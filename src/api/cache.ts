/**
 * Response cache for PokéAPI.
 *
 * PokéAPI's fair-use policy *requires* consumers to cache responses locally; ignoring it
 * risks a permanent IP ban. Every network read in this app therefore goes through here.
 *
 * Backend selection, in order of preference:
 *   1. IndexedDB    — no practical size ceiling, survives reloads. Pokémon payloads are
 *                     large (the `moves` array alone can exceed 200 KB), so this matters.
 *   2. localStorage — ~5 MB ceiling; evicts least-recently-used entries on quota errors.
 *   3. Memory       — used in Node (tests, the CLI battle runner) where neither exists.
 */

export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CacheEntry<T = unknown> {
  value: T;
  /** Epoch milliseconds after which the entry is stale. */
  expiresAt: number;
  /** Epoch milliseconds of the last read or write, used for LRU eviction. */
  touchedAt: number;
}

export interface CacheBackend {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Memory backend                                                             */
/* -------------------------------------------------------------------------- */

export class MemoryCacheBackend implements CacheBackend {
  readonly kind = 'memory' as const;
  private readonly store = new Map<string, CacheEntry>();

  async get(key: string): Promise<CacheEntry | undefined> {
    return this.store.get(key);
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

/* -------------------------------------------------------------------------- */
/* localStorage backend                                                       */
/* -------------------------------------------------------------------------- */

const LS_PREFIX = 'pokeapi:';

export class LocalStorageCacheBackend implements CacheBackend {
  readonly kind = 'localstorage' as const;

  constructor(private readonly storage: Storage) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    const raw = this.storage.getItem(LS_PREFIX + key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as CacheEntry;
    } catch {
      // Corrupt entry: drop it rather than failing the read.
      this.storage.removeItem(LS_PREFIX + key);
      return undefined;
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const payload = JSON.stringify(entry);
    try {
      this.storage.setItem(LS_PREFIX + key, payload);
    } catch {
      // Quota exceeded. Reclaim space, then try once more. If it still fails we
      // silently skip caching — a cache miss is recoverable, a crash is not.
      this.reclaim();
      try {
        this.storage.setItem(LS_PREFIX + key, payload);
      } catch {
        /* give up on caching this entry */
      }
    }
  }

  async delete(key: string): Promise<void> {
    this.storage.removeItem(LS_PREFIX + key);
  }

  async clear(): Promise<void> {
    for (const key of this.ownKeys()) this.storage.removeItem(key);
  }

  private ownKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i += 1) {
      const key = this.storage.key(i);
      if (key !== null && key.startsWith(LS_PREFIX)) keys.push(key);
    }
    return keys;
  }

  /** Drop expired entries first, then the least recently used half of what remains. */
  private reclaim(): void {
    const now = Date.now();
    const survivors: Array<{ key: string; touchedAt: number }> = [];

    for (const key of this.ownKeys()) {
      const raw = this.storage.getItem(key);
      if (raw === null) continue;
      try {
        const entry = JSON.parse(raw) as CacheEntry;
        if (entry.expiresAt <= now) {
          this.storage.removeItem(key);
        } else {
          survivors.push({ key, touchedAt: entry.touchedAt });
        }
      } catch {
        this.storage.removeItem(key);
      }
    }

    survivors.sort((a, b) => a.touchedAt - b.touchedAt);
    const evictCount = Math.ceil(survivors.length / 2);
    for (let i = 0; i < evictCount; i += 1) {
      const victim = survivors[i];
      if (victim) this.storage.removeItem(victim.key);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* IndexedDB backend                                                          */
/* -------------------------------------------------------------------------- */

const DB_NAME = 'pokeapi-cache';
const DB_VERSION = 1;
const STORE_NAME = 'responses';

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDbCacheBackend implements CacheBackend {
  readonly kind = 'indexeddb' as const;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory) {}

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise === null) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Cannot open cache database'));
        request.onblocked = () => reject(new Error('Cache database upgrade blocked'));
      });
    }
    return this.dbPromise;
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.openDb();
    const tx = db.transaction(STORE_NAME, mode);
    const result = await promisifyRequest(run(tx.objectStore(STORE_NAME)));
    return result;
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    return this.withStore('readonly', (store) => store.get(key) as IDBRequest<CacheEntry | undefined>);
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    await this.withStore('readwrite', (store) => store.put(entry, key));
  }

  async delete(key: string): Promise<void> {
    await this.withStore('readwrite', (store) => store.delete(key));
  }

  async clear(): Promise<void> {
    await this.withStore('readwrite', (store) => store.clear());
  }
}

/* -------------------------------------------------------------------------- */
/* Facade                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Picks the best backend available in the current environment. IndexedDB is probed
 * lazily on first use so that a browser with IndexedDB disabled (private mode in some
 * builds) falls back rather than throwing at import time.
 */
export function createCacheBackend(preferIndexedDb = true): CacheBackend {
  const idb: IDBFactory | undefined = globalThis.indexedDB;
  if (preferIndexedDb && idb !== undefined) return new IndexedDbCacheBackend(idb);

  try {
    const ls = globalThis.localStorage;
    if (ls !== undefined) {
      const probe = '__pokeapi_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return new LocalStorageCacheBackend(ls);
    }
  } catch {
    /* localStorage present but unusable */
  }

  return new MemoryCacheBackend();
}

export interface ResponseCacheOptions {
  backend?: CacheBackend;
  ttlMs?: number;
  now?: () => number;
}

/** TTL-aware key/value cache used by the PokéAPI client. */
export class ResponseCache {
  private backend: CacheBackend;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: ResponseCacheOptions = {}) {
    this.backend = options.backend ?? createCacheBackend();
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get backendKind(): CacheBackend['kind'] {
    return this.backend.kind;
  }

  /** Returns the cached value, or `undefined` if absent, expired, or unreadable. */
  async get<T>(key: string): Promise<T | undefined> {
    let entry: CacheEntry | undefined;
    try {
      entry = await this.backend.get(key);
    } catch {
      if (this.fallback()) return this.get<T>(key);
      return undefined;
    }
    if (entry === undefined) return undefined;

    if (entry.expiresAt <= this.now()) {
      void this.backend.delete(key).catch(() => undefined);
      return undefined;
    }

    // Refresh the LRU timestamp opportunistically; failure here is harmless.
    void this.backend
      .set(key, { ...entry, touchedAt: this.now() })
      .catch(() => undefined);

    return entry.value as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const timestamp = this.now();
    try {
      await this.backend.set(key, {
        value,
        expiresAt: timestamp + this.ttlMs,
        touchedAt: timestamp,
      });
    } catch {
      if (this.fallback()) await this.set(key, value);
    }
  }

  private fallback(): boolean {
    if (this.backend.kind === 'memory') return false;
    this.backend = this.backend.kind === 'indexeddb'
      ? createCacheBackend(false) : new MemoryCacheBackend();
    return true;
  }

  async clear(): Promise<void> {
    try {
      await this.backend.clear();
    } catch {
      /* ignore */
    }
  }
}
