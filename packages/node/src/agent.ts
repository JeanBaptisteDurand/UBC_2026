/** agent.ts — "archive-node up": starts the enclave in Docker, watches it, and sends its state to the site
 *  (diagnosis, status, logs, public keys, address) every 30 s. Ctrl+C stops it cleanly.
 *  The operator key comes from ~/.archive/node.json (pairing), from a file (--key-file) or from the ARCHIVE_KEY variable;
 *  never from an argument (--key is refused: it would show in the process list and the shell history). */
import { readFileSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { configPath, loadConfig, loadState, normalizeUrl, resolveApi, saveConfig, saveState, tilde, type NodeConfig } from "./config";
import {
  CHAIN_ID, CONTAINER, DEFAULT_IMAGE, DEFAULT_PORT, DEFAULT_RPC, DEFAULT_WEB, ENCLAVE_REGISTRY, HEARTBEAT_MS, HEARTBEAT_STARTING_MS,
  LABEL_OWNER, MAX_LOG_LINES, PRODUCT_DEMO, PRODUCT_TDX, RUN_SPEC, SESSION_PAY, STARTUP_GRACE_MS,
} from "./constants";
import {
  containerLogs, dockerState, formatLogLine, hostDockerArch, imagePlatform, inspectContainer, mergeLogLines, pullError,
  pullImage, runArgs, runError, type LogLine,
} from "./docker";
import { runDoctor, type DoctorReport } from "./doctor";
import { CliError, UsageError, errMsg } from "./errors";
import { lastLine, run } from "./exec";
import { apiError, netError, request, type HttpResult } from "./net";
import { parsePort, parseProduct } from "./args";
import { detectMode, hasDstack, isAgentAlive, modeLabel, primaryIPv4, upCommand, type Mode } from "./system";
import { CLOUDFLARED_HELP, cloudflaredAvailable, startQuickTunnel, type Tunnel } from "./tunnel";
import { KO, OK, WARN, bold, dim, err, flush, hhmmss, keyIdOf, maskKey, out, short } from "./ui";
import { VERSION } from "./version";

export interface UpFlags {
  product?: string;
  port?: string;
  image?: string;
  demo?: boolean;
  /** refused (see KEY_ARG_REFUSED): read only to explain why */
  key?: string;
  /** a file that holds the operator key (arcop_…, alone) */
  keyFile?: string;
  publicUrl?: string;
  tunnel?: boolean;
  api?: string;
}

export interface UpPlan {
  api: string;
  key: string;
  /** the key comes from ~/.archive/node.json (machineId and operator can be stored there) */
  keyFromConfig: boolean;
  /** where the key comes from, for display: ~/.archive/node.json, "--key-file <file>" or "ARCHIVE_KEY" */
  keySource: string | null;
  /** a warning about the key (a file readable by other accounts), or null */
  keyWarning: string | null;
  cfg: NodeConfig | null;
  mode: Mode;
  detected: Mode;
  product: number;
  port: number;
  image: string;
  publicUrl: string | null;
  tunnel: boolean;
}

export const NO_TDX_HELP =
  `No TDX on this machine (neither /dev/tdx_guest nor a dstack agent).\n` +
  `To run it as a demo (simulated attestation, testnet only): ${upCommand("demo")}`;

const KEY_RE = /^arcop_[A-Za-z0-9_-]{8,}$/;

/** --key is refused: a key passed as an argument shows in the process list (ps) and in the shell history. */
export const KEY_ARG_REFUSED =
  "--key is no longer accepted: a key passed as an argument shows in the process list (ps) and in the shell history.\n" +
  "Give it through a file only you can read (chmod 600 <file>, then --key-file <file>) or through the ARCHIVE_KEY " +
  "environment variable; or pair the machine (archive-node pair), which stores it in ~/.archive/node.json.";

export interface SuppliedKey {
  key: string;
  /** "--key-file <file>" or "ARCHIVE_KEY" */
  source: string;
  warning: string | null;
}

/** The key given outside node.json: --key-file <file> (first), otherwise the ARCHIVE_KEY variable; null otherwise.
 *  The file holds the key alone (spaces and a final newline are tolerated); a pipe (--key-file <(pass show …)) works. */
export function suppliedKey(keyFile: string | undefined, env: NodeJS.ProcessEnv = process.env): SuppliedKey | null {
  if (keyFile !== undefined) {
    const path = keyFile.trim();
    if (!path) throw new UsageError("--key-file: file path expected.");
    let raw: string;
    let loose = false;
    try {
      const st = statSync(path);
      if (st.isDirectory()) throw new UsageError(`--key-file: “${path}” is a directory, not a file.`);
      if (st.isFile() && st.size > 4096) throw new UsageError(`--key-file: “${path}” is too big to hold only an operator key.`);
      if (!st.isFile() && !st.isFIFO()) throw new UsageError(`--key-file: “${path}” is neither a file nor a pipe.`);
      loose = st.isFile() && (st.mode & 0o077) !== 0;
      raw = readFileSync(path, "utf8");
    } catch (e) {
      if (e instanceof UsageError) throw e;
      const code = (e as { code?: string }).code;
      const why = code === "ENOENT" ? "file not found" : code === "EACCES" ? "access denied" : errMsg(e);
      throw new UsageError(`--key-file: can't read “${path}” (${why}).`);
    }
    const key = raw.trim();
    if (!KEY_RE.test(key)) throw new UsageError(`--key-file: “${path}” must contain the operator key alone (arcop_…, on one line).`);
    return {
      key, source: `--key-file ${path}`,
      warning: loose ? `The key file ${path} is readable by other accounts on this machine: chmod 600 ${path}` : null,
    };
  }
  const v = env.ARCHIVE_KEY?.trim();
  if (!v) return null;
  if (!KEY_RE.test(v)) throw new UsageError("ARCHIVE_KEY: invalid operator key (expected: arcop_…).");
  return { key: v, source: "ARCHIVE_KEY", warning: null };
}

/** validates the options of "up" (shared with "service install") */
export function planUp(f: UpFlags, opts: { requireKey: boolean }): UpPlan {
  // first the option values (usage errors), then the mode, then the key
  if (f.key !== undefined) throw new UsageError(KEY_ARG_REFUSED);
  const port = parsePort(f.port ?? String(DEFAULT_PORT));
  const image = (f.image ?? DEFAULT_IMAGE).trim();
  if (!image || /\s/.test(image) || image.startsWith("-")) throw new UsageError(`--image: invalid image reference “${f.image}”.`);
  const publicUrl = f.publicUrl ? normalizeUrl(f.publicUrl, "--public-url") : null;
  const detected = detectMode();
  const mode: Mode = f.demo ? "demo" : detected;
  if (mode === "demo" && !f.demo) throw new CliError(NO_TDX_HELP);
  const product = parseProduct(f.product ?? String(mode === "demo" ? PRODUCT_DEMO : PRODUCT_TDX));
  const cfg = loadConfig();
  const supplied = suppliedKey(f.keyFile);
  const key = supplied?.key ?? cfg?.key ?? "";
  if (opts.requireKey && !key) {
    throw new CliError("This machine isn't paired: run archive-node pair first (or give the key with --key-file <file> or the ARCHIVE_KEY variable).");
  }
  const api = resolveApi(f.api, cfg);
  const keyFromConfig = !supplied || supplied.key === cfg?.key;
  return {
    api, key, keyFromConfig,
    keySource: supplied?.source ?? (cfg?.key ? tilde(configPath()) : null),
    keyWarning: supplied?.warning ?? null,
    cfg, mode, detected, product, port, image, publicUrl,
    tunnel: !!f.tunnel && !publicUrl,
  };
}

type Status = "starting" | "running" | "error" | "stopped";
const STATUS_LABEL: Record<Status, string> = { starting: "starting", running: "running", error: "error", stopped: "stopped" };

export class Agent {
  private status: Status = "starting";
  private announced = false;
  private stopping = false;
  private readonly ac = new AbortController();
  private sleepAbort: AbortController | null = null;
  private tickPromise: Promise<void> | null = null;
  private events: LogLine[] = [];
  private once = new Set<string>();
  private lastDoctor: DoctorReport | null = null;
  private tunnel: Tunnel | null = null;
  private tunnelPromise: Promise<void> | null = null;
  private tunnelRetryAt = 0;
  private machineId: string | null;
  private operator: string | null;
  private registered: boolean | null = null;
  private apiState = "";
  private beats = 0;
  private lastBeatAt: number | null = null;
  private lastBeatOk: boolean | null = null;
  private lastError: string | null = null;
  private readonly startedAt = new Date().toISOString();
  private containerStartedAt: number | null = null;
  private readonly ip = primaryIPv4();

  constructor(private readonly p: UpPlan) {
    this.machineId = p.keyFromConfig ? p.cfg?.machineId ?? null : null;
    this.operator = p.keyFromConfig ? p.cfg?.operator ?? null : null;
  }

  async run(): Promise<number> {
    const st = loadState();
    if (st?.pid && (await isAgentAlive(st.pid))) {
      throw new CliError(`An archive-node agent is already running on this machine (pid ${st.pid}).\nStop it first: Ctrl+C in its terminal, or sudo systemctl stop archive-node.`);
    }
    this.printHeader();
    // not SIGHUP: "nohup archive-node up &" must survive the terminal closing
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void this.shutdown(sig));
    process.on("exit", () => {
      try {
        this.tunnel?.child.kill("SIGTERM");
      } catch {
        /* already stopped */
      }
    });
    if (this.p.tunnel) void this.ensureTunnel(); // opens while the container starts
    while (!this.stopping) {
      this.tickPromise = this.tick().catch((e) => this.note("error", `Internal agent error: ${errMsg(e)}`));
      await this.tickPromise;
      if (this.stopping) break;
      await this.sleep(this.status === "starting" ? HEARTBEAT_STARTING_MS : HEARTBEAT_MS);
    }
    return new Promise<number>(() => {
      /* shutdown() ends the process */
    });
  }

  // ---------- one round: enclave, diagnosis, status, logs, heartbeat ----------

  private async tick(): Promise<void> {
    let launchError: string | null = null;
    try {
      await this.ensureEnclave();
    } catch (e) {
      launchError = errMsg(e);
    }
    if (this.stopping) return;
    if (this.p.tunnel) await this.ensureTunnel();
    if (this.stopping) return;
    const report = await runDoctor({ api: this.p.api, port: this.p.port, demo: this.p.mode === "demo", expectEnclave: true, signal: this.ac.signal });
    if (this.stopping) return;
    this.lastDoctor = report;
    const { status, reason } = this.computeStatus(report, launchError);
    this.setStatus(status, reason, report);
    const logs = await this.collectLogs(this.ac.signal);
    if (this.stopping) return;
    await this.heartbeat(status, report, logs, 10_000);
    this.writeState(false);
  }

  private labels(): Record<string, string> {
    return {
      [LABEL_OWNER]: "archive-node",
      "io.archive.spec": RUN_SPEC,
      "io.archive.image": this.p.image,
      "io.archive.product": String(this.p.product),
      "io.archive.port": String(this.p.port),
      "io.archive.mode": this.p.mode,
      // the operator allowed to receive a quote: when the pairing makes it known, the container is replaced
      "io.archive.operator": this.operator ?? "",
    };
  }

  /** Container variables: the stack's contract addresses (the image has no default address valid for the live stack),
   *  the only operator allowed to request a quote (OPERATOR_ALLOWLIST: without it the enclave fails closed) and, when
   *  the agent has it, the upstream model's secret, inherited without appearing on the command line. */
  private containerEnv(): Record<string, string> {
    return {
      CHAIN_ID: String(CHAIN_ID),
      RPC_URL: DEFAULT_RPC,
      REGISTRY: ENCLAVE_REGISTRY,
      SESSIONPAY: SESSION_PAY,
      ...(this.operator ? { OPERATOR_ALLOWLIST: this.operator } : {}),
      ...(process.env.REDPILL_API_KEY ? { REDPILL_API_KEY: "" } : {}),
    };
  }

  /** the container runs with the right configuration (otherwise: it is created, restarted or replaced) */
  private async ensureEnclave(): Promise<void> {
    const sig = this.ac.signal;
    const ds = await dockerState(sig);
    if (!ds.ok) throw new Error(ds.detail);
    const want = this.labels();
    const c = await inspectContainer(CONTAINER, sig);
    if (c && Object.entries(want).every(([k, v]) => c.labels[k] === v)) {
      if (c.running || c.restarting || this.stopping) return;
      this.note("info", `Restarting the ${CONTAINER} container (it was stopped)`);
      const r = await run("docker", ["start", CONTAINER], { timeoutMs: 60_000, signal: sig });
      if (r.code !== 0) {
        if (r.aborted) return;
        throw new Error(runError(r.stderr, this.p.port));
      }
      this.containerStartedAt = Date.now();
      return;
    }

    // the image first: if it cannot be found, the old container stays in place
    let platform = await imagePlatform(this.p.image, sig);
    if (!platform) {
      if (this.stopping) return;
      this.note("info", `Downloading the image ${short(this.p.image, 60, 8)} (the first time: one to a few minutes)…`, "pull");
      // during a long download, the site must keep seeing the machine ("starting")
      const beat = () => void this.collectLogs(sig).then((logs) => this.heartbeat("starting", null, logs, 10_000));
      if (!this.lastBeatAt || Date.now() - this.lastBeatAt > 20_000) beat();
      const keepAlive = setInterval(beat, HEARTBEAT_MS);
      let r = await pullImage(this.p.image, null, sig);
      if (r.code !== 0 && !r.aborted && process.arch !== "x64" && /no matching manifest/i.test(r.stderr)) {
        this.note("info", "x86-64-only image: downloading for linux/amd64 (emulated on this processor)", "pull-amd64");
        r = await pullImage(this.p.image, "linux/amd64", sig);
      }
      clearInterval(keepAlive);
      if (r.code !== 0) {
        if (r.aborted) return;
        throw new Error(pullError(r.stderr, this.p.image));
      }
      platform = await imagePlatform(this.p.image, sig);
      this.note("ok", "Image downloaded");
    }
    if (this.stopping) return;
    if (c) {
      this.note("info", c.labels[LABEL_OWNER] ? `Configuration changed: replacing the ${CONTAINER} container` : `A ${CONTAINER} container already existed (started by hand): it is replaced`);
      const r = await run("docker", ["rm", "-f", CONTAINER], { timeoutMs: 60_000, signal: sig });
      if (r.code !== 0) throw new Error(`Can't remove the old ${CONTAINER} container: ${lastLine(r.stderr)}`);
    }
    if (this.stopping) return;
    const arch = platform?.split("/")[1];
    const r = await run(
      "docker",
      runArgs({
        port: this.p.port, product: this.p.product, image: this.p.image, env: this.containerEnv(),
        platform: platform && arch && arch !== hostDockerArch() ? platform : null,
        dstack: this.p.mode !== "demo" && hasDstack(),
        labels: want,
      }),
      { timeoutMs: 120_000, signal: sig },
    );
    if (r.code !== 0) {
      if (r.aborted) return;
      throw new Error(runError(r.stderr, this.p.port));
    }
    this.containerStartedAt = Date.now();
    this.note("ok", `Enclave started: container ${CONTAINER} (${r.stdout.trim().slice(0, 12)}), port ${this.p.port}, product #${this.p.product}${this.p.mode === "demo" ? ", simulated attestation" : ""}`);
    if (!this.operator) {
      this.note("info", "Operator not known yet: the enclave refuses every quote (OPERATOR_ALLOWLIST) until pairing; the container will be restarted with your address.", "no-operator");
    }
  }

  private computeStatus(report: DoctorReport, launchError: string | null): { status: Status; reason: string } {
    if (launchError) return { status: "error", reason: launchError };
    const c = report.facts.container;
    const health = report.checks.find((x) => x.id === "enclave_health");
    if (!c) return { status: "error", reason: `container ${CONTAINER} not found` };
    if (c.running && health?.ok) return { status: "running", reason: "" };
    if ((c.running || c.state === "created") && !c.restarting) {
      const since = c.startedAt ?? this.containerStartedAt ?? Date.now();
      if (Date.now() - since < STARTUP_GRACE_MS) return { status: "starting", reason: "" };
    }
    return { status: "error", reason: health?.detail ?? `container ${c.state}` };
  }

  private setStatus(s: Status, reason: string, report: DoctorReport): void {
    const changed = s !== this.status || (s === "error" && reason !== this.lastError) || !this.announced;
    this.status = s;
    this.lastError = s === "error" ? reason : null;
    if (!changed) return;
    this.announced = true;
    if (s === "running") {
      const a = report.checks.find((c) => c.id === "attest");
      this.note("ok", `Enclave running on port ${this.p.port}${a?.ok ? ` · ${a.detail}` : ""}`);
    } else if (s === "starting") this.note("info", "The enclave is starting…");
    else if (s === "error") this.note("error", `Enclave error: ${reason}`);
  }

  private async collectLogs(signal?: AbortSignal): Promise<string[]> {
    const container = await containerLogs(CONTAINER, MAX_LOG_LINES, signal);
    return mergeLogLines([container, this.events], MAX_LOG_LINES).map(formatLogLine);
  }

  // ---------- heartbeat ----------

  private async heartbeat(status: Status, report: DoctorReport | null, logs: string[], timeoutMs: number): Promise<boolean> {
    const body = {
      ...(this.machineId ? { machineId: this.machineId } : {}),
      hostname: hostname(),
      version: VERSION,
      mode: this.p.mode,
      productId: this.p.product,
      enclaveUrl: this.enclaveUrl(),
      signer: report?.facts.signer ?? null,
      x25519: report?.facts.x25519 ?? null,
      status,
      ...(report ? { doctor: { ok: report.ok, checks: report.checks.map(({ id, label, ok, detail }) => ({ id, label, ok, detail })) } } : {}),
      logs,
    };
    let r: HttpResult;
    try {
      r = await request(`${this.p.api}/machines/heartbeat`, {
        body,
        headers: { authorization: `Bearer ${this.p.key}` },
        timeoutMs,
        signal: status === "stopped" ? undefined : this.ac.signal,
      });
    } catch (e) {
      if (this.stopping && status !== "stopped") return false;
      this.lastBeatOk = false;
      this.setApi("unreachable", `API unreachable (${netError(e, timeoutMs)}): retrying in 30 s, the enclave keeps running.`);
      return false;
    }
    if (r.ok && r.json?.ok) {
      this.lastBeatOk = true;
      this.lastBeatAt = Date.now();
      this.beats++;
      const mid = typeof r.json.machineId === "string" ? r.json.machineId : null;
      const op = typeof r.json.operator === "string" ? r.json.operator : null;
      if (mid && (mid !== this.machineId || (op && op !== this.operator))) {
        this.machineId = mid;
        this.operator = op ?? this.operator;
        this.persistIdentity();
      }
      this.setApi("ok", "");
      const reg = typeof r.json.next?.registered === "boolean" ? (r.json.next.registered as boolean) : null;
      if (status !== "stopped") {
        if (reg !== null && reg !== this.registered) {
          this.registered = reg;
          if (reg) this.note("ok", "Enclave registered on Arc: it can receive sessions paid in USDC.");
          else this.note("info", `Not registered on Arc yet: on the site, Operator page, click “Register” (wallet signature) → ${this.web()}/#/operator`);
        }
        out(dim(`${hhmmss()} ♥ heartbeat #${this.beats} · ${STATUS_LABEL[status]}`));
      }
      return true;
    }
    this.lastBeatOk = false;
    if (r.status === 401 || r.status === 403) {
      this.setApi("unauthorized", `The API refuses the operator key (${apiError(r)}): pair again with archive-node pair --force. The enclave keeps running.`);
    } else if (r.status === 404) {
      this.setApi("missing", `This API doesn't accept heartbeats yet (POST /machines/heartbeat → 404): check --api.`);
    } else {
      this.setApi(`http-${r.status}`, `The API refused the heartbeat (${apiError(r)}).`);
    }
    return false;
  }

  private setApi(state: string, message: string): void {
    if (state === this.apiState) return;
    const first = this.apiState === "";
    this.apiState = state;
    if (state === "ok") {
      if (first) this.note("ok", `Linked to the site: machine ${short(this.machineId, 8, 4)} · account ${short(this.operator)}`);
      else this.note("ok", "Link with the API restored");
      return;
    }
    this.note(state === "unreachable" ? "warn" : "error", message);
  }

  /** stores machineId/operator in node.json, if the key comes from there and has not changed in between */
  private persistIdentity(): void {
    if (!this.p.keyFromConfig) return;
    try {
      const cur = loadConfig();
      if (cur && cur.key === this.p.key) saveConfig({ ...cur, machineId: this.machineId, operator: this.operator });
    } catch {
      /* it is only a cache */
    }
  }

  // ---------- public address ----------

  private fallbackUrl(): string {
    return `http://${this.ip?.address ?? "127.0.0.1"}:${this.p.port}`;
  }

  private enclaveUrl(): string {
    if (this.p.publicUrl) return this.p.publicUrl;
    if (this.tunnel?.alive && this.tunnel.url) return this.tunnel.url;
    return this.fallbackUrl();
  }

  private web(): string {
    return (this.p.keyFromConfig ? this.p.cfg?.web : null) ?? DEFAULT_WEB;
  }

  private ensureTunnel(): Promise<void> {
    if (this.stopping || this.tunnel?.alive) return Promise.resolve();
    if (this.tunnelPromise) return this.tunnelPromise;
    if (Date.now() < this.tunnelRetryAt) return Promise.resolve();
    this.tunnelPromise = (async () => {
      if (!(await cloudflaredAvailable())) {
        this.note("warn", `cloudflared isn't installed, so no tunnel: ${CLOUDFLARED_HELP}. Address announced meanwhile: ${this.fallbackUrl()}`, "no-cloudflared");
        this.tunnelRetryAt = Date.now() + 5 * 60_000;
        return;
      }
      try {
        const t = await startQuickTunnel(this.p.port, (code) => {
          if (!this.stopping) this.note("warn", `The cloudflared tunnel stopped (code ${code}): reopening at the next heartbeat, with a new address.`);
        });
        if (this.stopping) {
          await t.stop();
          return;
        }
        this.tunnel = t;
        this.note("ok", `Public address (cloudflared tunnel): ${t.url}`);
      } catch (e) {
        this.tunnelRetryAt = Date.now() + 60_000;
        this.note("warn", `cloudflared tunnel failed: ${errMsg(e)}. Address announced meanwhile: ${this.fallbackUrl()}`);
      }
    })().finally(() => {
      this.tunnelPromise = null;
    });
    return this.tunnelPromise;
  }

  // ---------- display, local state, shutdown ----------

  private note(level: "ok" | "info" | "warn" | "error", text: string, onceKey?: string): void {
    if (onceKey) {
      if (this.once.has(onceKey)) return;
      this.once.add(onceKey);
    }
    const sym = level === "ok" ? OK : level === "error" ? KO : level === "warn" ? WARN : dim("·");
    out(`${dim(hhmmss())} ${sym} ${text}`);
    this.events.push({ ts: Date.now(), frac: 0, text: `[archive-node] ${text}` });
    if (this.events.length > 40) this.events.shift();
  }

  private printHeader(): void {
    const p = this.p;
    const kid = keyIdOf(p.key);
    out(`${bold("archive-node")} ${VERSION} · “${hostname()}” joins the ArcHive hive`);
    out(`  Mode      ${modeLabel(p.mode)}${p.mode !== p.detected ? dim(" (forced by --demo)") : ""}`);
    out(`  Product   #${p.product} · port ${p.port}${p.mode === "demo" ? ` ${WARN} no TDX: local trial, this machine can't register (a simulated attestation proves nothing)` : ""}`);
    out(`  Image     ${p.image}`);
    out(`  API       ${p.api} · key ${maskKey(p.key)}${kid ? ` (#${kid})` : ""}${p.keySource ? dim(` · ${p.keySource}`) : ""}`);
    if (p.keyWarning) out(`  ${WARN} ${p.keyWarning}`);
    if (p.keyFromConfig && p.cfg?.api && p.cfg.api !== p.api) {
      out(`  ${WARN} The key was issued by ${p.cfg.api} but will be sent to ${p.api}.`);
    }
    if (p.publicUrl) out(`  Address   ${p.publicUrl}`);
    else if (p.tunnel) out(`  Address   cloudflared tunnel (opening…)`);
    else {
      out(`  Address   ${this.fallbackUrl()}`);
      if (!this.ip || this.ip.isPrivate) {
        out(`  ${WARN} ${this.ip ? "Private" : "Local"} address: the site probably can't reach the enclave. Add --tunnel or --public-url https://…`);
      }
    }
    out(dim("  Ctrl+C stops the enclave and tells the site."));
    out();
  }

  private writeState(stopped: boolean): void {
    saveState({
      pid: stopped ? null : process.pid,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      mode: this.p.mode,
      productId: this.p.product,
      port: this.p.port,
      image: this.p.image,
      api: this.p.api,
      machineId: this.machineId,
      operator: this.operator,
      status: stopped ? "stopped" : this.status,
      enclaveUrl: this.enclaveUrl(),
      registered: this.registered,
      lastHeartbeatAt: this.lastBeatAt ? new Date(this.lastBeatAt).toISOString() : null,
      lastHeartbeatOk: this.lastBeatOk,
      lastError: this.lastError,
    });
  }

  private sleep(ms: number): Promise<void> {
    const ctl = new AbortController();
    this.sleepAbort = ctl;
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      ctl.signal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
  }

  private async shutdown(sig: string): Promise<void> {
    if (this.stopping) {
      err(`\n${KO} Forced stop.`);
      process.exit(130);
    }
    this.stopping = true;
    out();
    this.note("info", `Stop requested (${sig}): stopping the enclave and sending a last heartbeat…`);
    this.ac.abort();
    this.sleepAbort?.abort();
    await Promise.race([this.tickPromise ?? Promise.resolve(), new Promise((r) => setTimeout(r, 10_000))]);
    await this.tunnel?.stop().catch(() => undefined);
    const r = await run("docker", ["stop", "-t", "10", CONTAINER], { timeoutMs: 30_000 });
    if (r.code === 0) this.note("ok", `Enclave stopped (container ${CONTAINER} stopped; archive-node up restarts it)`);
    const ok = await this.heartbeat("stopped", this.lastDoctor, await this.collectLogs(), 5_000);
    this.note(ok ? "ok" : "warn", ok ? "Site notified: machine stopped." : "The site couldn't be notified: it will see the machine offline within 90 s.");
    this.status = "stopped";
    this.writeState(true);
    await flush();
    process.exit(0);
  }
}

export async function runUp(f: UpFlags): Promise<number> {
  return new Agent(planUp(f, { requireKey: true })).run();
}
