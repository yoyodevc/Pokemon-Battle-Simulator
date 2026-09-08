import { describe, expect, it } from 'vitest';
import { chooseMoveset, levelUpPool, selectMoveset } from './moveSelect';
import type { Move, Pokemon } from './types';

function move(name: string, type: string, power: number | null): Move {
  return {
    id: 1, name, power, accuracy: 100, pp: 10, priority: 0,
    type: { name: type, url: '' },
    damage_class: { name: power === null ? 'status' : 'physical', url: '' },
    effect_chance: null, meta: null, stat_changes: [], effect_entries: [],
  };
}

const pokemon: Pokemon = {
  id: 25, name: 'pikachu', height: 4, weight: 60, stats: [], types: [],
  sprites: { front_default: null, back_default: null, front_shiny: null, back_shiny: null },
  cries: { latest: null, legacy: null },
  moves: ['thunder', 'quick-attack'].map((name, index) => ({
    move: { name, url: `move/${name}` },
    version_group_details: [{
      level_learned_at: 10 + index,
      move_learn_method: { name: 'level-up', url: '' },
      version_group: { name: 'red-blue', url: '' },
    }],
  })),
};

describe('move selection', () => {
  it('falls back to red-blue and sorts by descending learn level', () => {
    const pool = levelUpPool(pokemon);
    expect(pool.versionGroup).toBe('red-blue');
    expect(pool.moves.map((entry) => entry.name)).toEqual(['quick-attack', 'thunder']);
  });

  it('selects four moves with damaging coverage and at most two status moves', () => {
    const selected = chooseMoveset([
      move('growl', 'normal', null), move('tail-whip', 'normal', null),
      move('agility', 'psychic', null), move('thunder', 'electric', 110),
      move('thunderbolt', 'electric', 90), move('quick-attack', 'normal', 40),
      move('iron-tail', 'steel', 100),
    ]);
    expect(selected).toHaveLength(4);
    expect(selected.filter((entry) => entry.power === null).length).toBeLessThanOrEqual(2);
    expect(new Set(selected.filter((entry) => entry.power !== null).map((entry) => entry.type.name)).size).toBe(3);
  });

  it('ranks reliable STAB and coverage ahead of weaker late-learned attacks', () => {
    const selected = chooseMoveset([
      move('weak-stab', 'electric', 40), move('thunderbolt', 'electric', 90),
      move('ice-beam', 'ice', 90), move('tackle', 'normal', 40),
    ], { preferredTypes: ['electric'] });
    expect(selected[0]?.name).toBe('thunderbolt');
    expect(selected.map((entry) => entry.name)).toContain('ice-beam');
  });

  it('surfaces failed move hydration so the page offers retry', async () => {
    await expect(selectMoveset(pokemon, {
      async get<T>(): Promise<T> { throw new Error('Service unavailable'); },
    })).rejects.toThrow('Service unavailable');
  });
});
