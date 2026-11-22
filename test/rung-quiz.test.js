import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadKitchens } from '../src/brain/kitchen-test.js';
import { buildInventory } from '../src/brain/inventory.js';
import { TIER_ORDER } from '../src/brain/ranker.js';
import { buildRungQuiz, encodeRungResult, scoreRungResult, rungMarcoChoices, parseRungResults, latestRuns, kendall, seededShuffle, PER_RUNG, RUNG_FORMAT, THIN_KITCHEN } from '../src/brain/rung-quiz.js';

const cache = JSON.parse(readFileSync(new URL('../data/ingredient-cache.json', import.meta.url), 'utf8'));
const [kitchen] = loadKitchens(readFileSync(new URL('../data/test-kitchens/kitchens.json', import.meta.url), 'utf8'));
const quiz = buildRungQuiz({ kitchen, inventory: buildInventory(kitchen.items, { cache }) });

test('quiz: rungs in order, capped, Marco then Pierre on sortable rungs, then White on all', () => {
  assert.ok(quiz.rungs.length >= 2);
  assert.deepEqual(quiz.rungs.map((g) => g.rung), [...quiz.rungs.map((g) => g.rung)].sort());
  for (const g of quiz.rungs) assert.ok(g.dishes.length >= 2 && g.dishes.length <= PER_RUNG + 1);
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

const tasteFirst = (ids) => [...ids].sort((x, y) => TIER_ORDER[quiz.dishes[y].harveys.tier] - TIER_ORDER[quiz.dishes[x].harveys.tier] || quiz.dishes[x].rung - quiz.dishes[y].rung || quiz.dishes[x].harveys.order - quiz.dishes[y].harveys.order);

test('a full taste test encodes, parses back from an issue body, and scores', () => {
  const answers = { marco: {}, pierre: {}, white: {} };
  for (const g of quiz.rungs) {
    if (g.dishes.length > 1) {
      answers.marco[g.rung] = { ranking: [...g.dishes].reverse(), moved: true, ms: 4000 };
      answers.pierre[g.rung] = { ranking: tasteFirst(g.dishes), moved: true, ms: 3000 };
    }
    answers.white[g.rung] = { picks: [g.dishes[0]], criteria: ['taste', 'difficulty'], none: false, ms: 2000 };
  }
  const res = encodeRungResult(quiz, answers, { version: 'test', at: '2026-11-22T00:00:00Z', testerId: 't-1', runNo: 1 });
  assert.equal('tester' in res, false);
  assert.equal(encodeRungResult(quiz, answers, { version: 'test', at: '2026-11-22T00:00:00Z', testerId: 't-1', tester: 'Riya' }).tester, 'Riya', '1.35.0: the name from the link');
  assert.equal(res.unmovedConfirmed, true);
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

test('a rung with one dish joins its neighbour, so every group can be sorted (round 1: soya chunks alone)', () => {
  const r1 = JSON.parse(readFileSync(new URL('../data/kitchen-tests/taste-2026-11-22-aspirational_bachelor_test_persona-6s03o-t-cfybq46xz.json', import.meta.url), 'utf8'));
  const [k] = loadKitchens({ ...r1.kitchen });
  const q = buildRungQuiz({ kitchen: k, inventory: buildInventory(k.items, { cache }) });
  for (const g of q.rungs) assert.ok(g.dishes.length >= 2, `rung ${g.rung} has ${g.dishes.length}`);
  const merged = q.rungs.find((g) => g.dishes.includes('airfryer_soya_chunks'));
  assert.ok(merged.rungs.includes(4)); // 1.39.0: rung 4 has egg fried rice too now, so it may stand alone
  assert.equal(q.dishes.airfryer_soya_chunks.rung, 4); // each dish keeps its own rung
  assert.ok(q.steps.some((s) => s.section === 'marco' && s.rung === merged.rung));
});

test('scoring a merged group: Harvey’s easiest-first is rung first, then friction', () => {
  const dishes = { a: { rung: 3, harveys: { friction: 3, tier: 'pass', order: 0 } }, b: { rung: 4, harveys: { friction: 1, tier: 'pass', order: 0 } } };
  const r = { kitchen: { kitchen: 'k' }, dishes, marco: [{ rung: 3, ranking: ['a', 'b'], moved: true }], pierre: [], white: [] };
  assert.equal(scoreRungResult(r).marco.tau, 1);
});

test('send: one file per run, and #send= saves the token once', async () => {
  const mem = {};
  globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const { pathFor, captureToken, getToken, sendResult, outbox } = await import('../src/send.js');
  assert.equal(pathFor({ at: '2026-11-22T11:00:00Z', kitchenId: 'k-1', testerId: 't-9' }), 'data/kitchen-tests/taste-2026-11-22-k-1-t-9.json');
  let replaced = null;
  assert.equal(captureToken({ hash: '#send=github_pat_x&relay=off', pathname: '/harveys/', search: '' }, { replaceState: (a, b, u) => { replaced = u; } }), true);
  assert.equal(getToken(), 'github_pat_x');
  assert.equal(replaced, '/harveys/');
  // No signal: the result waits in the outbox instead of being lost.
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.equal(await sendResult({ at: '2026-11-22T11:00:00Z', kitchenId: 'k-1', testerId: 't-9', kitchen: { kitchen: 'K' } }), 'queued');
  assert.equal(outbox().length, 1);
  // Signal back: it goes, as a new file, and the outbox empties.
  const calls = [];
  globalThis.fetch = async (url, o) => { calls.push([url, o?.method]); return { ok: true, status: 201, json: async () => ({}) }; };
  assert.equal(await sendResult({ at: '2026-11-22T12:00:00Z', kitchenId: 'k-1', testerId: 't-10', kitchen: { kitchen: 'K' } }), 'sent');
  assert.equal(outbox().length, 0);
  assert.equal(calls.filter(([, m]) => m === 'PUT').length, 2);
  assert.ok(calls[0][0].endsWith('/contents/data/kitchen-tests/taste-2026-11-22-k-1-t-9.json'));
});

// 1.37.0: Banana Singh's kitchen (22 Nov): a steel pot, eggs, bread, milk, oats, no pan, no microwave.
const BANANA = { kitchen: 'Pot kitchen', items: ['eggs', 'milk', 'ghee', 'oats', 'brown bread', 'black salt', 'gas stove', 'steel pot'].map((name) => ({ name })) };

test('a steel pot cooks milk oats and a boiled-egg sandwich, not just boiled eggs', () => {
  const q = buildRungQuiz({ kitchen: BANANA, inventory: buildInventory(BANANA.items) });
  const real = Object.values(q.dishes).filter((d) => !d.away).map((d) => d.id);
  for (const id of ['boiled_eggs', 'pot_milk_oats', 'boiled_egg_sandwich']) assert.ok(real.includes(id), id);
});

// 1.38.0: the pot egg bhurji lifts BANANA to four dishes, so the thin case drops the ghee and oats.
const THIN = { kitchen: 'Thin pot kitchen', items: ['eggs', 'milk', 'brown bread', 'gas stove', 'steel pot'].map((name) => ({ name })) };

test('a thin kitchen gets one-away dishes for Marco, marked, and White shows only cookable ones', () => {
  const q = buildRungQuiz({ kitchen: THIN, inventory: buildInventory(THIN.items) });
  const all = Object.values(q.dishes);
  assert.ok(all.filter((d) => !d.away).length < THIN_KITCHEN);
  const away = all.filter((d) => d.away);
  assert.ok(away.length > 0);
  for (const d of away) assert.match(d.how, /^Needs /);
  assert.ok(q.steps.some((s) => s.section === 'marco'));
  for (const g of q.rungs) {
    for (const id of g.shown.white) assert.ok(!q.dishes[id].away, id);
    if (g.pick) assert.ok(!q.dishes[g.pick].away);
  }
  const res = encodeRungResult(q, { white: Object.fromEntries(q.rungs.map((g) => [g.rung, { picks: [], none: true }])) }, { version: 't', at: 'x', testerId: 't' });
  for (const w of res.white) assert.ok(w.harveys == null || !res.dishes[w.harveys].away);
  assert.ok(Object.values(res.dishes).some((d) => d.away));
});

test('latestRuns keeps a named tester’s last run per kitchen, never merges unnamed ones', () => {
  const r = (tester, testerId, at, kitchenId = 'k') => ({ tester, testerId, at, kitchenId });
  const runs = [r('Banana Singh', 'a', '2026-11-22T14:02'), r('banana singh', 'b', '2026-11-22T14:03'), r('', 'c', '1'), r('', 'd', '2'), r('Banana Singh', 'e', '3', 'k2')];
  assert.deepEqual(latestRuns(runs).map((x) => x.testerId), ['b', 'c', 'd', 'e']);
});

test('1.42.0 meal cards: a deck in Harvey’s order, yes/no and difficulty ratings become Marco pairs', () => {
  assert.equal(quiz.deck.length, Object.keys(quiz.dishes).length);
  const rungs = quiz.deck.map((id) => quiz.dishes[id].rung);
  assert.deepEqual(rungs, [...rungs].sort((a, b) => a - b), 'easiest rung first');
  assert.deepEqual([...quiz.rateOrder].sort(), [...quiz.deck].sort());
  assert.notDeepEqual(quiz.rateOrder, quiz.deck, 'ratings are asked in a shuffled order');
  const cards = Object.fromEntries(quiz.deck.map((id, i) => [id, { yes: i % 2 === 0, why: i % 2 ? 'taste' : 'effort', ms: 900 }]));
  // levels: Harvey's deck order gives 1,1,2,2,3,…; one tie per level
  const levels = Object.fromEntries(quiz.deck.map((id, i) => [id, { level: Math.min(5, 1 + Math.floor(i / 2)), ms: 700 }]));
  const res = encodeRungResult(quiz, { marco: {}, pierre: {}, white: {}, cards, difficulty: { levels, skipped: false } }, { version: 'test', testerId: 't-c' });
  assert.equal(res.format, RUNG_FORMAT, 'same format: the live relay takes it unchanged');
  assert.equal(res.flow, 'cards');
  assert.equal(res.cards.length, quiz.deck.length);
  assert.equal(res.cards[0].why, null, 'a yes carries no why');
  assert.equal(res.cards[1].why, 'taste');
  assert.equal(res.difficulty.ratings.length, quiz.deck.length);
  assert.deepEqual(res.difficulty.ratings.map((r) => r.id), quiz.rateOrder);
  const n = quiz.deck.length;
  const ties = quiz.deck.reduce((t, id) => { t[levels[id].level] = (t[levels[id].level] ?? 0) + 1; return t; }, {});
  const apart = n * (n - 1) / 2 - Object.values(ties).reduce((s, k) => s + k * (k - 1) / 2, 0);
  const pairs = rungMarcoChoices(res);
  assert.equal(pairs.length, apart, 'every two dishes rated apart, ties left out');
  assert.ok(pairs.every((p) => p.id.startsWith('d:')));
  const s = scoreRungResult(res);
  assert.equal(s.flow, 'cards');
  assert.equal(s.cards.yes, Math.ceil(n / 2));
  assert.equal(s.cards.firstYes, true);
  assert.equal(s.difficulty.pairs, apart);
  assert.ok(s.difficulty.agree > 0.5, 'ratings that follow Harvey’s order mostly agree with it');
  const skipped = encodeRungResult(quiz, { marco: {}, pierre: {}, white: {}, cards, difficulty: { levels: {}, skipped: true } }, { testerId: 't-s' });
  assert.equal(skipped.difficulty, null);
  assert.equal(scoreRungResult(skipped).difficulty.skipped, true);
  assert.equal(rungMarcoChoices(skipped).length, 0);
});

test('1.43.0 recipe test: effort and taste stars, can’t-make reasons, effort stars become Marco pairs', () => {
  const n = quiz.deck.length;
  // Effort follows Harvey's deck order: first dish 5 stars (effortless), later ones fewer.
  const stars = Object.fromEntries(quiz.deck.map((id, i) => [id, { effort: Math.max(1, 5 - Math.floor(i / 2)), taste: 1 + (i % 5), ms: 1200 }]));
  stars[quiz.deck[n - 1]] = { cant: 'equipment', cantOpen: true, ms: 400 };
  stars.not_a_dish = { effort: 3, taste: 3 };
  const res = encodeRungResult(quiz, { marco: {}, pierre: {}, white: {}, stars }, { version: 'test', testerId: 't-st' });
  assert.equal(res.format, RUNG_FORMAT, 'same format: the live relay takes it unchanged');
  assert.equal(res.flow, 'stars');
  assert.equal(res.stars.length, n, 'only dishes in the quiz');
  assert.deepEqual(res.stars.map((x) => x.id), quiz.deck, 'in the order shown');
  assert.equal(res.stars[n - 1].cant, 'equipment');
  assert.equal(res.stars[n - 1].effort, null);
  assert.ok(!('cantOpen' in res.stars[0]));
  assert.equal(res.difficulty.ratings.length, n - 1, 'a dish they can’t make has no effort level');
  assert.equal(res.difficulty.ratings[0].level, 1, '5 stars = level 1, effortless');
  const pairs = rungMarcoChoices(res);
  assert.ok(pairs.length > 0 && pairs.every((p) => p.id.startsWith('d:')));
  const s = scoreRungResult(res);
  assert.equal(s.flow, 'stars');
  assert.equal(s.stars.n, n);
  assert.equal(s.stars.both, n - 1);
  assert.deepEqual(s.stars.cant, { equipment: 1 });
  assert.ok(s.difficulty.agree > 0.5, 'stars that follow Harvey’s order agree with it');
  const empty = encodeRungResult(quiz, { marco: {}, pierre: {}, white: {}, stars: {} }, { testerId: 't-e' });
  assert.equal(empty.difficulty, null);
  assert.deepEqual(empty.stars, []);
});
