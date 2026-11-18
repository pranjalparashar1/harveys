// Marco's brain: decides what to cook. Deterministic and explainable.
//
//   1. Hard filter: a meal needing kit or an ingredient you don't have is dropped.
//   2. score = payoff − λ_context × Σ_i w_i · f_i
//   3. Every score comes back as named parts, so the UI can say why it won.
//
// Pure: no DOM, no network, no randomness, no clock (the caller passes the time).
// Written to port line-for-line to MarcoCore (Foundation-only Swift).

import { CAPABILITIES, EQUIPMENT, labelFor } from './vocabulary.js';
import { DEFAULT_CONFIG } from './config.js';
import { nutritionProblems } from './validate.js';

/** Eating ware doesn't count as a "tool" (you'd use a plate for takeaway too). */
const EATING_WARE = new Set(['plate', 'spoon', 'fork', 'mug']);

const FRICTION_LABELS = {
  tools: 'tools',
  ingredients: 'ingredients (prep-weighted)',
  steps: 'steps',
  activeMinutes: 'hands-on minutes',
  attention: 'attention needed',
  cleanup: 'cleanup',
};

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

/** Raw friction values for a meal as it would actually be made. */
export function frictionFeatures(meal, used, config = DEFAULT_CONFIG) {
  const tools = used.equipment.length + used.utensils.filter((u) => !EATING_WARE.has(u)).length;
  const ingredients = used.ingredients.reduce((acc, i) => acc + (config.prepWeights[i.prep] ?? 1), 0);
  const steps = meal.steps.length;
  const activeMinutes = meal.steps.reduce((acc, s) => acc + (s.active ?? 0), 0);
  const passiveMinutes = meal.steps.reduce((acc, s) => acc + (s.passive ?? 0), 0);
  const attention = meal.attention;
  const cleanup = meal.cleanup.dishes + meal.cleanup.greasy * config.greasyWeight;
  const chopCount = used.ingredients.filter((i) => i.prep === 'peel_chop').length;
  return { tools, ingredients, steps, activeMinutes, attention, cleanup, passiveMinutes, chopCount };
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
  const raw = frictionFeatures(meal, used, config);
  const frictionParts = Object.keys(config.frictionWeights).map((key) => {
    const normalised = Math.min(raw[key] / config.frictionScale[key], 1);
    return { name: key, label: FRICTION_LABELS[key], raw: raw[key], normalised, value: config.frictionWeights[key] * normalised };
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

/** The short "why" chips, e.g. ["1 tool", "no chopping", "2 min hands-on", "20 g protein"]. */
export function headlineReasons(result) {
  const { raw, meal } = result;
  return [
    plural(raw.tools, 'tool'),
    raw.chopCount === 0 ? 'no chopping' : plural(raw.chopCount, 'thing to chop', 'things to chop'),
    `${fmtMin(raw.activeMinutes)} min hands-on`,
    raw.passiveMinutes > 0 ? `${fmtMin(raw.passiveMinutes)} min waiting` : 'no waiting',
    `${meal.macros.protein} g protein`,
  ];
}

/** Sentences comparing the winner with another meal, largest friction gaps first. */
export function compareReasons(winner, other) {
  const reasons = [];
  const d = (k) => other.raw[k] - winner.raw[k];
  if (d('tools') > 0) reasons.push(`${plural(d('tools'), 'fewer tool', 'fewer tools')}`);
  if (other.raw.chopCount > winner.raw.chopCount)
    reasons.push(winner.raw.chopCount === 0 ? 'no chopping' : `${other.raw.chopCount - winner.raw.chopCount} less to chop`);
  if (d('activeMinutes') >= 1) reasons.push(`${fmtMin(d('activeMinutes'))} fewer minutes standing there`);
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
