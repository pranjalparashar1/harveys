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

// Staples pranjal eats as they are (1.20.0) sit under the gate's protein floor. The gate is off by
// default, so they still surface; with it on they're the ones it would hide, and nothing else.
const UNDER_GATE = { maggi: ['only 6 g protein'], masala_oats: ['only 7 g protein'], airfryer_potato_wedges: ['only 6 g protein'] };
test('every catalogue meal passes the nutrition gate when it is on, except the light staples', () => {
  for (const m of CATALOGUE) assert.deepEqual(nutritionProblems(m, GATED), UNDER_GATE[m.id] ?? [], m.id);
});

test('an AI recipe with chicken, tuna or tofu is rejected', () => {
  for (const id of ['chicken', 'tuna', 'tofu']) {
    const r = validateMeal({ ...good, ingredients: [...good.ingredients, { id, amount: '100 g', prep: 'ready' }] });
    assert.equal(r.ok, false, id);
    // Not a known food any more, so Marco can't verify it (tofu is a preference, not a diet rule).
    assert.ok(r.errors.some((e) => e.includes(`"${id}"`)), r.errors.join('; '));
  }
});

test('the AI recipe prompt states the diet', async () => {
  const { recipePrompt } = await import('../src/ai/prompt.js');
  assert.match(recipePrompt({ have: ['paneer'] }), /vegetarian plus eggs only\. No meat, fish or tofu/i);
});

// pranjal's cooking rules ("The staples and their processes", 21 Nov).
const withSteps = (steps, extra = {}) => ({ ...good, steps: steps.map((text) => ({ text, active: 2, passive: 0 })), ...extra });

test('an AI recipe that microwaves eggs, dal or legumes is rejected', () => {
  const mug = validateMeal(withSteps(['Whisk eggs in a mug.', 'Microwave the eggs 90 s.'], {
    equipment: ['microwave'], ingredients: [{ id: 'eggs', amount: '2', prep: 'crack' }, { id: 'salt', amount: 'pinch', prep: 'measure' }],
  }));
  assert.ok(!mug.ok);
  assert.ok(mug.errors.some((e) => /microwaves eggs/.test(e)), mug.errors.join('; '));
  const chole = validateMeal(withSteps(['Microwave the chole with water for 10 min.']));
  assert.ok(chole.errors.some((e) => /microwaves chickpeas/.test(e)), chole.errors.join('; '));
  // The microwave as the only heat, with dal in it, even if the steps don't say so.
  const dal = validateMeal(withSteps(['Cook it all for 8 min.'], { equipment: ['microwave'], ingredients: [{ id: 'dal', amount: '50 g', prep: 'measure' }] }));
  assert.ok(dal.errors.some((e) => /microwaves dal/.test(e)), dal.errors.join('; '));
});

test('microwaving paneer, oats or soya is fine; so are eggs on the stove beside a microwave', () => {
  assert.ok(validateMeal(withSteps(['Microwave the paneer 1 min.'], { equipment: ['microwave'] })).ok);
  const both = validateMeal(withSteps(['Scramble the eggs in the pan.', 'Microwave the bread 20 s.'], {
    equipment: ['microwave', 'stovetop', 'pan'], ingredients: [...good.ingredients, { id: 'eggs', amount: '2', prep: 'crack' }],
  }));
  assert.deepEqual(both.errors.filter((e) => /microwaves/.test(e)), []);
  assert.ok(!validateMeal(withSteps(['Make the bread and egg mix.']), {}).errors.some((e) => /microwaves/.test(e)), 'eggless mayo is not an egg');
});

test('a tadka is oil or ghee, never butter; butter elsewhere is fine', () => {
  const v = validateMeal(withSteps(['Make a tadka: heat butter, add mustard seeds.', 'Pour over the dal.']));
  assert.ok(v.errors.includes('its tadka uses butter (oil or ghee only)'), v.errors.join('; '));
  assert.ok(validateMeal(withSteps(['Make a tadka in ghee with mustard seeds.'])).ok);
  assert.ok(validateMeal(withSteps(['Fry the paneer in butter until golden.'])).ok, 'butter omelette / butter paneer stay allowed');
});
