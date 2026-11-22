import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importKitchens } from '../src/brain/kitchens.js';

const kitchens = JSON.parse(readFileSync(new URL('../data/test-kitchens/kitchens.json', import.meta.url), 'utf8'));
const bachelor = kitchens[0];

test('a hard-wrapped kitchen JSON paste still parses to clean items', () => {
  const compact = JSON.stringify([bachelor]).replace('"induction cooktop"', '"induction\ncooktop"');
  let wrapped = '';
  for (let i = 0; i < compact.length; i += 37) wrapped += `${compact.slice(i, i + 37)}\n`;
  const [k] = importKitchens(wrapped);
  assert.equal(k.kitchen, bachelor.kitchen);
  assert.equal(k.items.length, bachelor.items.length);
  assert.ok(k.items.every((i) => !/[{}":]/.test(i.name)), 'no JSON punctuation in item names');
  assert.ok(k.items.some((i) => i.name === 'induction cooktop'));
  assert.deepEqual(k.items.map((i) => i.category), bachelor.items.map((i) => i.category));
});

test('smart quotes and trailing commas are repaired', () => {
  const [k] = importKitchens('{“kitchen”: “x”, “items”: [{“name”: “eggs”, “category”: “protein”},],}');
  assert.deepEqual(k.items.map((i) => [i.name, i.category]), [['eggs', 'protein']]);
});
