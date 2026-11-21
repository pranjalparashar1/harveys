// Refit Marco from real dinners (backlog #2, Step 5 handoff §5). Pure: turns the
// "Cooked this" log into the pick-two choices fitMarco() already understands.
// Each dinner says "I cooked X over everything else I was shown": X beats every
// other rung's pick (ladderShown, cross-rung skips) and every other dish on its
// own rung (alternativesShown, within-rung overrides).

import { CATALOGUE } from './catalogue.js';
import { TECHNIQUE_OVERLAY } from './train-data.js';
import { FEATURES, rawFeatures, featureVector, fitMarco, fittedWeightsPayload } from './learn.js';

/** Pierre tier → the trainer's 0..1 taste value (same as train.js). */
export const TIER_VALUE = { crave: 1, pass: 1, floor: 0.5, veto: 0 };

/** Accepts a "Copy for Claude" paste (object with cookLog) or a bare cookLog array. */
export function cookLogFrom(paste) {
  const data = typeof paste === 'string' ? JSON.parse(paste) : paste;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.cookLog)) return data.cookLog;
  throw new Error('no cookLog in this paste');
}

/**
 * Pairwise choices from the cook log. Only catalogue dishes can be refit (an AI
 * recipe's friction isn't kept in the log); their pairs are counted as skipped.
 */
export function cookLogChoices(cookLog, { catalogue = CATALOGUE } = {}) {
  const byId = new Map(catalogue.map((d) => [d.id, { ...d, ...TECHNIQUE_OVERLAY[d.id] }]));
  const vec = (id, tier) => (byId.has(id) ? featureVector(rawFeatures(byId.get(id)), TIER_VALUE[tier] ?? 0.5) : null);
  const choices = [];
  const skipped = new Set();
  let dinners = 0;
  for (const e of cookLog) {
    const xa = vec(e.dishId, e.tier);
    if (!xa) { skipped.add(e.dishId); continue; }
    const others = [
      ...(e.ladderShown ?? []).filter((l) => l.pickId !== e.dishId).map((l) => ({ id: l.pickId, tier: l.tier, kind: 'skip' })),
      ...(e.alternativesShown ?? []).filter((a) => a.id !== e.dishId).map((a) => ({ id: a.id, tier: a.tier, kind: 'override' })),
    ];
    const seen = new Set();
    let used = 0;
    for (const o of others) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      const xb = vec(o.id, o.tier);
      if (!xb) { skipped.add(o.id); continue; }
      choices.push({ xa, xb, pick: 'a', mood: 'okay', a: e.dishId, b: o.id, kind: o.kind, at: e.at });
      used++;
    }
    if (used) dinners++;
  }
  return { choices, dinners, skipped: [...skipped].sort() };
}

/**
 * Refits θ from the cook log. Returns the fit, the config-ready frictionTheta
 * (positives clamped to 0, as in 5C: a cost can't be a bonus) and the change
 * against the weights the app runs on now. It never writes config.
 */
export function refitFromCookLog(cookLog, { current = {}, catalogue } = {}) {
  const { choices, dinners, skipped } = cookLogChoices(cookLog, { catalogue });
  // Start from (and pull toward) the weights the app runs on now, so a handful of
  // dinners nudges the sprint fit instead of falling back to the trainer's priors.
  const prior = FEATURES.map((f) => (f.payoff ? f.prior : current[f.key] ?? f.prior));
  const fit = fitMarco(choices.map(({ xa, xb, pick, mood }) => ({ xa, xb, pick, mood })), { prior });
  const payload = fittedWeightsPayload(fit);
  const clamped = Object.fromEntries(Object.entries(payload.frictionTheta).map(([k, v]) => [k, v > 0 ? 0 : v]));
  const diff = FEATURES.filter((f) => !f.payoff).map((f) => ({
    key: f.key, now: current[f.key] ?? f.prior, fitted: payload.frictionTheta[f.key], proposed: clamped[f.key],
  }));
  return { dinners, pairs: choices.length, skipped, fit, payload, frictionTheta: clamped, diff };
}
