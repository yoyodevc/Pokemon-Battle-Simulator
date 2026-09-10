import './register.mjs';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname, extname, sep } from 'node:path';
import { League, blankData } from './league.mjs';
import { loadBattle } from '../src/api/battleSetup.ts';
import { savedTeams } from './teams.mjs';

const port = Number(process.env.LEAGUE_PORT || 3001);
const dbPath = resolve(process.env.LEAGUE_DATABASE || '.league/league.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const data = blankData();
for (const row of db.prepare('SELECT * FROM league_records').all()) if (data[row.collection]) data[row.collection][row.id] = JSON.parse(row.payload);
const insert = db.prepare('INSERT INTO league_records(collection,id,payload) VALUES(?,?,?)');
const league = new League(data, current => {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM league_records');
    for (const [collection, entries] of Object.entries(current)) for (const [id, value] of Object.entries(entries)) insert.run(collection, id, JSON.stringify(value));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});
const loadServerBattle = loadBattle;
for (const m of Object.values(data.matches)) {
  if (m.status === 'loading') { m.status = 'preparing'; m.ready = [false, false]; }
  if (m.status === 'battle') { m.deadline = Date.now() + 90000; m.players.forEach(id => league.touch(id)); }
}
const streams = new Set(), limits = new Map();
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const digest = token => createHash('sha256').update(token).digest('hex');
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
function session(req) {
  const token = /(?:^|;\s*)league_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
  const s = token && data.sessions[digest(token)];
  return s && s.expires > Date.now() ? { ...s, hash: digest(token) } : null;
}
function issue(res, id, old) {
  if (old) delete data.sessions[old.hash];
  const token = randomBytes(32).toString('hex');
  data.sessions[digest(token)] = { userId: id, expires: Date.now() + 7 * 86400000 };
  res.setHeader('Set-Cookie', `league_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  league.touch(id); league.commit();
}
function push() {
  for (const stream of streams) {
    try {
      if (!data.sessions[stream.session.hash] || stream.session.expires <= Date.now()) { stream.res.end(); continue; }
      const body = { lobby: league.snapshot(stream.session.userId), match: stream.matchId ? league.viewMatch(stream.session.userId, stream.matchId) : null,
        invitation: stream.inviteId ? league.invitation(stream.session.userId, stream.inviteId) : null };
      const encoded = JSON.stringify(body);
      if (encoded !== stream.last) { stream.res.write(`data: ${encoded}\n\n`); stream.last = encoded; }
    } catch { stream.res.end(); }
  }
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
    const s = session(req), path = url.pathname.slice('/api/league/'.length);
    if (req.method === 'GET' && path === 'config') return json(res, 200, { supabaseUrl, supabaseKey, accounts: !!(supabaseUrl && supabaseKey) });
    if (req.method === 'GET' && path === 'poll') {
      if (!s) return json(res, 401, { error: 'Session expired. Sign in again.' });
      league.touch(s.userId, url.searchParams.get('away') === 'true'); league.tick();
      return json(res, 200, { lobby: league.snapshot(s.userId),
        match: url.searchParams.get('match') ? league.viewMatch(s.userId, url.searchParams.get('match')) : null,
        invitation: url.searchParams.get('invite') ? league.invitation(s.userId, url.searchParams.get('invite')) : null });
    }
    if (req.method === 'GET' && path === 'events') {
      if (!s) return json(res, 401, { error: 'Sign in or continue as guest.' });
      if ([...streams].filter(x => x.session.userId === s.userId).length >= 5) return json(res, 429, { error: 'Too many open connections.' });
      const matchId = url.searchParams.get('match');
      const inviteId = url.searchParams.get('invite');
      if (matchId) league.match(s.userId, matchId);
      if (inviteId) league.invitation(s.userId, inviteId);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const stream = { res, session: s, matchId, inviteId, last: '' }; streams.add(stream); league.touch(s.userId); push();
      res.on('close', () => streams.delete(stream)); return;
    }
    if (req.method === 'GET' && path === 'session') return s ? json(res, 200, league.snapshot(s.userId)) : json(res, 401, { error: 'Sign in or continue as guest.' });
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
    if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'JSON required.' });
    const key = s?.userId || req.socket.remoteAddress;
    const bucket = limits.get(key) || { count: 0, reset: Date.now() + 60000 };
    if (bucket.reset < Date.now()) { bucket.count = 0; bucket.reset = Date.now() + 60000; }
    bucket.count++; limits.set(key, bucket);
    if (bucket.count > 90) return json(res, 429, { error: 'Too many requests. Try again in a minute.' });
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 16384) return json(res, 413, { error: 'Request too large.' }); }
    const input = JSON.parse(raw || '{}');
    if (path === 'guest') {
      if (s) return json(res, 200, league.snapshot(s.userId));
      const u = league.createUser(); issue(res, u.id); push(); return json(res, 200, league.snapshot(u.id));
    }
    if (path === 'auth') {
      if (!supabaseUrl || !supabaseKey) return json(res, 503, { error: 'Account sign-in has not been configured. Guest battles are available.' });
      if (typeof input.token !== 'string' || input.token.length > 8192) return json(res, 401, { error: 'Invalid sign-in token.' });
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${input.token}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) return json(res, 401, { error: 'Sign-in expired. Please sign in again.' });
      const verified = await response.json();
      if (!verified.id || !verified.email_confirmed_at) return json(res, 401, { error: 'Verify your email before signing in.' });
      const u = league.account(verified.id, s?.userId); issue(res, u.id, s); push(); return json(res, 200, league.snapshot(u.id));
    }
    if (!s) return json(res, 401, { error: 'Session expired. Sign in again.' });
    const id = s.userId; league.touch(id, !!input.away); league.tick();
    let result = {};
    switch (path) {
      case 'logout': delete data.sessions[s.hash]; league.commit(); res.setHeader('Set-Cookie', 'league_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); break;
      case 'heartbeat': break;
      case 'teams': result = savedTeams(data, id, input); league.commit(); break;
      case 'profile': league.edit(id, input); break;
      case 'friends': league.friend(id, input); break;
      case 'search': result = { trainers: league.search(id, input.query) }; break;
      case 'challenge': result = league.challenge(id, input.target || null); break;
      case 'invitation': result = league.invitation(id, input.id); break;
      case 'respond': result = { matchId: league.respond(id, input.id, input.action) }; break;
      case 'match': result = league.viewMatch(id, input.id); break;
      case 'ready': {
        const pending = league.ready(id, input.id, input.roster, loadServerBattle);
        push(); await pending; result = league.viewMatch(id, input.id); break;
      }
      case 'action': league.act(id, input.id, input.action, input.version); break;
      case 'rematch': result = { matchId: league.rematch(id, input.id) }; break;
      default: return json(res, 404, { error: 'Not found' });
    }
    push(); json(res, 200, result);
  } catch (error) { json(res, error.status || 400, { error: error.status || error instanceof SyntaxError ? error.message : 'Unable to complete this request. Please try again.' }); }
});
setInterval(() => {
  league.tick(); push();
  for (const stream of streams) stream.res.write(': heartbeat\n\n');
  for (const [key, bucket] of limits) if (bucket.reset < Date.now()) limits.delete(key);
}, 3000).unref();
setInterval(() => {
  for (const [key, s] of Object.entries(data.sessions)) if (s.expires < Date.now()) delete data.sessions[key];
  for (const [key, c] of Object.entries(data.challenges)) if (c.expires < Date.now() - 86400000) delete data.challenges[key];
  for (const [id, u] of Object.entries(data.users)) if (!u.authId && u.created < Date.now() - 30 * 86400000 && !league.active(id) && !Object.values(data.matches).some(m => m.players.includes(id))) delete data.users[id];
  league.commit();
}, 3600000).unref();
server.listen(port, '0.0.0.0', () => console.log(`League server: http://localhost:${port}`));
