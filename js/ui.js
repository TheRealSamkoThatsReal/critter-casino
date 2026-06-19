/* Shared UI helpers: toasts, modal, card rendering, formatting. */
(function (G) {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function')
        e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function fmt(n) {
    n = Math.round(n);
    if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'k';
    return String(n);
  }

  // Haptic feedback (Android Chrome etc.; silently no-ops where unsupported,
  // e.g. iOS Safari, which doesn't implement the Vibration API).
  function haptic(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  function toast(msg, kind) {
    const wrap = $('#toasts');
    const t = el('div', { class: 'toast ' + (kind || ''), text: msg });
    wrap.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 300);
    }, 2600);
  }

  // creature card. opts: {size, badge, onClick, selected, showValue}
  function card(item, opts) {
    opts = opts || {};
    const sp = G.state.getSpecies(item.sid);
    if (!sp) return el('div', { class: 'card missing', text: '???' });
    const r = G.data.rarity(sp.tier);
    const size = opts.size || 64;
    const c = el('div', {
      class: 'card r' + sp.tier + (opts.selected ? ' selected' : '') + (item.shiny ? ' shiny' : ''),
      title: sp.name + ' — ' + r.name
    });
    c.style.setProperty('--glow', r.glow === 'none' ? 'transparent' : r.glow);
    c.style.setProperty('--rcolor', r.color);
    const spr = el('div', { class: 'spritebox' });
    const sprCanvas = G.sprites.el(sp, size);
    if (opts.silhouette) sprCanvas.classList.add('silhouette');
    spr.appendChild(sprCanvas);
    if (item.shiny && !opts.silhouette) spr.appendChild(el('div', { class: 'shiny-star', text: '★' }));
    c.appendChild(spr);
    c.appendChild(el('div', { class: 'cname', text: opts.silhouette ? (opts.nameOverride || '???') : sp.name }));
    c.appendChild(el('div', { class: 'crarity', text: r.name }));
    if (opts.showValue !== false && !opts.silhouette)
      c.appendChild(el('div', { class: 'cvalue', html: '⛁ ' + fmt(G.state.valueOf(item)) }));
    if (opts.badge) c.appendChild(el('div', { class: 'cbadge', text: opts.badge }));
    if (opts.onClick) {
      c.classList.add('clickable');
      c.addEventListener('click', function () { haptic(8); opts.onClick(item, c); });
    }
    return c;
  }

  // modal
  function modal(title, contentNode, opts) {
    opts = opts || {};
    const overlay = el('div', { class: 'overlay' });
    const box = el('div', { class: 'modal' });
    const head = el('div', { class: 'modal-head' }, [
      el('h3', { text: title }),
      el('button', { class: 'x', text: '✕', onclick: close })
    ]);
    box.appendChild(head);
    const body = el('div', { class: 'modal-body' });
    body.appendChild(contentNode);
    box.appendChild(body);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay && opts.dismiss !== false) close(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    function close() {
      overlay.classList.remove('show');
      setTimeout(function () { overlay.remove(); }, 200);
      if (opts.onClose) opts.onClose();
    }
    return { close: close, body: body, overlay: overlay };
  }

  // reveal animation for a newly obtained creature
  function reveal(item, headline) {
    const sp = G.state.getSpecies(item.sid);
    const r = G.data.rarity(sp.tier);
    function build() {
      const node = el('div', { class: 'reveal r' + sp.tier });
      node.style.setProperty('--rcolor', r.color);
      node.appendChild(el('div', { class: 'reveal-head', text: headline || 'You got…' }));
      const big = el('div', { class: 'reveal-sprite' });
      big.appendChild(G.sprites.el(sp, 140));
      node.appendChild(big);
      node.appendChild(el('div', { class: 'reveal-name', text: (item.shiny ? '✨ Shiny ' : '') + sp.name }));
      node.appendChild(el('div', { class: 'reveal-rarity', text: r.name + ' • ⛁ ' + fmt(G.state.valueOf(item)) }));
      if (G.fx) G.fx.celebrate(sp.tier);
      return modal('', node);
    }
    // rarer pulls get a suspenseful build-up first
    if (G.fx && sp.tier >= 2) { G.fx.suspense(sp.tier, build); return null; }
    return build();
  }

  G.ui = { $: $, $$: $$, el: el, fmt: fmt, toast: toast, card: card, modal: modal, reveal: reveal, haptic: haptic };
})(window.G = window.G || {});
