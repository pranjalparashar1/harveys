// v2 Step 4 report: your 30 benchmark answers against the hidden key. Writes markdown with the
// 4×4 confusion matrix, the acceptance check, per-dimension disagreement, the floor refit
// (fitted to your answers only, nothing invented), the three choices the plan says this
// settles, and the open flags (milk and cheese-slice retest drift, the almond/walnut crunch).
//   node scripts/benchmark-report.mjs key.json answers.txt [retest.txt] > benchmark.md
import { readFileSync } from 'node:fs';
import { decodeBench, applyFix, TIER_IDS } from '../src/quiz/bench.js';
import { decodePayload } from '../src/quiz/quiz.js';
import { PIERRE_RAW } from '../src/brain/pierre-raw.js';
import { pierreTier, TEXTURES } from '../src/brain/ingredients.js';
import { DEFAULT_CONFIG } from '../src/brain/config.js';
import { TABLE_KITCHEN } from './pierre-tiers.mjs';

const toPart = (k) => { const [id, technique] = k.split('@'); return technique ? { id, technique } : { id }; };
const tierOf = (k, kb = PIERRE_RAW, floor = DEFAULT_CONFIG.pierreFloor) => pierreTier(k.parts.map(toPart), k.form, { modifiers: k.modifiers, inventory: TABLE_KITCHEN, kb, floor });
// Pierre's reasons as dimensions, comparable with yours.
export const whyDims = (why) => [...new Set(why.map((w) => (w.startsWith('vetoed') ? 'cooking'
  : w.startsWith('no texture') ? 'texture'
  : w.startsWith('no fat') || w.startsWith('no ') && w.includes('at Medium') ? 'bland'
  : w.includes("doesn't fit") || w.startsWith('needs another') ? 'cooking'
  : w.startsWith('no anchor') || w.startsWith('no base') || w.includes('has no') ? 'meal' : 'other')))];
const low = (t) => t === 'veto' || t === 'floor';
const up = (t) => t === 'pass' || t === 'crave';

/** Floor settings that best match your answers: your veto/floor never computed pass first, then agreement. */
export function refitFloor(keys, answers, kb = PIERRE_RAW) {
  const base = DEFAULT_CONFIG.pierreFloor;
  const grid = [];
  for (const flavourMin of [1, 2, 3]) for (const texturesMin of [0, 1, 2, 3]) {
    const floor = { ...base, flavourMin, texturesMin };
    let misses = 0; let agree = 0;
    for (const k of keys) {
      const a = answers[k.id]?.tier; if (!a) continue;
      const c = tierOf(k, kb, floor).computed;
      if (low(a) && up(c)) misses++;
      if (low(a) === low(c)) agree++;
    }
    grid.push({ flavourMin, texturesMin, misses, agree, current: flavourMin === base.flavourMin && texturesMin === base.texturesMin });
  }
  grid.sort((x, y) => x.misses - y.misses || y.agree - x.agree || y.current - x.current);
  return { best: grid[0], grid };
}

const mergeFlaky = (kb) => {
  const c = structuredClone(kb);
  for (const v of [...Object.values(c.foods), ...Object.values(c.tech ?? {})]) if (v.texture) { v.texture.crisp = Math.max(v.texture.crisp, v.texture.flaky); v.texture.flaky = 0; }
  return c;
};

export function report(keys, { answers, tiers }, retest = {}) {
  const rated = keys.filter((k) => answers[k.id]);
  const { best, grid } = refitFloor(rated, answers);
  const floor = { ...DEFAULT_CONFIG.pierreFloor, flavourMin: best.flavourMin, texturesMin: best.texturesMin };
  const out = [];
  const say = (s = '') => out.push(s);
  say(`# Pierre benchmark, ${new Date().toISOString().slice(0, 10)}`);
  say();
  say(`${rated.length} of ${keys.length} dishes rated, blind. Rows are your tier, columns Pierre's computed tier with the floor as it stood (flavour ≥ ${DEFAULT_CONFIG.pierreFloor.flavourMin}, textures ≥ ${DEFAULT_CONFIG.pierreFloor.texturesMin}). Pierre never computes crave.`);
  say();
  const m = Object.fromEntries(TIER_IDS.map((r) => [r, Object.fromEntries(TIER_IDS.map((c) => [c, 0]))]));
  for (const k of rated) m[answers[k.id].tier][k.computed]++;
  say(`| You \\ Pierre | ${TIER_IDS.join(' | ')} |`);
  say(`|---|${TIER_IDS.map(() => '---').join('|')}|`);
  for (const r of TIER_IDS) say(`| **${r}** | ${TIER_IDS.map((c) => m[r][c]).join(' | ')} |`);
  say();
  const miss = rated.filter((k) => low(answers[k.id].tier) && up(k.computed));
  say(`**Acceptance (your veto or floor never comes out pass or crave): ${miss.length ? `FAILS on ${miss.length}` : 'met'}.**`);
  say();
  say('## Every dish');
  say();
  say('| Dish | Source | You | Pierre | Pierre\'s reason | Your reason | Couvert |');
  say('|---|---|---|---|---|---|---|');
  for (const k of rated) {
    const a = answers[k.id];
    say(`| ${k.name} | ${k.source} | **${a.tier}** | ${k.computed}${a.tier === k.computed ? '' : ' ✗'} | ${k.why.join('; ') || '–'}${k.unrated.length ? ` (unrated: ${k.unrated.join(', ')})` : ''} | ${a.reasons.join(', ') || '–'} | ${k.couvert ?? '–'} |`);
  }
  say();
  const fixed = rated.filter((k) => answers[k.id].fix);
  if (fixed.length) {
    say('## Your fixes');
    say();
    say("What you'd change to rescue a veto or floor, and what Pierre computes for the fixed dish. Pierre's own upgrade only ever adds a spice or a small food, so a cooking change it can't suggest is a gap in the upgrade search.");
    say();
    say("| Dish | You | Your fix | Fixed, you | Fixed, Pierre | Pierre's own upgrade |");
    say('|---|---|---|---|---|---|');
    for (const k of fixed) {
      const items = [...k.parts.map(toPart), ...k.modifiers.map((id) => ({ id, mod: true }))];
      const after = applyFix(items, answers[k.id].fix.line);
      const t = tierOf({ ...k, parts: after.filter((x) => !x.mod).map((x) => (x.technique ? `${x.id}@${x.technique}` : x.id)), modifiers: after.filter((x) => x.mod).map((x) => x.id) }, PIERRE_RAW, floor);
      say(`| ${k.name} | ${answers[k.id].tier} | ${answers[k.id].fix.line} | **${answers[k.id].fix.tier}** | ${t.computed}${t.computed === answers[k.id].fix.tier ? '' : ' ✗'} | ${k.upgrade ? `+ ${k.upgrade}` : '–'} |`);
    }
    say();
  }
  say('## Per-dimension disagreement');
  say();
  say('A dimension you named on a dish Pierre passed is something Pierre is blind to. One Pierre named on a dish you passed is a rule that is too strict.');
  say();
  const dims = ['bland', 'savoury', 'texture', 'clash', 'cooking', 'meal'];
  say('| Dimension | You named it, Pierre passed | Pierre named it, you passed |');
  say('|---|---|---|');
  for (const d of dims) {
    const mine = rated.filter((k) => answers[k.id].reasons.includes(d) && up(k.computed)).map((k) => k.name);
    const his = rated.filter((k) => whyDims(k.why).includes(d) && up(answers[k.id].tier)).map((k) => k.name);
    say(`| ${d} | ${mine.length}${mine.length ? `: ${mine.join('; ')}` : ''} | ${his.length}${his.length ? `: ${his.join('; ')}` : ''} |`);
  }
  say();
  say('## Floor refit');
  say();
  say(`Searched flavour minimum 1–3 and texture count 0–3 (${grid.length} settings), ranked by acceptance misses, then agreement on floor-or-below vs pass-or-above, then keeping the current setting on a tie.`);
  say();
  say(`**Best: flavour ≥ ${best.flavourMin}, textures ≥ ${best.texturesMin}** (${best.misses} misses, ${best.agree}/${rated.length} agree)${best.current ? ', the same as now: the 30 answers don\'t move it' : ''}. Top five:`);
  say();
  say('| Flavour ≥ | Textures ≥ | Misses | Agree |');
  say('|---|---|---|---|');
  for (const g of grid.slice(0, 5)) say(`| ${g.flavourMin} | ${g.texturesMin} | ${g.misses} | ${g.agree} |`);
  say();
  const most = [...grid].sort((x, y) => y.agree - x.agree || x.misses - y.misses)[0];
  if (most !== best) say(`Most agreement overall: flavour ≥ ${most.flavourMin}, textures ≥ ${most.texturesMin} (${most.agree}/${rated.length} agree, ${most.misses} misses). The plan gates on misses, so the best above wins.`);
  if (best.misses) say(`No floor setting clears acceptance: even the best lets ${best.misses} dish(es) you rated veto or floor through, so that gap is not in the floor numbers (see the reasons above).`);
  say();
  say('## The three choices');
  say();
  const craves = rated.filter((k) => answers[k.id].tier === 'crave').length;
  say(`1. **Four tiers or 0–5 spoons:** ${tiers === 'finer' ? '**add spoons.** You said some dishes needed finer steps than four tiers give.' : tiers === 'enough' ? '**keep four tiers.** You said four was enough.' : 'not answered (the last screen).'} You used crave on ${craves} dish(es).`);
  const fk = mergeFlaky(PIERRE_RAW);
  const moved = rated.filter((k) => tierOf(k, fk, floor).computed !== tierOf(k, PIERRE_RAW, floor).computed);
  const flakyParts = [...Object.entries(PIERRE_RAW.foods), ...Object.entries(PIERRE_RAW.tech ?? {})].filter(([, v]) => v.texture?.flaky >= 2).map(([id]) => id);
  say(`2. **Merge flaky into crisp:** ${moved.length ? `**keep them apart**: merging changes ${moved.length} dish(es): ${moved.map((k) => k.name).join('; ')}.` : '**merge.** It changes none of the 30 computed tiers.'} Foods or forms rated flaky Medium+: ${flakyParts.join(', ') || 'none'}.`);
  const sav = rated.filter((k) => answers[k.id].reasons.includes('savoury'));
  const savMiss = sav.filter((k) => up(k.computed));
  say(`3. **Umami per food:** ${savMiss.length ? `**yes, rate it.** On ${savMiss.length} dish(es) you named "lacks savoury depth" and Pierre passed them: ${savMiss.map((k) => k.name).join('; ')}. Nothing in Pierre's dimensions sees that.` : `**not needed yet.** You named "lacks savoury depth" on ${sav.length} dish(es)${sav.length ? ', and Pierre already put each below pass' : ''}.`}`);
  say();
  say('## Open flags');
  say();
  say('- The sheet named no cooking state or arrangement for the absurd combos (a part with no cooking was "as it comes"), and you asked how one was arranged while rating. Their ratings carry that ambiguity; the brain has no arrangement either.');
  const withIds = (ids) => rated.filter((k) => k.parts.some((p) => ids.includes(p.split('@')[0])));
  const swap = (ids) => {
    const c = structuredClone(PIERRE_RAW);
    for (const id of ids) if (retest[id] && c.foods[id]) c.foods[id] = { ...c.foods[id], texture: retest[id].texture, taste: { ...c.foods[id].taste, ...retest[id].taste } };
    return c;
  };
  const flagRows = (ids, kb2, label) => {
    const ds = withIds(ids);
    if (!ds.length) return say(`- ${label}: no dish in the 30 has ${ids.join(' or ')}.`);
    say(`- ${label}:`);
    for (const k of ds) say(`  - ${k.name}: you **${answers[k.id].tier}**, Pierre (refit floor) ${tierOf(k, PIERRE_RAW, floor).computed}, with the alternative ${tierOf(k, kb2, floor).computed}.`);
  };
  flagRows(['milk'], swap(['milk']), 'Milk retest drift (juicy 2→0, canvas 3→1): alternative = your 20 Nov retest ratings');
  flagRows(['cheese_slices'], swap(['cheese_slices']), 'Cheese-slice retest drift (fat 3→0): alternative = your 20 Nov retest ratings');
  const nuts = structuredClone(PIERRE_RAW);
  for (const id of ['almonds', 'walnuts']) if (nuts.foods[id]) nuts.foods[id].centre = 2;
  flagRows(['almonds', 'walnuts'], nuts, 'Almond/walnut crunch (centre 1, so the crunch is ignored): alternative = counted as centre 2');
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [keyPath, answersPath, retestPath] = process.argv.slice(2);
  const keys = JSON.parse(readFileSync(keyPath, 'utf8'));
  const bench = decodeBench(readFileSync(answersPath ?? 0, 'utf8'));
  const retest = retestPath ? decodePayload(readFileSync(retestPath, 'utf8')) : {};
  console.log(report(keys, bench, retest));
}
