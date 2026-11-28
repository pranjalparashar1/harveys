# Harvey's: full handover for a new Claude

**Written:** 21 Nov 2026, by the Claude that built Harvey's from 18 to 21 Nov, for the Claude that takes over.
**Repo:** `pranjalparashar1/harveys` at `ec0a1cc` (v1.19.0, PR #50 merged). 173 of 173 tests pass (`npm test`).
**Live:** https://pranjalparashar1.github.io/harveys/ (main page), `/train.html`, `/bench.html`, `/pierre.html`, `/tutor.html`.
**Owner:** pranjal (GitHub `pranjalparashar1`). They are the only user, the only rater and the only source of weights.

**Original v2 documents** (added 21 Nov from pranjal's copies) are in [`docs/v2/`](v2/): the [v2 execution plan](v2/v2-execution-plan.pdf), its [review](v2/v2-execution-plan-review.md), Fable's [Pierre ontology (SFAH)](v2/pierre-ontology-sfah.md) and the [Step 5 handoff](v2/step-5-white-v2-handoff.md). Sections 6 to 8 below summarise them; where they differ, pranjal's later rules here win.

> **Updated 26 Nov 2026 (v1.59.0):** start with [§15](#15-update-26-nov-2026-everything-from-1200-to-1590), which covers everything since this file was first written and wins where it differs.

You have the code but none of the old project's memory, chat or files. Everything that only lived there is copied into this file. Where something lives only in the old project and isn't copied, this file says so.

> **The repo is public.** Never commit secrets. pranjal holds their own Gemini API key and pastes it into the page; it lives only in their browser's `localStorage`. Ask them for it if you need a live scan test, and never write it into the repo, logs, PRs or memory.

---

> **1.29.0 (open-ended pantry):** any named ingredient now works. See [`docs/catalogue-prompt.md`](catalogue-prompt.md) for the cataloguing prompt, `src/brain/pantry.js` for profiles and `scripts/import-kitchens.mjs` for importing other people's kitchens.

## 0. Read this first (60-second version)

- **What it is:** "What should I cook right now, from what I already have, that I will actually make?" Photograph your kitchen, an AI lists what's there, and a deterministic brain picks the dish and explains why.
- **Three layers, named after Marco Pierre White:** **Marco** = will I actually make it (friction). **Pierre** = is it worth eating (culinary physics, 4 tiers). **White** = given both, what to show (the effort ladder).
- **State at 1.19.0:** all three layers are live. Pierre vetoes and sorts; White shows a 4-rung effort ladder with one pick per rung; Marco's friction weights are fitted from pranjal's 52-tap sprint (3 of 9 clamped to 0). "Cooked this" and "Fix / Veto" log real dinners to `localStorage`.
- **What's next (agreed with pranjal 21 Nov):** stop building sheets. pranjal uses the app for real dinners, taps "Cooked this", and after 20 to 30 dinners you refit from that log. Offered but not yet accepted: add everyday staples (dal, rice, Maggi, chole, noodles) as catalogue dishes.
- **How pranjal wants you to work:** move fast to a working end-to-end version, not bottom-up perfection. Small PRs. **Never merge without pranjal saying so.** Gemini **flash-lite only**. Vegetarian plus eggs on every path. Weights come from pranjal's real choices, never invented.

---

## 1. Genesis

### 1.1 The split from Cals
Cals is a SwiftUI iPhone calorie tracker pranjal built with a friend (the friend's private repo; the friend owns it and has the Mac). Cals asks "what did I eat?". They split the architecture: the friend keeps Cals, pranjal builds **Marco** (renamed **Harvey's** on 19 Nov, after MPW's restaurant). Marco started from Cals' "photo of food → estimate" capability and points it at the kitchen instead of the plate.

### 1.2 The real ambition (pranjal's words)
The ambitious part is **not** the smart kitchen, it's a recommender that suggests things **people will actually cook**: "It sounds simple, but the simplicity is where ambition is required to build the right algorithm."

The canonical example: fusilli with air-fried paneer is good on paper, but it needs a pot, a board and knife, a strainer, seasonings, then the washing up. **Protein bread with cheese slices in the air fryer gives about 20 g protein with almost no effort.** That is what a tired person makes, so it should win on a weeknight.

### 1.3 The long-term architecture (still the plan)
- **AI perceives, the algorithm decides.** The AI (today Gemini flash-lite in the web prototype; eventually Apple Foundation Models on-device) turns photos into an inventory. It **never picks the meal**.
- **The brain is deterministic, explainable and portable:** pure ES modules today (`src/brain/`: no DOM, no network, no clock, no randomness), written to port later to a Foundation-only Swift package ("MarcoCore"), built and tested on Windows with Swift Testing (no XCTest).
- pranjal has a **Windows 11 PC and an iPhone, no Mac, no paid Apple developer account.** So the web prototype on GitHub Pages **is** the product for now.

### 1.4 Original design (18 Nov, from the Cals handoff)
`score = payoff − λ_context × Σ wᵢ·fᵢ`. Payoff = progress to today's remaining protein, calories, fiber (capped; protein weighted 3×). Friction = tools, ingredients, steps, active minutes, cleanup (later: hands-on vs waiting, peels vs cuts, attention, pre-prep). λ rises late at night, on weeknights, when tired. Learning = pairwise Bradley–Terry from choices ("you cooked A when B was shown"), a regularised prior, not a neural net (one person makes 2–3 meals a day). pranjal's very first friction exercise: their handwritten aglio olio process and the protein-bread-cheese toast, broken into equipment / ingredients / prep / cooking actions / time / attention / cleanup / feasibility. Attention and "sticky cleanup" came out of that.

The original plan was "log 15–20 real meals first, then fit weights". That never happened; the meal log was replaced by trainers, sheets and finally the 50-tap sprint plus the live "Cooked this" log.

---

## 2. The model: Marco, Pierre, White ("The Great White")

pranjal's own brain model (draft PDF, 19 Nov, not in the repo):

| Layer | Question | Today's output |
|---|---|---|
| **Marco** | Repeatability / friction: will I actually make it? Time (prep, active vs passive, pre-prep, cleanup), equipment, major vs minor ingredients (major = cooked or prepped, more friction; minor = seasonings just added). | Friction v2 score from 9 features, fitted θ |
| **Pierre** | Is it worth eating? Culinary physics only, no effort. Originally "Couvert 0–5 spoons", bicameral: right brain = taste (salt, sugar, fat, acid, heat, bonus freshness, canvas), left = texture (crisp, creamy, chewy, juicy; flaky merged into crisp). | 4 tiers: `veto`, `floor` (with the cheapest fix), `pass`, `crave` |
| **White** | Combines both into what to show, plus "bridges" (connector steps such as washing mushrooms vs paneer straight in). | The effort ladder: up to 4 rungs by attention, one pick per rung |

pranjal's quadrants (keep these in mind when judging a pick):
- **Marco-dominant:** banana oats shake (3 stars, about 2.5 spoons) → yes.
- **Pierre-dominant:** pranjal's carbonara (5 spoons, anti-Marco) → yes if there's time and energy.
- **Pierre-dominant, Marco-optimised = "the real charm":** close-enough swaps (cheese slices not a roux, slotted spoon not a strainer, tulsi/coriander not basil).
- **Marco-optimised, Pierre-poor:** whey and water stirred with a spoon. Still allowed.

Recipe format pranjal described: base, augmentations, time, equipment, Marco layer, Pierre layer.

---

## 3. Philosophy (internalise this; it decides close calls)

- Named after **Marco Pierre White**, who rejected fake snobbery (complication for show) for **real snobbery: good food with maximal simplicity** (Knorr cubes). Mirrors MPW plus Taleb (simplicity, antifragility). **Not austerity.** What people actually cook daily wins.
- **Silly-but-good is welcome** (whey makhana bowl, butter + salt surfacing as proof the ranker works). Silly-and-bad is not.
- **Write every recipe in its simplest honest form.** Don't pad a bhurji with onion/tomato chopping it doesn't need.
- pranjal wants **high ambition toward functional and beautiful**; fail fast, iterate on feedback.
- **The 1.3.5 lesson (PR #8, parked, never merge):** a "keep only the simplest dishes" cut went 28 → 16 dishes. pranjal judged it austerity. Diagnosis: the brain counted the stove as a tool on top of the pan, over-wrote bhurji/chilla with chopping, counted cubing tofu like peeling garlic, priced waiting at 0, ignored soaking, and had no taste in payoff. Its revealed principle was "fewest objects and minutes per gram of protein". Don't rebuild that.
- **Pierre verdicts pranjal gave by hand:** fails = mug omelette (tastes bad, smells up the microwave), microwaved eggs, boiled soya chunks, paneer wrap (wraps aren't common in Indian homes). Mild disapproval = air-fryer egg-in-a-hole (messy). **Microwaved paneer does NOT fail** (corrected 20 Nov). Should never be cut: butter omelette, egg bhurji, paneer bhurji, besan chilla, khichdi, aglio olio (passes Pierre). Idea: pan-fried paneer with salt and pepper as a slightly-higher-friction alternative beside the microwave version.
- **Pre-prep** (poha soak 15 min, rice about 1 h, chickpeas overnight) is its own variable. Such dishes are never hidden; they keep their rung and carry "If you have time: …".

---

## 4. pranjal's rules and preferences (verbatim where possible)

### 4.1 Working style
- **"Move fast to an actual working end-to-end version first, not bottom-up perfectionism."** (21 Nov)
- **New thread per stage/feature** in their project tool (they care about token cost of long threads). In your world: keep each piece of work small and self-contained, and brief from docs rather than dragging old context.
- pranjal consults **Fable** (an outside AI on a friend's account) for direction. Fable wrote the v2 RFC, the SFAH ontology, the tap-to-repair spec and the Step 5 handoff (all summarised below). Treat Fable's docs as strong input, but **pranjal's own rules win where they differ.**
- Replies: plain, short, lead with the result or the ask. pranjal skims on a phone.
- UI: Kiron's design system (pranjal's own PWA, `pranjalparashar1/kiron`): always dark, true black, Poppins (self-hosted), colour only for state, 44 px targets, transform/opacity-only motion. **Native iOS controls first** (native `<select>`, `<details>`). **No helper or explanatory text**, no counts or scores on screen, scan results not persisted (reload is clean for demos). Debug stays a faint link at the bottom.

### 4.2 Merge and git policy
- **Never merge a PR until pranjal says so in words** ("merge", "merge and deploy", "go ahead"). Then merge, and watch the Pages deploy through.
- Feature branch per PR, PR against `main`, merged as a merge commit (the old rule from Cals: `--no-ff`). Bump `package.json` version per PR (semver-ish: feature = minor, fix = patch) and put the version in the PR title.
- **Commit only when asked** (in practice: PRs are expected for every change pranjal requests; direct pushes to main are not).
- Stacked PRs: retarget to main once the base merges (PR #10 once merged into a merged branch and missed main). After a merge, check `git log origin/main..branch` before saying a fix is live (a commit pushed after merge never reached main once, 1.3.3).

### 4.3 AI / keys
- **Gemini: flash-lite models only with pranjal's key; ask before using any other model.** `gemini-3.5-flash-lite` is the workhorse; `3.1-flash-lite` often 503s; `2.5-flash-lite` 404s for new keys. Free key hits 429 quota after heavy testing, so keep live tests few.
- The page also accepts Claude/OpenAI keys (provider detected by key prefix, mirroring Cals), but pranjal uses Gemini.
- Target: **recipe on screen within 15 s of tapping Scan.**

### 4.4 Diet and pantry
- **Vegetarian plus eggs only**, on every path: catalogue, scan, pasted list, AI recipes. No chicken, tuna; tofu out by preference (not diet). Enforced in `rank()`, `validateMeal()`, the AI prompt and the vocabulary.
- **Kitchen:** Indian staples. Amul butter, Nakpro whey (chocolate), paneer, makhana, protein bread, fusilli, eggs, dal, rice, oats, poha, chickpeas, soya chunks, curd. Equipment: Philips air fryer, induction cooktop, microwave, kitchen scale, blender; steel pot, nonstick pan, strainer.
- **Round 3 pantry (pranjal, 21 Nov; use from now on):**
  - Remove hung curd.
  - Spices: salt, sugar, chilli flakes, oregano, chaat masala (brings acid AND salt), black pepper. **Other masalas (turmeric, coriander powder, red chilli powder…) are NOT put in dishes**: pranjal adds those as "what would improve the dish".
  - Fresh: lemon, coriander, mint, yogurt (= curd).
  - Condiments: tomato sauce (ketchup), chilli sauce, mayo.
  - Fats: olive oil, ghee, butter. Liquids: milk, fresh cream.
  - Instant/supplements: Maggi (noodle cake; Maggi Masala is its own seasoning; treated as `maggi@boiled`, done, self-coated), whey (chocolate), cocoa powder. Honey stays.
  - Mint, tomato sauce, chilli sauce, mayo have **Claude's estimated** profiles (marked `estimate`) until rated.
  - **Ask pranjal before adding ingredients not on this list.**
- Foods only ever eaten on their own (watermelon, orange) are removed: Harvey's needn't recommend them. Chaas removed (a curd preparation). Sprouts, spinach, cauliflower, sweet potato, lauki, brinjal, broccoli, okra are excluded. Sweet corn and toor dal were marked "remove" in a retest but **not acted on**.

### 4.5 Pierre rules pranjal set (these beat any ontology)
- **4 tiers, no spoons** (kept 20 Nov): veto, floor (upgradeable, show the fix), pass, crave. **Crave only from pranjal's signal** (a crave rating or repeat cooking), never computed.
- **Cook-first list:** every food needs cooking before it's edible **except cabbage, carrot and capsicum** (20 Nov). A cook-first food served raw → veto.
- **Garlic:** raw garlic vetoes a dish where nothing is cooked ("for now"). **Sautéed garlic is distance 0** (done). The garlic numbers are Claude estimates, marked `estimate`.
- **Poha:** centre 5 (it's a base).
- **Bases = centre 5:** rice, pasta, noodles, oats, bread, roti, poha. One 5 per dish; 4s (dal, rajma, soya, chickpeas) may join. Thali (two bases) allowed but rare via Marco friction; a clash is a flag, not a ban.
- **Eggs are prep only** (an egg cracked raw into a bowl isn't food until a technique). Eggs centre 4, whey centre 3.
- **Freshness High** is reserved for coriander, lemon, cucumber; onion is fresh Medium, heat Medium (pungency).
- **Salt and sugar are assumed present** at max; not rated per food. Tutor pairs are rated **unsalted**.
- **Whey stirred into curd = floor, not veto.**
- **Plain butter on pasta = floor** (bland without cheese or aromatics).
- **A sandwich needs no moisture bridge** (raw-onion toasted paneer sandwich passed).
- **Strong flavour lifts a one-texture dish:** mashed chickpeas + butter + curd is all creamy but passes on flavour (fat + acid + fresh).
- **Equivalent cookings count as one** ("cooked"); the method is Marco's choice (oats boiled vs microwaved).
- **Fixes on a sheet** record one change that lifts veto → floor (or floor → pass).
- **Khichdi** is the counterexample to "fat-only is bland".
- Pass rates don't matter yet: **pranjal will define "passable" over rounds 3 and 4.**
- Deferred disagreements (don't block on them): boiled eggs + lemon + chaat masala floored (eggs + pepper passed); sautéed kala chana salad floored (boiled passed); eggs alone floored after dropping hung curd.

### 4.6 Marco / ranking rules
- **Weights from real choices, never invented.** Any hand-set number is marked `PROVISIONAL` in `config.js`.
- **Nutrition gate OFF by default** (`nutritionGate.enabled: false`): pranjal wants odd lowest-friction ideas (100 g butter + salt) to surface. Don't re-enable without asking.
- Mood/energy input removed from the UI (λ neutral). λ per mood is frozen.
- Inside a rung, **payoff beats friction** (sorting by friction first reintroduces austerity).

---

## 5. Architecture and key files

```
photo(s) ──► src/ai (Gemini flash-lite) ──► inventory {have, other}
                                                │
                       targets + context ──► rank()  (src/brain/ranker.js)
                                                │  1. hard filter: kit/ingredients, diet, (nutrition gate off)
                                                │  2. Pierre: judgeMeal → pierreTier → drop veto
                                                │  3. Marco: payoff − λ·friction (fitted θ)
                                                │  4. White: rungOf → buildLadder (tier → payoff → friction → id)
                                                ▼
                           { ladder, ranked, filtered, vetoed, unlocks, lambda }
                                                │
                    index.html / src/app.js renders the ladder, "Cooked this", "Fix / Veto"
```

| File | What it holds |
|---|---|
| `src/brain/index.js` | The single entry point the pages import. |
| `src/brain/ranker.js` | `rank()`, `checkMeal`, `payoff`, `scoreMeal`, `judgeMeal` (Pierre in the ranker), `pierreHint`, `rungOf`, `RUNGS`, `buildLadder`, `byRungOrder`, `assemblyStepOf`, `headlineReasons`. |
| `src/brain/config.js` | **The only place tunable numbers live.** `frictionTheta` (fitted), `payoffWeights`, `lambda`, `nutritionGate`, `pierreFloor`, `pierreRules` (all PROVISIONAL except the fitted θ). |
| `src/brain/learn.js` | `FEATURES` (9 friction features + priors), `rawFeatures`, `featureVector`, Bradley–Terry `fitMarco`, `explainWeights`, `fittedWeightsPayload`, `nextPair` (with `maxRungGap`), `inDiet`, `methodsOf`. |
| `src/brain/ingredients.js` | Pierre's engine: `partVector`, `dishProfile`, `FORMS`, `pierreTier`, coatings, fat roles, cook-first, the 6-slot chain (`toDishChain`/`fromDishChain`, `CHAIN_SLOTS`), learned rules, repair hints, `mergeRatings`, `mergeRepairs`. |
| `src/brain/ontology.js` | Fable's SFAH physics: 8 food classes, phases, methods, temperatures, umami (all marked estimate). |
| `src/brain/pierre-raw.js` | **Generated** brain data (pranjal's ratings, tech rows, prep, excluded, repairs, rules). Never hand-edit; regenerate with `scripts/ingest-pierre.mjs`. |
| `src/brain/technique-prior.js` | **Generated** class prior (`scripts/derive-prior.mjs`); re-run after each ingest. |
| `src/brain/catalogue.js` | 25 catalogue meals with structured friction data, `parts` and `form`. |
| `src/brain/train-data.js` | `PIERRE_SEED` (pranjal's dish verdicts, which beat computed tiers), trainer extras. |
| `src/brain/log.js` | `cookLogEntry`, `liveRepairEntry`, `liveVerdicts`. |
| `src/brain/validate.js` | `validateMeal` for AI recipes (unknown ids, impossible macros, understated friction, diet), `nutritionProblems`. |
| `src/brain/vocabulary.js`, `inventory.js` | Canonical food/equipment ids; matching scan output and pasted lists. |
| `src/ai/providers.js`, `prompt.js`, `images.js` | Key detection, model lists, `callModel` (retry, timeout, same-model re-send every 2.5 s, groups of 4 photos at 640 px), scan and recipe prompts. |
| `src/app.js` + `index.html` | Main page: key, scan, inventory, ladder, Cooked this, Fix / Veto, Debug ("Copy for Claude"). localStorage keys are `marco.*`. |
| `src/train.js` + `train.html` | Pick-two trainer. Since 1.18.1 shows only Pierre round 3 and the 50-tap 7 PM sprint (older cards hidden, not deleted). "Equivalent" and "Neither" choices. "Copy fitted Marco weights". |
| `src/prep.js` + `prep.html`, `src/quiz/prep.js` | Marco prep quiz (1.24.0): 40 questions, one dish two ways at a stated time and energy (30 pairs + 10 repeats at the other energy for λ; every 4th held out). "Send to Harvey's" issue → `node scripts/fit-prep.mjs <answers.txt> [--no-taste]` prints held-out hits, θ, λ by energy and a config block; never edits config. |
| `src/bench.js` + `bench.html`, `src/quiz/bench.js` | Blind Pierre sheets (`?sheet=holdout`, `?sheet=round3`), 6-slot tap-to-repair card, "Send to Harvey's" (prefilled GitHub issue). |
| `pierre.html`/`src/pierre.js`, `tutor.html`, `retest.html`, `src/quiz/*.json` | Earlier rating quizzes (raw foods, food×technique, retest). Done; kept for reference. |
| `scripts/` | Ingest, prior derivation, sheet builders, scorers, `stamp.mjs` (cache-busting). |
| `.github/workflows/pages.yml` | Tests on every PR; on push to main, tests then deploy to Pages (files stamped `?v=<sha>`). |
| `test/*.test.js` | `node:test`, no dependencies. 173 tests. |

### 5.1 The rungs (`rungOf`)
Checked in this order:
1. **Rung 4 Juggle:** 2+ cooking units (closed appliances + open vessels) or attention ≥ 3.
2. **Rung 1 Nothing to watch:** no cooking unit, 0 peels, 0 cuts.
3. **Rung 2 Walk away:** exactly 1 closed appliance (microwave, air fryer, sandwich maker, toaster, kettle, pressure cooker), no open vessel, attention ≤ 1, 0 peels.
4. **Rung 3 Stand at it:** everything else.

Heat is read from the kit (`COOKING_UNITS`), not `methodsOf()` (its regex reads "protein toast" as a toaster). Pre-prep never moves a rung.

### 5.2 Friction features (Friction v2, `learn.js FEATURES`)
tools (the stove isn't a tool on top of its pan), handsOn minutes, waiting minutes, prePrep (log scale), peels, cuts, steps, attention, cleanup. Garlic/onion/ginger count as peels; cubing paneer is a cut.

### 5.3 Pierre resolution order
pranjal's dish verdict (`PIERRE_SEED`, live repairs) → rated `food@technique` row → derived class prior → raw food vector. AI recipes have no `parts`, so they are **not judged** (pass, `untested`).

### 5.4 Sample-kitchen ladder at 1.19.0 (Wed 7 PM, 60 g protein / 1200 kcal / 20 g fiber)
| Rung | Pick (tier) | Alternatives |
|---|---|---|
| 1 Nothing to watch | whey milk shake (pass) | whey makhana bowl (floor) |
| 2 Walk away | air-fryer protein cheese toast (pass) | microwave paneer bhurji (floor), air-fryer makhana (floor) |
| 3 Stand at it | tawa paneer cheese sandwich (floor) | none |
| 4 Juggle | pasta aglio olio with paneer (pass, pranjal's verdict) | none |

Note for your audit: most catalogue dishes sit at floor, and the ladder is thin (rungs 3 and 4 have one dish each in the sample kitchen). This is a big reason staples-as-dishes is the obvious next build.

---

## 6. History: every step and what it taught

### 18 Nov: the web prototype (PRs #1–#7, 1.0 → 1.3.4)
- **#1** static prototype on GitHub Pages: BYO key, photos → AI inventory → brain picks, sample kitchen.
- **#2 (1.1)** multi-photo picking on iPhone fixed; retries and model fallback for Gemini 503; **AI-designed recipes that must pass `validateMeal`** ("the AI proposes, Marco picks").
- **#3 (1.2)** 15-second budget: compact `{have, other}` reply, two models raced, hard deadlines (iOS Safari kills requests at about 60 s), Debug panel with timings and "Copy for Claude".
- **#4 (1.3)** tuned on the live API: Gemini latency is bimodal (1–2.5 s or 7–8 s, set by its queue, not by photos); one request per group of photos, re-send to the same flash-lite model every 2.5 s. 6/6 page runs 1.3–8.9 s.
- **#5 (1.3.2)** Kiron design, quiet demo page, mood input removed.
- **#6 (1.3.3)** Pages caches 10 min, so iPhone mixed new HTML with old JS: deploy now stamps `?v=<sha>`. Also the lesson about commits pushed after merge.
- **#7 (1.3.4)** on pranjal's 6 real kitchen photos the scan found 11–13/19 items; a shelf-by-shelf, read-the-labels prompt gets 16–19/19. Nutrition gate added but OFF. Whey and makhana bowl (an AI idea pranjal loved) became a catalogue meal.
- **#8 (1.3.5) parked, never merge** (austerity, see §3).

### 19 Nov: training Marco and Pierre (PRs #9–#27)
- **#9 (1.4.0)** `train.html` pick-two trainer: Bradley–Terry over protein, Pierre and friction; a tag-logistic Pierre (since deleted).
- **#10–#21 Pierre-trainer** (`pierre.html`): pranjal rated raw foods on texture (crisp, creamy, chewy, juicy, flaky) and taste (salt, sweet, fat, acid, heat, canvas + fresh bonus), centre 1–5 (accent → the meal). Photos removed, Back added, "Rate it / Part of prep" toggles, "Remove from list". Round 1: 34 rated, 33 prep; round 2: 16 rated, 24 removed. Rules from pranjal: rate the plainest cooked form for foods that need cooking; centre = role in a meal; remove-it test (slightly worse = accent, changes = support, stops being the dish = partner+). Repo renamed `marco` → `harveys` (#18).
- **#22–#27 Pierre-tutor** (`tutor.html`): food × technique pairs (52 after cutting gravies, tadkas, shakes, batters: "one food, one technique, a repeatable result"). "How ready?" became **distance to done** (0 eat as is, 1 one finishing step, 2 needs something added, 3 needs another cooking step, x = veto). Pairs rated unsalted.

### 20 Nov: outside audit and the v2 plan
- Claude wrote an audit brief for Fable. Findings: **the live ranker ignored Pierre entirely**; texture was averaged by centre, erasing contrast; every top "couvert" combo contained raw tomato (rated crisp 2, juicy 2, acid 2, fresh 2); salt/heat/flaky near-constant; stale seeds.
- Fable returned the **Great White v2 RFC** (effort ladder, templates, 3-tier Pierre, delete several dimensions). Claude's audit-of-the-audit adopted the ladder, benchmark, choice log and hygiene; adapted templates into "parts in a state inside a form"; rejected the dimension deletions, a hard pre-prep filter, and moving assembly into Marco. Fable's R2 accepted most of that.
- **v2 execution plan (5 steps), each a PR merged after pranjal's OK:**
  1. **Hygiene (#28, 1.9.0):** diet enforced on every path, Friction v2 in the live ranker, chicken/tuna/tofu meals and ids removed, makhana out of Pierre.
  2. **Rating pass (#29, #30, #32):** whey tutor rows, blind test-retest of 12 foods, prep centres (whey 3, eggs 4). All dals merged into one food `dal` (chole, rajma, kala chana stay separate).
  3. **Pierre core (#34, 1.11.0):** `partVector` with state, derived 2-class technique prior, `FORMS` grammar, `pierreTier()`, provisional floor in `config.pierreFloor`.
  4. **30-dish blind benchmark (#35–#37, 1.12.x):** `bench.html`, hidden key, optional "Fix it" step after a veto/floor. pranjal kept 4 tiers.
  - **4b (#39, 1.13.0):** rules fitted to the 30 answers: cook-first → veto, raw-garlic veto, sharp raw veg needs lemon, all-one-texture floors, idle support part, fat/sugar not alone, chaat masala acid Low, unrated part → floor. **In-sample:** 0 dangerous misses, 25/30 exact.
  - **4c holdout (#40, 1.13.1):** 22 new blind dishes. **Failed out of sample:** 8 of 12 veto/floor dishes passed, exact 9/22. Main miss: sautéed tomato treated as a sauce (4 misses). Also too strict on hung curd + banana + honey, raw-onion toasted sandwich, apple + PB.
  5. (White) **not started until 21 Nov.**

### 21 Nov morning: Pierre rebuilt on physics, round 3, tap-to-repair
- **#42 (1.15.x) Pierre on cooking physics**, from Fable's SFAH ontology (§7). Both sheets now **in-sample**: exact 43/52 (was 34), dangerous misses 2 (was 8), fixes 14/17. A third blind sheet was needed.
- **#43 Round 3 sheet** (26 blind dishes from pranjal's new pantry, §4.4) at `bench.html?sheet=round3`. Key held outside the repo (copied in §9).
- **#44 (1.16.0) Tap-to-repair** (Fable's spec): every dish is a 6-slot chain `anchor → seasonedWith → cookedWith → technique → toppedWith → servedWith`. Tap a slot, swap the value, rate "with your fix", choose scope (class or dish). Export line: `repair <id> | before= | edit=slot:from->to | after= | scope= | at=`. `node scripts/ingest-pierre.mjs <export>` writes repairs, dishes and class rules (`foodClass@technique:slot`) into `pierre-raw.js`. Added a **provisional physics prior** `config.pierreRules.dryHeatNeedsFat` (cook-first hydrated starch air-fried/roasted with no fat → floor), which flips `r3_potato_mayo` from pass to floor.
- pranjal asked for a status brief for Fable ("next steps toward a working end-to-end version fast"). Fable replied with the **Step 5 execution handoff** (§8).

### 21 Nov midday: Step 5, everything goes live
- **#45 (1.17.0) 5A:** Pierre in `rank()`: veto dropped (kept in `vetoed` for Debug), sort by tier, floor dishes show "Lift it: + X", Pierre row in the why-table.
- **#46 (1.18.0) 5B:** effort ladder in `rank()` and the UI; "Cooked this" → `localStorage marco.cookLog`; "Fix / Veto" → `marco.liveRepairs` (applies at once as pranjal's verdict); both in Debug's "Copy for Claude". Trainer: 50-tap 7 PM sprint with `maxRungGap = 1`, "Copy fitted Marco weights". Legacy tag-logistic Pierre deleted. Also fixed `chana_chaat` part to `chickpeas@boiled` and Pierre's upgrade guard.
- **#47 (1.18.1)** `/train` shows only round 3 and the sprint. **#48 (1.18.2)** no Pierre rating buttons on sprint cards. **#49 (1.18.3)** "Equivalent" choice next to Neither (pairwise y = 0.5).
- **#50 (1.19.0) 5C fitted weights** (§9.3).

---

## 7. Fable's SFAH ontology (the basis of today's Pierre)

"Pierre: Foundational Culinary Ontology", grounded in Samin Nosrat's *Salt, Fat, Acid, Heat*. **Pierre = culinary physics only; effort is Marco's; weights from pranjal's ratings.** Implemented in `ontology.js` + `ingredients.js`; numbers in it (umami 3 etc.) are estimates, not ratings.

1. **Matter:** 8 food classes: `dry_starch_seed` (rice, pasta, oats, poha, dry legumes, soya: inedible raw), `hydrated_starch` (bread, roti, boiled potato, cooked grains), `watery_veg_fruit` (tomato, onion, capsicum, cucumber, mushroom, fruit), `dense_protein_dairy` (paneer, cheese), `delicate_protein` (eggs), `protein_powder_flour` (whey, besan, suji: never standalone), `pure_or_emulsified_fat` (oil, ghee, butter, cream, curd, milk, PB, nuts), `aromatic_herb_acid` (garlic, chilli, coriander, lemon, spices). Phases: `raw_inedible`, `raw_edible`, `discrete_cooked`, `paste_mash`, `cohesive_sauce`, `flavored_fat`, `liquid_drink`, `set_batter`.
2. **Salt/Fat/Acid/Heat as operators:** fat roles = cooking medium / main binder / seasoning; acid = cooking vs garnishing; aromatics bloom in fat; `taste.heat` = pungency, not temperature.
3. **Transformation matrix** foodClass × method → phase. **Key invariant: `tomato@sauteed` is `discrete_cooked`, never a sauce.** A sauce needs a continuous liquid/emulsified phase (simmered/reduced tomato, curd, cooked dal, starch-fat emulsion).
4. **Composites and forms:** tadka (fat + aromatic → flavoured fat), masala base, 4 sauce families, dressing. Forms declare required phases, e.g. `coated_base` (pasta, rice, noodles, oats, poha) needs a cohesive sauce, curd, or a named fat with a bloomed aromatic; `toast_melt` needs egg/paneer/cheese/spread on it.
5. **Pipeline:** vetoes (inedible phase, rated technique veto, sweet/savoury clash, no anchor, milk boiled with acid) → salt/fat/acid/umami balance (dry starch needs lubrication; rich anchor wants acid/fresh; sweet anchor wants acid/salt/fat) → texture contrast (≥ 2 textures at level ≥ 2 from **different** parts) + hot/cold contrast → tier. Crave only from owner signal. Umami is computed and reported, **never judged on**.

Where pranjal beats the doc: see §4.5 (cook-first list, raw garlic veto, sautéed garlic 0, poha 5, sprouts out, 4 tiers, whey-in-curd floor, no moisture bridge, butter-on-pasta floor). The sweet/savoury clash veto must not catch hung curd + banana + honey (pranjal passed it); chaat masala is not on the savoury side (fruit chaat is real).

---

## 8. Fable's Step 5 handoff: the locked decisions (don't reopen)

1. **Ship Pierre now**; score round 3 in parallel; patch only if round 3 shows veto/floor leaking into pass/crave.
2. **Pierre in White** = hard veto filter + first sort key inside a rung: **tier → payoff → Friction v2 → id.**
3. **No layer penalty** for assembly-heavy dishes; rungs plus steps/tools handle it.
4. **Marco calibration** = a 50-tap sprint on `train.html` at a fixed "7 PM after work, low energy" baseline (mood `okay`), pairs within or adjacent rung only; export θ → `config.js`.
5. **"Cooked this"** logs `{dishId, rung, tier, ladderShown, alternativesShown, context, at}` to `marco.cookLog`; plus 1-tap **Fix / Veto** (`marco.liveRepairs`). Both in Debug "Copy for Claude". **Refit after about 20–30 dinners.**
6. pranjal's rules beat the ontology (already true).
7. **Recipe text is deterministic** from catalogue steps + White's assembly line ("Finish the X with Y"); AI steps only for AI recipes.

**Scope freeze for v1:** no new sheets after round 3, no spoons, no computed crave, no umami gating, no λ per mood, no store-bought shortcuts, no Swift port.

---

## 9. Data that lives outside the repo (copied here)

### 9.1 Benchmark keys and answers
Hidden keys (Pierre's computed tier per dish) were kept out of the repo so sheets stayed blind. pranjal's answers came in as GitHub issues: **#38** (30-dish benchmark), **#41** (22-dish holdout), plus #31 (retest) and #33 (tutor). Those issues are still open and readable. The scorer is `node scripts/score-sheets.mjs <key.json> <answers.txt> [...] --md`; for the first two sheets the full per-dish result table is reproduced by running it, but the key JSON files themselves are not in the repo. If you need to rescore, regenerate the keys: `scripts/benchmark.mjs` and `scripts/holdout.mjs` are deterministic given their seed, or ask the old project for `pierre-benchmark/*.json`.

### 9.2 Round 3 sheet (26 dishes) and its status
**Status: pranjal's round 3 answers had NOT been submitted at handover** (no GitHub issue from `bench.html?sheet=round3`, no paste). They may be partway through; answers save in their browser under `harveys.round3.v1`. When they arrive (as a "Send to Harvey's" issue), score them against Pierre's current tiers. Scoring rule from decision 1: only act if a veto/floor of pranjal's comes out pass/crave.

The 26 dishes (in sheet order):
1. Potato air-fried with no oil, salt and chilli flakes, mayo on the side as a dip (`r3_potato_mayo`, flipped to floor by `dryHeatNeedsFat`)
2. Egg bhurji: onion, tomato and eggs cooked in butter, coriander and chilli flakes
3. Dal and rice with ghee stirred in and a squeeze of lemon
4. Omelette cooked in butter, tomato sauce on the side
5. Chilli soya: soya chunks, onion and capsicum sautéed in olive oil, tossed in chilli sauce and tomato sauce
6. Egg fried rice: rice, spring onion and egg stir-fried in olive oil, chilli sauce tossed through
7. Boiled pasta tossed in warm cream as the sauce, a cheese slice melted in, black pepper
8. Egg mayo sandwich: boiled eggs mashed with mayo, in toasted bread
9. Maggi cooked with its masala
10. Pasta with tomato simmered down in olive oil with garlic and oregano
11. Toasted sandwich: paneer pan-fried in butter, raw onion, mayo and chilli sauce spread inside
12. Eggs scrambled in butter, on toast with salt and pepper
13. Pasta aglio olio: garlic and chilli flakes in olive oil
14. Paneer bhurji: onion, tomato and crumbled paneer cooked in ghee, coriander and black pepper
15. Boiled pasta tossed with tomato sauce (ketchup) and oregano
16. Aloo chaat: boiled potato with raw onion, tomato, coriander, lemon and chaat masala
17. Maggi cooked with its masala, an egg fried in butter on top
18. Cucumber raita with mint and salt
19. Maggi cooked with its masala, a cheese slice melted in
20. Curd with apple, banana and a little sugar
21. Chocolate whey shaken with milk, banana and cocoa
22. Paneer pan-fried in ghee, with cold curd, mint and black pepper
23. Cheese toast with oregano and chilli flakes
24. Garlic bread: garlic sautéed in butter, spread on toasted bread with oregano
25. Creamy mushroom toast: mushrooms and garlic sautéed in butter, finished with cream, on toast
26. Microwaved oats with milk, banana, cocoa and honey

The sheet itself is `src/quiz/round3.json` (built by `scripts/round3.mjs`); Pierre's live tier for each is whatever `pierreTier()` says now, so you can rebuild a key from code.

### 9.3 The 5C sprint export (fitted Marco weights)
52 taps (7 PM after work, low energy; train.html 1.18.3). **Leave-one-out 32/52** vs 19/52 for the old priors (36/52 in-sample).

Raw θ (protein-scaled units in the trainer): protein 1.786, pierre 0.832, tools −0.145, handsOn −0.659, waiting −0.813, prePrep −0.948, peels −0.298, **cuts +0.255, attention +0.659, cleanup +0.212**, steps −0.314.

Shipped as `config.frictionTheta` (rescaled so protein stays 1 per 30 g): tools −0.081, handsOn −0.369, waiting −0.455, prePrep −0.531, peels −0.167, steps −0.176, **cuts 0, attention 0, cleanup 0**.

**Why three are zero:** cuts, attention and cleanup fitted **positive** (more effort scoring as better). 52 taps can't separate them from the dishes pranjal likes (pan-fried paneer and egg bhurji are attention 2). A cost can't be a bonus, so they're clamped to 0 (costs 3 of 37 clear picks on that sheet) until the Cooked-this log refits them. Priors stay in `FEATURES` for the trainer. In grams of protein pranjal would trade: pre-prep (soaking) about 16 g per unit, a peel about 5 g, a hands-on minute about 1.1 g, a waiting minute about 0.9 g, a tool about 0.6 g. The 52 choices are in the old project only.

---

### 9.4 Marco prep quiz (21 Nov, rounds 1 and 2)
- **Round 1** (issue #59, `data/prep-answers-2026-11-21.txt`) set today's `config.frictionTheta` (1.25.0): 20/26 clear picks vs 14/26 for the 5C weights, held-out 7/10.
- **Round 2** (issue #62, `data/prep-answers-round2-2026-11-21.txt`): the friction features don't explain it. The current weights get 21/39 clear picks, and a refit on both rounds also gets 21/39, with held-out 10/20 (chance). So config was **not** changed.
- **Why:** of the 18 misses, almost all are pranjal choosing the more careful technique when it makes the food better, even at "wiped out": rinse rice, marinate paneer, tadka in ghee, garlic peeled fresh, batter whisked smooth, a separate pan for cream sauce, knife over blender for onion, oats weighed, a bowl rather than eating from the pot. The quiz holds taste equal inside a pair, so these read as "more effort preferred".
- **Lesson:** a technique that changes the result is a Pierre (quality) question, not just a Marco (effort) one. Future prep pairs should keep the result truly identical, or carry a quality rating for each side.
- **1.27.0:** those taste picks are now Pierre's, in `src/brain/technique-prefs.js` (`TECHNIQUE_PREFS`, hand-written, with quiz ids as evidence). Recipes use the preferred way; `--no-taste` in `fit-prep.mjs` also drops those ids. pranjal: the cream pasta pick was partly wording; what they want is the sauce cooked in the pot (oil, garlic, salt, cream, cheese) and the pasta added back. Oats weighed (p34) is about macros, so it isn't listed.
- **Round 3** (`prep.html?round=3`, p61–p90 + r21–r30): only pairs where the food tastes the same (same pot vs second pan, strainer vs lid, eggs in the pasta water, foil in the basket…). Every option is written as the actual steps in order. Fit with `node scripts/fit-prep.mjs data/*.txt <round3.txt> --no-taste`.
- **Round 3 answers** (issue #65, `data/prep-answers-round3-2026-11-21.txt`): refit on round 1 + round 2 without taste picks + round 3 (`--no-taste`, 91 answers, 77 clear a/b). On the 21 held-out clear picks: current weights 15/21, refit 14/21. On all 77: current 55, refit 54. So the refit is no better and config was **not** changed. The refit leans harder on hands-on minutes (−0.57 → −1.0) and tools (−0.42 → −0.68), and softer on waiting (−0.73 → −0.52). Peels and cuts still fit positive. About 75% of clear picks are explained either way: friction from the quiz has hit its ceiling, so the next signal is the Cooked-this log.
- **Round 4** (1.28.0, `prep.html?round=4`, p91–p116 + r31–r40, 36 questions): pranjal asked for one more round with new dishes and items. Every pair trades one effort for another (waiting vs attention, hands-on vs washing up, soaking vs cooking time, cuts vs cleanup, batch vs nightly), and most are tuned so the current weights are near undecided (|Δu| < 0.3), for the most information per tap. Ids now have 2 or 3 digits.

## 10. Backlog (agreed or raised, not built)

1. **Staples as catalogue dishes** (offered 21 Nov, waiting on pranjal): dal (pressure cooker), rice, Maggi, chole, noodles, kala chana etc. Ask pranjal which they actually cook and the usual method for each. Helps both the trainer and real dinners; the ladder is thin without them.
2. **Refit from Cooked this** after 20–30 logged dinners: Bradley–Terry on chosen vs `ladderShown` + `alternativesShown`, refit θ (especially cuts/attention/cleanup), the provisional Pierre floors and `dryHeatNeedsFat`. The script exists (1.22.0): `node scripts/refit-cooklog.mjs <paste.json>` prints fitted vs current θ and a config block; it never edits config. Ingest `liveRepairs` via `scripts/ingest-pierre.mjs`.
3. **Round 3 scoring** when answers arrive (§9.2). Then pranjal defines "passable" over rounds 3–4.
4. **Store-bought / ready-made shortcuts:** an owned ready-made item (aglio olio paste, roasted chana, murmura, khakhra, corn flakes, cheese spread, peanut butter) should count as a pre-done technique (`food@technique`) and remove those steps' friction. Aglio olio from scratch is Marco-poor; with a paste it's Marco-compatible (MPW's Knorr-cube point). Roasted chana is on `excluded`; un-exclude when this is built. Frozen for v1.
5. **Swift port (MarcoCore)**, Foundation-only, Swift Testing, Windows-buildable. Frozen for v1. Keep the brain pure JS with plain-data tables (no closures in data) so it ports.
6. Smaller: pre-prep "start soaking for tomorrow" phrasing; chained techniques in the tutor; prep-only foods with no centre (gobi); the egg+lemon+chaat and sautéed kala chana disagreements; cacio-e-pepe style cheese emulsion isn't modelled; cream sauce dishes (round 3) will test `coated_base`; skips ("shown, not cooked") are implicitly in `ladderShown` but not logged when nothing is cooked.
7. Later ambitions: close the loop (log the plate, deduct inventory), on-device Foundation Models, many-user shared priors.

---

## 11. How-to

```bash
npm test                              # Node 22+, no dependencies (173 tests)
python3 -m http.server 8000           # then open http://localhost:8000
node scripts/ingest-pierre.mjs <export.txt>      # Pierre-trainer/tutor/bench/repair exports → src/brain/pierre-raw.js
node scripts/derive-prior.mjs                    # re-run after every ingest (rewrites technique-prior.js)
node scripts/score-sheets.mjs <key> <answers> [<key> <answers>…] --md
node scripts/pierre-tiers.mjs > tiers.md         # every catalogue meal's tier
node scripts/refit-cooklog.mjs                          # refit Marco θ from data/cook-logs/ (1.64.0; prints only; want 20+ dinners; --device <id>, or pass paste files)
node scripts/fit-prep.mjs <answers.txt> [--no-taste]     # fit Marco θ from the prep quiz (prints only)
```

- **Ingest path:** pranjal taps "Send to Harvey's" on a quiz/bench page → a prefilled GitHub issue (and the text is copied). Read the issue with `gh api repos/pranjalparashar1/harveys/issues/<n>`, save the body to a file, run the ingest, commit in a PR.
- **Debug path:** on the main page, Debug → "Copy for Claude" copies timings, errors, `cookLog`, `liveRepairs` (never the key). pranjal pastes it to you.
- **Trainer weights:** `/train.html` → "Copy fitted Marco weights" gives `{taps, looHits, theta, explained, choices}`.
- **Deploy:** merging to main runs `.github/workflows/pages.yml` (tests → stamp → deploy). Pages then caches for up to 10 minutes; tell pranjal to wait and reload.
- **Ladder trace for a PR description:** build an inventory with `buildInventory(DEMO_KITCHEN)` (`src/demo-kitchen.js`) and call `rank({ inventory, targets: {protein: 60, calories: 1200, fiber: 20}, context: {kind: 'any', hour: 19, weekday: 3}, catalogue: CATALOGUE })`; print `ladder`.

---

## 12. Gotchas

- **Pages deploy glitch:** a deploy can fail on GitHub's side with "Fetching artifact metadata failed". **Don't re-run the failed job** (it duplicates the artifact and fails again). Start a fresh run from main (`workflow_dispatch`, or `gh api -X POST repos/pranjalparashar1/harveys/actions/workflows/pages.yml/dispatches -f ref=main`).
- **The `marco` name:** the repo was renamed `marco` → `harveys` on 19 Nov. Git URLs for `marco` redirect for reads, but **writes and API calls via the old name return 403**. Always use `pranjalparashar1/harveys`. The old Pages URL `/marco/` is dead. `package.json` still says `"name": "marco"` and README's title is "Marco"; localStorage keys are `marco.*` (don't rename them: it would wipe pranjal's cookLog).
- **Pages caching:** 10 min; files are stamped `?v=<sha>` so a phone never mixes builds. A test checks every element `app.js` looks up exists in `index.html`.
- **Generated files:** never hand-edit `pierre-raw.js` or `technique-prior.js`.
- **In-sample trap:** both early sheets (52 dishes) shaped the rules. Don't quote 43/52 as accuracy. Round 3 is the first real out-of-sample test.
- **AI recipes aren't judged by Pierre** (no parts → pass, "untested").
- **`methodsOf()`** uses a regex over step text and misreads things ("protein toast" → toaster). Read heat from equipment.
- **Pierre floors most catalogue dishes** before pranjal's verdicts; `PIERRE_SEED` verdicts and live repairs override. Check `pierre.source` (`verdict` / `computed` / `untested`) when a tier looks wrong.
- **Bench and train data live in pranjal's browser** (`harveys.bench.v1`, `harveys.holdout.v1`, `harveys.round3.v1`, `marco.*`). Clearing site data loses unsent answers.
- **Free Gemini key quota:** heavy testing hits 429. Test with "Try a sample kitchen" or a pasted list first.
- **Windows:** pranjal can't build iOS. Anything needing a Mac goes through the friend.

---

## 13. Open items at handover

- PR **#8** open, parked (austerity cut). Leave it; close only if pranjal asks.
- Issues **#31, #33, #38, #41** open: they're answer exports already ingested/scored. Safe to leave.
- Round 3 answers: not yet received.
- Staples-as-dishes offer: waiting on pranjal's list.
- This handover PR (docs/HANDOVER.md): waiting on pranjal's OK to merge.

---

## 14. Recommended next step

1. **Ask pranjal two things** in one message: (a) are the round 3 answers done (if so, "Send to Harvey's"), and (b) which staples they actually cook and how (dal in the pressure cooker, Maggi on the stove, rice in…?).
2. **Build staples as catalogue dishes** in one small PR (with `parts`, `form`, honest simplest friction, pre-prep notes), show a before/after ladder trace for the sample kitchen and pranjal's real kitchen, and ask to merge. This fills thin rungs 3–4 and gives Cooked-this something real to log.
3. **Score round 3** the moment it lands; patch only a dangerous-miss pattern (pranjal's veto/floor → Pierre pass/crave), as a rule in `config.pierreRules` marked PROVISIONAL.
4. **Write the cookLog refit script** now (it's cheap) so that when pranjal has 20–30 dinners, the refit is one command. Until then, don't touch weights.

Keep everything else frozen (§8) until those dinners exist.

---

## 15. Update, 26 Nov 2026: everything from 1.20.0 to 1.59.0

**Written:** 26 Nov 2026, for an outside reviewer (Fable) who will suggest next steps. This section stands on its own; sections 0 to 14 describe Harvey's at 1.19.0 and are kept as history. Where they disagree, this section wins.
**Repo:** `pranjalparashar1/harveys`, `main` at `38f53ee` (**v1.59.0**, PR #109 merged 26 Nov). `npm test`: 307 of 307 pass. A longer log of 21 to 24 Nov (PRs #53 to #100) is in [`projectstatus.md`](../projectstatus.md) at the repo root.
**Live:** https://pranjalparashar1.github.io/harveys/ is now the **tester page**. Owner pages (`owner.html`, `share.html`, `train.html`, `prep.html`, `test.html`) sit behind a soft password gate.

### 15.1 What changed in direction since 21 Nov

- **The focus moved from pranjal's own kitchen to other people's kitchens.** On 21 Nov the plan was "pranjal cooks real dinners and taps Cooked this". Instead, from 22 Nov the project became a **tester loop**: other people rate the dishes Harvey's says their kitchen can make, for effort and for taste.
- **Product direction (pranjal):** suggest the **easiest dishes first, after balancing for macros**. **No energy modifiers and no energy picker**: pranjal's Marco taps were made tired and are everyone's baseline. Card or carousel picking for real users is far off.
- **Diet:** vegetarian plus eggs on every path. Non-veg (one tester asked for chicken) is deferred; pranjal decides later.
- **Real testers first, then persona kitchens.** Three real testers (Harsh, Banana Singh, Purujeet) on 22 to 24 Nov, from kitchen videos. From 24 Nov, five synthetic **persona kitchens L1 to L5** that testers pick from ("Which of these sounds most like you?").

### 15.2 What shipped, by version

**21 Nov, finishing pranjal's own brain (1.20 to 1.29)**
- **1.20.0 (#53):** Pierre round 3 ingested (14/26 exact out of sample; six misses, six different causes, so no new rule). 11 everyday staples added in their simplest honest form (dal tadka with rice, cooker chole/rajma/kala chana, paneer pulao, egg fried rice, Maggi three ways, air-fried soya, masala oats).
- **1.21.0 (#55):** an unsoaked soak dish moves to a "For tomorrow" card.
- **1.22.0 (#56):** `scripts/refit-cooklog.mjs` refits Marco from the Cooked this log (prints only).
- **1.23.0 (#57):** AI recipes obey pranjal's cooking rules: never microwave eggs, dal or legumes; tadka in oil or ghee, never butter.
- **1.24 to 1.28 (#58 to #66): Marco prep quiz** (`prep.html`), one dish two ways. Round 1 set today's weights shape; round 2 showed pranjal picks the more careful technique when it makes food better, so those picks moved to Pierre (`src/brain/technique-prefs.js`); round 3 refit was no better. Round 4 answers never came back. Energy multipliers were dropped (pranjal).
- **1.29.0 (#68): open-ended pantry.** Any named ingredient gets a profile (`src/brain/pantry.js`); role slots (`role:heat`, `role:acid`) let sriracha or vinegar fill a slot. Kitchen importer and the cataloguing prompt for kitchen videos (`docs/catalogue-prompt.md`).

**22 to 24 Nov, the tester loop (1.30 to 1.51)**
- **Kitchen test mode, share links and a relay.** A tester films their kitchen; pranjal runs it through a video agent with the catalogue prompt; the JSON goes into `share.html`, which makes a named link (`#n=<name>&k=<kitchen>`, kitchen compressed in the fragment, nothing stored server-side). **Send** posts the result to a Cloudflare Worker (`relay/worker.js`) that commits it create-only to `data/kitchen-tests/taste-<date>-<kitchen>-<tester>.json`. Format `harveys-rung-quiz/1`, changed only additively, so the relay has never been redeployed.
- **Brain fixes found by testing:** White's within-rung order now really uses Marco's score (before #71 the weights had no effect on rung picks); `config.frictionTheta` = the prep-quiz rounds 1 to 3 refit (adopted 22 Nov). Salt, oil and a strainer are always assumed. Real kitchens turned out to be ingredient-limited, not kit-limited, so pot, kettle, tawa, microwave and no-cook dishes were added (19 bare-kitchen dishes, chai meals, 5 one-pot protein dishes).
- **The tester flow settled** (after card, swipe and list versions; pranjal ruled out dating-app swipes): Hello, confirm your foods, confirm your cookware (everything pre-ticked, untick what's wrong, "Add more" to add), then **one dish per screen** with effort stars and taste stars (5 = effortless / delicious), "I can't make this" with reasons, a bonus dish one item away, and Send. Dishes come in a shuffled order so position says nothing about effort.
- **1.51.0 (#100):** egg dishes cost 2 extra hands-on minutes (testers rated egg dishes harder than Harvey's did; effort agreement 41/55 → 45/55).

**24 to 26 Nov, persona kitchens and templates (1.52 to 1.59)**
- **1.52.0 (#102):** sample-kitchen picker on the bare site and presets in `share.html`; **9 no-pan, no-onion dishes** (dahi poha, butter-cheese sandwich, PB-banana sandwich, kettle banana-peanut oats, banana shake, one-pot cheese pasta, Maggi with boiled eggs, air-fried masala paneer, air-fried potato wedges); a fair `priorHits` (today's weights get their own fitted threshold; was pinned at 0, which understated them, 35 → 58 of 76 picks); `kitchen-tests.mjs score` prints "Batch checks" for eggs, air fryer and easy vs tasty.
- **1.53.0 (#103):** `banana_oats_shake`. Raw oats in a shake are a **cook-first exception** (`config.pierreRules.cookFirstExceptions`, food + form pairs); raw oats still veto in a bowl or a pot.
- **1.54.0 (#104): persona kitchens L1 to L5 and open-slot templates** (see 15.3).
- **1.55.0 (#105):** each level rates its own dishes; frozen and ready-to-eat foods set aside (see 15.3 and 15.4).
- **1.56.0 (#106):** tofu dropped; soya never swapped; close macros count as a tie, savoury before sweet (see 15.3).
- **1.57.0 (#107): rate every recipe** (see 15.3).
- **1.58.0 (#108):** type-to-search on "Add more" (see 15.3).
- **1.59.0 (#109):** "How do you cook?" screen; soya boils on its own; plain omelette, khichdi and chai with buttered toast pass (see 15.3 and 15.4).

### 15.3 Current architecture (1.59.0)

**Pierre (is it worth eating).** Culinary physics on Fable's SFAH ontology (§7), with pranjal's rules on top. Tiers: veto, floor, pass, crave. Crave comes only from pranjal's own verdicts (`PIERRE_SEED`); Pierre never computes crave. Pierre is a hard veto filter and the first sort key inside a rung.
- **Flavour floor** (`config.pierreFloor`, provisional): a dish needs enough flavour (`flavourMin: 2`) and at least one texture. Fat alone does not clear it: a dish whose only strong flavour is fat (from butter, cheese, paneer, ghee) floors unless acid, chilli heat or something fresh comes with it. This came from pranjal's 20 Nov ratings, where paneer, cheese and butter on fat alone tasted bland. Two class-level exceptions, both 26 Nov:
  - `fatCarries: ['delicate_protein']`: when a cooked egg is in the dish, fat at Medium clears the floor alone (plain omelette rule).
  - `saltCarries: [['rice', 'dal']]`: cooked rice and dal together carry a dish on salt alone (khichdi rule).
- **Cook-first** foods eaten raw veto, except the pairs in `cookFirstExceptions` (only oats in a shake).
- **Technique preferences** from the prep quiz (`technique-prefs.js`): rinse rice, ghee tadka, fresh garlic and so on are Pierre's, and recipes use the preferred way.
- **Rulings on specific dishes** live in `PIERRE_SEED` (e.g. `chai_toast` → pass).

**Marco (will I make it).** Friction features (tools, hands-on minutes, waiting, pre-prep, peels, cuts, steps, attention, cleanup) weighted by `config.frictionTheta`: tools −0.682, handsOn −1.005, waiting −0.518, prePrep −0.367, peels 0, cuts 0, steps −0.036, attention −0.571, cleanup −0.734 (positive fits are clamped to 0). Eggs add 2 hands-on minutes. Score = payoff − λ × friction, where payoff is macros only (protein ×3, calories ×1, fiber ×0.75) capped at what's left today.

**White (what to show): the ladder.** Four rungs by effort (rung 1 no-cook, 0 peels, 0 cuts; rung 2 heat from exactly one closed appliance, little attention; rung 4 two or more cooking units or attention ≥3; rung 3 the rest). Inside a rung: Pierre tier, then Marco score, then friction.
- **Tie rule (1.56.0, pranjal chose "close macros count as a tie"):** `orderRung()` in `ranker.js` walks Marco's order; the leader plus every same-tier dish within **3 g protein and 0.1 friction** of it form a band (`config.tie`). Inside a band, **savoury before sweet** (`isSweet()`: fruit, honey, whey, jam, sugar, cocoa…). Why: at rung 1 every dish had identical friction and tier, so 1 g of estimated protein put the curd-banana-peanut bowl first, and testers rated it about 2★. The butter-cheese sandwich now leads rung 1 for L2 to L5.

**Catalogue as open-slot templates (1.54.0, `src/brain/templates.js`).** pranjal: no static recipes for testers. The 77 catalogue dishes are templates whose slots open to the kitchen:
- A **swap** fills a slot with a kitchen item from the same group cooked the same way (cubes: paneer, mushroom, potato; banana → apple, mango; peanuts → almonds; tomato → cucumber, capsicum, carrot). An **add-on** puts one extra vegetable into a bhurji, omelette, chaat or fried rice.
- A swap is allowed only if Pierre has rated that food in that state, and every variant goes through Pierre's vetoes and tiers. Knife-free templates stay knife-free; eggs, dal and legumes are never microwaved; fats are never swapped.
- `NEVER_SWAP` (soya chunks): soya is never swapped in or out. `BOIL_ALONE` (soya chunks): soya never shares boiling water; `test/soya-boil.test.js` checks every written and opened dish.

**Persona kitchens (1.54.0, `data/test-kitchens/kitchens.json`).** Five cumulative kitchens, each with `persona` (the picker line) and `level`:

| Level | Persona line | Items | Cookware summary |
|---|---|---|---|
| L1 | "I order in. Maggi, an omelette, and that's about it." | 20 | kettle, single induction, small nonstick pan |
| L2 | "I mostly order in, but I make chai and try cooking now and then." | 42 | + 2-burner gas, saucepan, kadhai, microwave |
| L3 | "I can cook the basics, and I'm starting to watch my protein." | 74 | + blender, pressure cooker, sandwich maker, egg boiler, knife and board |
| L4 | "I cook a lot, track macros, and own way too many spices." | 121 | + air fryer, tawa, rice cooker, scale, grater |
| L5 | "I cook anything, keep it simple, and have the sauces to show for it." | 128 | pranjal's kitchen: everything below minus L4's vanity spices, plus condiments and shortcuts |

Because the kitchens are cumulative, every level first saw the same easy dishes (a bug: L2 and L3 shared 7 of 12). Since 1.55.0 a sample-kitchen run puts the dishes the level below can't make (`levelBelow()`, `freshAt()`) first. Share links don't carry the persona list and keep the plain order.

**The tester flow at 1.59.0** (`src/rung-quiz-ui.js`):
1. Hello (name from the link only), or on the bare site the persona picker.
2. **Confirm your foods**, then **How do you cook?**, then **Confirm your cookware**.
   - **Add more** (1.58.0) opens a search box above the groups: results by label and every synonym (Hindi and brand names), prefixes while typing, small typos only when nothing is spelled right; Enter adds the top hit; no match adds the words as typed. Set-aside words find nothing and say frozen and ready-made food isn't in Harvey's yet (`searchAdd`, `searchNote`, `EXTRA_ALIASES` in `src/brain/confirm.js`).
   - **How do you cook?** (1.59.0, pranjal: ask for a way, not cookware) has four multi-pick questions plus "I don't": boil eggs (pot, pressure cooker, kettle, egg boiler), scramble eggs (frying pan, kadhai, tawa, pot, microwave), toast bread (toaster, tawa, pan, sandwich maker, air fryer, oven), boil water (kettle, pot, microwave). Each way maps to kit the ranker already knows (`src/brain/ways.js`, `WAYS`); picked kit joins the kitchen and shows under "Added" on the cookware check. Answers go to `confirm.ways`. The egg boiler opens no dish yet.
3. **Rate every recipe** (1.57.0, pranjal: "give all possible recipes"): the deck is every dish the kitchen opens (L1 4, L2 26, L3 44, L4 68, L5 81), in `stratify()`'s round-robin across rungs (written and opened variants alternating), each round shuffled. **Done with quiz · send N rated** is on every dish screen; after sending, **Keep rating (N left)** continues and the next send replaces the earlier file. A taste rating of 1 or 2 shows optional why-chips (don't like an ingredient, odd combination, bland, dry or one texture, not filling) in `stars[].why`.
4. Bonus dish (one item away), then an end screen with an optional "meals or foods you often make" box, then Send.

### 15.4 pranjal's standing rulings (since 21 Nov)

- **Pierre is meant to be a snob** (24 Nov). Low taste ratings on easy dishes are knee-jerk dismissals that testers reverse after trying, so don't tune Pierre toward average tester taste.
- **Tofu is dropped entirely for now** (26 Nov). The same aglio olio got 5★ with paneer and 2★ with tofu. No tofu in templates, pantry or persona kitchens; a kitchen that lists tofu gets no tofu dish.
- **Soya is never swapped into or for anything** (26 Nov), and **soya always boils on its own** (26 Nov): in shared water its flavour seeps into the pasta and the chunks can't be fished out and squeezed. `soya_pasta_pot` and `soya_jeera_rice` were rewritten (soya pasta: 4 steps, 7 min hands-on, 16 min waiting, 2 dishes; was 3, 5, 10, 1). Ratings of those two ids before 1.59.0 were for the co-boiled recipes.
- **Frozen, ready-to-eat, takeaway, leftover and pouch items are set aside** (25 Nov, `SET_ASIDE` in `vocabulary.js`): no food id, join no dish, removed from the persona kitchens, shown in the ingredient check as `set_aside`. Canned chickpeas stay. Frozen-food support comes later.
- **A plain omelette (eggs, cooking fat, salt) is a pass, never a floor** (26 Nov).
- **Butter is a fat** (26 Nov); Pierre already classes it with oil, ghee and cream.
- **Khichdi passes**: "the main flavor comes from the salt + rice + dal"; ghee on top is an enhancer (26 Nov).
- **Chai with buttered toast passes**: separate items that each pass (26 Nov). Done as a ruling on `chai_toast`, not a general rule.
- **Stay floor** (26 Nov, the fat-only list): paneer cheese sandwich, one-pot cheese pasta, bare savoury oats (oil, oats, onion, one or two masalas; richer builds may pass), soya jeera rice when the soya is only oil, salt and air fryer, dal without a tadka (passes with one). No catalogue dish has a tadka dal or a richer savoury oats yet.
- **Raw oats in a shake are fine** (24 Nov), as a narrow cook-first exception.
- **About 12 dishes per tester** (24 Nov), later replaced by **rate every recipe** (26 Nov).
- **Close macros count as a tie**, savoury before sweet (26 Nov).
- Carried from before: never merge without pranjal saying "merge it"; Gemini flash-lite only; weights come from real choices, never invented; no gradients, no swipe UI, minimal explanatory text, one thing per screen.

### 15.5 Tester data so far (`data/kitchen-tests/`, 17 files)

- **Real kitchens, 22 to 24 Nov** (Harsh, Banana Singh, Purujeet): showed real kitchens are ingredient-limited, egg dishes feel harder than Harvey's thought (fixed in 1.51.0), air fryer may feel easier than Harvey's ranks it (one or two signals, not acted on), and for one tester the easiest dishes were the least tasty.
- **Analysis 1 (26 Nov morning): 6 persona runs on 25 Nov, 61 ratings** (L1 ×2, one abandoned after 1 dish; L2 and L3 on 1.54.0; L4 and L5 on 1.55.0).
  - Pierre's tiers order taste correctly: crave 4.9★, pass 3.3★, floor 2.9★. Maggi with a fried egg 5★ from all four who saw it.
  - Pierre's taste order vs testers: 0.95 (L1), 0.68 (L2), 0.85 (L3), 0.50 (L4, only 6 pairs), 0.91 (L5). Marco's effort order: 0.59 to 0.76.
  - Tofu-for-paneer and soya dishes rated low (soya 2, 2, 3, 2★ though Pierre passes them); almond swaps never beat peanuts (kanda poha 5★ → 3★, dahi poha 3★ → 2★); the curd-banana-peanut bowl was Harvey's rung-1 pick for L1 to L4 but got about 2★. These drove 1.56.0.
  - Taste rises with effort: rung 1 averages 2.9★ taste, 4.4★ effort; rung 4 3.9★ taste, 3.4★ effort. Six of seven testers gave their two easiest dishes 3★ or less (read as the knee-jerk pattern pranjal described, not a Pierre signal).
  - Egg dishes 3.7★ effort vs 4.3★ for the rest; air-fryer dishes 3.9★ vs 4.2★. Aglio olio (2★ effort) and the co-boiled soya pasta (1★) were the hardest.
  - A pooled Marco refit over 295 picks gave extreme weights and was not applied. `kitchen-tests.mjs` skips leave-one-out past 150 picks.
  - Every tester skipped the feedback box.
- **Analysis 2 (26 Nov, on 1.58.0): 4 new runs, 38 ratings** (L1 ×3 with thin decks of 3, 5 and 6 dishes; L2 ×1 rating all 24).
  - Crave 5.0★ (2 ratings), pass 3.5★ (27), **floor 3.7★ (9)**: floor no longer sat below pass, because the fat-only floor put bread omelette, butter omelette and egg toast on the floor in L1's kitchen (no pepper or chilli), and L1 testers rated them 5★. Omelettes got 5★ taste from every tester. This drove the 1.59.0 omelette ruling.
  - Marco's effort order: 1.00, 0.67, 1.00, 0.74. Pierre's taste order for L2: 0.64 (L1 decks too small to measure).
  - Why-chips (L2 only, on 7 of 10 low ratings): bland ×5, four of them on dishes Pierre passes (boiled eggs with salt and pepper, boiled egg sandwich, masala oats, banana-peanut oats); ingredient ×3; odd ×1. L2 rated all four oat dishes 1 to 3★, and masala oats and the one-pot egg bhurji 1★ as bland. Here the tester was harsher than Pierre.
  - No tofu or soya in any new deck (1.56.0 worked). The butter-cheese sandwich now leads rung 1 but averages 3.0★; one L1 tester asked for it without butter.
  - Only one tester (an L1) filled in the feedback box.
- Not yet tested on 1.59.0: no ratings have arrived since the How do you cook screen, the soya rewrite and the floor rulings went live.

### 15.6 Open questions and backlog

Open questions (raised, not decided):
1. **Two egg floor flags that look wrong.** In a bare kitchen, `egg_pasta_pot` and `egg_rice` floor with "nothing to coat it", and `pot_egg_bhurji` floors with "a bhurji has no base". Not yet looked into or ruled on. (`boiled_eggs` also floors there because it has no cooking fat, and `airfryer_egg_in_toast` because eggs@air_fried is unrated.)
2. **Does plain buttered toast on its own pass?** Pierre floors it as fat only; the chai-and-toast ruling was made per dish so it wouldn't reach it. pranjal was asked and hasn't answered.
3. **Easy vs tasty.** Rung-1 dishes average under 3★ taste while "easiest first" is the product direction. pranjal reads low taste on easy dishes as knee-jerk; L2's "bland" chips were on dishes Pierre passes.
4. **Air fryer** may be easier than Harvey's ranks it; still only a few signals.
5. **Marco refit needs more picks.** The pooled tester refit (295 picks) gives extreme weights; today's weights stay pranjal's prep-quiz fit. The Cooked this log never reached the 20 to 30 dinners planned on 21 Nov.
6. **The feedback box is skipped.** One tester in ten filled it in, so the stars and why-chips are nearly all the qualitative signal.
7. **Thin L1 decks** (3 to 6 dishes) give little to measure.

Backlog (agreed or raised, not built):
- **Frozen-food support** (set aside since 1.55.0; pranjal will add it later).
- **Pre-prep suggestions** ("if you have time": poha 15 min, rice about 1 h, chickpeas overnight). Unsoaked dishes already go to a "For tomorrow" card (1.21.0); wording and broader use are open.
- **Ready-made / store-bought shortcuts:** an owned ready-made item (aglio olio paste, roasted chana, cheese spread) should count as a pre-done technique and remove those steps' friction. Frozen for v1 in the Step 5 handoff.
- **Egg boiler** is asked about but opens no dish.
- **Non-veg** (chicken): deferred to pranjal.
- Smaller: the video agent prompt is uploaded by hand (API later); matcher gaps for RTE items are moot while they're set aside; rung 3's sheet label says "On the stove" even when a knife put the dish there.
- Still frozen from §8: Swift port, spoons, computed crave, umami gating, λ per mood.
