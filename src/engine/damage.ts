import { chance, randInt, type RandomState } from './rng.ts';
import { stageMultiplier } from './stats.ts';
import type { Move, Pokemon, TypeChart } from './types.ts';

export function effectiveness(chart: TypeChart, type: string, defenders: readonly string[]): number {
  return defenders.reduce((value, defender) => value * (chart[type]?.[defender] ?? 1), 1);
}

export function accuracyChance(attacker: Pokemon, defender: Pokemon, move: Move): number {
  if (move.accuracy === null) return 1;
  return Math.min(1, Math.max(0, move.accuracy / 100
    * stageMultiplier(attacker.stages.accuracy, true)
    / stageMultiplier(defender.stages.evasion, true)));
}

export function criticalChance(stage = 0): number {
  return stage <= 0 ? 1 / 24 : stage === 1 ? 1 / 8 : stage === 2 ? 1 / 2 : 1;
}

export interface DamageResult { damage: number; critical: boolean; effectiveness: number }

/** Explicit rolls also support deterministic expected-damage scoring in the CPU layer. */
export function calculateDamage(attacker: Pokemon, defender: Pokemon, move: Move,
  chart: TypeChart, critical = false, roll = 100): DamageResult {
  const typeMod = effectiveness(chart, move.type, defender.types);
  if (move.power === null || move.damageClass === 'status' || typeMod === 0) {
    return { damage: 0, critical, effectiveness: typeMod };
  }
  const attackStat = move.damageClass === 'physical' ? 'attack' : 'specialAttack';
  const defenseStat = move.damageClass === 'physical' ? 'defense' : 'specialDefense';
  const attackStage = critical ? Math.max(0, attacker.stages[attackStat]) : attacker.stages[attackStat];
  const defenseStage = critical ? Math.min(0, defender.stages[defenseStat]) : defender.stages[defenseStat];
  const attack = Math.max(1, Math.floor(attacker.stats[attackStat] * stageMultiplier(attackStage)));
  const defense = Math.max(1, Math.floor(defender.stats[defenseStat] * stageMultiplier(defenseStage)));
  const base = Math.floor(Math.floor(Math.floor(Math.floor(2 * attacker.level / 5 + 2)
    * move.power * attack / defense) / 50) + 2);
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const burn = attacker.status === 'burn' && move.damageClass === 'physical' ? 0.5 : 1;
  const damage = Math.max(1, Math.floor(base * (critical ? 1.5 : 1) * roll / 100 * stab * typeMod * burn));
  return { damage, critical, effectiveness: typeMod };
}

export function rollDamage(attacker: Pokemon, defender: Pokemon, move: Move,
  chart: TypeChart, rng: RandomState): DamageResult {
  return calculateDamage(attacker, defender, move, chart,
    chance(rng, criticalChance(move.critRate)), randInt(rng, 85, 100));
}

export function hitCount(move: Move, rng: RandomState): number {
  const min = move.minHits ?? 1;
  const max = move.maxHits ?? min;
  if (min === max) return min;
  if (min === 2 && max === 5) {
    const roll = randInt(rng, 1, 100);
    return roll <= 35 ? 2 : roll <= 70 ? 3 : roll <= 85 ? 4 : 5;
  }
  return randInt(rng, min, max);
}

export function confusionDamage(pokemon: Pokemon, rng: RandomState): number {
  const attack = Math.max(1, Math.floor(pokemon.stats.attack * stageMultiplier(pokemon.stages.attack)));
  const defense = Math.max(1, Math.floor(pokemon.stats.defense * stageMultiplier(pokemon.stages.defense)));
  const base = Math.floor(Math.floor(Math.floor(2 * pokemon.level / 5 + 2) * 40 * attack / defense) / 50) + 2;
  return Math.max(1, Math.floor(base * randInt(rng, 85, 100) / 100));
}
