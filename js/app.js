/* Main app: navigation, collection view, hatching, and bootstrap. */
(function (G) {
  'use strict';
  const el = G.ui.el, toast = G.ui.toast, fmt = G.ui.fmt;

  let current = 'collection';
  let collFilter = 'all', collSort = 'rarity';

  // ---- header --------------------------------------------------------------
  function renderHeader() {
    const s = G.state.get();
    const c = document.getElementById('coins');
    if (c) c.textContent = fmt(s.coins);
    const cnt = document.getElementById('inv-count');
    if (cnt) cnt.textContent = s.inv.length;
    const pb = document.getElementById('prestige-badge');
    if (pb) {
      const lvl = G.state.prestigeLevel();
      pb.hidden = lvl < 1;
      pb.textContent = '✨ ' + lvl;
    }
  }

  // ---- collection ----------------------------------------------------------
  function collectionValue() {
    return G.state.get().inv.reduce(function (a, it) { return a + G.state.valueOf(it); }, 0);
  }

  function detail(item) {
    const sp = G.state.getSpecies(item.sid);
    const r = G.data.rarity(sp.tier);
    const node = el('div', { class: 'detail' });
    const big = el('div', { class: 'detail-sprite r' + sp.tier });
    big.style.setProperty('--rcolor', r.color);
    big.appendChild(G.sprites.el(sp, 150));
    node.appendChild(big);
    node.appendChild(el('div', { class: 'detail-name', text: (item.shiny ? '✨ ' : '') + sp.name }));
    node.appendChild(el('div', { class: 'detail-meta', html:
      '<span class="pill r' + sp.tier + '">' + r.name + '</span> ' +
      '<span class="pill">' + sp.element + '</span> ' +
      '<span class="pill">⛁ ' + fmt(G.state.valueOf(item)) + '</span> ' +
      '<span class="pill">📈 ⛁ ' + G.idle.fmtRate(G.idle.creatureIncome(item)) + '/s</span>' }));
    const m = G.ui.modal(sp.name, node);
    node.appendChild(el('div', { class: 'gaction' }, [
      el('button', { class: 'btn', text: '💰 Sell for ⛁ ' + fmt(G.state.valueOf(item)), onclick: function () {
        const v = G.state.valueOf(item);
        G.state.removeInstance(item.iid);
        G.state.addCoins(v);
        m.close(); toast('Sold ' + sp.name + ' for ' + fmt(v) + ' coins.', 'good');
        refreshAll();
      } })
    ]));
  }

  function renderCollection(container) {
    const s = G.state.get();
    container.innerHTML = '';
    container.appendChild(el('h2', { class: 'view-title', text: '📦 Collection' }));
    const uniq = {};
    s.inv.forEach(function (it) { uniq[it.sid] = 1; });
    container.appendChild(el('div', { class: 'coll-stats' }, [
      el('div', { class: 'stat' }, [el('b', { text: String(s.inv.length) }), el('span', { text: 'creatures' })]),
      el('div', { class: 'stat' }, [el('b', { text: '⛁ ' + fmt(collectionValue()) }), el('span', { text: 'total value' })]),
      el('div', { class: 'stat' }, [el('b', { text: Object.keys(uniq).length + '/' + G.state.allSpecies().length }), el('span', { text: 'species' })])
    ]));

    // controls
    const filterSel = el('select', { class: 'ctrl' });
    filterSel.appendChild(el('option', { value: 'all', text: 'All rarities' }));
    G.data.RARITIES.forEach(function (r) { filterSel.appendChild(el('option', { value: r.tier, text: r.name })); });
    filterSel.value = collFilter;
    filterSel.addEventListener('change', function () { collFilter = filterSel.value; renderCollection(container); });
    const sortSel = el('select', { class: 'ctrl' });
    [['rarity', 'Rarity ↓'], ['value', 'Value ↓'], ['name', 'Name A–Z'], ['element', 'Element']].forEach(function (o) {
      sortSel.appendChild(el('option', { value: o[0], text: o[1] }));
    });
    sortSel.value = collSort;
    sortSel.addEventListener('change', function () { collSort = sortSel.value; renderCollection(container); });
    container.appendChild(el('div', { class: 'controls' }, [filterSel, sortSel]));

    let items = s.inv.slice();
    if (collFilter !== 'all') items = items.filter(function (it) {
      const sp = G.state.getSpecies(it.sid); return sp && sp.tier === parseInt(collFilter, 10);
    });
    items.sort(function (a, b) {
      const sa = G.state.getSpecies(a.sid) || {}, sb = G.state.getSpecies(b.sid) || {};
      if (collSort === 'value') return G.state.valueOf(b) - G.state.valueOf(a);
      if (collSort === 'name') return (sa.name || '').localeCompare(sb.name || '');
      if (collSort === 'element') return (sa.element || '').localeCompare(sb.element || '');
      return (sb.tier - sa.tier) || (sa.name || '').localeCompare(sb.name || '');
    });

    if (!items.length) {
      container.appendChild(el('div', { class: 'empty', html:
        '🥚 No creatures yet.<br>Head to <b>Hatch</b> to get some!' }));
      return;
    }
    const grid = el('div', { class: 'grid coll-grid' });
    items.forEach(function (it) {
      grid.appendChild(G.ui.card(it, { size: 64, onClick: detail }));
    });
    container.appendChild(grid);
  }

  // ---- hatch ---------------------------------------------------------------
  const EGGS = [
    { id: 'free', name: 'Free Egg', icon: '🥚', cost: 0, cd: 30000, min: 0, max: 3, shiny: 0.02,
      desc: 'A free egg every 30 seconds.' },
    { id: 'basic', name: 'Basic Egg', icon: '🥚', cost: 120, min: 0, max: 3, shiny: 0.03,
      desc: 'Common to Epic.' },
    { id: 'rare', name: 'Glowing Egg', icon: '🪺', cost: 700, min: 1, max: 4, shiny: 0.05,
      desc: 'Uncommon to Legendary.' },
    { id: 'cosmic', name: 'Cosmic Egg', icon: '🌌', cost: 5000, min: 2, max: 6, shiny: 0.10,
      desc: 'Rare to Divine — best odds!' }
  ];

  function hatch(egg) {
    const s = G.state.get();
    if (egg.cost > 0 && s.coins < egg.cost) { toast('Not enough coins.', 'bad'); return; }
    if (egg.cd) {
      const next = (s.cooldowns[egg.id] || 0);
      if (Date.now() < next) { toast('Free egg not ready yet.', 'bad'); return; }
      s.cooldowns[egg.id] = Date.now() + egg.cd;
    }
    if (egg.cost > 0) G.state.addCoins(-egg.cost);
    const sp = G.state.randomSpecies(egg.min, egg.max);
    if (!sp) { toast('No creatures available.', 'bad'); return; }
    const isShiny = Math.random() < egg.shiny;
    const inst = G.state.addSpecies(sp.id, isShiny);
    s.stats.hatched++;
    G.state.save();
    G.ui.haptic(isShiny ? [20, 40, 20, 40, 20, 40, 90] : [15, 30, 50]);
    G.ui.reveal(inst, isShiny ? '✨ A SHINY hatched! ✨' : 'It hatched!');
    refreshAll();
  }

  let cdTimer = null;
  function renderHatch(container) {
    container.innerHTML = '';
    container.appendChild(el('h2', { class: 'view-title', text: '🥚 Hatch' }));
    container.appendChild(el('p', { class: 'view-sub', text: 'Hatch eggs to grow your collection. Sell duplicates for coins, then buy better eggs.' }));
    const grid = el('div', { class: 'egg-grid' });
    EGGS.forEach(function (egg) {
      const tile = el('div', { class: 'egg-tile' });
      tile.appendChild(el('div', { class: 'egg-icon', text: egg.icon }));
      tile.appendChild(el('div', { class: 'egg-name', text: egg.name }));
      tile.appendChild(el('div', { class: 'egg-desc', text: egg.desc }));
      const btn = el('button', { class: 'btn primary' });
      if (egg.cost > 0) btn.innerHTML = '⛁ ' + fmt(egg.cost);
      else btn.textContent = 'Hatch';
      btn.dataset.egg = egg.id;
      btn.addEventListener('click', function () { hatch(egg); renderHatch(container); });
      tile.appendChild(btn);
      grid.appendChild(tile);
    });
    container.appendChild(grid);
    // cooldown ticker
    if (cdTimer) clearInterval(cdTimer);
    cdTimer = setInterval(function () {
      const s = G.state.get();
      EGGS.forEach(function (egg) {
        if (!egg.cd) return;
        const btn = grid.querySelector('button[data-egg="' + egg.id + '"]');
        if (!btn) return;
        const left = (s.cooldowns[egg.id] || 0) - Date.now();
        if (left > 0) { btn.disabled = true; btn.textContent = Math.ceil(left / 1000) + 's'; }
        else { btn.disabled = false; btn.textContent = 'Hatch'; }
      });
    }, 250);
  }

  // ---- navigation ----------------------------------------------------------
  const VIEWS = {
    collection: renderCollection,
    ranch: function (c) { G.idle.render(c); },
    hatch: renderHatch,
    casino: function (c) { G.games.render(c); },
    trade: function (c) { G.trade.render(c); },
    admin: function (c) { G.admin.render(c); }
  };

  function navOrder() {
    return G.ui.$$('.navbtn').map(function (b) { return b.dataset.view; });
  }

  function navigate(view) {
    if (!VIEWS[view]) return;
    const order = navOrder();
    const dir = Math.sign(order.indexOf(view) - order.indexOf(current));
    current = view;
    if (cdTimer && view !== 'hatch') { clearInterval(cdTimer); cdTimer = null; }
    const c = document.getElementById('view');
    c.scrollTop = 0;
    window.scrollTo(0, 0);
    VIEWS[view](c);
    if (dir !== 0) {
      c.classList.remove('slide-l', 'slide-r');
      void c.offsetWidth; // restart animation
      c.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
    }
    G.ui.$$('.navbtn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
  }

  // swipe left/right to move between adjacent tabs (mobile)
  function initSwipe() {
    const view = document.getElementById('view');
    let sx = 0, sy = 0, st = 0, tracking = false;
    view.addEventListener('touchstart', function (e) {
      // ignore multi-touch, or when a modal / suspense overlay is on screen
      if (e.touches.length !== 1 || document.querySelector('.overlay, .fx-suspense')) { tracking = false; return; }
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now(); tracking = true;
    }, { passive: true });
    view.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - st;
      if (dt > 600) return;                         // too slow to be a flick
      if (Math.abs(dx) < 60) return;                // not far enough
      if (Math.abs(dx) < Math.abs(dy) * 1.8) return; // too vertical (a scroll)
      const order = navOrder();
      const i = order.indexOf(current);
      if (i < 0) return;
      if (dx < 0 && i < order.length - 1) navigate(order[i + 1]);
      else if (dx > 0 && i > 0) navigate(order[i - 1]);
    }, { passive: true });
  }

  function refreshAll() {
    renderHeader();
    VIEWS[current](document.getElementById('view'));
    G.ui.$$('.navbtn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === current); });
  }
  window.refreshAll = refreshAll;

  // ---- daily reminder (push) settings --------------------------------------
  function hourLabel(h) {
    const ap = h < 12 ? 'AM' : 'PM';
    const hr = h % 12 === 0 ? 12 : h % 12;
    return hr + ':00 ' + ap;
  }
  function openReminders(onChange) {
    const wrap = el('div', {});
    wrap.appendChild(el('p', { class: 'gdesc', text:
      'Get a daily nudge so you never miss your streak, daily rewards, or ranch coins. We only send if you haven\'t played that day.' }));

    if (!G.push.supported()) {
      wrap.appendChild(el('div', { class: 'gresult bad', text: 'This browser doesn\'t support notifications.' }));
      G.ui.modal('🔔 Daily Reminders', wrap); return;
    }
    if (G.push.isIOS() && !G.push.isStandalone()) {
      wrap.appendChild(el('div', { class: 'help-card', html:
        '<b>On iPhone/iPad:</b> add Critter Casino to your Home Screen first (Share → Add to Home Screen), then open it from there to enable reminders.' }));
      G.ui.modal('🔔 Daily Reminders', wrap); return;
    }
    if (!G.push.configured()) {
      wrap.appendChild(el('div', { class: 'help-card', html:
        'Reminders aren\'t connected to a server yet. (Deploy the push Worker and set <code>PUSH_BASE</code> in <code>js/push.js</code>.)' }));
      G.ui.modal('🔔 Daily Reminders', wrap); return;
    }

    const hourSel = el('select', { class: 'a-input' });
    for (let h = 0; h < 24; h++) {
      const o = el('option', { value: h, text: hourLabel(h) });
      if (h === G.push.getHour()) o.selected = true;
      hourSel.appendChild(o);
    }
    wrap.appendChild(el('div', { class: 'name-row' }, [el('label', { text: 'Remind me at: ' }), hourSel]));

    const status = el('div', { class: 'gsub' });
    const btn = el('button', { class: 'btn primary big' });
    const testBtn = el('button', { class: 'btn', text: '✉️ Send test notification', hidden: 'hidden' });
    wrap.appendChild(el('div', { class: 'gaction' }, [btn, testBtn, status]));
    const m = G.ui.modal('🔔 Daily Reminders', wrap);

    testBtn.addEventListener('click', function () {
      testBtn.disabled = true;
      Promise.resolve(G.push.sendTest()).then(function (ok) {
        toast(ok ? 'Test sent — check your notifications!' : 'Test failed to send.', ok ? 'good' : 'bad');
      }).catch(function () { toast('Test failed to send.', 'bad'); })
        .then(function () { testBtn.disabled = false; });
    });

    function refresh() {
      G.push.isEnabled().then(function (on) {
        btn.textContent = on ? '🔕 Turn off reminders' : '🔔 Turn on reminders';
        status.textContent = on ? ('On — daily at ' + hourLabel(G.push.getHour())) :
          (G.push.permission() === 'denied' ? 'Notifications are blocked in your browser settings.' : 'Off');
        testBtn.hidden = !on;
      });
    }
    refresh();
    hourSel.addEventListener('change', function () {
      G.push.setHour(parseInt(hourSel.value, 10));
      G.push.isEnabled().then(function (on) { if (on) G.push.enable().catch(function () {}); refresh(); });
    });
    btn.addEventListener('click', function () {
      btn.disabled = true;
      G.push.isEnabled().then(function (on) {
        const action = on ? G.push.disable() : G.push.enable(parseInt(hourSel.value, 10));
        Promise.resolve(action).then(function () {
          toast(on ? 'Reminders off.' : 'Reminders on! 🔔', 'good');
        }).catch(function (e) {
          toast(e && e.message === 'denied' ? 'Permission blocked in browser settings.' : 'Could not enable reminders.', 'bad');
        }).then(function () {
          btn.disabled = false; refresh(); if (onChange) onChange();
        });
      });
    });
  }

  // ---- bootstrap -----------------------------------------------------------
  function init() {
    G.ui.$$('.navbtn').forEach(function (b) {
      b.addEventListener('click', function () { navigate(b.dataset.view); });
    });
    renderHeader();
    navigate('collection');
    initSwipe();
    G.idle.init(); // start passive income + offline earnings
    G.fx.init();   // arm audio on first gesture

    // sound mute toggle
    const muteBtn = document.getElementById('mute');
    if (muteBtn) {
      const sync = function () { muteBtn.textContent = G.fx.isMuted() ? '🔇' : '🔊'; };
      sync();
      muteBtn.addEventListener('click', function () { G.fx.toggleMute(); sync(); });
    }

    // daily reminder (push) toggle
    const bellBtn = document.getElementById('bell');
    if (bellBtn) {
      const syncBell = function () {
        G.push.isEnabled().then(function (on) { bellBtn.textContent = on ? '🔔' : '🔕'; });
      };
      syncBell();
      bellBtn.addEventListener('click', function () { openReminders(syncBell); });
    }
    if (G.push) G.push.heartbeat();

    // PWA install prompt
    let deferred = null;
    const installBtn = document.getElementById('install');
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); deferred = e;
      if (installBtn) installBtn.hidden = false;
    });
    if (installBtn) installBtn.addEventListener('click', function () {
      if (deferred) { deferred.prompt(); deferred = null; installBtn.hidden = true; }
    });
    window.addEventListener('appinstalled', function () { if (installBtn) installBtn.hidden = true; });

    // service worker + auto-update: when a new SW takes control, reload once so
    // returning users always get the latest assets (no stale cache).
    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (refreshing || !hadController) return;
        refreshing = true;
        window.location.reload();
      });
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').then(function (reg) {
          // check for updates on each launch
          reg.update().catch(function () {});
        }).catch(function () {});
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.G = window.G || {});
