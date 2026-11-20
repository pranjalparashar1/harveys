// Marco's brain: decides what to cook. Deterministic and explainable.
//
//   1. Hard filter: a meal outside the diet (vegetarian + eggs), or needing kit or
//      an ingredient you don't have, is dropped.
//   2. score = payoff − λ_context × Σ_i w_i · f_i   (Friction v2, see learn.js)
//   3. Every score comes back as named parts, so the UI can say why it won.
//
// Pure: no DOM, no network, no randomness, no clock (the caller passes the time).
// Written to port line-for-line to MarcoCore (Foundation-only Swift).

import { CAPABILITIES, EQUIPMENT, labelFor } from './vocabulary.js';
import { DEFAULT_CONFIG } from './config.js';
import { nutritionProblems } from './validate.js';
import { FEATURES, inDiet, prePrepUnits, rawFeatures } from './learn.js';

/**
 * Friction v2: the friction half of learn.js's FEATURES. Weight = −prior.
 * PROVISIONAL: the priors are hand-set, not fitted. They get refit from the
 * "Cooked this" log (v2 plan, Step 5). Not capped at 1: effort past the
 * scale still counts, the same as the pick-two trainer sees it.
 */
const FRICTION = FEATURES.filter((f) => !f.payoff);

/**
 * λ_context with its named parts.
 * Mood is optional: with no mood given (the 1.3.2 page doesn't ask), it adds no
 * factor, so λ comes from time of day and day of week alone. An unknown mood
 * counts as 'okay'.
 */
export function contextLambda(context = {}, config = DEFAULT_CONFIG) {
  const { lambda } = config;
  const mood = context.mood == null ? null : context.mood in lambda.mood ? context.mood : 'okay';
  const hour = Number.isFinite(context.hour) ? context.hour : 19;
  const day = Number.isFinite(context.weekday) ? context.weekday : 3; // 0 = Sunday
  const late = hour >= 21 || hour < 5;
  const weekend = day === 0 || day === 6;
  const parts = mood ? [{ name: `mood: ${mood}`, factor: lambda.mood[mood] }] : [];
  if (late) parts.push({ name: 'late night', factor: lambda.lateNight });
  parts.push(weekend ? { name: 'weekend', factor: lambda.weekend } : { name: 'weekday', factor: lambda.weeknight });
  const value = parts.reduce((acc, p) => acc * p.factor, 1);
  return { value, parts };
}

function resolveEquipment(req, have) {
  if (CAPABILITIES[req]) {
    const owned = CAPABILITIES[req].anyOf.find((id) => have.has(id));
    return owned ? { ok: true, id: owned } : { ok: false, need: req };
  }
  return have.has(req) ? { ok: true, id: req } : { ok: false, need: req };
}

function resolveIngredient(ing, have) {
  const options = ing.anyOf ?? [ing.id];
  const owned = options.find((id) => have.has(id));
  return owned ? { ok: true, id: owned } : { ok: false, options };
}

/** Checks one meal against the inventory. Returns what it would use, or what is missing. */
export function checkMeal(meal, inventory) {
  const { have, missingBasics } = inventory;
  const equipment = [];
  const missing = { equipment: [], ingredients: [] };
  for (const req of meal.equipment) {
    const r = resolveEquipment(req, have);
    if (r.ok) equipment.push(r.id);
    else missing.equipment.push(r.need);
  }
  for (const u of meal.utensils) if (missingBasics.has(u)) missing.equipment.push(u);
  const ingredients = [];
  for (const ing of meal.ingredients) {
    const r = resolveIngredient(ing, have);
    if (r.ok) ingredients.push({ ...ing, id: r.id });
    else if (!ing.optional) missing.ingredients.push(r.options);
  }
  const ok = missing.equipment.length === 0 && missing.ingredients.length === 0;
  return { ok, equipment, utensils: meal.utensils.filter((u) => !missingBasics.has(u)), ingredients, missing };
}

/**
 * Raw Friction v2 values for a meal as it would actually be made (the kit you
 * own that it uses). The stove isn't a tool on top of its pan; peels (garlic,
 * onion, ginger) are counted apart from easy cuts; pre-prep is its own value.
 */
export function frictionRaw(meal, used) {
  return rawFeatures({ ...meal, equipment: used.equipment, utensils: used.utensils });
}

/** Payoff: progress toward what is left of today's targets, capped at the target. */
export function payoff(meal, targets, config = DEFAULT_CONFIG) {
  const conf = config.confidenceFactor[meal.source] ?? config.confidenceFactor.estimate;
  const rows = [
    ['protein', meal.macros.protein, targets.protein, 'g protein'],
    ['calories', meal.macros.kcal, targets.calories, 'kcal'],
    ['fiber', meal.macros.fiber, targets.fiber, 'g fiber'],
  ];
  const parts = rows.map(([key, amount, remaining, unit]) => {
    const progress = remaining > 0 ? Math.min(amount, remaining) / remaining : 0;
    return { name: key, amount, unit, progress, value: config.payoffWeights[key] * progress * conf };
  });
  return { value: parts.reduce((acc, p) => acc + p.value, 0), parts, confidence: conf };
}

/** Scores one feasible meal. */
export function scoreMeal(meal, used, targets, lambda, config = DEFAULT_CONFIG) {
  const raw = frictionRaw(meal, used);
  const values = { ...raw, prePrep: prePrepUnits(raw.prePrepMinutes) };
  const frictionParts = FRICTION.map((f) => {
    const value = Number(values[f.key]) || 0;
    const normalised = value / f.scale;
    return { name: f.key, label: f.label, raw: value, normalised, value: -f.prior * normalised };
  });
  const friction = frictionParts.reduce((acc, p) => acc + p.value, 0);
  const pay = payoff(meal, targets, config);
  const score = pay.value - lambda.value * friction;
  return { score, payoff: pay, friction, frictionParts, lambda, raw };
}

function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

function fmtMin(m) {
  return Number.isInteger(m) ? `${m}` : m.toFixed(1).replace(/\.0$/, '');
}

/** "no chopping", "1 thing to peel", "2 things to cut", or both. */
function knifeWork(raw) {
  if (raw.peels === 0 && raw.cuts === 0) return 'no chopping';
  return [
    raw.peels ? plural(raw.peels, 'thing to peel', 'things to peel') : null,
    raw.cuts ? plural(raw.cuts, 'thing to cut', 'things to cut') : null,
  ].filter(Boolean).join(', ');
}

/** The short "why" chips, e.g. ["1 tool", "no chopping", "2 min hands-on", "20 g protein"]. */
export function headlineReasons(result) {
  const { raw, meal } = result;
  return [
    plural(raw.tools, 'tool'),
    knifeWork(raw),
    `${fmtMin(raw.handsOn)} min hands-on`,
    raw.waiting > 0 ? `${fmtMin(raw.waiting)} min waiting` : 'no waiting',
    `${meal.macros.protein} g protein`,
  ];
}

/** Sentences comparing the winner with another meal, largest friction gaps first. */
export function compareReasons(winner, other) {
  const reasons = [];
  const d = (k) => other.raw[k] - winner.raw[k];
  if (d('tools') > 0) reasons.push(`${plural(d('tools'), 'fewer tool', 'fewer tools')}`);
  const knife = (r) => r.peels + r.cuts;
  if (knife(other.raw) > knife(winner.raw)) {
    if (knife(winner.raw) === 0) reasons.push('no chopping');
    else {
      if (d('peels') > 0) reasons.push(`${plural(d('peels'), 'fewer thing', 'fewer things')} to peel`);
      if (d('cuts') > 0) reasons.push(`${plural(d('cuts'), 'fewer thing', 'fewer things')} to cut`);
    }
  }
  if (d('handsOn') >= 1) reasons.push(`${fmtMin(d('handsOn'))} fewer minutes standing there`);
  if (d('prePrepMinutes') > 0) reasons.push(winner.raw.prePrepMinutes === 0 ? 'no soaking ahead' : 'less soaking ahead');
  if (d('cleanup') >= 1) reasons.push(`${fmtMin(d('cleanup'))} less to clean`);
  if (d('steps') > 0) reasons.push(`${plural(d('steps'), 'fewer step', 'fewer steps')}`);
  const proteinGap = winner.meal.macros.protein - other.meal.macros.protein;
  if (proteinGap > 0) reasons.push(`${proteinGap} g more protein`);
  else if (proteinGap < 0) reasons.push(`${-proteinGap} g less protein, worth it for the effort saved`);
  return reasons;
}

/**
 * Ranks the catalogue for this inventory and moment.
 *
 * @param {object} input
 * @param {{have: Set<string>, missingBasics: Set<string>}} input.inventory  from buildInventory()
 * @param {{protein: number, calories: number, fiber: number}} input.targets  remaining today
 * @param {{mood?: 'fresh'|'okay'|'tired', hour?: number, weekday?: number, kind?: 'meal'|'snack'|'any'}} input.context
 * @param {Array} input.catalogue
 * @param {object} [input.config]
 */
export function rank({ inventory, targets, context = {}, catalogue, config = DEFAULT_CONFIG }) {
  const lambda = contextLambda(context, config);
  const kind = context.kind ?? 'meal';
  const ranked = [];
  const filtered = [];
  for (const meal of catalogue) {
    if (kind !== 'any' && meal.kind !== kind) continue;
    if (!inDiet(meal)) continue; // vegetarian + eggs, whatever the scan or the AI says
    if (nutritionProblems(meal, config).length) continue; // not food worth suggesting
    const used = checkMeal(meal, inventory);
    if (!used.ok) {
      filtered.push({ meal, missing: used.missing });
      continue;
    }
    ranked.push({ meal, used, ...scoreMeal(meal, used, targets, lambda, config) });
  }
  ranked.sort((a, b) => b.score - a.score || a.friction - b.friction || a.meal.id.localeCompare(b.meal.id));
  for (const r of ranked) r.reasons = headlineReasons(r);
  if (ranked.length > 1) ranked[0].beats = { other: ranked[1].meal, reasons: compareReasons(ranked[0], ranked[1]) };

  // "Buy X to unlock": meals blocked by exactly one ingredient (and no missing kit).
  const unlockCounts = new Map();
  for (const f of filtered) {
    if (f.missing.equipment.length === 0 && f.missing.ingredients.length === 1) {
      const key = f.missing.ingredients[0][0];
      if (!unlockCounts.has(key)) unlockCounts.set(key, []);
      unlockCounts.get(key).push(f.meal.name);
    }
  }
  const unlocks = [...unlockCounts.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, config.unlockSuggestions)
    .map(([id, meals]) => ({ id, label: labelFor(id), meals }));

  return { ranked, filtered, unlocks, lambda };
}

/** Human description of what blocked a meal. */
export function describeMissing(missing) {
  const kit = missing.equipment.map((id) => (EQUIPMENT[id] || CAPABILITIES[id] ? labelFor(id) : labelFor(id).toLowerCase()));
  const food = missing.ingredients.map((opts) => opts.map(labelFor).join(' or '));
  return [...kit, ...food];
}
