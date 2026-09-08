import { describe, expect, it } from 'vitest';
import { createRandomTeams, VIABLE_RANDOM_POOL } from './battleSetup';

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
