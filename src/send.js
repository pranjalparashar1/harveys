// One-tap send (1.32.0): a taste test goes straight into the repo as a new file in
// data/kitchen-tests/, through GitHub's contents API, with a token saved once on this phone.
//
// Set up once: open the app with #send=<token> (a fine-grained token for this repo only,
// Contents: read and write), or paste it on the last screen. It lives in this browser's
// localStorage and nowhere else. Then every Send is one tap, for every tester on the phone.
//
// No signal? The file waits in an outbox on the phone and goes on the next send, the next
// open, or when the phone comes back online. One file per run, so sends never collide.

export const REPO = 'pranjalparashar1/harveys';
export const DIR = 'data/kitchen-tests';
const TOKEN_KEY = 'harveys.gh.v1';
const OUTBOX_KEY = 'harveys.outbox.v1';
const API = `https://api.github.com/repos/${REPO}`;

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export const getToken = () => read(TOKEN_KEY, null);
export const hasToken = () => !!getToken();
export const forgetToken = () => write(TOKEN_KEY, null);
export const outbox = () => read(OUTBOX_KEY, []);

/** #send=<token> in the address saves the token and takes it out of the address bar. */
export function captureToken(loc = globalThis.location, hist = globalThis.history) {
  const m = /(?:^#|&)send=([^&]+)/.exec(loc?.hash ?? '');
  if (!m) return false;
  write(TOKEN_KEY, decodeURIComponent(m[1]).trim());
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

/** Sends everything waiting in the outbox. → { sent, left, auth } */
export async function flush() {
  const token = getToken();
  let box = outbox();
  if (!token || !box.length) return { sent: 0, left: box.length, auth: !token };
  let sent = 0;
  let auth = false;
  for (const item of [...box]) {
    let r;
    try { r = await put(item, token); } catch { r = 'retry'; }
    if (r === 'sent') { sent++; box = box.filter((x) => x.path !== item.path); write(OUTBOX_KEY, box); }
    if (r === 'auth') { auth = true; break; }
    if (r === 'retry') break;
  }
  return { sent, left: box.length, auth };
}

/** Queues one result and tries to send. → 'sent' | 'queued' (no signal) | 'auth' (no or bad token) */
export async function sendResult(res) {
  const item = { path: pathFor(res), message: `Taste test: ${res.kitchen?.kitchen ?? res.kitchenId} (${res.testerId})`, content: JSON.stringify(res, null, 1) + '\n' };
  write(OUTBOX_KEY, [...outbox().filter((x) => x.path !== item.path), item]);
  const { left, auth } = await flush();
  if (!outbox().some((x) => x.path === item.path)) return 'sent';
  return auth ? 'auth' : left ? 'queued' : 'sent';
}

if (typeof window !== 'undefined') {
  captureToken();
  flush();
  window.addEventListener('online', () => { flush(); });
}
