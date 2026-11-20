/** system.ts — what the machine knows of itself: mode (TDX, dstack, demo), system, IP address, port, running agent. */
import { existsSync, readFileSync } from "node:fs";
import { arch, networkInterfaces, platform, release } from "node:os";
import net from "node:net";
import { DSTACK_SOCKET, PRODUCT_DEMO, PRODUCT_TDX, TDX_DEVICES, TSM_REPORT_DIR } from "./constants";
import { run } from "./exec";

export type Mode = "tdx" | "dstack" | "demo";

export const tdxDevice = (): string | null => TDX_DEVICES.find((p) => existsSync(p)) ?? null;
export const hasTsmReport = (): boolean => existsSync(TSM_REPORT_DIR);
export const hasDstack = (): boolean => existsSync(DSTACK_SOCKET);

/** dstack if the dstack agent's socket exists, tdx if /dev/tdx_guest exists, otherwise demo */
export function detectMode(): Mode {
  if (hasDstack()) return "dstack";
  if (tdxDevice()) return "tdx";
  return "demo";
}

export function modeLabel(m: Mode): string {
  if (m === "dstack") return "dstack (Intel TDX VM, real quote through the dstack agent)";
  if (m === "tdx") return "TDX (Intel TDX VM)";
  return "no-TDX (local trial only: a simulated attestation can't register)";
}

/** the command the site shows, identical */
export const upCommand = (m: Mode): string =>
  m === "demo" ? `archive-node up --demo   (local trial; to serve the network, rent an Intel TDX VM: Phala Cloud from $0.06/h)` : `archive-node up --product ${PRODUCT_TDX} --tunnel`;

export async function osDescription(): Promise<string> {
  const p = platform();
  if (p === "linux") {
    let pretty = "Linux";
    try {
      pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(readFileSync("/etc/os-release", "utf8"))?.[1] ?? pretty;
    } catch {
      /* no /etc/os-release */
    }
    return `${pretty} · kernel ${release()} · ${arch()}`;
  }
  if (p === "darwin") {
    const r = await run("sw_vers", ["-productVersion"], { timeoutMs: 3000 });
    return `macOS ${r.code === 0 ? r.stdout.trim() : `(Darwin ${release()})`} (${arch()})`;
  }
  return `${p} ${release()} (${arch()})`;
}

export function isPrivateIPv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

// virtual interfaces (Docker, VPN, bridges): their address is never the one to announce
const VIRTUAL_IFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|cni|flannel|kube|cali|weave|tun|tap|utun|wg|tailscale|zt|lo|bridge|awdl|llw|anpi|gif|stf)/i;

/** the first non-internal IPv4 (public by preference) */
export function primaryIPv4(): { address: string; iface: string; isPrivate: boolean } | null {
  const cands: { address: string; iface: string; isPrivate: boolean }[] = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_IFACE.test(iface)) continue;
    for (const a of addrs ?? []) {
      const fam = String(a.family);
      if ((fam !== "IPv4" && fam !== "4") || a.internal) continue;
      cands.push({ address: a.address, iface, isPrivate: isPrivateIPv4(a.address) });
    }
  }
  return cands.find((c) => !c.isPrivate) ?? cands[0] ?? null;
}

export type PortState = "free" | "busy" | "denied";

/** free, taken, or forbidden (port < 1024 without root) */
export async function probePort(port: number): Promise<PortState> {
  if (await canConnect(port)) return "busy";
  return tryListen(port);
}

function canConnect(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

function tryListen(port: number): Promise<PortState> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", (e: NodeJS.ErrnoException) => resolve(e.code === "EACCES" ? "denied" : "busy"));
    srv.listen({ port, host: "0.0.0.0", exclusive: true }, () => srv.close(() => resolve("free")));
  });
}

/** "node, pid 1234": who listens on this port (if lsof is there) */
export async function portOwner(port: number): Promise<string | null> {
  const r = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { timeoutMs: 4000 });
  if (r.code !== 0) return null;
  const pid = /^p(\d+)/m.exec(r.stdout)?.[1];
  const cmd = /^c(.+)$/m.exec(r.stdout)?.[1];
  return pid ? `${cmd ?? "?"}, pid ${pid}` : null;
}

/** true if `pid` is a live archive-node agent (other than us) */
export async function isAgentAlive(pid: number | null | undefined): Promise<boolean> {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  const r = await run("ps", ["-p", String(pid), "-o", "command="], { timeoutMs: 3000 });
  return r.code === 0 && /archive-node/.test(r.stdout);
}
