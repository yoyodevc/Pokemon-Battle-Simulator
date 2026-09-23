# Netlify + Firebase

Netlify serves the frontend/assets and runs the authoritative battle API as serverless functions. Firebase provides account authentication (including guests, via Anonymous Auth) and Firestore stores trainers, friends, blocks, invitations, matches/replays, saved teams and presence — one document per entity, not one shared row, so unrelated players' requests never contend with each other. The local `npm run dev` server still uses SQLite for storage, but authenticates against the same Firebase project.

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com). Analytics is not needed.
2. Build > Authentication > Get started. Enable the **Anonymous** and **Email/Password** sign-in providers. Guests are anonymous Firebase users; "Create an account" links that same identity to a real email/password via `linkWithCredential`, so a guest's trainer, friends and history carry over automatically.
3. Build > Firestore Database > Create database. Any region; production mode (the bundled `firestore.rules` denies all client access regardless — the frontend never talks to Firestore directly, only the server does, via the Admin SDK, which bypasses rules).
4. Deploy the security rules and indexes from this repo: `npx firebase deploy --only firestore --project <your-project-id>` (requires `npx firebase login` once). The composite indexes in `firestore.indexes.json` are required for the lobby's friends/history/challenge queries; without them those queries fail until the index finishes building (the error message includes a direct link to create it manually as a fallback).
5. Project settings > General > Your apps > add a Web app. Copy the six `firebaseConfig` values.
6. Project settings > Service accounts > Generate new private key. This JSON file is a secret — never commit it.
7. In Netlify, import this repository (`netlify.toml` sets the build command, output directory and function bundler). Set these environment variables with Functions scope, then redeploy:
   - `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID` — the public web config from step 5.
   - `FIREBASE_SERVICE_ACCOUNT` — the *entire contents* of the service-account JSON from step 6, pasted as one value. Keep this server-only; never prefix with `VITE_`.
8. In Firebase Authentication > Settings > Authorized domains, add your Netlify site's domain (and any custom domain) so sign-in works there.
9. To preserve existing Supabase data from before this migration: keep the old Supabase project reachable, populate `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your local (ignored) `.env` alongside the Firebase variables above, then run:

   ```powershell
   node --env-file=.env scripts/migrate-firestore.mjs
   ```

   This reads the Supabase `league_state` row and Supabase's own Auth user list (read-only — nothing is deleted or modified there) and writes matching Firebase Auth accounts plus Firestore documents, reusing existing trainer ids as Firebase UIDs directly. Registered accounts are created without a password; email them a password-reset link (or have them use "Forgot password?") before announcing the new site. Guest trainers cannot be carried over — a guest's identity only ever lived in that one browser's session, which no migration can recreate; this is unchanged from before.
10. Open the deployed site in two separate browsers (or devices): create guests, accept a challenge, ready both teams, submit moves and verify a completed replay. Then verify email sign-in and saving/loading a team after reloading.

Saved teams in browser storage import when that trainer opens a preparation room on the same origin. Browser storage does not cross domains: before changing domains, export the `league-teams:<trainer-id>` localStorage value and import it under that key on the new origin after signing into the same trainer. Audio preferences and disposable PokéAPI caches remain local. Pokémon data and fallback sprites retain their existing external sources; bundled assets are served by Netlify.

The frontend polls every ten seconds. A scheduled Netlify Function (`netlify/functions/league-sweep.mjs`, every two minutes) is a backstop that expires abandoned invitations and matches nobody is actively polling, using targeted Firestore queries — never a full-collection scan. Firestore's own optimistic-concurrency transactions (per document, not per shared row) are what make concurrent players safe; there is no single point every request contends on.

If sign-in fails, check Firebase Authentication's sign-in method configuration and the authorized-domains list. Guest invitations need no email at all, but still require Firestore to be created (step 3) and the service-account key to be set. A plain `#match/...` URL only opens for that match's two participants; share `#invite/...` to invite a new opponent. Invitation links expire after ten minutes.

Battle music uses the user-provided "Pokémon Diamond/Pearl/Platinum - Battle! Trainer Music (HQ)" recording, bundled locally as `audio/battle-source.mp3`. Playback skips the first four seconds and restarts at 0:04 when the track ends, preserving the rhythm of the requested section. This is Pokémon game music and does not have a royalty-free license; keep it for private testing unless you have permission to publish it. The Audio toggle mutes it with battle effects, and the Music slider saves its volume in this browser. Browsers may require a click or keypress before playback. Music stops when the battle ends, the tab is hidden, or the battle screen is closed.

Configuration references: [Netlify functions](https://docs.netlify.com/build/functions/configuration/), [Netlify scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/), [Firestore security rules](https://firebase.google.com/docs/firestore/security/get-started), [Firebase Admin SDK setup](https://firebase.google.com/docs/admin/setup), [Firebase Auth Anonymous sign-in](https://firebase.google.com/docs/auth/web/anonymous-auth), [linking an anonymous account](https://firebase.google.com/docs/auth/web/account-linking).
