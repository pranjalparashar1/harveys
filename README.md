# Marco

Tells you what to cook right now, from what you already have, that you will actually make.

## Web prototype

**Live:** https://pranjalparashar1.github.io/marco/ (after GitHub Pages is enabled, see below)

1. **Your AI.** Paste an API key from Claude, OpenAI or Gemini. The provider is detected from the key's format, the same way Cals does it. The key is stored only in this browser's `localStorage` and sent only to that provider.
2. **Scan your kitchen.** Add up to 8 photos (fridge, shelves, counter, drawers). They are shrunk to 1280 px and sent in one request.
3. **What your AI spotted.** The AI returns a structured list of food, appliances, cookware and utensils. It never picks a meal. Remove mistakes, add what it missed.
4. **Right now.** Energy (fresh / okay / tired), meal or snack, time, and what's left of today's protein, calories and fiber.
5. **Cook this.** Marco's brain ranks its catalogue and shows the simplest meal you'll actually make, with the steps and a breakdown of why it won.

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
