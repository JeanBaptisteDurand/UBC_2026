/** readAccess.ts — the operator's reserved read. ONE EIP-4361 signature ("read my operator data") is valid for 10
 *  minutes and kept in memory for the page's session: never written to disk, forgotten on reload. It opens the
 *  machines' details (diagnostics, logs), their real names and the real labels of the operator keys. The API consumes
 *  its nonce on first use, then accepts it until it expires. */
import { useEffect, useState } from "react";
import type { ArcClient } from "@arcvault/sdk";
import type { Signed } from "./api";
import { signAction } from "./operatorActions";

/** margin before expiry: past it, the site asks again rather than send a signature about to expire */
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

/** the current read signature for this address, without asking the wallet anything (null if there is none) */
export const readSignature = (address?: string | null): Signed | null => current(address)?.signed ?? null;
/** its expiry (ms), or null */
export const readExpiresAt = (address?: string | null): number | null => current(address)?.expiresAt ?? null;

/** The read signature: the current one, otherwise a new one (the wallet asks to sign; no transaction). */
export function requestReadAccess(arc: ArcClient): Promise<Signed> {
  const have = readSignature(arc.account?.address);
  if (have) return Promise.resolve(have);
  pending ??= signAction(arc, { kind: "read" })
    .then(({ expiresAt, ...signed }) => {
      held = { signed, expiresAt };
      if (timer) clearTimeout(timer);
      timer = setTimeout(notify, Math.max(0, expiresAt - MARGIN_MS - Date.now()) + 50); // at the end, the pages go back to the public view
      notify();
      return signed;
    })
    .finally(() => { pending = null; });
  return pending;
}

/** Forgets the read (expired, or refused by the API: restarted in the meantime, for example). */
export function dropReadAccess() {
  held = null;
  if (timer) clearTimeout(timer);
  timer = null;
  notify();
}

/** The current read for this address; the page redraws when it arrives, is forgotten or expires. */
export function useReadAccess(address?: string | null): Signed | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    const f = () => redraw((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return readSignature(address);
}
