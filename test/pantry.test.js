import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE, buildInventory, rank, importKitchens, profileOf, parseClassification, classifyPrompt, looksLikeKitchenJson } from '../src/brain/index.js';

const fixture = readFileSync(new URL('./fixtures/kitchens-sample.json', import.meta.url), 'utf8');
const TARGETS = { protein: 60, calories: 1200, fiber: 20 };

test('any named ingredient gets a profile: soy sauce is salt and umami, vinegar is acid', () => {
  assert.deepEqual(profileOf('soy sauce').roles, ['salt', 'umami']);
  assert.equal(profileOf('Soy Sauce').id, 'x:soy_sauce');
  assert.deepEqual(profileOf('white vinegar').roles, ['acid']);
  assert.equal(profileOf('sourdough').as, 'bread');
  assert.equal(profileOf('zaatar').source, 'unknown');
  assert.equal(profileOf('chicken nuggets').diet, 'non_veg');
});

test('the fixed ids still work as aliases', () => {
  const inv = buildInventory([{ name: 'Protein bread', canonical: 'protein_bread' }, 'Amul cheese slices', 'olive oil']);
  assert.ok(inv.have.has('protein_bread') && inv.have.has('cheese_slices') && inv.have.has('oil'));
  assert.ok(inv.have.has('role:fat'));
});

test('open-ended items join the inventory; non-veg never does', () => {
  const inv = buildInventory(['soy sauce', 'chicken breast', 'zaatar']);
  assert.ok(inv.have.has('x:soy_sauce') && inv.have.has('role:umami'));
  assert.deepEqual(inv.excluded, ['chicken breast']);
  assert.deepEqual(inv.unmatched, ['zaatar']);
  assert.ok(!inv.have.has('x:chicken_breast'));
});

test('plain bread makes the protein-bread toast, with lower protein and a plain name', () => {
  const inv = buildInventory(['bread', 'cheese slices', 'air fryer']);
  const r = rank({ inventory: inv, targets: TARGETS, context: { hour: 19, weekday: 3, kind: 'any' }, catalogue: CATALOGUE });
  const toast = r.ranked.find((x) => x.meal.id === 'airfryer_protein_cheese_toast');
  assert.ok(toast, 'toast is cookable with plain bread');
  assert.equal(toast.meal.name, 'Air-fryer cheese toast');
  assert.equal(toast.meal.macros.protein, 12);
  const own = rank({ inventory: buildInventory(['protein bread', 'cheese slices', 'air fryer']), targets: TARGETS, context: { kind: 'any' }, catalogue: CATALOGUE })
    .ranked.find((x) => x.meal.id === 'airfryer_protein_cheese_toast');
  assert.equal(own.meal.macros.protein, 20);
  assert.equal(own.meal.name, 'Air-fryer protein bread cheese toast');
});

test('a role slot takes any item with that role: sriracha fills chilli flakes', () => {
  const inv = buildInventory(['bread', 'cheese slices', 'air fryer', 'sriracha']);
  const r = rank({ inventory: inv, targets: TARGETS, context: { kind: 'any' }, catalogue: CATALOGUE });
  const toast = r.ranked.find((x) => x.meal.id === 'airfryer_protein_cheese_toast');
  const heat = toast.used.ingredients.find((i) => i.role === 'role:heat');
  assert.equal(heat.id, 'x:sriracha');
  assert.equal(heat.label, 'sriracha');
});

test('importer reads both the old fixed-id shape and the open shape, and both kitchens rank', () => {
  const ks = importKitchens(fixture);
  assert.equal(ks.length, 2);
  assert.equal(ks[0].kitchen, 'Pune PG room, video 1');
  assert.ok(ks[0].items.some((i) => i.canonical === 'maggi'));
  assert.ok(ks[1].items.some((i) => i.name === 'soy sauce' && i.category === 'condiment'));
  for (const k of ks) {
    const r = rank({ inventory: buildInventory(k.items), targets: TARGETS, context: { kind: 'any' }, catalogue: CATALOGUE });
    assert.ok(r.ranked.length > 0, `${k.kitchen} has something to cook`);
  }
  assert.ok(looksLikeKitchenJson(fixture) && !looksLikeKitchenJson('eggs, bread'));
});

test('flash-lite classifications are parsed, cached by name and then used', () => {
  assert.match(classifyPrompt(['zaatar']), /"zaatar"/);
  const cache = parseClassification('```json\n{"items":[{"name":"Zaatar","as":null,"kind":"food","category":"spice","foodClass":"aromatic_herb_acid","roles":["acid","fresh","bogus"],"cookFirst":false,"diet":"veg","per100g":{"protein":9,"kcal":300,"fiber":20}}]}\n```');
  assert.deepEqual(cache.zaatar.roles, ['acid', 'fresh']);
  const inv = buildInventory(['zaatar'], { cache });
  assert.deepEqual(inv.unmatched, []);
  assert.ok(inv.have.has('role:acid'));
  assert.deepEqual(parseClassification('not json'), {});
});
