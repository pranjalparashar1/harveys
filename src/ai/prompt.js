// The one instruction every provider receives. The AI perceives; it never
// suggests meals. It maps what it sees onto Marco's vocabulary where it can.

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
