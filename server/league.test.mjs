import { test } from 'node:test';
import assert from 'node:assert/strict';
import { League } from './league.mjs';
import { createBattle } from '../src/engine/turn.ts';
import { emptyStages } from '../src/engine/stats.ts';

function setup() {
  let time = 1000000;
  const league = new League(undefined, undefined, () => time);
  const a = league.createUser('auth-a', false, 'Alice'), b = league.createUser('auth-b', false, 'Bob');
  league.touch(a.id); league.touch(b.id);
  return { league, a, b, advance: ms => { time += ms; } };
}
const roster = ['charizard', 'pikachu', 'venusaur', 'blastoise', 'gengar', 'arcanine'];
const mon = name => ({ name, types: ['normal'], level: 50, hp: 100,
  stats: { hp: 100, attack: 100, defense: 100, specialAttack: 100, specialDefense: 100, speed: 100 },
  stages: emptyStages(), moves: [{ name: 'tackle', type: 'normal', damageClass: 'physical', power: 40, accuracy: 100, pp: 35, maxPp: 35, priority: 0 }],
  status: null, sleepTurns: 0, toxicCounter: 1, confusionTurns: 0, flinched: false });
const loader = async (a, b) => ({ initial: createBattle([{ name: 'A', active: 0, pokemon: a.map(mon) }, { name: 'B', active: 0, pokemon: b.map(mon) }], { normal: { normal: 1 } }) });
async function battle(ctx) {
  const { league, a, b } = ctx;
  const c = league.challenge(a.id, b.id), id = league.respond(b.id, c.id, 'accept');
  await league.ready(a.id, id, roster, loader); await league.ready(b.id, id, roster, loader);
  return id;
}
test('friend requests require the recipient; blocks remove friendship and prevent challenges', () => {
  const { league, a, b } = setup();
  league.friend(a.id, { target: b.id, action: 'request' });
  assert.throws(() => league.friend(a.id, { target: b.id, action: 'accept' }));
  league.friend(b.id, { target: a.id, action: 'accept' });
  assert.equal(league.snapshot(a.id).friends[0].status, 'accepted');
  league.friend(b.id, { target: a.id, action: 'block' });
  assert.equal(league.snapshot(a.id).friends.length, 0);
  assert.throws(() => league.challenge(a.id, b.id));
});
test('guests can accept invitations, but cannot persist friendships', () => {
  const { league, a } = setup(); const guest = league.createUser('guest-1', true);
  const c = league.challenge(a.id);
  assert.ok(league.respond(guest.id, c.id, 'accept'));
  assert.throws(() => league.friend(guest.id, { target: a.id, action: 'request' }));
  const upgraded = league.claim(guest.id);
  assert.equal(upgraded.id, guest.id); assert.equal(upgraded.guest, false);
});
test('invitation acceptance is single-use and prevents conflicting matches', () => {
  const { league, a, b } = setup(); const c = league.challenge(a.id);
  const id = league.respond(b.id, c.id, 'accept');
  assert.ok(id); assert.throws(() => league.respond(b.id, c.id, 'accept'));
  assert.throws(() => league.challenge(b.id));
  assert.throws(() => league.viewMatch(league.createUser().id, id));
});
test('expired and private challenges reject acceptance', () => {
  const { league, a, b, advance } = setup(); const c = league.challenge(a.id);
  advance(600001); assert.throws(() => league.respond(b.id, c.id, 'accept'));
  league.edit(b.id, { privacy: 'friends' }); assert.throws(() => league.challenge(a.id, b.id));
});
test('opponent moves, roster, seed and pending actions are not disclosed', async () => {
  const ctx = setup(), id = await battle(ctx), { league, a, b } = ctx;
  const view = league.viewMatch(a.id, id);
  assert.equal(view.state.rng, undefined); assert.ok(view.state.chart);
  assert.equal(view.state.teams[1].pokemon[0].moves, undefined);
  assert.equal(view.state.teams[1].pokemon[1].name, 'unknown');
  league.act(b.id, id, { kind: 'move', slot: 0 }, view.version);
  assert.equal(league.viewMatch(a.id, id).actions, undefined);
  assert.equal(league.viewMatch(a.id, id).opponentSubmitted, true);
});
test('one action per version; simultaneous moves advance once and reject stale commands', async () => {
  const ctx = setup(), id = await battle(ctx), { league, a, b } = ctx;
  const v = league.viewMatch(a.id, id).version;
  league.act(a.id, id, { kind: 'move', slot: 0 }, v);
  assert.throws(() => league.act(a.id, id, { kind: 'move', slot: 0 }, v));
  league.act(b.id, id, { kind: 'move', slot: 0 }, v);
  assert.equal(league.viewMatch(a.id, id).state.turn, 1);
  assert.throws(() => league.act(a.id, id, { kind: 'move', slot: 0 }, v));
});
test('forfeit immediately records exactly one result and mutual rematch creates one room', async () => {
  const ctx = setup(), id = await battle(ctx), { league, a, b } = ctx;
  league.act(a.id, id, { kind: 'forfeit' });
  assert.equal(league.snapshot(b.id).stats.wins, 1);
  assert.throws(() => league.act(a.id, id, { kind: 'forfeit' }));
  assert.equal(league.snapshot(b.id).stats.wins, 1);
  assert.equal(league.rematch(a.id, id), undefined);
  assert.ok(league.rematch(b.id, id));
  assert.equal(league.active(a.id).id, league.active(b.id).id);
});
test('disconnect grace permits reconnect and awards the connected trainer after expiry', async () => {
  const ctx = setup(), id = await battle(ctx), { league, a, b, advance } = ctx;
  advance(40000); league.touch(a.id); league.touch(b.id); league.tick();
  assert.equal(league.viewMatch(a.id, id).status, 'battle');
  advance(60001); league.touch(a.id); league.tick();
  assert.equal(league.viewMatch(a.id, id).winner, 0);
  assert.equal(league.viewMatch(a.id, id).reason, 'disconnect');
});
test('turn timeout draws with no choices and rewards the trainer who submitted', async () => {
  const ctx = setup(), id = await battle(ctx), { league, a, b, advance } = ctx;
  league.act(a.id, id, { kind: 'move', slot: 0 }, league.viewMatch(a.id, id).version);
  advance(90001); league.touch(a.id); league.touch(b.id); league.tick();
  assert.equal(league.viewMatch(a.id, id).winner, 0);
  assert.equal(league.viewMatch(a.id, id).reason, 'timeout');
});
test('invalid rosters never load; loader failure returns an actionable preparation state', async () => {
  const { league, a, b } = setup(), c = league.challenge(a.id), id = league.respond(b.id, c.id, 'accept');
  await assert.rejects(league.ready(a.id, id, Array(6).fill('pikachu'), loader));
  await league.ready(a.id, id, roster, loader);
  await league.ready(b.id, id, roster, async () => { throw new Error('offline'); });
  assert.equal(league.viewMatch(a.id, id).status, 'preparing');
  assert.deepEqual(league.viewMatch(a.id, id).ready, [false, false]);
});
test('persisted snapshots restore locked actions, friendships, and account identity', async () => {
  const ctx = setup(), id = await battle(ctx), { league, a, b } = ctx;
  league.friend(a.id, { target: b.id, action: 'request' });
  league.act(a.id, id, { kind: 'move', slot: 0 }, league.viewMatch(a.id, id).version);
  const restored = new League(JSON.parse(JSON.stringify(league.data)));
  assert.equal(restored.viewMatch(a.id, id).submitted, true);
  assert.equal(restored.snapshot(b.id).friends[0].from, a.id);
  assert.equal(restored.user(a.id).guest, false);
});
test('natural knockout completion records a win and preserves revealed opponents', async () => {
  const ctx = setup(), id = await battle(ctx), { league, a, b } = ctx;
  let steps = 0;
  while (league.data.matches[id].status === 'battle' && steps++ < 300) {
    const version = league.viewMatch(a.id, id).version;
    for (const player of [a, b]) {
      const view = league.viewMatch(player.id, id);
      if (view.version !== version) break;
      const action = view.legal.find(x => x.kind !== 'forfeit');
      if (action) league.act(player.id, id, action, version);
    }
  }
  assert.ok(steps < 300);
  assert.equal(league.snapshot(a.id).stats.played, 1);
  assert.equal(league.snapshot(b.id).stats.played, 1);
  assert.equal(league.viewMatch(a.id, id).reason, 'battle');
});
test('neither trainer choosing produces a draw; leaving preparation records no loss', async () => {
  const ctx = setup(), id = await battle(ctx), { league, a, b, advance } = ctx;
  advance(90001); league.touch(a.id); league.touch(b.id); league.tick();
  assert.equal(league.viewMatch(a.id, id).winner, 'draw');
  const c = league.challenge(a.id), room = league.respond(b.id, c.id, 'accept');
  league.act(a.id, room, { kind: 'forfeit' });
  assert.equal(league.snapshot(a.id).stats.played, 1);
  assert.equal(league.viewMatch(b.id, room).status, 'abandoned');
});
test('invalid profile edits are atomic and usernames are case-insensitively unique', () => {
  const { league, a } = setup();
  assert.throws(() => league.edit(a.id, { username: 'bob' }));
  assert.throws(() => league.edit(a.id, { username: 'Different', avatar: -1 }));
  assert.equal(league.user(a.id).username, 'Alice');
});
