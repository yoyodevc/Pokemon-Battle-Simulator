import type { Pokemon, StageStat, Stages, Stats } from './types.ts';

export const DEFAULT_LEVEL = 50;

export interface StatOptions {
  level?: number;
  iv?: number;
  ev?: number;
  nature?: number;
}

/** Mainline stat formula. HP uses the +level+10 variant; other stats apply the nature multiplier. */
export function calculateStat(base: number, isHp: boolean, options: StatOptions = {}): number {
  const { level = DEFAULT_LEVEL, iv = 31, ev = 0, nature = 1 } = options;
  const core = Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100);
  if (isHp) return core + level + 10;
  return Math.floor((core + 5) * nature);
}

export function calculateStats(base: Stats, options: StatOptions = {}): Stats {
  return {
    hp: calculateStat(base.hp, true, options),
    attack: calculateStat(base.attack, false, options),
    defense: calculateStat(base.defense, false, options),
    specialAttack: calculateStat(base.specialAttack, false, options),
    specialDefense: calculateStat(base.specialDefense, false, options),
    speed: calculateStat(base.speed, false, options),
  };
}

export function emptyStages(): Stages {
  return { attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, accuracy: 0, evasion: 0 };
}

export const clampStage = (stage: number): number => Math.max(-6, Math.min(6, stage));

/** Battle stages use a 2/(2+n) ratio; accuracy and evasion use the 3/(3+n) table. */
export function stageMultiplier(stage: number, isAccuracy = false): number {
  const numerator = isAccuracy ? 3 : 2;
  const clamped = clampStage(stage);
  return clamped >= 0 ? (numerator + clamped) / numerator : numerator / (numerator - clamped);
}

/** Applies a stage change and returns the actual delta after clamping. */
export function changeStage(pokemon: Pokemon, stat: StageStat, change: number): number {
  const before = pokemon.stages[stat];
  pokemon.stages[stat] = clampStage(before + change);
  return pokemon.stages[stat] - before;
}

export function effectiveSpeed(pokemon: Pokemon): number {
  const staged = Math.floor(pokemon.stats.speed * stageMultiplier(pokemon.stages.speed));
  return Math.floor(staged * (pokemon.status === 'paralysis' ? 0.5 : 1));
}
