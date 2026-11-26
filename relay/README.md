# Send relay: one-tap Send from any phone

Friends open the link, do the taste test, tap **Send to Harvey's**, and the result lands in `data/kitchen-tests/` on `main`. They need no token, no account and no download. The GitHub token lives as a secret in a free Cloudflare Worker ([`worker.js`](worker.js)), never in the page or the repo.

Since 1.61.0 the same Worker also runs the **free kitchen scan** (`POST /scan`, code in [`scan.js`](scan.js)): a new user's photos, or stills cut from a short video on their phone, go to Gemini flash-lite with Harvey's own key, so nobody needs an API key to start. See [Free scan](#free-scan-1610) below.

What the Worker allows: only requests from `pranjalparashar1.github.io`, only a valid `harveys-rung-quiz/1` result under 200 KB, a file name it builds itself, create-only (nobody can overwrite a result), and about 20 sends per IP per 10 minutes. To switch sending off, delete the `GITHUB_TOKEN` secret.

## Setup (about 5 minutes, once)

**1. Make the token** at github.com → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   - Token name: `harveys-relay`. Expiration: 90 days (sends wait on phones if it lapses; make a new one and repeat step 4).
   - Repository access: **Only select repositories** → `pranjalparashar1/harveys`.
   - Permissions → Repository permissions → **Contents: Read and write**. Metadata: Read-only is added for you. Nothing else.
   - Generate, and copy the token (`github_pat_…`).

**2. Make the Worker** at dash.cloudflare.com (sign up free with an email if you have no account) → **Workers & Pages** → **Create** → **Create Worker** (the "Hello World" start) → name it `harveys-send` → **Deploy**.

**3. Deploy the code** (since 1.61.0 the Worker imports the app's own scan prompt, so it is deployed with wrangler, not pasted): see [Free scan](#free-scan-1610).

**4. Add the token:** Worker → **Settings** → **Variables and Secrets** → **Add** → Type **Secret**, Name `GITHUB_TOKEN`, Value the token from step 1 → **Deploy**.

**5. Check it:** open the Worker's address (shown on its page, like `https://harveys-send.<you>.workers.dev`). It should say `{"ok":true,"relay":"harveys","ready":true}`.

**6. Turn it on in the app:** done in 1.33.1: `RELAY_URL` in [`src/send.js`](../src/send.js) is `https://harveys-send.pranjalparashar1.workers.dev/`. To point one phone at another relay, open
`https://pranjalparashar1.github.io/harveys/#relay=<the address>`.

## After that

- Results arrive as commits on `main` ("Taste test: …"). They don't redeploy the site.
- Score them: `git pull && node scripts/kitchen-tests.mjs score`. The end of the output now lists the ingredient check across kitchens.
- No signal on a friend's phone: the result waits on the phone and retries every 30 s while the page is open, and on the next open.
- The old token-on-the-phone path (`#send=<token>`) still works as a fallback if the relay is ever down.

## Free scan (1.61.0)

`POST /scan` takes `{ images: [{ base64, mediaType: 'image/jpeg' }] }` (1 to 8 images, 2.5 MB in all; the app shrinks photos to 640 px and cuts a video into up to 8 stills before sending) and answers `{ have, other, model, ms }`, the same compact form a scan with your own key gets.

- **Model:** `gemini-3.1-flash-lite`, then `gemini-3.5-flash-lite` if 3.1 is busy or silent. Flash-lite only (`SCAN_MODELS` in `scan.js` refuses anything else).
- **Limits:** the app's origin only; 3 scans per IP per 24 hours; 400 scans a day across everyone. A scan Gemini could not answer is not counted. Counts live in a Durable Object (`ScanQuota`, global, free plan), keyed by a salted hash of the IP, never the IP itself, and expire after a day.
- **The key:** the `GEMINI_API_KEY` secret. Never sent back to the phone, never logged; Gemini's own error text is not passed on either. To switch scanning off, delete the secret: the app then offers "Start from a kitchen like yours" or "Use your own API key".
- **Optional settings** (Worker → Settings → Variables, kept across deploys): `SCAN_PER_IP`, `SCAN_DAILY_CAP`, `SCAN_SALT`.
- **Check it:** `GET /` now also says `"scan": true` once the key is set.

**Deploy** (needs Node; from this `relay/` folder; the first time, `npx wrangler login` opens the browser to sign in to Cloudflare):

```
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```

The first command asks for the key (paste it; it goes straight to Cloudflare). The second uploads `worker.js` with `scan.js` and the app's prompt bundled in, keeps the `GITHUB_TOKEN` secret and any dashboard variables, and creates the `ScanQuota` Durable Object. If wrangler warns that the Worker was edited in the dashboard, say yes: this replaces the pasted 1.33.0 copy with the same code plus `/scan`.
