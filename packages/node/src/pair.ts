/** pair.ts — "archive-node pair": pairing by code (a "device" flow, like a TV).
 *  The machine shows HIVE-XXXX-XXXX; a person approves it on the site by signing with their wallet; the machine receives
 *  an operator key arcop_… (which cannot spend anything).
 *  Before keeping it, the machine shows the FULL ADDRESS of the account that approved and asks for confirmation
 *  (y/N, no by default; "o" and "oui" are accepted too): a code seen by someone else and approved before you is
 *  refused here, and the API revokes the key (POST /pair/reject); this closes a finding of the security audit.
 *  Automation: --operator <address> accepts only that account; --yes accepts without asking. The key kept is stored
 *  with file mode 0600. The answer comes from the person at the terminal, after the address is shown: anything typed
 *  while waiting is discarded; a standard input that is not a terminal (pipe, script, `echo y |`) is never read:
 *  without a terminal, --operator or --yes is required, before a code is even requested.
 *  Messages are in English. */
import { hostname } from "node:os";
import { configPath, loadConfig, resolveApi, saveConfig, tilde } from "./config";
import { CliError, UsageError } from "./errors";
import { apiError, netError, request, type HttpResult } from "./net";
import { detectMode, modeLabel, upCommand } from "./system";
import { ARROW, OK, askYesNo, bold, codeBanner, columns, cyan, dim, isTTY, keyIdOf, maskKey, out, short } from "./ui";
import { VERSION } from "./version";

export interface PairFlags {
  api?: string;
  force?: boolean;
  /** accept the approving account without asking (automation) */
  yes?: boolean;
  /** accept only this account (safe automation): any other account is refused and its key revoked */
  operator?: string;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** without a terminal, nobody can both see the approving account's address AND answer; the decision is made beforehand */
export const NO_TTY =
  "standard input is not a terminal (pipe, script, cloud-init): the machine can't show you the account that will " +
  "approve the code and then read YOUR answer (an answer from a pipe, as in “echo y | archive-node pair”, doesn't prove " +
  "that anyone checked the address).\nRun it again in a terminal, or decide in advance: " +
  "--operator <the full address of YOUR wallet> (accepts only this account, recommended), or --yes (accepts whichever " +
  "account approves).";

const clampNum = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/** a waiting line that rewrites itself (terminal only) */
class Waiting {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private note = "";
  constructor(private deadline: number) {
    if (isTTY()) {
      this.timer = setInterval(() => this.draw(), 1000);
      this.draw();
    } else out("Waiting for your signature on the site…");
  }
  setNote(n: string) {
    this.note = n;
    if (!isTTY() && n) out(dim(n));
  }
  private draw() {
    const left = Math.max(0, Math.round((this.deadline - Date.now()) / 1000));
    const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    const f = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[this.frame++ % 10];
    process.stdout.write(`\r\x1b[2K  ${cyan(f!)} Waiting for your signature… ${dim(`(expires in ${mmss}${this.note ? ` · ${this.note}` : ""} · Ctrl+C to cancel)`)}`);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stdout.write("\r\x1b[2K");
    }
  }
}

/** Keep the key or not: `how` says why it is kept; otherwise `why`, and the exit code. */
type Verdict = { keep: true; how: string } | { keep: false; why: string; exitCode: number };

/** Shows the account that approved, in full, and decides (--operator, --yes, otherwise the y/N question). */
async function confirmOperator(operator: string, f: PairFlags, signal: AbortSignal): Promise<Verdict> {
  out(`${OK} Code approved on the site, by the account:`);
  out();
  out(`      ${bold(operator)}`);
  out();
  if (f.operator) {
    if (operator === f.operator.toLowerCase()) return { keep: true, how: "it is the expected account (--operator)" };
    return {
      keep: false, exitCode: 1,
      why: `This is not the expected account (--operator ${f.operator.toLowerCase()}): someone else approved the code. Pairing refused.`,
    };
  }
  if (f.yes) return { keep: true, how: "accepted without asking (--yes)" };
  out("  Is this YOUR wallet? The site shows the same address, in full, right after your signature.");
  out(dim("  If you don't recognize it, answer n: someone else approved your code, and their key will be revoked."));
  out();
  const a = await askYesNo("  Keep this pairing and save the key on this machine? [y/N] ", signal);
  if (a === "yes") return { keep: true, how: "confirmed on this machine" };
  if (a === "cancel") return { keep: false, exitCode: 130, why: "Pairing cancelled." };
  // pairCommand already required it before asking for a code: never reached, unless the terminal vanished in between
  if (a === "notty") return { keep: false, exitCode: 2, why: `Pairing refused: ${NO_TTY}` };
  if (a === "eof") return { keep: false, exitCode: 1, why: "No answer (input closed): refused by default." };
  return { keep: false, exitCode: 1, why: "Pairing refused." };
}

/** The key is not kept: the API revokes it, and the machine (never seen) leaves the account that approved it.
 *  Even with no answer from the API, nothing is lost: the key was handed to this machine alone, which does not keep it. */
async function rejectPairing(api: string, key: string): Promise<string> {
  try {
    const r = await request(`${api}/pair/reject`, { method: "POST", headers: { authorization: `Bearer ${key}` }, timeoutMs: 10_000 });
    if (r.ok) return "the key is not saved, the API revoked it, and the machine left the account that had approved it";
    return `the key is not saved (the API didn't revoke it: ${apiError(r)}; it was only given to this machine, nobody else can use it)`;
  } catch (e) {
    return `the key is not saved (API unreachable to revoke it: ${netError(e)}; it was only given to this machine, nobody else can use it)`;
  }
}

export async function pairCommand(f: PairFlags): Promise<number> {
  if (f.operator !== undefined && !ADDRESS_RE.test(f.operator.trim())) {
    throw new UsageError(`--operator: invalid address “${f.operator}” (expected: 0x followed by 40 hex characters, the full address of your wallet).`);
  }
  const flags: PairFlags = { ...f, operator: f.operator?.trim() };
  const existing = loadConfig();
  const mode = detectMode();
  if (existing && !flags.force) {
    out(`This machine is already paired: account ${existing.operator ?? "—"} · machine ${short(existing.machineId, 8, 4)} · key ${maskKey(existing.key)}.`);
    out(`${ARROW} To pair it again (new key): ${bold("archive-node pair --force")}`);
    out(`${ARROW} To start the enclave: ${bold(upCommand(mode))}`);
    return 0;
  }
  // without a terminal, the y/N question would not be read (askYesNo): say so BEFORE asking for a code, not 15 min later
  if (!flags.yes && !flags.operator && !process.stdin.isTTY) throw new UsageError(`${NO_TTY.charAt(0).toUpperCase()}${NO_TTY.slice(1)}`);
  const api = resolveApi(flags.api, existing);
  const host = hostname();

  // 1) demander un code
  let start: HttpResult;
  try {
    start = await request(`${api}/pair/start`, { body: { hostname: host, mode, version: VERSION }, timeoutMs: 10_000 });
  } catch (e) {
    throw new CliError(`Can't reach the ArcHive API (${api}): ${netError(e)}.\nCheck the address (--api or ARCHIVE_API) and the connection, or run archive-node doctor.`);
  }
  if (start.status === 404 && typeof start.json?.code !== "string") {
    throw new CliError(`This API doesn't offer pairing yet (POST ${api}/pair/start → 404).\nCheck the address (--api or ARCHIVE_API), or try again once the API is updated.`);
  }
  if (!start.ok) throw new CliError(`The API refused to start the pairing (${apiError(start)}).`);
  const s = start.json ?? {};
  if (typeof s.deviceCode !== "string" || typeof s.userCode !== "string" || typeof s.verifyUrl !== "string") {
    throw new CliError("Unexpected answer from the API to /pair/start (deviceCode, userCode or verifyUrl missing).");
  }
  const code: string = s.userCode;
  const interval = clampNum(s.interval, 1, 60, 3) * 1000;
  const expiresIn = clampNum(s.expiresIn, 30, 3600, 900) * 1000;
  const deadline = Date.now() + expiresIn;

  // 2) show the code, in big letters (readable on an 80-column terminal)
  out(`${bold("archive-node")} ${VERSION} · pairing “${host}” (mode ${modeLabel(mode).split(" ")[0]})`);
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
  out(dim(`  The code expires in ${Math.round(expiresIn / 60_000)} min. Signing is free and sends no transaction.`));
  out(dim("  Don't show this code to anyone: after the approval, this machine will ask you to confirm the account."));
  out();

  // 3) wait for the approval, then confirm it here
  const ac = new AbortController();
  const onSig = () => ac.abort();
  process.once("SIGINT", onSig);
  const wait = new Waiting(deadline);
  let delay = interval;
  try {
    for (;;) {
      await sleep(delay, ac.signal);
      if (ac.signal.aborted) throw new CliError("Pairing cancelled.", 130);
      if (Date.now() > deadline + 30_000) throw new CliError("The code expired before it was approved: run archive-node pair again.");
      let r: HttpResult;
      try {
        r = await request(`${api}/pair/poll`, { body: { deviceCode: s.deviceCode }, timeoutMs: 10_000, signal: ac.signal });
      } catch (e) {
        if (ac.signal.aborted) throw new CliError("Pairing cancelled.", 130);
        wait.setNote(`API unreachable (${netError(e)}), retrying…`);
        continue;
      }
      if (r.status === 429) {
        delay = Math.min(delay + 2000, 30_000);
        continue;
      }
      if (r.status === 404) throw new CliError("The API no longer knows this pairing request (restarted?): run archive-node pair again.");
      if (!r.ok) {
        if (r.status >= 500) {
          wait.setNote(`the API answers ${r.status}, retrying…`);
          continue;
        }
        throw new CliError(`API error while waiting (${apiError(r)}).`);
      }
      wait.setNote("");
      const st = r.json?.status;
      if (st === "pending") continue;
      if (st === "expired") throw new CliError("The code expired before it was approved: run archive-node pair again.");
      if (st === "consumed") throw new CliError("This code was already used (the key is handed out only once): run archive-node pair again.");
      if (st !== "approved") throw new CliError(`Unexpected answer from the API to /pair/poll (status “${String(st)}”).`);

      const key = r.json?.key;
      if (typeof key !== "string" || !/^arcop_[A-Za-z0-9_-]{8,}$/.test(key)) throw new CliError("The API approved the pairing but didn't send a valid operator key.");
      const machineId = typeof r.json?.machineId === "string" ? r.json.machineId : null;
      const rawOperator = r.json?.operator;
      const operator = typeof rawOperator === "string" && ADDRESS_RE.test(rawOperator) ? rawOperator.toLowerCase() : null;
      wait.stop();
      out();
      if (!operator) {
        throw new CliError(`The API approved the pairing without saying which account approved it: to be safe, ${await rejectPairing(api, key)}.\nRun archive-node pair again.`);
      }

      // 4) the person confirms the account (full address) before the key is saved
      const verdict = await confirmOperator(operator, flags, ac.signal);
      if (!verdict.keep) {
        const what = await rejectPairing(api, key);
        throw new CliError(
          `${verdict.why}\n${what.charAt(0).toUpperCase()}${what.slice(1)}.\n` +
            "Run archive-node pair again to get a new code, and approve it yourself without showing it to anyone.",
          verdict.exitCode,
        );
      }

      let web: string | null = null;
      try {
        web = new URL(s.verifyUrl).origin;
      } catch {
        web = null;
      }
      saveConfig({ api, key, machineId, operator, web, pairedAt: new Date().toISOString() });
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
