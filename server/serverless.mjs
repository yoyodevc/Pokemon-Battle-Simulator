import { randomInt } from 'node:crypto';
import { League } from './league.mjs';
import { loadBattle } from '../src/api/battleSetup.ts';
import { withDocs, mergeQuerySnapshots } from './firestore.mjs';
import { savedTeams } from './teams.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });

// Rate limiting is per warm function instance, keyed by Firebase uid (always present —
// every caller, guest or registered, holds a real Firebase ID token). This is simpler and
// cheaper than a Firestore-backed limiter, at the cost of not being shared across
// instances; acceptable for its purpose (stop a buggy client from hammering the API), and
// it fixes a real bug the old IP-keyed fallback had: two guests behind one NAT no longer
// share a bucket.
const limits = new Map();
function withinRateLimit(uid) {
  const now = Date.now();
  let bucket = limits.get(uid);
  if (!bucket || bucket.reset <= now) { bucket = { count: 0, reset: now + 60000 }; limits.set(uid, bucket); }
  bucket.count += 1;
  return bucket.count <= 90;
}

function buildLeague(data) {
  const league = new League(data);
  league.presence = new Map(Object.entries(data.presence));
  return league;
}

/** Read-only lobby assembly: friends, pending challenges, match history, and the other
 * users/presence they reference. Not part of the mutating transaction — snapshot() never
 * writes, so staleness here is at most one poll interval, same as the rest of the lobby. */
async function loadLobbyExtras(db, uid) {
  const [friendsFrom, friendsTo, pendingFrom, pendingTo, history, blocksSnap] = await Promise.all([
    db.collection('friends').where('from', '==', uid).get(),
    db.collection('friends').where('to', '==', uid).get(),
    db.collection('challenges').where('from', '==', uid).where('status', '==', 'pending').get(),
    db.collection('challenges').where('to', '==', uid).where('status', '==', 'pending').get(),
    db.collection('matches').where('players', 'array-contains', uid).where('status', '==', 'ended').orderBy('ended', 'desc').limit(20).get(),
    db.collection('blocks').where('blocker', '==', uid).get(),
  ]);
  const friends = mergeQuerySnapshots([friendsFrom, friendsTo]);
  const challenges = mergeQuerySnapshots([pendingFrom, pendingTo]);
  const matches = mergeQuerySnapshots([history]);
  const blocks = mergeQuerySnapshots([blocksSnap]);
  const others = new Set();
  Object.values(friends).forEach(f => others.add(f.from === uid ? f.to : f.from));
  Object.values(challenges).forEach(c => { others.add(c.from); if (c.to) others.add(c.to); });
  Object.values(matches).forEach(m => m.players.forEach(p => { if (p !== uid) others.add(p); }));
  Object.values(blocks).forEach(b => others.add(b.blocked));
  const ids = [...others];
  const [userDocs, presenceDocs] = ids.length
    ? await Promise.all([db.getAll(...ids.map(id => db.collection('users').doc(id))), db.getAll(...ids.map(id => db.collection('presence').doc(id)))])
    : [[], []];
  const users = {}; userDocs.forEach(d => { if (d.exists) users[d.id] = d.data(); });
  const presence = {}; presenceDocs.forEach(d => { if (d.exists) presence[d.id] = d.data(); });
  return { friends, challenges, matches, blocks, users, presence };
}

/** Builds the full Lobby snapshot from the (already-committed) core data plus the read-only extras above. */
function assembleLobby(coreData, extras, uid) {
  const data = { ...coreData,
    friends: extras.friends, challenges: extras.challenges, blocks: extras.blocks,
    matches: { ...coreData.matches, ...extras.matches }, users: { ...coreData.users, ...extras.users } };
  const league = buildLeague({ ...data, presence: { ...data.presence, ...extras.presence } });
  return league.snapshot(uid);
}

function firebaseWebConfig() {
  const { FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID } = process.env;
  if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID || !FIREBASE_APP_ID) return null;
  return { apiKey: FIREBASE_API_KEY, authDomain: FIREBASE_AUTH_DOMAIN, projectId: FIREBASE_PROJECT_ID,
    storageBucket: FIREBASE_STORAGE_BUCKET, messagingSenderId: FIREBASE_MESSAGING_SENDER_ID, appId: FIREBASE_APP_ID };
}

export async function handle(request, store, { loader = loadBattle, verify } = {}) {
  try {
    const url = new URL(request.url), path = url.pathname.replace(/^\/api\/league\//, '');
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin && !(process.env.LEAGUE_ORIGINS || '').split(',').includes(origin)) fail('Origin not allowed.', 403);
    const firebase = firebaseWebConfig();
    if (request.method === 'GET' && path === 'config') return json(200, { firebase, accounts: !!firebase });
    if (!['GET', 'POST'].includes(request.method)) fail('Method not allowed.', 405);
    // Only accessed past this point — accessing store.db/store.auth is what lazily
    // constructs the Firebase Admin app, so `config` still answers with credentials unset.
    const { db, auth } = store;
    const verifyToken = verify ?? (token => auth.verifyIdToken(token));
    if (request.method === 'GET' && !['session', 'poll'].includes(path)) fail('Not found.', 404);
    let input = {};
    if (request.method === 'POST') {
      if (!request.headers.get('content-type')?.startsWith('application/json')) fail('JSON required.', 415);
      const reader = request.body?.getReader();
      let size = 0; const chunks = [];
      if (reader) for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16384) { await reader.cancel(); fail('Request too large.', 413); }
        chunks.push(Buffer.from(value));
      }
      input = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('JSON object required.');
    }

    const bearer = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '')?.[1];
    if (!bearer) fail('Sign in or continue as guest.', 401);
    let decoded;
    try { decoded = await verifyToken(bearer); } catch { fail('Sign-in expired. Please sign in again.', 401); }
    const uid = decoded.uid, isAnonymous = decoded.firebase?.sign_in_provider === 'anonymous';
    if (!withinRateLimit(uid)) fail('Too many requests. Try again in a minute.', 429);

    let loaded;
    const cachedLoader = (...args) => loaded ??= (async () => {
      let timer;
      try { return await Promise.race([loader(...args), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Team loading timed out.')), 20000); })]); }
      finally { clearTimeout(timer); }
    })();

    // Discover ids the request depends on before building the transaction's doc plan —
    // small non-transactional reads that only decide WHICH docs the real transaction
    // below will read for real (and thus be able to abort/retry against).
    const matchId = path === 'poll' ? url.searchParams.get('match') : ['match', 'ready', 'action', 'rematch'].includes(path) ? input.id : null;
    const inviteId = path === 'poll' ? url.searchParams.get('invite') : (path === 'invitation' || path === 'respond') ? input.id : null;

    const plan = [{ collection: 'users', id: uid }, { collection: 'presence', id: uid }];
    const add = (collection, id) => { if (id && !plan.some(p => p.collection === collection && p.id === id)) plan.push({ collection, id }); };

    if (matchId) {
      add('matches', matchId);
      const m = (await db.collection('matches').doc(matchId).get()).data();
      if (m) for (const p of m.players) { add('users', p); add('presence', p); }
    }
    if (inviteId) {
      add('challenges', inviteId);
      const c = (await db.collection('challenges').doc(inviteId).get()).data();
      if (c) { add('users', c.from); add('presence', c.from); if (c.to) { add('users', c.to); add('presence', c.to); } }
    }
    if (path === 'search' && typeof input.query === 'string' && input.query.trim().length >= 3) {
      const prefix = input.query.trim().toLowerCase();
      const snap = await db.collection('users').where('usernameLower', '>=', prefix).where('usernameLower', '<', `${prefix}`).limit(15).get();
      for (const doc of snap.docs) { add('users', doc.id); add('presence', doc.id); add('blocks', `${uid}:${doc.id}`); add('blocks', `${doc.id}:${uid}`); }
    }
    if (path === 'teams') add('teams', uid);
    if (path === 'profile' && typeof input.username === 'string') {
      const dupe = await db.collection('users').where('usernameLower', '==', input.username.toLowerCase()).limit(1).get();
      for (const doc of dupe.docs) add('users', doc.id);
    }
    if (path === 'challenge') {
      if (input.target) { add('users', input.target); add('presence', input.target); add('blocks', `${uid}:${input.target}`); add('blocks', `${input.target}:${uid}`); add('friends', [uid, input.target].sort().join(':')); }
      const pending = await db.collection('challenges').where('from', '==', uid).where('status', '==', 'pending').get();
      for (const doc of pending.docs) add('challenges', doc.id);
    }
    if (path === 'friends' && input.target) {
      add('users', input.target); add('blocks', `${uid}:${input.target}`); add('blocks', `${input.target}:${uid}`);
      add('friends', [uid, input.target].sort().join(':'));
      if (input.action === 'block') {
        const [q1, q2] = await Promise.all([
          db.collection('challenges').where('from', '==', uid).where('to', '==', input.target).where('status', '==', 'pending').get(),
          db.collection('challenges').where('from', '==', input.target).where('to', '==', uid).where('status', '==', 'pending').get(),
        ]);
        for (const id of Object.keys(mergeQuerySnapshots([q1, q2]))) add('challenges', id);
      }
    }
    if (path === 'respond' && input.action === 'accept' && inviteId) {
      const c = (await db.collection('challenges').doc(inviteId).get()).data();
      if (c) {
        add('friends', [c.from, uid].sort().join(':'));
        const [q1, q2, q3, q4] = await Promise.all([
          db.collection('challenges').where('from', '==', c.from).where('status', '==', 'pending').get(),
          db.collection('challenges').where('to', '==', c.from).where('status', '==', 'pending').get(),
          db.collection('challenges').where('from', '==', uid).where('status', '==', 'pending').get(),
          db.collection('challenges').where('to', '==', uid).where('status', '==', 'pending').get(),
        ]);
        for (const id of Object.keys(mergeQuerySnapshots([q1, q2, q3, q4]))) add('challenges', id);
      }
    }
    if (path === 'rematch' && matchId) {
      const m = (await db.collection('matches').doc(matchId).get()).data();
      const target = m?.players.find(p => p !== uid);
      if (target) { add('users', target); add('friends', [uid, target].sort().join(':')); }
    }

    let hydrate = null;
    const core = await withDocs(db, plan, async data => {
      const league = buildLeague(data);
      if (!data.users[uid]) league.createUser(uid, isAnonymous);
      else if (!isAnonymous && data.users[uid].guest) league.claim(uid);
      league.touch(uid, path === 'poll' ? url.searchParams.get('away') === 'true' : !!input.away);
      league.tick();
      let body = {};
      switch (path) {
        case 'session': body = null; break; // filled in from the full lobby assembly below
        case 'poll': body = { match: matchId ? league.viewMatch(uid, matchId) : null, invitation: inviteId ? league.invitation(uid, inviteId) : null }; break;
        case 'heartbeat': break;
        case 'profile': league.edit(uid, input); break;
        case 'friends': league.friend(uid, input); break;
        case 'teams': body = savedTeams(data, uid, input); break;
        case 'search': body = { trainers: league.search(uid, input.query) }; break;
        case 'challenge': body = league.challenge(uid, input.target || null); break;
        case 'invitation': body = league.invitation(uid, input.id); break;
        case 'respond': body = { matchId: league.respond(uid, input.id, input.action) }; break;
        case 'match': body = league.viewMatch(uid, input.id); break;
        case 'ready':
          hydrate = league.markReady(uid, input.id, input.roster);
          if (hydrate) hydrate.players = data.matches[input.id].players;
          body = league.viewMatch(uid, input.id);
          break;
        case 'action': league.act(uid, input.id, input.action, input.version); body = league.viewMatch(uid, input.id); break;
        case 'rematch': body = { matchId: league.rematch(uid, input.id) }; break;
        default: fail('Not found.', 404);
      }
      data.presence = Object.fromEntries(league.presence);
      return { body, data };
    });

    if (hydrate) {
      let loadedBattle, failed = false;
      try { loadedBattle = await cachedLoader(hydrate.rosters[0], hydrate.rosters[1], 'local', randomInt(1, 0xffffffff)); }
      catch { failed = true; }
      const followUpPlan = [{ collection: 'matches', id: hydrate.matchId }, ...hydrate.players.map(p => ({ collection: 'users', id: p }))];
      const followUp = await withDocs(db, followUpPlan, async data => {
        const league = buildLeague(data);
        if (failed) league.failReady(hydrate.matchId); else league.applyBattle(hydrate.matchId, loadedBattle);
        return league.viewMatch(uid, hydrate.matchId);
      });
      core.body = followUp;
    }

    let body = core.body;
    if (path === 'session' || path === 'poll') {
      const extras = await loadLobbyExtras(db, uid);
      const lobby = assembleLobby(core.data, extras, uid);
      body = path === 'session' ? lobby : { lobby, ...core.body };
    }
    return json(200, body);
  } catch (error) {
    // Unexpected failures are otherwise invisible in function logs, which makes
    // storage and credential problems look like generic outages to the browser.
    if (!error.status && !(error instanceof SyntaxError)) console.error('League request failed:', error);
    else if (error.detail) console.error('League request failed:', error.message, error.detail);
    return json(error.status || (error instanceof SyntaxError ? 400 : 503), { error: error.status ? error.message : error instanceof SyntaxError ? 'Invalid JSON.' : 'Unable to complete this request. Please try again.' });
  }
}
