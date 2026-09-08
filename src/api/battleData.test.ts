import { describe, expect, it } from 'vitest';
import { toBattleMove, toBattlePokemon } from './battleData';
import type { Move, MoveMeta, Pokemon } from './types';

function apiMove(overrides: Partial<Move> = {}): Move {
  return {
    id: 1, name: 'toxic', power: null, accuracy: 90, pp: 10, priority: 0,
    type: { name: 'poison', url: '' }, damage_class: { name: 'status', url: '' },
    effect_chance: null, meta: null, stat_changes: [], effect_entries: [], ...overrides,
  };
}

const meta: MoveMeta = {
  ailment: { name: 'none', url: '' }, ailment_chance: 0,
  category: { name: 'damage+raise', url: '' }, crit_rate: 1, drain: 50,
  flinch_chance: 10, healing: 0, max_hits: 5, min_hits: 2, max_turns: null,
  min_turns: null, stat_chance: 100,
};

describe('API engine boundary', () => {
  it('normalizes Toxic and guaranteed status chances', () => {
    expect(toBattleMove(apiMove())).toMatchObject({ ailment: 'toxic', ailmentChance: 100, pp: 10, maxPp: 10 });
  });
  it('maps special stat names and self buffs independently of attack targets', () => {
    const move = toBattleMove(apiMove({ name: 'test-attack', power: 40,
      damage_class: { name: 'special', url: '' }, meta,
      stat_changes: [{ stat: { name: 'special-attack', url: '' }, change: 1 }],
    }));
    expect(move).toMatchObject({ target: 'opponent', statTarget: 'self', minHits: 2, maxHits: 5,
      drain: 50, critRate: 1, flinchChance: 10,
      statChanges: [{ stat: 'specialAttack', change: 1 }],
    });
  });
  it('maps self-targeting recovery and zero metadata chances for status moves', () => {
    expect(toBattleMove(apiMove({ target: { name: 'user', url: '' },
      meta: { ...meta, healing: 50, stat_chance: 0 },
    }))).toMatchObject({ target: 'self', healing: 50, statChance: 100 });
  });
  it('hydrates stats and moves independently of cached API objects', () => {
    const pokemon: Pokemon = {
      id: 25, name: 'pikachu', height: 4, weight: 60,
      stats: ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'].map((name) => ({
        base_stat: name === 'hp' ? 35 : 55, effort: 0, stat: { name, url: '' },
      })), types: [{ slot: 1, type: { name: 'electric', url: '' } }], moves: [],
      sprites: { front_default: null, back_default: null, front_shiny: null, back_shiny: null },
      cries: { latest: null, legacy: null },
    };
    const move = apiMove();
    const result = toBattlePokemon(pokemon, [move]);
    expect(result).toMatchObject({ level: 50, hp: 110, types: ['electric'], status: null });
    result.moves[0]!.pp -= 1;
    expect(move.pp).toBe(10);
    expect(() => toBattlePokemon({ ...pokemon, stats: [] }, [])).toThrow('Missing base stats');
  });
});
