import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createBattle, legalActions, resolveTurn } from '../src/engine/turn.ts';

export const blankData = () => ({ users: {}, sessions: {}, friends: {}, blocks: {}, challenges: {}, matches: {}, teams: {} });
const pair = (a, b) => [a, b].sort().join(':');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const same = (a, b) => a.kind === b.kind && (a.kind === 'forfeit' || a.slot === b.slot);
export const AVATARS = [25, 6, 9, 3, 94, 149, 131, 143];

export class League {
  constructor(data = blankData(), save = () => {}, now = Date.now) {
    this.data = data; this.save = save; this.now = now; this.presence = new Map();
  }
  commit() { this.save(this.data); }
  user(id) { return this.data.users[id] ?? fail('Session expired. Sign in again.', 401); }
  profile(id) {
    const u = this.user(id), p = this.presence.get(id);
    return { id, username: u.username, avatar: u.avatar, guest: !u.authId, privacy: u.privacy,
      presence: !p || this.now() - p.seen > 25000 ? 'offline' : this.active(id) ? 'in battle' : p.away ? 'away' : 'online' };
  }
  createUser(authId = null, username) {
    const id = randomUUID();
    if (username && Object.values(this.data.users).some(u => u.username.toLowerCase() === username.toLowerCase())) fail('That trainer name is taken.', 409);
    if (!username) do { username = `Guest_${randomBytes(4).toString('hex')}`; } while (Object.values(this.data.users).some(u => u.username === username));
    const u = { id, authId, username: username || `Guest_${randomBytes(3).toString('hex')}`, avatar: 25,
      privacy: 'everyone', created: this.now() };
    this.data.users[id] = u; this.commit(); return u;
  }
  account(authId, guestId) {
    let u = Object.values(this.data.users).find(x => x.authId === authId);
    if (!u && guestId && !this.user(guestId).authId) {
      u = this.user(guestId); u.authId = authId;
    }
    if (!u) u = this.createUser(authId, `Trainer_${randomBytes(4).toString('hex')}`);
    this.commit(); return u;
  }
  edit(id, input) {
    const u = this.user(id);
    if (input.username !== undefined) {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(input.username)) fail('Use 3-20 letters, numbers, or underscores.');
      if (Object.values(this.data.users).some(x => x.id !== id && x.username.toLowerCase() === input.username.toLowerCase())) fail('That trainer name is taken.', 409);
    }
    if (input.avatar !== undefined && !AVATARS.includes(input.avatar)) fail('Choose a preset avatar.');
    if (input.privacy !== undefined && !['everyone', 'friends', 'nobody'].includes(input.privacy)) fail('Invalid privacy setting.');
    if (input.username !== undefined) u.username = input.username;
    if (input.avatar !== undefined) u.avatar = input.avatar;
    if (input.privacy !== undefined) u.privacy = input.privacy;
    this.commit();
  }
  blocked(a, b) { return !!(this.data.blocks[`${a}:${b}`] || this.data.blocks[`${b}:${a}`]); }
  active(id) { return Object.values(this.data.matches).find(m => m.players.includes(id) && !['ended', 'abandoned'].includes(m.status)); }
  touch(id, away = false) { this.presence.set(id, { seen: this.now(), away }); }
  canChallenge(a, b) {
    if (a === b) fail('Invite another trainer.');
    const target = this.user(b);
    if (this.blocked(a, b)) fail('This trainer is unavailable.', 403);
    if (target.privacy === 'nobody' || (target.privacy === 'friends' && this.data.friends[pair(a, b)]?.status !== 'accepted')) fail('This trainer is not accepting challenges.', 403);
  }
  friend(id, input) {
    const target = this.user(input.target);
    if (id === target.id) fail('Choose another trainer.');
    const key = pair(id, target.id), current = this.data.friends[key];
    if (input.action === 'block') {
      this.data.blocks[`${id}:${target.id}`] = true; delete this.data.friends[key];
      for (const c of Object.values(this.data.challenges)) if (c.status === 'pending' && pair(c.from, c.to) === key) c.status = 'cancelled';
    } else if (input.action === 'unblock') delete this.data.blocks[`${id}:${target.id}`];
    else {
      if (!this.user(id).authId || !target.authId) fail('Both trainers need accounts to become friends.');
      if (this.blocked(id, target.id)) fail('This trainer is unavailable.', 403);
      if (input.action === 'request') {
        if (current) fail('A friendship or request already exists.', 409);
        this.data.friends[key] = { from: id, to: target.id, status: 'pending', created: this.now() };
      } else if (input.action === 'accept') {
        if (!current || current.to !== id || current.status !== 'pending') fail('Request no longer available.', 409);
        current.status = 'accepted';
      } else if (['decline', 'cancel', 'remove'].includes(input.action)) {
        if (!current || (input.action === 'cancel' && current.from !== id) || (input.action === 'decline' && current.to !== id)) fail('Request no longer available.', 409);
        delete this.data.friends[key];
      } else fail('Unknown friend action.');
    }
    this.commit();
  }
  challenge(id, target = null) {
    if (this.active(id)) fail('Finish your current match first.', 409);
    if (target) { this.canChallenge(id, target); if (this.active(target)) fail('That trainer is in a match.', 409); }
    const pending = Object.values(this.data.challenges).filter(c => c.from === id && c.status === 'pending' && c.expires > this.now());
    if (pending.length >= 5) fail('You already have five pending invitations.');
    if (pending.some(c => c.to === target)) fail('An invitation is already pending.', 409);
    const c = { id: randomBytes(24).toString('hex'), from: id, to: target, status: 'pending', created: this.now(), expires: this.now() + 600000, matchId: null };
    this.data.challenges[c.id] = c; this.commit(); return c;
  }
  invitation(id, token) {
    const c = this.data.challenges[token];
    if (!c || (c.to && ![c.from, c.to].includes(id))) fail('Invitation not found.', 404);
    if (this.blocked(c.from, id)) fail('Invitation unavailable.', 403);
    return { ...c, from: this.profile(c.from), to: c.to ? this.profile(c.to) : null };
  }
  respond(id, token, action) {
    const c = this.data.challenges[token];
    this.invitation(id, token);
    if (c.status !== 'pending' || c.expires <= this.now()) fail('This invitation is no longer available.', 409);
    if (action === 'cancel') { if (c.from !== id) fail('Only the sender can cancel.', 403); c.status = 'cancelled'; }
    else if (action === 'decline') { if (c.to !== id) fail('Only the recipient can decline.', 403); c.status = 'declined'; }
    else if (action === 'accept') {
      this.canChallenge(c.from, id);
      if (this.active(c.from) || this.active(id)) fail('One of the trainers already has a match.', 409);
      const match = { id: randomUUID(), players: [c.from, id], status: 'preparing', rosters: [null, null], ready: [false, false],
        actions: [null, null], version: 0, state: null, events: [], created: this.now(), deadline: this.now() + 600000, rematch: [] };
      this.data.matches[match.id] = match;
      c.to = id; c.status = 'accepted'; c.matchId = match.id;
      for (const other of Object.values(this.data.challenges)) if (other.status === 'pending' && [other.from, other.to].some(p => match.players.includes(p))) other.status = 'cancelled';
    } else fail('Unknown invitation action.');
    this.commit(); return c.matchId;
  }
  match(id, matchId) {
    const m = this.data.matches[matchId];
    if (!m || !m.players.includes(id)) fail('Match not found.', 404);
    return m;
  }
  /**
   * Synchronous half of readying up: validates and records this side's roster. Returns
   * null unless both sides are now ready, in which case the match moves to 'loading' and
   * the caller must hydrate the rosters (a slow, external-network step) and report back
   * via applyBattle/failReady. Kept separate so the slow step never runs inside a held
   * database transaction (see server/serverless.mjs).
   */
  markReady(id, matchId, roster) {
    const m = this.match(id, matchId), side = m.players.indexOf(id);
    if (m.status !== 'preparing') fail('This room is no longer preparing.', 409);
    if (!Array.isArray(roster) || roster.length !== 6 || new Set(roster).size !== 6 || roster.some(n => typeof n !== 'string' || !/^[a-z0-9-]{1,40}$/.test(n))) fail('Select six different Pokemon.');
    m.rosters[side] = roster; m.ready[side] = true; delete m.error;
    if (!m.ready.every(Boolean)) { this.commit(); return null; }
    m.status = 'loading'; this.commit();
    return { matchId, rosters: [m.rosters[0], m.rosters[1]] };
  }
  applyBattle(matchId, loaded) {
    const m = this.data.matches[matchId];
    if (!m || m.status !== 'loading') return;
    const teams = loaded.initial.teams;
    teams.forEach((t, s) => { t.name = this.user(m.players[s]).username; });
    m.state = createBattle(teams, loaded.initial.chart, randomInt(1, 0xffffffff));
    m.revealed = [[m.state.teams[0].active], [m.state.teams[1].active]];
    m.status = 'battle'; m.deadline = this.now() + 90000; m.version += 1;
    delete m.error;
    this.commit();
  }
  failReady(matchId, message = 'Team data could not be loaded. Please ready up again.') {
    const m = this.data.matches[matchId];
    if (!m || m.status !== 'loading') return;
    m.status = 'preparing'; m.ready = [false, false]; m.error = message;
    this.commit();
  }
  /** Convenience wrapper composing markReady/applyBattle/failReady for direct, single-process callers (tests, scripts). */
  async ready(id, matchId, roster, loadBattle) {
    const hydrate = this.markReady(id, matchId, roster);
    if (!hydrate) return;
    try { this.applyBattle(matchId, await loadBattle(hydrate.rosters[0], hydrate.rosters[1], 'local', randomInt(1, 0xffffffff))); }
    catch { this.failReady(matchId); }
  }
  finish(m, winner, reason) {
    m.status = 'ended'; m.winner = winner; m.reason = reason; m.ended = this.now(); m.version += 1;
    if (m.state) { m.state.phase = 'ended'; m.state.winner = winner; }
    m.actions = [null, null];
  }
  act(id, matchId, action, version) {
    const m = this.match(id, matchId), side = m.players.indexOf(id);
    if (['ended', 'abandoned'].includes(m.status)) fail('This match has ended.', 409);
    if (action?.kind === 'forfeit') {
      if (m.status === 'battle') this.finish(m, 1 - side, 'forfeit');
      else { m.status = 'abandoned'; m.ended = this.now(); m.version += 1; }
      this.commit(); return;
    }
    if (m.status !== 'battle' || version !== m.version || m.actions[side]) fail('The turn changed or your choice is already locked.', 409);
    if (!action || !legalActions(m.state, side).some(a => same(a, action))) fail('That action is not available.');
    m.actions[side] = action;
    if ([0, 1].every(s => m.actions[s] || !legalActions(m.state, s).length)) {
      const result = resolveTurn(m.state, m.actions);
      m.revealed ??= [[m.state.teams[0].active], [m.state.teams[1].active]];
      result.events.forEach(e => { if (e.teams) [0, 1].forEach(s => { if (!m.revealed[s].includes(e.teams[s].active)) m.revealed[s].push(e.teams[s].active); }); });
      m.state = result.state; m.events = [...m.events, ...result.events];
      m.actions = [null, null]; m.version += 1; m.deadline = this.now() + 90000;
      if (m.state.phase === 'ended') this.finish(m, m.state.winner, 'battle');
    }
    this.commit();
  }
  rematch(id, matchId) {
    const m = this.match(id, matchId), target = m.players.find(p => p !== id);
    if (m.status !== 'ended') fail('Finish this match first.');
    this.canChallenge(id, target);
    if (this.active(id) || this.active(target)) fail('A trainer already has another match.', 409);
    if (!m.rematch.includes(id)) m.rematch.push(id);
    if (m.rematch.length === 2 && !m.next) {
      const c = this.challenge(m.players[0], m.players[1]);
      m.next = this.respond(m.players[1], c.id, 'accept');
    }
    this.commit(); return m.next;
  }
  tick() {
    let changed = false;
    for (const c of Object.values(this.data.challenges)) if (c.status === 'pending' && c.expires <= this.now()) { c.status = 'expired'; changed = true; }
    for (const m of Object.values(this.data.matches)) {
      if (m.status === 'preparing' && m.deadline < this.now()) { m.status = 'abandoned'; m.ended = this.now(); changed = true; }
      if (m.status !== 'battle') continue;
      const disconnected = m.players.map(p => this.now() - (this.presence.get(p)?.seen ?? m.created) > 60000);
      if (disconnected.some(Boolean)) { this.finish(m, disconnected.every(Boolean) ? 'draw' : disconnected[0] ? 1 : 0, 'disconnect'); changed = true; }
      else if (m.deadline < this.now()) {
        const missing = [0, 1].map(s => !m.actions[s] && legalActions(m.state, s).length > 0);
        this.finish(m, missing.every(Boolean) ? 'draw' : missing[0] ? 1 : 0, 'timeout'); changed = true;
      }
    }
    if (changed) this.commit();
  }
  viewMatch(id, matchId) {
    const m = this.match(id, matchId), side = m.players.indexOf(id);
    const publicTeams = source => {
      const teams = structuredClone(source);
      if (m.status !== 'ended') teams[1 - side].pokemon = teams[1 - side].pokemon.map((p, slot) => {
        const revealed = slot === teams[1 - side].active || m.revealed?.[1 - side]?.includes(slot);
        return revealed ? { name: p.name, hp: p.hp, stats: { hp: p.stats.hp }, types: p.types, status: p.status, level: p.level } : { name: 'unknown', hp: null, stats: { hp: null } };
      });
      return teams;
    };
    let state = null;
    if (m.state) {
      state = structuredClone(m.state); delete state.rng;
      state.teams = publicTeams(state.teams);
    }
    return { id: m.id, side, players: m.players.map(p => this.profile(p)), status: m.status, ready: m.ready,
      roster: m.rosters[side], state, version: m.version, submitted: !!m.actions[side], opponentSubmitted: !!m.actions[1 - side],
      legal: m.state && m.status === 'battle' ? legalActions(m.state, side) : [], events: m.events.map(e => e.teams ? { ...e, teams: publicTeams(e.teams) } : e),
      deadline: m.deadline, winner: m.winner, reason: m.reason, error: m.error, rematch: m.rematch, next: m.next,
      connections: m.players.map(p => this.now() - (this.presence.get(p)?.seen ?? 0) < 25000) };
  }
  snapshot(id) {
    const user = this.profile(id);
    const friends = Object.values(this.data.friends).filter(f => f.from === id || f.to === id).map(f => ({ ...f, trainer: this.profile(f.from === id ? f.to : f.from) }));
    const challenges = Object.values(this.data.challenges).filter(c => (c.from === id || c.to === id) && c.status === 'pending').map(c => this.invitation(id, c.id));
    const history = Object.values(this.data.matches).filter(m => m.players.includes(id) && m.status === 'ended').sort((a, b) => b.ended - a.ended);
    return { user, friends, challenges, blocked: Object.keys(this.data.blocks).filter(k => k.startsWith(`${id}:`)).map(k => this.profile(k.slice(id.length + 1))),
      activeMatch: this.active(id)?.id ?? null,
      stats: { played: history.length, wins: history.filter(m => m.winner === m.players.indexOf(id)).length, draws: history.filter(m => m.winner === 'draw').length },
      history: history.slice(0, 20).map(m => ({ id: m.id, opponent: this.profile(m.players.find(p => p !== id)), result: m.winner === 'draw' ? 'draw' : m.winner === m.players.indexOf(id) ? 'win' : 'loss', reason: m.reason, ended: m.ended })) };
  }
  search(id, query) {
    if (!this.user(id).authId) fail('Create an account to find friends.');
    if (typeof query !== 'string' || query.trim().length < 3) return [];
    return Object.values(this.data.users).filter(u => u.authId && u.id !== id && !this.blocked(id, u.id) && u.username.toLowerCase().includes(query.toLowerCase().trim())).slice(0, 15).map(u => this.profile(u.id));
  }
}
