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
function rowListing(r) {
  return { id: r.id, owner: { id: r.owner_id, name: r.owner_name }, give: JSON.parse(r.give), want: r.want || '', status: r.status, created: r.created };
}
function rowOffer(r) {
  return { offerId: r.offer_id, listingId: r.listing_id, bidder: { id: r.bidder_id, name: r.bidder_name }, give: JSON.parse(r.give),
    status: r.status, payout: r.payout ? JSON.parse(r.payout) : null, collected: !!r.collected, created: r.created };
}

// Marketplace trade board. One DO instance ("board") serializes everything, so
// it's strongly consistent + atomic. Players POST listings; others make OFFERS
// (their creatures escrowed); the owner ACCEPTs one (gets that bidder's
// creatures; the winner & rejected bidders collect via their offers) or DECLINEs.
export class TradeBoard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec('CREATE TABLE IF NOT EXISTS listings (id TEXT PRIMARY KEY, owner_id TEXT, owner_name TEXT, give TEXT, want TEXT, status TEXT, created INTEGER)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS offers (offer_id TEXT PRIMARY KEY, listing_id TEXT, bidder_id TEXT, bidder_name TEXT, give TEXT, status TEXT, payout TEXT, collected INTEGER, created INTEGER)');
    });
  }
  _listing(id) { return this.sql.exec('SELECT * FROM listings WHERE id=?', String(id || '')).toArray()[0]; }
  _offer(id) { return this.sql.exec('SELECT * FROM offers WHERE offer_id=?', String(id || '')).toArray()[0]; }

  post(owner, give, want) {
    const g = cleanTokens(give); if (!g || !g.length) return { error: 'nothing to give' };
    const o = person(owner); if (!o.id) return { error: 'no owner' };
    const n = this.sql.exec("SELECT COUNT(*) c FROM listings WHERE owner_id=? AND status='open'", o.id).one().c;
    if (n >= 20) return { error: 'too many listings' };
    const id = tid();
    this.sql.exec('INSERT INTO listings (id,owner_id,owner_name,give,want,status,created) VALUES (?,?,?,?,?,?,?)',
      id, o.id, o.name, JSON.stringify(g), String(want || '').slice(0, 80), 'open', Date.now());
    return { ok: true, id: id };
  }
  list() {
    const rows = this.sql.exec("SELECT * FROM listings WHERE status='open' ORDER BY created DESC LIMIT 60").toArray();
    const out = [];
    for (const r of rows) {
      const t = rowListing(r);
      t.offerCount = this.sql.exec("SELECT COUNT(*) c FROM offers WHERE listing_id=? AND status='pending'", r.id).one().c;
      out.push(t);
    }
    return { ok: true, trades: out };
  }
  offer(listingId, bidder, give) {
    const L = this._listing(listingId);
    if (!L || L.status !== 'open') return { error: 'listing unavailable' };
    const b = person(bidder); if (!b.id) return { error: 'no bidder' };
    if (b.id === L.owner_id) return { error: 'own listing' };
    const g = cleanTokens(give); if (!g || !g.length) return { error: 'nothing offered' };
    const n = this.sql.exec("SELECT COUNT(*) c FROM offers WHERE bidder_id=? AND status='pending'", b.id).one().c;
    if (n >= 30) return { error: 'too many pending offers' };
    const oid = tid();
    this.sql.exec('INSERT INTO offers (offer_id,listing_id,bidder_id,bidder_name,give,status,payout,collected,created) VALUES (?,?,?,?,?,?,?,?,?)',
      oid, L.id, b.id, b.name, JSON.stringify(g), 'pending', null, 0, Date.now());
    return { ok: true, offerId: oid };
  }
  myListings(ownerId) {
    const rows = this.sql.exec("SELECT * FROM listings WHERE owner_id=? AND status='open' ORDER BY created DESC", String(ownerId || '')).toArray();
    const out = [];
    for (const r of rows) {
      const t = rowListing(r);
      t.offers = this.sql.exec("SELECT * FROM offers WHERE listing_id=? AND status='pending' ORDER BY created", r.id).toArray().map(rowOffer);
      out.push(t);
    }
    return { ok: true, listings: out };
  }
  myOffers(bidderId) {
    const rows = this.sql.exec('SELECT * FROM offers WHERE bidder_id=? ORDER BY created DESC', String(bidderId || '')).toArray();
    const out = [];
    for (const r of rows) {
      const o = rowOffer(r);
      const L = this._listing(r.listing_id);
      o.listing = L ? { give: JSON.parse(L.give), owner: L.owner_name, want: L.want || '' } : null;
      out.push(o);
    }
    return { ok: true, offers: out };
  }
  accept(listingId, ownerId, offerId) {
    const L = this._listing(listingId);
    if (!L || L.owner_id !== String(ownerId || '')) return { error: 'not owner' };
    if (L.status !== 'open') return { error: 'closed' };
    const O = this.sql.exec('SELECT * FROM offers WHERE offer_id=? AND listing_id=?', String(offerId || ''), L.id).toArray()[0];
    if (!O || O.status !== 'pending') return { error: 'offer gone' };
    this.sql.exec("UPDATE offers SET status='accepted', payout=? WHERE offer_id=?", L.give, O.offer_id); // winner collects the listing
    this.sql.exec("UPDATE offers SET status='declined', payout=give WHERE listing_id=? AND status='pending'", L.id); // others refunded
    this.sql.exec("UPDATE listings SET status='completed' WHERE id=?", L.id);
    return { ok: true, ownerGets: JSON.parse(O.give) }; // owner receives the accepted bidder's creatures now
  }
  decline(listingId, ownerId, offerId) {
    const L = this._listing(listingId);
    if (!L || L.owner_id !== String(ownerId || '')) return { error: 'not owner' };
    const O = this.sql.exec('SELECT * FROM offers WHERE offer_id=? AND listing_id=?', String(offerId || ''), L.id).toArray()[0];
    if (!O || O.status !== 'pending') return { error: 'offer gone' };
    this.sql.exec("UPDATE offers SET status='declined', payout=give WHERE offer_id=?", O.offer_id);
    return { ok: true };
  }
  cancel(listingId, ownerId) {
    const L = this._listing(listingId);
    if (!L || L.owner_id !== String(ownerId || '')) return { error: 'not owner' };
    if (L.status !== 'open') return { error: 'closed' };
    this.sql.exec("UPDATE offers SET status='declined', payout=give WHERE listing_id=? AND status='pending'", L.id);
    this.sql.exec("UPDATE listings SET status='cancelled' WHERE id=?", L.id);
    return { ok: true, give: JSON.parse(L.give) };
  }
  withdraw(offerId, bidderId) {
    const O = this._offer(offerId);
    if (!O || O.bidder_id !== String(bidderId || '')) return { error: 'not yours' };
    if (O.status !== 'pending') return { error: 'cannot withdraw' };
    this.sql.exec('DELETE FROM offers WHERE offer_id=?', O.offer_id);
    return { ok: true, give: JSON.parse(O.give) };
  }
  collect(offerId, bidderId) {
    const O = this._offer(offerId);
    if (!O || O.bidder_id !== String(bidderId || '')) return { error: 'not yours' };
    if ((O.status !== 'accepted' && O.status !== 'declined') || O.collected || !O.payout) return { ok: true, give: [] };
    this.sql.exec('DELETE FROM offers WHERE offer_id=?', O.offer_id);
    return { ok: true, give: JSON.parse(O.payout), won: O.status === 'accepted' };
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
      const bd = board(env);
      switch (url.pathname.slice('/trade/'.length)) {
        case 'post': return json(await bd.post(b.owner, b.give, b.want));
        case 'offer': return json(await bd.offer(b.listingId, b.bidder, b.give));
        case 'accept': return json(await bd.accept(b.listingId, b.ownerId, b.offerId));
        case 'decline': return json(await bd.decline(b.listingId, b.ownerId, b.offerId));
        case 'cancel': return json(await bd.cancel(b.listingId, b.ownerId));
        case 'withdraw': return json(await bd.withdraw(b.offerId, b.bidderId));
        case 'collect': return json(await bd.collect(b.offerId, b.bidderId));
        case 'mine-listings': return json(await bd.myListings(b.ownerId));
        case 'mine-offers': return json(await bd.myOffers(b.bidderId));
      }
      return json({ error: 'bad op' }, 400);
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
