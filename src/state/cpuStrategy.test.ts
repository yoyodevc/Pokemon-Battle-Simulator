import { describe, expect, it } from 'vitest';
import { createBattle } from '../engine/turn';
import { DEMO_CHART, makeMove, makePokemon } from '../engine/fixtures';
import { chooseCpuAction } from './cpuStrategy';

function battleWithMoves() {
  return createBattle([
    { name: 'Player', active: 0, pokemon: [makePokemon('Bulbasaur', ['grass'])] },
    { name: 'CPU', active: 0, pokemon: [makePokemon('Venusaur', ['grass'], undefined, [
      makeMove({ name: 'Flamethrower', type: 'fire', damageClass: 'special', power: 90 }),
      makeMove({ name: 'Tackle', type: 'normal', power: 40 }),
    ])] },
  ], DEMO_CHART, 17);
}

function battleWithBadMatchup() {
  return createBattle([
    { name: 'Player', active: 0, pokemon: [makePokemon('Blastoise', ['water'])] },
    { name: 'CPU', active: 0, pokemon: [
      makePokemon('Charizard', ['fire'], undefined, [makeMove({ name: 'Ember', type: 'fire', power: 40 })]),
      makePokemon('Venusaur', ['grass'], undefined, [makeMove({ name: 'Razor Leaf', type: 'grass', power: 55 })]),
    ] },
  ], DEMO_CHART, 17);
}

describe('CPU strategy', () => {
  it('keeps rookie choices legal and deterministic for a seed', () => {
    const battle = battleWithMoves();
    const first = chooseCpuAction(battle, 'rookie', { rng: 5 });
    const second = chooseCpuAction(battle, 'rookie', { rng: 5 });
    expect(first).toEqual(second);
    expect(first?.kind).toBe('move');
  });

  it('trainer difficulty prefers a super-effective move', () => {
    const action = chooseCpuAction(battleWithMoves(), 'trainer', { rng: 5 });
    expect(action).toEqual({ kind: 'move', slot: 0 });
  });

  it('ace difficulty can choose a high-value finish', () => {
    const battle = battleWithMoves();
    battle.teams[0].pokemon[0]!.hp = 1;
    const action = chooseCpuAction(battle, 'ace', { rng: 5 });
    expect(action).toEqual({ kind: 'move', slot: 0 });
  });

  it('ace difficulty recognizes a losing matchup and switches to coverage', () => {
    const action = chooseCpuAction(battleWithBadMatchup(), 'ace', { rng: 5 });
    expect(action).toEqual({ kind: 'switch', slot: 1 });
  });
});
