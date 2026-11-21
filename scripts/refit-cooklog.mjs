// Refit Marco's friction weights from real dinners ("Cooked this").
//
//   node scripts/refit-cooklog.mjs <copy-for-claude.json> [--min 20] [--json]
//
// Input: the main page's Debug → "Copy for Claude" paste (or a bare cookLog array).
// Prints the fitted weights next to the ones in src/brain/config.js and a
// frictionTheta block to paste in. It never edits config: you review, then PR.

import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/brain/config.js';
import { cookLogFrom, refitFromCookLog } from '../src/brain/refit.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--min');
if (!file) {
  console.error('usage: node scripts/refit-cooklog.mjs <copy-for-claude.json> [--min 20] [--json]');
  process.exit(1);
}
const min = Number(args[args.indexOf('--min') + 1]) || 20;
const cookLog = cookLogFrom(readFileSync(file, 'utf8'));
const r = refitFromCookLog(cookLog, { current: DEFAULT_CONFIG.frictionTheta });

if (args.includes('--json')) {
  console.log(JSON.stringify({ dinners: r.dinners, pairs: r.pairs, skipped: r.skipped, hits: r.fit.hits, looHits: r.fit.looHits, priorHits: r.fit.priorHits, frictionTheta: r.frictionTheta, fitted: r.payload.frictionTheta }, null, 1));
  process.exit(0);
}

const f3 = (n) => (n == null ? '-' : (n >= 0 ? ' ' : '') + n.toFixed(3));
console.log(`${cookLog.length} logged dinners, ${r.dinners} usable, ${r.pairs} pairs (cooked vs shown).`);
if (r.skipped.length) console.log(`Not in the catalogue (skipped): ${r.skipped.join(', ')}`);
if (r.dinners < min) console.log(`\nWARNING: only ${r.dinners} usable dinners (want ${min}+). Don't ship these weights yet.`);
console.log(`In-sample ${r.fit.hits}/${r.pairs}, leave-one-out ${r.fit.looHits ?? '-'}/${r.pairs}, current weights ${r.fit.priorHits}/${r.pairs}.\n`);
console.log('feature     now      fitted   proposed');
for (const d of r.diff) console.log(`${d.key.padEnd(10)} ${f3(d.now)}   ${f3(d.fitted)}   ${f3(d.proposed)}${d.fitted > 0 ? '  (fitted positive, clamped)' : ''}`);
console.log(`\n// src/brain/config.js → DEFAULT_CONFIG\nfrictionTheta: Object.freeze(${JSON.stringify(r.frictionTheta)}),`);
