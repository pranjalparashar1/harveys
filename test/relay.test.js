import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { checkResult } from '../relay/worker.js';
import { loadKitchens } from '../src/brain/kitchen-test.js';
import { buildInventory } from '../src/brain/inventory.js';
import { buildRungQuiz, encodeRungResult } from '../src/brain/rung-quiz.js';

const cache = JSON.parse(readFileSync(new URL('../data/ingredient-cache.json', import.meta.url), 'utf8'));
const [kitchen] = loadKitchens(readFileSync(new URL('../data/test-kitchens/kitchens.json', import.meta.url), 'utf8'));
const quiz = buildRungQuiz({ kitchen, inventory: buildInventory(kitchen.items, { cache }) });
const NOW = Date.parse('2026-11-22T12:00:00Z');
const result = encodeRungResult(quiz, { marco: {}, pierre: {}, white: {} }, { version: '1.33.0', at: '2026-11-22T11:00:00Z', testerId: 't-abc123' });
const ORIGIN = 'https://pranjalparashar1.github.io';

test('relay: a real result passes, and the file name is built by the relay', () => {
  const c = checkResult(JSON.stringify(result), NOW);
  assert.equal(c.ok, true);
  assert.equal(c.path, `data/kitchen-tests/taste-2026-11-22-${quiz.id}-t-abc123.json`);
  assert.deepEqual(JSON.parse(c.content), result);
});

test('relay: junk, path tricks, huge bodies and odd dates are refused', () => {
  assert.equal(checkResult('hello', NOW).ok, false);
  assert.equal(checkResult(JSON.stringify({ ...result, format: 'x' }), NOW).ok, false);
  assert.equal(checkResult(JSON.stringify({ ...result, testerId: '../../index' }), NOW).ok, false);
  assert.equal(checkResult(JSON.stringify({ ...result, kitchenId: 'a/b' }), NOW).ok, false);
  assert.equal(checkResult(JSON.stringify({ ...result, at: '2031-01-01T00:00:00Z' }), NOW).ok, false);
  assert.equal(checkResult(JSON.stringify({ ...result, marco: null }), NOW).ok, false);
  assert.equal(checkResult(JSON.stringify({ ...result, pad: 'x'.repeat(210_000) }), NOW).ok, false);
});

test('relay: commits create-only with the secret token; other sites and resends handled', async () => {
  const calls = [];
  globalThis.fetch = async (url, o) => { calls.push({ url, o }); return { ok: calls.length === 1, status: calls.length === 1 ? 201 : 422 }; };
  const env = { GITHUB_TOKEN: 'secret' };
  const post = (origin, body = JSON.stringify({ ...result, at: new Date().toISOString() })) => worker.fetch(new Request('https://relay.example/', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body }), env);
  let res = await post(ORIGIN);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(calls[0].o.method, 'PUT');
  assert.equal(calls[0].o.headers.Authorization, 'Bearer secret');
  assert.equal(JSON.parse(calls[0].o.body).sha, undefined); // never an overwrite
  res = await post(ORIGIN); // the same file again: already in, still a success
  assert.equal((await res.json()).existed, true);
  assert.equal((await post('https://evil.example')).status, 403);
  assert.equal((await post(ORIGIN, '{"format":"nope"}')).status, 400);
  assert.equal((await worker.fetch(new Request('https://relay.example/', { method: 'POST', headers: { Origin: ORIGIN }, body: '{}' }), {})).status, 503);
  assert.equal(calls.length, 2);
});

test('send: through the relay with no token, refused files stop blocking the outbox', async () => {
  const mem = {};
  globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const { captureToken, canSend, sendResult, outbox, getToken } = await import('../src/send.js');
  assert.equal(canSend(), true); // the live relay is the default
  captureToken({ hash: '#relay=off', pathname: '/', search: '' }, { replaceState() {} });
  assert.equal(canSend(), false);
  captureToken({ hash: '#relay=https%3A%2F%2Frelay.example%2F', pathname: '/harveys/', search: '' }, { replaceState() {} });
  assert.equal(canSend(), true);
  assert.equal(getToken(), null);
  const calls = [];
  globalThis.fetch = async (url, o) => { calls.push([url, o.method, o.headers['Content-Type']]); return { ok: true, status: 200 }; };
  assert.equal(await sendResult({ ...result, testerId: 't-1' }), 'sent');
  assert.deepEqual(calls[0], ['https://relay.example/', 'POST', 'text/plain']); // a simple request: no CORS preflight
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.equal(await sendResult({ ...result, testerId: 't-2' }), 'queued');
  globalThis.fetch = async () => ({ ok: false, status: 400 });
  assert.equal(await sendResult({ ...result, testerId: 't-3' }), 'failed');
  assert.equal(outbox().length, 0); // t-2 was refused too, and moved aside
});

test('1.35.0: a Send during a slow flush is never wiped, and is only "sent" once it really went', async () => {
  const { sendResult, flush, outbox } = await import('../src/send.js');
  let release;
  const gate = new Promise((r) => { release = r; });
  const posted = [];
  // The first post hangs (bad signal), then the relay goes down for the rest.
  globalThis.fetch = async (url, o) => {
    posted.push(JSON.parse(o.body).testerId);
    if (posted.length === 1) { await gate; return { ok: true, status: 200 }; }
    throw new TypeError('offline');
  };
  localStorage.setItem('harveys.outbox.v1', JSON.stringify([{ path: 'data/kitchen-tests/old.json', message: 'm', content: JSON.stringify({ ...result, testerId: 't-old' }) }]));
  const slow = flush(); // the page's own flush on open
  const tap = sendResult({ ...result, testerId: 't-new' }); // the tester taps Send meanwhile
  release();
  await slow;
  assert.equal(await tap, 'queued', 'no signal for the new one: queued, not "sent"');
  assert.deepEqual(outbox().map((x) => JSON.parse(x.content).testerId), ['t-new']);
});

test('ingredient check: every item is used or has a reason, and the result keeps the unused ones', () => {
  const u = quiz.usage;
  assert.equal(u.items.length, kitchen.items.length);
  assert.equal(u.used + u.unused, u.items.length);
  for (const x of u.items) {
    if (x.status === 'used') assert.ok(x.usedIn.length && x.usedIn.every((d) => Object.values(quiz.dishes).some((q) => q.name === d)));
    else assert.ok(x.reasons.length, x.name);
  }
  const eggs = u.items.find((x) => x.name === 'eggs');
  assert.equal(eggs.status, 'used');
  const pasta = u.items.find((x) => /pasta/.test(x.name));
  assert.match(pasta.reasons[0].why, /^missing /);
  assert.ok(u.gaps.includes('quinoa'));
  const file = encodeRungResult(quiz, { marco: {}, pierre: {}, white: {} }, { version: 'x', at: 'y', testerId: 't' });
  assert.ok(file.ingredients.used.includes('eggs'));
  assert.ok(file.ingredients.unused.some((x) => x.name === 'quinoa' && x.reasons[0].why === 'no recipe uses it'));
  assert.ok(file.ingredients.blockers.some((b) => /Strainer/.test(b.thing)));
});
