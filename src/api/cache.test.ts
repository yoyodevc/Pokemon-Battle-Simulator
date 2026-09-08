import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageCacheBackend, ResponseCache, type CacheBackend } from './cache';

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function brokenDatabase(): CacheBackend {
  return { kind: 'indexeddb',
    get: async () => { throw new Error('Database unavailable'); },
    set: async () => { throw new Error('Database unavailable'); },
    delete: async () => undefined, clear: async () => undefined,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('persistent cache fallback', () => {
  it('persists writes to localStorage when IndexedDB fails', async () => {
    const local = storage();
    vi.stubGlobal('localStorage', local);
    const cache = new ResponseCache({ backend: brokenDatabase() });
    await cache.set('pokemon/25', { id: 25 });
    expect(cache.backendKind).toBe('localstorage');
    const reloaded = new ResponseCache({ backend: new LocalStorageCacheBackend(local) });
    expect(await reloaded.get('pokemon/25')).toEqual({ id: 25 });
  });
  it('reads previously saved localStorage responses after database failure', async () => {
    const local = storage();
    vi.stubGlobal('localStorage', local);
    await new ResponseCache({ backend: new LocalStorageCacheBackend(local) }).set('cached', 42);
    expect(await new ResponseCache({ backend: brokenDatabase() }).get('cached')).toBe(42);
  });
  it('continues with memory when both persistent stores are unavailable', async () => {
    vi.stubGlobal('localStorage', undefined);
    const cache = new ResponseCache({ backend: brokenDatabase() });
    await cache.set('cached', 42);
    expect(cache.backendKind).toBe('memory');
    expect(await cache.get('cached')).toBe(42);
  });
});
