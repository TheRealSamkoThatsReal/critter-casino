/* Casino games. Players wager a creature for a chance to upgrade or lose it. */
(function (G) {
  'use strict';
  const el = G.ui.el, toast = G.ui.toast, fmt = G.ui.fmt;
  const MAXT = G.data.RARITIES.length - 1;

  // diminishing odds for climbing — top tiers are a real gamble
  const CLIMB = [0.50, 0.45, 0.38, 0.30, 0.22, 0.12]; // chance to go tier t -> t+1
  function climbChance(t) { return CLIMB[Math.min(t, CLIMB.length - 1)]; }
  function shiny() { return Math.random() < 0.03; }

  // Apply an outcome. delta: 'lose' | integer (0 keep, +n upgrade).
  // Returns {lost} or {item}. Consumes the staked instance.
  function resolve(staked, delta) {
    G.state.removeInstance(staked.iid);
    G.state.get().stats.gambled++;
    if (delta === 'lose') {
      G.state.get().stats.losses++;
      G.state.save();
      return { lost: true };
    }
    if (delta === 0) {
      G.state.addInstance(staked); // returned unchanged
      G.state.save();
      return { item: staked, kept: true };
    }
    const sp = G.state.getSpecies(staked.sid);
    const newTier = Math.min(MAXT, sp.tier + delta);
    const ns = G.state.randomSpeciesAtTier(newTier) || sp;
    const inst = G.state.addSpecies(ns.id, shiny());
    G.state.get().stats.wins++;
    G.state.save();
    return { item: inst, upgraded: true };
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ---- creature picker -----------------------------------------------------
  function chooseCreature(cb) {
    const inv = G.state.get().inv.slice().sort(function (a, b) {
      return G.state.valueOf(b) - G.state.valueOf(a);
    });
    if (!inv.length) { toast('You have no creatures to wager!', 'bad'); return; }
    const grid = el('div', { class: 'grid pick-grid' });
    const m = G.ui.modal('Choose a creature to wager', grid);
    inv.forEach(function (item) {
      grid.appendChild(G.ui.card(item, {
        size: 56, onClick: function () { m.close(); cb(item); }
      }));
    });
  }

  // ---- shared result panel -------------------------------------------------
  function showResult(res, container, onAgain) {
    container.innerHTML = '';
    if (res.lost) {
      container.appendChild(el('div', { class: 'gresult bad', html: '💀 Gone! Your creature was lost.' }));
    } else if (res.kept) {
      container.appendChild(el('div', { class: 'gresult', html: '😌 Safe — you keep your creature.' }));
      container.appendChild(G.ui.card(res.item, { size: 64 }));
    } else {
      container.appendChild(el('div', { class: 'gresult good', html: '🎉 Upgraded!' }));
      container.appendChild(G.ui.card(res.item, { size: 80 }));
    }
    container.appendChild(el('button', { class: 'btn primary', text: 'Play again', onclick: onAgain }));
    if (window.refreshAll) window.refreshAll();
  }

  // ---- Coin Flip (Double or Nothing) --------------------------------------
  function coinFlip(item) {
    const sp = G.state.getSpecies(item.sid);
    const chance = climbChance(sp.tier);
    const wrap = el('div', { class: 'game coinflip' });
    wrap.appendChild(el('p', { class: 'gdesc', html:
      'Heads upgrades <b>' + sp.name + '</b> to a higher rarity. Tails and it\'s lost forever.<br>' +
      'Win chance: <b>' + Math.round(chance * 100) + '%</b>' }));
    const stage = el('div', { class: 'gstage' });
    const coin = el('div', { class: 'coin' }, [
      el('div', { class: 'coin-face heads', text: '⛀' }),
      el('div', { class: 'coin-face tails', text: '☠' })
    ]);
    stage.appendChild(coin);
    wrap.appendChild(stage);
    const action = el('div', { class: 'gaction' });
    wrap.appendChild(action);
    const flipBtn = el('button', { class: 'btn primary', text: 'Flip!' });
    action.appendChild(flipBtn);
    const m = G.ui.modal('Coin Flip', wrap);
    flipBtn.addEventListener('click', function () {
      flipBtn.disabled = true;
      const win = Math.random() < chance;
      coin.classList.add('flipping');
      coin.style.setProperty('--end', win ? '0deg' : '180deg');
      setTimeout(function () {
        coin.className = 'coin ' + (win ? 'show-heads' : 'show-tails');
        const res = resolve(item, win ? 1 : 'lose');
        showResult(res, action, function () { m.close(); coinFlip2(); });
      }, 1700);
    });
  }
  function coinFlip2() { chooseCreature(coinFlip); }

  // ---- Lucky Wheel ---------------------------------------------------------
  const WHEEL = [
    { label: 'LOSE', delta: 'lose', w: 26, color: '#e0413f' },
    { label: 'KEEP', delta: 0, w: 22, color: '#6b7280' },
    { label: '+1', delta: 1, w: 24, color: '#3d8bff' },
    { label: 'LOSE', delta: 'lose', w: 14, color: '#b8302e' },
    { label: '+2', delta: 2, w: 9, color: '#b15cff' },
    { label: 'KEEP', delta: 0, w: 3, color: '#6b7280' },
    { label: '+3', delta: 3, w: 2, color: '#ff9b21' }
  ];
  function wheelGame(item) {
    const sp = G.state.getSpecies(item.sid);
    const wrap = el('div', { class: 'game wheelgame' });
    wrap.appendChild(el('p', { class: 'gdesc', html:
      'Spin to decide the fate of <b>' + sp.name + '</b>. Land on +1/+2/+3 to climb rarities!' }));
    const stage = el('div', { class: 'gstage' });
    const wheel = el('div', { class: 'wheel' });
    // build conic gradient + labels
    let total = WHEEL.reduce(function (a, s) { return a + s.w; }, 0);
    let acc = 0; const stops = []; const segMid = [];
    WHEEL.forEach(function (s) {
      const start = acc / total * 360; acc += s.w; const end = acc / total * 360;
      stops.push(s.color + ' ' + start + 'deg ' + end + 'deg');
      segMid.push((start + end) / 2);
    });
    wheel.style.background = 'conic-gradient(' + stops.join(',') + ')';
    WHEEL.forEach(function (s, i) {
      const lab = el('div', { class: 'wlabel', text: s.label });
      lab.style.transform = 'rotate(' + segMid[i] + 'deg) translateY(-72px)';
      wheel.appendChild(lab);
    });
    const inner = el('div', { class: 'wheel-wrap' }, [wheel, el('div', { class: 'wheel-ptr', text: '▼' })]);
    stage.appendChild(inner);
    wrap.appendChild(stage);
    const action = el('div', { class: 'gaction' });
    const spinBtn = el('button', { class: 'btn primary', text: 'Spin!' });
    action.appendChild(spinBtn); wrap.appendChild(action);
    const m = G.ui.modal('Lucky Wheel', wrap);
    let rot = 0;
    spinBtn.addEventListener('click', function () {
      spinBtn.disabled = true;
      // weighted pick
      let r = Math.random() * total, idx = 0;
      for (let i = 0; i < WHEEL.length; i++) { r -= WHEEL[i].w; if (r <= 0) { idx = i; break; } }
      const target = 360 - segMid[idx] + (5 * 360); // pointer at top
      rot += target;
      wheel.style.transition = 'transform 3.4s cubic-bezier(.17,.67,.2,1)';
      wheel.style.transform = 'rotate(' + rot + 'deg)';
      setTimeout(function () {
        const res = resolve(item, WHEEL[idx].delta);
        showResult(res, action, function () { m.close(); wheelGame2(); });
      }, 3500);
    });
  }
  function wheelGame2() { chooseCreature(wheelGame); }

  // ---- Slots ---------------------------------------------------------------
  const SYMS = ['🔥', '💧', '🌿', '⚡', '❄', '⭐'];
  function slots(item) {
    const sp = G.state.getSpecies(item.sid);
    const wrap = el('div', { class: 'game slots' });
    wrap.appendChild(el('p', { class: 'gdesc', html:
      'Three matching symbols upgrade <b>' + sp.name + '</b>. Two matching keeps it safe. ' +
      'All different and it\'s lost!' }));
    const reels = el('div', { class: 'reels' });
    const cells = [];
    for (let i = 0; i < 3; i++) {
      const c = el('div', { class: 'reel', text: '❔' });
      cells.push(c); reels.appendChild(c);
    }
    wrap.appendChild(reels);
    const action = el('div', { class: 'gaction' });
    const btn = el('button', { class: 'btn primary', text: 'Spin!' });
    action.appendChild(btn); wrap.appendChild(action);
    const m = G.ui.modal('Slots', wrap);
    btn.addEventListener('click', function () {
      btn.disabled = true;
      // decide outcome with weighting, then back out symbols
      const roll = Math.random();
      let result; // 'three','two','none'
      const triple = 0.04 + 0.08 * Math.max(0, (5 - sp.tier)) / 5; // harder at high tier
      if (roll < triple) result = 'three';
      else if (roll < triple + 0.42) result = 'two';
      else result = 'none';
      let final;
      if (result === 'three') { const s = pick(SYMS); final = [s, s, s]; }
      else if (result === 'two') { const s = pick(SYMS); let o = pick(SYMS); while (o === s) o = pick(SYMS); final = pick([[s, s, o], [s, o, s], [o, s, s]]); }
      else { const a = pick(SYMS); let b = pick(SYMS); while (b === a) b = pick(SYMS); let c = pick(SYMS); while (c === a || c === b) c = pick(SYMS); final = [a, b, c]; }
      let spins = 0;
      const iv = setInterval(function () {
        cells.forEach(function (c) { c.textContent = pick(SYMS); });
        spins++;
        if (spins > 14) {
          clearInterval(iv);
          cells.forEach(function (c, i) { c.textContent = final[i]; c.classList.add('settle'); });
          const delta = result === 'three' ? 2 : result === 'two' ? 0 : 'lose';
          setTimeout(function () {
            const res = resolve(item, delta);
            showResult(res, action, function () { m.close(); slots2(); });
          }, 500);
        }
      }, 90);
    });
  }
  function slots2() { chooseCreature(slots); }

  // ---- Dice (High Roll) ----------------------------------------------------
  function dice(item) {
    const sp = G.state.getSpecies(item.sid);
    const wrap = el('div', { class: 'game dice' });
    wrap.appendChild(el('p', { class: 'gdesc', html:
      'Roll two dice. <b>11-12</b>: big upgrade (+2). <b>8-10</b>: upgrade (+1). ' +
      '<b>4-7</b>: safe. <b>2-3</b>: lost.' }));
    const stage = el('div', { class: 'gstage dicestage' });
    const d1 = el('div', { class: 'die', text: '⚀' });
    const d2 = el('div', { class: 'die', text: '⚀' });
    stage.appendChild(d1); stage.appendChild(d2);
    wrap.appendChild(stage);
    const action = el('div', { class: 'gaction' });
    const btn = el('button', { class: 'btn primary', text: 'Roll!' });
    action.appendChild(btn); wrap.appendChild(action);
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const m = G.ui.modal('High Roll', wrap);
    btn.addEventListener('click', function () {
      btn.disabled = true;
      let spins = 0;
      const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6);
      const iv = setInterval(function () {
        d1.textContent = pick(faces); d2.textContent = pick(faces); spins++;
        if (spins > 12) {
          clearInterval(iv);
          d1.textContent = faces[a - 1]; d2.textContent = faces[b - 1];
          const sum = a + b;
          let delta = sum >= 11 ? 2 : sum >= 8 ? 1 : sum >= 4 ? 0 : 'lose';
          // soften high-tier upgrades
          if (delta > 0 && sp.tier >= 4 && Math.random() < 0.45) delta = 0;
          setTimeout(function () {
            const res = resolve(item, delta);
            showResult(res, action, function () { m.close(); dice2(); });
          }, 500);
        }
      }, 90);
    });
  }
  function dice2() { chooseCreature(dice); }

  // ---- lobby ---------------------------------------------------------------
  const GAMES = [
    { id: 'coin', name: 'Coin Flip', icon: '⛀', desc: 'Double or nothing. High risk climb.', fn: coinFlip2 },
    { id: 'wheel', name: 'Lucky Wheel', icon: '🎡', desc: 'Spin for upgrades up to +3 tiers.', fn: wheelGame2 },
    { id: 'slots', name: 'Slots', icon: '🎰', desc: 'Match three to jump +2 rarities.', fn: slots2 },
    { id: 'dice', name: 'High Roll', icon: '🎲', desc: 'Roll the dice. Safer middle ground.', fn: dice2 }
  ];

  function render(container) {
    container.innerHTML = '';
    container.appendChild(el('h2', { class: 'view-title', text: '🎲 Casino' }));
    container.appendChild(el('p', { class: 'view-sub', text:
      'Wager a creature for a chance at a rarer one — or lose it. The house always watches.' }));
    const grid = el('div', { class: 'game-lobby' });
    GAMES.forEach(function (g) {
      const c = el('div', { class: 'game-tile clickable', onclick: g.fn }, [
        el('div', { class: 'game-icon', text: g.icon }),
        el('div', { class: 'game-name', text: g.name }),
        el('div', { class: 'game-desc', text: g.desc })
      ]);
      grid.appendChild(c);
    });
    container.appendChild(grid);
  }

  G.games = { render: render };
})(window.G = window.G || {});
