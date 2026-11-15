/** msg.ts — the texts the site shows LATER (status lines, the steps of an action, refusals it raises itself) are kept as
 *  their KEY and values, never as text already translated: they are put into words when displayed, in the language of
 *  the moment, so they follow the EN | FR switch without re-reading or re-doing anything.
 *  - msg(key, vars): like t(), but nothing is translated yet. A value can itself be a message, an error (`{ error }`,
 *    explained at display time by explainError) or a function (an amount, a date: formatted in the language of the
 *    moment, e.g. () => usdc(v)). Variables are type-checked per key, as for t();
 *  - fail(e): "Failed: …" / « échec : … » for an error; failWith(m): the same for one of the site's own messages;
 *  - show(m): the text, now; isFailure(m): a failure (shown in red);
 *  - MsgError: an error the site raises with its message (explainError puts it into words at display time);
 *  - Shown: a message, or a function that renders React (a sentence with links, addresses), for Steps.
 *  explainError (errors.ts) and show call each other: the two modules import each other, inside functions only. */
import type { ReactNode } from "react";
import { t, type En, type HasVars, type Key, type Placeholders } from "./i18n";
import { explainError } from "./errors";

/** A value kept in a message: put into words (or called) at display time. */
export type MsgValue = string | number | bigint | Msg | (() => string);
export type Msg =
  | { readonly key: Key; readonly vars?: Readonly<Record<string, MsgValue>> }
  | { readonly error: unknown };

type MsgVars<K extends Key> = En[K] extends (v: infer V) => string ? V : Record<Placeholders<En[K]>, MsgValue>;
type MsgArgs<K extends Key> = HasVars<K> extends true ? [vars: MsgVars<K>] : [];

/** The message `key` with its values, to show later (in the language of that moment). */
export function msg<K extends Key>(key: K, ...args: MsgArgs<K>): Msg {
  const vars = args[0] as Record<string, MsgValue> | undefined;
  return vars ? { key, vars } : { key };
}
/** An error, explained at display time (explainError). */
export const errorMsg = (e: unknown): Msg => ({ error: e });
/** "Failed: …" / « échec : … » for an error. */
export const fail = (e: unknown): Msg => msg("common.fail", { msg: { error: e } });
/** "Failed: …" / « échec : … » for one of the site's own messages. */
export const failWith = (m: Msg): Msg => msg("common.fail", { msg: m });

const isMsg = (x: unknown): x is Msg => !!x && typeof x === "object" && ("key" in x || "error" in x);

function value(v: MsgValue): unknown {
  if (typeof v === "function") return v();
  if (isMsg(v)) return show(v);
  return v;
}

/** The text of a message, in the current language ("" for none). */
export function show(m: Msg | null | undefined): string {
  if (!m) return "";
  if ("error" in m) return explainError(m.error);
  const vars = m.vars ? Object.fromEntries(Object.entries(m.vars).map(([k, v]) => [k, value(v)])) : undefined;
  return (t as (k: Key, v?: Record<string, unknown>) => string)(m.key, vars);
}

/** True for a failure ("Failed: …"): the status line is shown in red. */
export const isFailure = (m: Msg | null | undefined): boolean => !!m && "key" in m && m.key === "common.fail";

/** An error raised by the site itself, carrying its message: put into words again at display time. */
export class MsgError extends Error {
  readonly msg: Msg;
  constructor(m: Msg, name = "MsgError") {
    super(show(m));
    this.msg = m;
    this.name = name;
  }
}

/** What a step shows: a message, or a function that renders React (links, addresses), called at display time. */
export type Shown = Msg | (() => ReactNode);
export const renderShown = (s: Shown | undefined): ReactNode => (s === undefined ? undefined : typeof s === "function" ? s() : show(s));
