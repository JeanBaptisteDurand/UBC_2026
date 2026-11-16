/** doctor.ts — le diagnostic : 12 vérifications aux identifiants fixes, lues aussi par le site et le copilote. */
import { hostname, platform } from "node:os";
import { CLOCK_MAX_SKEW_S, CONTAINER, DEFAULT_RPC, DSTACK_SOCKET, TSM_REPORT_DIR } from "./constants";
import { dockerState, inspectContainer, type ContainerInfo, type DockerState } from "./docker";
import { apiError, hostOf, netError, request } from "./net";
import {
  detectMode, hasDstack, hasTsmReport, modeLabel, osDescription, portOwner, probePort, tdxDevice, upCommand, type Mode,
} from "./system";
import { ARROW, KO, OK, SKIP, bold, columns, dim, fmtInt, fmtSeconds, isTTY, out, pad, plural, short, wrap } from "./ui";
import { VERSION } from "./version";

export const CHECK_IDS = [
  "os", "node", "docker", "tdx_guest", "tsm_report", "dstack_socket", "clock", "rpc", "api", "port", "enclave_health", "attest",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/** le format exact envoyé à l'API dans chaque battement de cœur */
export interface Check {
  id: CheckId;
  label: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  mode: Mode;
  detected: Mode;
  hostname: string;
  version: string;
  at: string;
  api: string;
  port: number;
  checks: Check[];
  /** vérifications qui comptent pour « ok » dans ce mode ; les autres sont facultatives */
  required: CheckId[];
  blocking: CheckId[];
  facts: {
    docker: DockerState;
    container: ContainerInfo | null;
    healthOk: boolean;
    signer: string | null;
    x25519: string | null;
    block: number | null;
  };
}

export interface DoctorOptions {
  api: string;
  port: number;
  /** forcer le mode démo (TDX facultatif) */
  demo?: boolean;
  /** l'enclave doit tourner (dans « up ») ; par défaut : si le conteneur existe */
  expectEnclave?: boolean;
  rpc?: string;
  signal?: AbortSignal;
}

const LABELS: Record<CheckId, string> = {
  os: "System",
  node: "Node.js",
  docker: "Docker",
  tdx_guest: "Intel TDX VM",
  tsm_report: "TSM report (configfs)",
  dstack_socket: "dstack agent",
  clock: "Clock",
  rpc: "Arc RPC",
  api: "ArcHive API",
  port: "Enclave port",
  enclave_health: "Enclave health",
  attest: "Attestation keys",
};

// l'API tronque à 300 caractères : on coupe proprement avant
const clip = (s: string, n = 300): string => (s.length <= n ? s : s.slice(0, n - 1) + "…");

interface Probe {
  ok: boolean;
  status?: number;
  json?: any;
  ms?: number;
  skewS?: number | null;
  error?: string;
}

async function probe(url: string, init: { body?: unknown; timeoutMs: number; signal?: AbortSignal }): Promise<Probe> {
  try {
    const r = await request(url, init);
    return { ok: r.ok, status: r.status, json: r.json, ms: r.ms, skewS: r.skewS, error: r.ok ? undefined : apiError(r) };
  } catch (e) {
    return { ok: false, error: netError(e, init.timeoutMs) };
  }
}

/** arrêt normal : sortie propre, ou arrêtée par docker stop (SIGTERM = 143, SIGKILL après délai = 137) */
const cleanStop = (c: ContainerInfo): boolean => !c.oomKilled && [0, 137, 143].includes(c.exitCode);

/** « quote simulé », « quote TDX réel », ou pas encore de quote (il naît à l'inscription) */
function quoteLabel(q: unknown): string {
  if (typeof q !== "string" || q === "0x" || q === "") return "no quote yet (it is produced at registration, from the site)";
  if (q.toLowerCase().startsWith("0x4d4f434b2d544458")) return "last quote simulated (demo mode)";
  return `last quote: real TDX (${fmtInt((q.length - 2) / 2)} bytes)`;
}

export async function runDoctor(o: DoctorOptions): Promise<DoctorReport> {
  const rpc = o.rpc ?? (process.env.ARCHIVE_RPC?.trim() || DEFAULT_RPC);
  const detected = detectMode();
  const mode: Mode = o.demo ? "demo" : detected;
  const local = `http://127.0.0.1:${o.port}`;
  const sig = o.signal;

  const [osDesc, docker, rpcP, apiP, health, keys] = await Promise.all([
    osDescription(),
    dockerState(sig),
    probe(rpc, { body: { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }, timeoutMs: 8000, signal: sig }),
    probe(`${o.api}/health`, { timeoutMs: 6000, signal: sig }),
    probe(`${local}/health`, { timeoutMs: 3000, signal: sig }),
    probe(`${local}/pubkeys`, { timeoutMs: 3000, signal: sig }),
  ]);
  const container = docker.ok ? await inspectContainer(CONTAINER, sig) : null;
  // après les sondes HTTP locales : l'essai d'écoute ne doit pas intercepter leurs connexions
  const portState = await probePort(o.port);

  const checks: Check[] = [];
  const add = (id: CheckId, ok: boolean, detail: string, label = LABELS[id]) => checks.push({ id, label, ok, detail: clip(detail) });
  const p = platform();

  // os
  if (p === "linux") add("os", true, osDesc + (process.arch !== "x64" ? " · TDX needs an Intel x86-64 processor: demo mode only" : ""));
  else if (p === "darwin") add("os", true, `${osDesc}: no TDX on a Mac: local trial only, the machine can't serve the network`);
  else if (p === "win32") add("os", false, "Windows isn't supported: use WSL 2 (Ubuntu) or a Linux VM.");
  else add("os", false, `${osDesc} isn't supported: use Linux (Intel TDX VM), or macOS for the demo.`);

  // node
  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= 20, major >= 20 ? `Node.js ${process.version}` : `Node.js ${process.version} is too old: install Node.js 20 or later (https://nodejs.org).`);

  // docker
  add("docker", docker.ok, docker.ok ? `Docker ${docker.version}, daemon reachable` : docker.detail);

  // TDX : périphérique invité, rapport TSM, agent dstack
  const dev = tdxDevice();
  if (dev) add("tdx_guest", true, `${dev} present: Intel TDX VM`);
  else if (mode === "dstack") add("tdx_guest", false, "Not visible here: normal in a dstack CVM, the quote goes through the dstack agent.");
  else if (p === "darwin") add("tdx_guest", false, "No TDX on macOS: optional in demo mode (simulated attestation, testnet only).");
  else add("tdx_guest", false, "No /dev/tdx_guest: this isn't an Intel TDX VM (or the module is missing: sudo modprobe tdx_guest). Optional in demo mode (--demo); for a real attestation: a TDX VM with dstack (Phala Cloud).");

  if (hasTsmReport()) add("tsm_report", true, `${TSM_REPORT_DIR} present (TDX quotes through configfs-tsm)`);
  else if (mode === "dstack") add("tsm_report", false, "Not visible here: normal in a dstack CVM.");
  else if (dev) add("tsm_report", false, `TDX present but ${TSM_REPORT_DIR} missing: sudo mount -t configfs none /sys/kernel/config (kernel 6.7 or later required).`);
  else add("tsm_report", false, "Missing (no TDX): without it, no real attestation, the machine can't register.");

  if (hasDstack()) add("dstack_socket", true, `${DSTACK_SOCKET} present: the enclave will get a real TDX quote through dstack.`);
  else if (mode === "tdx") add("dstack_socket", false, `No dstack agent (${DSTACK_SOCKET}): the current image only gets a real quote through dstack (Phala Cloud); without it, the attestation stays simulated.`);
  else add("dstack_socket", false, "No dstack agent: normal outside a dstack CVM (Phala Cloud). Optional in demo mode.");

  // clock : l'heure du RPC d'Arc (en-tête Date), à défaut celle de l'API
  const skew = rpcP.skewS ?? apiP.skewS ?? null;
  const src = rpcP.skewS != null ? hostOf(rpc) : "the ArcHive API";
  if (skew == null) add("clock", false, "Reference time unreadable (RPC and API unreachable): restore the network, then check the clock (Linux: timedatectl).");
  else if (Math.abs(skew) < CLOCK_MAX_SKEW_S) add("clock", true, `Offset of ${fmtSeconds(skew)} from the time of ${src}`);
  else add("clock", false, `Clock ${skew > 0 ? "ahead" : "behind"} by ${fmtSeconds(skew)} compared to ${src}: sync it (Linux: sudo timedatectl set-ntp true; macOS: Settings › General › Date & Time, set automatically).`);

  // rpc
  let block: number | null = null;
  try {
    block = typeof rpcP.json?.result === "string" ? Number(BigInt(rpcP.json.result)) : null;
  } catch {
    block = null;
  }
  if (rpcP.ok && block !== null) add("rpc", true, `Arc testnet RPC reachable (${hostOf(rpc)}) · block ${fmtInt(block)} · ${rpcP.ms} ms`);
  else {
    const why = rpcP.error ?? (typeof rpcP.json?.error?.message === "string" ? rpcP.json.error.message : "answer without a block number");
    add("rpc", false, `Arc RPC unreachable (${rpc}: ${why}). Check outbound Internet access over HTTPS (port 443)${rpcP.status === 429 ? "; the RPC is rate-limiting, try again in a moment" : ""}.`);
  }

  // api
  if (apiP.ok && apiP.json?.ok === true) add("api", true, `ArcHive API reachable (${o.api} · ${apiP.ms} ms)`);
  else add("api", false, `ArcHive API unreachable (${o.api}/health: ${apiP.error ?? "unexpected answer"}). Check --api or ARCHIVE_API, and that this outbound port is open.`);

  // port : libre, ou déjà le nôtre
  const portLabel = `Enclave port (${o.port})`;
  const ours = !!container && container.hostPort === o.port && (container.running || container.restarting);
  if (ours) add("port", true, `Port ${o.port}: used by the ArcHive enclave (container ${CONTAINER})`, portLabel);
  else if (portState === "free") add("port", true, `Port ${o.port} free`, portLabel);
  else if (portState === "denied") add("port", false, `Port ${o.port} not allowed (ports < 1024 are reserved for root): pick a port ≥ 1024 (--port 8802).`, portLabel);
  else {
    const who = await portOwner(o.port);
    add("port", false, `Port ${o.port} already taken by another program${who ? ` (${who})` : ""}: stop it or pick another port (--port ${o.port + 1}).`, portLabel);
  }

  // enclave_health : GET /health de l'enclave locale
  const healthOk = health.ok && health.json?.ok === true;
  const up = upCommand(mode);
  if (!container) {
    if (healthOk) add("enclave_health", true, `An enclave answers on ${local}/health (outside the ${CONTAINER} container, ${health.ms} ms)`);
    else add("enclave_health", false, `The enclave isn't running: ${up}.`);
  } else if (container.restarting) {
    add("enclave_health", false, `The enclave keeps restarting (${plural(container.restartCount, "restart", "restarts")}): archive-node logs to see the error.`);
  } else if (!container.running && cleanStop(container)) {
    add("enclave_health", false, `The enclave is stopped (normal stop): ${up}.`);
  } else if (!container.running) {
    add("enclave_health", false, `The enclave stopped on an error (exit code ${container.exitCode}${container.oomKilled ? ", out of memory" : ""}): archive-node logs to understand, then ${up}.`);
  } else if (healthOk) {
    add("enclave_health", true, `The enclave answers on ${local}/health (${health.ms} ms)`);
  } else if (container.hostPort && container.hostPort !== o.port) {
    add("enclave_health", false, `The ${CONTAINER} container publishes port ${container.hostPort}, not ${o.port}: run again with --port ${container.hostPort}.`);
  } else {
    add("enclave_health", false, `The container is running but the enclave doesn't answer on 127.0.0.1:${o.port} (${health.error ?? "unexpected answer"}): it may still be starting; otherwise archive-node logs.`);
  }

  // attest : GET /pubkeys → signer + x25519
  const signer = typeof keys.json?.signer === "string" && /^0x[0-9a-fA-F]{40}$/.test(keys.json.signer) ? (keys.json.signer as string) : null;
  const x25519 = typeof keys.json?.x25519 === "string" && /^0x[0-9a-fA-F]{64}$/.test(keys.json.x25519) ? (keys.json.x25519 as string) : null;
  if (signer && x25519) add("attest", true, `signer ${short(signer)} · x25519 ${short(x25519)} · ${quoteLabel(keys.json?.lastQuote)}`);
  else if (!healthOk) add("attest", false, "Enclave keys unavailable: the enclave isn't answering (see “Enclave health”).");
  else add("attest", false, `/pubkeys doesn't return signer + x25519 (${keys.error ?? "fields missing"}): incompatible enclave image? Check --image.`);

  const required: CheckId[] = ["os", "node", "docker", "clock", "rpc", "api", "port"];
  if (mode === "tdx") required.push("tdx_guest", "tsm_report");
  if (mode === "dstack") required.push("dstack_socket");
  // par défaut, l'enclave compte si son conteneur tourne ou s'est arrêté sur une erreur (pas après un arrêt normal)
  if (o.expectEnclave ?? (!!container && !(!container.running && !container.restarting && cleanStop(container)))) {
    required.push("enclave_health", "attest");
  }
  const blocking = checks.filter((c) => !c.ok && required.includes(c.id)).map((c) => c.id);

  return {
    ok: blocking.length === 0,
    mode,
    detected,
    hostname: hostname(),
    version: VERSION,
    at: new Date().toISOString(),
    api: o.api,
    port: o.port,
    checks,
    required,
    blocking,
    facts: { docker, container, healthOk, signer, x25519, block },
  };
}

/** la sortie --json : les vérifications + « required » pour chacune */
export function doctorJson(r: DoctorReport) {
  return {
    ok: r.ok,
    mode: r.mode,
    detectedMode: r.detected,
    hostname: r.hostname,
    version: r.version,
    at: r.at,
    api: r.api,
    port: r.port,
    blocking: r.blocking,
    checks: r.checks.map((c) => ({ ...c, required: r.required.includes(c.id) })),
  };
}

export function printChecks(r: DoctorReport): void {
  const labelW = 26;
  const indent = " ".repeat(4 + labelW + 1);
  // hors terminal (tuyau, journal) : pas de coupure, une vérification par ligne
  const width = isTTY() ? Math.min(columns(), 120) - indent.length : Infinity;
  for (const c of r.checks) {
    const req = r.required.includes(c.id);
    const mark = c.ok ? OK : req ? KO : SKIP;
    const label = pad(c.label, labelW);
    const detail = wrap(c.detail, width, indent);
    out(`  ${mark} ${c.ok ? label : req ? bold(label) : dim(label)} ${c.ok || req ? detail : dim(detail)}`);
  }
}

export function printDoctor(r: DoctorReport, next: string | null): void {
  out(`${bold("archive-node")} ${r.version} · diagnostics for “${r.hostname}”`);
  out(`Mode: ${modeLabel(r.mode)}${r.mode !== r.detected ? dim(" (forced by --demo)") : ""}`);
  out();
  printChecks(r);
  out();
  const green = r.checks.filter((c) => c.ok).length;
  const optional = r.checks.filter((c) => !c.ok && !r.required.includes(c.id)).length;
  if (r.ok) {
    out(`${OK} Nothing blocking: ${green}/${r.checks.length} green${optional ? dim(` (${optional} optional here, marked ·)`) : ""}.`);
  } else {
    out(`${KO} ${plural(r.blocking.length, "blocking issue", "blocking issues")}: fix the ✗ lines, then run archive-node doctor again.`);
  }
  if (next) out(`${ARROW} Next step: ${bold(next)}`);
}
