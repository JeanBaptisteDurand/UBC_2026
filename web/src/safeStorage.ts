/** safeStorage.ts — the browser's storage, without ever bringing the page down.
 *  When the browser blocks site data (Chrome's "don't allow sites to save data", Safari with all cookies blocked), merely
 *  reading window.localStorage throws a SecurityError: wagmi (createConfig) and RainbowKit (an effect on mount) touch it
 *  without try/catch, which would leave the page blank.
 *  - `safeStorage`: a Storage whose every access is guarded (try/catch); what is written also stays in memory for the
 *    life of the page if the browser refuses to keep it (blocked, quota full).
 *  - on import: if window.localStorage is unreadable, it is replaced by `safeStorage` (memory only), for the libraries
 *    that call it directly. This module must be imported BEFORE wagmi and RainbowKit (main.tsx). */

/** the browser's localStorage, read ONCE here (null if blocked); never read again after the replacement */
const real: Storage | null = (() => {
  try {
    return typeof window !== "undefined" ? window.localStorage ?? null : null;
  } catch {
    return null;
  }
})();

/** what the page wrote (null: removed); takes priority over the browser, which may have refused the write */
const mem = new Map<string, string | null>();

export const safeStorage: Storage = {
  getItem(key: string): string | null {
    if (mem.has(key)) return mem.get(key) ?? null;
    try {
      return real?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    mem.set(key, String(value));
    try {
      real?.setItem(key, String(value));
    } catch {
      /* blocked or full: the value lives in memory for the life of the page */
    }
  },
  removeItem(key: string): void {
    mem.set(key, null);
    try {
      real?.removeItem(key);
    } catch {
      /* nothing to remove on the browser side */
    }
  },
  clear(): void {
    for (const k of keys()) mem.set(k, null);
    try {
      real?.clear();
    } catch {
      /* idem */
    }
  },
  key(index: number): string | null {
    return keys()[index] ?? null;
  },
  get length(): number {
    return keys().length;
  },
};

/** the visible keys: the browser's (if it answers) and those written here, minus the removed ones */
function keys(): string[] {
  const out = new Set<string>();
  try {
    if (real) for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k !== null) out.add(k); }
  } catch {
    /* navigateur muet */
  }
  for (const [k, v] of mem) { if (v === null) out.delete(k); else out.add(k); }
  return [...out];
}

/** does the browser accept writes? (quota full, private mode of older Safari: reads work, writes throw) */
function writable(s: Storage): boolean {
  try {
    const k = "archive.storage-probe";
    s.setItem(k, "1");
    s.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** Replaces window.localStorage if it is unreadable or refuses writes (once, on import); `safeStorage` then still reads
 *  the browser when it answers. Returns true if the replacement happened. */
export function guardLocalStorage(): boolean {
  if (typeof window === "undefined" || (real && writable(real))) return false;
  try {
    Object.defineProperty(window, "localStorage", { configurable: true, enumerable: true, get: () => safeStorage });
    return true;
  } catch {
    return false; // non-configurable property: wagmi still goes through safeStorage (wagmi.ts)
  }
}

guardLocalStorage();
