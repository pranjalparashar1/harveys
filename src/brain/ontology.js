// Pierre's culinary physics (v2 Step 5), from Fable's SFAH ontology (Salt, Fat, Acid, Heat).
// Pure data and pure functions (no DOM, no network), so it ports to MarcoCore as Codable structs.
//
// What lives here is physics, not preference:
//   foodClass  what a food is made of, and so how heat, salt and acid change it
//   METHODS    what a technique physically does (medium, intensity, steam, browning, hot or cold)
//   phaseOf    the physical state a part is in once cooked (a sautéed tomato is discrete pieces,
//              never a sauce; curd is a sauce as it comes)
//   fat roles  cooking medium, binder or seasoning
//   umami      savoury depth, an ESTIMATE only: reported, never used to judge a dish yet
// pranjal's ratings still give every number Pierre scores with. Nothing here is a rating:
// the classes and umami values are Fable's and Claude's estimates (marked `estimate`), and
// pranjal's own rules win where they differ (cook-first list, raw garlic veto, 4 tiers).

export const ESTIMATE = true; // every class and umami value below is an estimate, not a rating

// ── Layer 1: food classes ───────────────────────────────────────────────────
export const FOOD_CLASSES = [
  'dry_starch_seed', // grains and pulses, dry: rice, pasta, oats, dal. Inedible raw.
  'hydrated_starch', // starch already hydrated: bread, roti, boiled potato
  'watery_veg_fruit', // water + pectin: tomato, onion, mushroom, fruit
  'dense_protein_dairy', // paneer, cheese: browns, doesn't melt (cheese melts)
  'delicate_protein', // eggs: set gently, rubbery when blasted
  'protein_powder_flour', // whey, besan, suji: must be hydrated into a shake or batter
  'pure_or_emulsified_fat', // oil, ghee, butter, cream, curd, milk, nut butter, nuts
  'aromatic_herb_acid', // garlic, chilli, coriander, lemon, spices
];

// Fable's table (§1.1), extended by Claude to every food in the brain. ESTIMATE.
export const FOOD_CLASS = {
  rice: 'dry_starch_seed', pasta: 'dry_starch_seed', noodles: 'dry_starch_seed', oats: 'dry_starch_seed',
  poha: 'dry_starch_seed', chickpeas: 'dry_starch_seed', dal: 'dry_starch_seed', rajma: 'dry_starch_seed',
  kala_chana: 'dry_starch_seed', soya_chunks: 'dry_starch_seed', frozen_peas: 'dry_starch_seed',
  bread: 'hydrated_starch', roti: 'hydrated_starch', potato: 'hydrated_starch',
  tomato: 'watery_veg_fruit', onion: 'watery_veg_fruit', spring_onion: 'watery_veg_fruit', capsicum: 'watery_veg_fruit',
  cucumber: 'watery_veg_fruit', cabbage: 'watery_veg_fruit', carrot: 'watery_veg_fruit', mushroom: 'watery_veg_fruit',
  apple: 'watery_veg_fruit', mango: 'watery_veg_fruit', banana: 'watery_veg_fruit', pomegranate: 'watery_veg_fruit', raisins: 'watery_veg_fruit', sweet_corn: 'watery_veg_fruit',
  paneer: 'dense_protein_dairy', cheese_slices: 'dense_protein_dairy', mozzarella: 'dense_protein_dairy',
  eggs: 'delicate_protein',
  whey: 'protein_powder_flour', besan: 'protein_powder_flour', suji: 'protein_powder_flour',
  oil: 'pure_or_emulsified_fat', ghee: 'pure_or_emulsified_fat', butter: 'pure_or_emulsified_fat', cream: 'pure_or_emulsified_fat',
  curd: 'pure_or_emulsified_fat', hung_curd: 'pure_or_emulsified_fat', milk: 'pure_or_emulsified_fat', peanut_butter: 'pure_or_emulsified_fat',
  almonds: 'pure_or_emulsified_fat', peanuts: 'pure_or_emulsified_fat', walnuts: 'pure_or_emulsified_fat', cashews: 'pure_or_emulsified_fat',
  garlic: 'aromatic_herb_acid', green_chilli: 'aromatic_herb_acid', coriander: 'aromatic_herb_acid', lemon: 'aromatic_herb_acid',
};
export const foodClassOf = (id) => FOOD_CLASS[id] ?? null;

// The fats that can carry a coating or a tadka: a pure fat, not a food that happens to be rich.
export const COATING_FATS = ['oil', 'ghee', 'butter', 'cream'];
// Aromatics that bloom in fat into a tadka (Fable §4.1: onion is the base of a masala).
export const BLOOM_AROMATICS = ['garlic', 'onion', 'spring_onion', 'green_chilli'];
// Grain bases that need a coating to be a dish (§4.2 coated_base): pasta, rice, noodles, oats, poha.
// Bread and roti are not here: a toast or sandwich carries its own grammar.
export const isGrainBase = (id, centre) => foodClassOf(id) === 'dry_starch_seed' && centre >= 5;

// ── Layer 2 and 3: methods and phases ───────────────────────────────────────
export const PHASES = ['raw_inedible', 'raw_edible', 'discrete_cooked', 'paste_mash', 'cohesive_sauce', 'flavored_fat', 'liquid_drink', 'set_batter'];
// taste.heat in pierre-raw.js is pungency (chilli, raw onion), never thermal heat. Thermal heat is
// a method's `medium` and `intensity` below.
const M = (medium, intensity, steam, browns, phase, temp = 'hot') => ({ medium, intensity, steam, browns, phase, temp });
export const METHODS = {
  raw: M('none', 'none', 'none', false, null, 'cold'),
  bloom_tadka: M('fat', 'gentle', 'open', false, 'bloomed'),
  sweat: M('fat', 'gentle', 'trapped', false, 'discrete_cooked'),
  sauteed: M('fat', 'intense', 'open', true, 'discrete_cooked'),
  pan_fried: M('fat', 'intense', 'open', true, 'discrete_cooked'),
  deep_fried: M('fat', 'intense', 'open', true, 'discrete_cooked'),
  fried_egg: M('fat', 'intense', 'open', true, 'discrete_cooked'),
  scrambled: M('fat', 'gentle', 'open', false, 'discrete_cooked'),
  omelette: M('fat', 'gentle', 'open', true, 'set_batter'),
  pancake: M('fat', 'med', 'open', true, 'set_batter'),
  chilla: M('fat', 'med', 'open', true, 'set_batter'),
  boiled: M('water', 'intense', 'open', false, 'discrete_cooked'),
  simmered: M('water', 'gentle', 'open', false, 'cohesive_sauce'),
  reduced: M('water', 'intense', 'open', false, 'cohesive_sauce'),
  pressure_cooked: M('water', 'intense', 'trapped', false, 'discrete_cooked'),
  toasted: M('air', 'intense', 'open', true, 'discrete_cooked'),
  roasted: M('air', 'intense', 'open', true, 'discrete_cooked'),
  air_fried: M('air', 'intense', 'open', true, 'discrete_cooked'),
  melted: M('air', 'gentle', 'open', false, 'discrete_cooked'),
  microwaved: M('dielectric', 'intense', 'trapped', false, 'discrete_cooked'),
  mashed: M('mechanical', 'none', 'none', false, 'paste_mash', 'inherit'),
  shake_water: M('mechanical', 'none', 'none', false, 'liquid_drink', 'cold'),
  shake_milk: M('mechanical', 'none', 'none', false, 'liquid_drink', 'cold'),
};
// A tadka is a sauté in Pierre's rated rows: garlic@bloom_tadka reads garlic@sauteed's numbers.
export const TECHNIQUE_ALIASES = { bloom_tadka: 'sauteed', sweat: 'sauteed', reduced: 'simmered' };
// Methods whose fat touches the food: an aromatic cooked this way has bloomed.
export const inFat = (technique) => METHODS[technique]?.medium === 'fat';

// What a food is as it comes (§1.2), when it isn't raw_edible.
const RAW_PHASE = {
  curd: 'cohesive_sauce', hung_curd: 'cohesive_sauce', cream: 'cohesive_sauce', // a cultured dairy sauce, ready as is
  peanut_butter: 'paste_mash',
  milk: 'liquid_drink',
};

/**
 * The physical phase of a part (§1.2, §3.1). `cookFirst` is pranjal's list (a raw one is inedible).
 * A pulse or grain boiled or pressure-cooked is hydrated (dal cooked is a sauce, Fable §1.2);
 * a watery veg simmered breaks down into a sauce; sautéed it stays in pieces.
 */
export function phaseOf(id, technique, { cookFirst = false } = {}) {
  const cls = foodClassOf(id);
  if (!technique) {
    if (cookFirst || cls === 'dry_starch_seed' || cls === 'delicate_protein') return 'raw_inedible';
    if (cls === 'protein_powder_flour') return 'raw_inedible';
    return RAW_PHASE[id] ?? 'raw_edible';
  }
  const m = METHODS[technique];
  if (id === 'dal' && (technique === 'pressure_cooked' || technique === 'boiled' || technique === 'simmered')) return 'cohesive_sauce';
  if (cls === 'aromatic_herb_acid' && inFat(technique)) return 'bloomed';
  return m?.phase ?? 'discrete_cooked';
}

/** Hot or cold, from the technique (§5 stage 3). A mash takes the temperature it was made at: hot. */
export const tempOf = (technique) => (!technique ? 'cold' : METHODS[technique]?.temp === 'cold' ? 'cold' : 'hot');

// ── Umami (§5 stage 2.3), ESTIMATE ──────────────────────────────────────────
// Savoury depth from concentrated, fermented or browned sources. Claude's estimates on SFAH's
// list, 0–3, not rated by pranjal: Pierre reports it and never judges on it until it's rated.
export const UMAMI = {
  cheese_slices: 2, mozzarella: 1, mushroom: 1, tomato: 1, soya_chunks: 1,
  'mushroom@sauteed': 2, 'mushroom@air_fried': 2, 'tomato@simmered': 2, 'onion@deep_fried': 1, 'cheese_slices@melted': 2,
};
export const UMAMI_BROWNING = 1; // a Maillard-browned part (pan-fried, toasted) brings Low umami
export const TOOMAMI = 4; // four or more umami sources together is a muddy kitchen sink (SFAH p. 190)
export function umamiOf(id, technique) {
  const own = UMAMI[technique ? `${id}@${technique}` : id] ?? (technique ? UMAMI[id] ?? 0 : 0);
  return Math.max(own, technique && METHODS[technique]?.browns ? UMAMI_BROWNING : 0);
}
