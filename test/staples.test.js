// 1.36.0 (pranjal, 22 Nov, from Harsh's taste test): salt and oil are always there, dal cooks
// in a kadai with a long boil, and tea and coffee need milk and a saucepan (never a kadai).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE, buildInventory, checkMeal, matchName } from '../src/brain/index.js';

const meal = (id) => CATALOGUE.find((m) => m.id === id);
const can = (id, items, opts) => checkMeal(meal(id), buildInventory(items, opts)).ok;

test('salt and oil are assumed unless marked missing', () => {
  assert.ok(buildInventory(['eggs']).have.has('salt'));
  assert.ok(buildInventory(['eggs']).have.has('oil'));
  assert.ok(!buildInventory(['eggs'], { missingBasics: ['salt'] }).have.has('salt'));
  assert.ok(can('boiled_eggs', ['eggs', 'induction cooktop', 'steel pot']), 'eggs no longer need salt spotted');
});

test('lentils are dal, and dal boils in any pot without a cooker', () => {
  assert.equal(matchName('lentils'), 'dal');
  assert.ok(can('kadai_dal', ['lentils', 'induction cooktop', 'kadhai']));
  assert.ok(can('kadai_dal', ['lentils', 'induction cooktop', 'steel pot']), '1.38.0: a patila boils dal too');
  assert.ok(!can('kadai_dal', ['lentils', 'induction cooktop']), 'still needs a vessel');
});

test('bare kitchens (1.38.0): egg bhurji in a pot, no pan and no chopping', () => {
  assert.ok(can('pot_egg_bhurji', ['eggs', 'ghee', 'gas stove', 'steel pot']));
  assert.ok(!can('pot_egg_bhurji', ['eggs', 'ghee', 'steel pot']), 'needs a stove');
});

test('chai and coffee need milk, the tea or coffee, and a saucepan; a kadai will not do', () => {
  const kit = ['induction cooktop', 'saucepan', 'milk'];
  assert.ok(can('masala_chai', [...kit, 'tea leaves']));
  assert.ok(can('milk_coffee', [...kit, 'instant coffee']));
  assert.ok(!can('masala_chai', ['tea leaves', 'induction cooktop', 'saucepan']), 'no milk, no chai');
  assert.ok(!can('masala_chai', ['tea leaves', 'milk', 'induction cooktop', 'kadhai']), 'chai is not a kadai dish');
  assert.equal(matchName('green tea bags'), 'green_tea');
});
