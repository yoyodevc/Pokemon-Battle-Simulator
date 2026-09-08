import { calculateStats, DEFAULT_LEVEL, emptyStages, type StatOptions } from '../engine/stats.ts';
import type { Ailment, Move, Pokemon, StageStat, Stat, Stats } from '../engine/types.ts';
import type { Move as ApiMove, Pokemon as ApiPokemon } from './types';
import { moveShortEffect } from './moveSelect';

const STAT_NAMES: Record<string, Stat | StageStat> = {
  hp: 'hp', attack: 'attack', defense: 'defense', 'special-attack': 'specialAttack',
  'special-defense': 'specialDefense', speed: 'speed', accuracy: 'accuracy', evasion: 'evasion',
};

const AILMENTS: Record<string, Ailment> = {
  burn: 'burn', poison: 'poison', paralysis: 'paralysis', sleep: 'sleep',
  freeze: 'freeze', confusion: 'confusion',
};

/** Converts hydrated API data without fetching or retaining references to cached responses. */
export function toBattleMove(move: ApiMove): Move {
  const damageClass = move.damage_class.name;
  if (damageClass !== 'physical' && damageClass !== 'special' && damageClass !== 'status') {
    throw new Error(`Unsupported damage class: ${damageClass}`);
  }
  const meta = move.meta;
  const target = move.target?.name === 'user' ? 'self' : 'opponent';
  const ailment = move.name === 'toxic' ? 'toxic' : AILMENTS[meta?.ailment.name ?? ''];
  return {
    name: move.name.replaceAll('-', ' '), type: move.type.name, damageClass,
    power: move.power, accuracy: move.accuracy, pp: move.pp ?? 0, maxPp: move.pp ?? 0,
    priority: move.priority, target, ailment,
    ailmentChance: meta?.ailment_chance || (damageClass === 'status' ? 100 : move.effect_chance ?? 0),
    statChance: meta?.stat_chance || (damageClass === 'status' ? 100 : move.effect_chance ?? 0),
    statTarget: meta?.category.name === 'damage+raise' ? 'self' : target,
    statChanges: move.stat_changes.flatMap((entry) => {
      const stat = STAT_NAMES[entry.stat.name];
      return stat && stat !== 'hp' ? [{ stat, change: entry.change }] : [];
    }),
    critRate: meta?.crit_rate ?? 0, minHits: meta?.min_hits ?? 1,
    maxHits: meta?.max_hits ?? meta?.min_hits ?? 1,
    drain: meta?.drain ?? 0, healing: meta?.healing ?? 0, flinchChance: meta?.flinch_chance ?? 0,
    shortEffect: moveShortEffect(move),
  };
}

export function toBattlePokemon(pokemon: ApiPokemon, moves: readonly ApiMove[], options: StatOptions = {}): Pokemon {
  const base: Partial<Stats> = {};
  for (const entry of pokemon.stats) {
    const stat = STAT_NAMES[entry.stat.name];
    if (stat && stat !== 'accuracy' && stat !== 'evasion') base[stat] = entry.base_stat;
  }
  if (base.hp === undefined || base.attack === undefined || base.defense === undefined
    || base.specialAttack === undefined || base.specialDefense === undefined || base.speed === undefined) {
    throw new Error(`Missing base stats for ${pokemon.name}`);
  }
  const stats = calculateStats(base as Stats, options);
  return {
    name: pokemon.name, types: [...pokemon.types].sort((a, b) => a.slot - b.slot).map((entry) => entry.type.name),
    level: options.level ?? DEFAULT_LEVEL, stats, hp: stats.hp, stages: emptyStages(),
    moves: moves.map(toBattleMove), status: null, sleepTurns: 0, toxicCounter: 1,
    confusionTurns: 0, flinched: false,
  };
}
