/** fmt.ts — formats partagés (montants USDC, hash courts), sans composant React : errors.ts et msg.ts s'en servent sans
 *  dépendre de ui.tsx (qui les réexporte pour les écrans). */
import { locale } from "./i18n";

/** Montant USDC (6 décimales) lisible dans la langue du site : « 0.0549 USDC » en anglais, « 0,0549 USDC » en français. */
export function usdc(v: bigint | string | number | undefined | null): string {
  if (v === undefined || v === null || v === "") return "—";
  const n = Number(typeof v === "bigint" ? v : BigInt(String(v))) / 1e6;
  return n.toLocaleString(locale(), { maximumFractionDigits: 4 }) + " USDC";
}

export function short(h?: string | null, n = 6): string {
  if (!h) return "—";
  return h.length <= 2 * n + 2 ? h : `${h.slice(0, n + 2)}…${h.slice(-4)}`;
}
