import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cookLogChoices, cookLogFrom, refitFromCookLog } from '../src/brain/refit.js';
import { DEFAULT_CONFIG } from '../src/brain/config.js';

const entry = (dishId, rung, picks, alts = [], tier = 'pass') => ({
  dishId, rung, tier,
  ladderShown: picks.map(([id, r, t = 'pass']) => ({ rung: r, pickId: id, tier: t })),
  alternativesShown: alts.map(([id, t = 'floor']) => ({ id, tier: t })),
  at: '2026-11-21T19:00:00Z',
});
const LADDER = [['whey_milk_shake', 1], ['airfryer_protein_cheese_toast', 2], ['pasta_aglio_olio_paneer', 4]];

test('a dinner beats every other rung pick and every same-rung alternative', () => {
  const e = entry('airfryer_protein_cheese_toast', 2, LADDER, [['microwave_paneer_bhurji']]);
  const { choices, dinners } = cookLogChoices([e]);
  assert.equal(dinners, 1);
  assert.deepEqual(choices.map((c) => [c.b, c.kind]), [['whey_milk_shake', 'skip'], ['pasta_aglio_olio_paneer', 'skip'], ['microwave_paneer_bhurji', 'override']]);
  assert.ok(choices.every((c) => c.pick === 'a' && c.a === 'airfryer_protein_cheese_toast'));
});

test('AI recipes and unknown dishes are skipped, not guessed', () => {
  const { choices, dinners, skipped } = cookLogChoices([entry('ai_recipe_1', 3, [['ai_recipe_1', 3], ['whey_milk_shake', 1]])]);
  assert.equal(choices.length, 0);
  assert.equal(dinners, 0);
  assert.deepEqual(skipped, ['ai_recipe_1']);
});

test('reads a Copy for Claude paste or a bare array', () => {
  const log = [entry('whey_milk_shake', 1, LADDER)];
  assert.deepEqual(cookLogFrom(JSON.stringify({ version: '1.21.0', cookLog: log })), log);
  assert.deepEqual(cookLogFrom(log), log);
  assert.throws(() => cookLogFrom('{}'), /no cookLog/);
});

test('refit proposes non-positive friction weights and leaves config alone', () => {
  const before = JSON.stringify(DEFAULT_CONFIG.frictionTheta);
  const log = Array.from({ length: 6 }, () => entry('whey_milk_shake', 1, LADDER));
  const r = refitFromCookLog(log, { current: DEFAULT_CONFIG.frictionTheta });
  assert.equal(r.dinners, 6);
  assert.equal(r.pairs, 12);
  for (const [k, v] of Object.entries(r.frictionTheta)) assert.ok(v <= 0, `${k} = ${v}`);
  assert.deepEqual(r.diff.map((d) => d.key).sort(), Object.keys(DEFAULT_CONFIG.frictionTheta).sort());
  assert.equal(JSON.stringify(DEFAULT_CONFIG.frictionTheta), before);
});

test('the script runs end to end on a paste, warns when there are too few dinners', () => {
  const dir = mkdtempSync(join(tmpdir(), 'refit-'));
  const file = join(dir, 'paste.json');
  writeFileSync(file, JSON.stringify({ cookLog: [entry('whey_milk_shake', 1, LADDER)] }));
  const config = readFileSync(new URL('../src/brain/config.js', import.meta.url), 'utf8');
  const out = execFileSync('node', [new URL('../scripts/refit-cooklog.mjs', import.meta.url).pathname, file], { encoding: 'utf8' });
  assert.match(out, /1 usable/);
  assert.match(out, /WARNING: only 1 usable dinners/);
  assert.match(out, /frictionTheta: Object\.freeze\(/);
  assert.equal(readFileSync(new URL('../src/brain/config.js', import.meta.url), 'utf8'), config, 'config untouched');
});
