import { describe, expect, it } from 'vitest';
import { createCompetitiveTeams, createRandomTeams, VIABLE_RANDOM_POOL } from './battleSetup';

describe('team presets', () => {
  it('creates two distinct six-Pokémon teams from the viable pool', () => {
    const [player, rival] = createRandomTeams(VIABLE_RANDOM_POOL, () => 0.37);
    expect(player).toHaveLength(6);
    expect(rival).toHaveLength(6);
    expect(new Set([...player, ...rival]).size).toBe(12);
    expect([...player, ...rival].every((name) => VIABLE_RANDOM_POOL.includes(name))).toBe(true);
  });

  it('rejects an incomplete dex response instead of creating weak filler teams', () => {
    expect(() => createRandomTeams(['pikachu', 'magikarp'], () => 0.5)).toThrow(/twelve/i);
  });
});

describe('createCompetitiveTeams', () => {
  it('creates two distinct teams and changes with the random source', () => {
    const available = [...VIABLE_RANDOM_POOL, 'starmie', 'corviknight', 'volcarona', 'dragapult', 'ferrothorn', 'gliscor', 'heatran', 'toxapex', 'clefable', 'landorus-therian', 'kingambit', 'gholdengo'];
    const [firstPlayer, firstEnemy] = createCompetitiveTeams(available, () => 0.1);
    const [secondPlayer, secondEnemy] = createCompetitiveTeams(available, () => 0.9);
    expect(new Set([...firstPlayer, ...firstEnemy]).size).toBe(12);
    expect(new Set([...secondPlayer, ...secondEnemy]).size).toBe(12);
    expect([...firstPlayer, ...firstEnemy]).not.toEqual([...secondPlayer, ...secondEnemy]);
  });
});
