# Cloudflare

The online League runs as one Cloudflare Worker. The Worker serves the built
frontend from `dist` and sends every `/api/league/*` request to a single
Durable Object (`LeagueObject` in `cloudflare/worker.mjs`). That object runs the
same `server/league.mjs` rules as the Node server and keeps all League data in
its built-in SQLite storage. Match updates reach players over a WebSocket at
`/api/league/socket`, and the lobby keeps polling as before.

Sign-in still uses Firebase Authentication. The Worker checks Firebase ID tokens
itself with Google's public keys, so no service-account key is needed. Firestore
is not used on Cloudflare.

Everything here fits the Workers Free plan: the Durable Object is SQLite-backed
and uses WebSocket hibernation.

## Run locally

1. `npm install`
2. Copy `.dev.vars.example` to `.dev.vars` and fill in the six Firebase web
   config values (the same ones `.env` used).
3. `npm run dev`. This starts `wrangler dev` on port 8787 and Vite, which
   forwards `/api/league` (including the WebSocket) to it.
4. Open the Vite URL followed by `/#league`.

Local League data lives in `.wrangler/state`. Delete that folder to start fresh.

## Deploy

1. `npx wrangler login` (once).
2. `npm run deploy` builds the frontend and runs `wrangler deploy`.
3. Add the six `FIREBASE_*` values with `npx wrangler secret put FIREBASE_API_KEY`
   and so on. Secrets survive later deploys, while variables typed into the
   dashboard are wiped by the next `wrangler deploy`. Add `LEAGUE_ORIGINS` the
   same way only if the site is opened from an origin other than the Worker's own.
4. In Firebase Authentication > Settings > Authorized domains, add the
   `*.workers.dev` domain (and any custom domain).

## Free plan limits that matter

- **100,000 Worker requests and 100,000 Durable Object requests per day.**
  Every League call counts once against each. The page polls every 5 seconds
  during a match and every 10 seconds in the lobby, so one player online for an
  hour uses roughly 400 to 700 of each. A match WebSocket counts as one request
  when it opens, and pushed updates are free.
- **13,000 GB-s of Durable Object time per day**, a little over 28 hours for
  one object. There is only one object, so it cannot run past the daily
  allowance even if someone is online all day.
- **100,000 SQLite rows written per day.** Only changed records are written,
  and polling alone writes nothing. A cold battle adds a few hundred cache rows.
- **50 outgoing requests per invocation.** Building a battle from scratch takes
  a few hundred PokeAPI calls. The Durable Object caches every PokeAPI response
  in SQLite and loads in steps of 40 calls, each step starting as soon as the
  last ends. To keep that off the critical path, the first start fetches the
  preset and starter teams (54 Pokemon) in the background, which takes about a
  minute, and a player's team starts loading the moment they ready up instead
  of when both have. Teams made of other Pokemon still wait a few seconds the
  first time, then are cached for good.
- **5 GB of Durable Object storage** on the account. Cached PokeAPI responses
  are the largest part. The preloaded set is well under 100 MB.

## Notes

- Existing Firestore data is not copied over. Trainers start fresh on
  Cloudflare, though Firebase accounts keep working because the same Firebase
  project still handles sign-in.
- All League traffic goes through one Durable Object, the same single-instance
  model as `server/index.mjs`. That keeps the League rules race-free and is
  plenty for a hobby-sized player base.
