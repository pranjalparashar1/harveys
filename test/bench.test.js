import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeBench, decodeBench, applyFix } from '../src/quiz/bench.js';
import { parseCombo, HACKS } from '../scripts/benchmark.mjs';
import { CATALOGUE } from '../src/brain/catalogue.js';

const sheet = JSON.parse(readFileSync(new URL('../src/quiz/benchmark.json', import.meta.url), 'utf8'));

test('Step 4: the sheet is blind, 30 dishes with names and parts only', () => {
  assert.equal(sheet.dishes.length, 30);
  assert.deepEqual(sheet.tiers.map((t) => t.id), ['veto', 'floor', 'pass', 'crave']);
  for (const d of sheet.dishes) assert.deepEqual(Object.keys(d).sort(), ['id', 'items', 'name', 'parts']);
  const raw = JSON.stringify(sheet);
  for (const word of ['computed', 'couvert', 'spoons', 'why', 'source']) assert.ok(!raw.includes(`"${word}"`), word);
  assert.equal(new Set(sheet.dishes.map((d) => d.id)).size, 30);
  const ids = new Set(CATALOGUE.map((m) => m.id));
  assert.equal(sheet.dishes.filter((d) => ids.has(d.id)).length, 12);
  assert.equal(sheet.dishes.filter((d) => d.id.startsWith('hack_')).length, 8);
  assert.equal(sheet.dishes.filter((d) => d.id.startsWith('combo_')).length, 10);
  assert.match(readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8'), /bench\.html/);
});

test('Step 4: answers round-trip, reasons only on veto and floor', () => {
  const answers = { [sheet.dishes[0].id]: { tier: 'veto', reasons: ['cooking', 'clash'], at: '2026-11-21T09:12:33.000Z' }, [sheet.dishes[1].id]: { tier: 'pass', reasons: ['bland'], at: '2026-11-21T09:13:00.000Z' } };
  const text = encodeBench(sheet, answers, 'finer');
  const back = decodeBench(text);
  assert.equal(back.seed, sheet.seed);
  assert.equal(back.tiers, 'finer');
  assert.deepEqual(back.answers[sheet.dishes[0].id], { tier: 'veto', reasons: ['cooking', 'clash'], at: '2026-11-21T09:12Z' });
  assert.deepEqual(back.answers[sheet.dishes[1].id].reasons, []);
  assert.throws(() => decodeBench('hello'));
});

test('Step 4: absurd combos parse, and every dish stays vegetarian plus eggs', () => {
  assert.deepEqual(parseCombo('tomato + paneer (pan fried) + salt* + garlic*'), { parts: [{ id: 'tomato' }, { id: 'paneer', technique: 'pan_fried' }], modifiers: ['salt', 'garlic'] });
  const meat = ['chicken', 'tuna', 'fish', 'mutton', 'prawn', 'tofu'];
  const text = JSON.stringify(sheet).toLowerCase() + JSON.stringify(HACKS);
  for (const m of meat) assert.ok(!text.includes(m), m);
});

test('Fix it: a veto rescued by cooking changes round-trips and applies', () => {
  const d = sheet.dishes.find((x) => x.name === 'Bread, tomato, paneer, salt, garlic');
  const i = (id) => d.items.findIndex((it) => it.id === id);
  const answers = { [d.id]: { tier: 'veto', reasons: ['clash'], fix: { changes: { [i('garlic')]: 'sauteed', [i('paneer')]: 'air_fried', [i('salt')]: 'drop' }, tier: 'floor' }, at: '2026-11-20T15:40:00.000Z' } };
  const back = decodeBench(encodeBench(sheet, answers));
  assert.deepEqual(back.answers[d.id].fix, { line: 'paneer@air_fried.-salt.garlic@sauteed', tier: 'floor' });
  const after = applyFix(d.items, back.answers[d.id].fix.line);
  assert.deepEqual(after.map((x) => `${x.id}${x.technique ? `@${x.technique}` : ''}`), ['bread', 'tomato', 'paneer@air_fried', 'garlic@sauteed']);
  // A pass carries no fix, and a fix without a tier isn't sent.
  assert.ok(!encodeBench(sheet, { [d.id]: { ...answers[d.id], tier: 'pass' } }).includes('fix '));
  assert.ok(!encodeBench(sheet, { [d.id]: { ...answers[d.id], fix: { changes: answers[d.id].fix.changes } } }).includes('fix '));
});
