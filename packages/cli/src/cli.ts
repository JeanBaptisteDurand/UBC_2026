/** cli.ts — analyse des arguments, aide en français, sorties et formats.
 *  Convention : stdout = le résultat (scriptable), stderr = progression, avertissements, erreurs. */
import { readFileSync } from "node:fs";
import { formatUnits, getAddress, isAddress, isHex, parseUnits, type Address, type Hex } from "viem";

export class CliError extends Error {}
export class UsageError extends Error {
  constructor(message: string, readonly command?: Command) {
    super(message);
  }
}

export interface OptSpec {
  name: string;
  /** présent : l'option prend une valeur (ex. "<usdc>") ; absent : simple drapeau */
  value?: string;
  desc: string;
  short?: string;
  required?: boolean;
}

export interface ArgSpec {
  name: string;
  desc: string;
  optional?: boolean;
}

export interface Ctx {
  args: string[];
  opts: Record<string, string | true>;
  rpc?: string;
  dryRun: boolean;
  cmd: Command;
}

export interface Command {
  path: string[];
  summary: string;
  usage: string;
  description?: string[];
  args?: ArgSpec[];
  options?: OptSpec[];
  examples?: string[];
  /** signe et envoie des transactions : PRIVATE_KEY requise, --dry-run disponible */
  write?: boolean;
  run(ctx: Ctx): Promise<void>;
}

export const GLOBAL_OPTS: OptSpec[] = [
  { name: "rpc", value: "<url>", desc: "RPC d'Arc testnet (défaut https://rpc.testnet.arc.io)" },
  { name: "help", short: "h", desc: "affiche cette aide" },
];
export const DRY_RUN_OPT: OptSpec = {
  name: "dry-run",
  desc: "simule la ou les transactions (eth_call) sans rien envoyer",
};

function specsOf(cmd: Command): OptSpec[] {
  return [...(cmd.options ?? []), ...(cmd.write ? [DRY_RUN_OPT] : []), ...GLOBAL_OPTS];
}

export function parseArgs(argv: string[], cmd: Command): Ctx {
  const specs = specsOf(cmd);
  const byName = new Map(specs.map((s) => [s.name, s]));
  const byShort = new Map(specs.filter((s) => s.short).map((s) => [s.short as string, s]));
  const opts: Record<string, string | true> = {};
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--") {
      args.push(...argv.slice(i + 1));
      break;
    }
    const isLong = a.startsWith("--");
    const isShort = !isLong && /^-[A-Za-z]$/.test(a);
    if (!isLong && !isShort) {
      args.push(a);
      continue;
    }
    let name: string;
    let inline: string | undefined;
    if (isLong) {
      const eq = a.indexOf("=");
      name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      inline = eq > 0 ? a.slice(eq + 1) : undefined;
    } else {
      const s = byShort.get(a.slice(1));
      if (!s) throw new UsageError(`option inconnue : ${a}`, cmd);
      name = s.name;
    }
    if (name === "pk") {
      throw new UsageError("--pk is not supported (the key would appear in shell history and the process list): set the PRIVATE_KEY environment variable", cmd);
    }
    if (name === "r") {
      throw new UsageError("--r is not supported (r would appear in shell history and the process list; with the public cP, it opens the exploit): use --r-file <file with mode 0600>, or --r-file - for standard input", cmd);
    }
    const spec = byName.get(name);
    if (!spec) throw new UsageError(`option inconnue : --${name}`, cmd);
    if (spec.value) {
      const v = inline ?? argv[i + 1];
      if (v === undefined || (inline === undefined && v.startsWith("--"))) {
        throw new UsageError(`--${name} attend une valeur ${spec.value}`, cmd);
      }
      if (inline === undefined) i++;
      opts[name] = v;
    } else {
      if (inline !== undefined) throw new UsageError(`--${name} ne prend pas de valeur`, cmd);
      opts[name] = true;
    }
  }
  const missing = specs.filter((s) => s.required && opts[s.name] === undefined).map((s) => `--${s.name}`);
  if (missing.length) throw new UsageError(`option(s) requise(s) manquante(s) : ${missing.join(", ")}`, cmd);
  const needed = (cmd.args ?? []).filter((x) => !x.optional).length;
  if (args.length < needed) {
    const names = (cmd.args ?? []).slice(args.length).filter((x) => !x.optional).map((x) => `<${x.name}>`);
    throw new UsageError(`argument(s) manquant(s) : ${names.join(" ")}`, cmd);
  }
  if (args.length > (cmd.args ?? []).length) {
    throw new UsageError(`argument(s) en trop : ${args.slice((cmd.args ?? []).length).join(" ")}`, cmd);
  }
  const rpc = typeof opts.rpc === "string" ? opts.rpc : undefined;
  return { args, opts, rpc, dryRun: opts["dry-run"] === true, cmd };
}

export function opt(ctx: Ctx, name: string): string | undefined {
  const v = ctx.opts[name];
  return typeof v === "string" ? v : undefined;
}
export function req(ctx: Ctx, name: string): string {
  const v = opt(ctx, name);
  if (v === undefined) throw new UsageError(`--${name} est requis`, ctx.cmd);
  return v;
}
export function flag(ctx: Ctx, name: string): boolean {
  return ctx.opts[name] === true;
}

// ---------- aide ----------

const pad = (s: string, n: number) => (s.length >= n ? `${s}  ` : s + " ".repeat(n - s.length));

export function renderHelp(c: Command): string {
  const L: string[] = [`Usage : arcvault ${c.usage}`, "", `  ${c.summary}`];
  if (c.description?.length) {
    L.push("");
    for (const d of c.description) L.push(`  ${d}`);
  }
  if (c.args?.length) {
    L.push("", "Arguments :");
    for (const a of c.args) L.push(`  ${pad(`<${a.name}>`, 28)}${a.desc}${a.optional ? " (facultatif)" : ""}`);
  }
  L.push("", "Options :");
  for (const o of specsOf(c)) {
    const f = `${o.short ? `-${o.short}, ` : ""}--${o.name}${o.value ? ` ${o.value}` : ""}`;
    L.push(`  ${pad(f, 28)}${o.desc}${o.required ? " (requis)" : ""}`);
  }
  if (c.write) {
    L.push(
      "",
      "Portefeuille :",
      "  signe avec la clé privée de la variable d'environnement PRIVATE_KEY (jamais affichée ni journalisée) ;",
      "  le RPC doit répondre Arc testnet (chainId 5042002) avant toute signature.",
    );
  }
  if (c.examples?.length) {
    L.push("", "Exemples :");
    for (const e of c.examples) L.push(`  ${e}`);
  }
  return L.join("\n");
}

export function renderGroupHelp(group: string, title: string, cmds: Command[]): string {
  const L: string[] = [`Usage: arcvault ${group} <subcommand> [options]`, "", `  ${title}`, "", "Subcommands:"];
  for (const c of cmds) L.push(`  ${pad(c.path.slice(1).join(" "), 14)}${c.summary}${c.write ? " [signs]" : ""}`);
  L.push("", `Detailed help: arcvault ${group} <subcommand> --help`);
  return L.join("\n");
}

// ---------- sorties ----------

export const out = (s = "") => {
  process.stdout.write(`${s}\n`);
};
export const info = (s = "") => {
  process.stderr.write(`${s}\n`);
};
export const warn = (s: string) => {
  process.stderr.write(`attention : ${s}\n`);
};

// ---------- formats et lectures d'arguments ----------

export const usdc = (x: bigint) => `${formatUnits(x, 6)} USDC`;

export function parseUsdc(v: string, label: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(v)) {
    throw new UsageError(`${label} : montant USDC invalide « ${v} » (ex. 2 ou 0.5 ; 6 décimales au plus)`);
  }
  return parseUnits(v, 6);
}

export function parseId(v: string | undefined, label: string): bigint {
  if (v === undefined || !/^\d+$/.test(v)) {
    throw new UsageError(`${label} : entier attendu${v === undefined ? "" : ` (reçu « ${v} »)`}`);
  }
  return BigInt(v);
}

export function parseAddr(v: string, label: string): Address {
  if (!isAddress(v, { strict: false })) throw new UsageError(`${label} : adresse invalide « ${v} »`);
  return getAddress(v);
}

export function isBytes32(v: unknown): v is Hex {
  return typeof v === "string" && isHex(v) && v.length === 66;
}

export const nowS = () => Math.floor(Date.now() / 1000);

/** Durée lisible en français : 45 s, 12 min, 3,5 h, 2,0 j. */
export function dur(s: number): string {
  const a = Math.abs(s);
  if (a < 60) return `${a} s`;
  if (a < 3600) return `${Math.round(a / 60)} min`;
  if (a < 172_800) return `${(a / 3600).toFixed(1).replace(".", ",")} h`;
  return `${(a / 86_400).toFixed(1).replace(".", ",")} j`;
}

export function fmtTime(ts: bigint | number): string {
  const t = Number(ts);
  if (t === 0) return "—";
  const d = `${new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC`;
  const delta = t - nowS();
  return `${d} (${delta >= 0 ? "dans" : "il y a"} ${dur(delta)})`;
}

/** Durée : 90s, 30m, 24h, 7d (ou 7j). */
export function parseDurationS(v: string, label: string): number {
  const m = v.match(/^(\d+)\s*(s|m|min|h|d|j)$/i);
  if (!m) throw new UsageError(`${label} : durée invalide « ${v} » (ex. 30m, 24h, 7d)`);
  const n = Number(m[1]);
  const unit = (m[2] as string).toLowerCase();
  return n * (unit === "s" ? 1 : unit === "m" || unit === "min" ? 60 : unit === "h" ? 3600 : 86_400);
}

/** Instant absolu (secondes Unix) : durée relative (7d), horodatage Unix, ou date ISO. */
export function parseWhen(v: string, label: string): bigint {
  if (/^\d{9,}$/.test(v)) return BigInt(v);
  if (/^\d+\s*(s|m|min|h|d|j)$/i.test(v)) return BigInt(nowS() + parseDurationS(v, label));
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new UsageError(`${label} : date invalide « ${v} » (ex. 7d, 1795000000, 2026-11-20T12:00Z)`);
  return BigInt(Math.floor(t / 1000));
}

export function readJson(path: string, label = "fichier"): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new CliError(`${label} introuvable ou illisible : ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new CliError(`${label} : JSON invalide (${path}) : ${(e as Error).message}`);
  }
}

/** Les montants en entiers des fichiers JSON (chaînes ou nombres) → bigint. */
export function big(v: unknown, label: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  throw new CliError(`${label} : entier attendu (reçu ${JSON.stringify(v)})`);
}

export const check = (ok: boolean) => (ok ? "✓" : "✗");
