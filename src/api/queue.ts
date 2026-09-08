/**
 * FIFO task queue with a hard ceiling on concurrent execution.
 *
 * Hydrating a full team is roughly 30 requests (6 Pokémon + 24 moves). Firing those at
 * once is both rude to PokéAPI and slower in practice, so they are funnelled through here.
 */

type Task = () => void;

export class ConcurrencyQueue {
  private readonly limit: number;
  private running = 0;
  private readonly waiting: Task[] = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`Concurrency limit must be a positive integer, received ${limit}`);
    }
    this.limit = limit;
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.waiting.length;
  }

  /** Schedules `task`, resolving or rejecting with its result once it has run. */
  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.running += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.running -= 1;
            this.drain();
          });
      };

      if (this.running < this.limit) {
        start();
      } else {
        this.waiting.push(start);
      }
    });
  }

  private drain(): void {
    while (this.running < this.limit) {
      const next = this.waiting.shift();
      if (next === undefined) return;
      next();
    }
  }
}
