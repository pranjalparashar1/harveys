// 1.61.0: the free kitchen scan. POST /scan on the relay, video keyframes, and the app's client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker } from '../relay/worker.js';
import { checkScan, scanReply, takeScan, refundScan, memoryStore, hashIp, SCAN_MODELS, SCAN_MAX_BYTES, SCAN_MONTHLY_CAP, ScanQuota, latchReason } from '../relay/scan.js';
import { parseInventory, scanViaRelay, scanUrl, AIError } from '../src/ai/providers.js';
import { keyframeTimes, isVideo } from '../src/ai/images.js';

const ORIGIN = 'https://pranjalparashar1.github.io';
const JPEG = '/9j/' + 'A'.repeat(396); // 400 chars of base64 that start like a JPEG
const img = (base64 = JPEG, mediaType = 'image/jpeg') => ({ base64, mediaType });
const body = (n = 2) => JSON.stringify({ images: Array.from({ length: n }, () => img()) });
const geminiOk = (have = ['eggs', 'paneer', 'air_fryer'], other = ['kasuri methi']) => ({
  ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ have, other }) }] } }] }),
});

function harness({ env = { GEMINI_API_KEY: 'AIza-secret-key' }, gemini = async () => geminiOk(), now } = {}) {
  const calls = [];
  const store = memoryStore();
  const worker = makeWorker({
    store,
    now,
    fetch: async (url, init) => { calls.push({ url, init }); return gemini(url, init); },
  });
  const post = (b = body(), { origin = ORIGIN, ip = '1.2.3.4', path = '/scan', headers = {} } = {}) => worker.fetch(new Request(`https://relay.example${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain', 'CF-Connecting-IP': ip, ...headers }, body: b }), env);
  return { worker, post, calls, store, env };
}

test('scan: checkScan accepts 1–8 JPEGs and refuses everything else', () => {
  assert.equal(checkScan(body(1)).ok, true);
  assert.equal(checkScan(body(8)).images.length, 8);
  assert.deepEqual(Object.keys(checkScan(JSON.stringify({ images: [{ ...img(), name: 'x', extra: 1 }] })).images[0]).sort(), ['base64', 'mediaType'], 'only what Gemini needs is kept');
  assert.equal(checkScan(body(9)).status, 400);
  assert.equal(checkScan(JSON.stringify({ images: [] })).status, 400);
  assert.equal(checkScan('{"images": "lots"}').status, 400);
  assert.equal(checkScan('not json').status, 400);
  assert.equal(checkScan('').status, 400);
  assert.equal(checkScan(JSON.stringify({ images: [img(JPEG, 'image/png')] })).status, 415);
  assert.equal(checkScan(JSON.stringify({ images: [img('iVBORw0KGgo' + 'A'.repeat(393))] })).status, 415, 'a PNG labelled JPEG');
  assert.equal(checkScan(JSON.stringify({ images: [img(JPEG.slice(0, -1) + '!')] })).status, 415, 'not base64');
  assert.equal(checkScan(JSON.stringify({ images: [img('/9j/AAAA')] })).status, 415, 'too small to be a photo');
  assert.equal(checkScan('x'.repeat(SCAN_MAX_BYTES + 1)).status, 413);
});

test('scan: the reply keeps vocabulary ids and short names, and parseInventory reads it like a BYO scan', () => {
  const r = scanReply([
    { name: 'Eggs', canonical: 'eggs' }, { name: 'Eggs', canonical: 'eggs' },
    { name: 'Air fryer', canonical: 'air_fryer' },
    { name: 'made-up', canonical: 'unicorn_meat' },
    { name: 'kasuri\nmethi', canonical: null },
    { name: '', canonical: null },
  ]);
  assert.deepEqual(r.have, ['eggs', 'air_fryer']);
  assert.deepEqual(r.other, ['made-up', 'kasuri methi']);
  const items = parseInventory(JSON.stringify({ ok: true, ...r, model: 'gemini-3.1-flash-lite', ms: 900 }));
  assert.deepEqual(items.filter((i) => i.canonical).map((i) => i.canonical), ['eggs', 'air_fryer']);
  assert.ok(items.some((i) => i.name === 'kasuri methi' && i.category === 'other'));
  assert.equal(items.find((i) => i.canonical === 'air_fryer').category, 'appliance');
});

test('scan: flash-lite only, 3.1 first and 3.5 as the fallback', () => {
  assert.deepEqual(SCAN_MODELS, ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
});

test('scan: a good scan calls Gemini with the secret key, minimal thinking, medium resolution, JSON out', async () => {
  const { post, calls } = harness();
  const res = await post(body(3));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const out = await res.json();
  assert.deepEqual(out.have, ['eggs', 'paneer', 'air_fryer']);
  assert.deepEqual(out.other, ['kasuri methi']);
  assert.equal(out.model, 'gemini-3.1-flash-lite');
  assert.equal(out.photosRead, 3);
  assert.equal(typeof out.ms, 'number');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /models\/gemini-3\.1-flash-lite:generateContent$/);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'AIza-secret-key');
  const g = JSON.parse(calls[0].init.body);
  assert.equal(g.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(g.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  assert.equal(g.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_MEDIUM');
  assert.match(g.contents[0].parts[0].text, /Food ids: .*eggs/, 'the same inventoryPrompt() the app uses');
  assert.equal(g.contents[0].parts.filter((p) => p.inline_data).length, 3);
  assert.ok(!JSON.stringify(out).includes('secret'), 'the key never comes back');
});

test('scan: 8 photos go to Gemini in two groups of 4, like the BYO scan', async () => {
  const { post, calls } = harness();
  const out = await (await post(body(8))).json();
  assert.equal(out.photosRead, 8);
  assert.deepEqual(calls.map((c) => JSON.parse(c.init.body).contents[0].parts.length - 1), [4, 4]);
});

test('scan: a busy 3.1 hands over to 3.5, and the user gets an answer', async () => {
  const { post, calls } = harness({ gemini: async (url) => (/3\.1/.test(url) ? { ok: false, status: 503, text: async () => 'high demand' } : geminiOk(['oats'])) });
  const out = await (await post(body(1))).json();
  assert.deepEqual(out.have, ['oats']);
  assert.equal(out.model, 'gemini-3.5-flash-lite');
  assert.ok(calls.every((c) => /flash-lite/.test(c.url)));
});

test('scan: bad origin, no key, junk and oversize bodies are refused before Gemini is called', async () => {
  const { post, calls } = harness();
  assert.equal((await post(body(), { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(body(), { origin: '' })).status, 403);
  assert.equal((await post(body(9))).status, 400);
  assert.equal((await post(JSON.stringify({ images: [img(JPEG, 'image/heic')] }))).status, 415);
  assert.equal((await post('x', { headers: { 'Content-Length': String(SCAN_MAX_BYTES + 1) } })).status, 413);
  assert.equal((await post(JSON.stringify({ images: [img('/9j/' + 'A'.repeat(SCAN_MAX_BYTES))] }))).status, 413);
  assert.equal(calls.length, 0);
  const off = harness({ env: {} });
  const res = await off.post();
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'scan off');
  assert.equal(off.calls.length, 0);
  // Local dev servers are allowed, as for Send.
  assert.equal((await harness().post(body(), { origin: 'http://localhost:8000' })).status, 200);
});

test('scan: 3 per IP per 24 h, a 429 says when, other IPs are unaffected, and the next day it frees up', async () => {
  let t = Date.parse('2026-11-26T10:00:00Z');
  const { post, calls } = harness({ now: () => t });
  for (let i = 0; i < 3; i++) assert.equal((await post(body(1), { ip: '9.9.9.9' })).status, 200);
  const res = await post(body(1), { ip: '9.9.9.9' });
  assert.equal(res.status, 429);
  const out = await res.json();
  assert.equal(out.error, 'limit');
  assert.equal(out.scope, 'ip');
  assert.match(out.message, /3 free scans/);
  assert.equal(Number(res.headers.get('Retry-After')), 24 * 3600);
  assert.equal(res.headers.get('Access-Control-Expose-Headers'), 'Retry-After');
  assert.equal(calls.length, 3, 'a refused scan costs nothing');
  assert.equal((await post(body(1), { ip: '8.8.8.8' })).status, 200);
  t += 24 * 3600e3 + 1;
  assert.equal((await post(body(1), { ip: '9.9.9.9' })).status, 200);
});

test('scan: a scan Gemini could not answer gives its slot back, and its error text stays inside', async () => {
  const { post } = harness({ gemini: async () => ({ ok: false, status: 400, text: async () => 'API key AIza-secret-key not valid; request id 123' }) });
  for (let i = 0; i < 5; i++) {
    const res = await post(body(1), { ip: '7.7.7.7' });
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.ok(!/secret|request id/.test(text), text);
  }
  const bad = harness({ gemini: async () => ({ ok: false, status: 403, text: async () => 'denied' }) });
  const res = await bad.post(body(1));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'scan off', "a dead server key reads as 'scan off', never as the user's key");
});

test('scan: a daily ceiling across every IP protects the bill', async () => {
  const { post } = harness({ env: { GEMINI_API_KEY: 'k', SCAN_DAILY_CAP: '2' } });
  assert.equal((await post(body(1), { ip: 'a' })).status, 200);
  assert.equal((await post(body(1), { ip: 'b' })).status, 200);
  const res = await post(body(1), { ip: 'c' });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).scope, 'all');
});

test('scan: quota bookkeeping, hashed IPs, and the Durable Object round trip', async () => {
  const store = memoryStore();
  const h = await hashIp('1.2.3.4', 'salt');
  assert.match(h, /^[0-9a-f]{32}$/);
  assert.notEqual(h, await hashIp('1.2.3.4', 'other'));
  const now = Date.parse('2026-11-26T00:00:00Z');
  const a = await takeScan(store, h, { perIp: 1, now });
  assert.equal(a.ok, true);
  assert.equal((await takeScan(store, h, { perIp: 1, now: now + 1 })).ok, false);
  await refundScan(store, a.slot);
  assert.equal((await takeScan(store, h, { perIp: 1, now: now + 2 })).ok, true);
  assert.ok(!JSON.stringify([...Object.keys(a.slot), a.slot.key]).includes('1.2.3.4'));

  // ScanQuota against a fake Durable Object storage.
  const mem = new Map();
  let alarm = null;
  const storage = {
    get: async (k) => mem.get(k), put: async (k, v) => { mem.set(k, structuredClone(v)); }, delete: async (ks) => { for (const k of [].concat(ks)) mem.delete(k); },
    list: async () => new Map(mem), getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; },
  };
  const dobj = new ScanQuota({ storage });
  const call = async (b) => (await dobj.fetch(new Request('https://quota/', { method: 'POST', body: JSON.stringify(b) }))).json();
  const first = await call({ op: 'take', ipHash: h, perIp: 2, dailyCap: 10 });
  assert.equal(first.ok, true);
  assert.equal((await call({ op: 'take', ipHash: h, perIp: 2, dailyCap: 10 })).ok, true);
  assert.equal((await call({ op: 'take', ipHash: h, perIp: 2, dailyCap: 10 })).scope, 'ip');
  await call({ op: 'refund', slot: first.slot });
  assert.equal((await call({ op: 'take', ipHash: h, perIp: 2, dailyCap: 10 })).ok, true);
  assert.ok(alarm > Date.now(), 'a clean-up alarm is set');
  mem.set('ip:old', { value: [1], until: 1 });
  await dobj.alarm();
  assert.ok(!mem.has('ip:old') && [...mem.keys()].sort().join() === `all:${new Date().toISOString().slice(0, 10)},ip:${h},month:${new Date().toISOString().slice(0, 7)}:`, 'expired counts are deleted');
});

test('relay: GET says whether Send and Scan are on; Send itself is unchanged by /scan', async () => {
  const w = makeWorker();
  const get = await (await w.fetch(new Request('https://relay.example/'), { GITHUB_TOKEN: 't', GEMINI_API_KEY: 'k' })).json();
  assert.deepEqual(get, { ok: true, relay: 'harveys', ready: true, scan: true });
  assert.equal((await (await w.fetch(new Request('https://relay.example/'), {})).json()).scan, false);
  // A taste-test result posted to the root is never mistaken for a scan.
  const r = await makeWorker().fetch(new Request('https://relay.example/', { method: 'POST', headers: { Origin: ORIGIN }, body: JSON.stringify({ images: [img()] }) }), { GEMINI_API_KEY: 'k' });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { ok: false, error: 'relay off' });
});

test('client: scanViaRelay posts a simple request to /scan and returns items like scanKitchen', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ ok: true, have: ['eggs', 'kadai'], other: ['jaggery'], model: 'gemini-3.1-flash-lite', ms: 1800, photosRead: 2, photosTotal: 2 }) };
  };
  const images = [{ ...img(), previewUrl: 'data:…', name: 'a.jpg', prepMs: 40 }, img()];
  const items = await scanViaRelay({ images, relay: 'https://relay.example/', fetchImpl });
  assert.equal(sent[0].url, 'https://relay.example/scan');
  assert.equal(sent[0].init.headers['Content-Type'], 'text/plain', 'no CORS preflight');
  assert.deepEqual(JSON.parse(sent[0].init.body), { images: [img(), img()] }, 'only base64 and type leave the phone');
  assert.deepEqual(items.filter((i) => i.canonical).map((i) => i.canonical), ['eggs', 'kadai']);
  assert.ok(items.some((i) => i.name === 'jaggery'));
  assert.equal(items.model, 'free scan · gemini-3.1-flash-lite');
  assert.equal(items.photosRead, 2);
  assert.equal(scanUrl('https://relay.example'), 'https://relay.example/scan');
});

test('client: more than 8 frames are thinned evenly to 8 before sending', async () => {
  let n = 0;
  const images = Array.from({ length: 12 }, (_, i) => ({ ...img(), name: `f${i}` }));
  await scanViaRelay({ images, relay: 'https://r.example/', fetchImpl: async (u, init) => { n = JSON.parse(init.body).images.length; return { ok: true, status: 200, json: async () => ({ have: [], other: [] }) }; } });
  assert.equal(n, 8);
});

test('client: a 429 becomes freeLimit with the relay message; offline and server-off are told apart', async () => {
  const reply = (status, b) => async () => ({ ok: false, status, json: async () => b, text: async () => JSON.stringify(b) });
  const run = (fetchImpl) => scanViaRelay({ images: [img()], relay: 'https://r.example/', fetchImpl }).then(() => null, (e) => e);
  let e = await run(reply(429, { error: 'limit', scope: 'ip', retryAfter: 3600, message: "That's today's 3 free scans from this connection." }));
  assert.ok(e instanceof AIError);
  assert.equal(e.kind, 'freeLimit');
  assert.equal(e.message, "That's today's 3 free scans from this connection.");
  assert.equal(e.retryAfter, 3600);
  e = await run(async () => { throw new TypeError('Load failed'); });
  assert.equal(e.kind, 'network');
  e = await run(reply(503, { error: 'scan off' }));
  assert.equal(e.kind, 'scanOff');
  e = await run(reply(504, { error: 'timeout' }));
  assert.equal(e.kind, 'timeout');
  e = await run(reply(502, { error: 'overloaded' }));
  assert.equal(e.kind, 'overloaded');
  e = await run(async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }));
  assert.equal(e.kind, 'malformedResponse');
});

test('client: a silent relay is given up on before iOS Safari would kill the request', async () => {
  const e = await scanViaRelay({
    images: [img()], relay: 'https://r.example/', timeoutMs: 50,
    fetchImpl: (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  }).catch((x) => x);
  assert.equal(e.kind, 'timeout');
});

test('video: keyframe times follow the spec, and videos are told apart from photos', () => {
  assert.deepEqual(keyframeTimes(10), [0.5, 3.5, 6.5, 9.5]); // n = max(4, ceil(10/3)) = 4
  assert.equal(keyframeTimes(18).length, 6);
  assert.equal(keyframeTimes(30).length, 8);
  assert.equal(keyframeTimes(120).length, 8, 'never more than 8');
  assert.equal(keyframeTimes(30, 5).length, 5);
  const t = keyframeTimes(30);
  assert.equal(t[0], 0.5);
  assert.equal(t.at(-1), 29.5);
  assert.ok(t.every((x, i) => i === 0 || x > t[i - 1]));
  assert.deepEqual(keyframeTimes(1), [0.5], 'a 1 s clip gives one frame, not 4 copies of it');
  assert.ok(keyframeTimes(2).length <= 4 && keyframeTimes(2).every((x) => x >= 0.5 && x <= 1.5));
  assert.equal(keyframeTimes(NaN).length, 4, 'unknown length (iOS): 4 frames');
  assert.equal(keyframeTimes(Infinity).length, 4);
  assert.equal(isVideo({ type: 'video/quicktime', name: 'IMG_1.MOV' }), true);
  assert.equal(isVideo({ type: '', name: 'clip.mp4' }), true);
  assert.equal(isVideo({ type: 'image/jpeg', name: 'IMG_2.JPG' }), false);
  assert.equal(isVideo({ type: 'image/heic', name: 'a.mov.heic' }), false);
});

test('relay: worker.js exports only what Cloudflare can load (functions, classes, the handler)', async () => {
  // wrangler dev, 26 Nov: an exported constant in the entry file stops the Worker from starting.
  const mod = await import('../relay/worker.js');
  for (const [name, v] of Object.entries(mod)) {
    assert.ok(typeof v === 'function' || (name === 'default' && typeof v.fetch === 'function'), `${name} is a ${typeof v}`);
  }
  assert.equal(typeof mod.ScanQuota, 'function', 'the Durable Object class is exported for wrangler.toml');
});

test('home hook: your own key first, else the free scan once the relay says it is on, else noKey', async () => {
  const mem = {};
  globalThis.localStorage ??= { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const { scanReady, scanPhotos, checkFreeScan, resetFreeScan, usesFreeScan } = await import('../src/ai/scan.js');
  const { relayUrl } = await import('../src/send.js');
  localStorage.removeItem('harveys.relay.v1');
  resetFreeScan();
  assert.equal(scanReady(null), false, 'not asked yet: no scan');
  // An old relay (before the GEMINI_API_KEY secret) says nothing about scan: still off.
  assert.equal(await checkFreeScan({ relay: relayUrl(), fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, relay: 'harveys', ready: true }) }) }), false);
  assert.equal(scanReady(null), false);
  assert.equal((await scanPhotos({ ai: null, images: [img()] }).catch((e) => e)).kind, 'noKey');
  resetFreeScan();
  assert.equal(await checkFreeScan({ relay: relayUrl(), fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, scan: true }) }) }), true);
  assert.equal(scanReady(null), true);
  assert.equal(usesFreeScan(null), true);
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ have: ['eggs'], other: [], model: 'gemini-3.1-flash-lite' }) }; };
  const items = await scanPhotos({ ai: null, images: [img()], fetchImpl });
  assert.equal(urls[0], `${relayUrl()}scan`);
  assert.deepEqual(items.map((i) => i.canonical), ['eggs']);
  // A saved key wins over the free scan.
  assert.equal(usesFreeScan({ apiKey: 'AIza-x', provider: 'gemini' }), false);
  const own = [];
  await scanPhotos({ ai: { apiKey: 'AIza-x', provider: 'gemini', model: 'gemini-3.5-flash-lite', models: [] }, images: [img()], fetchImpl: async (url) => { own.push(url); return geminiOk(); } });
  assert.match(own[0], /generativelanguage/);
  resetFreeScan();
});

// ── Failsafe (pranjal, 26 Nov): run out, and scanning stays off until a manual reset ──────────
test('failsafe: the monthly cap switches the free scan off, and a new day, month or cold start does not bring it back', async () => {
  let t = Date.parse('2026-11-26T10:00:00Z');
  const h = harness({ env: { GEMINI_API_KEY: 'k', SCAN_MONTHLY_CAP: '3', SCAN_PER_IP: '99' }, now: () => t });
  for (let i = 0; i < 3; i++) assert.equal((await h.post(body(1), { ip: `ip${i}` })).status, 200);
  const off = await h.post(body(1), { ip: 'new' });
  assert.equal(off.status, 503);
  assert.equal((await off.json()).error, 'scan off', 'the app reads this as scanOff: key box + kitchen like yours');
  assert.equal(h.calls.length, 3, 'nothing more reaches Gemini');
  const get = await (await h.worker.fetch(new Request('https://relay.example/'), h.env)).json();
  assert.equal(get.scan, false, 'GET says off, so the page shows the key box straight away');
  assert.match(get.off, /monthly cap of 3/);
  t = Date.parse('2026-12-02T10:00:00Z'); // a new month: still off
  assert.equal((await h.post(body(1), { ip: 'dec' })).status, 503);
  // Reset by hand: a new SCAN_RESET value (wrangler secret put SCAN_RESET) lifts it and starts a fresh count.
  h.env.SCAN_RESET = '2026-12-02';
  assert.equal((await h.post(body(1), { ip: 'dec' })).status, 200);
  assert.equal((await (await h.worker.fetch(new Request('https://relay.example/'), h.env)).json()).scan, true);
});

test('failsafe: failed scans still count for the month (they may have cost something)', async () => {
  const h = harness({ env: { GEMINI_API_KEY: 'k', SCAN_MONTHLY_CAP: '2', SCAN_PER_IP: '99' }, gemini: async () => ({ ok: false, status: 503, text: async () => 'busy' }) });
  assert.equal((await h.post(body(1))).status, 502);
  assert.equal((await h.post(body(1))).status, 502);
  assert.equal((await h.post(body(1))).status, 503);
  assert.equal(SCAN_MONTHLY_CAP, 1500);
});

test('failsafe: Gemini saying quota or billing is gone latches at once; a per-minute burst does not', async () => {
  const daily = JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
  const minute = JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }] }] } });
  assert.match(latchReason(429, daily), /quota or billing/);
  assert.equal(latchReason(429, minute), null);
  assert.match(latchReason(429, 'Resource has been exhausted'), /429/, 'an unclear 429 latches: the safe side');
  assert.match(latchReason(403, 'PERMISSION_DENIED billing disabled'), /403/);
  assert.match(latchReason(400, 'API key expired. Please renew the API key.'), /400/);
  assert.equal(latchReason(400, 'Invalid JSON payload: thinkingConfig'), null, 'a speed setting a model rejects is retried, not latched');
  assert.equal(latchReason(503, 'high demand'), null);

  const h = harness({ env: { GEMINI_API_KEY: 'k', SCAN_PER_IP: '99' }, gemini: async () => ({ ok: false, status: 429, text: async () => daily, clone() { return this; } }) });
  const res = await h.post(body(1));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'scan off');
  const n = h.calls.length;
  assert.equal((await h.post(body(1))).status, 503);
  assert.equal(h.calls.length, n, 'latched: Gemini is not called again');
  const get = await (await h.worker.fetch(new Request('https://relay.example/'), h.env)).json();
  assert.equal(get.scan, false);
  assert.match(get.off, /quota or billing/);
  assert.ok(!JSON.stringify(get).includes('RESOURCE'), "Gemini's text stays inside");

  // One model's quota gone while the other answers: the scan is served, the next one is not.
  let first = true;
  const mixed = harness({ env: { GEMINI_API_KEY: 'k', SCAN_PER_IP: '99' }, gemini: async (url) => (/3\.1/.test(url) && first ? ((first = false), { ok: false, status: 429, text: async () => daily }) : geminiOk(['eggs'])) });
  assert.equal((await mixed.post(body(1))).status, 200);
  assert.equal((await mixed.post(body(1))).status, 503);

  // A per-minute 429 does not latch.
  let n429 = 0;
  const burst = harness({ env: { GEMINI_API_KEY: 'k', SCAN_PER_IP: '99' }, gemini: async () => (n429++ < 1 ? { ok: false, status: 429, text: async () => minute } : geminiOk(['oats'])) });
  assert.equal((await burst.post(body(1))).status, 200);
  assert.equal((await burst.post(body(1))).status, 200);
});

test('logs: nothing the Worker runs ever writes to the console (Workers Logs is on)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['../relay/worker.js', '../relay/scan.js', '../src/ai/providers.js', '../src/ai/prompt.js', '../src/brain/vocabulary.js']) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /\bconsole\.(log|info|warn|error|debug|trace)\(/, f);
  }
  const toml = readFileSync(new URL('../relay/wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /compatibility_date = "2026-11-22"/);
  assert.match(toml, /preview_urls = false/);
  assert.doesNotMatch(toml, /GEMINI_API_KEY\s*=/, 'secrets never live in the config');
});

// ── 1.63.0: honest errors (pranjal saw "overloaded" for what was Gemini refusing the request) ──
test('errors: the Worker sends back Gemini codes, never its text', async () => {
  const { geminiCode } = await import('../relay/scan.js');
  const bad = JSON.stringify({ error: { code: 400, message: 'API key not valid. key=AIza-secret', status: 'INVALID_ARGUMENT', details: [{ '@type': 'x', reason: 'API_KEY_INVALID' }] } });
  assert.deepEqual(geminiCode(400, bad), { http: 400, status: 'INVALID_ARGUMENT', reason: 'API_KEY_INVALID' });
  assert.deepEqual(geminiCode(503, 'high demand'), { http: 503, status: null, reason: null });
  assert.deepEqual(geminiCode(400, JSON.stringify({ error: { status: 'lower case or <script>', details: [{ reason: 'a b' }] } })), { http: 400, status: null, reason: null });

  const h = harness({ env: { GEMINI_API_KEY: 'k', SCAN_PER_IP: '99' }, gemini: async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { code: 400, message: 'Unable to process input image. secret', status: 'INVALID_ARGUMENT' } }) }) });
  const res = await h.post(body(1), { ip: 'codes-1' });
  assert.equal(res.status, 502);
  const out = await res.json();
  assert.equal(out.error, 'badRequest');
  assert.deepEqual(out.gemini, { http: 400, status: 'INVALID_ARGUMENT', reason: null });
  assert.ok(!JSON.stringify(out).includes('secret'));
  // A latched key error says why it is off.
  const k = harness({ env: { GEMINI_API_KEY: 'k', SCAN_PER_IP: '99' }, gemini: async () => ({ ok: false, status: 400, text: async () => bad }) });
  const off = await (await k.post(body(1), { ip: 'codes-2' })).json();
  assert.equal(off.error, 'scan off');
  assert.match(off.off, /key or billing/);
  assert.equal(off.gemini.reason, 'API_KEY_INVALID');
  const again = await (await k.post(body(1), { ip: 'codes-3' })).json();
  assert.match(again.off, /key or billing/, 'later scans say why too');
});

test('errors: only a real overload reads as "overloaded"; a refused request reads as "isn\'t working"', async () => {
  const { relayError } = await import('../src/ai/providers.js');
  const bad = relayError(502, { error: 'badRequest', gemini: { http: 400, status: 'INVALID_ARGUMENT', reason: 'API_KEY_INVALID' } });
  assert.equal(bad.kind, 'scanBroken');
  assert.equal(bad.message, "The free scan isn't working right now.");
  assert.equal(bad.code, 'badRequest · gemini 400 INVALID_ARGUMENT API_KEY_INVALID');
  assert.equal(relayError(502, { error: 'overloaded', gemini: { http: 503 } }).kind, 'overloaded');
  assert.equal(relayError(502, { error: 'rateLimited', gemini: { http: 429 } }).kind, 'overloaded');
  assert.equal(relayError(500, null).kind, 'scanBroken', 'a crashed Worker is not "busy"');
  assert.equal(relayError(502, { error: 'malformedResponse' }).kind, 'scanBroken');
  assert.equal(relayError(503, { error: 'scan off', off: 'monthly cap of 1500 scans reached' }).kind, 'scanOff');
  assert.match(relayError(503, { error: 'scan off', off: 'monthly cap of 1500 scans reached' }).detail, /monthly cap/);
});

test('errors: one retry on a real overload, none on anything else', async () => {
  const run = async (replies) => {
    let n = 0;
    const fetchImpl = async () => { const r = replies[Math.min(n++, replies.length - 1)]; return { ok: r.status === 200, status: r.status, json: async () => r.body }; };
    const out = await scanViaRelay({ images: [img()], relay: 'https://r.example/', fetchImpl, retryMs: 5 }).then((x) => x, (e) => e);
    return { out, n };
  };
  const ok = { status: 200, body: { have: ['eggs'], other: [] } };
  const busy = { status: 502, body: { error: 'overloaded', gemini: { http: 503 } } };
  const broken = { status: 502, body: { error: 'badRequest', gemini: { http: 400 } } };
  let r = await run([busy, ok]);
  assert.equal(r.n, 2);
  assert.deepEqual(r.out.map((i) => i.canonical), ['eggs']);
  r = await run([busy, busy]);
  assert.equal(r.n, 2, 'only one retry');
  assert.equal(r.out.kind, 'overloaded');
  r = await run([broken, ok]);
  assert.equal(r.n, 1, 'a refused request is not retried');
  assert.equal(r.out.kind, 'scanBroken');
  r = await run([{ status: 429, body: { error: 'limit' } }, ok]);
  assert.equal(r.n, 1);
});
