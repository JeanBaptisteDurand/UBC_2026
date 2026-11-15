/**
 * keyed-mutex.ts — verrou exclusif par clé (file d'attente FIFO), sans dépendance.
 *
 * Sert à rendre atomique, par session, la réservation de `seq` et du cumul (O2, v2) : deux requêtes
 * concurrentes sur la même session passent l'une après l'autre, dans l'ordre d'arrivée ; deux sessions
 * différentes restent en parallèle. La file d'une clé est effacée dès qu'elle se vide.
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  /** Exécute `fn` seul pour cette clé ; les appels suivants sur la même clé attendent leur tour. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Tout ce qui suit jusqu'au premier `await` est synchrone : l'ordre de la file = l'ordre des appels.
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => mine); // ne rejette jamais
    this.tails.set(key, tail);
    try {
      await previous;
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** Nombre de clés dont la file n'est pas vide (diagnostic, tests). */
  get pending(): number {
    return this.tails.size;
  }
}
