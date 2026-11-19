import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateQuiz, blankState, startRound, queue, tapTexture, tapTaste, tapCentre, tapPrep, tapRated, upgradeAnswer,
  canAdvance, advance, back, canGoBack, roundOver, unsent, markSent, encodePayload, decodePayload, STEPS,
} from '../src/quiz/quiz.js';
import { rawVector, roleOf, plateShape, partnersFor, dishProfile, partVector, mergeRatings, pullOf } from '../src/brain/ingredients.js';
import { renderBrainFile } from '../scripts/ingest-pierre.mjs';
import { mulberry32 } from '../src/brain/learn.js';

const quiz = validateQuiz(JSON.parse(readFileSync(new URL('../src/quiz/pierre-trainer.json', import.meta.url), 'utf8')));

test('the quiz file is valid: veg and egg foods, no spices or condiments', () => {
  assert.ok(quiz.foods.length >= 40);
  for (const later of ['besan', 'suji', 'vermicelli']) {
    assert.ok(!quiz.foods.some((f) => f.id === later), `${later} waits for Pierre-tutor`);
    assert.ok(quiz.tutor.some((f) => f.id === later));
  }
  const ids = quiz.foods.map((f) => f.id);
  assert.ok(ids.includes('bread') && !ids.includes('protein_bread'), 'plain bread; protein bread is a macro modifier for later');
  for (const banned of ['chicken', 'tuna', 'salt', 'turmeric', 'garam_masala', 'ketchup', 'mayo', 'oil']) assert.ok(!ids.includes(banned), banned);
  assert.deepEqual(quiz.textures.map((t) => t.id), ['crisp', 'creamy', 'chewy', 'juicy', 'flaky']);
  assert.deepEqual(quiz.tastes.map((t) => t.id), ['salt', 'sugar', 'fat', 'acid', 'heat', 'canvas', 'fresh']);
  assert.deepEqual(quiz.centre.map((c) => c.value), [1, 2, 3, 4, 5]);
  assert.throws(() => validateQuiz({ ...quiz, foods: [...quiz.foods, quiz.foods[0]] }), /twice/);
});

test('rounds take the user’s kitchen first, seven at a time, never a rated food', () => {
  let s = startRound(quiz, blankState(), mulberry32(1));
  assert.equal(s.round.ids.length, 7);
  const kitchen = new Set(quiz.foods.filter((f) => f.kitchen).map((f) => f.id));
  assert.ok(s.round.ids.every((id) => kitchen.has(id)));
  s = { ...s, answers: { paneer: { at: 'x' } } };
  assert.ok(!queue(quiz, s, mulberry32(2)).includes('paneer'));
});

test('every tap toggles: a second tap on the same option undoes it', () => {
  const s = startRound(quiz, blankState(), mulberry32(3));
  let d = s.round.draft;
  d = tapTexture(d, 'creamy', 3);
  assert.equal(d.texture.creamy, 3);
  d = tapTexture(d, 'creamy', 2);
  assert.equal(d.texture.creamy, 2);
  d = tapTexture(d, 'creamy', 2);
  assert.equal(d.texture.creamy, 0);
  d = tapTaste(d, 'fat', 3);
  assert.equal(d.taste.fat, 3);
  d = tapTaste(d, 'fat', 1);
  assert.equal(d.taste.fat, 1, 'a different level replaces it');
  assert.equal(tapTaste(d, 'fat', 1).taste.fat, 0);
  assert.equal(tapTaste(d, 'canvas', 3).taste.canvas, 3);
  d = tapCentre(d, 4);
  assert.equal(d.centre, 4);
  assert.equal(tapCentre(d, 4).centre, null);
});

test('three steps per food, the centre is required', () => {
  let s = startRound(quiz, blankState(), mulberry32(4));
  const first = s.round.ids[0];
  s = advance(quiz, s); // texture → taste (all none is fine)
  s = advance(quiz, s); // taste → centre
  assert.equal(STEPS[s.round.step], 'centre');
  assert.equal(canAdvance(s.round.step, s.round.draft), false);
  assert.equal(advance(quiz, s), s, 'cannot go on without a centre');
  s = { ...s, round: { ...s.round, draft: tapCentre(s.round.draft, 4) } };
  s = advance(quiz, s, new Date('2026-11-19T12:00:00Z'));
  assert.equal(s.answers[first].centre, 4);
  assert.equal(s.round.i, 1);
  assert.equal(s.round.step, 0);
  assert.equal(s.round.draft.centre, null, 'a fresh draft for the next food');
  for (let i = 1; i < 7; i++) {
    s = advance(quiz, advance(quiz, s));
    s = { ...s, round: { ...s.round, draft: tapCentre(s.round.draft, 2) } };
    s = advance(quiz, s);
  }
  assert.ok(roundOver(s));
  assert.equal(Object.keys(s.answers).length, 7);
  assert.equal(unsent(s).length, 7);
  assert.equal(unsent(markSent(s, Object.keys(s.answers), new Date('2027-01-01'))).length, 0);
});

test('Back goes to the previous step, then into the previous food with its answers', () => {
  let s = startRound(quiz, blankState(), mulberry32(6));
  assert.equal(canGoBack(s), false, 'nothing before the first screen');
  const [first, second] = s.round.ids;
  s = { ...s, round: { ...s.round, draft: tapTexture(s.round.draft, 'chewy', 2) } };
  s = advance(quiz, s);
  s = back(quiz, s);
  assert.equal(s.round.step, 0);
  assert.equal(s.round.draft.texture.chewy, 2, 'the texture is still there');
  s = advance(quiz, advance(quiz, s));
  s = { ...s, round: { ...s.round, draft: tapCentre(tapTaste(s.round.draft, 'fat', 2), 4) } };
  s = advance(quiz, s);
  assert.equal(s.round.ids[s.round.i], second);
  s = back(quiz, s);
  assert.equal(s.round.ids[s.round.i], first);
  assert.equal(s.round.step, 2);
  assert.equal(s.round.draft.centre, 4);
  s = back(quiz, s);
  assert.equal(s.round.step, 1, 'to the taste step');
  s = { ...s, round: { ...s.round, draft: tapTaste(s.round.draft, 'salt', 1) } };
  s = advance(quiz, advance(quiz, s), new Date('2026-11-19T13:00:00Z'));
  assert.equal(s.answers[first].taste.salt, 1, 'the fix is saved');
  assert.equal(s.answers[first].texture.chewy, 2);
  // From the end of a round, and from a food marked prep.
  let e = { ...s, round: { ...s.round, i: s.round.ids.length } };
  e = { ...e, answers: { ...e.answers, [e.round.ids.at(-1)]: { prep: true, at: 'x' } } };
  e = back(quiz, e);
  assert.equal(e.round.i, e.round.ids.length - 1);
  assert.equal(e.round.draft.prep, true);
  assert.equal(e.round.step, 0);
});

test('a food is rated, part of prep, or both, and the export and brain file carry it', () => {
  let s = startRound(quiz, blankState(), mulberry32(5));
  const [first, second, third] = s.round.ids;
  // Prep only (soaked poha): untick "Rate it", tick "Part of prep", straight to the next food.
  let d = tapRated(s.round.draft);
  assert.equal(canAdvance(0, d), false, 'needs at least one of the two');
  d = tapPrep(d);
  assert.equal(tapPrep(d).prep, false, 'a second tap undoes it');
  s = { ...s, round: { ...s.round, draft: d } };
  s = advance(quiz, s, new Date('2026-11-19T12:00:00Z'));
  assert.deepEqual(s.answers[first], { prep: true, at: '2026-11-19T12:00:00.000Z' });
  assert.equal(s.round.ids[s.round.i], second);
  // Both (paneer): prep ticked, ratings still asked.
  s = { ...s, round: { ...s.round, draft: tapPrep(tapTexture(s.round.draft, 'creamy', 3)) } };
  s = advance(quiz, s);
  assert.equal(s.round.step, 1, 'ratings carry on');
  s = advance(quiz, s);
  s = { ...s, round: { ...s.round, draft: tapCentre(s.round.draft, 4) } };
  s = advance(quiz, s, new Date('2026-11-19T12:01:00Z'));
  assert.equal(s.answers[second].prep, true);
  assert.equal(s.answers[second].centre, 4);
  assert.equal(s.answers[second].texture.creamy, 3);
  assert.equal(s.round.ids[s.round.i], third);
  // Back restores both kinds.
  let b = back(quiz, s);
  assert.equal(b.round.step, 2);
  assert.equal(b.round.draft.prep, true);
  assert.equal(b.round.draft.rated, true);
  b = back(quiz, back(quiz, back(quiz, b)));
  assert.equal(b.round.ids[b.round.i], first);
  assert.equal(b.round.draft.rated, false);
  assert.equal(b.round.draft.prep, true);
  // Export and ingest.
  const answers = {
    poha: { prep: true, at: '2026-11-19T12:00:00.000Z' },
    paneer: { texture: { creamy: 3 }, taste: { fat: 1 }, centre: 4, prep: true, at: '2026-11-19T12:01:00.000Z' },
    eggs: { texture: { creamy: 2 }, taste: { fat: 1 }, centre: 3, at: '2026-11-19T12:02:00.000Z' },
  };
  const text = encodePayload(quiz, answers);
  assert.match(text, /^poha \| prep \| 2026-11-19T12:00:00.000Z$/m);
  assert.match(text, /^paneer \| t 0\.3\.0\.0\.0 \| s 0\.0\.1\.0\.0\.0\.0 \| c 4 \| prep \| 2026-11-19T12:01:00.000Z$/m);
  assert.match(text, /^eggs \| t 0\.2\.0\.0\.0 \| s 0\.0\.1\.0\.0\.0\.0 \| c 3 \| 2026-11-19T12:02:00.000Z$/m);
  const backText = decodePayload(text);
  assert.deepEqual(backText.poha, { prep: true, at: '2026-11-19T12:00:00.000Z' });
  assert.equal(backText.paneer.prep, true);
  assert.equal(backText.paneer.centre, 4);
  assert.equal(backText.eggs.prep, undefined);
  const kb = mergeRatings({ version: 1, foods: { poha: { centre: 3, at: '2026-11-01T00:00:00.000Z' } }, prep: { eggs: { at: '2026-11-01T00:00:00.000Z' } } }, backText);
  assert.equal(kb.foods.poha, undefined, 'prep only: no raw ratings');
  assert.ok(kb.prep.poha);
  assert.equal(kb.foods.paneer.centre, 4, 'both: rated');
  assert.ok(kb.prep.paneer, 'both: and listed as prep');
  assert.equal(kb.prep.eggs, undefined, 'a newer rated-only answer drops the old prep mark');
  assert.equal(rawVector('paneer', kb).centre, 4);
});

test('taste is 0–3 with canvas, and pre-1.6 answers read as Medium, marked assumed', () => {
  const answers = {
    paneer: { texture: {}, taste: { fat: 2, canvas: 2 }, centre: 4, v: 2, at: '2026-11-19T13:00:00.000Z' },
    cheese_slices: { texture: {}, taste: { fat: 3, salt: 2, acid: 1 }, centre: 2, v: 2, at: '2026-11-19T13:00:00.000Z' },
    tofu: upgradeAnswer({ texture: {}, taste: { salt: 0, sugar: 1, fat: 0 }, centre: 3, at: '2026-11-19T12:00:00.000Z' }),
  };
  assert.equal(answers.tofu.taste.sugar, 2);
  assert.equal(answers.tofu.tasteAssumed, true);
  assert.equal(upgradeAnswer(answers.paneer), answers.paneer, 'new answers are left alone');
  const text = encodePayload(quiz, answers);
  assert.match(text, /^tastes salt\.sugar\.fat\.acid\.heat\.canvas\.fresh$/m);
  assert.match(text, /^cheese_slices \| t 0\.0\.0\.0\.0 \| s 2\.0\.3\.1\.0\.0\.0 \| c 2 \| /m);
  assert.match(text, /^tofu \| .* \| c 3 \| assumed \| /m);
  const back = decodePayload(text);
  assert.ok(back.cheese_slices.taste.fat > back.paneer.taste.fat, 'cheese is more fat than paneer');
  assert.equal(back.paneer.taste.canvas, 2);
  assert.equal(back.tofu.tasteAssumed, true);
  // A v1 export (taste names only) still reads.
  const v1 = decodePayload('#marco pierre-trainer v1\ntextures crisp.creamy.chewy.juicy.flaky\nbread | t 0.1.1.0.1 | s salt sugar | c 3 | 2026-11-19T12:00:00.000Z');
  assert.deepEqual([v1.bread.taste.salt, v1.bread.taste.sugar, v1.bread.tasteAssumed], [2, 2, true]);
  const kb = mergeRatings({ version: 1, foods: {} }, back);
  assert.equal(kb.foods.cheese_slices.taste.fat, 3);
  assert.equal(kb.foods.tofu.tasteAssumed, true);
  assert.equal(rawVector('paneer', kb).taste.canvas, 2);
});

test('the Send to Marco text round-trips', () => {
  const answers = {
    paneer: { texture: { crisp: 0, creamy: 3, chewy: 2, juicy: 1, flaky: 0 }, taste: { salt: 0, sugar: 0, fat: 1, acid: 0, heat: 0, fresh: 0 }, centre: 4, at: '2026-11-19T12:00:00.000Z' },
    cheese_slices: { texture: { crisp: 0, creamy: 2, chewy: 1, juicy: 0, flaky: 0 }, taste: { salt: 1, sugar: 0, fat: 1, acid: 1, heat: 0, fresh: 0 }, centre: 2, at: '2026-11-19T12:01:00.000Z' },
    makhana: { texture: { crisp: 3, creamy: 0, chewy: 0, juicy: 0, flaky: 1 }, taste: { salt: 0, sugar: 0, fat: 0, acid: 0, heat: 0, fresh: 0 }, centre: 3, at: '2026-11-19T12:02:00.000Z' },
  };
  const text = encodePayload(quiz, answers);
  assert.match(text, /^#marco pierre-trainer v2/);
  assert.match(text, /paneer \| t 0\.3\.2\.1\.0 \| s 0\.0\.1\.0\.0\.0\.0 \| c 4/);
  assert.match(text, /makhana \| t 3\.0\.0\.0\.1 \| s 0\.0\.0\.0\.0\.0\.0 \| c 3/);
  const back = decodePayload('Here you go:\n```\n' + text + '\n```\n');
  assert.equal(back.paneer.texture.creamy, 3);
  assert.equal(back.paneer.taste.fat, 1);
  assert.equal(back.cheese_slices.taste.acid, 1);
  assert.equal(back.makhana.centre, 3);
  assert.ok(Object.values(back.makhana.taste).every((v) => v === 0));
  assert.throws(() => decodePayload('hello'), /not a Pierre-trainer/);
  // A prefilled GitHub issue for every food still fits in a URL.
  const all = Object.fromEntries(quiz.foods.map((f) => [f.id, { ...answers.cheese_slices }]));
  assert.ok(encodeURIComponent(encodePayload(quiz, all)).length < 7000);
});

test('ingesting writes a brain file that imports and keeps the newest rating', async () => {
  const text = encodePayload(quiz, {
    paneer: { texture: { creamy: 3, chewy: 2 }, taste: { fat: 1 }, centre: 4, at: '2026-11-19T12:00:00.000Z' },
    eggs: { texture: { creamy: 2, juicy: 1 }, taste: { fat: 1 }, centre: 3, at: '2026-11-19T12:00:00.000Z' },
  });
  let kb = mergeRatings({ version: 1, foods: {} }, decodePayload(text));
  assert.equal(kb.foods.paneer.role, 'major');
  kb = mergeRatings(kb, { paneer: { centre: 2, at: '2026-01-01T00:00:00.000Z' } });
  assert.equal(kb.foods.paneer.centre, 4, 'an older rating does not win');
  const src = renderBrainFile(kb);
  const mod = await import('data:text/javascript,' + encodeURIComponent(src));
  assert.equal(mod.PIERRE_RAW.foods.eggs.centre, 3);
});

const KB = mergeRatings({ version: 1, foods: {} }, {
  paneer: { texture: { creamy: 3, chewy: 2, juicy: 1 }, taste: { fat: 1 }, centre: 4 },
  eggs: { texture: { creamy: 2, juicy: 2 }, taste: { fat: 1 }, centre: 3 },
  rice: { texture: { chewy: 1, creamy: 1 }, taste: {}, centre: 5 },
  onion: { texture: { crisp: 2, juicy: 2 }, taste: { sugar: 1, heat: 1, fresh: 1 }, centre: 2 },
  butter: { texture: { creamy: 3 }, taste: { fat: 1, salt: 1 }, centre: 1 },
  makhana: { texture: { crisp: 3 }, taste: {}, centre: 3 },
  mushroom: { texture: { chewy: 2, juicy: 2 }, taste: {}, centre: 3 },
});

test('centrality: major from 3, co-leads within 1 of the anchor, pull doubles per step', () => {
  assert.equal(roleOf(2), 'minor');
  assert.equal(roleOf(3), 'major');
  assert.deepEqual([1, 2, 3, 4, 5].map(pullOf), [1, 2, 4, 8, 16]);
  const bhurji = plateShape(['eggs', 'paneer', 'onion', 'butter'], KB);
  assert.equal(bhurji.anchor, 'paneer');
  assert.deepEqual(bhurji.leads, ['paneer', 'eggs']);
  assert.deepEqual(bhurji.supports, ['onion']);
  assert.deepEqual(bhurji.accents, ['butter']);
  assert.ok(bhurji.meal);
  assert.equal(bhurji.majors, 2);
  const rice = plateShape(['rice', 'eggs', 'onion'], KB);
  assert.deepEqual(rice.leads, ['rice'], 'eggs (3) are 2 below rice (5): support, not co-lead');
  assert.deepEqual(rice.supports, ['eggs', 'onion']);
  assert.equal(plateShape(['onion', 'butter'], KB).meal, false);
  assert.equal(plateShape(['paneer', 'eggs', 'mushroom', 'makhana'], KB).crowded, true);
  assert.deepEqual(partnersFor('paneer', ['eggs', 'onion', 'rice', 'butter', 'mushroom'], KB), ['rice', 'eggs', 'mushroom']);
});

test('dish profile: the anchor dominates texture, any part brings a taste', () => {
  const p = dishProfile(['paneer', 'butter', 'onion'], KB);
  assert.ok(p.texture.creamy > 2.2);
  assert.ok(p.texture.crisp < 0.5, 'a little onion does not make paneer crunchy');
  assert.equal(p.taste.salt, 1, 'butter salts the dish');
  assert.equal(p.taste.fresh, 1);
  assert.deepEqual(p.textures, ['creamy']);
  assert.deepEqual(dishProfile(['paneer', 'saffron'], KB).missing, ['saffron']);
});

test('the technique layer: a rated "food@technique" wins, an unknown technique falls back to raw', () => {
  const kb = mergeRatings(KB, { 'paneer@fried': { texture: { crisp: 2, creamy: 2, chewy: 2 }, taste: { fat: 1, salt: 0 }, centre: 4 } });
  const fried = partVector({ id: 'paneer', technique: 'fried' }, kb);
  assert.equal(fried.source, 'rated');
  assert.equal(fried.texture.crisp, 2);
  const boiled = partVector({ id: 'paneer', technique: 'boiled' }, kb);
  assert.match(boiled.source, /^raw/);
  const shifted = partVector({ id: 'paneer', technique: 'airfried' }, kb, { airfried: { texture: { crisp: 2, juicy: -1 } } });
  assert.equal(shifted.texture.crisp, 2);
  assert.equal(shifted.texture.juicy, 0);
  assert.equal(rawVector('paneer@fried', kb).centre, 4);
});

test('the pages exist and are deployed', () => {
  const html = readFileSync(new URL('../pierre.html', import.meta.url), 'utf8');
  assert.match(html, /src\/pierre\.js/);
  assert.match(readFileSync(new URL('../train.html', import.meta.url), 'utf8'), /href="pierre\.html"/);
  assert.match(readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8'), /pierre\.html/);
});
