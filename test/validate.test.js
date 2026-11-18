import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE, buildInventory, rank, validateMeal } from '../src/brain/index.js';
import { nutritionProblems } from '../src/brain/validate.js';
import { DEFAULT_CONFIG } from '../src/brain/config.js';

// The nutrition gate is off by default (pranjal wants odd ideas to surface).
const GATED = { ...DEFAULT_CONFIG, nutritionGate: { ...DEFAULT_CONFIG.nutritionGate, enabled: true } };
import { DEMO_KITCHEN } from '../src/demo-kitchen.js';

const TARGETS = { protein: 40, calories: 800, fiber: 15 };
const TIRED = { mood: 'tired', hour: 22, weekday: 2 };

const good = {
  name: 'Air-fried paneer cheese melt',
  kind: 'meal',
  equipment: ['air_fryer'],
  utensils: ['plate'],
  ingredients: [
    { id: 'protein_bread', amount: '2 slices', prep: 'ready' },
    { id: 'paneer', amount: '50 g, crumbled', prep: 'crumble' },
    { id: 'cheese_slices', amount: '1 slice', prep: 'ready' },
  ],
  steps: [{ text: 'Top bread with paneer and cheese.', active: 2, passive: 0 }, { text: 'Air-fry 5 min.', active: 0.5, passive: 5 }],
  attention: 1,
  cleanup: { dishes: 1, greasy: 0 },
  macros: { protein: 30, kcal: 420, fiber: 6 },
};

test('a sound AI recipe passes and competes in the ranking', () => {
  const v = validateMeal(good, { index: 0 });
  assert.ok(v.ok, v.errors.join('; '));
  const result = rank({ inventory: buildInventory(DEMO_KITCHEN), targets: TARGETS, context: TIRED, catalogue: [...CATALOGUE, v.meal] });
  const pos = result.ranked.findIndex((r) => r.meal.id === v.meal.id);
  assert.ok(pos >= 0);
  assert.equal(result.ranked[pos].payoff.confidence, 0.8);
});

test('an AI recipe needing something you lack is filtered out by the ranker', () => {
  const v = validateMeal({ ...good, ingredients: [...good.ingredients, { id: 'eggs', amount: '2', prep: 'crack' }] });
  assert.ok(v.ok);
  const result = rank({ inventory: buildInventory(DEMO_KITCHEN), targets: TARGETS, context: TIRED, catalogue: [v.meal] });
  assert.equal(result.ranked.length, 0);
  assert.deepEqual(result.filtered[0].missing.ingredients, [['eggs']]);
});

test('unknown ingredients or kit are rejected: Marco must be able to check them', () => {
  const v = validateMeal({ ...good, ingredients: [...good.ingredients, { id: 'truffle_oil', amount: '1 tsp', prep: 'measure' }], equipment: ['sous_vide'] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('truffle_oil')));
  assert.ok(v.errors.some((e) => e.includes('sous_vide')));
});

test('impossible macros are rejected', () => {
  const v = validateMeal({ ...good, macros: { protein: 60, kcal: 150, fiber: 0 } });
  assert.equal(v.ok, false);
  assert.ok(v.errors[0].includes("don't add up"));
});

test('the AI cannot make a recipe look easier than it is', () => {
  const v = validateMeal({
    ...good,
    equipment: ['stovetop', 'pan'],
    utensils: [],
    ingredients: [{ id: 'onion', amount: '1', prep: 'peel_chop' }, { id: 'eggs', amount: '3', prep: 'crack' }],
    steps: [{ text: 'Chop, fry, scramble.', active: 0, passive: 0 }],
    cleanup: { dishes: 0, greasy: 0 },
  });
  assert.ok(v.ok, v.errors.join('; '));
  assert.ok(v.meal.utensils.includes('knife') && v.meal.utensils.includes('cutting_board'));
  assert.ok(v.meal.cleanup.dishes >= 3); // pan + knife + board
  assert.equal(v.meal.steps[0].active, 0.5);
  assert.ok(v.adjustments.length >= 3);
});

test('garbage in is rejected, not thrown', () => {
  for (const junk of [null, 'pasta', {}, { name: 'x', ingredients: 'all of them' }]) {
    const v = validateMeal(junk);
    assert.equal(v.ok, false);
  }
});

// 1.3.4: a real iPhone scan found only butter, salt and oil, and the AI's
// "Microwave Butter Salt Bowl" (1 g protein, 717 kcal) became Marco's pick.
const BUTTER_SALT_BOWL = {
  name: 'Microwave Butter Salt Bowl', kind: 'meal',
  equipment: ['microwave', 'kitchen_scale'], utensils: ['bowl', 'spoon'],
  ingredients: [{ id: 'butter', amount: '100g', prep: 'measure' }, { id: 'salt', amount: '2g', prep: 'measure' }],
  steps: [{ text: 'Weigh butter.', active: 1 }, { text: 'Microwave until melted.', active: 0.5, passive: 1 }, { text: 'Stir in salt and eat.', active: 1 }],
  attention: 0, cleanup: { dishes: 1, greasy: 2 }, macros: { protein: 1, kcal: 717, fiber: 0 },
};

test('by default the gate is off: the butter-and-salt bowl is allowed to compete', () => {
  assert.equal(DEFAULT_CONFIG.nutritionGate.enabled, false);
  assert.equal(validateMeal(BUTTER_SALT_BOWL, { kind: 'meal' }).ok, true);
});

test('golden (gate on): the butter-and-salt bowl is rejected, with a reason', () => {
  const v = validateMeal(BUTTER_SALT_BOWL, { kind: 'meal', config: GATED });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /protein/.test(e)), v.errors.join('; '));
  assert.ok(v.errors.includes('only fats, spices or spreads'));
});

test('golden (gate on): even if it slipped through, the ranker never picks it', () => {
  const meal = { ...validateMeal(BUTTER_SALT_BOWL).meal, origin: 'ai' };
  const inv = buildInventory(['butter', 'salt', 'cooking oil', 'kitchen scale', 'microwave', 'air fryer']);
  const result = rank({ inventory: inv, targets: { protein: 40, calories: 800, fiber: 15 }, context: TIRED, catalogue: [...CATALOGUE, meal], config: GATED });
  assert.equal(result.ranked.some((r) => r.meal.id === meal.id), false);
});

test('golden (gate on): high-calorie, low-protein dishes fail; lean high-protein ones pass', () => {
  const base = { ...BUTTER_SALT_BOWL, ingredients: [{ id: 'oats', amount: '60 g', prep: 'measure' }, { id: 'butter', amount: '40 g', prep: 'measure' }] };
  assert.equal(validateMeal({ ...base, macros: { protein: 10, kcal: 650, fiber: 5 } }, { config: GATED }).ok, false, '65 kcal per g protein');
  assert.equal(validateMeal({ ...base, ingredients: [{ id: 'whey', amount: '1 scoop', prep: 'ready' }, { id: 'makhana', amount: '1 cup', prep: 'measure' }], macros: { protein: 28, kcal: 260, fiber: 2 } }, { config: GATED }).ok, true);
});

test('every catalogue meal passes the nutrition gate when it is on', () => {
  for (const m of CATALOGUE) assert.deepEqual(nutritionProblems(m, GATED), [], m.id);
});
