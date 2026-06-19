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
  const PREFIX = 'CC1:';

  function encode(obj) {
    return PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }
  function decode(str) {
    str = (str || '').trim();
    if (str.indexOf(PREFIX) === 0) str = str.slice(PREFIX.length);
    return JSON.parse(decodeURIComponent(escape(atob(str))));
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
      const items = Object.keys(selected).map(function (k) { return selected[k]; });
      if (!items.length) { toast('Select at least one creature.', 'bad'); return; }
      // escrow: remove from inventory
      items.forEach(function (it) { G.state.removeInstance(it.iid); });
      const me = G.state.get().player;
      const offer = {
        t: 'offer',
        id: me.id + '-' + Date.now().toString(36),
        from: { id: me.id, name: me.name },
        give: items.map(strip)
      };
      const code = encode(offer);
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
        if (obj.from && obj.from.id === me.id) return reclaimFlow(obj, m);
        return respondFlow(obj, m);
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
      // escrow my give-back
      const mine = Object.keys(selected).map(function (k) { return selected[k]; });
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

  function render(container) {
    container.innerHTML = '';
    container.appendChild(el('h2', { class: 'view-title', text: '🤝 Trade' }));
    container.appendChild(el('p', { class: 'view-sub', text:
      'Trade creatures with friends using share codes — no internet account needed.' }));
    const me = G.state.get().player;
    const nameRow = el('div', { class: 'name-row' }, [
      el('label', { text: 'Your trainer name: ' }),
      (function () {
        const inp = el('input', { class: 'tname', value: me.name, maxlength: 20 });
        inp.addEventListener('change', function () {
          me.name = inp.value.trim() || 'Trainer'; G.state.save(); toast('Name saved.', 'good');
        });
        return inp;
      })()
    ]);
    container.appendChild(nameRow);
    const actions = el('div', { class: 'trade-actions' }, [
      el('button', { class: 'btn primary big', text: '➕ Create Offer', onclick: createOffer }),
      el('button', { class: 'btn big', text: '📥 Import Code', onclick: importCode })
    ]);
    container.appendChild(actions);
    container.appendChild(el('div', { class: 'help-card', html:
      '<b>How to trade</b><ol>' +
      '<li>One player taps <b>Create Offer</b>, picks creatures, and shares the code.</li>' +
      '<li>The other taps <b>Import Code</b>, picks creatures to give back, and accepts.</li>' +
      '<li>They send back the <b>accept code</b>; the first player imports it to finish.</li>' +
      '</ol>' }));
  }

  G.trade = { render: render };
})(window.G = window.G || {});
