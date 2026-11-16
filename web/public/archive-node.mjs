#!/usr/bin/env node
import { createRequire as _cr } from 'module'; const require = _cr(import.meta.url);

// src/agent.ts
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
var DEFAULT_IMAGE = "ghcr.io/jeanbaptistedurand/archive-sealed-chat@sha256:f7b9a5b7e6fe3fc1a1519d34920a6d08e645755564234ece16723c18423cc316";
var PRODUCT_TDX = 6;
var PRODUCT_DEMO = 8;
var HEARTBEAT_MS = 3e4;
var HEARTBEAT_STARTING_MS = 5e3;
var STARTUP_GRACE_MS = 12e4;
var MAX_LOG_LINES = 100;
var CLOCK_MAX_SKEW_S = 30;
var DSTACK_SOCKET = "/var/run/dstack.sock";
var TDX_DEVICES = ["/dev/tdx_guest", "/dev/tdx-guest"];
var TSM_REPORT_DIR = "/sys/kernel/config/tsm/report";
var LABEL_OWNER = "io.archive.owner";
var RUN_SPEC = "2";

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
    throw new CliError(`Le fichier ${p} est illisible : supprimez-le, puis appairez \xE0 nouveau avec archive-node pair.`);
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
    throw new UsageError(`${what} : adresse invalide \xAB ${raw} \xBB (attendu : http(s)://h\xF4te:port).`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UsageError(`${what} : seules les adresses http:// ou https:// sont accept\xE9es (\xAB ${raw} \xBB).`);
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
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 2e4, maxBuffer: 32 * 1024 * 1024, encoding: "utf8", signal: opts.signal, windowsHide: true },
      (error, stdout, stderr) => {
        const so = String(stdout ?? "");
        const se = String(stderr ?? "");
        if (!error) return resolve({ code: 0, stdout: so, stderr: se });
        const e = error;
        if (e.name === "AbortError") return resolve({ code: null, stdout: so, stderr: se, aborted: true });
        if (typeof e.code === "string") return resolve({ code: null, stdout: so, stderr: se || e.message, missing: e.code === "ENOENT" });
        resolve({ code: typeof e.code === "number" ? e.code : null, stdout: so, stderr: se, timedOut: !!e.killed && !!e.signal });
      }
    );
  });
}
function lastLine(s) {
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? "").replace(/^(Error response from daemon|docker): /i, "").slice(0, 240);
}

// src/ui.ts
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
  return new Promise((resolve) => process.stdout.write("", () => resolve()));
}
var stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
function pad(s, n) {
  const len = [...stripAnsi(s)].length;
  return len >= n ? s : s + " ".repeat(n - len);
}
var GLUE_AFTER = /* @__PURE__ */ new Set(["archive-node", "sudo", "docker", "systemctl", "curl", "brew", "mount", "modprobe", "timedatectl", "usermod", "launchctl", "nvm", "\xAB", "|"]);
function wrap(text, width, indent) {
  if (!Number.isFinite(width) || width < 20) return text;
  const chunks = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const prev = chunks[chunks.length - 1];
    const prevWord = prev?.split(" ").pop() ?? "";
    const glue = prev !== void 0 && (/^[-|»]/.test(w) || GLUE_AFTER.has(prevWord) || /^-/.test(prevWord) && !/[.;,:)]$/.test(prevWord));
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
  return `${h} h ${String(m % 60).padStart(2, "0")}`;
}
var hhmmss = (d = /* @__PURE__ */ new Date()) => d.toTimeString().slice(0, 8);
var fmtInt = (n) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
var fmtSeconds = (s) => {
  const a = Math.abs(s);
  return `${a < 10 ? a.toFixed(1).replace(".", ",") : Math.round(a)} s`;
};
var FONT = {
  A: ".###.|#...#|#####|#...#|#...#",
  B: "####.|#...#|####.|#...#|####.",
  C: ".####|#....|#....|#....|.####",
  D: "####.|#...#|#...#|#...#|####.",
  E: "#####|#....|####.|#....|#####",
  F: "#####|#....|####.|#....|#....",
  G: ".####|#....|#..##|#...#|.####",
  H: "#...#|#...#|#####|#...#|#...#",
  I: "#####|..#..|..#..|..#..|#####",
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
  "-": ".....|.....|.###.|.....|....."
};
function bigText(text) {
  const rows = ["", "", "", "", ""];
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch];
    if (!g) return null;
    g.split("|").forEach((r, i) => {
      rows[i] += r.replace(/#/g, "\u2588").replace(/\./g, " ") + " ";
    });
  }
  return rows.map((r) => r.trimEnd());
}

// src/docker.ts
async function dockerState(signal) {
  const r = await run("docker", ["version", "--format", "{{.Server.Version}}"], { timeoutMs: 12e3, signal });
  if (r.missing) {
    return { ok: false, kind: "missing", detail: "Docker n'est pas install\xE9. Linux : curl -fsSL https://get.docker.com | sh ; macOS : Docker Desktop (ou OrbStack, Colima)." };
  }
  if (r.timedOut) return { ok: false, kind: "timeout", detail: "Docker ne r\xE9pond pas (plus de 12 s) : red\xE9marrez Docker, puis relancez." };
  const v = r.stdout.trim();
  if (r.code === 0 && v) return { ok: true, version: v };
  const e = r.stderr;
  if (/permission denied/i.test(e)) {
    return { ok: false, kind: "permission", detail: "Docker est install\xE9 mais votre utilisateur n'a pas acc\xE8s au d\xE9mon : sudo usermod -aG docker $USER, puis reconnectez-vous (ou lancez avec sudo)." };
  }
  if (/cannot connect|is the docker daemon running|error during connect|daemon is not running|no such file or directory/i.test(e)) {
    return { ok: false, kind: "daemon", detail: "Docker est install\xE9 mais le d\xE9mon ne tourne pas : lancez Docker Desktop (macOS) ou sudo systemctl start docker (Linux)." };
  }
  return { ok: false, kind: "other", detail: `Docker r\xE9pond mal : ${lastLine(e) || `code ${r.code}`}` };
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
var PRIVATE_IMAGE_HELP = "L'image de l'enclave est priv\xE9e pour l'instant : connectez Docker au registre avec le jeton fourni par l'\xE9quipe ArcHive (docker login ghcr.io -u <utilisateur>), ou construisez l'image depuis enclave/Dockerfile (docker build -t archive-sealed-chat:local enclave/) et relancez avec --image archive-sealed-chat:local.";
function pullErrorFr(stderr, image) {
  if (/no matching manifest|does not match the specified platform/i.test(stderr)) {
    return `L'image ${image} n'existe pas pour ce processeur (${process.arch}) : utilisez une machine x86-64 ou une autre image (--image).`;
  }
  if (/unauthorized|denied|authentication required|forbidden|manifest unknown|not found|does not exist|may require 'docker login'/i.test(stderr)) {
    return `${PRIVATE_IMAGE_HELP} (Docker : ${lastLine(stderr)})`;
  }
  if (/timeout|tls handshake|no such host|dial tcp|connection refused|network is unreachable|i\/o timeout/i.test(stderr)) {
    return `T\xE9l\xE9chargement de l'image impossible (r\xE9seau) : v\xE9rifiez l'acc\xE8s \xE0 ${image.split("/")[0]} (Docker : ${lastLine(stderr)}).`;
  }
  return `T\xE9l\xE9chargement de l'image impossible : ${lastLine(stderr) || "erreur inconnue"}.`;
}
function runErrorFr(stderr, port) {
  if (/port is already allocated|address already in use|bind for/i.test(stderr)) {
    return `Le port ${port} est d\xE9j\xE0 utilis\xE9 sur cette machine : lib\xE9rez-le ou relancez avec --port ${port + 1}.`;
  }
  if (/is already in use by container|conflict/i.test(stderr)) {
    return `Un autre conteneur s'appelle d\xE9j\xE0 ${CONTAINER} : docker rm -f ${CONTAINER}, puis relancez.`;
  }
  if (/dstack\.sock/i.test(stderr)) return `Montage de ${DSTACK_SOCKET} impossible : ${lastLine(stderr)}.`;
  return `Docker n'a pas pu lancer l'enclave : ${lastLine(stderr) || "erreur inconnue"}.`;
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
    ...s.dstack ? ["-v", `${DSTACK_SOCKET}:${DSTACK_SOCKET}`] : [],
    ...Object.entries(s.labels).flatMap(([k, v]) => ["--label", `${k}=${v}`]),
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
function netErrorFr(e, timeoutMs = 1e4) {
  const x = e;
  if (x?.name === "TimeoutError") return `pas de r\xE9ponse en ${Math.round(timeoutMs / 1e3)} s`;
  if (x?.name === "AbortError") return "requ\xEAte annul\xE9e";
  if (/bad port/i.test(x?.cause?.message ?? x?.message ?? "")) return "port refus\xE9 par le client HTTP (port r\xE9serv\xE9 : choisissez-en un autre)";
  switch (x?.cause?.code ?? x?.code) {
    case "ECONNREFUSED":
      return "connexion refus\xE9e (rien n'\xE9coute \xE0 cette adresse)";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "nom d'h\xF4te introuvable (DNS)";
    case "ECONNRESET":
    case "UND_ERR_SOCKET":
      return "connexion coup\xE9e par le serveur";
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return "d\xE9lai de connexion d\xE9pass\xE9 (pare-feu ?)";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "r\xE9seau injoignable";
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "certificat TLS refus\xE9 (horloge fausse ou proxy ?)";
  }
  return String(x?.cause?.message ?? x?.message ?? e);
}
function apiErrorFr(r) {
  const m = typeof r.json?.error === "string" ? r.json.error : r.text.replace(/\s+/g, " ").trim().slice(0, 160);
  return `HTTP ${r.status}${m ? ` : ${m}` : ""}`;
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
function modeFr(m) {
  if (m === "dstack") return "dstack (VM Intel TDX, quote r\xE9el par l'agent dstack)";
  if (m === "tdx") return "TDX (VM Intel TDX)";
  return "sans TDX (essai local seulement : une attestation simul\xE9e ne peut pas s'inscrire)";
}
var upCommand = (m) => m === "demo" ? `archive-node up --demo   (essai local ; pour servir le r\xE9seau, louez une VM Intel TDX : Phala Cloud d\xE8s 0,06 $/h)` : `archive-node up --product ${PRODUCT_TDX} --tunnel`;
async function osDescription() {
  const p = platform();
  if (p === "linux") {
    let pretty = "Linux";
    try {
      pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(readFileSync2("/etc/os-release", "utf8"))?.[1] ?? pretty;
    } catch {
    }
    return `${pretty} \xB7 noyau ${release()} \xB7 ${arch()}`;
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
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}
function tryListen(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", (e) => resolve(e.code === "EACCES" ? "denied" : "busy"));
    srv.listen({ port, host: "0.0.0.0", exclusive: true }, () => srv.close(() => resolve("free")));
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
  os: "Syst\xE8me",
  node: "Node.js",
  docker: "Docker",
  tdx_guest: "VM Intel TDX",
  tsm_report: "Rapport TSM (configfs)",
  dstack_socket: "Agent dstack",
  clock: "Horloge",
  rpc: "RPC d'Arc",
  api: "API ArcHive",
  port: "Port de l'enclave",
  enclave_health: "Sant\xE9 de l'enclave",
  attest: "Cl\xE9s d'attestation"
};
var clip = (s, n = 300) => s.length <= n ? s : s.slice(0, n - 1) + "\u2026";
async function probe(url, init) {
  try {
    const r = await request(url, init);
    return { ok: r.ok, status: r.status, json: r.json, ms: r.ms, skewS: r.skewS, error: r.ok ? void 0 : apiErrorFr(r) };
  } catch (e) {
    return { ok: false, error: netErrorFr(e, init.timeoutMs) };
  }
}
var cleanStop = (c) => !c.oomKilled && [0, 137, 143].includes(c.exitCode);
function quoteFr(q) {
  if (typeof q !== "string" || q === "0x" || q === "") return "pas encore de quote (il est produit \xE0 l'inscription depuis le site)";
  if (q.toLowerCase().startsWith("0x4d4f434b2d544458")) return "dernier quote simul\xE9 (mode d\xE9mo)";
  return `dernier quote TDX r\xE9el (${fmtInt((q.length - 2) / 2)} octets)`;
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
  if (p === "linux") add("os", true, osDesc + (process.arch !== "x64" ? " \xB7 TDX exige un processeur Intel x86-64 : mode d\xE9mo seulement" : ""));
  else if (p === "darwin") add("os", true, `${osDesc} : pas de TDX sur Mac : essai local seulement, la machine ne peut pas servir le r\xE9seau`);
  else if (p === "win32") add("os", false, "Windows n'est pas pris en charge : utilisez WSL 2 (Ubuntu) ou une VM Linux.");
  else add("os", false, `${osDesc} n'est pas pris en charge : utilisez Linux (VM Intel TDX) ou macOS pour la d\xE9mo.`);
  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= 20, major >= 20 ? `Node.js ${process.version}` : `Node.js ${process.version} est trop ancien : installez Node.js 20 ou plus (https://nodejs.org).`);
  add("docker", docker.ok, docker.ok ? `Docker ${docker.version}, d\xE9mon joignable` : docker.detail);
  const dev = tdxDevice();
  if (dev) add("tdx_guest", true, `${dev} pr\xE9sent : VM Intel TDX`);
  else if (mode === "dstack") add("tdx_guest", false, "Non visible ici : normal dans une CVM dstack, le quote passe par l'agent dstack.");
  else if (p === "darwin") add("tdx_guest", false, "Pas de TDX sur macOS : facultatif en mode d\xE9mo (attestation simul\xE9e, testnet seulement).");
  else add("tdx_guest", false, "Pas de /dev/tdx_guest : ce n'est pas une VM Intel TDX (ou le module manque : sudo modprobe tdx_guest). Facultatif en mode d\xE9mo (--demo) ; pour une vraie attestation : une VM TDX avec dstack (Phala Cloud).");
  if (hasTsmReport()) add("tsm_report", true, `${TSM_REPORT_DIR} pr\xE9sent (quotes TDX par configfs-tsm)`);
  else if (mode === "dstack") add("tsm_report", false, "Non visible ici : normal dans une CVM dstack.");
  else if (dev) add("tsm_report", false, `TDX pr\xE9sent mais ${TSM_REPORT_DIR} absent : sudo mount -t configfs none /sys/kernel/config (noyau 6.7 ou plus requis).`);
  else add("tsm_report", false, "Absent (pas de TDX) : sans lui, pas de vraie attestation, la machine ne peut pas s'inscrire.");
  if (hasDstack()) add("dstack_socket", true, `${DSTACK_SOCKET} pr\xE9sent : l'enclave obtiendra un vrai quote TDX par dstack.`);
  else if (mode === "tdx") add("dstack_socket", false, `Pas d'agent dstack (${DSTACK_SOCKET}) : l'image actuelle n'obtient un vrai quote que par dstack (Phala Cloud) ; sans lui, l'attestation reste simul\xE9e.`);
  else add("dstack_socket", false, "Pas d'agent dstack : normal hors d'une CVM dstack (Phala Cloud). Facultatif en mode d\xE9mo.");
  const skew = rpcP.skewS ?? apiP.skewS ?? null;
  const src = rpcP.skewS != null ? hostOf(rpc) : "l'API ArcHive";
  if (skew == null) add("clock", false, "Heure de r\xE9f\xE9rence illisible (RPC et API injoignables) : r\xE9tablissez le r\xE9seau, puis v\xE9rifiez l'horloge (Linux : timedatectl).");
  else if (Math.abs(skew) < CLOCK_MAX_SKEW_S) add("clock", true, `D\xE9calage de ${fmtSeconds(skew)} avec l'heure de ${src}`);
  else add("clock", false, `Horloge ${skew > 0 ? "en avance" : "en retard"} de ${fmtSeconds(skew)} sur ${src} : synchronisez-la (Linux : sudo timedatectl set-ntp true ; macOS : R\xE9glages \u203A G\xE9n\xE9ral \u203A Date et heure, r\xE9glage automatique).`);
  let block = null;
  try {
    block = typeof rpcP.json?.result === "string" ? Number(BigInt(rpcP.json.result)) : null;
  } catch {
    block = null;
  }
  if (rpcP.ok && block !== null) add("rpc", true, `RPC d'Arc testnet joignable (${hostOf(rpc)}) \xB7 bloc n\xB0 ${fmtInt(block)} \xB7 ${rpcP.ms} ms`);
  else {
    const why = rpcP.error ?? (typeof rpcP.json?.error?.message === "string" ? rpcP.json.error.message : "r\xE9ponse sans num\xE9ro de bloc");
    add("rpc", false, `RPC d'Arc injoignable (${rpc} : ${why}). V\xE9rifiez l'acc\xE8s Internet sortant en HTTPS (port 443)${rpcP.status === 429 ? " ; le RPC limite le d\xE9bit, r\xE9essayez dans un instant" : ""}.`);
  }
  if (apiP.ok && apiP.json?.ok === true) add("api", true, `API ArcHive joignable (${o.api} \xB7 ${apiP.ms} ms)`);
  else add("api", false, `API ArcHive injoignable (${o.api}/health : ${apiP.error ?? "r\xE9ponse inattendue"}). V\xE9rifiez --api ou ARCHIVE_API, et que ce port sortant est ouvert.`);
  const portLabel = `Port de l'enclave (${o.port})`;
  const ours = !!container && container.hostPort === o.port && (container.running || container.restarting);
  if (ours) add("port", true, `Port ${o.port} : utilis\xE9 par l'enclave ArcHive (conteneur ${CONTAINER})`, portLabel);
  else if (portState === "free") add("port", true, `Port ${o.port} libre`, portLabel);
  else if (portState === "denied") add("port", false, `Port ${o.port} interdit (ports < 1024 r\xE9serv\xE9s \xE0 root) : choisissez un port \u2265 1024 (--port 8802).`, portLabel);
  else {
    const who = await portOwner(o.port);
    add("port", false, `Port ${o.port} d\xE9j\xE0 pris par un autre programme${who ? ` (${who})` : ""} : arr\xEAtez-le ou choisissez un autre port (--port ${o.port + 1}).`, portLabel);
  }
  const healthOk = health.ok && health.json?.ok === true;
  const up = upCommand(mode);
  if (!container) {
    if (healthOk) add("enclave_health", true, `Une enclave r\xE9pond sur ${local}/health (hors conteneur ${CONTAINER}, ${health.ms} ms)`);
    else add("enclave_health", false, `L'enclave n'est pas lanc\xE9e : ${up}.`);
  } else if (container.restarting) {
    add("enclave_health", false, `L'enclave red\xE9marre en boucle (${plural(container.restartCount, "red\xE9marrage", "red\xE9marrages")}) : archive-node logs pour voir l'erreur.`);
  } else if (!container.running && cleanStop(container)) {
    add("enclave_health", false, `L'enclave est arr\xEAt\xE9e (arr\xEAt normal) : ${up}.`);
  } else if (!container.running) {
    add("enclave_health", false, `L'enclave s'est arr\xEAt\xE9e sur une erreur (code de sortie ${container.exitCode}${container.oomKilled ? ", m\xE9moire \xE9puis\xE9e" : ""}) : archive-node logs pour comprendre, puis ${up}.`);
  } else if (healthOk) {
    add("enclave_health", true, `L'enclave r\xE9pond sur ${local}/health (${health.ms} ms)`);
  } else if (container.hostPort && container.hostPort !== o.port) {
    add("enclave_health", false, `Le conteneur ${CONTAINER} publie le port ${container.hostPort}, pas ${o.port} : relancez avec --port ${container.hostPort}.`);
  } else {
    add("enclave_health", false, `Le conteneur tourne mais l'enclave ne r\xE9pond pas sur 127.0.0.1:${o.port} (${health.error ?? "r\xE9ponse inattendue"}) : elle d\xE9marre peut-\xEAtre encore ; sinon archive-node logs.`);
  }
  const signer = typeof keys.json?.signer === "string" && /^0x[0-9a-fA-F]{40}$/.test(keys.json.signer) ? keys.json.signer : null;
  const x25519 = typeof keys.json?.x25519 === "string" && /^0x[0-9a-fA-F]{64}$/.test(keys.json.x25519) ? keys.json.x25519 : null;
  if (signer && x25519) add("attest", true, `signer ${short(signer)} \xB7 x25519 ${short(x25519)} \xB7 ${quoteFr(keys.json?.lastQuote)}`);
  else if (!healthOk) add("attest", false, "Cl\xE9s de l'enclave indisponibles : l'enclave ne r\xE9pond pas (voir \xAB Sant\xE9 de l'enclave \xBB).");
  else add("attest", false, `/pubkeys ne renvoie pas signer + x25519 (${keys.error ?? "champs absents"}) : image d'enclave incompatible ? V\xE9rifiez --image.`);
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
  out(`${bold("archive-node")} ${r.version} \xB7 diagnostic de \xAB ${r.hostname} \xBB`);
  out(`Mode : ${modeFr(r.mode)}${r.mode !== r.detected ? dim(" (forc\xE9 par --demo)") : ""}`);
  out();
  printChecks(r);
  out();
  const green2 = r.checks.filter((c) => c.ok).length;
  const optional = r.checks.filter((c) => !c.ok && !r.required.includes(c.id)).length;
  if (r.ok) {
    out(`${OK} Aucun point bloquant : ${green2}/${r.checks.length} au vert${optional ? dim(` (${optional} facultatif${optional > 1 ? "s" : ""} ici, marqu\xE9${optional > 1 ? "s" : ""} \xB7)`) : ""}.`);
  } else {
    out(`${KO} ${plural(r.blocking.length, "point bloquant", "points bloquants")} : corrigez les lignes \u2717, puis relancez archive-node doctor.`);
  }
  if (next) out(`${ARROW} \xC9tape suivante : ${bold(next)}`);
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
    throw new UsageError(parseErrorFr(e, cmd));
  }
}
function parseErrorFr(e, cmd) {
  const x = e;
  const opt = /'(-{1,2}[^' ]+)/.exec(x.message ?? "")?.[1] ?? "";
  const help2 = `voir : archive-node ${cmd} --help`;
  switch (x.code) {
    case "ERR_PARSE_ARGS_UNKNOWN_OPTION":
      return `option inconnue ${opt} (${help2}).`;
    case "ERR_PARSE_ARGS_INVALID_OPTION_VALUE":
      return /argument missing/i.test(x.message ?? "") ? `l'option ${opt} attend une valeur (${help2}).` : `l'option ${opt} ne prend pas de valeur (${help2}).`;
    case "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL":
      return `argument inattendu (${help2}).`;
  }
  return `${x.message ?? String(e)} (${help2}).`;
}
var str = (v) => typeof v === "string" ? v : void 0;
function parsePort(v, flag = "--port") {
  const n = Number(v);
  if (!/^\d+$/.test(v.trim()) || !Number.isInteger(n) || n < 1 || n > 65535) {
    throw new UsageError(`${flag} : port invalide \xAB ${v} \xBB (attendu : un entier entre 1 et 65535).`);
  }
  return n;
}
function parseProduct(v) {
  const n = Number(v);
  if (!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(n)) {
    throw new UsageError(`--product : num\xE9ro de produit invalide \xAB ${v} \xBB (attendu : un entier, par exemple 8).`);
  }
  return n;
}
function parseCount(v, flag, max) {
  const n = Number(v);
  if (!/^\d+$/.test(v.trim()) || n < 1 || n > max) throw new UsageError(`${flag} : nombre invalide \xAB ${v} \xBB (entre 1 et ${max}).`);
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
var CLOUDFLARED_HELP = "installez cloudflared (macOS : brew install cloudflared ; Debian/Ubuntu : curl -fsSLo cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared.deb), ou donnez votre propre adresse avec --public-url";
function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
      resolve();
    }, 3e3);
    child.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(t);
      resolve();
    }
  });
}
function startQuickTunnel(port, onExit, timeoutMs = 45e3) {
  return new Promise((resolve, reject) => {
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
            resolve(tunnel);
          });
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (e) => {
      tunnel.alive = false;
      finish(() => reject(new Error(`cloudflared ne d\xE9marre pas : ${e.message}`)));
    });
    child.once("exit", (code) => {
      tunnel.alive = false;
      if (settled) onExit(code, tail);
      else finish(() => reject(new Error(`cloudflared s'est arr\xEAt\xE9 (code ${code}) : ${tail.slice(-2).join(" | ") || "aucune sortie"}`)));
    });
    const timer = setTimeout(() => {
      finish(() => {
        child.kill("SIGTERM");
        reject(new Error(`cloudflared n'a pas donn\xE9 d'adresse en ${Math.round(timeoutMs / 1e3)} s (${tail.slice(-1)[0] ?? "aucune sortie"})`));
      });
    }, timeoutMs);
  });
}

// src/agent.ts
var NO_TDX_HELP = `Pas de TDX sur cette machine (ni /dev/tdx_guest, ni agent dstack).
Pour la faire tourner en d\xE9monstration (attestation simul\xE9e, testnet seulement) : ${upCommand("demo")}`;
function planUp(f, opts) {
  const port = parsePort(f.port ?? String(DEFAULT_PORT));
  const image = (f.image ?? DEFAULT_IMAGE).trim();
  if (!image || /\s/.test(image) || image.startsWith("-")) throw new UsageError(`--image : r\xE9f\xE9rence d'image invalide \xAB ${f.image} \xBB.`);
  const publicUrl = f.publicUrl ? normalizeUrl(f.publicUrl, "--public-url") : null;
  if (f.key && !/^arcop_[A-Za-z0-9_-]{8,}$/.test(f.key)) throw new UsageError("--key : cl\xE9 op\xE9rateur invalide (attendu : arcop_\u2026).");
  const detected = detectMode();
  const mode = f.demo ? "demo" : detected;
  if (mode === "demo" && !f.demo) throw new CliError(NO_TDX_HELP);
  const product = parseProduct(f.product ?? String(mode === "demo" ? PRODUCT_DEMO : PRODUCT_TDX));
  const cfg = loadConfig();
  const key = f.key ?? cfg?.key ?? "";
  if (opts.requireKey && !key) {
    throw new CliError("Cette machine n'est pas appair\xE9e : lancez d'abord archive-node pair (ou passez --key arcop_\u2026).");
  }
  const api = resolveApi(f.api, cfg);
  return {
    api,
    key,
    keyFromConfig: !f.key || f.key === cfg?.key,
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
var STATUS_FR = { starting: "d\xE9marrage", running: "en service", error: "en erreur", stopped: "arr\xEAt\xE9e" };
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
      throw new CliError(`Un agent archive-node tourne d\xE9j\xE0 sur cette machine (pid ${st.pid}).
Arr\xEAtez-le d'abord : Ctrl+C dans son terminal, ou sudo systemctl stop archive-node.`);
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
      this.tickPromise = this.tick().catch((e) => this.note("error", `Erreur interne de l'agent : ${errMsg(e)}`));
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
      "io.archive.mode": this.p.mode
    };
  }
  /** le conteneur tourne avec la bonne configuration (sinon : on le crée, le relance ou le remplace) */
  async ensureEnclave() {
    const sig = this.ac.signal;
    const ds = await dockerState(sig);
    if (!ds.ok) throw new Error(ds.detail);
    const want = this.labels();
    const c = await inspectContainer(CONTAINER, sig);
    if (c && Object.entries(want).every(([k, v]) => c.labels[k] === v)) {
      if (c.running || c.restarting || this.stopping) return;
      this.note("info", `Relance du conteneur ${CONTAINER} (il \xE9tait arr\xEAt\xE9)`);
      const r2 = await run("docker", ["start", CONTAINER], { timeoutMs: 6e4, signal: sig });
      if (r2.code !== 0) {
        if (r2.aborted) return;
        throw new Error(runErrorFr(r2.stderr, this.p.port));
      }
      this.containerStartedAt = Date.now();
      return;
    }
    let platform4 = await imagePlatform(this.p.image, sig);
    if (!platform4) {
      if (this.stopping) return;
      this.note("info", `T\xE9l\xE9chargement de l'image ${short(this.p.image, 60, 8)} (la premi\xE8re fois : une \xE0 quelques minutes)\u2026`, "pull");
      const beat = () => void this.collectLogs(sig).then((logs) => this.heartbeat("starting", null, logs, 1e4));
      if (!this.lastBeatAt || Date.now() - this.lastBeatAt > 2e4) beat();
      const keepAlive = setInterval(beat, HEARTBEAT_MS);
      let r2 = await pullImage(this.p.image, null, sig);
      if (r2.code !== 0 && !r2.aborted && process.arch !== "x64" && /no matching manifest/i.test(r2.stderr)) {
        this.note("info", "Image x86-64 uniquement : t\xE9l\xE9chargement pour linux/amd64 (ex\xE9cution \xE9mul\xE9e sur ce processeur)", "pull-amd64");
        r2 = await pullImage(this.p.image, "linux/amd64", sig);
      }
      clearInterval(keepAlive);
      if (r2.code !== 0) {
        if (r2.aborted) return;
        throw new Error(pullErrorFr(r2.stderr, this.p.image));
      }
      platform4 = await imagePlatform(this.p.image, sig);
      this.note("ok", "Image t\xE9l\xE9charg\xE9e");
    }
    if (this.stopping) return;
    if (c) {
      this.note("info", c.labels[LABEL_OWNER] ? `Configuration chang\xE9e : remplacement du conteneur ${CONTAINER}` : `Un conteneur ${CONTAINER} existait d\xE9j\xE0 (lanc\xE9 \xE0 la main) : il est remplac\xE9`);
      const r2 = await run("docker", ["rm", "-f", CONTAINER], { timeoutMs: 6e4, signal: sig });
      if (r2.code !== 0) throw new Error(`Impossible de retirer l'ancien conteneur ${CONTAINER} : ${lastLine(r2.stderr)}`);
    }
    if (this.stopping) return;
    const arch2 = platform4?.split("/")[1];
    const r = await run(
      "docker",
      runArgs({
        port: this.p.port,
        product: this.p.product,
        image: this.p.image,
        platform: platform4 && arch2 && arch2 !== hostDockerArch() ? platform4 : null,
        dstack: this.p.mode !== "demo" && hasDstack(),
        labels: want
      }),
      { timeoutMs: 12e4, signal: sig }
    );
    if (r.code !== 0) {
      if (r.aborted) return;
      throw new Error(runErrorFr(r.stderr, this.p.port));
    }
    this.containerStartedAt = Date.now();
    this.note("ok", `Enclave lanc\xE9e : conteneur ${CONTAINER} (${r.stdout.trim().slice(0, 12)}), port ${this.p.port}, produit n\xB0 ${this.p.product}${this.p.mode === "demo" ? ", attestation simul\xE9e" : ""}`);
  }
  computeStatus(report, launchError) {
    if (launchError) return { status: "error", reason: launchError };
    const c = report.facts.container;
    const health = report.checks.find((x) => x.id === "enclave_health");
    if (!c) return { status: "error", reason: `conteneur ${CONTAINER} introuvable` };
    if (c.running && health?.ok) return { status: "running", reason: "" };
    if ((c.running || c.state === "created") && !c.restarting) {
      const since = c.startedAt ?? this.containerStartedAt ?? Date.now();
      if (Date.now() - since < STARTUP_GRACE_MS) return { status: "starting", reason: "" };
    }
    return { status: "error", reason: health?.detail ?? `conteneur ${c.state}` };
  }
  setStatus(s, reason, report) {
    const changed = s !== this.status || s === "error" && reason !== this.lastError || !this.announced;
    this.status = s;
    this.lastError = s === "error" ? reason : null;
    if (!changed) return;
    this.announced = true;
    if (s === "running") {
      const a = report.checks.find((c) => c.id === "attest");
      this.note("ok", `Enclave en service sur le port ${this.p.port}${a?.ok ? ` \xB7 ${a.detail}` : ""}`);
    } else if (s === "starting") this.note("info", "L'enclave d\xE9marre\u2026");
    else if (s === "error") this.note("error", `Enclave en erreur : ${reason}`);
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
      this.setApi("unreachable", `API injoignable (${netErrorFr(e, timeoutMs)}) : nouvel essai dans 30 s, l'enclave continue de tourner.`);
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
          if (reg) this.note("ok", "Enclave inscrite sur Arc : elle peut recevoir des sessions pay\xE9es en USDC.");
          else this.note("info", `Pas encore inscrite sur Arc : sur le site, onglet Op\xE9rateur, cliquez \xAB Inscrire \xBB (signature du wallet) \u2192 ${this.web()}/#/operateur`);
        }
        out(dim(`${hhmmss()} \u2665 battement n\xB0 ${this.beats} \xB7 ${STATUS_FR[status]}`));
      }
      return true;
    }
    this.lastBeatOk = false;
    if (r.status === 401 || r.status === 403) {
      this.setApi("unauthorized", `L'API refuse la cl\xE9 op\xE9rateur (${apiErrorFr(r)}) : appairez \xE0 nouveau avec archive-node pair --force. L'enclave continue de tourner.`);
    } else if (r.status === 404) {
      this.setApi("missing", `Cette API ne re\xE7oit pas encore les battements de c\u0153ur (POST /machines/heartbeat \u2192 404) : v\xE9rifiez --api.`);
    } else {
      this.setApi(`http-${r.status}`, `L'API a refus\xE9 le battement de c\u0153ur (${apiErrorFr(r)}).`);
    }
    return false;
  }
  setApi(state, message) {
    if (state === this.apiState) return;
    const first = this.apiState === "";
    this.apiState = state;
    if (state === "ok") {
      if (first) this.note("ok", `Reli\xE9e au site : machine ${short(this.machineId, 8, 4)} \xB7 compte ${short(this.operator)}`);
      else this.note("ok", "Liaison avec l'API r\xE9tablie");
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
        this.note("warn", `cloudflared n'est pas install\xE9, donc pas de tunnel : ${CLOUDFLARED_HELP}. Adresse annonc\xE9e en attendant : ${this.fallbackUrl()}`, "no-cloudflared");
        this.tunnelRetryAt = Date.now() + 5 * 6e4;
        return;
      }
      try {
        const t = await startQuickTunnel(this.p.port, (code) => {
          if (!this.stopping) this.note("warn", `Le tunnel cloudflared s'est arr\xEAt\xE9 (code ${code}) : r\xE9ouverture au prochain battement, avec une nouvelle adresse.`);
        });
        if (this.stopping) {
          await t.stop();
          return;
        }
        this.tunnel = t;
        this.note("ok", `Adresse publique (tunnel cloudflared) : ${t.url}`);
      } catch (e) {
        this.tunnelRetryAt = Date.now() + 6e4;
        this.note("warn", `Tunnel cloudflared impossible : ${errMsg(e)}. Adresse annonc\xE9e en attendant : ${this.fallbackUrl()}`);
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
    out(`${bold("archive-node")} ${VERSION} \xB7 \xAB ${hostname2()} \xBB rejoint la ruche ArcHive`);
    out(`  Mode      ${modeFr(p.mode)}${p.mode !== p.detected ? dim(" (forc\xE9 par --demo)") : ""}`);
    out(`  Produit   n\xB0 ${p.product} \xB7 port ${p.port}${p.mode === "demo" ? ` ${WARN} sans TDX : essai local, cette machine ne peut pas s'inscrire (une attestation simul\xE9e ne prouve rien)` : ""}`);
    out(`  Image     ${p.image}`);
    out(`  API       ${p.api} \xB7 cl\xE9 ${maskKey(p.key)}${kid ? ` (n\xB0 ${kid})` : ""}${p.keyFromConfig ? dim(` \xB7 ${tilde(configPath())}`) : ""}`);
    if (p.keyFromConfig && p.cfg?.api && p.cfg.api !== p.api) {
      out(`  ${WARN} La cl\xE9 a \xE9t\xE9 d\xE9livr\xE9e par ${p.cfg.api} mais sera envoy\xE9e \xE0 ${p.api}.`);
    }
    if (p.publicUrl) out(`  Adresse   ${p.publicUrl}`);
    else if (p.tunnel) out(`  Adresse   tunnel cloudflared (ouverture\u2026)`);
    else {
      out(`  Adresse   ${this.fallbackUrl()}`);
      if (!this.ip || this.ip.isPrivate) {
        out(`  ${WARN} Adresse ${this.ip ? "priv\xE9e" : "locale"} : le site ne pourra sans doute pas joindre l'enclave. Ajoutez --tunnel ou --public-url https://\u2026`);
      }
    }
    out(dim("  Ctrl+C arr\xEAte l'enclave et pr\xE9vient le site."));
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
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      ctl.signal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
  }
  async shutdown(sig) {
    if (this.stopping) {
      err(`
${KO} Arr\xEAt forc\xE9.`);
      process.exit(130);
    }
    this.stopping = true;
    out();
    this.note("info", `Arr\xEAt demand\xE9 (${sig}) : arr\xEAt de l'enclave et dernier battement de c\u0153ur\u2026`);
    this.ac.abort();
    this.sleepAbort?.abort();
    await Promise.race([this.tickPromise ?? Promise.resolve(), new Promise((r2) => setTimeout(r2, 1e4))]);
    await this.tunnel?.stop().catch(() => void 0);
    const r = await run("docker", ["stop", "-t", "10", CONTAINER], { timeoutMs: 3e4 });
    if (r.code === 0) this.note("ok", `Enclave arr\xEAt\xE9e (conteneur ${CONTAINER} stopp\xE9 ; archive-node up le relance)`);
    const ok = await this.heartbeat("stopped", this.lastDoctor, await this.collectLogs(), 5e3);
    this.note(ok ? "ok" : "warn", ok ? "Site pr\xE9venu : machine arr\xEAt\xE9e." : "Le site n'a pas pu \xEAtre pr\xE9venu : il verra la machine hors ligne d'ici 90 s.");
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
var API_HELP = `  --api <url>          API ArcHive (d\xE9faut : $ARCHIVE_API, sinon celle de l'appairage, sinon ${DEFAULT_API})`;
var HELP = {
  main: `archive-node ${VERSION} : l'agent op\xE9rateur d'ArcHive

Fait tourner une enclave ArcHive sur cette machine et la relie \xE0 votre compte (votre wallet)
sur le site. Votre cl\xE9 priv\xE9e ne quitte jamais votre wallet : la machine re\xE7oit une cl\xE9
op\xE9rateur (arcop_\u2026) qui ne peut rien d\xE9penser.

Usage : archive-node <commande> [options]

Commandes :
  doctor               V\xE9rifie que la machine est pr\xEAte (Docker, TDX, horloge, r\xE9seau, enclave)
  pair                 Appaire la machine \xE0 votre wallet avec un code (HIVE-XXXX)
  up                   Lance l'enclave et envoie son \xE9tat au site toutes les 30 s
  status               R\xE9sume l'\xE9tat local et ce que le site sait de la machine
  logs                 Affiche les journaux de l'enclave (-f pour les suivre)
  service install      Lance l'agent au d\xE9marrage (systemd ; \xE9quivalent launchd sur macOS)
  service uninstall    Retire ce service

Options :
  -h, --help           Aide (aussi : archive-node <commande> --help)
  -V, --version        Version

D\xE9marrage rapide :
  archive-node doctor
  archive-node pair
  archive-node up --product ${PRODUCT_TDX} --tunnel            VM Intel TDX (dstack) : sert le r\xE9seau
  archive-node up --demo                                       essai local sans TDX (rien n'est inscrit)

Fichiers : ~/.archive/node.json (cl\xE9 op\xE9rateur, droits 0600) \xB7 ~/.archive/state.json (dernier \xE9tat)
Variables : ARCHIVE_API, ARCHIVE_HOME (au lieu de ~/.archive), ARCHIVE_RPC, NO_COLOR, ARCHIVE_DEBUG`,
  doctor: `archive-node doctor : v\xE9rifie que cette machine est pr\xEAte \xE0 faire tourner une enclave ArcHive.

Usage : archive-node doctor [--json] [--port <n>] [--demo] [--api <url>]

V\xE9rifie, dans l'ordre : os, node, docker, tdx_guest, tsm_report, dstack_socket, clock, rpc,
api, port, enclave_health, attest. Chaque ligne dit quoi faire si elle n'est pas au vert.
Mode d\xE9tect\xE9 : dstack si /var/run/dstack.sock existe, tdx si /dev/tdx_guest existe, sinon d\xE9mo
(en d\xE9mo, les v\xE9rifications TDX sont facultatives et marqu\xE9es \xB7).

Options :
  --json               Sortie JSON (scripts, copilote)
  --port <n>           Port de l'enclave \xE0 v\xE9rifier (d\xE9faut : celui du conteneur, sinon ${DEFAULT_PORT})
  --demo               \xC9valuer la machine en mode d\xE9mo (TDX facultatif)
${API_HELP}

Code de sortie : 0 sans point bloquant, 1 sinon.`,
  pair: `archive-node pair : appaire cette machine \xE0 votre compte (votre wallet) avec un code.

Usage : archive-node pair [--force] [--api <url>]

La machine affiche un code (HIVE-XXXX) et une adresse. Ouvrez-la, entrez le code et signez avec
votre wallet : aucune transaction, aucun frais. La machine re\xE7oit alors une cl\xE9 op\xE9rateur arcop_\u2026,
qui ne peut rien d\xE9penser, rang\xE9e dans ~/.archive/node.json (lisible par vous seul).

Options :
  --force              Appairer \xE0 nouveau m\xEAme si la machine l'est d\xE9j\xE0 (nouvelle cl\xE9)
${API_HELP}`,
  up: `archive-node up : lance l'enclave dans Docker et envoie son \xE9tat au site toutes les 30 s
(diagnostic, statut, 100 derni\xE8res lignes de journal, cl\xE9s publiques, adresse).

Usage : archive-node up [options]

Options :
  --product <n>        Produit servi par l'enclave (d\xE9faut : ${PRODUCT_TDX} ; avec --demo, essai local, rien n'est inscrit)
  --port <n>           Port de l'enclave sur cette machine (d\xE9faut : ${DEFAULT_PORT})
  --image <r\xE9f>        Image de l'enclave (d\xE9faut : sealed-chat, \xE9pingl\xE9e par digest)
  --demo               Machine sans TDX : attestation simul\xE9e, testnet seulement
  --tunnel             Adresse https publique automatique (tunnel rapide cloudflared)
  --public-url <url>   Votre propre adresse publique pour l'enclave (prioritaire sur --tunnel)
  --key <arcop_\u2026>      Cl\xE9 op\xE9rateur (d\xE9faut : celle de ~/.archive/node.json)
${API_HELP}

Sans --tunnel ni --public-url, l'adresse annonc\xE9e est http://<IP de la machine>:<port>.
Sans TDX, --demo est obligatoire. Ctrl+C arr\xEAte l'enclave et pr\xE9vient le site.
Lancement au d\xE9marrage : archive-node service install (m\xEAmes options).

Exemples :
  archive-node up --product ${PRODUCT_TDX} --tunnel            VM Intel TDX (dstack) : sert le r\xE9seau
  archive-node up --demo                                       essai local sans TDX (rien n'est inscrit)`,
  status: `archive-node status : l'\xE9tat de la machine en un coup d'\u0153il.

Usage : archive-node status [--json] [--port <n>] [--api <url>]

Montre l'appairage (compte, machine, cl\xE9 masqu\xE9e), ce que le site sait (en ligne, dernier
battement de c\u0153ur, inscription sur Arc), le conteneur, l'agent et le r\xE9sum\xE9 du diagnostic.

Options :
  --json               Sortie JSON
  --port <n>           Port de l'enclave (d\xE9faut : celui du conteneur)
${API_HELP}`,
  logs: `archive-node logs : les journaux de l'enclave (conteneur archive-enclave).

Usage : archive-node logs [-f] [-n <lignes>]

Options :
  -f, --follow         Suivre les nouvelles lignes (Ctrl+C pour arr\xEAter)
  -n, --tail <n>       Nombre de lignes depuis la fin (d\xE9faut : 200)`,
  service: `archive-node service : lancer l'agent au d\xE9marrage de la machine.

Usage :
  archive-node service install [options de up]
  archive-node service uninstall

Linux : \xE9crit une unit\xE9 systemd (/etc/systemd/system/archive-node.service) qui lance
\xAB archive-node up \xBB avec les m\xEAmes options, en tant que vous. Sans les droits root, l'unit\xE9 est
\xE9crite dans ~/.archive et les trois commandes sudo \xE0 lancer sont affich\xE9es.
macOS : affiche l'\xE9quivalent launchd (agent de session).
La cl\xE9 op\xE9rateur n'est jamais \xE9crite dans le service : appairez d'abord avec archive-node pair.

Options de install : --product, --port, --image, --demo, --tunnel, --public-url, --api (voir archive-node up --help)`
};

// src/logs.ts
import { spawn as spawn2 } from "node:child_process";
async function logsCommand(f) {
  const ds = await dockerState();
  if (!ds.ok) throw new CliError(ds.detail);
  if (!await inspectContainer()) {
    throw new CliError(`Aucun conteneur ${CONTAINER} sur cette machine : lancez d'abord ${upCommand(detectMode())}.`);
  }
  const args = ["logs", "--tail", String(f.tail ?? 200), ...f.follow ? ["--follow"] : [], CONTAINER];
  return new Promise((resolve) => {
    const child = spawn2("docker", args, { stdio: "inherit" });
    const onSig = () => {
    };
    process.on("SIGINT", onSig);
    child.once("error", (e) => {
      process.removeListener("SIGINT", onSig);
      resolve(Promise.reject(new CliError(`docker logs impossible : ${e.message}`)));
    });
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", onSig);
      resolve(signal ? 0 : code ?? 1);
    });
  });
}

// src/pair.ts
import { hostname as hostname3 } from "node:os";
var clampNum = (v, min, max, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
var Waiting = class {
  constructor(deadline2) {
    this.deadline = deadline2;
    if (isTTY()) {
      this.timer = setInterval(() => this.draw(), 1e3);
      this.draw();
    } else out("En attente de votre signature sur le site\u2026");
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
    process.stdout.write(`\r\x1B[2K  ${cyan(f)} En attente de votre signature\u2026 ${dim(`(expire dans ${mmss}${this.note ? ` \xB7 ${this.note}` : ""} \xB7 Ctrl+C pour annuler)`)}`);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stdout.write("\r\x1B[2K");
    }
  }
};
async function pairCommand(f) {
  const existing = loadConfig();
  const mode = detectMode();
  if (existing && !f.force) {
    out(`Cette machine est d\xE9j\xE0 appair\xE9e : compte ${short(existing.operator)} \xB7 machine ${short(existing.machineId, 8, 4)} \xB7 cl\xE9 ${maskKey(existing.key)}.`);
    out(`${ARROW} Pour l'appairer \xE0 nouveau (nouvelle cl\xE9) : ${bold("archive-node pair --force")}`);
    out(`${ARROW} Pour lancer l'enclave : ${bold(upCommand(mode))}`);
    return 0;
  }
  const api = resolveApi(f.api, existing);
  const host = hostname3();
  let start;
  try {
    start = await request(`${api}/pair/start`, { body: { hostname: host, mode, version: VERSION }, timeoutMs: 1e4 });
  } catch (e) {
    throw new CliError(`Impossible de joindre l'API ArcHive (${api}) : ${netErrorFr(e)}.
V\xE9rifiez l'adresse (--api ou ARCHIVE_API) et la connexion, ou lancez archive-node doctor.`);
  }
  if (start.status === 404) {
    throw new CliError(`Cette API ne propose pas encore l'appairage (POST ${api}/pair/start \u2192 404).
V\xE9rifiez l'adresse (--api ou ARCHIVE_API), ou r\xE9essayez quand l'API sera \xE0 jour.`);
  }
  if (!start.ok) throw new CliError(`L'API a refus\xE9 de d\xE9marrer l'appairage (${apiErrorFr(start)}).`);
  const s = start.json ?? {};
  if (typeof s.deviceCode !== "string" || typeof s.userCode !== "string" || typeof s.verifyUrl !== "string") {
    throw new CliError("R\xE9ponse inattendue de l'API \xE0 /pair/start (deviceCode, userCode ou verifyUrl manquant).");
  }
  const code = s.userCode;
  const interval = clampNum(s.interval, 1, 60, 3) * 1e3;
  const expiresIn = clampNum(s.expiresIn, 30, 3600, 900) * 1e3;
  const deadline2 = Date.now() + expiresIn;
  out(`${bold("archive-node")} ${VERSION} \xB7 appairage de \xAB ${host} \xBB (mode ${modeFr(mode).split(" ")[0]})`);
  out();
  out(`  Ouvrez ${cyan(s.verifyUrl)}`);
  out(`  et entrez le code ${bold(code)}, puis signez avec votre wallet.`);
  out();
  const big = isTTY() && columns() >= 64 ? bigText(code) : null;
  if (big) {
    for (const row of big) out(`    ${bold(row)}`);
    out();
  }
  out(dim(`  Le code expire dans ${Math.round(expiresIn / 6e4)} min. La signature ne co\xFBte rien et n'envoie aucune transaction.`));
  out();
  const ac = new AbortController();
  const onSig = () => ac.abort();
  process.once("SIGINT", onSig);
  const wait = new Waiting(deadline2);
  let delay = interval;
  try {
    for (; ; ) {
      await sleep(delay, ac.signal);
      if (ac.signal.aborted) throw new CliError("Appairage annul\xE9.", 130);
      if (Date.now() > deadline2 + 3e4) throw new CliError("Le code a expir\xE9 avant d'\xEAtre valid\xE9 : relancez archive-node pair.");
      let r;
      try {
        r = await request(`${api}/pair/poll`, { body: { deviceCode: s.deviceCode }, timeoutMs: 1e4, signal: ac.signal });
      } catch (e) {
        if (ac.signal.aborted) throw new CliError("Appairage annul\xE9.", 130);
        wait.setNote(`API injoignable (${netErrorFr(e)}), nouvel essai\u2026`);
        continue;
      }
      if (r.status === 429) {
        delay = Math.min(delay + 2e3, 3e4);
        continue;
      }
      if (r.status === 404) throw new CliError("L'API ne reconna\xEEt plus cette demande d'appairage (red\xE9marr\xE9e ?) : relancez archive-node pair.");
      if (!r.ok) {
        if (r.status >= 500) {
          wait.setNote(`l'API r\xE9pond ${r.status}, nouvel essai\u2026`);
          continue;
        }
        throw new CliError(`Erreur de l'API pendant l'attente (${apiErrorFr(r)}).`);
      }
      wait.setNote("");
      const st = r.json?.status;
      if (st === "pending") continue;
      if (st === "expired") throw new CliError("Le code a expir\xE9 avant d'\xEAtre valid\xE9 : relancez archive-node pair.");
      if (st === "consumed") throw new CliError("Ce code a d\xE9j\xE0 servi (la cl\xE9 n'est remise qu'une seule fois) : relancez archive-node pair.");
      if (st !== "approved") throw new CliError(`R\xE9ponse inattendue de l'API \xE0 /pair/poll (statut \xAB ${String(st)} \xBB).`);
      const key = r.json?.key;
      if (typeof key !== "string" || !/^arcop_[A-Za-z0-9_-]{8,}$/.test(key)) throw new CliError("L'API a valid\xE9 l'appairage mais n'a pas renvoy\xE9 de cl\xE9 op\xE9rateur valide.");
      const machineId = typeof r.json?.machineId === "string" ? r.json.machineId : null;
      const operator = typeof r.json?.operator === "string" ? r.json.operator : null;
      let web = null;
      try {
        web = new URL(s.verifyUrl).origin;
      } catch {
        web = null;
      }
      saveConfig({ api, key, machineId, operator, web, pairedAt: (/* @__PURE__ */ new Date()).toISOString() });
      wait.stop();
      const kid = keyIdOf(key);
      out(`${OK} Machine appair\xE9e au compte ${bold(short(operator))}${machineId ? ` (machine ${short(machineId, 8, 4)})` : ""}.`);
      out(`  Cl\xE9 op\xE9rateur ${maskKey(key)}${kid ? ` (n\xB0 ${kid})` : ""} enregistr\xE9e dans ${tilde(configPath())}, lisible par vous seul.`);
      out(dim("  Elle ne peut rien d\xE9penser : la caution et l'inscription sur Arc restent sign\xE9es par votre wallet."));
      out();
      out(`${ARROW} \xC9tape suivante : ${bold(upCommand(mode))}`);
      return 0;
    }
  } finally {
    wait.stop();
    process.removeListener("SIGINT", onSig);
  }
}

// src/service.ts
import { existsSync as existsSync3, readFileSync as readFileSync3, realpathSync, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir2, platform as platform3, userInfo } from "node:os";
import { dirname as dirname2, join as join2 } from "node:path";
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
  return a;
}
function systemdQuote(s) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;
}
var envQuote = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;
function renderSystemdUnit(u) {
  return [
    "# G\xE9n\xE9r\xE9 par \xAB archive-node service install \xBB : l'agent op\xE9rateur d'ArcHive.",
    "# La cl\xE9 op\xE9rateur n'est pas ici : elle reste dans ~/.archive/node.json (droits 0600).",
    "[Unit]",
    "Description=ArcHive : agent op\xE9rateur (archive-node)",
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
    ...Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`),
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
    for (const line of readFileSync3("/etc/passwd", "utf8").split("\n")) {
      const f = line.split(":");
      if (f[0] === user && f[5]) return f[5];
    }
  } catch {
  }
  return null;
}
function scriptPath() {
  const a = process.argv[1];
  if (!a) throw new CliError("Impossible de retrouver le chemin d'archive-node.");
  try {
    return realpathSync(a);
  } catch {
    return a;
  }
}
async function serviceInstall(f) {
  if (f.key) {
    throw new UsageError("--key n'est pas accept\xE9 ici : la cl\xE9 finirait en clair dans le fichier de service. Appairez d'abord la machine (archive-node pair), le service lira ~/.archive/node.json.");
  }
  const plan = planUp(f, { requireKey: false });
  const program = [stableNodePath(), scriptPath(), ...upArgsFromPlan(plan, f)];
  const os = platform3();
  if (os === "darwin") {
    const log = join2(archiveDir(), "archive-node.log");
    const plistPath = `~/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;
    out(`${bold("macOS")} n'a pas systemd : l'\xE9quivalent est un agent launchd. Enregistrez ceci dans ${bold(plistPath)} :`);
    out();
    const env = { PATH: servicePath() };
    if (process.env.ARCHIVE_HOME?.trim()) env.ARCHIVE_HOME = process.env.ARCHIVE_HOME.trim();
    out(renderLaunchdPlist(program, env, log));
    out();
    out("Puis chargez-le (il d\xE9marrera \xE0 chaque ouverture de session, Docker Desktop doit \xEAtre lanc\xE9) :");
    out(`  launchctl bootstrap gui/$(id -u) ${plistPath}`);
    out(dim(`Arr\xEAt : launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL} \xB7 journaux : tail -f ${tilde(log)}`));
    if (!plan.key) out(`${WARN} Machine pas encore appair\xE9e : lancez archive-node pair avant de charger l'agent.`);
    return 0;
  }
  if (os !== "linux") throw new CliError(`Service non pris en charge sur ${os} : lancez archive-node up dans un terminal.`);
  const sd = await run("systemctl", ["--version"], { timeoutMs: 5e3 });
  if (sd.missing || sd.code !== 0) {
    throw new CliError("Pas de systemd sur cette machine (systemctl introuvable) : lancez archive-node up dans un terminal, ou dans tmux/screen pour qu'il survive \xE0 la d\xE9connexion.");
  }
  const isRoot = process.getuid?.() === 0;
  const sudoUser = isRoot && process.env.SUDO_USER && process.env.SUDO_USER !== "root" ? process.env.SUDO_USER : null;
  const user = sudoUser ?? userInfo().username;
  const home = sudoUser ? homeOf(sudoUser) ?? homedir2() : homedir2();
  const archiveHome = process.env.ARCHIVE_HOME?.trim() || void 0;
  const unit = renderSystemdUnit({ user, home, path: servicePath(), archiveHome, execStart: program });
  const cfgFile = join2(archiveHome ?? join2(home, ".archive"), "node.json");
  const warnings = [];
  if (!existsSync3(cfgFile)) warnings.push(`Machine pas encore appair\xE9e pour ${user} (${cfgFile} absent) : lancez archive-node pair, sinon le service s'arr\xEAtera aussit\xF4t.`);
  if (user !== "root") {
    const g = await run("id", ["-nG", user], { timeoutMs: 3e3 });
    if (g.code === 0 && !g.stdout.split(/\s+/).includes("docker")) {
      warnings.push(`L'utilisateur ${user} n'est pas dans le groupe docker : sudo usermod -aG docker ${user} (sinon le service ne pourra pas lancer l'enclave).`);
    }
  }
  if (!isRoot) {
    const local = join2(archiveDir(), `${UNIT_NAME}.service`);
    writePrivateFile(local, unit);
    out(`Unit\xE9 systemd \xE9crite dans ${bold(tilde(local))} (lanc\xE9e en tant que ${user}).`);
    out("Il faut les droits root pour l'installer ; ex\xE9cutez :");
    out(`  sudo install -m 644 ${local} ${UNIT_PATH}`);
    out("  sudo systemctl daemon-reload");
    out(`  sudo systemctl enable --now ${UNIT_NAME}`);
    out(dim(`Suivre : journalctl -u ${UNIT_NAME} -f \xB7 arr\xEAter : sudo systemctl stop ${UNIT_NAME}`));
    for (const w of warnings) out(`${WARN} ${w}`);
    return 0;
  }
  writeFileSync2(UNIT_PATH, unit, { mode: 420 });
  for (const args of [["daemon-reload"], ["enable", UNIT_NAME], ["restart", UNIT_NAME]]) {
    const r = await run("systemctl", args, { timeoutMs: 6e4 });
    if (r.code !== 0) throw new CliError(`systemctl ${args.join(" ")} a \xE9chou\xE9 : ${lastLine(r.stderr) || `code ${r.code}`}`);
  }
  out(`${OK} Service ${bold(UNIT_NAME)} install\xE9 (${UNIT_PATH}), activ\xE9 au d\xE9marrage et lanc\xE9 en tant que ${user}.`);
  out(`${ARROW} Suivre : journalctl -u ${UNIT_NAME} -f \xB7 \xE9tat : archive-node status`);
  for (const w of warnings) out(`${WARN} ${w}`);
  return 0;
}
async function serviceUninstall() {
  const os = platform3();
  if (os === "darwin") {
    out("Sur macOS, retirez l'agent launchd :");
    out(`  launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL}`);
    out(`  rm ~/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`);
    return 0;
  }
  if (os !== "linux") throw new CliError(`Service non pris en charge sur ${os}.`);
  if (process.getuid?.() !== 0) {
    out("Il faut les droits root ; ex\xE9cutez :");
    out(`  sudo systemctl disable --now ${UNIT_NAME}`);
    out(`  sudo rm ${UNIT_PATH}`);
    out("  sudo systemctl daemon-reload");
    return 0;
  }
  if (!existsSync3(UNIT_PATH)) {
    out(`Aucun service ${UNIT_NAME} install\xE9 (${UNIT_PATH} absent).`);
    return 0;
  }
  await run("systemctl", ["disable", "--now", UNIT_NAME], { timeoutMs: 9e4 });
  unlinkSync(UNIT_PATH);
  await run("systemctl", ["daemon-reload"], { timeoutMs: 3e4 });
  out(`${OK} Service ${UNIT_NAME} arr\xEAt\xE9 et retir\xE9.`);
  return 0;
}

// src/status.ts
async function fetchMachine(api, id) {
  try {
    const r = await request(`${api}/machines/${encodeURIComponent(id)}`, { timeoutMs: 8e3 });
    if (r.ok && r.json && typeof r.json === "object") return { ok: true, machine: r.json };
    return { ok: false, error: apiErrorFr(r), gone: r.status === 404 };
  } catch (e) {
    return { ok: false, error: netErrorFr(e, 8e3) };
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
    cfg?.machineId ? fetchMachine(api, cfg.machineId) : Promise.resolve(null),
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
  out(`${bold("archive-node")} ${VERSION} \xB7 \xE9tat de \xAB ${report.hostname} \xBB`);
  out();
  const row = (label, text) => out(`  ${label.padEnd(12)} ${text}`);
  if (cfg) {
    const kid = keyIdOf(cfg.key);
    row("Appairage", `${OK} compte ${short(cfg.operator)} \xB7 machine ${short(cfg.machineId, 8, 4)} \xB7 cl\xE9 ${maskKey(cfg.key)}${kid ? ` (n\xB0 ${kid})` : ""}`);
  } else row("Appairage", `${KO} pas encore appair\xE9e`);
  if (!cfg) row("Site", dim("\u2014"));
  else if (!cfg.machineId) row("Site", `${WARN} identifiant de machine inconnu : il arrive au premier battement de c\u0153ur (archive-node up)`);
  else if (!remote || !remote.ok) {
    row("Site", remote && remote.gone ? `${KO} machine inconnue de l'API (retir\xE9e depuis le site ?) : archive-node pair --force` : `${WARN} API injoignable (${remote?.error ?? "?"}) : ${api}`);
  } else {
    const m = remote.machine;
    const seen = typeof m.lastSeen === "number" ? `dernier battement il y a ${ago(Date.now() - m.lastSeen)}` : "jamais vue";
    row("Site", `${m.online ? `${OK} en ligne` : `${KO} hors ligne`} \xB7 ${seen} \xB7 statut \xAB ${m.status ?? "?"} \xBB`);
    row("", `inscrite sur Arc : ${m.registered ? "oui" : "non"} \xB7 diagnostic vu par le site : ${m.doctorOk === true ? "OK" : m.doctorOk === false ? "\xE0 corriger" : "en attente"}${m.enclaveUrl ? ` \xB7 ${m.enclaveUrl}` : ""}`);
  }
  if (!docker.ok) row("Enclave", `${KO} ${docker.detail}`);
  else if (!c) row("Enclave", `${KO} aucun conteneur archive-enclave`);
  else {
    const since = c.running && c.startedAt ? ` depuis ${ago(Date.now() - c.startedAt)}` : "";
    const stateFr = c.running ? `${OK} en marche${since}` : c.restarting ? `${KO} red\xE9marre en boucle` : `${KO} arr\xEAt\xE9e (code ${c.exitCode})`;
    row("Enclave", `${stateFr} \xB7 produit n\xB0 ${c.labels["io.archive.product"] ?? "?"} \xB7 port ${c.hostPort ?? "?"} \xB7 mode ${modeFr(c.labels["io.archive.mode"] ?? "demo").split(" ")[0]}`);
    row("", dim(c.image));
  }
  if (agentAlive) {
    row("Agent", `${OK} actif (pid ${st?.pid})${st?.enclaveUrl ? ` \xB7 adresse annonc\xE9e ${st.enclaveUrl}` : ""}`);
  } else {
    row("Agent", `${KO} arr\xEAt\xE9${st?.updatedAt ? dim(` (dernier passage il y a ${ago(Date.now() - Date.parse(st.updatedAt))})`) : ""}`);
  }
  const green2 = report.checks.filter((x) => x.ok).length;
  row("Diagnostic", report.ok ? `${OK} ${green2}/${report.checks.length} au vert, aucun point bloquant ${dim("(d\xE9tail : archive-node doctor)")}` : `${KO} ${plural(report.blocking.length, "point bloquant", "points bloquants")} : ${report.blocking.join(", ")} ${dim("(d\xE9tail : archive-node doctor)")}`);
  out();
  const web = cfg?.web ?? DEFAULT_WEB;
  let next = null;
  if (!report.ok) next = "archive-node doctor, puis corrigez les lignes \u2717";
  else if (!cfg) next = "archive-node pair";
  else if (!agentAlive || !c?.running) next = upCommand(lastMode ?? mode);
  else if (remote?.ok && remote.machine.registered === false) next = `inscrivez l'enclave depuis le site : ${web}/#/operateur`;
  if (next) out(`${ARROW} \xC9tape suivante : ${bold(next)}`);
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
  key: { type: "string" },
  "public-url": { type: "string" },
  tunnel: { type: "boolean" }
};
var upFlags = (v) => ({
  product: str(v.product),
  port: str(v.port),
  image: str(v.image),
  demo: v.demo === true,
  key: str(v.key),
  publicUrl: str(v["public-url"]),
  tunnel: v.tunnel === true,
  api: str(v.api)
});
function noPositionals(p, cmd) {
  if (p.length) throw new UsageError(`argument inattendu \xAB ${p[0]} \xBB (voir : archive-node ${cmd} --help).`);
}
var COMMANDS = ["doctor", "pair", "up", "status", "logs", "service", "help"];
function help(text) {
  out(text ?? HELP.main);
  return 0;
}
async function main(argv) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    err(`archive-node a besoin de Node.js 20 ou plus (vous avez ${process.version}) : https://nodejs.org (ou : nvm install 22).`);
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
      const { values: v, positionals } = parseCommand(rest, { ...API, json: { type: "boolean" }, port: { type: "string" }, demo: { type: "boolean" } }, cmd);
      if (v.help) return help(HELP.doctor);
      noPositionals(positionals, cmd);
      const cfg = loadConfig();
      const api = resolveApi(str(v.api), cfg);
      const c = str(v.port) ? null : await inspectContainer();
      const port = str(v.port) ? parsePort(str(v.port)) : c?.hostPort ?? DEFAULT_PORT;
      const demo = v.demo === true || c?.labels["io.archive.mode"] === "demo";
      const r = await runDoctor({ api, port, demo });
      if (v.json) out(JSON.stringify(doctorJson(r), null, 2));
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
      const { values: v, positionals } = parseCommand(rest, { ...API, force: { type: "boolean" } }, cmd);
      if (v.help) return help(HELP.pair);
      noPositionals(positionals, cmd);
      return pairCommand({ api: str(v.api), force: v.force === true });
    }
    case "up": {
      const { values: v, positionals } = parseCommand(rest, UP, cmd);
      if (v.help) return help(HELP.up);
      noPositionals(positionals, cmd);
      return runUp(upFlags(v));
    }
    case "status": {
      const { values: v, positionals } = parseCommand(rest, { ...API, json: { type: "boolean" }, port: { type: "string" } }, cmd);
      if (v.help) return help(HELP.status);
      noPositionals(positionals, cmd);
      return statusCommand({ api: str(v.api), port: str(v.port), json: v.json === true });
    }
    case "logs": {
      const { values: v, positionals } = parseCommand(rest, { follow: { type: "boolean", short: "f" }, tail: { type: "string", short: "n" } }, cmd);
      if (v.help) return help(HELP.logs);
      noPositionals(positionals, cmd);
      return logsCommand({ follow: v.follow === true, tail: str(v.tail) ? parseCount(str(v.tail), "--tail", 1e5) : void 0 });
    }
    case "service": {
      const [sub, ...more] = rest;
      if (!sub || sub === "-h" || sub === "--help" || sub === "help") return help(HELP.service);
      if (sub === "install") {
        const { values: v, positionals } = parseCommand(more, UP, "service");
        if (v.help) return help(HELP.service);
        noPositionals(positionals, "service");
        return serviceInstall(upFlags(v));
      }
      if (sub === "uninstall") {
        const { values: v, positionals } = parseCommand(more, {}, "service");
        if (v.help) return help(HELP.service);
        noPositionals(positionals, "service");
        return serviceUninstall();
      }
      throw new UsageError(`sous-commande inconnue \xAB service ${sub} \xBB : install ou uninstall.`);
    }
  }
  const guess = COMMANDS.find((c) => c.startsWith(cmd.slice(0, 2).toLowerCase()));
  throw new UsageError(`commande inconnue \xAB ${cmd} \xBB${guess ? ` (vouliez-vous dire \xAB ${guess} \xBB ?)` : ""}. Voir : archive-node --help`);
}
main(process.argv.slice(2)).then(
  async (code) => {
    await flush();
    process.exit(code);
  },
  async (e) => {
    if (e instanceof CliError) {
      err(e.exitCode === 130 ? e.message : `${red("Erreur")} : ${e.message}`);
      await flush();
      process.exit(e.exitCode);
    }
    err(`${red("Erreur inattendue")} : ${errMsg(e)}`);
    if (process.env.ARCHIVE_DEBUG) err(String(e?.stack ?? e));
    else err(dim("Relancez avec ARCHIVE_DEBUG=1 pour le d\xE9tail technique."));
    await flush();
    process.exit(1);
  }
);
