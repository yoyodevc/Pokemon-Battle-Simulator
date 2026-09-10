# Netlify + Supabase

Netlify serves the frontend/assets and runs the authoritative battle API. Supabase stores trainers, sessions, friends, blocks, invitations, matches/replays, saved teams and presence, and provides account authentication. The local `npm run dev` server still uses SQLite.

1. Create a Supabase project and run `supabase/migrations/202609100001_league.sql` in its SQL editor. The table is private: browser roles have no access; only the server key can read/write it.
2. In Netlify, import this repository. `netlify.toml` sets the build command, output directory and function bundler. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in Netlify environment variables with Functions scope. Keep the service-role key server-only; never use a `VITE_` prefix. Redeploy after setting them.
3. In Supabase Authentication URL Configuration, set Site URL to your Netlify HTTPS URL and add that URL to allowed redirect URLs. Enable email/password authentication and email confirmation. Add any custom domain you use as well.
4. To preserve existing data, stop the local League server before importing and keep the new site unused until import finishes. Populate the same three variables in your ignored local `.env`, then run:

   ```powershell
   node --env-file=.env scripts/migrate-supabase.mjs
   ```

   This reads `.league/league.sqlite` (or `LEAGUE_DATABASE`) without changing it and refuses to overwrite an already-used destination. Keep a backup of the SQLite file. Existing Supabase account IDs require the same Supabase Auth project; moving to a different project requires migrating its Auth users separately.
5. Open the deployed site in two browsers; create guests, accept a challenge, ready both teams, submit moves and verify a completed replay. Also verify email sign-in and saving/loading a team after reloading.

Saved teams in browser storage import when that trainer opens a preparation room on the same origin. Browser storage and guest cookies do not cross domains: before changing domains, export the `league-teams:<trainer-id>` localStorage value and import it under that key on the new origin after signing into the same trainer. Guest-only identities need to be linked to an account on the old site first. Audio preferences and disposable PokéAPI caches remain local. Pokémon data and fallback sprites retain their existing external sources; bundled assets are served by Netlify.

The API polls every three seconds. Deadlines are evaluated when a request arrives, including after an idle period. Updates use a version-checked database snapshot, so competing function instances cannot overwrite each other's accepted moves. This preserves the existing engine for small deployments; the shared snapshot is a throughput and storage limitation as players and replay history grow. No persistent Node server is required on Netlify.

Configuration references: [Netlify functions](https://docs.netlify.com/build/functions/configuration/), [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
