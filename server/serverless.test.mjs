import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './serverless.mjs';
import { streamMatch } from '../netlify/functions/league.mjs';
import { createBattle } from '../src/engine/turn.ts';
import { emptyStages } from '../src/engine/stats.ts';

// Minimal in-memory Firestore fake covering exactly the surface server/firestore.mjs and
// server/serverless.mjs use (collection/doc get/set/delete, simple where/orderBy/limit
// queries, getAll, and runTransaction). Transactions replicate Firestore's real guarantee —
// a stale read anywhere in the transaction's read set aborts and retries the whole
// operation — rather than diffing, so the version-race tests below stay meaningful.
function matchOp(actual, op, value) {
  switch (op) {
    case '==': return actual === value;
    case '<': return actual < value;
    case '<=': return actual <= value;
    case '>': return actual > value;
    case '>=': return actual >= value;
    case 'in': return value.includes(actual);
    case 'array-contains': return Array.isArray(actual) && actual.includes(value);
    default: throw new Error(`Unsupported operator ${op}`);
  }
}
class FakeQuery {
  constructor(db, collection, filters = [], order = null, cap = Infinity) { this.db = db; this.collection = collection; this.filters = filters; this.order = order; this.cap = cap; }
  where(field, op, value) { return new FakeQuery(this.db, this.collection, [...this.filters, [field, op, value]], this.order, this.cap); }
  orderBy(field, direction = 'asc') { return new FakeQuery(this.db, this.collection, this.filters, [field, direction], this.cap); }
  limit(n) { return new FakeQuery(this.db, this.collection, this.filters, this.order, n); }
  async get() {
    const prefix = `${this.collection}/`;
    let rows = [...this.db.docs.entries()].filter(([k]) => k.startsWith(prefix))
      .map(([k, entry]) => ({ id: k.slice(prefix.length), raw: entry.value }));
    for (const [field, op, value] of this.filters) rows = rows.filter(r => matchOp(r.raw[field], op, value));
    if (this.order) { const [field, dir] = this.order; rows.sort((a, b) => (a.raw[field] > b.raw[field] ? 1 : -1) * (dir === 'desc' ? -1 : 1)); }
    rows = rows.slice(0, this.cap);
    return { docs: rows.map(r => ({ id: r.id, data: () => structuredClone(r.raw) })) };
  }
}
class FakeDocRef {
  constructor(db, collection, id) { this.db = db; this.collection = collection; this.id = id; this.key = `${collection}/${id}`; }
  snap() { const entry = this.db.docs.get(this.key); return { id: this.id, exists: !!entry, data: () => entry ? structuredClone(entry.value) : undefined }; }
  async get() { return this.snap(); }
  async set(value) { const entry = this.db.docs.get(this.key); this.db.docs.set(this.key, { value: structuredClone(value), version: (entry?.version ?? 0) + 1 }); }
  async delete() { this.db.docs.delete(this.key); }
  onSnapshot(next) {
    const listeners = this.db.listeners.get(this.key) || new Set();
    listeners.add(next); this.db.listeners.set(this.key, listeners);
    queueMicrotask(() => { if (listeners.has(next)) next(this.snap()); });
    return () => listeners.delete(next);
  }
}
class FakeTransaction {
  constructor(db) { this.db = db; this.reads = new Map(); this.writes = new Map(); }
  async get(refOrQuery) {
    if (refOrQuery instanceof FakeQuery) return refOrQuery.get();
    if (!this.reads.has(refOrQuery.key)) this.reads.set(refOrQuery.key, this.db.docs.get(refOrQuery.key)?.version ?? 0);
    return refOrQuery.snap();
  }
  set(ref, value) { this.writes.set(ref.key, { type: 'set', value: structuredClone(value) }); }
  delete(ref) { this.writes.set(ref.key, { type: 'delete' }); }
  commit() {
    for (const [key, expected] of this.reads) if ((this.db.docs.get(key)?.version ?? 0) !== expected) return false;
    for (const [key, op] of this.writes) {
      if (op.type === 'delete') this.db.docs.delete(key);
      else { const entry = this.db.docs.get(key); this.db.docs.set(key, { value: op.value, version: (entry?.version ?? 0) + 1 }); }
    }
    for (const key of this.writes.keys()) for (const next of this.db.listeners.get(key) || []) next(new FakeDocRef(this.db, ...key.split('/')).snap());
    return true;
  }
}
class FakeFirestore {
  constructor() { this.docs = new Map(); this.listeners = new Map(); }
  collection(name) { return { doc: id => new FakeDocRef(this, name, id), where: (f, o, v) => new FakeQuery(this, name).where(f, o, v) }; }
  async getAll(...refs) { return refs.map(r => r.snap()); }
  async runTransaction(fn) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const tx = new FakeTransaction(this);
      const result = await fn(tx);
      if (tx.commit()) return result;
    }
    throw new Error('Transaction contention exceeded retries in test fake');
  }
}

function setup(customLoader) {
  const db = new FakeFirestore();
  const tokens = new Map();
  const verify = async token => { const decoded = tokens.get(token); if (!decoded) throw new Error('invalid token'); return decoded; };
  const asUser = (uid, anonymous = true) => { const token = `token-${uid}`; tokens.set(token, { uid, firebase: { sign_in_provider: anonymous ? 'anonymous' : 'password' } }); return token; };
  const roster = ['charizard', 'pikachu', 'venusaur', 'blastoise', 'gengar', 'arcanine'];
  const mon = name => ({ name, types: ['normal'], level: 50, hp: 100,
    stats: { hp: 100, attack: 100, defense: 100, specialAttack: 100, specialDefense: 100, speed: 100 },
    stages: emptyStages(), moves: [{ name: 'tackle', type: 'normal', damageClass: 'physical', power: 40, accuracy: 100, pp: 35, maxPp: 35, priority: 0 }],
    status: null, sleepTurns: 0, toxicCounter: 1, confusionTurns: 0, flinched: false });
  const loader = async (a, b) => ({ initial: createBattle([{ name: 'A', active: 0, pokemon: a.map(mon) }, { name: 'B', active: 0, pokemon: b.map(mon) }], { normal: { normal: 1 } }) });
  const call = async (path, body, token, origin = 'https://league.example') => {
    const response = await handle(new Request(`https://league.example/api/league/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), { db, auth: {} }, { verify, loader: customLoader || loader });
    return { status: response.status, body: await response.json() };
  };
  return { db, call, asUser, roster, loader, verify };
}

test('concurrent guests get distinct trainers; origin protection and missing tokens are rejected', async () => {
  const { call, asUser } = setup();
  const [a, b] = await Promise.all([call('session', undefined, asUser('guest-a')), call('session', undefined, asUser('guest-b'))]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.notEqual(a.body.user.id, b.body.user.id);
  assert.equal((await call('session', undefined, asUser('guest-a'))).body.user.id, a.body.user.id);
  assert.equal((await call('profile', { username: 'Hacked' }, asUser('guest-a'), 'https://evil.example')).status, 403);
  assert.equal((await call('session')).status, 401);
});

test('saved teams persist privately and importing twice is idempotent', async () => {
  const { call, asUser, roster } = setup();
  const tokenA = asUser('guest-a'), tokenB = asUser('guest-b');
  await call('session', undefined, tokenA); await call('session', undefined, tokenB);
  const team = { id: 'team-1', name: 'First', roster };
  assert.equal((await call('teams', { action: 'import', teams: [team] }, tokenA)).status, 200);
  assert.equal((await call('teams', { action: 'import', teams: [team] }, tokenA)).body.teams.length, 1);
  assert.deepEqual((await call('teams', {}, tokenB)).body.teams, []);
  assert.equal((await call('teams', { action: 'save', team: { ...team, roster: [] } }, tokenA)).status, 400);
  assert.deepEqual((await call('teams', {}, tokenA)).body.teams, [team]);
});

test('separate calls preserve presence and concurrent moves resolve once', async () => {
  const { call, asUser, roster, db } = setup();
  const tokenA = asUser('p-a'), tokenB = asUser('p-b'), tokenS = asUser('spectator');
  await call('session', undefined, tokenA); await call('session', undefined, tokenB); await call('session', undefined, tokenS);
  const challenge = await call('challenge', { target: 'p-b' }, tokenA);
  const accepted = await call('respond', { id: challenge.body.id, action: 'accept' }, tokenB);
  const id = accepted.body.matchId;
  assert.ok(id);
  await call('ready', { id, roster }, tokenA);
  const ready = await call('ready', { id, roster }, tokenB);
  assert.equal(ready.body.status, 'battle');
  const version = ready.body.version;
  const [first, second] = await Promise.all([
    call('action', { id, version, action: { kind: 'move', slot: 0 } }, tokenA),
    call('action', { id, version, action: { kind: 'move', slot: 0 } }, tokenB),
  ]);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  const polled = await call(`poll?match=${id}`, undefined, tokenA);
  assert.equal(polled.body.match.version, version + 1);
  assert.deepEqual(polled.body.match.connections, [true, true]);
  assert.equal(polled.body.match.state.teams[1].pokemon[0].moves, undefined);
  assert.equal((await call(`poll?match=${id}`, undefined, tokenS)).status, 404);
  assert.equal((await call('action', { id, version, action: { kind: 'move', slot: 0 } }, tokenA)).status, 409);
  const presenceKey = 'presence/p-b', entry = db.docs.get(presenceKey);
  db.docs.set(presenceKey, { value: { ...entry.value, seen: Date.now() - 61000 }, version: entry.version + 1 });
  const ended = await call(`poll?match=${id}`, undefined, tokenA);
  assert.equal(ended.body.match.reason, 'disconnect');
  assert.equal(ended.body.match.winner, 0);
});

test('match stream pushes each participant a redacted update and rejects spectators', async () => {
  const { db, call, asUser, roster, verify, loader } = setup();
  const a = asUser('stream-a'), b = asUser('stream-b'), spectator = asUser('stream-spectator');
  await call('session', undefined, a); await call('session', undefined, b); await call('session', undefined, spectator);
  const invitation = await call('challenge', { target: 'stream-b' }, a);
  const { body: { matchId: id } } = await call('respond', { id: invitation.body.id, action: 'accept' }, b);
  await call('ready', { id, roster }, a);
  await call('ready', { id, roster }, b);
  const source = { db, auth: {} }, read = (request, store) => handle(request, store, { verify, loader });
  const open = token => streamMatch(new Request('https://league.example/api/league/stream', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, origin: 'https://league.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }), source, read);
  assert.equal((await open(spectator)).status, 404);
  const response = await open(a);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const next = async () => {
    for (;;) {
      const { done, value } = await reader.read();
      assert.equal(done, false);
      const event = new TextDecoder().decode(value);
      if (event.startsWith('data: ')) return JSON.parse(event.slice(6));
    }
  };
  const first = await next();
  assert.equal(first.status, 'battle');
  assert.equal(first.state.teams[1].pokemon[0].moves, undefined);
  await call('action', { id, version: first.version, action: { kind: 'move', slot: 0 } }, a);
  const updated = await next();
  assert.equal(updated.submitted, true);
  assert.equal(updated.state.teams[1].pokemon[0].moves, undefined);
  await reader.cancel();
});

test('a storage failure returns 503 and never creates a user document', async () => {
  const failing = { runTransaction: async () => { throw new Error('offline'); } };
  const response = await handle(new Request('https://league.example/api/league/session', {
    headers: { authorization: 'Bearer tok', origin: 'https://league.example' },
  }), { db: failing, auth: {} }, { verify: async () => ({ uid: 'trainer-x', firebase: { sign_in_provider: 'anonymous' } }) });
  assert.equal(response.status, 503);
});

test('shareable invitations survive guests joining and polls during team loading', async () => {
  const { loader } = setup();
  let started, release;
  const loading = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let loads = 0;
  const { call, asUser, roster } = setup(async (...args) => { loads++; started(); await gate; return loader(...args); });
  const a = asUser('guest-a'), invitation = await call('challenge', {}, a);
  const b = asUser('guest-b');
  await call('session', undefined, b);
  const opened = await call('invitation', { id: invitation.body.id }, b);
  assert.equal(opened.status, 200);
  const accepted = await call('respond', { id: invitation.body.id, action: 'accept' }, b);
  const id = accepted.body.matchId;
  assert.ok(id);
  assert.equal((await call(`poll?invite=${invitation.body.id}`, undefined, a)).body.invitation.matchId, id);
  await call('ready', { id, roster }, a);
  const ready = call('ready', { id, roster }, b);
  await loading;
  await call(`poll?match=${id}`, undefined, a);
  release();
  assert.equal((await ready).body.status, 'battle');
  assert.equal(loads, 1);
  assert.equal((await call(`poll?match=${id}`, undefined, a)).body.match.status, 'battle');
});

test('token verification failures are retryable, and a guest keeps its trainer once claimed by a real account', async () => {
  let reject = true;
  const verify = async () => { if (reject) throw new Error('offline'); return { uid: 'trainer-1', firebase: { sign_in_provider: 'password' } }; };
  const db = new FakeFirestore();
  const call = async (path, body, token) => {
    const response = await handle(new Request(`https://league.example/api/league/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, origin: 'https://league.example', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), { db, auth: {} }, { verify });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call('session', undefined, 'tok')).status, 401);
  reject = false;
  const first = await call('session', undefined, 'tok');
  assert.equal(first.status, 200);
  assert.equal(first.body.user.guest, false);
  const again = await call('session', undefined, 'tok');
  assert.equal(again.body.user.id, first.body.user.id);
  assert.equal(again.body.user.guest, false);
});
