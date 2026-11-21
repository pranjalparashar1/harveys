import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSheet } from '../scripts/holdout.mjs';
import { ROUND3, ROUND3_SEED } from '../scripts/round3.mjs';
import { MODIFIERS } from '../src/brain/ingredients.js';
import { PIERRE_RAW } from '../src/brain/pierre-raw.js';

const sheet = JSON.parse(readFileSync(new URL('../src/quiz/round3.json', import.meta.url), 'utf8'));
const earlier = ['benchmark', 'holdout'].map((f) => JSON.parse(readFileSync(new URL(`../src/quiz/${f}.json`, import.meta.url), 'utf8')));

test('round 3: the sheet is blind, new, and matches the script', () => {
  assert.deepEqual(sheet, buildSheet(ROUND3, ROUND3_SEED, 'round3', 'Pierre round 3').sheet);
  for (const s of earlier) assert.notEqual(sheet.seed, s.seed);
  const seen = new Set(earlier.flatMap((s) => s.dishes.map((d) => d.parts.toLowerCase())));
  for (const d of sheet.dishes) assert.ok(!seen.has(d.parts.toLowerCase()), d.name);
  const raw = JSON.stringify(sheet);
  for (const word of ['computed', 'probe', 'why', 'source']) assert.ok(!raw.includes(`"${word}"`), word);
});

test("round 3: only pranjal's round-3 pantry, no masalas, no hung curd", () => {
  const spices = ['salt', 'sugar', 'honey', 'chilli_flakes', 'oregano', 'chaat_masala', 'black_pepper', 'olive_oil', 'maggi_masala', 'cocoa_powder'];
  const estimated = ['mint', 'tomato_sauce', 'chilli_sauce', 'mayo'];
  for (const d of ROUND3) {
    for (const m of d.modifiers) assert.ok(spices.includes(m) || estimated.includes(m), `${d.id}: ${m}`);
    for (const p of d.parts) assert.ok(PIERRE_RAW.foods[p.id] || PIERRE_RAW.prep[p.id], `${d.id}: ${p.id}`);
  }
  assert.ok(!JSON.stringify(ROUND3).includes('hung_curd'));
  assert.ok(!PIERRE_RAW.foods.hung_curd && PIERRE_RAW.excluded.includes('hung_curd'));
  for (const m of spices) assert.ok(MODIFIERS[m], m);
  assert.ok(PIERRE_RAW.foods.maggi.estimate && PIERRE_RAW.tech['maggi@boiled'].estimate, 'Maggi is an estimate until you rate it');
  for (const id of estimated) assert.ok(PIERRE_RAW.foods[id]?.estimate && PIERRE_RAW.foods[id].texture, `${id} has an estimated profile`);
});
