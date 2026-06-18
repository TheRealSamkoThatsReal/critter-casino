/* Admin panel: add new creatures, grant creatures, manage the game.
 * Note: this is a client-side game with no server, so the passcode is a
 * soft gate only — it just keeps the panel out of casual players' way. */
(function (G) {
  'use strict';
  const el = G.ui.el, toast = G.ui.toast;
  const PASS = 'admin';
  let unlocked = false;

  function previewSprite(species, size) {
    const box = el('div', { class: 'admin-preview' });
    box.appendChild(G.sprites.el(species, size || 96));
    return box;
  }

  function addForm(container) {
    let draft = { id: '', name: '', element: 'Fire', tier: 0, spriteSeed: 'seed-1' };
    const preview = el('div', { class: 'admin-preview-wrap' });
    function redraw() {
      preview.innerHTML = '';
      const sp = { id: 'preview', name: draft.name || 'New', element: draft.element, tier: draft.tier, spriteSeed: draft.spriteSeed };
      // bust sprite cache for preview by using unique id each time
      sp.id = 'preview-' + draft.spriteSeed + '-' + draft.element + '-' + draft.tier;
      preview.appendChild(G.sprites.el(sp, 110));
      const r = G.data.rarity(draft.tier);
      preview.appendChild(el('div', { class: 'admin-prev-info', html:
        '<b>' + (draft.name || 'Unnamed') + '</b><br>' + draft.element + ' • ' + r.name + ' • ⛁ ' + r.value }));
    }
    const nameInp = el('input', { class: 'a-input', placeholder: 'Creature name' });
    nameInp.addEventListener('input', function () { draft.name = nameInp.value; redraw(); });

    const elSel = el('select', { class: 'a-input' });
    G.data.ELEMENTS.forEach(function (e) { elSel.appendChild(el('option', { value: e, text: e })); });
    elSel.addEventListener('change', function () { draft.element = elSel.value; redraw(); });

    const tierSel = el('select', { class: 'a-input' });
    G.data.RARITIES.forEach(function (r) {
      tierSel.appendChild(el('option', { value: r.tier, text: r.name + ' (⛁' + r.value + ')' }));
    });
    tierSel.addEventListener('change', function () { draft.tier = parseInt(tierSel.value, 10); redraw(); });

    let seedN = 1;
    const reroll = el('button', { class: 'btn', text: '🎲 Reroll sprite', onclick: function () {
      seedN++; draft.spriteSeed = 'seed-' + seedN + '-' + nameInp.value + '-' + Math.floor(Math.random() * 99999);
      redraw();
    } });

    const saveBtn = el('button', { class: 'btn primary', text: '＋ Add creature', onclick: function () {
      const name = (draft.name || '').trim();
      if (!name) { toast('Give it a name.', 'bad'); return; }
      const base = 'cust_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      let id = base, n = 2;
      const existing = {};
      G.state.allSpecies().forEach(function (s) { existing[s.id] = 1; });
      while (existing[id]) { id = base + '-' + n++; }
      const sp = { id: id, name: name, element: draft.element, tier: draft.tier, spriteSeed: draft.spriteSeed || id, custom: true };
      G.state.get().customSpecies.push(sp);
      G.state.save();
      toast('Added ' + name + '!', 'good');
      render(document.getElementById('view'));
    } });

    const form = el('div', { class: 'admin-form' }, [
      el('div', { class: 'a-fields' }, [
        el('label', { text: 'Name' }), nameInp,
        el('label', { text: 'Element' }), elSel,
        el('label', { text: 'Rarity' }), tierSel,
        reroll
      ]),
      preview
    ]);
    container.appendChild(el('div', { class: 'panel' }, [el('h3', { text: '➕ Add Creature' }), form, saveBtn]));
    redraw();
  }

  function customList(container) {
    const custom = G.state.get().customSpecies;
    const panel = el('div', { class: 'panel' }, [el('h3', { text: '🧬 Custom Creatures (' + custom.length + ')' })]);
    if (!custom.length) { panel.appendChild(el('p', { class: 'gdesc', text: 'None yet — add some above.' })); }
    else {
      const grid = el('div', { class: 'grid' });
      custom.slice().reverse().forEach(function (sp) {
        const c = G.ui.card({ iid: 'x', sid: sp.id, shiny: false }, { size: 56, showValue: true });
        c.appendChild(el('button', { class: 'card-del', text: '🗑', onclick: function (e) {
          e.stopPropagation();
          const i = custom.indexOf(sp);
          if (i > -1) { custom.splice(i, 1); G.state.save(); render(document.getElementById('view')); toast('Deleted ' + sp.name, ''); }
        } }));
        grid.appendChild(c);
      });
      panel.appendChild(grid);
    }
    container.appendChild(panel);
  }

  function grantPanel(container) {
    const search = el('input', { class: 'a-input', placeholder: 'Search any creature to grant…' });
    const results = el('div', { class: 'grid' });
    function update() {
      results.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      const list = G.state.allSpecies().filter(function (s) {
        return !q || s.name.toLowerCase().indexOf(q) > -1 || s.element.toLowerCase().indexOf(q) > -1;
      }).slice(0, 40);
      list.forEach(function (sp) {
        results.appendChild(G.ui.card({ iid: 'g', sid: sp.id, shiny: false }, {
          size: 52, onClick: function () {
            G.state.addSpecies(sp.id, false);
            toast('Granted ' + sp.name, 'good');
            if (window.refreshAll) window.refreshAll();
          }
        }));
      });
    }
    search.addEventListener('input', update);
    container.appendChild(el('div', { class: 'panel' }, [
      el('h3', { text: '🎁 Grant Creature (to your inventory)' }),
      el('p', { class: 'gdesc', text: 'Tap a creature to add it to your collection. Shift-add for shiny via the button below.' }),
      search, results,
      el('button', { class: 'btn', text: '✨ Grant random shiny', onclick: function () {
        const sp = G.state.randomSpecies(2, 6);
        if (sp) { G.state.addSpecies(sp.id, true); toast('Granted shiny ' + sp.name + '!', 'good'); if (window.refreshAll) window.refreshAll(); }
      } })
    ]));
    update();
  }

  function dangerPanel(container) {
    const coinsInp = el('input', { class: 'a-input', type: 'number', value: G.state.get().coins });
    container.appendChild(el('div', { class: 'panel' }, [
      el('h3', { text: '⚙ Game Controls' }),
      el('div', { class: 'a-fields' }, [
        el('label', { text: 'Coins' }), coinsInp,
        el('button', { class: 'btn', text: 'Set coins', onclick: function () {
          G.state.get().coins = Math.max(0, parseInt(coinsInp.value, 10) || 0); G.state.save();
          if (window.refreshAll) window.refreshAll(); toast('Coins updated.', 'good');
        } })
      ]),
      el('button', { class: 'btn danger', text: '🗑 Reset entire game', onclick: function () {
        if (confirm('Wipe all progress, creatures, and custom species?')) {
          G.state.reset(); render(document.getElementById('view')); if (window.refreshAll) window.refreshAll();
          toast('Game reset.', '');
        }
      } })
    ]));
  }

  function gate(container) {
    const inp = el('input', { class: 'a-input', type: 'password', placeholder: 'Admin passcode' });
    const go = function () {
      if (inp.value === PASS) { unlocked = true; render(container); }
      else toast('Wrong passcode.', 'bad');
    };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    container.appendChild(el('div', { class: 'panel gate' }, [
      el('h3', { text: '🔒 Admin' }),
      el('p', { class: 'gdesc', text: 'Enter the admin passcode. (Default: "admin")' }),
      inp,
      el('button', { class: 'btn primary', text: 'Unlock', onclick: go })
    ]));
  }

  function render(container) {
    container.innerHTML = '';
    container.appendChild(el('h2', { class: 'view-title', text: '🛠 Admin Panel' }));
    if (!unlocked) { gate(container); return; }
    addForm(container);
    customList(container);
    grantPanel(container);
    dangerPanel(container);
  }

  G.admin = { render: render };
})(window.G = window.G || {});
