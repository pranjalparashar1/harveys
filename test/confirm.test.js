// 1.39.0: the quick check before Round 1, bare-kitchen dishes, and a strainer that is assumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmCandidates, withConfirmed, CONFIRM_LIMIT } from '../src/brain/confirm.js';
import { buildRungQuiz, encodeRungResult } from '../src/brain/rung-quiz.js';
import { CATALOGUE, buildInventory, checkMeal, rank } from '../src/brain/index.js';

const names = (list) => list.map((name) => ({ name }));
const HARSH = names(['lentils', 'chickpeas', 'eggs', 'milk', 'butter', 'instant noodles', 'sweet corn', 'lemon', 'peanuts', 'induction cooktop', 'microwave', 'electric kettle', 'tawa', 'steel pot']);
const BANANA = names(['eggs', 'milk', 'ghee', 'oats', 'brown bread', 'black salt', 'peanuts', 'blender', 'electric kettle', 'gas stove', 'steel pot']);
const cookable = (items) => buildRungQuiz({ kitchen: { kitchen: 'k', items }, inventory: buildInventory(items) });
const meals = (inv) => rank({ inventory: inv, targets: { protein: 60, calories: 1200, fiber: 20 }, context: { kind: 'meal' }, catalogue: CATALOGUE }).ranked.length;

test('the check asks about what unlocks the most dishes, never what the list already has', () => {
  const ask = confirmCandidates(HARSH);
  assert.ok(ask.length > 0 && ask.length <= CONFIRM_LIMIT);
  const ids = ask.map((a) => a.id);
  for (const id of ['eggs', 'milk', 'tawa', 'dal']) assert.ok(!ids.includes(id), id);
  assert.ok(ids.includes('rice') && ids.includes('onion'));
  for (const a of ask) assert.ok(a.alone > 0 || a.together > 0);
  for (let i = 1; i < ask.length; i++) assert.ok(ask[i - 1].alone >= ask[i].alone);
});

test('a pan, a tawa and a kadai that unlock the same dishes are asked about once', () => {
  const kit = confirmCandidates(BANANA).filter((a) => ['frying_pan', 'kadai', 'tawa'].includes(a.id));
  assert.equal(kit.length, 1);
  assert.equal(kit[0].label, 'A pan, tawa or kadai');
});

test('tapping what you have adds dishes, and the result records the check', () => {
  const before = cookable(BANANA);
  const inv = withConfirmed(BANANA, ['frying_pan', 'rice']);
  const after = buildRungQuiz({ kitchen: { kitchen: 'k', items: BANANA }, inventory: inv });
  assert.equal(after.id, before.id, 'same kitchen, same run');
  assert.ok(meals(inv) > meals(buildInventory(BANANA)) + 2);
  const res = encodeRungResult(after, { marco: {}, pierre: {}, white: {}, confirm: { asked: ['frying_pan', 'rice', 'tea'], have: ['frying_pan', 'rice'], ms: 900 } }, { version: 't', at: 'x', testerId: 't' });
  assert.deepEqual(res.confirm.have, ['frying_pan', 'rice']);
  assert.equal(encodeRungResult(before, { marco: {}, pierre: {}, white: {} }, { version: 't', at: 'x', testerId: 't' }).confirm, null);
});

test('real tester kitchens now get a real list (Harsh and Banana Singh, 22 Nov)', () => {
  const n = (items) => meals(buildInventory(items));
  assert.ok(n(HARSH) >= 7, `Harsh ${n(HARSH)}`); // 4 in 1.37.0
  assert.ok(n(BANANA) >= 6, `Banana ${n(BANANA)}`); // 3 in 1.37.0
  for (const items of [HARSH, BANANA]) assert.ok(Object.values(cookable(items).dishes).every((d) => !d.away), 'no longer a thin kitchen');
});

test('bare-kitchen dishes need only what they say, and a strainer is never a blocker', () => {
  const can = (id, items) => checkMeal(CATALOGUE.find((m) => m.id === id), buildInventory(items)).ok;
  assert.ok(can('egg_drop_maggi', ['maggi', 'eggs', 'induction', 'steel pot']));
  assert.ok(can('kettle_oats', ['oats', 'milk', 'peanuts', 'kettle']));
  assert.ok(can('curd_rice', ['rice', 'curd', 'gas stove', 'steel pot']));
  assert.ok(can('chai_toast', ['tea', 'milk', 'bread', 'butter', 'gas stove', 'steel pot']), 'chai and toast is a meal');
  assert.ok(!can('chai_toast', ['tea', 'milk', 'bread', 'butter', 'gas stove', 'kadhai']), 'chai is never a kadai dish');
  assert.ok(can('egg_fried_rice', ['rice', 'eggs', 'induction', 'steel pot', 'nonstick pan']), 'no strainer listed');
  for (const m of CATALOGUE) assert.ok(!m.equipment.includes('strainer'), m.id);
});
