/* Sound + visual effects for celebrating rare pulls.
 * SFX are synthesized with the Web Audio API (no audio files, works offline);
 * VFX is a canvas confetti + shockwave burst. Triggered for Rare (tier>=2)+. */
(function (G) {
  'use strict';

  const MUTE_KEY = 'cc.muted';
  function isMuted() { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; } }
  function setMuted(m) { try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (e) {} }
  function toggleMute() { setMuted(!isMuted()); return isMuted(); }

  // ---- audio ---------------------------------------------------------------
  let actx = null;
  function ctx() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    }
    if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
    return actx;
  }
  function tone(freq, start, dur, type, vol) {
    const c = ctx(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    o.connect(g); g.connect(c.destination);
    const t = c.currentTime + start;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.03);
  }

  // ascending arpeggio that grows with rarity, plus sparkles/boom for high tiers
  function sound(tier) {
    if (isMuted()) return;
    const c = ctx(); if (!c) return;
    const scale = [0, 4, 7, 12, 16, 19, 24, 28, 31, 36]; // major intervals (semitones)
    const root = 294; // ~D4
    const notes = Math.max(3, Math.min(3 + tier, scale.length));
    for (let i = 0; i < notes; i++) {
      const f = root * Math.pow(2, scale[i] / 12);
      tone(f, i * 0.075, 0.55, 'triangle', 0.17);
    }
    if (tier >= 4) {
      for (let i = 0; i < 7; i++) tone(1400 + Math.random() * 2000, 0.25 + i * 0.05, 0.28, 'sine', 0.07);
    }
    if (tier >= 6) {
      tone(70, 0, 0.9, 'sawtooth', 0.22);                 // sub boom
      tone(root * 4, notes * 0.075, 0.8, 'triangle', 0.16); // high shimmer chord top
    }
    if (tier >= 9) {
      // choir-like sustained swell for the rarest tiers
      [392, 494, 587, 784].forEach(function (f, i) { tone(f, 0.1, 1.6, 'sine', 0.06); });
    }
  }

  // ---- visuals -------------------------------------------------------------
  function fxColors(tier) {
    const r = G.data.rarity(tier);
    const base = [r.color, '#ffffff', '#ffd75e'];
    if (tier >= 4) base.push('#6c5cff', '#ff4d8d');
    if (tier >= 8) base.push('#5ad6ff', '#4dffb0');
    return base;
  }

  function burst(tier) {
    const W = window.innerWidth, H = window.innerHeight, dpr = window.devicePixelRatio || 1;
    const cv = document.createElement('canvas');
    cv.className = 'fx-canvas';
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.cssText = 'position:fixed;inset:0;z-index:300;pointer-events:none;';
    document.body.appendChild(cv);
    const x = cv.getContext('2d'); x.scale(dpr, dpr);
    const colors = fxColors(tier);
    const cx = W / 2, cy = H * 0.42;
    const N = 70 + tier * 22;
    const parts = [];
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * (8 + tier * 0.8);
      parts.push({
        x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4,
        g: 0.16 + Math.random() * 0.12, r: 3 + Math.random() * 4,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.5,
        c: colors[i % colors.length], life: 0, max: 55 + Math.random() * 45,
        shape: Math.random() < 0.5 ? 'rect' : 'circ'
      });
    }
    let ring = tier >= 4 ? { r: 0, max: Math.max(W, H) * 0.7 } : null;
    let frame = 0;
    function step() {
      frame++;
      x.clearRect(0, 0, W, H);
      if (ring) {
        const al = Math.max(0, 0.7 - ring.r / ring.max);
        x.strokeStyle = 'rgba(255,255,255,' + al + ')';
        x.lineWidth = 5; x.beginPath(); x.arc(cx, cy, ring.r, 0, 6.2832); x.stroke();
        ring.r += 16; if (ring.r > ring.max) ring = null;
      }
      let alive = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]; p.life++;
        if (p.life > p.max) continue;
        alive = true;
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr;
        x.save(); x.globalAlpha = Math.max(0, 1 - p.life / p.max);
        x.translate(p.x, p.y); x.rotate(p.rot); x.fillStyle = p.c;
        if (p.shape === 'rect') x.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        else { x.beginPath(); x.arc(0, 0, p.r, 0, 6.2832); x.fill(); }
        x.restore();
      }
      if ((alive || ring) && frame < 240) requestAnimationFrame(step);
      else cv.remove();
    }
    requestAnimationFrame(step);
  }

  // ---- public --------------------------------------------------------------
  // Celebrate getting a creature of the given rarity tier.
  function celebrate(tier) {
    if (tier == null) return;
    if (tier < 2) { if (!isMuted()) tone(523, 0, 0.16, 'sine', 0.08); return; } // soft pop for commons
    sound(tier);
    burst(tier);
  }

  function init() {
    // create/resume the audio context on the first user gesture so SFX are allowed
    const unlock = function () {
      ctx();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  G.fx = { celebrate: celebrate, sound: sound, burst: burst, init: init,
    isMuted: isMuted, toggleMute: toggleMute };
})(window.G = window.G || {});
