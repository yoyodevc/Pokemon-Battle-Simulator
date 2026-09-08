import { describe, expect, it } from 'vitest';
import { MemoryCacheBackend, ResponseCache } from './cache';
import { ApiError, PokeApiClient } from './client';

interface StubResponse {
  status: number;
  body?: unknown;
  /** Milliseconds the response is held open, used to observe concurrency. */
  delayMs?: number;
}

function makeFetch(handler: (url: string, callIndex: number) => StubResponse) {
  const calls: string[] = [];
  let inFlight = 0;
  let peakInFlight = 0;

  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    const callIndex = calls.length;
    calls.push(url);

    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);

    const stub = handler(url, callIndex);
    if (stub.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, stub.delayMs));
    }
    inFlight -= 1;

    return {
      ok: stub.status >= 200 && stub.status < 300,
      status: stub.status,
      json: async () => stub.body,
    } as Response;
  }) as unknown as typeof fetch;

  return {
    fetchFn,
    calls,
    get peakInFlight() {
      return peakInFlight;
    },
  };
}

function makeClient(fetchFn: typeof fetch, overrides: Partial<{ concurrency: number }> = {}) {
  return new PokeApiClient({
    fetchFn,
    cache: new ResponseCache({ backend: new MemoryCacheBackend() }),
    concurrency: overrides.concurrency ?? 6,
    retryBaseMs: 1,
    sleep: async () => undefined,
  });
}

describe('PokeApiClient URL resolution', () => {
  it('treats relative paths and absolute resource URLs as the same cache key', async () => {
    const stub = makeFetch(() => ({ status: 200, body: { name: 'pikachu' } }));
    const client = makeClient(stub.fetchFn);

    await client.get('pokemon/pikachu');
    await client.get('/pokemon/pikachu');
    await client.get('https://pokeapi.co/api/v2/pokemon/pikachu');
    await client.get('https://pokeapi.co/api/v2/pokemon/pikachu/');
    await client.get('pokemon/pikachu/');

    expect(stub.calls).toEqual(['https://pokeapi.co/api/v2/pokemon/pikachu']);
  });
});

describe('PokeApiClient caching', () => {
  it('serves repeat reads from cache without touching the network', async () => {
    const stub = makeFetch(() => ({ status: 200, body: { id: 25 } }));
    const client = makeClient(stub.fetchFn);

    const first = await client.get<{ id: number }>('pokemon/25');
    const second = await client.get<{ id: number }>('pokemon/25');

    expect(first).toEqual({ id: 25 });
    expect(second).toEqual({ id: 25 });
    expect(stub.calls).toHaveLength(1);
  });

  it('expires entries once the TTL elapses', async () => {
    const stub = makeFetch(() => ({ status: 200, body: { id: 25 } }));
    let now = 0;
    const client = new PokeApiClient({
      fetchFn: stub.fetchFn,
      cache: new ResponseCache({
        backend: new MemoryCacheBackend(),
        ttlMs: 1000,
        now: () => now,
      }),
      retryBaseMs: 1,
      sleep: async () => undefined,
    });

    await client.get('pokemon/25');
    now = 999;
    await client.get('pokemon/25');
    expect(stub.calls).toHaveLength(1);

    now = 1001;
    await client.get('pokemon/25');
    expect(stub.calls).toHaveLength(2);
  });
});

describe('PokeApiClient deduplication', () => {
  it('collapses concurrent reads of the same URL into one request', async () => {
    const stub = makeFetch(() => ({ status: 200, body: { id: 6 }, delayMs: 10 }));
    const client = makeClient(stub.fetchFn);

    const results = await Promise.all([
      client.get('pokemon/6'),
      client.get('pokemon/6'),
      client.get('pokemon/6'),
    ]);

    expect(stub.calls).toHaveLength(1);
    expect(results[0]).toBe(results[1]);
  });
});

describe('PokeApiClient concurrency', () => {
  it('never exceeds the configured parallel request limit', async () => {
    const stub = makeFetch(() => ({ status: 200, body: {}, delayMs: 5 }));
    const client = makeClient(stub.fetchFn, { concurrency: 3 });

    const paths = Array.from({ length: 12 }, (_, i) => `move/${i + 1}`);
    await client.getAll(paths);

    expect(stub.calls).toHaveLength(12);
    expect(stub.peakInFlight).toBeLessThanOrEqual(3);
  });
});

describe('PokeApiClient error handling', () => {
  it('retries transient failures and then succeeds', async () => {
    const stub = makeFetch((_url, callIndex) =>
      callIndex < 2 ? { status: 503 } : { status: 200, body: { ok: true } },
    );
    const client = makeClient(stub.fetchFn);

    await expect(client.get('type/1')).resolves.toEqual({ ok: true });
    expect(stub.calls).toHaveLength(3);
  });

  it('fails fast on a 404 without retrying', async () => {
    const stub = makeFetch(() => ({ status: 404 }));
    const client = makeClient(stub.fetchFn);

    await expect(client.get('move/does-not-exist')).rejects.toBeInstanceOf(ApiError);
    expect(stub.calls).toHaveLength(1);
  });

  it('gives up after the attempt budget is spent', async () => {
    const stub = makeFetch(() => ({ status: 500 }));
    const client = makeClient(stub.fetchFn);

    await expect(client.get('type/1')).rejects.toBeInstanceOf(ApiError);
    expect(stub.calls).toHaveLength(3);
  });
});

describe('PokeApiClient progress', () => {
  it('reports completion once every scheduled request settles', async () => {
    const stub = makeFetch(() => ({ status: 200, body: {}, delayMs: 2 }));
    const client = makeClient(stub.fetchFn, { concurrency: 2 });

    const seen: number[] = [];
    const unsubscribe = client.onProgress((snapshot) => seen.push(snapshot.ratio));

    await client.getAll(['pokemon/1', 'pokemon/2', 'pokemon/3', 'pokemon/4']);
    unsubscribe();

    expect(seen[0]).toBe(1); // nothing outstanding at subscribe time
    expect(seen.at(-1)).toBe(1);
    expect(Math.min(...seen)).toBeLessThan(1);
    expect(client.snapshot().completed).toBe(4);
  });
});
