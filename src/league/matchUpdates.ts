import type { Match } from './client';

export function mergeMatch(current: Match | null, incoming: Match | null): Match | null {
  if (!current || !incoming || current.id !== incoming.id) return incoming;
  if (incoming.version < current.version) return current;
  if (incoming.version === current.version && current.submitted && !incoming.submitted) {
    return { ...incoming, submitted: true };
  }
  return incoming;
}
