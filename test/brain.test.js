import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGUE, DEFAULT_CONFIG, FOODS, EQUIPMENT, ASSUMED_BASICS, CAPABILITIES,
  buildInventory, matchName, rank, contextLambda,
} from '../src/brain/index.js';
import { DEMO_KITCHEN } from '../src/demo-kitchen.js';

const TARGETS = { protein: 40, calories: 800, fiber: 15 };
const TIRED_WEEKNIGHT = { mood: 'tired', hour: 22, weekday: 2 }; // Tuesday 10 pm
const FRESH_SUNDAY = { mood: 'fresh', hour: 12, weekday: 0 };

const positionOf = (result, id) => result.ranked.findIndex((r) => r.meal.id === id);

test('golden: protein bread + cheese beats fusilli aglio olio with paneer on a tired weeknight', () => {
  const result = rank({ inventory: buildInventory(DEMO_KITCHEN), targets: TARGETS, context: TIRED_WEEKNIGHT, catalogue: CATALOGUE });
  const bread = positionOf(result, 'airfryer_protein_cheese_toast');
  const pasta = positionOf(result, 'pasta_aglio_olio_paneer');
  assert.ok(bread >= 0, 'bread toast should be feasible');
  assert.ok(pasta >= 0, 'pasta should be feasible in the demo kitchen');
  assert.ok(bread < pasta, `bread (#${bread + 1}) should rank above pasta (#${pasta + 1})`);
});

test('golden: the bread toast explains itself as 1 tool, no chopping, 20 g protein', () => {
  const result = rank({ inventory: buildInventory(DEMO_KITCHEN), targets: TARGETS, context: TIRED_WEEKNIGHT, catalogue: CATALOGUE });
  const bread = result.ranked.find((r) => r.meal.id === 'airfryer_protein_cheese_toast');
  assert.ok(bread.reasons.includes('1 tool'));
  assert.ok(bread.reasons.includes('no chopping'));
  assert.ok(bread.reasons.includes('20 g protein'));
});

test('the pasta gap narrows when you are fresh on a Sunday', () => {
  const inv = buildInventory(DEMO_KITCHEN);
  const gap = (ctx) => {
    const r = rank({ inventory: inv, targets: TARGETS, context: ctx, catalogue: CATALOGUE });
    const s = (id) => r.ranked.find((x) => x.meal.id === id).score;
    return s('airfryer_protein_cheese_toast') - s('pasta_aglio_olio_paneer');
  };
  assert.ok(gap(FRESH_SUNDAY) < gap(TIRED_WEEKNIGHT));
});

test('missing equipment is a filter, not a weight', () => {
  const noFryer = DEMO_KITCHEN.filter((i) => i.canonical !== 'air_fryer');
  const result = rank({ inventory: buildInventory(noFryer), targets: TARGETS, context: TIRED_WEEKNIGHT, catalogue: CATALOGUE });
  assert.equal(positionOf(result, 'airfryer_protein_cheese_toast'), -1);
  const blocked = result.filtered.find((f) => f.meal.id === 'airfryer_protein_cheese_toast');
  assert.deepEqual(blocked.missing.equipment, ['air_fryer']);
});

test('a capability is met by any of its kit (gas stove instead of induction)', () => {
  const gas = DEMO_KITCHEN.map((i) => (i.canonical === 'induction' ? { name: 'Gas stove', canonical: 'gas_stove' } : i));
  const result = rank({ inventory: buildInventory(gas), targets: TARGETS, context: TIRED_WEEKNIGHT, catalogue: CATALOGUE });
  assert.ok(positionOf(result, 'pasta_aglio_olio_paneer') >= 0);
});

test('anyOf ingredients: a cheese block stands in for slices', () => {
  const inv = buildInventory(['protein bread', 'cheddar', 'air fryer']);
  const result = rank({ inventory: inv, targets: TARGETS, context: TIRED_WEEKNIGHT, catalogue: CATALOGUE });
  const bread = result.ranked.find((r) => r.meal.id === 'airfryer_protein_cheese_toast');
  assert.ok(bread);
  assert.ok(bread.used.ingredients.some((i) => i.id === 'cheese'));
});

test('optional ingredients never filter a meal out', () => {
  const inv = buildInventory(['protein bread', 'cheese slices', 'air fryer']); // no chilli flakes
  const result = rank({ inventory: inv, targets: TARGETS, context: TIRED_WEEKNIGHT, catalogue: CATALOGUE });
  assert.ok(positionOf(result, 'airfryer_protein_cheese_toast') >= 0);
});

test('a basic the user marks missing filters meals that need it', () => {
  const inv = buildInventory(DEMO_KITCHEN, { missingBasics: ['cutting_board'] });
  const result = rank({ inventory: inv, targets: TARGETS, context: TIRED_WEEKNIGHT, catalogue: CATALOGUE });
  assert.equal(positionOf(result, 'pasta_aglio_olio_paneer'), -1);
});

test('λ is higher when tired late on a weeknight than fresh on a weekend', () => {
  assert.ok(contextLambda(TIRED_WEEKNIGHT).value > contextLambda(FRESH_SUNDAY).value);
  assert.deepEqual(contextLambda(TIRED_WEEKNIGHT).parts.map((p) => p.name), ['mood: tired', 'late night', 'weekday']);
});

test('payoff is capped: overshooting the remaining protein earns nothing extra', () => {
  const inv = buildInventory(DEMO_KITCHEN);
  const small = rank({ inventory: inv, targets: { protein: 10, calories: 800, fiber: 15 }, context: TIRED_WEEKNIGHT, catalogue: CATALOGUE });
  for (const r of small.ranked) assert.ok(r.payoff.parts[0].progress <= 1);
});

test('ranking is deterministic', () => {
  const run = () => rank({ inventory: buildInventory(DEMO_KITCHEN), targets: TARGETS, context: TIRED_WEEKNIGHT, catalogue: CATALOGUE })
    .ranked.map((r) => `${r.meal.id}:${r.score.toFixed(6)}`);
  assert.deepEqual(run(), run());
});

test('every score is the sum of its named parts', () => {
  const result = rank({ inventory: buildInventory(DEMO_KITCHEN), targets: TARGETS, context: TIRED_WEEKNIGHT, catalogue: CATALOGUE });
  for (const r of result.ranked) {
    const pay = r.payoff.parts.reduce((a, p) => a + p.value, 0);
    const fr = r.frictionParts.reduce((a, p) => a + p.value, 0);
    assert.ok(Math.abs(r.score - (pay - r.lambda.value * fr)) < 1e-9);
  }
});

test('"buy X to unlock" names the single missing ingredient', () => {
  const noEggs = buildInventory(DEMO_KITCHEN);
  const result = rank({ inventory: noEggs, targets: TARGETS, context: TIRED_WEEKNIGHT, catalogue: CATALOGUE });
  const eggs = result.unlocks.find((u) => u.id === 'eggs');
  assert.ok(eggs, 'eggs should unlock something');
  assert.ok(eggs.meals.length >= 2);
});

test('snack mode only returns snacks', () => {
  const result = rank({ inventory: buildInventory(DEMO_KITCHEN), targets: TARGETS, context: { ...TIRED_WEEKNIGHT, kind: 'snack' }, catalogue: CATALOGUE });
  assert.ok(result.ranked.length > 0);
  assert.ok(result.ranked.every((r) => r.meal.kind === 'snack'));
});

test('name matching handles brands and longer phrases', () => {
  assert.equal(matchName('Amul Butter'), 'butter');
  assert.equal(matchName('Nakpro whey protein'), 'whey');
  assert.equal(matchName('Pintola peanut butter jar'), 'peanut_butter');
  assert.equal(matchName('Philips Air Fryer'), 'air_fryer');
  assert.equal(matchName('nonstick pan'), 'frying_pan');
  assert.equal(matchName('Induction stove'), 'induction');
  assert.equal(matchName('a mystery jar'), null);
});

test('an unknown canonical id from the AI falls back to name matching', () => {
  const inv = buildInventory([{ name: 'Amul paneer', canonical: 'paneer_block' }]);
  assert.ok(inv.have.has('paneer'));
});

test('catalogue only uses known ids and valid prep kinds', () => {
  const kit = new Set([...Object.keys(EQUIPMENT), ...Object.keys(CAPABILITIES)]);
  for (const meal of CATALOGUE) {
    for (const e of meal.equipment) assert.ok(kit.has(e), `${meal.id}: unknown equipment ${e}`);
    for (const u of meal.utensils) assert.ok(ASSUMED_BASICS[u], `${meal.id}: unknown utensil ${u}`);
    for (const ing of meal.ingredients) {
      for (const id of ing.anyOf ?? [ing.id]) assert.ok(FOODS[id], `${meal.id}: unknown food ${id}`);
      assert.ok(ing.prep in DEFAULT_CONFIG.prepWeights, `${meal.id}: unknown prep ${ing.prep}`);
    }
    assert.ok(['meal', 'snack'].includes(meal.kind));
  }
  assert.equal(new Set(CATALOGUE.map((m) => m.id)).size, CATALOGUE.length);
});
