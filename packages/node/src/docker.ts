/** docker.ts — tout ce que l'agent demande à Docker : démon, image, conteneur de l'enclave, journaux. */
import { CONTAINER, DSTACK_SOCKET, ENCLAVE_INNER_PORT } from "./constants";
import { lastLine, run, type ExecResult } from "./exec";
import { stripAnsi } from "./ui";

export type DockerState =
  | { ok: true; version: string }
  | { ok: false; kind: "missing" | "permission" | "daemon" | "timeout" | "other"; detail: string };

export async function dockerState(signal?: AbortSignal): Promise<DockerState> {
  const r = await run("docker", ["version", "--format", "{{.Server.Version}}"], { timeoutMs: 12_000, signal });
  if (r.missing) {
    return { ok: false, kind: "missing", detail: "Docker isn't installed. Linux: curl -fsSL https://get.docker.com | sh; macOS: Docker Desktop (or OrbStack, Colima)." };
  }
  if (r.timedOut) return { ok: false, kind: "timeout", detail: "Docker isn't answering (over 12 s): restart Docker, then try again." };
  const v = r.stdout.trim();
  if (r.code === 0 && v) return { ok: true, version: v };
  const e = r.stderr;
  if (/permission denied/i.test(e)) {
    return { ok: false, kind: "permission", detail: "Docker is installed but your user can't reach the daemon: sudo usermod -aG docker $USER, then log in again (or run with sudo)." };
  }
  if (/cannot connect|is the docker daemon running|error during connect|daemon is not running|no such file or directory/i.test(e)) {
    return { ok: false, kind: "daemon", detail: "Docker is installed but the daemon isn't running: start Docker Desktop (macOS) or sudo systemctl start docker (Linux)." };
  }
  return { ok: false, kind: "other", detail: `Docker answers badly: ${lastLine(e) || `code ${r.code}`}` };
}

export interface ContainerInfo {
  id: string;
  /** created | running | restarting | paused | exited | dead */
  state: string;
  running: boolean;
  restarting: boolean;
  exitCode: number;
  error: string;
  oomKilled: boolean;
  startedAt: number | null;
  restartCount: number;
  image: string;
  labels: Record<string, string>;
  hostPort: number | null;
}

const when = (iso: unknown): number | null => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) && t > 0 ? t : null; // « 0001-01-01T00:00:00Z » = jamais démarré
};

export async function inspectContainer(name = CONTAINER, signal?: AbortSignal): Promise<ContainerInfo | null> {
  const r = await run("docker", ["container", "inspect", name, "--format", "{{json .}}"], { timeoutMs: 12_000, signal });
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    const st = j.State ?? {};
    const binding = j.HostConfig?.PortBindings?.[`${ENCLAVE_INNER_PORT}/tcp`]?.[0]?.HostPort;
    return {
      id: String(j.Id ?? ""),
      state: String(st.Status ?? "unknown"),
      running: st.Running === true && st.Restarting !== true,
      restarting: st.Restarting === true,
      exitCode: Number(st.ExitCode ?? 0),
      error: String(st.Error ?? ""),
      oomKilled: st.OOMKilled === true,
      startedAt: when(st.StartedAt),
      restartCount: Number(j.RestartCount ?? 0),
      image: String(j.Config?.Image ?? ""),
      labels: (j.Config?.Labels ?? {}) as Record<string, string>,
      hostPort: binding ? Number(binding) : null,
    };
  } catch {
    return null;
  }
}

/** « linux/amd64 » si l'image est présente localement, sinon null */
export async function imagePlatform(image: string, signal?: AbortSignal): Promise<string | null> {
  const r = await run("docker", ["image", "inspect", image, "--format", "{{.Os}}/{{.Architecture}}"], { timeoutMs: 12_000, signal });
  if (r.code !== 0) return null;
  return r.stdout.trim().split("\n")[0] || "linux/amd64";
}

export function pullImage(image: string, platform: string | null, signal?: AbortSignal): Promise<ExecResult> {
  return run("docker", ["pull", ...(platform ? ["--platform", platform] : []), image], { timeoutMs: 20 * 60_000, signal });
}

export const PRIVATE_IMAGE_HELP =
  "The enclave image is private for now: log Docker in to the registry with the token from the ArcHive team " +
  "(docker login ghcr.io -u <user>), or build the image from enclave/Dockerfile " +
  "(docker build -t archive-sealed-chat:local enclave/) and run again with --image archive-sealed-chat:local.";

export function pullError(stderr: string, image: string): string {
  if (/no matching manifest|does not match the specified platform/i.test(stderr)) {
    return `The image ${image} doesn't exist for this processor (${process.arch}): use an x86-64 machine or another image (--image).`;
  }
  if (/unauthorized|denied|authentication required|forbidden|manifest unknown|not found|does not exist|may require 'docker login'/i.test(stderr)) {
    return `${PRIVATE_IMAGE_HELP} (Docker: ${lastLine(stderr)})`;
  }
  if (/timeout|tls handshake|no such host|dial tcp|connection refused|network is unreachable|i\/o timeout/i.test(stderr)) {
    return `Can't download the image (network): check access to ${image.split("/")[0]} (Docker: ${lastLine(stderr)}).`;
  }
  return `Can't download the image: ${lastLine(stderr) || "unknown error"}.`;
}

export function runError(stderr: string, port: number): string {
  if (/port is already allocated|address already in use|bind for/i.test(stderr)) {
    return `Port ${port} is already in use on this machine: free it or run again with --port ${port + 1}.`;
  }
  if (/is already in use by container|conflict/i.test(stderr)) {
    return `Another container is already named ${CONTAINER}: docker rm -f ${CONTAINER}, then run again.`;
  }
  if (/dstack\.sock/i.test(stderr)) return `Can't mount ${DSTACK_SOCKET}: ${lastLine(stderr)}.`;
  return `Docker couldn't start the enclave: ${lastLine(stderr) || "unknown error"}.`;
}

export interface RunSpec {
  port: number;
  product: number;
  /** variables passées au conteneur (contrats, opérateurs autorisés…) ; une valeur vide = héritée de l'environnement
   *  de l'agent (docker run -e NOM), pour qu'un secret n'apparaisse jamais dans la ligne de commande */
  env?: Record<string, string>;
  image: string;
  /** à passer seulement si l'image n'est pas de l'architecture de la machine (émulation) */
  platform: string | null;
  dstack: boolean;
  labels: Record<string, string>;
}

/** docker run -d --name archive-enclave --restart unless-stopped -p {port}:8802 -e PRODUCT_ID={product} [-e …] [-v dstack.sock] {image}
 *  (+ --init : node n'est pas PID 1, il reçoit SIGTERM et l'arrêt est immédiat au lieu d'attendre 10 s) */
export function runArgs(s: RunSpec): string[] {
  return [
    "run", "-d", "--init", "--name", CONTAINER, "--restart", "unless-stopped",
    "-p", `${s.port}:${ENCLAVE_INNER_PORT}`,
    "-e", `PRODUCT_ID=${s.product}`,
    ...Object.entries(s.env ?? {}).flatMap(([k, v]) => ["-e", v === "" ? k : `${k}=${v}`]),
    ...(s.dstack ? ["-v", `${DSTACK_SOCKET}:${DSTACK_SOCKET}`] : []),
    ...Object.entries(s.labels).flatMap(([k, v]) => ["--label", `${k}=${v}`]),
    ...(s.platform ? ["--platform", s.platform] : []),
    s.image,
  ];
}

/** architecture Docker de cette machine (amd64, arm64…) */
export const hostDockerArch = (): string => ({ x64: "amd64", arm64: "arm64", arm: "arm", ia32: "386" } as Record<string, string>)[process.arch] ?? process.arch;

// ---------- journaux ----------

export interface LogLine {
  /** horodatage en ms et fraction en ns (docker donne la nanoseconde) pour trier stdout et stderr ensemble */
  ts: number;
  frac: number;
  text: string;
}

const TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})\s?(.*)$/;

export function parseLogLines(chunk: string): LogLine[] {
  const outLines: LogLine[] = [];
  let prev = { ts: 0, frac: 0 };
  for (const raw of chunk.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = TS_RE.exec(raw);
    if (!m) {
      outLines.push({ ...prev, text: stripAnsi(raw) });
      continue;
    }
    prev = { ts: Date.parse(m[1]! + m[3]!), frac: Number(((m[2] ?? "") + "000000000").slice(0, 9)) };
    outLines.push({ ...prev, text: stripAnsi(m[4] ?? "") });
  }
  return outLines;
}

/** les dernières lignes du conteneur, stdout et stderr remis dans l'ordre */
export async function containerLogs(name: string, tail: number, signal?: AbortSignal): Promise<LogLine[]> {
  const r = await run("docker", ["logs", "--timestamps", "--tail", String(tail), name], { timeoutMs: 12_000, signal });
  if (r.code !== 0) return [];
  return mergeLogLines([parseLogLines(r.stdout), parseLogLines(r.stderr)], tail);
}

export function mergeLogLines(groups: LogLine[][], max: number): LogLine[] {
  const all = groups.flat().map((l, i) => ({ l, i }));
  all.sort((a, b) => a.l.ts - b.l.ts || a.l.frac - b.l.frac || a.i - b.i);
  return all.slice(-max).map((x) => x.l);
}

/** « 2026-11-07T01:03:50Z message », tronqué pour l'API (500 caractères au plus par ligne) */
export function formatLogLine(l: LogLine): string {
  const stamp = l.ts > 0 ? new Date(l.ts).toISOString().slice(0, 19) + "Z " : "";
  return (stamp + l.text).slice(0, 400);
}
