import { describe, expect, it } from 'vitest';
import { DEMO_CHART, demoTeams, makeMove, makePokemon } from './fixtures.ts';
import { createBattle, legalActions, resolveTurn } from './turn.ts';
import type { Action, BattleState, Move } from './types.ts';

const attack: Action = { kind: 'move', slot: 0 };
const switchOut: Action = { kind: 'switch', slot: 1 };

function setup(a: Partial<Move> = {}, b: Partial<Move> = {}): BattleState {
  const state = createBattle([
    { name: 'A', active: 0, pokemon: [makePokemon('Alpha', ['normal'], undefined, [makeMove(a)]), makePokemon('Reserve A')] },
    { name: 'B', active: 0, pokemon: [makePokemon('Beta', ['normal'], undefined, [makeMove(b)]), makePokemon('Reserve B')] },
  ], DEMO_CHART, 1);
  state.teams[0].pokemon[0]!.stats.speed = 150;
  return state;
}

describe('turn ordering', () => {
  it('resolves higher speed first', () => {
    const result = resolveTurn(setup(), [attack, attack]);
    expect(result.events.filter((event) => event.kind === 'move').map((event) => event.side)).toEqual([0, 1]);
  });
  it('resolves priority before speed', () => {
    const result = resolveTurn(setup({}, { priority: 1 }), [attack, attack]);
    expect(result.events.find((event) => event.kind === 'move')?.side).toBe(1);
  });
  it('orders using paralysis-modified speed', () => {
    const state = setup();
    state.teams[0].pokemon[0]!.status = 'paralysis';
    const result = resolveTurn(state, [attack, attack]);
    expect(result.events.find((event) => event.kind === 'move')?.side).toBe(1);
  });
  it('uses deterministic coin flips on exact ties', () => {
    const firstSides = new Set<number>();
    for (let seed = 0; seed < 10; seed += 1) {
      const state = setup();
      state.rng = seed;
      state.teams[0].pokemon[0]!.stats.speed = 100;
      firstSides.add(resolveTurn(state, [attack, attack]).events.find((event) => event.kind === 'move')!.side);
    }
    expect([...firstSides].sort()).toEqual([0, 1]);
  });
  it('switches before priority moves and attacks the incoming Pokemon', () => {
    const result = resolveTurn(setup({ priority: 5 }), [attack, switchOut]);
    expect(result.events[0]?.kind).toBe('switch');
    expect(result.state.teams[1].pokemon[0]!.hp).toBe(155);
    expect(result.state.teams[1].pokemon[1]!.hp).toBeLessThan(155);
  });
  it('orders simultaneous switches by outgoing speed', () => {
    const result = resolveTurn(setup(), [switchOut, switchOut]);
    expect(result.events.filter((event) => event.kind === 'switch').map((event) => event.side)).toEqual([0, 1]);
  });
});

describe('battle lifecycle', () => {
  it('preserves the entire input and replays state plus event log exactly', () => {
    const state = setup();
    const before = structuredClone(state);
    const first = resolveTurn(state, [attack, attack]);
    expect(state).toEqual(before);
    expect(resolveTurn(state, [attack, attack])).toEqual(first);
    expect(first.state.teams[0].pokemon[0]!.moves[0]!.pp).toBe(34);
  });
  it('prevents fainted actors from moving and grants a free replacement', () => {
    const state = setup({ power: 1000 });
    const first = resolveTurn(state, [attack, attack]);
    expect(first.events.filter((event) => event.kind === 'move')).toHaveLength(1);
    expect(first.state.phase).toBe('switch');
    const second = resolveTurn(first.state, [null, switchOut]);
    expect(second.state.turn).toBe(1);
    expect(second.state.phase).toBe('turn');
    expect(second.events.map((event) => event.kind)).toEqual(['switch']);
    expect(second.state.teams[0].pokemon[0]!.moves[0]!.pp).toBe(34);
  });
  it('queued opponent move misses after recoil leaves an empty slot', () => {
    const state = setup({ power: 40, drain: -100 });
    state.teams[0].pokemon[0]!.hp = 1;
    const result = resolveTurn(state, [attack, attack]);
    expect(result.events.some((event) => event.kind === 'miss' && event.side === 1)).toBe(true);
    expect(result.state.phase).toBe('switch');
  });
  it('resolves simultaneous residual knockouts as a draw', () => {
    const state = setup({ accuracy: 0 }, { accuracy: 0 });
    for (const team of state.teams) {
      team.pokemon.length = 1;
      team.pokemon[0]!.hp = 1;
      team.pokemon[0]!.status = 'poison';
    }
    const result = resolveTurn(state, [attack, attack]);
    expect(result.state).toMatchObject({ phase: 'ended', winner: 'draw' });
    expect(result.events.filter((event) => event.kind === 'faint')).toHaveLength(2);
  });
  it('allows both free replacements without residual damage or turn advancement', () => {
    const state = setup();
    state.phase = 'switch';
    for (const team of state.teams) {
      team.pokemon[0]!.hp = 0;
      team.pokemon[1]!.status = 'poison';
    }
    const result = resolveTurn(state, [switchOut, switchOut]);
    expect(result.state.turn).toBe(0);
    expect(result.state.teams[0].pokemon[1]!.hp).toBe(155);
    expect(result.state.phase).toBe('turn');
  });
  it('ends with a winner when the final opponent faints', () => {
    const state = setup({ power: 1000 });
    state.teams[1].pokemon.length = 1;
    const result = resolveTurn(state, [attack, attack]);
    expect(result.state).toMatchObject({ phase: 'ended', winner: 0 });
    expect(legalActions(result.state, 0)).toEqual([]);
    expect(() => resolveTurn(result.state, [attack, attack])).toThrow('ended');
  });
  it('supports forfeit and rejects invalid moves or switches without changing state', () => {
    const state = setup();
    expect(resolveTurn(state, [{ kind: 'forfeit' }, attack]).state.winner).toBe(1);
    expect(resolveTurn(state, [{ kind: 'forfeit' }, { kind: 'forfeit' }]).state.winner).toBe('draw');
    expect(() => resolveTurn(state, [{ kind: 'move', slot: 99 }, attack])).toThrow('Illegal');
    expect(() => resolveTurn(state, [{ kind: 'switch', slot: 0 }, attack])).toThrow('Illegal');
  });
  it('offers Struggle only when every move is exhausted', () => {
    const state = setup({ pp: 0 });
    expect(legalActions(state, 0)).toContainEqual({ kind: 'move', slot: -1 });
    expect(() => resolveTurn(state, [attack, attack])).toThrow('Illegal');
    const result = resolveTurn(state, [{ kind: 'move', slot: -1 }, switchOut]);
    expect(result.state.teams[0].pokemon[0]!.hp).toBe(117);
    expect(result.state.teams[0].pokemon[0]!.moves[0]!.pp).toBe(0);
  });
});

describe('move effects', () => {
  it('misses consume PP but do not deal damage', () => {
    const result = resolveTurn(setup({ accuracy: 0 }, { accuracy: 0 }), [attack, attack]);
    expect(result.events.filter((event) => event.kind === 'miss')).toHaveLength(2);
    expect(result.state.teams[0].pokemon[0]!.moves[0]!.pp).toBe(34);
    expect(result.state.teams[1].pokemon[0]!.hp).toBe(155);
  });
  it('immunity blocks damage and secondary status', () => {
    const state = setup({ type: 'electric', ailment: 'paralysis', ailmentChance: 100 }, { accuracy: 0 });
    state.teams[1].pokemon[0]!.types = ['ground'];
    const result = resolveTurn(state, [attack, attack]);
    expect(result.state.teams[1].pokemon[0]!).toMatchObject({ hp: 155, status: null });
    expect(result.events.some((event) => event.message.includes("doesn't affect"))).toBe(true);
  });
  it('fire hits thaw frozen opponents before they act', () => {
    const state = setup({ type: 'fire' });
    state.teams[1].pokemon[0]!.status = 'freeze';
    const result = resolveTurn(state, [attack, attack]);
    expect(result.state.teams[1].pokemon[0]!.status).toBeNull();
    expect(result.events.filter((event) => event.kind === 'move')).toHaveLength(2);
  });
  it('flinches only a queued opponent and clears flinch at turn end', () => {
    const result = resolveTurn(setup({ flinchChance: 100 }), [attack, attack]);
    expect(result.events.filter((event) => event.kind === 'move')).toHaveLength(1);
    expect(result.state.teams[1].pokemon[0]!.flinched).toBe(false);
    const late = resolveTurn(setup({}, { flinchChance: 100 }), [attack, attack]);
    expect(late.events.filter((event) => event.kind === 'move')).toHaveLength(2);
    expect(late.events.some((event) => event.kind === 'unable')).toBe(false);
  });
  it('rolls critical hits independently for each multi-hit strike', () => {
    const result = resolveTurn(setup({ minHits: 3, maxHits: 3, power: 1, critRate: 3 }), [attack, switchOut]);
    expect(result.events.filter((event) => event.kind === 'critical')).toHaveLength(3);
    expect(result.events.find((event) => event.kind === 'hits')?.amount).toBe(3);
  });
  it('stops multi-hit moves immediately on faint', () => {
    const result = resolveTurn(setup({ minHits: 5, maxHits: 5, power: 1000 }), [attack, attack]);
    expect(result.events.find((event) => event.kind === 'hits')?.amount).toBe(1);
    expect(result.events.filter((event) => event.kind === 'faint')).toHaveLength(1);
  });
  it('drain uses actual HP lost, not overkill damage', () => {
    const state = setup({ power: 1000, drain: 50 });
    state.teams[0].pokemon[0]!.hp = 50;
    state.teams[1].pokemon[0]!.hp = 10;
    const result = resolveTurn(state, [attack, attack]);
    expect(result.state.teams[0].pokemon[0]!.hp).toBe(55);
  });
  it('self healing and stat changes affect only the user', () => {
    const state = setup({ target: 'self', power: null, damageClass: 'status', healing: 50,
      statChanges: [{ stat: 'attack', change: 2 }] }, { accuracy: 0 });
    state.teams[0].pokemon[0]!.hp = 20;
    const result = resolveTurn(state, [attack, attack]);
    expect(result.state.teams[0].pokemon[0]!.hp).toBe(97);
    expect(result.state.teams[0].pokemon[0]!.stages.attack).toBe(2);
    expect(result.state.teams[1].pokemon[0]!.stages.attack).toBe(0);
  });
  it('applies guaranteed secondary status and stage effects', () => {
    const result = resolveTurn(setup({ ailment: 'poison', ailmentChance: 100,
      statChanges: [{ stat: 'defense', change: -1 }], statChance: 100 }, { accuracy: 0 }), [attack, attack]);
    expect(result.state.teams[1].pokemon[0]!.status).toBe('poison');
    expect(result.state.teams[1].pokemon[0]!.stages.defense).toBe(-1);
  });
  it('applies user stat effects even when the attack knocks out its target', () => {
    const result = resolveTurn(setup({ power: 1000, statTarget: 'self', statChance: 100,
      statChanges: [{ stat: 'attack', change: 1 }] }), [attack, attack]);
    expect(result.state.teams[0].pokemon[0]!.stages.attack).toBe(1);
  });
});

it('completes the offline fixture battle deterministically', () => {
  let state = createBattle(demoTeams(), DEMO_CHART, 1);
  for (let step = 0; step < 100 && state.phase !== 'ended'; step += 1) {
    const choose = (side: 0 | 1): Action | null => legalActions(state, side)
      .find((action) => action.kind === (state.phase === 'switch' ? 'switch' : 'move')) ?? null;
    state = resolveTurn(state, [choose(0), choose(1)]).state;
  }
  expect(state.phase).toBe('ended');
});
