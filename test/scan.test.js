// 1.61.0: the free kitchen scan. POST /scan on the relay, video keyframes, and the app's client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker } from '../relay/worker.js';
import { checkScan, scanReply, takeScan, refundScan, memoryStore, hashIp, SCAN_MODELS, SCAN_MAX_BYTES, ScanQuota } from '../relay/scan.js';
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
  assert.deepEqual(await res.json(), { ok: false, error: 'scan off' });
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
  assert.deepEqual(await res.json(), { ok: false, error: 'scan off' }, "a dead server key reads as 'scan off', never as the user's key");
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
  assert.ok(!mem.has('ip:old') && mem.size === 2, 'expired counts are deleted');
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
