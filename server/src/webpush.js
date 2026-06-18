/* Minimal Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) using only WebCrypto,
 * so it runs in Cloudflare Workers (and Node) with no dependencies. */

export function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (s.length % 4)) % 4;
  const bin = atob(s + '='.repeat(pad));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64url(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat() {
  let len = 0;
  for (let i = 0; i < arguments.length; i++) len += arguments[i].length;
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < arguments.length; i++) { out.set(arguments[i], o); o += arguments[i].length; }
  return out;
}
const te = (s) => new TextEncoder().encode(s);

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: info }, key, len * 8);
  return new Uint8Array(bits);
}

// Encrypt a payload for a push subscription's keys (p256dh, auth are base64url).
// Returns the aes128gcm body bytes to POST to the endpoint.
export async function encryptPayload(plaintext, p256dhB64, authB64) {
  const uaPublic = b64urlToBytes(p256dhB64);   // 65 bytes (0x04 || X || Y)
  const authSecret = b64urlToBytes(authB64);    // 16 bytes

  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey)); // 65 bytes
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  // IKM = HKDF(auth, ecdh, "WebPush: info\0" || ua_pub || as_pub)
  const keyInfo = concat(te('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te('Content-Encoding: nonce\0'), 12);

  // single record: plaintext || 0x02 (padding delimiter, no extra padding)
  const record = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  // header: salt(16) | rs(4, big-endian) | idlen(1)=65 | keyid(as_pub, 65)
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, ct);
}

async function importVapidKey(pubB64, privB64) {
  const pub = b64urlToBytes(pubB64); // 65 bytes
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: bytesToB64url(b64urlToBytes(privB64))
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// Build the VAPID Authorization header value for a given endpoint.
export async function vapidAuth(endpoint, subject, pubB64, privB64, nowSec) {
  const aud = new URL(endpoint).origin;
  const now = nowSec != null ? nowSec : Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: aud, exp: now + 12 * 3600, sub: subject };
  const signingInput = bytesToB64url(te(JSON.stringify(header))) + '.' + bytesToB64url(te(JSON.stringify(payload)));
  const key = await importVapidKey(pubB64, privB64);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te(signingInput));
  const jwt = signingInput + '.' + bytesToB64url(sig);
  return { authorization: 'vapid t=' + jwt + ', k=' + pubB64, jwt: jwt };
}

// Send a push message. Returns the fetch Response.
export async function sendPush(subscription, payloadObj, env) {
  const body = await encryptPayload(te(JSON.stringify(payloadObj)), subscription.keys.p256dh, subscription.keys.auth);
  const { authorization } = await vapidAuth(subscription.endpoint, env.VAPID_SUBJECT, env.VAPID_PUBLIC, env.VAPID_PRIVATE);
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'TTL': '86400',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Authorization': authorization
    },
    body: body
  });
}
