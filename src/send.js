// One-tap send: a taste test goes straight into the repo as a new file in data/kitchen-tests/.
//
// 1.33.0, any phone: Send posts the result to the relay (relay/worker.js, a Cloudflare Worker
// that holds the GitHub token), so a friend on their own phone taps once and it's in. No
// token, no account, no download.
// 1.32.0, fallback: a token saved on this phone (#send=<token>, a fine-grained token for this
// repo only, Contents: read and write) commits through GitHub's contents API directly. Used
// when no relay is set, or the relay is down and this phone has a token.
//
// No signal? The file waits in an outbox on the phone and goes on the next send, the next
// open, every 30 s while the page is open, or when the phone comes back online.
// One file per run, so sends never collide.

export const REPO = 'pranjalparashar1/harveys';
export const DIR = 'data/kitchen-tests';
/** The relay's address (relay/README.md). #relay=<url> overrides it on one phone, for testing. */
export const RELAY_URL = 'https://harveys-send.pranjalparashar1.workers.dev/';
const TOKEN_KEY = 'harveys.gh.v1';
const RELAY_KEY = 'harveys.relay.v1';
const OUTBOX_KEY = 'harveys.outbox.v1';
const API = `https://api.github.com/repos/${REPO}`;

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export const getToken = () => read(TOKEN_KEY, null);
export const hasToken = () => !!getToken();
export const forgetToken = () => write(TOKEN_KEY, null);
export const outbox = () => read(OUTBOX_KEY, []);
export const relayUrl = () => { const v = read(RELAY_KEY, null); return v === 'off' ? null : v || RELAY_URL || null; };
/** Can this phone send without asking anyone for anything? */
export const canSend = () => !!(relayUrl() || getToken());

/** #send=<token> saves the token, #relay=<url> (or #relay=off) the relay; both leave the address bar. */
export function captureToken(loc = globalThis.location, hist = globalThis.history) {
  const hash = loc?.hash ?? '';
  const t = /(?:^#|&)send=([^&]+)/.exec(hash);
  const r = /(?:^#|&)relay=([^&]+)/.exec(hash);
  if (!t && !r) return false;
  if (t) write(TOKEN_KEY, decodeURIComponent(t[1]).trim());
  if (r) { const v = decodeURIComponent(r[1]).trim(); write(RELAY_KEY, v); }
  try { hist?.replaceState(null, '', loc.pathname + loc.search); } catch { /* old browser */ }
  return true;
}

const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });

/** Saves `token` if it can write to the repo. → 'ok' | 'bad' | 'offline' */
export async function setToken(token) {
  const t = String(token ?? '').trim();
  if (!t) return 'bad';
  try {
    const res = await fetch(API, { headers: headers(t) });
    if (!res.ok) return 'bad';
    const repo = await res.json();
    if (repo.permissions && !repo.permissions.push) return 'bad';
  } catch { write(TOKEN_KEY, t); return 'offline'; }
  write(TOKEN_KEY, t);
  return 'ok';
}

const b64 = (s) => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };

/** The repo path for one result: date, kitchen and the run's own tester id, so never a clash. */
export const pathFor = (res) => `${DIR}/taste-${String(res.at ?? new Date().toISOString()).slice(0, 10)}-${res.kitchenId}-${res.testerId}.json`;

async function put(item, token) {
  const url = `${API}/contents/${item.path.split('/').map(encodeURIComponent).join('/')}`;
  const body = JSON.stringify({ message: item.message, content: b64(item.content) });
  let res = await fetch(url, { method: 'PUT', headers: headers(token), body });
  // Sent before (e.g. the answer was lost on the way back): overwrite with the newest copy.
  if (res.status === 422) {
    const cur = await fetch(url, { headers: headers(token) });
    if (cur.ok) res = await fetch(url, { method: 'PUT', headers: headers(token), body: JSON.stringify({ ...JSON.parse(body), sha: (await cur.json()).sha }) });
  }
  if (res.ok) return 'sent';
  if ([401, 403, 404].includes(res.status)) return 'auth';
  return 'retry';
}

/** Through the relay: 'sent' | 'retry' (no signal, busy, down) | 'rejected' (the relay refused this file). */
async function post(item, url) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: item.content });
  if (res.ok) return 'sent';
  if (res.status === 400 || res.status === 413) return 'rejected';
  return 'retry';
}

/** Sends everything waiting in the outbox. → { sent, left, auth, rejected } */
export async function flush() {
  const token = getToken();
  const relay = relayUrl();
  let box = outbox();
  if ((!token && !relay) || !box.length) return { sent: 0, left: box.length, auth: !token && !relay, rejected: 0 };
  let sent = 0;
  let auth = false;
  let rejected = 0;
  for (const item of [...box]) {
    let r = 'retry';
    if (relay) { try { r = await post(item, relay); } catch { r = 'retry'; } }
    // The relay is down or refused it, and this phone has a token: go straight to GitHub.
    if (r !== 'sent' && token) { try { r = await put(item, token); } catch { r = 'retry'; } }
    else if (r === 'rejected') { rejected++; item.rejected = true; }
    if (r === 'sent') { sent++; box = box.filter((x) => x.path !== item.path); write(OUTBOX_KEY, box); }
    if (r === 'auth' && !relay) { auth = true; break; }
    if (r === 'retry') break;
  }
  // A refused file stays out of the way of the rest: kept on the phone, never retried.
  if (rejected) { write('harveys.rejected.v1', [...read('harveys.rejected.v1', []), ...box.filter((x) => x.rejected)].slice(-20)); box = box.filter((x) => !x.rejected); write(OUTBOX_KEY, box); }
  return { sent, left: box.length, auth, rejected };
}

/** Queues one result and tries to send. → 'sent' | 'queued' (no signal) | 'auth' (no way to send) | 'failed' (refused) */
export async function sendResult(res) {
  const item = { path: pathFor(res), message: `Taste test: ${res.kitchen?.kitchen ?? res.kitchenId} (${res.testerId})`, content: JSON.stringify(res, null, 1) + '\n' };
  write(OUTBOX_KEY, [...outbox().filter((x) => x.path !== item.path), item]);
  const { auth, rejected } = await flush();
  if (!outbox().some((x) => x.path === item.path)) return rejected && read('harveys.rejected.v1', []).some((x) => x.path === item.path) ? 'failed' : 'sent';
  return auth ? 'auth' : 'queued';
}

if (typeof window !== 'undefined') {
  captureToken();
  flush();
  window.addEventListener('online', () => { flush(); });
  // A friend may never open the page again: keep trying while it's open.
  setInterval(() => { if (outbox().length && navigator.onLine !== false) flush(); }, 30e3);
}
