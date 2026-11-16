/** config.ts — ~/.archive : la clé opérateur (node.json, droits 0600) et l'état du dernier lancement (state.json). */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { DEFAULT_API } from "./constants";
import { CliError, UsageError } from "./errors";

export interface NodeConfig {
  api: string;
  key: string;
  machineId?: string | null;
  operator?: string | null;
  /** origine du site (déduite de l'URL d'appairage) pour les liens affichés */
  web?: string | null;
  pairedAt?: string;
}

export interface NodeState {
  pid: number | null;
  startedAt: string;
  updatedAt: string;
  mode: string;
  productId: number;
  port: number;
  image: string;
  api: string;
  machineId: string | null;
  operator: string | null;
  status: string;
  enclaveUrl: string | null;
  registered: boolean | null;
  lastHeartbeatAt: string | null;
  lastHeartbeatOk: boolean | null;
  lastError: string | null;
}

export const archiveDir = (): string => process.env.ARCHIVE_HOME?.trim() || join(homedir(), ".archive");
export const configPath = (): string => join(archiveDir(), "node.json");
export const statePath = (): string => join(archiveDir(), "state.json");

/** écriture atomique, lisible par le seul propriétaire (dossier 0700, fichier 0600) */
export function writePrivateFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

const writePrivateJson = (path: string, data: unknown): void => writePrivateFile(path, JSON.stringify(data, null, 2) + "\n");

export function loadConfig(): NodeConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  let c: NodeConfig | null = null;
  try {
    c = JSON.parse(readFileSync(p, "utf8")) as NodeConfig;
  } catch {
    c = null;
  }
  if (!c || typeof c.key !== "string" || !c.key) {
    throw new CliError(`The file ${p} is unreadable: delete it, then pair again with archive-node pair.`);
  }
  try {
    if ((statSync(p).mode & 0o077) !== 0) chmodSync(p, 0o600); // la clé ne doit être lisible que par vous
  } catch {
    /* système de fichiers sans droits Unix */
  }
  return c;
}

export function saveConfig(c: NodeConfig): void {
  writePrivateJson(configPath(), c);
}

export function loadState(): NodeState | null {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as NodeState;
  } catch {
    return null;
  }
}

export function saveState(s: NodeState): void {
  try {
    writePrivateJson(statePath(), s);
  } catch {
    /* l'état local n'est qu'un confort pour « status » */
  }
}

/** http(s)://hôte[:port][/chemin], sans « / » final */
export function normalizeUrl(raw: string, what: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UsageError(`${what}: invalid address “${raw}” (expected: http(s)://host:port).`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UsageError(`${what}: only http:// or https:// addresses are accepted (“${raw}”).`);
  }
  return u.toString().replace(/\/+$/, "");
}

/** ordre : --api, puis $ARCHIVE_API, puis l'API de l'appairage, puis l'API publique d'ArcHive */
export function resolveApi(flag: string | undefined, cfg: NodeConfig | null): string {
  const raw = flag ?? (process.env.ARCHIVE_API?.trim() || undefined) ?? cfg?.api ?? DEFAULT_API;
  return normalizeUrl(raw, flag ? "--api" : process.env.ARCHIVE_API ? "ARCHIVE_API" : "API");
}

/** le chemin affiché à l'humain : ~/.archive/… plutôt que /home/jb/.archive/… */
export function tilde(p: string): string {
  const h = homedir();
  return h && p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
}
