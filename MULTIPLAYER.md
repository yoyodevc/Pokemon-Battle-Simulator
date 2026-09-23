# Battle League

## Local play

Requires Node.js 24 or later. Run `npm install` and `npm run dev`.
The command starts Vite and the authoritative League server together. Open the
Vite URL followed by `/#league`. A Firebase project must be configured (see
Accounts below) — even guests sign in through Firebase Anonymous Auth, so there
is no guest-only mode that skips Firebase entirely.

Create a duel invitation, open it in another browser profile or private window,
accept it, and lock both teams. Different tabs in the same browser profile share
one trainer session (Firebase persists the signed-in user to that browser).
CPU and pass-and-play battles remain under `/#battle`.

The backend defaults to port 3001. To change it, update `LEAGUE_PORT` in `.env`
and the corresponding Vite proxy target. Vite can choose another available
frontend port; include its exact origin in `LEAGUE_ORIGINS`.

## Accounts

Firebase Authentication handles registration, password login, and password
recovery. Guests are Firebase **Anonymous** users, not a bespoke cookie —
"Create an account" links that same anonymous identity to a real email/password
(`linkWithCredential`), keeping the same trainer, friends, and history. The
League server verifies the client's Firebase ID token directly (a local,
stateless JWT check — no network round trip and no server-side session to
manage) before touching any data. Passwords are never handled or stored by the
League server.

1. Create a Firebase project and enable the **Anonymous** and **Email/Password**
   sign-in providers under Authentication.
2. Set `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`,
   `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, and
   `FIREBASE_APP_ID` in `.env` (the public web config — safe to expose to the
   client), plus `FIREBASE_SERVICE_ACCOUNT_PATH` (server-only) pointing at a
   downloaded service-account key. See `.env.example`.
3. In Firebase Authentication > Settings > Authorized domains, add
   `localhost` (usually present by default) and any other origin you test from.
4. Create a Firestore database for the project (see DEPLOYMENT.md) and deploy
   `firestore.rules`/`firestore.indexes.json`.
5. Restart the server. Playing as a guest and creating an account both work
   immediately — there is no email-confirmation gate to configure.

Signing up from a guest session upgrades that same guest in place (same
trainer id, friends, and history) rather than creating a second identity.
Signing into a separate, already-registered account switches to that trainer
instead. Guest identity persists as long as Firebase keeps that browser signed
in — there is no fixed expiry.

## State and rules

- Friendship: pending -> accepted, or removed by decline/cancel/remove/block.
  Only recipients can accept or decline; only senders can cancel.
- Challenge: pending -> accepted, declined, cancelled, or expired. Invitations
  expire after ten minutes. Acceptance is single-use and reserves both players.
- Match: preparing -> loading -> battle -> ended. Leaving preparation produces
  an abandoned room, not a loss. Preparation expires after ten minutes.
- Teams: six distinct Pokemon, level 50, existing standard stat and moveset
  conversion. The first slot leads. Teams are locked when ready. Server data,
  not browser-supplied stats or moves, constructs each battle.
- Turns: 90 seconds. A lone non-submitting player loses; if neither submits,
  the result is a draw. Forced switches require only the fainted side to act.
- Disconnect: 60 seconds from the last heartbeat. Reconnecting preserves the
  locked action and match. If both disconnect, the match is a draw.
- Forfeit: immediate opponent victory during battle. Match results are counted
  from unique ended matches, so duplicate commands cannot duplicate wins.
- Rematch: both trainers must request it. A fresh preparation room is created.
- Privacy: opponents cannot read hidden roster members, unused moves, queued
  actions, or the random seed. Used moves and revealed Pokemon remain public.
  This is enforced server-side (`server/league.mjs`'s `viewMatch`), which is
  also why the frontend never reads Firestore directly — there is no way to
  express this per-viewer redaction in Firestore security rules.

SQLite persists profiles, social relationships, invitations, and match
snapshots in `.league/league.sqlite` for local development (`server/index.mjs`,
one row per entity in `server/schema.sql`, `user_version = 1`). Production
(Netlify) instead persists one Firestore document per entity — see
DEPLOYMENT.md. Back up the SQLite database using SQLite's backup API or while
the server is stopped; WAL files may contain recent transactions. `.league` and
`.env` are gitignored. Presence is transient. On restart, live battles receive
a fresh reconnect window; interrupted team loading returns to preparation.

## Deployment

Self-hosting needs a long-running, **single-instance Node server and a
persistent disk** for its SQLite database. It is not a static-only deployment
or a Cloudflare Worker. Keep all installed dependencies available to the
server's TypeScript loader. Even self-hosted, sign-in still goes through the
Firebase project configured above (`FIREBASE_SERVICE_ACCOUNT_PATH`/
`FIREBASE_SERVICE_ACCOUNT` must be set on that host).

Run `npm run build`, then `npm start`. The League server serves both the built
frontend and `/api/league`. Put it behind an HTTPS reverse proxy, set
`NODE_ENV=production`, and set `LEAGUE_ORIGINS` to the exact public origin.
Persist `LEAGUE_DATABASE` on the deployment volume. Never expose the SQLite file.
Do not run multiple replicas against independent copies of the database.

For a serverless deployment (no persistent disk, e.g. Netlify), see
DEPLOYMENT.md — that path stores state in Firestore instead of SQLite, since
concurrent function instances can't safely share a single local file.

For LAN development, open the Vite network URL, add that origin to
`LEAGUE_ORIGINS` and to Firebase's authorized domains, and share invitations
created from that network URL. `localhost` invitations cannot be opened from
another computer.

## Verification

- `npm run build`: frontend typechecking and production assets.
- `npm run test:league`: server authorization and multiplayer lifecycle tests
  (`server/league.test.mjs`, storage-agnostic).
- `node --import ./server/register.mjs --test server/serverless.test.mjs`:
  the Firestore-backed serverless handler, against an in-memory fake that
  replicates Firestore's real transaction read-set-versioning.
- `npm test -- --run src/engine/turn.test.ts`: existing battle-engine checks.
- `node scripts/league-browser-check.mjs <path-to-playwright/index.js>`:
  two independent browser contexts, invitation, team lock, real turn resolution,
  refresh recovery, forfeit, rematch, and mobile overflow. This script uses an
  existing Playwright installation and defaults to Chrome on Windows.

External PokeAPI access is required for roster and battle-data hydration.
Starter sprites are bundled; other Pokemon sprites load from Pokemon Showdown.
Firebase sign-up, sign-in, and password reset must be verified against the
configured project before public release.
