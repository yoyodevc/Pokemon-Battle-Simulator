# Battle League

## Local play

Requires Node.js 24 or later. Run `npm install` and `npm run dev`.
The command starts Vite and the authoritative League server together. Open the
Vite URL followed by `/#league`. Guests need no Supabase configuration.

Create a duel invitation, open it in another browser profile or private window,
accept it, and lock both teams. Different tabs in the same browser profile share
one trainer session. CPU and pass-and-play battles remain under `/#battle`.

The backend defaults to port 3001. To change it, update `LEAGUE_PORT` in `.env`
and the corresponding Vite proxy target. Vite can choose another available
frontend port; include its exact origin in `LEAGUE_ORIGINS`.

## Accounts

Supabase handles registration, email verification, password login, and password
recovery. The League server validates the Supabase access token directly with
Supabase before issuing its own HttpOnly, SameSite session cookie. Passwords
are never handled or stored by the League server.

1. Create a Supabase project with email/password authentication enabled.
2. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env`, using
   `.env.example` as the reference. Use the publishable/anonymous key, never a
   secret or service-role key. These public values are supplied to the client.
3. In Supabase Authentication URL Configuration, set the site URL to the
   frontend origin and allow that origin's `/**` redirect URLs. For local
   testing, include `http://localhost:5174/**` and the actual Vite origin.
4. Keep email confirmation enabled. Configure a real SMTP provider before
   inviting public users; provider defaults may restrict email delivery.
5. Restart the server. Create and verify an account from the Lounge.

An authenticated account created from a guest session retains the guest's
trainer ID and battles when that account does not already have a trainer.
Signing into an existing trainer restores that trainer instead of merging
two identities. Guest cookies expire after seven days.

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

SQLite persists profiles, hashed session tokens, social relationships,
invitations, and match snapshots in `.league/league.sqlite`. The initial schema
is applied automatically from `server/schema.sql` (`user_version = 1`). Back up
the SQLite database using SQLite's backup API or while the server is stopped;
WAL files may contain recent transactions. `.league` and `.env` are gitignored.
Presence is transient. On restart, live battles receive a fresh reconnect window;
interrupted team loading returns to preparation.

## Deployment

This implementation needs a long-running, **single-instance Node server and a
persistent disk**. It is not a static-only deployment or a Cloudflare Worker.
Keep all installed dependencies available to the server's TypeScript loader.

Run `npm run build`, then `npm start`. The League server serves both the built
frontend and `/api/league`. Put it behind an HTTPS reverse proxy, set
`NODE_ENV=production`, and set `LEAGUE_ORIGINS` to the exact public origin.
Preserve SSE streaming and disable reverse-proxy buffering on `/api/league/events`.
Persist `LEAGUE_DATABASE` on the deployment volume. Never expose the SQLite file.
Do not run multiple replicas against independent copies of the database.

For LAN development, open the Vite network URL, add that origin to
`LEAGUE_ORIGINS`, and share invitations created from that network URL.
`localhost` invitations cannot be opened from another computer.

## Verification

- `npm run build`: frontend typechecking and production assets.
- `npm run test:league`: server authorization and multiplayer lifecycle tests.
- `npm test -- --run src/engine/turn.test.ts`: existing battle-engine checks.
- `node scripts/league-browser-check.mjs <path-to-playwright/index.js>`:
  two independent browser contexts, invitation, team lock, real turn resolution,
  refresh recovery, forfeit, rematch, and mobile overflow. This script uses an
  existing Playwright installation and defaults to Chrome on Windows.

External PokeAPI access is required for roster and battle-data hydration.
Starter sprites are bundled; other Pokemon sprites load from Pokemon Showdown.
Supabase signup, confirmation-email delivery, and password reset must be verified
against the configured project before public release.
