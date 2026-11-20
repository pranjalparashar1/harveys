import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateQuiz, blankState, startRound, queue, tapTexture, tapTaste, tapCentre, tapPrep, tapRated, tapRemove, upgradeAnswer,
  canAdvance, advance, back, canGoBack, roundOver, unsent, markSent, encodePayload, decodePayload, STEPS, stepsOf, tapDistance,
} from '../src/quiz/quiz.js';
import { rawVector, roleOf, plateShape, partnersFor, dishProfile, partVector, mergeRatings, pullOf } from '../src/brain/ingredients.js';
import { renderBrainFile } from '../scripts/ingest-pierre.mjs';
import { mulberry32 } from '../src/brain/learn.js';

const quiz = validateQuiz(JSON.parse(readFileSync(new URL('../src/quiz/pierre-trainer.json', import.meta.url), 'utf8')));

test('the quiz file is valid: veg and egg foods, no spices or condiments', () => {
  assert.ok(quiz.foods.length >= 35); // 38 since the dals became one food (20 Nov)
  for (const later of ['besan', 'suji', 'vermicelli']) {
    assert.ok(!quiz.foods.some((f) => f.id === later), `${later} waits for Pierre-tutor`);
    assert.ok(quiz.tutor.some((f) => f.id === later));
  }
  const ids = quiz.foods.map((f) => f.id);
  assert.ok(!ids.includes('protein_bread'), 'protein bread is a macro modifier for later');
  assert.equal(quiz.edition, 2);
  for (const id of ids) assert.ok(!quiz.done.round1.includes(id), `${id} was in round 1`);
  for (const id of ['spinach', 'okra', 'brinjal']) assert.ok(!ids.includes(id), `${id} is set aside`);
  for (const banned of ['chicken', 'tuna', 'tofu', 'salt', 'turmeric', 'garam_masala', 'ketchup', 'mayo', 'oil']) assert.ok(!ids.includes(banned), banned);
  assert.deepEqual(quiz.textures.map((t) => t.id), ['crisp', 'creamy', 'chewy', 'juicy', 'flaky']);
  assert.deepEqual(quiz.tastes.map((t) => t.id), ['sugar', 'fat', 'acid', 'canvas', 'fresh'], 'salt and heat are dish-level now (Step 3)');
  assert.deepEqual(quiz.centre.map((c) => c.value), [1, 2, 3, 4, 5]);
  assert.throws(() => validateQuiz({ ...quiz, foods: [...quiz.foods, quiz.foods[0]] }), /twice/);
});

test('rounds take everyday foods first, seven at a time, never a rated food', () => {
  let s = startRound(quiz, blankState(), mulberry32(1));
  assert.equal(s.round.ids.length, 7);
  const first = new Set(quiz.foods.filter((f) => f.kitchen || f.everyday).map((f) => f.id));
  assert.ok(first.size >= 7);
  assert.ok(s.round.ids.every((id) => first.has(id)));
  s = { ...s, answers: { roti: { at: 'x' } } };
  assert.ok(!queue(quiz, s, mulberry32(2)).includes('roti'));
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
  assert.match(text, /^poha \| prep \| 2026-11-19T12:00Z$/m);
  assert.match(text, /^paneer \| t 0\.3\.0\.0\.0 \| s 0\.1\.0\.0\.0 \| c 4 \| prep \| 2026-11-19T12:01Z$/m);
  assert.match(text, /^eggs \| t 0\.2\.0\.0\.0 \| s 0\.1\.0\.0\.0 \| c 3 \| 2026-11-19T12:02Z$/m);
  const backText = decodePayload(text);
  assert.deepEqual(backText.poha, { prep: true, at: '2026-11-19T12:00Z' });
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
  assert.match(text, /^tastes sugar\.fat\.acid\.canvas\.fresh$/m);
  assert.match(text, /^cheese_slices \| t 0\.0\.0\.0\.0 \| s 0\.3\.1\.0\.0 \| c 2 \| /m);
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

test('the Send to Harvey’s text round-trips', () => {
  const answers = {
    paneer: { texture: { crisp: 0, creamy: 3, chewy: 2, juicy: 1, flaky: 0 }, taste: { salt: 0, sugar: 0, fat: 1, acid: 0, heat: 0, fresh: 0 }, centre: 4, at: '2026-11-19T12:00:00.000Z' },
    cheese_slices: { texture: { crisp: 0, creamy: 2, chewy: 1, juicy: 0, flaky: 0 }, taste: { salt: 1, sugar: 0, fat: 1, acid: 1, heat: 0, fresh: 0 }, centre: 2, at: '2026-11-19T12:01:00.000Z' },
    makhana: { texture: { crisp: 3, creamy: 0, chewy: 0, juicy: 0, flaky: 1 }, taste: { salt: 0, sugar: 0, fat: 0, acid: 0, heat: 0, fresh: 0 }, centre: 3, at: '2026-11-19T12:02:00.000Z' },
  };
  const text = encodePayload(quiz, answers);
  assert.match(text, /^#harveys pierre-trainer v3/);
  assert.ok(decodePayload(text.replace('#harveys pierre-trainer v3', '#marco pierre-trainer v2')).paneer, 'round-1 exports still read');
  assert.match(text, /paneer \| t 0\.3\.2\.1\.0 \| s 0\.1\.0\.0\.0 \| c 4/);
  assert.match(text, /makhana \| t 3\.0\.0\.0\.1 \| s 0\.0\.0\.0\.0 \| c 3/);
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
  pasta: { texture: { chewy: 3 }, taste: { canvas: 3 }, centre: 5 },
  dal: { texture: { creamy: 2 }, taste: { canvas: 2 }, centre: 4 },
});

test('bases: one 5 per plate; a base takes 4s but never another base', () => {
  const clash = plateShape(['rice', 'pasta', 'onion'], KB);
  assert.deepEqual(clash.bases.sort(), ['pasta', 'rice']);
  assert.equal(clash.clash, true);
  const dalChawal = plateShape(['rice', 'dal', 'butter'], KB);
  assert.equal(dalChawal.clash, false);
  assert.deepEqual(dalChawal.leads, ['rice', 'dal']);
  assert.deepEqual(partnersFor('rice', ['pasta', 'dal', 'paneer', 'onion'], KB), ['dal', 'paneer']);
  assert.deepEqual(partnersFor('dal', ['pasta', 'rice'], KB), ['pasta', 'rice'], 'a 4 can join either base');
});

test('the real brain file: issue #16 ingested', async () => {
  const { PIERRE_RAW: kb } = await import('../src/brain/pierre-raw.js');
  assert.equal(kb.foods.pasta.centre, 5);
  assert.equal(kb.foods.cream.taste.canvas, 0);
  assert.ok(kb.prep.eggs && !kb.foods.eggs, 'eggs are prep only');
  assert.ok(kb.prep.paneer && kb.foods.paneer, 'paneer is rated and prep');
  for (const id of ['rice', 'oats', 'bread', 'pasta']) assert.equal(kb.foods[id].centre, 5, `${id} is a base`);
  for (const id of ['dal', 'rajma', 'chickpeas']) assert.equal(kb.foods[id].centre, 4, id);
  assert.ok(kb.excluded.includes('spinach') && !kb.prep.spinach, 'spinach set aside');
});

test('Remove from list: any step, skips the rest, exported as remove, ingested as excluded', () => {
  let s = startRound(quiz, blankState(), mulberry32(4));
  const [a, b] = s.round.ids;
  s = { ...s, round: { ...s.round, draft: tapTexture(s.round.draft, 'crisp', 2) } };
  s = advance(quiz, s); // to taste
  assert.equal(s.round.step, 1);
  s = { ...s, round: { ...s.round, draft: tapRemove(s.round.draft) } };
  assert.ok(canAdvance(s.round.step, s.round.draft), 'a removed food can always go on');
  s = advance(quiz, s, new Date('2026-11-20T10:00:00Z'));
  assert.equal(s.round.i, 1, 'removing skips the remaining steps');
  assert.deepEqual(s.answers[a], { removed: true, at: '2026-11-20T10:00:00.000Z' });
  // Undo: tap again, and the food is rated as usual.
  let d = tapRemove(tapRemove(s.round.draft));
  assert.equal(d.removed, false);
  // Back restores a removed food as removed, on its first screen.
  const prev = back(quiz, s);
  assert.equal(prev.round.i, 0);
  assert.equal(prev.round.step, 0);
  assert.equal(prev.round.draft.removed, true);
  const text = encodePayload(quiz, s.answers);
  assert.match(text, new RegExp(`${a} \\| remove \\| 2026-11-20`));
  const got = decodePayload(text);
  assert.deepEqual(got[a], { remove: true, at: '2026-11-20T10:00Z' });
  const kb = mergeRatings({ foods: { [a]: { centre: 2 } }, prep: { [a]: {} }, excluded: ['okra'] }, got);
  assert.ok(!kb.foods[a] && !kb.prep[a]);
  assert.deepEqual(kb.excluded, [a, 'okra'].sort());
  assert.ok(b);
});

test('excluded foods leave the brain and stay out on later ingests', () => {
  const kb = mergeRatings({ foods: {}, prep: { spinach: {}, eggs: {} } }, {}, { exclude: ['spinach'] });
  assert.deepEqual(Object.keys(kb.prep), ['eggs']);
  const again = mergeRatings(kb, { spinach: { prep: true, at: '2027-01-01T00:00:00Z' } });
  assert.ok(!again.prep.spinach);
  assert.deepEqual(again.excluded, ['spinach']);
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

test('dish profile: texture is the max over parts with centre 2+, contrast counts different parts', () => {
  const p = dishProfile(['paneer', 'butter', 'onion'], KB);
  assert.equal(p.texture.creamy, 3, 'paneer brings creamy');
  assert.equal(p.texture.crisp, 2, 'onion (centre 2) is a real share of the bite');
  assert.equal(p.contrast, 2, 'creamy from paneer, crisp from onion');
  assert.equal(dishProfile(['rice', 'butter'], KB).texture.creamy, 1, 'an accent (centre 1) claims no texture');
  assert.equal(dishProfile(['onion'], KB).contrast, 1, 'one part crisp and juicy is not a contrast');
  assert.equal(p.taste.salt, 2, 'butter salts the dish');
  assert.equal(dishProfile(['paneer'], KB).taste.salt, 2, 'salt is assumed present');
  assert.equal(dishProfile(['paneer'], KB, undefined, ['chilli_flakes']).taste.heat, 2, 'heat comes from modifiers');
  assert.deepEqual(dishProfile(['paneer', 'saffron'], KB).missing, ['saffron']);
});

test('the technique layer: a rated "food@technique" wins, an unknown technique falls back to raw', () => {
  const kb = mergeRatings({ foods: KB.foods }, { 'paneer@fried': { texture: { crisp: 2, creamy: 2, chewy: 2 }, taste: { fat: 1, salt: 0 }, distance: 1 } });
  assert.ok(kb.tech['paneer@fried'] && !kb.foods['paneer@fried'], 'cooked ratings live in tech');
  const fried = partVector({ id: 'paneer', technique: 'fried' }, kb);
  assert.equal(fried.source, 'rated');
  assert.equal(fried.texture.crisp, 2);
  assert.equal(fried.centre, KB.foods.paneer.centre, 'the centre is the food’s own');
  assert.equal(fried.distance, 1);
  const p1 = dishProfile([{ id: 'paneer', technique: 'fried' }, 'onion'], kb);
  assert.deepEqual([p1.inedible, p1.finish], [[], { 'paneer@fried': 'one finishing step' }]);
  const vetoed = mergeRatings(kb, { 'paneer@microwaved': { texture: { chewy: 3 }, taste: {}, distance: 'x' } });
  assert.deepEqual(dishProfile([{ id: 'paneer', technique: 'microwaved' }, 'onion'], vetoed).inedible, ['paneer@microwaved']);
  const step = mergeRatings(kb, { 'paneer@boiled': { texture: { creamy: 2 }, taste: {}, distance: 3 } });
  const p2 = dishProfile([{ id: 'paneer', technique: 'boiled' }], step);
  assert.deepEqual([p2.inedible, p2.unfinished], [[], ['paneer@boiled']], 'another step is not a veto, but not the last technique either');
  const boiled = partVector({ id: 'paneer', technique: 'boiled' }, kb);
  assert.deepEqual([boiled.source, boiled.state], ['raw', '@boiled']);
  assert.equal(partVector('paneer', kb).state, 'raw');
  const shifted = partVector({ id: 'paneer', technique: 'airfried' }, mergeRatings(kb, {}, { classes: { dense_starchy: ['paneer'] } }), { airfried: { dense_starchy: { texture: { crisp: 2, juicy: -1 } } } });
  assert.equal(shifted.source, 'prior');
  assert.equal(shifted.texture.crisp, 2);
  assert.equal(shifted.texture.juicy, 0);
});

test('the pages exist and are deployed', () => {
  const html = readFileSync(new URL('../pierre.html', import.meta.url), 'utf8');
  assert.match(html, /src\/pierre\.js/);
  assert.match(readFileSync(new URL('../train.html', import.meta.url), 'utf8'), /href="pierre\.html"/);
  assert.match(readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8'), /pierre\.html tutor\.html/);
  assert.match(readFileSync(new URL('../tutor.html', import.meta.url), 'utf8'), /data-quiz="pierre-tutor"[^]*src\/pierre\.js/);
  assert.match(readFileSync(new URL('../train.html', import.meta.url), 'utf8'), /href="tutor\.html"/);
});

const tutor = validateQuiz(JSON.parse(readFileSync(new URL('../src/quiz/pierre-tutor.json', import.meta.url), 'utf8')));

test('Pierre-tutor: pairs come from prep foods (and the tutor list), never a set-aside food', async () => {
  const { PIERRE_RAW: kb } = await import('../src/brain/pierre-raw.js');
  const tutorList = quiz.tutor.map((f) => f.id);
  assert.deepEqual(stepsOf(tutor), ['texture', 'taste', 'distance']);
  assert.deepEqual(tutor.distance.map((r) => r.value), [0, 1, 2, 3, 'x']);
  assert.ok(tutor.foods.length >= 45);
  // One food, one technique, a repeatable result (pranjal, 19 Nov): nothing whose
  // result depends on other ingredients.
  for (const vague of ['simmered', 'tadka', 'blended', 'porridge', 'soaked', 'pakora']) {
    assert.ok(!tutor.foods.some((f) => f.technique === vague), `${vague} depends on what else goes in`);
  }
  for (const f of tutor.foods) {
    assert.equal(f.id, `${f.food}@${f.technique}`);
    assert.ok(kb.prep[f.food] || tutorList.includes(f.food), `${f.food} is prep or a tutor food`);
    assert.ok(!kb.excluded.includes(f.food), `${f.food} is set aside`);
    assert.ok(tutor.techniques[f.technique], `${f.technique} is described`);
  }
  for (const id of ['eggs@scrambled', 'paneer@microwaved', 'eggs@microwaved', 'mushroom@sauteed', 'besan@chilla']) assert.ok(tutor.foods.some((f) => f.id === id), id);
});

test('Pierre-tutor: texture, taste, then distance 0–3 or x; exported as d and ingested into tech', () => {
  let s = startRound(tutor, blankState(), mulberry32(5));
  const id = s.round.ids[0];
  const steps = stepsOf(tutor);
  s = { ...s, round: { ...s.round, draft: tapTexture(s.round.draft, 'crisp', 3) } };
  s = advance(tutor, s);
  s = { ...s, round: { ...s.round, draft: tapTaste(s.round.draft, 'fat', 2) } };
  s = advance(tutor, s);
  assert.equal(steps[s.round.step], 'distance');
  assert.equal(canAdvance(s.round.step, s.round.draft, steps), false, 'needs a distance');
  assert.ok(canAdvance(s.round.step, tapDistance(s.round.draft, 0), steps), 'Done (0) is a real answer');
  let d = tapDistance(s.round.draft, 'x');
  assert.equal(d.distance, 'x');
  assert.equal(tapDistance(d, 'x').distance, null, 'tap again to clear');
  s = advance(tutor, { ...s, round: { ...s.round, draft: d } }, new Date('2026-11-20T09:00:00Z'));
  assert.deepEqual(s.answers[id], { texture: { crisp: 3, creamy: 0, chewy: 0, juicy: 0, flaky: 0 }, taste: { salt: 0, sugar: 0, fat: 2, acid: 0, heat: 0, canvas: 0, fresh: 0 }, distance: 'x', v: 2, at: '2026-11-20T09:00:00.000Z' });
  const prev = back(tutor, s);
  assert.equal(steps[prev.round.step], 'distance');
  assert.equal(prev.round.draft.distance, 'x');
  const text = encodePayload(tutor, s.answers);
  assert.match(text, /^#harveys pierre-tutor v2/);
  assert.ok(text.includes(`${id} | t 3.0.0.0.0 | s 0.0.2.0.0.0.0 | d x | 2026-11-20`));
  const got = decodePayload(text);
  assert.equal(got[id].distance, 'x');
  const kb = mergeRatings({ foods: {}, prep: {} }, got);
  assert.equal(kb.tech[id].veto, true);
  assert.equal(kb.tech[id].distance, undefined);
  assert.equal(mergeRatings({}, { 'suji@roasted': { texture: {}, taste: {}, distance: 3 } }).tech['suji@roasted'].distance, 3);
  // v1 exports (readiness r 4–0) still ingest, read as distance.
  const v1 = decodePayload('#harveys pierre-tutor v1\nbread@toasted | t 3.0.1.0.0 | s 0.1.0.0.0.3.0 | r 3 | 2026-11-20T06:36Z\neggs@microwaved | t 0.1.3.0.0 | s 0.0.1.0.0.3.0 | r 0 | 2026-11-20T06:32Z');
  assert.deepEqual([v1['bread@toasted'].distance, v1['eggs@microwaved'].distance], [1, 'x']);
  assert.equal(kb.tech[id].texture.crisp, 3);
  assert.ok(!kb.foods[id]);
  // Every pair in one issue URL.
  const all = Object.fromEntries(tutor.foods.map((f) => [f.id, s.answers[id]]));
  const url = new URLSearchParams({ title: 'Pierre-tutor: 77 foods', labels: 'pierre-tutor', body: '```\n' + encodePayload(tutor, all) + '\n```' }).toString();
  assert.ok(url.length < 7000, `issue URL is ${url.length} chars`);
});

test('makhana is set aside from Pierre (pranjal, 20 Nov), but the whey bowl stays on the menu', async () => {
  const { PIERRE_RAW: kb } = await import('../src/brain/pierre-raw.js');
  const { CATALOGUE } = await import('../src/brain/catalogue.js');
  for (const id of ['makhana', 'makhana@air_fried', 'makhana@roasted']) assert.ok(kb.excluded.includes(id), id);
  assert.equal(kb.foods.makhana, undefined);
  assert.equal(kb.prep.makhana, undefined);
  assert.equal(kb.tech['makhana@air_fried'], undefined);
  assert.ok(!tutor.foods.some((f) => f.food === 'makhana'));
  assert.ok(CATALOGUE.some((m) => m.id === 'whey_makhana_bowl'));
});

// ── v2 Step 2: the rating pass ──────────────────────────────────────────────
test('Step 2: the tutor asks whey as a shake (water, milk) and as a pancake', () => {
  for (const id of ['whey@shake_water', 'whey@shake_milk', 'whey@pancake']) assert.ok(tutor.foods.some((f) => f.id === id), id);
});

test('Step 2: the retest is blind, 12 foods with tomato and milk, anchors never retested', async () => {
  const { PIERRE_RAW: kb } = await import('../src/brain/pierre-raw.js');
  const raw = readFileSync(new URL('../src/quiz/pierre-retest.json', import.meta.url), 'utf8');
  const q = validateQuiz(JSON.parse(raw));
  const ids = q.foods.map((f) => f.id);
  assert.equal(ids.length, 12);
  for (const id of ['tomato', 'milk']) assert.ok(ids.includes(id), id);
  for (const id of ids) assert.ok(kb.foods[id]?.at.startsWith('2026-11-19'), `${id} was rated on 19 Nov`);
  const anchors = [...q.textures, ...q.tastes].map((t) => t.line).join(' ') + q.centre.map((c) => c.line).join(' ');
  for (const f of q.foods) assert.ok(!anchors.includes(`: ${f.name} `) && !anchors.includes(`Like ${f.name}.`), `${f.id} is not its own anchor`);
  assert.ok(!/"(texture|taste|centre)"\s*:\s*\{/.test(raw), 'no old ratings in the file');
  assert.match(readFileSync(new URL('../retest.html', import.meta.url), 'utf8'), /data-quiz="pierre-retest"[^]*src\/pierre\.js/);
  assert.match(readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8'), /retest\.html/);
});

test('Step 2: a retest export is reported, never ingested', async () => {
  const { isRetest } = await import('../src/quiz/quiz.js');
  const { retestReport } = await import('../scripts/retest-report.mjs');
  const q = validateQuiz(JSON.parse(readFileSync(new URL('../src/quiz/pierre-retest.json', import.meta.url), 'utf8')));
  const kb = { foods: { tomato: { texture: { crisp: 2, creamy: 0, chewy: 0, juicy: 2, flaky: 0 }, taste: { salt: 0, sugar: 1, fat: 0, acid: 2, heat: 0, canvas: 0, fresh: 2 }, centre: 2 } } };
  const text = encodePayload(q, { tomato: { texture: { crisp: 0, juicy: 3 }, taste: { acid: 2, fresh: 2, sugar: 1 }, centre: 2, at: '2026-11-21T10:00:00.000Z' } });
  assert.ok(isRetest(text));
  const { moved, rows } = retestReport(decodePayload(text), kb);
  assert.deepEqual(moved.map((d) => d.dim), ['texture.crisp']);
  assert.equal(rows[0].off1, 1);
});

test('Step 2: a prep-only food gets its centre on the prep entry, and its tutor rows use it', () => {
  const kb = mergeRatings({ foods: {}, prep: { whey: { at: '2026-11-19T14:48:22.280Z' } }, tech: { 'whey@shake_water': { texture: { creamy: 2 }, taste: {}, distance: 0 } } }, {}, { centres: { whey: 4 } });
  assert.equal(kb.prep.whey.centre, 4);
  const v = partVector({ id: 'whey', technique: 'shake_water' }, kb);
  assert.equal(v.source, 'rated');
  assert.equal(v.centre, 4);
  // A later prep answer keeps the centre.
  assert.equal(mergeRatings(kb, { whey: { prep: true, at: '2026-11-22T10:00:00.000Z' } }).prep.whey.centre, 4);
  assert.throws(() => mergeRatings(kb, {}, { centres: { tomato: 3 } }), /not a prep-only food/);
});

test('Step 2: whey and eggs have a centre, and the three dish tiers are seeded', async () => {
  const { PIERRE_RAW: kb } = await import('../src/brain/pierre-raw.js');
  const { PIERRE_SEED } = await import('../src/brain/train-data.js');
  assert.equal(kb.prep.whey.centre, 3);
  assert.equal(kb.prep.eggs.centre, 4);
  const tiers = { microwave_paneer_bhurji: 'floor', paneer_wrap: 'pass', whey_makhana_bowl: 'floor' };
  const asVerdict = { veto: 'fail', floor: 'meh', pass: 'pass', crave: 'pass' };
  for (const [id, tier] of Object.entries(tiers)) {
    assert.equal(PIERRE_SEED[id].tier, tier, id);
    assert.equal(PIERRE_SEED[id].verdict, asVerdict[tier], id);
  }
});

test('all dals are one food, "dal"; chole, rajma and chana stay separate (pranjal, 20 Nov)', async () => {
  const { PIERRE_RAW: kb } = await import('../src/brain/pierre-raw.js');
  const { FOODS } = await import('../src/brain/vocabulary.js');
  for (const id of ['moong_dal', 'masoor_dal', 'toor_dal', 'urad_dal', 'chana_dal']) {
    assert.ok(!kb.foods[id] && !kb.prep[id] && !FOODS[id], `${id} is gone`);
    assert.equal(kb.aliases[id], 'dal');
  }
  assert.equal(kb.foods.dal.centre, 4);
  for (const id of ['rajma', 'chickpeas', 'kala_chana']) assert.ok(kb.foods[id], `${id} stays`);
  // A later rating under an old id lands on dal.
  const later = mergeRatings(kb, { toor_dal: { texture: { creamy: 3 }, taste: {}, centre: 4, at: '2026-11-21T10:00:00.000Z' } });
  assert.equal(later.foods.dal.texture.creamy, 3);
  assert.ok(!later.foods.toor_dal);
});
