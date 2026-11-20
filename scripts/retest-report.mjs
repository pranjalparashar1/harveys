// Step 2 test-retest report: compares a "Pierre retest" export with the 19 Nov ratings in
// src/brain/pierre-raw.js and lists every dimension that moved by 2 or more. Those are
// flagged for the Step 4 benchmark; nothing in the brain is changed.
//   node scripts/retest-report.mjs retest.txt   (or pipe the text in)
import { readFileSync } from 'node:fs';
import { decodePayload } from '../src/quiz/quiz.js';
import { PIERRE_RAW } from '../src/brain/pierre-raw.js';

export function retestReport(ratings, kb = PIERRE_RAW) {
  const rows = [];
  const moved = [];
  for (const [id, r] of Object.entries(ratings)) {
    const old = kb.foods[id];
    if (!old || r.centre == null) continue;
    const dims = [
      ...Object.keys(old.texture).map((k) => [`texture.${k}`, old.texture[k], r.texture?.[k] ?? 0]),
      ...Object.keys(old.taste).map((k) => [`taste.${k}`, old.taste[k], r.taste?.[k] ?? 0]),
      ['centre', old.centre, r.centre],
    ];
    const diffs = dims.map(([dim, a, b]) => ({ id, dim, was: a, now: b, by: Math.abs(a - b) }));
    rows.push({ id, same: diffs.filter((d) => d.by === 0).length, off1: diffs.filter((d) => d.by === 1).length, dims: diffs.length });
    moved.push(...diffs.filter((d) => d.by >= 2));
  }
  return { rows, moved };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rows, moved } = retestReport(decodePayload(readFileSync(process.argv[2] ?? 0, 'utf8')));
  console.log('| food | same | off by 1 | off by 2+ |\n|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.id} | ${r.same}/${r.dims} | ${r.off1} | ${r.dims - r.same - r.off1} |`);
  console.log(`\nMoved by 2 or more (flagged for the benchmark, not changed): ${moved.length}`);
  for (const d of moved) console.log(`- ${d.id} ${d.dim}: ${d.was} → ${d.now}`);
}
