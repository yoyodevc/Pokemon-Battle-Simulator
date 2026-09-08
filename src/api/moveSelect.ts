import type { Move, Pokemon } from './types';

/** Preferred version group for level-up learnsets. */
export const PREFERRED_VERSION_GROUP = 'scarlet-violet';
/** Used when the Pokémon predates the preferred version group. */
export const FALLBACK_VERSION_GROUP = 'red-blue';

export interface LearnableMove {
  name: string;
  url: string;
  /** Level at which the move is learned, or 0 for non level-up methods. */
  level: number;
  method: string;
}

/** Minimal surface the selector needs, so tests can inject a stub. */
export interface MoveSource {
  get<T>(path: string): Promise<T>;
}

export interface MovesetOptions {
  /** Version groups tried in order. */
  versionGroups?: readonly string[];
  /** How many top-level moves to fetch details for before choosing. */
  candidatePoolSize?: number;
  minDamagingMoves?: number;
  maxStatusMoves?: number;
  movesPerPokemon?: number;
  /** Pokémon typing used to prioritize STAB without making coverage one-dimensional. */
  preferredTypes?: readonly string[];
}

/** Level-up moves for one specific version group, highest level first. */
export function levelUpMoves(pokemon: Pokemon, versionGroup: string): LearnableMove[] {
  const found = new Map<string, LearnableMove>();

  for (const entry of pokemon.moves) {
    for (const detail of entry.version_group_details) {
      if (detail.move_learn_method.name !== 'level-up') continue;
      if (detail.version_group.name !== versionGroup) continue;

      const existing = found.get(entry.move.name);
      if (existing === undefined || detail.level_learned_at > existing.level) {
        found.set(entry.move.name, {
          name: entry.move.name,
          url: entry.move.url,
          level: detail.level_learned_at,
          method: 'level-up',
        });
      }
    }
  }

  return [...found.values()].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
}

/**
 * Picks the first version group that yields any level-up moves. Falls back to level-up
 * moves from *any* version group so that obscure forms still get a learnset.
 */
export function levelUpPool(
  pokemon: Pokemon,
  versionGroups: readonly string[] = [PREFERRED_VERSION_GROUP, FALLBACK_VERSION_GROUP],
): { versionGroup: string; moves: LearnableMove[] } {
  for (const versionGroup of versionGroups) {
    const moves = levelUpMoves(pokemon, versionGroup);
    if (moves.length > 0) return { versionGroup, moves };
  }

  const anyVersion = new Map<string, LearnableMove>();
  for (const entry of pokemon.moves) {
    for (const detail of entry.version_group_details) {
      if (detail.move_learn_method.name !== 'level-up') continue;
      const existing = anyVersion.get(entry.move.name);
      if (existing === undefined || detail.level_learned_at > existing.level) {
        anyVersion.set(entry.move.name, {
          name: entry.move.name,
          url: entry.move.url,
          level: detail.level_learned_at,
          method: 'level-up',
        });
      }
    }
  }

  return {
    versionGroup: 'any',
    moves: [...anyVersion.values()].sort(
      (a, b) => b.level - a.level || a.name.localeCompare(b.name),
    ),
  };
}

/**
 * Every move the Pokémon can learn by any method, deduplicated. Backs the team builder's
 * "search the full learnable pool" override.
 */
export function allLearnableMoves(pokemon: Pokemon): LearnableMove[] {
  const found = new Map<string, LearnableMove>();

  for (const entry of pokemon.moves) {
    const best = entry.version_group_details.reduce<LearnableMove | undefined>(
      (acc, detail) => {
        const candidate: LearnableMove = {
          name: entry.move.name,
          url: entry.move.url,
          level: detail.level_learned_at,
          method: detail.move_learn_method.name,
        };
        if (acc === undefined) return candidate;
        // Prefer level-up entries, then the highest level.
        if (acc.method !== 'level-up' && candidate.method === 'level-up') return candidate;
        if (acc.method === candidate.method && candidate.level > acc.level) return candidate;
        return acc;
      },
      undefined,
    );

    if (best !== undefined) found.set(best.name, best);
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function isDamaging(move: Move): boolean {
  return move.power !== null && move.damage_class.name !== 'status';
}

function moveQuality(move: Move, preferredTypes: readonly string[]): number {
  const stab = preferredTypes.includes(move.type.name) ? 1.5 : 1;
  const accuracy = move.accuracy === null ? 1 : Math.max(0, move.accuracy) / 100;
  const meta = move.meta;

  if (isDamaging(move)) {
    // A high-power move that misses often is not a great battle move. Small bonuses
    // reward reliable secondary effects without letting them outrank a real attack.
    return (move.power ?? 0) * accuracy * stab
      + (move.priority > 0 ? 8 : 0)
      + (meta?.crit_rate ?? 0) * 5
      + (meta?.flinch_chance ?? 0) * 0.08
      + (meta?.ailment_chance ?? 0) * 0.05
      + Math.max(0, meta?.drain ?? 0) * 0.08
      + (meta?.healing ?? 0) * 0.05;
  }

  // Keep one useful utility option when the learnset offers it. Plain stat drops
  // still remain valid fallbacks, but real ailment, setup, and healing moves win.
  let score = 18;
  if (meta?.ailment && !['none', 'unknown'].includes(meta.ailment.name)) {
    score += 18 + (meta.ailment_chance ?? 0) * 0.12;
  }
  if (move.stat_changes.length > 0) score += 16 + move.stat_changes.reduce((sum, change) => sum + Math.max(0, change.change), 0) * 4;
  if (meta?.healing) score += 20 + meta.healing * 0.1;
  if (meta?.category.name.includes('raise')) score += 8;
  return score;
}

/**
 * Chooses a practical four-move battle set from hydrated candidates:
 *   - prefer the strongest reliable STAB attack,
 *   - add distinct offensive types for coverage,
 *   - reserve one slot for the best utility move when available,
 *   - fill remaining slots with the strongest legal attacks.
 *
 * This intentionally scores the move data instead of trusting PokéAPI learn-level
 * order, which often puts late-but-low-power moves ahead of better early moves.
 */
export function chooseMoveset(candidates: readonly Move[], options: MovesetOptions = {}): Move[] {
  const slots = options.movesPerPokemon ?? 4;
  const minDamaging = options.minDamagingMoves ?? 2;
  const maxStatus = options.maxStatusMoves ?? 2;
  const preferredTypes = options.preferredTypes ?? [];

  const damaging = candidates.filter(isDamaging)
    .sort((left, right) => moveQuality(right, preferredTypes) - moveQuality(left, preferredTypes)
      || left.name.localeCompare(right.name));
  const status = candidates.filter((move) => !isDamaging(move))
    .sort((left, right) => moveQuality(right, preferredTypes) - moveQuality(left, preferredTypes)
      || left.name.localeCompare(right.name));

  const picked: Move[] = [];
  const pickedNames = new Set<string>();
  const coveredTypes = new Set<string>();

  const take = (move: Move): void => {
    if (pickedNames.has(move.name) || picked.length >= slots) return;
    picked.push(move);
    pickedNames.add(move.name);
    coveredTypes.add(move.type.name);
  };

  // 1. Three attacks is the default competitive shape, unless the candidate pool
  // cannot support it or the caller explicitly asks for a different minimum.
  const damagingTarget = Math.min(damaging.length, Math.max(minDamaging, Math.min(slots, 3)));
  while (picked.filter(isDamaging).length < damagingTarget) {
    const move = damaging.find((candidate) => !pickedNames.has(candidate.name) && !coveredTypes.has(candidate.type.name))
      ?? damaging.find((candidate) => !pickedNames.has(candidate.name));
    if (!move) break;
    take(move);
  }

  // 2. Use the most useful status move as the fourth slot when possible.
  let statusUsed = 0;
  for (const move of status) {
    if (picked.length >= slots || statusUsed >= maxStatus) break;
    if (pickedNames.has(move.name)) continue;
    take(move);
    statusUsed += 1;
    break;
  }

  // 3. Top up damaging moves if type diversity left us short of the minimum.
  for (const move of damaging) {
    if (picked.length >= minDamaging) break;
    take(move);
  }

  // 4. Fill any remaining slots with the strongest attacks, then additional
  // utility moves up to the configured cap.
  for (const move of damaging) {
    if (picked.length >= slots) break;
    take(move);
  }
  for (const move of status) {
    if (picked.length >= slots || statusUsed >= maxStatus) break;
    if (pickedNames.has(move.name)) continue;
    take(move);
    statusUsed += 1;
  }

  return picked;
}

/**
 * End-to-end auto moveset: read the level-up pool, fetch details for the top candidates,
 * then choose four. Detail fetches go through the shared client, so they are cached,
 * deduplicated and concurrency-limited.
 */
export async function selectMoveset(
  pokemon: Pokemon,
  source: MoveSource,
  options: MovesetOptions = {},
): Promise<Move[]> {
  const poolSize = options.candidatePoolSize ?? 24;
  const versionGroups = options.versionGroups ?? [PREFERRED_VERSION_GROUP, FALLBACK_VERSION_GROUP];

  const { moves } = levelUpPool(pokemon, versionGroups);
  const candidateRefs = moves.slice(0, poolSize);

  const details = await Promise.all(
    candidateRefs.map((ref) => source.get<Move>(ref.url)),
  );

  return chooseMoveset(details, {
    ...options,
    preferredTypes: options.preferredTypes ?? pokemon.types.map((entry) => entry.type.name),
  });
}

/** Resolves the `$effect_chance` placeholder PokéAPI leaves in `short_effect`. */
export function moveShortEffect(move: Move, language = 'en'): string {
  const entry =
    move.effect_entries.find((candidate) => candidate.language.name === language) ??
    move.effect_entries[0];
  if (entry === undefined) return '';
  return entry.short_effect.replaceAll('$effect_chance', String(move.effect_chance ?? 0));
}
