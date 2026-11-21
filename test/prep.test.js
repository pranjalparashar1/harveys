import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PREP_QUIZ, encodePrep, parsePrep, prepChoices, fitPrep, prepFacts, PREP_HEADER } from '../src/quiz/prep.js';
import { FEATURES, featureVector } from '../src/brain/learn.js';

test('40 questions, unique ids, a quarter held out, three energies', () => {
  assert.equal(PREP_QUIZ.length, 40);
  assert.equal(new Set(PREP_QUIZ.map((q) => q.id)).size, 40);
  assert.equal(PREP_QUIZ.filter((q) => q.holdout).length, 10);
  assert.deepEqual(new Set(PREP_QUIZ.map((q) => q.energy)), new Set(['fresh', 'okay', 'tired']));
  for (const q of PREP_QUIZ) {
    for (const side of ['a', 'b']) {
      const r = q[side].raw;
      for (const f of FEATURES) if (f.key !== 'pierre') assert.ok(Number.isFinite(f.key === 'prePrep' ? r.prePrepMinutes : r[f.key]), `${q.id}.${side}.${f.key}`);
      assert.ok(r.attention >= 0 && r.attention <= 3);
      assert.ok(prepFacts(q[side]).length >= 2);
    }
    assert.notDeepEqual(q.a.raw, q.b.raw, `${q.id}: the two ways must differ`);
  }
});

test('repeats sit apart from their originals', () => {
  const pos = new Map(PREP_QUIZ.map((q, i) => [q.id, i]));
  for (const q of PREP_QUIZ.filter((x) => x.of)) assert.ok(Math.abs(pos.get(q.id) - pos.get(q.of)) > 3, q.id);
});

test('pranjal’s cooking rules: no microwaved eggs, dal or legumes; no butter tadka', () => {
  for (const q of PREP_QUIZ) for (const o of [q.a, q.b]) {
    const text = `${q.dish} ${o.name} ${o.how}`.toLowerCase();
    if (/microwave/.test(text)) assert.doesNotMatch(text, /egg|dal|chana|chickpea|rajma|khichdi/, q.id);
    assert.doesNotMatch(text, /tadka.*butter|butter.*tadka/, q.id);
    assert.doesNotMatch(text, /chicken|tuna|tofu/, q.id);
  }
});

test('export round-trips, inside a GitHub issue body too', () => {
  const answers = { p01: { pick: 'a', at: '2026-11-21T15:00:12.000Z' }, r03: { pick: 'neither', at: null }, p09: { pick: 'either', at: '2026-11-21T15:01Z' } };
  const text = encodePrep(answers);
  assert.ok(text.startsWith(PREP_HEADER));
  assert.match(text, /p01 \| a \| 2026-11-21T15:00Z/);
  const back = parsePrep('```\n' + text + '\n```');
  assert.deepEqual(Object.keys(back).sort(), ['p01', 'p09', 'r03']);
  assert.equal(back.r03.pick, 'neither');
  assert.equal(back.r03.at, null);
});

// A simulated pranjal with known weights: the fit should predict their held-out picks.
function simulate(theta, tiredLambda = 1.6) {
  const answers = {};
  for (const q of PREP_QUIZ) {
    const lam = q.energy === 'tired' ? tiredLambda : q.energy === 'fresh' ? 0.7 : 1;
    const u = (raw) => featureVector(raw, 1).reduce((s, v, j) => s + v * theta[j] * (FEATURES[j].payoff ? 1 : lam), 0);
    answers[q.id] = { pick: u(q.a.raw) >= u(q.b.raw) ? 'a' : 'b', at: null };
  }
  return answers;
}

test('fit recovers a simulated cook: held-out picks predicted, frictions negative', () => {
  const truth = FEATURES.map((f) => (f.payoff ? f.prior : f.key === 'attention' ? -1.2 : f.key === 'cleanup' ? -1 : f.prior));
  const r = fitPrep(simulate(truth));
  assert.equal(r.answered, 40);
  assert.equal(r.held, 10);
  assert.ok(r.heldHits >= 8, `held-out ${r.heldHits}/10`);
  assert.ok(r.hits >= 34, `in-sample ${r.hits}/40`);
  assert.ok(Object.values(r.frictionTheta).every((v) => v <= 0));
  assert.ok(r.theta.attention < 0 && r.theta.cleanup < 0);
});

test('--no-taste drops the pairs where one way changes the dish', () => {
  const answers = simulate(FEATURES.map((f) => f.prior));
  const all = prepChoices(answers);
  const plain = prepChoices(answers, { noTaste: true });
  assert.equal(all.length, 40);
  assert.equal(plain.length, 40 - PREP_QUIZ.filter((q) => q.taste).length);
});

test('fit-prep script prints a config block and never edits config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prep-'));
  const file = join(dir, 'answers.txt');
  writeFileSync(file, encodePrep(simulate(FEATURES.map((f) => f.prior))));
  const before = readFileSync('src/brain/config.js', 'utf8');
  const out = execFileSync('node', ['scripts/fit-prep.mjs', file], { encoding: 'utf8' });
  assert.match(out, /Held out: predicted \d+\/10/);
  assert.match(out, /frictionTheta: Object\.freeze\(/);
  assert.equal(readFileSync('src/brain/config.js', 'utf8'), before);
});
