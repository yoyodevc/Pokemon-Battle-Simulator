/**
 * Offline preview fixtures. PokéAPI is not reachable from the design sandbox, so
 * this file fabricates the exact shapes `BattleProvider` expects. Never shipped:
 * only `preview.html` imports it.
 */
import { calculateStats, emptyStages } from '../src/engine/stats';
import { createBattle } from '../src/engine/turn';
import type { Move, Pokemon, Stats, Team, TypeChart } from '../src/engine/types';
import type { Pokemon as ApiPokemon } from '../src/api/types';

/**
 * Sprites resolved through Vite's asset pipeline so the sandbox needs no network.
 * `preview/` is never part of a production build — `vite build` only reads index.html.
 */
const SPRITE_FILES = import.meta.glob('./sprites/**/*.gif', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const spriteUrl = (path: string): string | null => SPRITE_FILES[`./sprites/${path}`] ?? null;

interface Spec {
  id: number;
  name: string;
  types: string[];
  base: Stats;
  moves: Array<Partial<Move> & { name: string; type: string }>;
}

const stats = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): Stats =>
  ({ hp, attack: atk, defense: def, specialAttack: spa, specialDefense: spd, speed: spe });

export const SPECS: Spec[] = [
  { id: 6, name: 'charizard', types: ['fire', 'flying'], base: stats(78, 84, 78, 109, 85, 100), moves: [
    { name: 'flamethrower', type: 'fire', damageClass: 'special', power: 90, pp: 15, maxPp: 15, ailment: 'burn', ailmentChance: 10, shortEffect: 'Inflicts regular damage. Has a 10% chance to burn the target.' },
    { name: 'air slash', type: 'flying', damageClass: 'special', power: 75, pp: 15, maxPp: 15, flinchChance: 30, shortEffect: 'Inflicts regular damage. Has a 30% chance to make the target flinch.' },
    { name: 'dragon pulse', type: 'dragon', damageClass: 'special', power: 85, pp: 10, maxPp: 10, shortEffect: 'Inflicts regular damage.' },
    { name: 'roost', type: 'flying', damageClass: 'status', power: null, pp: 10, maxPp: 10, target: 'self', healing: 50, shortEffect: 'Heals the user by half its max HP.' },
  ] },
  { id: 25, name: 'pikachu', types: ['electric'], base: stats(35, 55, 40, 50, 50, 90), moves: [
    { name: 'thunderbolt', type: 'electric', damageClass: 'special', power: 90, pp: 15, maxPp: 15, ailment: 'paralysis', ailmentChance: 10, shortEffect: 'Inflicts regular damage. Has a 10% chance to paralyze the target.' },
    { name: 'iron tail', type: 'steel', damageClass: 'physical', power: 100, accuracy: 75, pp: 15, maxPp: 15, shortEffect: 'Inflicts regular damage. Has a 30% chance to lower the target’s Defense.' },
    { name: 'quick attack', type: 'normal', damageClass: 'physical', power: 40, pp: 30, maxPp: 30, priority: 1, shortEffect: 'Inflicts regular damage. Always goes first.' },
    { name: 'nasty plot', type: 'dark', damageClass: 'status', power: null, pp: 20, maxPp: 20, target: 'self', shortEffect: 'Raises the user’s Special Attack by two stages.' },
  ] },
  { id: 3, name: 'venusaur', types: ['grass', 'poison'], base: stats(80, 82, 83, 100, 100, 80), moves: [
    { name: 'giga drain', type: 'grass', damageClass: 'special', power: 75, pp: 10, maxPp: 10, drain: 50, shortEffect: 'Drains half the damage inflicted to heal the user.' },
    { name: 'sludge bomb', type: 'poison', damageClass: 'special', power: 90, pp: 10, maxPp: 10, ailment: 'poison', ailmentChance: 30, shortEffect: 'Inflicts regular damage. Has a 30% chance to poison the target.' },
    { name: 'earthquake', type: 'ground', damageClass: 'physical', power: 100, pp: 10, maxPp: 10, shortEffect: 'Inflicts regular damage.' },
    { name: 'sleep powder', type: 'grass', damageClass: 'status', power: null, accuracy: 75, pp: 15, maxPp: 15, ailment: 'sleep', ailmentChance: 100, shortEffect: 'Puts the target to sleep.' },
  ] },
  { id: 9, name: 'blastoise', types: ['water'], base: stats(79, 83, 100, 85, 105, 78), moves: [
    { name: 'hydro pump', type: 'water', damageClass: 'special', power: 110, accuracy: 80, pp: 5, maxPp: 5, shortEffect: 'Inflicts regular damage.' },
    { name: 'ice beam', type: 'ice', damageClass: 'special', power: 90, pp: 10, maxPp: 10, ailment: 'freeze', ailmentChance: 10, shortEffect: 'Has a 10% chance to freeze the target.' },
    { name: 'flash cannon', type: 'steel', damageClass: 'special', power: 80, pp: 10, maxPp: 10, shortEffect: 'Inflicts regular damage.' },
    { name: 'rapid spin', type: 'normal', damageClass: 'physical', power: 50, pp: 40, maxPp: 40, shortEffect: 'Inflicts regular damage and raises the user’s Speed.' },
  ] },
  { id: 94, name: 'gengar', types: ['ghost', 'poison'], base: stats(60, 65, 60, 130, 75, 110), moves: [
    { name: 'shadow ball', type: 'ghost', damageClass: 'special', power: 80, pp: 15, maxPp: 15, shortEffect: 'Has a 20% chance to lower the target’s Special Defense.' },
    { name: 'sludge wave', type: 'poison', damageClass: 'special', power: 95, pp: 10, maxPp: 10, shortEffect: 'Inflicts regular damage.' },
    { name: 'thunderbolt', type: 'electric', damageClass: 'special', power: 90, pp: 15, maxPp: 15, shortEffect: 'Has a 10% chance to paralyze the target.' },
    { name: 'hypnosis', type: 'psychic', damageClass: 'status', power: null, accuracy: 60, pp: 20, maxPp: 20, ailment: 'sleep', ailmentChance: 100, shortEffect: 'Puts the target to sleep.' },
  ] },
  { id: 59, name: 'arcanine', types: ['fire'], base: stats(90, 110, 80, 100, 80, 95), moves: [
    { name: 'flare blitz', type: 'fire', damageClass: 'physical', power: 120, pp: 15, maxPp: 15, drain: -33, shortEffect: 'User takes 1/3 recoil damage.' },
    { name: 'extreme speed', type: 'normal', damageClass: 'physical', power: 80, pp: 5, maxPp: 5, priority: 2, shortEffect: 'Inflicts regular damage. Always goes first.' },
    { name: 'wild charge', type: 'electric', damageClass: 'physical', power: 90, pp: 15, maxPp: 15, shortEffect: 'User takes 1/4 recoil damage.' },
    { name: 'close combat', type: 'fighting', damageClass: 'physical', power: 120, pp: 5, maxPp: 5, shortEffect: 'Lowers the user’s Defense and Special Defense.' },
  ] },
  { id: 149, name: 'dragonite', types: ['dragon', 'flying'], base: stats(91, 134, 95, 100, 100, 80), moves: [
    { name: 'outrage', type: 'dragon', damageClass: 'physical', power: 120, pp: 10, maxPp: 10, shortEffect: 'Locks the user into a rampage.' },
    { name: 'hurricane', type: 'flying', damageClass: 'special', power: 110, accuracy: 70, pp: 10, maxPp: 10, shortEffect: 'Has a 30% chance to confuse the target.' },
    { name: 'fire punch', type: 'fire', damageClass: 'physical', power: 75, pp: 15, maxPp: 15, shortEffect: 'Has a 10% chance to burn the target.' },
    { name: 'dragon dance', type: 'dragon', damageClass: 'status', power: null, pp: 20, maxPp: 20, target: 'self', shortEffect: 'Raises the user’s Attack and Speed.' },
  ] },
  { id: 143, name: 'snorlax', types: ['normal'], base: stats(160, 110, 65, 65, 110, 30), moves: [
    { name: 'body slam', type: 'normal', damageClass: 'physical', power: 85, pp: 15, maxPp: 15, ailment: 'paralysis', ailmentChance: 30, shortEffect: 'Has a 30% chance to paralyze the target.' },
    { name: 'crunch', type: 'dark', damageClass: 'physical', power: 80, pp: 15, maxPp: 15, shortEffect: 'Has a 20% chance to lower the target’s Defense.' },
    { name: 'earthquake', type: 'ground', damageClass: 'physical', power: 100, pp: 10, maxPp: 10, shortEffect: 'Inflicts regular damage.' },
    { name: 'rest', type: 'psychic', damageClass: 'status', power: null, pp: 5, maxPp: 5, target: 'self', healing: 100, shortEffect: 'Sleeps for two turns and fully heals the user.' },
  ] },
  { id: 65, name: 'alakazam', types: ['psychic'], base: stats(55, 50, 45, 135, 95, 120), moves: [
    { name: 'psychic', type: 'psychic', damageClass: 'special', power: 90, pp: 10, maxPp: 10, shortEffect: 'Has a 10% chance to lower Special Defense.' },
    { name: 'focus blast', type: 'fighting', damageClass: 'special', power: 120, accuracy: 70, pp: 5, maxPp: 5, shortEffect: 'Has a 10% chance to lower Special Defense.' },
    { name: 'shadow ball', type: 'ghost', damageClass: 'special', power: 80, pp: 15, maxPp: 15, shortEffect: 'Has a 20% chance to lower Special Defense.' },
    { name: 'calm mind', type: 'psychic', damageClass: 'status', power: null, pp: 20, maxPp: 20, target: 'self', shortEffect: 'Raises Special Attack and Special Defense.' },
  ] },
  { id: 130, name: 'gyarados', types: ['water', 'flying'], base: stats(95, 125, 79, 60, 100, 81), moves: [
    { name: 'waterfall', type: 'water', damageClass: 'physical', power: 80, pp: 15, maxPp: 15, shortEffect: 'Has a 20% chance to make the target flinch.' },
    { name: 'crunch', type: 'dark', damageClass: 'physical', power: 80, pp: 15, maxPp: 15, shortEffect: 'Has a 20% chance to lower Defense.' },
    { name: 'ice fang', type: 'ice', damageClass: 'physical', power: 65, accuracy: 95, pp: 15, maxPp: 15, shortEffect: 'Has a chance to freeze or flinch.' },
    { name: 'dragon dance', type: 'dragon', damageClass: 'status', power: null, pp: 20, maxPp: 20, target: 'self', shortEffect: 'Raises Attack and Speed.' },
  ] },
  { id: 131, name: 'lapras', types: ['water', 'ice'], base: stats(130, 85, 80, 85, 95, 60), moves: [
    { name: 'surf', type: 'water', damageClass: 'special', power: 90, pp: 15, maxPp: 15, shortEffect: 'Inflicts regular damage.' },
    { name: 'freeze dry', type: 'ice', damageClass: 'special', power: 70, pp: 20, maxPp: 20, shortEffect: 'Super effective against Water.' },
    { name: 'thunder', type: 'electric', damageClass: 'special', power: 110, accuracy: 70, pp: 10, maxPp: 10, shortEffect: 'Has a 30% chance to paralyze.' },
    { name: 'sing', type: 'normal', damageClass: 'status', power: null, accuracy: 55, pp: 15, maxPp: 15, ailment: 'sleep', ailmentChance: 100, shortEffect: 'Puts the target to sleep.' },
  ] },
  { id: 68, name: 'machamp', types: ['fighting'], base: stats(90, 130, 80, 65, 85, 55), moves: [
    { name: 'dynamic punch', type: 'fighting', damageClass: 'physical', power: 100, accuracy: 50, pp: 5, maxPp: 5, shortEffect: 'Always confuses the target.' },
    { name: 'stone edge', type: 'rock', damageClass: 'physical', power: 100, accuracy: 80, pp: 5, maxPp: 5, critRate: 1, shortEffect: 'High critical hit ratio.' },
    { name: 'knock off', type: 'dark', damageClass: 'physical', power: 65, pp: 20, maxPp: 20, shortEffect: 'Removes the target’s held item.' },
    { name: 'bulk up', type: 'fighting', damageClass: 'status', power: null, pp: 20, maxPp: 20, target: 'self', shortEffect: 'Raises Attack and Defense.' },
  ] },
];

function toMove(partial: Partial<Move> & { name: string; type: string }): Move {
  return {
    damageClass: 'physical', power: 60, accuracy: 100, pp: 20, maxPp: 20,
    priority: 0, target: 'opponent', ...partial,
  };
}

function toPokemon(spec: Spec): Pokemon {
  const computed = calculateStats(spec.base);
  return {
    name: spec.name, types: spec.types, level: 50, stats: computed, hp: computed.hp,
    stages: emptyStages(), moves: spec.moves.map(toMove), status: null,
    sleepTurns: 0, toxicCounter: 1, confusionTurns: 0, flinched: false,
  };
}

export function previewSprites(): Record<string, ApiPokemon> {
  const entry: Record<string, ApiPokemon> = {};
  for (const spec of SPECS) {
    entry[spec.name] = {
      id: spec.id, name: spec.name, height: 17, weight: 905, stats: [], types: [], moves: [],
      cries: { latest: null, legacy: null },
      sprites: {
        front_default: spriteUrl(`${spec.id}.gif`),
        back_default: spriteUrl(`back/${spec.id}.gif`),
        front_shiny: null, back_shiny: null,
        other: {
          showdown: {
            front_default: spriteUrl(`${spec.id}.gif`),
            back_default: spriteUrl(`back/${spec.id}.gif`),
          },
        },
      },
    };
  }
  return entry;
}

/** A deliberately coarse chart: enough for effectiveness readouts in the preview. */
export const PREVIEW_CHART: TypeChart = (() => {
  const types = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison',
    'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];
  const chart: TypeChart = {};
  for (const type of types) chart[type] = {};
  const set = (from: string, to: string, value: 0 | 0.5 | 2) => { chart[from]![to] = value; };
  set('fire', 'grass', 2); set('fire', 'ice', 2); set('fire', 'bug', 2); set('fire', 'steel', 2);
  set('fire', 'water', 0.5); set('fire', 'fire', 0.5); set('fire', 'rock', 0.5); set('fire', 'dragon', 0.5);
  set('water', 'fire', 2); set('water', 'ground', 2); set('water', 'rock', 2);
  set('water', 'water', 0.5); set('water', 'grass', 0.5); set('water', 'dragon', 0.5);
  set('electric', 'water', 2); set('electric', 'flying', 2);
  set('electric', 'ground', 0); set('electric', 'grass', 0.5); set('electric', 'electric', 0.5); set('electric', 'dragon', 0.5);
  set('grass', 'water', 2); set('grass', 'ground', 2); set('grass', 'rock', 2);
  set('grass', 'fire', 0.5); set('grass', 'grass', 0.5); set('grass', 'poison', 0.5);
  set('grass', 'flying', 0.5); set('grass', 'bug', 0.5); set('grass', 'dragon', 0.5); set('grass', 'steel', 0.5);
  set('ice', 'grass', 2); set('ice', 'ground', 2); set('ice', 'flying', 2); set('ice', 'dragon', 2);
  set('ice', 'fire', 0.5); set('ice', 'water', 0.5); set('ice', 'ice', 0.5); set('ice', 'steel', 0.5);
  set('fighting', 'normal', 2); set('fighting', 'ice', 2); set('fighting', 'rock', 2); set('fighting', 'dark', 2); set('fighting', 'steel', 2);
  set('fighting', 'poison', 0.5); set('fighting', 'flying', 0.5); set('fighting', 'psychic', 0.5); set('fighting', 'bug', 0.5); set('fighting', 'fairy', 0.5); set('fighting', 'ghost', 0);
  set('poison', 'grass', 2); set('poison', 'fairy', 2);
  set('poison', 'poison', 0.5); set('poison', 'ground', 0.5); set('poison', 'rock', 0.5); set('poison', 'ghost', 0.5); set('poison', 'steel', 0);
  set('ground', 'fire', 2); set('ground', 'electric', 2); set('ground', 'poison', 2); set('ground', 'rock', 2); set('ground', 'steel', 2);
  set('ground', 'grass', 0.5); set('ground', 'bug', 0.5); set('ground', 'flying', 0);
  set('flying', 'grass', 2); set('flying', 'fighting', 2); set('flying', 'bug', 2);
  set('flying', 'electric', 0.5); set('flying', 'rock', 0.5); set('flying', 'steel', 0.5);
  set('psychic', 'fighting', 2); set('psychic', 'poison', 2);
  set('psychic', 'psychic', 0.5); set('psychic', 'steel', 0.5); set('psychic', 'dark', 0);
  set('bug', 'grass', 2); set('bug', 'psychic', 2); set('bug', 'dark', 2);
  set('bug', 'fire', 0.5); set('bug', 'fighting', 0.5); set('bug', 'poison', 0.5);
  set('bug', 'flying', 0.5); set('bug', 'ghost', 0.5); set('bug', 'steel', 0.5); set('bug', 'fairy', 0.5);
  set('rock', 'fire', 2); set('rock', 'ice', 2); set('rock', 'flying', 2); set('rock', 'bug', 2);
  set('rock', 'fighting', 0.5); set('rock', 'ground', 0.5); set('rock', 'steel', 0.5);
  set('ghost', 'psychic', 2); set('ghost', 'ghost', 2); set('ghost', 'dark', 0.5); set('ghost', 'normal', 0);
  set('dragon', 'dragon', 2); set('dragon', 'steel', 0.5); set('dragon', 'fairy', 0);
  set('dark', 'psychic', 2); set('dark', 'ghost', 2);
  set('dark', 'fighting', 0.5); set('dark', 'dark', 0.5); set('dark', 'fairy', 0.5);
  set('steel', 'ice', 2); set('steel', 'rock', 2); set('steel', 'fairy', 2);
  set('steel', 'fire', 0.5); set('steel', 'water', 0.5); set('steel', 'electric', 0.5); set('steel', 'steel', 0.5);
  set('fairy', 'fighting', 2); set('fairy', 'dragon', 2); set('fairy', 'dark', 2);
  set('fairy', 'fire', 0.5); set('fairy', 'poison', 0.5); set('fairy', 'steel', 0.5);
  set('normal', 'rock', 0.5); set('normal', 'steel', 0.5); set('normal', 'ghost', 0);
  return chart;
})();

export function previewBattle() {
  const pick = (names: string[]): Pokemon[] =>
    names.map((name) => toPokemon(SPECS.find((spec) => spec.name === name)!));
  const teams: [Team, Team] = [
    { name: 'You', active: 0, pokemon: pick(['charizard', 'pikachu', 'venusaur', 'blastoise', 'gengar', 'arcanine']) },
    { name: 'CPU Rival', active: 0, pokemon: pick(['dragonite', 'snorlax', 'alakazam', 'gyarados', 'lapras', 'machamp']) },
  ];
  return createBattle(teams, PREVIEW_CHART, 7);
}
