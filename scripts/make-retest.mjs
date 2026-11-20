// Step 2 test-retest (v2 plan): writes src/quiz/pierre-retest.json, a blind re-rating of
// 10 foods rated on 19 Nov, picked at random, plus tomato and milk. Each 0–3 level and
// each centre shows fixed anchor foods: foods pranjal rated at that level, never one in
// the retest itself. No old ratings and no LLM numbers are shown.
//   node scripts/make-retest.mjs [seed]
import { writeFileSync, readFileSync } from 'node:fs';
import { PIERRE_RAW } from '../src/brain/pierre-raw.js';

const ALWAYS = ['tomato', 'milk'];
const PICK = 10;
const seed = Number(process.argv[2] ?? 20261120);

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (list, rng) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

export function buildRetest(kb = PIERRE_RAW, trainer, rng = mulberry32(seed)) {
  const names = Object.fromEntries(trainer.foods.map((f) => [f.id, f.name]));
  const nameOf = (id) => names[id] ?? id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const on19 = Object.keys(kb.foods).filter((id) => kb.foods[id].at?.startsWith('2026-11-19') && !ALWAYS.includes(id)).sort();
  const ids = [...shuffle(on19, rng).slice(0, PICK), ...ALWAYS];
  const pool = Object.keys(kb.foods).filter((id) => !ids.includes(id)).sort();
  // One anchor per level: a food rated exactly there (taste levels guessed pre-1.6 don't count).
  const anchor = (get, lv, tasteDim) => {
    const c = pool.filter((id) => get(kb.foods[id]) === lv && !(tasteDim && kb.foods[id].tasteAssumed));
    return c.length ? nameOf(shuffle(c, rng)[0]) : '–';
  };
  const line = (get, tasteDim) => trainer.levels.map((w, lv) => `${w}: ${anchor(get, lv, tasteDim)}`).join(' · ');
  return {
    format: 'marco-quiz',
    version: 1,
    id: 'pierre-retest',
    title: 'Pierre retest',
    purpose: 'Blind re-rating of 12 raw foods against fixed anchors, to see how steady the 19 Nov ratings are.',
    round: ids.length,
    steps: ['texture', 'taste', 'centre'],
    kinds: false,
    seed,
    textures: trainer.textures.map((t) => ({ ...t, line: line((f) => f.texture[t.id]) })),
    levels: trainer.levels,
    tastes: trainer.tastes.map((t) => ({ ...t, line: `${t.line ? `${t.line}. ` : ''}${line((f) => f.taste[t.id], true)}` })),
    centre: trainer.centre.map((c) => ({ ...c, line: `${c.line} Like ${anchor((f) => f.centre, c.value)}.` })),
    rated: trainer.rated,
    foods: ids.map((id) => ({ id, name: nameOf(id) })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const trainer = JSON.parse(readFileSync(new URL('../src/quiz/pierre-trainer.json', import.meta.url), 'utf8'));
  const q = buildRetest(PIERRE_RAW, trainer);
  writeFileSync(new URL('../src/quiz/pierre-retest.json', import.meta.url), `${JSON.stringify(q, null, 2)}\n`);
  console.log(`retest: ${q.foods.map((f) => f.id).join(', ')}`);
}
