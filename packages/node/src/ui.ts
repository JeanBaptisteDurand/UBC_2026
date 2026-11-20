/** ui.ts — terminal output: colors (off outside a terminal or with NO_COLOR), symbols, masking, large characters,
 *  yes/no question. */
import { createInterface } from "node:readline";

const COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const paint = (open: number, close: number) => (t: string) => (COLOR ? `\x1b[${open}m${t}\x1b[${close}m` : t);

export const bold = paint(1, 22);
export const dim = paint(2, 22);
export const red = paint(31, 39);
export const green = paint(32, 39);
export const yellow = paint(33, 39);
export const cyan = paint(36, 39);

export const isTTY = (): boolean => !!process.stdout.isTTY;
export const columns = (): number => process.stdout.columns || 100;

export const OK = green("✓");
export const KO = red("✗");
export const SKIP = dim("·");
export const WARN = yellow("!");
export const ARROW = cyan("→");

export function out(line = ""): void {
  process.stdout.write(line + "\n");
}
export function err(line = ""): void {
  process.stderr.write(line + "\n");
}
/** waits until stdout is flushed (before process.exit, otherwise a redirected output can be cut short) */
export function flush(): Promise<void> {
  return new Promise((resolve) => process.stdout.write("", () => resolve()));
}

export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

/** pads on the right up to n visible characters */
export function pad(s: string, n: number): string {
  const len = [...stripAnsi(s)].length;
  return len >= n ? s : s + " ".repeat(n - len);
}

// after these words, the line is not cut: a command to copy and paste stays in one piece (even between quotes)
const GLUE_AFTER = new Set(["archive-node", "sudo", "docker", "systemctl", "curl", "brew", "mount", "modprobe", "timedatectl", "usermod", "launchctl", "nvm", "«", "|"]);
const unquote = (w: string): string => w.replace(/^[“"«]/, "");

/** cuts a text into lines of `width` characters (without breaking commands); the following lines get `indent` */
export function wrap(text: string, width: number, indent: string): string {
  if (!Number.isFinite(width) || width < 20) return text;
  const chunks: string[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const prev = chunks[chunks.length - 1];
    const prevWord = prev?.split(" ").pop() ?? "";
    const glue = prev !== undefined && (/^[-|»”]/.test(w) || GLUE_AFTER.has(unquote(prevWord)) || (/^-/.test(prevWord) && !/[.;,:)”]$/.test(prevWord)));
    if (glue) chunks[chunks.length - 1] = `${prev} ${w}`;
    else chunks.push(w);
  }
  const lines: string[] = [];
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

export const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

/** 0x1234…cdef (address, public key, identifier) */
export function short(h: string | null | undefined, head = 6, tail = 4): string {
  if (!h) return "—";
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/** arcop_1a2b…wxyz: the operator key is NEVER shown in full */
export function maskKey(key: string): string {
  const m = /^arcop_(.+)$/.exec(key);
  if (!m) return key.length > 10 ? `${key.slice(0, 2)}…${key.slice(-2)}` : "…";
  const rest = m[1]!;
  if (rest.length < 12) return "arcop_…";
  return `arcop_${rest.slice(0, 4)}…${rest.slice(-4)}`;
}

/** the key's public identifier (arcop_<id>_<secret>), the one the site shows under "Keys" */
export function keyIdOf(key: string): string | null {
  return /^arcop_([0-9a-f]{8})_/.exec(key)?.[1] ?? null;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

export const hhmmss = (d = new Date()): string => d.toTimeString().slice(0, 8);

export const fmtInt = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export const fmtSeconds = (s: number): string => {
  const a = Math.abs(s);
  return `${a < 10 ? a.toFixed(1) : Math.round(a)} s`;
};

// ---------- yes/no question ----------

/** An answer read at the terminal: "y", "yes" (and the French "o", "oui") = yes; "n", "no", "non", Enter alone or
 *  anything else = no (the default). Case and spaces are ignored. */
export function parseYesNo(line: string): "yes" | "no" {
  return /^(y|yes|o|oui)$/i.test(line.trim()) ? "yes" : "no";
}

/** "notty": standard input is not a terminal; the question is not asked (see askYesNo). */
export type Answer = "yes" | "no" | "eof" | "cancel" | "notty";

type TtyInput = NodeJS.ReadStream & { isRaw?: boolean; setRawMode?: (mode: boolean) => unknown };

/** the terminal's raw mode; a terminal that refuses it (rare) does not stop the agent: the purge then reads finished lines */
function rawMode(input: TtyInput, on: boolean): void {
  try {
    input.setRawMode?.(on);
  } catch {
    /* terminal gone, or no raw mode */
  }
}

/** the silence (ms) that ends the purge of what was typed ahead; the purge's longest duration */
const TYPEAHEAD_QUIET_MS = 60;
const TYPEAHEAD_MAX_MS = 1_000;

/** Throws away what was typed BEFORE the question: the terminal switches to raw mode (a line started, even without Enter,
 *  becomes readable), and everything that arrives is read and dropped until 60 ms of silence (1 s at most). A Ctrl+C in
 *  the batch (no longer a signal in raw mode) gives "cancel". The stream stays open: whoever reads the answer must hook
 *  onto it right after, without waiting (no byte can arrive in between). */
function discardTypeAhead(input: TtyInput, signal?: AbortSignal): Promise<{ cancel: boolean; bytes: number }> {
  return new Promise((resolve) => {
    let bytes = 0;
    let cancel = false;
    let over = false;
    let quiet: NodeJS.Timeout | undefined;
    const end = () => {
      if (over) return;
      over = true;
      clearTimeout(quiet);
      clearTimeout(cap);
      input.removeListener("data", onData);
      signal?.removeEventListener("abort", onAbort);
      resolve({ cancel, bytes });
    };
    const onData = (chunk: Buffer | string) => {
      const s = typeof chunk === "string" ? chunk : chunk.toString("latin1");
      bytes += s.length;
      if (s.includes("\x03")) {
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

/** Asks the person IN FRONT OF THE TERMINAL a yes/no question and reads ONE line (parseYesNo: "y", "yes", "o", "oui"
 *  = yes; "n", "no", "non", Enter or anything else = no, the default). What was typed before the question showed is
 *  thrown away (an answer typed ahead, or a reflex Enter during the wait, does not count). If standard input is not a
 *  terminal (pipe, script, `echo o |`), nothing is read: "notty" (an answer from a pipe does not prove that someone
 *  read the question). "eof": the input closed without an answer; "cancel": Ctrl+C, or `signal`
 *  aborted. */
export async function askYesNo(question: string, signal?: AbortSignal): Promise<Answer> {
  if (signal?.aborted) return "cancel";
  const input = process.stdin as TtyInput;
  if (!input.isTTY || typeof input.setRawMode !== "function") return "notty";
  const purged = await discardTypeAhead(input, signal);
  // from here, nothing asynchronous before readline reads the input: no byte passes between the two
  const terminal = !!process.stdout.isTTY;
  if (purged.cancel || signal?.aborted) {
    rawMode(input, false);
    input.pause();
    process.stdout.write("\n");
    return "cancel";
  }
  if (!terminal) rawMode(input, false); // without a terminal on the output, the kernel handles echo and line editing
  if (purged.bytes > 0) process.stdout.write(dim("  (anything typed before this question is ignored: answer now)") + "\n");
  return new Promise((resolve) => {
    const rl = createInterface({ input, output: process.stdout, terminal });
    let done = false;
    const finish = (a: Answer, newline: boolean) => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", onAbort);
      if (newline) process.stdout.write("\n");
      rl.close();
      rawMode(input, false);
      input.pause();
      resolve(a);
    };
    const onAbort = () => finish("cancel", true);
    signal?.addEventListener("abort", onAbort, { once: true });
    rl.on("SIGINT", () => finish("cancel", true)); // Ctrl+C in the terminal (read by readline, not a signal)
    rl.on("close", () => finish("eof", true)); // input closed (Ctrl+D) without an answer
    rl.question(question, (line) => {
      finish(parseYesNo(line), false);
    });
  });
}

// ---------- big characters (5 lines) for the pairing code ----------

// 5 columns per glyph; the narrow "I" and "-" take 3: HIVE-XXXX-XXXX fits in 77 columns
const FONT: Record<string, string> = {
  A: ".###.|#...#|#####|#...#|#...#", B: "####.|#...#|####.|#...#|####.", C: ".####|#....|#....|#....|.####",
  D: "####.|#...#|#...#|#...#|####.", E: "#####|#....|####.|#....|#####", F: "#####|#....|####.|#....|#....",
  G: ".####|#....|#..##|#...#|.####", H: "#...#|#...#|#####|#...#|#...#", I: "###|.#.|.#.|.#.|###",
  J: "#####|...#.|...#.|#..#.|.##..", K: "#...#|#..#.|###..|#..#.|#...#", L: "#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#...#|#...#", N: "#...#|##..#|#.#.#|#..##|#...#", O: ".###.|#...#|#...#|#...#|.###.",
  P: "####.|#...#|####.|#....|#....", Q: ".###.|#...#|#.#.#|#..#.|.##.#", R: "####.|#...#|####.|#..#.|#...#",
  S: ".####|#....|.###.|....#|####.", T: "#####|..#..|..#..|..#..|..#..", U: "#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|.#.#.|..#..", W: "#...#|#...#|#.#.#|##.##|#...#", X: "#...#|.#.#.|..#..|.#.#.|#...#",
  Y: "#...#|.#.#.|..#..|..#..|..#..", Z: "#####|...#.|..#..|.#...|#####",
  "0": ".###.|#..##|#.#.#|##..#|.###.", "1": "..#..|.##..|..#..|..#..|.###.", "2": ".###.|#...#|..##.|.#...|#####",
  "3": "####.|....#|.###.|....#|####.", "4": "#...#|#...#|#####|....#|....#", "5": "#####|#....|####.|....#|####.",
  "6": ".###.|#....|####.|#...#|.###.", "7": "#####|....#|...#.|..#..|..#..", "8": ".###.|#...#|.###.|#...#|.###.",
  "9": ".###.|#...#|.####|....#|.###.", "-": "...|...|###|...|...",
};

/** the text's characters (5 lines each), or null if a character is not in the font */
function glyphsOf(text: string): string[][] | null {
  const out: string[][] = [];
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch];
    if (!g) return null;
    out.push(g.split("|"));
  }
  return out;
}

/** the text in 5 lines of blocks (one column between two characters), or null if a character is not in the font */
export function bigText(text: string): string[] | null {
  const gs = glyphsOf(text);
  if (!gs) return null;
  return [0, 1, 2, 3, 4].map((i) => gs.map((g) => g[i]!.replace(/#/g, "█").replace(/\./g, " ")).join(" ").trimEnd());
}

/** the width of bigText(text) in columns, or null */
export function bigWidth(text: string): number | null {
  const gs = glyphsOf(text);
  return gs ? gs.reduce((n, g) => n + g[0]!.length, 0) + Math.max(0, gs.length - 1) : null;
}

/** The pairing code in big letters for a terminal of `cols` columns: a 2-space margin on the left and at least one
 *  free column on the right (no automatic line wrap). The whole code (HIVE-XXXX-XXXX: 77 columns, readable on 80),
 *  otherwise without the HIVE- prefix, optional when typing it (51 columns: `short`), otherwise null. */
export function codeBanner(code: string, cols: number): { rows: string[]; short: boolean } | null {
  const tries: Array<[string, boolean]> = [[code, false]];
  if (/^HIVE-./i.test(code)) tries.push([code.slice(5), true]);
  for (const [text, short] of tries) {
    const w = bigWidth(text);
    const rows = bigText(text);
    if (rows && w !== null && 2 + w < cols) return { rows: rows.map((r) => `  ${r}`), short };
  }
  return null;
}
