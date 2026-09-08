export interface RandomState { rng: number }

/** Mulberry32. The caller owns this state; turn resolution uses a cloned battle state. */
export function random(state: RandomState): number {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let value = state.rng;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

export function randInt(state: RandomState, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new RangeError('Random bounds must be ordered integers');
  }
  return min + Math.floor(random(state) * (max - min + 1));
}

export function chance(state: RandomState, probability: number): boolean {
  if (probability <= 0) return false;
  if (probability >= 1) return true;
  return random(state) < probability;
}

/** Accepts a query string without accessing browser globals. */
export function seedFromQuery(query: string, fallback = 1): number {
  const raw = new URLSearchParams(query).get('seed');
  if (raw === null || raw.trim() === '') return fallback >>> 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value >>> 0 : fallback >>> 0;
}
