// "Did Harvey miss anything?" (1.39.0). A video can't see inside unlabelled jars, and the agent
// lists only what it's sure of: Harsh's kadhai, salt and dal jars went missing. So before the
// taste test, Harvey asks about the few common things that would unlock the most dishes in
// this kitchen, and the tester taps what they have.
// Pure: no DOM, no network.

import { CATALOGUE } from './catalogue.js';
import { DEFAULT_CONFIG } from './config.js';
import { buildInventory, matchName, SYNONYMS } from './inventory.js';
import { rank } from './ranker.js';
import { kindOf, labelFor } from './vocabulary.js';
import { MOMENT, TARGETS } from './kitchen-test.js';

/** Things most Indian kitchens have that a video often misses: jars, a vessel on a hook. */
export const CONFIRM_POOL = Object.freeze([
  'onion', 'tomato', 'rice', 'dal', 'curd', 'bread', 'tea', 'turmeric', 'red_chilli_powder', 'poha',
  'besan', 'peanuts', 'oats', 'eggs', 'milk', 'tortilla', 'paneer', 'lemon', 'maggi', 'banana', 'green_chilli',
]);

/**
 * 1.41.0: cookware gets its own row (pranjal, 22 Nov: Purujeet's video showed no stove, but he
 * cooks on induction). Every piece the list doesn't have is offered, stoves first, so one tap
 * fixes a kitchen the video got wrong. Burners are asked once a stove is there.
 */
export const KIT_POOL = Object.freeze([
  'gas_stove', 'induction', 'pressure_cooker', 'saucepan', 'frying_pan', 'kadai', 'tawa',
  'kettle', 'microwave', 'air_fryer', 'sandwich_maker', 'toaster', 'oven', 'blender',
]);
export const STOVES = Object.freeze(['gas_stove', 'induction']);
export const BURNERS = Object.freeze([{ n: 1, label: '1' }, { n: 2, label: '2' }, { n: 3, label: '3 or more' }]);
/** How the ask reads on a chip, where the vocabulary label is too narrow. */
const ASK_LABEL = { gas_stove: 'Gas stove', induction: 'Induction cooktop', saucepan: 'A pot or patila', kadai: 'Kadhai', kettle: 'Kettle', blender: 'Mixer / blender', tea: 'Tea (chai patti)', tortilla: 'Roti or wraps', dal: 'Dal (any)', curd: 'Curd', red_chilli_powder: 'Chilli powder' };
export const CONFIRM_LIMIT = 8;

/** The inventory with these canonical ids added, as if the list had named them. */
export function withConfirmed(items, ids, options = {}, extras = []) {
  return buildInventory([
    ...(items ?? []),
    ...ids.map((id) => ({ name: labelFor(id), canonical: id, source: 'confirm' })),
    // Typed, with no vocabulary id: still joins as an extra, so its roles (soy sauce: umami) count.
    ...extras.map((name) => ({ name, source: 'confirm' })),
  ], options);
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

/**
 * The cookware row: every KIT_POOL piece the list lacks, { id, label, alone }. Stoves lead
 * when there is none (nothing else cooks without one); the rest go by dishes they'd unlock,
 * counted as if a stove were there, so a pot still ranks in a kitchen with no stove spotted.
 * noStove: the list has no stove, so the screen says Harvey didn't see one.
 */
export function kitCandidates(items, { cache = {}, missingBasics = [], catalogue = CATALOGUE, config = DEFAULT_CONFIG } = {}) {
  const opts = { cache, missingBasics };
  const base = buildInventory(items, opts);
  const noStove = !STOVES.some((id) => base.have.has(id));
  const assume = noStove ? ['induction'] : [];
  const now = cookable(withConfirmed(items, assume, opts), catalogue, config);
  const kit = KIT_POOL.filter((id) => !base.have.has(id)).map((id) => {
    const alone = STOVES.includes(id) ? null : [...cookable(withConfirmed(items, [...assume, id], opts), catalogue, config)].filter((m) => !now.has(m)).length;
    return { id, label: ASK_LABEL[id] ?? labelFor(id), alone };
  });
  const rank = (a) => (STOVES.includes(a.id) ? (noStove ? -1e3 : 1e3) : -a.alone);
  kit.sort((a, b) => rank(a) - rank(b) || KIT_POOL.indexOf(a.id) - KIT_POOL.indexOf(b.id));
  return { kit, noStove, hasStove: !noStove };
}

// ── "Add something else" (1.41.0) ───────────────────────────────────────────

const clean = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) {
  if (a === b) return 0;
  // Damerau (optimal string alignment): a swapped pair, "kettel", is one slip, not two.
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);
/** How alike two names must be for a typo to count as the same thing. */
export const FUZZY_MIN = 0.75;

/**
 * What a tester typed → the closest vocabulary id: { text, id, label, how } where how is
 * 'exact' (a known name or synonym), 'fuzzy' (a typo: "indction", "presure cooker") or null
 * (nothing close: Harvey keeps the words and pranjal hears about it in the reports).
 */
export function matchTyped(text) {
  const t = clean(text);
  const out = { text: String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), id: null, label: null, how: null };
  if (t.length < 2) return out;
  const exact = matchName(t);
  if (exact) return { ...out, id: exact, label: labelFor(exact), how: 'exact' };
  if (t.length < 4) return out;
  let best = null;
  const words = t.split(' ');
  for (const { id, phrase } of SYNONYMS) {
    let s = sim(t, phrase);
    // One word typed wrong inside a longer phrase: "brwn bread" vs "brown bread".
    if (words.length > 1 && phrase.split(' ').length === 1) for (const w of words) if (w.length >= 4) s = Math.max(s, sim(w, phrase) - 0.05);
    if (!best || s > best.s) best = { id, s };
  }
  return best && best.s >= FUZZY_MIN ? { ...out, id: best.id, label: labelFor(best.id), how: 'fuzzy' } : out;
}
