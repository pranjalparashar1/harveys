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

import { randomId } from './brain/log.js';

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

// One flush at a time (1.35.0). The page flushes on open, every 30 s, when it comes back
// online and on Send; two at once each wrote back their own stale copy of the outbox, so a
// result queued mid-flush could be wiped and then reported "Sent" without ever leaving.
let chain = Promise.resolve();
const drop = (paths) => write(OUTBOX_KEY, outbox().filter((x) => !paths.includes(x.path)));

/** Sends everything waiting in the outbox. → { sent, left, auth, rejected } */
export function flush() {
  // A flush asked for while one runs goes right after it, so it sees anything just queued.
  const p = chain.then(flushOnce, flushOnce);
  chain = p.catch(() => {});
  return p;
}

async function flushOnce() {
  const token = getToken();
  const relay = relayUrl();
  const box = outbox();
  if ((!token && !relay) || !box.length) return { sent: 0, left: box.length, auth: !token && !relay, rejected: 0 };
  let sent = 0;
  let auth = false;
  const refused = [];
  for (const item of box) {
    let r = 'retry';
    if (relay) { try { r = await post(item, relay); } catch { r = 'retry'; } }
    // The relay is down or refused it, and this phone has a token: go straight to GitHub.
    if (r !== 'sent' && token) { try { r = await put(item, token); } catch { r = 'retry'; } }
    if (r === 'rejected') refused.push(item);
    // Always re-read before writing: something may have been queued while this one was on the way.
    if (r === 'sent') { sent++; drop([item.path]); }
    if (r === 'auth' && !relay) { auth = true; break; }
    if (r === 'retry') break;
  }
  // A refused file stays out of the way of the rest: kept on the phone, never retried.
  if (refused.length) {
    write('harveys.rejected.v1', [...read('harveys.rejected.v1', []), ...refused].slice(-20));
    drop(refused.map((x) => x.path));
  }
  return { sent, left: outbox().length, auth, rejected: refused.length };
}

/** Queues one result and tries to send. → 'sent' | 'queued' (no signal) | 'auth' (no way to send) | 'failed' (refused) */
export async function sendResult(res) {
  const item = { path: pathFor(res), message: `Taste test: ${res.kitchen?.kitchen ?? res.kitchenId} (${res.testerId})`, content: JSON.stringify(res, null, 1) + '\n' };
  write(OUTBOX_KEY, [...outbox().filter((x) => x.path !== item.path), item]);
  const { auth, rejected } = await flush();
  if (!outbox().some((x) => x.path === item.path)) return rejected && read('harveys.rejected.v1', []).some((x) => x.path === item.path) ? 'failed' : 'sent';
  // 1.48.0: a blip (a lift, a weak bar) usually clears in seconds; don't wait 30 s to retry.
  if (!auth) for (const ms of [3e3, 10e3]) setTimeout(() => { if (outbox().length) flush(); }, ms);
  return auth ? 'auth' : 'queued';
}

/**
 * 1.48.0: the page is going away (tab closed, app switched, phone locked) with results still
 * waiting. The end screen already said "Saved. Thank you", so most testers close it there and
 * never come back, and the outbox only retried while the page was open. A beacon is the one
 * request a browser keeps sending after the page is gone. It can't report back, so the item
 * stays in the outbox: if it did land, the next flush gets "already there" from the relay and
 * drops it. → how many beacons went out.
 */
export function beaconOutbox(nav = globalThis.navigator) {
  const url = relayUrl();
  if (!url || typeof nav?.sendBeacon !== 'function') return 0;
  let n = 0;
  let bytes = 0;
  for (const item of outbox()) {
    bytes += item.content.length;
    if (bytes > 60_000) break; // browsers cap what beacons may carry at once (64 KB)
    try { if (nav.sendBeacon(url, item.content)) n++; } catch { /* no beacon */ }
  }
  return n;
}

// ── 1.64.0: the live log ("Cooked this", "Fix / Veto") ───────────────────────
// Every event is saved on the phone first (marco.cookLog, marco.liveRepairs), then queued
// here and sent in the background to the relay's POST /log, which commits it to
// data/cook-logs/. Its own outbox and its own one-at-a-time chain, so it never touches the
// taste test's. Only the relay sends these (no token path): no relay, they just wait.
// The only id is a random deviceId made on this phone; no names, no keys, no user agent.

const DEVICE_KEY = 'harveys.deviceId';
const LIVE_KEY = 'harveys.liveOutbox.v1';
const LIVE_MAX = 300;

/** This phone's anonymous id: 10 random letters and digits, made once. */
export function deviceId() {
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch { /* private mode */ }
  if (id && /^[a-z0-9]{6,16}$/.test(id)) return id;
  id = randomId(10);
  try { localStorage.setItem(DEVICE_KEY, id); } catch { /* private mode: a new id each visit */ }
  return id;
}
export const newEventId = () => randomId(12);
export const liveOutbox = () => read(LIVE_KEY, []);
export const liveLogUrl = () => { const r = relayUrl(); return r ? `${r.replace(/\/+$/, '')}/log` : null; };

/** Queues one encoded live event (src/brain/log.js encodeLiveEvent) and sends it in the background. */
export function queueLiveEvent(payload) {
  write(LIVE_KEY, [...liveOutbox().filter((x) => x.eventId !== payload.eventId), payload].slice(-LIVE_MAX));
  const p = flushLiveOutbox();
  // A blip usually clears in seconds; the 30 s timer and 'online' cover the rest.
  p.then(({ left }) => { if (left) for (const ms of [3e3, 10e3]) setTimeout(() => { if (liveOutbox().length) flushLiveOutbox(); }, ms); }, () => {});
  return p;
}

let liveChain = Promise.resolve();
const dropLive = (ids) => write(LIVE_KEY, liveOutbox().filter((x) => !ids.includes(x.eventId)));

/** Sends everything in the live outbox, one flush at a time. → { sent, left, rejected } */
export function flushLiveOutbox() {
  const p = liveChain.then(flushLiveOnce, flushLiveOnce);
  liveChain = p.catch(() => {});
  return p;
}

async function flushLiveOnce() {
  const url = liveLogUrl();
  const box = liveOutbox();
  if (!url || !box.length) return { sent: 0, left: box.length, rejected: 0 };
  let sent = 0;
  let rejected = 0;
  for (const item of box) {
    let res;
    try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(item), keepalive: true }); } catch { break; }
    if (res.ok) { sent++; dropLive([item.eventId]); continue; }
    // Refused for good (bad shape, too big): drop it so it never blocks the rest. Still on the phone in marco.*.
    if (res.status === 400 || res.status === 413) { rejected++; dropLive([item.eventId]); continue; }
    break; // 429, 5xx, relay off: try again later
  }
  return { sent, left: liveOutbox().length, rejected };
}

/** The page is going away with live events waiting: beacon them (a resend lands as a duplicate, which is fine). */
export function beaconLiveOutbox(nav = globalThis.navigator) {
  const url = liveLogUrl();
  if (!url || typeof nav?.sendBeacon !== 'function') return 0;
  let n = 0;
  let bytes = 0;
  for (const item of liveOutbox()) {
    const body = JSON.stringify(item);
    bytes += body.length;
    if (bytes > 60_000) break;
    try { if (nav.sendBeacon(url, body)) n++; } catch { /* no beacon */ }
  }
  return n;
}

if (typeof window !== 'undefined') {
  captureToken();
  flush();
  flushLiveOutbox();
  window.addEventListener('online', () => { flush(); flushLiveOutbox(); });
  addEventListener('pagehide', () => { beaconOutbox(); beaconLiveOutbox(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { beaconOutbox(); beaconLiveOutbox(); } });
  // A friend may never open the page again: keep trying while it's open.
  setInterval(() => {
    if (navigator.onLine === false) return;
    if (outbox().length) flush();
    if (liveOutbox().length) flushLiveOutbox();
  }, 30e3);
}
