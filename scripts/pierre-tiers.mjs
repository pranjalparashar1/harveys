// Step 3 acceptance: every catalogue meal with Pierre's tier, computed and after pranjal's verdict.
//   node scripts/pierre-tiers.mjs > tiers.md
// Upgrades are offered from the demo kitchen plus curd, lemon, chaat masala and banana.
import { CATALOGUE } from '../src/brain/catalogue.js';
import { PIERRE_SEED } from '../src/brain/train-data.js';
import { DEMO_KITCHEN } from '../src/demo-kitchen.js';
import { pierreTier, verdictTier, techKey } from '../src/brain/ingredients.js';

export const TABLE_KITCHEN = [...DEMO_KITCHEN.filter((i) => i.category === 'food' && i.canonical).map((i) => i.canonical), 'curd', 'lemon', 'chaat_masala', 'banana'];
export const modifiersOf = (meal) => meal.ingredients.map((i) => i.id ?? i.anyOf?.[0]).filter(Boolean);

export function tierRows(meals = CATALOGUE, inventory = TABLE_KITCHEN) {
  return meals.map((m) => {
    const t = pierreTier(m.parts, m.form, { modifiers: modifiersOf(m), inventory, verdict: PIERRE_SEED[m.id] });
    return { id: m.id, form: m.form, parts: m.parts.map((p) => techKey(p.id, p.technique)), verdict: verdictTier(PIERRE_SEED[m.id]), ...t };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = tierRows();
  console.log('| Meal | Form | Parts | Computed | Your verdict | Tier | Why (computed) | Upgrade |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const notes = [...r.why, ...(r.profile?.unscored.length ? [`no vector: ${r.profile.unscored.join(', ')}`] : []), ...(r.profile?.provisional.length ? [`prior: ${r.profile.provisional.join(', ')}`] : [])];
    console.log(`| ${r.id} | ${r.form} | ${r.parts.join(', ')} | ${r.computed} | ${r.verdict ?? '–'} | **${r.tier}** | ${notes.join('; ') || '–'} | ${r.upgrade ? `+ ${r.upgrade.options.join(' / ')}` : '–'} |`);
  }
  const v = rows.filter((r) => r.verdict);
  console.log(`\n${rows.length} meals. Verdicts reproduced: ${v.filter((r) => r.tier === r.verdict).length}/${v.length}. Computed tier matches your verdict: ${v.filter((r) => r.computed === r.verdict).length}/${v.length}.`);
}
