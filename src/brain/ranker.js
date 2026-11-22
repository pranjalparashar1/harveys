// Marco's brain: decides what to cook. Deterministic and explainable.
//
//   1. Hard filter: a meal outside the diet (vegetarian + eggs), or needing kit or
//      an ingredient you don't have, is dropped.
//   2. score = payoff − λ_context × Σ_i w_i · f_i   (Friction v2, see learn.js)
//   3. Pierre (v2 Step 5A): a vetoed dish is dropped; the rest sort by tier
//      (crave > pass > floor) first, then by score.
//   4. White v2 (Step 5B): the ladder. Each dish sits on one attention rung (nothing
//      to watch, walk away, stand at it, juggle); inside a rung, tier → payoff →
//      friction. One pick per rung, so an easy dish never buries a better one.
//   5. Every score comes back as named parts, so the UI can say why it won.
//
// Pure: no DOM, no network, no randomness, no clock (the caller passes the time).
// Written to port line-for-line to MarcoCore (Foundation-only Swift).

import { CAPABILITIES, EQUIPMENT, FOODS, labelFor } from './vocabulary.js';
import { DEFAULT_CONFIG } from './config.js';
import { nutritionProblems } from './validate.js';
import { FEATURES, inDiet, prePrepUnits, rawFeatures } from './learn.js';
import { pierreTier } from './ingredients.js';
import { PIERRE_SEED } from './train-data.js';

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
    if (r.ok) ingredients.push(asUsed(ing, r.id, inventory));
    else if (!ing.optional) missing.ingredients.push(r.options);
  }
  const ok = missing.equipment.length === 0 && missing.ingredients.length === 0;
  return { ok, equipment, utensils: meal.utensils.filter((u) => !missingBasics.has(u)), ingredients, missing };
}

/**
 * The ingredient as it will be made. A role slot ('role:acid') becomes the item that fills it
 * (vinegar), keeping the role so Pierre tastes it; an open-ended item keeps its own name.
 */
function asUsed(ing, id, inventory) {
  if (id.startsWith('role:')) {
    const source = inventory.roles?.get(id.slice(5))?.[0] ?? id;
    return { ...ing, id: source, role: id, label: inventory.labels?.get(source) ?? labelFor(source) };
  }
  const label = inventory.labels?.get(id);
  return label ? { ...ing, id, label } : { ...ing, id };
}

/** The meal's macros and name as made: a swap (plain bread for protein bread) adjusts them (ESTIMATE). */
export function macrosAsMade(meal, used) {
  const m = { ...meal.macros };
  let name = meal.name;
  let swapped = false;
  for (const ing of used.ingredients) {
    const d = ing.swap?.[ing.id];
    if (!d) continue;
    swapped = true;
    if (d.name) name = d.name;
    for (const k of ['protein', 'kcal', 'fiber']) m[k] = Math.max(0, (m[k] ?? 0) + (d[k] ?? 0));
  }
  return swapped ? { macros: m, name, source: 'estimate' } : null;
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
    // Fitted Marco weights (config.frictionTheta, from the 50-tap sprint) win over the priors.
    const theta = config.frictionTheta?.[f.key] ?? f.prior;
    return { name: f.key, label: f.label, raw: value, normalised, value: -theta * normalised };
  });
  const friction = frictionParts.reduce((acc, p) => acc + p.value, 0);
  const pay = payoff(meal, targets, config);
  const score = pay.value - lambda.value * friction;
  return { score, payoff: pay, friction, frictionParts, lambda, raw };
}

/** Sort weight of Pierre's tiers. A veto never reaches the sort: rank() drops it. */
export const TIER_ORDER = { crave: 3, pass: 2, floor: 1 };

/** The one line a floor dish shows: the cheapest add-on that lifts it, else the slot to fix, else why. */
export function pierreHint(t) {
  if (t.tier !== 'floor') return null;
  if (t.upgrade) return `Lift it: + ${labelFor(t.upgrade.add)}`;
  const fix = t.repairs?.[0];
  if (fix?.suggest) return `Lift it: ${fix.slot === 'cookedWith' ? 'cook it with' : 'add'} ${labelFor(fix.suggest)}`;
  if (t.source === 'verdict') return 'Your rating: floor';
  return t.why.length ? `Why floor: ${t.why[0]}` : 'Floor';
}

/**
 * Pierre's view of a meal in this kitchen. Catalogue meals carry `parts` and a `form`;
 * the dish's seasonings are what it would actually use; pranjal's own verdict wins.
 * A meal without parts (an AI recipe) isn't judged: it passes, marked `untested`.
 */
export function judgeMeal(meal, used, inventory, verdicts = PIERRE_SEED) {
  if (!Array.isArray(meal.parts) || !meal.parts.length || !meal.form) {
    return { tier: 'pass', computed: null, source: 'untested', why: ['not judged: no Pierre parts'], hint: null, untested: true, finish: {} };
  }
  const t = pierreTier(meal.parts, meal.form, {
    // A role-filled or open-ended seasoning tastes like its roles to Pierre (ingredients.js MODIFIERS).
    modifiers: used.ingredients.flatMap((i) => (i.role ? [i.role] : i.id?.startsWith('x:') ? (inventory.extras?.find((e) => e.id === i.id)?.roles ?? []).map((r) => `role:${r}`) : [i.id])),
    inventory: [...inventory.have],
    verdict: verdicts[meal.id] ?? null,
  });
  return {
    tier: t.tier, computed: t.computed, source: t.source, why: t.why, upgrade: t.upgrade, repairs: t.repairs,
    untested: t.untested, hint: pierreHint(t), finish: t.profile?.finish ?? {},
  };
}

// ── White v2: the effort ladder (Step 5B) ──────────────────────────────────
/** Closed appliances: walk-away heat. */
export const CLOSED_APPLIANCES = new Set(['microwave', 'air_fryer', 'sandwich_maker', 'toaster', 'kettle', 'pressure_cooker']);
/** Open vessels you stand over (capabilities and the kit that meets them). */
export const OPEN_VESSELS = new Set(['pan', 'pot', 'saucepan', 'frying_pan', 'tawa', 'kadai', 'oven']);
/** Everything that counts toward juggling. */
export const COOKING_UNITS = new Set([...CLOSED_APPLIANCES, ...OPEN_VESSELS]);

export const RUNGS = {
  1: 'Nothing to watch',
  2: 'Walk away',
  3: 'Stand at it',
  4: 'Juggle',
};

/**
 * The attention rung of a meal as it would be made (`used` = checkMeal's kit, else the meal's).
 * Checked in this order: 4 (two or more cooking units, or attention 3), 1 (no heat, no knife),
 * 2 (exactly one closed appliance, no open vessel, attention ≤ 1, nothing to peel), else 3.
 * "Heat" is read from the kit, not the step text: "protein toast" is not a toaster.
 * Pre-prep never moves a dish between rungs.
 */
export function rungOf(meal, used = null) {
  const equipment = used?.equipment ?? meal.equipment ?? [];
  const raw = rawFeatures({ ...meal, equipment, utensils: used?.utensils ?? meal.utensils });
  const units = equipment.filter((e) => COOKING_UNITS.has(e));
  const closed = units.filter((e) => CLOSED_APPLIANCES.has(e)).length;
  const open = units.length - closed;
  if (units.length >= 2 || raw.attention >= 3) return 4;
  if (units.length === 0 && raw.peels === 0 && raw.cuts === 0) return 1;
  if (closed === 1 && open === 0 && raw.attention <= 1 && raw.peels === 0) return 2;
  return 3;
}

/** White's assembly line: parts one finishing step from done get a closing step, not friction. */
export function assemblyStepOf(meal, pierre, used) {
  const near = Object.entries(pierre?.finish ?? {}).filter(([, d]) => d === 'one finishing step').map(([k]) => k.split('@')[0]);
  if (!near.length) return null;
  const nearSet = new Set(near);
  const seasonings = (used?.ingredients ?? meal.ingredients ?? [])
    .map((i) => i.id ?? i.anyOf?.[0])
    .filter((id) => id && !nearSet.has(id) && ['spice', 'fat'].includes(FOODS[id]?.group) && id !== 'oil');
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
  const what = list([...new Set(near)].map((id) => labelFor(id).toLowerCase()));
  const withWhat = seasonings.length ? list([...new Set(seasonings)].map((id) => labelFor(id).toLowerCase())) : 'a pinch of salt';
  return `Finish the ${what} with ${withWhat}.`;
}

/** Inside a rung: tier, then payoff (macros win), then friction, then id. */
export function byRungOrder(a, b) {
  return TIER_ORDER[b.pierre.tier] - TIER_ORDER[a.pierre.tier]
    || b.payoff.value - a.payoff.value
    || a.friction - b.friction
    || a.meal.id.localeCompare(b.meal.id);
}

/** Groups ranked meals into the ladder: only rungs with a dish, one pick each. */
export function buildLadder(ranked, { alternatives = 3 } = {}) {
  const ladder = [];
  for (const rung of [1, 2, 3, 4]) {
    const items = ranked.filter((r) => r.rung === rung).sort(byRungOrder);
    if (!items.length) continue;
    ladder.push({ rung, name: RUNGS[rung], pick: items[0], alternatives: items.slice(1, 1 + alternatives) });
  }
  return ladder;
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
  if (winner.pierre && other.pierre && TIER_ORDER[winner.pierre.tier] > TIER_ORDER[other.pierre.tier]) {
    reasons.push(`Pierre rates it ${winner.pierre.tier}, the other ${other.pierre.tier}`);
  }
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
 * @param {object} [input.verdicts]  pranjal's Pierre verdicts by meal id (default PIERRE_SEED)
 */
/** The foods a dish needs soaked first (1.21.0): catalogue `prePrep.soak`. */
export const soakNeeds = (meal) => meal.prePrep?.soak ?? [];

/**
 * `soaked` (1.21.0): the foods you have soaking or soaked today. A dish whose soak foods are all
 * soaked ranks as if the soaking were done (no pre-prep friction, no note); one that still needs
 * soaking leaves tonight's ladder for `tomorrow` ("Soak rajma tonight"). Never hidden (v2 plan §2).
 */
export function rank({ inventory, targets, context = {}, catalogue, config = DEFAULT_CONFIG, verdicts = PIERRE_SEED, soaked = [] }) {
  const isSoaked = new Set(soaked);
  const tomorrow = [];
  const lambda = contextLambda(context, config);
  const kind = context.kind ?? 'meal';
  const ranked = [];
  const filtered = [];
  const vetoed = [];
  for (let meal of catalogue) {
    if (kind !== 'any' && meal.kind !== kind) continue;
    if (!inDiet(meal)) continue; // vegetarian + eggs, whatever the scan or the AI says
    if (nutritionProblems(meal, config).length) continue; // not food worth suggesting
    const used = checkMeal(meal, inventory);
    if (!used.ok) {
      filtered.push({ meal, missing: used.missing });
      continue;
    }
    const swapped = macrosAsMade(meal, used);
    if (swapped) meal = { ...meal, ...swapped };
    const pierre = judgeMeal(meal, used, inventory, verdicts);
    if (pierre.tier === 'veto') {
      vetoed.push({ meal, pierre });
      continue;
    }
    const needs = soakNeeds(meal);
    const unsoaked = needs.filter((id) => !isSoaked.has(id));
    if (unsoaked.length) {
      tomorrow.push({ meal, used, pierre, soak: unsoaked, ...scoreMeal(meal, used, targets, lambda, config) });
      continue;
    }
    // Soaked already: the pre-prep is done, so it costs nothing and needs no note.
    const ready = needs.length ? { ...meal, prePrep: null } : meal;
    ranked.push({
      meal: ready, used, pierre, rung: rungOf(ready, used),
      prePrepNote: ready.prePrep?.text ?? null,
      assemblyStep: assemblyStepOf(ready, pierre, used),
      ...scoreMeal(ready, used, targets, lambda, config),
    });
  }
  tomorrow.sort((a, b) => TIER_ORDER[b.pierre.tier] - TIER_ORDER[a.pierre.tier]
    || b.score - a.score || a.meal.id.localeCompare(b.meal.id));
  ranked.sort((a, b) => TIER_ORDER[b.pierre.tier] - TIER_ORDER[a.pierre.tier]
    || b.score - a.score || a.friction - b.friction || a.meal.id.localeCompare(b.meal.id));
  for (const r of ranked) r.reasons = headlineReasons(r);
  if (ranked.length > 1) ranked[0].beats = { other: ranked[1].meal, reasons: compareReasons(ranked[0], ranked[1]) };

  // "Buy X to unlock": meals blocked by exactly one ingredient (and no missing kit).
  const unlockCounts = new Map();
  for (const f of filtered) {
    if (f.missing.equipment.length === 0 && f.missing.ingredients.length === 1) {
      // Never "unlock" a dish Pierre would veto once you had it (the mug omelette).
      const asMade = { ingredients: f.meal.ingredients.map((i) => ({ id: i.id ?? i.anyOf[0] })) };
      if (judgeMeal(f.meal, asMade, inventory, verdicts).tier === 'veto') continue;
      const key = f.missing.ingredients[0][0];
      if (!unlockCounts.has(key)) unlockCounts.set(key, []);
      unlockCounts.get(key).push(f.meal.name);
    }
  }
  const unlocks = [...unlockCounts.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, config.unlockSuggestions)
    .map(([id, meals]) => ({ id, label: labelFor(id), meals }));

  // "Get a saucepan to unlock": meals blocked only by one piece of kit (1.30.0). A kitchen
  // with a nonstick kadai but no saucepan or kettle has no real way to boil water.
  const kitCounts = new Map();
  for (const f of filtered) {
    if (f.missing.ingredients.length || new Set(f.missing.equipment).size !== 1) continue;
    const key = f.missing.equipment[0];
    if (!kitCounts.has(key)) kitCounts.set(key, []);
    kitCounts.get(key).push(f.meal.name);
  }
  const kitUnlocks = [...kitCounts.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, config.unlockSuggestions)
    .map(([id, meals]) => ({ id, label: labelFor(id), meals }));

  return { ladder: buildLadder(ranked), ranked, filtered, vetoed, unlocks, kitUnlocks, lambda, tomorrow };
}

/** Human description of what blocked a meal. */
export function describeMissing(missing) {
  const kit = missing.equipment.map((id) => (EQUIPMENT[id] || CAPABILITIES[id] ? labelFor(id) : labelFor(id).toLowerCase()));
  const food = missing.ingredients.map((opts) => opts.map(labelFor).join(' or '));
  return [...kit, ...food];
}
