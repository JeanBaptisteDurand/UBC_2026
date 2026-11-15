/** safeStorage.ts — le stockage du navigateur, sans jamais faire tomber la page.
 *  Quand le navigateur bloque les données du site (Chrome « ne pas autoriser les sites à enregistrer des données »,
 *  Safari avec tous les cookies bloqués), le simple accès à window.localStorage lève une SecurityError : wagmi
 *  (createConfig) et RainbowKit (effet au montage) y touchent sans try/catch, et la page restait blanche.
 *  - `safeStorage` : un Storage dont chaque accès est protégé (try/catch) ; ce qui est écrit reste aussi en mémoire,
 *    pour la durée de la page, si le navigateur refuse de le garder (bloqué, quota plein).
 *  - à l'import : si window.localStorage est illisible, il est remplacé par `safeStorage` (en mémoire seulement), pour
 *    les bibliothèques qui l'appellent directement. Ce module doit être importé AVANT wagmi et RainbowKit (main.tsx). */

/** le localStorage du navigateur, lu UNE fois ici (null s'il est bloqué) ; jamais relu après le remplacement */
const real: Storage | null = (() => {
  try {
    return typeof window !== "undefined" ? window.localStorage ?? null : null;
  } catch {
    return null;
  }
})();

/** ce que la page a écrit (null : effacé) ; prioritaire sur le navigateur, qui a pu refuser l'écriture */
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
      /* bloqué ou plein : la valeur vit en mémoire le temps de la page */
    }
  },
  removeItem(key: string): void {
    mem.set(key, null);
    try {
      real?.removeItem(key);
    } catch {
      /* rien à effacer côté navigateur */
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

/** les clés visibles : celles du navigateur (s'il répond) et celles écrites ici, moins les effacées */
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

/** le navigateur accepte-t-il d'écrire ? (quota plein, mode privé d'anciens Safari : la lecture marche, l'écriture lève) */
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

/** Remplace window.localStorage s'il est illisible ou refuse d'écrire (une seule fois, à l'import) ; `safeStorage` lit
 *  alors encore le navigateur quand il répond. Rend vrai si le remplacement a eu lieu. */
export function guardLocalStorage(): boolean {
  if (typeof window === "undefined" || (real && writable(real))) return false;
  try {
    Object.defineProperty(window, "localStorage", { configurable: true, enumerable: true, get: () => safeStorage });
    return true;
  } catch {
    return false; // propriété non configurable : wagmi passe quand même par safeStorage (wagmi.ts)
  }
}

guardLocalStorage();
