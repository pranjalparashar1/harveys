// Prompts. The scan prompt makes the AI perceive only. The recipe prompt lets
// it propose candidates, which Marco's brain then validates, filters and scores.

import { FOODS, EQUIPMENT, ASSUMED_BASICS } from '../brain/vocabulary.js';

/**
 * Scan prompt (1.2): a compact answer is the biggest speed win. Listing ids
 * instead of a full object per item cuts the reply from thousands of tokens to
 * about a hundred, and the reply length is most of the wait.
 */
export function inventoryPrompt() {
  const foods = Object.keys(FOODS).join(',');
  const kit = [...Object.keys(EQUIPMENT), ...Object.keys(ASSUMED_BASICS)].join(',');
  return `These photos show one kitchen (fridge, shelves, counter, drawers). List what is clearly visible that matters for cooking. Do not suggest meals.

Known food ids: ${foods}
Known kit ids: ${kit}

Reply with ONLY this JSON, no prose:
{"have":[ids from the two lists that you can see],"other":[short names of other visible food or cookware, max 15]}`;
}

/**
 * Asks the AI to DESIGN candidates, not to choose. Marco's brain validates
 * each one against the inventory and scores it with everything else.
 * @param {{have: string[], context: {kind?: string, mood?: string}}} p
 */
export function recipePrompt({ have, context = {} }) {
  const foods = have.filter((id) => FOODS[id]);
  const kit = have.filter((id) => EQUIPMENT[id]);
  const kind = context.kind === 'snack' ? 'snack' : 'meal';
  return `You design recipes for a kitchen app. Another program, not you, will check and rank your recipes, and it rejects any recipe that uses something not listed below.

Food available (use ONLY these ids): ${foods.join(', ') || 'none'}
Appliances and cookware available (use ONLY these ids): ${kit.join(', ') || 'none'}
Small utensils assumed available: ${Object.keys(ASSUMED_BASICS).join(', ')}

Design up to 3 different ${kind}s for one person${context.mood ? ` who feels ${context.mood}` : ''}. Aim for the laziest high-protein ${kind} possible: as few tools, ingredients, steps and hands-on minutes as you can, little chopping, little to wash. Use realistic amounts and honest nutrition estimates for one serving.

Respond with ONLY a JSON object, no markdown and no prose, of exactly this form:
{"recipes": [{
  "name": string,
  "kind": "${kind}",
  "equipment": [appliance or cookware ids],
  "utensils": [small utensil ids],
  "ingredients": [{"id": food id, "amount": string, "prep": "ready"|"measure"|"wash"|"crack"|"crumble"|"peel_chop", "optional": boolean}],
  "steps": [{"text": string, "active": minutes you must be busy, "passive": minutes of waiting}],
  "attention": 0-3 (0 walk away, 3 burns if you look away),
  "cleanup": {"dishes": number of things to wash, "greasy": 0-2},
  "macros": {"protein": grams, "kcal": number, "fiber": grams}
}]}

"prep" is how the ingredient is handled: "ready" means open and use, "peel_chop" means it must be peeled or cut with a knife. Keep each step to one short sentence.`;
}
