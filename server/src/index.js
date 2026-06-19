/* Critter Casino push backend (Cloudflare Worker).
 *  - POST /subscribe   { subscription, hour, tz, active }  -> store/update
 *  - POST /unsubscribe { endpoint }                        -> remove
 *  - GET  /            -> status
 *  - cron (hourly)     -> send each subscriber their daily reminder at their
 *                         chosen local hour, unless they already played today.
 * Subscriptions live in the SUBS KV namespace. No accounts, no game save —
 * just the push subscription + a reminder hour + timezone + last-active day. */
import { DurableObject } from 'cloudflare:workers';
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

// ---- trade board helpers ---------------------------------------------------
function tid() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
}
function cleanTokens(arr, max) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (let i = 0; i < arr.length && out.length < (max || 12); i++) {
    const n = parseInt(arr[i], 10);
    if (Number.isFinite(n) && n >= 0 && n < 100000) out.push(n);
  }
  return out;
}
function person(p) {
  p = p || {};
  return { id: String(p.id || '').slice(0, 40), name: String(p.name || 'Trainer').slice(0, 20) };
}
function rowToTrade(r) {
  return {
    id: r.id, owner: { id: r.owner_id, name: r.owner_name }, give: JSON.parse(r.give),
    want: r.want || '', status: r.status, created: r.created,
    claimer: r.claimer_id ? { id: r.claimer_id, name: r.claimer_name } : null,
    ownerGets: r.owner_gets ? JSON.parse(r.owner_gets) : null
  };
}

// Strongly-consistent, single-claim trade board. One DO instance ("board")
// serializes all operations, so posts are visible immediately and a trade can
// only be claimed once (no dup exploit, no KV list lag). Low traffic -> a single
// instance is fine here.
export class TradeBoard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec('CREATE TABLE IF NOT EXISTS trades (' +
        'id TEXT PRIMARY KEY, owner_id TEXT, owner_name TEXT, give TEXT, want TEXT, ' +
        'status TEXT, created INTEGER, claimer_id TEXT, claimer_name TEXT, owner_gets TEXT)');
    });
  }
  post(owner, give, want) {
    const g = cleanTokens(give); if (!g || !g.length) return { error: 'nothing to give' };
    const o = person(owner); if (!o.id) return { error: 'no owner' };
    const n = this.sql.exec("SELECT COUNT(*) c FROM trades WHERE owner_id=? AND status='open'", o.id).one().c;
    if (n >= 20) return { error: 'too many open trades' };
    const id = tid();
    this.sql.exec('INSERT INTO trades (id,owner_id,owner_name,give,want,status,created,claimer_id,claimer_name,owner_gets) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, o.id, o.name, JSON.stringify(g), String(want || '').slice(0, 80), 'open', Date.now(), null, null, null);
    return { ok: true, id: id };
  }
  list() {
    const rows = this.sql.exec("SELECT * FROM trades WHERE status='open' ORDER BY created DESC LIMIT 60").toArray();
    return { ok: true, trades: rows.map(rowToTrade) };
  }
  mine(ownerId) {
    const rows = this.sql.exec('SELECT * FROM trades WHERE owner_id=? ORDER BY created DESC', String(ownerId || '')).toArray();
    return { ok: true, trades: rows.map(rowToTrade) };
  }
  claim(id, claimer, back) {
    const row = this.sql.exec('SELECT * FROM trades WHERE id=?', String(id || '')).toArray()[0];
    if (!row) return { error: 'not found' };
    if (row.status !== 'open') return { error: 'unavailable' };
    const c = person(claimer);
    if (c.id && c.id === row.owner_id) return { error: 'own trade' };
    const b = cleanTokens(back) || [];
    if (b.length) this.sql.exec("UPDATE trades SET status='claimed', claimer_id=?, claimer_name=?, owner_gets=? WHERE id=?", c.id, c.name, JSON.stringify(b), row.id);
    else this.sql.exec('DELETE FROM trades WHERE id=?', row.id);
    return { ok: true, give: JSON.parse(row.give) };
  }
  collect(id, ownerId) {
    const row = this.sql.exec('SELECT * FROM trades WHERE id=?', String(id || '')).toArray()[0];
    if (!row || row.owner_id !== String(ownerId || '')) return { error: 'not owner' };
    if (row.status !== 'claimed' || !row.owner_gets) return { ok: true, give: [] };
    this.sql.exec('DELETE FROM trades WHERE id=?', row.id);
    return { ok: true, give: JSON.parse(row.owner_gets) };
  }
  cancel(id, ownerId) {
    const row = this.sql.exec('SELECT * FROM trades WHERE id=?', String(id || '')).toArray()[0];
    if (!row || row.owner_id !== String(ownerId || '')) return { error: 'not owner' };
    if (row.status !== 'open') return { error: 'cannot cancel' };
    this.sql.exec('DELETE FROM trades WHERE id=?', row.id);
    return { ok: true, give: JSON.parse(row.give) };
  }
}
function board(env) { return env.TRADE.get(env.TRADE.idFromName('board')); }

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

    // ---- trade board (Durable Object: strongly consistent + atomic) ---------
    if (url.pathname === '/trade/list' && request.method === 'GET') {
      return json(await board(env).list());
    }
    if (request.method === 'POST' && url.pathname.indexOf('/trade/') === 0) {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const op = url.pathname.slice('/trade/'.length);
      const bd = board(env);
      if (op === 'post') return json(await bd.post(b.owner, b.give, b.want));
      if (op === 'claim') return json(await bd.claim(b.id, b.claimer, b.give));
      if (op === 'cancel') return json(await bd.cancel(b.id, b.ownerId));
      if (op === 'collect') return json(await bd.collect(b.id, b.ownerId));
      return json({ error: 'bad op' }, 400);
    }
    if (request.method === 'POST' && url.pathname === '/trade-mine') {
      let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      return json(await board(env).mine(b && b.ownerId));
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

        // pick the most urgent applicable reminder. The first "hungry" alert of
        // a feed cycle is sent IMMEDIATELY (once) the moment they hit 24h —
        // bypassing the throttle — so it arrives as soon as they become hungry.
        let msg = null, gapH = 0, immediate = false;
        if (hrsFed != null && hrsFed >= 60) {
          msg = { title: 'Critter Casino ⚠️', body: 'Your critters are STARVING and may start dying! Feed them now. 🐾' };
          gapH = 6;
        } else if (hrsFed != null && hrsFed >= 24 && s.hungryNotified !== s.lastFed) {
          msg = { title: 'Critter Casino 🍖', body: 'Your critters just got hungry (earning only 25%) — feed them to restore full income!' };
          immediate = true;
        } else if (hrsFed != null && hrsFed >= 24) {
          msg = { title: 'Critter Casino 🍖', body: 'Your critters are still hungry — feed them to restore full income!' };
          gapH = 12;
        } else if (localHour === s.hour && s.active !== localDay) {
          msg = { title: 'Critter Casino 🎲', body: 'Daily rewards & ranch coins are waiting. 🐾' };
          gapH = 20;
        }
        if (!msg) continue;
        if (!immediate && since < gapH * 3600000) continue;

        try {
          const res = await sendPush(s, { title: msg.title, body: msg.body, url: './' }, env);
          if (res.status === 404 || res.status === 410) {
            await env.SUBS.delete(entry.name); // subscription gone
          } else {
            if (immediate) s.hungryNotified = s.lastFed; // mark this hunger cycle as alerted
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
