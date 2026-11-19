/** fmt.ts — shared formats (USDC amounts, short hashes), without a React component: errors.ts and msg.ts use them
 *  without depending on ui.tsx (which re-exports them for the screens). */
import { locale } from "./i18n";

/** A USDC amount (6 decimals) readable in the site's language: "0.0549 USDC" in English, « 0,0549 USDC » in French. */
export function usdc(v: bigint | string | number | undefined | null): string {
  if (v === undefined || v === null || v === "") return "—";
  const n = Number(typeof v === "bigint" ? v : BigInt(String(v))) / 1e6;
  return n.toLocaleString(locale(), { maximumFractionDigits: 4 }) + " USDC";
}

export function short(h?: string | null, n = 6): string {
  if (!h) return "—";
  return h.length <= 2 * n + 2 ? h : `${h.slice(0, n + 2)}…${h.slice(-4)}`;
}
