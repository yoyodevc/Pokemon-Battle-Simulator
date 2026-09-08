import { describe, expect, it } from 'vitest';
import type { NamedAPIResourceList, TypeInfo } from './types';
import {
  buildTypeChart,
  effectivenessMessage,
  isBattleType,
  lookupEffectiveness,
  typeEffectiveness,
  type TypeChartSource,
} from './typeChart';

/**
 * Offensive relations only; defensive relations are the transpose and are not read by
 * the builder. Written out longhand so the fixture stays an independent statement of the
 * expected chart rather than a re-derivation of the production code.
 */
const OFFENSE: Record<string, { double: string[]; half: string[]; none: string[] }> = {
  normal: { double: [], half: ['rock', 'steel'], none: ['ghost'] },
  fire: { double: ['grass', 'ice', 'bug', 'steel'], half: ['fire', 'water', 'rock', 'dragon'], none: [] },
  water: { double: ['fire', 'ground', 'rock'], half: ['water', 'grass', 'dragon'], none: [] },
  electric: { double: ['water', 'flying'], half: ['electric', 'grass', 'dragon'], none: ['ground'] },
  grass: {
    double: ['water', 'ground', 'rock'],
    half: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'],
    none: [],
  },
  ice: { double: ['grass', 'ground', 'flying', 'dragon'], half: ['fire', 'water', 'ice', 'steel'], none: [] },
  fighting: {
    double: ['normal', 'ice', 'rock', 'dark', 'steel'],
    half: ['poison', 'flying', 'psychic', 'bug', 'fairy'],
    none: ['ghost'],
  },
  poison: { double: ['grass', 'fairy'], half: ['poison', 'ground', 'rock', 'ghost'], none: ['steel'] },
  ground: {
    double: ['fire', 'electric', 'poison', 'rock', 'steel'],
    half: ['grass', 'bug'],
    none: ['flying'],
  },
  flying: { double: ['grass', 'fighting', 'bug'], half: ['electric', 'rock', 'steel'], none: [] },
  psychic: { double: ['fighting', 'poison'], half: ['psychic', 'steel'], none: ['dark'] },
  bug: {
    double: ['grass', 'psychic', 'dark'],
    half: ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'],
    none: [],
  },
  rock: { double: ['fire', 'ice', 'flying', 'bug'], half: ['fighting', 'ground', 'steel'], none: [] },
  ghost: { double: ['psychic', 'ghost'], half: ['dark'], none: ['normal'] },
  dragon: { double: ['dragon'], half: ['steel'], none: ['fairy'] },
  dark: { double: ['psychic', 'ghost'], half: ['fighting', 'dark', 'fairy'], none: [] },
  steel: { double: ['ice', 'rock', 'fairy'], half: ['fire', 'water', 'electric', 'steel'], none: [] },
  fairy: { double: ['fighting', 'dragon', 'dark'], half: ['fire', 'poison', 'steel'], none: [] },
};

const TYPE_IDS: Record<string, number> = {
  normal: 1, fighting: 2, flying: 3, poison: 4, ground: 5, rock: 6,
  bug: 7, ghost: 8, steel: 9, fire: 10, water: 11, grass: 12,
  electric: 13, psychic: 14, ice: 15, dragon: 16, dark: 17, fairy: 18,
  unknown: 10001, shadow: 10002,
};

const BASE = 'https://pokeapi.co/api/v2/';
const ref = (name: string) => ({ name, url: `${BASE}type/${TYPE_IDS[name]}/` });

function makeTypeInfo(name: string): TypeInfo {
  const relations = OFFENSE[name] ?? { double: [], half: [], none: [] };
  return {
    id: TYPE_IDS[name] ?? 0,
    name,
    damage_relations: {
      double_damage_to: relations.double.map(ref),
      half_damage_to: relations.half.map(ref),
      no_damage_to: relations.none.map(ref),
      // Defensive relations are irrelevant to the builder; left empty deliberately.
      double_damage_from: [],
      half_damage_from: [],
      no_damage_from: [],
    },
  };
}

/** Records every path requested so we can assert excluded types are never fetched. */
function makeSource(): TypeChartSource & { requested: string[] } {
  const requested: string[] = [];
  const allNames = Object.keys(TYPE_IDS);

  return {
    requested,
    async get<T>(path: string): Promise<T> {
      requested.push(path);

      if (path === 'type?limit=100') {
        const list: NamedAPIResourceList = {
          count: allNames.length,
          next: null,
          previous: null,
          results: allNames.map(ref),
        };
        return list as T;
      }

      const match = /type\/(\d+)\/?$/.exec(path);
      const id = Number(match?.[1]);
      const name = allNames.find((candidate) => TYPE_IDS[candidate] === id);
      if (name === undefined) throw new Error(`Unexpected type request: ${path}`);
      return makeTypeInfo(name) as T;
    },
  };
}

describe('isBattleType', () => {
  it('rejects placeholder and non-canonical types', () => {
    expect(isBattleType('unknown', 10001)).toBe(false);
    expect(isBattleType('shadow', 10002)).toBe(false);
    expect(isBattleType('custom', 10050)).toBe(false);
    expect(isBattleType('water', 11)).toBe(true);
  });
});

describe('buildTypeChart', () => {
  it('never requests excluded types', async () => {
    const source = makeSource();
    await buildTypeChart(source);

    expect(source.requested).toContain('type?limit=100');
    expect(source.requested).not.toContain(`${BASE}type/10001/`);
    expect(source.requested).not.toContain(`${BASE}type/10002/`);
    expect(source.requested).toHaveLength(19); // index + 18 battle types
  });

  it('omits excluded types from both axes', async () => {
    const chart = await buildTypeChart(makeSource());
    const attackers = Object.keys(chart);

    expect(attackers).toHaveLength(18);
    expect(attackers).not.toContain('unknown');
    expect(attackers).not.toContain('shadow');
    expect(Object.keys(chart.water ?? {})).toHaveLength(18);
    expect(chart.water).not.toHaveProperty('shadow');
  });

  it('matches known single-type matchups', async () => {
    const chart = await buildTypeChart(makeSource());

    expect(lookupEffectiveness(chart, 'water', 'fire')).toBe(2);
    expect(lookupEffectiveness(chart, 'electric', 'ground')).toBe(0);
    expect(lookupEffectiveness(chart, 'ghost', 'normal')).toBe(0);
    expect(lookupEffectiveness(chart, 'fighting', 'steel')).toBe(2);
    expect(lookupEffectiveness(chart, 'fire', 'water')).toBe(0.5);
    expect(lookupEffectiveness(chart, 'normal', 'normal')).toBe(1);
    expect(lookupEffectiveness(chart, 'dragon', 'fairy')).toBe(0);
    expect(lookupEffectiveness(chart, 'poison', 'steel')).toBe(0);
  });

  it('treats unlisted pairings as neutral', async () => {
    const chart = await buildTypeChart(makeSource());
    expect(lookupEffectiveness(chart, 'water', 'stellar')).toBe(1);
    expect(lookupEffectiveness(chart, 'stellar', 'water')).toBe(1);
  });
});

describe('typeEffectiveness', () => {
  it('multiplies across both of a dual-type defender', async () => {
    const chart = await buildTypeChart(makeSource());

    // Gyarados: doubly weak to Electric.
    expect(typeEffectiveness(chart, 'electric', ['water', 'flying'])).toBe(4);
    // Omastar: doubly resistant to Fire.
    expect(typeEffectiveness(chart, 'fire', ['rock', 'water'])).toBe(0.25);
    // Skarmory: Ground is walled by the Flying immunity despite Steel weakness.
    expect(typeEffectiveness(chart, 'ground', ['steel', 'flying'])).toBe(0);
    // Charizard: Rock hits both halves for double.
    expect(typeEffectiveness(chart, 'rock', ['fire', 'flying'])).toBe(4);
    // Neutral single type.
    expect(typeEffectiveness(chart, 'normal', ['water'])).toBe(1);
  });
});

describe('effectivenessMessage', () => {
  it('describes each multiplier band', () => {
    expect(effectivenessMessage(0, 'Gengar')).toBe("It doesn't affect Gengar…");
    expect(effectivenessMessage(2, 'Gengar')).toBe("It's super effective!");
    expect(effectivenessMessage(4, 'Gengar')).toBe("It's super effective!");
    expect(effectivenessMessage(0.5, 'Gengar')).toBe("It's not very effective…");
    expect(effectivenessMessage(1, 'Gengar')).toBeNull();
  });
});
