// Harvey's send relay (1.33.0): a Cloudflare Worker that holds the GitHub token, so a tester's
// Send is one tap from any phone with nothing to set up. The app POSTs one taste-test result;
// the Worker checks it and commits it to data/kitchen-tests/ on main, exactly where
// `node scripts/kitchen-tests.mjs score` reads from. Setup steps: relay/README.md.
//
// Abuse limits: browser origin must be the app's; body ≤ 200 KB; must be a harveys-rung-quiz/1
// result with sane ids and date; the file name is built here, never taken from the request;
// files are create-only (nobody can overwrite anyone's result); ~20 sends per IP per 10 min.
// The token never leaves Cloudflare. To switch sending off, delete the GITHUB_TOKEN secret.

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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = ORIGINS.includes(origin) || LOCAL.test(origin);
    const cors = { 'Access-Control-Allow-Origin': allowed ? origin : ORIGINS[0], 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET') return reply(200, { ok: true, relay: 'harveys', ready: !!env.GITHUB_TOKEN });
    if (request.method !== 'POST') return reply(405, { ok: false, error: 'POST only' });
    if (!allowed) return reply(403, { ok: false, error: 'origin' });
    if (!env.GITHUB_TOKEN) return reply(503, { ok: false, error: 'relay off' });
    if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BYTES) return reply(413, { ok: false, error: 'too big' });
    if (limited(request.headers.get('CF-Connecting-IP') ?? 'unknown')) return reply(429, { ok: false, error: 'slow down' });

    const check = checkResult(await request.text());
    if (!check.ok) return reply(400, check);

    const url = `https://api.github.com/repos/${env.REPO || REPO}/contents/${check.path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, {
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
