/* Casino games. Players wager one OR MORE creatures; their combined value is
 * the stake. Each game rolls a payout multiplier — the bigger your total
 * stake, the higher the value you can win, so pooling creatures unlocks a
 * shot at rarer prizes. Lose, and the whole wager is gone. */
(function (G) {
  'use strict';
  const el = G.ui.el, toast = G.ui.toast, fmt = G.ui.fmt;
  const MAXT = G.data.RARITIES.length - 1;

  function shiny() { return Math.random() < 0.03; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function stakeOf(wager) { return wager.reduce(function (a, it) { return a + G.state.valueOf(it); }, 0); }

  // tier whose value the payout can "afford"
  function tierForValue(v) {
    let t = 0;
    for (let i = 0; i <= MAXT; i++) if (G.data.rarity(i).value <= v) t = i;
    return t;
  }

  // Resolve a wager with a payout multiplier (0 = total loss). On a win the
  // payout VALUE (stake*mult) is paid out as a set of creatures whose combined
  // value matches it — so you actually receive what the payout says.
  function resolve(wager, mult) {
    const stake = stakeOf(wager);
    wager.forEach(function (it) { G.state.removeInstance(it.iid); });
    G.state.get().stats.gambled++;
    if (!mult || mult <= 0) {
      G.state.get().stats.losses++;
      G.state.save();
      return { lost: true, count: wager.length, stake: stake };
    }
    let budget = Math.round(stake * mult); // no prestige tax on casino winnings
    if (Math.random() < 0.07) budget = Math.round(budget * 1.5); // lucky crit bonus
    const cap = G.state.maxTierUnlocked(); // rarities above are prestige-locked
    const items = [];
    let remaining = budget, guard = 0;
    while (remaining >= G.data.rarity(0).value && items.length < 20 && guard++ < 100) {
      let tier = 0; // highest affordable (& unlocked) tier for the remaining budget
      for (let t = 0; t <= cap; t++) if (G.data.rarity(t).value <= remaining) tier = t;
      const sp = G.state.randomSpeciesAtTier(tier);
      if (!sp) break;
      items.push(G.state.addSpecies(sp.id, shiny()));
      remaining -= G.data.rarity(tier).value;
    }
    if (!items.length) { const sp0 = G.state.randomSpeciesAtTier(0); if (sp0) items.push(G.state.addSpecies(sp0.id, false)); }
    G.state.get().stats.wins++;
    G.state.save();
    return { items: items, count: wager.length, stake: stake, mult: mult };
  }

  // ---- multi-creature wager picker ----------------------------------------
  function chooseWager(cb) {
    const inv = G.state.get().inv.slice().sort(function (a, b) {
      return G.state.valueOf(a) - G.state.valueOf(b); // cheapest first
    });
    if (!inv.length) { toast('You have no creatures to wager!', 'bad'); return; }
    const selected = {}, cardByIid = {};
    const grid = el('div', { class: 'grid pick-grid' });

    function setSel(item, on) {
      if (on) selected[item.iid] = item; else delete selected[item.iid];
      cardByIid[item.iid].classList.toggle('selected', on);
    }
    function countSel() { return Object.keys(selected).length; }
    function addCheapest(n) {
      let added = 0;
      for (let i = 0; i < inv.length && added < n; i++) {
        if (!selected[inv[i].iid]) { setSel(inv[i], true); added++; }
      }
      update();
    }
    function clearAll() {
      Object.keys(selected).forEach(function (k) { cardByIid[k].classList.remove('selected'); delete selected[k]; });
      update();
    }
    inv.forEach(function (item) {
      const c = G.ui.card(item, { size: 54, onClick: function () { setSel(item, !selected[item.iid]); update(); } });
      cardByIid[item.iid] = c;
      grid.appendChild(c);
    });

    const info = el('div', { class: 'wager-total' });
    const goBtn = el('button', { class: 'btn primary' });
    function update() {
      const items = Object.keys(selected).map(function (k) { return selected[k]; });
      const total = stakeOf(items);
      info.innerHTML = 'Wagering <b>' + items.length + '</b> · stake <b>✨ ' + fmt(total) + '</b>';
      goBtn.disabled = !items.length;
      goBtn.textContent = items.length ? ('Wager ✨ ' + fmt(total)) : 'Select creatures';
    }
    const tools = el('div', { class: 'wager-tools' }, [
      el('button', { class: 'btn small', text: '+5 cheapest', onclick: function () { addCheapest(5); } }),
      el('button', { class: 'btn small', text: '+10 cheapest', onclick: function () { addCheapest(10); } }),
      el('button', { class: 'btn small', text: 'Clear', onclick: clearAll })
    ]);
    const wrap = el('div', {}, [
      el('p', { class: 'gdesc', text: 'Pick creatures to wager — their combined value is your stake. Bigger stakes can win rarer creatures!' }),
      info, tools, grid
    ]);
    const m = G.ui.modal('Choose your wager', wrap, { footer: goBtn });
    goBtn.addEventListener('click', function () {
      const items = Object.keys(selected).map(function (k) { return selected[k]; });
      if (!items.length) return;
      m.close(); cb(items);
    });
    update();
  }

  // ---- shared result panel -------------------------------------------------
  function showResult(res, container, onAgain) {
    const bestTier = res.lost ? -1 : res.items.reduce(function (m, it) {
      const sp = G.state.getSpecies(it.sid); return sp && sp.tier > m ? sp.tier : m;
    }, 0);
    function build() {
      container.innerHTML = '';
      G.ui.haptic(res.lost ? 180 : [25, 40, 30, 40, 80]);
      if (res.lost) {
        container.appendChild(el('div', { class: 'gresult bad', html:
          '💀 Lost! Your wager of ' + res.count + ' creature' + (res.count > 1 ? 's' : '') + ' (✨ ' + fmt(res.stake) + ') is gone.' }));
      } else {
        if (G.fx) G.fx.celebrate(bestTier);
        const wonVal = res.items.reduce(function (a, it) { return a + G.state.valueOf(it); }, 0);
        container.appendChild(el('div', { class: 'gresult good', html:
          '🎉 ×' + res.mult + ' → won ' + res.items.length + ' creature' + (res.items.length > 1 ? 's' : '') + '!' }));
        // group identical (species + shiny), rarest first
        const groups = {};
        res.items.forEach(function (it) { const k = it.sid + (it.shiny ? '_s' : ''); (groups[k] = groups[k] || { item: it, n: 0 }).n++; });
        const arr = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) {
          return (G.state.getSpecies(b.item.sid) || {}).tier - (G.state.getSpecies(a.item.sid) || {}).tier;
        });
        const grid = el('div', { class: 'grid pick-grid' });
        arr.forEach(function (g) { grid.appendChild(G.ui.card(g.item, { size: 56, showValue: false, badge: g.n > 1 ? ('×' + g.n) : null })); });
        container.appendChild(grid);
        container.appendChild(el('div', { class: 'gsub', html:
          'Staked ✨ ' + fmt(res.stake) + ' → won ✨ ' + fmt(wonVal) }));
      }
      container.appendChild(el('button', { class: 'btn primary', text: 'Play again', onclick: onAgain }));
      if (window.refreshAll) window.refreshAll();
    }
    // suspenseful build-up before revealing a rare+ win
    if (!res.lost && G.fx && bestTier >= 2) { container.innerHTML = ''; G.fx.suspense(bestTier, build); }
    else build();
  }

  function payoutTable(rows) {
    const t = el('div', { class: 'payout-table' });
    rows.forEach(function (r) {
      t.appendChild(el('div', { class: 'payout-row' }, [
        el('span', { class: 'po-out', text: r[0] }),
        el('span', { class: 'po-mult' + (r[1] === 'LOSE' ? ' lose' : ''), text: r[1] })
      ]));
    });
    return t;
  }

  // ---- Coin Flip (Double or Nothing) --------------------------------------
  function coinFlip(wager) {
    const stake = stakeOf(wager);
    const wrap = el('div', { class: 'game coinflip' });
    wrap.appendChild(el('p', { class: 'gdesc', html:
      'Heads <b>doubles</b> your ✨ ' + fmt(stake) + ' stake into a new creature. Tails and it\'s all lost. 50/50.' }));
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
      G.ui.haptic(18); flipBtn.disabled = true;
      const win = Math.random() < 0.5;
      coin.classList.add('flipping');
      coin.style.setProperty('--end', win ? '0deg' : '180deg');
      setTimeout(function () {
        coin.className = 'coin ' + (win ? 'show-heads' : 'show-tails');
        const res = resolve(wager, win ? 2 : 0);
        showResult(res, action, function () { m.close(); coinFlip2(); });
      }, 1700);
    });
  }
  function coinFlip2() { chooseWager(coinFlip); }

  // ---- Lucky Wheel ---------------------------------------------------------
  const WHEEL = [
    { label: 'LOSE', mult: 0, w: 40, color: '#e0413f' },
    { label: '×1.5', mult: 1.5, w: 24, color: '#3d8bff' },
    { label: '×2', mult: 2, w: 18, color: '#4caf50' },
    { label: 'LOSE', mult: 0, w: 9, color: '#b8302e' },
    { label: '×3', mult: 3, w: 5, color: '#b15cff' },
    { label: '×5', mult: 5, w: 3, color: '#ff9b21' },
    { label: 'JACKPOT', mult: 10, w: 1, color: '#ffe14d' }
  ];
  function wheelGame(wager) {
    const stake = stakeOf(wager);
    const wrap = el('div', { class: 'game wheelgame' });
    wrap.appendChild(el('p', { class: 'gdesc', html:
      'Spin to multiply your ✨ ' + fmt(stake) + ' stake. Land JACKPOT for a ×10 payout!' }));
    const stage = el('div', { class: 'gstage' });
    const wheel = el('div', { class: 'wheel' });
    let total = WHEEL.reduce(function (a, s) { return a + s.w; }, 0);
    let acc = 0; const stops = []; const segMid = [];
    WHEEL.forEach(function (s) {
      const start = acc / total * 360; acc += s.w; const end = acc / total * 360;
      stops.push(s.color + ' ' + start + 'deg ' + end + 'deg');
      segMid.push((start + end) / 2);
    });
    wheel.style.background = 'conic-gradient(' + stops.join(',') + ')';
    const labelEls = [];
    WHEEL.forEach(function (s, i) {
      const lab = el('div', { class: 'wlabel', text: s.label });
      lab.style.transform = 'rotate(' + segMid[i] + 'deg) translateY(-76px)';
      wheel.appendChild(lab); labelEls.push(lab);
    });
    const ptr = el('div', { class: 'wheel-ptr', text: '▼' });
    const inner = el('div', { class: 'wheel-wrap' }, [wheel, ptr, el('div', { class: 'wheel-hub' })]);
    stage.appendChild(inner);
    wrap.appendChild(stage);
    const action = el('div', { class: 'gaction' });
    const spinBtn = el('button', { class: 'btn primary', text: 'Spin!' });
    action.appendChild(spinBtn); wrap.appendChild(action);
    const m = G.ui.modal('Lucky Wheel', wrap);
    let rot = 0;
    spinBtn.addEventListener('click', function () {
      G.ui.haptic(18); spinBtn.disabled = true;
      ptr.classList.add('ticking');
      let r = Math.random() * total, idx = 0;
      for (let i = 0; i < WHEEL.length; i++) { r -= WHEEL[i].w; if (r <= 0) { idx = i; break; } }
      const targetDeg = 360 - segMid[idx] + (5 * 360);
      rot += targetDeg;
      wheel.style.transition = 'transform 3.4s cubic-bezier(.17,.67,.2,1)';
      wheel.style.transform = 'rotate(' + rot + 'deg)';
      setTimeout(function () {
        ptr.classList.remove('ticking');
        wheel.classList.add('landed');
        if (labelEls[idx]) labelEls[idx].classList.add('win');
        G.ui.haptic([20, 40]);
        const res = resolve(wager, WHEEL[idx].mult);
        showResult(res, action, function () { m.close(); wheelGame2(); });
      }, 3500);
    });
  }
  function wheelGame2() { chooseWager(wheelGame); }

  // ---- Slots ---------------------------------------------------------------
  const SYMS = ['🔥', '💧', '🌿', '⚡', '❄'];
  const STAR = '⭐';
  function slots(wager) {
    const stake = stakeOf(wager);
    const wrap = el('div', { class: 'game slots' });
    wrap.appendChild(el('p', { class: 'gdesc', html:
      'Spin your ✨ ' + fmt(stake) + ' stake. ⭐⭐⭐ pays ×8, any three ×3, two matching ×1.5, all different loses.' }));
    const reels = el('div', { class: 'reels' });
    const cells = [];
    for (let i = 0; i < 3; i++) { const c = el('div', { class: 'reel', text: '❔' }); cells.push(c); reels.appendChild(c); }
    wrap.appendChild(reels);
    const action = el('div', { class: 'gaction' });
    const btn = el('button', { class: 'btn primary', text: 'Spin!' });
    action.appendChild(btn); wrap.appendChild(action);
    const m = G.ui.modal('Slots', wrap);
    const ALL = SYMS.concat([STAR]);
    btn.addEventListener('click', function () {
      G.ui.haptic(18); btn.disabled = true;
      const roll = Math.random();
      let cat, mult, final;
      if (roll < 0.02) { cat = 'jackpot'; mult = 8; final = [STAR, STAR, STAR]; }
      else if (roll < 0.08) { cat = 'three'; mult = 3; const s = pick(SYMS); final = [s, s, s]; }
      else if (roll < 0.46) { cat = 'two'; mult = 1.5; const s = pick(SYMS); let o = pick(ALL); while (o === s) o = pick(ALL); final = pick([[s, s, o], [s, o, s], [o, s, s]]); }
      else { cat = 'none'; mult = 0; const a = pick(ALL); let b = pick(ALL); while (b === a) b = pick(ALL); let c = pick(ALL); while (c === a || c === b) c = pick(ALL); final = [a, b, c]; }
      // reels spin then lock one-by-one (left → right) for anticipation
      const stopAt = [700, 1050, 1450];
      const ivs = cells.map(function (c) { c.classList.add('spin'); return setInterval(function () { c.textContent = pick(ALL); }, 70); });
      cells.forEach(function (c, i) {
        setTimeout(function () {
          clearInterval(ivs[i]);
          c.textContent = final[i];
          c.classList.remove('spin'); c.classList.add('settle');
          G.ui.haptic(22);
          if (i === cells.length - 1) {
            if (mult > 0) { // glow the matched symbols
              const counts = {}; final.forEach(function (sy) { counts[sy] = (counts[sy] || 0) + 1; });
              cells.forEach(function (cc, j) { if (counts[final[j]] >= 2) cc.classList.add('match'); });
            }
            setTimeout(function () {
              const res = resolve(wager, mult);
              showResult(res, action, function () { m.close(); slots2(); });
            }, mult > 0 ? 800 : 450);
          }
        }, stopAt[i]);
      });
    });
  }
  function slots2() { chooseWager(slots); }

  // ---- Dice (High Roll) ----------------------------------------------------
  function dice(wager) {
    const stake = stakeOf(wager);
    const wrap = el('div', { class: 'game dice' });
    wrap.appendChild(el('p', { class: 'gdesc', html:
      'Roll two dice with your ✨ ' + fmt(stake) + ' stake. <b>12</b>: ×4. <b>10-11</b>: ×2.5. ' +
      '<b>7-9</b>: ×1.5. <b>2-6</b>: lost.' }));
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
      G.ui.haptic(18); btn.disabled = true;
      const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6);
      d1.classList.add('rolling'); d2.classList.add('rolling');
      const iv = setInterval(function () { d1.textContent = pick(faces); d2.textContent = pick(faces); }, 80);
      setTimeout(function () {
        clearInterval(iv);
        d1.textContent = faces[a - 1]; d2.textContent = faces[b - 1];
        d1.classList.remove('rolling'); d2.classList.remove('rolling');
        d1.classList.add('land'); d2.classList.add('land');
        G.ui.haptic([20, 40]);
        const sum = a + b;
        const mult = sum === 12 ? 4 : sum >= 10 ? 2.5 : sum >= 7 ? 1.5 : 0;
        setTimeout(function () {
          const res = resolve(wager, mult);
          showResult(res, action, function () { m.close(); dice2(); });
        }, 550);
      }, 1200);
    });
  }
  function dice2() { chooseWager(dice); }

  // ===== SKILL minigames ====================================================

  // ---- Bullseye (timing) ---------------------------------------------------
  function timing(wager) {
    const stake = stakeOf(wager);
    const wrap = el('div', { class: 'game timing' });
    wrap.appendChild(el('p', { class: 'gdesc', html:
      'Stop the marker on the tiny <b>center</b> bullseye for ×4. It moves fast — most taps miss.' }));
    const track = el('div', { class: 'tbar' });
    const marker = el('div', { class: 'tbar-marker' });
    track.appendChild(marker);
    wrap.appendChild(el('div', { class: 'gstage' }, [track]));
    const action = el('div', { class: 'gaction' });
    const btn = el('button', { class: 'btn primary', text: 'STOP!' });
    action.appendChild(btn); wrap.appendChild(action);
    let pos = 0, dir = 1, raf = null, stopped = false;
    const m = G.ui.modal('Bullseye', wrap, { onClose: function () { stopped = true; if (raf) cancelAnimationFrame(raf); } });
    function frame() {
      if (stopped) return;
      pos += dir * 2.5;
      if (pos >= 100) { pos = 100; dir = -1; } else if (pos <= 0) { pos = 0; dir = 1; }
      marker.style.left = pos + '%';
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    btn.addEventListener('click', function () {
      if (stopped) return; stopped = true; if (raf) cancelAnimationFrame(raf);
      G.ui.haptic(20); btn.disabled = true;
      const d = Math.abs(pos - 50);
      const mult = d <= 1.5 ? 4 : d <= 5 ? 2 : d <= 12 ? 1.2 : 0;
      marker.classList.add(mult > 0 ? 'hit' : 'miss');
      setTimeout(function () {
        const res = resolve(wager, mult);
        showResult(res, action, function () { m.close(); timing2(); });
      }, 650);
    });
  }
  function timing2() { chooseWager(timing); }

  // ---- Quick Draw (reaction) ----------------------------------------------
  function reaction(wager) {
    const wrap = el('div', { class: 'game reaction' });
    wrap.appendChild(el('p', { class: 'gdesc', html:
      'When it turns <b>GREEN</b>, tap instantly. Under 200ms ×3 · 320ms ×2 · 450ms ×1.3 · slower loses. Tap early and you lose!' }));
    const pad = el('div', { class: 'react-pad waiting', text: 'Wait…' });
    wrap.appendChild(el('div', { class: 'gstage' }, [pad]));
    const action = el('div', { class: 'gaction' });
    wrap.appendChild(action);
    let state = 'waiting', goAt = 0, to = null;
    const m = G.ui.modal('Quick Draw', wrap, { onClose: function () { state = 'done'; if (to) clearTimeout(to); } });
    to = setTimeout(function () {
      if (state !== 'waiting') return;
      state = 'go'; goAt = performance.now();
      pad.className = 'react-pad go'; pad.textContent = 'TAP!';
    }, 1200 + Math.random() * 2600);
    function done(mult, label) {
      if (state === 'done') return;
      state = 'done'; if (to) clearTimeout(to);
      pad.className = 'react-pad ' + (mult > 0 ? 'go' : 'fail'); pad.textContent = label;
      setTimeout(function () {
        const res = resolve(wager, mult);
        showResult(res, action, function () { m.close(); reaction2(); });
      }, 750);
    }
    pad.addEventListener('click', function () {
      if (state === 'waiting') done(0, 'Too soon! 💀');
      else if (state === 'go') {
        const ms = Math.round(performance.now() - goAt);
        G.ui.haptic(20);
        const mult = ms < 200 ? 3 : ms < 320 ? 2 : ms < 450 ? 1.3 : 0;
        done(mult, ms + 'ms' + (mult ? ' • ×' + mult : ' • too slow'));
      }
    });
  }
  function reaction2() { chooseWager(reaction); }

  // ---- Echo (memory) -------------------------------------------------------
  function memory(wager) {
    const wrap = el('div', { class: 'game memory' });
    wrap.appendChild(el('p', { class: 'gdesc', html:
      'Watch the 6-step sequence, then repeat it exactly for <b>×2.5</b>. One slip and you lose.' }));
    const padWrap = el('div', { class: 'mem-pads' });
    const COLORS = ['#ff5470', '#3d8bff', '#4caf50', '#ffd75e'];
    const pads = COLORS.map(function (c, i) {
      const p = el('div', { class: 'mem-pad' }); p.style.setProperty('--c', c); p.dataset.i = i; return p;
    });
    pads.forEach(function (p) { padWrap.appendChild(p); });
    wrap.appendChild(el('div', { class: 'gstage' }, [padWrap]));
    const status = el('div', { class: 'gsub', text: 'Watch…' });
    wrap.appendChild(status);
    const action = el('div', { class: 'gaction' });
    wrap.appendChild(action);
    let closed = false, accept = false, inputIdx = 0;
    const m = G.ui.modal('Echo', wrap, { onClose: function () { closed = true; } });
    const seq = []; for (let i = 0; i < 6; i++) seq.push(Math.floor(Math.random() * 4));
    function flash(i, cb) {
      if (closed) return;
      const p = pads[i]; p.classList.add('lit'); G.ui.haptic(10);
      setTimeout(function () { p.classList.remove('lit'); setTimeout(cb, 90); }, 270);
    }
    function playSeq(k) {
      if (closed) return;
      if (k >= seq.length) { accept = true; status.textContent = 'Your turn!'; return; }
      flash(seq[k], function () { playSeq(k + 1); });
    }
    setTimeout(function () { playSeq(0); }, 550);
    function finish(win) {
      accept = false;
      setTimeout(function () {
        const res = resolve(wager, win ? 2.5 : 0);
        showResult(res, action, function () { m.close(); memory2(); });
      }, 450);
    }
    pads.forEach(function (p) {
      p.addEventListener('click', function () {
        if (!accept) return;
        const i = +p.dataset.i;
        p.classList.add('lit'); setTimeout(function () { p.classList.remove('lit'); }, 150);
        G.ui.haptic(10);
        if (i === seq[inputIdx]) {
          inputIdx++;
          if (inputIdx >= seq.length) { status.textContent = 'Correct! ✓'; finish(true); }
        } else { status.textContent = 'Wrong! 💀'; finish(false); }
      });
    });
  }
  function memory2() { chooseWager(memory); }

  // ---- lobby ---------------------------------------------------------------
  const GAMES = [
    { id: 'coin', name: 'Coin Flip', icon: '⛀', desc: 'Double or nothing on your whole stake.', fn: coinFlip2 },
    { id: 'wheel', name: 'Lucky Wheel', icon: '🎡', desc: 'Spin for up to ×10 on your stake.', fn: wheelGame2 },
    { id: 'slots', name: 'Slots', icon: '🎰', desc: 'Match symbols for up to ×8.', fn: slots2 },
    { id: 'dice', name: 'High Roll', icon: '🎲', desc: 'Roll the dice — safer middle ground.', fn: dice2 }
  ];
  const SKILL = [
    { id: 'timing', name: 'Bullseye', icon: '🎯', desc: 'Nail the tiny fast-moving center. ×4.', fn: timing2 },
    { id: 'react', name: 'Quick Draw', icon: '⚡', desc: 'Sub-200ms reaction for ×3.', fn: reaction2 },
    { id: 'memory', name: 'Echo', icon: '🧠', desc: 'Repeat a 6-step sequence for ×2.5.', fn: memory2 }
  ];

  function tile(g) {
    return el('div', { class: 'game-tile clickable', onclick: g.fn }, [
      el('div', { class: 'game-icon', text: g.icon }),
      el('div', { class: 'game-name', text: g.name }),
      el('div', { class: 'game-desc', text: g.desc })
    ]);
  }

  function render(container) {
    container.innerHTML = '';
    container.appendChild(el('h2', { class: 'view-title', text: '🎲 Casino' }));
    container.appendChild(el('p', { class: 'view-sub', text:
      'Wager one or many creatures — their combined value is your stake. Win bigger by betting bigger… or lose it all.' }));
    container.appendChild(el('h3', { class: 'lobby-head', text: '🍀 Luck' }));
    const luck = el('div', { class: 'game-lobby' });
    GAMES.forEach(function (g) { luck.appendChild(tile(g)); });
    container.appendChild(luck);
    container.appendChild(el('h3', { class: 'lobby-head', text: '🎯 Skill' }));
    container.appendChild(el('p', { class: 'view-sub', text: 'Your own timing, reflexes and memory decide the payout.' }));
    const skill = el('div', { class: 'game-lobby' });
    SKILL.forEach(function (g) { skill.appendChild(tile(g)); });
    container.appendChild(skill);
  }

  G.games = { render: render };
})(window.G = window.G || {});
