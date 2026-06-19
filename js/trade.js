/* Player-to-player trading without a server, via shareable codes.
 *
 * Flow:
 *  1. Player A "Create Offer": picks creatures to give. They are escrowed
 *     (removed from A's inventory) and packed into an OFFER code.
 *  2. Player B "Import code" (offer): sees what's offered, picks creatures to
 *     give back, accepts. B receives A's creatures; B's picks are escrowed
 *     into an ACCEPT code. The offer code is marked redeemed on B's device.
 *  3. Player A "Import code" (accept): receives B's creatures. Trade complete.
 *  If B never responds, A can re-import their own OFFER code to reclaim. */
(function (G) {
  'use strict';
  const el = G.ui.el, toast = G.ui.toast;
  const PREFIX = 'CC2:';      // compact codes
  const OLD_PREFIX = 'CC1:';  // legacy base64-JSON (still decodable)
  const ROSTER = G.data.builtinRoster;
  let SIDX = null;
  function sidIndex(sid) {
    if (!SIDX) { SIDX = {}; ROSTER.forEach(function (s, i) { SIDX[s.id] = i; }); }
    return SIDX[sid] != null ? SIDX[sid] : -1;
  }
  function isBuiltin(item) { return sidIndex(item.sid) >= 0; }
  function shortId() { return Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 1296).toString(36); }
  function pendingOffers() { const s = G.state.get(); if (!s.pendingOffers) s.pendingOffers = {}; return s.pendingOffers; }

  function b64u(s) { return s ? btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : ''; }
  function unb64u(s) {
    if (!s) return '';
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    try { return decodeURIComponent(escape(atob(s))); } catch (e) { return ''; }
  }
  // each builtin creature -> one integer: rosterIndex*2 + shinyBit, joined by '-'
  function packGive(give) {
    return (give || []).map(function (it) { return sidIndex(it.sid) * 2 + (it.shiny ? 1 : 0); }).join('-');
  }
  function unpackGive(str) {
    if (!str) return [];
    return str.split('-').map(function (tok) {
      const n = parseInt(tok, 10); const sp = ROSTER[n >> 1];
      return { sid: sp ? sp.id : '?', shiny: (n & 1) === 1 };
    });
  }

  // canonical obj: { t:'offer'|'accept', id, from:{name}, give:[{sid,shiny}] }
  function encode(obj) {
    const t = obj.t === 'accept' ? 'a' : 'o';
    const parts = [t, obj.id, packGive(obj.give)];
    if (t === 'o') parts.push(b64u((obj.from && obj.from.name) || ''));
    return PREFIX + parts.join('.');
  }
  function decode(str) {
    str = (str || '').trim();
    if (str.indexOf(OLD_PREFIX) === 0) { // legacy CC1 base64-JSON
      return JSON.parse(decodeURIComponent(escape(atob(str.slice(OLD_PREFIX.length)))));
    }
    if (str.indexOf(PREFIX) !== 0) throw new Error('bad code');
    const p = str.slice(PREFIX.length).split('.');
    return { t: p[0] === 'a' ? 'accept' : 'offer', id: p[1], give: unpackGive(p[2]), from: { name: unb64u(p[3] || '') } };
  }
  function redeemed() {
    const s = G.state.get();
    if (!s.redeemed) s.redeemed = {};
    return s.redeemed;
  }
  function strip(item) { return { sid: item.sid, shiny: !!item.shiny }; }

  function codeId(obj) {
    return obj.t + ':' + obj.id;
  }

  // ---- copy helper ---------------------------------------------------------
  function codeBox(code, note) {
    const ta = el('textarea', { class: 'codebox', readonly: 'readonly' });
    ta.value = code;
    const copy = el('button', { class: 'btn primary', text: '📋 Copy code' });
    copy.addEventListener('click', function () {
      ta.select();
      const ok = (navigator.clipboard && navigator.clipboard.writeText)
        ? navigator.clipboard.writeText(code).then(function () { return true; }, function () { return false; })
        : Promise.resolve(document.execCommand('copy'));
      Promise.resolve(ok).then(function () { toast('Code copied!', 'good'); });
    });
    return el('div', { class: 'codewrap' }, [
      note ? el('p', { class: 'gdesc', html: note }) : null, ta, copy
    ]);
  }

  // ---- create offer --------------------------------------------------------
  function createOffer() {
    const inv = G.state.get().inv.slice();
    if (!inv.length) { toast('You have nothing to offer.', 'bad'); return; }
    const selected = {};
    const grid = el('div', { class: 'grid pick-grid' });
    const wrap = el('div', {}, [
      el('p', { class: 'gdesc', text: 'Tap creatures you want to give away, then create the offer code.' }),
      grid
    ]);
    inv.forEach(function (item) {
      const c = G.ui.card(item, { size: 56, onClick: function (it, node) {
        if (selected[item.iid]) { delete selected[item.iid]; node.classList.remove('selected'); }
        else { selected[item.iid] = item; node.classList.add('selected'); }
      } });
      grid.appendChild(c);
    });
    const m = G.ui.modal('Create Trade Offer', wrap, {
      footer: el('button', { class: 'btn primary', text: 'Create offer code', onclick: make })
    });
    function make() {
      let items = Object.keys(selected).map(function (k) { return selected[k]; });
      if (!items.length) { toast('Select at least one creature.', 'bad'); return; }
      const tradeable = items.filter(isBuiltin);
      if (tradeable.length < items.length) toast('Custom creatures can\'t be traded — skipped.', '');
      if (!tradeable.length) { toast('None of those can be traded.', 'bad'); return; }
      items = tradeable;
      // escrow: remove from inventory
      items.forEach(function (it) { G.state.removeInstance(it.iid); });
      const me = G.state.get().player;
      const offer = { t: 'offer', id: shortId(), from: { id: me.id, name: me.name }, give: items.map(strip) };
      pendingOffers()[offer.id] = 1; // remember our own offer (for reclaim detection)
      const code = encode(offer);
      G.state.save();
      m.setFooter(null);
      m.body.innerHTML = '';
      m.body.appendChild(el('div', { class: 'gresult good', text: 'Offer created & escrowed!' }));
      m.body.appendChild(codeBox(code,
        'Send this code to the other player. They import it to respond.<br>' +
        'Re-import this same code yourself to <b>reclaim</b> if they never accept.'));
      if (window.refreshAll) window.refreshAll();
    }
  }

  // ---- import any code -----------------------------------------------------
  function importCode() {
    const ta = el('textarea', { class: 'codebox', placeholder: 'Paste a trade code here…' });
    const wrap = el('div', {}, [
      el('p', { class: 'gdesc', text: 'Paste an offer or accept code from another player.' }),
      ta,
      el('div', { class: 'gaction' }, [
        el('button', { class: 'btn primary', text: 'Load code', onclick: load })
      ])
    ]);
    const m = G.ui.modal('Import Trade Code', wrap);
    function load() {
      let obj;
      try { obj = decode(ta.value); } catch (e) { toast('That code is not valid.', 'bad'); return; }
      if (!obj || !obj.t) { toast('Unrecognized code.', 'bad'); return; }
      const me = G.state.get().player;
      if (obj.t === 'offer') {
        const mine = (obj.from && obj.from.id === me.id) || pendingOffers()[obj.id];
        return mine ? reclaimFlow(obj, m) : respondFlow(obj, m);
      }
      if (obj.t === 'accept') return completeFlow(obj, m);
      toast('Unrecognized code type.', 'bad');
    }
  }

  function alreadyDone(obj, m) {
    if (redeemed()[codeId(obj)]) {
      m.body.innerHTML = '';
      m.body.appendChild(el('div', { class: 'gresult bad', text: 'This code has already been used on this device.' }));
      return true;
    }
    return false;
  }

  // B responds to A's offer
  function respondFlow(offer, m) {
    if (alreadyDone(offer, m)) return;
    m.body.innerHTML = '';
    m.body.appendChild(el('h4', { text: 'Offer from ' + (offer.from ? offer.from.name : 'a trainer') }));
    const oList = el('div', { class: 'grid' });
    offer.give.forEach(function (it) { oList.appendChild(G.ui.card(it, { size: 52 })); });
    m.body.appendChild(el('p', { class: 'gdesc', text: 'They are offering:' }));
    m.body.appendChild(oList);

    const inv = G.state.get().inv.slice();
    const selected = {};
    m.body.appendChild(el('p', { class: 'gdesc', text: 'Pick creatures to give back (optional):' }));
    const myGrid = el('div', { class: 'grid pick-grid' });
    inv.forEach(function (item) {
      myGrid.appendChild(G.ui.card(item, { size: 52, onClick: function (it, node) {
        if (selected[item.iid]) { delete selected[item.iid]; node.classList.remove('selected'); }
        else { selected[item.iid] = item; node.classList.add('selected'); }
      } }));
    });
    m.body.appendChild(myGrid);
    m.setFooter(el('button', { class: 'btn primary', text: 'Accept trade', onclick: accept }));
    function accept() {
      m.setFooter(null);
      // receive offered creatures
      offer.give.forEach(function (it) { G.state.addInstance(G.state.mkInstance(it.sid, it.shiny)); });
      // escrow my give-back (built-in creatures only; customs aren't shareable)
      let mine = Object.keys(selected).map(function (k) { return selected[k]; });
      const tradeable = mine.filter(isBuiltin);
      if (tradeable.length < mine.length) toast('Custom creatures can\'t be traded — skipped.', '');
      mine = tradeable;
      mine.forEach(function (it) { G.state.removeInstance(it.iid); });
      redeemed()[codeId(offer)] = 1;
      G.state.get().stats.traded++;
      G.state.save();
      const accept = {
        t: 'accept', id: offer.id, to: offer.from,
        give: mine.map(strip)
      };
      m.body.innerHTML = '';
      m.body.appendChild(el('div', { class: 'gresult good', text: 'Trade accepted! You received the creatures.' }));
      if (accept.give.length) {
        m.body.appendChild(codeBox(encode(accept),
          'Send this ACCEPT code back so they receive your creatures.'));
      } else {
        m.body.appendChild(el('p', { class: 'gdesc', text: 'You gave nothing back — no return code needed. It was a gift!' }));
      }
      if (window.refreshAll) window.refreshAll();
    }
  }

  // A completes after B accepted
  function completeFlow(acc, m) {
    if (alreadyDone(acc, m)) return;
    m.body.innerHTML = '';
    if (!acc.give || !acc.give.length) {
      m.body.appendChild(el('div', { class: 'gresult', text: 'They accepted but sent nothing back.' }));
      redeemed()[codeId(acc)] = 1; G.state.save();
      return;
    }
    const list = el('div', { class: 'grid' });
    acc.give.forEach(function (it) { list.appendChild(G.ui.card(it, { size: 56 })); });
    m.body.appendChild(el('p', { class: 'gdesc', text: 'You will receive:' }));
    m.body.appendChild(list);
    m.body.appendChild(el('div', { class: 'gaction' }, [
      el('button', { class: 'btn primary', text: 'Receive creatures', onclick: function () {
        acc.give.forEach(function (it) { G.state.addInstance(G.state.mkInstance(it.sid, it.shiny)); });
        redeemed()[codeId(acc)] = 1;
        G.state.get().stats.traded++;
        G.state.save();
        m.body.innerHTML = '';
        m.body.appendChild(el('div', { class: 'gresult good', text: '🎉 Trade complete!' }));
        if (window.refreshAll) window.refreshAll();
      } })
    ]));
  }

  // A reclaims an unaccepted offer
  function reclaimFlow(offer, m) {
    if (alreadyDone(offer, m)) return;
    m.body.innerHTML = '';
    m.body.appendChild(el('p', { class: 'gdesc', text: 'This is your own offer. Reclaim the escrowed creatures? (Only do this if the other player did NOT accept.)' }));
    const list = el('div', { class: 'grid' });
    offer.give.forEach(function (it) { list.appendChild(G.ui.card(it, { size: 52 })); });
    m.body.appendChild(list);
    m.body.appendChild(el('div', { class: 'gaction' }, [
      el('button', { class: 'btn primary', text: 'Reclaim', onclick: function () {
        offer.give.forEach(function (it) { G.state.addInstance(G.state.mkInstance(it.sid, it.shiny)); });
        redeemed()[codeId(offer)] = 1;
        G.state.save();
        m.body.innerHTML = '';
        m.body.appendChild(el('div', { class: 'gresult', text: 'Creatures reclaimed.' }));
        if (window.refreshAll) window.refreshAll();
      } })
    ]));
  }

  // ===== live trade board (server-backed, single-claim) =====================
  function me() { return G.state.get().player; }
  function serverBase() { return (G.push && G.push.base) ? G.push.base() : ''; }
  function api(path, method, body) {
    const base = serverBase();
    if (!base) return Promise.reject(new Error('no server'));
    return fetch(base + path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }
  function toTokens(items) { return items.map(function (it) { return sidIndex(it.sid) * 2 + (it.shiny ? 1 : 0); }); }
  function fromTokens(arr) {
    return (arr || []).map(function (n) { const sp = ROSTER[n >> 1]; return { sid: sp ? sp.id : '?', shiny: (n & 1) === 1 }; });
  }
  function spriteRow(items, size) {
    const row = el('div', { class: 'trade-sprites' });
    items.forEach(function (it) { row.appendChild(G.ui.card(it, { size: size || 46, showValue: false })); });
    return row;
  }
  // grid of the player's (built-in) creatures with tap-to-select; returns {grid, selected}
  function pickGrid(size) {
    const selected = {};
    const grid = el('div', { class: 'grid pick-grid' });
    G.state.get().inv.slice().sort(function (a, b) { return G.state.valueOf(b) - G.state.valueOf(a); }).forEach(function (item) {
      if (sidIndex(item.sid) < 0) return; // built-in only
      grid.appendChild(G.ui.card(item, { size: size || 50, onClick: function (it, node) {
        if (selected[item.iid]) { delete selected[item.iid]; node.classList.remove('selected'); }
        else { selected[item.iid] = item; node.classList.add('selected'); }
      } }));
    });
    return { grid: grid, list: function () { return Object.keys(selected).map(function (k) { return selected[k]; }); } };
  }

  function renderBoardInto(listEl) {
    listEl.innerHTML = '';
    listEl.appendChild(el('p', { class: 'gdesc', text: 'Loading trades…' }));
    api('/trade/list').then(function (res) {
      const trades = (res && res.trades) || [];
      listEl.innerHTML = '';
      if (!trades.length) { listEl.appendChild(el('p', { class: 'gdesc', text: 'No open trades right now — post one!' })); return; }
      trades.forEach(function (t) {
        const mine = t.owner.id === me().id;
        const row = el('div', { class: 'trade-row' }, [
          el('div', { class: 'trade-row-head' }, [
            el('span', { class: 'trade-owner', text: t.owner.name || 'Trainer' }),
            t.want ? el('span', { class: 'trade-want', text: '“' + t.want + '”' }) : null
          ]),
          spriteRow(fromTokens(t.give)),
          el('div', { class: 'gaction' }, [
            mine ? el('span', { class: 'gsub', text: 'Your trade' })
                 : el('button', { class: 'btn small primary', text: 'Claim', onclick: function () { claimTrade(t); } })
          ])
        ]);
        listEl.appendChild(row);
      });
    }).catch(function () { listEl.innerHTML = ''; listEl.appendChild(el('p', { class: 'gdesc', text: '⚠️ Trade server unavailable.' })); });
  }

  function postTrade() {
    const pg = pickGrid(50);
    if (!pg.grid.children.length) { toast('No tradeable creatures to offer.', 'bad'); return; }
    const wantInp = el('input', { class: 'a-input', placeholder: 'What you\'re hoping for (optional)', maxlength: 80 });
    const wrap = el('div', {}, [
      el('p', { class: 'gdesc', text: 'Pick creatures to offer on the public board. The first player to claim them gets them.' }),
      wantInp, pg.grid
    ]);
    const goBtn = el('button', { class: 'btn primary', text: 'Post to board' });
    const m = G.ui.modal('Post a Trade', wrap, { footer: goBtn });
    goBtn.addEventListener('click', function () {
      const items = pg.list();
      if (!items.length) { toast('Select at least one creature.', 'bad'); return; }
      goBtn.disabled = true;
      api('/trade/post', 'POST', { owner: { id: me().id, name: me().name }, give: toTokens(items), want: wantInp.value })
        .then(function (res) {
          if (!res || !res.ok) { toast((res && res.error) || 'Post failed.', 'bad'); goBtn.disabled = false; return; }
          items.forEach(function (it) { G.state.removeInstance(it.iid); }); // escrow after server confirms
          G.state.save();
          m.close(); toast('Posted to the board!', 'good');
          if (window.refreshAll) window.refreshAll();
        })
        .catch(function () { toast('Trade server unavailable.', 'bad'); goBtn.disabled = false; });
    });
  }

  function claimTrade(t) {
    const wrap = el('div', {});
    wrap.appendChild(el('p', { class: 'gdesc', html: '<b>' + (t.owner.name || 'Trainer') + '</b> is offering:' }));
    wrap.appendChild(spriteRow(fromTokens(t.give), 52));
    if (t.want) wrap.appendChild(el('p', { class: 'gdesc', text: 'They want: ' + t.want }));
    wrap.appendChild(el('p', { class: 'gdesc', text: 'Give creatures back (optional):' }));
    const pg = pickGrid(48);
    wrap.appendChild(pg.grid);
    const goBtn = el('button', { class: 'btn primary', text: 'Claim trade' });
    const m = G.ui.modal('Claim trade', wrap, { footer: goBtn });
    goBtn.addEventListener('click', function () {
      goBtn.disabled = true;
      const back = pg.list();
      api('/trade/claim', 'POST', { id: t.id, claimer: { id: me().id, name: me().name }, give: toTokens(back) })
        .then(function (res) {
          if (!res || !res.ok) { toast(res && res.error === 'unavailable' ? 'Too late — already claimed!' : 'Claim failed.', 'bad'); m.close(); return; }
          fromTokens(res.give).forEach(function (it) { G.state.addInstance(G.state.mkInstance(it.sid, it.shiny)); });
          back.forEach(function (it) { G.state.removeInstance(it.iid); }); // escrow give-back to the owner
          G.state.get().stats.traded++; G.state.save();
          m.close(); toast('Trade claimed! 🎉', 'good');
          if (window.refreshAll) window.refreshAll();
        })
        .catch(function () { toast('Trade server unavailable.', 'bad'); goBtn.disabled = false; });
    });
  }

  function myTrades() {
    const wrap = el('div', {}, [el('p', { class: 'gdesc', text: 'Loading…' })]);
    const m = G.ui.modal('My Trades', wrap);
    function reload() {
      api('/trade-mine', 'POST', { ownerId: me().id }).then(function (res) {
        wrap.innerHTML = '';
        const trades = (res && res.trades) || [];
        if (!trades.length) { wrap.appendChild(el('p', { class: 'gdesc', text: 'You have no active trades.' })); return; }
        trades.forEach(function (t) {
          const row = el('div', { class: 'trade-row' }, [spriteRow(fromTokens(t.give), 44)]);
          if (t.status === 'open') {
            row.appendChild(el('div', { class: 'gaction' }, [
              el('span', { class: 'gsub', text: 'Open on board' }),
              el('button', { class: 'btn small', text: 'Cancel & reclaim', onclick: function () {
                api('/trade/cancel', 'POST', { id: t.id, ownerId: me().id }).then(function (r) {
                  if (r && r.ok) { fromTokens(r.give).forEach(function (it) { G.state.addInstance(G.state.mkInstance(it.sid, it.shiny)); }); G.state.save(); toast('Reclaimed.', 'good'); if (window.refreshAll) window.refreshAll(); reload(); }
                  else toast('Could not cancel.', 'bad');
                }).catch(function () { toast('Server unavailable.', 'bad'); });
              } })
            ]));
          } else if (t.status === 'claimed') {
            row.appendChild(el('div', { class: 'gaction' }, [
              el('span', { class: 'gsub', text: 'Claimed by ' + ((t.claimer && t.claimer.name) || 'someone') }),
              el('button', { class: 'btn small primary', text: 'Collect return', onclick: function () {
                api('/trade/collect', 'POST', { id: t.id, ownerId: me().id }).then(function (r) {
                  if (r && r.ok) { fromTokens(r.give).forEach(function (it) { G.state.addInstance(G.state.mkInstance(it.sid, it.shiny)); }); G.state.save(); toast((r.give && r.give.length) ? 'Collected!' : 'Nothing to collect.', 'good'); if (window.refreshAll) window.refreshAll(); reload(); }
                  else toast('Could not collect.', 'bad');
                }).catch(function () { toast('Server unavailable.', 'bad'); });
              } })
            ]));
          }
          wrap.appendChild(row);
        });
      }).catch(function () { wrap.innerHTML = ''; wrap.appendChild(el('p', { class: 'gdesc', text: '⚠️ Trade server unavailable.' })); });
    }
    reload();
  }

  function render(container) {
    container.innerHTML = '';
    container.appendChild(el('h2', { class: 'view-title', text: '🤝 Trade' }));
    container.appendChild(el('p', { class: 'view-sub', text:
      'Post creatures to the live board — first to claim gets them. Each trade can only be claimed once.' }));
    const meP = me();
    container.appendChild(el('div', { class: 'name-row' }, [
      el('label', { text: 'Your trainer name: ' }),
      (function () {
        const inp = el('input', { class: 'tname', value: meP.name, maxlength: 20 });
        inp.addEventListener('change', function () { meP.name = inp.value.trim() || 'Trainer'; G.state.save(); toast('Name saved.', 'good'); });
        return inp;
      })()
    ]));

    if (serverBase()) {
      const list = el('div', { class: 'trade-board' });
      container.appendChild(el('div', { class: 'trade-actions' }, [
        el('button', { class: 'btn primary', text: '➕ Post Trade', onclick: postTrade }),
        el('button', { class: 'btn', text: '📦 My Trades', onclick: myTrades }),
        el('button', { class: 'btn', text: '↻', title: 'Refresh', onclick: function () { renderBoardInto(list); } })
      ]));
      container.appendChild(el('h3', { class: 'lobby-head', text: '🛒 Trade Board' }));
      container.appendChild(list);
      renderBoardInto(list);
    } else {
      container.appendChild(el('p', { class: 'gdesc', text: 'Trade board unavailable (server not configured).' }));
    }

    // offline fallback: code-based trading
    container.appendChild(el('h3', { class: 'lobby-head', text: '✉️ Trade by code (offline)' }));
    container.appendChild(el('div', { class: 'trade-actions' }, [
      el('button', { class: 'btn', text: '➕ Create Offer', onclick: createOffer }),
      el('button', { class: 'btn', text: '📥 Import Code', onclick: importCode })
    ]));
  }

  G.trade = { render: render };
})(window.G = window.G || {});
