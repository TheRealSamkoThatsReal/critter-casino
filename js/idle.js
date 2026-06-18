/* Idle / passive-income system: your creatures generate coins per second based
 * on rarity, even while you're away (offline earnings, capped). Coins buy
 * upgrades that boost income. */
(function (G) {
  'use strict';
  const el = G.ui.el, fmt = G.ui.fmt, toast = G.ui.toast;

  // coins/sec produced by one creature of each tier (shiny = x5)
  const RATE = [0.05, 0.2, 0.8, 3, 12, 45, 180];

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
    return v * habitatMult();
  }
  function incomePerSec() {
    return G.state.get().inv.reduce(function (a, it) { return a + creatureIncome(it); }, 0);
  }

  // ---- offline / ticking ---------------------------------------------------
  function collectOffline() {
    const s = G.state.get();
    const now = Date.now();
    if (!s.lastTick) { s.lastTick = now; G.state.save(); return null; }
    const elapsed = Math.max(0, (now - s.lastTick) / 1000);
    s.lastTick = now;
    const capped = Math.min(elapsed, offlineCapSec());
    const earned = incomePerSec() * capped;
    if (earned > 0) s.coins += earned;
    G.state.save();
    return { earned: earned, elapsed: elapsed, capped: capped };
  }

  let iv = null, ticks = 0;
  function tick() {
    const s = G.state.get();
    const inc = incomePerSec();
    if (inc > 0) s.coins += inc; // one second's worth
    ticks++;
    if (ticks % 10 === 0) { s.lastTick = Date.now(); G.state.save(); }
    updateLive();
  }
  function start() { if (!iv) iv = setInterval(tick, 1000); }
  function stop() {
    if (iv) { clearInterval(iv); iv = null; }
    const s = G.state.get(); s.lastTick = Date.now(); G.state.save();
  }

  function updateLive() {
    const coinEl = document.getElementById('coins');
    if (coinEl) coinEl.textContent = fmt(G.state.get().coins);
    const inc = document.getElementById('idle-income');
    if (inc) inc.textContent = '⛁ ' + fmtRate(incomePerSec()) + ' /s';
    const bal = document.getElementById('idle-balance');
    if (bal) bal.textContent = '⛁ ' + fmt(G.state.get().coins);
    document.querySelectorAll('.idle-buy').forEach(function (b) {
      const c = +b.dataset.cost;
      if (!isNaN(c)) b.disabled = G.state.get().coins < c;
    });
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
    node.appendChild(el('div', { class: 'offline-earn', text: '⛁ ' + fmt(res.earned) }));
    node.appendChild(el('div', { class: 'gsub', text:
      'Your ranch earned this while you were away (' + fmtDuration(res.elapsed) +
      (res.capped < res.elapsed ? ', capped at ' + fmtDuration(offlineCapSec()) : '') + ').' }));
    const m = G.ui.modal('', node);
    node.appendChild(el('div', { class: 'gaction' }, [
      el('button', { class: 'btn primary', text: 'Collect', onclick: function () { m.close(); } })
    ]));
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

  // ---- Ranch view ----------------------------------------------------------
  function render(container) {
    container.innerHTML = '';
    container.appendChild(el('h2', { class: 'view-title', text: '🏡 Ranch' }));
    container.appendChild(el('p', { class: 'view-sub', text:
      'Your creatures earn coins over time based on rarity — even while the app is closed. Spend coins on upgrades to earn faster.' }));

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
  function init() {
    const res = collectOffline();
    if (res && res.earned >= 1 && res.elapsed > 60) offlineModal(res);
    start();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stop(); }
      else {
        const r = collectOffline();
        if (r && r.earned >= 1 && r.elapsed > 60) offlineModal(r);
        start();
        updateLive();
      }
    });
  }

  G.idle = { init: init, render: render, incomePerSec: incomePerSec, creatureIncome: creatureIncome, fmtRate: fmtRate };
})(window.G = window.G || {});
