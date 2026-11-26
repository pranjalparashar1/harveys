// Soya boils alone (1.59.0, pranjal 26 Nov): boiled in the pasta's water it flavours the pasta,
// and the chunks can't be fished out to squeeze. Every dish, written or opened from a template,
// boils a BOIL_ALONE food in a step of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE } from '../src/brain/catalogue.js';
import { buildInventory } from '../src/brain/inventory.js';
import { importKitchens } from '../src/brain/kitchens.js';
import { expandTemplates, BOIL_ALONE } from '../src/brain/templates.js';
import { rawFeatures } from '../src/brain/learn.js';
import { labelFor } from '../src/brain/vocabulary.js';

const kitchens = importKitchens(readFileSync(new URL('../data/test-kitchens/kitchens.json', import.meta.url), 'utf8'));
const OTHERS = /\b(pasta|fusilli|penne|macaroni|spaghetti|rice|noodles?|maggi|dal|chickpeas|rajma|eggs?|potato(es)?|together)\b/i;

function allDishes() {
  const seen = new Map(CATALOGUE.map((m) => [m.id, m]));
  for (const k of kitchens) for (const m of expandTemplates(CATALOGUE, buildInventory(k.items))) seen.set(m.id, m);
  return [...seen.values()];
}

test('soya chunks never boil in the same water as anything else', () => {
  const words = BOIL_ALONE.map((id) => new RegExp(`\\b${labelFor(id).split(' ')[0]}\\b`, 'i'));
  let checked = 0;
  for (const m of allDishes()) {
    if (!m.parts?.some((p) => BOIL_ALONE.includes(p.id))) continue;
    for (const s of m.steps) {
      if (!/\bboil/i.test(s.text) || !words.some((w) => w.test(s.text))) continue;
      checked++;
      assert.ok(!OTHERS.test(s.text), `${m.id}: "${s.text}"`);
    }
  }
  assert.ok(checked >= 4, `checked ${checked} soya boil steps`);
});

test('boiling soya apart costs more effort than the old co-boil', () => {
  const pasta = rawFeatures(CATALOGUE.find((m) => m.id === 'soya_pasta_pot'));
  // The 1.58 one-pot version: 3 steps, 5 min hands-on, 10 min waiting, 1 dish.
  assert.ok(pasta.steps > 3 && pasta.handsOn > 5 && pasta.waiting > 10 && pasta.cleanup > 1, JSON.stringify(pasta));
  const rice = rawFeatures(CATALOGUE.find((m) => m.id === 'soya_jeera_rice'));
  assert.ok(rice.steps > 2 && rice.waiting > 12, JSON.stringify(rice));
});
