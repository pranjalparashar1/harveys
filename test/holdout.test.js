import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeBench, decodeBench } from '../src/quiz/bench.js';
import { buildHoldout, HOLDOUT } from '../scripts/holdout.mjs';
import { CATALOGUE } from '../src/brain/catalogue.js';

const sheet = JSON.parse(readFileSync(new URL('../src/quiz/holdout.json', import.meta.url), 'utf8'));
const bench = JSON.parse(readFileSync(new URL('../src/quiz/benchmark.json', import.meta.url), 'utf8'));

test('Step 4c: the holdout sheet is blind and matches the script', () => {
  assert.deepEqual(sheet, buildHoldout().sheet);
  assert.equal(sheet.dishes.length, 22);
  assert.notEqual(sheet.seed, bench.seed);
  for (const d of sheet.dishes) assert.deepEqual(Object.keys(d).sort(), ['id', 'items', 'name', 'parts']);
  const raw = JSON.stringify(sheet);
  for (const word of ['computed', 'probe', 'boundary', 'why', 'source']) assert.ok(!raw.includes(`"${word}"`), word);
});

test('Step 4c: no dish was in the Step 4 sheet or the catalogue, and all stay vegetarian plus eggs', () => {
  const seen = new Set([...bench.dishes.map((d) => d.parts.toLowerCase()), ...CATALOGUE.map((m) => m.id)]);
  for (const d of sheet.dishes) { assert.ok(!seen.has(d.parts.toLowerCase()), d.name); assert.ok(!seen.has(d.id), d.id); }
  const text = JSON.stringify(HOLDOUT).toLowerCase();
  for (const m of ['chicken', 'tuna', 'fish', 'mutton', 'prawn', 'tofu', 'sprouts', 'makhana']) assert.ok(!text.includes(m), m);
});

test('Step 4c: the key probes boundary passes and the sauté-vs-sauce cases', () => {
  const { key } = buildHoldout();
  assert.ok(key.filter((k) => k.computed === 'pass' && k.boundary.length).length >= 5);
  assert.ok(key.filter((k) => k.probe.startsWith('sauté vs sauce')).length >= 3);
  assert.ok(key.some((k) => k.computed === 'floor') && key.some((k) => k.computed === 'veto'));
});

test('Step 4c: answers go out in the benchmark format, under the holdout seed', () => {
  const d = sheet.dishes[0];
  const back = decodeBench(encodeBench(sheet, { [d.id]: { tier: 'floor', reasons: ['bland'], at: '2026-11-21T09:00:00.000Z' } }));
  assert.equal(back.seed, sheet.seed);
  assert.deepEqual(back.answers[d.id].reasons, ['bland']);
});
