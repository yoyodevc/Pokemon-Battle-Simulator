/**
 * Type definitions mirroring the subset of PokéAPI (v2) responses this app consumes.
 * These describe the *raw wire format*. Domain models used by the battle engine are
 * defined separately in `src/engine/types.ts` so the engine never depends on the API shape.
 */

export interface NamedAPIResource {
  name: string;
  url: string;
}

export interface NamedAPIResourceList {
  count: number;
  next: string | null;
  previous: string | null;
  results: NamedAPIResource[];
}

/** Canonical stat identifiers as returned by PokéAPI. */
export type StatName =
  | 'hp'
  | 'attack'
  | 'defense'
  | 'special-attack'
  | 'special-defense'
  | 'speed';

export type DamageClass = 'physical' | 'special' | 'status';

/* -------------------------------------------------------------------------- */
/* /pokemon/{id|name}                                                          */
/* -------------------------------------------------------------------------- */

export interface PokemonStatEntry {
  base_stat: number;
  effort: number;
  stat: NamedAPIResource;
}

export interface PokemonTypeEntry {
  /** 1 for the primary type, 2 for the secondary type. */
  slot: number;
  type: NamedAPIResource;
}

export interface VersionGroupDetail {
  level_learned_at: number;
  move_learn_method: NamedAPIResource;
  version_group: NamedAPIResource;
}

export interface PokemonMoveEntry {
  move: NamedAPIResource;
  version_group_details: VersionGroupDetail[];
}

export interface PokemonSprites {
  front_default: string | null;
  back_default: string | null;
  front_shiny: string | null;
  back_shiny: string | null;
  other?: {
    'official-artwork'?: {
      front_default: string | null;
      front_shiny?: string | null;
    };
    /** Animated GIF sprites. Not present for every species. */
    showdown?: {
      front_default: string | null;
      back_default: string | null;
    };
    home?: { front_default: string | null };
  };
}

export interface PokemonCries {
  latest: string | null;
  legacy: string | null;
}

export interface Pokemon {
  id: number;
  name: string;
  /** Decimetres. */
  height: number;
  /** Hectograms. */
  weight: number;
  stats: PokemonStatEntry[];
  types: PokemonTypeEntry[];
  moves: PokemonMoveEntry[];
  sprites: PokemonSprites;
  cries: PokemonCries;
}

/* -------------------------------------------------------------------------- */
/* /move/{id|name}                                                             */
/* -------------------------------------------------------------------------- */

export interface MoveMeta {
  ailment: NamedAPIResource;
  /** Percentage chance (0–100) of inflicting `ailment`. 0 means "never" or "always" per move. */
  ailment_chance: number;
  category: NamedAPIResource;
  /** 0 = normal crit odds, 1 = high crit ratio, etc. */
  crit_rate: number;
  /** Positive = HP drained as a percentage of damage dealt. Negative = recoil. */
  drain: number;
  flinch_chance: number;
  /** Percentage of the user's max HP restored. */
  healing: number;
  max_hits: number | null;
  max_turns: number | null;
  min_hits: number | null;
  min_turns: number | null;
  /** Percentage chance (0–100) of applying `stat_changes`. */
  stat_chance: number;
}

export interface MoveStatChange {
  /** Number of stages, may be negative. */
  change: number;
  stat: NamedAPIResource;
}

export interface MoveEffectEntry {
  effect: string;
  /** May contain the literal placeholder `$effect_chance`. */
  short_effect: string;
  language: NamedAPIResource;
}

export interface Move {
  target?: NamedAPIResource;
  id: number;
  name: string;
  /** `null` means the move never misses. */
  accuracy: number | null;
  /** `null` for status moves. */
  power: number | null;
  pp: number | null;
  priority: number;
  damage_class: NamedAPIResource;
  type: NamedAPIResource;
  effect_chance: number | null;
  meta: MoveMeta | null;
  stat_changes: MoveStatChange[];
  effect_entries: MoveEffectEntry[];
}

/* -------------------------------------------------------------------------- */
/* /type/{id|name}                                                             */
/* -------------------------------------------------------------------------- */

export interface TypeDamageRelations {
  double_damage_from: NamedAPIResource[];
  double_damage_to: NamedAPIResource[];
  half_damage_from: NamedAPIResource[];
  half_damage_to: NamedAPIResource[];
  no_damage_from: NamedAPIResource[];
  no_damage_to: NamedAPIResource[];
}

export interface TypeInfo {
  id: number;
  name: string;
  damage_relations: TypeDamageRelations;
}
