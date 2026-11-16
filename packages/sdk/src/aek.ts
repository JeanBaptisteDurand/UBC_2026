/** aek.ts — clé d'accès à distance : `aek_<réseau>_<sessionId>_<secret>`.
 *  Le secret EST la clé privée de session (elle peut dépenser jusqu'au dépôt, pas plus).
 *  Préfixe lisible pour les détecteurs de fuite. Naît dans le navigateur, jamais côté serveur. */
import { type Hex, toBytes, toHex } from "viem";

function b64url(u8: Uint8Array): string {
  const bin = String.fromCharCode(...u8);
  const s = typeof btoa !== "undefined" ? btoa(bin) : (globalThis as any).Buffer.from(u8).toString("base64");
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin: string = typeof atob !== "undefined" ? atob(b) : (globalThis as any).Buffer.from(b, "base64").toString("binary");
  return Uint8Array.from([...bin].map((c) => c.charCodeAt(0)));
}

export function encodeAek(net: string, sessionId: bigint, sessionPrivateKey: Hex): string {
  return `aek_${net}_${sessionId}_${b64url(toBytes(sessionPrivateKey))}`;
}

export interface DecodedAek { net: string; sessionId: bigint; sessionPrivateKey: Hex; }

export function decodeAek(aek: string): DecodedAek {
  const m = aek.match(/^aek_([a-z0-9]+)_(\d+)_([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error("clé aek invalide");
  return { net: m[1]!, sessionId: BigInt(m[2]!), sessionPrivateKey: toHex(unb64url(m[3]!)) };
}

/** Masque une clé pour l'affichage/les journaux : aek_arctest_12_abcd…WXYZ */
export function maskAek(aek: string): string {
  const m = aek.match(/^(aek_[a-z0-9]+_\d+_)(.+)$/);
  if (!m) return "aek_…";
  const tail = m[2]!;
  return `${m[1]}${tail.slice(0, 4)}…${tail.slice(-4)}`;
}
