/* Client side of push notifications: subscribe/unsubscribe and report a daily
 * reminder hour + timezone to the push backend. Works once PUSH_BASE is set to
 * the deployed Cloudflare Worker URL. */
(function (G) {
  'use strict';

  // Public VAPID key — must match server/wrangler.toml VAPID_PUBLIC.
  const VAPID_PUBLIC_KEY = 'BIib9JSjizYPUcIlyTTCIKNXUT20TSgGEMG4VMMZqCIW_JvrdPYFw-rlKIK7ZAv1DrGnlLfnsTT8eUG-PI_dpRg';
  // Set this to your Worker URL after deploying (see server/SETUP.md). No trailing slash.
  const PUSH_BASE = 'https://critter-casino-push.sam-kouse.workers.dev';

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function configured() { return !!PUSH_BASE; }
  function permission() { return supported() ? Notification.permission : 'unsupported'; }

  // iOS only delivers web push to installed PWAs
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function u8(b64) {
    const s = b64.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function getHour() { const h = parseInt(localStorage.getItem('cc.remHour'), 10); return isNaN(h) ? 19 : h; }
  function setHour(h) { localStorage.setItem('cc.remHour', String(h)); }
  function localDay() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  async function currentSub() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  async function isEnabled() {
    if (!supported()) return false;
    try { return permission() === 'granted' && !!(await currentSub()); } catch (e) { return false; }
  }

  async function postSub(sub) {
    if (!configured()) return;
    await fetch(PUSH_BASE + '/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        hour: getHour(),
        tz: -new Date().getTimezoneOffset(), // minutes east of UTC
        active: localDay(),
        lastFed: (G.state && G.state.get().lastFed) || 0 // for feed reminders
      })
    });
  }

  async function enable(hour) {
    if (!supported()) throw new Error('unsupported');
    if (!configured()) throw new Error('unconfigured');
    if (typeof hour === 'number') setHour(hour);
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('denied');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(VAPID_PUBLIC_KEY) });
    await postSub(sub);
    return true;
  }

  async function disable() {
    try {
      const sub = await currentSub();
      if (sub) {
        if (configured()) {
          await fetch(PUSH_BASE + '/unsubscribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint })
          }).catch(function () {});
        }
        await sub.unsubscribe();
      }
    } catch (e) {}
  }

  // Ask the server to send a test push to this device right now.
  async function sendTest() {
    if (!configured()) throw new Error('unconfigured');
    const sub = await currentSub();
    if (!sub) throw new Error('not subscribed');
    const r = await fetch(PUSH_BASE + '/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
    return r.ok;
  }

  // Called on launch: refresh the server's record (updates last-active day +
  // reminder hour) so today's reminder is suppressed.
  async function heartbeat() {
    if (!configured()) return;
    try { if (await isEnabled()) { const sub = await currentSub(); if (sub) await postSub(sub); } } catch (e) {}
  }

  G.push = {
    supported: supported, configured: configured, permission: permission,
    isStandalone: isStandalone, isIOS: isIOS,
    isEnabled: isEnabled, enable: enable, disable: disable, heartbeat: heartbeat,
    sendTest: sendTest, getHour: getHour, setHour: setHour,
    base: function () { return PUSH_BASE; } // shared Worker URL (also used by the trade board)
  };
})(window.G = window.G || {});
