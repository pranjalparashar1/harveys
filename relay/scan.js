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
export const SCAN_DAILY_CAP = 400; // every IP together, per day: a ceiling on the bill
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
 * Takes one scan from this (hashed) IP's allowance, or says when the next one frees up.
 * @returns {Promise<{ok: true, slot: {key: string, day: string, at: number}} | {ok: false, retryAfter: number, scope: 'ip'|'all'}>}
 */
export async function takeScan(store, ipHash, { perIp = SCAN_PER_IP, dailyCap = SCAN_DAILY_CAP, now = Date.now() } = {}) {
  const key = `ip:${ipHash}`;
  const day = `all:${new Date(now).toISOString().slice(0, 10)}`;
  const mine = ((await store.get(key)) ?? []).filter((t) => now - t < DAY);
  if (mine.length >= perIp) return { ok: false, scope: 'ip', retryAfter: Math.max(60, Math.ceil((mine[0] + DAY - now) / 1000)) };
  const all = Number(await store.get(day)) || 0;
  if (all >= dailyCap) return { ok: false, scope: 'all', retryAfter: Math.max(60, Math.ceil((DAY - (now % DAY)) / 1000)) };
  mine.push(now);
  await store.put(key, mine, DAY / 1000);
  await store.put(day, all + 1, DAY / 1000);
  return { ok: true, slot: { key, day, at: now } };
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
    const { op, ipHash, slot, perIp, dailyCap } = await request.json();
    // Once a day, forget everything that has run out, so storage never grows.
    if (!(await this.state.storage.getAlarm?.())) await this.state.storage.setAlarm?.(Date.now() + DAY);
    if (op === 'take') return Response.json(await takeScan(this.store, ipHash, { perIp, dailyCap }));
    if (op === 'refund') { await refundScan(this.store, slot); return Response.json({ ok: true }); }
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
function quotaFor(env, deps) {
  if (deps.store) return { take: (h, o) => takeScan(deps.store, h, o), refund: (slot) => refundScan(deps.store, slot) };
  if (env.SCAN_QUOTA) {
    const stub = env.SCAN_QUOTA.get(env.SCAN_QUOTA.idFromName('scan-quota'));
    const call = async (body) => (await stub.fetch('https://quota/', { method: 'POST', body: JSON.stringify(body) })).json();
    return { take: (ipHash, o) => call({ op: 'take', ipHash, ...o }), refund: (slot) => call({ op: 'refund', slot }) };
  }
  return { take: (h, o) => takeScan(memoryQuota, h, o), refund: (slot) => refundScan(memoryQuota, slot) };
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
    ...(deps.now ? { now: deps.now() } : {}),
  });
  if (!got.ok) return reply(429, { ok: false, error: 'limit', scope: got.scope, retryAfter: got.retryAfter, message: LIMIT_MESSAGE[got.scope] }, { 'Retry-After': String(got.retryAfter) });

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
      fetchImpl: deps.fetch ?? fetch,
    });
    return reply(200, { ok: true, ...scanReply(items), model: items.model, ms: Date.now() - t0, photosRead: items.photosRead, photosTotal: items.photosTotal });
  } catch (e) {
    await quota.refund(got.slot).catch(() => {});
    // Only the kind goes back: Gemini's own error text could carry request details.
    const kind = e instanceof AIError ? e.kind : 'error';
    const status = kind === 'timeout' ? 504 : kind === 'invalidKey' ? 503 : 502;
    return reply(status, { ok: false, error: kind === 'invalidKey' ? 'scan off' : kind });
  }
}

