// Open-ended pantry (1.29.0). Any named ingredient gets a profile Pierre and Marco can use,
// so a kitchen is no longer limited to pranjal's fixed ids (vocabulary.js).
//
// A profile says what a food IS, not what it's called:
//   as        the vocabulary id it can stand in for ('sourdough' → bread), or null
//   kind      food | appliance | cookware
//   category  a display group (CATEGORIES)
//   foodClass one of Fable's 8 SFAH classes (ontology.js), or null
//   roles     what it brings to a dish as a seasoning: salt, umami, acid, fat, heat, sweet, fresh, crunch
//   cookFirst true when it's inedible raw
//   diet      veg | egg | non_veg   (non_veg never enters an inventory)
//   per100g   { protein, kcal, fiber } rough, for later payoff use
//   source    id (a vocabulary id) | lookup (the table below) | keyword | ai (flash-lite, cached) | unknown
//
// Resolution order: vocabulary id or synonym → cache (flash-lite answers) → LOOKUP → keyword rules.
// Every value here is Claude's ESTIMATE, not a rating. Pure: no DOM, no network.

import { FOODS, EQUIPMENT } from './vocabulary.js';
import { FOOD_CLASSES } from './ontology.js';

export const ROLES = Object.freeze(['salt', 'umami', 'acid', 'fat', 'heat', 'sweet', 'fresh', 'crunch']);
export const CATEGORIES = Object.freeze(['protein', 'dairy', 'grain', 'bread', 'veg', 'fruit', 'fat', 'condiment', 'spice', 'herb', 'nuts_seeds', 'snack', 'sweet', 'drink', 'appliance', 'cookware', 'other']);
export const DIETS = Object.freeze(['veg', 'egg', 'non_veg']);

/** The token an inventory carries for a role ('role:acid'), so a dish can ask for "any acid". */
export const roleToken = (role) => `role:${role}`;
/** The id an open-ended item carries ('x:soy_sauce'). */
export const extraId = (name) => `x:${slug(name)}`;

export function slug(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

const P = (category, roles = [], extra = {}) => ({ category, roles, ...extra });

// Common things outside the fixed ids, as they appear in Indian home kitchens. ESTIMATE.
export const LOOKUP = {
  'soy sauce': P('condiment', ['salt', 'umami'], { foodClass: 'aromatic_herb_acid', per100g: { protein: 8, kcal: 60, fiber: 1 } }),
  'dark soy sauce': P('condiment', ['salt', 'umami', 'sweet'], { foodClass: 'aromatic_herb_acid' }),
  vinegar: P('condiment', ['acid'], { foodClass: 'aromatic_herb_acid' }),
  'apple cider vinegar': P('condiment', ['acid'], { foodClass: 'aromatic_herb_acid' }),
  'chilli sauce': P('condiment', ['heat', 'sweet', 'acid'], { foodClass: 'aromatic_herb_acid' }),
  'green chilli sauce': P('condiment', ['heat', 'acid'], { foodClass: 'aromatic_herb_acid' }),
  'hot sauce': P('condiment', ['heat', 'acid', 'salt'], { foodClass: 'aromatic_herb_acid' }),
  sriracha: P('condiment', ['heat', 'sweet', 'acid'], { foodClass: 'aromatic_herb_acid' }),
  'schezwan sauce': P('condiment', ['heat', 'salt', 'umami'], { foodClass: 'aromatic_herb_acid' }),
  'peri peri': P('spice', ['heat', 'salt'], { foodClass: 'aromatic_herb_acid' }),
  mustard: P('condiment', ['acid', 'heat'], { foodClass: 'aromatic_herb_acid' }),
  pesto: P('condiment', ['fat', 'salt', 'umami', 'fresh'], { foodClass: 'pure_or_emulsified_fat' }),
  'pasta sauce': P('condiment', ['acid', 'umami', 'salt'], { foodClass: 'watery_veg_fruit' }),
  'pizza sauce': P('condiment', ['acid', 'umami', 'salt'], { foodClass: 'watery_veg_fruit' }),
  pickle: P('condiment', ['acid', 'salt', 'heat'], { foodClass: 'aromatic_herb_acid' }),
  achar: P('condiment', ['acid', 'salt', 'heat'], { foodClass: 'aromatic_herb_acid' }),
  chutney: P('condiment', ['acid', 'sweet', 'fresh'], { foodClass: 'aromatic_herb_acid' }),
  tamarind: P('condiment', ['acid', 'sweet'], { foodClass: 'aromatic_herb_acid' }),
  jaggery: P('sweet', ['sweet']),
  sugar: P('sweet', ['sweet']),
  jam: P('sweet', ['sweet', 'acid'], { foodClass: 'watery_veg_fruit' }),
  'maple syrup': P('sweet', ['sweet']),
  'cocoa powder': P('sweet', []),
  'fresh cream': P('dairy', ['fat'], { foodClass: 'pure_or_emulsified_fat', per100g: { protein: 2, kcal: 290, fiber: 0 } }),
  cream: P('dairy', ['fat'], { foodClass: 'pure_or_emulsified_fat' }),
  'cheese spread': P('dairy', ['fat', 'salt', 'umami'], { as: 'cheese', foodClass: 'dense_protein_dairy' }),
  parmesan: P('dairy', ['salt', 'umami'], { as: 'cheese', foodClass: 'dense_protein_dairy', per100g: { protein: 35, kcal: 400, fiber: 0 } }),
  tofu: P('protein', [], { foodClass: 'dense_protein_dairy', per100g: { protein: 12, kcal: 120, fiber: 1 } }),
  coriander: P('herb', ['fresh'], { foodClass: 'aromatic_herb_acid' }),
  mint: P('herb', ['fresh'], { foodClass: 'aromatic_herb_acid' }),
  'curry leaves': P('herb', ['fresh'], { foodClass: 'aromatic_herb_acid' }),
  'kasuri methi': P('herb', [], { foodClass: 'aromatic_herb_acid' }),
  cumin: P('spice', [], { foodClass: 'aromatic_herb_acid' }),
  jeera: P('spice', [], { foodClass: 'aromatic_herb_acid' }),
  'coriander powder': P('spice', [], { foodClass: 'aromatic_herb_acid' }),
  'pav bhaji masala': P('spice', ['heat', 'salt'], { foodClass: 'aromatic_herb_acid' }),
  'amchur': P('spice', ['acid'], { foodClass: 'aromatic_herb_acid' }),
  'black salt': P('spice', ['salt'], { foodClass: 'aromatic_herb_acid' }),
  potato: P('veg', [], { foodClass: 'hydrated_starch', cookFirst: true, per100g: { protein: 2, kcal: 77, fiber: 2 } }),
  carrot: P('veg', ['sweet', 'crunch'], { foodClass: 'watery_veg_fruit' }),
  cabbage: P('veg', ['crunch'], { foodClass: 'watery_veg_fruit' }),
  mushroom: P('veg', ['umami'], { foodClass: 'watery_veg_fruit', cookFirst: true }),
  suji: P('grain', [], { foodClass: 'protein_powder_flour', cookFirst: true, per100g: { protein: 11, kcal: 360, fiber: 4 } }),
  atta: P('grain', [], { foodClass: 'protein_powder_flour', cookFirst: true, per100g: { protein: 12, kcal: 340, fiber: 11 } }),
  noodles: P('grain', [], { foodClass: 'dry_starch_seed', cookFirst: true }),
  vermicelli: P('grain', [], { foodClass: 'dry_starch_seed', cookFirst: true }),
  cornflakes: P('grain', ['crunch', 'sweet'], { foodClass: 'dry_starch_seed' }),
  muesli: P('grain', ['crunch', 'sweet'], { as: 'oats', foodClass: 'dry_starch_seed' }),
  granola: P('grain', ['crunch', 'sweet'], { foodClass: 'dry_starch_seed' }),
  sourdough: P('bread', [], { as: 'bread', foodClass: 'hydrated_starch' }),
  almonds: P('nuts_seeds', ['fat', 'crunch'], { foodClass: 'pure_or_emulsified_fat', per100g: { protein: 21, kcal: 580, fiber: 12 } }),
  cashews: P('nuts_seeds', ['fat', 'crunch'], { foodClass: 'pure_or_emulsified_fat' }),
  walnuts: P('nuts_seeds', ['fat', 'crunch'], { foodClass: 'pure_or_emulsified_fat' }),
  'chia seeds': P('nuts_seeds', [], { foodClass: 'pure_or_emulsified_fat', per100g: { protein: 17, kcal: 490, fiber: 34 } }),
  'pumpkin seeds': P('nuts_seeds', ['crunch', 'fat'], { foodClass: 'pure_or_emulsified_fat' }),
  'sesame seeds': P('nuts_seeds', ['crunch', 'fat'], { foodClass: 'pure_or_emulsified_fat' }),
  'olive oil': P('fat', ['fat'], { as: 'oil', foodClass: 'pure_or_emulsified_fat' }),
  coffee: P('drink', []),
  tea: P('drink', []),
  apple: P('fruit', ['sweet', 'crunch', 'acid'], { foodClass: 'watery_veg_fruit' }),
  mango: P('fruit', ['sweet'], { foodClass: 'watery_veg_fruit' }),
  'rice cooker': P('appliance', [], { kind: 'appliance' }),
  'otg': P('appliance', [], { kind: 'appliance', as: 'oven' }),
  grater: P('cookware', [], { kind: 'cookware' }),
};

// Fallbacks by a word in the name, longest first. ESTIMATE.
const KEYWORDS = [
  ['vinegar', P('condiment', ['acid'])],
  ['pickle', P('condiment', ['acid', 'salt', 'heat'])],
  ['achaar', P('condiment', ['acid', 'salt', 'heat'])],
  ['chutney', P('condiment', ['acid', 'sweet', 'fresh'])],
  ['chilli', P('condiment', ['heat'])],
  ['chili', P('condiment', ['heat'])],
  ['masala', P('spice', ['heat'])],
  ['powder', P('spice', [])],
  ['sauce', P('condiment', ['salt'])],
  ['dressing', P('condiment', ['acid', 'fat'])],
  ['seeds', P('nuts_seeds', ['crunch'])],
  ['nuts', P('nuts_seeds', ['fat', 'crunch'])],
  ['flour', P('grain', [], { foodClass: 'protein_powder_flour', cookFirst: true })],
  ['noodles', P('grain', [], { foodClass: 'dry_starch_seed', cookFirst: true })],
  ['juice', P('drink', ['sweet', 'acid'])],
  ['biscuit', P('snack', ['sweet', 'crunch'])],
  ['chips', P('snack', ['salt', 'crunch', 'fat'])],
  ['namkeen', P('snack', ['salt', 'crunch', 'fat'])],
  ['bhujia', P('snack', ['salt', 'crunch', 'fat'])],
  ['chocolate', P('sweet', ['sweet', 'fat'])],
  ['syrup', P('sweet', ['sweet'])],
];

// Never in a Harvey's inventory: vegetarian plus eggs only.
const NON_VEG = /\b(chicken|mutton|lamb|goat|beef|pork|bacon|ham|salami|sausage|pepperoni|fish|tuna|salmon|prawn|prawns|shrimp|crab|meat|keema|anchov\w*|gelatin|fish sauce|oyster sauce)\b/;

function clean(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function finish(name, p, source) {
  const as = p.as && (FOODS[p.as] || EQUIPMENT[p.as]) ? p.as : null;
  const kind = p.kind ?? (EQUIPMENT[as]?.kind) ?? (p.category === 'appliance' || p.category === 'cookware' ? p.category : 'food');
  return {
    name,
    id: as ?? extraId(name),
    as,
    kind,
    category: CATEGORIES.includes(p.category) ? p.category : 'other',
    foodClass: FOOD_CLASSES.includes(p.foodClass) ? p.foodClass : null,
    roles: (p.roles ?? []).filter((r) => ROLES.includes(r)),
    cookFirst: p.cookFirst === true,
    diet: DIETS.includes(p.diet) ? p.diet : 'veg',
    per100g: p.per100g ?? null,
    source,
  };
}

/**
 * A profile for any name. `cache` holds flash-lite answers keyed by cleaned name.
 * `category` is the cataloguer's hint, used only when nothing better is known.
 * Returns source 'unknown' (worth asking flash-lite about) when only the hint was used.
 */
export function profileOf(name, { category = null, cache = {}, matchName = null } = {}) {
  const text = clean(name);
  if (!text) return null;
  if (NON_VEG.test(text)) return finish(name, { category: 'protein', diet: 'non_veg' }, 'keyword');
  const id = matchName?.(name);
  if (id) return { ...finish(name, { as: id, category: FOODS[id]?.group ?? EQUIPMENT[id]?.kind }, 'id'), roles: ID_ROLES[id] ?? [] };
  if (cache[text]) return finish(name, cache[text], 'ai');
  if (LOOKUP[text]) return finish(name, LOOKUP[text], 'lookup');
  const padded = ` ${text} `;
  const hit = Object.keys(LOOKUP).sort((a, b) => b.length - a.length).find((k) => padded.includes(` ${k} `));
  if (hit) return finish(name, LOOKUP[hit], 'lookup');
  const kw = KEYWORDS.find(([k]) => padded.includes(` ${k}`));
  if (kw) return finish(name, { ...kw[1], category: CATEGORIES.includes(category) ? category : kw[1].category }, 'keyword');
  return finish(name, { category: category ?? 'other' }, 'unknown');
}

// What the fixed ids bring as seasonings, so a role slot sees them too. ESTIMATE.
export const ID_ROLES = {
  salt: ['salt'], chaat_masala: ['salt', 'acid'], lemon: ['acid'], curd: ['acid', 'fat'], ketchup: ['sweet', 'acid'],
  chilli_flakes: ['heat'], green_chilli: ['heat'], red_chilli_powder: ['heat'], black_pepper: ['heat'], garam_masala: ['heat'],
  butter: ['fat'], ghee: ['fat'], oil: ['fat'], mayo: ['fat'], peanut_butter: ['fat', 'sweet'], honey: ['sweet'],
  cheese_slices: ['salt', 'umami', 'fat'], cheese: ['salt', 'umami', 'fat'], tomato: ['acid', 'umami'],
  cucumber: ['fresh', 'crunch'], spring_onion: ['fresh'], onion: ['crunch'], makhana: ['crunch'], peanuts: ['crunch', 'fat'],
};

// ── flash-lite classification (cached) ───────────────────────────────────────
/** Prompt that classifies names into profiles. One call for a whole batch. */
export function classifyPrompt(names) {
  const ids = Object.keys(FOODS).join(',');
  const kit = Object.keys(EQUIPMENT).join(',');
  return `You classify kitchen items for a vegetarian cooking app. For each name, reply with what the item IS.

Fields:
- "name": the name exactly as given
- "as": the id below it can stand in for when cooking (brown bread → bread, mozzarella → cheese, any lentil → dal), or null. Food ids: ${ids}. Kit ids: ${kit}
- "kind": "food" | "appliance" | "cookware"
- "category": one of ${CATEGORIES.join(', ')}
- "foodClass": one of ${FOOD_CLASSES.join(', ')}, or null for kit
- "roles": what it adds as a seasoning, any of ${ROLES.join(', ')} (soy sauce = salt, umami; vinegar = acid; sriracha = heat, sweet, acid). [] if none
- "cookFirst": true if it is inedible raw
- "diet": "veg" | "egg" | "non_veg" (fish sauce, gelatin, meat stock = non_veg)
- "per100g": {"protein": g, "kcal": n, "fiber": g}, rough

Names: ${JSON.stringify(names)}

Reply with ONLY a JSON object, no prose: {"items":[{...}, ...]}`;
}

/** Parses a classification reply into cache entries keyed by cleaned name. Bad rows are dropped. */
export function parseClassification(text) {
  let obj = null;
  try {
    const s = String(text ?? '');
    obj = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
  } catch {
    return {};
  }
  const out = {};
  for (const r of Array.isArray(obj?.items) ? obj.items : []) {
    if (!r || typeof r.name !== 'string' || !clean(r.name)) continue;
    const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
    out[clean(r.name)] = {
      as: typeof r.as === 'string' ? r.as : null,
      kind: ['food', 'appliance', 'cookware'].includes(r.kind) ? r.kind : undefined,
      category: CATEGORIES.includes(r.category) ? r.category : 'other',
      foodClass: FOOD_CLASSES.includes(r.foodClass) ? r.foodClass : null,
      roles: Array.isArray(r.roles) ? r.roles.filter((x) => ROLES.includes(x)) : [],
      cookFirst: r.cookFirst === true,
      diet: DIETS.includes(r.diet) ? r.diet : 'veg',
      per100g: r.per100g && typeof r.per100g === 'object' ? { protein: n(r.per100g.protein), kcal: n(r.per100g.kcal), fiber: n(r.per100g.fiber) } : null,
    };
  }
  return out;
}

export const cacheKey = clean;
