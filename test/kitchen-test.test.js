import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadKitchens, buildKitchenTest, whiteFor, encodeResult, parseResults, scoreResult, kitchenId, RESULT_FORMAT, marcoChoices, fitFrom } from '../src/brain/kitchen-test.js';
import { importKitchens } from '../src/brain/index.js';

const text = readFileSync(new URL('../data/test-kitchens/kitchens.json', import.meta.url), 'utf8');
const [bachelor] = loadKitchens(text);

test('a single kitchen object imports as one kitchen, not as its items', () => {
  const one = JSON.stringify(JSON.parse(text)[0]);
  assert.equal(importKitchens(one).length, 1);
  assert.equal(importKitchens(one)[0].items.length, 58);
});

test('kitchen ids are stable and change with the items', () => {
  assert.equal(kitchenId(bachelor), loadKitchens(text)[0].id);
  assert.notEqual(kitchenId(bachelor), kitchenId({ ...bachelor, items: bachelor.items.slice(1) }));
});

test('each kitchen gets Pierre, Marco and White sized to what it can make', () => {
  const t = buildKitchenTest(bachelor);
  assert.ok(t.pierre.length >= 10 && t.pierre.length <= t.summary.cookable);
  assert.ok(t.marco.length >= 5);
  for (const q of t.marco) assert.notEqual(q.a, q.b);
  assert.equal(new Set(t.marco.map((q) => [q.a, q.b].sort().join())).size, t.marco.length);
  const w = whiteFor(t);
  assert.ok(w.top);
  assert.ok(w.ladder.every((d, i, l) => i === 0 || l[i - 1].rung < d.rung), 'easiest rung first');
});

test('a tiny kitchen makes a short test, not a crash', () => {
  const [k] = loadKitchens({ kitchen: 'Noodles only', items: [{ name: 'instant noodles' }, { name: 'water' }] });
  const t = buildKitchenTest(k);
  assert.ok(t.marco.length <= 1);
  const r = encodeResult(t, {}, { version: 't', at: 'x' });
  assert.equal(r.format, RESULT_FORMAT);
});

test('answers change White, and the result round-trips through an issue body', () => {
  const t = buildKitchenTest(bachelor);
  const before = whiteFor(t).top.id;
  const pierre = { [before]: 'veto' };
  const after = whiteFor(t, { pierreAnswers: pierre }).top.id;
  assert.notEqual(after, before, 'a vetoed dish leaves the lead');
  const marco = Object.fromEntries(t.marco.map((q, i) => [q.id, i % 2 ? 'a' : 'b']));
  assert.ok(fitFrom(marcoChoices(t, marco, pierre)).n >= 3);
  const res = encodeResult(t, { pierre, marco, white: { [after]: 'yes' }, instead: after }, { version: 't', at: 'x', persona: 'noodles' });
  const back = parseResults(`Some words\n\`\`\`json\n${JSON.stringify(res)}\n\`\`\``);
  assert.equal(back.length, 1);
  const s = scoreResult(back[0]);
  assert.equal(s.white.topAnswer, 'yes');
  assert.equal(s.pierre.n, 1);
  assert.ok(JSON.stringify(res).length < 6000, 'small enough for an issue URL');
});
