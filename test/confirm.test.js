// 1.39.0 (cookware and typed items 1.41.0): the quick check before Round 1, bare-kitchen dishes, and a strainer that is assumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmCandidates, kitCandidates, withConfirmed, matchTyped, CONFIRM_LIMIT } from '../src/brain/confirm.js';
import { summariseFeedback, feedbackReport } from '../src/brain/feedback.js';
import { kindOf } from '../src/brain/vocabulary.js';
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

test('the food row is food only; cookware has its own row, stoves first when none was seen', () => {
  for (const a of confirmCandidates(BANANA)) assert.equal(kindOf(a.id), 'food', a.id);
  // Purujeet's case (22 Nov): no stove on the list, but he cooks on induction.
  const bare = names(['eggs', 'milk', 'bread', 'maggi', 'rice', 'steel pot']);
  const k = kitCandidates(bare);
  assert.ok(k.noStove);
  assert.deepEqual(k.kit.slice(0, 2).map((a) => a.id), ['gas_stove', 'induction']);
  assert.ok(!k.kit.some((a) => a.id === 'saucepan'), 'a pot was already listed');
  const h = kitCandidates(HARSH);
  assert.ok(!h.noStove && h.hasStove);
  for (const id of ['induction', 'microwave', 'kettle', 'tawa', 'saucepan']) assert.ok(!h.kit.some((a) => a.id === id), id);
  const after = buildInventory([...bare, { name: 'Induction cooktop', canonical: 'induction' }]);
  assert.ok(meals(after) > meals(buildInventory(bare)) + 2, 'tapping induction unlocks the stove dishes');
});

test('typed items go to the closest known thing; nothing close stays as typed', () => {
  const id = (t) => matchTyped(t).id;
  assert.equal(id('induction'), 'induction');
  assert.equal(id('indction'), 'induction');
  assert.equal(id('kettel'), 'kettle');
  assert.equal(id('presure cooker'), 'pressure_cooker');
  assert.equal(id('kadhai'), 'kadai');
  assert.equal(id('tava'), 'tawa');
  assert.equal(id('gas'), 'gas_stove');
  assert.equal(matchTyped('indction').how, 'fuzzy');
  for (const t of ['soy sauce', 'hing', 'tamarind', 'a', '']) assert.equal(id(t), null, t);
  assert.equal(matchTyped('  Soy   sauce ').text, 'Soy sauce');
});

test('the result records cookware, burners and typed items, and the reports flag what is new', () => {
  const bare = names(['eggs', 'milk', 'bread', 'maggi', 'steel pot']);
  const conf = { asked: ['gas_stove', 'induction'], have: ['induction'], typed: [{ text: 'indction', id: 'induction', how: 'fuzzy' }, { text: 'Hing', id: null, how: null }], burners: 2, noStove: true, ms: 1200 };
  const inv = withConfirmed(bare, ['induction'], {}, ['Hing']);
  const quiz = buildRungQuiz({ kitchen: { kitchen: 'Purujeet', items: bare }, inventory: inv });
  const res = encodeRungResult(quiz, { marco: {}, pierre: {}, white: {}, confirm: conf }, { version: 't', at: 'x', testerId: 't1', tester: 'Purujeet' });
  assert.deepEqual(res.confirm.unmatched, ['Hing']);
  assert.equal(res.confirm.burners, 2);
  assert.ok(res.confirm.noStove);
  const s = summariseFeedback([{ ...res, feedback: { chips: ['wrong_items'], missedItems: ['Rice', 'Makhana chaat masala'], wrongItems: [], dishIdeas: [] } }]);
  assert.deepEqual(s.check.fresh.map((e) => e.name), ['Hing', 'Makhana chaat masala'].filter((n) => !matchTyped(n).id));
  assert.ok(s.check.have.some((e) => e.id === 'induction'));
  const md = feedbackReport(s);
  assert.match(md, /New from testers/);
  assert.match(md, /\*\*Hing\*\* \(1\) from quick check: Purujeet/);
  assert.match(md, /No stove on the list:\*\* Purujeet \(Purujeet\) → Induction cooktop/);
  assert.match(md, /Burners at once:\*\* Purujeet 2/);
  // An older file with no check still reports fine.
  assert.doesNotMatch(feedbackReport(summariseFeedback([{ ...res, confirm: null, feedback: null }])), /New from testers/);
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
