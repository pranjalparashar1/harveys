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
  assert.equal(t.upgrade.add, 'chaat_masala', 'a spice shaken in is cheapest');
  assert.ok(t.upgrade.options.includes('butter') && t.upgrade.options.includes('lemon'));
  assert.ok(!t.upgrade.options.includes('banana'), 'a savoury dish takes no sweet add-on');
  assert.ok(!t.upgrade.options.includes('oil'), 'oil is a cooking medium');
  assert.equal(pierreTier([{ id: 'chickpeas', technique: 'boiled' }], 'bowl', { modifiers: ['chaat_masala'] }).tier, 'pass');
});

test('oats with raw tomato as a bowl is not a pass (R2 §3.3)', () => {
  const t = pierreTier(['oats', 'tomato'], 'bowl');
  assert.notEqual(t.tier, 'pass');
  assert.match(t.why.join(), /oats doesn't fit a bowl's base/);
});

test('an unknown form is scored on the open path, labelled untested', () => {
  const t = pierreTier([{ id: 'paneer', technique: 'pan_fried' }], 'pizza', { modifiers: ['salt'] });
  assert.equal(t.untested, true);
  assert.equal(t.tier, 'pass');
});

test('a rated row beats the class prior; your dish verdict beats both', () => {
  assert.equal(partVector({ id: 'paneer', technique: 'air_fried' }).source, 'rated');
  const rajma = partVector({ id: 'rajma', technique: 'air_fried' });
  assert.deepEqual([rajma.source, rajma.provisional, rajma.state], ['prior', true, '@air_fried']);
  assert.equal(rajma.texture.crisp, PIERRE_RAW.foods.rajma.texture.crisp + TECHNIQUES.air_fried.dense_starchy.texture.crisp);
  const t = pierreTier([{ id: 'paneer', technique: 'microwaved' }, 'butter'], 'bhurji', { verdict: PIERRE_SEED.microwave_paneer_bhurji });
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
