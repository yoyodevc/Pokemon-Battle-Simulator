// One-time migration: reads the existing Supabase league_state row (read-only, via the
// REST API directly — no SDK dependency needed for a script that runs once) and writes it
// into Firestore using server/firestore.mjs's one-document-per-entity model, reusing the
// existing UUIDs as Firebase UIDs directly so matches/friends/blocks/challenges need no id
// remapping. Registered accounts' emails live in Supabase's own Auth service (never in our
// payload), so those are fetched separately via the Supabase Auth admin API and used to
// create matching Firebase accounts — without a password; existing trainers get a
// password-reset email (or use "Forgot password?") before they can sign back in.
//
// Usage: node --env-file=.env scripts/migrate-firestore.mjs
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (source, read-only) and
// FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT (destination) already set.

import { createStore } from '../server/firestore.mjs';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to read the existing data.'); process.exit(1); }

const supabaseHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const rowResponse = await fetch(`${supabaseUrl}/rest/v1/league_state?id=eq.1&select=payload`, { headers: supabaseHeaders });
if (!rowResponse.ok) { console.error('Failed to read Supabase league_state:', rowResponse.status, await rowResponse.text()); process.exit(1); }
const [{ payload }] = await rowResponse.json();

// Supabase's admin API paginates; collect every auth user's id -> email.
const emailByAuthId = {};
for (let page = 1; ; page++) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: supabaseHeaders });
  if (!res.ok) { console.error('Failed to read Supabase auth users:', res.status, await res.text()); process.exit(1); }
  const { users } = await res.json();
  if (!users?.length) break;
  for (const u of users) emailByAuthId[u.id] = u.email;
}

const { db, auth } = createStore();

let accountsCreated = 0, accountsSkipped = 0;
for (const [id, user] of Object.entries(payload.users || {})) {
  const email = user.authId ? emailByAuthId[user.authId] : undefined;
  try { await auth.getUser(id); accountsSkipped++; }
  catch { await auth.createUser({ uid: id, ...(email ? { email, emailVerified: true } : {}) }); accountsCreated++; }
}
console.log(`Firebase Auth: ${accountsCreated} accounts created, ${accountsSkipped} already existed.`);

// One document per entity, matching server/firestore.mjs's collections. users/{uid}'s
// activeMatchId/stats are old Supabase-era fields league.mjs never had before this
// migration — recomputed from the migrated matches in the second pass below.
let writes = 0;
const write = async (collection, id, value) => { await db.collection(collection).doc(id).set(value); writes++; };

for (const [id, user] of Object.entries(payload.users || {})) {
  await write('users', id, {
    username: user.username, usernameLower: user.username.toLowerCase(), avatar: user.avatar,
    guest: !user.authId, privacy: user.privacy, created: user.created,
    activeMatchId: null, stats: { played: 0, wins: 0, draws: 0 },
  });
}
for (const [id, f] of Object.entries(payload.friends || {})) await write('friends', id, f);
for (const [id] of Object.entries(payload.blocks || {})) {
  const [blocker, blocked] = id.split(':');
  await write('blocks', id, { blocker, blocked, created: Date.now() });
}
for (const [id, c] of Object.entries(payload.challenges || {})) await write('challenges', id, c);
for (const [id, m] of Object.entries(payload.matches || {})) await write('matches', id, m);
for (const [id, teams] of Object.entries(payload.teams || {})) await write('teams', id, teams);

const statsById = {};
for (const m of Object.values(payload.matches || {})) {
  m.players.forEach((p, side) => {
    statsById[p] ??= { played: 0, wins: 0, draws: 0, activeMatchId: null };
    if (m.status === 'ended') {
      statsById[p].played++;
      if (m.winner === 'draw') statsById[p].draws++; else if (m.winner === side) statsById[p].wins++;
    } else if (m.status !== 'abandoned') statsById[p].activeMatchId = m.id;
  });
}
for (const [id, s] of Object.entries(statsById)) {
  await db.collection('users').doc(id).set({ stats: { played: s.played, wins: s.wins, draws: s.draws }, activeMatchId: s.activeMatchId }, { merge: true });
}

console.log(`Firestore: ${writes} documents written.`);
console.log('Registered accounts have no password yet — email them a password-reset link (or point them at "Forgot password?") before announcing the new site. Guest trainers cannot be signed back into: their identity only ever lived in that one browser\'s Firebase session, which this migration cannot recreate.');
