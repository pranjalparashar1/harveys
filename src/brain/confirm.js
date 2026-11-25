// "Did Harvey miss anything?" (1.39.0). A video can't see inside unlabelled jars, and the agent
// lists only what it's sure of: Harsh's kadhai, salt and dal jars went missing. So before the
// taste test, Harvey asks about the few common things that would unlock the most dishes in
// this kitchen, and the tester taps what they have.
// Pure: no DOM, no network.

import { CATALOGUE } from './catalogue.js';
import { DEFAULT_CONFIG } from './config.js';
import { buildInventory, matchName, SYNONYMS } from './inventory.js';
import { rank } from './ranker.js';
import { kindOf, labelFor, FOODS, ASSUMED_STAPLES, isSetAside } from './vocabulary.js';
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
  if (t.length < 2 || isSetAside(t)) return out;
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

// ── Confirm, don't ask (1.44.0) ─────────────────────────────────────────────
// pranjal, 22 Nov: testers fumbled "Do you have any of these?". Now Harvey shows what it saw
// as a list to confirm (all ticked; untick what isn't there), and "Missed something? Add more"
// opens a few categories of taps. Foods first, then cookware, the same way.

/** The categories behind "Add more". text entries have no vocabulary id: they join as typed. */
export const FOOD_GROUPS = Object.freeze([
  { id: 'veg', label: 'Veg & fruit', groups: ['veg', 'fruit'], extra: ['Potato', 'Carrot', 'Coriander leaves', 'Cauliflower', 'Apple'] },
  { id: 'spices', label: 'Spices', groups: ['spice'], extra: ['Cumin (jeera)', 'Coriander powder', 'Hing', 'Ajwain'] },
  { id: 'condiments', label: 'Sauces & spreads', groups: ['spread'], extra: ['Soy sauce', 'Pickle (achaar)', 'Green chutney', 'Chilli sauce', 'Vinegar', 'Jam'] },
  { id: 'foods', label: 'Staples', groups: ['grain', 'protein', 'dairy', 'bread', 'fat'], extra: ['Atta', 'Sooji (rava)', 'Frozen paratha'] },
  { id: 'misc', label: 'Drinks & snacks', groups: ['drink', 'snack'], extra: ['Biscuits', 'Chips', 'Instant soup', 'Dry fruits'], type: true },
]);
export const KIT_GROUPS = Object.freeze([
  { id: 'stove', label: 'Stove', ids: ['gas_stove', 'induction'] },
  { id: 'pots', label: 'Pots & pans', ids: ['pressure_cooker', 'saucepan', 'frying_pan', 'kadai', 'tawa'] },
  { id: 'appliances', label: 'Appliances', ids: ['kettle', 'microwave', 'air_fryer', 'sandwich_maker', 'toaster', 'oven', 'blender'], type: true },
]);
const KIT_CATS = new Set(['appliance', 'appliances', 'cookware', 'utensil', 'utensils', 'equipment', 'tool', 'tools']);
const CAT_GROUP = { veg: 'veg', fruit: 'veg', herb: 'veg', spice: 'spices', condiment: 'condiments', sweet: 'condiments', drink: 'misc', snack: 'misc', nuts_seeds: 'misc', other: 'misc' };
const GROUP_OF = Object.fromEntries(FOOD_GROUPS.flatMap((g) => g.groups.map((x) => [x, g.id])));
const cap = (s) => String(s ?? '').replace(/^./, (c) => c.toUpperCase());

/**
 * The kitchen list split for the two confirm screens: { food: [{ name, id, group }], kit: [...] }.
 * Plates, spoons and the like are assumed, so they aren't shown. One row per name.
 */
export function listedSplit(items) {
  const out = { food: [], kit: [] };
  const seen = new Set();
  for (const item of items ?? []) {
    const name = String((typeof item === 'string' ? item : item?.name) ?? '').trim();
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const id = (item?.canonical && kindOf(item.canonical) ? item.canonical : null) ?? matchName(name);
    const kind = id ? kindOf(id) : null;
    const cat = String(item?.category ?? '').toLowerCase();
    if (kind === 'utensil' || (!kind && /^(utensil|utensils|tool|tools)$/.test(cat))) continue;
    if (kind === 'appliance' || kind === 'cookware' || (!kind && KIT_CATS.has(cat))) out.kit.push({ name: cap(name), id });
    else out.food.push({ name: cap(name), id, group: GROUP_OF[FOODS[id]?.group] ?? CAT_GROUP[cat] ?? 'foods' });
  }
  return out;
}

/**
 * What each "Add more" category offers: { food: [{ id, label, opts }], kit: [...] } where an opt
 * is { id, label } (a vocabulary id) or { text, label } (typed). Things already on the list,
 * and salt and oil (always assumed), aren't offered. Within a category, the ones that unlock
 * the most dishes here come first.
 */
export function addChoices(items, { cache = {}, missingBasics = [] } = {}) {
  const base = buildInventory(items, { cache, missingBasics });
  const first = new Map(confirmCandidates(items, { cache, missingBasics, limit: 99 }).map((a, i) => [a.id, i]));
  const kitFirst = new Map(kitCandidates(items, { cache, missingBasics }).kit.map((a, i) => [a.id, i]));
  const order = (rank) => (a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99);
  const label = (id) => ASK_LABEL[id] ?? labelFor(id);
  const food = FOOD_GROUPS.map((g) => {
    const ids = Object.keys(FOODS).filter((id) => g.groups.includes(FOODS[id].group) && !base.have.has(id) && !ASSUMED_STAPLES.includes(id)).sort(order(first));
    return { id: g.id, label: g.label, type: !!g.type, opts: [...ids.map((id) => ({ id, label: label(id) })), ...g.extra.map((text) => ({ text, label: text }))] };
  });
  const kit = KIT_GROUPS.map((g) => ({ id: g.id, label: g.label, type: !!g.type, opts: g.ids.filter((id) => !base.have.has(id)).sort(order(kitFirst)).map((id) => ({ id, label: label(id) })) })).filter((g) => g.opts.length || g.type);
  return { food, kit, noStove: !STOVES.some((id) => base.have.has(id)) };
}
