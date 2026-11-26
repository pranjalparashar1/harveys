// Harvey's send relay (1.33.0): a Cloudflare Worker that holds the GitHub token, so a tester's
// Send is one tap from any phone with nothing to set up. The app POSTs one taste-test result;
// the Worker checks it and commits it to data/kitchen-tests/ on main, exactly where
// `node scripts/kitchen-tests.mjs score` reads from. Setup steps: relay/README.md.
//
// Abuse limits: browser origin must be the app's; body ≤ 200 KB; must be a harveys-rung-quiz/1
// result with sane ids and date; the file name is built here, never taken from the request;
// files are create-only (nobody can overwrite anyone's result); ~20 sends per IP per 10 min.
// The token never leaves Cloudflare. To switch sending off, delete the GITHUB_TOKEN secret.
//
// 1.61.0, free kitchen scan: POST /scan takes up to 8 compressed JPEG photos (or video
// keyframes, cut on the phone) and answers {have, other, model, ms} from Gemini flash-lite,
// so a new user needs no API key. The Gemini key is the GEMINI_API_KEY secret: never sent
// back, never logged. Limits: the app's origin only; 1–8 JPEGs, ≤ 2.5 MB in all; 3 scans per
// IP per 24 h (only a scan that read something counts) and a daily ceiling for the whole
// Worker. To switch scanning off, delete the GEMINI_API_KEY secret.
//
// Deployed with wrangler (relay/wrangler.toml) because /scan shares the app's own prompt and
// Gemini client (src/ai/), so the dashboard copy-paste of 1.33.0 no longer works.
//
// 1.64.0, live cook log: POST /log takes one "Cooked this" (harveys-cook-log/1) or one
// "Fix / Veto" (harveys-live-repair/1) and commits it as a new file in data/cook-logs/, where
// `node scripts/refit-cooklog.mjs` pools them. Same rules as the taste test: the app's origin
// only, create-only files named here, the token never leaves Cloudflare. Limits: ≤ 16 KB, a
// strict schema (unknown keys dropped), 30 events per IP per 24 h on a counter of its own, so
// dinners never eat into a tester's sends. The only id is a random deviceId made on the phone.

import { handleScan, ScanQuota, quotaFor } from './scan.js';

// The scan counter's Durable Object class (wrangler.toml binds it as SCAN_QUOTA). Cloudflare
// treats every export of this file as an entry point, so constants live in scan.js, not here.
export { ScanQuota };

const REPO = 'pranjalparashar1/harveys';
const DIR = 'data/kitchen-tests';
const MAX_BYTES = 200_000;
const ORIGINS = ['https://pranjalparashar1.github.io'];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const DAY = 864e5;

const LOG_DIR = 'data/cook-logs';
const LOG_MAX_BYTES = 16_384;
const LOG_KINDS = { 'harveys-cook-log/1': 'cook', 'harveys-live-repair/1': 'repair' };
const TIER = ['veto', 'floor', 'pass', 'crave'];
const DISH = /^[\w.:~+-]{1,120}$/; // catalogue ids, template variants (base~swap, base+addon), ai_0_slug
const isTier = (t) => TIER.includes(t);
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Only the keys refit and the repair summary read are kept; everything else is dropped.
const shownPick = (l) => ({ rung: num(l?.rung), pickId: str(l?.pickId, 120), tier: isTier(l?.tier) ? l.tier : null, payoff: num(l?.payoff), friction: num(l?.friction) });
const shownAlt = (a) => ({ id: str(a?.id, 120), tier: isTier(a?.tier) ? a.tier : null, payoff: num(a?.payoff), friction: num(a?.friction) });
// Plain JSON only, bounded: short strings, short arrays, shallow objects with word-like keys.
function plain(v, depth = 3) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return str(v, 80);
  if (depth <= 0) return null;
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => plain(x, depth - 1));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => /^[\w-]{1,40}$/.test(k)).slice(0, 24).map(([k, x]) => [k, plain(x, depth - 1)]));
  return null;
}

/** One live event's text → { ok, path, message, content } or { ok: false, error }. Pure, so it's tested in node. */
export function checkLog(text, now = Date.now()) {
  if (typeof text !== 'string' || !text.length) return { ok: false, error: 'empty' };
  if (new TextEncoder().encode(text).length > LOG_MAX_BYTES) return { ok: false, error: 'too big' };
  let r;
  try { r = JSON.parse(text); } catch { return { ok: false, error: 'not JSON' }; }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, error: 'not an event' };
  const kind = LOG_KINDS[r.format];
  if (!kind) return { ok: false, error: 'wrong format' };
  if (!/^[a-z0-9-]{8,32}$/.test(String(r.eventId ?? '')) || !/^[a-z0-9]{6,16}$/.test(String(r.deviceId ?? ''))) return { ok: false, error: 'bad ids' };
  const at = Date.parse(r.at);
  if (typeof r.at !== 'string' || !Number.isFinite(at) || at > now + DAY || at < now - 90 * DAY) return { ok: false, error: 'bad date' };
  const e = r.entry;
  if (!e || typeof e !== 'object' || Array.isArray(e) || !DISH.test(String(e.dishId ?? ''))) return { ok: false, error: 'bad entry' };
  let entry;
  if (kind === 'cook') {
    const rung = e.rung == null ? null : Number(e.rung);
    if (rung !== null && !(Number.isInteger(rung) && rung >= 1 && rung <= 4)) return { ok: false, error: 'bad rung' };
    if (!isTier(e.tier) || !Array.isArray(e.ladderShown) || !Array.isArray(e.alternativesShown)) return { ok: false, error: 'bad entry' };
    entry = { dishId: e.dishId, rung, tier: e.tier, ladderShown: e.ladderShown.slice(0, 8).map(shownPick), alternativesShown: e.alternativesShown.slice(0, 40).map(shownAlt), context: e.context && typeof e.context === 'object' && !Array.isArray(e.context) ? plain(e.context) : {}, at: r.at };
  } else {
    if (!isTier(e.yours) || typeof (e.fix ?? '') !== 'string' || String(e.fix ?? '').length > 200) return { ok: false, error: 'bad entry' };
    entry = {
      dishId: e.dishId, name: str(e.name, 120), form: e.form == null ? null : str(e.form, 60),
      parts: Array.isArray(e.parts) ? plain(e.parts) : null,
      modifiers: Array.isArray(e.modifiers) ? e.modifiers.slice(0, 40).filter((x) => typeof x === 'string').map((x) => str(x, 80)) : [],
      chain: e.chain && typeof e.chain === 'object' ? plain(e.chain) : null,
      pierre: isTier(e.pierre) ? e.pierre : null, yours: e.yours, fix: str(e.fix, 200).trim(), at: r.at,
    };
  }
  const date = new Date(at).toISOString().slice(0, 10);
  const clean = { format: r.format, version: str(r.version, 20), deviceId: r.deviceId, eventId: r.eventId, at: r.at, entry };
  return {
    ok: true,
    path: `${LOG_DIR}/${kind}-${date}-${r.deviceId}-${r.eventId}.json`,
    message: `${kind === 'cook' ? 'Cooked' : 'Fix / Veto'}: ${entry.dishId} (${r.deviceId})`,
    content: JSON.stringify(clean, null, 1) + '\n',
  };
}

/** A result's text → { ok, path, message, content } or { ok: false, error }. Pure, so it's tested in node. */
export function checkResult(text, now = Date.now()) {
  if (typeof text !== 'string' || !text.length) return { ok: false, error: 'empty' };
  if (new TextEncoder().encode(text).length > MAX_BYTES) return { ok: false, error: 'too big' };
  let r;
  try { r = JSON.parse(text); } catch { return { ok: false, error: 'not JSON' }; }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, error: 'not a result' };
  if (r.format !== 'harveys-rung-quiz/1') return { ok: false, error: 'wrong format' };
  if (!ID.test(String(r.kitchenId ?? '')) || !ID.test(String(r.testerId ?? ''))) return { ok: false, error: 'bad ids' };
  const at = Date.parse(r.at);
  if (!Number.isFinite(at) || at > now + DAY || at < now - 90 * DAY) return { ok: false, error: 'bad date' };
  if (!['marco', 'pierre', 'white'].every((k) => Array.isArray(r[k])) || typeof r.dishes !== 'object' || typeof r.kitchen !== 'object') return { ok: false, error: 'missing answers' };
  const date = new Date(at).toISOString().slice(0, 10);
  return {
    ok: true,
    path: `${DIR}/taste-${date}-${r.kitchenId}-${r.testerId}.json`,
    message: `Taste test: ${String(r.kitchen?.kitchen ?? r.kitchenId).slice(0, 60).replace(/[\r\n]/g, ' ')} (${r.testerId})`,
    content: JSON.stringify(r, null, 1) + '\n', // re-written, so only JSON ever lands in the repo
  };
}

const hits = new Map(); // ip → [times]; per Worker instance, a speed bump rather than a wall
function limited(ip, now = Date.now()) {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60e3);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 20;
}

const logHits = new Map(); // the live log's own counter: 30 per IP per 24 h
function logLimited(ip, now = Date.now()) {
  const recent = (logHits.get(ip) ?? []).filter((t) => now - t < DAY);
  if (recent.length >= 30) { logHits.set(ip, recent); return true; }
  recent.push(now);
  logHits.set(ip, recent);
  if (logHits.size > 5000) logHits.clear();
  return false;
}

const b64 = (s) => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };

/** One create-only commit (never a sha, so never an overwrite). */
function createFile(check, env, deps) {
  const url = `https://api.github.com/repos/${env.REPO || REPO}/contents/${check.path.split('/').map(encodeURIComponent).join('/')}`;
  return (deps.fetch ?? fetch)(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'harveys-relay' },
    body: JSON.stringify({ message: check.message, content: b64(check.content) }),
  });
}

/** POST /log: one live event → one new file in data/cook-logs/. */
async function handleLog(request, env, reply, deps) {
  if (!env.GITHUB_TOKEN) return reply(503, { ok: false, error: 'relay off' });
  if (Number(request.headers.get('Content-Length') ?? 0) > LOG_MAX_BYTES) return reply(413, { ok: false, error: 'too big' });
  if (logLimited(request.headers.get('CF-Connecting-IP') ?? 'unknown')) return reply(429, { ok: false, error: 'slow down' }, { 'Retry-After': '3600' });
  const check = checkLog(await request.text());
  if (!check.ok) return reply(check.error === 'too big' ? 413 : 400, check);
  const res = await createFile(check, env, deps);
  if (res.ok) return reply(200, { ok: true, path: check.path });
  // Already there: a resend of the same eventId (a beacon that did land, an answer lost on the way).
  if (res.status === 422) return reply(200, { ok: true, path: check.path, duplicate: true });
  return reply(502, { ok: false, error: `github ${res.status}` });
}

/** The Worker, with its outside world injectable for tests. */
export function makeWorker(deps = {}) {
  return {
    async fetch(request, env) {
      const origin = request.headers.get('Origin') ?? '';
      const allowed = ORIGINS.includes(origin) || LOCAL.test(origin);
      const cors = { 'Access-Control-Allow-Origin': allowed ? origin : ORIGINS[0], 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Expose-Headers': 'Retry-After', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
      const reply = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });
      const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method === 'GET') {
        // scan: true only with a key AND no failsafe latch. The app asks this before offering a free scan.
        let scan = !!env.GEMINI_API_KEY;
        let off = null;
        if (scan) {
          try { const st = await quotaFor(env, deps).status(); off = st.latch?.reason ?? null; scan = !off; } catch { /* count store unreachable: say on, /scan decides */ }
        }
        return reply(200, { ok: true, relay: 'harveys', ready: !!env.GITHUB_TOKEN, scan, log: true, ...(off ? { off } : {}) });
      }
      if (request.method !== 'POST') return reply(405, { ok: false, error: 'POST only' });
      if (!allowed) return reply(403, { ok: false, error: 'origin' });
      if (path === '/log') return handleLog(request, env, reply, deps);
      if (limited(request.headers.get('CF-Connecting-IP') ?? 'unknown')) return reply(429, { ok: false, error: 'slow down' });
      if (path === '/scan') return handleScan(request, env, reply, deps);

      // Everything else is a taste-test result, exactly as in 1.33.0.
      if (!env.GITHUB_TOKEN) return reply(503, { ok: false, error: 'relay off' });
      if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BYTES) return reply(413, { ok: false, error: 'too big' });

      const check = checkResult(await request.text());
      if (!check.ok) return reply(400, check);

      const res = await createFile(check, env, deps);
      if (res.ok) return reply(200, { ok: true, path: check.path });
      // Already there (a resend after a lost answer): it's in, and nobody overwrites a result.
      if (res.status === 422) return reply(200, { ok: true, path: check.path, existed: true });
      return reply(502, { ok: false, error: `github ${res.status}` });
    },
  };
}

export default makeWorker();
