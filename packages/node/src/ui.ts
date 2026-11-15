/** ui.ts — sortie terminal : couleurs (coupées hors terminal ou avec NO_COLOR), symboles, masquage, gros caractères,
 *  question oui/non. */
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
/** attend que stdout soit vidé (avant process.exit, sinon une sortie redirigée peut être tronquée) */
export function flush(): Promise<void> {
  return new Promise((resolve) => process.stdout.write("", () => resolve()));
}

export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

/** complète à droite jusqu'à n caractères visibles */
export function pad(s: string, n: number): string {
  const len = [...stripAnsi(s)].length;
  return len >= n ? s : s + " ".repeat(n - len);
}

// après ces mots, on ne coupe pas la ligne : une commande à copier-coller reste d'un seul tenant (même entre guillemets)
const GLUE_AFTER = new Set(["archive-node", "sudo", "docker", "systemctl", "curl", "brew", "mount", "modprobe", "timedatectl", "usermod", "launchctl", "nvm", "«", "|"]);
const unquote = (w: string): string => w.replace(/^[“"«]/, "");

/** coupe un texte en lignes de `width` caractères (sans casser les commandes) ; les lignes suivantes reçoivent `indent` */
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

/** 0x1234…cdef (adresse, clé publique, identifiant) */
export function short(h: string | null | undefined, head = 6, tail = 4): string {
  if (!h) return "—";
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/** arcop_1a2b…wxyz : la clé opérateur n'est JAMAIS affichée en entier */
export function maskKey(key: string): string {
  const m = /^arcop_(.+)$/.exec(key);
  if (!m) return key.length > 10 ? `${key.slice(0, 2)}…${key.slice(-2)}` : "…";
  const rest = m[1]!;
  if (rest.length < 12) return "arcop_…";
  return `arcop_${rest.slice(0, 4)}…${rest.slice(-4)}`;
}

/** identifiant public de la clé (arcop_<id>_<secret>), celui que le site affiche dans « Clés » */
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

// ---------- question oui/non ----------

/** Une réponse lue au terminal : « y », « yes » (et « o », « oui » : l'agent était en français) = oui ; « n », « no »,
 *  « non », Entrée seule ou tout le reste = non (le défaut). Casse et espaces indifférents. */
export function parseYesNo(line: string): "yes" | "no" {
  return /^(y|yes|o|oui)$/i.test(line.trim()) ? "yes" : "no";
}

/** « notty » : l'entrée standard n'est pas un terminal ; la question n'est pas posée (voir askYesNo). */
export type Answer = "yes" | "no" | "eof" | "cancel" | "notty";

type TtyInput = NodeJS.ReadStream & { isRaw?: boolean; setRawMode?: (mode: boolean) => unknown };

/** mode brut du terminal ; un terminal qui le refuse (rare) n'arrête pas l'agent : la purge lit alors les lignes finies */
function rawMode(input: TtyInput, on: boolean): void {
  try {
    input.setRawMode?.(on);
  } catch {
    /* terminal disparu ou sans mode brut */
  }
}

/** silence (ms) qui clôt la purge de ce qui a été tapé d'avance ; durée maximale de la purge */
const TYPEAHEAD_QUIET_MS = 60;
const TYPEAHEAD_MAX_MS = 1_000;

/** Jette ce qui a été tapé AVANT la question : le terminal passe en mode brut (une ligne commencée, même sans Entrée,
 *  devient lisible), on lit et on jette tout ce qui arrive jusqu'à 60 ms de silence (1 s au plus). Ctrl+C dans le lot
 *  (en mode brut, ce n'est plus un signal) : « cancel ». Le flux reste ouvert : celui qui lit la réponse doit s'y brancher
 *  dans la foulée, sans attente (aucun octet ne peut arriver entre les deux). */
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

/** Pose une question oui/non à l'humain DEVANT LE TERMINAL et lit UNE ligne (parseYesNo : « y », « yes », « o », « oui »
 *  = oui ; « n », « no », « non », Entrée ou tout le reste = non, le défaut). Ce qui a été tapé avant que la question s'affiche est
 *  jeté (une réponse tapée d'avance, ou une Entrée machinale pendant l'attente, ne compte pas). Si l'entrée standard
 *  n'est pas un terminal (tube, script, `echo o |`), rien n'est lu : « notty » (une réponse venue d'un tube ne prouve pas
 *  que quelqu'un a lu la question). « eof » : l'entrée s'est fermée sans réponse ; « cancel » : Ctrl+C, ou `signal`
 *  interrompu. */
export async function askYesNo(question: string, signal?: AbortSignal): Promise<Answer> {
  if (signal?.aborted) return "cancel";
  const input = process.stdin as TtyInput;
  if (!input.isTTY || typeof input.setRawMode !== "function") return "notty";
  const purged = await discardTypeAhead(input, signal);
  // à partir d'ici, rien d'asynchrone avant que readline ne lise l'entrée : aucun octet ne passe entre les deux
  const terminal = !!process.stdout.isTTY;
  if (purged.cancel || signal?.aborted) {
    rawMode(input, false);
    input.pause();
    process.stdout.write("\n");
    return "cancel";
  }
  if (!terminal) rawMode(input, false); // sans terminal en sortie, le noyau gère l'écho et l'édition de la ligne
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
    rl.on("SIGINT", () => finish("cancel", true)); // Ctrl+C dans le terminal (lu par readline, pas un signal)
    rl.on("close", () => finish("eof", true)); // entrée fermée (Ctrl+D) sans réponse
    rl.question(question, (line) => {
      finish(parseYesNo(line), false);
    });
  });
}

// ---------- gros caractères (5 lignes) pour le code d'appairage ----------

// 5 colonnes par signe ; « I » et « - », étroits, en prennent 3 : HIVE-XXXX-XXXX tient en 77 colonnes
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

/** les signes du texte (5 lignes chacun), ou null si un caractère n'est pas dans la police */
function glyphsOf(text: string): string[][] | null {
  const out: string[][] = [];
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch];
    if (!g) return null;
    out.push(g.split("|"));
  }
  return out;
}

/** le texte en 5 lignes de blocs (une colonne entre deux signes), ou null si un caractère n'est pas dans la police */
export function bigText(text: string): string[] | null {
  const gs = glyphsOf(text);
  if (!gs) return null;
  return [0, 1, 2, 3, 4].map((i) => gs.map((g) => g[i]!.replace(/#/g, "█").replace(/\./g, " ")).join(" ").trimEnd());
}

/** la largeur de bigText(text) en colonnes, ou null */
export function bigWidth(text: string): number | null {
  const gs = glyphsOf(text);
  return gs ? gs.reduce((n, g) => n + g[0]!.length, 0) + Math.max(0, gs.length - 1) : null;
}

/** Le code d'appairage en gros pour un terminal de `cols` colonnes : 2 espaces de marge à gauche et au moins une
 *  colonne libre à droite (pas de retour à la ligne automatique). Le code entier (HIVE-XXXX-XXXX : 77 colonnes,
 *  lisible sur 80), sinon sans le préfixe HIVE-, facultatif à la saisie (51 colonnes : `short`), sinon null. */
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
