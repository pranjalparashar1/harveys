// v2 Step 5: Pierre on cooking physics (Fable's SFAH ontology). Real brain file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pierreTier, partVector, dishProfile, coatingOf, fatRolesOf } from '../src/brain/ingredients.js';
import { FOOD_CLASS, FOOD_CLASSES, phaseOf, tempOf, ESTIMATE } from '../src/brain/ontology.js';
import { PIERRE_RAW } from '../src/brain/pierre-raw.js';
import { DEFAULT_CONFIG } from '../src/brain/config.js';

const P = (s) => s.split(',').map((x) => { const [id, technique] = x.trim().split('@'); return technique ? { id, technique } : { id }; });
const tier = (parts, form, mods = []) => pierreTier(P(parts), form, { modifiers: mods });

test('every food in the brain has a food class, from the eight', () => {
  const ids = [...Object.keys(PIERRE_RAW.foods), ...Object.keys(PIERRE_RAW.prep), ...Object.keys(PIERRE_RAW.tech).map((k) => k.split('@')[0])];
  for (const id of new Set(ids)) assert.ok(FOOD_CLASSES.includes(FOOD_CLASS[id]), `${id} has no class`);
  assert.equal(ESTIMATE, true, 'classes are estimates, not ratings');
});

test('every part carries its class, phase and temperature', () => {
  const v = partVector({ id: 'tomato', technique: 'sauteed' });
  assert.equal(v.foodClass, 'watery_veg_fruit');
  assert.equal(v.phase, 'discrete_cooked', 'a sautéed tomato is pieces, never a sauce');
  assert.equal(v.temp, 'hot');
  assert.equal(partVector({ id: 'tomato' }).temp, 'cold');
  assert.equal(phaseOf('tomato', 'simmered'), 'cohesive_sauce');
  assert.equal(phaseOf('curd'), 'cohesive_sauce', 'curd is a sauce as it comes');
  assert.equal(phaseOf('pasta'), 'raw_inedible');
  assert.equal(phaseOf('garlic', 'sauteed'), 'bloomed');
  assert.equal(phaseOf('dal', 'pressure_cooked'), 'cohesive_sauce');
  assert.equal(tempOf('shake_milk'), 'cold');
});

test('sautéed tomato on boiled pasta is not a sauced pasta', () => {
  const t = tier('pasta@boiled,tomato@sauteed', 'open', ['salt']);
  assert.equal(t.computed, 'floor');
  assert.match(t.why.join(), /no sauce: pasta@boiled/);
  assert.equal(tier('noodles@boiled,tomato@sauteed,onion@sauteed', 'open', ['salt', 'chilli_flakes']).computed, 'floor');
  assert.equal(tier('rice@sauteed,tomato@sauteed,onion@sauteed', 'one-pot', ['salt', 'red_chilli_powder']).computed, 'floor', 'tomato rice (you: floor)');
});

test('a simmered tomato, curd or a tadka coats a base', () => {
  assert.equal(tier('pasta@boiled,tomato@simmered', 'coated_base', ['oil', 'salt']).computed, 'pass', 'pomarola');
  assert.equal(coatingOf(P('pasta@boiled,garlic@bloom_tadka,paneer@pan_fried'), ['oil']).kind, 'flavored_fat', 'aglio olio');
  assert.equal(tier('pasta@boiled,garlic@bloom_tadka,paneer@pan_fried', 'coated_base', ['oil', 'salt', 'chilli_flakes']).computed, 'pass');
  assert.equal(tier('rice@pressure_cooked,curd', 'bowl', ['salt']).computed, 'pass', 'curd rice');
  assert.equal(tier('poha@sauteed,onion@sauteed,peanuts@roasted', 'one-pot', ['oil', 'salt']).computed, 'pass', 'kanda poha (you: crave)');
});

test('a plain fat only greases a base', () => {
  const t = tier('pasta@boiled,butter', 'open', ['salt', 'black_pepper']);
  assert.equal(t.computed, 'floor', 'you: bland');
  assert.match(t.why.join(), /butter only greases it/);
  assert.deepEqual(fatRolesOf(P('pasta@boiled,butter')), { butter: 'main_binder' });
  assert.deepEqual(fatRolesOf(P('bread@toasted,butter')), { butter: 'seasoning' });
  assert.deepEqual(fatRolesOf(P('pasta@boiled,garlic@sauteed'), ['oil']), { oil: 'cooking_medium' });
  assert.deepEqual(fatRolesOf(P('paneer@pan_fried,ghee,curd')), { ghee: 'cooking_medium' }, 'the fat a part is fried in');
  assert.deepEqual(fatRolesOf(P('potato@air_fried'), ['mayo']), { mayo: 'seasoning' }, 'mayo is a condiment, never a cooking fat');
});

test('Fable §7 cases', () => {
  assert.equal(tier('chickpeas@boiled', 'bowl').computed, 'floor', 'plain boiled chickpeas');
  // All creamy, but the taste carries it (pranjal, 21 Nov): fat, acid and fresh.
  assert.equal(tier('chickpeas@mashed,butter,curd', 'savory_mash', ['salt']).computed, 'pass');
  assert.equal(tier('butter', 'bowl', ['salt']).computed, 'floor', 'no anchor');
  assert.equal(tier('oats,tomato', 'open').computed, 'veto', 'raw oats');
  assert.equal(tier('eggs,bread@toasted', 'toast').computed, 'veto', 'raw eggs are inedible');
});

test('a toast needs an egg, paneer, cheese or a spread on it', () => {
  const t = tier('bread@toasted,mushroom@sauteed,butter,garlic@sauteed', 'toast', ['salt', 'black_pepper']);
  assert.equal(t.computed, 'floor', 'garlic mushroom toast (you: not a meal)');
  assert.match(t.why.join(), /not a meal/);
  assert.equal(tier('bread@toasted,eggs@scrambled,onion@sauteed', 'toast', ['salt', 'green_chilli']).computed, 'pass');
  assert.equal(tier('bread@toasted,peanut_butter,banana', 'toast').computed, 'pass');
});

test('whey stirred in as a powder floors, shaken it passes', () => {
  assert.match(tier('curd,whey', 'bowl').why.join(), /whey stirred in as a powder/);
  assert.equal(tier('whey@shake_milk', 'shake').computed, 'pass');
});

test('loosened 4b rules: raw onion on a cooked base, a sweet curd bowl, a snack pairing', () => {
  assert.equal(tier('bread@toasted,paneer@air_fried,onion', 'sandwich', ['salt', 'chaat_masala']).computed, 'pass', 'you: pass');
  assert.equal(tier('bread,tomato,onion,paneer', 'open', ['salt']).computed, 'floor', 'all raw still clashes');
  assert.equal(tier('tomato,onion,paneer@pan_fried', 'open', ['salt']).computed, 'floor', 'no base to carry the onion (you: floor)');
  assert.equal(tier('curd,banana', 'bowl', ['honey']).computed, 'pass', 'a sweet curd bowl (you passed it with hung curd)');
  assert.match(tier('banana,peanut_butter', 'bowl').why.join(), /all creamy/, 'still mush');
  assert.equal(tier('apple,peanut_butter', 'bowl').computed, 'pass', 'you: pass');
});

test('chemistry vetoes: sweet with savoury, milk boiled with acid', () => {
  assert.equal(tier('banana,onion@sauteed', 'bowl').computed, 'veto');
  assert.equal(tier('milk@boiled,tomato', 'open').computed, 'veto');
  for (const id of ['curd', 'honey', 'chaat_masala']) assert.ok(!DEFAULT_CONFIG.pierreRules.savourySide.includes(id), `${id} is not savoury`);
});

test('umami is reported as an estimate and never judged on', () => {
  const p = dishProfile(P('bread@toasted,cheese_slices@melted'), PIERRE_RAW, undefined, ['chilli_flakes']);
  assert.equal(p.umami.estimate, true);
  assert.ok(p.umami.level >= 2);
  assert.ok(dishProfile(P('pasta@boiled,paneer@pan_fried,curd')).tempContrast, 'hot pasta, cold curd');
});

test('the physics rules sit in config, PROVISIONAL', () => {
  assert.match(readFileSync(new URL('../src/brain/config.js', import.meta.url), 'utf8'), /PROVISIONAL[^]*pierreRules/);
});
