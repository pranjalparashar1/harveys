// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER WEIGHTS. Every number in this file is provisional.
//
// None of these were fitted. They exist so the prototype runs end to end.
// Once the meal log has 15–20 real rows (design doc §5.5), replace this whole
// object with fitted values: normalise, fit w_i to "effort felt", check the
// cooked-vs-skipped hit rate, then set λ per mood bucket.
//
// This is the ONLY place the brain reads tunable numbers from.
// ─────────────────────────────────────────────────────────────────────────────

export const PROVISIONAL = true;

export const DEFAULT_CONFIG = Object.freeze({
  // score = payoff − λ_context × Σ_i w_i · f_i

  // Friction weights w_i. Equal on purpose (design doc §5.5 step 2: "start equal").
  frictionWeights: Object.freeze({
    tools: 1,
    ingredients: 1,
    steps: 1,
    activeMinutes: 1,
    attention: 1,
    cleanup: 1,
  }),

  // Each raw friction value is divided by this and clamped to 0..1, so minutes
  // don't drown out counts. Fixed reference scales stand in for the log-based
  // normalisation until real data exists.
  frictionScale: Object.freeze({
    tools: 6, // pots, pans, boards, knives, appliances used
    ingredients: 10, // prep-weighted ingredient count (see prepWeights)
    steps: 10, // discrete actions
    activeMinutes: 30, // minutes you must stand there (waiting time excluded)
    attention: 3, // 0 walk away … 3 burns if you look away / skill needed
    cleanup: 8, // dishes to wash + greasiness bonus
  }),

  // How much one ingredient "costs", by how much handling it needs.
  prepWeights: Object.freeze({
    ready: 0.5, // tear open and use: bread, cheese slice, whey scoop
    measure: 1, // measure / pour / spoon: oats, oil, spices, curd
    wash: 1, // rinse: sprouts, spinach
    crack: 1, // eggs
    crumble: 1, // crumble by hand: paneer
    peel_chop: 2.5, // peel and/or chop: garlic, onion, paneer cubes (the painful step)
  }),

  // Cleanup: each dish counts 1, plus greasiness (0 none, 1 oily, 2 oily and sticky).
  greasyWeight: 1.5,

  // Payoff: progress to what is still remaining today, capped at the target.
  payoffWeights: Object.freeze({ protein: 3, calories: 1, fiber: 0.75 }),

  // Branded items with a label count fully, generic estimates a little less.
  confidenceFactor: Object.freeze({ label: 1, estimate: 0.9 }),

  // λ_context = mood × time of day × day of week.
  lambda: Object.freeze({
    mood: Object.freeze({ fresh: 0.6, okay: 1.0, tired: 1.6 }),
    lateNight: 1.25, // 21:00–05:00
    weeknight: 1.15, // Mon–Fri
    weekend: 0.85, // Sat–Sun
  }),

  // Meals one missing ingredient away are offered as "buy X to unlock".
  unlockSuggestions: 3,
});
