# Marco

Tells you what to cook right now, from what you already have, that you will actually make.

## Web prototype

**Live:** https://pranjalparashar1.github.io/marco/ (after GitHub Pages is enabled, see below)

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
- **Friction:** tools, ingredients weighted by prep (ready < measure < peel/chop), steps, hands-on minutes (waiting time excluded), attention needed, cleanup (dishes + greasiness).
- **λ_context:** mood (optional, neutral when absent) × late night × weekday/weekend.
- **Weights:** `src/brain/config.js` is the only place tunable numbers live. **They are placeholders** (equal weights) until they're fitted to the meal log.
- **Catalogue:** `src/brain/catalogue.js`, 26 seeded lazy meals with structured friction data. **Vocabulary:** `src/brain/vocabulary.js`, the ids the AI maps what it sees onto.

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
- A nutrition gate (`nutritionProblems` in `src/brain/validate.js`, thresholds in `config.js`) rejects any meal under 8 g protein (5 g for a snack), over 45 kcal per gram of protein, or made only of fats, spices and spreads. It applies to AI recipes and the catalogue alike, so "100 g butter with salt" can never be picked again.
- The whey and makhana bowl is now a catalogue meal, so Marco can pick it without the AI.
