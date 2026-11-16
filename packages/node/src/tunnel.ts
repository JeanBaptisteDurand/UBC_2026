/** tunnel.ts — une adresse https publique sans rien configurer : tunnel rapide cloudflared (trycloudflare.com). */
import { spawn, type ChildProcess } from "node:child_process";
import { run } from "./exec";

export interface Tunnel {
  url: string;
  child: ChildProcess;
  alive: boolean;
  stop(): Promise<void>;
}

/** l'URL publique dans la sortie de cloudflared (pas api.trycloudflare.com, cité dans ses erreurs) */
export function parseTunnelUrl(line: string): string | null {
  for (const m of line.matchAll(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi)) {
    if (m[1]!.toLowerCase() !== "api") return m[0];
  }
  return null;
}

export async function cloudflaredAvailable(): Promise<boolean> {
  const r = await run("cloudflared", ["--version"], { timeoutMs: 8000 });
  return !r.missing && r.code === 0;
}

export const CLOUDFLARED_HELP =
  "install cloudflared (macOS: brew install cloudflared; Debian/Ubuntu: curl -fsSLo cloudflared.deb " +
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared.deb), " +
  "or give your own address with --public-url";

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* déjà mort */
      }
      resolve();
    }, 3000);
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

/** lance « cloudflared tunnel --url http://localhost:{port} » et rend l'URL dès qu'elle est annoncée */
export function startQuickTunnel(port: number, onExit: (code: number | null, tail: string[]) => void, timeoutMs = 45_000): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
    const tail: string[] = [];
    let settled = false;
    const tunnel: Tunnel = { url: "", child, alive: true, stop: () => stopChild(child) };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const onData = (buf: Buffer) => {
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
    // on lit la sortie jusqu'au bout, sinon le tuyau se remplit et cloudflared se bloque
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
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
        reject(new Error(`cloudflared gave no address within ${Math.round(timeoutMs / 1000)} s (${tail.slice(-1)[0] ?? "no output"})`));
      });
    }, timeoutMs);
  });
}
