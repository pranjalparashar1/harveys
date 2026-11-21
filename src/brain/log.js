// White v2's live learning (Step 5B): what "Cooked this" and "Fix / Veto" record.
// Pure: the page passes the time and stores the entries (localStorage marco.cookLog,
// marco.liveRepairs); Debug's "Copy for Claude" carries both.

import { toDishChain, TIERS } from './ingredients.js';

const r3 = (n) => Number((Number(n) || 0).toFixed(3));
const brief = (item) => ({ id: item.meal.id, tier: item.pierre.tier, payoff: r3(item.payoff.value), friction: r3(item.friction) });

/**
 * One "Cooked this" tap. `ladderShown` is every rung's pick (cross-rung skips);
 * `alternativesShown` is the rest of the chosen rung (within-rung overrides).
 */
export function cookLogEntry({ chosen, ladder, context = {}, at }) {
  const group = ladder.find((g) => g.pick.meal.id === chosen.meal.id || g.alternatives.some((a) => a.meal.id === chosen.meal.id));
  return {
    dishId: chosen.meal.id,
    rung: group?.rung ?? chosen.rung ?? null,
    tier: chosen.pierre.tier,
    ladderShown: ladder.map((g) => ({ rung: g.rung, pickId: g.pick.meal.id, tier: g.pick.pierre.tier, payoff: r3(g.pick.payoff.value), friction: r3(g.pick.friction) })),
    alternativesShown: group ? [group.pick, ...group.alternatives].filter((x) => x.meal.id !== chosen.meal.id).map(brief) : [],
    context,
    at,
  };
}

/** One "Fix / Veto" from the result screen: your tier for this exact dish, and what would fix it. */
export function liveRepairEntry({ item, tier, fix = '', at }) {
  if (!TIERS.includes(tier)) throw new Error(`unknown tier ${tier}`);
  const modifiers = item.used?.ingredients?.map((i) => i.id) ?? [];
  return {
    dishId: item.meal.id,
    name: item.meal.name,
    form: item.meal.form ?? null,
    parts: item.meal.parts ?? null,
    modifiers,
    chain: item.meal.parts ? toDishChain({ parts: item.meal.parts, modifiers }) : null,
    pierre: item.pierre.tier,
    yours: tier,
    fix: String(fix).trim().slice(0, 200),
    at,
  };
}

/** Your latest live tier per dish, as verdicts rank() applies straight away (a veto hides it). */
export function liveVerdicts(liveRepairs = []) {
  const out = {};
  for (const r of [...liveRepairs].sort((a, b) => String(a.at).localeCompare(String(b.at)))) out[r.dishId] = { tier: r.yours, why: r.fix || 'Fix / Veto on the result screen' };
  return out;
}
