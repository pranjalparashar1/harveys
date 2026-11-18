# Marco

Tells you what to cook right now, from what you already have, that you will actually make.

## Web prototype

**Live:** https://pranjalparashar1.github.io/marco/ (after GitHub Pages is enabled, see below)

1. **Your AI.** Paste an API key from Claude, OpenAI or Gemini. The provider is detected from the key's format, the same way Cals does it. The key is stored only in this browser's `localStorage` and sent only to that provider.
2. **Scan your kitchen.** Add up to 8 photos (fridge, shelves, counter, drawers). They are shrunk to 1280 px and sent in one request.
3. **What your AI spotted.** The AI returns a structured list of food, appliances, cookware and utensils. It never picks a meal. Remove mistakes, add what it missed.
4. **Right now.** Energy (fresh / okay / tired), meal or snack, time, and what's left of today's protein, calories and fiber.
5. **Cook this.** Marco's brain ranks its catalogue and shows the simplest meal you'll actually make, with the steps and a breakdown of why it won.
6. **Your AI's recipe ideas** (1.1). With a key, the AI also designs up to 3 recipes from your inventory in a strict schema. `src/brain/validate.js` rejects anything Marco can't verify (unknown ingredients or kit, impossible macros) and corrects friction the AI understated (a knife and board for chopping, one dish per pan and utensil, at least half a minute per step). Survivors then go through the same inventory filter and score as the catalogue. The AI proposes; Marco picks.

### Per-photo scanning (1.3)

On a real iPhone, 1.2's single 7-photo request (about 1 MB, raced on two models, so uploaded twice) got no answer from Gemini within 12 s. In 1.3:
- **Each photo is its own small request** (640 px, about 60–120 KB), and all of them are sent at once.
- **A silent model gets company.** If a photo has no answer after 5 s, a second, lighter model starts alongside the first.
- **No waiting on stragglers.** Once 60% of the photos are in, the slowest gets 2.5 s more, then Marco moves on with what it has.
- **Least thinking first.** Gemini 3 is asked for `thinkingLevel: minimal`. If a model rejects that, Marco steps up to `low`, never straight to full thinking.
- **A fuller debug log.** It records every request (sent, size, answered or failed, and how long) and survives a reload.

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
- **λ_context:** mood × late night × weekday/weekend.
- **Weights:** `src/brain/config.js` is the only place tunable numbers live. **They are placeholders** (equal weights) until they're fitted to the meal log.
- **Catalogue:** `src/brain/catalogue.js`, 26 seeded lazy meals with structured friction data. **Vocabulary:** `src/brain/vocabulary.js`, the ids the AI maps what it sees onto.

### Run and test locally

```
npm test                     # Node 22+, no dependencies
python -m http.server 8000   # then open http://localhost:8000
```

### Enable GitHub Pages (once)

Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. Every push to `main` then runs the tests and deploys.
