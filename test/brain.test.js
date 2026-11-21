import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGUE, DEFAULT_CONFIG, FOODS, PREP_KINDS, EQUIPMENT, ASSUMED_BASICS, CAPABILITIES, inDiet, scoreMeal, checkMeal, validateMeal,
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

test('with no mood, λ is neutral on mood and still follows the clock', () => {
  const noMood = contextLambda({ hour: 22, weekday: 2 });
  assert.deepEqual(noMood.parts.map((p) => p.name), ['late night', 'weekday']);
  assert.equal(noMood.value, contextLambda({ mood: 'okay', hour: 22, weekday: 2 }).value);
  assert.ok(Number.isFinite(rank({ inventory: buildInventory(DEMO_KITCHEN), targets: TARGETS, context: { hour: 19, weekday: 3 }, catalogue: CATALOGUE }).ranked[0].score));
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
      assert.ok(PREP_KINDS.includes(ing.prep), `${meal.id}: unknown prep ${ing.prep}`);
    }
    assert.ok(['meal', 'snack'].includes(meal.kind));
  }
  assert.equal(new Set(CATALOGUE.map((m) => m.id)).size, CATALOGUE.length);
});

test("golden: pranjal's real kitchen (18 Nov) picks the whey and makhana bowl", () => {
  // What the 1.3.4 scan found in the 6 real photos (perception measured at 16–19 of 19).
  const inv = buildInventory(['whey', 'makhana', 'oats', 'chickpeas', 'rice', 'pasta', 'onion', 'garlic', 'tomato',
    'butter', 'oil', 'salt', 'black pepper', 'honey', 'air fryer', 'microwave', 'kitchen scale', 'frying pan', 'blender']);
  for (const context of [{ hour: 22, weekday: 2 }, { hour: 19, weekday: 3 }, { hour: 13, weekday: 0 }]) {
    const result = rank({ inventory: inv, targets: TARGETS, context: { kind: 'meal', ...context }, catalogue: CATALOGUE });
    assert.equal(result.ranked[0].meal.id, 'whey_makhana_bowl', JSON.stringify(context));
  }
});

// ── v2 Step 1: diet and Friction v2 in the live ranker ──────────────────────

test('every catalogue meal is vegetarian plus eggs, and tofu is gone', () => {
  for (const meal of CATALOGUE) {
    assert.ok(inDiet(meal), meal.id);
    for (const ing of meal.ingredients) assert.ok(!(ing.anyOf ?? [ing.id]).includes('tofu'), meal.id);
  }
  for (const id of ['chicken', 'tuna', 'tofu']) assert.equal(FOODS[id], undefined, id);
});

test('a kitchen with chicken, tuna and tofu never gets a meal using them', () => {
  const inv = buildInventory([...DEMO_KITCHEN, 'chicken breast', 'canned tuna', 'tofu']);
  for (const id of ['chicken', 'tuna', 'tofu']) assert.ok(!inv.have.has(id), `${id} should not map to an id`);
  // Even a meal that reached the ranker some other way is dropped.
  const sneaky = { ...CATALOGUE[0], id: 'sneaky_chicken', ingredients: [{ id: 'chicken', amount: '1', prep: 'ready' }] };
  const result = rank({ inventory: { ...inv, have: new Set([...inv.have, 'chicken']) }, targets: TARGETS, context: TIRED_WEEKNIGHT, catalogue: [...CATALOGUE, sneaky] });
  assert.ok(!result.ranked.some((r) => r.meal.id === 'sneaky_chicken'));
  assert.ok(!result.filtered.some((f) => f.meal.id === 'sneaky_chicken'), 'not even offered as "buy X to unlock"');
});

test('Friction v2: the stove is not a tool on top of its pan; peels and cuts are apart', () => {
  const inv = buildInventory(['induction', 'pot', 'pan', 'strainer', 'air fryer', 'pasta', 'paneer', 'garlic', 'oil', 'salt']);
  const meal = CATALOGUE.find((m) => m.id === 'pasta_aglio_olio_paneer');
  const used = checkMeal(meal, inv);
  assert.ok(used.ok);
  assert.ok(used.equipment.includes('induction'));
  const { raw, frictionParts } = scoreMeal(meal, used, TARGETS, contextLambda({}));
  const kit = used.equipment.filter((e) => e !== 'induction').length + used.utensils.filter((u) => !['plate', 'spoon', 'fork', 'mug'].includes(u)).length;
  assert.equal(raw.tools, kit, 'induction is not counted');
  assert.equal(raw.peels, 1); // garlic
  assert.equal(raw.cuts, 1); // paneer cubes
  assert.deepEqual(frictionParts.map((p) => p.name), ['tools', 'handsOn', 'waiting', 'prePrep', 'peels', 'cuts', 'steps', 'attention', 'cleanup']);
  for (const p of frictionParts) assert.ok(p.value >= 0, `${p.name} adds friction`);
});

test('Friction v2: overnight soaking costs more than none, and is not capped away', () => {
  const inv = buildInventory(['chickpeas', 'onion', 'tomato', 'lemon', 'chaat masala']);
  const meal = CATALOGUE.find((m) => m.id === 'chana_chaat');
  const used = checkMeal(meal, inv);
  assert.ok(used.ok);
  const soak = scoreMeal(meal, used, TARGETS, contextLambda({})).frictionParts.find((p) => p.name === 'prePrep');
  const none = scoreMeal({ ...meal, prePrep: undefined }, used, TARGETS, contextLambda({})).frictionParts.find((p) => p.name === 'prePrep');
  assert.ok(soak.value > none.value);
  assert.ok(soak.normalised > 1, 'overnight is 5 units on a scale of 1, not clamped');
});

test('AI recipes still validate with the new prep kinds, and get a knife for a cut', () => {
  const r = validateMeal({
    name: 'Paneer cubes with chaat masala', kind: 'meal', equipment: [], utensils: ['plate'],
    ingredients: [{ id: 'paneer', amount: '150 g', prep: 'cut' }, { id: 'chaat_masala', amount: '1 tsp', prep: 'measure' }],
    steps: [{ text: 'Cube and sprinkle.', active: 2 }], attention: 0, cleanup: { dishes: 1, greasy: 0 },
    macros: { protein: 27, kcal: 400, fiber: 0 },
  });
  assert.ok(r.ok, r.errors.join('; '));
  assert.equal(r.meal.ingredients[0].prep, 'cut');
  assert.ok(r.meal.utensils.includes('knife'));
});

// ── v2 Step 5A: Pierre in the live ranker ──────────────────────────────────
const EGG_KITCHEN = () => buildInventory([...DEMO_KITCHEN, 'eggs', 'soya chunks', 'curd']);
const rankAll = (inventory, extra = {}) => rank({ inventory, targets: TARGETS, context: { hour: 19, weekday: 3, kind: 'any' }, catalogue: CATALOGUE, ...extra });

test('5A: a vetoed dish never reaches ranked, and is listed in vetoed', () => {
  const r = rankAll(EGG_KITCHEN());
  for (const id of ['mug_omelette', 'soya_chunk_curd_bowl']) {
    assert.equal(positionOf(r, id), -1, `${id} should not be ranked`);
    assert.ok(r.vetoed.some((v) => v.meal.id === id), `${id} should be in vetoed`);
  }
  assert.ok(r.ranked.every((x) => x.pierre.tier !== 'veto'));
});

test('5A: crave ranks above pass, pass above floor, whatever the score', () => {
  const r = rankAll(EGG_KITCHEN(), { verdicts: { boiled_eggs: { tier: 'crave' }, whey_milk_shake: { tier: 'floor' }, mug_omelette: { verdict: 'fail' } } });
  const order = { crave: 3, pass: 2, floor: 1 };
  for (let i = 1; i < r.ranked.length; i++) assert.ok(order[r.ranked[i - 1].pierre.tier] >= order[r.ranked[i].pierre.tier], `#${i} ${r.ranked[i - 1].meal.id} before ${r.ranked[i].meal.id}`);
  assert.equal(r.ranked[0].meal.id, 'boiled_eggs');
  assert.equal(r.ranked.find((x) => x.meal.id === 'whey_milk_shake').pierre.tier, 'floor');
});

test('5A: every floor dish carries a one-line hint, and pass/crave dishes none', () => {
  const r = rankAll(EGG_KITCHEN());
  assert.ok(r.ranked.some((x) => x.pierre.tier === 'floor'));
  for (const x of r.ranked) {
    if (x.pierre.tier === 'floor') assert.ok(typeof x.pierre.hint === 'string' && x.pierre.hint.length > 0, x.meal.id);
    else assert.equal(x.pierre.hint, null, x.meal.id);
  }
  const bhurji = r.ranked.find((x) => x.meal.id === 'microwave_paneer_bhurji');
  assert.match(bhurji.pierre.hint, /^Lift it: \+ /);
});

test('5A: a meal without Pierre parts (an AI recipe) is ranked, marked untested', () => {
  const ai = { ...CATALOGUE.find((m) => m.id === 'whey_milk_shake'), id: 'ai_shake', origin: 'ai', parts: undefined, form: undefined };
  const r = rank({ inventory: buildInventory(DEMO_KITCHEN), targets: TARGETS, context: { hour: 19, weekday: 3, kind: 'any' }, catalogue: [ai] });
  assert.equal(r.ranked[0].pierre.untested, true);
  assert.equal(r.ranked[0].pierre.tier, 'pass');
});

test('5A: chana chaat (chickpeas boiled ahead) is not vetoed as raw', () => {
  const inv = buildInventory([...DEMO_KITCHEN, 'chickpeas', 'onion', 'lemon', 'chaat masala']);
  const r = rankAll(inv);
  assert.ok(positionOf(r, 'chana_chaat') >= 0);
});

test('5A: "one thing to buy" never unlocks a dish Pierre vetoes', () => {
  const r = rankAll(buildInventory(DEMO_KITCHEN));
  for (const u of r.unlocks) assert.ok(!u.meals.includes('Microwave mug omelette'), u.label);
});

// ── v2 Step 5B: White's effort ladder ──────────────────────────────────────
import { rungOf, buildLadder, cookLogEntry, liveRepairEntry, liveVerdicts } from '../src/brain/index.js';
const meal = (id) => CATALOGUE.find((m) => m.id === id);
const WED_7PM = { hour: 19, weekday: 3 };
const BIG = { protein: 60, calories: 1200, fiber: 20 };

test('5B: fixed rung assignments', () => {
  const want = {
    whey_milk_shake: 1, whey_makhana_bowl: 1, airfryer_protein_cheese_toast: 2, microwave_paneer_bhurji: 2,
    stovetop_paneer_bhurji: 3, pasta_aglio_olio_paneer: 4, chana_chaat: 3,
  };
  for (const [id, rung] of Object.entries(want)) assert.equal(rungOf(meal(id)), rung, id);
});

test('5B: chana chaat keeps its attention rung and carries the pre-prep note', () => {
  const inv = buildInventory([...DEMO_KITCHEN, 'chickpeas', 'onion', 'lemon', 'chaat masala']);
  const r = rank({ inventory: inv, targets: BIG, context: WED_7PM, catalogue: CATALOGUE });
  const c = r.ranked.find((x) => x.meal.id === 'chana_chaat');
  assert.equal(c.rung, 3);
  assert.match(c.prePrepNote, /Soak/);
});

test('5B precedence: two closed appliances juggle (rung 4); a no-cook dish with a cut stands (rung 3)', () => {
  const two = { equipment: ['microwave', 'air_fryer'], utensils: [], ingredients: [], steps: [{ text: 'Heat.', active: 1 }], attention: 1 };
  assert.equal(rungOf(two), 4);
  const cut = { equipment: [], utensils: ['knife'], ingredients: [{ id: 'tomato', prep: 'peel_chop' }], steps: [{ text: 'Slice.', active: 2 }], attention: 0 };
  assert.equal(rungOf(cut), 3);
});

test('5B within a rung: a higher-protein pass beats a lower-protein pass with slightly less friction', () => {
  const base = meal('stovetop_paneer_bhurji');
  const lean = { ...base, id: 'lean', macros: { ...base.macros, protein: 12 }, steps: base.steps.slice(0, -1) };
  const rich = { ...base, id: 'rich', macros: { ...base.macros, protein: 30 } };
  const inv = buildInventory([...DEMO_KITCHEN, 'onion']);
  const r = rank({ inventory: inv, targets: BIG, context: WED_7PM, catalogue: [lean, rich], verdicts: {} });
  const rich3 = r.ranked.find((x) => x.meal.id === 'rich');
  const lean3 = r.ranked.find((x) => x.meal.id === 'lean');
  assert.equal(rich3.rung, 3);
  assert.equal(lean3.rung, 3);
  assert.equal(rich3.pierre.tier, lean3.pierre.tier);
  assert.ok(lean3.friction < rich3.friction, 'lean is a little less effort');
  assert.equal(r.ladder.find((g) => g.rung === 3).pick.meal.id, 'rich');
});

test('5B small pantry: only no-cook dishes gives a rung-1-only ladder', () => {
  const r = rank({ inventory: buildInventory(['whey', 'milk', 'makhana']), targets: BIG, context: { ...WED_7PM, kind: 'any' }, catalogue: CATALOGUE });
  assert.ok(r.ladder.length >= 1);
  assert.deepEqual(r.ladder.map((g) => g.rung), [1]);
});

test('5B: no vetoed dish appears on any rung', () => {
  const r = rank({ inventory: buildInventory([...DEMO_KITCHEN, 'eggs', 'soya chunks', 'curd']), targets: BIG, context: { ...WED_7PM, kind: 'any' }, catalogue: CATALOGUE });
  assert.ok(r.vetoed.length >= 2);
  const vetoed = new Set(r.vetoed.map((v) => v.meal.id));
  for (const g of r.ladder) for (const x of [g.pick, ...g.alternatives]) assert.ok(!vetoed.has(x.meal.id) && x.pierre.tier !== 'veto', x.meal.id);
});

test('5B ladder trace: demo kitchen, Wednesday 7 PM: whey on 1, toast on 2, sandwich on 3, aglio olio on 4', () => {
  const r = rank({ inventory: buildInventory(DEMO_KITCHEN), targets: BIG, context: WED_7PM, catalogue: CATALOGUE });
  const pick = Object.fromEntries(r.ladder.map((g) => [g.rung, g.pick.meal.id]));
  assert.deepEqual(r.ladder.map((g) => g.rung), [1, 2, 3, 4]);
  assert.match(pick[1], /whey/);
  assert.equal(pick[2], 'airfryer_protein_cheese_toast');
  assert.match(pick[3], /sandwich/);
  assert.equal(pick[4], 'pasta_aglio_olio_paneer');
  assert.ok(r.ladder.find((g) => g.rung === 2).alternatives.some((a) => a.meal.id === 'microwave_paneer_bhurji'));
});

test('5B assembly line: a dish one finishing step from done gets a closing step', () => {
  const r = rank({ inventory: buildInventory(DEMO_KITCHEN), targets: BIG, context: WED_7PM, catalogue: CATALOGUE });
  const bhurji = r.ranked.find((x) => x.meal.id === 'microwave_paneer_bhurji');
  assert.match(bhurji.assemblyStep, /^Finish the paneer with .*butter/);
});

test('5B export round trip: cookLog and liveRepairs serialise for "Copy for Claude"', () => {
  const r = rank({ inventory: buildInventory(DEMO_KITCHEN), targets: BIG, context: WED_7PM, catalogue: CATALOGUE });
  const g2 = r.ladder.find((g) => g.rung === 2);
  const chosen = g2.alternatives[0];
  const entry = cookLogEntry({ chosen, ladder: r.ladder, context: { kind: 'meal', ...WED_7PM }, at: '2026-11-21T19:00:00Z' });
  assert.equal(entry.dishId, chosen.meal.id);
  assert.equal(entry.rung, 2);
  assert.equal(entry.ladderShown.length, r.ladder.length);
  assert.ok(entry.alternativesShown.some((a) => a.id === g2.pick.meal.id), 'the rung pick you skipped is recorded');
  assert.ok(!entry.alternativesShown.some((a) => a.id === chosen.meal.id));
  const fix = liveRepairEntry({ item: g2.pick, tier: 'veto', fix: 'too dry', at: '2026-11-21T19:01:00Z' });
  const json = JSON.parse(JSON.stringify({ cookLog: [entry], liveRepairs: [fix] }));
  assert.deepEqual(json.cookLog[0], entry);
  assert.equal(json.liveRepairs[0].chain.anchor.id, 'bread');
  // A live veto applies at once.
  const again = rank({ inventory: buildInventory(DEMO_KITCHEN), targets: BIG, context: WED_7PM, catalogue: CATALOGUE, verdicts: liveVerdicts([fix]) });
  assert.ok(again.vetoed.some((v) => v.meal.id === g2.pick.meal.id));
});

test('5C: fitted friction weights are costs (none positive) and cover every friction feature', async () => {
  const { FEATURES } = await import('../src/brain/learn.js');
  const keys = FEATURES.filter((f) => !f.payoff).map((f) => f.key).sort();
  assert.deepEqual(Object.keys(DEFAULT_CONFIG.frictionTheta).sort(), keys);
  for (const k of keys) assert.ok(DEFAULT_CONFIG.frictionTheta[k] <= 0, `${k} = ${DEFAULT_CONFIG.frictionTheta[k]}`);
});
