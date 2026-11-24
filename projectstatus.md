# Harvey's: project status (21 Nov to 24 Nov 2026)

**Read this after [`docs/HANDOVER.md`](docs/HANDOVER.md).** The handover describes Harvey's at **v1.19.0 (PR #50)**, with a short note added at 1.29.0. This file covers everything since then, up to **v1.51.0 (PR #100, merged 24 Nov 2026)**: what changed, why, what broke and got fixed, what real testers showed, and what is still open. Where this file and the handover disagree, this file wins.

- **Repo:** `pranjalparashar1/harveys`, `main` at PR #100. `npm test`: 271 of 271 pass.
- **Live:** https://pranjalparashar1.github.io/harveys/ (the site root is now the **tester page**). Owner pages: `owner.html`, `share.html`, `train.html`, `prep.html`, `test.html`, behind a soft password gate.
- **The repo is public.** No secrets, keys, emails or private repo names in commits, PRs or this file.

---

## 1. Where things stand now (v1.51.0)

### 1.1 The product in one paragraph
Harvey's answers "what should I cook right now, from what I already have, that I will actually make?" The brain is still Marco (friction, will I make it), Pierre (is it worth eating) and White (what to show). **Product direction (pranjal, confirmed in chat):** Harvey's suggests the **easiest dishes first, after balancing for macros**. There are **no energy modifiers and no energy picker**. pranjal's Marco training taps were made from a tired state and are the baseline for everyone. Much later, users will pick what to make from a card or carousel view, but that is far off and is not today's UI.

### 1.2 What the project is doing right now
The focus moved from pranjal's own kitchen to **testing in other people's kitchens** (the MVP goal). The loop is:

1. A tester films their kitchen. pranjal runs the video through a separate video agent using [`docs/catalogue-prompt.md`](docs/catalogue-prompt.md) (prompt v2). **For now the prompt is uploaded by hand with each video; an API integration comes later.**
2. pranjal pastes the agent's JSON into `share.html`, types the tester's first name and sends a named link: `https://…/harveys/#n=<name>&k=<kitchen>`. The kitchen travels compressed in the URL fragment (deflate-raw + base64url). Nothing is stored server-side.
3. The tester opens the link on their phone (site root, `index.html`) and runs the **recipe test** (flow in §1.3).
4. **Send** posts the result to a Cloudflare Worker relay (`relay/worker.js`, `RELAY_URL` in `src/send.js`), which commits it create-only to `data/kitchen-tests/taste-<date>-<kitchenId>-<testerId>.json`.
5. Read results with `git pull && node scripts/kitchen-tests.mjs score` (or `feedback --out f.md`).

### 1.3 The tester flow at 1.51.0 (screen kinds live in `screens()` in `src/rung-quiz-ui.js`)
1. **Hello:** big "Hi, <name>" (name from the `#n=` link only, never from storage). Lines fade in one at a time. Button: **Check my kitchen**.
2. **Confirm your foods**, then **Confirm your cookware**: every item the video agent listed is pre-ticked; the tester unticks what isn't there (`confirm.removed`, dropped from the inventory). "Missed something? Add more" opens tap categories plus a type box (fuzzy-matched by `matchTyped` in `src/brain/confirm.js`; no-match entries land in `confirm.unmatched`). Each tick shows a "+N meal ideas" toast when it unlocks dishes.
3. **Thinking** (about 1.8 s) and **reveal** ("Harvey's came up with N"), with the rating how-to and cycling demo stars.
4. **One dish per screen**, in a seeded shuffle (`quiz.rateOrder`, recorded as `order`), never Harvey's own order. Effort stars then taste stars (5 = effortless / delicious). Recipe sheet on tap (draggable). "I can't make this" tick box with multi-pick reasons (ingredients, equipment). **Testers rate exactly the dishes their confirmed kitchen can make, no cap and no padding.**
5. **Bonus:** the single dish that is one item away. First a screen explaining the dish and what the item unlocks, then effort, taste, "Would you buy <item>?" (1 to 5) or "I already have it".
6. **End:** optional "meals or foods you often make" box (`feedback.makes`), then Send. "Start fresh" (top right and footer) clears local runs and reloads.

Result format stays `harveys-rung-quiz/1` with `flow:'stars'`, and every change has been additive, so **the live relay has never needed a redeploy**. Keep it that way.

### 1.4 Brain state
- `config.frictionTheta` = the **prep-quiz rounds 1 to 3 refit** (adopted 22 Nov): tools −0.682, handsOn −1.005, waiting −0.518, prePrep −0.367, peels 0, cuts 0, steps −0.036, attention −0.571, cleanup −0.734. Positives are always clamped to 0.
- **Egg handling:** `rawFeatures` in `src/brain/learn.js` adds `EGG_HANDLING_MINUTES = 2` to hands-on time for any dish that needs eggs (PR #100).
- White's within-rung order is tier → Marco score (payoff − λ × friction) → friction → id (fixed in PR #71; before that the weights never affected rung picks).
- Open-ended pantry (`src/brain/pantry.js`): any named ingredient gets a profile; role slots (`role:heat`, `role:acid`…) let sriracha or vinegar fill a slot.
- **Always assumed:** salt, oil, a strainer (a lid held ajar drains rice).
- Catalogue: 67 meals plus snacks (count at 1.47.1), including 11 everyday staples, 19 bare-kitchen dishes (one pot, tawa, kettle or microwave), chai meals and 5 one-pot protein dishes.
- Diet: vegetarian plus eggs on every path. **Non-veg is deferred** (see §4).

### 1.5 Real tester data so far (`data/kitchen-tests/`, 7 files)

| Tester | Version | Kitchen | What it showed |
|---|---|---|---|
| Test persona (aspirational bachelor) | 1.31.0 | synthetic | First end-to-end run of the old sorting flow |
| **Harsh** | 1.35.0 | videos 1-3 | Saw only Maggi: salt wasn't listed and the video missed his kadhai. Drove 1.36 (salt/oil assumed, kadai dal) |
| **Banana Singh** | 1.36.1 (×2), 1.41.0 | video_1 | Only boiled eggs (no pan, no microwave). Drove 1.37 to 1.39 (pot dishes, bare-kitchen dishes, quick check) |
| **Banana Singh** | 1.48.0 | video_1 | Added 22 items on confirm; engine went 6 → 21 cookable but she saw 8. Drove 1.49/1.50 (rate every cookable dish). Effort agreement 0.84 |
| **Purujeet** | 1.50.0 | video_1 (m0xa7) | Clean run, 11 dishes, bonus, no flow bugs. Effort agreement 0.69, taste vs Pierre 0.36 |

Findings from the two star-rating runs (Banana 1.48, Purujeet 1.50):
- **Egg dishes feel harder than Harvey's thinks.** Both rated boiled eggs and 6 of 7 egg dishes "Some effort". 8 of the 14 effort pairs Harvey's got wrong involved eggs. **Fixed in PR #100** (agreement 41/55 → 45/55). Two testers, so directional only.
- **Air fryer may be easier than Harvey's thinks.** Two effortless ratings (Purujeet's air-fryer tikka, Banana's bonus toast), yet Harvey's ranks air-fryer dishes hardest. **Flagged, not acted on.** Watch the next batch.
- **For Purujeet, the easiest dishes were the least tasty** (curd bowls and curd rice got taste 2 to 3, harder dishes got 5). Banana gave the curd bowl a 4. Mixed; worth watching because "easiest first" only works if easy dishes are also worth eating.
- **Purujeet wants chicken** ("chicken rice"). Harvey's is veg plus eggs. **pranjal will decide on non-veg later**; don't build it.
- Pooled Marco fit over all taste tests: 76 picks, leave-one-out 63 vs 35 for today's weights (the 35 is partly a scoring quirk: `priorHits` scores with outside = 0). Not adopted; too few testers.

---

## 2. Chronological log (PR #53 to #100)

### 21 Nov: finishing pranjal's own brain (1.20 to 1.29)
- **#53 (1.19.1 / 1.20.0) Pierre round 3 ingest + everyday staples.** Pierre round 3 scored 14/26 exact out of sample; the six misses had six different causes, so no new general rule (Fable's "patch only a pattern"). Added 11 staples in their simplest honest form: dal tadka with rice, cooker chole/rajma/kala chana, paneer pulao, egg fried rice, Maggi three ways, air-fried soya chunks, masala oats.
- **#54** Original v2 documents into `docs/v2/`.
- **#55 (1.21.0) Soaked or not.** pranjal: "if soaked, difficulty is fine; if not, it should be a 'for tomorrow' option." Unsoaked soak dishes move to a "For tomorrow" card. Egg fried rice split into pass (usual) and a spring-onion crave version.
- **#56 (1.22.0)** `scripts/refit-cooklog.mjs`: refit Marco from the "Cooked this" log in one command, pulled toward current weights, never edits config.
- **#57 (1.23.0)** AI recipes obey pranjal's cooking rules: never microwave eggs, dal or legumes; tadka in oil or ghee, never butter.
- **#58, #60 (1.24, 1.25) Marco prep quiz** (`prep.html`): one dish two ways at a set time and energy. Round 1 fit gave attention and cleanup real costs (20/26 clear picks vs 14).
- **#61 (1.26.0) Round 2, and the energy decision.** The fit said effort feels 2.5× heavier when wiped out. **pranjal dropped energy multipliers entirely**: no picker; quiz taps are the tired baseline.
- **#63** Round 2 findings: friction doesn't explain them. pranjal picks the more careful technique when it makes the food better (rinsed rice, marinated paneer, ghee tadka, fresh garlic). Weights unchanged.
- **#64 (1.27.0)** Those taste-driven picks go to Pierre (`src/brain/technique-prefs.js`) and are excluded from Marco with `--no-taste`. Round 3: same-taste pairs only.
- **#66 (1.27.1 / 1.28.0)** Round 3 refit no better, weights unchanged. Round 4 (trade-off pairs tuned near indifference) published; answers never came back.
- **#68 (1.29.0) Open-ended pantry** and the kitchen importer (`src/brain/kitchens.js`, `scripts/import-kitchens.mjs`), plus the first cataloguing prompt. This is the bridge to other people's kitchens.

### 22 Nov: other people's kitchens (1.30 to 1.44)
- **#69** (closed, not merged) first try at a persona test kitchen; folded into #70.
- **#70 (1.30.0) Kitchen test mode** (`test.html`): any kitchen → Pierre, Marco and White quizzes, scored per kitchen by `scripts/kitchen-tests.mjs`.
- **#71 Audit fixes before testing:** ladder now sorts by Marco score (weights were having no effect on rung picks); fits rescaled and clamped; kitchen tests no longer inherit pranjal's personal Pierre seed. Then **adopted the rounds 1 to 3 refit** (leave-one-out 52/91 vs 47/91).
- **#72 to #74 Main page stripped for testing:** paste a list → summary (two big counts, Kiron style) → Proceed. Renamed to Harvey. Fixed hard-wrapped JSON pastes.
- **#75 (1.31.0) The first taste test**, in Kiron's player style: drag-sort each rung for Marco and Pierre, tap-order picks for White. pranjal praised this as the model to follow (ambitious, evidence-grounded UX).
- **#76 (1.32.0)** One-tap Send with a phone token; lone-dish rungs merge.
- **#77, #78 (1.33.x) The relay:** Cloudflare Worker holds the GitHub token, origin-locked, schema-checked, create-only, rate-limited. Ingredient check (`src/brain/usage.js`) in every result.
- **#79 (1.34.0) Share links** (`share.html`) and tester feedback chips.
- **#80 (1.35.0) Tester page at the root** with "Hi, <name>"; owner workbench moved to `owner.html`; soft password gate (`src/gate.js`). Fixed overlapping outbox flushes that could show "Sent" for a lost result.
- **First real results: Harsh** (only Maggi). → **#81 (1.36.0)** salt and oil assumed; "lentils" = dal; kadai dal; chai and coffee need milk and a saucepan. **#82** share page no longer refills old JSON.
- **Banana Singh** (only boiled eggs, twice). → **#83 (1.37.0)** pot dishes, one-away padding for thin kitchens, latest run per tester in reports.
- **Diagnosis (22 Nov):** real kitchens are **ingredient-limited, not kit-limited** (6 to 7 of 37 meals feasible); the catalogue was shaped around pranjal's own kitchen (paneer, whey, air fryer, protein bread, onion+tomato); the video agent skipped closed jars. → **#84 (1.38.0)** dal in any pot, plain egg bhurji in a pot. **#85 (1.39.0)** "Do you have any of these?" quick check, 19 bare-kitchen dishes, chai meals, strainer assumed. Harsh 4 → 8 meals, Banana 3 → 6.
- **#86 (1.40.0)** Old links showed the old flow: saved runs resumed at a screen index that new screens had shifted. Runs now carry the version; Start fresh button; `version.json` makes stale pages reload.
- **#87 (1.41.0)** Cookware row and "Anything else?" box in the quick check (Purujeet's video showed no stove though he has induction).
- **#88 (1.42.0)** Sorting rounds replaced with Yes/No meal cards plus optional difficulty ratings.
- **#89 (1.43.0)** **pranjal: a dating-app swipe gives the wrong message.** Cards and swipes removed; Kiron-style list with Effort and Taste stars. Explanatory copy and both gradients removed.
- **#90 (1.44.0)** Testers mis-tapped in the scrolling list → **one dish per screen**. Quick check became **confirm screens** (everything ticked, untick what's wrong). Bonus dish added.

### 23 Nov: hardening the tester flow (1.45 to 1.50)
- **#91 (1.45.0)** The 1.44 tap filter was eating real iPhone taps (time-based gates vs momentum scroll). Now a tap is dropped only if the finger moved > 16 px or it repeats a screen-changing tap within 350 ms. **Never add time-based tap gates again.** Phone Back goes back one screen.
- **#92 (1.46.0)** Hello lines really fade in one at a time (a duplicate `class` attribute had silently broken it); draggable recipe sheet; multi-reason can't-make; feedback screen removed; bonus explained first.
- **#93** "Pages not refreshing" was a **failed deploy** (GitHub artifact lag), not caching. Deploy now retries once. First check for "old version on my phone": the latest main Actions run.
- **#94 Catalogue prompt v2:** misses cost more than extras (testers untick), zone-by-zone sweep, identify unlabelled jars, per-item confidence.
- **#95 (1.47.0)** The v2 video kitchen (protein pantry, induction, one pot, air fryer, no veg/pan/microwave) had 5 meals; 5 one-pot protein dishes took it to 11. Kit never maps to food (a milk frother had counted as milk).
- **#96 (1.47.1)** Bare site greeted the last tester whose link pranjal opened; the name now comes from the link only. Patch bumps keep in-progress runs.
- **Audit of 1.47.1** (`/mnt/project-files/audit/harveys-audit-2026-11-23.md` in the project, not the repo). Biggest gap: no real data since 1.41. → **#97 (1.48.0)** sends survive closing the page (`sendBeacon` + 3 s/10 s retries); dishes rated in shuffled order (position bias in effort stars was flattering Marco); next rating scrolls into view on iPhone SE.
- **Banana Singh 1.48.0 run.** → **#98 (1.49.0)** "+N meal ideas" toast; added items' dishes reach the screen. pranjal: "let them rate all dishes". **#99 (1.50.0)** rate exactly what the confirmed kitchen can make, no one-away padding; bonus is the one extra (pranjal's call).

### 24 Nov
- **Purujeet 1.50.0 run** (first clean run on the current flow). → **#100 (1.51.0)** egg dishes cost 2 extra hands-on minutes.

---

## 3. Decisions and rules that live only in chat

**Product**
- Easiest dishes first, after balancing macros. No energy modifiers, no energy picker. pranjal's tired-state Marco taps are the baseline.
- Card or carousel picking for real users comes much later.
- Testers rate every dish their confirmed kitchen can make; the bonus round is the single one-item-away dish.
- Non-veg (chicken) is deferred; pranjal decides later.
- Novice/persona role-play results stay pooled into Marco's shared weights by default (pranjal's call); `--persona` only filters for inspection.

**Design (pranjal's rules)**
- **No gradients** unless pranjal asks.
- **No dating-app swipe or card UI.**
- **Cut explanatory text**; keep only direct instructions. Communicate purpose through layout and wording.
- **Testers are non-technical** and fumble basics, so every step must be obvious. One thing per screen, big targets.
- Ground design in real evidence: the Kiron repo (`pranjalparashar1/kiron`, its PM record and design system) is the reference. The rung-sorting quiz (PR #75) is the example of the ambition pranjal wants.

**Working style**
- Ship fast, small experiments, information gain per unit time. Noisy but directionally right beats perfect.
- Be ambitious: go beyond the literal ask when it makes the result much better.
- **pranjal approves merges by saying "merge it".** Never merge otherwise.
- Keep replies short. Prefer new threads for new work.

**Ops**
- The video agent prompt is uploaded by hand with each video; API integration later.
- New owner pages must be added to the `cp` list in `.github/workflows/pages.yml` (a test checks it).
- Keep results `harveys-rung-quiz/1` and additive so the relay needs no redeploy.
- Bump minor (x.y.0) when quiz screens change meaning: that resets in-progress runs. Patch bumps keep them.
- The cloud container can't reach `workers.dev` (test the relay from a phone; a GET returns `ready: true`), can't download WebKit and can't spawn a local http server. Walk the site with Chromium + `ctx.route` serving files from disk.

---

## 4. Open questions and next steps

**Open items**
1. **Thin kitchens that have neither a pan nor onion.** Pan blocks about 16 dishes and onion about 11. Need more dishes that use neither (one pot, kettle, tawa, no-cook). Highest value for coverage.
2. **Air fryer may be easier than ranked.** Two signals only. Check the next batch before touching it.
3. **Easy vs tasty tension** (Purujeet). If easy dishes keep scoring low on taste, "easiest first" may need a taste floor. Watch, don't build yet.
4. **Non-veg:** waiting on pranjal.
5. **Resent edited answers aren't saved** (low priority). The relay is create-only per tester id, so a tester who edits and resends keeps the first file and still sees success.
6. Video agent API integration (later).
7. Catalogue prompt v2 idea: show `guess`-confidence items unticked on the confirm screens.
8. Prep-quiz round 4 answers never came in; the "Cooked this" log hasn't reached the 20 to 30 dinners needed for a refit.

**Recommended next steps**
1. **Get the next batch of testers** (3 to 5) on 1.51.0 before changing the flow again. Information per unit time comes from real runs now, not more screens.
2. After each batch: `node scripts/kitchen-tests.mjs score` and `feedback`; check `confirm.removed`, `confirm.unmatched` ("New from testers"), `feedback.makes`, egg and air-fryer effort agreement, and taste on the easiest dishes. Tell pranjal what's new.
3. Build a small set of no-pan, no-onion dishes for thin kitchens, replayed against the real kitchens in `data/kitchen-tests/` with before/after counts.
4. Only refit `frictionTheta` from tester stars once there are several more testers; always clamp positives and never overwrite pranjal's baseline without asking.
