# Execution Handoff: Ship Pierre Live + White v2 (Effort Ladder & Rapid Calibration)

* **Repository:** `pranjalparashar1/harveys`
* **Base Commit:** `e11f8a8` (`main`, v1.16.0 — 153 of 153 tests passing)
* **Live Prototype:** `https://pranjalparashar1.github.io/harveys/` (Windows-only dev; web prototype is the product for now)
* **Strategy:** Freeze Pierre as good enough for v1 and ship end-to-end in **two small PRs** (**PR 5A** and **PR 5B**), immediately followed by a **5-minute, 50-tap Marco calibration sprint** at a fixed 7 PM low-energy baseline so fitted weights ship right away (with passive `cookLog` correcting optimism bias over time).

## 1. Locked Decisions (Answers to Status Brief §5 + Marco Calibration)

These seven calls are final for v1 so execution does not stall:

1. **Ship Pierre now vs. wait for Round 3:** **Ship now.** Score Round 3 in parallel; patch only if Round 3 surfaces a dangerous-miss pattern (`veto`/`floor` leaking into `pass`/`crave`).
2. **How much Pierre in White:** **Hard veto filter + primary sort key inside each rung:**
   $$
   \text{tier } (\text{crave} > \text{pass} > \text{floor}) \;\to\; \text{payoff} \;\to\; \text{Friction v2}
   $$
   *(Payoff MUST beat Friction v2 inside a rung—the rung already buckets effort, so sorting by Friction first would reintroduce austerity.)*
3. **Assembly-heavy dishes (2–3 layers):** **Do not invent a new layer penalty.** Let the ladder's attention rungs and Friction v2's existing `steps`/`tools` handle it for v1.
4. **Marco calibration (speed over waiting 7 nights):** **50-tap rapid calibration sprint at a single fixed 7 PM low-energy baseline**, constrained to **within-rung and adjacent-rung pairs** (`|rung(a) - rung(b)| <= 1`). Cross-rung pairs (Rung 1 vs. Rung 4) waste taps because `rungOf()` already separates them structurally. Export fitted $\theta$ from `train.html` via one click and commit to `config.js` as v1 fitted weights.
5. **Ongoing live learning (skips + within-rung overrides):** Every `"Cooked this"` tap logs `{ dishId, rung, tier, ladderShown, alternativesShown, at }` to `cookLog`. Recording both `ladderShown` (cross-rung picks) and `alternativesShown` (runner-up dishes inside the chosen rung) captures implicit Bradley-Terry skips and within-rung overrides to correct any optimism bias from the manual sprint. Pair this with a 1-tap **"Fix / Veto"** action on any rung card.
6. **Unresolved Pierre disagreements (Pranjal's rules beat the ontology):**
   * **Respect immediately (if currently conflicting in `ingredients.js`):** Plain butter on pasta is `floor` (bland without cheese/aromatics); a sandwich does *not* require a moisture bridge; strong flavor lifts an all-creamy dish (mashed chickpeas + butter + curd = `pass`).
   * **Defer until post-ship / Round 3:** Do *not* block Step 5 on edge-case disagreements (`boiled eggs + lemon + chaat masala` vs. `pepper`, `sautéed kala chana salad`). Fix those only if they recur in Round 3 or real dinners.
7. **Recipe text:** **Deterministic from `CATALOGUE` steps + White's assembly line** (`dishProfile().finish` for `distance === 1` finishing steps). Keep AI-written steps *only* for AI-proposed recipes. This keeps the 15 s time-to-recipe budget intact and avoids extra LLM calls.

## 2. Guardrails & Scope Freeze

* **Freeze Pierre's ontology and quizzes.** No new blind sheets beyond Round 3, no 0–5 spoons, no computed `crave`, no `umami` gating, no $\lambda$ per mood (locked to 7 PM low-energy default), no store-bought shortcuts, and no Swift port in these PRs.
* **Vegetarian + eggs on every path** (catalogue, scan, paste, AI).
* **Gemini `flash-lite` only.**
* **No invented weights outside `PROVISIONAL` entries in `config.js`.** Once the 50-tap sprint exports fitted $\theta$, replace provisional Friction v2 priors with the fitted vector and mark `PROVISIONAL = false` for friction weights.
* **Merge policy:** Open one PR per branch against `main` (`--no-ff` after Pranjal approves). **Do not merge automatically.**

## 3. PR 5A: Wire Pierre into Live `rank()` (Half-Day PR)

* **Branch:** `step-5a-wire-pierre`
* **Goal:** Connect the built, idle Pierre engine (`pierreTier()` / `dishProfile()`) into the live ranker so the live app actually uses Pierre before the UI changes to a ladder.

### File Changes

1. **`src/brain/index.js`:**
   * Export `pierreTier` and `dishProfile` from `./ingredients.js` so `ranker.js` and `app.js` consume Pierre through the single brain entry point.
2. **`src/brain/ranker.js`:**
   * Import `pierreTier` and `dishProfile` from `./ingredients.js`.
   * Inside `rank()`:
     * For every feasible meal (both `CATALOGUE` meals, which already have `parts` and `form`, and AI-proposed meals that pass `validateMeal()`), evaluate `const pierre = pierreTier(meal.parts, meal.form, { inventory })` (if an AI meal lacks `parts`/`form`, pass it through the open/untested path rather than crashing).
     * **Hard veto drop:** If `pierre.tier === 'veto'`, drop the meal from `ranked` (record it in a `vetoed` array on the return object for Debug visibility).
     * Attach `pierre` (tier, reasons, upgrade/fix hint, and `finish` from `dishProfile()`) onto each ranked result object.
     * Update sort order: `TIER_ORDER[b.pierre.tier] - TIER_ORDER[a.pierre.tier]` (`crave: 3, pass: 2, floor: 1`), then existing `score` (`payoff - lambda * friction`), then `friction`, then `id`.
3. **`src/app.js`:**
   * On the pick card and "Also possible" list, display a compact Pierre tier badge (`crave` / `pass` / `floor`) and, for `floor` dishes, render the one-line upgrade hint (e.g., `Lift it: + lemon` or `Lift it: + butter`).
   * In `whyTable()`, include a small Pierre row showing the tier and why.

### Tests & Acceptance (PR 5A)

* **New tests in `test/brain.test.js`:**
  * A vetoed dish (`eggs@microwaved` / `mug_omelette` or `soya_chunk_curd_bowl`) never appears in `rank().ranked` and appears in `rank().vetoed`.
  * `crave` ranks above `pass`, and `pass` ranks above `floor`.
  * Every `floor` dish returned by `rank()` carries its upgrade/fix hint.
* **Golden tests:** Re-run `npm test`; list any moved golden rankings in the PR description alongside a Before vs. After `DEMO_KITCHEN` table for Pranjal's sign-off.

## 4. PR 5B: White v2 — Effort Ladder, Assembly Line & Rapid Marco Calibration (1-Day PR)

* **Branch:** `step-5b-white-ladder` (branched from `main` after PR 5A merges)
* **Goal:** Replace the single austerity-biased ranked list with the 4-rung attention ladder, add White's assembly line and pre-prep annotations, add `"Cooked this"` + inline `"Fix / Veto"` live learning, constrain `train.html` / `nextPair()` for the 50-tap 7 PM Marco sprint with 1-click weight export, and delete the legacy tag-logistic Pierre.

### 4.1 `src/brain/ranker.js` — Attention Rungs & Ladder Output

Export `rungOf(meal, used)` (so both `rank()` and `learn.js` / `train.js` share the exact same rung classifier) using **strict precedence** so multi-appliance dishes are never trapped in Rung 2 and no-cook dishes with chopping do not vacuously match Rung 2:

```js
// Closed appliances (walk-away heat)
const CLOSED_APPLIANCES = new Set([
  'microwave', 'air_fryer', 'sandwich_maker', 'toaster', 'kettle', 'pressure_cooker',
]);
// Cooking vessels/appliances that count toward juggling
const COOKING_UNITS = new Set([
  ...CLOSED_APPLIANCES, 'pan', 'pot', 'saucepan', 'frying_pan', 'tawa', 'kadai', 'oven',
]);
```

**Evaluation order (check Rung 4 FIRST, then 1 $\to$ 2 $\to$ 3):**

| Check Order | Rung | Name | Exact Rule |
| :--- | :--- | :--- | :--- |
| **1st** | **4** | `Juggle` | `cookingUnitsUsed >= 2` (two or more cooking vessels/appliances) **OR** `attention >= 3` |
| **2nd** | **1** | `Nothing to watch` | `methodsOf(meal)` is `['no-cook']` only **AND** `raw.peels === 0` **AND** `raw.cuts === 0` |
| **3rd** | **2** | `Walk away` | Uses heat (`!noCook`), **exactly 1** closed appliance (`closedCount === 1`), **0** open stovetop vessels, `attention <= 1`, **AND** `raw.peels === 0` |
| **4th** | **3** | `Stand at it` | Everything else (open stovetop vessel, or `peels > 0`, or `cuts > 0`, or `attention === 2`, with $\le 1$ cooking unit) |

* **Pre-prep rule:** `meal.prePrep` does **not** hide the dish and does **not** change its rung. Keep the dish in its attention rung and attach `prePrepNote: meal.prePrep ? meal.prePrep.text : null` (rendered as `"If you have time: ..."`).
* **Within-rung sorting:** Group non-vetoed feasible dishes by `rung` (1 to 4). Inside each rung, sort strictly by:
  1. `tier` (`crave > pass > floor`)
  2. `payoff.value` (descending — macros win inside the rung)
  3. `friction` (ascending — Friction v2 as tie-breaker, reading fitted `config.frictionTheta` when present or falling back to `learn.js` priors)
  4. `meal.id` (deterministic tie-break)
* **Return value of `rank()`:** Return `ladder: [{ rung, name, pick, alternatives }]` (only rungs with $\ge 1$ feasible dish) alongside existing `ranked`, `filtered`, `vetoed`, `unlocks`, and `lambda` so existing callers remain unbroken.
* **White's assembly line:** For any dish whose `dishProfile().finish` has `distance === 1` parts (e.g., `"one finishing step"`), attach `assemblyStep` (e.g., `"Finish with salt and butter"`) so White renders it as the final recipe step rather than counting it as Marco friction.

### 4.2 `src/app.js` & `assets/styles.css` — 8 PM Ladder UI & Live Learning Loop

1. **Render the Effort Ladder in `renderResult()`:**
   * Replace the single top pick card with the **Ladder** (`Rung 1: Nothing to watch` $\to$ `Rung 2: Walk away` $\to$ `Rung 3: Stand at it` $\to$ `Rung 4: Juggle`).
   * Each rung shows its winning `pick` card (name, macro + effort chips, Pierre tier badge, `prePrepNote` if present, `floor` upgrade hint if present, expandable recipe steps including White's `assemblyStep`, and expandable `alternatives` for that rung).
   * Keep `AI ideas`, `One thing to buy`, and `Can't make yet` below the ladder.
2. **One-Tap `"Cooked this"` Button (Passive Choice Log with Within-Rung Alternatives):**
   * Add a primary `"Cooked this"` button on every rung pick (and alternative).
   * Tapping it appends an entry to `localStorage` under `marco.cookLog`:
     ```js
     {
       dishId: chosen.meal.id,
       rung: rungGroup.rung,
       tier: chosen.pierre.tier,
       ladderShown: result.ladder.map((g) => ({
         rung: g.rung,
         pickId: g.pick.meal.id,
         tier: g.pick.pierre.tier,
         payoff: Number(g.pick.payoff.value.toFixed(3)),
         friction: Number(g.pick.friction.toFixed(3)),
       })),
       alternativesShown: [rungGroup.pick, ...rungGroup.alternatives]
         .filter((item) => item.meal.id !== chosen.meal.id)
         .map((item) => ({
           id: item.meal.id,
           tier: item.pierre.tier,
           payoff: Number(item.payoff.value.toFixed(3)),
           friction: Number(item.friction.toFixed(3)),
         })),
       context: { kind: state.ctx.kind, ...moment(), targets: state.ctx.targets },
       at: new Date().toISOString(),
     }
     ```
   * Show a brief confirmation state (`Logged · Cooked tonight`) and include `cookLog` in Debug's **"Copy for Claude"** export (`copyDebug()`).
3. **Live `"Fix / Veto"` Hook (Reusing Tap-to-Repair):**
   * Add a quiet `"Fix / Veto"` button on each rung card.
   * Tapping it opens a lightweight inline repair drawer (reusing the 6-slot flowchart chain + `editSlot` / `setRepairTier` / `setRepairScope` logic from `src/quiz/bench.js`) or links directly into `bench.html` preloaded with that dish's chain, storing any live repair under `marco.liveRepairs` and including it in **"Copy for Claude"** so Pranjal can fix a bad 8 PM pitch in 5 seconds without waiting for another quiz sheet.

### 4.3 `src/brain/learn.js`, `src/train.js`, & `train.html` — 50-Tap 7 PM Marco Sprint & Cleanup

1. **Within-Rung / Adjacent-Rung Pair Selection (`src/brain/learn.js`):**
   * Extend `nextPair(pool, opts)` to accept optional `maxRungGap = 1` (each pool item carries `rung: rungOf(dish)`).
   * Prefer pairs where `Math.abs(a.rung - b.rung) <= maxRungGap` (giving a bonus to `a.rung === b.rung` so the majority of taps force real within-rung trade-offs like `peels` vs. `cleanup` vs. `handsOn` vs. `protein`, while adjacent-rung pairs calibrate rung boundaries).
   * Fall back to any pair only if no valid within/adjacent-rung pair exists in `pool`.
2. **Fixed 7 PM Low-Energy Baseline & 1-Click Weight Export (`src/train.js` & `train.html`):**
   * Default the trainer prompt to the fixed baseline: *"7 PM after a long day of work (low energy) — which would you actually make right now?"* (single fixed mood `'okay'` so all 50 taps fit $\theta$ directly without splitting data across 3 moods).
   * Display a progress counter toward 50 taps (e.g., `18 / 50 taps for Marco v1 fit`) alongside the live `explainWeights(theta)` summary (`1 thing to peel ≈ X g protein`).
   * Add a **"Copy fitted Marco weights"** button that copies a clean JSON/JS payload containing `{ taps, looHits, theta, explained: explainWeights(theta), choices }` ready to drop straight into `src/brain/config.js` (and open a prefilled GitHub issue if desired).
3. **Delete Legacy Tag-Logistic Pierre:**
   * **`src/train.js`:** Replace `fitPierre` / `pierreTags` usage with `pierreTier()` from `src/brain/ingredients.js`.
   * **`src/brain/learn.js`:** Delete `fitPierre`, `pierreSummary`, `pierreTags`, `tagLabel`, and `VERDICT_VALUE` (keep `FEATURES`, `rawFeatures`, `featureVector`, `fitLogistic`, `fitMarco`, `utility`, `explainWeights`, `nextPair`, `inDiet`, `methodsOf`, `starsOf`, `mulberry32`).
   * **`src/brain/train-data.js`:** Delete `TECHNIQUE_OVERLAY.pierreTags` (keep `PIERRE_SEED`, `TRAINING_EXTRAS`, `FORM_TOOLS`, `PRE_PREP_OPTIONS`).
   * Update `test/learn.test.js` to remove tests for the deleted tag-logistic functions and add tests for `maxRungGap` in `nextPair()`.

### 4.4 Tests & Acceptance (PR 5B)

* **New tests in `test/brain.test.js`:**
  * Fixed rung assignments:
    * `whey_milk_shake` $\to$ Rung 1 (`Nothing to watch`)
    * `whey_makhana_bowl` $\to$ Rung 1 (`Nothing to watch`)
    * `airfryer_protein_cheese_toast` $\to$ Rung 2 (`Walk away`)
    * `microwave_paneer_bhurji` $\to$ Rung 2 (`Walk away`)
    * `stovetop_paneer_bhurji` $\to$ Rung 3 (`Stand at it`)
    * `pasta_aglio_olio_paneer` $\to$ Rung 4 (`Juggle`)
    * `chana_chaat` $\to$ keeps its attention rung (Rung 3) and carries `prePrepNote`
  * **Precedence edge cases (B2):**
    * Synthetic dish with `microwave` + `air_fryer`, `attention: 1`, `0` peels $\to$ **Rung 4** (not trapped in Rung 2).
    * Synthetic `no-cook` dish with `1` cut and `0` peels $\to$ **Rung 3** (not vacuously Rung 2).
  * **Within-rung sort (B1):** Inside Rung 3, a higher-protein `pass` dish beats a lower-protein `pass` dish with slightly lower friction.
  * **Small-pantry guard:** A pantry with only no-cook dishes produces a Rung-1-only ladder (no fake Rung 2/3 promotion).
  * **Veto guard:** Zero vetoed dishes appear in any rung of `ladder`.
  * **Export round-trip:** `cookLog` (including `alternativesShown`) and `liveRepairs` serialize cleanly into the Debug `"Copy for Claude"` JSON.
* **New tests in `test/learn.test.js`:**
  * `nextPair()` with `maxRungGap: 1` never pairs a Rung 1 dish with a Rung 4 dish when within/adjacent-rung pairs exist.
* **CLI Ladder Trace (paste into PR 5B description):**
  Run `DEMO_KITCHEN` (Wednesday 19:00, 60 g protein / 1200 kcal / 20 g fiber) and verify the ladder outputs 3–4 rungs with a whey option on Rung 1, toast/microwave paneer on Rung 2, sandwich on Rung 3, and aglio olio on Rung 4—none burying the others.
* **Phone / Browser Smoke Check:**
  * Recipe ladder on screen within 15 s on iPhone; tapping `"Cooked this"` logs `ladderShown` + `alternativesShown` to `cookLog`; `train.html` shows the 7 PM low-energy prompt and copies fitted weights cleanly.

## 5. Immediate Post-Merge Sprint (Same Day as PR 5B)

1. **5-Minute Marco Sprint (Right after PR 5B merges):**
   * Pranjal opens `train.html` and completes **50 rapid within/adjacent-rung taps** holding the fixed 7 PM post-work low-energy baseline.
   * Sanity-check `explainWeights(theta)` (confirm `peels`, `cleanup`, and `handsOn` sit in the right relative order).
   * Click **"Copy fitted Marco weights"** and commit the fitted $\theta$ into `src/brain/config.js` (tiny **PR 5C** — 10-line config update).
2. **Live Usage & Drift Correction (Ongoing):**
   * Use the live GitHub Pages app for real dinners, tapping `"Cooked this"` and using `"Fix / Veto"` only when an actual suggestion is wrong.
   * After ~20–30 real logged dinners, refit $\theta$ on `cookLog` (`chosen` vs. `ladderShown` + `alternativesShown`) to correct any optimism bias from the manual sprint, and ingest any `liveRepairs` via `scripts/ingest-pierre.mjs`.