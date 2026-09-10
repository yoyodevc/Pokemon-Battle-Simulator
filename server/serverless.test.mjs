import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './serverless.mjs';
import { blankData } from './league.mjs';
import { createBattle } from '../src/engine/turn.ts';
import { emptyStages } from '../src/engine/stats.ts';

function setup() {
  let version = 0, payload = { ...blankData(), presence: {}, limits: {} };
  const store = {
    async read() { return { version, payload: structuredClone(payload) }; },
    async write(expected, next) {
      if (version !== expected) return false;
      version++; payload = structuredClone(next); return true;
    },
  };
  const roster = ['charizard', 'pikachu', 'venusaur', 'blastoise', 'gengar', 'arcanine'];
  const mon = name => ({ name, types: ['normal'], level: 50, hp: 100,
    stats: { hp: 100, attack: 100, defense: 100, specialAttack: 100, specialDefense: 100, speed: 100 },
    stages: emptyStages(), moves: [{ name: 'tackle', type: 'normal', damageClass: 'physical', power: 40, accuracy: 100, pp: 35, maxPp: 35, priority: 0 }],
    status: null, sleepTurns: 0, toxicCounter: 1, confusionTurns: 0, flinched: false });
  const loader = async (a, b) => ({ initial: createBattle([{ name: 'A', active: 0, pokemon: a.map(mon) }, { name: 'B', active: 0, pokemon: b.map(mon) }], { normal: { normal: 1 } }) });
  const call = async (path, body, cookie = '', origin = 'https://league.example') => {
    const response = await handle(new Request(`https://league.example/api/league/${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { cookie, origin, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), store, { ip: '127.0.0.1', loader });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], body: await response.json() };
  };
  return { store, call, roster };
}

test('concurrent guests survive cold requests; logout and origin protections hold', async () => {
  const { call, store } = setup();
  const [a, b] = await Promise.all([call('guest', {}), call('guest', {})]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.notEqual(a.body.user.id, b.body.user.id);
  assert.equal(Object.keys((await store.read()).payload.users).length, 2);
  assert.equal((await call('session', undefined, a.cookie)).body.user.id, a.body.user.id);
  assert.equal((await call('profile', { username: 'Hacked' }, a.cookie, 'https://evil.example')).status, 403);
  assert.equal((await call('session')).status, 401);
  await call('logout', {}, a.cookie);
  assert.equal((await call('session', undefined, a.cookie)).status, 401);
});

test('saved teams persist privately and importing twice is idempotent', async () => {
  const { call, roster } = setup();
  const a = await call('guest', {}), b = await call('guest', {});
  const team = { id: 'team-1', name: 'First', roster };
  assert.equal((await call('teams', { action: 'import', teams: [team] }, a.cookie)).status, 200);
  assert.equal((await call('teams', { action: 'import', teams: [team] }, a.cookie)).body.teams.length, 1);
  assert.deepEqual((await call('teams', {}, b.cookie)).body.teams, []);
  assert.equal((await call('teams', { action: 'save', team: { ...team, roster: [] } }, a.cookie)).status, 400);
  assert.deepEqual((await call('teams', {}, a.cookie)).body.teams, [team]);
});

test('separate function calls preserve presence and concurrent moves resolve once', async () => {
  const { call, store, roster } = setup();
  const a = await call('guest', {}), b = await call('guest', {}), spectator = await call('guest', {});
  const challenge = await call('challenge', { target: b.body.user.id }, a.cookie);
  const accepted = await call('respond', { id: challenge.body.id, action: 'accept' }, b.cookie);
  const id = accepted.body.matchId;
  assert.ok(id);
  await call('ready', { id, roster }, a.cookie);
  const ready = await call('ready', { id, roster }, b.cookie);
  assert.equal(ready.body.status, 'battle');
  const version = ready.body.version;
  const [first, second] = await Promise.all([
    call('action', { id, version, action: { kind: 'move', slot: 0 } }, a.cookie),
    call('action', { id, version, action: { kind: 'move', slot: 0 } }, b.cookie),
  ]);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  const polled = await call(`poll?match=${id}`, undefined, a.cookie);
  assert.equal(polled.body.match.version, version + 1);
  assert.deepEqual(polled.body.match.connections, [true, true]);
  assert.equal(polled.body.match.state.teams[1].pokemon[0].moves, undefined);
  assert.equal((await call(`poll?match=${id}`, undefined, spectator.cookie)).status, 404);
  assert.equal((await call('action', { id, version, action: { kind: 'move', slot: 0 } }, a.cookie)).status, 409);
  const snapshot = await store.read();
  snapshot.payload.presence[b.body.user.id].seen = Date.now() - 61000;
  await store.write(snapshot.version, snapshot.payload);
  const ended = await call(`poll?match=${id}`, undefined, a.cookie);
  assert.equal(ended.body.match.reason, 'disconnect');
  assert.equal(ended.body.match.winner, 0);
});

test('database failure never issues an unpersisted guest cookie', async () => {
  const response = await handle(new Request('https://league.example/api/league/guest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }), { async read() { return { version: 0, payload: blankData() }; }, async write() { throw new Error('offline'); } });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
});
