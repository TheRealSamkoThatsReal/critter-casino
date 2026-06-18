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
    stats: { hatched: 0, gambled: 0, wins: 0, losses: 0, traded: 0 },
    seenAdmin: false
  };

  let counter = 0;
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return seed(JSON.parse(JSON.stringify(def)));
      const s = Object.assign(JSON.parse(JSON.stringify(def)), JSON.parse(raw));
      if (!s.player.id) s.player.id = genId();
      return s;
    } catch (e) {
      return seed(JSON.parse(JSON.stringify(def)));
    }
  }

  function seed(s) {
    s.player.id = genId();
    // starter creatures so a new player has something to play with
    ['c_emberpup', 'c_drizzle', 'c_leaflet'].forEach(function (sid) {
      s.inv.push(mkInstance(sid));
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

  // value of an instance
  function valueOf(item) {
    const sp = getSpecies(item.sid);
    if (!sp) return 0;
    const base = G.data.rarity(sp.tier).value;
    return item.shiny ? base * 5 : base;
  }

  // gacha: pick a random species weighted by rarity weights.
  function randomSpecies(minTier, maxTier) {
    minTier = minTier == null ? 0 : minTier;
    maxTier = maxTier == null ? G.data.RARITIES.length - 1 : maxTier;
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

  // pick a random species at exactly a tier (for upgrades)
  function randomSpeciesAtTier(tier) {
    const opts = speciesByTier(tier);
    if (!opts.length) return null;
    return opts[Math.floor(Math.random() * opts.length)];
  }

  // inventory ops
  function addSpecies(sid, shiny) {
    const inst = mkInstance(sid, shiny);
    state.inv.push(inst);
    save();
    return inst;
  }
  function addInstance(inst) {
    if (!inst.iid) inst.iid = genIid();
    state.inv.push(inst);
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
  function addCoins(n) { state.coins = Math.max(0, state.coins + n); save(); }

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
    addSpecies: addSpecies,
    addInstance: addInstance,
    removeInstance: removeInstance,
    getInstance: getInstance,
    addCoins: addCoins
  };
})(window.G = window.G || {});
