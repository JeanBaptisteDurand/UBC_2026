/** secrets.ts — the secrets filter, shared by the copilot and the MCP server.
 *
 *  Nothing sent to the LLM provider may carry:
 *  - an access key aek_<network>_<session>_<secret>; an operator key arcop_<id>_<secret>;
 *  - an API provider key: sk-… and sk-proj-… (OpenAI and compatible), rpk_… (RedPill), gsk_, hf_, xai-, ghp_,
 *    github_pat_, glpat-, AIza…; a "Bearer …" token; the value of a secret environment variable (…_API_KEY=,
 *    …_SECRET=, …_TOKEN=, …_PASSWORD=, …_PRIVATE_KEY=, …_MNEMONIC=…);
 *  - a BIP-39 recovery phrase: 12 or more words IN A ROW from one list (the ten official lists), numbered or not
 *    ("1.", "2)", "3:", "#4", "Mot n°5 :", "Word 6:", "07."), one per line, in aligned columns, or with one typo per
 *    12-word slice (a letter missing, added, changed or swapped with its neighbour, or a word recognised by its first 4
 *    letters, as wallets do);
 *  - a PEM private key;
 *  - a hexadecimal private key (0x + 64 hex, or 64 bare hex) NEAR a word that names it (clé, key, priv, secret, seed,
 *    wallet…). A transaction hash or a public bytes32 (workloadId, quoteHash, PUBLIC X25519 key, nonce) stays readable:
 *    only the label of the value's field counts (in JSON, the key before it, never the next field's), and the nearest
 *    word decides ("tx", "hash", "publique"… win).
 *  A phrase's words can also be joined by "+" or "." ("abandon+ability+…").
 *
 *  ALERT MODE (for the WHOLE conversation, scrubConversation): as soon as a USER message mentions a private key, a
 *  recovery phrase or an extended key (mentionsSecret, precise wordings), ALL the conversation's messages are filtered
 *  strictly — the secret often arrives in the message AFTER the one that mentions it:
 *  - any 64-hex value is masked, whatever the nearest word ("my private key, not the transaction hash: 0x…"), even when
 *    split: lines, pairs ("4c 08 83 …"), groups of 2 to 8 digits or more (at least 64 digits in total, letters a-f AND
 *    digits: a table of numbers is not one);
 *  - base58 keys: a Solana key (87 or 88 characters), a Bitcoin WIF key (51 or 52 characters, starting with 5, K or L);
 *    and a Solana key as a byte array ("[174,47,…]", 32 to 64 numbers);
 *  - a recovery phrase is recognised from 8 words (one typo per 6-word slice), and a phrase SPLIT across several user
 *    messages ("start: …", then "the end: …") is too: chunks of at least 4 words from one list, alone on their line (or
 *    after ":"), which together make 12 words or more, are all masked.
 *  scrubUserMessage applies this mode to a single message (alert if the message itself mentions a secret).
 *  The filter applies to the client's messages, to tool results (machine logs included) and to the answer.
 *
 *  Fewer false positives in NORMAL MODE: "clé", "key", "wallet" (and MetaMask, Rabby, Phantom, Keplr) are AMBIGUOUS
 *  words: they name a secret only BEFORE the value, with no public word in the same sentence of the label ("the
 *  transaction for your key registration: 0x…", "Transaction of wallet 0x…: 0x…" stay readable) and no public neighbour
 *  ("enclave key", "clé de l'enclave", like "clé publique"). "privée", "secret", "seed"… keep the nearest-word rule. A
 *  word cut by the label window is taken whole;
 *  - also in NORMAL MODE: a BIP-32 extended key (xprv, yprv, zprv, tprv, uprv, vprv…) is always masked; a hexadecimal
 *    key in groups and a base58 key (Solana, WIF) are masked when a secret word names them ("my metamask key: 4c08
 *    83a6 …");
 *  - the ALERT is triggered only by precise wordings (clé privée, private key, seed phrase, recovery phrase, phrase de
 *    récupération, mnemonic, xprv/zprv/tprv…), not by "export", "seed" or "secret key" alone;
 *  - in alert mode, any hexadecimal chunk of 16 digits or more (letters a-f AND digits; an address 0x + 40 hex stays
 *    readable) is masked: a key split 32 + 32 across two messages cannot get through, even before the second half
 *    arrives.
 *  Out of reach: a phrase sent in chunks of fewer than 4 words, or split without any mention; a bare key with no label;
 *  a private key in base64. */
import {
  czech, english, french, italian, japanese, korean, portuguese, simplifiedChinese, spanish, traditionalChinese,
} from "viem/accounts";

export const MASK_KEY = "[clé masquée]";
export const MASK_PHRASE = "[phrase de récupération masquée]";
/** Alert mode: a value (hexadecimal or base58) in a conversation that talks about a private key. Key or plain hash, it is
 *  not read (see scrubConversation). */
export const MASK_CAUTION = "[valeur masquée par prudence]";

const AEK_RE = /aek_[a-z0-9]+_\d+_[A-Za-z0-9_-]{8,}/g;
const ARCOP_RE = /arcop_[A-Za-z0-9_-]{8,}/g;
const PEM_RE = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g;
const HEX64_RE = /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
/** API provider keys. They need at least one digit (a compound word "sk-…" is not one). */
const PROVIDER_RE = /(?<![A-Za-z0-9_-])(?:sk-[A-Za-z0-9][A-Za-z0-9_-]{19,}|rpk_[A-Za-z0-9_-]{16,}|(?:gsk|hf|xai|ghp|gho|ghu|ghs|ghr|github_pat|glpat)[_-][A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})/g;
const BEARER_RE = /\b(Bearer\s+)([A-Za-z0-9._~+/-]{16,}=*)/gi;
/** The value of a secret environment variable ("OPENAI_API_KEY=…", "REDPILL_API_KEY: …", '"API_KEY": "…"'): 12
 *  characters or more, letters AND digits. A template ("${…}", "<…>"), a call or a code path ("randomBytes(36)",
 *  "process.env.API_KEY") stays readable. */
const ENV_SECRET_RE = /\b((?:[A-Z][A-Z0-9]*_)*(?:API_?KEY|SECRET(?:_KEY)?|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|PASSPHRASE|MNEMONIC|SEED_PHRASE))(["']?\s*[=:](?:\s|\\[nrt])*)(["']?)([A-Za-z0-9_\-+/=.~]{12,})(?![\w(])/g;
const looksSecret = (v: string) => /\d/.test(v) && /[A-Za-z]/.test(v) && !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(v);
const hasDigit = (s: string) => /\d/.test(s);
/** A PRIVATE BIP-32 extended key (xprv, and the SLIP-132 variants yprv, zprv, Yprv, Zprv; tprv, uprv, vprv… on
 *  testnet): 111 base58 characters, unambiguous (an xpub stays readable). */
const EXT_PRIV_RE = /(?<![\p{L}\p{N}_])[xyztuvXYZTUV]prv[1-9A-HJ-NP-Za-km-z]{100,108}(?![\p{L}\p{N}_])/gu;

/** A copy of the same length where the JSON escapes \n \r \t become blanks (\n stays a line break): the filter reads a
 *  raw text as well as a tool result's JSON (otherwise "abandon\nability" would glue the n to the next word). */
const probeOf = (s: string) => s.replace(/\\n/g, " \n").replace(/\\[rt]/g, "  ");

/** A folded word: no accents, no invisible characters (zero-width space U+200B, soft hyphen U+00AD, joiners
 *  U+200C/U+200D…, category Cf: some copy-pastes stick them inside a word), lower case. */
const fold = (w: string) => w.normalize("NFD").replace(/[\p{M}\p{Cf}]/gu, "").toLowerCase();

/** Splits identifiers (camelCase, snake_case): "privateKey" → "private Key", "PRIVATE_KEY" → "PRIVATE KEY". */
const splitIdent = (s: string) => s.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").replace(/_/g, " ");

// ---------------------------------------------------------------- BIP-39 recovery phrases

/** The ten official BIP-39 lists. Typos are searched only in the Latin-alphabet lists. */
const LISTS: Array<{ words: readonly string[]; typos: boolean }> = [
  { words: english, typos: true }, { words: french, typos: true }, { words: spanish, typos: true },
  { words: italian, typos: true }, { words: portuguese, typos: true }, { words: czech, typos: true },
  { words: japanese, typos: false }, { words: korean, typos: false },
  { words: simplifiedChinese, typos: false }, { words: traditionalChinese, typos: false },
];

interface WordIndex {
  /** A word (folded: no accents, lower case) → the lists that contain it (one bit per list). */
  exact: Map<string, number>;
  /** A word missing one letter → lists (Latin lists only). */
  minus1: Map<string, number>;
  /** The first 4 letters → lists (Latin lists only; BIP-39 makes them unique within each list). */
  prefix4: Map<string, number>;
  typoMask: number;
}
let INDEX: WordIndex | undefined;

const deletions = (w: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < w.length; i++) out.push(w.slice(0, i) + w.slice(i + 1));
  return out;
};

/** The index, built on first use (≈ 100,000 entries). */
function wordIndex(): WordIndex {
  if (INDEX) return INDEX;
  const exact = new Map<string, number>(), minus1 = new Map<string, number>(), prefix4 = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, bit: number) => m.set(k, (m.get(k) ?? 0) | bit);
  let typoMask = 0;
  LISTS.forEach((l, i) => {
    const bit = 1 << i;
    if (l.typos) typoMask |= bit;
    for (const raw of l.words) {
      const w = fold(raw);
      add(exact, w, bit);
      if (!l.typos) continue;
      for (const d of deletions(w)) add(minus1, d, bit);
      if (w.length >= 4) add(prefix4, w.slice(0, 4), bit);
    }
  });
  return (INDEX = { exact, minus1, prefix4, typoMask });
}

/** The lists in which `w` (folded) is a word up to one typo: a letter missing, added, changed or swapped with its
 *  neighbour, or a word recognised by its first 4 letters. */
function typoLists(ix: WordIndex, w: string): number {
  if (w.length < 3 || w.length > 12) return 0;
  let m = ix.minus1.get(w) ?? 0; // a letter missing
  for (const d of deletions(w)) m |= (ix.exact.get(d) ?? 0) | (ix.minus1.get(d) ?? 0); // one too many; changed or swapped
  if (w.length >= 4) m |= ix.prefix4.get(w.slice(0, 4)) ?? 0;
  return m & ix.typoMask;
}

/** The numbering of a hand-written phrase, erased (blanks of the same length) before the words are counted: "1.",
 *  "2)", "3:", "4 -", "#5", "(6)", "[7]", '"8":', "n°9", "Mot n°10 :", "Word 11:", "01.". */
const NUMBERING = /(?<![\p{L}\p{N}_])(?:(?:mots?|words?)\s*)?(?:(?:n|no|nr|num(?:[eé]ro)?)\s*[°º.]?\s*|#\s*)?(?:\\?[(\[«"'])?\d{1,2}(?:\\?[)\]»"'])?\s*[.:)\]\-–—=]?(?!\p{N})/giu;
const phraseProbe = (s: string) => probeOf(s).replace(NUMBERING, (m) => " ".repeat(m.length));

/** Between two words of a phrase (numbering erased): blanks, including aligned columns and line breaks, and light
 *  punctuation; without a blank, a single separator ("a,b", "a-b") or the '","' of a JSON array. Never ":", "=",
 *  braces or angle brackets (the key-values of a JSON log), nor code's glued punctuation ("slice(Math.max", "a.b": the
 *  keys "hunt.step.key", "hunt.step.replay"… of a translation file would otherwise form a run of list words). Words
 *  glued by "." or "+" are handled apart (maskGluedPhrases). */
function gapOk(gap: string): boolean {
  if (gap.length > 64 || /[:={}<>]/.test(gap) || /\p{N}{3,}/u.test(gap)) return false;
  if (/\s/.test(gap)) return gap.replace(/\s+/g, "").length <= 8;
  return /^(?:[,;|/_·•–—-]|\\?["'],\\?["'])$/.test(gap);
}

/** Words glued by one same separator, "." or "+" ("abandon+ability+able…", "abandon.ability.able…"): a run of 8 words
 *  or more, in one piece (no blank), is judged as if its words were separated by spaces; if it contains a phrase, it is
 *  masked whole. A translation key or a property chain ("hunt.step.key") does not have enough segments. */
const GLUED_RE = /(?<![\p{L}\p{M}\p{N}_.+])[\p{L}\p{M}]+(?:[.+][\p{L}\p{M}]+){7,}(?![\p{L}\p{M}\p{N}_])/gu;
function maskGluedPhrases(s: string, rule: PhraseRule): string {
  return s.replace(GLUED_RE, (m) => {
    if (new Set(m.match(/[.+]/g)).size !== 1) return m; // a single separator, always the same
    const spaced = m.replace(/[.+]/g, " ");
    return maskMnemonics(spaced, rule) === spaced ? m : MASK_PHRASE;
  });
}

/** A phrase's thresholds: at least `minWords` words, one typo tolerated per slice of `wordsPerTypo` words (at least one). */
interface PhraseRule { minWords: number; wordsPerTypo: number }
const PHRASE_RULE: PhraseRule = { minWords: 12, wordsPerTypo: 12 };
/** A user message that talks about a private key or a recovery phrase (mentionsSecret): lower thresholds. */
const ALERT_PHRASE_RULE: PhraseRule = { minWords: 8, wordsPerTypo: 6 };
const typosAllowed = (r: PhraseRule, total: number) => Math.max(1, Math.floor(total / r.wordsPerTypo));

interface Tok { start: number; end: number; exact: number; typo: number; joined: boolean }

/** A segment (words from one list, or isolated typos, linked by allowed blanks): whole if it passes the thresholds (a
 *  typo at an edge is kept only when it is needed), otherwise its longest windows that pass them. */
function judgeSegment(seg: Tok[], bit: number, rule: PhraseRule, spans: Array<[number, number]>) {
  if (seg.length < rule.minWords) return;
  const isTypo = (t: Tok) => (t.exact & bit) === 0;
  const before: number[] = [0]; // fautes avant l'indice k
  for (const t of seg) before.push(before[before.length - 1]! + (isTypo(t) ? 1 : 0));
  const dense = (a: number, z: number) => before[z + 1]! - before[a]! <= typosAllowed(rule, z - a + 1);
  const fits = (a: number, z: number) => z - a + 1 >= rule.minWords && dense(a, z);
  if (fits(0, seg.length - 1)) {
    let a = 0, z = seg.length - 1;
    if (isTypo(seg[a]!) && fits(a + 1, z)) a++; // never two typos in a row in a segment: only one to drop per edge
    if (isTypo(seg[z]!) && fits(a, z - 1)) z--;
    spans.push([seg[a]!.start, seg[z]!.end]);
    return;
  }
  // too many typos for the whole segment: exact runs linked by one typo, in a sliding window
  const runs: Array<[number, number]> = [];
  let from = -1;
  seg.forEach((t, k) => {
    if (!isTypo(t)) { if (from < 0) from = k; return; }
    if (from >= 0) runs.push([from, k - 1]);
    from = -1;
  });
  if (from >= 0) runs.push([from, seg.length - 1]);
  // each window can also take the typo before or after it (a mistyped first or last word)
  let i = 0;
  for (let j = 0; j < runs.length; j++) {
    while (i < j && !dense(runs[i]![0], runs[j]![1])) i++;
    const a0 = runs[i]![0], z0 = runs[j]![1];
    const aT = a0 > 0 ? a0 - 1 : a0, zT = z0 < seg.length - 1 ? z0 + 1 : z0; // a run's neighbour is a typo
    const w = ([[a0, z0], [aT, z0], [a0, zT], [aT, zT]] as const).find(([a, z]) => fits(a, z));
    if (w) spans.push([seg[w[0]]!.start, seg[w[1]]!.end]);
  }
}

/** The words of a text (numbering erased): their positions (the same as in the text), the lists they appear in, and
 *  whether an allowed gap links them to the previous word (gapOk). */
function tokenize(s: string): { probe: string; toks: Tok[]; words: string[] } {
  const probe = phraseProbe(s);
  const ix = wordIndex();
  const toks: Tok[] = [];
  const words: string[] = [];
  let prevEnd = -1;
  // a word can contain invisible characters (Cf), never at its start or end
  for (const m of probe.matchAll(/[\p{L}\p{M}](?:[\p{L}\p{M}\p{Cf}]*[\p{L}\p{M}])?/gu)) {
    const start = m.index!, end = start + m[0].length, w = fold(m[0]);
    toks.push({ start, end, exact: ix.exact.get(w) ?? 0, typo: 0, joined: prevEnd >= 0 && gapOk(probe.slice(prevEnd, start)) });
    words.push(w);
    prevEnd = end;
  }
  return { probe, toks, words };
}

/** The lists (one bit each) of which the text contains at least `min` exact words. */
const listsWith = (toks: Tok[], min: number) =>
  LISTS.map((_, i) => 1 << i).filter((bit) => toks.reduce((n, t) => n + (t.exact & bit ? 1 : 0), 0) >= min);

/** Merges [start, end[ intervals, then replaces them with `mask`, from the end to the start. */
function replaceSpans(s: string, spans: Array<[number, number]>, mask: string): string {
  if (!spans.length) return s;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const sp of sorted) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([sp[0], sp[1]]);
  }
  let out = s;
  for (const [a, b] of merged.reverse()) out = out.slice(0, a) + mask + out.slice(b);
  return out;
}

function maskMnemonics(s: string, rule: PhraseRule): string {
  const { toks, words } = tokenize(s);
  const ix = wordIndex();
  // a list is examined only when the text contains enough of its exact words (the usual case: none)
  const lists = listsWith(toks, rule.minWords - typosAllowed(rule, rule.minWords));
  if (!lists.length) return s;
  if (lists.some((bit) => bit & ix.typoMask)) toks.forEach((t, k) => { t.typo = typoLists(ix, words[k]!) & ~t.exact; });

  const spans: Array<[number, number]> = [];
  for (const bit of lists) {
    let seg: Tok[] = [];
    const close = () => { if (seg.length) judgeSegment(seg, bit, rule, spans); seg = []; };
    for (const t of toks) {
      const isExact = (t.exact & bit) !== 0;
      if (!isExact && !(t.typo & bit)) { close(); continue; }
      if (seg.length && !t.joined) close();
      else if (!isExact && seg.length && !(seg[seg.length - 1]!.exact & bit)) close(); // deux fautes de suite
      seg.push(t);
    }
    close();
  }
  // overlapping segments (several lists) are merged
  return replaceSpans(s, spans, MASK_PHRASE);
}

// ---------------------------------------------------------------- alert mode: a phrase split across several messages

/** A phrase chunk counts from this number of exact words in a row from one list. */
const FRAGMENT_MIN = 4;
interface Fragment { bit: number; start: number; end: number; words: number }

/** What can come before a chunk on its line (after blanks): the start of the text, a line break, ":", "=", a bullet, a
 *  dash, an opening parenthesis or quote ("start: abandon ability…", "- abandon…"). */
const FRAGMENT_LEFT = new Set(["\n", ":", "=", ">", "«", "\"", "'", "(", "[", "{", "*", "•", "·", "→", "|", "–", "—", "-"]);
/** What can follow it: final punctuation, then the end of the line or of the text. */
const FRAGMENT_RIGHT = /[ \t.,;!?…)\]}»"']*(?:\r?\n|$)/uy;

/** Is the chunk [start, end[ alone on its line (or after ":")? A run of common words in the middle of an ordinary
 *  sentence ("you have any other way…") is not. */
function standsAlone(probe: string, start: number, end: number): boolean {
  let i = start - 1;
  while (i >= 0 && (probe[i] === " " || probe[i] === "\t")) i--;
  if (i >= 0 && !FRAGMENT_LEFT.has(probe[i]!)) return false;
  FRAGMENT_RIGHT.lastIndex = end;
  return FRAGMENT_RIGHT.test(probe);
}

/** The phrase chunks of a text: FRAGMENT_MIN exact words or more from one list, linked, alone on their line. */
function phraseFragments(s: string): Fragment[] {
  const { probe, toks } = tokenize(s);
  const out: Fragment[] = [];
  for (const bit of listsWith(toks, FRAGMENT_MIN)) {
    let a = -1;
    const close = (z: number) => {
      if (a >= 0 && z - a + 1 >= FRAGMENT_MIN && standsAlone(probe, toks[a]!.start, toks[z]!.end)) {
        out.push({ bit, start: toks[a]!.start, end: toks[z]!.end, words: z - a + 1 });
      }
      a = -1;
    };
    toks.forEach((t, k) => {
      if (!(t.exact & bit)) return close(k - 1);
      if (a >= 0 && !t.joined) close(k - 1);
      if (a < 0) a = k;
    });
    close(toks.length - 1);
  }
  return out;
}

/** Alert mode: the phrase chunks spread over these texts (the user's messages, in order) that together make 12 words or
 *  more from one list are all masked. */
function maskPhraseFragments(texts: readonly string[]): string[] {
  const frags = texts.map(phraseFragments);
  const total = new Map<number, number>();
  for (const f of frags.flat()) total.set(f.bit, (total.get(f.bit) ?? 0) + f.words);
  const hit = new Set([...total].filter(([, n]) => n >= PHRASE_RULE.minWords).map(([bit]) => bit));
  if (!hit.size) return [...texts];
  return texts.map((t, k) => replaceSpans(t, frags[k]!.filter((f) => hit.has(f.bit)).map((f): [number, number] => [f.start, f.end]), MASK_PHRASE));
}

// ---------------------------------------------------------------- hexadecimal keys labelled as secret

/** Words that name a secret ON THEIR OWN: the nearest one decides, against the nearest public word. */
const STRONG_SECRET_WORD = /^(?:priv\p{L}*|secr[eèé]t\p{L}*|seeds?|mn[ée]mo\p{L}*|mnemo\p{L}*|pk|sk|passphrases?|passwords?|passwd|mdp|signing)$/iu;
/** AMBIGUOUS words: an enclave key, a key registration and a wallet's transaction are public. They name a secret only
 *  BEFORE the value, with no public word in the same sentence of the label and no public neighbour (see weakLabel). The
 *  wallets that export a private key are among them ("my MetaMask export: 0x…"). */
const WEAK_SECRET_WORD = /^(?:cl[ée]f?s?|keys?|wallets?|portefeuilles?|metamask|rabby|phantom|keplr)$/iu;
/** Words of a public context (hash, transaction, public key…): when they are nearer, the value stays readable. */
const PUBLIC_WORD = /^(?:publi\p{L}*|pub|pubkeys?|x25519|hash\p{L}*|tx\p{L}*|transactions?|workload\p{L}*|quote\p{L}*|pr[ée]dica\p{L}*|manifest\p{L}*|digests?|bloc\p{L}*|block\p{L}*|nonces?|topics?|events?|[ée]v[ée]nements?|empreintes?|fingerprints?|ids?|identifiants?|keccak\p{L}*|sha\d*|merkle|roots?|commits?|signatures?)$/iu;
/** "clé publique", "public key", "x25519 key": a public neighbour neutralizes the key word. */
const PUBLIC_NEIGHBOUR = /^(?:publi\p{L}*|pub|pubkeys?|x25519)$/iu;
/** A neighbour that makes an AMBIGUOUS key public; an enclave's key never leaves the enclave, so "enclave key",
 *  "enclave's key" and "clé de l'enclave" name its public key. */
const WEAK_PUBLIC_NEIGHBOUR = /^(?:publi\p{L}*|pub|pubkeys?|x25519|enclaves?)$/iu;
/** Linking words skipped to find that neighbour. */
const CONNECTOR = /^(?:of|the|for|s|de|du|des|d|l|la|le|les)$/iu;
/** splitIdent cuts "MetaMask" into "Meta Mask": it is glued back first. */
const brands = (s: string) => s.replace(/meta[\s_-]*mask/gi, "metamask");

type Word = { w: string; start: number; end: number };
const wordsOf = (s: string): Word[] => [...s.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ w: m[0], start: m.index!, end: m.index! + m[0].length }));

/** The distance (in characters) to the nearest (strong) secret word and to the nearest public word. */
function nearest(words: Word[], dist: (x: Word) => number): { secret: number; pub: number } {
  let secret = Infinity, pub = Infinity;
  words.forEach((x, i) => {
    if (PUBLIC_WORD.test(x.w)) pub = Math.min(pub, dist(x));
    else if (STRONG_SECRET_WORD.test(x.w)) {
      const neutral = [words[i - 1], words[i + 1]].some((n) => n && PUBLIC_NEIGHBOUR.test(n.w));
      if (!neutral) secret = Math.min(secret, dist(x));
    }
  });
  return { secret, pub };
}

/** Does the label BEFORE the value name it with an ambiguous word ("ma clé : 0x…", "my wallet 0x…")? Only in its last
 *  sentence, with no public word (hash, tx, transaction…) and no public neighbour of the word ("enclave key"). */
function weakLabel(before: string): boolean {
  const clauses = before.split(/[.!?](?=\s|$)/);
  let clause = clauses.pop() ?? "";
  while (clauses.length && !/\p{L}/u.test(clause)) clause = clauses.pop()!;
  const ws = wordsOf(clause);
  if (ws.some((x) => PUBLIC_WORD.test(x.w))) return false;
  const neighbour = (i: number, step: 1 | -1) => {
    let j = i + step;
    while (ws[j] && CONNECTOR.test(ws[j]!.w)) j += step;
    return ws[j];
  };
  return ws.some((x, i) => WEAK_SECRET_WORD.test(x.w) && ![neighbour(i, -1), neighbour(i, 1)].some((n) => n && WEAK_PUBLIC_NEIGHBOUR.test(n.w)));
}

/** The USER's messages only: an ambiguous word STUCK to the value names it, whatever the public words further on in the
 *  sentence: the last word before it ("I signed the tx with my key: 0x…", "send from this wallet 0x…"), or one of the
 *  first 4 words after it ("0x… is my metamask key", "0x… (wallet key)"). These stay readable: a public or enclave
 *  neighbour ("enclave key:", "transaction of wallet 0x…") and a label that ends with another word ("key registration:
 *  0x…"). The model's answers and the tool results do not go through here. */
function stuckWeak(before: string, after: string): boolean {
  const publicNeighbour = (w?: Word) => !!w && (WEAK_PUBLIC_NEIGHBOUR.test(w.w) || PUBLIC_WORD.test(w.w));
  const bw = wordsOf(before);
  if (bw.length) {
    const i = bw.length - 1;
    const tail = before.slice(bw[i]!.end);
    if (/^[\s:=(\[{"'`<-]*$/u.test(tail) && WEAK_SECRET_WORD.test(bw[i]!.w)) {
      // walk up the chain of complements ("Transaction d'inscription de la clé", "transaction of wallet"): a public or
      // enclave word in that chain makes the value readable; the chain stops at the first unlinked word
      let j = i - 1;
      let isPublic = false;
      for (;;) {
        let linked = false;
        while (bw[j] && CONNECTOR.test(bw[j]!.w)) { j--; linked = true; }
        if (publicNeighbour(bw[j])) { isPublic = true; break; }
        if (!linked && j !== i - 1) break;
        if (!bw[j] || !(bw[j - 1] && CONNECTOR.test(bw[j - 1]!.w))) break;
        j--;
      }
      if (!isPublic) return true;
    }
  }
  // a value announced as public right before it ("tx 0x… from my wallet") is not named by what follows
  if (bw.length && PUBLIC_WORD.test(bw[bw.length - 1]!.w) && /^[\s:=(\[{"'`<-]*$/u.test(before.slice(bw[bw.length - 1]!.end))) return false;
  const aw = wordsOf(after).slice(0, 4);
  if (aw.some((x) => PUBLIC_WORD.test(x.w))) return false;
  return aw.some((x, i) => WEAK_SECRET_WORD.test(x.w) && !publicNeighbour(aw[i - 1]) && !publicNeighbour(aw[i + 1]));
}

/** Field separators: a line break, the '","' of a JSON (compact or indented), braces, brackets, ";", "|". */
const FIELD_SEP = /\n|"\s*,\s*"?|,\s*"|[{}[\];|]/;

/** The label BEFORE the value: the current field (same line, after the last separator); when it has no word (a value at
 *  the start of a line, the first item of an array), the field before it ("Ma clé :\n0x…", '"keys":["0x…"]'). */
function zoneBefore(probe: string, start: number): string {
  // a word cut by the start of the window is taken whole ("ansaction" is not a public word)
  let a = Math.max(0, start - 64);
  const inWord = (i: number) => /[\p{L}\p{N}]/u.test(probe[i] ?? "");
  for (let k = 0; k < 32 && a > 0 && inWord(a - 1) && inWord(a); k++) a--;
  const win = probe.slice(a, start).split("\n").slice(-2).join("\n");
  const segs = win.split(FIELD_SEP);
  const last = segs[segs.length - 1] ?? "";
  if (/\p{L}/u.test(last) || segs.length < 2) return last;
  return `${segs[segs.length - 2]} ${last}`;
}
/** The label AFTER the value ("0x… (clé privée)"), up to the first quote or separator: a JSON's next field is never
 *  part of it. */
const zoneAfter = (probe: string, end: number) => probe.slice(end, end + 48).split(/["\n{}[\];|]/)[0] ?? "";

/** Does its label name a value (0x + 64 hex…) as secret? A strong word ("privée", "secret", "seed"…) nearer than any
 *  public word, before or after it; otherwise an ambiguous word before it (weakLabel). */
function isLabeledSecret(probe: string, start: number, end: number, user = false): boolean {
  const before = splitIdent(brands(zoneBefore(probe, start)));
  const after = splitIdent(brands(zoneAfter(probe, end)));
  const b = nearest(wordsOf(before), (x) => before.length - x.end);
  const a = nearest(wordsOf(after), (x) => x.start);
  const secret = Math.min(b.secret, a.secret), pub = Math.min(b.pub, a.pub);
  return (secret !== Infinity && secret <= pub) || weakLabel(before) || (user && stuckWeak(before, after));
}

/** Masks (MASK_KEY) the values of `re` that `keep` retains and that their label names as secret. */
function maskLabeled(s: string, re: RegExp, keep: (m: string) => boolean = () => true, user = false): string {
  const probe = probeOf(s);
  return s.replace(re, (m: string, offset: number) => (keep(m) && isLabeledSecret(probe, offset, offset + m.length, user) ? MASK_KEY : m));
}

function maskLabeledHex(s: string, user = false): string {
  return maskLabeled(s, HEX64_RE, () => true, user);
}

// ---------------------------------------------------------------- filtres

function scrub(s: string, rule: PhraseRule, user = false): string {
  if (!s) return s;
  let out = s.replace(PEM_RE, MASK_KEY).replace(AEK_RE, MASK_KEY).replace(ARCOP_RE, MASK_KEY).replace(EXT_PRIV_RE, MASK_KEY);
  out = out.replace(PROVIDER_RE, (m) => (hasDigit(m) ? MASK_KEY : m));
  out = out.replace(BEARER_RE, (m, pre: string, tok: string) => (hasDigit(tok) ? pre + MASK_KEY : m));
  out = out.replace(ENV_SECRET_RE, (m, name: string, sep: string, q: string, v: string) => (looksSecret(v) ? `${name}${sep}${q}${MASK_KEY}` : m));
  out = maskMnemonics(maskGluedPhrases(out, rule), rule);
  return maskLabeledHex(out, user);
}

/** Masks the secrets of a raw text or a JSON (see the header). Outside alert mode, a hexadecimal key in groups and a
 *  base58 key (Solana, WIF) are also masked when a secret word names them (in alert mode, they always are). */
export function scrubSecrets(s: string, o: { user?: boolean } = {}): string {
  const user = o.user === true;
  let out = scrub(s, PHRASE_RULE, user);
  out = maskLabeled(out, SPLIT_HEX_RE, splitHexKey, user);
  out = maskLabeled(out, SOLANA_KEY_RE, mixedB58, user);
  return maskLabeled(out, WIF_RE, mixedB58, user);
}

/** Does the message talk about a private key, a recovery phrase or an extended key? PRECISE wordings only: "export",
 *  "seed", "secret key" or "signing key" alone no longer put the conversation on alert ("export my wallet history to
 *  CSV", "seed the liquidity pool", "secret key in RSA"). */
const SECRET_MENTION = /\b(?:cl(?:e|ef)s?\s+privee?s?|private\s*keys?|priv\s*keys?|mnemoni\w*|mnemo|(?:seed|recovery|backup)\s*(?:phrases?|words?)|secret\s*phrases?|phrases?\s+(?:secretes?\s+)?(?:de\s+)?(?:recuperation|mnemoniques?|sauvegarde|restauration)|mots?\s+de\s+recuperation)\b/;
/** A private BIP-32 extended key: xprv, yprv, zprv, tprv, uprv, vprv (folded to lower case). */
const EXT_PRIV_MENTION = /(?<![\p{L}\p{N}])[xyztuv]prv/u;
export function mentionsSecret(s: string): boolean {
  // split identifiers ("privateKey", "PRIVATE_KEY" → "private key")
  const f = fold(splitIdent(s)).replace(/[_-]+/g, " ");
  return SECRET_MENTION.test(f) || EXT_PRIV_MENTION.test(f);
}

/** Alert mode: a hexadecimal key cut into pieces (lines, pairs, groups of 2 to 8 digits or more, the last group possibly
 *  shorter); kept when it has 64 digits or more, with letters a-f AND digits (a random key has both; a table of numbers
 *  or words like "de ce" do not). */
const SPLIT_HEX_RE = /(?<![\p{L}\p{N}_])(?:0x)?[0-9a-fA-F]{2,}(?:(?:[ \t]*\r?\n[ \t]*|[ \t]+|[ \t]*[-:.,][ \t]*)[0-9a-fA-F]{2,})+(?:(?:[ \t]+|[ \t]*[-:.,][ \t]*)[0-9a-fA-F])?(?![\p{L}\p{N}_])/gu;
const splitHexKey = (m: string) => {
  const d = m.replace(/^0x/i, "").replace(/[^0-9a-fA-F]/g, "");
  return d.length >= 64 && /[a-fA-F]/.test(d) && /[0-9]/.test(d);
};
/** Alert mode: base58 keys (Bitcoin's alphabet: no 0, O, I or l) — a Solana key (64 bytes: 87 or 88 characters) and a
 *  Bitcoin WIF key (51 characters starting with 5, 52 starting with K or L); kept when they mix digits, upper case and
 *  lower case (a random key always does). */
const B58 = "[1-9A-HJ-NP-Za-km-z]";
const SOLANA_KEY_RE = new RegExp(`(?<![\\p{L}\\p{N}_])${B58}{87,88}(?![\\p{L}\\p{N}_])`, "gu");
const WIF_RE = new RegExp(`(?<![\\p{L}\\p{N}_])[5KL]${B58}{50,51}(?![\\p{L}\\p{N}_])`, "gu");
const mixedB58 = (m: string) => /[0-9]/.test(m) && /[A-Z]/.test(m) && /[a-z]/.test(m);
/** Alert mode: a Solana key as a byte array (a solana-keygen file): 32 to 64 numbers from 0 to 255. */
const BYTE_ARRAY_RE = /\[\s*(?:\d{1,3}\s*,\s*){31,63}\d{1,3}\s*\]/g;
const byteArrayKey = (m: string) => (m.match(/\d+/g) ?? []).every((n) => Number(n) <= 255);
/** Alert mode: a hexadecimal CHUNK (contiguous, or in groups of at least 2 digits) of at least 16 digits, with letters
 *  a-f AND digits: half of a key split across two messages (32 + 32), masked from the first message. An address (0x +
 *  40 hex) stays readable. */
const HEX_FRAGMENT_RE = /(?<![\p{L}\p{N}_])(?:0x)?[0-9a-fA-F]{2,}(?:(?:[ \t]*\r?\n[ \t]*|[ \t]+|[ \t]*[-:.,][ \t]*)[0-9a-fA-F]{2,})*(?![\p{L}\p{N}_])/gu;
const hexFragment = (m: string) => {
  if (/^0x[0-9a-fA-F]{40}$/.test(m)) return false;
  const d = m.replace(/^0x/i, "").replace(/[^0-9a-fA-F]/g, "");
  return d.length >= 16 && /[a-fA-F]/.test(d) && /[0-9]/.test(d);
};

/** The strict filter (alert mode) of a text: lower phrase thresholds, then every 64-hex value (contiguous or in pieces),
 *  every hexadecimal chunk of 16 digits or more, and every base58 key or key byte array masked whatever its label. An
 *  address (0x + 40 hex) stays readable. */
function scrubAlert(s: string): string {
  if (!s) return s;
  return scrub(s, ALERT_PHRASE_RULE)
    .replace(HEX64_RE, MASK_CAUTION)
    .replace(SPLIT_HEX_RE, (m) => (splitHexKey(m) ? MASK_CAUTION : m))
    .replace(HEX_FRAGMENT_RE, (m) => (hexFragment(m) ? MASK_CAUTION : m))
    .replace(SOLANA_KEY_RE, (m) => (mixedB58(m) ? MASK_CAUTION : m))
    .replace(WIF_RE, (m) => (mixedB58(m) ? MASK_CAUTION : m))
    .replace(BYTE_ARRAY_RE, (m) => (byteArrayKey(m) ? MASK_CAUTION : m));
}

/** The filter of one USER message taken alone: scrubSecrets, or, when it talks about a private key, a recovery phrase or
 *  an extended key (mentionsSecret), the alert mode (see the header), phrase chunks included. For a conversation, use
 *  scrubConversation (the alert then holds for all its messages). */
export function scrubUserMessage(s: string): string {
  if (!s || !mentionsSecret(s)) return scrubSecrets(s, { user: true });
  return scrubAlert(maskPhraseFragments([s])[0]!);
}

/** Is the conversation in alert mode? Yes as soon as a USER message talks about a private key, a recovery phrase or an
 *  extended key (mentionsSecret; the model's answers, which often warn about it, do not count). */
export function conversationAlert(messages: ReadonlyArray<{ role: string; content: string }>): boolean {
  return messages.some((m) => m.role === "user" && typeof m.content === "string" && mentionsSecret(m.content));
}

/** The filter of a WHOLE conversation (the client's messages, in order): outside alert mode, scrubSecrets on each
 *  message; in alert mode (conversationAlert), the phrase chunks spread over the user's messages are masked, then each
 *  message (the user's or the model's) goes through the strict filter. Only `content` changes. */
export function scrubConversation<M extends { role: string; content: string }>(messages: readonly M[]): { messages: M[]; alert: boolean } {
  const alert = conversationAlert(messages);
  if (!alert) return { alert, messages: messages.map((m) => ({ ...m, content: scrubSecrets(m.content, { user: m.role === "user" }) })) };
  const users = messages.flatMap((m, i) => (m.role === "user" ? [i] : []));
  const contents = messages.map((m) => m.content);
  maskPhraseFragments(users.map((i) => contents[i]!)).forEach((c, k) => { contents[users[k]!] = c; });
  return { alert, messages: messages.map((m, i) => ({ ...m, content: scrubAlert(contents[i]!) })) };
}

/** Removes the server's own secrets (the model key…) from a text, whatever their format. */
export function redactLiterals(s: string, secrets: readonly string[] = []): string {
  let out = s;
  for (const k of secrets) if (typeof k === "string" && k.length >= 8 && out.includes(k)) out = out.split(k).join(MASK_KEY);
  return out;
}
