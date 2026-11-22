#!/usr/bin/env node
// Kitchen test mode (1.30.0): read results back and score Harvey's three brains.
//
//   node scripts/kitchen-tests.mjs plan [kitchens.json …]   print each kitchen's three quizzes
//   node scripts/kitchen-tests.mjs score [results …] [--persona <text>]
//                                                           score each result, then fit Marco on all
//
// score reads both kinds of result: test.html's kitchen tests (harveys-kitchen-test/1) and the
// taste test after Proceed on the main page (harveys-rung-quiz/1, 1.31.0). A taste test's
// Marco rankings become every pair inside each rung, pooled into the same frictionTheta fit.
//
// --persona is optional and only for looking: by default every result is pooled, persona
// role-plays included, because they calibrate Marco's shared effort weights for everyone.
//
// plan defaults to data/test-kitchens/kitchens.json; score defaults to data/kitchen-tests/*.json.
// Results are the downloaded files, the copied text, or a kitchen-test issue body.
// score never edits config: it prints the pooled frictionTheta and Pierre verdicts to review.

import { readFileSync, readdirSync } from 'node:fs';
import { loadKitchens, buildKitchenTest, whiteFor, parseResults, scoreResult, marcoChoices, fitFrom } from '../src/brain/kitchen-test.js';
import { DEFAULT_CONFIG } from '../src/brain/config.js';
import { parseRungResults, scoreRungResult, rungMarcoChoices, buildRungQuiz } from '../src/brain/rung-quiz.js';
import { buildInventory } from '../src/brain/inventory.js';
import { usageForResult } from '../src/brain/usage.js';

const [cmd = 'score', ...rest] = process.argv.slice(2);
const pi = rest.indexOf('--persona');
const personaFilter = pi >= 0 ? String(rest[pi + 1] ?? '').toLowerCase() : '';
const files = rest.filter((a, i) => !a.startsWith('--') && !(pi >= 0 && i === pi + 1));
let cache = {};
try { cache = JSON.parse(readFileSync(new URL('../data/ingredient-cache.json', import.meta.url), 'utf8')); } catch { /* empty cache */ }
const dir = new URL('../data/kitchen-tests/', import.meta.url);
const allKitchens = () => loadKitchens(readFileSync(new URL('../data/test-kitchens/kitchens.json', import.meta.url), 'utf8'));

if (cmd === 'plan') {
  const ks = files.length ? files.flatMap((f) => loadKitchens(readFileSync(f, 'utf8'))) : allKitchens();
  for (const k of ks) {
    const t = buildKitchenTest(k, { cache });
    console.log(`## ${k.kitchen}  [${t.id}]  ${t.summary.items} items, ${t.summary.cookable} dishes`);
    console.log(`Pierre (${t.pierre.length}): ${t.pierre.map((p) => `${p.name} (${p.harveys})`).join('; ')}`);
    console.log(`Marco (${t.marco.length}):`);
    for (const q of t.marco) console.log(`  ${q.id} ${q.A.name}  vs  ${q.B.name}`);
    console.log(`White now: ${whiteFor(t).ladder.map((d) => `${d.rung} ${d.name}`).join(' | ') || 'nothing'}\n`);
  }
  process.exit(0);
}

const paths = files.length ? files : readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => new URL(n, dir));
const texts = paths.map((p) => readFileSync(p, 'utf8'));
const results = texts.flatMap(parseResults)
  .filter((r) => !personaFilter || String(r.persona ?? '').toLowerCase().includes(personaFilter));
const tastes = personaFilter ? [] : texts.flatMap(parseRungResults);
if (!results.length && !tastes.length) { console.log(`No kitchen-test results found${personaFilter ? ` for persona "${personaFilter}"` : ''}.`); process.exit(0); }
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
  const t = buildKitchenTest(k, { cache });
  const pierre = Object.fromEntries(r.pierre.map((p) => [p.dish, p.answer]));
  const marco = Object.fromEntries(r.marco.filter((m) => t.marco.some((q) => q.id === m.q && q.a === m.a && q.b === m.b)).map((m) => [m.q, m.pick]));
  pooled.push(...marcoChoices(t, marco, pierre));
}

// Taste tests: one line per tester and kitchen, then dishes where testers and Pierre disagree.
const pct = (x) => (x == null ? '-' : x.toFixed(2));
const tastePlace = {}; // dish → { name, tier, places: [0 = top … 1 = bottom] }
const criteria = {};
for (const r of tastes) {
  const s = scoreRungResult(r);
  console.log(`## Taste test: ${s.kitchen}  [${s.kitchenId}]  tester ${s.tester || s.testerId}`);
  console.log(`   Marco:  agreement ${pct(s.marco.tau)} (Kendall, 1 = same order) over ${s.marco.rungs.length} rung(s), ${s.marco.pairs} pairs; ${s.marco.rungs.filter((x) => !x.moved).length} left as shown`);
  console.log(`   Pierre: agreement ${pct(s.pierre.tau)} over ${s.pierre.rungs.length} rung(s)`);
  console.log(`   White:  Harvey's pick was first on ${s.white.hits}/${s.white.n} rungs, picked at all on ${s.white.inPicks}/${s.white.n}; why: ${Object.entries(s.white.criteria).sort((a, b) => b[1] - a[1]).map(([k]) => k).join(' > ') || '-'}`);
  for (const [k, v] of Object.entries(s.white.criteria)) criteria[k] = (criteria[k] ?? 0) + v;
  for (const row of r.pierre) row.ranking.forEach((id, i) => {
    const d = r.dishes[id];
    tastePlace[id] ??= { name: d.name, tier: d.harveys.tier, places: [] };
    tastePlace[id].places.push(row.ranking.length > 1 ? i / (row.ranking.length - 1) : 0);
  });
  pooled.push(...rungMarcoChoices(r));
}
if (tastes.length) {
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const rows = Object.values(tastePlace).map((d) => ({ ...d, place: avg(d.places) }));
  const flag = rows.filter((d) => (['crave', 'pass'].includes(d.tier) && d.place >= 0.75) || (['veto', 'floor'].includes(d.tier) && d.place <= 0.25));
  console.log(flag.length ? `Taste vs Pierre: ${flag.map((d) => `${d.name} (${d.tier}, placed ${pct(d.place)} down)`).join('; ')}` : 'Taste vs Pierre: no strong disagreements.');
  console.log(`What decided White's picks (points, most first): ${Object.entries(criteria).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);

  // Ingredient check (1.33.0): items kitchens had that no shown dish used. A file from before
  // 1.33.0 has no record, so it's rebuilt from its items with today's catalogue.
  const byKitchen = new Map();
  for (const r of tastes) {
    if (byKitchen.has(r.kitchenId)) continue;
    let u = r.ingredients;
    if (!u && Array.isArray(r.kitchen?.items)) {
      const k = { ...r.kitchen, items: r.kitchen.items };
      u = usageForResult(buildRungQuiz({ kitchen: k, inventory: buildInventory(k.items, { cache }) }).usage);
    }
    if (u) byKitchen.set(r.kitchenId, u);
  }
  const tally = (pick) => {
    const m = new Map();
    for (const u of byKitchen.values()) for (const x of pick(u)) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([x, n]) => (byKitchen.size > 1 ? `${x} (${n})` : x)).join(', ');
  };
  if (byKitchen.size) {
    console.log(`\n# Ingredient check over ${byKitchen.size} kitchen(s)`);
    console.log(`No recipe uses it: ${tally((u) => u.gaps) || '-'}`);
    console.log(`Named by a dish, but out: ${tally((u) => u.unused.filter((x) => x.reasons[0]?.dish).map((x) => `${x.name} [${x.reasons[0].why}]`)) || '-'}`);
    console.log(`One thing away: ${tally((u) => (u.blockers ?? []).map((b) => `${b.thing} → ${b.dishes.join(' / ')}`)) || '-'}`);
  }
}

const fit = fitFrom(pooled);
console.log(`\n# Pooled over ${results.length} kitchen test(s) and ${tastes.length} taste test(s)${personaFilter ? `, persona contains "${personaFilter}"` : ', all personas'}`);
if (fit) {
  console.log(`Marco: ${fit.n} picks, fit ${fit.hits}, leave-one-out ${fit.looHits ?? '-'}, today's weights ${fit.priorHits}`);
  console.log('feature     now      proposed');
  for (const [key, v] of Object.entries(fit.frictionTheta)) console.log(`${key.padEnd(10)} ${String(DEFAULT_CONFIG.frictionTheta[key] ?? '-').padEnd(8)} ${v}`);
} else console.log('Marco: under 3 picks, no fit.');
const disagree = Object.entries(verdicts);
console.log(disagree.length ? `Pierre disagreements: ${disagree.map(([d, ts]) => `${d} → ${ts.join('/')}`).join('; ')}` : 'Pierre: no disagreements.');
