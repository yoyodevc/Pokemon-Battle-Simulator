import { resourceId } from './pokeapi';
import type { NamedAPIResourceList, TypeInfo } from './types';

/** Multiplier a single attacking type has against a single defending type. */
export type Effectiveness = 0 | 0.5 | 1 | 2;

/** `chart[attackingType][defendingType]` */
export type TypeChart = Record<string, Record<string, Effectiveness>>;

/**
 * Types that exist in the API but never appear in battle. `unknown` and `shadow` are
 * placeholders, and everything at id >= 10000 is a non-canonical entry (e.g. Stellar).
 */
export const EXCLUDED_TYPE_NAMES: ReadonlySet<string> = new Set(['unknown', 'shadow']);
export const NON_CANONICAL_TYPE_ID_FLOOR = 10_000;

/** Minimal surface the chart builder needs, so tests can inject a stub. */
export interface TypeChartSource {
  get<T>(path: string): Promise<T>;
}

export function isBattleType(name: string, id: number): boolean {
  return !EXCLUDED_TYPE_NAMES.has(name) && id < NON_CANONICAL_TYPE_ID_FLOOR;
}

/**
 * Builds the full attacker × defender multiplier table from `/type` responses.
 *
 * The chart is always derived from the API rather than hardcoded, so a future generation's
 * changes flow through automatically. Known values are asserted in the unit tests instead.
 */
export async function buildTypeChart(source: TypeChartSource): Promise<TypeChart> {
  const index = await source.get<NamedAPIResourceList>('type?limit=100');

  const battleTypes = index.results.filter((entry) =>
    isBattleType(entry.name, resourceId(entry.url)),
  );

  const infos = await Promise.all(
    battleTypes.map((entry) => source.get<TypeInfo>(entry.url)),
  );

  const names = infos.map((info) => info.name);
  const chart: TypeChart = {};

  for (const info of infos) {
    const row: Record<string, Effectiveness> = {};
    for (const defender of names) row[defender] = 1;

    for (const target of info.damage_relations.double_damage_to) {
      if (target.name in row) row[target.name] = 2;
    }
    for (const target of info.damage_relations.half_damage_to) {
      if (target.name in row) row[target.name] = 0.5;
    }
    for (const target of info.damage_relations.no_damage_to) {
      if (target.name in row) row[target.name] = 0;
    }

    chart[info.name] = row;
  }

  return chart;
}

/** Multiplier of one attacking type against one defending type. Unknown pairings are neutral. */
export function lookupEffectiveness(
  chart: TypeChart,
  attackingType: string,
  defendingType: string,
): Effectiveness {
  return chart[attackingType]?.[defendingType] ?? 1;
}

/**
 * Product of the multipliers against every one of the defender's types.
 * Yields 0, 0.25, 0.5, 1, 2 or 4.
 */
export function typeEffectiveness(
  chart: TypeChart,
  attackingType: string,
  defendingTypes: readonly string[],
): number {
  return defendingTypes.reduce(
    (multiplier, defendingType) =>
      multiplier * lookupEffectiveness(chart, attackingType, defendingType),
    1,
  );
}

/** Battle-log phrasing for an effectiveness multiplier. `null` means "say nothing". */
export function effectivenessMessage(multiplier: number, defenderName: string): string | null {
  if (multiplier === 0) return `It doesn't affect ${defenderName}…`;
  if (multiplier > 1) return "It's super effective!";
  if (multiplier < 1) return "It's not very effective…";
  return null;
}

let cachedChart: Promise<TypeChart> | null = null;

/**
 * Memoised chart load. The underlying `/type` responses are already persisted by the
 * client cache; this avoids rebuilding the table on every render.
 */
export function loadTypeChart(source: TypeChartSource): Promise<TypeChart> {
  cachedChart ??= buildTypeChart(source).catch((error: unknown) => {
    cachedChart = null;
    throw error;
  });
  return cachedChart;
}

export function resetTypeChartCache(): void {
  cachedChart = null;
}
