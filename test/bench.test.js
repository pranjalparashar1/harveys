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

// ── Tap-to-repair (1.16) ────────────────────────────────────────────────────
import { editSlot, setRepairTier, setRepairScope, clearRepairs, repairLine, parseRepairLine } from '../src/quiz/bench.js';
import { toDishChain } from '../src/brain/ingredients.js';

const round3 = JSON.parse(readFileSync(new URL('../src/quiz/round3.json', import.meta.url), 'utf8'));
const potato = round3.dishes.find((d) => d.id === 'r3_potato_mayo');

test('repair: a slot edit records the diff, and swapping back removes it', () => {
  const orig = toDishChain(potato);
  assert.equal(orig.cookedWith, null);
  let a = { tier: 'floor', reasons: [], at: '2026-11-21T08:10:00.000Z' };
  a = editSlot(a, 'cookedWith', 'oil', orig);
  assert.deepEqual(a.repair.edits, [{ slot: 'cookedWith', from: null, to: 'oil' }]);
  assert.equal(a.repair.scope, 'class', 'a cooking-medium fix generalises by default');
  assert.equal(a.tier, 'floor', 'the before tier stays');
  a = editSlot(a, 'cookedWith', null, orig);
  assert.equal(a.repair, null, 'back to the original: no repair');
});

test('repair: scope defaults per slot, and a picked scope sticks', () => {
  const orig = toDishChain(potato);
  let a = editSlot({ tier: 'pass' }, 'servedWith', 'tomato_sauce', orig);
  assert.equal(a.repair.scope, 'dish', 'a dip change stays with the dish');
  assert.deepEqual(a.repair.edits, [{ slot: 'servedWith', from: 'mayo', to: 'tomato_sauce' }]);
  a = editSlot(a, 'cookedWith', 'ghee', orig);
  assert.equal(a.repair.scope, 'class');
  a = setRepairScope(a, 'dish');
  a = editSlot(a, 'technique', 'pan_fried', orig);
  assert.equal(a.repair.scope, 'dish', 'pranjal picked dish, so it stays');
  a = setRepairTier(a, 'crave');
  assert.equal(a.repair.afterTier, 'crave');
  a = editSlot(a, 'seasonedWith', ['salt', 'chilli_flakes', 'chaat_masala'], orig);
  assert.deepEqual(a.repair.edits.find((e) => e.slot === 'seasonedWith'), { slot: 'seasonedWith', from: ['chilli_flakes', 'salt'], to: ['chaat_masala', 'chilli_flakes', 'salt'] });
  assert.equal(clearRepairs(a).repair, null);
  assert.equal(clearRepairs(a).tier, 'pass');
});

test('repair: export round-trips before, edits, after and scope, beside the old lines', () => {
  const orig = toDishChain(potato);
  let a = { tier: 'floor', reasons: ['texture'], at: '2026-11-21T08:10:00.000Z' };
  a = setRepairTier(editSlot(a, 'cookedWith', 'oil', orig), 'crave');
  a.repair.at = '2026-11-21T08:15:00.000Z';
  let b = editSlot({ tier: 'pass', at: '2026-11-21T08:11:00.000Z' }, 'seasonedWith', ['salt'], toDishChain(round3.dishes[1]));
  b = setRepairTier(b, 'floor');
  b.repair.at = '2026-11-21T08:16:00.000Z';
  const text = encodeBench(round3, { r3_potato_mayo: a, [round3.dishes[1].id]: b });
  assert.match(text, /^repair r3_potato_mayo \| before=floor \| edit=cookedWith:none->oil \| after=crave \| scope=class \| at=2026-11-21T08:15Z$/m);
  const back = decodeBench(text);
  assert.equal(back.answers.r3_potato_mayo.tier, 'floor');
  assert.deepEqual(back.answers.r3_potato_mayo.reasons, ['texture']);
  assert.deepEqual(back.answers.r3_potato_mayo.repair, { edits: [{ slot: 'cookedWith', from: null, to: 'oil' }], afterTier: 'crave', scope: 'class', at: '2026-11-21T08:15Z' });
  assert.deepEqual(back.answers[round3.dishes[1].id].repair.edits, [{ slot: 'seasonedWith', from: ['chilli_flakes', 'salt'], to: ['salt'] }]);
  assert.equal(back.repairs.length, 2);
  assert.equal(back.seed, round3.seed);
  // An unfinished repair (no after tier) isn't exported.
  assert.equal(repairLine('x', editSlot({ tier: 'floor' }, 'cookedWith', 'oil', orig)), '');
  assert.equal(parseRepairLine('repair x | before=floor | after=crave'), null, 'no edits, no repair');
});

test('repair: an old answer with no repair exports exactly as before', () => {
  const answers = { [round3.dishes[0].id]: { tier: 'pass', reasons: [], at: '2026-11-21T08:00:00.000Z' } };
  assert.ok(!encodeBench(round3, answers).includes('repair'));
});
