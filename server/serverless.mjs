import { createHash, randomBytes, randomInt } from 'node:crypto';
import { League } from './league.mjs';
import { loadBattle } from '../src/api/battleSetup.ts';
import { transact } from './supabase-store.mjs';
import { savedTeams } from './teams.mjs';

const digest = token => createHash('sha256').update(token).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });

export async function handle(request, store, { ip = 'unknown', loader = loadBattle } = {}) {
  try {
    const url = new URL(request.url), path = url.pathname.replace(/^\/api\/league\//, '');
    const supabaseUrl = process.env.SUPABASE_URL || '', supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin && !(process.env.LEAGUE_ORIGINS || '').split(',').includes(origin)) fail('Origin not allowed.', 403);
    if (request.method === 'GET' && path === 'config') return json(200, { supabaseUrl, supabaseKey, accounts: !!(supabaseUrl && supabaseKey) });
    if (!['GET', 'POST'].includes(request.method)) fail('Method not allowed.', 405);
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
    let verified;
    if (path === 'auth') {
      if (!supabaseUrl || !supabaseKey) fail('Account sign-in is not configured.', 503);
      if (typeof input.token !== 'string' || input.token.length > 8192) fail('Invalid sign-in token.', 401);
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${input.token}` }, signal: AbortSignal.timeout(10000) });
      if (response.status === 429) fail('The accounts service is busy. Please try again shortly.', 429);
      if (response.status >= 500) fail('The accounts service is temporarily unavailable. Please try again.', 503);
      if (!response.ok) fail('Sign-in expired. Please sign in again.', 401);
      verified = await response.json();
      if (!verified.id || !verified.email_confirmed_at) fail('Verify your email before signing in.', 401);
    }
    const token = /(?:^|;\s*)league_session=([a-f0-9]{64})/.exec(request.headers.get('cookie') || '')?.[1];
    const hash = token && digest(token);
    let loaded;
    const cachedLoader = (...args) => loaded ??= (async () => {
      let timer;
      try { return await Promise.race([loader(...args), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Team loading timed out.')), 20000); })]); }
      finally { clearTimeout(timer); }
    })();
    const prepare = data => {
      data.presence ??= {}; data.limits ??= {};
      const league = new League(data);
      league.presence = new Map(Object.entries(data.presence));
      const now = Date.now();
      for (const [key, s] of Object.entries(data.sessions)) if (s.expires <= now) delete data.sessions[key];
      for (const [key, bucket] of Object.entries(data.limits)) if (bucket.reset <= now) delete data.limits[key];
      for (const [key, p] of league.presence) if (now - p.seen > 86400000) league.presence.delete(key);
      for (const [key, c] of Object.entries(data.challenges)) if (c.expires < now - 86400000) delete data.challenges[key];
      return league;
    };
    // 'ready' only records this side's roster here; when both sides are ready this holds
    // the match/rosters to hydrate *after* the transaction below has committed, so the slow,
    // external PokeAPI hydration never holds a stale read open against the shared row.
    let hydrate = null, userId;
    const result = await transact(store, async data => {
      const league = prepare(data);
      const now = Date.now();
      const session = hash && data.sessions[hash];
      const bucket = data.limits[session?.userId || ip] ??= { count: 0, reset: now + 60000 };
      if (++bucket.count > 90) return { status: 429, body: { error: 'Too many requests. Try again in a minute.' } };
      let id = session?.userId, cookie, body = {};
      const issue = userId => {
        if (hash) delete data.sessions[hash];
        const next = randomBytes(32).toString('hex');
        data.sessions[digest(next)] = { userId, expires: now + 7 * 86400000 };
        cookie = `league_session=${next}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${url.protocol === 'https:' ? '; Secure' : ''}`;
        id = userId;
      };
      if (path === 'guest' && !id) issue(league.createUser().id);
      if (path === 'auth' && (!id || data.users[id]?.authId !== verified.id)) issue(league.account(verified.id, id).id);
      if (!id) fail('Session expired. Sign in again.', 401);
      userId = id;
      league.touch(id, path === 'poll' ? url.searchParams.get('away') === 'true' : !!input.away);
      league.tick();
      switch (path) {
        case 'guest': case 'auth': case 'session': body = league.snapshot(id); break;
        case 'poll': body = { lobby: league.snapshot(id),
          match: url.searchParams.get('match') ? league.viewMatch(id, url.searchParams.get('match')) : null,
          invitation: url.searchParams.get('invite') ? league.invitation(id, url.searchParams.get('invite')) : null }; break;
        case 'logout': delete data.sessions[hash]; cookie = `league_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${url.protocol === 'https:' ? '; Secure' : ''}`; break;
        case 'heartbeat': break;
        case 'profile': league.edit(id, input); break;
        case 'friends': league.friend(id, input); break;
        case 'teams': body = savedTeams(data, id, input); break;
        case 'search': body = { trainers: league.search(id, input.query) }; break;
        case 'challenge': body = league.challenge(id, input.target || null); break;
        case 'invitation': body = league.invitation(id, input.id); break;
        case 'respond': body = { matchId: league.respond(id, input.id, input.action) }; break;
        case 'match': body = league.viewMatch(id, input.id); break;
        case 'ready': hydrate = league.markReady(id, input.id, input.roster); body = league.viewMatch(id, input.id); break;
        case 'action': league.act(id, input.id, input.action, input.version); break;
        case 'rematch': body = { matchId: league.rematch(id, input.id) }; break;
        default: fail('Not found.', 404);
      }
      data.presence = Object.fromEntries(league.presence);
      return { status: 200, body, cookie };
    });
    if (hydrate && result.status === 200) {
      let loadedBattle, failed = false;
      try { loadedBattle = await cachedLoader(hydrate.rosters[0], hydrate.rosters[1], 'local', randomInt(1, 0xffffffff)); }
      catch { failed = true; }
      const followUp = await transact(store, async data => {
        const league = prepare(data);
        if (failed) league.failReady(hydrate.matchId); else league.applyBattle(hydrate.matchId, loadedBattle);
        data.presence = Object.fromEntries(league.presence);
        return { status: 200, body: league.viewMatch(userId, hydrate.matchId) };
      });
      result.body = followUp.body;
    }
    return json(result.status, result.body, result.cookie ? { 'Set-Cookie': result.cookie } : {});
  } catch (error) {
    // Unexpected failures are otherwise invisible in function logs, which makes
    // storage and credential problems look like generic outages to the browser.
    if (!error.status && !(error instanceof SyntaxError)) console.error('League request failed:', error);
    else if (error.detail) console.error('League request failed:', error.message, error.detail);
    return json(error.status || (error instanceof SyntaxError ? 400 : 503), { error: error.status ? error.message : error instanceof SyntaxError ? 'Invalid JSON.' : 'Unable to complete this request. Please try again.' });
  }
}
