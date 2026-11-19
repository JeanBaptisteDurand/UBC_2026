/** i18n — the site's two languages, without a library: English by default, French on request.
 *  - `en.ts` is the reference dictionary (typed `as const`); `fr.ts` must have exactly the same keys (type `Dict`).
 *  - `t(key, vars)` returns the text in the current language: `{name}` placeholders are filled from `vars`, and an
 *    entry written as a function (plurals, grammar) is called with `vars`. Variables are type-checked per key.
 *  - `tx(key, vars)` does the same with React elements in the placeholders (links, addresses, code).
 *  - the language lives in a small store: kept in localStorage when it is available (private window, blocked
 *    storage: memory only), mirrored on <html lang> and in the page title. `useLang()` redraws a component on change.
 *  - numbers and dates follow the language (en-US / fr-FR): fmtNum, fmtDateTime, fmtUnix, fmtTime. */
import { Fragment, createElement, useSyncExternalStore, type ReactNode } from "react";
import { en, type Dict } from "./en";
import { fr } from "./fr";

export type Lang = "en" | "fr";
export const LANGS: readonly Lang[] = ["en", "fr"];

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

const DICTS: Record<Lang, Dict> = { en, fr };
const STORE_KEY = "archive.lang";
/** The language key of the landing site ("archive-lang"): a visitor who chose French on the site arrives in a French
 *  console. It is read first (the site writes only its own key, the console writes both: the more recent of the two
 *  choices wins); the console's older key comes next. */
const SITE_KEY = "archive-lang";

function stored(): Lang | null {
  try {
    for (const k of [SITE_KEY, STORE_KEY]) {
      const v = window.localStorage.getItem(k);
      if (v === "en" || v === "fr") return v;
    }
    return null;
  } catch { return null; }
}

let current: Lang = (typeof window !== "undefined" && stored()) || "en";
const listeners = new Set<() => void>();

export const getLang = (): Lang => current;
/** BCP 47 locale for numbers and dates */
export const locale = (): "en-US" | "fr-FR" => (current === "fr" ? "fr-FR" : "en-US");

export function setLang(l: Lang) {
  if (l === current || !LANGS.includes(l)) return;
  current = l;
  try { window.localStorage.setItem(STORE_KEY, l); window.localStorage.setItem(SITE_KEY, l); } catch { /* storage unavailable: the choice lasts for this page */ }
  syncDocument();
  for (const f of listeners) f();
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** The current language; the component redraws when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

function raw(key: Key): unknown {
  return (DICTS[current] as Record<string, unknown>)[key] ?? (en as Record<string, unknown>)[key];
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

// ---------- numbers and dates in the current language ----------

export function fmtNum(n: number | bigint, o?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale(), o).format(n);
}
/** short date and time from milliseconds, with the time zone (19/11: a deadline without its zone was ambiguous) */
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

// ---------- <html lang>, title and description follow the language ----------

function syncDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current;
  document.title = t("meta.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
}
syncDocument();
