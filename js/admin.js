/* Admin panel: add new creatures, grant creatures, manage the game.
 * Note: this is a client-side game with no server, so the passcode is a
 * soft gate only — it just keeps the panel out of casual players' way. */
(function (G) {
  'use strict';
  const el = G.ui.el, toast = G.ui.toast;
  function pass() { return G.state.get().adminPass || 'admin'; }
  let unlocked = false;

  function previewSprite(species, size) {
    const box = el('div', { class: 'admin-preview' });
    box.appendChild(G.sprites.el(species, size || 96));
    return box;
  }

  // ---- 14x14 pixel sprite editor ------------------------------------------
  // ref: {element, tier, spriteSeed} used for palette + procedural start.
  // current: existing pixels array (or null). onSave(pixels|null).
  function openEditor(ref, current, onSave) {
    const SIZE = G.sprites.SIZE;
    const palette = G.sprites.palette(ref);
    const SLOTS = [
      { k: '', label: 'Erase' },
      { k: 'outline', label: 'Outline' },
      { k: 'dark', label: 'Dark' },
      { k: 'mid', label: 'Body' },
      { k: 'light', label: 'Light' },
      { k: 'accent', label: 'Accent' },
      { k: 'eye', label: 'Eye' }
    ];
    let grid = current ? G.sprites.pixelsToGrid(current) : G.sprites.generatedGrid(ref);
    let cur = 'mid', mirror = true, painting = false;

    const cells = new Array(SIZE * SIZE);
    const gridEl = el('div', { class: 'pix-grid' });
    gridEl.style.gridTemplateColumns = 'repeat(' + SIZE + ', 1fr)';

    function setCell(x, y) {
      const c = cells[y * SIZE + x];
      const css = G.sprites.keyColor(grid[y][x], palette);
      c.style.background = css || '';
      c.classList.toggle('on', !!grid[y][x]);
    }
    function paint(x, y) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
      grid[y][x] = cur; setCell(x, y);
      if (mirror) { const mx = SIZE - 1 - x; grid[y][mx] = cur; setCell(mx, y); }
    }
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const c = el('div', { class: 'pix-cell' });
        c.dataset.x = x; c.dataset.y = y;
        cells[y * SIZE + x] = c;
        gridEl.appendChild(c);
        setCell(x, y);
      }
    }
    function cellFromPoint(e) {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      if (t && t.classList.contains('pix-cell')) paint(+t.dataset.x, +t.dataset.y);
    }
    gridEl.addEventListener('pointerdown', function (e) {
      e.preventDefault(); painting = true;
      if (e.target.classList.contains('pix-cell')) paint(+e.target.dataset.x, +e.target.dataset.y);
    });
    gridEl.addEventListener('pointermove', function (e) { if (painting) { e.preventDefault(); cellFromPoint(e); } });
    window.addEventListener('pointerup', function () { painting = false; });
    gridEl.addEventListener('pointerleave', function () { painting = false; });

    // palette swatches
    const sw = el('div', { class: 'pix-palette' });
    const swatchEls = {};
    SLOTS.forEach(function (s) {
      const b = el('button', { class: 'pix-swatch' + (s.k === cur ? ' active' : ''), title: s.label });
      const css = G.sprites.keyColor(s.k, palette);
      if (s.k === '') b.classList.add('erase'); else b.style.background = css;
      b.appendChild(el('span', { class: 'pix-swatch-l', text: s.label }));
      b.addEventListener('click', function () {
        cur = s.k;
        Object.keys(swatchEls).forEach(function (k) { swatchEls[k].classList.toggle('active', k === cur); });
      });
      swatchEls[s.k] = b;
      sw.appendChild(b);
    });

    const mirrorBtn = el('button', { class: 'btn small' + (mirror ? ' on' : ''), text: '🪞 Mirror: On' });
    mirrorBtn.addEventListener('click', function () {
      mirror = !mirror;
      mirrorBtn.textContent = '🪞 Mirror: ' + (mirror ? 'On' : 'Off');
      mirrorBtn.classList.toggle('on', mirror);
    });
    function refreshAllCells() { for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) setCell(x, y); }
    const clearBtn = el('button', { class: 'btn small', text: '✕ Clear', onclick: function () {
      grid = []; for (let y = 0; y < SIZE; y++) grid.push(new Array(SIZE).fill('')); refreshAllCells();
    } });
    const randBtn = el('button', { class: 'btn small', text: '🎲 Random', onclick: function () {
      grid = G.sprites.generatedGrid({ element: ref.element, tier: ref.tier,
        spriteSeed: 'r' + Math.floor(Math.random() * 1e9) }); refreshAllCells();
    } });

    const wrap = el('div', { class: 'pix-editor' }, [
      el('p', { class: 'gdesc', text: 'Tap or drag to paint. Mirror keeps both halves symmetric. Colors follow the creature\'s element & rarity.' }),
      sw,
      gridEl,
      el('div', { class: 'pix-tools' }, [mirrorBtn, randBtn, clearBtn])
    ]);
    const m = G.ui.modal('Sprite Editor (' + SIZE + '×' + SIZE + ')', wrap);
    wrap.appendChild(el('div', { class: 'gaction' }, [
      el('button', { class: 'btn primary', text: '✓ Save sprite', onclick: function () {
        onSave(G.sprites.gridToPixels(grid)); m.close();
      } }),
      el('button', { class: 'btn', text: 'Use procedural instead', onclick: function () {
        onSave(null); m.close();
      } })
    ]));
  }

  function addForm(container) {
    let draft = { id: '', name: '', element: 'Fire', tier: 0, spriteSeed: 'seed-1', pixels: null };
    const preview = el('div', { class: 'admin-preview-wrap' });
    function redraw() {
      preview.innerHTML = '';
      const sp = { name: draft.name || 'New', element: draft.element, tier: draft.tier, spriteSeed: draft.spriteSeed, pixels: draft.pixels };
      // bust sprite cache for preview by using unique id each time
      sp.id = 'preview-' + draft.spriteSeed + '-' + draft.element + '-' + draft.tier;
      preview.appendChild(G.sprites.el(sp, 110));
      const r = G.data.rarity(draft.tier);
      preview.appendChild(el('div', { class: 'admin-prev-info', html:
        '<b>' + (draft.name || 'Unnamed') + '</b><br>' + draft.element + ' • ' + r.name + ' • ✨ ' + r.value +
        (draft.pixels ? '<br><span class="custom-tag">✏️ custom sprite</span>' : '') }));
    }
    const nameInp = el('input', { class: 'a-input', placeholder: 'Creature name' });
    nameInp.addEventListener('input', function () { draft.name = nameInp.value; redraw(); });

    const elSel = el('select', { class: 'a-input' });
    G.data.ELEMENTS.forEach(function (e) { elSel.appendChild(el('option', { value: e, text: e })); });
    elSel.addEventListener('change', function () { draft.element = elSel.value; redraw(); });

    const tierSel = el('select', { class: 'a-input' });
    G.data.RARITIES.forEach(function (r) {
      tierSel.appendChild(el('option', { value: r.tier, text: r.name + ' (✨' + r.value + ')' }));
    });
    tierSel.addEventListener('change', function () { draft.tier = parseInt(tierSel.value, 10); redraw(); });

    let seedN = 1;
    const reroll = el('button', { class: 'btn', text: '🎲 Reroll sprite', onclick: function () {
      seedN++; draft.spriteSeed = 'seed-' + seedN + '-' + nameInp.value + '-' + Math.floor(Math.random() * 99999);
      draft.pixels = null;
      redraw();
    } });
    const drawBtn = el('button', { class: 'btn', text: '✏️ Draw sprite', onclick: function () {
      openEditor(draft, draft.pixels, function (pixels) { draft.pixels = pixels; redraw(); });
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
      if (draft.pixels) sp.pixels = draft.pixels;
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
        reroll, drawBtn
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
        c.appendChild(el('button', { class: 'card-edit', text: '✏️', title: 'Edit sprite', onclick: function (e) {
          e.stopPropagation();
          openEditor(sp, sp.pixels, function (pixels) {
            if (pixels) sp.pixels = pixels; else delete sp.pixels;
            G.state.save(); render(document.getElementById('view'));
            if (window.refreshAll) window.refreshAll();
            toast('Sprite updated.', 'good');
          });
        } }));
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

  function passcodePanel(container) {
    const np = el('input', { class: 'a-input', type: 'password', placeholder: 'New passcode' });
    const cp = el('input', { class: 'a-input', type: 'password', placeholder: 'Confirm passcode' });
    container.appendChild(el('div', { class: 'panel' }, [
      el('h3', { text: '🔑 Admin Passcode' }),
      el('div', { class: 'a-fields' }, [
        el('label', { text: 'New passcode' }), np,
        el('label', { text: 'Confirm' }), cp
      ]),
      el('button', { class: 'btn primary', text: 'Change passcode', onclick: function () {
        const a = np.value, b = cp.value;
        if (!a) { toast('Enter a new passcode.', 'bad'); return; }
        if (a !== b) { toast('Passcodes don\'t match.', 'bad'); return; }
        G.state.get().adminPass = a; G.state.save();
        np.value = ''; cp.value = '';
        toast('Admin passcode changed.', 'good');
      } })
    ]));
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
      if (inp.value === pass()) { unlocked = true; render(container); }
      else toast('Wrong passcode.', 'bad');
    };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    container.appendChild(el('div', { class: 'panel gate' }, [
      el('h3', { text: '🔒 Admin' }),
      el('p', { class: 'gdesc', text: 'Enter the admin passcode.' }),
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
    passcodePanel(container);
    dangerPanel(container);
  }

  G.admin = { render: render };
})(window.G = window.G || {});
