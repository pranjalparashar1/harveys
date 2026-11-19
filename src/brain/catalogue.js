// Seeded catalogue of lazy, mostly high-protein meals built around the user's
// kitchen (Indian staples, air fryer, induction, microwave).
//
// Marco 1.3.5: only the simplest dishes stay. Marco is named after Marco Pierre
// White, who gave up three Michelin stars for simple food people actually cook
// (Knorr cubes and all). A silly dish with almost no friction (whey and makhana
// in a bowl) is the point, not a joke. The bar, checked by a test:
//   no peeling or chopping · at most 2 tools · at most 5 hands-on minutes.
// Dishes cut in 1.3.5 are in git history; the aglio olio lives on as a test
// benchmark in test/fixtures/aglio-olio.js.
//
// Every number here is an estimate for one serving, to be replaced by logged
// meals and real labels. Friction data is structured so the ranker can count it:
//
//   equipment   hard requirements: an EQUIPMENT id or a CAPABILITY id
//   utensils    small kit (assumed present unless the user marks it missing)
//   ingredients { id | anyOf, amount, prep, optional? }
//               prep ∈ ready | measure | wash | crack | crumble | peel_chop
//               optional ones never filter a meal out; they only count if you have them
//   steps       { text, active (min you must be there), passive (min of waiting) }
//   attention   0 walk away … 3 needs watching / skill
//   cleanup     { dishes, greasy 0–2 }
//   macros      { protein g, kcal, fiber g }, source: 'label' | 'estimate'

export const CATALOGUE = [
  {
    id: 'airfryer_protein_cheese_toast',
    name: 'Air-fryer protein bread cheese toast',
    kind: 'meal',
    equipment: ['air_fryer'],
    utensils: ['plate'],
    ingredients: [
      { id: 'protein_bread', amount: '2 slices', prep: 'ready' },
      { anyOf: ['cheese_slices', 'cheese'], amount: '2 slices (or 40 g grated)', prep: 'ready' },
      { id: 'chilli_flakes', amount: 'a pinch', prep: 'measure', optional: true },
    ],
    steps: [
      { text: 'Lay a cheese slice on each slice of protein bread.', active: 1 },
      { text: 'Air-fry at 180°C for 4–5 minutes until the cheese bubbles.', active: 0.5, passive: 5 },
    ],
    attention: 1,
    cleanup: { dishes: 1, greasy: 0 },
    macros: { protein: 20, kcal: 330, fiber: 6 },
    source: 'label',
  },
  {
    id: 'microwave_paneer_bhurji',
    name: 'Microwave paneer bhurji (no chopping)',
    kind: 'meal',
    equipment: ['microwave'],
    utensils: ['bowl', 'spoon'],
    ingredients: [
      { id: 'paneer', amount: '125 g, crumbled by hand', prep: 'crumble' },
      { anyOf: ['butter', 'ghee'], amount: '1 tsp', prep: 'measure' },
      { id: 'salt', amount: 'a pinch', prep: 'measure' },
      { id: 'turmeric', amount: 'a pinch', prep: 'measure', optional: true },
      { id: 'red_chilli_powder', amount: 'a pinch', prep: 'measure', optional: true },
    ],
    steps: [
      { text: 'Crumble the paneer into a microwave-safe bowl with the butter and spices.', active: 2 },
      { text: 'Microwave 1 minute, stir, then 1 more minute.', active: 1, passive: 2 },
    ],
    attention: 1,
    cleanup: { dishes: 1, greasy: 1 },
    macros: { protein: 24, kcal: 390, fiber: 0 },
    source: 'label',
  },
  {
    id: 'curd_whey_bowl',
    name: 'Curd and whey protein bowl',
    kind: 'meal',
    equipment: [],
    utensils: ['bowl', 'spoon'],
    ingredients: [
      { id: 'curd', amount: '200 g', prep: 'measure' },
      { id: 'whey', amount: '1 scoop', prep: 'ready' },
      { id: 'banana', amount: '1, sliced with the spoon', prep: 'ready', optional: true },
      { id: 'honey', amount: '1 tsp', prep: 'measure', optional: true },
    ],
    steps: [
      { text: 'Stir a scoop of whey into the curd until smooth.', active: 2 },
      { text: 'Top with banana or honey if you have them.', active: 1 },
    ],
    attention: 0,
    cleanup: { dishes: 1, greasy: 0 },
    macros: { protein: 32, kcal: 290, fiber: 1 },
    source: 'label',
  },
  {
    // 1.3.4: the bowl an AI proposed from pranjal's real kitchen on 18 Nov, kept
    // so Marco can pick it without the AI. Whey whisked thick with a little
    // water, then crunchy makhana on top.
    id: 'whey_makhana_bowl',
    name: 'Whey and makhana bowl',
    kind: 'meal',
    equipment: [],
    utensils: ['bowl', 'spoon'],
    ingredients: [
      { id: 'whey', amount: '1 scoop (30 g)', prep: 'ready' },
      { id: 'makhana', amount: '1 cup (25 g)', prep: 'measure' },
      { id: 'milk', amount: '100 ml, instead of water', prep: 'measure', optional: true },
      { id: 'honey', amount: '1 tsp', prep: 'measure', optional: true },
    ],
    steps: [
      { text: 'Whisk a scoop of whey with 4–5 tbsp water (or milk) into a thick pudding.', active: 1.5 },
      { text: 'Tip makhana on top and eat while it is crunchy.', active: 0.5 },
    ],
    attention: 0,
    cleanup: { dishes: 1, greasy: 0 },
    macros: { protein: 27, kcal: 210, fiber: 2 },
    source: 'estimate',
  },
  {
    id: 'whey_milk_shake',
    name: 'Whey shake with milk',
    kind: 'snack',
    equipment: [],
    utensils: ['shaker'],
    ingredients: [
      { id: 'whey', amount: '1 scoop', prep: 'ready' },
      { id: 'milk', amount: '250 ml', prep: 'measure' },
    ],
    steps: [
      { text: 'Pour milk into the shaker, add a scoop of whey.', active: 1 },
      { text: 'Shake for 20 seconds.', active: 0.5 },
    ],
    attention: 0,
    cleanup: { dishes: 1, greasy: 0 },
    macros: { protein: 32, kcal: 280, fiber: 0 },
    source: 'label',
  },
  {
    id: 'pb_protein_toast',
    name: 'Peanut butter protein toast',
    kind: 'snack',
    equipment: [],
    utensils: ['plate', 'knife'],
    ingredients: [
      { id: 'protein_bread', amount: '2 slices', prep: 'ready' },
      { id: 'peanut_butter', amount: '2 tbsp', prep: 'measure' },
      { id: 'banana', amount: '½, sliced', prep: 'ready', optional: true },
    ],
    steps: [
      { text: 'Spread peanut butter on two slices of protein bread.', active: 2 },
      { text: 'Optional: toast first, or top with banana.', active: 0.5 },
    ],
    attention: 0,
    cleanup: { dishes: 1, greasy: 0 },
    macros: { protein: 22, kcal: 400, fiber: 7 },
    source: 'label',
  },
  {
    id: 'microwave_whey_oats',
    name: 'Microwave protein oats',
    kind: 'meal',
    equipment: ['microwave'],
    utensils: ['bowl', 'spoon'],
    ingredients: [
      { id: 'oats', amount: '50 g', prep: 'measure' },
      { id: 'milk', amount: '200 ml', prep: 'measure' },
      { id: 'whey', amount: '1 scoop', prep: 'ready' },
      { id: 'banana', amount: '½', prep: 'ready', optional: true },
    ],
    steps: [
      { text: 'Mix oats and milk in a big bowl.', active: 1 },
      { text: 'Microwave 2 minutes, stir, 30 seconds more.', active: 1, passive: 3 },
      { text: 'Let it cool a minute, then stir in the whey.', active: 1, passive: 1 },
    ],
    attention: 1,
    cleanup: { dishes: 1, greasy: 0 },
    macros: { protein: 36, kcal: 450, fiber: 5 },
    source: 'label',
  },
  {
    id: 'boiled_eggs',
    name: 'Boiled eggs with salt and pepper',
    kind: 'meal',
    equipment: ['stovetop', 'pot'],
    utensils: ['plate'],
    ingredients: [
      { id: 'eggs', amount: '4', prep: 'ready' },
      { id: 'salt', amount: 'a pinch', prep: 'measure' },
      { id: 'black_pepper', amount: 'a pinch', prep: 'measure', optional: true },
    ],
    steps: [
      { text: 'Put the eggs in a pot of water and bring to a boil.', active: 1, passive: 5 },
      { text: 'Simmer 9 minutes.', active: 0, passive: 9 },
      { text: 'Cool in cold water and peel.', active: 4 },
    ],
    attention: 1,
    cleanup: { dishes: 2, greasy: 0 },
    macros: { protein: 25, kcal: 290, fiber: 0 },
    source: 'estimate',
  },
  {
    id: 'mug_omelette',
    name: 'Microwave mug omelette',
    kind: 'meal',
    equipment: ['microwave'],
    utensils: ['mug', 'fork'],
    ingredients: [
      { id: 'eggs', amount: '3', prep: 'crack' },
      { id: 'salt', amount: 'a pinch', prep: 'measure' },
      { anyOf: ['cheese_slices', 'cheese'], amount: '1 slice, torn', prep: 'ready', optional: true },
    ],
    steps: [
      { text: 'Crack the eggs into a greased mug, add salt, whisk with a fork.', active: 2 },
      { text: 'Microwave 1 minute, stir, then 45 seconds more.', active: 1, passive: 2 },
    ],
    attention: 1,
    cleanup: { dishes: 1, greasy: 1 },
    macros: { protein: 19, kcal: 240, fiber: 0 },
    source: 'estimate',
  },
  {
    id: 'airfryer_egg_in_toast',
    name: 'Air-fryer egg-in-a-hole on protein bread',
    kind: 'meal',
    equipment: ['air_fryer'],
    utensils: ['plate', 'spoon'],
    ingredients: [
      { id: 'protein_bread', amount: '2 slices', prep: 'ready' },
      { id: 'eggs', amount: '2', prep: 'crack' },
      { id: 'salt', amount: 'a pinch', prep: 'measure' },
      { id: 'butter', amount: 'a little', prep: 'measure', optional: true },
    ],
    steps: [
      { text: 'Press a well into each slice with the back of a spoon.', active: 1 },
      { text: 'Crack an egg into each well, salt it.', active: 1 },
      { text: 'Air-fry at 180°C for 7–8 minutes.', active: 0.5, passive: 8 },
    ],
    attention: 1,
    cleanup: { dishes: 1, greasy: 1 },
    macros: { protein: 26, kcal: 360, fiber: 6 },
    source: 'estimate',
  },
  {
    id: 'paneer_cheese_sandwich',
    name: 'Paneer cheese grilled sandwich',
    kind: 'meal',
    equipment: ['sandwich_maker'],
    utensils: ['plate', 'bowl', 'spoon'],
    ingredients: [
      { anyOf: ['protein_bread', 'bread'], amount: '2 slices', prep: 'ready' },
      { id: 'paneer', amount: '75 g, crumbled', prep: 'crumble' },
      { anyOf: ['cheese_slices', 'cheese'], amount: '1 slice', prep: 'ready' },
      { id: 'salt', amount: 'a pinch', prep: 'measure' },
      { id: 'chaat_masala', amount: 'a pinch', prep: 'measure', optional: true },
    ],
    steps: [
      { text: 'Crumble paneer with salt and masala.', active: 2 },
      { text: 'Fill the bread with paneer and cheese.', active: 1 },
      { text: 'Grill in the sandwich maker for 4 minutes.', active: 0.5, passive: 4 },
    ],
    attention: 1,
    cleanup: { dishes: 2, greasy: 1 },
    macros: { protein: 30, kcal: 450, fiber: 5 },
    source: 'estimate',
  },
  {
    id: 'airfryer_chicken_breast',
    name: 'Air-fryer chicken breast',
    kind: 'meal',
    equipment: ['air_fryer'],
    utensils: ['plate', 'spatula'],
    ingredients: [
      { id: 'chicken', amount: '1 breast (~170 g)', prep: 'ready' },
      { id: 'oil', amount: '1 tsp', prep: 'measure' },
      { id: 'salt', amount: 'a pinch', prep: 'measure' },
      { anyOf: ['garam_masala', 'red_chilli_powder', 'black_pepper'], amount: '½ tsp', prep: 'measure', optional: true },
    ],
    steps: [
      { text: 'Rub the breast with oil, salt and spice.', active: 2 },
      { text: 'Air-fry at 190°C for 16–18 minutes, flipping halfway.', active: 1, passive: 18 },
      { text: 'Rest 3 minutes before eating.', active: 0, passive: 3 },
    ],
    attention: 2,
    cleanup: { dishes: 2, greasy: 1 },
    macros: { protein: 40, kcal: 290, fiber: 0 },
    source: 'estimate',
  },
  {
    id: 'tuna_mayo_toast',
    name: 'Tuna mayo toast',
    kind: 'meal',
    equipment: [],
    utensils: ['bowl', 'fork', 'plate'],
    ingredients: [
      { id: 'tuna', amount: '1 can, drained', prep: 'ready' },
      { id: 'mayo', amount: '1 tbsp', prep: 'measure' },
      { anyOf: ['protein_bread', 'bread'], amount: '2 slices', prep: 'ready' },
      { id: 'black_pepper', amount: 'a pinch', prep: 'measure', optional: true },
    ],
    steps: [
      { text: 'Mash the tuna with mayo and pepper.', active: 2 },
      { text: 'Pile it on the bread.', active: 1 },
    ],
    attention: 0,
    cleanup: { dishes: 2, greasy: 1 },
    macros: { protein: 32, kcal: 420, fiber: 4 },
    source: 'label',
  },
  {
    id: 'soya_chunk_curd_bowl',
    name: 'Microwave soya chunks in spiced curd',
    kind: 'meal',
    equipment: ['microwave'],
    utensils: ['bowl', 'spoon'],
    ingredients: [
      { id: 'soya_chunks', amount: '50 g', prep: 'measure' },
      { id: 'curd', amount: '100 g', prep: 'measure' },
      { id: 'salt', amount: 'a pinch', prep: 'measure' },
      { anyOf: ['chaat_masala', 'red_chilli_powder', 'garam_masala'], amount: '½ tsp', prep: 'measure', optional: true },
    ],
    steps: [
      { text: 'Cover the soya chunks with water and microwave 4 minutes.', active: 1, passive: 4 },
      { text: 'Drain and squeeze out the water once they cool a little.', active: 3, passive: 2 },
      { text: 'Stir into curd with salt and masala.', active: 1 },
    ],
    attention: 1,
    cleanup: { dishes: 1, greasy: 0 },
    macros: { protein: 30, kcal: 250, fiber: 6 },
    source: 'label',
  },
  {
    id: 'airfryer_makhana',
    name: 'Air-fryer masala makhana',
    kind: 'snack',
    equipment: ['air_fryer'],
    utensils: ['bowl'],
    ingredients: [
      { id: 'makhana', amount: '2 cups', prep: 'measure' },
      { anyOf: ['ghee', 'oil', 'butter'], amount: '1 tsp', prep: 'measure' },
      { anyOf: ['chaat_masala', 'salt'], amount: 'a pinch', prep: 'measure' },
    ],
    steps: [
      { text: 'Toss makhana with ghee and masala.', active: 1 },
      { text: 'Air-fry at 160°C for 5 minutes.', active: 0.5, passive: 5 },
    ],
    attention: 1,
    cleanup: { dishes: 1, greasy: 1 },
    macros: { protein: 6, kcal: 180, fiber: 3 },
    source: 'estimate',
  },
  {
    id: 'paneer_wrap',
    name: 'Microwave paneer wrap',
    kind: 'meal',
    equipment: ['microwave'],
    utensils: ['plate', 'bowl'],
    ingredients: [
      { id: 'tortilla', amount: '1 large or 2 rotis', prep: 'ready' },
      { id: 'paneer', amount: '100 g, crumbled', prep: 'crumble' },
      { anyOf: ['mayo', 'ketchup', 'curd'], amount: '1 tbsp', prep: 'measure' },
      { id: 'chaat_masala', amount: 'a pinch', prep: 'measure', optional: true },
    ],
    steps: [
      { text: 'Crumble paneer into a bowl with salt or masala, microwave 1 minute.', active: 2, passive: 1 },
      { text: 'Spread sauce on the wrap, add paneer, roll.', active: 2 },
    ],
    attention: 0,
    cleanup: { dishes: 2, greasy: 0 },
    macros: { protein: 24, kcal: 420, fiber: 3 },
    source: 'estimate',
  },
];
