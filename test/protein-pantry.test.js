import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importKitchens } from '../src/brain/kitchens.js';
import { buildInventory } from '../src/brain/inventory.js';
import { buildRungQuiz } from '../src/brain/rung-quiz.js';
import { loadKitchens } from '../src/brain/kitchen-test.js';

// A prompt-v2 video kitchen (23 Nov): protein pantry, induction, one steel pot, air fryer, no veg or pan.
const text = readFileSync(new URL('./fixtures/kitchen-video-1-v2.json', import.meta.url), 'utf8');

test('the stove field counts when items leave the stove out', () => {
  const k = JSON.parse(text)[0];
  const noStove = { ...k, items: k.items.filter((i) => i.name !== 'induction cooktop') };
  const [imported] = importKitchens([noStove]);
  assert.ok(buildInventory(imported.items).have.has('induction'));
  const [plain] = importKitchens([{ ...noStove, stove: undefined }]);
  assert.ok(!buildInventory(plain.items).have.has('induction'));
  // No duplicate when items already list it.
  const [both] = importKitchens(text);
  assert.equal(both.items.filter((i) => /induction/.test(i.name)).length, 1);
});

test('a milk frother is kit, not milk', () => {
  const inv = buildInventory([{ name: 'milk frother', category: 'appliance' }]);
  assert.ok(!inv.have.has('milk'));
  assert.ok(buildInventory([{ name: 'milk', category: 'dairy' }]).have.has('milk'));
});

test('a protein pantry with one pot gets one-pot soya, pasta and rice meals', () => {
  const [k] = loadKitchens(text);
  const inv = buildInventory(k.items);
  for (const id of ['cumin', 'soya_chunks', 'pasta', 'saucepan', 'induction', 'air_fryer']) assert.ok(inv.have.has(id), id);
  const quiz = buildRungQuiz({ kitchen: k, inventory: inv });
  assert.ok(quiz.cookable >= 8, `tester sees ${quiz.cookable} dishes`);
  for (const id of ['pot_soya_curd_bowl', 'soya_pasta_pot', 'pot_airfryer_soya_tikka', 'curd_peanut_banana_bowl']) assert.ok(quiz.dishes[id], id);
});
