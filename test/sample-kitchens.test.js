// 1.52.0: the 10-sample-kitchen batch prep (Fable's handoff, 24 Nov): thin-kitchen dishes,
// a fair priorHits, the three batch checks, and the additive kitchenSource on a result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CATALOGUE, buildInventory } from '../src/brain/index.js';
import { inDiet, fitMarco, FEATURES, featureVector, rawFeatures } from '../src/brain/learn.js';
import { cookingRuleProblems } from '../src/brain/validate.js';
import { pierreTier, FORMS } from '../src/brain/ingredients.js';
import { checkMeal, judgeMeal } from '../src/brain/ranker.js';
import { loadKitchens } from '../src/brain/kitchen-test.js';
import { DEFAULT_CONFIG } from '../src/brain/config.js';
import { buildRungQuiz, encodeRungResult, batchChecks, batchCheckLines, isEggDish, isAirFryerDish, todayOrder, RUNG_FORMAT } from '../src/brain/rung-quiz.js';

const THIN = ['dahi_poha', 'butter_cheese_sandwich', 'pb_banana_sandwich', 'kettle_banana_peanut_oats', 'banana_shake',
  'cheese_pasta_pot', 'maggi_boiled_eggs', 'airfryer_masala_paneer', 'airfryer_potato_wedges', 'banana_oats_shake'];
const PAN = new Set(['pan', 'frying_pan', 'tawa', 'kadai']);
const needsOnion = (m) => m.ingredients.some((i) => !i.optional && (i.anyOf ?? [i.id]).every((x) => x === 'onion' || x === 'spring_onion'));
const noPanNoOnion = (m) => !(m.equipment ?? []).some((e) => PAN.has(e)) && !needsOnion(m);

test('thin kitchens: the 10 new dishes need no pan and no onion, and pass every rule', () => {
  for (const id of THIN) {
    const m = CATALOGUE.find((d) => d.id === id);
    assert.ok(m, id);
    assert.ok(noPanNoOnion(m), `${id} needs a pan or an onion`);
    assert.ok(inDiet(m), id);
    assert.deepEqual(cookingRuleProblems(m), [], id);
    assert.ok(FORMS[m.form], `${id}: form ${m.form}`);
    assert.ok(Array.isArray(m.parts) && m.parts.length, `${id}: parts`);
    assert.notEqual(pierreTier(m.parts, m.form).computed, 'veto', id);
    assert.ok(m.steps.length && m.steps.every((s) => s.text && s.active >= 0), id);
    assert.ok(Number.isInteger(m.attention) && m.cleanup.dishes >= 1 && m.macros.protein > 0 && m.macros.kcal > 0, id);
    // No microwaved eggs, dal or legumes; no butter tadka; vegetarian plus eggs.
    assert.ok(!m.ingredients.some((i) => (i.anyOf ?? [i.id]).some((x) => ['chicken', 'tuna', 'tofu', 'fish', 'meat'].includes(x))), id);
  }
  assert.equal(new Set(CATALOGUE.map((m) => m.id)).size, CATALOGUE.length, 'no duplicate ids');
});

test('thin kitchens: Pierre never vetoes them as made in a kitchen that has their parts', () => {
  const inv = buildInventory(['bread', 'cheese slices', 'butter', 'peanut butter', 'banana', 'oats', 'peanuts', 'milk', 'curd', 'poha',
    'pasta', 'ketchup', 'maggi', 'eggs', 'paneer', 'potato', 'red chilli powder', 'kettle', 'blender', 'air fryer', 'induction', 'saucepan']);
  for (const id of THIN) {
    const m = CATALOGUE.find((d) => d.id === id);
    const used = checkMeal(m, inv);
    assert.ok(used.ok, `${id}: ${JSON.stringify(used.missing)}`);
    assert.notEqual(judgeMeal(m, used, inv).tier, 'veto', id);
  }
});

test('thin kitchens: at least 8 catalogue dishes need neither a pan nor an onion, beyond what was there', () => {
  assert.ok(CATALOGUE.filter(noPanNoOnion).length >= 8);
  assert.ok(THIN.length >= 8 && THIN.length <= 10);
});

test('thin kitchens: a hostel kettle kitchen and a one-pot kitchen get a real list', () => {
  const dishes = (items) => Object.keys(buildRungQuiz({ kitchen: { kitchen: 'k', items: items.map((name) => ({ name })) }, inventory: buildInventory(items) }).dishes);
  const kettle = dishes(['kettle', 'oats', 'banana', 'peanuts', 'bread', 'peanut butter', 'curd', 'poha']);
  for (const id of ['kettle_banana_peanut_oats', 'pb_banana_sandwich', 'dahi_poha']) assert.ok(kettle.includes(id), id);
  const pot = dishes(['induction', 'saucepan', 'maggi', 'eggs', 'pasta', 'cheese slices', 'ketchup']);
  for (const id of ['maggi_boiled_eggs', 'cheese_pasta_pot']) assert.ok(pot.includes(id), id);
});

test('cook-first exception: raw oats pass in a shake, and only there (pranjal, 24 Nov)', () => {
  const shake = CATALOGUE.find((d) => d.id === 'banana_oats_shake');
  assert.equal(pierreTier(shake.parts, shake.form).tier, 'pass');
  // Everywhere else oats stay cook-first: a raw-oat bowl or cold bowl still vetoes.
  for (const form of ['bowl', 'cold_bowl', 'one-pot']) assert.equal(pierreTier([{ id: 'oats' }, { id: 'milk' }, { id: 'banana' }], form).tier, 'veto', form);
  // Other cook-first foods get no pass in a shake: raw poha does not.
  assert.equal(pierreTier([{ id: 'milk' }, { id: 'banana' }, { id: 'poha' }], 'shake').tier, 'veto');
  // The rule is a switch in config: without the exception the shake vetoes again.
  const rules = { ...DEFAULT_CONFIG.pierreRules, cookFirstExceptions: [] };
  assert.equal(pierreTier(shake.parts, shake.form, { rules }).tier, 'veto');
});

test('priorHits: fixed weights get their own fitted threshold, so they are scored like the fit', () => {
  const pool = CATALOGUE.filter(inDiet).slice(0, 20).map((d) => featureVector(rawFeatures(d), 0.75));
  // Every pick is "neither" (would cook neither): with outside pinned at 0 the prior called every
  // one wrongly; with its own threshold it can say "neither" too.
  const neither = [];
  for (let i = 0; i + 1 < pool.length; i += 2) neither.push({ xa: pool[i], xb: pool[i + 1], pick: 'neither', mood: 'okay' });
  const f = fitMarco(neither);
  assert.ok(f.priorHits >= f.hits - 1, `prior ${f.priorHits} vs fit ${f.hits}`);
  assert.ok(f.priorHits > 0);
  assert.equal(f.pairN, 0);
  // Strict a/b picks: the prior, used as the generator, is right on every pair whatever the threshold.
  const theta = FEATURES.map((x) => x.prior);
  const u = (x) => x.reduce((s, v, j) => s + v * theta[j], 0);
  const ab = [];
  for (let i = 0; i + 1 < pool.length; i++) ab.push({ xa: pool[i], xb: pool[i + 1], pick: u(pool[i]) >= u(pool[i + 1]) ? 'a' : 'b', mood: 'okay' });
  const g = fitMarco(ab);
  assert.equal(g.pairN, ab.length);
  assert.equal(g.priorPairHits, ab.length);
  assert.ok(g.priorHits >= g.priorPairHits - 2, `${g.priorHits} vs ${g.priorPairHits}`);
  assert.ok(Number.isFinite(g.priorOutside));
});

// Synthetic star results: two testers, Harvey's order stored in each result.
const dish = (id, name, rung, friction, tier = 'pass') => [id, { name, rung, harveys: { tier, friction } }];
const resultA = {
  format: RUNG_FORMAT, flow: 'stars', tester: 'A', testerId: 't-a',
  dishes: Object.fromEntries([dish('boiled_eggs', 'Boiled eggs', 2, 1), dish('curd_whey_bowl', 'Curd and whey', 1, 0.2), dish('airfryer_masala_paneer', 'Air-fried paneer', 2, 2), dish('pot_khichdi', 'Khichdi', 3, 3)]),
  stars: [{ id: 'boiled_eggs', effort: 2, taste: 3 }, { id: 'curd_whey_bowl', effort: 5, taste: 2 }, { id: 'airfryer_masala_paneer', effort: 5, taste: 5 }, { id: 'pot_khichdi', effort: 1, taste: 5 }],
};
const resultB = {
  format: RUNG_FORMAT, flow: 'stars', tester: 'B', testerId: 't-b',
  dishes: Object.fromEntries([dish('whey_milk_shake', 'Whey shake', 1, 0.1), dish('pb_protein_toast', 'PB toast', 1, 0.3), dish('egg_rice', 'Egg rice', 3, 2.5)]),
  stars: [{ id: 'whey_milk_shake', effort: 5, taste: 4 }, { id: 'pb_protein_toast', effort: 4, taste: 4 }, { id: 'egg_rice', effort: 3, taste: 4 }],
};

test('batch checks: eggs, air fryer and easy vs tasty on synthetic star results', () => {
  assert.ok(isEggDish('boiled_eggs') && isEggDish('maggi_boiled_eggs') && !isEggDish('curd_whey_bowl'));
  assert.ok(isEggDish('ai_x', 'Egg toast') && !isEggDish('ai_y', 'Veggie toast'));
  assert.ok(isAirFryerDish('airfryer_masala_paneer') && !isAirFryerDish('pot_khichdi'));
  const b = batchChecks([resultA, resultB]);
  // A: whey and the air-fried paneer tie on effort, so 5 pairs apart. Egg pairs: eggs vs whey
  // (Harvey agrees), vs the paneer (rated 5 vs 2 but Harvey has eggs easier: disagrees), vs khichdi
  // (agrees). Plain: whey vs khichdi, paneer vs khichdi (both agree). B: all three agree, 2 with egg rice.
  assert.deepEqual([b.eggs.egg.agree, b.eggs.egg.pairs], [4, 5]);
  assert.deepEqual([b.eggs.plain.agree, b.eggs.plain.pairs], [3, 3]);
  assert.equal(b.eggs.meanEffort, 2.5);
  // Air fryer: one dish, 5 stars, in 2 pairs apart; rated easier than the eggs where Harvey has it harder.
  assert.equal(b.airFryer.meanEffort, 5);
  assert.equal(b.airFryer.pairs, 2);
  assert.equal(b.airFryer.easierThanHarvey, 1);
  // Easy vs tasty: A's easiest two (Harvey) are whey (2★) and eggs (3★): 2.5 vs 5; B's 4 vs 4.
  assert.equal(b.easyTasty.n, 2);
  assert.deepEqual(b.easyTasty.testers.map((t) => [t.tester, t.easiestTaste, t.restTaste]), [['A', 2.5, 5], ['B', 4, 4]]);
  assert.equal(b.easyTasty.lowTaste, 1);
  const lines = batchCheckLines(b);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Eggs:/);
  assert.match(lines[1], /^Air fryer:/);
  assert.match(lines[2], /^Easy vs tasty:.*1 of 2 tester/);
  // A result with no stars (older flows) is left out, not a crash.
  assert.equal(batchChecks([{ format: RUNG_FORMAT, dishes: {}, marco: [] }]).easyTasty.n, 0);
});

test('batch checks: dishesFor swaps in another Harvey order (today\'s brain)', () => {
  const flipped = (r) => Object.fromEntries(Object.entries(r.dishes).map(([id, d]) => [id, { ...d, harveys: { ...d.harveys, friction: -d.harveys.friction }, rung: 1 }]));
  assert.notDeepEqual(batchChecks([resultA], { dishesFor: flipped }).eggs, batchChecks([resultA]).eggs);
  const real = JSON.parse(readFileSync(new URL('../data/kitchen-tests/taste-2026-11-23-kitchen_video_1-m0xa7-t-76mnjcvim.json', import.meta.url), 'utf8'));
  const today = todayOrder(real);
  for (const s of real.stars) assert.ok(today[s.id], `${s.id} is still cookable in Purujeet's confirmed kitchen`);
});

test('kitchen-tests.mjs score runs cleanly on data/kitchen-tests and prints the batch checks and a fair priorHits', () => {
  const out = execFileSync('node', [new URL('../scripts/kitchen-tests.mjs', import.meta.url).pathname, 'score'], { encoding: 'utf8' });
  assert.match(out, /# Batch checks over \d+ star-rated result/);
  assert.match(out, /^Eggs: /m);
  assert.match(out, /^Air fryer: /m);
  assert.match(out, /^Easy vs tasty: /m);
  // Leave-one-out is skipped past 150 picks (learn.js), which the 25 Nov testers crossed: '-' then.
  const m = /Marco: (\d+) picks, fit (\d+), leave-one-out (\d+|-), today's weights (\d+)/.exec(out);
  assert.ok(m, out.slice(-800));
  assert.ok(Number(m[4]) > 35, `today's weights ${m[4]} (35 with outside pinned at 0)`);
  assert.match(out, /strict a\/b picks only/);
  const fb = execFileSync('node', [new URL('../scripts/kitchen-tests.mjs', import.meta.url).pathname, 'feedback'], { encoding: 'utf8' });
  assert.match(fb, /# Batch checks/);
});

test('kitchenSource is additive: sample and link ride along, the format stays harveys-rung-quiz/1', () => {
  const [k] = loadKitchens(readFileSync(new URL('./fixtures/bachelor-kitchen.json', import.meta.url), 'utf8'));
  const q = buildRungQuiz({ kitchen: k, inventory: buildInventory(k.items) });
  const base = encodeRungResult(q, { stars: {} }, { version: 't', at: 'x', testerId: 't-1' });
  assert.equal(base.kitchenSource, undefined);
  for (const src of ['sample', 'link']) {
    const r = encodeRungResult(q, { stars: {} }, { version: 't', at: 'x', testerId: 't-1', kitchenSource: src });
    assert.equal(r.kitchenSource, src);
    assert.equal(r.format, 'harveys-rung-quiz/1');
    assert.deepEqual(Object.keys(r).filter((x) => x !== 'kitchenSource'), Object.keys(base));
  }
  assert.equal(encodeRungResult(q, { stars: {} }, { kitchenSource: 'other' }).kitchenSource, undefined);
});

test('sample kitchens: every kitchen in kitchens.json loads and makes a test', () => {
  const ks = loadKitchens(readFileSync(new URL('../data/test-kitchens/kitchens.json', import.meta.url), 'utf8'));
  assert.ok(ks.length >= 1);
  for (const k of ks) {
    assert.ok(k.kitchen && k.items.length, k.kitchen);
    assert.ok(Object.keys(buildRungQuiz({ kitchen: k, inventory: buildInventory(k.items) }).dishes).length >= 1, k.kitchen);
  }
  assert.ok(readdirSync(new URL('../data/test-kitchens/', import.meta.url)).includes('kitchens.json'));
});
