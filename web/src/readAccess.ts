/** readAccess.ts — la lecture réservée à l'opérateur : UNE signature EIP-4361 (« lire mes données d'opérateur »),
 *  valable 10 minutes, gardée en mémoire le temps de la session de la page (jamais écrite sur disque, oubliée au
 *  rechargement). Elle ouvre le détail des machines (diagnostic, journaux), leurs vrais noms et les vrais libellés des
 *  clés opérateur ; l'API consomme son nonce au premier usage et l'accepte ensuite jusqu'à son échéance. */
import { useEffect, useState } from "react";
import type { ArcClient } from "@arcvault/sdk";
import type { Signed } from "./api";
import { signAction } from "./operatorActions";

/** marge avant l'échéance : au-delà, on redemande plutôt que d'envoyer une signature sur le point d'expirer */
const MARGIN_MS = 30_000;

let held: { signed: Signed; expiresAt: number } | null = null;
let pending: Promise<Signed> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const f of listeners) f(); };

function current(address?: string | null) {
  if (!held || !address || held.signed.address.toLowerCase() !== address.toLowerCase()) return null;
  return Date.now() < held.expiresAt - MARGIN_MS ? held : null;
}

/** la signature de lecture en cours pour cette adresse, sans rien demander au wallet (null s'il n'y en a pas) */
export const readSignature = (address?: string | null): Signed | null => current(address)?.signed ?? null;
/** son échéance (ms), ou null */
export const readExpiresAt = (address?: string | null): number | null => current(address)?.expiresAt ?? null;

/** La signature de lecture : celle en cours, sinon une nouvelle (le wallet demande de signer ; aucune transaction). */
export function requestReadAccess(arc: ArcClient): Promise<Signed> {
  const have = readSignature(arc.account?.address);
  if (have) return Promise.resolve(have);
  pending ??= signAction(arc, { kind: "read" })
    .then(({ expiresAt, ...signed }) => {
      held = { signed, expiresAt };
      if (timer) clearTimeout(timer);
      timer = setTimeout(notify, Math.max(0, expiresAt - MARGIN_MS - Date.now()) + 50); // fin : les pages repassent en vue publique
      notify();
      return signed;
    })
    .finally(() => { pending = null; });
  return pending;
}

/** Oublie la lecture (échue, ou refusée par l'API : redémarrée entre-temps, par exemple). */
export function dropReadAccess() {
  held = null;
  if (timer) clearTimeout(timer);
  timer = null;
  notify();
}

/** La lecture en cours pour cette adresse ; la page se redessine quand elle arrive, est oubliée ou expire. */
export function useReadAccess(address?: string | null): Signed | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    const f = () => redraw((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return readSignature(address);
}
