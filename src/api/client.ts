import { MemoryCacheBackend, ResponseCache, type ResponseCacheOptions } from './cache';
import { ConcurrencyQueue } from './queue';

export const POKEAPI_BASE_URL = 'https://pokeapi.co/api/v2/';

/** Default parallel request ceiling. Deliberately conservative — see PokéAPI fair use. */
export const DEFAULT_CONCURRENCY = 6;

export interface ProgressSnapshot {
  /** Requests that reached the network and finished (successfully or not). */
  completed: number;
  /** Requests currently in flight. */
  active: number;
  /** Requests queued behind the concurrency limit. */
  pending: number;
  /** completed + active + pending, for the current hydration run. */
  total: number;
  /** 0–1. Equals 1 when nothing is outstanding. */
  ratio: number;
}

export type ProgressListener = (snapshot: ProgressSnapshot) => void;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface PokeApiClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  cache?: ResponseCache;
  cacheOptions?: ResponseCacheOptions;
  concurrency?: number;
  /** Total attempts per request, including the first. */
  maxAttempts?: number;
  /** Base delay for exponential backoff, in milliseconds. */
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Single entry point for every PokéAPI read.
 *
 * Guarantees, in order of application:
 *   1. A fresh cached response short-circuits the network entirely.
 *   2. Concurrent callers asking for the same URL share one in-flight promise.
 *   3. Network requests are capped at `concurrency` in parallel.
 *   4. Transient failures retry with exponential backoff and jitter.
 */
export class PokeApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly cache: ResponseCache;
  private readonly queue: ConcurrencyQueue;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<ProgressListener>();
  private completed = 0;
  private scheduled = 0;

  constructor(options: PokeApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? POKEAPI_BASE_URL;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.cache = options.cache ?? new ResponseCache(options.cacheOptions);
    this.queue = new ConcurrencyQueue(options.concurrency ?? DEFAULT_CONCURRENCY);
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 400;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get cacheBackendKind(): string {
    return this.cache.backendKind;
  }

  /**
   * Fetches `path` as JSON. `path` may be relative to the API base ("pokemon/pikachu",
   * "/pokemon/pikachu") or an absolute PokéAPI URL, which is what `NamedAPIResource.url`
   * contains. Both forms resolve to the same cache key.
   */
  async get<T>(path: string): Promise<T> {
    const url = this.resolve(path);

    const cached = await this.cache.get<T>(url);
    if (cached !== undefined) return cached;

    const existing = this.inFlight.get(url);
    if (existing !== undefined) return existing as Promise<T>;

    this.scheduled += 1;
    this.emit();

    const request = this.queue
      .run(() => this.fetchWithRetry<T>(url))
      .then(async (value) => {
        await this.cache.set(url, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(url);
        this.completed += 1;
        this.emit();
      });

    this.inFlight.set(url, request);
    return request;
  }

  /** Fetches many paths at once, respecting the concurrency limit. */
  async getAll<T>(paths: readonly string[]): Promise<T[]> {
    return Promise.all(paths.map((path) => this.get<T>(path)));
  }

  /** Subscribes to progress updates. Returns an unsubscribe function. */
  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Resets progress counters. Call before starting a new hydration run. */
  resetProgress(): void {
    this.completed = 0;
    this.scheduled = this.inFlight.size;
    this.emit();
  }

  snapshot(): ProgressSnapshot {
    const active = this.queue.activeCount;
    const pending = this.queue.pendingCount;
    const total = Math.max(this.scheduled, this.completed + active + pending);
    return {
      completed: this.completed,
      active,
      pending,
      total,
      ratio: total === 0 ? 1 : this.completed / total,
    };
  }

  clearCache(): Promise<void> {
    return this.cache.clear();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private resolve(path: string): string {
    const url = new URL(path.replace(/^\/(?!\/)/, ''), this.baseUrl);
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    url.hash = '';
    return url.toString();
  }

  private async fetchWithRetry<T>(url: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchFn(url, {
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          const error = new ApiError(
            `PokéAPI responded ${response.status} for ${url}`,
            url,
            response.status,
          );
          if (!RETRYABLE_STATUSES.has(response.status)) throw error;
          lastError = error;
        } else {
          return (await response.json()) as T;
        }
      } catch (error) {
        // A non-retryable ApiError must propagate immediately (e.g. 404 unknown move).
        if (error instanceof ApiError && !RETRYABLE_STATUSES.has(error.status ?? 0)) {
          throw error;
        }
        lastError = error;
      }

      if (attempt < this.maxAttempts) {
        const backoff = this.retryBaseMs * 2 ** (attempt - 1);
        const jitter = Math.random() * this.retryBaseMs;
        await this.sleep(backoff + jitter);
      }
    }

    if (lastError instanceof ApiError) throw lastError;
    throw new ApiError(
      `PokéAPI request failed after ${this.maxAttempts} attempts: ${String(lastError)}`,
      url,
    );
  }
}

/** Shared client instance used by the app. Tests construct their own. */
export const pokeApi = new PokeApiClient(typeof window !== 'undefined' && import.meta.env.DEV && window.location.pathname.endsWith('/preview.html')
  ? { cacheOptions: { backend: new MemoryCacheBackend() } } : {});
