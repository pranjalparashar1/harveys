// Step 5: score Pierre on several answered sheets at once (both are in-sample after Step 5, so a
// third blind sheet is still needed). Prints every dish and fix, then the totals per sheet and
// together. `--md` writes markdown tables.
//   node scripts/score-sheets.mjs key1.json answers1.txt [key2.json answers2.txt …] [--md]
import { readFileSync } from 'node:fs';
import { decodeBench, applyFix } from '../src/quiz/bench.js';
import { pierreTier } from '../src/brain/ingredients.js';
import { TABLE_KITCHEN } from './pierre-tiers.mjs';

const toPart = (k) => { const [id, technique] = k.split('@'); return technique ? { id, technique } : { id }; };
const low = (t) => t === 'veto' || t === 'floor';
const up = (t) => t === 'pass' || t === 'crave';
const tierOf = (parts, modifiers, form) => pierreTier(parts.map(toPart), form, { modifiers, inventory: TABLE_KITCHEN });

/** Every dish and fix of one sheet, with your tier and Pierre's. */
export function scoreSheet(keys, answers) {
  const rows = [];
  for (const k of keys) {
    const a = answers[k.id];
    if (!a) continue;
    const t = tierOf(k.parts, k.modifiers, k.form);
    rows.push({ id: k.id, name: k.name, you: a.tier, pierre: t.computed, why: t.why, reasons: a.reasons, fix: false });
    if (a.fix) {
      const items = [...k.parts.map(toPart), ...k.modifiers.map((id) => ({ id, mod: true }))];
      const after = applyFix(items, a.fix.line);
      const f = tierOf(after.filter((x) => !x.mod).map((x) => (x.technique ? `${x.id}@${x.technique}` : x.id)), after.filter((x) => x.mod).map((x) => x.id), k.form);
      rows.push({ id: `${k.id} fix`, name: `${k.name} → ${a.fix.line}`, you: a.fix.tier, pierre: f.computed, why: f.why, reasons: [], fix: true });
    }
  }
  return rows;
}

export function totals(rows) {
  const d = rows.filter((r) => !r.fix);
  const f = rows.filter((r) => r.fix);
  return {
    dishes: d.length,
    exact: d.filter((r) => r.you === r.pierre).length,
    side: d.filter((r) => low(r.you) === low(r.pierre)).length,
    misses: d.filter((r) => low(r.you) && up(r.pierre)).length,
    strict: d.filter((r) => up(r.you) && low(r.pierre)).length,
    fixes: f.length,
    fixExact: f.filter((r) => r.you === r.pierre).length,
    fixMisses: f.filter((r) => low(r.you) && up(r.pierre)).length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const md = args.includes('--md');
  const files = args.filter((a) => a !== '--md');
  const all = [];
  for (let i = 0; i < files.length; i += 2) {
    const keys = JSON.parse(readFileSync(files[i], 'utf8'));
    const { answers } = decodeBench(readFileSync(files[i + 1], 'utf8'));
    const rows = scoreSheet(keys, answers);
    all.push(...rows);
    const t = totals(rows);
    console.log(`\n## ${files[i].split('/').pop()}: exact ${t.exact}/${t.dishes}, same side ${t.side}/${t.dishes}, your veto/floor passed ${t.misses}, too strict ${t.strict}; fixes ${t.fixExact}/${t.fixes} (passed a floor fix: ${t.fixMisses})\n`);
    if (md) { console.log('| Dish | You | Pierre | Pierre\'s reason |'); console.log('|---|---|---|---|'); }
    for (const r of rows) {
      const mark = r.you === r.pierre ? '' : low(r.you) && up(r.pierre) ? ' ✗ MISS' : ' ✗';
      if (md) console.log(`| ${r.name} | ${r.you}${r.reasons.length ? ` (${r.reasons.join(', ')})` : ''} | ${r.pierre}${mark} | ${r.why.join('; ') || '–'} |`);
      else console.log(`${r.you.padEnd(5)} ${r.pierre.padEnd(5)}${mark.padEnd(8)} ${r.name}  [${r.why.join('; ')}]`);
    }
  }
  const t = totals(all);
  console.log(`\n## Together: exact ${t.exact}/${t.dishes}, same side ${t.side}/${t.dishes}, your veto/floor passed ${t.misses}, too strict ${t.strict}; fixes ${t.fixExact}/${t.fixes} (passed a floor fix: ${t.fixMisses})`);
}
