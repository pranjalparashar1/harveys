// Prompts. The scan prompt makes the AI perceive only. The recipe prompt lets
// it propose candidates, which Marco's brain then validates, filters and scores.

import { FOODS, EQUIPMENT, ASSUMED_BASICS } from '../brain/vocabulary.js';

export function inventoryPrompt() {
  const ids = [...Object.keys(FOODS), ...Object.keys(EQUIPMENT), ...Object.keys(ASSUMED_BASICS)].join(', ');
  return `You are the eyes of a kitchen inventory app. The photos show one kitchen: counters, shelves, drawers, the fridge and freezer.

List every distinct thing you can see that matters for cooking: food and drink (including fridge contents, packets, spices and condiments), appliances, cookware, utensils and cutlery. Read brand names on packaging when legible. Merge duplicates that appear in several photos. Do not guess at things you cannot see, and do not suggest recipes or meals.

For each item, set "canonical" to the closest id from this list when the item clearly is that thing, otherwise null:
${ids}

Respond with ONLY a JSON object, no markdown and no prose, of exactly this form:
{"items": [{"name": string, "category": "food"|"appliance"|"cookware"|"utensil"|"cutlery"|"other", "canonical": string|null, "brand": string|null, "quantity": string|null, "location": "fridge"|"freezer"|"counter"|"shelf"|"drawer"|"other", "confidence": "low"|"medium"|"high"}]}

"quantity" is a short estimate such as "half a block", "6 eggs" or "almost empty".`;
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

Design up to 3 different ${kind}s for one person who feels ${context.mood || 'okay'}. Aim for the laziest high-protein ${kind} possible: as few tools, ingredients, steps and hands-on minutes as you can, little chopping, little to wash. Use realistic amounts and honest nutrition estimates for one serving.

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
