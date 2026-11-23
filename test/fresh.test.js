// 1.40.0: "Start fresh" and the stale-page reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearLocal, freshUrl, FRESH_KEYS } from '../src/fresh.js';

const mem = (init) => { const m = new Map(Object.entries(init)); return { m, removeItem: (k) => m.delete(k), clear: () => m.clear(), getItem: (k) => m.get(k) ?? null }; };

test('start fresh forgets saved runs and the last kitchen, keeps unsent results and keys', async () => {
  const ls = mem({ 'harveys.rq.v1': '{}', 'marco.pantry': '{}', 'harveys.outbox.v1': '[1]', 'harveys.gh.v1': 't', 'marco.ai': 'k', 'harveys.tester.name.v1': 'Harsh' });
  const deleted = [];
  await clearLocal({ ls, ss: mem({ a: 1 }), caches: { keys: async () => ['x'], delete: async (k) => deleted.push(k) }, sw: { getRegistrations: async () => [{ unregister: async () => deleted.push('sw') }] } });
  assert.deepEqual([...ls.m.keys()].sort(), ['harveys.gh.v1', 'harveys.outbox.v1', 'harveys.tester.name.v1', 'marco.ai']);
  assert.deepEqual(deleted.sort(), ['sw', 'x']);
  assert.ok(FRESH_KEYS.includes('harveys.rq.v1'));
});

test('the fresh URL keeps the link and changes the query', () => {
  assert.equal(freshUrl({ pathname: '/harveys/', hash: '#n=Harsh&k=1abc' }, 36), '/harveys/?fresh=10#n=Harsh&k=1abc');
});

test('a run saved by an older version is dropped, and the tester page shows Start fresh', () => {
  const ui = readFileSync(new URL('../src/rung-quiz-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /minor\(run\.v\) !== minor\(version\)\) run = null/);
  assert.match(ui, /data-act="fresh"/);
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /id="start-fresh"/);
  assert.match(readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8'), /_site\/version\.json/);
});
