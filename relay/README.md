# Send relay: one-tap Send from any phone

Friends open the link, do the taste test, tap **Send to Harvey's**, and the result lands in `data/kitchen-tests/` on `main`. They need no token, no account and no download. The GitHub token lives as a secret in a free Cloudflare Worker ([`worker.js`](worker.js)), never in the page or the repo.

What the Worker allows: only requests from `pranjalparashar1.github.io`, only a valid `harveys-rung-quiz/1` result under 200 KB, a file name it builds itself, create-only (nobody can overwrite a result), and about 20 sends per IP per 10 minutes. To switch sending off, delete the `GITHUB_TOKEN` secret.

## Setup (about 5 minutes, once)

**1. Make the token** at github.com → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   - Token name: `harveys-relay`. Expiration: 90 days (sends wait on phones if it lapses; make a new one and repeat step 4).
   - Repository access: **Only select repositories** → `pranjalparashar1/harveys`.
   - Permissions → Repository permissions → **Contents: Read and write**. Metadata: Read-only is added for you. Nothing else.
   - Generate, and copy the token (`github_pat_…`).

**2. Make the Worker** at dash.cloudflare.com (sign up free with an email if you have no account) → **Workers & Pages** → **Create** → **Create Worker** (the "Hello World" start) → name it `harveys-send` → **Deploy**.

**3. Paste the code:** on the Worker, tap **Edit code**, delete everything in `worker.js`, paste the whole of [`relay/worker.js`](worker.js) (open it on GitHub → **Raw** → select all → copy), then **Deploy**.

**4. Add the token:** Worker → **Settings** → **Variables and Secrets** → **Add** → Type **Secret**, Name `GITHUB_TOKEN`, Value the token from step 1 → **Deploy**.

**5. Check it:** open the Worker's address (shown on its page, like `https://harveys-send.<you>.workers.dev`). It should say `{"ok":true,"relay":"harveys","ready":true}`.

**6. Turn it on in the app:** send Claude that address. It goes into `RELAY_URL` in [`src/send.js`](../src/send.js), and from then on every phone sends through it. To try it on your phone before that, open
`https://pranjalparashar1.github.io/harveys/#relay=<the address>`.

## After that

- Results arrive as commits on `main` ("Taste test: …"). They don't redeploy the site.
- Score them: `git pull && node scripts/kitchen-tests.mjs score`. The end of the output now lists the ingredient check across kitchens.
- No signal on a friend's phone: the result waits on the phone and retries every 30 s while the page is open, and on the next open.
- The old token-on-the-phone path (`#send=<token>`) still works as a fallback if the relay is ever down.
