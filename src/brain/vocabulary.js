// Marco's canonical vocabulary: the ids the brain understands.
//
// The AI is asked to map what it sees onto these ids. Anything it reports that
// has no id is kept for display but cannot unlock a meal. `synonyms` is the
// local fallback used when the AI returns only a free-text name.
//
// Pure data. No DOM, no network. Port target: MarcoCore (Foundation-only Swift).

/** @typedef {'food'|'appliance'|'cookware'|'utensil'} ItemKind */

/**
 * How an ingredient is handled. `peel_chop` is the old catch-all; `peel`
 * (garlic, onion) and `cut` (paneer cubes, tomato) are Friction v2's split.
 */
export const PREP_KINDS = Object.freeze(['ready', 'measure', 'wash', 'crack', 'crumble', 'cut', 'peel', 'peel_chop']);

/**
 * Food items. `group` is only for display. Vegetarian plus eggs only: no meat
 * or fish id exists, so nothing a scan or the AI reports can map to one. Tofu
 * is left out by preference (20 Nov).
 */
export const FOODS = {
  protein_bread: { label: 'Protein bread', group: 'bread', synonyms: ['protein bread', 'high protein bread', 'the health factory', 'protein loaf'] },
  bread: { label: 'Bread', group: 'bread', synonyms: ['bread', 'brown bread', 'white bread', 'multigrain bread', 'sandwich bread', 'whole wheat bread', 'pav', 'bun'] },
  cheese_slices: { label: 'Cheese slices', group: 'dairy', synonyms: ['cheese slice', 'cheese slices', 'amul cheese slices', 'sliced cheese'] },
  cheese: { label: 'Cheese (block or cubes)', group: 'dairy', synonyms: ['cheese', 'cheese block', 'cheese cubes', 'processed cheese', 'mozzarella', 'cheddar', 'cheese spread'] },
  paneer: { label: 'Paneer', group: 'dairy', synonyms: ['paneer', 'cottage cheese', 'malai paneer', 'amul paneer'] },
  eggs: { label: 'Eggs', group: 'protein', synonyms: ['egg', 'eggs', 'anda'] },
  soya_chunks: { label: 'Soya chunks', group: 'protein', synonyms: ['soya chunks', 'soy chunks', 'nutrela', 'soya nuggets'] },
  whey: { label: 'Whey protein', group: 'protein', synonyms: ['whey', 'whey protein', 'protein powder', 'nakpro', 'nakpro whey', 'muscleblaze', 'optimum nutrition'] },
  milk: { label: 'Milk', group: 'dairy', synonyms: ['milk', 'toned milk', 'full cream milk', 'amul taaza', 'doodh'] },
  curd: { label: 'Curd / yogurt', group: 'dairy', synonyms: ['curd', 'dahi', 'yogurt', 'yoghurt', 'greek yogurt', 'hung curd', 'skyr'] },
  butter: { label: 'Butter', group: 'fat', synonyms: ['butter', 'amul butter', 'salted butter'] },
  ghee: { label: 'Ghee', group: 'fat', synonyms: ['ghee', 'desi ghee', 'clarified butter'] },
  oil: { label: 'Cooking oil', group: 'fat', synonyms: ['oil', 'cooking oil', 'olive oil', 'sunflower oil', 'mustard oil', 'rice bran oil', 'groundnut oil', 'vegetable oil'] },
  peanut_butter: { label: 'Peanut butter', group: 'spread', synonyms: ['peanut butter', 'pintola', 'myfitness peanut butter'] },
  mayo: { label: 'Mayonnaise', group: 'spread', synonyms: ['mayo', 'mayonnaise', 'veg mayonnaise', 'eggless mayo'] },
  ketchup: { label: 'Ketchup', group: 'spread', synonyms: ['ketchup', 'tomato ketchup', 'tomato sauce'] },
  honey: { label: 'Honey', group: 'spread', synonyms: ['honey'] },
  makhana: { label: 'Makhana', group: 'snack', synonyms: ['makhana', 'fox nuts', 'lotus seeds', 'phool makhana'] },
  peanuts: { label: 'Peanuts', group: 'snack', synonyms: ['peanuts', 'groundnuts', 'moongphali', 'roasted peanuts'] },
  oats: { label: 'Oats', group: 'grain', synonyms: ['oats', 'rolled oats', 'instant oats', 'quaker oats'] },
  pasta: { label: 'Pasta (fusilli etc.)', group: 'grain', synonyms: ['pasta', 'fusilli', 'spirali', 'penne', 'macaroni', 'spaghetti'] },
  rice: { label: 'Rice', group: 'grain', synonyms: ['rice', 'basmati', 'basmati rice'] },
  poha: { label: 'Poha', group: 'grain', synonyms: ['poha', 'flattened rice', 'beaten rice'] },
  besan: { label: 'Besan', group: 'grain', synonyms: ['besan', 'gram flour', 'chickpea flour'] },
  // One food since 20 Nov (pranjal): the differences between dals are negligible. Chole, rajma, chana stay separate.
  dal: { label: 'Dal', group: 'grain', synonyms: ['dal', 'daal', 'moong dal', 'yellow moong dal', 'split moong', 'masoor dal', 'toor dal', 'arhar dal', 'urad dal', 'chana dal', 'lentils', 'lentil'] },
  chickpeas: { label: 'Chickpeas (boiled or canned)', group: 'protein', synonyms: ['chickpeas', 'chole', 'kabuli chana', 'canned chickpeas', 'boiled chana'] },
  // Staples from pranjal's "The staples and their processes" (21 Nov): soaked overnight, then pressure-cooked.
  rajma: { label: 'Rajma', group: 'protein', synonyms: ['rajma', 'kidney beans', 'red kidney beans'] },
  kala_chana: { label: 'Kala chana', group: 'protein', synonyms: ['kala chana', 'black chana', 'black chickpeas', 'bengal gram'] },
  maggi: { label: 'Maggi noodles', group: 'grain', synonyms: ['maggi', 'maggi noodles', 'maggi masala noodles', 'instant noodles', '2-minute noodles'] },
  sprouts: { label: 'Moong sprouts', group: 'protein', synonyms: ['sprouts', 'moong sprouts', 'sprouted moong'] },
  tortilla: { label: 'Wraps / roti', group: 'bread', synonyms: ['tortilla', 'wrap', 'wraps', 'roti', 'chapati'] },
  tomato: { label: 'Tomato', group: 'veg', synonyms: ['tomato', 'tomatoes', 'tamatar'] },
  onion: { label: 'Onion', group: 'veg', synonyms: ['onion', 'onions', 'pyaz', 'red onion'] },
  spring_onion: { label: 'Spring onion', group: 'veg', synonyms: ['spring onion', 'spring onions', 'green onion', 'scallion', 'hara pyaz'] },
  garlic: { label: 'Garlic', group: 'veg', synonyms: ['garlic', 'lahsun', 'garlic cloves'] },
  ginger: { label: 'Ginger', group: 'veg', synonyms: ['ginger', 'adrak'] },
  green_chilli: { label: 'Green chilli', group: 'veg', synonyms: ['green chilli', 'green chili', 'hari mirch', 'chillies'] },
  capsicum: { label: 'Capsicum', group: 'veg', synonyms: ['capsicum', 'bell pepper', 'shimla mirch'] },
  cucumber: { label: 'Cucumber', group: 'veg', synonyms: ['cucumber', 'kheera'] },
  spinach: { label: 'Spinach', group: 'veg', synonyms: ['spinach', 'palak'] },
  frozen_peas: { label: 'Frozen peas', group: 'veg', synonyms: ['peas', 'frozen peas', 'matar', 'green peas'] },
  sweet_corn: { label: 'Sweet corn', group: 'veg', synonyms: ['sweet corn', 'corn', 'frozen corn'] },
  lemon: { label: 'Lemon', group: 'veg', synonyms: ['lemon', 'lime', 'nimbu'] },
  // Tea and coffee with milk (1.36.0, pranjal 22 Nov): made only when spotted with milk.
  tea: { label: 'Tea leaves', group: 'drink', synonyms: ['tea', 'chai', 'chai patti', 'tea leaves', 'tea powder', 'tata tea', 'red label', 'tea bags', 'black tea', 'assam tea'] },
  green_tea: { label: 'Green tea', group: 'drink', synonyms: ['green tea', 'green tea bags'] },
  coffee: { label: 'Coffee', group: 'drink', synonyms: ['coffee', 'instant coffee', 'coffee powder', 'nescafe', 'bru', 'filter coffee', 'black coffee'] },
  banana: { label: 'Banana', group: 'fruit', synonyms: ['banana', 'bananas', 'kela'] },
  salt: { label: 'Salt', group: 'spice', synonyms: ['salt', 'namak', 'tata salt', 'rock salt'] },
  black_pepper: { label: 'Black pepper', group: 'spice', synonyms: ['black pepper', 'pepper', 'kali mirch'] },
  chilli_flakes: { label: 'Chilli flakes', group: 'spice', synonyms: ['chilli flakes', 'chili flakes', 'red chilli flakes', 'oregano and chilli flakes sachet'] },
  oregano: { label: 'Oregano / mixed herbs', group: 'spice', synonyms: ['oregano', 'mixed herbs', 'italian seasoning'] },
  chaat_masala: { label: 'Chaat masala', group: 'spice', synonyms: ['chaat masala'] },
  turmeric: { label: 'Turmeric', group: 'spice', synonyms: ['turmeric', 'haldi'] },
  red_chilli_powder: { label: 'Red chilli powder', group: 'spice', synonyms: ['red chilli powder', 'chilli powder', 'lal mirch', 'kashmiri chilli'] },
  garam_masala: { label: 'Garam masala', group: 'spice', synonyms: ['garam masala', 'tikka masala', 'kitchen king'] },
  mustard_seeds: { label: 'Mustard seeds', group: 'spice', synonyms: ['mustard seeds', 'rai', 'sarson'] },
};

/** Appliances and cookware. Only these act as hard filters for meals. */
export const EQUIPMENT = {
  air_fryer: { label: 'Air fryer', kind: 'appliance', synonyms: ['air fryer', 'airfryer', 'philips air fryer', 'air-fryer'] },
  microwave: { label: 'Microwave', kind: 'appliance', synonyms: ['microwave', 'microwave oven', 'convection microwave'] },
  induction: { label: 'Induction cooktop', kind: 'appliance', synonyms: ['induction', 'induction cooktop', 'induction stove', 'induction hob'] },
  gas_stove: { label: 'Gas stove', kind: 'appliance', synonyms: ['gas stove', 'gas hob', 'stove', 'burner', 'cooktop', 'chulha', 'gas', 'gas burner', 'lpg stove'] },
  oven: { label: 'Oven / OTG', kind: 'appliance', synonyms: ['oven', 'otg', 'toaster oven'] },
  toaster: { label: 'Pop-up toaster', kind: 'appliance', synonyms: ['toaster', 'pop up toaster', 'bread toaster'] },
  sandwich_maker: { label: 'Sandwich maker', kind: 'appliance', synonyms: ['sandwich maker', 'sandwich toaster', 'grill sandwich maker', 'panini press'] },
  kettle: { label: 'Electric kettle', kind: 'appliance', synonyms: ['kettle', 'electric kettle'] },
  blender: { label: 'Blender / mixer', kind: 'appliance', synonyms: ['blender', 'mixer', 'mixer grinder', 'nutribullet', 'hand blender'] },
  kitchen_scale: { label: 'Kitchen scale', kind: 'appliance', synonyms: ['kitchen scale', 'weighing scale', 'food scale'] },
  pressure_cooker: { label: 'Pressure cooker', kind: 'cookware', synonyms: ['pressure cooker', 'cooker', 'prestige cooker', 'hawkins'] },
  saucepan: { label: 'Saucepan / pot', kind: 'cookware', synonyms: ['saucepan', 'pot', 'steel pot', 'stock pot', 'patila', 'boiling pot'] },
  frying_pan: { label: 'Frying pan', kind: 'cookware', synonyms: ['frying pan', 'pan', 'nonstick pan', 'non-stick pan', 'skillet', 'fry pan'] },
  tawa: { label: 'Tawa', kind: 'cookware', synonyms: ['tawa', 'griddle', 'flat pan', 'dosa tawa'] },
  kadai: { label: 'Kadai / wok', kind: 'cookware', synonyms: ['kadai', 'kadhai', 'wok'] },
};

/** Small utensils every kitchen is assumed to have unless the user says otherwise. */
export const ASSUMED_BASICS = {
  plate: { label: 'Plate', synonyms: ['plate', 'plates', 'thali'] },
  bowl: { label: 'Bowl', synonyms: ['bowl', 'bowls', 'katori'] },
  spoon: { label: 'Spoon', synonyms: ['spoon', 'spoons', 'tablespoon', 'teaspoon'] },
  fork: { label: 'Fork', synonyms: ['fork', 'forks'] },
  mug: { label: 'Mug / glass', synonyms: ['mug', 'cup', 'glass', 'tumbler'] },
  shaker: { label: 'Shaker bottle', synonyms: ['shaker', 'shaker bottle', 'protein shaker'] },
  knife: { label: 'Kitchen knife', synonyms: ['knife', 'kitchen knife', 'chef knife', 'paring knife'] },
  cutting_board: { label: 'Cutting board', synonyms: ['cutting board', 'chopping board', 'chopping block'] },
  spatula: { label: 'Spatula / ladle', synonyms: ['spatula', 'ladle', 'turner', 'karchi', 'tongs'] },
  // 1.39.0: assumed, not a hard filter. It blocked 5 dishes in every tester kitchen, and a lid held ajar drains rice.
  strainer: { label: 'Strainer / colander', synonyms: ['strainer', 'colander', 'sieve', 'channi'] },
};

/**
 * Pantry staples every kitchen is assumed to have (1.36.0, pranjal 22 Nov): a video rarely
 * shows the salt tin or the oil bottle, and missing salt alone hid every egg dish from Harsh.
 * buildInventory adds them unless the user marks them missing.
 */
export const ASSUMED_STAPLES = Object.freeze(['salt', 'oil']);

/** Capabilities: one requirement that several pieces of kit can satisfy. */
export const CAPABILITIES = {
  stovetop: { label: 'a stove (induction or gas)', anyOf: ['induction', 'gas_stove'] },
  pot: { label: 'a pot to boil in', anyOf: ['saucepan', 'pressure_cooker', 'kadai'] },
  pan: { label: 'a pan', anyOf: ['frying_pan', 'tawa', 'kadai'] },
};

const ROLE_LABELS = { salt: 'something salty', umami: 'something savoury', acid: 'something sour', fat: 'a fat', heat: 'something hot', sweet: 'something sweet', fresh: 'a fresh herb', crunch: 'something crunchy' };

export function labelFor(id) {
  if (typeof id === 'string' && id.startsWith('role:')) return ROLE_LABELS[id.slice(5)] ?? id.slice(5);
  if (typeof id === 'string' && id.startsWith('x:')) return id.slice(2).replace(/_/g, ' ');
  return FOODS[id]?.label ?? EQUIPMENT[id]?.label ?? ASSUMED_BASICS[id]?.label ?? CAPABILITIES[id]?.label ?? id;
}

export function kindOf(id) {
  if (FOODS[id]) return 'food';
  if (EQUIPMENT[id]) return EQUIPMENT[id].kind;
  if (ASSUMED_BASICS[id]) return 'utensil';
  return null;
}
