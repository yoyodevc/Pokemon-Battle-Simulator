import { DurableObject } from 'cloudflare:workers';
import { randomInt } from 'node:crypto';
import { League, blankData } from '../server/league.mjs';
import { savedTeams } from '../server/teams.mjs';
import { loadBattle } from '../src/api/battleSetup.ts';
import { ApiError, pokeApi } from '../src/api/client.ts';
import { verifyFirebaseToken } from './firebaseToken.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const json = (status, body) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const recordKey = (collection, id) => `${collection}\n${id}`;
// Workers Free allows 50 outgoing requests per invocation, but a cold battle needs a few
// hundred PokeAPI calls. Responses are kept in SQLite and loading resumes on short alarms,
// each with a fresh budget, so the cache warms up and later battles start immediately.
const FETCH_BUDGET = 40;

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/league/')) return env.LEAGUE.get(env.LEAGUE.idFromName('league')).fetch(request);
    return env.ASSETS.fetch(request);
  },
};

// One object holds the whole League, the same single-instance model as server/index.mjs.
// Durable Objects run one request at a time between awaits, so League's synchronous
// methods never race, and match updates are pushed to players over WebSockets.
export class LeagueObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS league_records (collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (collection, id))');
    const data = blankData();
    this.written = new Map();
    for (const row of this.sql.exec('SELECT collection, id, payload FROM league_records')) {
      if (!data[row.collection]) continue;
      data[row.collection][row.id] = JSON.parse(row.payload);
      this.written.set(recordKey(row.collection, row.id), row.payload);
    }
    this.league = new League(data, current => this.persist(current));
    this.limits = new Map();
    this.sent = new Map();
    this.cleaned = Date.now();
    this.attempts = new Map();
    this.hydrating = null;
    this.sql.exec('CREATE TABLE IF NOT EXISTS api_cache (url TEXT PRIMARY KEY, body TEXT NOT NULL)');
    // Presence is transient, so a restarted object gives live battles a fresh reconnect window.
    for (const m of Object.values(data.matches)) {
      if (m.status === 'loading') { m.status = 'preparing'; m.ready = [false, false]; }
      if (m.status === 'battle') { m.deadline = Date.now() + 90000; m.players.forEach(id => this.league.touch(id)); }
    }
    this.persist(data);
  }

  verify(token) {
    if (!this.env.FIREBASE_PROJECT_ID) fail('Account sign-in has not been configured on this server.', 503);
    return verifyFirebaseToken(token, this.env.FIREBASE_PROJECT_ID);
  }

  firebaseConfig() {
    const { FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID } = this.env;
    if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID || !FIREBASE_APP_ID) return null;
    return { apiKey: FIREBASE_API_KEY, authDomain: FIREBASE_AUTH_DOMAIN, projectId: FIREBASE_PROJECT_ID,
      storageBucket: FIREBASE_STORAGE_BUCKET, messagingSenderId: FIREBASE_MESSAGING_SENDER_ID, appId: FIREBASE_APP_ID };
  }

  /** Writes only the records that changed since the last commit, then pushes changed matches to their sockets. */
  persist(current) {
    const upserts = [], seen = new Set(), changedMatches = new Set();
    for (const [collection, entries] of Object.entries(current)) for (const [id, value] of Object.entries(entries)) {
      const key = recordKey(collection, id), payload = JSON.stringify(value);
      seen.add(key);
      if (this.written.get(key) === payload) continue;
      upserts.push([key, collection, id, payload]);
      if (collection === 'matches') changedMatches.add(id);
    }
    const removed = [...this.written.keys()].filter(key => !seen.has(key));
    if (!upserts.length && !removed.length) return;
    this.ctx.storage.transactionSync(() => {
      for (const [, collection, id, payload] of upserts) this.sql.exec('INSERT OR REPLACE INTO league_records(collection, id, payload) VALUES(?, ?, ?)', collection, id, payload);
      for (const key of removed) { const split = key.indexOf('\n'); this.sql.exec('DELETE FROM league_records WHERE collection = ? AND id = ?', key.slice(0, split), key.slice(split + 1)); }
    });
    for (const [key, , , payload] of upserts) this.written.set(key, payload);
    for (const key of removed) this.written.delete(key);
    if (changedMatches.size) for (const ws of this.ctx.getWebSockets()) {
      const watching = ws.deserializeAttachment();
      if (watching && changedMatches.has(watching.matchId)) this.push(ws, watching);
    }
  }

  push(ws, { uid, matchId }) {
    try {
      const value = JSON.stringify(this.league.viewMatch(uid, matchId));
      if (this.sent.get(ws) !== value) { this.sent.set(ws, value); ws.send(value); }
    } catch { try { ws.close(1008, 'Match unavailable.'); } catch { /* already closed */ } }
  }

  /** Runs League's timers. Requests already tick, so the alarm only matters once players stop polling. */
  housekeeping() {
    const now = Date.now();
    this.league.tick();
    for (const [key, bucket] of this.limits) if (bucket.reset < now) this.limits.delete(key);
    for (const id of this.attempts.keys()) if (this.league.data.matches[id]?.status !== 'loading') this.attempts.delete(id);
    if (now - this.cleaned < 3600000) return;
    this.cleaned = now;
    const data = this.league.data;
    for (const [key, c] of Object.entries(data.challenges)) if (c.expires < now - 86400000) delete data.challenges[key];
    for (const [id, u] of Object.entries(data.users)) if (u.guest && u.created < now - 30 * 86400000 && !this.league.active(id) && !Object.values(data.matches).some(m => m.players.includes(id))) delete data.users[id];
    this.league.commit();
  }

  schedule() {
    const data = this.league.data;
    const live = Object.values(data.matches).some(m => ['preparing', 'loading', 'battle'].includes(m.status))
      || Object.values(data.challenges).some(c => c.status === 'pending');
    if (Object.values(data.matches).some(m => m.status === 'loading')) this.ctx.storage.setAlarm(Date.now() + 500);
    else if (live) this.ctx.storage.setAlarm(Date.now() + 15000);
  }

  async alarm() {
    this.housekeeping();
    const loading = Object.values(this.league.data.matches).find(m => m.status === 'loading');
    if (loading) await this.hydrate(loading.id);
    this.schedule();
  }

  /** PokeAPI fetch backed by the api_cache table, refusing to go past this attempt's budget. */
  cachedFetch(budget) {
    return async url => {
      const row = this.sql.exec('SELECT body FROM api_cache WHERE url = ?', url).toArray()[0];
      if (row) return new Response(row.body, { headers: { 'Content-Type': 'application/json' } });
      if (budget.used >= FETCH_BUDGET) throw Object.assign(new ApiError('Fetch budget used up for this attempt.', url, 509), { budget: true });
      budget.used++;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) return response;
      const body = await response.text();
      try { this.sql.exec('INSERT OR REPLACE INTO api_cache(url, body) VALUES(?, ?)', url, body); } catch { /* too large to cache */ }
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    };
  }

  /** One loading attempt for a match in 'loading'. Runs one at a time so budgets never overlap. */
  async hydrate(matchId) {
    const m = this.league.data.matches[matchId];
    if (this.hydrating || m?.status !== 'loading') return;
    const budget = { used: 0 };
    pokeApi.fetchFn = this.cachedFetch(budget);
    this.hydrating = (async () => {
      let timeout;
      try {
        const loaded = await Promise.race([
          loadBattle(m.rosters[0], m.rosters[1], 'local', randomInt(1, 0xffffffff)),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Team loading timed out')), 120000); }),
        ]);
        this.attempts.delete(matchId);
        this.league.applyBattle(matchId, loaded);
      } catch (error) {
        const attempts = (this.attempts.get(matchId) ?? 0) + 1;
        // Let queued requests from this attempt fail against its spent budget before the next one starts.
        while (pokeApi.snapshot().active + pokeApi.snapshot().pending > 0) await new Promise(resolve => setTimeout(resolve, 50));
        if (error.budget && attempts < 40) this.attempts.set(matchId, attempts);
        else { console.error('Team loading failed:', error); this.attempts.delete(matchId); this.league.failReady(matchId); }
      } finally { clearTimeout(timeout); }
    })();
    try { await this.hydrating; } finally { this.hydrating = null; }
  }

  async fetch(request) {
    try {
      const url = new URL(request.url), path = url.pathname.slice('/api/league/'.length);
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin && !(this.env.LEAGUE_ORIGINS || '').split(',').map(o => o.trim()).includes(origin)) fail('Origin not allowed.', 403);
      if (request.method === 'GET' && path === 'config') return json(200, { firebase: this.firebaseConfig(), accounts: !!this.firebaseConfig() });
      if (path === 'socket') {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') fail('WebSocket required.', 426);
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        return new Response(null, { status: 101, webSocket: client });
      }
      if (request.method === 'GET' && !['session', 'poll'].includes(path)) fail('Not found.', 404);
      if (!['GET', 'POST'].includes(request.method)) fail('Method not allowed.', 405);

      const bearer = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '')?.[1];
      if (!bearer) fail('Sign in or continue as guest.', 401);
      let decoded;
      try { decoded = await this.verify(bearer); } catch (error) { if (error.status) throw error; fail('Sign-in expired. Please sign in again.', 401); }
      const id = decoded.uid, isAnonymous = decoded.firebase?.sign_in_provider === 'anonymous';

      const bucket = this.limits.get(id) || { count: 0, reset: Date.now() + 60000 };
      if (bucket.reset < Date.now()) { bucket.count = 0; bucket.reset = Date.now() + 60000; }
      bucket.count++; this.limits.set(id, bucket);
      if (bucket.count > 90) fail('Too many requests. Try again in a minute.', 429);

      let input = {};
      if (request.method === 'POST') {
        if (!request.headers.get('content-type')?.startsWith('application/json')) fail('JSON required.', 415);
        const raw = await request.text();
        if (raw.length > 16384) fail('Request too large.', 413);
        input = JSON.parse(raw || '{}');
        if (!input || typeof input !== 'object' || Array.isArray(input)) fail('JSON object required.');
      }

      const { league } = this, data = league.data;
      if (!data.users[id]) league.createUser(id, isAnonymous);
      else if (!isAnonymous && data.users[id].guest) league.claim(id);
      league.touch(id, path === 'poll' ? url.searchParams.get('away') === 'true' : !!input.away);
      this.housekeeping();

      let result = {};
      switch (path) {
        case 'session': result = league.snapshot(id); break;
        case 'poll': result = { lobby: league.snapshot(id),
          match: url.searchParams.get('match') ? league.viewMatch(id, url.searchParams.get('match')) : null,
          invitation: url.searchParams.get('invite') ? league.invitation(id, url.searchParams.get('invite')) : null }; break;
        case 'heartbeat': break;
        case 'teams': result = savedTeams(data, id, input); break;
        case 'profile': league.edit(id, input); break;
        case 'friends': league.friend(id, input); break;
        case 'search': result = { trainers: league.search(id, input.query) }; break;
        case 'challenge': result = league.challenge(id, input.target || null); break;
        case 'invitation': result = league.invitation(id, input.id); break;
        case 'respond': result = { matchId: league.respond(id, input.id, input.action) }; break;
        case 'match': result = league.viewMatch(id, input.id); break;
        case 'ready':
          if (league.markReady(id, input.id, input.roster)) await this.hydrate(input.id);
          result = league.viewMatch(id, input.id); break;
        case 'action': league.act(id, input.id, input.action, input.version); result = league.viewMatch(id, input.id); break;
        case 'rematch': result = { matchId: league.rematch(id, input.id) }; break;
        default: fail('Not found.', 404);
      }
      league.commit();
      this.schedule();
      return json(200, result);
    } catch (error) {
      if (!error.status && !(error instanceof SyntaxError)) console.error('League request failed:', error);
      return json(error.status || 400, { error: error.status ? error.message : error instanceof SyntaxError ? 'Invalid JSON.' : 'Unable to complete this request. Please try again.' });
    }
  }

  /** The first message on a socket authenticates it: {token, id}. Later messages are ignored. */
  async webSocketMessage(ws, message) {
    if (ws.deserializeAttachment()) return;
    try {
      if (typeof message !== 'string' || message.length > 8192) fail('Bad message.');
      const { token, id } = JSON.parse(message);
      if (typeof token !== 'string' || typeof id !== 'string') fail('Bad message.');
      const { uid } = await this.verify(token);
      this.league.viewMatch(uid, id);
      ws.serializeAttachment({ uid, matchId: id });
      this.push(ws, { uid, matchId: id });
    } catch { try { ws.close(1008, 'Unauthorized.'); } catch { /* already closed */ } }
  }

  webSocketClose(ws) { this.sent.delete(ws); }
  webSocketError(ws) { this.sent.delete(ws); }
}
