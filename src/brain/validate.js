// Gatekeeper for recipes the AI designs. The AI may propose; only meals that
// pass here, then pass the ranker's inventory filter, can ever be suggested.
// Friction is recomputed from structure where possible, so the AI can't make a
// recipe look easier than it is. Pure: no DOM, no network.

import { FOODS, EQUIPMENT, ASSUMED_BASICS, CAPABILITIES } from './vocabulary.js';
import { DEFAULT_CONFIG } from './config.js';

/**
 * Why a meal isn't food worth suggesting, or [] if it passes. Shared by the AI
 * gatekeeper below and the ranker, so the catalogue meets the same bar.
 */
export function nutritionProblems(meal, config = DEFAULT_CONFIG) {
  const gate = config.nutritionGate;
  const problems = [];
  const protein = Number(meal.macros?.protein) || 0;
  const kcal = Number(meal.macros?.kcal) || 0;
  const min = gate.minProtein[meal.kind] ?? gate.minProtein.meal;
  if (protein < min) problems.push(`only ${protein} g protein`);
  else if (kcal / protein > gate.maxKcalPerGramProtein) problems.push(`${kcal} kcal for ${protein} g protein`);
  const core = (meal.ingredients ?? []).filter((i) => !i.optional);
  if (core.length && core.every((i) => gate.condimentGroups.includes(FOODS[i.id]?.group))) {
    problems.push('only fats, spices or spreads');
  }
  return problems;
}

const EATING_WARE = new Set(['plate', 'spoon', 'fork', 'mug']);
const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : null);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

/**
 * @param {any} raw  one recipe as the AI returned it
 * @param {{index?: number, kind?: string, config?: object}} [opts]
 * @returns {{ok: boolean, meal?: object, errors: string[], adjustments: string[]}}
 */
export function validateMeal(raw, opts = {}) {
  const config = opts.config ?? DEFAULT_CONFIG;
  const errors = [];
  const adjustments = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['not a recipe'], adjustments };

  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : '';
  if (name.length < 2) errors.push('it has no name');

  // Kit: appliances/cookware must be known ids; utensils that are really cookware move over.
  const equipment = [];
  const utensils = [];
  for (const id of Array.isArray(raw.equipment) ? raw.equipment : []) {
    if (EQUIPMENT[id] || CAPABILITIES[id]) equipment.push(id);
    else if (ASSUMED_BASICS[id]) utensils.push(id);
    else errors.push(`it needs "${id}", which Marco doesn't know`);
  }
  for (const id of Array.isArray(raw.utensils) ? raw.utensils : []) {
    if (ASSUMED_BASICS[id]) utensils.push(id);
    else if (EQUIPMENT[id]) equipment.push(id);
    else adjustments.push(`ignored unknown utensil "${id}"`);
  }

  // Ingredients: every id must be a known food, or Marco can't check you have it.
  const ingredients = [];
  const rawIngredients = Array.isArray(raw.ingredients) ? raw.ingredients : [];
  if (rawIngredients.length === 0 || rawIngredients.length > 12) errors.push('it has no usable ingredient list');
  for (const ing of rawIngredients.slice(0, 12)) {
    if (!ing || !FOODS[ing.id]) {
      errors.push(`it uses "${ing?.id ?? ing?.name ?? '?'}", which Marco can't verify you have`);
      continue;
    }
    const prep = ing.prep in config.prepWeights ? ing.prep : 'measure';
    if (prep !== ing.prep) adjustments.push(`treated ${ing.id} as "measure"`);
    ingredients.push({ id: ing.id, amount: String(ing.amount ?? '').slice(0, 40) || 'some', prep, optional: ing.optional === true });
  }
  if (ingredients.length && ingredients.every((i) => i.optional)) errors.push('every ingredient is optional');

  // Chopping needs a knife and a board, whatever the AI listed.
  if (ingredients.some((i) => i.prep === 'peel_chop')) {
    for (const u of ['knife', 'cutting_board']) {
      if (!utensils.includes(u)) {
        utensils.push(u);
        adjustments.push(`added a ${u.replace('_', ' ')} for the chopping`);
      }
    }
  }

  // Steps: at least half a minute of hands-on time each.
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  if (rawSteps.length === 0 || rawSteps.length > 12) errors.push('it has no usable steps');
  const steps = rawSteps.slice(0, 12).map((s) => {
    const text = String(s?.text ?? s ?? '').slice(0, 200);
    let active = num(s?.active, 0, 120) ?? 1;
    if (active < 0.5) {
      active = 0.5;
      adjustments.push('counted every step as at least half a minute');
    }
    return { text, active, passive: num(s?.passive, 0, 240) ?? 0 };
  });

  // Cleanup: at least one dish per pan, pot and non-eating utensil used.
  const kitToWash = equipment.filter((id) => EQUIPMENT[id]?.kind === 'cookware' || CAPABILITIES[id] && id !== 'stovetop').length
    + utensils.filter((u) => !EATING_WARE.has(u)).length;
  const claimedDishes = num(raw.cleanup?.dishes, 0, 15) ?? kitToWash;
  const dishes = Math.max(claimedDishes, kitToWash, 1);
  if (dishes > claimedDishes) adjustments.push(`raised cleanup from ${claimedDishes} to ${dishes} dishes`);

  // Macros must be physically possible: 4 kcal per gram of protein.
  const protein = num(raw.macros?.protein, 0, 150);
  const kcal = num(raw.macros?.kcal, 0, 2500);
  const fiber = num(raw.macros?.fiber, 0, 60) ?? 0;
  if (protein == null || kcal == null) errors.push('it has no nutrition estimate');
  else if (protein * 4 > kcal * 1.1) errors.push(`its macros don't add up (${protein} g protein in ${kcal} kcal)`);

  const meal = {
    id: `ai_${opts.index ?? 0}_${slug(name) || 'recipe'}`,
    name,
    kind: raw.kind === 'snack' || raw.kind === 'meal' ? raw.kind : opts.kind ?? 'meal',
    origin: 'ai',
    equipment: [...new Set(equipment)],
    utensils: [...new Set(utensils)],
    ingredients,
    steps,
    attention: Math.round(num(raw.attention, 0, 3) ?? 1),
    cleanup: { dishes, greasy: Math.round(num(raw.cleanup?.greasy, 0, 2) ?? 1) },
    macros: { protein: Math.round(protein ?? 0), kcal: Math.round(kcal ?? 0), fiber: Math.round(fiber) },
    source: 'ai',
  };
  if (protein != null && kcal != null) errors.push(...nutritionProblems(meal, config));
  return { ok: errors.length === 0, meal, errors, adjustments };
}
