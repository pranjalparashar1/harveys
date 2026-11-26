// 1.64.0: "Cooked this" and "Fix / Veto" go home on their own, through the relay's POST /log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorker, checkLog, checkResult } from '../relay/worker.js';
import { cookLogEntry, liveRepairEntry, encodeLiveEvent, poolLiveEvents, randomId, COOK_LOG_FORMAT, LIVE_REPAIR_FORMAT } from '../src/brain/log.js';

const ORIGIN = 'https://pranjalparashar1.github.io';
const AT = '2026-11-26T19:30:00.000Z';
const NOW = Date.parse('2026-11-26T20:00:00Z');
const dish = (id, tier = 'pass') => ({ meal: { id, name: id.replace(/_/g, ' '), parts: [{ id: 'bread', technique: 'air_fried' }, { id: 'cheese_slices', technique: 'melted' }] }, pierre: { tier }, payoff: { value: 1.23456 }, friction: 0.5, used: { ingredients: [{ id: 'butter' }] } });
const ladder = [
  { rung: 1, pick: dish('whey_milk_shake'), alternatives: [] },
  { rung: 2, pick: dish('airfryer_protein_cheese_toast'), alternatives: [dish('microwave_paneer_bhurji', 'floor')] },
];
const cook = cookLogEntry({ chosen: ladder[1].pick, ladder, context: { kind: 'meal', hour: 19, weekday: 4, targets: { protein: 30 }, soaked: [], page: 'home' }, at: AT });
const repair = liveRepairEntry({ item: dish('microwave_paneer_bhurji', 'floor'), tier: 'pass', fix: 'more chilli', at: AT });
const cookEv = encodeLiveEvent({ kind: 'cook', entry: cook, deviceId: 'abc123xyz0', eventId: 'ev0000000001', version: '1.64.0' });
const repairEv = encodeLiveEvent({ kind: 'repair', entry: repair, deviceId: 'abc123xyz0', eventId: 'ev0000000002', version: '1.64.0' });

test('encodeLiveEvent wraps a cook and a repair, with no names, keys or user agent', () => {
  assert.deepEqual(Object.keys(cookEv), ['format', 'version', 'deviceId', 'eventId', 'at', 'entry']);
  assert.equal(cookEv.format, COOK_LOG_FORMAT);
  assert.equal(repairEv.format, LIVE_REPAIR_FORMAT);
  assert.equal(cookEv.at, AT);
  assert.equal(cookEv.entry.dishId, 'airfryer_protein_cheese_toast');
  assert.equal(repairEv.entry.yours, 'pass');
  assert.doesNotMatch(JSON.stringify([cookEv, repairEv]), /Mozilla|apiKey|AIza|@/);
  assert.throws(() => encodeLiveEvent({ kind: 'x', entry: cook, deviceId: 'abc123', eventId: 'ev0000000001' }), /kind/);
  assert.throws(() => encodeLiveEvent({ kind: 'cook', entry: cook, deviceId: 'A!', eventId: 'ev0000000001' }), /deviceId/);
  const id = randomId(10);
  assert.match(id, /^[a-z0-9]{10}$/);
});

test('relay checkLog: both formats pass, are rebuilt key by key and named by the relay', () => {
  const c = checkLog(JSON.stringify({ ...cookEv, ua: 'Mozilla/5.0', name: 'pranjal', entry: { ...cookEv.entry, email: 'x@y.z' } }), NOW);
  assert.equal(c.ok, true);
  assert.equal(c.path, 'data/cook-logs/cook-2026-11-26-abc123xyz0-ev0000000001.json');
  const saved = JSON.parse(c.content);
  assert.deepEqual(Object.keys(saved), ['format', 'version', 'deviceId', 'eventId', 'at', 'entry']);
  assert.equal(saved.entry.email, undefined);
  assert.doesNotMatch(c.content, /Mozilla|pranjal|x@y/);
  assert.deepEqual(saved.entry.ladderShown.map((l) => l.pickId), ['whey_milk_shake', 'airfryer_protein_cheese_toast']);
  assert.deepEqual(saved.entry.alternativesShown.map((a) => a.id), ['microwave_paneer_bhurji']);
  assert.equal(saved.entry.context.targets.protein, 30);
  const r = checkLog(JSON.stringify(repairEv), NOW);
  assert.equal(r.ok, true);
  assert.equal(r.path, 'data/cook-logs/repair-2026-11-26-abc123xyz0-ev0000000002.json');
  assert.equal(JSON.parse(r.content).entry.fix, 'more chilli');
  assert.deepEqual(JSON.parse(r.content).entry.parts, repair.parts);
});

test('relay checkLog: wrong format, bad ids, bad tier, long fix, odd dates and >16 KB are refused', () => {
  const no = (ev) => assert.equal(checkLog(JSON.stringify(ev), NOW).ok, false, JSON.stringify(ev).slice(0, 80));
  no({ ...cookEv, format: 'harveys-rung-quiz/1' });
  no({ ...cookEv, deviceId: '../../index' });
  no({ ...cookEv, deviceId: 'ABC123' });
  no({ ...cookEv, eventId: 'short' });
  no({ ...cookEv, entry: { ...cook, tier: 'meh' } });
  no({ ...cookEv, entry: { ...cook, rung: 7 } });
  no({ ...cookEv, entry: { ...cook, ladderShown: null } });
  no({ ...repairEv, entry: { ...repair, fix: 'x'.repeat(201) } });
  no({ ...repairEv, entry: { ...repair, yours: 'great' } });
  no({ ...cookEv, at: '2031-01-01T00:00:00Z' });
  assert.equal(checkLog(JSON.stringify({ ...cookEv, pad: 'x'.repeat(17_000) }), NOW).error, 'too big');
  assert.equal(checkLog('nope', NOW).ok, false);
  // And a live event is never taken for a taste test.
  assert.equal(checkResult(JSON.stringify(cookEv), NOW).ok, false);
});

test('relay POST /log: create-only commit, a resend is a duplicate, origin and size guarded, quiz route untouched', async () => {
  const calls = [];
  const w = makeWorker({ fetch: async (url, o) => { calls.push({ url, o }); return { ok: calls.length !== 2, status: calls.length === 2 ? 422 : 201 }; } });
  const env = { GITHUB_TOKEN: 'secret' };
  const now = new Date().toISOString();
  const post = (body, { origin = ORIGIN, path = '/log', ip = '1.1.1.1' } = {}) => w.fetch(new Request(`https://relay.example${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain', 'CF-Connecting-IP': ip }, body }), env);
  let res = await post(JSON.stringify({ ...cookEv, at: now, entry: { ...cook, at: now } }));
  assert.equal(res.status, 200);
  assert.match(calls[0].url, /\/repos\/pranjalparashar1\/harveys\/contents\/data\/cook-logs\/cook-\d{4}-\d\d-\d\d-abc123xyz0-ev0000000001\.json$/);
  assert.equal(calls[0].o.method, 'PUT');
  assert.equal(calls[0].o.headers.Authorization, 'Bearer secret');
  assert.equal(JSON.parse(calls[0].o.body).sha, undefined); // never an overwrite
  res = await post(JSON.stringify({ ...cookEv, at: now })); // the same eventId again
  assert.equal(res.status, 200);
  const dup = await res.json();
  assert.equal(dup.duplicate, true);
  assert.match(dup.path, /^data\/cook-logs\/cook-.*-abc123xyz0-ev0000000001\.json$/);
  assert.equal((await post(JSON.stringify({ ...repairEv, at: now }))).status, 200);
  assert.match(calls[2].url, /data\/cook-logs\/repair-/);
  assert.equal((await post(JSON.stringify({ ...cookEv, at: now }), { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(JSON.stringify({ ...cookEv, at: now, format: 'nope' }))).status, 400);
  assert.equal((await post(JSON.stringify({ ...cookEv, at: now, deviceId: 'NO' }))).status, 400);
  assert.equal((await post(JSON.stringify({ ...cookEv, at: now, pad: 'x'.repeat(17_000) }))).status, 413);
  assert.equal((await w.fetch(new Request('https://relay.example/log', { method: 'POST', headers: { Origin: ORIGIN }, body: '{}' }), {})).status, 503);
  assert.equal(calls.length, 3);
  // Health check says the log is there; a live event posted to the quiz route is still refused there.
  assert.equal((await (await w.fetch(new Request('https://relay.example/', { headers: { Origin: ORIGIN } }), env)).json()).log, true);
  assert.equal((await post(JSON.stringify(cookEv), { path: '/' })).status, 400);
  assert.equal(calls.length, 3);
});

test('relay POST /log: 30 events per IP per day, then 429, on a counter apart from the quiz', async () => {
  const w = makeWorker({ fetch: async () => ({ ok: true, status: 201 }) });
  const env = { GITHUB_TOKEN: 'secret' };
  const now = new Date().toISOString();
  const post = (i) => w.fetch(new Request('https://relay.example/log', { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '9.9.9.9' }, body: JSON.stringify({ ...cookEv, at: now, eventId: `ev-${String(i).padStart(8, '0')}` }) }), env);
  for (let i = 0; i < 30; i++) assert.equal((await post(i)).status, 200, `event ${i}`);
  assert.equal((await post(30)).status, 429);
});

test('poolLiveEvents dedupes by eventId, splits cooks from repairs and filters by device', () => {
  const other = { ...cookEv, deviceId: 'zzz999', eventId: 'ev0000000009', at: '2026-11-25T19:00:00Z', entry: { ...cook, at: '2026-11-25T19:00:00Z' } };
  const pool = poolLiveEvents([cookEv, cookEv, repairEv, other, { format: 'harveys-rung-quiz/1' }, null]);
  assert.deepEqual(pool.cookLog.map((e) => e.eventId), ['ev0000000009', 'ev0000000001']); // oldest first
  assert.deepEqual(pool.repairs.map((e) => e.dishId), ['microwave_paneer_bhurji']);
  assert.deepEqual(poolLiveEvents([cookEv, other], { device: 'zzz999' }).cookLog.map((e) => e.deviceId), ['zzz999']);
});

test('refit-cooklog pools data/cook-logs, dedupes, filters --device and lists live repairs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cooklogs-'));
  const LADDER = [{ rung: 1, pickId: 'whey_milk_shake', tier: 'pass' }, { rung: 2, pickId: 'airfryer_protein_cheese_toast', tier: 'pass' }, { rung: 4, pickId: 'pasta_aglio_olio_paneer', tier: 'pass' }];
  const ev = (i, dev, dishId) => ({ format: COOK_LOG_FORMAT, version: '1.64.0', deviceId: dev, eventId: `ev-${String(i).padStart(8, '0')}`, at: AT, entry: { dishId, rung: 1, tier: 'pass', ladderShown: LADDER, alternativesShown: [], at: AT } });
  writeFileSync(join(dir, 'cook-2026-11-26-aaaaaa-ev-00000001.json'), JSON.stringify(ev(1, 'aaaaaa', 'whey_milk_shake')));
  writeFileSync(join(dir, 'cook-2026-11-26-aaaaaa-ev-00000001-copy.json'), JSON.stringify(ev(1, 'aaaaaa', 'whey_milk_shake'))); // same eventId
  writeFileSync(join(dir, 'cook-2026-11-26-bbbbbb-ev-00000002.json'), JSON.stringify(ev(2, 'bbbbbb', 'airfryer_protein_cheese_toast')));
  writeFileSync(join(dir, 'repair-2026-11-26-aaaaaa-ev0000000002.json'), JSON.stringify(repairEv));
  const run = (...a) => execFileSync('node', ['scripts/refit-cooklog.mjs', '--dir', dir, '--min', '1', ...a], { encoding: 'utf8' });
  const all = run();
  assert.match(all, /^2 logged dinners from 2 phones, 2 usable/);
  assert.match(all, /Live repairs \(1\)\n {2}microwave_paneer_bhurji: floor → pass \("more chilli"\)/);
  assert.match(run('--device', 'bbbbbb'), /^1 logged dinners from 1 phone \(device bbbbbb\), 1 usable/);
  assert.equal(JSON.parse(run('--json')).dinners, 2);
  // A single cook-*.json file still works as an argument.
  assert.match(execFileSync('node', ['scripts/refit-cooklog.mjs', join(dir, 'cook-2026-11-26-bbbbbb-ev-00000002.json'), '--min', '1'], { encoding: 'utf8' }), /^1 logged dinners/);
});

test('phone outbox: queued, sent to <relay>/log, kept on no signal, dropped when refused; never touches the quiz outbox', async () => {
  const mem = {};
  globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const { deviceId, newEventId, queueLiveEvent, liveOutbox, flushLiveOutbox, beaconLiveOutbox, outbox } = await import('../src/send.js');
  const id = deviceId();
  assert.match(id, /^[a-z0-9]{10}$/);
  assert.equal(deviceId(), id, 'made once');
  assert.equal(mem['harveys.deviceId'], id);
  assert.match(newEventId(), /^[a-z0-9]{12}$/);
  const calls = [];
  globalThis.fetch = async (url, o) => { calls.push([url, o.method, o.headers['Content-Type'], o.keepalive]); return { ok: true, status: 200 }; };
  assert.deepEqual(await queueLiveEvent(cookEv), { sent: 1, left: 0, rejected: 0 });
  assert.deepEqual(calls[0], ['https://harveys-send.pranjalparashar1.workers.dev/log', 'POST', 'text/plain', true]);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await queueLiveEvent(repairEv);
  await queueLiveEvent(repairEv); // the same event twice is one item
  assert.deepEqual(liveOutbox().map((x) => x.eventId), ['ev0000000002']);
  const beacons = [];
  assert.equal(beaconLiveOutbox({ sendBeacon: (u, b) => { beacons.push([u, JSON.parse(b).eventId]); return true; } }), 1);
  assert.deepEqual(beacons, [['https://harveys-send.pranjalparashar1.workers.dev/log', 'ev0000000002']]);
  globalThis.fetch = async () => ({ ok: false, status: 429 });
  assert.equal((await flushLiveOutbox()).left, 1, 'slow down: kept');
  globalThis.fetch = async () => ({ ok: false, status: 400 });
  assert.deepEqual(await flushLiveOutbox(), { sent: 0, left: 0, rejected: 1 });
  assert.deepEqual(outbox(), [], 'the taste-test outbox is not used');
});
