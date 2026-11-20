/** i18n — the site's words, without a library. The whole site is in English: the console always shows English,
 *  whatever the browser's language or a French choice stored in this browser earlier, and it has no language switch.
 *  `fr.ts` stays a complete dictionary (the `Dict` type checks its keys), but the console does not load it.
 *  - `en.ts` is the dictionary (typed `as const`).
 *  - `t(key, vars)` returns the text: `{name}` placeholders are filled from `vars`, and an entry written as a function
 *    (plurals, grammar) is called with `vars`. Variables are type-checked per key.
 *  - `tx(key, vars)` does the same with React elements in the placeholders (links, addresses, code).
 *  - `getLang()` and `useLang()` always give "en"; <html lang>, the page title and its description are set once.
 *  - numbers and dates are written in en-US: fmtNum, fmtDateTime, fmtUnix, fmtTime. */
import { Fragment, createElement, useSyncExternalStore, type ReactNode } from "react";
import { en } from "./en";

/** "fr" stays in the type: callers still test for it (the SDK's French messages are shown in English). */
export type Lang = "en" | "fr";

export type En = typeof en;
export type Key = keyof En;
/** `{a}` and `{b}` in "x {a} y {b}" → "a" | "b" */
export type Placeholders<S> = S extends `${string}{${infer P}}${infer R}` ? P | Placeholders<R> : never;
type Primitive = string | number | bigint;
/** true if the entry takes variables (placeholders, or an entry written as a function) */
export type HasVars<K extends Key> = En[K] extends (...a: any[]) => string ? true : [Placeholders<En[K]>] extends [never] ? false : true;
type VarsOf<K extends Key> = En[K] extends (v: infer V) => string ? V : Record<Placeholders<En[K]>, Primitive>;
type Args<K extends Key> = HasVars<K> extends true ? [vars: VarsOf<K>] : [];
/** keys whose text takes no variable (labels, titles) */
export type StaticKey = { [K in Key]: HasVars<K> extends false ? K : never }[Key];
/** keys written as plain text (usable with `tx`) */
export type TemplateKey = { [K in Key]: En[K] extends string ? K : never }[Key];

/** Always English. No stored choice is read (neither the console's "archive.lang" nor the landing site's
 *  "archive-lang"), nor the browser's language, and nothing switches it. */
export const getLang = (): Lang => "en";
/** BCP 47 locale for numbers and dates */
export const locale = (): "en-US" | "fr-FR" => "en-US";

/** The language never changes: there is nothing to subscribe to. */
const subscribe = () => () => {};

/** The language ("en"), kept as a hook for the components that call it. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

function raw(key: Key): unknown {
  return (en as Record<string, unknown>)[key];
}

export function t<K extends Key>(key: K, ...args: Args<K>): string {
  const vars = args[0] as Record<string, unknown> | undefined;
  const v = raw(key);
  if (typeof v === "function") return (v as (x: unknown) => string)(vars ?? {});
  const s = typeof v === "string" ? v : String(key);
  return vars ? s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : s;
}

/** `t` with React elements in the placeholders: "Open {link}, then…" → ["Open ", <a/>, ", then…"] */
export function tx<K extends TemplateKey>(key: K, vars: Record<Placeholders<En[K]>, ReactNode>): ReactNode {
  const parts = String(raw(key)).split(/\{(\w+)\}/);
  const v = vars as Record<string, ReactNode>;
  return createElement(Fragment, null, ...parts.map((p, i) => (i % 2 ? createElement(Fragment, { key: i }, v[p]) : p)));
}

// ---------- numbers and dates, in en-US ----------

export function fmtNum(n: number | bigint, o?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale(), o).format(n);
}
/** short date and time from milliseconds, with the time zone (a deadline without its zone would be ambiguous) */
export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString(locale(), { year: "2-digit", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
/** short date and time from Unix seconds (on-chain timestamps) */
export function fmtUnix(s: bigint | number): string {
  return fmtDateTime(Number(s) * 1000);
}
/** hour and minute from milliseconds */
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

// ---------- <html lang>, title and description ----------

function syncDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = "en";
  document.title = t("meta.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
}
syncDocument();
