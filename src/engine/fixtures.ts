import { calculateStats, emptyStages } from './stats.ts';
import type { Move, Pokemon, Stats, Team, TypeChart } from './types.ts';

export function makeMove(overrides: Partial<Move> = {}): Move {
  return { name: 'Tackle', type: 'normal', damageClass: 'physical', power: 40,
    accuracy: 100, pp: 35, maxPp: 35, priority: 0, ...overrides };
}

export function makePokemon(name: string, types: string[] = ['normal'],
  base: Stats = { hp: 80, attack: 80, defense: 80, specialAttack: 80, specialDefense: 80, speed: 80 },
  moves: Move[] = [makeMove()]): Pokemon {
  const stats = calculateStats(base);
  return { name, types, level: 50, stats, hp: stats.hp, stages: emptyStages(),
    moves: structuredClone(moves), status: null, sleepTurns: 0, toxicCounter: 1,
    confusionTurns: 0, flinched: false };
}

/** Offline demonstration fixture only. Production charts still come from PokéAPI. */
export const DEMO_CHART: TypeChart = {
  fire: { grass: 2, water: 0.5, fire: 0.5 },
  water: { fire: 2, grass: 0.5, water: 0.5 },
  grass: { water: 2, fire: 0.5, grass: 0.5, poison: 0.5, flying: 0.5 },
  electric: { water: 2, ground: 0, grass: 0.5, electric: 0.5, flying: 2 },
  poison: { grass: 2, poison: 0.5 },
  normal: { ghost: 0 }, ghost: { normal: 0 }, fighting: { steel: 2 },
};

export function demoTeams(): [Team, Team] {
  return [
    { name: 'Red', active: 0, pokemon: [
      makePokemon('Charizard', ['fire', 'flying'],
        { hp: 78, attack: 84, defense: 78, specialAttack: 109, specialDefense: 85, speed: 100 }, [
          makeMove({ name: 'Flamethrower', type: 'fire', damageClass: 'special', power: 90, pp: 15, maxPp: 15, ailment: 'burn', ailmentChance: 10 }),
          makeMove({ name: 'Slash', power: 70, critRate: 1 }),
        ]),
      makePokemon('Pikachu', ['electric'],
        { hp: 35, attack: 55, defense: 40, specialAttack: 50, specialDefense: 50, speed: 90 }, [
          makeMove({ name: 'Thunderbolt', type: 'electric', damageClass: 'special', power: 90, ailment: 'paralysis', ailmentChance: 10 }),
          makeMove({ name: 'Quick Attack', priority: 1 }),
        ]),
    ] },
    { name: 'Blue', active: 0, pokemon: [
      makePokemon('Blastoise', ['water'],
        { hp: 79, attack: 83, defense: 100, specialAttack: 85, specialDefense: 105, speed: 78 }, [
          makeMove({ name: 'Surf', type: 'water', damageClass: 'special', power: 90 }),
          makeMove({ name: 'Bite', type: 'dark', power: 60, flinchChance: 30 }),
        ]),
      makePokemon('Venusaur', ['grass', 'poison'],
        { hp: 80, attack: 82, defense: 83, specialAttack: 100, specialDefense: 100, speed: 80 }, [
          makeMove({ name: 'Giga Drain', type: 'grass', damageClass: 'special', power: 75, drain: 50 }),
          makeMove({ name: 'Sludge Bomb', type: 'poison', damageClass: 'special', power: 90, ailment: 'poison', ailmentChance: 30 }),
        ]),
    ] },
  ];
}
