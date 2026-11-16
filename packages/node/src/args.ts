/** args.ts — lecture des options (node:util parseArgs) avec des erreurs en anglais, et validation des valeurs. */
import util from "node:util";
import { UsageError } from "./errors";

export type OptionSpec = Record<string, { type: "string" | "boolean"; short?: string }>;
export type Values = Record<string, string | boolean | undefined>;

/** les options d'une commande ; « -h/--help » est toujours accepté */
export function parseCommand(argv: string[], spec: OptionSpec, cmd: string): { values: Values; positionals: string[] } {
  try {
    const r = util.parseArgs({
      args: argv,
      options: { ...spec, help: { type: "boolean", short: "h" } },
      strict: true,
      allowPositionals: true,
    });
    return { values: r.values as Values, positionals: r.positionals };
  } catch (e) {
    throw new UsageError(parseError(e, cmd));
  }
}

export function parseError(e: unknown, cmd: string): string {
  const x = e as { code?: string; message?: string };
  const opt = /'(-{1,2}[^' ]+)/.exec(x.message ?? "")?.[1] ?? "";
  const help = `see: archive-node ${cmd} --help`;
  switch (x.code) {
    case "ERR_PARSE_ARGS_UNKNOWN_OPTION":
      return `unknown option ${opt} (${help}).`;
    case "ERR_PARSE_ARGS_INVALID_OPTION_VALUE":
      return /argument missing/i.test(x.message ?? "")
        ? `option ${opt} expects a value (${help}).`
        : `option ${opt} doesn't take a value (${help}).`;
    case "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL":
      return `unexpected argument (${help}).`;
  }
  return `${x.message ?? String(e)} (${help}).`;
}

export const str = (v: string | boolean | undefined): string | undefined => (typeof v === "string" ? v : undefined);

export function parsePort(v: string, flag = "--port"): number {
  const n = Number(v);
  if (!/^\d+$/.test(v.trim()) || !Number.isInteger(n) || n < 1 || n > 65535) {
    throw new UsageError(`${flag}: invalid port “${v}” (expected: an integer between 1 and 65535).`);
  }
  return n;
}

export function parseProduct(v: string): number {
  const n = Number(v);
  if (!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(n)) {
    throw new UsageError(`--product: invalid product number “${v}” (expected: an integer, for example 1).`);
  }
  return n;
}

export function parseCount(v: string, flag: string, max: number): number {
  const n = Number(v);
  if (!/^\d+$/.test(v.trim()) || n < 1 || n > max) throw new UsageError(`${flag}: invalid number “${v}” (between 1 and ${max}).`);
  return n;
}
