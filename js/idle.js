/* Idle / passive-income system: your creatures generate coins per second based
 * on rarity, even while you're away (offline earnings, capped). Coins buy
 * upgrades that boost income. */
(function (G) {
  'use strict';
  const el = G.ui.el, fmt = G.ui.fmt, toast = G.ui.toast;

  // coins/sec produced by one creature of each tier (shiny = x5)
  const RATE = [0.05, 0.2, 0.8, 3, 12, 45, 180,
    700, 2800, 11000, 44000, 175000, 700000];

  // income rates can be fractional; keep small values readable instead of "0"
  function fmtRate(n) {
    if (n <= 0) return '0';
    if (n < 1) return String(+n.toFixed(2));
    if (n < 10) return String(+n.toFixed(1));
    return fmt(n);
  }

  const UPGRADES = [
    { id: 'habitat', icon: '🏡', name: 'Habitat',      desc: '+25% income from ALL creatures', baseCost: 150,  growth: 1.7, max: Infinity },
    { id: 'rarity',  icon: '💎', name: 'Gilded Cages', desc: '+15% income from Rare and rarer', baseCost: 400,  growth: 1.8, max: Infinity },
    { id: 'offline', icon: '🛏', name: 'Cozy Beds',    desc: '+2h offline earning cap',        baseCost: 1500, growth: 2.4, max: 8 }
  ];
  function costOf(def, level) { return Math.floor(def.baseCost * Math.pow(def.growth, level)); }
  function lvl(id) { const u = G.state.get().upgrades || {}; return u[id] || 0; }

  function habitatMult() { return 1 + 0.25 * lvl('habitat'); }
  function rarityMult() { return 1 + 0.15 * lvl('rarity'); }
  function offlineCapSec() { return (4 + 2 * lvl('offline')) * 3600; }

  // income for a single creature instance (incl. all multipliers)
  function creatureIncome(item) {
    const sp = G.state.getSpecies(item.sid);
    if (!sp) return 0;
    let v = RATE[sp.tier] * (item.shiny ? 5 : 1);
    if (sp.tier >= 2) v *= rarityMult();
    v *= G.data.modMult(item.mod); // rare income modifier (ranch-grown)
    return v * habitatMult() * G.state.prestigeMult();
  }
  function rawIncomePerSec() {
    return G.state.get().inv.reduce(function (a, it) { return a + creatureIncome(it); }, 0);
  }
  // hungry/starving creatures still earn, just reduced
  function incomePerSec() {
    return rawIncomePerSec() * hungerMult();
  }

  // ---- hunger / feeding ----------------------------------------------------
  const FEED_MS = 24 * 3600 * 1000;    // income drops to 25% after this long unfed
  const STARVE_MS = 72 * 3600 * 1000;  // deaths begin after this long unfed
  const DEATH_PER_HOUR = 0.03;         // per creature, each hour while starving
  const HUNGRY_MULT = 0.25;            // income multiplier while hungry/starving
  function hungerMult() { return fedState() === 'fed' ? 1 : HUNGRY_MULT; }

  function msSinceFed() { const f = G.state.get().lastFed || Date.now(); return Math.max(0, Date.now() - f); }
  function hoursSinceFed() { return msSinceFed() / 3600000; }
  function fedState() {
    const ms = msSinceFed();
    if (ms >= STARVE_MS) return 'starving';
    if (ms >= FEED_MS) return 'hungry';
    return 'fed';
  }

  function feed() {
    const s = G.state.get();
    if (!s.inv.length) { toast('No creatures to feed.', ''); return; }
    s.lastFed = Date.now();
    s.lastDeathRoll = s.lastFed;
    G.state.save();
    G.ui.haptic([20, 30, 60]);
    toast('🍖 Fed your creatures! Income restored.', 'good');
    if (G.push && G.push.heartbeat) G.push.heartbeat(); // tell the server they're fed
    if (window.refreshAll) window.refreshAll(); else render(document.getElementById('view'));
    updateLive();
  }

  // Hold-to-feed: must press & hold ~5s (progress fill + building rumble) so
  // you can't feed by reflex-tapping. Releasing early cancels.
  function wireHold(btn, fill, onComplete) {
    const DUR = 5000;
    let raf = null, startTs = 0, holding = false, lastTick = 0;
    function reset() { holding = false; if (raf) cancelAnimationFrame(raf); raf = null; startTs = 0; fill.style.width = '0%'; btn.classList.remove('holding'); }
    function frame(ts) {
      if (!holding) return;
      if (!startTs) startTs = ts;
      const p = Math.min(1, (ts - startTs) / DUR);
      fill.style.width = (p * 100) + '%';
      // building rumble: pulses get stronger and more frequent toward the end
      if (ts - lastTick > (220 - p * 130)) { lastTick = ts; G.ui.haptic(Math.round(12 + p * 35)); }
      if (p >= 1) { reset(); onComplete(); return; }
      raf = requestAnimationFrame(frame);
    }
    btn.addEventListener('pointerdown', function (e) { e.preventDefault(); if (holding) return; holding = true; lastTick = 0; btn.classList.add('holding'); raf = requestAnimationFrame(frame); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, reset); });
    btn.addEventListener('click', function (e) { e.preventDefault(); }); // taps do nothing
  }
  function feedButton(onDone) {
    const fill = el('span', { class: 'hold-fill' });
    const btn = el('button', { class: 'btn primary hold-btn' }, [fill, el('span', { class: 'hold-label', text: '🍖 Hold to feed' })]);
    wireHold(btn, fill, function () { feed(); if (onDone) onDone(); });
    return btn;
  }

  // Apply hourly death rolls for any starving hours up to `now`. Returns # died.
  function processStarvation(now) {
    const s = G.state.get();
    const starveStart = (s.lastFed || now) + STARVE_MS;
    const from = Math.max(s.lastDeathRoll || 0, starveStart);
    if (now <= from) return 0;
    const hours = Math.floor((now - from) / 3600000);
    if (hours <= 0) return 0;
    let died = 0;
    for (let h = 0; h < hours && s.inv.length; h++) {
      for (let i = s.inv.length - 1; i >= 0; i--) {
        if (Math.random() < DEATH_PER_HOUR) { s.inv.splice(i, 1); died++; }
      }
    }
    s.lastDeathRoll = from + hours * 3600000;
    if (died) G.state.save();
    return died;
  }

  // Per eligible (unmodified) creature, a small hourly chance to develop a rare
  // income modifier. Rolls whole elapsed hours (works live and for offline gaps).
  // Returns [{item, mod}] for any granted this pass.
  const MOD_PER_HOUR = 0.0006; // ~0.06%/creature/hour — rare; ~1/week for a typical collection, scales with size
  function processModifiers(now) {
    const s = G.state.get();
    const from = s.lastModRoll || now;
    const hours = Math.floor((now - from) / 3600000);
    if (hours <= 0) return [];
    const loopHours = Math.min(hours, 2000); // bound the loop for very long gaps
    s.lastModRoll = hours > 2000 ? now : from + hours * 3600000;
    const gained = [];
    for (let h = 0; h < loopHours; h++) {
      for (let i = 0; i < s.inv.length; i++) {
        const it = s.inv[i];
        if (it.mod) continue; // one modifier per creature, no re-rolls
        if (Math.random() < MOD_PER_HOUR) {
          it.mod = G.data.rollModifierId();
          gained.push({ item: it, mod: it.mod });
        }
      }
    }
    if (gained.length) G.state.save();
    return gained;
  }

  // celebratory toast(s) when creatures develop a modifier
  function announceModifiers(gained) {
    if (!gained || !gained.length) return;
    gained.slice(0, 3).forEach(function (g) {
      const m = G.data.modifier(g.mod), sp = G.state.getSpecies(g.item.sid);
      if (!m || !sp) return;
      toast(m.icon + ' ' + sp.name + ' became ' + m.name + '! ×' + m.mult + ' income', 'good');
    });
    if (gained.length > 3) toast('✦ ' + (gained.length - 3) + ' more creatures gained modifiers!', 'good');
    G.ui.haptic([15, 30, 15, 30, 60]);
  }

  // ---- offline / ticking ---------------------------------------------------
  function collectOffline() {
    const s = G.state.get();
    const now = Date.now();
    if (!s.lastTick) { s.lastTick = now; G.state.save(); return null; }
    const elapsed = Math.max(0, (now - s.lastTick) / 1000);
    // Income: full rate while fed (lastFed..lastFed+24h), 25% after, all within
    // the offline cap. Computed BEFORE deaths (starvation happens after the fed window).
    const fedUntil = (s.lastFed || now) + FEED_MS;
    const start = s.lastTick;
    const endCap = Math.min(now, start + offlineCapSec() * 1000);
    const raw = rawIncomePerSec();
    const fullSec = Math.max(0, (Math.min(endCap, fedUntil) - start) / 1000);
    const hungrySec = Math.max(0, (endCap - Math.max(start, fedUntil)) / 1000);
    const earned = raw * (fullSec + hungrySec * HUNGRY_MULT);
    if (earned > 0) s.coins += earned;
    s.lastTick = now;
    const died = processStarvation(now); // also saves if any died
    const mods = processModifiers(now);  // also saves if any granted
    G.state.save();
    return { earned: earned, elapsed: elapsed, capped: Math.min(elapsed, offlineCapSec()), died: died, mods: mods };
  }

  let iv = null, ticks = 0;
  function tick() {
    const s = G.state.get();
    const inc = incomePerSec(); // 0 when hungry/starving
    if (inc > 0) s.coins += inc; // one second's worth
    processStarvation(Date.now()); // acts only when a whole starving hour elapses
    announceModifiers(processModifiers(Date.now())); // rare modifier grants (acts hourly)
    ticks++;
    if (ticks % 10 === 0) { s.lastTick = Date.now(); G.state.save(); }
    updateLive();
  }
  function start() { if (!iv) iv = setInterval(tick, 1000); }
  function stop() {
    if (iv) { clearInterval(iv); iv = null; }
    const s = G.state.get(); s.lastTick = Date.now(); G.state.save();
  }

  function feedStatus() {
    const st = fedState();
    const ms = msSinceFed();
    if (st === 'fed') return { cls: 'fed', icon: '🍖', text: 'Fed — hungry in ' + fmtDuration((FEED_MS - ms) / 1000) };
    if (st === 'hungry') return { cls: 'hungry', icon: '🍽️', text: 'Hungry! Earning 25% — starving in ' + fmtDuration((STARVE_MS - ms) / 1000) };
    return { cls: 'starving', icon: '💀', text: 'STARVING! 25% income & may die hourly — feed now!' };
  }

  function updateLive() {
    const s = G.state.get();
    const coinEl = document.getElementById('coins');
    if (coinEl) coinEl.textContent = fmt(s.coins);
    const st = fedState();
    const inc = document.getElementById('idle-income');
    if (inc) inc.textContent = '⛁ ' + fmtRate(incomePerSec()) + ' /s' + (st === 'fed' ? '' : ' 🍽️');
    const bal = document.getElementById('idle-balance');
    if (bal) bal.textContent = '⛁ ' + fmt(s.coins);
    document.querySelectorAll('.idle-buy').forEach(function (b) {
      const c = +b.dataset.cost;
      if (!isNaN(c)) b.disabled = s.coins < c;
    });
    // feeding status text + card class
    const fs = feedStatus();
    const fst = document.getElementById('feed-status');
    if (fst) fst.textContent = fs.icon + ' ' + fs.text;
    const fcard = document.getElementById('feed-card');
    if (fcard) fcard.className = 'feed-card ' + fs.cls;
    // topbar hunger badge
    const fb = document.getElementById('feed-badge');
    if (fb) {
      if (!s.inv.length || st === 'fed') { fb.hidden = true; }
      else { fb.hidden = false; fb.textContent = st === 'starving' ? '💀' : '🍖'; fb.className = 'feed-badge ' + st; }
    }
  }

  // ---- offline welcome-back modal -----------------------------------------
  function fmtDuration(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + s + 's';
    return s + 's';
  }
  function offlineModal(res) {
    const node = el('div', { class: 'reveal' });
    node.appendChild(el('div', { class: 'reveal-head', text: '🏡 Welcome back!' }));
    if (res.earned >= 1) {
      node.appendChild(el('div', { class: 'offline-earn', text: '⛁ ' + fmt(res.earned) }));
      node.appendChild(el('div', { class: 'gsub', text:
        'Earned while you were away (' + fmtDuration(res.elapsed) +
        (res.capped < res.elapsed ? ', capped at ' + fmtDuration(offlineCapSec()) : '') + ').' }));
    }
    if (res.died > 0) {
      node.appendChild(el('div', { class: 'gresult bad', text:
        '💀 ' + res.died + ' creature' + (res.died > 1 ? 's' : '') + ' starved while you were away!' }));
    }
    if (res.mods && res.mods.length) {
      res.mods.slice(0, 4).forEach(function (g) {
        const md = G.data.modifier(g.mod), sp = G.state.getSpecies(g.item.sid);
        if (md && sp) node.appendChild(el('div', { class: 'gresult good', text:
          md.icon + ' ' + sp.name + ' became ' + md.name + '! ×' + md.mult + ' income' }));
      });
      if (res.mods.length > 4) node.appendChild(el('div', { class: 'gsub', text: '…and ' + (res.mods.length - 4) + ' more gained modifiers.' }));
    }
    const st = fedState();
    if (st !== 'fed') {
      node.appendChild(el('div', { class: 'gsub', text:
        '⚠️ Your creatures are ' + (st === 'starving' ? 'STARVING (25% income) and dying' : 'hungry — earning only 25%') + '.' }));
    }
    const m = G.ui.modal('', node);
    const acts = [];
    if (st !== 'fed') {
      acts.push(feedButton(function () { m.close(); }));
      acts.push(el('button', { class: 'btn', text: 'Later', onclick: function () { m.close(); } }));
    } else {
      acts.push(el('button', { class: 'btn primary', text: 'Collect', onclick: function () { m.close(); } }));
    }
    node.appendChild(el('div', { class: 'gaction' }, acts));
  }

  // ---- feeding panel -------------------------------------------------------
  function feedingPanel(container) {
    const s = G.state.get();
    if (!s.inv.length) return;
    const fs = feedStatus();
    const card = el('div', { id: 'feed-card', class: 'feed-card ' + fs.cls }, [
      el('div', { class: 'feed-head' }, [
        el('div', { class: 'feed-title', text: '🍖 Feeding' }),
        el('div', { id: 'feed-status', class: 'feed-status', text: fs.icon + ' ' + fs.text })
      ]),
      el('div', { class: 'feed-sub', text:
        'Feed your creatures every 24h to keep them earning. After 3 days unfed, they may start dying each hour.' }),
      el('div', { class: 'gaction' }, [feedButton()])
    ]);
    container.appendChild(card);
  }

  // ---- buy -----------------------------------------------------------------
  function buy(id) {
    const def = UPGRADES.filter(function (u) { return u.id === id; })[0];
    const s = G.state.get();
    const level = lvl(id);
    if (level >= def.max) { toast('Maxed out!', ''); return; }
    const cost = costOf(def, level);
    if (s.coins < cost) { toast('Not enough coins.', 'bad'); return; }
    s.coins -= cost;
    if (!s.upgrades) s.upgrades = {};
    s.upgrades[id] = level + 1;
    G.state.save();
    G.ui.haptic(20);
    toast(def.name + ' Lv ' + (level + 1) + '!', 'good');
    render(document.getElementById('view'));
  }

  // ---- prestige ------------------------------------------------------------
  function nextUnlockName() {
    const t = G.state.maxTierUnlocked() + 1;
    return t < G.data.RARITIES.length ? G.data.rarity(t).name : null;
  }
  function confirmPrestige() {
    if (!G.state.canPrestige()) return;
    const next = G.state.prestigeLevel() + 1;
    const bonus = Math.round((0.5 * next) * 100);
    const unlock = nextUnlockName();
    const node = el('div', {});
    node.appendChild(el('p', { class: 'gdesc', html:
      'Prestiging <b>resets</b> your creatures, coins, and Ranch upgrades — and clears your Critterdex.<br><br>' +
      'In return you gain a <b>permanent +50% income</b> (total +' + bonus + '% after this)' +
      (unlock ? ' and <b>unlock the ' + unlock + ' rarity</b>' : '') +
      ', then collect them all again to prestige higher.' }));
    const m = G.ui.modal('Prestige?', node);
    node.appendChild(el('div', { class: 'gaction' }, [
      el('button', { class: 'btn primary', text: '✨ Prestige', onclick: function () {
        if (G.state.doPrestige()) {
          G.ui.haptic([30, 50, 30, 50, 30, 50, 120]);
          m.close();
          toast('Prestige ' + G.state.prestigeLevel() + '! +' + bonus + '% permanent income.', 'good');
          render(document.getElementById('view'));
          if (window.refreshAll) window.refreshAll();
        }
      } }),
      el('button', { class: 'btn', text: 'Cancel', onclick: function () { m.close(); } })
    ]));
  }

  // show the still-undiscovered creatures (up to the unlocked cap) as silhouettes
  function showMissing() {
    const cap = G.state.maxTierUnlocked();
    const disc = G.state.get().discovered;
    const missing = G.state.allSpecies().filter(function (sp) { return sp.tier <= cap && !disc[sp.id]; });
    missing.sort(function (a, b) { return (a.tier - b.tier) || a.name.localeCompare(b.name); });
    const node = el('div', {});
    if (!missing.length) {
      node.appendChild(el('p', { class: 'gdesc', text: 'You\'ve collected everything — you can prestige!' }));
      G.ui.modal('Critterdex complete', node);
      return;
    }
    node.appendChild(el('p', { class: 'gdesc', text:
      'Discover these ' + missing.length + ' creature' + (missing.length !== 1 ? 's' : '') + ' to prestige:' }));
    const grid = el('div', { class: 'grid pick-grid' });
    missing.forEach(function (sp) {
      grid.appendChild(G.ui.card({ iid: 'm', sid: sp.id, shiny: false }, { size: 54, silhouette: true, showValue: false }));
    });
    node.appendChild(grid);
    G.ui.modal('Still needed (' + missing.length + ')', node);
  }

  function prestigePanel(container) {
    const p = G.state.dexProgress();
    const level = G.state.prestigeLevel();
    const pct = p.total ? Math.floor(p.have / p.total * 100) : 0;
    const ready = G.state.canPrestige();
    const card = el('div', { class: 'prestige-card' + (ready ? ' ready' : '') });
    card.appendChild(el('div', { class: 'prestige-head' }, [
      el('div', { class: 'prestige-title', html: '✨ Prestige' + (level ? ' <span class="prestige-lvl">Lv ' + level + '</span>' : '') }),
      el('div', { class: 'prestige-bonus', text: level ? ('+' + Math.round((G.state.prestigeMult() - 1) * 100) + '% income') : 'no bonus yet' })
    ]));
    const top = G.data.rarity(G.state.maxTierUnlocked()).name;
    const nxt = nextUnlockName();
    card.appendChild(el('div', { class: 'prestige-sub', text:
      'Top rarity unlocked: ' + top + '. ' +
      (nxt ? 'Collect them all, then prestige to unlock ' + nxt + ' + permanent income.'
           : 'Max rarity reached — prestige for more permanent income.') }));
    const fill = el('div', { class: 'pbar-fill' });
    fill.style.width = pct + '%';
    card.appendChild(el('div', { class: 'pbar' }, [fill]));
    card.appendChild(el('div', { class: 'prestige-prog', text: 'Critterdex: ' + p.have + ' / ' + p.total + ' (' + pct + '%)' }));
    const btn = el('button', { class: 'btn primary',
      text: ready ? (nxt ? '✨ Prestige → unlock ' + nxt : '✨ Prestige now') : '🔍 See what\'s left' });
    btn.addEventListener('click', function () { if (G.state.canPrestige()) confirmPrestige(); else showMissing(); });
    card.appendChild(el('div', { class: 'gaction' }, [btn]));
    container.appendChild(card);
  }

  // ---- Ranch view ----------------------------------------------------------
  function render(container) {
    container.innerHTML = '';
    container.appendChild(el('h2', { class: 'view-title', text: '🏡 Ranch' }));
    container.appendChild(el('p', { class: 'view-sub', text:
      'Your creatures earn coins over time based on rarity — even while the app is closed. Spend coins on upgrades to earn faster.' }));

    feedingPanel(container);
    prestigePanel(container);

    const s = G.state.get();
    container.appendChild(el('div', { class: 'idle-stats' }, [
      el('div', { class: 'idle-stat' }, [
        el('b', { id: 'idle-income', text: '⛁ ' + fmtRate(incomePerSec()) + ' /s' }),
        el('span', { text: 'income' })
      ]),
      el('div', { class: 'idle-stat' }, [
        el('b', { id: 'idle-balance', text: '⛁ ' + fmt(s.coins) }),
        el('span', { text: 'balance' })
      ]),
      el('div', { class: 'idle-stat' }, [
        el('b', { text: String(s.inv.length) }),
        el('span', { text: 'earners' })
      ])
    ]));

    if (!s.inv.length) {
      container.appendChild(el('div', { class: 'empty', html:
        'No creatures earning yet.<br>Hatch some to start your passive income!' }));
      return;
    }

    // income breakdown by rarity
    const breakdown = el('div', { class: 'idle-breakdown' });
    G.data.RARITIES.forEach(function (r) {
      const items = s.inv.filter(function (it) { const sp = G.state.getSpecies(it.sid); return sp && sp.tier === r.tier; });
      if (!items.length) return;
      const inc = items.reduce(function (a, it) { return a + creatureIncome(it); }, 0);
      const row = el('div', { class: 'bd-row' }, [
        el('span', { class: 'bd-name pill r' + r.tier, text: r.name }),
        el('span', { class: 'bd-count', text: '×' + items.length }),
        el('span', { class: 'bd-inc', text: '⛁ ' + fmtRate(inc) + ' /s' })
      ]);
      breakdown.appendChild(row);
    });
    container.appendChild(el('div', { class: 'panel' }, [
      el('h3', { text: '📈 Income by rarity' }), breakdown
    ]));

    // upgrades
    const upWrap = el('div', { class: 'idle-upgrades' });
    UPGRADES.forEach(function (def) {
      const level = lvl(def.id);
      const maxed = level >= def.max;
      const cost = costOf(def, level);
      const tile = el('div', { class: 'upgrade-tile' }, [
        el('div', { class: 'up-icon', text: def.icon }),
        el('div', { class: 'up-main' }, [
          el('div', { class: 'up-name', text: def.name + ' ' + (maxed ? '(MAX)' : 'Lv ' + level) }),
          el('div', { class: 'up-desc', text: def.desc })
        ]),
        maxed
          ? el('button', { class: 'btn small', disabled: 'disabled', text: 'MAX' })
          : (function () {
              const b = el('button', { class: 'btn small primary idle-buy', text: '⛁ ' + fmt(cost),
                onclick: function () { buy(def.id); } });
              b.dataset.cost = cost;
              b.disabled = s.coins < cost;
              return b;
            })()
      ]);
      upWrap.appendChild(tile);
    });
    container.appendChild(el('div', { class: 'panel' }, [
      el('h3', { text: '⚡ Upgrades' }), upWrap
    ]));
    updateLive();
  }

  // ---- init ----------------------------------------------------------------
  function shouldModal(res) {
    return res && ((res.earned >= 1 && res.elapsed > 60) || res.died > 0 || (res.mods && res.mods.length));
  }
  function init() {
    const res = collectOffline();
    if (shouldModal(res)) offlineModal(res);
    start();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stop(); }
      else {
        const r = collectOffline();
        if (shouldModal(r)) offlineModal(r);
        start();
        updateLive();
      }
    });
  }

  G.idle = { init: init, render: render, incomePerSec: incomePerSec, creatureIncome: creatureIncome,
    fmtRate: fmtRate, feed: feed, fedState: fedState };
})(window.G = window.G || {});
