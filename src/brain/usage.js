// Ingredient check (1.33.0): did Harvey's use what the kitchen has?
//
// For every item a tester listed, either the suggested dishes that use it, or each catalogue
// dish that mentions it and the reason that dish didn't make it: missing kit, a missing
// co-ingredient, the diet, a Pierre veto, soaking, a snack, a full rung, or another item
// filling the same slot. An item no dish mentions is a catalogue gap ("no recipe uses it").
// Shown in ?debug and saved in every taste-test result, so gaps add up across kitchens.
// Pure: no DOM, no network, no clock.

import { CAPABILITIES, EQUIPMENT, ASSUMED_BASICS, labelFor } from './vocabulary.js';
import { ID_ROLES } from './pantry.js';
import { inDiet } from './learn.js';
import { nutritionProblems } from './validate.js';
import { describeMissing } from './ranker.js';
import { DEFAULT_CONFIG } from './config.js';

const nameKey = (s) => String(s ?? '').trim().toLowerCase();
const isKit = (id) => !!(EQUIPMENT[id] || ASSUMED_BASICS[id]);

/** What one listed item became in the inventory: its ids and the seasoning roles it brings. */
function resolveItem(name, inventory) {
  const k = nameKey(name);
  const ids = new Set();
  const roles = new Set();
  for (const m of inventory.matched ?? []) if (nameKey(m.name) === k) { ids.add(m.id); for (const r of ID_ROLES[m.id] ?? []) roles.add(r); }
  for (const p of inventory.extras ?? []) if (nameKey(p.name) === k) { ids.add(p.as ?? p.id); for (const r of p.roles ?? []) roles.add(r); }
  const excluded = (inventory.excluded ?? []).some((n) => nameKey(n) === k);
  const setAside = (inventory.setAside ?? []).some((n) => nameKey(n) === k);
  return { ids: [...ids], roles: [...roles], excluded, setAside };
}

/** How a catalogue dish refers to these ids: 'direct' (named), 'role' (a seasoning slot), or null. */
function mentions(meal, ids, roles) {
  const has = (x) => ids.includes(x);
  for (const ing of meal.ingredients ?? []) if ((ing.anyOf ?? [ing.id]).some(has)) return 'direct';
  for (const req of meal.equipment ?? []) if (has(req) || (CAPABILITIES[req]?.anyOf ?? []).some(has)) return 'direct';
  if ((meal.utensils ?? []).some(has)) return 'direct';
  for (const ing of meal.ingredients ?? []) if ((ing.anyOf ?? []).some((o) => o.startsWith('role:') && roles.includes(o.slice(5)))) return 'role';
  return null;
}

/** The ids a ranked dish actually uses as made. */
const usedIds = (x) => new Set([...(x.used?.ingredients ?? []).map((i) => i.id), ...(x.used?.equipment ?? []), ...(x.used?.utensils ?? [])]);

/** The item that fills the slot this item could have filled, e.g. "made with bread instead". */
function filledBy(meal, x, ids, roles) {
  for (const ing of meal.ingredients ?? []) {
    const opts = ing.anyOf ?? [ing.id];
    const fits = opts.some((o) => ids.includes(o) || (o.startsWith('role:') && roles.includes(o.slice(5))));
    if (!fits) continue;
    const got = (x.used?.ingredients ?? []).find((u) => (ing.anyOf ? u.anyOf === ing.anyOf : u.id === ing.id));
    if (got && !ids.includes(got.id)) return got.label ?? labelFor(got.id);
  }
  for (const req of meal.equipment ?? []) {
    const any = CAPABILITIES[req]?.anyOf;
    if (any?.some((o) => ids.includes(o))) {
      const got = (x.used?.equipment ?? []).find((e) => any.includes(e));
      if (got && !ids.includes(got)) return labelFor(got);
    }
  }
  return null;
}

/**
 * @param {object} input
 * @param {Array<{name: string, category?: string}>} input.items  what the tester listed
 * @param {object} input.inventory  buildInventory's
 * @param {object} input.ranking    rank()'s result for the run (ranked, filtered, vetoed, tomorrow)
 * @param {string[]} input.shown    the dish ids the tester saw
 * @param {Array} input.catalogue
 * @param {string} [input.kind]     'meal' | 'snack' | 'any': what the run asked for
 * @returns {{ items: Array, blockers: Array<{thing, dishes}>, used: number, unused: number, gaps: string[] }}
 *   items: { name, category, status: 'used'|'unused'|'not_veg'|'unknown', kit, usedIn: [names],
 *            reasons: [{ dish, why }] } — reasons only for unused items, every dish that mentions it.
 */
export function ingredientUsage({ items, inventory, ranking, shown, catalogue, kind = 'meal', config = DEFAULT_CONFIG }) {
  const shownSet = new Set(shown);
  const ranked = new Map((ranking.ranked ?? []).map((x) => [x.meal.id, x]));
  const filtered = new Map((ranking.filtered ?? []).map((x) => [x.meal.id, x]));
  const vetoed = new Map((ranking.vetoed ?? []).map((x) => [x.meal.id, x]));
  const tomorrow = new Map((ranking.tomorrow ?? []).map((x) => [x.meal.id, x]));
  const rungPos = new Map();
  for (const x of ranking.ranked ?? []) {
    const same = (ranking.ranked ?? []).filter((y) => y.rung === x.rung);
    rungPos.set(x.meal.id, same.indexOf(x) + 1);
  }

  const why = (meal, ids, roles, how) => {
    if (kind !== 'any' && meal.kind !== kind) return `a ${meal.kind}, and the test shows ${kind}s`;
    if (!inDiet(meal)) return 'outside the diet (vegetarian + eggs)';
    if (nutritionProblems(meal, config).length) return 'fails the nutrition check';
    if (filtered.has(meal.id)) return `missing ${describeMissing(filtered.get(meal.id).missing).join(', ')}`;
    if (vetoed.has(meal.id)) return `Pierre vetoes it${vetoed.get(meal.id).pierre?.why?.[0] ? ` (${vetoed.get(meal.id).pierre.why[0]})` : ''}`;
    if (tomorrow.has(meal.id)) return `needs ${tomorrow.get(meal.id).soak.map(labelFor).join(', ')} soaked first`;
    const x = ranked.get(meal.id);
    if (x && !shownSet.has(meal.id)) return `cookable, but #${rungPos.get(meal.id)} on its rung (only the top dishes are shown)`;
    if (x) {
      const other = filledBy(meal, x, ids, roles);
      if (other) return `made with ${other} instead`;
      return how === 'role' ? 'its seasoning slot went to another item' : 'optional, and left out';
    }
    return 'not ranked';
  };

  const out = (items ?? []).map((item) => {
    const name = typeof item === 'string' ? item : item?.name;
    const category = typeof item === 'object' ? item?.category ?? null : null;
    const { ids, roles, excluded, setAside } = resolveItem(name, inventory);
    const kit = ids.some(isKit) || category === 'appliance' || category === 'cookware';
    if (excluded) return { name, category, status: 'not_veg', kit, usedIn: [], reasons: [] };
    if (setAside) return { name, category, status: 'set_aside', kit, usedIn: [], reasons: [{ dish: null, why: 'frozen or ready-to-eat: left out for now' }] };
    if (!ids.length) return { name, category, status: 'unknown', kit, usedIn: [], reasons: [{ dish: null, why: 'Harvey’s couldn’t tell what this is' }] };
    const usedIn = [...shownSet].map((id) => ranked.get(id)).filter((x) => x && ids.some((i) => usedIds(x).has(i))).map((x) => x.meal.name);
    if (usedIn.length) return { name, category, status: 'used', kit, usedIn, reasons: [] };
    const reasons = [];
    for (const meal of catalogue) {
      const how = mentions(meal, ids, roles);
      if (how) reasons.push({ dish: meal.name, why: why(meal, ids, roles, how), how });
    }
    // Named dishes first (a seasoning slot is a weaker claim), then the closest to cookable.
    const near = (r) => (r.why.startsWith('cookable') || r.why.startsWith('made with') ? 0 : r.why.startsWith('missing') ? 1 : 2);
    reasons.sort((a, b) => (a.how === 'direct' ? 0 : 1) - (b.how === 'direct' ? 0 : 1) || near(a) - near(b));
    if (!reasons.length) reasons.push({ dish: null, why: 'no recipe uses it', how: null });
    return { name, category, status: 'unused', kit, usedIn: [], reasons: reasons.map(({ dish, why: w }) => ({ dish, why: w })) };
  });
  const unused = out.filter((x) => x.status !== 'used');
  // One missing thing away: the kit or food that would unlock the most dishes on its own.
  const one = new Map();
  for (const f of ranking.filtered ?? []) {
    if (kind !== 'any' && f.meal.kind !== kind) continue;
    const all = describeMissing(f.missing);
    if (all.length !== 1) continue;
    if (!one.has(all[0])) one.set(all[0], []);
    one.get(all[0]).push(f.meal.name);
  }
  const blockers = [...one.entries()].map(([thing, dishes]) => ({ thing, dishes }))
    .sort((a, b) => b.dishes.length - a.dishes.length || a.thing.localeCompare(b.thing));
  return {
    items: out,
    blockers,
    used: out.length - unused.length,
    unused: unused.length,
    gaps: unused.filter((x) => x.status !== 'set_aside' && x.reasons.length === 1 && x.reasons[0].dish === null).map((x) => x.name),
  };
}

/** The compact form a result file keeps: unused items only, each with up to 4 reasons. */
export function usageForResult(u) {
  return {
    used: u.items.filter((x) => x.status === 'used').map((x) => x.name),
    unused: u.items.filter((x) => x.status !== 'used').map((x) => ({ name: x.name, category: x.category, status: x.status, reasons: x.reasons.slice(0, 4) })),
    gaps: u.gaps,
    blockers: u.blockers.slice(0, 5),
  };
}
