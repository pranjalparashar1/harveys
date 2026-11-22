#!/usr/bin/env node
// Kitchen test mode (1.30.0): read results back and score Harvey's three brains.
//
//   node scripts/kitchen-tests.mjs plan [kitchens.json …]   print each kitchen's three quizzes
//   node scripts/kitchen-tests.mjs score [results …]        score each result, then fit Marco on all
//
// plan defaults to data/test-kitchens/kitchens.json; score defaults to data/kitchen-tests/*.json.
// Results are the downloaded files, the copied text, or a kitchen-test issue body.
// score never edits config: it prints the pooled frictionTheta and Pierre verdicts to review.

import { readFileSync, readdirSync } from 'node:fs';
import { loadKitchens, buildKitchenTest, whiteFor, parseResults, scoreResult, marcoChoices, fitFrom } from '../src/brain/kitchen-test.js';
import { DEFAULT_CONFIG } from '../src/brain/config.js';

const [cmd = 'score', ...rest] = process.argv.slice(2);
const files = rest.filter((a) => !a.startsWith('--'));
const dir = new URL('../data/kitchen-tests/', import.meta.url);
const allKitchens = () => loadKitchens(readFileSync(new URL('../data/test-kitchens/kitchens.json', import.meta.url), 'utf8'));

if (cmd === 'plan') {
  const ks = files.length ? files.flatMap((f) => loadKitchens(readFileSync(f, 'utf8'))) : allKitchens();
  for (const k of ks) {
    const t = buildKitchenTest(k);
    console.log(`## ${k.kitchen}  [${t.id}]  ${t.summary.items} items, ${t.summary.cookable} dishes`);
    console.log(`Pierre (${t.pierre.length}): ${t.pierre.map((p) => `${p.name} (${p.harveys})`).join('; ')}`);
    console.log(`Marco (${t.marco.length}):`);
    for (const q of t.marco) console.log(`  ${q.id} ${q.A.name}  vs  ${q.B.name}`);
    console.log(`White now: ${whiteFor(t).ladder.map((d) => `${d.rung} ${d.name}`).join(' | ') || 'nothing'}\n`);
  }
  process.exit(0);
}

const paths = files.length ? files : readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => new URL(n, dir));
const results = paths.flatMap((p) => parseResults(readFileSync(p, 'utf8')));
if (!results.length) { console.log('No kitchen-test results found.'); process.exit(0); }
const known = Object.fromEntries(allKitchens().map((k) => [k.id, k]));

const pooled = [];
const verdicts = {};
for (const r of results) {
  const s = scoreResult(r);
  console.log(`## ${s.kitchen}  [${s.kitchenId}]  persona: ${r.persona || '-'}`);
  console.log(`   Pierre: ${s.pierre.exact}/${s.pierre.n} exact, ${s.pierre.withinOne}/${s.pierre.n} within one tier`);
  console.log(`   Marco:  fit ${s.marco.fitHits ?? '-'}/${s.marco.n}, leave-one-out ${s.marco.looHits ?? '-'}, today's weights ${s.marco.priorHits ?? '-'}`);
  console.log(`   White:  leads with ${s.white.top ?? 'nothing'} → ${s.white.topAnswer ?? 'unanswered'}; ${s.white.yes}/${s.white.asked} yes; would make: ${s.white.instead ?? '-'}`);
  for (const p of r.pierre) if (p.answer !== p.harveys) verdicts[p.dish] = [...(verdicts[p.dish] ?? []), p.answer];
  // Rebuild the pairs' features from the kitchen, so the pooled fit uses today's catalogue.
  const k = known[r.kitchenId] ?? (Array.isArray(r.kitchen.items) ? loadKitchens({ ...r.kitchen })[0] : null);
  if (!k) { console.log('   (kitchen items not in the file or kitchens.json: left out of the pooled fit)'); continue; }
  const t = buildKitchenTest(k);
  const pierre = Object.fromEntries(r.pierre.map((p) => [p.dish, p.answer]));
  const marco = Object.fromEntries(r.marco.filter((m) => t.marco.some((q) => q.id === m.q && q.a === m.a && q.b === m.b)).map((m) => [m.q, m.pick]));
  pooled.push(...marcoChoices(t, marco, pierre));
}

const fit = fitFrom(pooled);
console.log(`\n# Pooled over ${results.length} kitchen test(s)`);
if (fit) {
  console.log(`Marco: ${fit.n} picks, fit ${fit.hits}, leave-one-out ${fit.looHits ?? '-'}, today's weights ${fit.priorHits}`);
  console.log('feature     now      proposed');
  for (const [key, v] of Object.entries(fit.frictionTheta)) console.log(`${key.padEnd(10)} ${String(DEFAULT_CONFIG.frictionTheta[key] ?? '-').padEnd(8)} ${v}`);
} else console.log('Marco: under 3 picks, no fit.');
const disagree = Object.entries(verdicts);
console.log(disagree.length ? `Pierre disagreements: ${disagree.map(([d, ts]) => `${d} → ${ts.join('/')}`).join('; ')}` : 'Pierre: no disagreements.');
