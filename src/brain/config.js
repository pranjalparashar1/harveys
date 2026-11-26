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
  // score = payoff − λ_context × friction  (friction: learn.js FEATURES)

  // Friction (v2) scales live in learn.js FEATURES, shared with the pick-two trainer.
  // FITTED (22 Nov 2026): pranjal's Marco prep quiz, rounds 1–3 (prep.html: 91 answers,
  // data/prep-answers-*.txt), refit with `scripts/fit-prep.mjs data/prep-answers-*.txt --no-taste`.
  // Leave-one-out 52/91; the 1.25.0 weights got 47/91. Held out: 15/24.
  // peels and cuts fitted positive (+0.213, +0.286) and are clamped to 0: a cost can't be a bonus.
  // λ by energy from the same fit: fresh 0.7, okay 1, tired 1.75 (not applied: λ per mood stays frozen).
  frictionTheta: Object.freeze({
    tools: -0.682, handsOn: -1.005, waiting: -0.518, prePrep: -0.367, peels: 0,
    cuts: 0, // fitted positive, clamped (see above)
    steps: -0.036, attention: -0.571, cleanup: -0.734,
  }),

  // Payoff: progress to what is still remaining today, capped at the target.
  payoffWeights: Object.freeze({ protein: 3, calories: 1, fiber: 0.75 }),

  // 1.56.0 (pranjal, 26 Nov): inside a rung and tier, dishes within 3 g of protein of the
  // leader (and at most 0.1 more friction) count as a tie, broken savoury before sweet (orderRung).
  tie: Object.freeze({ proteinGrams: 3, friction: 0.1 }),

  // Branded items with a label count fully, generic estimates a little less.
  confidenceFactor: Object.freeze({ label: 1, estimate: 0.9, ai: 0.8 }), // ai = macros guessed by the AI

  // λ_context = mood × time of day × day of week.
  lambda: Object.freeze({
    mood: Object.freeze({ fresh: 0.6, okay: 1.0, tired: 1.6 }),
    lateNight: 1.25, // 21:00–05:00
    weeknight: 1.15, // Mon–Fri
    weekend: 0.85, // Sat–Sun
  }),

  // Sanity gate: what counts as food at all (1.3.4). A real pick on a phone was
  // "100 g butter, microwaved, with salt": 1 g protein, 717 kcal.
  // OFF on purpose (pranjal, 18 Nov): odd lowest-friction ideas show the ranker
  // working and may inspire. Set `enabled: true` to reject them again.
  nutritionGate: Object.freeze({
    enabled: false,
    minProtein: Object.freeze({ meal: 8, snack: 5 }), // grams
    maxKcalPerGramProtein: 45, // poha, the leanest-protein catalogue meal, is 42
    // At least one ingredient must be real food, not only fat, spice or spread.
    condimentGroups: Object.freeze(['fat', 'spice', 'spread']),
  }),

  // Pierre's floor (v2 Step 3). PROVISIONAL: not fitted; Step 4 refits it from the
  // 30-dish blind benchmark. A dish clears it with one flavour beyond the assumed salt
  // and sugar at Medium (2) or above, and one texture at Medium or above.
  // Step 4b: a part's own sugar counts too, but fat and sugar only clear it together or with
  // acid, heat or fresh (you called 8 fat-only dishes bland). The numbers stay where the
  // benchmark refit left them.
  pierreFloor: Object.freeze({
    flavours: Object.freeze(['fat', 'acid', 'heat', 'fresh', 'sugar']),
    notAlone: Object.freeze(['fat', 'sugar']),
    // ...except with a cooked egg (pranjal, 26 Nov: "a plain omelette, eggs + cooking fat + salt,
    // is a pass for sure, never a floor"). A cooked part of these classes carries the dish on salt
    // and fat alone. Eggs only: paneer, cheese and butter on fat alone stay floor (Step 4b).
    fatCarries: Object.freeze(['delicate_protein']),
    // A cooked pair that carries the dish on salt alone, with no strong flavour at all (pranjal,
    // 26 Nov: in khichdi "the main flavor comes from the salt + rice + dal"; ghee on top is an
    // enhancer). Every id must be a cooked part. Dal on its own, with no tadka, stays floor.
    saltCarries: Object.freeze([Object.freeze(['rice', 'dal'])]),
    flavourMin: 2,
    texturesMin: 1,
  }),

  // Pierre's physics rules (v2 Step 5, from Fable's SFAH ontology). PROVISIONAL: the laws
  // (a sautéed tomato is not a sauce, raw pasta is inedible) are permanent; these lists and
  // switches are where they meet pranjal's answers, and each rests on one to seven of them.
  pierreRules: Object.freeze({
    // pranjal, 24 Nov ("add it as an exception"): raw oats blended into a shake are fine for now.
    // Narrow on purpose: only these food+form pairs skip the cook-first veto; oats stay cook-first
    // in every other form (a raw-oat bowl still vetoes).
    cookFirstExceptions: Object.freeze([Object.freeze({ id: 'oats', form: 'shake' })]),
    // Sharp raw veg (raw onion) with no lemon is no clash on a cooked base (toast, rice): the
    // toasted paneer sandwich with raw onion passed (holdout). Raw bread, tomato, onion and
    // paneer (Step 4) and pan-fried paneer with raw onion and tomato (Step 4) didn't.
    sharpTamedByCookedBase: true,
    // 1.60.0 (Fable's handoff, bare-kitchen egg flags): a cooked part of these classes, scrambled or
    // fried in the dish's fat, coats a grain base with that fat (egg rice, eggs stirred into pasta).
    // Eggs only; a fat with no egg still only greases it (butter on pasta stays floor).
    coatingProteins: Object.freeze(['delicate_protein']),
    // One texture throughout floors only a soft texture (all creamy: 4b's three cases). All
    // crisp passed (holdout sandwich). A cold sweet dairy-and-fruit bowl is exempt: creamy is
    // the point of it (hung curd, banana, honey passed).
    mushTextures: Object.freeze(['creamy']),
    // ...unless the taste carries it (pranjal, 21 Nov: mashed chickpeas, butter and curd passes on
    // flavour). The dish must bring each of these at least this strongly.
    mushLift: Object.freeze({ fat: 2, acid: 1, fresh: 2 }),
    // A plate with no anchor passes as a snack pairing when its parts bring at least this many
    // textures from different parts (apple with peanut butter: crisp, juicy, creamy).
    snackContrast: 2,
    // Sweet / savoury clash veto (SFAH stage 1): a sweet part with a savoury aromatic.
    // Chaat masala is not on the savoury side (fruit chaat is a real dish).
    sweetSide: Object.freeze(['banana', 'mango', 'apple', 'raisins', 'honey', 'sugar', 'peanut_butter', 'whey']),
    savourySide: Object.freeze(['onion', 'garlic', 'spring_onion']),
    // Dry heat needs a cooking fat (tap-to-repair, 21 Nov). PROVISIONAL physics prior, not
    // pranjal's rating: a raw starch that must be cooked through (cook-first potato) blasted in
    // dry air with no fat dries out before it crisps. Bread and roti are already cooked, so a dry
    // air-fried toast is fine. Learned rules from pranjal's repairs (pierre-raw.js `rules`) sit on
    // top of this and win; set `on: false` to judge with learned rules only.
    dryHeatNeedsFat: Object.freeze({
      on: true,
      techniques: Object.freeze(['air_fried', 'roasted']),
      classes: Object.freeze(['hydrated_starch']),
      cookFirstOnly: true,
      provisional: true,
    }),
  }),

  // Meals one missing ingredient away are offered as "buy X to unlock".
  unlockSuggestions: 3,
});
