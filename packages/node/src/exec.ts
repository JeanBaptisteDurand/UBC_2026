/** exec.ts — runs a system command (docker, cloudflared, systemctl…) without a shell, with a timeout and cancellation. */
import { execFile } from "node:child_process";

export interface ExecResult {
  /** exit code; null if the command could not run to the end */
  code: number | null;
  stdout: string;
  stderr: string;
  /** binary not found (ENOENT) */
  missing?: boolean;
  timedOut?: boolean;
  aborted?: boolean;
}

export function run(cmd: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 20_000, maxBuffer: 32 * 1024 * 1024, encoding: "utf8", signal: opts.signal, windowsHide: true },
      (error, stdout, stderr) => {
        const so = String(stdout ?? "");
        const se = String(stderr ?? "");
        if (!error) return resolve({ code: 0, stdout: so, stderr: se });
        const e = error as Error & { code?: string | number; killed?: boolean; signal?: string | null };
        if (e.name === "AbortError") return resolve({ code: null, stdout: so, stderr: se, aborted: true });
        if (typeof e.code === "string") return resolve({ code: null, stdout: so, stderr: se || e.message, missing: e.code === "ENOENT" });
        resolve({ code: typeof e.code === "number" ? e.code : null, stdout: so, stderr: se, timedOut: !!e.killed && !!e.signal });
      },
    );
  });
}

/** the last non-empty line of an output (docker's useful error message) */
export function lastLine(s: string): string {
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? "").replace(/^(Error response from daemon|docker): /i, "").slice(0, 240);
}
