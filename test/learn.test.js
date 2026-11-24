import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE, parseItemList, buildInventory } from '../src/brain/index.js';
import {
  rawFeatures, featureVector, fitMarco, explainWeights, nextPair, mulberry32,
  inDiet, prePrepUnits, FEATURES, utility,
} from '../src/brain/learn.js';
import * as learn from '../src/brain/learn.js';
import { TECHNIQUE_OVERLAY } from '../src/brain/train-data.js';
import { rungOf } from '../src/brain/ranker.js';

const dish = (id) => ({ ...CATALOGUE.find((d) => d.id === id), ...TECHNIQUE_OVERLAY[id] });

test('the stove is not a tool on top of the pan', () => {
  assert.equal(rawFeatures({ equipment: ['stovetop', 'pan'], utensils: ['plate'], steps: [] }).tools, 1);
  assert.equal(rawFeatures({ equipment: ['induction'], utensils: [], steps: [] }).tools, 1, 'a stove alone (no vessel) still counts');
  assert.equal(rawFeatures(dish('airfryer_protein_cheese_toast')).tools, 1);
});

test('peeling garlic or onion is separate from an easy cut', () => {
  const aglio = rawFeatures(dish('pasta_aglio_olio_paneer'));
  assert.equal(aglio.peels, 1); // garlic
  assert.equal(aglio.cuts, 1); // paneer cubes
  const tikka = rawFeatures(dish('airfryer_paneer_tikka'));
  assert.equal(tikka.peels, 0);
  assert.equal(tikka.cuts, 1);
});

test('pre-prep is a variable: poha 15 min, khichdi 1 h, chickpeas overnight', () => {
  assert.equal(rawFeatures(dish('poha')).prePrepMinutes, 15);
  assert.equal(rawFeatures(dish('moong_dal_khichdi')).prePrepMinutes, 60);
  assert.equal(rawFeatures(dish('chana_chaat')).prePrepMinutes, 480);
  assert.equal(prePrepUnits(0), 0);
  assert.ok(prePrepUnits(15) < prePrepUnits(60) && prePrepUnits(60) < prePrepUnits(480));
});

test('the training pool is vegetarian plus eggs', () => {
  const pool = CATALOGUE.filter(inDiet).map((d) => d.id);
  assert.ok(!pool.includes('airfryer_chicken_breast'));
  assert.ok(!pool.includes('tuna_mayo_toast'));
  assert.ok(pool.includes('egg_bhurji'));
});

test('the tag-logistic Pierre is gone: Pierre is pierreTier() everywhere (5B)', () => {
  for (const name of ['fitPierre', 'pierreSummary', 'pierreTags', 'tagLabel', 'VERDICT_VALUE']) assert.equal(learn[name], undefined, name);
  for (const o of Object.values(TECHNIQUE_OVERLAY)) assert.equal(o.pierreTags, undefined);
});

/** A simulated user who hates peeling far more than the prior assumes. */
function simulate(n, seed = 7) {
  const rng = mulberry32(seed);
  const pool = CATALOGUE.filter(inDiet).map((d) => ({ id: d.id, x: featureVector(rawFeatures(d), 0.75) }));
  const truth = FEATURES.map((f) => (f.key === 'peels' ? -3 : f.prior));
  const choices = [];
  for (let i = 0; i < n; i++) {
    const a = pool[Math.floor(rng() * pool.length)];
    let b = pool[Math.floor(rng() * pool.length)];
    if (a === b) b = pool[(pool.indexOf(a) + 1) % pool.length];
    const p = 1 / (1 + Math.exp(-(utility(truth, a.x) - utility(truth, b.x))));
    choices.push({ xa: a.x, xb: b.x, pick: rng() < p ? 'a' : 'b', mood: 'okay' });
  }
  return choices;
}

test('pairwise choices move the weights toward the truth', () => {
  // One seed is luck (removing 3 meals in v2 Step 1 flipped seed 7), so judge the
  // median over five simulated users with 300 picks each.
  const start = explainWeights(FEATURES.map((f) => f.prior)).find((w) => w.key === 'peels');
  const fits = [1, 2, 3, 4, 5].map((seed) => fitMarco(simulate(300, seed)));
  const grams = fits.map((f) => explainWeights(f.theta).find((w) => w.key === 'peels').gramsPerUnit).sort((a, b) => a - b);
  assert.ok(grams[2] > start.gramsPerUnit * 1.5, `median peeling ${grams[2]} g vs start ${start.gramsPerUnit} g`);
  const fit = fitMarco(simulate(120));
  assert.ok(fit.hits >= fit.priorHits, 'fitted weights explain the picks at least as well as the prior');
  assert.ok(fit.looHits != null);
});

test('no picks means the prior, unchanged', () => {
  const fit = fitMarco([]);
  FEATURES.forEach((f, j) => assert.ok(Math.abs(fit.theta[j] - f.prior) < 1e-9));
});

test('"neither" teaches the would-cook threshold', () => {
  const x = featureVector(rawFeatures(dish('besan_chilla')), 0.5);
  const fit = fitMarco(Array.from({ length: 6 }, () => ({ xa: x, xb: x, pick: 'neither', mood: 'okay' })));
  assert.ok(fit.outside > 0);
});

test('tired nights get their own λ once there are enough of them', () => {
  const base = simulate(30, 3);
  const tired = simulate(12, 4).map((c) => ({ ...c, mood: 'tired' }));
  const fit = fitMarco([...base, ...tired]);
  assert.ok(Number.isFinite(fit.lambdas.tired));
  assert.equal(fit.lambdas.okay, 1);
});

test('the next pair is two different dishes and avoids repeats', () => {
  const pool = CATALOGUE.filter(inDiet).map((d) => ({ id: d.id, x: featureVector(rawFeatures(d), 0.75) }));
  const theta = FEATURES.map((f) => f.prior);
  const rng = mulberry32(1);
  const [a, b] = nextPair(pool, { theta, rng });
  assert.notEqual(a.id, b.id);
  const seen = new Set([[a.id, b.id].sort().join('|')]);
  const again = nextPair(pool, { theta, rng, seenPairs: seen, last: [a.id, b.id] });
  assert.notDeepEqual([again[0].id, again[1].id].sort(), [a.id, b.id].sort());
});

test('a pasted list becomes the inventory', () => {
  const items = parseItemList('- 12 eggs\n• Amul butter, paneer; protein bread\n1. air fryer\n\neggs');
  assert.deepEqual(items, ['12 eggs', 'Amul butter', 'paneer', 'protein bread', 'air fryer', 'eggs']);
  const inv = buildInventory(items.map((name) => ({ name })));
  for (const id of ['eggs', 'butter', 'paneer', 'protein_bread', 'air_fryer']) assert.ok(inv.have.has(id), id);
});

test('every element the trainer looks up exists in train.html', () => {
  const js = readFileSync(new URL('../src/train.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../train.html', import.meta.url), 'utf8');
  const ids = [...new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]))];
  const dynamic = new Set(FIELDS_FROM(js));
  assert.deepEqual(ids.filter((id) => !html.includes(`id="${id}"`)), []);
  for (const f of dynamic) assert.ok(html.includes(`id="d-${f}"`), `d-${f}`);
});

function FIELDS_FROM(js) {
  const m = js.match(/const FIELDS = \[([^\]]+)\]/);
  return m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [];
}

test('5B: nextPair with maxRungGap 1 never pairs rung 1 with rung 4 when closer pairs exist', () => {
  const pool = CATALOGUE.filter(inDiet).map((d) => ({ id: d.id, x: featureVector(rawFeatures(d), 0.75), rung: rungOf(d) }));
  assert.ok(pool.some((p) => p.rung === 1) && pool.some((p) => p.rung === 4));
  const theta = FEATURES.map((f) => f.prior);
  const rng = mulberry32(3);
  let same = 0;
  for (let k = 0; k < 200; k++) {
    const [a, b] = nextPair(pool, { theta, rng, maxRungGap: 1 });
    assert.ok(Math.abs(a.rung - b.rung) <= 1, `${a.id} (${a.rung}) vs ${b.id} (${b.rung})`);
    if (a.rung === b.rung) same++;
  }
  assert.ok(same > 100, `most pairs within one rung (${same}/200)`);
});

test('5B: nextPair falls back to any pair when no pair is close enough', () => {
  const pool = [{ id: 'a', x: [0], rung: 1 }, { id: 'b', x: [0], rung: 4 }];
  const pair = nextPair(pool, { theta: [0], rng: mulberry32(1), maxRungGap: 1 });
  assert.deepEqual(pair.map((p) => p.id).sort(), ['a', 'b']);
});

test('5B: the fitted-weights payload is ready for config.js (protein-scaled friction θ)', () => {
  const fit = fitMarco(simulate(60));
  const p = learn.fittedWeightsPayload(fit, []);
  assert.equal(p.taps, 60);
  const friction = FEATURES.filter((f) => !f.payoff).map((f) => f.key);
  assert.deepEqual(Object.keys(p.frictionTheta).sort(), [...friction].sort());
  for (const k of friction) assert.ok(Number.isFinite(p.frictionTheta[k]), k);
  assert.ok(p.explained.some((w) => w.key === 'peels'));
  // Round trip: the ranker reads the same keys from config.frictionTheta.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(p)));
});

test('"Equivalent" pulls two dishes toward equal utility', () => {
  const a = CATALOGUE.find((d) => d.id === 'airfryer_protein_cheese_toast');
  const b = CATALOGUE.find((d) => d.id === 'stovetop_paneer_bhurji');
  const xa = featureVector(rawFeatures(a), 0.75);
  const xb = featureVector(rawFeatures(b), 0.75);
  const prior = FEATURES.map((f) => f.prior);
  const gap = (th) => Math.abs(utility(th, xa) - utility(th, xb));
  const fit = fitMarco(Array.from({ length: 12 }, () => ({ xa, xb, pick: 'either', mood: 'okay' })));
  assert.ok(gap(fit.theta) < gap(prior), `gap ${gap(fit.theta).toFixed(3)} < prior ${gap(prior).toFixed(3)}`);
  assert.ok(fit.outside < 0.5, 'you would cook either');
});

test('1.51.0: an egg dish carries 2 extra hands-on minutes for cracking or peeling', async () => {
  const { rawFeatures: raw, EGG_HANDLING_MINUTES } = await import('../src/brain/learn.js');
  const steps = [{ text: 'Boil.', active: 1, passive: 9 }];
  const eggs = raw({ ingredients: [{ id: 'eggs' }], steps });
  const plain = raw({ ingredients: [{ id: 'rice' }], steps });
  const optional = raw({ ingredients: [{ id: 'rice' }, { id: 'eggs', optional: true }], steps });
  assert.equal(EGG_HANDLING_MINUTES, 2);
  assert.equal(eggs.handsOn, plain.handsOn + 2);
  assert.equal(optional.handsOn, plain.handsOn);
  assert.equal(raw({ ingredients: [{ id: 'eggs' }], steps, counts: { handsOn: 3 } }).handsOn, 3);
});
