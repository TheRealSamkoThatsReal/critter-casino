/* Procedural pixel-art creature sprite generator.
 * Each creature gets a unique, deterministic, symmetric monster sprite
 * derived from its id (seed) and element palette. No image files needed,
 * so we can have an unlimited number of creatures. */
(function (G) {
  'use strict';

  // --- deterministic PRNG ---------------------------------------------------
  function hashStr(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- element palettes (base hue) -----------------------------------------
  const ELEMENT_HUE = {
    Fire: 12, Water: 205, Grass: 110, Electric: 52, Ice: 185,
    Rock: 28, Shadow: 270, Light: 48, Toxic: 95, Cosmic: 285,
    Metal: 210, Psychic: 320, Dragon: 0, Wind: 160, Spirit: 240,
    Aqua: 195, Nature: 130, Void: 260, Solar: 40, Lunar: 230
  };

  function hsl(h, s, l) { return 'hsl(' + h + ',' + s + '%,' + l + '%)'; }

  function buildPalette(rng, element, tier) {
    const baseHue = (ELEMENT_HUE[element] != null ? ELEMENT_HUE[element] : Math.floor(rng() * 360));
    const hue = (baseHue + Math.floor((rng() - 0.5) * 24) + 360) % 360;
    const sat = 55 + tier * 5 + Math.floor(rng() * 10);
    return {
      dark: hsl(hue, Math.min(sat + 10, 95), 24),
      mid: hsl(hue, Math.min(sat, 90), 44),
      light: hsl((hue + 14) % 360, Math.min(sat, 90), 64),
      accent: hsl((hue + 150) % 360, 85, 60),
      outline: hsl(hue, 60, 12)
    };
  }

  // --- sprite matrix generation --------------------------------------------
  // Returns a SIZE x SIZE matrix of color keys ('', 'dark','mid','light','accent','eye','outline')
  const SIZE = 14;

  function generateMatrix(seed) {
    const rng = mulberry32(seed);
    const half = Math.ceil(SIZE / 2);
    const cell = []; // [y][x]
    for (let y = 0; y < SIZE; y++) cell.push(new Array(SIZE).fill(''));

    const cx = (SIZE - 1) / 2;
    const cy = (SIZE - 1) / 2 + 0.5;
    const bodyR = 3.6 + rng() * 1.8;

    // Build a blobby symmetric body in the left half, then mirror.
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 0; x < half; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy * 0.85);
        let p = (bodyR - dist) / bodyR + 0.18;
        p += (rng() - 0.5) * 0.55;
        if (dist < bodyR * 0.55) p += 0.25; // solid core
        if (p > 0.42) cell[y][x] = 'mid';
      }
    }
    // mirror left -> right
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < half; x++)
        if (cell[y][x]) cell[y][SIZE - 1 - x] = cell[y][x];

    // limbs / spikes: poke out random pixels on edges (mirrored)
    const limbs = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < limbs; i++) {
      const y = 3 + Math.floor(rng() * (SIZE - 6));
      const x = 1 + Math.floor(rng() * (half - 1));
      cell[y][x] = 'mid'; cell[y][SIZE - 1 - x] = 'mid';
      if (rng() > 0.5 && x > 0) { cell[y][x - 1] = 'mid'; cell[y][SIZE - x] = 'mid'; }
    }

    // shading: pixels with empty neighbor below -> darker; top -> lighter
    const base = cell.map(row => row.slice());
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!base[y][x]) continue;
        const below = y + 1 < SIZE ? base[y + 1][x] : '';
        const above = y - 1 >= 0 ? base[y - 1][x] : '';
        if (!below) cell[y][x] = 'dark';
        else if (!above) cell[y][x] = 'light';
      }
    }

    // outline pass: empty cell adjacent to body -> outline
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (base[y][x]) continue;
        let touch = false;
        for (let dy = -1; dy <= 1 && !touch; dy++)
          for (let dx = -1; dx <= 1 && !touch; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && base[ny][nx]) touch = true;
          }
        if (touch) cell[y][x] = 'outline';
      }
    }

    // eyes: find a filled row in the upper-mid section, place symmetric eyes
    const eyeRow = Math.max(3, Math.floor(cy - 1));
    let eyeX = -1;
    for (let x = Math.floor(cx) - 1; x >= 1; x--) {
      if (base[eyeRow][x]) { eyeX = x; break; }
    }
    if (eyeX === -1) eyeX = Math.floor(cx) - 2;
    if (eyeX >= 1) {
      cell[eyeRow][eyeX] = 'eye';
      cell[eyeRow][SIZE - 1 - eyeX] = 'eye';
    }

    // a few accent specks
    const specks = Math.floor(rng() * 3);
    for (let i = 0; i < specks; i++) {
      const y = 2 + Math.floor(rng() * (SIZE - 4));
      const x = 1 + Math.floor(rng() * (half - 1));
      if (base[y][x]) { cell[y][x] = 'accent'; cell[y][SIZE - 1 - x] = 'accent'; }
    }

    return cell;
  }

  // --- custom pixel grids (hand-drawn in the admin editor) ------------------
  // Stored compactly as an array of SIZE strings, one char per cell.
  const KEY2CH = { '': '.', outline: 'o', dark: 'd', mid: 'm', light: 'l', accent: 'a', eye: 'e' };
  const CH2KEY = { '.': '', o: 'outline', d: 'dark', m: 'mid', l: 'light', a: 'accent', e: 'eye' };

  function gridToPixels(grid) {
    const rows = [];
    for (let y = 0; y < SIZE; y++) {
      let s = '';
      for (let x = 0; x < SIZE; x++) s += (KEY2CH[grid[y][x]] || '.');
      rows.push(s);
    }
    return rows;
  }
  function pixelsToGrid(pixels) {
    const grid = [];
    for (let y = 0; y < SIZE; y++) {
      const row = (pixels && pixels[y]) || '';
      const r = [];
      for (let x = 0; x < SIZE; x++) r.push(CH2KEY[row[x]] || '');
      grid.push(r);
    }
    return grid;
  }

  function paletteOf(creature) {
    const seed = hashStr(creature.spriteSeed || creature.id);
    const rng = mulberry32(seed ^ 0x9e3779b9);
    return buildPalette(rng, creature.element, creature.tier || 0);
  }
  // fresh 2D key grid from the procedural generator (good editor starting point)
  function generatedGrid(creature) {
    return generateMatrix(hashStr(creature.spriteSeed || creature.id));
  }

  // cache matrices/palettes by key (procedural creatures only)
  const cache = {};
  function spriteData(creature) {
    // hand-drawn sprite: never cached, so edits always show immediately
    if (creature.pixels) {
      return { matrix: pixelsToGrid(creature.pixels), palette: paletteOf(creature) };
    }
    const key = creature.id;
    if (cache[key]) return cache[key];
    const data = { matrix: generatedGrid(creature), palette: paletteOf(creature) };
    cache[key] = data;
    return data;
  }

  function colorFor(key, pal) {
    switch (key) {
      case 'dark': return pal.dark;
      case 'mid': return pal.mid;
      case 'light': return pal.light;
      case 'accent': return pal.accent;
      case 'outline': return pal.outline;
      case 'eye': return '#ffffff';
      default: return null;
    }
  }

  // Draw onto a canvas element (sized px x px).
  function draw(canvas, creature, px) {
    const d = spriteData(creature);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    canvas.style.width = px + 'px';
    canvas.style.height = px + 'px';
    ctx.imageSmoothingEnabled = false;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, px, px);
    const s = px / SIZE;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const c = colorFor(d.matrix[y][x], d.palette);
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(Math.floor(x * s), Math.floor(y * s), Math.ceil(s), Math.ceil(s));
        if (d.matrix[y][x] === 'eye') {
          ctx.fillStyle = '#101018';
          ctx.fillRect(Math.floor(x * s + s * 0.35), Math.floor(y * s + s * 0.2),
            Math.ceil(s * 0.45), Math.ceil(s * 0.6));
        }
      }
    }
  }

  // Returns an <canvas> element ready to insert.
  function el(creature, px) {
    const c = document.createElement('canvas');
    c.className = 'sprite';
    draw(c, creature, px);
    return c;
  }

  // Each species' sprite is drawn ONCE to a data URL and reused. This keeps big
  // grids (e.g. the wager picker with hundreds of creatures) cheap — an <img>
  // sharing a cached, already-decoded bitmap instead of a fresh 196-fillRect
  // canvas per card.
  const urlCache = {};
  const BASE = 84; // single cached resolution; CSS scales it (pixelated)
  function dataURL(creature) {
    const key = (creature.id || creature.spriteSeed || 'x') + (creature.pixels ? '|' + creature.pixels.join('') : '');
    if (urlCache[key]) return urlCache[key];
    const c = document.createElement('canvas');
    draw(c, creature, BASE);
    let u = null;
    try { u = c.toDataURL(); } catch (e) {}
    if (u) urlCache[key] = u;
    return u;
  }
  // Lightweight cached sprite as an <img>; preferred for list/grid cards.
  function imgEl(creature, px) {
    const im = new Image();
    im.className = 'sprite';
    im.decoding = 'async';
    im.style.width = px + 'px';
    im.style.height = px + 'px';
    const u = dataURL(creature);
    if (u) im.src = u;
    return im;
  }

  G.sprites = {
    draw: draw, el: el, imgEl: imgEl, data: spriteData, SIZE: SIZE, hashStr: hashStr,
    palette: paletteOf, keyColor: colorFor,
    generatedGrid: generatedGrid, gridToPixels: gridToPixels, pixelsToGrid: pixelsToGrid
  };
})(window.G = window.G || {});
