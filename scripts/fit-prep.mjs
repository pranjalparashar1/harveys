// Fit Marco's friction weights from the prep quiz (prep.html → "Send to Harvey's").
//
//   node scripts/fit-prep.mjs <answers.txt> [--no-taste] [--json]
//
// Input: the issue body or the copied text. Fits on 3 of every 4 questions, checks the
// held-out quarter, then fits on all of them. Prints the weights next to src/brain/config.js
// and a frictionTheta block to paste in. It never edits config: you review, then PR.

import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/brain/config.js';
import { parsePrep, fitPrep, PREP_QUIZ } from '../src/quiz/prep.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node scripts/fit-prep.mjs <answers.txt> [--no-taste] [--json]');
  process.exit(1);
}
const answers = parsePrep(readFileSync(file, 'utf8'));
const r = fitPrep(answers, { current: DEFAULT_CONFIG.frictionTheta, noTaste: args.includes('--no-taste') });

if (args.includes('--json')) {
  console.log(JSON.stringify({ answered: r.answered, heldHits: r.heldHits, held: r.held, hits: r.hits, looHits: r.looHits, lambdas: r.lambdas, theta: r.theta, frictionTheta: r.frictionTheta }, null, 1));
  process.exit(0);
}

const f3 = (n) => (n == null ? '-' : (n >= 0 ? ' ' : '') + n.toFixed(3));
console.log(`${r.answered} of ${PREP_QUIZ.length} answered.`);
console.log(`Held out: predicted ${r.heldHits}/${r.held} (fit on the other ${r.train}).`);
console.log(`All: in-sample ${r.hits}/${r.answered}, leave-one-out ${r.looHits ?? '-'}/${r.answered}, current weights ${r.priorHits}/${r.answered}.`);
console.log(`λ by energy: ${Object.entries(r.lambdas).map(([m, l]) => `${m} ${l}`).join(', ')}\n`);
console.log('feature     now      fitted   proposed');
for (const d of r.diff) console.log(`${d.key.padEnd(10)} ${f3(d.now)}   ${f3(d.fitted)}   ${f3(d.proposed)}${d.fitted > 0 ? '  (fitted positive, clamped)' : ''}`);
console.log(`\n// src/brain/config.js → DEFAULT_CONFIG\nfrictionTheta: Object.freeze(${JSON.stringify(r.frictionTheta)}),`);
