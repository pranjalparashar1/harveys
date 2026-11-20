// Starting data for the pick-two trainer (1.4.0). Pure data.

/**
 * Pierre verdicts pranjal gave in the project chat on 19 Nov 2026, so Pierre
 * doesn't start from nothing. Every one can be changed on the page.
 */
export const PIERRE_SEED = {
  microwave_paneer_bhurji: { verdict: 'meh', why: 'Fine idea, but microwaved paneer sounds sad' },
  mug_omelette: { verdict: 'fail', why: 'Tastes bad and smells up the microwave; a pan is one more step' },
  airfryer_egg_in_toast: { verdict: 'meh', why: 'Slightly messy' },
  soya_chunk_curd_bowl: { verdict: 'fail', why: 'Boiled soya chunks taste horrible' },
  paneer_wrap: { verdict: 'fail', why: 'Microwaved paneer tastes horrible; wraps aren’t a home staple' },
  plain_omelette: { verdict: 'pass', why: 'Easy, and good' },
  egg_bhurji: { verdict: 'pass', why: 'Easy, and good' },
  stovetop_paneer_bhurji: { verdict: 'pass', why: 'Easy, and good' },
  besan_chilla: { verdict: 'pass', why: 'Easy, and good' },
  moong_dal_khichdi: { verdict: 'pass', why: 'Easy, and good' },
  pasta_aglio_olio_paneer: { verdict: 'pass', why: 'Pierre approves' },
};

/** Extra technique facts the catalogue can't express, for Pierre's tags. */
export const TECHNIQUE_OVERLAY = {
  soya_chunk_curd_bowl: { methods: ['boil'] }, // microwaved in water = boiled
  paneer_wrap: { pierreTags: ['wrap'] },
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
