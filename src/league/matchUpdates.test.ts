import { describe, expect, it } from 'vitest';
import type { Match } from './client';
import { mergeMatch } from './matchUpdates';

const match = (version: number, submitted = false) => ({ id: 'duel', version, submitted } as Match);

describe('match response ordering', () => {
  it('keeps the resolved turn when an older poll arrives', () => {
    const current = match(8);
    expect(mergeMatch(current, match(7))).toBe(current);
  });
  it('keeps a submitted move while refreshing connection information', () => {
    const incoming = { ...match(7), connections: [true, false] };
    expect(mergeMatch(match(7, true), incoming)).toEqual({ ...incoming, submitted: true });
  });
  it('unlocks the next turn and accepts a terminal result', () => {
    const ended = { ...match(8), status: 'ended', reason: 'disconnect' };
    expect(mergeMatch(match(7, true), ended)).toBe(ended);
  });
  it('allows navigation to another match or the lobby', () => {
    const next = { ...match(1), id: 'rematch' };
    expect(mergeMatch(match(8), next)).toBe(next);
    expect(mergeMatch(match(8), null)).toBeNull();
  });
});
