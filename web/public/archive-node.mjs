#!/usr/bin/env node
import { createRequire as _cr } from 'module'; const require = _cr(import.meta.url);

// src/agent.ts
import { readFileSync as readFileSync3, statSync as statSync2 } from "node:fs";
import { hostname as hostname2 } from "node:os";

// src/config.ts
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

// src/constants.ts
var DEFAULT_API = "https://archive.62-171-153-35.sslip.io/api";
var DEFAULT_WEB = "https://archive.62-171-153-35.sslip.io";
var DEFAULT_RPC = "https://rpc.testnet.arc.io";
var DEFAULT_PORT = 8802;
var ENCLAVE_INNER_PORT = 8802;
var CONTAINER = "archive-enclave";
var DEFAULT_IMAGE = "ghcr.io/jeanbaptistedurand/archive-sealed-chat@sha256:5699da226fb3f1e0f09234c8f9330b5a5414eb8d5bc619854953d10dbe7edc3f";
var PRODUCT_TDX = 1;
var PRODUCT_DEMO = 1;
var CHAIN_ID = 5042002;
var ENCLAVE_REGISTRY = "0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d";
var SESSION_PAY = "0x8Bf8A8356f53006E9aB359AA6382f783923058a6";
var HEARTBEAT_MS = 3e4;
var HEARTBEAT_STARTING_MS = 5e3;
var STARTUP_GRACE_MS = 12e4;
var MAX_LOG_LINES = 100;
var CLOCK_MAX_SKEW_S = 30;
var DSTACK_SOCKET = "/var/run/dstack.sock";
var TDX_DEVICES = ["/dev/tdx_guest", "/dev/tdx-guest"];
var TSM_REPORT_DIR = "/sys/kernel/config/tsm/report";
var LABEL_OWNER = "io.archive.owner";
var RUN_SPEC = "3";

// src/errors.ts
var CliError = class extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
};
var UsageError = class extends CliError {
  constructor(message) {
    super(message, 2);
  }
};
var errMsg = (e) => e instanceof Error ? e.message : String(e);

// src/config.ts
var archiveDir = () => process.env.ARCHIVE_HOME?.trim() || join(homedir(), ".archive");
var configPath = () => join(archiveDir(), "node.json");
var statePath = () => join(archiveDir(), "state.json");
function writePrivateFile(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 448 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 384 });
  chmodSync(tmp, 384);
  renameSync(tmp, path);
}
var writePrivateJson = (path, data) => writePrivateFile(path, JSON.stringify(data, null, 2) + "\n");
function loadConfig() {
  const p = configPath();
  if (!existsSync(p)) return null;
  let c = null;
  try {
    c = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    c = null;
  }
  if (!c || typeof c.key !== "string" || !c.key) {
    throw new CliError(`The file ${p} is unreadable: delete it, then pair again with archive-node pair.`);
  }
  try {
    if ((statSync(p).mode & 63) !== 0) chmodSync(p, 384);
  } catch {
  }
  return c;
}
function saveConfig(c) {
  writePrivateJson(configPath(), c);
}
function loadState() {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return null;
  }
}
function saveState(s) {
  try {
    writePrivateJson(statePath(), s);
  } catch {
  }
}
function normalizeUrl(raw, what) {
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UsageError(`${what}: invalid address \u201C${raw}\u201D (expected: http(s)://host:port).`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UsageError(`${what}: only http:// or https:// addresses are accepted (\u201C${raw}\u201D).`);
  }
  return u.toString().replace(/\/+$/, "");
}
function resolveApi(flag, cfg) {
  const raw = flag ?? (process.env.ARCHIVE_API?.trim() || void 0) ?? cfg?.api ?? DEFAULT_API;
  return normalizeUrl(raw, flag ? "--api" : process.env.ARCHIVE_API ? "ARCHIVE_API" : "API");
}
function tilde(p) {
  const h = homedir();
  return h && p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
}

// src/exec.ts
import { execFile } from "node:child_process";
function run(cmd, args, opts = {}) {
  return new Promise((resolve2) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 2e4, maxBuffer: 32 * 1024 * 1024, encoding: "utf8", signal: opts.signal, windowsHide: true },
      (error, stdout, stderr) => {
        const so = String(stdout ?? "");
        const se = String(stderr ?? "");
        if (!error) return resolve2({ code: 0, stdout: so, stderr: se });
        const e = error;
        if (e.name === "AbortError") return resolve2({ code: null, stdout: so, stderr: se, aborted: true });
        if (typeof e.code === "string") return resolve2({ code: null, stdout: so, stderr: se || e.message, missing: e.code === "ENOENT" });
        resolve2({ code: typeof e.code === "number" ? e.code : null, stdout: so, stderr: se, timedOut: !!e.killed && !!e.signal });
      }
    );
  });
}
function lastLine(s) {
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? "").replace(/^(Error response from daemon|docker): /i, "").slice(0, 240);
}

// src/ui.ts
import { createInterface } from "node:readline";
var COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
var paint = (open, close) => (t) => COLOR ? `\x1B[${open}m${t}\x1B[${close}m` : t;
var bold = paint(1, 22);
var dim = paint(2, 22);
var red = paint(31, 39);
var green = paint(32, 39);
var yellow = paint(33, 39);
var cyan = paint(36, 39);
var isTTY = () => !!process.stdout.isTTY;
var columns = () => process.stdout.columns || 100;
var OK = green("\u2713");
var KO = red("\u2717");
var SKIP = dim("\xB7");
var WARN = yellow("!");
var ARROW = cyan("\u2192");
function out(line = "") {
  process.stdout.write(line + "\n");
}
function err(line = "") {
  process.stderr.write(line + "\n");
}
function flush() {
  return new Promise((resolve2) => process.stdout.write("", () => resolve2()));
}
var stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
function pad(s, n) {
  const len = [...stripAnsi(s)].length;
  return len >= n ? s : s + " ".repeat(n - len);
}
var GLUE_AFTER = /* @__PURE__ */ new Set(["archive-node", "sudo", "docker", "systemctl", "curl", "brew", "mount", "modprobe", "timedatectl", "usermod", "launchctl", "nvm", "\xAB", "|"]);
var unquote = (w) => w.replace(/^[“"«]/, "");
function wrap(text, width, indent) {
  if (!Number.isFinite(width) || width < 20) return text;
  const chunks = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const prev = chunks[chunks.length - 1];
    const prevWord = prev?.split(" ").pop() ?? "";
    const glue = prev !== void 0 && (/^[-|»”]/.test(w) || GLUE_AFTER.has(unquote(prevWord)) || /^-/.test(prevWord) && !/[.;,:)”]$/.test(prevWord));
    if (glue) chunks[chunks.length - 1] = `${prev} ${w}`;
    else chunks.push(w);
  }
  const lines = [];
  let cur = "";
  for (const c of chunks) {
    if (cur && cur.length + 1 + c.length > width) {
      lines.push(cur);
      cur = c;
    } else cur = cur ? `${cur} ${c}` : c;
  }
  if (cur) lines.push(cur);
  return lines.join("\n" + indent);
}
var plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
function short(h, head = 6, tail = 4) {
  if (!h) return "\u2014";
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}\u2026${h.slice(-tail)}`;
}
function maskKey(key) {
  const m = /^arcop_(.+)$/.exec(key);
  if (!m) return key.length > 10 ? `${key.slice(0, 2)}\u2026${key.slice(-2)}` : "\u2026";
  const rest = m[1];
  if (rest.length < 12) return "arcop_\u2026";
  return `arcop_${rest.slice(0, 4)}\u2026${rest.slice(-4)}`;
}
function keyIdOf(key) {
  return /^arcop_([0-9a-f]{8})_/.exec(key)?.[1] ?? null;
}
function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1e3));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}
var hhmmss = (d = /* @__PURE__ */ new Date()) => d.toTimeString().slice(0, 8);
var fmtInt = (n) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
var fmtSeconds = (s) => {
  const a = Math.abs(s);
  return `${a < 10 ? a.toFixed(1) : Math.round(a)} s`;
};
function parseYesNo(line) {
  return /^(y|yes|o|oui)$/i.test(line.trim()) ? "yes" : "no";
}
function rawMode(input, on) {
  try {
    input.setRawMode?.(on);
  } catch {
  }
}
var TYPEAHEAD_QUIET_MS = 60;
var TYPEAHEAD_MAX_MS = 1e3;
function discardTypeAhead(input, signal) {
  return new Promise((resolve2) => {
    let bytes = 0;
    let cancel = false;
    let over = false;
    let quiet;
    const end = () => {
      if (over) return;
      over = true;
      clearTimeout(quiet);
      clearTimeout(cap);
      input.removeListener("data", onData);
      signal?.removeEventListener("abort", onAbort);
      resolve2({ cancel, bytes });
    };
    const onData = (chunk) => {
      const s = typeof chunk === "string" ? chunk : chunk.toString("latin1");
      bytes += s.length;
      if (s.includes("")) {
        cancel = true;
        return end();
      }
      clearTimeout(quiet);
      quiet = setTimeout(end, TYPEAHEAD_QUIET_MS);
    };
    const onAbort = () => {
      cancel = true;
      end();
    };
    const cap = setTimeout(end, TYPEAHEAD_MAX_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    rawMode(input, true);
    input.on("data", onData);
    input.resume();
    quiet = setTimeout(end, TYPEAHEAD_QUIET_MS);
  });
}
async function askYesNo(question, signal) {
  if (signal?.aborted) return "cancel";
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") return "notty";
  const purged = await discardTypeAhead(input, signal);
  const terminal = !!process.stdout.isTTY;
  if (purged.cancel || signal?.aborted) {
    rawMode(input, false);
    input.pause();
    process.stdout.write("\n");
    return "cancel";
  }
  if (!terminal) rawMode(input, false);
  if (purged.bytes > 0) process.stdout.write(dim("  (anything typed before this question is ignored: answer now)") + "\n");
  return new Promise((resolve2) => {
    const rl = createInterface({ input, output: process.stdout, terminal });
    let done = false;
    const finish = (a, newline) => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", onAbort);
      if (newline) process.stdout.write("\n");
      rl.close();
      rawMode(input, false);
      input.pause();
      resolve2(a);
    };
    const onAbort = () => finish("cancel", true);
    signal?.addEventListener("abort", onAbort, { once: true });
    rl.on("SIGINT", () => finish("cancel", true));
    rl.on("close", () => finish("eof", true));
    rl.question(question, (line) => {
      finish(parseYesNo(line), false);
    });
  });
}
var FONT = {
  A: ".###.|#...#|#####|#...#|#...#",
  B: "####.|#...#|####.|#...#|####.",
  C: ".####|#....|#....|#....|.####",
  D: "####.|#...#|#...#|#...#|####.",
  E: "#####|#....|####.|#....|#####",
  F: "#####|#....|####.|#....|#....",
  G: ".####|#....|#..##|#...#|.####",
  H: "#...#|#...#|#####|#...#|#...#",
  I: "###|.#.|.#.|.#.|###",
  J: "#####|...#.|...#.|#..#.|.##..",
  K: "#...#|#..#.|###..|#..#.|#...#",
  L: "#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#...#|#...#",
  N: "#...#|##..#|#.#.#|#..##|#...#",
  O: ".###.|#...#|#...#|#...#|.###.",
  P: "####.|#...#|####.|#....|#....",
  Q: ".###.|#...#|#.#.#|#..#.|.##.#",
  R: "####.|#...#|####.|#..#.|#...#",
  S: ".####|#....|.###.|....#|####.",
  T: "#####|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|.#.#.|..#..",
  W: "#...#|#...#|#.#.#|##.##|#...#",
  X: "#...#|.#.#.|..#..|.#.#.|#...#",
  Y: "#...#|.#.#.|..#..|..#..|..#..",
  Z: "#####|...#.|..#..|.#...|#####",
  "0": ".###.|#..##|#.#.#|##..#|.###.",
  "1": "..#..|.##..|..#..|..#..|.###.",
  "2": ".###.|#...#|..##.|.#...|#####",
  "3": "####.|....#|.###.|....#|####.",
  "4": "#...#|#...#|#####|....#|....#",
  "5": "#####|#....|####.|....#|####.",
  "6": ".###.|#....|####.|#...#|.###.",
  "7": "#####|....#|...#.|..#..|..#..",
  "8": ".###.|#...#|.###.|#...#|.###.",
  "9": ".###.|#...#|.####|....#|.###.",
  "-": "...|...|###|...|..."
};
function glyphsOf(text) {
  const out2 = [];
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch];
    if (!g) return null;
    out2.push(g.split("|"));
  }
  return out2;
}
function bigText(text) {
  const gs = glyphsOf(text);
  if (!gs) return null;
  return [0, 1, 2, 3, 4].map((i) => gs.map((g) => g[i].replace(/#/g, "\u2588").replace(/\./g, " ")).join(" ").trimEnd());
}
function bigWidth(text) {
  const gs = glyphsOf(text);
  return gs ? gs.reduce((n, g) => n + g[0].length, 0) + Math.max(0, gs.length - 1) : null;
}
function codeBanner(code, cols) {
  const tries = [[code, false]];
  if (/^HIVE-./i.test(code)) tries.push([code.slice(5), true]);
  for (const [text, short2] of tries) {
    const w = bigWidth(text);
    const rows = bigText(text);
    if (rows && w !== null && 2 + w < cols) return { rows: rows.map((r) => `  ${r}`), short: short2 };
  }
  return null;
}

// src/docker.ts
async function dockerState(signal) {
  const r = await run("docker", ["version", "--format", "{{.Server.Version}}"], { timeoutMs: 12e3, signal });
  if (r.missing) {
    return { ok: false, kind: "missing", detail: "Docker isn't installed. Linux: curl -fsSL https://get.docker.com | sh; macOS: Docker Desktop (or OrbStack, Colima)." };
  }
  if (r.timedOut) return { ok: false, kind: "timeout", detail: "Docker isn't answering (over 12 s): restart Docker, then try again." };
  const v2 = r.stdout.trim();
  if (r.code === 0 && v2) return { ok: true, version: v2 };
  const e = r.stderr;
  if (/permission denied/i.test(e)) {
    return { ok: false, kind: "permission", detail: "Docker is installed but your user can't reach the daemon: sudo usermod -aG docker $USER, then log in again (or run with sudo)." };
  }
  if (/cannot connect|is the docker daemon running|error during connect|daemon is not running|no such file or directory/i.test(e)) {
    return { ok: false, kind: "daemon", detail: "Docker is installed but the daemon isn't running: start Docker Desktop (macOS) or sudo systemctl start docker (Linux)." };
  }
  return { ok: false, kind: "other", detail: `Docker answers badly: ${lastLine(e) || `code ${r.code}`}` };
}
var when = (iso) => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) && t > 0 ? t : null;
};
async function inspectContainer(name = CONTAINER, signal) {
  const r = await run("docker", ["container", "inspect", name, "--format", "{{json .}}"], { timeoutMs: 12e3, signal });
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
      labels: j.Config?.Labels ?? {},
      hostPort: binding ? Number(binding) : null
    };
  } catch {
    return null;
  }
}
async function imagePlatform(image, signal) {
  const r = await run("docker", ["image", "inspect", image, "--format", "{{.Os}}/{{.Architecture}}"], { timeoutMs: 12e3, signal });
  if (r.code !== 0) return null;
  return r.stdout.trim().split("\n")[0] || "linux/amd64";
}
function pullImage(image, platform4, signal) {
  return run("docker", ["pull", ...platform4 ? ["--platform", platform4] : [], image], { timeoutMs: 20 * 6e4, signal });
}
var PRIVATE_IMAGE_HELP = "The enclave image is hosted in a private registry: log Docker in with an access token from the ArcHive team (docker login ghcr.io -u <user>), or build the image from enclave/Dockerfile (docker build -t archive-sealed-chat:local enclave/) and run again with --image archive-sealed-chat:local (the network registers an enclave only if its image measurement is one the product allows).";
function pullError(stderr, image) {
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
function runError(stderr, port) {
  if (/port is already allocated|address already in use|bind for/i.test(stderr)) {
    return `Port ${port} is already in use on this machine: free it or run again with --port ${port + 1}.`;
  }
  if (/is already in use by container|conflict/i.test(stderr)) {
    return `Another container is already named ${CONTAINER}: docker rm -f ${CONTAINER}, then run again.`;
  }
  if (/dstack\.sock/i.test(stderr)) return `Can't mount ${DSTACK_SOCKET}: ${lastLine(stderr)}.`;
  return `Docker couldn't start the enclave: ${lastLine(stderr) || "unknown error"}.`;
}
function runArgs(s) {
  return [
    "run",
    "-d",
    "--init",
    "--name",
    CONTAINER,
    "--restart",
    "unless-stopped",
    "-p",
    `${s.port}:${ENCLAVE_INNER_PORT}`,
    "-e",
    `PRODUCT_ID=${s.product}`,
    ...Object.entries(s.env ?? {}).flatMap(([k, v2]) => ["-e", v2 === "" ? k : `${k}=${v2}`]),
    ...s.dstack ? ["-v", `${DSTACK_SOCKET}:${DSTACK_SOCKET}`] : [],
    ...Object.entries(s.labels).flatMap(([k, v2]) => ["--label", `${k}=${v2}`]),
    ...s.platform ? ["--platform", s.platform] : [],
    s.image
  ];
}
var hostDockerArch = () => ({ x64: "amd64", arm64: "arm64", arm: "arm", ia32: "386" })[process.arch] ?? process.arch;
var TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})\s?(.*)$/;
function parseLogLines(chunk) {
  const outLines = [];
  let prev = { ts: 0, frac: 0 };
  for (const raw of chunk.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = TS_RE.exec(raw);
    if (!m) {
      outLines.push({ ...prev, text: stripAnsi(raw) });
      continue;
    }
    prev = { ts: Date.parse(m[1] + m[3]), frac: Number(((m[2] ?? "") + "000000000").slice(0, 9)) };
    outLines.push({ ...prev, text: stripAnsi(m[4] ?? "") });
  }
  return outLines;
}
async function containerLogs(name, tail, signal) {
  const r = await run("docker", ["logs", "--timestamps", "--tail", String(tail), name], { timeoutMs: 12e3, signal });
  if (r.code !== 0) return [];
  return mergeLogLines([parseLogLines(r.stdout), parseLogLines(r.stderr)], tail);
}
function mergeLogLines(groups, max) {
  const all = groups.flat().map((l, i) => ({ l, i }));
  all.sort((a, b) => a.l.ts - b.l.ts || a.l.frac - b.l.frac || a.i - b.i);
  return all.slice(-max).map((x) => x.l);
}
function formatLogLine(l) {
  const stamp = l.ts > 0 ? new Date(l.ts).toISOString().slice(0, 19) + "Z " : "";
  return (stamp + l.text).slice(0, 400);
}

// src/doctor.ts
import { hostname, platform as platform2 } from "node:os";

// src/version.ts
var VERSION = true ? "0.1.0" : "0.1.0-dev";

// src/net.ts
function deadline(ms, signal) {
  const t = AbortSignal.timeout(ms);
  const any = AbortSignal.any;
  return signal && any ? any([t, signal]) : t;
}
async function request(url, init = {}) {
  const t0 = Date.now();
  const hasBody = init.body !== void 0;
  const res = await fetch(url, {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers: {
      "user-agent": `archive-node/${VERSION}`,
      accept: "application/json",
      ...hasBody ? { "content-type": "application/json" } : {},
      ...init.headers
    },
    body: hasBody ? JSON.stringify(init.body) : void 0,
    signal: deadline(init.timeoutMs ?? 1e4, init.signal)
  });
  const text = await res.text();
  const t1 = Date.now();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const date = Date.parse(res.headers.get("date") ?? "");
  const skewS = Number.isFinite(date) ? ((t0 + t1) / 2 - (date + 500)) / 1e3 : null;
  return { status: res.status, ok: res.ok, json, text, headers: res.headers, ms: t1 - t0, skewS };
}
function netError(e, timeoutMs = 1e4) {
  const x = e;
  if (x?.name === "TimeoutError") return `no answer within ${Math.round(timeoutMs / 1e3)} s`;
  if (x?.name === "AbortError") return "request cancelled";
  if (/bad port/i.test(x?.cause?.message ?? x?.message ?? "")) return "port refused by the HTTP client (reserved port: pick another one)";
  switch (x?.cause?.code ?? x?.code) {
    case "ECONNREFUSED":
      return "connection refused (nothing is listening at this address)";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "host name not found (DNS)";
    case "ECONNRESET":
    case "UND_ERR_SOCKET":
      return "connection closed by the server";
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return "connection timed out (firewall?)";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "network unreachable";
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "TLS certificate refused (wrong clock or proxy?)";
  }
  return String(x?.cause?.message ?? x?.message ?? e);
}
var v = (p, k, dflt = "?") => p[k] === void 0 || p[k] === null ? dflt : String(p[k]);
var SCOPE_EN = {
  signatures: "signatures",
  signed_reads: "signed reads",
  nonce_requests: "nonce requests",
  code_requests: "code requests",
  code_lookups: "code lookups",
  pairing_polls: "pairing polls",
  pairing_refusals: "pairing refusals",
  key_reads: "key reads",
  heartbeats: "heartbeats",
  key_heartbeats: "heartbeats for this key",
  account_signatures: "signatures for this account",
  account_reads: "signed reads for this account",
  account_new_reads: "new signed reads for this account",
  invalid_signatures: "invalid signatures"
};
var API_EN = {
  rate_limited: (p) => `too many requests (${SCOPE_EN[v(p, "scope")] ?? v(p, "scope")}): try again in ${v(p, "retryAfter")} s`,
  pairings_full: () => "too many pairings in progress: try again in a few minutes",
  pairings_per_ip: (p) => `already ${v(p, "max")} pairings in progress from this address: finish one or wait for it to expire (${v(p, "minutes", "15")} min)`,
  pairings_per_network: (p) => `already ${v(p, "max")} pairings in progress from this network: finish one or wait for it to expire (${v(p, "minutes", "15")} min)`,
  no_free_code: () => "no free code: try again",
  invalid_enum: (p) => `invalid ${v(p, "field")}: expected ${v(p, "allowed")}`,
  invalid_hex: (p) => `invalid ${v(p, "field")}: expected 0x followed by ${v(p, "length")} hex characters`,
  invalid_product_id: () => "invalid productId: an integer of 10 digits at most",
  invalid_enclave_url: (p) => `invalid enclaveUrl: an http(s) address of ${v(p, "max", "200")} characters at most`,
  unreadable_enclave_url: () => "invalid enclaveUrl: unreadable address",
  enclave_url_scheme: () => "invalid enclaveUrl: http:// or https://, without credentials",
  invalid_doctor: () => "invalid doctor: expected { checks: [...] }",
  invalid_logs: () => "invalid logs: expected an array of lines",
  body_too_large: (p) => `request body too large (${v(p, "maxKiB", "64")} KiB at most)`,
  device_code_unknown: () => "unknown pairing request (deviceCode)",
  not_a_machine_key: () => "only the key of a machine paired by code can refuse its pairing",
  key_missing: () => "operator key missing or malformed (expected: Authorization: Bearer arcop_\u2026)",
  key_unknown_or_revoked: () => "unknown or revoked operator key",
  key_invalid: () => "invalid operator key",
  key_forbidden: () => "this key doesn't give access to this machine",
  machine_unknown_for_key: () => "unknown machine for this key: pair again (archive-node pair --force)",
  machine_unknown: () => "unknown machine",
  machine_limit: (p) => `limit of ${v(p, "max")} machines per operator reached: remove one on the Operator page`,
  network_full_machines: () => "the network isn't accepting new machines right now: try again later",
  internal_error: () => "internal error of the operator API",
  server_error: () => "the API failed to answer (server error)"
};
function apiMessage(r) {
  const code = typeof r.json?.code === "string" ? r.json.code : null;
  const params = r.json?.params && typeof r.json.params === "object" ? r.json.params : {};
  const en = code && Object.prototype.hasOwnProperty.call(API_EN, code) ? API_EN[code](params) : null;
  if (en) return en;
  return typeof r.json?.error === "string" ? r.json.error : r.text.replace(/\s+/g, " ").trim().slice(0, 160);
}
function apiError(r) {
  const m = apiMessage(r);
  return `HTTP ${r.status}${m ? `: ${m}` : ""}`;
}
var hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// src/system.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { arch, networkInterfaces, platform, release } from "node:os";
import net from "node:net";
var tdxDevice = () => TDX_DEVICES.find((p) => existsSync2(p)) ?? null;
var hasTsmReport = () => existsSync2(TSM_REPORT_DIR);
var hasDstack = () => existsSync2(DSTACK_SOCKET);
function detectMode() {
  if (hasDstack()) return "dstack";
  if (tdxDevice()) return "tdx";
  return "demo";
}
function modeLabel(m) {
  if (m === "dstack") return "dstack (Intel TDX VM, real quote through the dstack agent)";
  if (m === "tdx") return "TDX (Intel TDX VM)";
  return "no-TDX (local trial only: a simulated attestation can't register)";
}
var upCommand = (m) => m === "demo" ? `archive-node up --demo   (local trial; to serve the network, rent an Intel TDX VM: Phala Cloud from $0.06/h)` : `archive-node up --product ${PRODUCT_TDX} --tunnel`;
async function osDescription() {
  const p = platform();
  if (p === "linux") {
    let pretty = "Linux";
    try {
      pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(readFileSync2("/etc/os-release", "utf8"))?.[1] ?? pretty;
    } catch {
    }
    return `${pretty} \xB7 kernel ${release()} \xB7 ${arch()}`;
  }
  if (p === "darwin") {
    const r = await run("sw_vers", ["-productVersion"], { timeoutMs: 3e3 });
    return `macOS ${r.code === 0 ? r.stdout.trim() : `(Darwin ${release()})`} (${arch()})`;
  }
  return `${p} ${release()} (${arch()})`;
}
function isPrivateIPv4(ip) {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254;
}
var VIRTUAL_IFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|cni|flannel|kube|cali|weave|tun|tap|utun|wg|tailscale|zt|lo|bridge|awdl|llw|anpi|gif|stf)/i;
function primaryIPv4() {
  const cands = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_IFACE.test(iface)) continue;
    for (const a of addrs ?? []) {
      const fam = String(a.family);
      if (fam !== "IPv4" && fam !== "4" || a.internal) continue;
      cands.push({ address: a.address, iface, isPrivate: isPrivateIPv4(a.address) });
    }
  }
  return cands.find((c) => !c.isPrivate) ?? cands[0] ?? null;
}
async function probePort(port) {
  if (await canConnect(port)) return "busy";
  return tryListen(port);
}
function canConnect(port, timeoutMs = 800) {
  return new Promise((resolve2) => {
    const s = net.connect({ host: "127.0.0.1", port });
    const done = (v2) => {
      s.destroy();
      resolve2(v2);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}
function tryListen(port) {
  return new Promise((resolve2) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", (e) => resolve2(e.code === "EACCES" ? "denied" : "busy"));
    srv.listen({ port, host: "0.0.0.0", exclusive: true }, () => srv.close(() => resolve2("free")));
  });
}
async function portOwner(port) {
  const r = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { timeoutMs: 4e3 });
  if (r.code !== 0) return null;
  const pid = /^p(\d+)/m.exec(r.stdout)?.[1];
  const cmd = /^c(.+)$/m.exec(r.stdout)?.[1];
  return pid ? `${cmd ?? "?"}, pid ${pid}` : null;
}
async function isAgentAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code !== "EPERM") return false;
  }
  const r = await run("ps", ["-p", String(pid), "-o", "command="], { timeoutMs: 3e3 });
  return r.code === 0 && /archive-node/.test(r.stdout);
}

// src/doctor.ts
var LABELS = {
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
  attest: "Attestation keys"
};
var clip = (s, n = 300) => s.length <= n ? s : s.slice(0, n - 1) + "\u2026";
async function probe(url, init) {
  try {
    const r = await request(url, init);
    return { ok: r.ok, status: r.status, json: r.json, ms: r.ms, skewS: r.skewS, error: r.ok ? void 0 : apiError(r) };
  } catch (e) {
    return { ok: false, error: netError(e, init.timeoutMs) };
  }
}
var cleanStop = (c) => !c.oomKilled && [0, 137, 143].includes(c.exitCode);
function quoteLabel(q) {
  if (typeof q !== "string" || q === "0x" || q === "") return "no quote yet (it is produced at registration, from the site)";
  if (q.toLowerCase().startsWith("0x4d4f434b2d544458")) return "last quote simulated (demo mode)";
  return `last quote: real TDX (${fmtInt((q.length - 2) / 2)} bytes)`;
}
async function runDoctor(o) {
  const rpc = o.rpc ?? (process.env.ARCHIVE_RPC?.trim() || DEFAULT_RPC);
  const detected = detectMode();
  const mode = o.demo ? "demo" : detected;
  const local = `http://127.0.0.1:${o.port}`;
  const sig = o.signal;
  const [osDesc, docker, rpcP, apiP, health, keys] = await Promise.all([
    osDescription(),
    dockerState(sig),
    probe(rpc, { body: { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }, timeoutMs: 8e3, signal: sig }),
    probe(`${o.api}/health`, { timeoutMs: 6e3, signal: sig }),
    probe(`${local}/health`, { timeoutMs: 3e3, signal: sig }),
    probe(`${local}/pubkeys`, { timeoutMs: 3e3, signal: sig })
  ]);
  const container = docker.ok ? await inspectContainer(CONTAINER, sig) : null;
  const portState = await probePort(o.port);
  const checks = [];
  const add = (id, ok, detail, label = LABELS[id]) => checks.push({ id, label, ok, detail: clip(detail) });
  const p = platform2();
  if (p === "linux") add("os", true, osDesc + (process.arch !== "x64" ? " \xB7 TDX needs an Intel x86-64 processor: demo mode only" : ""));
  else if (p === "darwin") add("os", true, `${osDesc}: no TDX on a Mac: local trial only, the machine can't serve the network`);
  else if (p === "win32") add("os", false, "Windows isn't supported: use WSL 2 (Ubuntu) or a Linux VM.");
  else add("os", false, `${osDesc} isn't supported: use Linux (Intel TDX VM), or macOS for the demo.`);
  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= 20, major >= 20 ? `Node.js ${process.version}` : `Node.js ${process.version} is too old: install Node.js 20 or later (https://nodejs.org).`);
  add("docker", docker.ok, docker.ok ? `Docker ${docker.version}, daemon reachable` : docker.detail);
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
  const skew = rpcP.skewS ?? apiP.skewS ?? null;
  const src = rpcP.skewS != null ? hostOf(rpc) : "the ArcHive API";
  if (skew == null) add("clock", false, "Reference time unreadable (RPC and API unreachable): restore the network, then check the clock (Linux: timedatectl).");
  else if (Math.abs(skew) < CLOCK_MAX_SKEW_S) add("clock", true, `Offset of ${fmtSeconds(skew)} from the time of ${src}`);
  else add("clock", false, `Clock ${skew > 0 ? "ahead" : "behind"} by ${fmtSeconds(skew)} compared to ${src}: sync it (Linux: sudo timedatectl set-ntp true; macOS: Settings \u203A General \u203A Date & Time, set automatically).`);
  let block = null;
  try {
    block = typeof rpcP.json?.result === "string" ? Number(BigInt(rpcP.json.result)) : null;
  } catch {
    block = null;
  }
  if (rpcP.ok && block !== null) add("rpc", true, `Arc testnet RPC reachable (${hostOf(rpc)}) \xB7 block ${fmtInt(block)} \xB7 ${rpcP.ms} ms`);
  else {
    const why = rpcP.error ?? (typeof rpcP.json?.error?.message === "string" ? rpcP.json.error.message : "answer without a block number");
    add("rpc", false, `Arc RPC unreachable (${rpc}: ${why}). Check outbound Internet access over HTTPS (port 443)${rpcP.status === 429 ? "; the RPC is rate-limiting, try again in a moment" : ""}.`);
  }
  if (apiP.ok && apiP.json?.ok === true) add("api", true, `ArcHive API reachable (${o.api} \xB7 ${apiP.ms} ms)`);
  else add("api", false, `ArcHive API unreachable (${o.api}/health: ${apiP.error ?? "unexpected answer"}). Check --api or ARCHIVE_API, and that this outbound port is open.`);
  const portLabel = `Enclave port (${o.port})`;
  const ours = !!container && container.hostPort === o.port && (container.running || container.restarting);
  if (ours) add("port", true, `Port ${o.port}: used by the ArcHive enclave (container ${CONTAINER})`, portLabel);
  else if (portState === "free") add("port", true, `Port ${o.port} free`, portLabel);
  else if (portState === "denied") add("port", false, `Port ${o.port} not allowed (ports < 1024 are reserved for root): pick a port \u2265 1024 (--port 8802).`, portLabel);
  else {
    const who = await portOwner(o.port);
    add("port", false, `Port ${o.port} already taken by another program${who ? ` (${who})` : ""}: stop it or pick another port (--port ${o.port + 1}).`, portLabel);
  }
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
  const signer = typeof keys.json?.signer === "string" && /^0x[0-9a-fA-F]{40}$/.test(keys.json.signer) ? keys.json.signer : null;
  const x25519 = typeof keys.json?.x25519 === "string" && /^0x[0-9a-fA-F]{64}$/.test(keys.json.x25519) ? keys.json.x25519 : null;
  if (signer && x25519) add("attest", true, `signer ${short(signer)} \xB7 x25519 ${short(x25519)} \xB7 ${quoteLabel(keys.json?.lastQuote)}`);
  else if (!healthOk) add("attest", false, "Enclave keys unavailable: the enclave isn't answering (see \u201CEnclave health\u201D).");
  else add("attest", false, `/pubkeys doesn't return signer + x25519 (${keys.error ?? "fields missing"}): incompatible enclave image? Check --image.`);
  const required = ["os", "node", "docker", "clock", "rpc", "api", "port"];
  if (mode === "tdx") required.push("tdx_guest", "tsm_report");
  if (mode === "dstack") required.push("dstack_socket");
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
    at: (/* @__PURE__ */ new Date()).toISOString(),
    api: o.api,
    port: o.port,
    checks,
    required,
    blocking,
    facts: { docker, container, healthOk, signer, x25519, block }
  };
}
function doctorJson(r) {
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
    checks: r.checks.map((c) => ({ ...c, required: r.required.includes(c.id) }))
  };
}
function printChecks(r) {
  const labelW = 26;
  const indent = " ".repeat(4 + labelW + 1);
  const width = isTTY() ? Math.min(columns(), 120) - indent.length : Infinity;
  for (const c of r.checks) {
    const req = r.required.includes(c.id);
    const mark = c.ok ? OK : req ? KO : SKIP;
    const label = pad(c.label, labelW);
    const detail = wrap(c.detail, width, indent);
    out(`  ${mark} ${c.ok ? label : req ? bold(label) : dim(label)} ${c.ok || req ? detail : dim(detail)}`);
  }
}
function printDoctor(r, next) {
  out(`${bold("archive-node")} ${r.version} \xB7 diagnostics for \u201C${r.hostname}\u201D`);
  out(`Mode: ${modeLabel(r.mode)}${r.mode !== r.detected ? dim(" (forced by --demo)") : ""}`);
  out();
  printChecks(r);
  out();
  const green2 = r.checks.filter((c) => c.ok).length;
  const optional = r.checks.filter((c) => !c.ok && !r.required.includes(c.id)).length;
  if (r.ok) {
    out(`${OK} Nothing blocking: ${green2}/${r.checks.length} green${optional ? dim(` (${optional} optional here, marked \xB7)`) : ""}.`);
  } else {
    out(`${KO} ${plural(r.blocking.length, "blocking issue", "blocking issues")}: fix the \u2717 lines, then run archive-node doctor again.`);
  }
  if (next) out(`${ARROW} Next step: ${bold(next)}`);
}

// src/args.ts
import util from "node:util";
function parseCommand(argv, spec, cmd) {
  try {
    const r = util.parseArgs({
      args: argv,
      options: { ...spec, help: { type: "boolean", short: "h" } },
      strict: true,
      allowPositionals: true
    });
    return { values: r.values, positionals: r.positionals };
  } catch (e) {
    throw new UsageError(parseError(e, cmd));
  }
}
function parseError(e, cmd) {
  const x = e;
  const opt = /'(-{1,2}[^' ]+)/.exec(x.message ?? "")?.[1] ?? "";
  const help2 = `see: archive-node ${cmd} --help`;
  switch (x.code) {
    case "ERR_PARSE_ARGS_UNKNOWN_OPTION":
      return `unknown option ${opt} (${help2}).`;
    case "ERR_PARSE_ARGS_INVALID_OPTION_VALUE":
      return /argument missing/i.test(x.message ?? "") ? `option ${opt} expects a value (${help2}).` : `option ${opt} doesn't take a value (${help2}).`;
    case "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL":
      return `unexpected argument (${help2}).`;
  }
  return `${x.message ?? String(e)} (${help2}).`;
}
var str = (v2) => typeof v2 === "string" ? v2 : void 0;
function parsePort(v2, flag = "--port") {
  const n = Number(v2);
  if (!/^\d+$/.test(v2.trim()) || !Number.isInteger(n) || n < 1 || n > 65535) {
    throw new UsageError(`${flag}: invalid port \u201C${v2}\u201D (expected: an integer between 1 and 65535).`);
  }
  return n;
}
function parseProduct(v2) {
  const n = Number(v2);
  if (!/^\d+$/.test(v2.trim()) || !Number.isSafeInteger(n)) {
    throw new UsageError(`--product: invalid product number \u201C${v2}\u201D (expected: an integer, for example 1).`);
  }
  return n;
}
function parseCount(v2, flag, max) {
  const n = Number(v2);
  if (!/^\d+$/.test(v2.trim()) || n < 1 || n > max) throw new UsageError(`${flag}: invalid number \u201C${v2}\u201D (between 1 and ${max}).`);
  return n;
}

// src/tunnel.ts
import { spawn } from "node:child_process";
function parseTunnelUrl(line) {
  for (const m of line.matchAll(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi)) {
    if (m[1].toLowerCase() !== "api") return m[0];
  }
  return null;
}
async function cloudflaredAvailable() {
  const r = await run("cloudflared", ["--version"], { timeoutMs: 8e3 });
  return !r.missing && r.code === 0;
}
var CLOUDFLARED_HELP = "install cloudflared (macOS: brew install cloudflared; Debian/Ubuntu: curl -fsSLo cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared.deb), or give your own address with --public-url";
function stopChild(child) {
  return new Promise((resolve2) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve2();
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
      resolve2();
    }, 3e3);
    child.once("exit", () => {
      clearTimeout(t);
      resolve2();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(t);
      resolve2();
    }
  });
}
function startQuickTunnel(port, onExit, timeoutMs = 45e3) {
  return new Promise((resolve2, reject) => {
    const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
    const tail = [];
    let settled = false;
    const tunnel = { url: "", child, alive: true, stop: () => stopChild(child) };
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const onData = (buf) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line.trim());
        if (tail.length > 20) tail.shift();
        const url = parseTunnelUrl(line);
        if (url) {
          finish(() => {
            tunnel.url = url;
            resolve2(tunnel);
          });
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (e) => {
      tunnel.alive = false;
      finish(() => reject(new Error(`cloudflared doesn't start: ${e.message}`)));
    });
    child.once("exit", (code) => {
      tunnel.alive = false;
      if (settled) onExit(code, tail);
      else finish(() => reject(new Error(`cloudflared stopped (code ${code}): ${tail.slice(-2).join(" | ") || "no output"}`)));
    });
    const timer = setTimeout(() => {
      finish(() => {
        child.kill("SIGTERM");
        reject(new Error(`cloudflared gave no address within ${Math.round(timeoutMs / 1e3)} s (${tail.slice(-1)[0] ?? "no output"})`));
      });
    }, timeoutMs);
  });
}

// src/agent.ts
var NO_TDX_HELP = `No TDX on this machine (neither /dev/tdx_guest nor a dstack agent).
To run it as a demo (simulated attestation, testnet only): ${upCommand("demo")}`;
var KEY_RE = /^arcop_[A-Za-z0-9_-]{8,}$/;
var KEY_ARG_REFUSED = "--key is no longer accepted: a key passed as an argument shows in the process list (ps) and in the shell history.\nGive it through a file only you can read (chmod 600 <file>, then --key-file <file>) or through the ARCHIVE_KEY environment variable; or pair the machine (archive-node pair), which stores it in ~/.archive/node.json.";
function suppliedKey(keyFile, env = process.env) {
  if (keyFile !== void 0) {
    const path = keyFile.trim();
    if (!path) throw new UsageError("--key-file: file path expected.");
    let raw;
    let loose = false;
    try {
      const st = statSync2(path);
      if (st.isDirectory()) throw new UsageError(`--key-file: \u201C${path}\u201D is a directory, not a file.`);
      if (st.isFile() && st.size > 4096) throw new UsageError(`--key-file: \u201C${path}\u201D is too big to hold only an operator key.`);
      if (!st.isFile() && !st.isFIFO()) throw new UsageError(`--key-file: \u201C${path}\u201D is neither a file nor a pipe.`);
      loose = st.isFile() && (st.mode & 63) !== 0;
      raw = readFileSync3(path, "utf8");
    } catch (e) {
      if (e instanceof UsageError) throw e;
      const code = e.code;
      const why = code === "ENOENT" ? "file not found" : code === "EACCES" ? "access denied" : errMsg(e);
      throw new UsageError(`--key-file: can't read \u201C${path}\u201D (${why}).`);
    }
    const key = raw.trim();
    if (!KEY_RE.test(key)) throw new UsageError(`--key-file: \u201C${path}\u201D must contain the operator key alone (arcop_\u2026, on one line).`);
    return {
      key,
      source: `--key-file ${path}`,
      warning: loose ? `The key file ${path} is readable by other accounts on this machine: chmod 600 ${path}` : null
    };
  }
  const v2 = env.ARCHIVE_KEY?.trim();
  if (!v2) return null;
  if (!KEY_RE.test(v2)) throw new UsageError("ARCHIVE_KEY: invalid operator key (expected: arcop_\u2026).");
  return { key: v2, source: "ARCHIVE_KEY", warning: null };
}
function planUp(f, opts) {
  if (f.key !== void 0) throw new UsageError(KEY_ARG_REFUSED);
  const port = parsePort(f.port ?? String(DEFAULT_PORT));
  const image = (f.image ?? DEFAULT_IMAGE).trim();
  if (!image || /\s/.test(image) || image.startsWith("-")) throw new UsageError(`--image: invalid image reference \u201C${f.image}\u201D.`);
  const publicUrl = f.publicUrl ? normalizeUrl(f.publicUrl, "--public-url") : null;
  const detected = detectMode();
  const mode = f.demo ? "demo" : detected;
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
    api,
    key,
    keyFromConfig,
    keySource: supplied?.source ?? (cfg?.key ? tilde(configPath()) : null),
    keyWarning: supplied?.warning ?? null,
    cfg,
    mode,
    detected,
    product,
    port,
    image,
    publicUrl,
    tunnel: !!f.tunnel && !publicUrl
  };
}
var STATUS_LABEL = { starting: "starting", running: "running", error: "error", stopped: "stopped" };
var Agent = class {
  constructor(p) {
    this.p = p;
    this.machineId = p.keyFromConfig ? p.cfg?.machineId ?? null : null;
    this.operator = p.keyFromConfig ? p.cfg?.operator ?? null : null;
  }
  status = "starting";
  announced = false;
  stopping = false;
  ac = new AbortController();
  sleepAbort = null;
  tickPromise = null;
  events = [];
  once = /* @__PURE__ */ new Set();
  lastDoctor = null;
  tunnel = null;
  tunnelPromise = null;
  tunnelRetryAt = 0;
  machineId;
  operator;
  registered = null;
  apiState = "";
  beats = 0;
  lastBeatAt = null;
  lastBeatOk = null;
  lastError = null;
  startedAt = (/* @__PURE__ */ new Date()).toISOString();
  containerStartedAt = null;
  ip = primaryIPv4();
  async run() {
    const st = loadState();
    if (st?.pid && await isAgentAlive(st.pid)) {
      throw new CliError(`An archive-node agent is already running on this machine (pid ${st.pid}).
Stop it first: Ctrl+C in its terminal, or sudo systemctl stop archive-node.`);
    }
    this.printHeader();
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void this.shutdown(sig));
    process.on("exit", () => {
      try {
        this.tunnel?.child.kill("SIGTERM");
      } catch {
      }
    });
    if (this.p.tunnel) void this.ensureTunnel();
    while (!this.stopping) {
      this.tickPromise = this.tick().catch((e) => this.note("error", `Internal agent error: ${errMsg(e)}`));
      await this.tickPromise;
      if (this.stopping) break;
      await this.sleep(this.status === "starting" ? HEARTBEAT_STARTING_MS : HEARTBEAT_MS);
    }
    return new Promise(() => {
    });
  }
  // ---------- un tour : enclave, diagnostic, statut, journaux, battement de cœur ----------
  async tick() {
    let launchError = null;
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
    await this.heartbeat(status, report, logs, 1e4);
    this.writeState(false);
  }
  labels() {
    return {
      [LABEL_OWNER]: "archive-node",
      "io.archive.spec": RUN_SPEC,
      "io.archive.image": this.p.image,
      "io.archive.product": String(this.p.product),
      "io.archive.port": String(this.p.port),
      "io.archive.mode": this.p.mode,
      // l'opérateur autorisé à recevoir un quote : quand l'appairage le fait connaître, le conteneur est remplacé
      "io.archive.operator": this.operator ?? ""
    };
  }
  /** Container variables: the stack's contract addresses (the image has no default address valid for the live stack),
   *  the only operator allowed to request a quote (OPERATOR_ALLOWLIST: without it the enclave fails closed) and, when
   *  the agent has it, the upstream model's secret, inherited without appearing on the command line. */
  containerEnv() {
    return {
      CHAIN_ID: String(CHAIN_ID),
      RPC_URL: DEFAULT_RPC,
      REGISTRY: ENCLAVE_REGISTRY,
      SESSIONPAY: SESSION_PAY,
      ...this.operator ? { OPERATOR_ALLOWLIST: this.operator } : {},
      ...process.env.REDPILL_API_KEY ? { REDPILL_API_KEY: "" } : {}
    };
  }
  /** le conteneur tourne avec la bonne configuration (sinon : on le crée, le relance ou le remplace) */
  async ensureEnclave() {
    const sig = this.ac.signal;
    const ds = await dockerState(sig);
    if (!ds.ok) throw new Error(ds.detail);
    const want = this.labels();
    const c = await inspectContainer(CONTAINER, sig);
    if (c && Object.entries(want).every(([k, v2]) => c.labels[k] === v2)) {
      if (c.running || c.restarting || this.stopping) return;
      this.note("info", `Restarting the ${CONTAINER} container (it was stopped)`);
      const r2 = await run("docker", ["start", CONTAINER], { timeoutMs: 6e4, signal: sig });
      if (r2.code !== 0) {
        if (r2.aborted) return;
        throw new Error(runError(r2.stderr, this.p.port));
      }
      this.containerStartedAt = Date.now();
      return;
    }
    let platform4 = await imagePlatform(this.p.image, sig);
    if (!platform4) {
      if (this.stopping) return;
      this.note("info", `Downloading the image ${short(this.p.image, 60, 8)} (the first time: one to a few minutes)\u2026`, "pull");
      const beat = () => void this.collectLogs(sig).then((logs) => this.heartbeat("starting", null, logs, 1e4));
      if (!this.lastBeatAt || Date.now() - this.lastBeatAt > 2e4) beat();
      const keepAlive = setInterval(beat, HEARTBEAT_MS);
      let r2 = await pullImage(this.p.image, null, sig);
      if (r2.code !== 0 && !r2.aborted && process.arch !== "x64" && /no matching manifest/i.test(r2.stderr)) {
        this.note("info", "x86-64-only image: downloading for linux/amd64 (emulated on this processor)", "pull-amd64");
        r2 = await pullImage(this.p.image, "linux/amd64", sig);
      }
      clearInterval(keepAlive);
      if (r2.code !== 0) {
        if (r2.aborted) return;
        throw new Error(pullError(r2.stderr, this.p.image));
      }
      platform4 = await imagePlatform(this.p.image, sig);
      this.note("ok", "Image downloaded");
    }
    if (this.stopping) return;
    if (c) {
      this.note("info", c.labels[LABEL_OWNER] ? `Configuration changed: replacing the ${CONTAINER} container` : `A ${CONTAINER} container already existed (started by hand): it is replaced`);
      const r2 = await run("docker", ["rm", "-f", CONTAINER], { timeoutMs: 6e4, signal: sig });
      if (r2.code !== 0) throw new Error(`Can't remove the old ${CONTAINER} container: ${lastLine(r2.stderr)}`);
    }
    if (this.stopping) return;
    const arch2 = platform4?.split("/")[1];
    const r = await run(
      "docker",
      runArgs({
        port: this.p.port,
        product: this.p.product,
        image: this.p.image,
        env: this.containerEnv(),
        platform: platform4 && arch2 && arch2 !== hostDockerArch() ? platform4 : null,
        dstack: this.p.mode !== "demo" && hasDstack(),
        labels: want
      }),
      { timeoutMs: 12e4, signal: sig }
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
  computeStatus(report, launchError) {
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
  setStatus(s, reason, report) {
    const changed = s !== this.status || s === "error" && reason !== this.lastError || !this.announced;
    this.status = s;
    this.lastError = s === "error" ? reason : null;
    if (!changed) return;
    this.announced = true;
    if (s === "running") {
      const a = report.checks.find((c) => c.id === "attest");
      this.note("ok", `Enclave running on port ${this.p.port}${a?.ok ? ` \xB7 ${a.detail}` : ""}`);
    } else if (s === "starting") this.note("info", "The enclave is starting\u2026");
    else if (s === "error") this.note("error", `Enclave error: ${reason}`);
  }
  async collectLogs(signal) {
    const container = await containerLogs(CONTAINER, MAX_LOG_LINES, signal);
    return mergeLogLines([container, this.events], MAX_LOG_LINES).map(formatLogLine);
  }
  // ---------- battement de cœur ----------
  async heartbeat(status, report, logs, timeoutMs) {
    const body = {
      ...this.machineId ? { machineId: this.machineId } : {},
      hostname: hostname2(),
      version: VERSION,
      mode: this.p.mode,
      productId: this.p.product,
      enclaveUrl: this.enclaveUrl(),
      signer: report?.facts.signer ?? null,
      x25519: report?.facts.x25519 ?? null,
      status,
      ...report ? { doctor: { ok: report.ok, checks: report.checks.map(({ id, label, ok, detail }) => ({ id, label, ok, detail })) } } : {},
      logs
    };
    let r;
    try {
      r = await request(`${this.p.api}/machines/heartbeat`, {
        body,
        headers: { authorization: `Bearer ${this.p.key}` },
        timeoutMs,
        signal: status === "stopped" ? void 0 : this.ac.signal
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
      if (mid && (mid !== this.machineId || op && op !== this.operator)) {
        this.machineId = mid;
        this.operator = op ?? this.operator;
        this.persistIdentity();
      }
      this.setApi("ok", "");
      const reg = typeof r.json.next?.registered === "boolean" ? r.json.next.registered : null;
      if (status !== "stopped") {
        if (reg !== null && reg !== this.registered) {
          this.registered = reg;
          if (reg) this.note("ok", "Enclave registered on Arc: it can receive sessions paid in USDC.");
          else this.note("info", `Not registered on Arc yet: on the site, Operator page, click \u201CRegister\u201D (wallet signature) \u2192 ${this.web()}/#/operateur`);
        }
        out(dim(`${hhmmss()} \u2665 heartbeat #${this.beats} \xB7 ${STATUS_LABEL[status]}`));
      }
      return true;
    }
    this.lastBeatOk = false;
    if (r.status === 401 || r.status === 403) {
      this.setApi("unauthorized", `The API refuses the operator key (${apiError(r)}): pair again with archive-node pair --force. The enclave keeps running.`);
    } else if (r.status === 404) {
      this.setApi("missing", `This API doesn't accept heartbeats yet (POST /machines/heartbeat \u2192 404): check --api.`);
    } else {
      this.setApi(`http-${r.status}`, `The API refused the heartbeat (${apiError(r)}).`);
    }
    return false;
  }
  setApi(state, message) {
    if (state === this.apiState) return;
    const first = this.apiState === "";
    this.apiState = state;
    if (state === "ok") {
      if (first) this.note("ok", `Linked to the site: machine ${short(this.machineId, 8, 4)} \xB7 account ${short(this.operator)}`);
      else this.note("ok", "Link with the API restored");
      return;
    }
    this.note(state === "unreachable" ? "warn" : "error", message);
  }
  /** range machineId/operator dans node.json, si la clé en vient et n'a pas changé entre-temps */
  persistIdentity() {
    if (!this.p.keyFromConfig) return;
    try {
      const cur = loadConfig();
      if (cur && cur.key === this.p.key) saveConfig({ ...cur, machineId: this.machineId, operator: this.operator });
    } catch {
    }
  }
  // ---------- adresse publique ----------
  fallbackUrl() {
    return `http://${this.ip?.address ?? "127.0.0.1"}:${this.p.port}`;
  }
  enclaveUrl() {
    if (this.p.publicUrl) return this.p.publicUrl;
    if (this.tunnel?.alive && this.tunnel.url) return this.tunnel.url;
    return this.fallbackUrl();
  }
  web() {
    return (this.p.keyFromConfig ? this.p.cfg?.web : null) ?? DEFAULT_WEB;
  }
  ensureTunnel() {
    if (this.stopping || this.tunnel?.alive) return Promise.resolve();
    if (this.tunnelPromise) return this.tunnelPromise;
    if (Date.now() < this.tunnelRetryAt) return Promise.resolve();
    this.tunnelPromise = (async () => {
      if (!await cloudflaredAvailable()) {
        this.note("warn", `cloudflared isn't installed, so no tunnel: ${CLOUDFLARED_HELP}. Address announced meanwhile: ${this.fallbackUrl()}`, "no-cloudflared");
        this.tunnelRetryAt = Date.now() + 5 * 6e4;
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
        this.tunnelRetryAt = Date.now() + 6e4;
        this.note("warn", `cloudflared tunnel failed: ${errMsg(e)}. Address announced meanwhile: ${this.fallbackUrl()}`);
      }
    })().finally(() => {
      this.tunnelPromise = null;
    });
    return this.tunnelPromise;
  }
  // ---------- affichage, état local, arrêt ----------
  note(level, text, onceKey) {
    if (onceKey) {
      if (this.once.has(onceKey)) return;
      this.once.add(onceKey);
    }
    const sym = level === "ok" ? OK : level === "error" ? KO : level === "warn" ? WARN : dim("\xB7");
    out(`${dim(hhmmss())} ${sym} ${text}`);
    this.events.push({ ts: Date.now(), frac: 0, text: `[archive-node] ${text}` });
    if (this.events.length > 40) this.events.shift();
  }
  printHeader() {
    const p = this.p;
    const kid = keyIdOf(p.key);
    out(`${bold("archive-node")} ${VERSION} \xB7 \u201C${hostname2()}\u201D joins the ArcHive hive`);
    out(`  Mode      ${modeLabel(p.mode)}${p.mode !== p.detected ? dim(" (forced by --demo)") : ""}`);
    out(`  Product   #${p.product} \xB7 port ${p.port}${p.mode === "demo" ? ` ${WARN} no TDX: local trial, this machine can't register (a simulated attestation proves nothing)` : ""}`);
    out(`  Image     ${p.image}`);
    out(`  API       ${p.api} \xB7 key ${maskKey(p.key)}${kid ? ` (#${kid})` : ""}${p.keySource ? dim(` \xB7 ${p.keySource}`) : ""}`);
    if (p.keyWarning) out(`  ${WARN} ${p.keyWarning}`);
    if (p.keyFromConfig && p.cfg?.api && p.cfg.api !== p.api) {
      out(`  ${WARN} The key was issued by ${p.cfg.api} but will be sent to ${p.api}.`);
    }
    if (p.publicUrl) out(`  Address   ${p.publicUrl}`);
    else if (p.tunnel) out(`  Address   cloudflared tunnel (opening\u2026)`);
    else {
      out(`  Address   ${this.fallbackUrl()}`);
      if (!this.ip || this.ip.isPrivate) {
        out(`  ${WARN} ${this.ip ? "Private" : "Local"} address: the site probably can't reach the enclave. Add --tunnel or --public-url https://\u2026`);
      }
    }
    out(dim("  Ctrl+C stops the enclave and tells the site."));
    out();
  }
  writeState(stopped) {
    saveState({
      pid: stopped ? null : process.pid,
      startedAt: this.startedAt,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
      lastError: this.lastError
    });
  }
  sleep(ms) {
    const ctl = new AbortController();
    this.sleepAbort = ctl;
    return new Promise((resolve2) => {
      const t = setTimeout(resolve2, ms);
      ctl.signal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve2();
      }, { once: true });
    });
  }
  async shutdown(sig) {
    if (this.stopping) {
      err(`
${KO} Forced stop.`);
      process.exit(130);
    }
    this.stopping = true;
    out();
    this.note("info", `Stop requested (${sig}): stopping the enclave and sending a last heartbeat\u2026`);
    this.ac.abort();
    this.sleepAbort?.abort();
    await Promise.race([this.tickPromise ?? Promise.resolve(), new Promise((r2) => setTimeout(r2, 1e4))]);
    await this.tunnel?.stop().catch(() => void 0);
    const r = await run("docker", ["stop", "-t", "10", CONTAINER], { timeoutMs: 3e4 });
    if (r.code === 0) this.note("ok", `Enclave stopped (container ${CONTAINER} stopped; archive-node up restarts it)`);
    const ok = await this.heartbeat("stopped", this.lastDoctor, await this.collectLogs(), 5e3);
    this.note(ok ? "ok" : "warn", ok ? "Site notified: machine stopped." : "The site couldn't be notified: it will see the machine offline within 90 s.");
    this.status = "stopped";
    this.writeState(true);
    await flush();
    process.exit(0);
  }
};
async function runUp(f) {
  return new Agent(planUp(f, { requireKey: true })).run();
}

// src/help.ts
var API_HELP = `  --api <url>          ArcHive API (default: $ARCHIVE_API, else the one from pairing, else ${DEFAULT_API})`;
var HELP = {
  main: `archive-node ${VERSION}: the ArcHive operator agent

Runs an ArcHive enclave on this machine and links it to your account (your wallet) on the
site. Your private key never leaves your wallet: the machine gets an operator key
(arcop_\u2026) that can't spend anything.

Usage: archive-node <command> [options]

Commands:
  doctor               Checks that the machine is ready (Docker, TDX, clock, network, enclave)
  pair                 Pairs the machine with your wallet using a code (HIVE-XXXX-XXXX)
  up                   Starts the enclave and reports its state to the site every 30 s
  status               Sums up the local state and what the site knows about the machine
  logs                 Shows the enclave logs (-f to follow them)
  service install      Starts the agent at boot (systemd; the launchd equivalent on macOS)
  service uninstall    Removes that service

Options:
  -h, --help           Help (also: archive-node <command> --help)
  -V, --version        Version

Quick start:
  archive-node doctor
  archive-node pair
  archive-node up --product ${PRODUCT_TDX} --tunnel            Intel TDX VM (dstack): serves the network
  archive-node up --demo                                       local trial without TDX (nothing is registered)

Files: ~/.archive/node.json (operator key, mode 0600) \xB7 ~/.archive/state.json (last state)
Variables: ARCHIVE_API, ARCHIVE_KEY (operator key, instead of node.json), ARCHIVE_HOME (instead of ~/.archive),
           ARCHIVE_RPC, NO_COLOR, ARCHIVE_DEBUG`,
  doctor: `archive-node doctor: checks that this machine is ready to run an ArcHive enclave.

Usage: archive-node doctor [--json] [--port <n>] [--demo] [--api <url>]

Checks, in order: os, node, docker, tdx_guest, tsm_report, dstack_socket, clock, rpc,
api, port, enclave_health, attest. Each line says what to do if it isn't green.
Detected mode: dstack if /var/run/dstack.sock exists, tdx if /dev/tdx_guest exists, otherwise demo
(in demo mode, the TDX checks are optional and marked \xB7).

Options:
  --json               JSON output (scripts, copilot)
  --port <n>           Enclave port to check (default: the container's, else ${DEFAULT_PORT})
  --demo               Assess the machine in demo mode (TDX optional)
${API_HELP}

Exit code: 0 when nothing is blocking, 1 otherwise.`,
  pair: `archive-node pair: pairs this machine with your account (your wallet) using a code.

Usage: archive-node pair [--force] [--yes | --operator <address>] [--api <url>]

The machine shows a code (HIVE-XXXX-XXXX) and an address. Open it, enter the code and sign
with your wallet: no transaction, no fee. The machine then gets an operator key arcop_\u2026,
which can't spend anything.

Before keeping it, the machine shows the FULL address of the account that approved the code
and asks "Keep this pairing? [y/N]". Compare it with the one the site shows after your
signature: if it isn't yours, answer n (someone else approved your code); the key is then
revoked and nothing is saved. On "y" (or "yes"), the key is stored in ~/.archive/node.json
(readable by you only). Enter alone, or no answer: that's a no.
Only an answer typed AFTER the question appears counts: anything typed while waiting
is ignored. Without a terminal (pipe, script, cloud-init), the question isn't asked:
--operator or --yes is then required.

Options:
  --force              Pair again even if the machine already is (new key)
  --operator <address> Safe automation: accepts only this account (0x + 40 characters), without
                       asking; any other account is refused and its key revoked
  -y, --yes            Automation: accepts whichever account approves, without asking.
                       Anyone who sees the code before you can then approve it in your place:
                       prefer --operator
${API_HELP}

Examples:
  archive-node pair
  archive-node pair --operator <the full address of YOUR wallet>     (script, cloud-init)`,
  up: `archive-node up: starts the enclave in Docker and reports its state to the site every 30 s
(diagnostics, status, last 100 log lines, public keys, address).

Usage: archive-node up [options]

Options:
  --product <n>        Product served by the enclave (default: ${PRODUCT_TDX}; with --demo, local trial, nothing is registered)
  --port <n>           Enclave port on this machine (default: ${DEFAULT_PORT})
  --image <ref>        Enclave image (default: sealed-chat, pinned by digest)
  --demo               Machine without TDX: simulated attestation, testnet only
  --tunnel             Automatic public https address (cloudflared quick tunnel)
  --public-url <url>   Your own public address for the enclave (takes precedence over --tunnel)
  --key-file <file>    File that holds the operator key arcop_\u2026 (alone, mode 600)
                       (default: $ARCHIVE_KEY, else the key from pairing, ~/.archive/node.json)
${API_HELP}

The key is never passed as an argument (--key is refused): it would show in the process
list and in the shell history. Use archive-node pair, --key-file or ARCHIVE_KEY.
Without --tunnel or --public-url, the announced address is http://<machine IP>:<port>.
Without TDX, --demo is required. Ctrl+C stops the enclave and tells the site.
Start at boot: archive-node service install (same options).

Examples:
  archive-node up --product ${PRODUCT_TDX} --tunnel            Intel TDX VM (dstack): serves the network
  archive-node up --demo                                       local trial without TDX (nothing is registered)`,
  status: `archive-node status: the machine's state at a glance.

Usage: archive-node status [--json] [--port <n>] [--api <url>]

Shows the pairing (account, machine, masked key), what the site knows (online, last
heartbeat, registration on Arc), the container, the agent and the diagnostics summary.

Options:
  --json               JSON output
  --port <n>           Enclave port (default: the container's)
${API_HELP}`,
  logs: `archive-node logs: the enclave logs (archive-enclave container).

Usage: archive-node logs [-f] [-n <lines>]

Options:
  -f, --follow         Follow new lines (Ctrl+C to stop)
  -n, --tail <n>       Number of lines from the end (default: 200)`,
  service: `archive-node service: start the agent when the machine boots.

Usage:
  archive-node service install [up options]
  archive-node service uninstall

Linux: writes a systemd unit (/etc/systemd/system/archive-node.service) that runs
"archive-node up" with the same options, as you. Without root, the unit is written to
~/.archive and the three sudo commands to run are shown.
macOS: shows the launchd equivalent (session agent).
The operator key is never written into the service: pair first with archive-node pair,
or pass --key-file <file> (only the file's path appears in the service). The ARCHIVE_KEY
variable isn't copied there.

install options: --product, --port, --image, --demo, --tunnel, --public-url, --key-file, --api
(see archive-node up --help)`
};

// src/logs.ts
import { spawn as spawn2 } from "node:child_process";
async function logsCommand(f) {
  const ds = await dockerState();
  if (!ds.ok) throw new CliError(ds.detail);
  if (!await inspectContainer()) {
    throw new CliError(`No ${CONTAINER} container on this machine: first run ${upCommand(detectMode())}.`);
  }
  const args = ["logs", "--tail", String(f.tail ?? 200), ...f.follow ? ["--follow"] : [], CONTAINER];
  return new Promise((resolve2) => {
    const child = spawn2("docker", args, { stdio: "inherit" });
    const onSig = () => {
    };
    process.on("SIGINT", onSig);
    child.once("error", (e) => {
      process.removeListener("SIGINT", onSig);
      resolve2(Promise.reject(new CliError(`docker logs failed: ${e.message}`)));
    });
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", onSig);
      resolve2(signal ? 0 : code ?? 1);
    });
  });
}

// src/pair.ts
import { hostname as hostname3 } from "node:os";
var ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
var NO_TTY = "standard input is not a terminal (pipe, script, cloud-init): the machine can't show you the account that will approve the code and then read YOUR answer (an answer from a pipe, as in \u201Cecho y | archive-node pair\u201D, doesn't prove that anyone checked the address).\nRun it again in a terminal, or decide in advance: --operator <the full address of YOUR wallet> (accepts only this account, recommended), or --yes (accepts whichever account approves).";
var clampNum = (v2, min, max, dflt) => {
  const n = Number(v2);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
function sleep(ms, signal) {
  return new Promise((resolve2) => {
    if (signal.aborted) return resolve2();
    const t = setTimeout(resolve2, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve2();
    }, { once: true });
  });
}
var Waiting = class {
  constructor(deadline2) {
    this.deadline = deadline2;
    if (isTTY()) {
      this.timer = setInterval(() => this.draw(), 1e3);
      this.draw();
    } else out("Waiting for your signature on the site\u2026");
  }
  timer = null;
  frame = 0;
  note = "";
  setNote(n) {
    this.note = n;
    if (!isTTY() && n) out(dim(n));
  }
  draw() {
    const left = Math.max(0, Math.round((this.deadline - Date.now()) / 1e3));
    const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    const f = "\u280B\u2819\u2839\u2838\u283C\u2834\u2826\u2827\u2807\u280F"[this.frame++ % 10];
    process.stdout.write(`\r\x1B[2K  ${cyan(f)} Waiting for your signature\u2026 ${dim(`(expires in ${mmss}${this.note ? ` \xB7 ${this.note}` : ""} \xB7 Ctrl+C to cancel)`)}`);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stdout.write("\r\x1B[2K");
    }
  }
};
async function confirmOperator(operator, f, signal) {
  out(`${OK} Code approved on the site, by the account:`);
  out();
  out(`      ${bold(operator)}`);
  out();
  if (f.operator) {
    if (operator === f.operator.toLowerCase()) return { keep: true, how: "it is the expected account (--operator)" };
    return {
      keep: false,
      exitCode: 1,
      why: `This is not the expected account (--operator ${f.operator.toLowerCase()}): someone else approved the code. Pairing refused.`
    };
  }
  if (f.yes) return { keep: true, how: "accepted without asking (--yes)" };
  out("  Is this YOUR wallet? The site shows the same address, in full, right after your signature.");
  out(dim("  If you don't recognize it, answer n: someone else approved your code, and their key will be revoked."));
  out();
  const a = await askYesNo("  Keep this pairing and save the key on this machine? [y/N] ", signal);
  if (a === "yes") return { keep: true, how: "confirmed on this machine" };
  if (a === "cancel") return { keep: false, exitCode: 130, why: "Pairing cancelled." };
  if (a === "notty") return { keep: false, exitCode: 2, why: `Pairing refused: ${NO_TTY}` };
  if (a === "eof") return { keep: false, exitCode: 1, why: "No answer (input closed): refused by default." };
  return { keep: false, exitCode: 1, why: "Pairing refused." };
}
async function rejectPairing(api, key) {
  try {
    const r = await request(`${api}/pair/reject`, { method: "POST", headers: { authorization: `Bearer ${key}` }, timeoutMs: 1e4 });
    if (r.ok) return "the key is not saved, the API revoked it, and the machine left the account that had approved it";
    return `the key is not saved (the API didn't revoke it: ${apiError(r)}; it was only given to this machine, nobody else can use it)`;
  } catch (e) {
    return `the key is not saved (API unreachable to revoke it: ${netError(e)}; it was only given to this machine, nobody else can use it)`;
  }
}
async function pairCommand(f) {
  if (f.operator !== void 0 && !ADDRESS_RE.test(f.operator.trim())) {
    throw new UsageError(`--operator: invalid address \u201C${f.operator}\u201D (expected: 0x followed by 40 hex characters, the full address of your wallet).`);
  }
  const flags = { ...f, operator: f.operator?.trim() };
  const existing = loadConfig();
  const mode = detectMode();
  if (existing && !flags.force) {
    out(`This machine is already paired: account ${existing.operator ?? "\u2014"} \xB7 machine ${short(existing.machineId, 8, 4)} \xB7 key ${maskKey(existing.key)}.`);
    out(`${ARROW} To pair it again (new key): ${bold("archive-node pair --force")}`);
    out(`${ARROW} To start the enclave: ${bold(upCommand(mode))}`);
    return 0;
  }
  if (!flags.yes && !flags.operator && !process.stdin.isTTY) throw new UsageError(`${NO_TTY.charAt(0).toUpperCase()}${NO_TTY.slice(1)}`);
  const api = resolveApi(flags.api, existing);
  const host = hostname3();
  let start;
  try {
    start = await request(`${api}/pair/start`, { body: { hostname: host, mode, version: VERSION }, timeoutMs: 1e4 });
  } catch (e) {
    throw new CliError(`Can't reach the ArcHive API (${api}): ${netError(e)}.
Check the address (--api or ARCHIVE_API) and the connection, or run archive-node doctor.`);
  }
  if (start.status === 404 && typeof start.json?.code !== "string") {
    throw new CliError(`This API doesn't offer pairing yet (POST ${api}/pair/start \u2192 404).
Check the address (--api or ARCHIVE_API), or try again once the API is updated.`);
  }
  if (!start.ok) throw new CliError(`The API refused to start the pairing (${apiError(start)}).`);
  const s = start.json ?? {};
  if (typeof s.deviceCode !== "string" || typeof s.userCode !== "string" || typeof s.verifyUrl !== "string") {
    throw new CliError("Unexpected answer from the API to /pair/start (deviceCode, userCode or verifyUrl missing).");
  }
  const code = s.userCode;
  const interval = clampNum(s.interval, 1, 60, 3) * 1e3;
  const expiresIn = clampNum(s.expiresIn, 30, 3600, 900) * 1e3;
  const deadline2 = Date.now() + expiresIn;
  out(`${bold("archive-node")} ${VERSION} \xB7 pairing \u201C${host}\u201D (mode ${modeLabel(mode).split(" ")[0]})`);
  out();
  out(`  Open ${cyan(s.verifyUrl)}`);
  out(`  and enter the code ${bold(code)}, then sign with your wallet.`);
  out();
  const banner = isTTY() ? codeBanner(code, columns()) : null;
  if (banner) {
    for (const row of banner.rows) out(bold(row));
    if (banner.short) out(dim("  (the HIVE- prefix is optional when you type it)"));
    out();
  }
  out(dim(`  The code expires in ${Math.round(expiresIn / 6e4)} min. Signing is free and sends no transaction.`));
  out(dim("  Don't show this code to anyone: after the approval, this machine will ask you to confirm the account."));
  out();
  const ac = new AbortController();
  const onSig = () => ac.abort();
  process.once("SIGINT", onSig);
  const wait = new Waiting(deadline2);
  let delay = interval;
  try {
    for (; ; ) {
      await sleep(delay, ac.signal);
      if (ac.signal.aborted) throw new CliError("Pairing cancelled.", 130);
      if (Date.now() > deadline2 + 3e4) throw new CliError("The code expired before it was approved: run archive-node pair again.");
      let r;
      try {
        r = await request(`${api}/pair/poll`, { body: { deviceCode: s.deviceCode }, timeoutMs: 1e4, signal: ac.signal });
      } catch (e) {
        if (ac.signal.aborted) throw new CliError("Pairing cancelled.", 130);
        wait.setNote(`API unreachable (${netError(e)}), retrying\u2026`);
        continue;
      }
      if (r.status === 429) {
        delay = Math.min(delay + 2e3, 3e4);
        continue;
      }
      if (r.status === 404) throw new CliError("The API no longer knows this pairing request (restarted?): run archive-node pair again.");
      if (!r.ok) {
        if (r.status >= 500) {
          wait.setNote(`the API answers ${r.status}, retrying\u2026`);
          continue;
        }
        throw new CliError(`API error while waiting (${apiError(r)}).`);
      }
      wait.setNote("");
      const st = r.json?.status;
      if (st === "pending") continue;
      if (st === "expired") throw new CliError("The code expired before it was approved: run archive-node pair again.");
      if (st === "consumed") throw new CliError("This code was already used (the key is handed out only once): run archive-node pair again.");
      if (st !== "approved") throw new CliError(`Unexpected answer from the API to /pair/poll (status \u201C${String(st)}\u201D).`);
      const key = r.json?.key;
      if (typeof key !== "string" || !/^arcop_[A-Za-z0-9_-]{8,}$/.test(key)) throw new CliError("The API approved the pairing but didn't send a valid operator key.");
      const machineId = typeof r.json?.machineId === "string" ? r.json.machineId : null;
      const rawOperator = r.json?.operator;
      const operator = typeof rawOperator === "string" && ADDRESS_RE.test(rawOperator) ? rawOperator.toLowerCase() : null;
      wait.stop();
      out();
      if (!operator) {
        throw new CliError(`The API approved the pairing without saying which account approved it: to be safe, ${await rejectPairing(api, key)}.
Run archive-node pair again.`);
      }
      const verdict = await confirmOperator(operator, flags, ac.signal);
      if (!verdict.keep) {
        const what = await rejectPairing(api, key);
        throw new CliError(
          `${verdict.why}
${what.charAt(0).toUpperCase()}${what.slice(1)}.
Run archive-node pair again to get a new code, and approve it yourself without showing it to anyone.`,
          verdict.exitCode
        );
      }
      let web = null;
      try {
        web = new URL(s.verifyUrl).origin;
      } catch {
        web = null;
      }
      saveConfig({ api, key, machineId, operator, web, pairedAt: (/* @__PURE__ */ new Date()).toISOString() });
      const kid = keyIdOf(key);
      out(`${OK} Machine paired with the account ${bold(operator)}${machineId ? ` (machine ${short(machineId, 8, 4)})` : ""}: ${verdict.how}.`);
      out(`  Operator key ${maskKey(key)}${kid ? ` (#${kid})` : ""} saved in ${tilde(configPath())}, readable by you only.`);
      out(dim("  It can't spend anything: the bond and the registration on Arc stay signed by your wallet."));
      out();
      out(`${ARROW} Next step: ${bold(upCommand(mode))}`);
      return 0;
    }
  } finally {
    wait.stop();
    process.removeListener("SIGINT", onSig);
  }
}

// src/service.ts
import { existsSync as existsSync3, readFileSync as readFileSync4, realpathSync, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir2, platform as platform3, userInfo } from "node:os";
import { dirname as dirname2, join as join2, resolve } from "node:path";
var UNIT_NAME = "archive-node";
var UNIT_PATH = `/etc/systemd/system/${UNIT_NAME}.service`;
var LAUNCHD_LABEL = "io.archive.node";
function upArgsFromPlan(p, f) {
  const a = ["up", "--product", String(p.product), "--port", String(p.port)];
  if (p.image !== DEFAULT_IMAGE) a.push("--image", p.image);
  if (f.demo) a.push("--demo");
  if (p.publicUrl) a.push("--public-url", p.publicUrl);
  else if (p.tunnel) a.push("--tunnel");
  if (f.api || process.env.ARCHIVE_API && p.api !== DEFAULT_API) a.push("--api", p.api);
  if (f.keyFile?.trim()) a.push("--key-file", resolve(f.keyFile.trim()));
  return a;
}
var ENV_KEY_NOTE = "The ARCHIVE_KEY variable is not copied into the service (it would be readable in clear there): the service will read ~/.archive/node.json, or the file given with --key-file.";
function systemdQuote(s) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;
}
var envQuote = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;
function renderSystemdUnit(u) {
  return [
    "# Generated by \u201Carchive-node service install\u201D: the ArcHive operator agent.",
    "# The operator key is not here: it stays in ~/.archive/node.json (mode 0600).",
    "[Unit]",
    "Description=ArcHive operator agent (archive-node)",
    "Wants=network-online.target",
    "After=network-online.target docker.service",
    "",
    "[Service]",
    "Type=simple",
    `User=${u.user}`,
    `Environment=${envQuote(`HOME=${u.home}`)}`,
    `Environment=${envQuote(`PATH=${u.path}`)}`,
    ...u.archiveHome ? [`Environment=${envQuote(`ARCHIVE_HOME=${u.archiveHome}`)}`] : [],
    `ExecStart=${u.execStart.map(systemdQuote).join(" ")}`,
    "Restart=always",
    "RestartSec=10",
    "KillMode=mixed",
    "TimeoutStopSec=45",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    ""
  ].join("\n");
}
var xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function renderLaunchdPlist(program, env, log) {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0"><dict>`,
    `  <key>Label</key><string>${LAUNCHD_LABEL}</string>`,
    `  <key>ProgramArguments</key><array>`,
    ...program.map((a) => `    <string>${xml(a)}</string>`),
    `  </array>`,
    `  <key>EnvironmentVariables</key><dict>`,
    ...Object.entries(env).map(([k, v2]) => `    <key>${xml(k)}</key><string>${xml(v2)}</string>`),
    `  </dict>`,
    `  <key>RunAtLoad</key><true/>`,
    `  <key>KeepAlive</key><true/>`,
    `  <key>StandardOutPath</key><string>${xml(log)}</string>`,
    `  <key>StandardErrorPath</key><string>${xml(log)}</string>`,
    `</dict></plist>`
  ].join("\n");
}
function servicePath() {
  const parts = (process.env.PATH ?? "").split(":").filter(Boolean);
  const nodeDir = dirname2(process.execPath);
  for (const d of [nodeDir, "/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"]) if (!parts.includes(d)) parts.push(d);
  return parts.join(":");
}
function stableNodePath() {
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  };
  const target = real(process.execPath);
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const candidate = join2(dir, "node");
    if (target && real(candidate) === target) return candidate;
  }
  return process.execPath;
}
function homeOf(user) {
  try {
    for (const line of readFileSync4("/etc/passwd", "utf8").split("\n")) {
      const f = line.split(":");
      if (f[0] === user && f[5]) return f[5];
    }
  } catch {
  }
  return null;
}
function scriptPath() {
  const a = process.argv[1];
  if (!a) throw new CliError("Can't find the path of archive-node.");
  try {
    return realpathSync(a);
  } catch {
    return a;
  }
}
async function serviceInstall(f) {
  const plan = planUp(f, { requireKey: false });
  const program = [stableNodePath(), scriptPath(), ...upArgsFromPlan(plan, f)];
  const os = platform3();
  const keyFile = !!f.keyFile?.trim();
  const envKey = !keyFile && !!process.env.ARCHIVE_KEY?.trim();
  if (os === "darwin") {
    const log = join2(archiveDir(), "archive-node.log");
    const plistPath = `~/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;
    out(`${bold("macOS")} has no systemd: the equivalent is a launchd agent. Save this in ${bold(plistPath)}:`);
    out();
    const env = { PATH: servicePath() };
    if (process.env.ARCHIVE_HOME?.trim()) env.ARCHIVE_HOME = process.env.ARCHIVE_HOME.trim();
    out(renderLaunchdPlist(program, env, log));
    out();
    out("Then load it (it starts at every login; Docker Desktop must be running):");
    out(`  launchctl bootstrap gui/$(id -u) ${plistPath}`);
    out(dim(`Stop: launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL} \xB7 logs: tail -f ${tilde(log)}`));
    if (plan.keyWarning) out(`${WARN} ${plan.keyWarning}`);
    if (envKey) out(`${WARN} ${ENV_KEY_NOTE}`);
    if (!keyFile && !plan.cfg?.key) out(`${WARN} Machine not paired yet: run archive-node pair before loading the agent.`);
    return 0;
  }
  if (os !== "linux") throw new CliError(`Service not supported on ${os}: run archive-node up in a terminal.`);
  const sd = await run("systemctl", ["--version"], { timeoutMs: 5e3 });
  if (sd.missing || sd.code !== 0) {
    throw new CliError("No systemd on this machine (systemctl not found): run archive-node up in a terminal, or in tmux/screen so it survives logging out.");
  }
  const isRoot = process.getuid?.() === 0;
  const sudoUser = isRoot && process.env.SUDO_USER && process.env.SUDO_USER !== "root" ? process.env.SUDO_USER : null;
  const user = sudoUser ?? userInfo().username;
  const home = sudoUser ? homeOf(sudoUser) ?? homedir2() : homedir2();
  const archiveHome = process.env.ARCHIVE_HOME?.trim() || void 0;
  const unit = renderSystemdUnit({ user, home, path: servicePath(), archiveHome, execStart: program });
  const cfgFile = join2(archiveHome ?? join2(home, ".archive"), "node.json");
  const warnings = [];
  if (plan.keyWarning) warnings.push(plan.keyWarning);
  if (envKey) warnings.push(ENV_KEY_NOTE);
  if (!keyFile && !existsSync3(cfgFile)) warnings.push(`Machine not paired yet for ${user} (${cfgFile} missing): run archive-node pair, otherwise the service will stop right away.`);
  if (user !== "root") {
    const g = await run("id", ["-nG", user], { timeoutMs: 3e3 });
    if (g.code === 0 && !g.stdout.split(/\s+/).includes("docker")) {
      warnings.push(`The user ${user} isn't in the docker group: sudo usermod -aG docker ${user} (otherwise the service can't start the enclave).`);
    }
  }
  if (!isRoot) {
    const local = join2(archiveDir(), `${UNIT_NAME}.service`);
    writePrivateFile(local, unit);
    out(`systemd unit written to ${bold(tilde(local))} (runs as ${user}).`);
    out("Installing it needs root; run:");
    out(`  sudo install -m 644 ${local} ${UNIT_PATH}`);
    out("  sudo systemctl daemon-reload");
    out(`  sudo systemctl enable --now ${UNIT_NAME}`);
    out(dim(`Follow: journalctl -u ${UNIT_NAME} -f \xB7 stop: sudo systemctl stop ${UNIT_NAME}`));
    for (const w of warnings) out(`${WARN} ${w}`);
    return 0;
  }
  writeFileSync2(UNIT_PATH, unit, { mode: 420 });
  for (const args of [["daemon-reload"], ["enable", UNIT_NAME], ["restart", UNIT_NAME]]) {
    const r = await run("systemctl", args, { timeoutMs: 6e4 });
    if (r.code !== 0) throw new CliError(`systemctl ${args.join(" ")} failed: ${lastLine(r.stderr) || `code ${r.code}`}`);
  }
  out(`${OK} Service ${bold(UNIT_NAME)} installed (${UNIT_PATH}), enabled at boot and started as ${user}.`);
  out(`${ARROW} Follow: journalctl -u ${UNIT_NAME} -f \xB7 status: archive-node status`);
  for (const w of warnings) out(`${WARN} ${w}`);
  return 0;
}
async function serviceUninstall() {
  const os = platform3();
  if (os === "darwin") {
    out("On macOS, remove the launchd agent:");
    out(`  launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL}`);
    out(`  rm ~/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`);
    return 0;
  }
  if (os !== "linux") throw new CliError(`Service not supported on ${os}.`);
  if (process.getuid?.() !== 0) {
    out("This needs root; run:");
    out(`  sudo systemctl disable --now ${UNIT_NAME}`);
    out(`  sudo rm ${UNIT_PATH}`);
    out("  sudo systemctl daemon-reload");
    return 0;
  }
  if (!existsSync3(UNIT_PATH)) {
    out(`No ${UNIT_NAME} service installed (${UNIT_PATH} missing).`);
    return 0;
  }
  await run("systemctl", ["disable", "--now", UNIT_NAME], { timeoutMs: 9e4 });
  unlinkSync(UNIT_PATH);
  await run("systemctl", ["daemon-reload"], { timeoutMs: 3e4 });
  out(`${OK} Service ${UNIT_NAME} stopped and removed.`);
  return 0;
}

// src/status.ts
async function fetchMachine(api, id, key) {
  try {
    const r = await request(`${api}/machines/${encodeURIComponent(id)}`, { timeoutMs: 8e3, headers: key ? { authorization: `Bearer ${key}` } : void 0 });
    if (r.ok && r.json && typeof r.json === "object") return { ok: true, machine: r.json };
    return { ok: false, error: apiError(r), gone: r.status === 404, refused: r.status === 401 || r.status === 403 };
  } catch (e) {
    return { ok: false, error: netError(e, 8e3) };
  }
}
async function statusCommand(f) {
  const cfg = loadConfig();
  const st = loadState();
  const api = resolveApi(f.api, cfg);
  const docker = await dockerState();
  const c = docker.ok ? await inspectContainer() : null;
  const port = f.port ? parsePort(f.port) : c?.hostPort ?? st?.port ?? DEFAULT_PORT;
  const lastMode = c?.labels["io.archive.mode"] ?? st?.mode;
  const [report, remote, agentAlive] = await Promise.all([
    runDoctor({ api, port, demo: lastMode === "demo" }),
    // la clé ne part que vers l'API qui l'a délivrée (une autre --api reçoit une lecture anonyme)
    cfg?.machineId ? fetchMachine(api, cfg.machineId, cfg.api === api ? cfg.key : null) : Promise.resolve(null),
    isAgentAlive(st?.pid ?? null)
  ]);
  const mode = report.mode;
  if (f.json) {
    out(JSON.stringify({
      version: VERSION,
      paired: !!cfg,
      api,
      machineId: cfg?.machineId ?? null,
      operator: cfg?.operator ?? null,
      key: cfg ? maskKey(cfg.key) : null,
      agent: { alive: agentAlive, pid: agentAlive ? st?.pid ?? null : null, lastStatus: st?.status ?? null, enclaveUrl: st?.enclaveUrl ?? null, lastHeartbeatAt: st?.lastHeartbeatAt ?? null },
      container: c ? { state: c.state, running: c.running, startedAt: c.startedAt, exitCode: c.exitCode, image: c.image, port: c.hostPort, product: c.labels["io.archive.product"] ?? null, mode: c.labels["io.archive.mode"] ?? null } : null,
      remote: remote ? remote.ok ? remote.machine : { error: remote.error } : null,
      doctor: doctorJson(report)
    }, null, 2));
    return report.ok ? 0 : 1;
  }
  out(`${bold("archive-node")} ${VERSION} \xB7 status of \u201C${report.hostname}\u201D`);
  out();
  const row = (label, text) => out(`  ${label.padEnd(12)} ${text}`);
  if (cfg) {
    const kid = keyIdOf(cfg.key);
    row("Pairing", `${OK} account ${short(cfg.operator)} \xB7 machine ${short(cfg.machineId, 8, 4)} \xB7 key ${maskKey(cfg.key)}${kid ? ` (#${kid})` : ""}`);
  } else row("Pairing", `${KO} not paired yet`);
  if (!cfg) row("Site", dim("\u2014"));
  else if (!cfg.machineId) row("Site", `${WARN} machine id unknown: it arrives with the first heartbeat (archive-node up)`);
  else if (!remote || !remote.ok) {
    row("Site", remote && remote.gone ? `${KO} machine unknown to the API (removed from the site?): archive-node pair --force` : remote && remote.refused ? `${KO} the API refuses this machine's key (${remote.error}): archive-node pair --force` : `${WARN} API unreachable (${remote?.error ?? "?"}): ${api}`);
  } else {
    const m = remote.machine;
    const seen = typeof m.lastSeen === "number" ? `last heartbeat ${ago(Date.now() - m.lastSeen)} ago` : "never seen";
    row("Site", `${m.online ? `${OK} online` : `${KO} offline`} \xB7 ${seen} \xB7 status \u201C${m.status ?? "?"}\u201D`);
    row("", `registered on Arc: ${m.registered ? "yes" : "no"} \xB7 diagnostics seen by the site: ${m.doctorOk === true ? "OK" : m.doctorOk === false ? "to fix" : "pending"}${m.enclaveUrl ? ` \xB7 ${m.enclaveUrl}` : ""}`);
  }
  if (!docker.ok) row("Enclave", `${KO} ${docker.detail}`);
  else if (!c) row("Enclave", `${KO} no archive-enclave container`);
  else {
    const since = c.running && c.startedAt ? ` for ${ago(Date.now() - c.startedAt)}` : "";
    const state = c.running ? `${OK} running${since}` : c.restarting ? `${KO} keeps restarting` : `${KO} stopped (code ${c.exitCode})`;
    row("Enclave", `${state} \xB7 product #${c.labels["io.archive.product"] ?? "?"} \xB7 port ${c.hostPort ?? "?"} \xB7 mode ${modeLabel(c.labels["io.archive.mode"] ?? "demo").split(" ")[0]}`);
    row("", dim(c.image));
  }
  if (agentAlive) {
    row("Agent", `${OK} active (pid ${st?.pid})${st?.enclaveUrl ? ` \xB7 announced address ${st.enclaveUrl}` : ""}`);
  } else {
    row("Agent", `${KO} stopped${st?.updatedAt ? dim(` (last seen ${ago(Date.now() - Date.parse(st.updatedAt))} ago)`) : ""}`);
  }
  const green2 = report.checks.filter((x) => x.ok).length;
  row("Diagnostics", report.ok ? `${OK} ${green2}/${report.checks.length} green, nothing blocking ${dim("(details: archive-node doctor)")}` : `${KO} ${plural(report.blocking.length, "blocking issue", "blocking issues")}: ${report.blocking.join(", ")} ${dim("(details: archive-node doctor)")}`);
  out();
  const web = cfg?.web ?? DEFAULT_WEB;
  let next = null;
  if (!report.ok) next = "archive-node doctor, then fix the \u2717 lines";
  else if (!cfg) next = "archive-node pair";
  else if (!agentAlive || !c?.running) next = upCommand(lastMode ?? mode);
  else if (remote?.ok && remote.machine.registered === false) next = `register the enclave from the site: ${web}/#/operateur`;
  if (next) out(`${ARROW} Next step: ${bold(next)}`);
  return report.ok ? 0 : 1;
}

// src/index.ts
var API = { api: { type: "string" } };
var UP = {
  ...API,
  product: { type: "string" },
  port: { type: "string" },
  image: { type: "string" },
  demo: { type: "boolean" },
  // --key est lu pour être refusé avec une explication (la clé passe par --key-file ou ARCHIVE_KEY)
  key: { type: "string" },
  "key-file": { type: "string" },
  "public-url": { type: "string" },
  tunnel: { type: "boolean" }
};
var upFlags = (v2) => ({
  product: str(v2.product),
  port: str(v2.port),
  image: str(v2.image),
  demo: v2.demo === true,
  key: str(v2.key),
  keyFile: str(v2["key-file"]),
  publicUrl: str(v2["public-url"]),
  tunnel: v2.tunnel === true,
  api: str(v2.api)
});
function noPositionals(p, cmd) {
  if (p.length) throw new UsageError(`unexpected argument \u201C${p[0]}\u201D (see: archive-node ${cmd} --help).`);
}
var COMMANDS = ["doctor", "pair", "up", "status", "logs", "service", "help"];
function help(text) {
  out(text ?? HELP.main);
  return 0;
}
async function main(argv) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    err(`archive-node needs Node.js 20 or later (you have ${process.version}): https://nodejs.org (or: nvm install 22).`);
    return 1;
  }
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") return help(HELP.main);
  if (cmd === "-V" || cmd === "--version" || cmd === "version") {
    out(VERSION);
    return 0;
  }
  if (cmd === "help") return help(HELP[rest[0] ?? "main"]);
  switch (cmd) {
    case "doctor": {
      const { values: v2, positionals } = parseCommand(rest, { ...API, json: { type: "boolean" }, port: { type: "string" }, demo: { type: "boolean" } }, cmd);
      if (v2.help) return help(HELP.doctor);
      noPositionals(positionals, cmd);
      const cfg = loadConfig();
      const api = resolveApi(str(v2.api), cfg);
      const c = str(v2.port) ? null : await inspectContainer();
      const port = str(v2.port) ? parsePort(str(v2.port)) : c?.hostPort ?? DEFAULT_PORT;
      const demo = v2.demo === true || c?.labels["io.archive.mode"] === "demo";
      const r = await runDoctor({ api, port, demo });
      if (v2.json) out(JSON.stringify(doctorJson(r), null, 2));
      else {
        let next = null;
        if (process.env.ARCHIVE_INSTALLING) next = null;
        else if (r.ok && !cfg) next = "archive-node pair";
        else if (r.ok && !r.facts.container?.running) next = upCommand(r.mode);
        printDoctor(r, next);
      }
      return r.ok ? 0 : 1;
    }
    case "pair": {
      const { values: v2, positionals } = parseCommand(rest, { ...API, force: { type: "boolean" }, yes: { type: "boolean", short: "y" }, operator: { type: "string" } }, cmd);
      if (v2.help) return help(HELP.pair);
      noPositionals(positionals, cmd);
      return pairCommand({ api: str(v2.api), force: v2.force === true, yes: v2.yes === true, operator: str(v2.operator) });
    }
    case "up": {
      const { values: v2, positionals } = parseCommand(rest, UP, cmd);
      if (v2.help) return help(HELP.up);
      noPositionals(positionals, cmd);
      return runUp(upFlags(v2));
    }
    case "status": {
      const { values: v2, positionals } = parseCommand(rest, { ...API, json: { type: "boolean" }, port: { type: "string" } }, cmd);
      if (v2.help) return help(HELP.status);
      noPositionals(positionals, cmd);
      return statusCommand({ api: str(v2.api), port: str(v2.port), json: v2.json === true });
    }
    case "logs": {
      const { values: v2, positionals } = parseCommand(rest, { follow: { type: "boolean", short: "f" }, tail: { type: "string", short: "n" } }, cmd);
      if (v2.help) return help(HELP.logs);
      noPositionals(positionals, cmd);
      return logsCommand({ follow: v2.follow === true, tail: str(v2.tail) ? parseCount(str(v2.tail), "--tail", 1e5) : void 0 });
    }
    case "service": {
      const [sub, ...more] = rest;
      if (!sub || sub === "-h" || sub === "--help" || sub === "help") return help(HELP.service);
      if (sub === "install") {
        const { values: v2, positionals } = parseCommand(more, UP, "service");
        if (v2.help) return help(HELP.service);
        noPositionals(positionals, "service");
        return serviceInstall(upFlags(v2));
      }
      if (sub === "uninstall") {
        const { values: v2, positionals } = parseCommand(more, {}, "service");
        if (v2.help) return help(HELP.service);
        noPositionals(positionals, "service");
        return serviceUninstall();
      }
      throw new UsageError(`unknown subcommand \u201Cservice ${sub}\u201D: install or uninstall.`);
    }
  }
  const guess = COMMANDS.find((c) => c.startsWith(cmd.slice(0, 2).toLowerCase()));
  throw new UsageError(`unknown command \u201C${cmd}\u201D${guess ? ` (did you mean \u201C${guess}\u201D?)` : ""}. See: archive-node --help`);
}
main(process.argv.slice(2)).then(
  async (code) => {
    await flush();
    process.exit(code);
  },
  async (e) => {
    if (e instanceof CliError) {
      err(e.exitCode === 130 ? e.message : `${red("Error")}: ${e.message}`);
      await flush();
      process.exit(e.exitCode);
    }
    err(`${red("Unexpected error")}: ${errMsg(e)}`);
    if (process.env.ARCHIVE_DEBUG) err(String(e?.stack ?? e));
    else err(dim("Run again with ARCHIVE_DEBUG=1 for the technical details."));
    await flush();
    process.exit(1);
  }
);
