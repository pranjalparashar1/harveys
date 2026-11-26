// "How do you cook?" (1.59.0): ways stand for kit the brain already ranks with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAYS, NONE, waysFromKit, toggleWay, waysKit, waysOut } from '../src/brain/ways.js';
import { EQUIPMENT } from '../src/brain/vocabulary.js';
import { withConfirmed } from '../src/brain/confirm.js';
import { rank } from '../src/brain/ranker.js';
import { CATALOGUE } from '../src/brain/catalogue.js';
import { encodeRungResult, buildRungQuiz } from '../src/brain/rung-quiz.js';
import { buildInventory } from '../src/brain/inventory.js';

test('every way stands for known kit, and every question has a choice', () => {
  for (const w of WAYS) {
    assert.ok(w.ask.endsWith('?') && w.opts.length >= 3, w.id);
    for (const o of w.opts) for (const k of o.kit) assert.ok(EQUIPMENT[k], `${w.id}.${o.id}: ${k}`);
    assert.equal(new Set(w.opts.map((o) => o.id)).size, w.opts.length, w.id);
  }
});

test('ways start picked from the listed kit; an egg boiler is never assumed', () => {
  const w = waysFromKit(['frying_pan', 'kadai', 'kettle']);
  assert.deepEqual(w.scramble_eggs, ['pan', 'kadai']);
  assert.deepEqual(w.boil_eggs, ['kettle']);
  assert.deepEqual(w.boil_water, ['kettle']);
  assert.deepEqual(w.toast_bread, ['pan']);
  assert.ok(!waysFromKit([]).boil_eggs.includes('egg_boiler'));
});

test('toggling: on, off, and "I don’t" clears the rest', () => {
  let w = toggleWay({}, 'scramble_eggs', 'pan');
  w = toggleWay(w, 'scramble_eggs', 'tawa');
  assert.deepEqual(w.scramble_eggs, ['pan', 'tawa']);
  w = toggleWay(w, 'scramble_eggs', NONE);
  assert.deepEqual(w.scramble_eggs, [NONE]);
  w = toggleWay(w, 'scramble_eggs', 'kadai');
  assert.deepEqual(w.scramble_eggs, ['kadai']);
  w = toggleWay(w, 'scramble_eggs', 'kadai');
  assert.deepEqual(w.scramble_eggs, []);
  assert.equal(toggleWay(w, 'nope', 'pan'), w, 'unknown question');
  assert.equal(toggleWay(w, 'scramble_eggs', 'grill'), w, 'unknown way');
});

test('picked ways give kit once each; I don’t and an egg boiler give none', () => {
  const w = { boil_eggs: ['pot', 'egg_boiler'], scramble_eggs: ['pan', 'pot'], boil_water: [NONE] };
  assert.deepEqual(waysKit(w), ['saucepan', 'frying_pan']);
  assert.deepEqual(waysKit(null), []);
  assert.deepEqual(waysOut({ ...w, junk: ['x'], toast_bread: ['grill'] }), { boil_eggs: ['pot', 'egg_boiler'], scramble_eggs: ['pan', 'pot'], toast_bread: [], boil_water: [NONE] });
});

test('"I scramble eggs in a pan" opens the pan egg dishes in a stove-only kitchen', () => {
  const items = [{ name: 'induction cooktop', category: 'appliance' }, { name: 'eggs' }, { name: 'bread' }, { name: 'butter' }, { name: 'onion' }];
  const ids = (inv) => new Set(rank({ inventory: inv, targets: { protein: 30, kcal: 600 }, context: { hour: 19, kind: 'meal' }, catalogue: CATALOGUE }).ranked.map((r) => r.meal.id));
  const before = ids(buildInventory(items));
  const after = ids(withConfirmed(items, waysKit({ scramble_eggs: ['pan'] })));
  const gained = [...after].filter((id) => !before.has(id));
  assert.ok(gained.includes('plain_omelette') || gained.includes('egg_bhurji'), gained.join(', '));
});

test('a result carries the ways answers', () => {
  const items = [{ name: 'induction cooktop' }, { name: 'eggs' }, { name: 'saucepan' }];
  const inventory = buildInventory(items);
  const quiz = buildRungQuiz({ kitchen: { kitchen: 'T', items }, inventory });
  const answers = { marco: {}, pierre: {}, white: {}, stars: {}, bonusItem: {}, confirm: { have: ['frying_pan'], typed: [], removed: [], ways: { scramble_eggs: ['pan'], boil_eggs: ['egg_boiler'] } } };
  const res = encodeRungResult(quiz, answers, { version: '1.59.0', at: 'x', testerId: 't' });
  assert.deepEqual(res.confirm.ways, { boil_eggs: ['egg_boiler'], scramble_eggs: ['pan'] });
});
