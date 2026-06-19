/* Main app: navigation, collection view, hatching, and bootstrap. */
(function (G) {
  'use strict';
  const el = G.ui.el, toast = G.ui.toast, fmt = G.ui.fmt;

  let current = 'collection';
  let collFilter = 'all', collSort = 'rarity', collMode = 'owned';

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

  // upgrading a modifier costs coins scaled by the creature's value and the
  // target tier — a steep, scaling coin sink. You still must EARN the first
  // modifier from the Ranch; coins only let you push it higher.
  const MOD_UPGRADE_FACTOR = [0, 50, 250, 1500]; // indexed by target modifier tier
  function nextModId(curId) {
    const list = G.data.MODIFIERS, i = list.findIndex(function (m) { return m.id === curId; });
    return (i >= 0 && i + 1 < list.length) ? list[i + 1].id : null;
  }
  function modUpgradeCost(item) {
    const next = nextModId(item.mod);
    if (!next) return Infinity;
    const idx = G.data.MODIFIERS.findIndex(function (m) { return m.id === next; });
    return Math.round(G.state.valueOf(item) * MOD_UPGRADE_FACTOR[idx]);
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
    const mod = G.data.modifier(item.mod);
    node.appendChild(el('div', { class: 'detail-meta', html:
      '<span class="pill r' + sp.tier + '">' + r.name + '</span> ' +
      '<span class="pill">' + sp.element + '</span> ' +
      (mod ? '<span class="pill mod-pill" style="--modc:' + mod.color + '">' + mod.icon + ' ' + mod.name + ' ×' + mod.mult + '</span> ' : '') +
      '<span class="pill">✨ ' + fmt(G.state.valueOf(item)) + '</span> ' +
      '<span class="pill">📈 ⛁ ' + G.idle.fmtRate(G.idle.creatureIncome(item)) + '/s</span>' }));
    const m = G.ui.modal(sp.name, node);
    const actions = [];
    const upId = item.mod ? nextModId(item.mod) : null;
    if (upId) {
      const nm = G.data.modifier(upId), cost = modUpgradeCost(item);
      const ub = el('button', { class: 'btn primary', html: '⬆ Upgrade to ' + nm.icon + ' ' + nm.name + ' — ⛁ ' + fmt(cost) });
      ub.addEventListener('click', function () {
        if (G.state.get().coins < cost) { toast('Not enough coins.', 'bad'); return; }
        G.state.addCoins(-cost);
        item.mod = upId; G.state.save();
        G.ui.haptic([20, 30, 60]);
        toast(sp.name + ' is now ' + nm.name + '! ×' + nm.mult + ' income', 'good');
        m.close(); refreshAll(); detail(item);
      });
      actions.push(ub);
    }
    actions.push(el('button', { class: 'btn', text: '💰 Sell for ⛁ ' + fmt(G.state.valueOf(item)), onclick: function () {
      const v = G.state.valueOf(item);
      G.state.removeInstance(item.iid);
      G.state.addCoins(v);
      m.close(); toast('Sold ' + sp.name + ' for ' + fmt(v) + ' coins.', 'good');
      refreshAll();
    } }));
    node.appendChild(el('div', { class: 'gaction' }, actions));
  }

  function stat(b, span) { return el('div', { class: 'stat' }, [el('b', { text: b }), el('span', { text: span })]); }

  function dexCounts() {
    const s = G.state.get(), cap = G.state.maxTierUnlocked();
    let have = 0, total = 0, locked = 0;
    G.state.allSpecies().forEach(function (sp) {
      if (sp.tier > cap) { locked++; return; }
      total++; if (s.discovered[sp.id]) have++;
    });
    return { have: have, total: total, locked: locked };
  }

  // read-only species detail (Critterdex)
  function speciesDetail(sp) {
    const r = G.data.rarity(sp.tier);
    const node = el('div', { class: 'detail' });
    const big = el('div', { class: 'detail-sprite r' + sp.tier });
    big.style.setProperty('--rcolor', r.color);
    big.appendChild(G.sprites.el(sp, 150));
    node.appendChild(big);
    node.appendChild(el('div', { class: 'detail-name', text: sp.name }));
    node.appendChild(el('div', { class: 'detail-meta', html:
      '<span class="pill r' + sp.tier + '">' + r.name + '</span> ' +
      '<span class="pill">' + sp.element + '</span> ' +
      '<span class="pill">✨ ' + fmt(r.value) + '</span>' }));
    const owned = G.state.get().inv.filter(function (it) { return it.sid === sp.id; }).length;
    node.appendChild(el('div', { class: 'gsub', text: owned ? ('You own ' + owned) : 'Discovered — not currently owned' }));
    G.ui.modal(sp.name, node);
  }

  function renderDexGrid(container) {
    const s = G.state.get(), cap = G.state.maxTierUnlocked();
    let species = G.state.allSpecies().slice();
    if (collFilter !== 'all') species = species.filter(function (sp) { return sp.tier === parseInt(collFilter, 10); });
    species.sort(function (a, b) { return (a.tier - b.tier) || a.name.localeCompare(b.name); });
    if (!species.length) { container.appendChild(el('div', { class: 'empty', text: 'Nothing here.' })); return; }
    const counts = {};
    s.inv.forEach(function (it) { counts[it.sid] = (counts[it.sid] || 0) + 1; });
    const grid = el('div', { class: 'grid coll-grid' });
    species.forEach(function (sp) {
      const proxy = { iid: 'dex', sid: sp.id, shiny: false };
      if (sp.tier > cap) {
        grid.appendChild(G.ui.card(proxy, { size: 64, silhouette: true, badge: '🔒P' + (sp.tier - G.data.PRESTIGE_MAX_TIER),
          onClick: function () { toast('🔒 Unlocks at Prestige ' + (sp.tier - G.data.PRESTIGE_MAX_TIER), ''); } }));
      } else if (!s.discovered[sp.id]) {
        grid.appendChild(G.ui.card(proxy, { size: 64, silhouette: true,
          onClick: function () { toast('❔ Not discovered yet — keep hatching!', ''); } }));
      } else {
        grid.appendChild(G.ui.card(proxy, { size: 64, showValue: false,
          badge: counts[sp.id] ? ('×' + counts[sp.id]) : null,
          onClick: function () { speciesDetail(sp); } }));
      }
    });
    container.appendChild(grid);
  }

  function renderCollection(container) {
    const s = G.state.get();
    container.innerHTML = '';
    container.appendChild(el('h2', { class: 'view-title', text: '📦 Collection' }));

    // Owned | Critterdex toggle
    const seg = el('div', { class: 'seg' });
    [['owned', 'Owned'], ['dex', 'Critterdex']].forEach(function (o) {
      seg.appendChild(el('button', { class: 'seg-btn' + (collMode === o[0] ? ' active' : ''), text: o[1],
        onclick: function () { collMode = o[0]; renderCollection(container); } }));
    });
    container.appendChild(seg);

    // stats
    if (collMode === 'owned') {
      const uniq = {}; s.inv.forEach(function (it) { uniq[it.sid] = 1; });
      container.appendChild(el('div', { class: 'coll-stats' }, [
        stat(String(s.inv.length), 'creatures'),
        stat('✨ ' + fmt(collectionValue()), 'total value'),
        stat(Object.keys(uniq).length + '/' + G.state.allSpecies().length, 'species')
      ]));
    } else {
      const d = dexCounts();
      container.appendChild(el('div', { class: 'coll-stats' }, [
        stat(d.have + '/' + d.total, 'discovered'),
        stat(String(d.locked), 'locked'),
        stat(String(G.state.allSpecies().length), 'total')
      ]));
    }

    // controls (filter always; sort only in Owned)
    const filterSel = el('select', { class: 'ctrl' });
    filterSel.appendChild(el('option', { value: 'all', text: 'All rarities' }));
    G.data.RARITIES.forEach(function (r) { filterSel.appendChild(el('option', { value: r.tier, text: r.name })); });
    filterSel.value = collFilter;
    filterSel.addEventListener('change', function () { collFilter = filterSel.value; renderCollection(container); });
    const controls = [filterSel];
    if (collMode === 'owned') {
      const sortSel = el('select', { class: 'ctrl' });
      [['rarity', 'Rarity ↓'], ['value', 'Value ↓'], ['name', 'Name A–Z'], ['element', 'Element']].forEach(function (o) {
        sortSel.appendChild(el('option', { value: o[0], text: o[1] }));
      });
      sortSel.value = collSort;
      sortSel.addEventListener('change', function () { collSort = sortSel.value; renderCollection(container); });
      controls.push(sortSel);
    }
    container.appendChild(el('div', { class: 'controls' }, controls));

    if (collMode === 'dex') { renderDexGrid(container); return; }

    container.appendChild(el('div', { class: 'fuse-bar' }, [
      el('button', { class: 'btn small', text: '🔥 Fuse creatures', onclick: openFuse })
    ]));

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
    { id: 'daily', name: 'Daily Egg', icon: '🎁', cost: 0, cd: 24 * 3600 * 1000, special: 'dex', shiny: 0.05,
      desc: 'Free once a day — a creature from any unlocked rarity, favouring ones you haven\'t collected yet!' },
    { id: 'free', name: 'Free Egg', icon: '🥚', cost: 0, cd: 30000, min: 0, max: 3, shiny: 0.02,
      desc: 'A free egg every 30 seconds.' },
    { id: 'basic', name: 'Basic Egg', icon: '🥚', cost: 120, min: 0, max: 3, shiny: 0.03,
      desc: 'Common to Epic.' },
    { id: 'rare', name: 'Glowing Egg', icon: '🪺', cost: 700, min: 1, max: 4, shiny: 0.05,
      desc: 'Uncommon to Legendary.' },
    { id: 'cosmic', name: 'Cosmic Egg', icon: '🌌', cost: 5000, min: 2, max: 12, shiny: 0.10,
      desc: 'Rare up to your top unlocked tier!' }
  ];

  function hatch(egg) {
    const s = G.state.get();
    if (egg.cost > 0 && s.coins < eggCost(egg)) { toast('Not enough coins.', 'bad'); return; }
    if (egg.cd) {
      const next = (s.cooldowns[egg.id] || 0);
      if (Date.now() < next) { toast('Free egg not ready yet.', 'bad'); return; }
      s.cooldowns[egg.id] = Date.now() + egg.cd;
    }
    if (egg.cost > 0) G.state.addCoins(-eggCost(egg));
    const sp = egg.special === 'dex' ? G.state.dailyPick() : G.state.randomSpecies(egg.min, egg.max);
    if (!sp) { toast('No creatures available.', 'bad'); return; }
    const isShiny = G.state.rollShiny(egg.shiny);
    const inst = G.state.addSpecies(sp.id, isShiny);
    s.stats.hatched++;
    G.state.save();
    G.ui.haptic(isShiny ? [20, 40, 20, 40, 20, 40, 90] : [15, 30, 50]);
    G.ui.reveal(inst, isShiny ? '✨ A SHINY hatched! ✨' : 'It hatched!');
    refreshAll();
  }

  // egg prices rise each prestige (1.6^prestige)
  function eggCost(egg) { return Math.round((egg.cost || 0) * G.state.progressScale()); }

  // open N paid eggs at once and show a grouped summary (no per-egg suspense)
  function multiHatch(egg, n) {
    const s = G.state.get();
    const total = eggCost(egg) * n;
    if (s.coins < total) { toast('Not enough coins.', 'bad'); return; }
    G.state.addCoins(-total);
    const results = [];
    for (let i = 0; i < n; i++) {
      const sp = G.state.randomSpecies(egg.min, egg.max);
      if (!sp) break;
      results.push(G.state.addSpecies(sp.id, G.state.rollShiny(egg.shiny)));
    }
    s.stats.hatched += results.length;
    G.state.save();
    hatchSummary(results);
    refreshAll();
  }

  // cost to guarantee a shiny fusion result = result-tier base value x this.
  // Shiny gives 5x value AND 5x income forever, so this is a steep premium.
  const SHINY_FUSE_MULT = 40;

  // ---- fusion: 3 of a rarity -> 1 of the next (shrinks the collection) -----
  function fuseRarityOptions() {
    const s = G.state.get(), cap = G.state.maxTierUnlocked(), counts = {};
    s.inv.forEach(function (it) { const sp = G.state.getSpecies(it.sid); if (sp) counts[sp.tier] = (counts[sp.tier] || 0) + 1; });
    const opts = [];
    G.data.RARITIES.forEach(function (r) { if (r.tier + 1 <= cap && (counts[r.tier] || 0) >= 3) opts.push(r.tier); });
    return opts;
  }

  function openFuse() {
    const opts = fuseRarityOptions();
    if (!opts.length) { toast('Need 3+ of one rarity (below your top tier) to fuse.', 'bad'); return; }
    const wrap = el('div', {});
    wrap.appendChild(el('p', { class: 'gdesc', text:
      'Fuse 3 creatures of one rarity into 1 of the next rarity up — same total value, fewer creatures.' }));
    const tierSel = el('select', { class: 'ctrl' });
    opts.forEach(function (t) { tierSel.appendChild(el('option', { value: t, text: G.data.rarity(t).name + ' → ' + G.data.rarity(t + 1).name })); });
    wrap.appendChild(el('div', { class: 'controls' }, [tierSel]));
    const info = el('div', { class: 'wager-total' });
    const tools = el('div', { class: 'wager-tools' });
    const grid = el('div', { class: 'grid pick-grid' });
    let forceShiny = false;
    const shinyChk = el('input', { type: 'checkbox' });
    const shinyTxt = el('span', { class: 'fuse-shiny-txt' });
    const shinyRow = el('label', { class: 'fuse-shiny' }, [shinyChk, shinyTxt]);
    shinyChk.addEventListener('change', function () { forceShiny = shinyChk.checked; update(); });
    wrap.appendChild(info); wrap.appendChild(shinyRow); wrap.appendChild(tools); wrap.appendChild(grid);
    const goBtn = el('button', { class: 'btn primary' });
    const m = G.ui.modal('🔥 Fuse', wrap, { footer: goBtn });
    let tier = opts[0], selected = {}, cardByIid = {};

    function shinyCost() { return G.data.rarity(tier + 1).value * SHINY_FUSE_MULT; }
    function update() {
      const n = Object.keys(selected).length, groups = Math.floor(n / 3);
      const sc = shinyCost(), totalSc = forceShiny ? sc * groups : 0;
      info.innerHTML = 'Selected <b>' + n + '</b> · fuse into <b>' + groups + ' ' + G.data.rarity(tier + 1).name + '</b>';
      shinyTxt.innerHTML = '✨ Guarantee shiny — ⛁ ' + fmt(sc) + ' each';
      const broke = forceShiny && G.state.get().coins < totalSc;
      goBtn.disabled = groups < 1 || broke;
      goBtn.textContent = groups < 1 ? 'Select 3+'
        : broke ? ('Need ⛁ ' + fmt(totalSc))
        : ('🔥 Fuse ×' + groups + (forceShiny ? ' · ✨ ⛁ ' + fmt(totalSc) : ''));
    }
    function rebuild() {
      selected = {}; cardByIid = {}; grid.innerHTML = ''; tools.innerHTML = '';
      const list = G.state.get().inv.filter(function (it) { const sp = G.state.getSpecies(it.sid); return sp && sp.tier === tier; })
        .sort(function (a, b) { return (a.shiny ? 1 : 0) - (b.shiny ? 1 : 0); }); // non-shiny first
      function setSel(it, on) { if (on) selected[it.iid] = it; else delete selected[it.iid]; if (cardByIid[it.iid]) cardByIid[it.iid].classList.toggle('selected', on); }
      list.forEach(function (it) { const c = G.ui.card(it, { size: 50, onClick: function () { setSel(it, !selected[it.iid]); update(); } }); cardByIid[it.iid] = c; grid.appendChild(c); });
      function add(k) { let added = 0; for (let i = 0; i < list.length && added < k; i++) { if (!selected[list[i].iid]) { setSel(list[i], true); added++; } } update(); }
      tools.appendChild(el('button', { class: 'btn small', text: '+3', onclick: function () { add(3); } }));
      tools.appendChild(el('button', { class: 'btn small', text: 'All', onclick: function () { add(list.length); } }));
      tools.appendChild(el('button', { class: 'btn small', text: 'Clear', onclick: function () { Object.keys(selected).forEach(function (k) { if (cardByIid[k]) cardByIid[k].classList.remove('selected'); }); selected = {}; update(); } }));
      update();
    }
    tierSel.addEventListener('change', function () { tier = parseInt(tierSel.value, 10); rebuild(); });
    rebuild();

    goBtn.addEventListener('click', function () {
      const items = Object.keys(selected).map(function (k) { return selected[k]; });
      const groups = Math.floor(items.length / 3);
      if (groups < 1) return;
      if (forceShiny) {
        const cost = shinyCost() * groups;
        if (G.state.get().coins < cost) { toast('Not enough coins for guaranteed shiny.', 'bad'); return; }
        G.state.addCoins(-cost);
      }
      const results = [];
      for (let i = 0; i < groups; i++) {
        const trio = items.slice(i * 3, i * 3 + 3);
        const allShiny = trio.every(function (it) { return it.shiny; });
        trio.forEach(function (it) { G.state.removeInstance(it.iid); });
        const sp = G.state.randomSpeciesAtTier(tier + 1);
        if (sp) results.push(G.state.addSpecies(sp.id, forceShiny || allShiny || G.state.rollShiny(0.03)));
      }
      G.state.save();
      G.ui.haptic([20, 30, 60]);
      m.close();
      if (window.refreshAll) window.refreshAll();
      if (results.length) hatchSummary(results, '🔥 Fused into ' + results.length + '!');
    });
  }

  function hatchSummary(results, headline) {
    if (!results.length) return;
    let bestTier = 0;
    results.forEach(function (it) { const sp = G.state.getSpecies(it.sid); if (sp && sp.tier > bestTier) bestTier = sp.tier; });
    G.ui.haptic(bestTier >= 4 ? [25, 40, 30, 40, 80] : [15, 30, 50]);
    if (G.fx) G.fx.celebrate(bestTier); // quick confetti/chime scaled to the rarest pull

    // group identical (species + shiny) with counts
    const groups = {};
    results.forEach(function (it) {
      const k = it.sid + (it.shiny ? '_s' : '');
      if (!groups[k]) groups[k] = { item: it, count: 0 };
      groups[k].count++;
    });
    const arr = Object.keys(groups).map(function (k) { return groups[k]; });
    arr.sort(function (a, b) {
      const sa = G.state.getSpecies(a.item.sid) || {}, sb = G.state.getSpecies(b.item.sid) || {};
      return (sb.tier - sa.tier) || (b.item.shiny - a.item.shiny) || (sa.name || '').localeCompare(sb.name || '');
    });
    const node = el('div', { class: 'summary' });
    const canvas = el('canvas', { class: 'fx-rays' });
    node.appendChild(canvas);
    const content = el('div', { class: 'summary-content' });
    content.appendChild(el('div', { class: 'reveal-head', text: headline || ('Hatched ×' + results.length + '!') }));
    const grid = el('div', { class: 'grid pick-grid' });
    arr.forEach(function (g, i) {
      const card = G.ui.card(g.item, { size: 56, showValue: false, showNew: true, badge: g.count > 1 ? ('×' + g.count) : null });
      card.classList.add('pop-in');
      card.style.animationDelay = Math.min(i * 0.04, 1.5) + 's'; // sequential cascade, rarest first
      grid.appendChild(card);
    });
    // NEW badges are shown here on the summary popup only; clear so dupes later don't re-flag
    arr.forEach(function (g) { if (G.state.markSeen) G.state.markSeen(g.item.sid); });
    content.appendChild(grid);
    node.appendChild(content);

    let stopRays = function () {};
    const niceBtn = el('button', { class: 'btn primary', text: 'Nice!' });
    const m = G.ui.modal('', node, { footer: niceBtn, onClose: function () { stopRays(); } });
    niceBtn.addEventListener('click', function () { m.close(); });
    if (G.fx && G.fx.rays) requestAnimationFrame(function () { stopRays = G.fx.rays(canvas, bestTier); });
  }

  function cdLabel(ms) {
    const s = Math.ceil(ms / 1000);
    if (s >= 3600) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
    if (s >= 60) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    return s + 's';
  }
  // ---- black market: buy a guaranteed undiscovered creature (coins -> dex) --
  const BM_BASE = 25000, BM_GROWTH = 2.5, BM_MAX_BUYS = 5; // cap purchases per prestige run
  function bmPrice() {
    return Math.round(BM_BASE * G.state.progressScale() * Math.pow(BM_GROWTH, G.state.get().bmBuys || 0));
  }
  function bmUndiscovered() {
    const cap = G.state.maxTierUnlocked(), disc = G.state.get().discovered;
    return G.state.allSpecies().filter(function (sp) { return sp.tier <= cap && !disc[sp.id]; });
  }
  function buyBlackMarket(container) {
    const s = G.state.get();
    if ((s.bmBuys || 0) >= BM_MAX_BUYS) { toast('Black market is sold out until you prestige.', ''); return; }
    const pool = bmUndiscovered();
    if (!pool.length) { toast('Every unlocked creature is already discovered!', ''); return; }
    const price = bmPrice();
    if (s.coins < price) { toast('Not enough coins.', 'bad'); return; }
    G.state.addCoins(-price);
    s.bmBuys = (s.bmBuys || 0) + 1;
    const sp = pool[Math.floor(Math.random() * pool.length)];
    const inst = G.state.addSpecies(sp.id, G.state.rollShiny(0.03));
    s.stats.hatched++;
    G.state.save();
    G.ui.haptic([15, 30, 50]);
    G.ui.reveal(inst, '🕵️ Black market find!');
    if (window.refreshAll) window.refreshAll();
    renderHatch(container);
  }
  function blackMarketPanel(container) {
    const s = G.state.get(), pool = bmUndiscovered(), price = bmPrice();
    const left = BM_MAX_BUYS - (s.bmBuys || 0);
    const panel = el('div', { class: 'panel bm-panel' }, [el('h3', { text: '🕵️ Black Market' })]);
    panel.appendChild(el('p', { class: 'gdesc', text:
      'Buy a creature you haven\'t discovered yet — progress toward your next prestige. Price rises sharply with each purchase, and stock is limited per run.' }));
    if (!pool.length) {
      panel.appendChild(el('div', { class: 'gsub', text: '✅ You\'ve discovered every unlocked creature. Prestige to unlock more.' }));
    } else if (left <= 0) {
      panel.appendChild(el('div', { class: 'gsub', text: '🚫 Sold out for this run — prestige to restock the black market.' }));
    } else {
      const b = el('button', { class: 'btn primary', html: '🛒 Buy undiscovered — ⛁ ' + fmt(price) });
      b.disabled = s.coins < price;
      b.addEventListener('click', function () { buyBlackMarket(container); });
      panel.appendChild(b);
      panel.appendChild(el('div', { class: 'gsub', text:
        left + ' purchase' + (left !== 1 ? 's' : '') + ' left this run · ' + pool.length + ' undiscovered at your tier.' }));
    }
    container.appendChild(panel);
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
      if (egg.cost > 0) btn.innerHTML = '⛁ ' + fmt(eggCost(egg));
      else btn.textContent = 'Hatch';
      btn.dataset.egg = egg.id;
      btn.addEventListener('click', function () { hatch(egg); renderHatch(container); });
      tile.appendChild(btn);
      // paid eggs get bulk-hatch options to spend coins faster
      if (egg.cost > 0) {
        const mult = el('div', { class: 'egg-mult' });
        [10, 100].forEach(function (n) {
          const c = eggCost(egg) * n;
          const b = el('button', { class: 'btn small', text: '×' + n + ' ⛁' + fmt(c) });
          b.disabled = G.state.get().coins < c;
          b.addEventListener('click', function () { multiHatch(egg, n); renderHatch(container); });
          mult.appendChild(b);
        });
        tile.appendChild(mult);
      }
      grid.appendChild(tile);
    });
    container.appendChild(grid);
    blackMarketPanel(container);
    // cooldown ticker
    if (cdTimer) clearInterval(cdTimer);
    cdTimer = setInterval(function () {
      const s = G.state.get();
      EGGS.forEach(function (egg) {
        if (!egg.cd) return;
        const btn = grid.querySelector('button[data-egg="' + egg.id + '"]');
        if (!btn) return;
        const left = (s.cooldowns[egg.id] || 0) - Date.now();
        if (left > 0) { btn.disabled = true; btn.textContent = cdLabel(left); }
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
    return G.ui.$$('.navbtn').filter(function (b) { return !b.hidden; }).map(function (b) { return b.dataset.view; });
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

    // sound mute toggle (+ secret knock: toggle on/off 3 times to reveal Admin)
    const muteBtn = document.getElementById('mute');
    if (muteBtn) {
      const sync = function () { muteBtn.textContent = G.fx.isMuted() ? '🔇' : '🔊'; };
      sync();
      let knock = 0, knockAt = 0;
      muteBtn.addEventListener('click', function () {
        G.fx.toggleMute(); sync();
        const now = Date.now();
        knock = (now - knockAt < 1500) ? knock + 1 : 1; // must be in quick succession
        knockAt = now;
        if (knock >= 6 && current !== 'admin') {
          knock = 0;
          G.ui.toast('🛠 Opening admin panel…', 'good');
          navigate('admin'); // hidden panel: only reachable via this secret knock
        }
      });
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

    // hunger badge -> jump to Ranch to feed
    const feedBadge = document.getElementById('feed-badge');
    if (feedBadge) feedBadge.addEventListener('click', function () { navigate('ranch'); });

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
