import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE, buildInventory, rank, importKitchens, kitchenTips } from '../src/brain/index.js';

const k = importKitchens(readFileSync(new URL('../data/kitchens/aspirational-bachelor.json', import.meta.url), 'utf8'))[0];
const inv = buildInventory(k.items, {});
const r = rank({ inventory: inv, targets: { protein: 60, calories: 1200, fiber: 20 }, context: { hour: 19, weekday: 3, kind: 'any' }, catalogue: CATALOGUE });

test('aspirational bachelor: the nonstick kadai boils, but nothing needs a pressure cooker', () => {
  const names = r.ranked.map((x) => x.meal.name);
  assert.ok(names.some((n) => /boiled eggs/i.test(n)), names.join(', '));
  assert.ok(!names.some((n) => /pressure-cooker/i.test(n)), names.join(', '));
  assert.ok(r.kitUnlocks.some((u) => u.id === 'pressure_cooker'));
});

test('aspirational bachelor: tips flag the metal spatula, not boiling', () => {
  const tips = kitchenTips(inv, k.items).join(' ');
  assert.doesNotMatch(tips, /boils water/);
  assert.match(tips, /metal spatula/);
  assert.match(kitchenTips(buildInventory(['nonstick pan']), []).join(' '), /boils water/);
  assert.deepEqual(kitchenTips(buildInventory(['kettle', 'nonstick pan']), [{ name: 'nonstick pan' }]), []);
});
