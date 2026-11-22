import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadKitchens } from '../src/brain/kitchen-test.js';
import { buildInventory } from '../src/brain/inventory.js';
import { buildRungQuiz, encodeRungResult, scoreRungResult, rungMarcoChoices, parseRungResults, kendall, seededShuffle, PER_RUNG, RUNG_FORMAT } from '../src/brain/rung-quiz.js';

const cache = JSON.parse(readFileSync(new URL('../data/ingredient-cache.json', import.meta.url), 'utf8'));
const [kitchen] = loadKitchens(readFileSync(new URL('../data/test-kitchens/kitchens.json', import.meta.url), 'utf8'));
const quiz = buildRungQuiz({ kitchen, inventory: buildInventory(kitchen.items, { cache }) });

test('quiz: rungs in order, capped, Marco then Pierre on sortable rungs, then White on all', () => {
  assert.ok(quiz.rungs.length >= 2);
  assert.deepEqual(quiz.rungs.map((g) => g.rung), [...quiz.rungs.map((g) => g.rung)].sort());
  for (const g of quiz.rungs) assert.ok(g.dishes.length >= 1 && g.dishes.length <= PER_RUNG);
  const sortable = quiz.rungs.filter((g) => g.dishes.length > 1).length;
  assert.deepEqual(quiz.steps.map((s) => s.section), [...Array(sortable).fill('marco'), ...Array(sortable).fill('pierre'), ...Array(quiz.rungs.length).fill('white')]);
});

test('shown orders are seeded shuffles of the rung, never Harvey’s own order', () => {
  for (const g of quiz.rungs.filter((x) => x.dishes.length > 1)) {
    for (const s of ['marco', 'pierre', 'white']) {
      assert.deepEqual([...g.shown[s]].sort(), [...g.dishes].sort());
      assert.notDeepEqual(g.shown[s], g.dishes);
    }
  }
  assert.deepEqual(seededShuffle([1, 2, 3, 4], 'x'), seededShuffle([1, 2, 3, 4], 'x'));
});

test('kendall: same order 1, reversed −1', () => {
  assert.equal(kendall(['a', 'b', 'c'], ['a', 'b', 'c']), 1);
  assert.equal(kendall(['a', 'b', 'c'], ['c', 'b', 'a']), -1);
});

test('a full taste test encodes, parses back from an issue body, and scores', () => {
  const answers = { marco: {}, pierre: {}, white: {} };
  for (const g of quiz.rungs) {
    if (g.dishes.length > 1) {
      answers.marco[g.rung] = { ranking: [...g.dishes].reverse(), moved: true, ms: 4000 };
      answers.pierre[g.rung] = { ranking: [...g.dishes], moved: true, ms: 3000 };
    }
    answers.white[g.rung] = { picks: [g.dishes[0]], criteria: ['taste', 'difficulty'], none: false, ms: 2000 };
  }
  const res = encodeRungResult(quiz, answers, { version: 'test', at: '2026-11-22T00:00:00Z', testerId: 't-1', tester: 'A' });
  assert.equal(res.format, RUNG_FORMAT);
  assert.equal(res.kitchenId, quiz.id);
  const [back] = parseRungResults('Sent from my phone\n```json\n' + JSON.stringify(res) + '\n```');
  assert.deepEqual(back, res);
  const pairs = res.marco.reduce((n, m) => n + (m.ranking.length * (m.ranking.length - 1)) / 2, 0);
  assert.equal(rungMarcoChoices(res).length, pairs);
  const s = scoreRungResult(res);
  assert.equal(s.pierre.tau, 1); // Harvey's own order, tier first, is what was given
  assert.equal(s.white.hits, quiz.rungs.length);
  assert.ok(s.white.criteria.taste > s.white.criteria.difficulty);
});

test('White "none of these" sends no picks', () => {
  const g = quiz.rungs[0];
  const res = encodeRungResult(quiz, { marco: {}, pierre: {}, white: { [g.rung]: { picks: [g.dishes[0]], none: true, criteria: [] } } }, { testerId: 't' });
  assert.deepEqual(res.white[0].picks, []);
  assert.equal(res.white[0].none, true);
});
