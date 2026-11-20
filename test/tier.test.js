// v2 Step 3: Pierre core (tiers, forms, the derived class prior). Real brain file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pierreTier, partVector, FORMS, TECHNIQUES, verdictTier } from '../src/brain/ingredients.js';
import { PIERRE_RAW } from '../src/brain/pierre-raw.js';
import { CATALOGUE } from '../src/brain/catalogue.js';
import { PIERRE_SEED } from '../src/brain/train-data.js';
import { derivePrior } from '../scripts/derive-prior.mjs';
import { tierRows } from '../scripts/pierre-tiers.mjs';

test('microwaved eggs veto the dish', () => {
  assert.equal(pierreTier([{ id: 'eggs', technique: 'microwaved' }], 'bhurji').tier, 'veto');
});

test('butter with salt has no anchor: floor', () => {
  const t = pierreTier(['butter'], 'bowl', { modifiers: ['salt'] });
  assert.equal(t.tier, 'floor');
  assert.ok(t.why.includes('no anchor'));
});

test('boiled chickpeas alone: floor, with an upgrade from the kitchen', () => {
  const t = pierreTier([{ id: 'chickpeas', technique: 'boiled' }], 'bowl', { inventory: ['banana', 'oil', 'butter', 'chaat_masala', 'lemon'] });
  assert.equal(t.tier, 'floor');
  // Step 4b: chaat masala brings acid at Low, and butter is fat alone, so neither lifts it now.
  assert.equal(t.upgrade.add, 'lemon', 'the only addition in this kitchen that lifts it');
  assert.ok(!t.upgrade.options.includes('chaat_masala') && !t.upgrade.options.includes('butter'));
  assert.ok(!t.upgrade.options.includes('banana'), 'a savoury dish takes no sweet add-on');
  assert.ok(!t.upgrade.options.includes('oil'), 'oil is a cooking medium');
  assert.equal(pierreTier([{ id: 'chickpeas', technique: 'boiled' }], 'bowl', { modifiers: ['chaat_masala'] }).tier, 'floor');
  assert.equal(pierreTier([{ id: 'chickpeas', technique: 'boiled' }, 'lemon'], 'bowl', { modifiers: ['chaat_masala'] }).tier, 'pass');
});

test('oats with raw tomato as a bowl is not a pass (R2 §3.3)', () => {
  const t = pierreTier(['oats', 'tomato'], 'bowl');
  assert.notEqual(t.tier, 'pass');
  assert.match(t.why.join(), /raw: oats needs cooking first/);
});

test('an unknown form is scored on the open path, labelled untested', () => {
  const t = pierreTier([{ id: 'paneer', technique: 'pan_fried' }], 'pizza', { modifiers: ['salt', 'black_pepper'] });
  assert.equal(t.untested, true);
  assert.equal(t.tier, 'pass');
});

test('a rated row beats the class prior; your dish verdict beats both', () => {
  assert.equal(partVector({ id: 'paneer', technique: 'air_fried' }).source, 'rated');
  const rajma = partVector({ id: 'rajma', technique: 'air_fried' });
  assert.deepEqual([rajma.source, rajma.provisional, rajma.state], ['prior', true, '@air_fried']);
  assert.equal(rajma.texture.crisp, PIERRE_RAW.foods.rajma.texture.crisp + TECHNIQUES.air_fried.dense_starchy.texture.crisp);
  const t = pierreTier([{ id: 'paneer', technique: 'microwaved' }, 'butter'], 'bhurji', { modifiers: ['black_pepper'], verdict: PIERRE_SEED.microwave_paneer_bhurji });
  assert.deepEqual([t.computed, t.tier, t.source], ['pass', 'floor', 'verdict']);
  assert.equal(pierreTier([{ id: 'eggs', technique: 'omelette' }], 'griddle', { verdict: { verdict: 'fail' } }).tier, 'veto');
});

test('the class prior is derived from rated rows, never typed in', () => {
  assert.deepEqual(TECHNIQUES, derivePrior(PIERRE_RAW), 'technique-prior.js is the script output: re-run scripts/derive-prior.mjs');
  assert.deepEqual(Object.keys(TECHNIQUES).sort(), ['air_fried', 'pan_fried', 'sauteed']);
  for (const cs of Object.values(TECHNIQUES)) for (const [cls, e] of Object.entries(cs)) {
    assert.ok(['dense_starchy', 'watery_veg'].includes(cls));
    assert.equal(e.provisional, true);
    assert.ok(e.from.length >= 2);
  }
  assert.ok(TECHNIQUES.air_fried.dense_starchy.texture.crisp > 0 && TECHNIQUES.air_fried.watery_veg.texture.crisp < 0, 'audit F7: air-frying crisps dense food, not watery veg');
});

test('every catalogue meal has parts and a known form', () => {
  for (const m of CATALOGUE) {
    assert.ok(FORMS[m.form], `${m.id}: form ${m.form}`);
    assert.ok(m.parts?.length, `${m.id}: parts`);
    for (const p of m.parts) assert.match(p.id, /^[a-z_]+$/, m.id);
  }
});

test('acceptance: every verdict you gave is reproduced', () => {
  const rows = tierRows();
  assert.equal(rows.length, CATALOGUE.length);
  for (const r of rows.filter((x) => x.verdict)) {
    const want = r.verdict;
    if (want === 'veto') assert.equal(r.tier, 'veto', r.id);
    else if (want === 'pass') assert.ok(['pass', 'crave'].includes(r.tier), r.id);
    else assert.equal(r.tier, want, r.id);
  }
  assert.ok(!rows.some((r) => r.computed === 'crave'), 'crave is never computed');
  assert.equal(verdictTier({ verdict: 'meh' }), 'floor');
});

test('the floor numbers are marked provisional', () => {
  assert.match(readFileSync(new URL('../src/brain/config.js', import.meta.url), 'utf8'), /PROVISIONAL[^]*pierreFloor/);
});

// ── Step 4b: the benchmark gaps ─────────────────────────────────────────────
// Each case is a dish you rated blind on 20 Nov (issue #38), or one of your fixes.
const P = (k) => { const [id, technique] = k.split('@'); return technique ? { id, technique } : { id }; };
const tierOfDish = (parts, form, modifiers = []) => pierreTier(parts.map(P), form, { modifiers });

test('4b: a cook-first food left raw vetoes the dish; cooked, it does not', () => {
  const t = tierOfDish(['tomato', 'onion', 'pasta', 'eggs@fried_egg'], 'open', ['salt']);
  assert.equal(t.tier, 'veto');
  assert.match(t.why.join(), /raw: pasta needs cooking first/);
  assert.equal(tierOfDish(['chickpeas', 'onion', 'tomato', 'lemon'], 'bowl', ['chaat_masala']).tier, 'veto', 'chana chaat with raw chickpeas');
  assert.equal(tierOfDish(['chickpeas@boiled', 'onion', 'tomato', 'lemon'], 'bowl', ['chaat_masala']).tier, 'pass', 'your fix');
  for (const id of ['oats', 'pasta', 'noodles', 'potato', 'chickpeas', 'rice', 'dal', 'rajma', 'kala_chana', 'soya_chunks', 'poha']) assert.ok(PIERRE_RAW.foods[id]?.cookFirst || PIERRE_RAW.prep[id]?.cookFirst, id);
  for (const id of ['cabbage', 'carrot', 'capsicum']) assert.ok(!PIERRE_RAW.foods[id].cookFirst, `${id} is edible raw`);
});

test('4b: raw garlic vetoes a dish where nothing is cooked, and only then', () => {
  assert.equal(tierOfDish(['bread', 'tomato', 'paneer'], 'open', ['salt', 'garlic']).tier, 'veto');
  assert.equal(tierOfDish(['bread', 'tomato', 'paneer'], 'open', ['salt']).tier, 'pass', 'your fix: drop the garlic');
  const fixed = tierOfDish(['oats@boiled', 'tomato', 'potato@microwaved', 'butter'], 'open', ['garlic']);
  assert.equal(fixed.tier, 'floor', 'with something cooked it is a clash, not a veto (you: floor)');
  assert.match(fixed.why.join(), /clash: raw .*garlic/);
  assert.equal(PIERRE_RAW.tech['garlic@sauteed'].distance, 0, 'sautéed garlic is done: only added to things');
  assert.ok(PIERRE_RAW.foods.garlic.estimate && PIERRE_RAW.tech['garlic@sauteed'].estimate, 'the numbers are marked as estimates');
});

test('4b: raw onion needs a High acid (lemon) to sit right', () => {
  assert.equal(tierOfDish(['bread', 'tomato', 'onion', 'paneer'], 'open', ['salt']).tier, 'floor');
  assert.equal(tierOfDish(['kala_chana@sauteed', 'onion', 'lemon'], 'bowl', ['salt', 'chaat_masala']).tier, 'pass');
});

test('4b: one texture throughout floors a dish', () => {
  const t = tierOfDish(['eggs@boiled', 'hung_curd'], 'bowl', ['salt', 'black_pepper']);
  assert.equal(t.tier, 'floor');
  assert.match(t.why.join(), /one texture throughout: all creamy/);
  assert.equal(tierOfDish(['eggs@boiled'], 'one-pot', ['salt', 'black_pepper']).tier, 'pass', 'one part is not mush');
});

test('4b: a supporting part that brings nothing drags the dish down', () => {
  const t = tierOfDish(['paneer@air_fried', 'curd', 'capsicum@air_fried'], 'griddle', ['salt']);
  assert.equal(t.tier, 'floor');
  assert.match(t.why.join(), /capsicum@air_fried adds nothing/);
  assert.equal(tierOfDish(['paneer@air_fried', 'curd'], 'griddle', ['salt']).tier, 'pass', 'your fix: drop the capsicum');
});

test('4b: fat alone no longer clears the flavour floor', () => {
  const t = tierOfDish(['bread@pan_fried', 'paneer', 'cheese_slices@melted', 'butter'], 'sandwich', ['salt']);
  assert.equal(t.tier, 'floor');
  assert.match(t.why.join(), /only fat at Medium or above/);
  assert.equal(tierOfDish(['paneer@microwaved'], 'bowl', ['salt', 'black_pepper']).tier, 'pass', 'fat with heat clears it');
  assert.equal(tierOfDish(['poha@sauteed', 'onion@sauteed', 'peanuts@roasted'], 'one-pot', ['oil', 'salt']).tier, 'pass', 'poha: fat with the onion\'s own sugar');
});

test('4b: a shake you rated done passes on its own flavour', () => {
  assert.equal(tierOfDish(['whey@shake_water'], 'shake').tier, 'pass');
  assert.equal(tierOfDish(['whey@shake_milk'], 'shake').tier, 'pass');
});

test('4b: a toast needs toasted bread, and an unrated part caps a dish at floor', () => {
  assert.equal(tierOfDish(['bread', 'peanut_butter', 'banana'], 'toast').tier, 'floor');
  assert.equal(tierOfDish(['bread@toasted', 'peanut_butter', 'banana'], 'toast').tier, 'pass', 'your fix');
  const t = tierOfDish(['curd', 'whey'], 'bowl');
  assert.equal(t.tier, 'floor');
  assert.match(t.why.join(), /can't judge whey/);
});

test('4b: flaky is folded into crisp', () => {
  assert.equal(partVector('cashews').texture.crisp, Math.max(PIERRE_RAW.foods.cashews.texture.crisp, PIERRE_RAW.foods.cashews.texture.flaky ?? 0));
  assert.equal('flaky' in partVector('walnuts').texture, false);
});
