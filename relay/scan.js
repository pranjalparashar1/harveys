// POST /scan (1.61.0): the free kitchen scan behind relay/worker.js. Photos or video keyframes
// in, {have, other, model, ms} out, from Gemini flash-lite with the GEMINI_API_KEY secret.
// Kept apart from worker.js because Cloudflare treats every export of the Worker's entry file
// as an entry point, and these constants and helpers are exported for the tests.

import { scanKitchen, AIError } from '../src/ai/providers.js';
import { FOODS, EQUIPMENT, ASSUMED_BASICS } from '../src/brain/vocabulary.js';

const DAY = 864e5;

// ── /scan ────────────────────────────────────────────────────────────────────
/** Gemini flash-lite only (pranjal's rule): 3.1 first, 3.5 when it is busy or silent. */
export const SCAN_MODELS = Object.freeze(['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
if (!SCAN_MODELS.every((m) => /^gemini-[\d.]+-flash-lite$/.test(m))) throw new Error('flash-lite only');
export const SCAN_MAX_IMAGES = 8;
export const SCAN_MAX_BYTES = 2_500_000;
export const SCAN_PER_IP = 3; // per rolling 24 h
export const SCAN_DAILY_CAP = 400; // every IP together, per day
/**
 * Failsafe (pranjal, 26 Nov): every scan sent to Gemini in a calendar month (UTC), failed ones
 * included. Reaching it switches the free scan OFF and it stays off, even next month, until
 * pranjal resets it by hand (relay/README.md → "Failsafe"). ~1,500 scans is a few dollars at
 * flash-lite prices even with every hedged copy counted.
 */
export const SCAN_MONTHLY_CAP = 1500;
const MONTH_TTL = 40 * 864e2; // seconds: a month's count outlives its month
const LATCH_TTL = 10 * 365 * 864e2; // seconds: a latch never runs out on its own
const SCAN_DEADLINE_MS = 11000; // the app gives up at 15 s; iOS Safari kills requests near 60 s
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A /scan body → { ok, images } or { ok: false, status, error }. Pure, so it's tested in node. */
export function checkScan(text) {
  if (typeof text !== 'string' || !text.length) return { ok: false, status: 400, error: 'empty' };
  if (text.length > SCAN_MAX_BYTES) return { ok: false, status: 413, error: 'too big' };
  let body;
  try { body = JSON.parse(text); } catch { return { ok: false, status: 400, error: 'not JSON' }; }
  const images = body?.images;
  if (!Array.isArray(images) || !images.length) return { ok: false, status: 400, error: 'no images' };
  if (images.length > SCAN_MAX_IMAGES) return { ok: false, status: 400, error: `at most ${SCAN_MAX_IMAGES} images` };
  const clean = [];
  for (const img of images) {
    if (img?.mediaType !== 'image/jpeg') return { ok: false, status: 415, error: 'JPEG only' };
    const data = img.base64;
    // "/9j/" is the base64 of a JPEG's first bytes (FF D8 FF): the label has to match the bytes.
    if (typeof data !== 'string' || data.length < 100 || !data.startsWith('/9j/') || data.length % 4 || !B64.test(data)) return { ok: false, status: 415, error: 'not a JPEG' };
    clean.push({ base64: data, mediaType: 'image/jpeg' });
  }
  return { ok: true, images: clean };
}

/** Scan items → the compact reply, ids checked against the vocabulary. Pure. */
export function scanReply(items) {
  const known = (id) => FOODS[id] || EQUIPMENT[id] || ASSUMED_BASICS[id];
  const have = [...new Set(items.map((i) => i.canonical).filter((id) => typeof id === 'string' && known(id)))];
  const other = [...new Set(items.filter((i) => !i.canonical || !known(i.canonical)).map((i) => String(i.name ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80)).filter(Boolean))].slice(0, 40);
  return { have, other };
}

/**
 * Scan counts. On Cloudflare they live in one Durable Object (ScanQuota, below): global and
 * one-request-at-a-time, so 3 a day means 3 everywhere, even for requests sent all at once.
 * (The Cache API does nothing on a workers.dev address, and memory is per Worker copy.)
 * Without the binding (tests, `wrangler dev`) they live in memory.
 * IPs are kept only as salted SHA-256 hashes, never as addresses.
 */
export function memoryStore() {
  const m = new Map();
  return {
    async get(k) { const v = m.get(k); return v && v.until > Date.now() ? v.value : null; },
    async put(k, value, ttl) { if (m.size > 20000) m.clear(); m.set(k, { value, until: Date.now() + ttl * 1000 }); },
    async prune() { const now = Date.now(); for (const [k, v] of m) if (v.until <= now) m.delete(k); },
  };
}

export async function hashIp(ip, salt = '') {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`harveys-scan|${salt}|${ip}`));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The off switch. A latch holds the reset token that was current when it tripped; it lifts only
 * when SCAN_RESET is changed to something else by hand. Nothing else clears it: not a new day,
 * not a new month, not a redeploy, not a cold start (it lives in the Durable Object).
 */
export async function latchScan(store, reason, { resetToken = '', now = Date.now() } = {}) {
  const was = await store.get('latch');
  if (was && was.token === resetToken) return was;
  const latch = { reason: String(reason).slice(0, 120), at: new Date(now).toISOString(), token: resetToken };
  await store.put('latch', latch, LATCH_TTL);
  return latch;
}
/** The latch in force, or null. A latch from an older reset token is cleared here. */
export async function scanLatch(store, { resetToken = '' } = {}) {
  const latch = await store.get('latch');
  if (!latch) return null;
  if (latch.token === resetToken) return latch;
  await store.put('latch', null, 60);
  return null;
}
const monthKey = (now, resetToken) => `month:${new Date(now).toISOString().slice(0, 7)}:${resetToken}`;
/** Scans sent this month since the last reset. */
export async function monthCount(store, { resetToken = '', now = Date.now() } = {}) {
  return Number(await store.get(monthKey(now, resetToken))) || 0;
}

/**
 * Takes one scan from this (hashed) IP's allowance, or says when the next one frees up.
 * @returns {Promise<{ok: true, slot: {key: string, day: string, at: number}} | {ok: false, retryAfter?: number, scope: 'ip'|'all'|'off', reason?: string}>}
 */
export async function takeScan(store, ipHash, { perIp = SCAN_PER_IP, dailyCap = SCAN_DAILY_CAP, monthlyCap = SCAN_MONTHLY_CAP, resetToken = '', now = Date.now() } = {}) {
  const latch = await scanLatch(store, { resetToken });
  if (latch) return { ok: false, scope: 'off', reason: latch.reason };
  const month = monthKey(now, resetToken);
  const used = Number(await store.get(month)) || 0;
  if (used >= monthlyCap) {
    const l = await latchScan(store, `monthly cap of ${monthlyCap} scans reached`, { resetToken, now });
    return { ok: false, scope: 'off', reason: l.reason };
  }
  const key = `ip:${ipHash}`;
  const day = `all:${new Date(now).toISOString().slice(0, 10)}`;
  const mine = ((await store.get(key)) ?? []).filter((t) => now - t < DAY);
  if (mine.length >= perIp) return { ok: false, scope: 'ip', retryAfter: Math.max(60, Math.ceil((mine[0] + DAY - now) / 1000)) };
  const all = Number(await store.get(day)) || 0;
  if (all >= dailyCap) return { ok: false, scope: 'all', retryAfter: Math.max(60, Math.ceil((DAY - (now % DAY)) / 1000)) };
  mine.push(now);
  await store.put(key, mine, DAY / 1000);
  await store.put(day, all + 1, DAY / 1000);
  // Counted for the month at once and never refunded: a failed scan may still have cost something.
  await store.put(month, used + 1, MONTH_TTL);
  return { ok: true, slot: { key, day, at: now } };
}

/**
 * Gemini answers that mean "money or quota is gone" switch the free scan off until a manual
 * reset. Read from Gemini's raw reply, before the app's client trims it. Pure.
 *   • 429 RESOURCE_EXHAUSTED: a daily or billing quota latches. A per-minute limit alone doesn't
 *     (a burst of friends at once), since it clears itself within a minute.
 *   • 403: key refused, API disabled or billing off.
 *   • 400 that names the key or billing (a 400 for a speed setting is retried, not latched).
 */
export function latchReason(status, body = '') {
  const b = String(body);
  if (status === 429) {
    if (/PerMinute|per minute/i.test(b) && !/PerDay|per day|billing account|credit|prepay/i.test(b)) return null;
    return 'Gemini quota or billing limit (429)';
  }
  if (status === 403) return 'Gemini refused the key or billing (403)';
  if (status === 400 && /API_KEY_INVALID|API key not valid|API key expired|billing|FAILED_PRECONDITION/i.test(b)) return 'Gemini key or billing problem (400)';
  return null;
}

/**
 * Gemini's error, reduced to codes that are safe to send to the phone and show in Debug:
 * the HTTP status, Google's status word and the ErrorInfo reason, e.g.
 * { http: 400, status: 'INVALID_ARGUMENT', reason: 'API_KEY_INVALID' }. Never the message
 * text, which can quote the request. Pure.
 */
export function geminiCode(http, body = '') {
  const word = (v) => (typeof v === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(v) ? v : null);
  let err = null;
  try { err = JSON.parse(String(body))?.error ?? null; } catch { /* not JSON */ }
  const reason = Array.isArray(err?.details) ? err.details.map((d) => word(d?.reason)).find(Boolean) ?? null : null;
  return { http: Number(http) || 0, status: word(err?.status), reason };
}

/** A scan that failed upstream (Gemini busy, nothing read) gives its slot back. */
export async function refundScan(store, { key, day, at }) {
  const mine = (await store.get(key)) ?? [];
  const i = mine.indexOf(at);
  if (i < 0) return;
  mine.splice(i, 1);
  await store.put(key, mine, DAY / 1000);
  await store.put(day, Math.max(0, (Number(await store.get(day)) || 1) - 1), DAY / 1000);
}

/** The Durable Object that holds the counts (bound as SCAN_QUOTA in wrangler.toml). */
export class ScanQuota {
  constructor(state) {
    this.state = state;
    const st = state.storage;
    this.store = {
      async get(k) { const v = await st.get(k); return v && v.until > Date.now() ? v.value : null; },
      async put(k, value, ttl) { await st.put(k, { value, until: Date.now() + ttl * 1000 }); },
    };
  }
  async fetch(request) {
    const { op, ipHash, slot, perIp, dailyCap, monthlyCap, resetToken, reason } = await request.json();
    // Once a day, forget everything that has run out, so storage never grows.
    if (!(await this.state.storage.getAlarm?.())) await this.state.storage.setAlarm?.(Date.now() + DAY);
    if (op === 'take') return Response.json(await takeScan(this.store, ipHash, { perIp, dailyCap, monthlyCap, resetToken }));
    if (op === 'refund') { await refundScan(this.store, slot); return Response.json({ ok: true }); }
    if (op === 'latch') return Response.json(await latchScan(this.store, reason, { resetToken }));
    if (op === 'status') return Response.json({ latch: await scanLatch(this.store, { resetToken }), month: await monthCount(this.store, { resetToken }) });
    return Response.json({ ok: false }, { status: 400 });
  }
  async alarm() {
    const now = Date.now();
    const all = await this.state.storage.list();
    const gone = [...all].filter(([, v]) => !v || v.until <= now).map(([k]) => k);
    for (let i = 0; i < gone.length; i += 128) await this.state.storage.delete(gone.slice(i, i + 128));
    await this.state.storage.setAlarm(now + DAY);
  }
}

const memoryQuota = memoryStore();
/** One interface over the Durable Object or memory. */
export function quotaFor(env, deps = {}) {
  const resetToken = String(env.SCAN_RESET ?? '');
  if (env.SCAN_QUOTA && !deps.store) {
    const stub = env.SCAN_QUOTA.get(env.SCAN_QUOTA.idFromName('scan-quota'));
    const call = async (body) => (await stub.fetch('https://quota/', { method: 'POST', body: JSON.stringify({ resetToken, ...body }) })).json();
    return {
      take: (ipHash, o) => call({ op: 'take', ipHash, ...o }),
      refund: (slot) => call({ op: 'refund', slot }),
      latch: (reason) => call({ op: 'latch', reason }),
      status: () => call({ op: 'status' }),
    };
  }
  const store = deps.store ?? memoryQuota;
  return {
    take: (h, o) => takeScan(store, h, { resetToken, ...o }),
    refund: (slot) => refundScan(store, slot),
    latch: (reason) => latchScan(store, reason, { resetToken }),
    status: async () => ({ latch: await scanLatch(store, { resetToken }), month: await monthCount(store, { resetToken }) }),
  };
}

const LIMIT_MESSAGE = {
  ip: `That's today's ${SCAN_PER_IP} free scans from this connection.`,
  all: "Today's free scans have run out.",
};

export async function handleScan(request, env, reply, deps) {
  if (!env.GEMINI_API_KEY) return reply(503, { ok: false, error: 'scan off' });
  if (Number(request.headers.get('Content-Length') ?? 0) > SCAN_MAX_BYTES) return reply(413, { ok: false, error: 'too big' });
  const check = checkScan(await request.text());
  if (!check.ok) return reply(check.status, { ok: false, error: check.error });

  const quota = quotaFor(env, deps);
  const ipHash = await hashIp(request.headers.get('CF-Connecting-IP') ?? 'unknown', env.SCAN_SALT ?? '');
  const got = await quota.take(ipHash, {
    perIp: Number(env.SCAN_PER_IP) || SCAN_PER_IP,
    dailyCap: Number(env.SCAN_DAILY_CAP) || SCAN_DAILY_CAP,
    monthlyCap: Number(env.SCAN_MONTHLY_CAP) || SCAN_MONTHLY_CAP,
    ...(deps.now ? { now: deps.now() } : {}),
  });
  if (!got.ok && got.scope === 'off') return reply(503, { ok: false, error: 'scan off', off: got.reason ?? null });
  if (!got.ok) return reply(429, { ok: false, error: 'limit', scope: got.scope, retryAfter: got.retryAfter, message: LIMIT_MESSAGE[got.scope] }, { 'Retry-After': String(got.retryAfter) });

  // Every Gemini reply is looked at for "quota or billing gone" before anything else reads it.
  // The last Gemini error's codes go back with a failure, so Debug shows the real cause.
  let trip = null;
  let gemini = null;
  const f = deps.fetch ?? fetch;
  const watched = async (url, init) => {
    const res = await f(url, init);
    if (!res.ok) {
      const body = await (res.clone?.() ?? res).text?.().catch(() => '') ?? '';
      gemini = geminiCode(res.status, body);
      if ([400, 403, 429].includes(res.status)) trip ??= latchReason(res.status, body);
    }
    return res;
  };
  const t0 = Date.now();
  try {
    const items = await scanKitchen({
      provider: 'gemini',
      apiKey: env.GEMINI_API_KEY,
      model: SCAN_MODELS[0],
      models: SCAN_MODELS,
      images: check.images,
      deadlineMs: SCAN_DEADLINE_MS,
      copies: 2, // [3.1, 3.1, 3.5, 3.5]: a busy or silent 3.1 hands over within 5 s
      resolution: 'medium',
      fetchImpl: watched,
    });
    if (trip) await quota.latch(trip).catch(() => {}); // this scan got through; the next ones won't
    return reply(200, { ok: true, ...scanReply(items), model: items.model, ms: Date.now() - t0, photosRead: items.photosRead, photosTotal: items.photosTotal });
  } catch (e) {
    await quota.refund(got.slot).catch(() => {});
    if (trip) {
      await quota.latch(trip).catch(() => {});
      return reply(503, { ok: false, error: 'scan off', off: trip, gemini });
    }
    // The kind and Gemini's codes go back, never Gemini's text, which could quote the request.
    const kind = e instanceof AIError ? e.kind : 'error';
    const status = kind === 'timeout' ? 504 : kind === 'invalidKey' ? 503 : 502;
    return reply(status, { ok: false, error: kind === 'invalidKey' ? 'scan off' : kind, gemini });
  }
}

