# Harvey's v2 Execution Plan: Review

**Reviewing:** `v2-execution-plan.pdf` (checked against `pranjalparashar1/harveys` at commit `f603849`, v1.8.1)  
**Status:** Ready to build from, pending three spec fixes before opening the Step 1 PR.

---

## Verdict

The execution plan is solid. All 15 corrections in §1 are verified against `f603849`. Closing the AI-prompt diet leak (C2), replacing the arbitrary dish-count threshold with attention-based rungs (C9), and setting a zero-false-positive acceptance gate for Step 4 make the plan cleaner and more disciplined than R2.

Before locking the plan and starting Step 1, fix **three concrete bugs/contradictions in the spec** and note one minor watch-out in Step 3.

---

## 1. Three Spec Bugs to Fix Before Step 1

### B1. Step 5: Within-rung ordering recreates the austerity bias
* **Plan text:** Orders dishes inside each rung by `tier (crave, pass, floor)` $\to$ `Friction v2` $\to$ `payoff`.
* **Problem:** The rungs already bucket meals by effort/attention. Sorting by `Friction v2` *before* `payoff` demotes macro targets to a tie-breaker. Inside Rung 3 ("Stand at it"), a 12 g protein dish with one fewer step will beat a 30 g protein `paneer_bhurji`, reintroducing the exact austerity bias the ladder is meant to eliminate.
* **Fix:** Order inside each rung by:
  $$\text{tier} \;\to\; \text{payoff} \;\;(\text{or } \text{payoff} - \lambda \cdot \text{friction}) \;\to\; \text{Friction v2}$$
  Let the rung handle the effort decision; let macros win inside the rung.

### B2. Step 5: Rung 2 vs. Rung 4 precedence bug (and a no-cook edge case)
* **Plan text:** *"A dish takes the first rung whose rule it meets."*
  * Rung 1: `methodsOf` is `no-cook` and nothing to peel or cut.
  * Rung 2: Heat only from a closed appliance, `attention` $\le 1$, nothing to peel.
  * Rung 4: Two or more cooking vessels or appliances, or `attention` $= 3$.
* **Problem:**
  1. A meal using **two closed appliances** (e.g., microwave + air fryer, `attention` $\le 1$, nothing to peel) satisfies Rung 2 and gets trapped there before ever reaching Rung 4.
  2. A `no-cook` dish with a `cut` (e.g., slicing tomato, no peel) fails Rung 1 and can vacuously satisfy Rung 2's *"Heat only from a closed appliance"* condition if implemented as a negative check (no open-stove heat).
* **Fix:** Tighten Rung 2 to require **exactly one closed appliance** and **requires heat** (or evaluate Rung 4 first, then Rung 1 $\to$ Rung 2 $\to$ Rung 3).

### B3. Step 1: Subtitle contradicts the diff
* **Plan text:** Step 1 is titled *"Hygiene (no change to live picks except the diet fix)"*, while porting Friction v2 (`rawFeatures()` and `FEATURES` from `learn.js`) into `ranker.js`.
* **Problem:** Dropping the stove as a tool, pricing waiting time above $0$, and splitting peels from cuts *will* change live scores and can reorder the top 5.
* **Fix:** Reword Step 1's expectation to *"no UI or ladder change; live scores shift from Friction v1 to v2"* (which already matches the plan to review moved golden tests in `test/brain.test.js`).

---

## 2. One Minor Watch-Out (Step 3)

* **Scope of texture max-pooling:** Scoping `dishProfile()`'s texture max-pool to parts with `centre` $\ge 2$ cleanly prevents garnish hijacking.
* **Edge case:** In `pierre-raw.js`, `almonds` and `walnuts` are rated `centre: 1`. A cold bowl topped with roasted almonds will not register `crisp` from the almonds unless crunchy nuts are later handled as a modifier or raised to `centre: 2`.
* **Call:** Leave as-is for Step 3 and let the Step 4 benchmark show whether it matters.

---

## 3. Pre-Flight Sign-Off Checklist

Confirm these three items to unlock Step 1:
1. **Within-rung sort (B1):** Switch Step 5 to `tier` $\to$ `payoff` (or `payoff - lambda * friction`) $\to$ `Friction v2`.
2. **Rung precedence (B2):** Add `exactly 1 closed appliance` + `requires heat` to Rung 2 (or evaluate Rung 4 first).
3. **Matrix Row 8 (`makhana`):** Keep `makhana` rated and let the Step 4 benchmark judge it (recommended), or exclude it in Step 1.