/* Critter Casino push backend (Cloudflare Worker).
 *  - POST /subscribe   { subscription, hour, tz, active }  -> store/update
 *  - POST /unsubscribe { endpoint }                        -> remove
 *  - GET  /            -> status
 *  - cron (hourly)     -> send each subscriber their daily reminder at their
 *                         chosen local hour, unless they already played today.
 * Subscriptions live in the SUBS KV namespace. No accounts, no game save —
 * just the push subscription + a reminder hour + timezone + last-active day. */
import { sendPush } from './webpush.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (obj, status) => new Response(JSON.stringify(obj), {
  status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
});

async function keyFor(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  const b = new Uint8Array(digest);
  let hex = ''; for (let i = 0; i < 16; i++) hex += b[i].toString(16).padStart(2, '0');
  return 'sub:' + hex;
}
function localDayStr(tzMin) {
  const d = new Date(Date.now() + (tzMin || 0) * 60000);
  return d.toISOString().slice(0, 10);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('Critter Casino push server is running.', { headers: CORS });
    }

    if (request.method === 'POST' && url.pathname === '/subscribe') {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const sub = b && b.subscription;
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
        return json({ error: 'invalid subscription' }, 400);
      }
      const k = await keyFor(sub.endpoint);
      const existing = await env.SUBS.get(k);
      const rec = existing ? JSON.parse(existing) : { created: Date.now() };
      rec.endpoint = sub.endpoint;
      rec.keys = sub.keys;
      rec.hour = Math.max(0, Math.min(23, parseInt(b.hour, 10) || 19));
      rec.tz = (typeof b.tz === 'number') ? b.tz : 0;
      rec.active = b.active || localDayStr(rec.tz); // last day the player was active
      if (typeof b.lastFed === 'number' && b.lastFed > 0) rec.lastFed = b.lastFed; // for feed reminders
      await env.SUBS.put(k, JSON.stringify(rec));
      return json({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/test') {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const sub = b && b.subscription;
      if (!sub || !sub.endpoint || !sub.keys) return json({ error: 'invalid subscription' }, 400);
      try {
        const res = await sendPush(sub, {
          title: 'Critter Casino 🎲',
          body: 'Test notification — reminders are working! 🐾',
          url: './'
        }, env);
        return json({ ok: res.status >= 200 && res.status < 300, status: res.status });
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
      }
    }

    if (request.method === 'POST' && url.pathname === '/unsubscribe') {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      if (b && b.endpoint) await env.SUBS.delete(await keyFor(b.endpoint));
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    let cursor;
    do {
      const list = await env.SUBS.list({ prefix: 'sub:', cursor });
      cursor = list.list_complete ? null : list.cursor;
      for (const entry of list.keys) {
        const raw = await env.SUBS.get(entry.name);
        if (!raw) continue;
        const s = JSON.parse(raw);
        const now = Date.now();
        const local = new Date(now + (s.tz || 0) * 60000);
        const localHour = local.getUTCHours();
        const localDay = local.toISOString().slice(0, 10);
        const since = (typeof s.lastReminder === 'number') ? (now - s.lastReminder) : Infinity;
        const hrsFed = s.lastFed ? (now - s.lastFed) / 3600000 : null;

        // pick the most urgent applicable reminder + how long to wait between sends
        let msg = null, gapH = 0;
        if (hrsFed != null && hrsFed >= 60) {
          msg = { title: 'Critter Casino ⚠️', body: 'Your critters are STARVING and may start dying! Feed them now. 🐾' };
          gapH = 6;
        } else if (hrsFed != null && hrsFed >= 23) {
          msg = { title: 'Critter Casino 🍖', body: 'Your critters are hungry (earning only 25%) — feed them to restore full income!' };
          gapH = 12;
        } else if (localHour === s.hour && s.active !== localDay) {
          msg = { title: 'Critter Casino 🎲', body: 'Daily rewards & ranch coins are waiting. 🐾' };
          gapH = 20;
        }
        if (!msg || since < gapH * 3600000) continue;

        try {
          const res = await sendPush(s, { title: msg.title, body: msg.body, url: './' }, env);
          if (res.status === 404 || res.status === 410) {
            await env.SUBS.delete(entry.name); // subscription gone
          } else {
            s.lastReminder = now;
            await env.SUBS.put(entry.name, JSON.stringify(s));
          }
        } catch (e) {
          // leave the record; try again next run
        }
      }
    } while (cursor);
  }
};
