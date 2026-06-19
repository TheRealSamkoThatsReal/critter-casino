/* Persistent game state (localStorage). No backend required. */
(function (G) {
  'use strict';
  const KEY = 'critcasino.v1';

  const def = {
    player: { id: null, name: 'Trainer' },
    coins: 250,
    inv: [],            // [{iid, sid, shiny}]
    customSpecies: [],  // admin-added species
    cooldowns: {},      // {free: timestamp}
    upgrades: {},       // idle upgrade levels {habitat, rarity, offline}
    lastTick: 0,        // timestamp of last income settle (for offline earnings)
    lastFed: 0,         // timestamp creatures were last fed (hunger/starvation)
    lastDeathRoll: 0,   // high-water mark for hourly starvation death rolls
    lastModRoll: 0,     // high-water mark for hourly income-modifier rolls
    discovered: {},     // Critterdex: every species id ever owned (persists across sell/gamble)
    newSpecies: {},     // species discovered but not yet viewed (shows a NEW badge)
    prestige: 0,        // number of times prestiged (permanent income multiplier)
    stardust: 0,            // ⭐ permanent meta-currency (persists across prestige)
    stardustUpgrades: {},   // {id: level} — permanent upgrade tree
    runCoinsEarned: 0,      // coins earned since last prestige (drives Stardust reward)
    lifetimeCoins: 0,       // total coins ever earned (milestones / records)
    peakCoins: 0,           // highest balance ever held (records)
    modsGained: 0,          // lifetime income modifiers grown (records)
    bmBuys: 0,              // black-market purchases this run (price escalation)
    claimedMilestones: {},  // milestone amount -> 1
    stats: { hatched: 0, gambled: 0, wins: 0, losses: 0, traded: 0 },
    adminPass: 'admin',
    seenAdmin: false
  };

  const STARTERS = ['c_emberpup', 'c_drizzle', 'c_leaflet'];

  let counter = 0;
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return seed(JSON.parse(JSON.stringify(def)));
      const s = Object.assign(JSON.parse(JSON.stringify(def)), JSON.parse(raw));
      if (!s.player.id) s.player.id = genId();
      if (!s.discovered) s.discovered = {};
      if (!s.newSpecies) s.newSpecies = {};
      // migrate: credit anything currently owned to the Critterdex
      (s.inv || []).forEach(function (it) { s.discovered[it.sid] = 1; });
      // existing players start well-fed so this update doesn't starve them
      if (!s.lastFed) s.lastFed = Date.now();
      // start the modifier clock now so existing saves don't get a retroactive burst
      if (!s.lastModRoll) s.lastModRoll = Date.now();
      if (!s.adminPass) s.adminPass = 'admin';
      return s;
    } catch (e) {
      return seed(JSON.parse(JSON.stringify(def)));
    }
  }

  function seed(s) {
    s.player.id = genId();
    s.discovered = s.discovered || {};
    s.lastFed = Date.now();
    s.lastModRoll = Date.now();
    // starter creatures so a new player has something to play with
    STARTERS.forEach(function (sid) {
      s.inv.push(mkInstance(sid));
      s.discovered[sid] = 1;
    });
    return s;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ids
  function genId() {
    return 'p' + Math.abs(G.sprites.hashStr(String(Date.now()) + Math.random())).toString(36);
  }
  function genIid() {
    counter++;
    return 'i' + Date.now().toString(36) + (counter).toString(36) +
      Math.floor(Math.random() * 1296).toString(36);
  }
  function mkInstance(sid, shiny) {
    return { iid: genIid(), sid: sid, shiny: !!shiny };
  }

  // species lookup (builtin + custom)
  function allSpecies() {
    return G.data.builtinRoster.concat(state.customSpecies);
  }
  function speciesMap() {
    const m = {};
    allSpecies().forEach(function (s) { m[s.id] = s; });
    return m;
  }
  function getSpecies(sid) { return speciesMap()[sid] || null; }

  function speciesByTier(tier) {
    return allSpecies().filter(function (s) { return s.tier === tier; });
  }

  // value of an instance (incl. the Fortune Stardust upgrade)
  function valueOf(item) {
    const sp = getSpecies(item.sid);
    if (!sp) return 0;
    let base = G.data.rarity(sp.tier).value;
    if (item.shiny) base *= 5;
    return Math.round(base * (1 + sdLinear('value')));
  }

  // gacha: pick a random species weighted by rarity weights.
  function randomSpecies(minTier, maxTier) {
    minTier = minTier == null ? 0 : minTier;
    maxTier = maxTier == null ? G.data.RARITIES.length - 1 : maxTier;
    maxTier = Math.min(maxTier, maxTierUnlocked()); // rarities above this are prestige-locked
    const pool = [];
    let total = 0;
    allSpecies().forEach(function (s) {
      if (s.tier < minTier || s.tier > maxTier) return;
      const w = G.data.rarity(s.tier).weight;
      pool.push({ s: s, w: w });
      total += w;
    });
    if (!pool.length) return null;
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) return pool[i].s;
    }
    return pool[pool.length - 1].s;
  }

  // daily egg: a random species from any unlocked tier, preferring one not yet
  // in the Critterdex (helps complete the collection toward prestige).
  // Favours undiscovered species, but WEIGHTED by rarity (raised to DAILY_POW)
  // so the rare tail of the Critterdex stays a real grind instead of being
  // handed to you one-per-day. Lower DAILY_POW => rares even less likely.
  const DAILY_POW = 0.35;
  function dailyPick() {
    const cap = maxTierUnlocked();
    const cands = allSpecies().filter(function (s) { return s.tier <= cap; });
    if (!cands.length) return null;
    const fresh = cands.filter(function (s) { return !state.discovered[s.id]; });
    const pool = fresh.length ? fresh : cands;
    let total = 0;
    const w = pool.map(function (s) { const x = Math.pow(G.data.rarity(s.tier).weight, DAILY_POW); total += x; return x; });
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  // pick a random species at exactly a tier (for upgrades)
  function randomSpeciesAtTier(tier) {
    const opts = speciesByTier(tier);
    if (!opts.length) return null;
    return opts[Math.floor(Math.random() * opts.length)];
  }

  // Critterdex: remember every species ever owned
  // first-ever acquisition of a species marks it NEW (until viewed)
  function discover(sid) {
    if (!sid) return;
    if (!state.discovered[sid]) { state.discovered[sid] = 1; state.newSpecies[sid] = 1; }
  }
  function isNew(sid) { return !!(state.newSpecies && state.newSpecies[sid]); }
  function markSeen(sid) { if (state.newSpecies && state.newSpecies[sid]) { delete state.newSpecies[sid]; save(); } }
  function newCount() { return state.newSpecies ? Object.keys(state.newSpecies).length : 0; }

  // inventory ops
  function addSpecies(sid, shiny) {
    const inst = mkInstance(sid, shiny);
    state.inv.push(inst);
    discover(sid);
    save();
    return inst;
  }
  function addInstance(inst) {
    if (!inst.iid) inst.iid = genIid();
    state.inv.push(inst);
    discover(inst.sid);
    save();
    return inst;
  }
  function removeInstance(iid) {
    const i = state.inv.findIndex(function (x) { return x.iid === iid; });
    if (i === -1) return null;
    const inst = state.inv.splice(i, 1)[0];
    save();
    return inst;
  }
  function getInstance(iid) {
    return state.inv.find(function (x) { return x.iid === iid; }) || null;
  }

  // coins are kept as a float so sub-1/sec idle income isn't lost to rounding;
  // the UI rounds for display.
  function trackEarn(n) {
    if (n <= 0) return;
    state.runCoinsEarned = (state.runCoinsEarned || 0) + n;
    state.lifetimeCoins = (state.lifetimeCoins || 0) + n;
  }
  function addCoins(n) {
    state.coins = Math.max(0, state.coins + n);
    if (n > 0) trackEarn(n);
    if (state.coins > (state.peakCoins || 0)) state.peakCoins = state.coins;
    save();
  }
  // idle income path: add coins + track earnings WITHOUT saving (caller batches saves)
  function earn(n) {
    if (n <= 0) return;
    state.coins += n;
    trackEarn(n);
    if (state.coins > (state.peakCoins || 0)) state.peakCoins = state.coins;
  }

  // ---- Stardust meta-currency ---------------------------------------------
  function sdDef(id) { return G.data.STARDUST_UPGRADES.filter(function (u) { return u.id === id; })[0]; }
  function sdLevel(id) { return (state.stardustUpgrades || {})[id] || 0; }
  function sdLinear(id) { const d = sdDef(id); return d ? d.per * sdLevel(id) : 0; } // additive effect
  function sdCost(id) { const d = sdDef(id); return d ? Math.floor(d.base * Math.pow(d.growth, sdLevel(id))) : Infinity; }
  function buyStardust(id) {
    const d = sdDef(id); if (!d) return false;
    const lvl = sdLevel(id);
    if (lvl >= d.max) return false;
    const cost = sdCost(id);
    if ((state.stardust || 0) < cost) return false;
    state.stardust -= cost;
    if (!state.stardustUpgrades) state.stardustUpgrades = {};
    state.stardustUpgrades[id] = lvl + 1;
    save();
    return true;
  }
  // effect getters used across the game
  function stardustIncomeMult() { return 1 + sdLinear('income'); }
  function casinoLuckMult() { return 1 + sdLinear('casino'); }
  function modRateMult() { return 1 + sdLinear('modrate'); }
  function shinyBonus() { return sdLinear('shiny'); }
  function nestKeepFrac() { return sdLinear('nest'); }
  function compounderMult() { return 1 + sdLinear('compound'); }
  function rollShiny(base) { return Math.random() < ((base || 0) + shinyBonus()); }

  // Stardust granted if you prestige right now: sqrt curve on coins earned this
  // run, boosted by the Compounder upgrade. Banking/spending coins => more power.
  function stardustReward() {
    const earned = state.runCoinsEarned || 0;
    if (earned < 1e5) return 0; // need ~100k earned in a run to start yielding
    const base = 8 * Math.sqrt(earned / 1e6);
    return Math.max(1, Math.floor(base * compounderMult()));
  }

  // grant any newly-reached lifetime-coin milestones; returns [{amt, sd}] granted
  function checkMilestones() {
    const got = [];
    if (!state.claimedMilestones) state.claimedMilestones = {};
    G.data.COIN_MILESTONES.forEach(function (m) {
      const key = String(m.amt);
      if (!state.claimedMilestones[key] && (state.lifetimeCoins || 0) >= m.amt) {
        state.claimedMilestones[key] = 1;
        state.stardust = (state.stardust || 0) + m.sd;
        got.push(m);
      }
    });
    if (got.length) save();
    return got;
  }
  function noteModifierGained(n) { state.modsGained = (state.modsGained || 0) + (n || 1); }

  // ---- prestige (collect every base creature -> reset for a permanent bonus)
  // Completion is based on the built-in roster only, so admin-added creatures
  // don't make the goal unreachable.
  // highest rarity tier currently available. Each prestige unlocks one more
  // tier above Divine (prestige 1 -> Celestial ... prestige 6 -> Omega).
  function maxTierUnlocked() {
    return Math.min(G.data.RARITIES.length - 1, G.data.PRESTIGE_MAX_TIER + (state.prestige || 0));
  }
  function dexProgress() {
    const cap = maxTierUnlocked();
    const req = G.data.builtinRoster.filter(function (sp) { return sp.tier <= cap; });
    let have = 0;
    req.forEach(function (sp) { if (state.discovered[sp.id]) have++; });
    return { have: have, total: req.length };
  }
  function canPrestige() {
    const p = dexProgress();
    return p.have >= p.total;
  }
  function prestigeLevel() { return state.prestige || 0; }
  function prestigeMult() { return 1 + 0.5 * (state.prestige || 0); } // +50% income per prestige
  // egg prices & casino value-to-tier scale up each prestige (outpaces income,
  // so each prestige is harder than the last).
  function progressScale() { return Math.pow(1.85, state.prestige || 0); }

  function doPrestige() {
    if (!canPrestige()) return false;
    // award Stardust for the run before wiping it, and honour the Nest Egg keep
    const reward = stardustReward();
    state.stardust = (state.stardust || 0) + reward;
    const kept = Math.floor((state.coins || 0) * nestKeepFrac());
    state.prestige = (state.prestige || 0) + 1;
    // hard reset of the run, keeping identity, custom species, lifetime stats
    state.inv = [];
    state.coins = Math.max(250, kept);
    state.runCoinsEarned = 0;
    state.bmBuys = 0;
    state.upgrades = {};
    state.cooldowns = {};
    state.discovered = {};
    state.newSpecies = {};
    state.lastTick = Date.now();
    state.lastModRoll = Date.now();
    state.lastFed = Date.now();
    state.lastDeathRoll = 0;
    STARTERS.forEach(function (sid) { state.inv.push(mkInstance(sid)); state.discovered[sid] = 1; });
    save();
    return true;
  }

  G.state = {
    get: function () { return state; },
    save: save,
    reset: function () { localStorage.removeItem(KEY); state = load(); save(); },
    mkInstance: mkInstance,
    genIid: genIid,
    allSpecies: allSpecies,
    getSpecies: getSpecies,
    speciesByTier: speciesByTier,
    valueOf: valueOf,
    randomSpecies: randomSpecies,
    randomSpeciesAtTier: randomSpeciesAtTier,
    dailyPick: dailyPick,
    addSpecies: addSpecies,
    addInstance: addInstance,
    removeInstance: removeInstance,
    getInstance: getInstance,
    isNew: isNew, markSeen: markSeen, newCount: newCount,
    addCoins: addCoins,
    earn: earn,
    valueMult: function () { return 1 + sdLinear('value'); },
    stardustIncomeMult: stardustIncomeMult,
    casinoLuckMult: casinoLuckMult,
    modRateMult: modRateMult,
    shinyBonus: shinyBonus,
    rollShiny: rollShiny,
    nestKeepFrac: nestKeepFrac,
    compounderMult: compounderMult,
    sdLevel: sdLevel, sdLinear: sdLinear, sdCost: sdCost, sdDef: sdDef,
    buyStardust: buyStardust,
    stardustReward: stardustReward,
    checkMilestones: checkMilestones,
    noteModifierGained: noteModifierGained,
    dexProgress: dexProgress,
    canPrestige: canPrestige,
    prestigeLevel: prestigeLevel,
    prestigeMult: prestigeMult,
    progressScale: progressScale,
    maxTierUnlocked: maxTierUnlocked,
    doPrestige: doPrestige
  };
})(window.G = window.G || {});
