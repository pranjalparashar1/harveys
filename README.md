# Marco

Tells you what to cook right now, from what you already have, that you will actually make.

## Web prototype

**Live:** https://pranjalparashar1.github.io/harveys/ (after GitHub Pages is enabled, see below)

1. **Your AI.** Paste an API key from Claude, OpenAI or Gemini. The provider is detected from the key's format, the same way Cals does it. The key is stored only in this browser's `localStorage` and sent only to that provider.
2. **Scan your kitchen.** Add up to 8 photos (fridge, shelves, counter, drawers). They are shrunk to 1280 px and sent in one request.
3. **Spotted.** The AI returns a structured list of food, appliances, cookware and utensils. It never picks a meal. Remove mistakes, add what it missed. Kept in memory only, so every reload starts clean (1.3.2).
4. **Right now.** Meal or snack, time, and what's left of today's protein, calories and fiber. Mood/energy is not asked from 1.3.2 on; λ then has no mood factor (neutral, same as "okay"), and `contextLambda` still accepts a mood when the page asks again.
5. **Cook this.** Marco's brain ranks its catalogue and shows the simplest meal you'll actually make, with the steps and a breakdown of why it won.
6. **Your AI's recipe ideas** (1.1). With a key, the AI also designs up to 3 recipes from your inventory in a strict schema. `src/brain/validate.js` rejects anything Marco can't verify (unknown ingredients or kit, impossible macros) and corrects friction the AI understated (a knife and board for chopping, one dish per pan and utensil, at least half a minute per step). Survivors then go through the same inventory filter and score as the catalogue. The AI proposes; Marco picks.

### Scanning against real Gemini (1.3)

Measured on 18 Nov 2026 with a real key on `gemini-3.5-flash-lite`. Gemini's response time is set by its queue, not by the photos: a request takes either about 1–2.5 s or about 7–8 s (once 18 s), whether it has 1 photo, 3 photos or none. Thinking was already at 0 tokens and replies were about 20 tokens. So:
- **Small groups.** Photos go in groups of up to 4 per request, at 640 px.
- **Repeat sends.** If a request has no answer, the same request goes to the **same flash-lite model** again every 2.5 s, up to 3 copies. The first copy back wins.
- **Flash-lite only.** For Gemini, Marco uses and offers flash-lite models only. `gemini-2.5-flash-lite` returns 404 for new keys.
- **Results.** 8 of 8 scans succeeded from a script (typical 6.8 s, slowest 7.9 s), and 6 of 6 through the page itself (1.3–8.9 s).

### Speed budget (1.2)

A recipe appears within 15 s of tapping Scan, every time:
- Photos go at 768 px. Gemini reads them at medium resolution and OpenAI at low detail.
- The AI replies in a compact form (`{"have": [ids], "other": [names]}`) instead of a full object per item, which is most of the speed-up.
- Two fast models are asked at once. The first good answer wins, and the other request is cancelled.
- Each call has a hard deadline: 12 s for the scan and 9 s for recipe ideas. iOS Safari otherwise cuts requests off at about 60 s with "Load failed".
- Marco's brain picks straight after the scan. Recipes the AI designs arrive later and can only upgrade the pick.
- If the AI never answers, the pick uses your last scan, or the sample kitchen with a clear note.
- The **Debug** panel at the bottom of the page shows each stage's time, the real HTTP status and error text, and the typical and slowest time over the last 10 scans. "Copy for Claude" copies all of this without the key.

### Reliability (1.1)

Every AI call retries twice with backoff on 5xx/429 (Gemini's 503 "high demand", Anthropic's 529), times out after 75 s instead of hanging, then falls back to other light, stable models the key can use. When a fallback works, Marco keeps using that model. Gemini "thinking" is turned down for scans, which makes them faster.

No key? "Try a sample kitchen" loads a kitchen like pranjal's so the brain can be tested without any AI call.

### The brain (`src/brain/`)

Pure ES modules: no DOM, no network, no clock, no randomness. Written to port to the Foundation-only Swift package (MarcoCore).

```
1. hard filter    missing kit or a required ingredient drops the meal
2. score          payoff − λ_context × Σ w_i · f_i
3. explain        every score is returned as named parts
```

- **Payoff:** progress toward what's left of today's protein, calories and fiber, capped at the target.
- **Friction (v2, 1.9.0):** the same features the pick-two trainer uses (`FEATURES` in `src/brain/learn.js`): tools (the stove isn't a tool on top of its pan), hands-on minutes, waiting minutes, pre-prep (soaking, on a log scale), things to peel, things to cut, steps, attention, washing up. Weights are learn.js's provisional priors, not capped.
- **Diet:** vegetarian plus eggs. `rank()` and `validateMeal()` both drop anything failing `inDiet()`, the vocabulary has no meat or fish ids, and the AI prompt states the rule. Tofu is left out by preference.
- **λ_context:** mood (optional, neutral when absent) × late night × weekday/weekend.
- **Weights:** payoff and λ live in `src/brain/config.js`; friction weights live in `learn.js` `FEATURES`. **All are placeholders** until they're fitted to real choices.
- **Catalogue:** `src/brain/catalogue.js`, seeded lazy meals with structured friction data. **Vocabulary:** `src/brain/vocabulary.js`, the ids the AI maps what it sees onto.

### Run and test locally

```
npm test                     # Node 22+, no dependencies
python -m http.server 8000   # then open http://localhost:8000
```

### Enable GitHub Pages (once)

Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. Every push to `main` then runs the tests and deploys.

### Fresh files on every deploy (1.3.3)

GitHub Pages caches every file for 10 minutes, so after the 1.3.2 deploy an iPhone ran the new `index.html` with the old `app.js` and `styles.css`: the scan crashed on a removed element and the icons rendered unstyled. The deploy now runs `scripts/stamp.mjs`, which gives the stylesheet, `app.js` and every module import a `?v=<commit>` URL, so a page only ever loads files from its own build. A test checks that every element `app.js` looks up exists in `index.html`.

### Seeing the whole kitchen, and never picking non-food (1.3.4)

Measured on pranjal's 6 real kitchen photos (19 known items in Marco's vocabulary), gemini-3.5-flash-lite, same 640 px photos:
- 1.3.3: 11–13 of 19 found when every photo was read, 7 when the 2.5 s cutoff dropped photos. Packets, jars and bagged food were mostly missed.
- 1.3.4: 16–19 of 19. The scan prompt now asks for every item shelf by shelf, reads packet labels (a brand counts as its food), and includes food in clear bags. Marco waits 5 s, not 2.5 s, for the last photo group.
- A nutrition gate (`nutritionProblems` in `src/brain/validate.js`, thresholds in `config.js`) rejects any meal under 8 g protein (5 g for a snack), over 45 kcal per gram of protein, or made only of fats, spices and spreads. It applies to AI recipes and the catalogue alike. It is **off by default** (`nutritionGate.enabled: false`): odd lowest-friction ideas such as "100 g butter with salt" are allowed to surface, as proof the ranker optimises friction and as possible inspiration.
- The whey and makhana bowl is now a catalogue meal, so Marco can pick it without the AI.

### Training Marco and Pierre: pick two (1.4.0)

`train.html` (the **Train** link on the main page) shows two dishes. Tap the one you'd cook tonight, or **Neither**, and give either a Pierre verdict (pass, meh, fail, plus an optional why). Marco is the whole brain; Pierre is the taste layer inside it (good result with maximal simplicity, not austerity).

- **Pool:** built-in meals (vegetarian + eggs only), pan-fried paneer, your own dishes (form, or pasted JSON from Claude), and AI-invented ones (**Invent 4 dishes**, uses the key saved on the main page; Gemini keys use flash-lite only).
- **Pierre** (`src/brain/learn.js`): a logistic model over technique tags (method × main ingredient, e.g. `microwave × paneer`), seeded with the 19 Nov chat verdicts. It guesses a verdict for dishes nobody judged.
- **Marco:** a Bradley–Terry model, P(A over B) = σ(u_A − u_B), u = θ·x over protein, Pierre and friction (tools without the stove, hands-on, waiting, pre-prep, peels, cuts, steps, attention, washing up). θ starts at a prior and is fit by MAP after every tap; "Neither" fits a would-cook threshold; λ per mood (fresh, okay, tired) is fit once a mood has 4 picks. Weights are shown as grams of protein you'd give up to avoid one more of each.
- **Data** stays in this browser. **Copy for Claude** exports picks, verdicts, dishes and the fit.

The live ranker (`ranker.js`, `config.js`) is unchanged: fitted weights move there only after review. A pasted item list (one per line or comma-separated) now works as the inventory on the main page.

### Pierre-trainer: rate raw foods (1.5.0)

`pierre.html` (the **Begin** button at the top of Train) is a quiz on Kiron's player: rounds of 7 raw foods, the user's own kitchen first, Each food takes three screens: **texture** (crisp, creamy, chewy, juicy, flaky: none to high), **taste** (salt, sweet, fat, acid, heat and **canvas**, whose flavour comes from technique or additions, plus fresh as Pierre's bonus: none to high) and **how central** it is to a meal (1 accent to 5 the meal). Every tap toggles; no streaks or timer. Back (‹) returns to the previous screen, into the previous food too. Each food's first screen has two toggles, **Rate it** and **Part of prep** (needs further processing): a food is rated, prep, or both (paneer). Prep only (soaked poha) skips the ratings and exports as `poha | prep`; both adds `| prep` to the rating line. Prep foods go into the brain file's `prep` list for Pierre-tutor. Progress is saved after every screen.

- **Quiz file:** `src/quiz/pierre-trainer.json` (45 foods, veg and eggs, no spices or condiments, and plain foods only: protein bread is a macro modifier for later, so it is plain bread here; rated as plainly eaten, so rice, dal and pasta are cooked plain. Besan, suji and vermicelli wait for Pierre-tutor, since they are cooked too many ways). Engine: `src/quiz/quiz.js`.
- **Remove from list** (1.7.0): under every food's name. A removed food is sent as `id | remove` and the ingest adds it to the brain's `excluded` list.
- **Round 2** (1.7.0): 40 new foods, everyday ones first. Round-1 ids are kept in the quiz file under `done.round1`.
- **Pierre-tutor** (1.8.0, `tutor.html`): the same player rates 52 food × technique pairs (eggs scrambled, paneer microwaved, mushrooms sautéed…), chosen from the foods marked part of prep. Every pair is one food and one technique with a repeatable result. Gravies, tadkas, shakes and filled batters are left out, because their result depends on what else goes in. Each pair gets texture, taste and **How ready?** (1.8.1). The scale runs 4 eat it as it is, 3 needs only seasoning, 2 needs something added, 1 needs another cooking step (boiled soya chunks), 0 inedible (a veto). Readiness says nothing about taste. It's Marco's finishing friction: `dishProfile` reports `finish` per part, plus `inedible` and `unfinished`. It's sent the same way, and the ingest writes it to the brain's `tech` section, where `partVector` uses it in place of the raw food.
- **Send to Harvey's:** opens a prefilled GitHub issue (and copies the same text). To pull it into the brain: `node scripts/ingest-pierre.mjs export.txt`, which rewrites `src/brain/pierre-raw.js`.
- **Knowledge base:** `src/brain/ingredients.js`. Centre 3+ is a major ingredient; the top food anchors the dish; majors within 1 of it are co-leads; a food's pull on texture doubles per step. A technique layer (`paneer@fried`) is ready for Pierre-tutor.

### Everyday staples (1.20.0)

From pranjal's "The staples and their processes": dal tadka with rice, pressure-cooker chole, rajma and kala chana (tadka first, in the cooker), paneer pulao, egg fried rice, Maggi (plain, cheese, fried egg), air-fried soya chunks and masala oats. New food ids `rajma`, `kala_chana` and `maggi`. Where round 3 or the staples sheet already rated a dish, that rating is its Pierre verdict in `PIERRE_SEED`. Soaking is pre-prep, so those dishes keep their rung and say "If you have time".

### Soaked or not (1.21.0)

Dishes that need soaking (dal, rice, chole, rajma, kala chana) list those foods in `prePrep.soak`. Under "Right now", tick what's already soaked; the ticks last until midnight. A dish whose foods are all soaked ranks with no soaking cost. Any other soak dish leaves tonight's ladder for a "For tomorrow" card ("Soak the rajma tonight"). Poha's 15-minute soak stays an "If you have time" note. Egg fried rice is pass without spring onion and crave with it, as a separate dish (new food id `spring_onion`).
