// "Did Harvey miss anything?" (1.39.0). A video can't see inside unlabelled jars, and the agent
// lists only what it's sure of: Harsh's kadhai, salt and dal jars went missing. So before the
// taste test, Harvey asks about the few common things that would unlock the most dishes in
// this kitchen, and the tester taps what they have.
// Pure: no DOM, no network.

import { CATALOGUE } from './catalogue.js';
import { DEFAULT_CONFIG } from './config.js';
import { buildInventory } from './inventory.js';
import { rank } from './ranker.js';
import { kindOf, labelFor } from './vocabulary.js';
import { MOMENT, TARGETS } from './kitchen-test.js';

/** Things most Indian kitchens have that a video often misses: jars, a vessel on a hook. */
export const CONFIRM_POOL = Object.freeze([
  'onion', 'tomato', 'rice', 'dal', 'curd', 'bread', 'tea', 'turmeric', 'red_chilli_powder', 'poha',
  'besan', 'peanuts', 'oats', 'eggs', 'milk', 'tortilla', 'paneer', 'lemon', 'maggi', 'banana', 'green_chilli',
  'frying_pan', 'kadai', 'tawa', 'pressure_cooker', 'saucepan', 'microwave',
]);
/** How the ask reads on a chip, where the vocabulary label is too narrow. */
const ASK_LABEL = { frying_pan: 'A pan, tawa or kadai', saucepan: 'A saucepan', tea: 'Tea (chai patti)', tortilla: 'Roti or wraps', dal: 'Dal (any)', curd: 'Curd', red_chilli_powder: 'Chilli powder' };
export const CONFIRM_LIMIT = 8;

/** The inventory with these canonical ids added, as if the list had named them. */
export function withConfirmed(items, ids, options = {}) {
  return buildInventory([...(items ?? []), ...ids.map((id) => ({ name: labelFor(id), canonical: id, source: 'confirm' }))], options);
}

const cookable = (inventory, catalogue, config) => new Set(rank({
  inventory, targets: TARGETS, context: { hour: MOMENT.hour, weekday: MOMENT.weekday, kind: 'meal' }, catalogue, config,
}).ranked.map((r) => r.meal.id));

/**
 * Up to `limit` ids to ask about, most dishes unlocked first: { id, label, alone, together }.
 * alone: dishes it unlocks by itself. together: dishes that need it once the rest of the
 * pool is there too (onion and tomato unlock egg bhurji only as a pair). Ranked by alone,
 * then together; an id that unlocks nothing either way isn't asked.
 */
export function confirmCandidates(items, { cache = {}, missingBasics = [], catalogue = CATALOGUE, config = DEFAULT_CONFIG, limit = CONFIRM_LIMIT } = {}) {
  const opts = { cache, missingBasics };
  const base = buildInventory(items, opts);
  const now = cookable(base, catalogue, config);
  const pool = CONFIRM_POOL.filter((id) => !base.have.has(id));
  const full = cookable(withConfirmed(items, pool, opts), catalogue, config);
  const out = [];
  const kitSeen = new Set();
  for (const id of pool) {
    const gained = [...cookable(withConfirmed(items, [id], opts), catalogue, config)].filter((m) => !now.has(m));
    const without = cookable(withConfirmed(items, pool.filter((x) => x !== id), opts), catalogue, config);
    const together = [...full].filter((m) => !without.has(m)).length;
    if (!gained.length && !together) continue;
    // A tawa, a pan and a kadai often unlock the same dishes: ask about the first one only.
    if (kindOf(id) !== 'food') {
      const key = gained.sort().join(',');
      if (kitSeen.has(key)) continue;
      kitSeen.add(key);
    }
    out.push({ id, label: ASK_LABEL[id] ?? labelFor(id), alone: gained.length, together });
  }
  return out.sort((a, b) => b.alone - a.alone || b.together - a.together || a.id.localeCompare(b.id)).slice(0, limit);
}
