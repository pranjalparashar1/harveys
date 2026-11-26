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

import { handleScan, ScanQuota } from './scan.js';

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

const b64 = (s) => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };

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
      if (request.method === 'GET') return reply(200, { ok: true, relay: 'harveys', ready: !!env.GITHUB_TOKEN, scan: !!env.GEMINI_API_KEY });
      if (request.method !== 'POST') return reply(405, { ok: false, error: 'POST only' });
      if (!allowed) return reply(403, { ok: false, error: 'origin' });
      if (limited(request.headers.get('CF-Connecting-IP') ?? 'unknown')) return reply(429, { ok: false, error: 'slow down' });
      if (path === '/scan') return handleScan(request, env, reply, deps);

      // Everything else is a taste-test result, exactly as in 1.33.0.
      if (!env.GITHUB_TOKEN) return reply(503, { ok: false, error: 'relay off' });
      if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BYTES) return reply(413, { ok: false, error: 'too big' });

      const check = checkResult(await request.text());
      if (!check.ok) return reply(400, check);

      const url = `https://api.github.com/repos/${env.REPO || REPO}/contents/${check.path.split('/').map(encodeURIComponent).join('/')}`;
      const res = await (deps.fetch ?? fetch)(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'harveys-relay' },
        body: JSON.stringify({ message: check.message, content: b64(check.content) }),
      });
      if (res.ok) return reply(200, { ok: true, path: check.path });
      // Already there (a resend after a lost answer): it's in, and nobody overwrites a result.
      if (res.status === 422) return reply(200, { ok: true, path: check.path, existed: true });
      return reply(502, { ok: false, error: `github ${res.status}` });
    },
  };
}

export default makeWorker();
