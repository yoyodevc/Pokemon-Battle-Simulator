import './register.mjs';
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname, extname, sep } from 'node:path';
import { League, blankData } from './league.mjs';
import { loadBattle } from '../src/api/battleSetup.ts';
import { savedTeams } from './teams.mjs';
import { createStore } from './firestore.mjs';

const port = Number(process.env.LEAGUE_PORT || 3001);
const dbPath = resolve(process.env.LEAGUE_DATABASE || '.league/league.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const data = blankData();
for (const row of db.prepare('SELECT * FROM league_records').all()) if (data[row.collection]) data[row.collection][row.id] = JSON.parse(row.payload);
const insert = db.prepare('INSERT INTO league_records(collection,id,payload) VALUES(?,?,?)');
const matchListeners = new Set();
const league = new League(data, current => {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM league_records');
    for (const [collection, entries] of Object.entries(current)) for (const [id, value] of Object.entries(entries)) insert.run(collection, id, JSON.stringify(value));
    db.exec('COMMIT');
    for (const listener of matchListeners) { try { listener(); } catch { matchListeners.delete(listener); } }
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});
const loadServerBattle = loadBattle;
for (const m of Object.values(data.matches)) {
  if (m.status === 'loading') { m.status = 'preparing'; m.ready = [false, false]; }
  if (m.status === 'battle') { m.deadline = Date.now() + 90000; m.players.forEach(id => league.touch(id)); }
}
const limits = new Map();
// Storage stays local SQLite in dev, but auth still goes through the same Firebase project
// as production (server/firestore.mjs) so the frontend doesn't need a dev-only code path.
// Left undefined (rather than throwing at startup) so guest play still works before Firebase
// is configured; only 'session'/'poll'/etc. (which all require a bearer token) need it.
let auth;
try { auth = createStore().auth; } catch { /* not configured yet */ }
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
function firebaseWebConfig() {
  const { FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID } = process.env;
  if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID || !FIREBASE_APP_ID) return null;
  return { apiKey: FIREBASE_API_KEY, authDomain: FIREBASE_AUTH_DOMAIN, projectId: FIREBASE_PROJECT_ID,
    storageBucket: FIREBASE_STORAGE_BUCKET, messagingSenderId: FIREBASE_MESSAGING_SENDER_ID, appId: FIREBASE_APP_ID };
}
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url, 'http://localhost');
  try {
  if (!url.pathname.startsWith('/api/league/')) {
    const root = resolve('dist'), file = resolve(root, `.${decodeURI(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (req.method !== 'GET' || !file.startsWith(`${root}${sep}`) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'Not found' });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public,max-age=31536000,immutable' : 'no-cache' });
    createReadStream(file).pipe(res); return;
  }
    const origin = req.headers.origin;
    if (origin && !(process.env.LEAGUE_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174').split(',').includes(origin)) throw Object.assign(new Error('Origin not allowed.'), { status: 403 });
    const path = url.pathname.slice('/api/league/'.length);
    if (req.method === 'GET' && path === 'config') return json(res, 200, { firebase: firebaseWebConfig(), accounts: !!firebaseWebConfig() });
    if (req.method === 'GET' && !['session', 'poll'].includes(path)) return json(res, 404, { error: 'Not found.' });
    if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });

    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    if (!bearer) return json(res, 401, { error: 'Sign in or continue as guest.' });
    if (!auth) return json(res, 503, { error: 'Account sign-in has not been configured on this server.' });
    let decoded;
    try { decoded = await auth.verifyIdToken(bearer); } catch { return json(res, 401, { error: 'Sign-in expired. Please sign in again.' }); }
    const id = decoded.uid, isAnonymous = decoded.firebase?.sign_in_provider === 'anonymous';

    const bucket = limits.get(id) || { count: 0, reset: Date.now() + 60000 };
    if (bucket.reset < Date.now()) { bucket.count = 0; bucket.reset = Date.now() + 60000; }
    bucket.count++; limits.set(id, bucket);
    if (bucket.count > 90) return json(res, 429, { error: 'Too many requests. Try again in a minute.' });

    let input = {};
    if (req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'JSON required.' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 16384) return json(res, 413, { error: 'Request too large.' }); }
      input = JSON.parse(raw || '{}');
    }

    if (!data.users[id]) league.createUser(id, isAnonymous);
    else if (!isAnonymous && data.users[id].guest) league.claim(id);
    league.touch(id, path === 'poll' ? url.searchParams.get('away') === 'true' : !!input.away);
    league.tick();

    let result = {};
    switch (path) {
      case 'session': result = league.snapshot(id); break;
      case 'poll': result = { lobby: league.snapshot(id),
        match: url.searchParams.get('match') ? league.viewMatch(id, url.searchParams.get('match')) : null,
        invitation: url.searchParams.get('invite') ? league.invitation(id, url.searchParams.get('invite')) : null }; break;
      case 'stream': {
        if (typeof input.id !== 'string') return json(res, 400, { error: 'Match required.' });
        league.viewMatch(id, input.id);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        let last = '';
        const send = () => {
          const value = JSON.stringify(league.viewMatch(id, input.id));
          if (value !== last && !res.destroyed) { last = value; res.write(`data: ${value}\n\n`); }
        };
        const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
        const stop = () => { matchListeners.delete(send); clearInterval(heartbeat); clearTimeout(expiry); if (!res.writableEnded) res.end(); };
        const expiry = setTimeout(stop, 50000);
        matchListeners.add(send); res.on('close', stop); send();
        return;
      }
      case 'heartbeat': break;
      case 'teams': result = savedTeams(data, id, input); break;
      case 'profile': league.edit(id, input); break;
      case 'friends': league.friend(id, input); break;
      case 'search': result = { trainers: league.search(id, input.query) }; break;
      case 'challenge': result = league.challenge(id, input.target || null); break;
      case 'invitation': result = league.invitation(id, input.id); break;
      case 'respond': result = { matchId: league.respond(id, input.id, input.action) }; break;
      case 'match': result = league.viewMatch(id, input.id); break;
      case 'ready': {
        const hydrate = league.markReady(id, input.id, input.roster);
        if (hydrate) {
          let timeout;
          try {
            const loaded = await Promise.race([
              loadServerBattle(hydrate.rosters[0], hydrate.rosters[1], 'local', randomInt(1, 0xffffffff)),
              new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Team loading timed out')), 120000); timeout.unref?.(); }),
            ]);
            league.applyBattle(hydrate.matchId, loaded);
          } catch { league.failReady(hydrate.matchId); }
          finally { clearTimeout(timeout); }
        }
        result = league.viewMatch(id, input.id); break;
      }
      case 'action': league.act(id, input.id, input.action, input.version); result = league.viewMatch(id, input.id); break;
      case 'rematch': result = { matchId: league.rematch(id, input.id) }; break;
      default: return json(res, 404, { error: 'Not found' });
    }
    league.commit();
    json(res, 200, result);
  } catch (error) { json(res, error.status || 400, { error: error.status ? error.message : error instanceof SyntaxError ? 'Invalid JSON.' : 'Unable to complete this request. Please try again.' }); }
});
setInterval(() => {
  league.tick();
  for (const [key, bucket] of limits) if (bucket.reset < Date.now()) limits.delete(key);
}, 3000).unref();
setInterval(() => {
  for (const [key, c] of Object.entries(data.challenges)) if (c.expires < Date.now() - 86400000) delete data.challenges[key];
  for (const [id, u] of Object.entries(data.users)) if (u.guest && u.created < Date.now() - 30 * 86400000 && !league.active(id) && !Object.values(data.matches).some(m => m.players.includes(id))) delete data.users[id];
  league.commit();
}, 3600000).unref();
server.listen(port, '0.0.0.0', () => console.log(`League server: http://localhost:${port}`));
