import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadKitchens } from '../src/brain/kitchen-test.js';
import { buildInventory } from '../src/brain/inventory.js';
import { buildRungQuiz, encodeRungResult } from '../src/brain/rung-quiz.js';
import { CATALOGUE } from '../src/brain/catalogue.js';
import { checkResult } from '../relay/worker.js';
import { blankFeedback, cleanFeedback, quickDishes, splitIdeas, placeIdea, summariseFeedback, feedbackReport } from '../src/brain/feedback.js';

const cache = JSON.parse(readFileSync(new URL('../data/ingredient-cache.json', import.meta.url), 'utf8'));
const [kitchen] = loadKitchens(readFileSync(new URL('./fixtures/bachelor-kitchen.json', import.meta.url), 'utf8'));
const quiz = buildRungQuiz({ kitchen, inventory: buildInventory(kitchen.items, { cache }) });
const [d1, d2] = Object.keys(quiz.dishes);

const fbOf = (over) => ({ ...blankFeedback(), seen: true, ...over });
const result = (feedback, testerId = 't-abc123') => encodeRungResult(quiz, { marco: {}, pierre: {}, white: {}, feedback }, { version: '1.34.0', at: '2026-11-22T12:00:00Z', testerId });

test('feedback goes in the result as clean, structured fields', () => {
  const r = result(fbOf({
    chips: ['wrong_items', 'missing_dishes', 'too_hard', 'bogus'],
    wrongItems: ['EGGS', 'not on the list'], missedItems: ['rice', 'Rice'],
    dishIdeas: [{ name: 'Maggi', quick: true }, 'aloo paratha'], tooHard: [d1, 'nope'], wouldntEat: [d2], note: '  never use the oven  ', ms: 9000,
  }));
  assert.deepEqual(r.feedback.chips, ['wrong_items', 'missing_dishes', 'too_hard']);
  assert.deepEqual(r.feedback.wrongItems, ['eggs']); // the list's own spelling, unknowns dropped
  assert.deepEqual(r.feedback.missedItems, ['rice']);
  assert.deepEqual(r.feedback.dishIdeas, [{ name: 'Maggi', quick: true }, { name: 'aloo paratha', quick: false }]);
  assert.deepEqual(r.feedback.tooHard, [d1]);
  assert.deepEqual(r.feedback.wouldntEat, []); // its chip wasn't tapped
  assert.equal(r.feedback.note, 'never use the oven');
  assert.equal(r.feedback.skipped, false);
  assert.ok(checkResult(JSON.stringify(r), Date.parse('2026-11-22T12:00:00Z')).ok, 'the live relay still takes it');
});

test('never reached is null; reached and skipped says so', () => {
  assert.equal(result(undefined).feedback, null);
  assert.equal(result(blankFeedback()).feedback, null);
  assert.equal(result(fbOf({})).feedback.skipped, true);
});

test('typed ideas split on commas and "and"; quick adds skip dishes already shown', () => {
  assert.deepEqual(splitIdeas('maggi, poha and dal chawal\nmaggi'), ['maggi', 'poha', 'dal chawal']);
  const q = buildRungQuiz({ kitchen: { kitchen: 'x', items: [] }, inventory: buildInventory([]) });
  assert.ok(quickDishes(q).includes('Maggi'));
  assert.ok(!quickDishes({ dishes: { a: { name: 'Khichdi' } } }).includes('Khichdi'));
});

test('ideas are placed: new, in the catalogue, shown, or ordering in', () => {
  assert.equal(placeIdea('aloo paratha', { catalogue: CATALOGUE }).status, 'new');
  assert.equal(placeIdea('egg bhurji', { catalogue: CATALOGUE }).status, 'catalogue');
  assert.equal(placeIdea('Egg bhurji', { shown: [{ id: 'egg_bhurji', name: 'Egg bhurji' }], catalogue: CATALOGUE }).status, 'shown');
  assert.equal(placeIdea('I’d order in').status, 'order-in');
});

test('the report pools testers into counts, catalogue candidates and notes', () => {
  const a = result(fbOf({ chips: ['missing_dishes', 'wrong_items'], dishIdeas: [{ name: 'Poha', quick: true }], wrongItems: ['eggs'], note: 'more dal please' }), 't-a');
  const b = result(fbOf({ chips: ['missing_dishes'], dishIdeas: ['poha', 'egg bhurji'] }), 't-b');
  const c = result(fbOf({ chips: ['all_good'] }), 't-c');
  const s = summariseFeedback([a, b, c], { catalogue: CATALOGUE });
  assert.equal(s.answered, 3);
  assert.deepEqual(s.chips.map((x) => [x.id, x.n]), [['missing_dishes', 2], ['all_good', 1], ['wrong_items', 1]]);
  const poha = s.ideas.find((x) => x.name.toLowerCase() === 'poha');
  assert.equal(poha.n, 2);
  assert.equal(poha.quick, 1);
  assert.deepEqual(s.wrongItems, [{ name: 'eggs', n: 1 }]);
  const md = feedbackReport(s);
  assert.match(md, /## What went wrong/);
  assert.match(md, /> more dal please/);
  assert.match(md, /New for the catalogue/);
});
