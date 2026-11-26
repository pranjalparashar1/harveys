# Send relay: one-tap Send from any phone

Friends open the link, do the taste test, tap **Send to Harvey's**, and the result lands in `data/kitchen-tests/` on `main`. They need no token, no account and no download. The GitHub token lives as a secret in a free Cloudflare Worker ([`worker.js`](worker.js)), never in the page or the repo.

Since 1.61.0 the same Worker also runs the **free kitchen scan** (`POST /scan`, code in [`scan.js`](scan.js)): a new user's photos, or stills cut from a short video on their phone, go to Gemini flash-lite with Harvey's own key, so nobody needs an API key to start. See [Free scan](#free-scan-1610) below.

Since 1.64.0 it also takes the **live cook log** (`POST /log`): every "Cooked this" and "Fix / Veto" tap, sent in the background. See [Live cook log](#live-cook-log-1640) below.

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

## Live cook log (1.64.0)

`POST /log` takes one `harveys-cook-log/1` ("Cooked this") or `harveys-live-repair/1` ("Fix / Veto") event, `{ format, version, deviceId, eventId, at, entry }`, and commits it as a new file `data/cook-logs/cook-<date>-<deviceId>-<eventId>.json` (or `repair-…`).

- **Anonymous:** `deviceId` is a random id made on the phone; no names, keys or user agents. The Worker rebuilds the event from the keys it knows and drops the rest.
- **Limits:** the app's origin only; 16 KB; strict schema; 30 events per IP per 24 h, counted apart from taste-test sends. Create-only: a resend of the same `eventId` answers `{ ok: true, duplicate: true }`.
- **Refit:** `git pull && node scripts/refit-cooklog.mjs` pools the folder (`--device <id>` for one phone) and lists live Fix / Veto disagreements. It prints weights; it never edits config.
- **Deploy:** no new secret (it uses `GITHUB_TOKEN`). From this folder: `npx wrangler deploy`. `GET /` then also says `"log": true`.

## Free scan (1.61.0)

`POST /scan` takes `{ images: [{ base64, mediaType: 'image/jpeg' }] }` (1 to 8 images, 2.5 MB in all; the app shrinks photos to 640 px and cuts a video into up to 8 stills before sending) and answers `{ have, other, model, ms }`, the same compact form a scan with your own key gets.

- **Model:** `gemini-3.1-flash-lite`, then `gemini-3.5-flash-lite` if 3.1 is busy or silent. Flash-lite only (`SCAN_MODELS` in `scan.js` refuses anything else).
- **Limits:** the app's origin only; 3 scans per IP per 24 hours; 400 scans a day across everyone. A scan Gemini could not answer is not counted. Counts live in a Durable Object (`ScanQuota`, global, free plan), keyed by a salted hash of the IP, never the IP itself, and expire after a day.
- **The key:** the `GEMINI_API_KEY` secret. Never sent back to the phone, never logged; Gemini's own error text is not passed on either. To switch scanning off, delete the secret: the app then offers "Start from a kitchen like yours" or "Use your own API key".
- **Failsafe:** see below. Scanning switches itself off and stays off until you reset it by hand.
- **Optional settings** (Worker → Settings → Variables, kept across deploys): `SCAN_PER_IP`, `SCAN_DAILY_CAP`, `SCAN_MONTHLY_CAP`, `SCAN_SALT`.
- **Check it:** `GET /` now also says `"scan": true` once the key is set, or `"scan": false, "off": "<why>"` while the failsafe holds it off.

**Deploy** (needs Node; from this `relay/` folder; the first time, `npx wrangler login` opens the browser to sign in to Cloudflare):

```
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```

The first command asks for the key (paste it; it goes straight to Cloudflare). The second uploads `worker.js` with `scan.js` and the app's prompt bundled in, keeps the `GITHUB_TOKEN` secret and any dashboard variables, and creates the `ScanQuota` Durable Object. If wrangler warns that the Worker was edited in the dashboard, say yes: this replaces the pasted 1.33.0 copy with the same code plus `/scan`.

## Failsafe (1.62.0): scanning stops until you switch it back on

The free scan switches itself **off** and stays off (through new days, new months, redeploys and restarts) when either of these happens:

1. **Monthly cap:** 1,500 scans in a calendar month (UTC), counting failed ones too. Change it with a `SCAN_MONTHLY_CAP` variable.
2. **Gemini says the money or quota is gone:** a 429 for a daily or billing quota, a 403 (key refused, API or billing off), or a 400 that names the key or billing. A short per-minute 429 from a burst of users does not count, because it clears itself.

While it's off, `/scan` answers `503 scan off`, so nothing reaches Gemini. The app then offers "Start from a kitchen like yours" and the own-key box. `GET /` shows why it's off, for example `{"scan": false, "off": "monthly cap of 1500 scans reached"}`.

The counts and the off switch live in the `ScanQuota` Durable Object: one global copy, one request at a time. A cold start or a second Worker copy can't skip them. (The Cache API was ruled out because it does nothing on a `workers.dev` address, and KV is eventually consistent.)

**To switch it back on**, from `relay/`, set the reset word to anything new, such as today's date:

```
npx wrangler secret put SCAN_RESET
```

Type a value that is different from the last one, such as `2026-12-01`. The off switch lifts at once and the month's count starts again from 0. Reusing an old value does nothing.

**To switch it off by hand:** `npx wrangler secret delete GEMINI_API_KEY`.
