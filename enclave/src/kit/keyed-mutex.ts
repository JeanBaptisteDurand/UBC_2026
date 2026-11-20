/**
 * keyed-mutex.ts — an exclusive lock per key (FIFO queue), with no dependency.
 *
 * It makes the reservation of `seq` and of the running total atomic per session (O2, v2): two concurrent requests on
 * the same session go one after the other, in order of arrival; two different sessions stay in parallel. The queue of
 * a key is erased as soon as it empties.
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  /** Runs `fn` alone for this key; the following calls on the same key wait their turn. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Everything up to the first `await` is synchronous: the order of the queue = the order of the calls.
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => mine); // never rejects
    this.tails.set(key, tail);
    try {
      await previous;
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** Number of keys whose queue is not empty (diagnostics, tests). */
  get pending(): number {
    return this.tails.size;
  }
}
