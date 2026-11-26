// Starting data for the pick-two trainer (1.4.0). Pure data.

/**
 * Pierre verdicts pranjal gave in the project chat on 19 Nov 2026, so Pierre
 * doesn't start from nothing. Every one can be changed on the page.
 */
export const PIERRE_SEED = {
// v2 Step 2 (pranjal, 20 Nov): `tier` is veto | floor | pass | crave (Step 3's Pierre).
// `verdict` stays fail | meh | pass for train.js: veto→fail, floor→meh, pass/crave→pass.
  microwave_paneer_bhurji: { verdict: 'meh', tier: 'floor', why: 'Floor: acceptable, not more' },
  mug_omelette: { verdict: 'fail', why: 'Tastes bad and smells up the microwave; a pan is one more step' },
  airfryer_egg_in_toast: { verdict: 'meh', why: 'Slightly messy' },
  soya_chunk_curd_bowl: { verdict: 'fail', why: 'Boiled soya chunks taste horrible' },
  // pranjal: "obviously a pass", but it's assembly of a wrap and paneer cooked some way;
  // hard to judge a dish of 2–3 layers of assembly without knowing its friction.
  paneer_wrap: { verdict: 'pass', tier: 'pass', why: 'Pass, though it’s an assembly of wrap and paneer whose cooking isn’t clear' },
  whey_makhana_bowl: { verdict: 'meh', tier: 'floor', why: 'Floor: barely acceptable' },
  plain_omelette: { verdict: 'pass', why: 'Easy, and good' },
  egg_bhurji: { verdict: 'pass', why: 'Easy, and good' },
  stovetop_paneer_bhurji: { verdict: 'pass', why: 'Easy, and good' },
  besan_chilla: { verdict: 'pass', why: 'Easy, and good' },
  moong_dal_khichdi: { verdict: 'pass', why: 'Easy, and good' },
  // pranjal, 26 Nov: "chai and buttered toast are two individual meals which are both pass, so
  // together they should be a pass too." A ruling on this dish: Pierre judges buttered toast on
  // its own as fat only (floor), so no general rule gets here without passing plain fat on bread.
  chai_toast: { verdict: 'pass', tier: 'pass', why: 'Chai and buttered toast each pass on their own, so together they pass' },
  pasta_aglio_olio_paneer: { verdict: 'pass', why: 'Pierre approves' },
  // Staples (1.20.0). Round 3 (issue #52, 21 Nov) rated the same dishes; the staples sheet says the rest.
  maggi: { verdict: 'pass', tier: 'pass', why: 'Round 3: Maggi cooked with its masala, pass' },
  maggi_cheese: { verdict: 'pass', tier: 'crave', why: 'Round 3: Maggi with a cheese slice melted in, crave' },
  maggi_fried_egg: { verdict: 'pass', tier: 'crave', why: 'Round 3: Maggi with an egg fried in oil (your fix for butter), crave' },
  // pranjal, 21 Nov: "I don't make egg fried rice with spring onion often, but it's a crave with them."
  egg_fried_rice: { verdict: 'pass', tier: 'pass', why: 'Pass without spring onion: how you usually make it' },
  egg_fried_rice_spring_onion: { verdict: 'pass', tier: 'crave', why: 'Round 3 (your fix: oil, no chilli sauce) and 21 Nov: a crave with spring onion' },
  cooker_chole: { verdict: 'pass', tier: 'pass', why: 'Staples sheet: ready to eat as is after pressure cooking with salt' },
  cooker_rajma: { verdict: 'pass', tier: 'pass', why: 'Staples sheet: ready to eat as is after pressure cooking with salt' },
  cooker_kala_chana: { verdict: 'pass', tier: 'pass', why: 'Staples sheet: ready to eat as is after pressure cooking with salt' },
};

/** Extra technique facts the catalogue can't express. */
export const TECHNIQUE_OVERLAY = {
  soya_chunk_curd_bowl: { methods: ['boil'] }, // microwaved in water = boiled
};

/** Dishes that exist only to be judged, not (yet) in Marco's catalogue. */
export const TRAINING_EXTRAS = [
  {
    // pranjal's "additional suggestion" for microwave paneer bhurji (19 Nov).
    id: 'pan_fried_paneer',
    name: 'Pan-fried paneer with salt and pepper',
    kind: 'meal',
    equipment: ['stovetop', 'pan'],
    utensils: ['spatula', 'plate'],
    ingredients: [
      { id: 'paneer', amount: '150 g, in slabs (cut in the pack)', prep: 'ready' },
      { id: 'oil', amount: '1 tsp', prep: 'measure' },
      { id: 'salt', amount: 'a pinch', prep: 'measure' },
      { id: 'black_pepper', amount: 'a pinch', prep: 'measure' },
    ],
    steps: [
      { text: 'Heat oil in a pan and lay in the paneer slabs.', active: 1 },
      { text: 'Fry 2 minutes a side until golden, salt and pepper.', active: 4 },
    ],
    attention: 2,
    cleanup: { dishes: 2, greasy: 1 },
    macros: { protein: 28, kcal: 420, fiber: 0 },
    source: 'estimate',
  },
];

/** Kit the "add your dish" form offers, in the order a kitchen reads. */
export const FORM_TOOLS = [
  ['pan', 'Pan / tawa'],
  ['pot', 'Pot'],
  ['pressure_cooker', 'Pressure cooker'],
  ['air_fryer', 'Air fryer'],
  ['microwave', 'Microwave'],
  ['sandwich_maker', 'Sandwich maker'],
  ['toaster', 'Toaster'],
  ['kettle', 'Kettle'],
  ['blender', 'Blender'],
  ['strainer', 'Strainer'],
  ['knife', 'Knife + board'],
  ['bowl', 'Mixing bowl'],
  ['spatula', 'Spatula'],
];

export const PRE_PREP_OPTIONS = [
  [0, 'None'],
  [15, '15 min'],
  [30, '30 min'],
  [60, '1 hour'],
  [240, 'A few hours'],
  [480, 'Overnight'],
];
