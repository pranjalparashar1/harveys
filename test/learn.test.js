import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE, parseItemList, buildInventory } from '../src/brain/index.js';
import {
  rawFeatures, featureVector, fitMarco, fitPierre, pierreTags, explainWeights, nextPair, mulberry32,
  inDiet, prePrepUnits, FEATURES, utility, VERDICT_VALUE,
} from '../src/brain/learn.js';
import { PIERRE_SEED, TECHNIQUE_OVERLAY, TRAINING_EXTRAS } from '../src/brain/train-data.js';

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

test('Pierre learns "microwaved protein is sad" from the chat verdicts', () => {
  const dishes = [...CATALOGUE.map((d) => ({ ...d, ...TECHNIQUE_OVERLAY[d.id] })), ...TRAINING_EXTRAS];
  const rows = Object.entries(PIERRE_SEED).map(([id, v]) => ({ tags: pierreTags(dishes.find((d) => d.id === id)), value: VERDICT_VALUE[v.verdict] }));
  const pierre = fitPierre(rows);
  assert.ok(pierre.weights['method:microwave'] < 0, 'microwave is disliked');
  const panPaneer = pierre.predict(pierreTags(TRAINING_EXTRAS[0]));
  const microPaneer = pierre.predict(pierreTags(dish('microwave_paneer_bhurji')));
  assert.ok(panPaneer > microPaneer, `pan-fried paneer ${panPaneer.toFixed(2)} > microwave ${microPaneer.toFixed(2)}`);
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
