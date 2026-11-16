/** secrets.ts — le filtre de secrets (audit du 7/11, n° 10, et restes relevés par le vérificateur le 8/11), partagé par
 *  le copilote et le serveur MCP.
 *
 *  Rien de ce qui part vers le fournisseur du LLM ne doit porter :
 *  - une clé d'accès aek_<réseau>_<session>_<secret> ; une clé opérateur arcop_<id>_<secret> ;
 *  - une clé de fournisseur d'API : sk-… et sk-proj-… (OpenAI et compatibles), rpk_… (RedPill), gsk_, hf_, xai-, ghp_,
 *    github_pat_, glpat-, AIza… ; un jeton « Bearer … » ; la valeur d'une variable d'environnement secrète
 *    (…_API_KEY=, …_SECRET=, …_TOKEN=, …_PASSWORD=, …_PRIVATE_KEY=, …_MNEMONIC=…) ;
 *  - une phrase de récupération BIP-39 : 12 mots ou plus À LA SUITE d'une même liste (les dix listes officielles),
 *    numérotée ou non (« 1. », « 2) », « 3: », « #4 », « Mot n°5 : », « Word 6: », « 07. »), une par ligne, en colonnes
 *    alignées, ou avec une faute de frappe par tranche de 12 mots (lettre oubliée, en trop, changée ou inversée avec sa
 *    voisine, ou mot reconnu à ses 4 premières lettres, comme le font les wallets) ;
 *  - une clé privée PEM ;
 *  - une clé privée hexadécimale (0x + 64 hex, ou 64 hex nus) PRÈS d'un mot qui la désigne (clé, key, priv, secret,
 *    seed, wallet…). Un hash de transaction ou un bytes32 public (workloadId, quoteHash, clé X25519 PUBLIQUE, nonce)
 *    reste lisible : seul compte le libellé du champ de la valeur (dans un JSON, la clé qui la précède, jamais celle
 *    du champ suivant), et le mot le plus proche décide (« tx », « hash », « publique »… l'emportent).
 *  Les mots d'une phrase peuvent aussi être collés par « + » ou « . » (« abandon+ability+… »).
 *
 *  MODE ALERTE (9/11 : pour TOUTE la conversation, scrubConversation) : dès qu'un message de l'UTILISATEUR parle de clé
 *  privée, de phrase de récupération ou de clé étendue (mentionsSecret, formulations précises), TOUS les messages de la conversation
 *  sont filtrés sévèrement — le secret arrive souvent dans le message SUIVANT celui qui en parle :
 *  - toute valeur de 64 hex y est masquée, quel que soit le mot le plus proche (« ma clé privée, pas le hash de
 *    transaction : 0x… »), même coupée en morceaux : lignes, paires (« 4c 08 83 … »), groupes de 2 à 8 chiffres ou plus
 *    (64 chiffres au moins au total, lettres a-f ET chiffres : une table de nombres n'en est pas une) ;
 *  - les clés base58 : clé Solana (87 ou 88 caractères), clé Bitcoin WIF (51 ou 52 caractères, commençant par 5, K ou
 *    L) ; et la clé Solana en tableau d'octets (« [174,47,…] », 32 à 64 nombres) ;
 *  - une phrase de récupération y est reconnue dès 8 mots (une faute par tranche de 6), et une phrase COUPÉE entre
 *    plusieurs messages de l'utilisateur (« début : … », puis « la fin : … ») l'est aussi : les morceaux d'au moins 4 mots
 *    d'une même liste, seuls sur leur ligne (ou après « : »), qui font ensemble 12 mots ou plus, sont tous masqués.
 *  scrubUserMessage applique ce mode à un message seul (alerte s'il parle lui-même de secret).
 *  Le filtre s'applique aux messages du client, aux résultats d'outils (journaux de machines compris) et à la réponse.
 *
 *  9/11 au soir (preuve secrets-new du vérificateur) :
 *  - MODE NORMAL, moins de faux positifs : « clé », « key », « wallet » (et MetaMask, Rabby, Phantom, Keplr) sont des
 *    mots AMBIGUS : ils ne désignent un secret qu'AVANT la valeur, sans mot public dans la même phrase du libellé
 *    (« the transaction for your key registration: 0x… », « Transaction of wallet 0x…: 0x… » restent lisibles) ni voisin
 *    public (« enclave key », « clé de l'enclave », comme « clé publique »). « privée », « secret », « seed »… gardent la
 *    règle du mot le plus proche. Un mot coupé par la fenêtre du libellé est repris en entier ;
 *  - MODE NORMAL, en plus : clé étendue BIP-32 (xprv, yprv, zprv, tprv, uprv, vprv…) toujours masquée ; clé hexadécimale
 *    en groupes et clé base58 (Solana, WIF) masquées quand un mot secret la désigne (« my metamask key: 4c08 83a6 … ») ;
 *  - l'ALERTE ne se déclenche plus que sur des formulations précises (clé privée, private key, seed phrase, recovery
 *    phrase, phrase de récupération, mnemonic, xprv/zprv/tprv…) : plus sur « export », « seed », « secret key » seuls ;
 *  - en alerte, tout morceau hexadécimal de 16 chiffres ou plus (lettres a-f ET chiffres ; une adresse 0x + 40 hex reste
 *    lisible) est masqué : une clé coupée 32 + 32 entre deux messages ne passe plus, même avant que la 2e moitié arrive.
 *  Limites connues : une phrase envoyée par morceaux de moins de 4 mots, ou coupée sans aucune mention ; une clé nue sans
 *  libellé ; une clé privée en base64. */
import {
  czech, english, french, italian, japanese, korean, portuguese, simplifiedChinese, spanish, traditionalChinese,
} from "viem/accounts";

export const MASK_KEY = "[clé masquée]";
export const MASK_PHRASE = "[phrase de récupération masquée]";
/** Mode alerte : valeur (hexadécimale ou base58) d'une conversation qui parle de clé privée : clé ou simple hash, on ne
 *  la lit pas (voir scrubConversation). */
export const MASK_CAUTION = "[valeur masquée par prudence]";

const AEK_RE = /aek_[a-z0-9]+_\d+_[A-Za-z0-9_-]{8,}/g;
const ARCOP_RE = /arcop_[A-Za-z0-9_-]{8,}/g;
const PEM_RE = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g;
const HEX64_RE = /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
/** Clés de fournisseurs d'API. Il leur faut au moins un chiffre (un mot composé « sk-… » n'en est pas une). */
const PROVIDER_RE = /(?<![A-Za-z0-9_-])(?:sk-[A-Za-z0-9][A-Za-z0-9_-]{19,}|rpk_[A-Za-z0-9_-]{16,}|(?:gsk|hf|xai|ghp|gho|ghu|ghs|ghr|github_pat|glpat)[_-][A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})/g;
const BEARER_RE = /\b(Bearer\s+)([A-Za-z0-9._~+/-]{16,}=*)/gi;
/** Valeur d'une variable d'environnement secrète (« OPENAI_API_KEY=… », « REDPILL_API_KEY: … », « "API_KEY": "…" ») :
 *  12 caractères ou plus, lettres ET chiffres. Un gabarit (« ${…} », « <…> »), un appel ou un chemin de code
 *  (« randomBytes(36) », « process.env.API_KEY ») reste lisible. */
const ENV_SECRET_RE = /\b((?:[A-Z][A-Z0-9]*_)*(?:API_?KEY|SECRET(?:_KEY)?|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|PASSPHRASE|MNEMONIC|SEED_PHRASE))(["']?\s*[=:](?:\s|\\[nrt])*)(["']?)([A-Za-z0-9_\-+/=.~]{12,})(?![\w(])/g;
const looksSecret = (v: string) => /\d/.test(v) && /[A-Za-z]/.test(v) && !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(v);
const hasDigit = (s: string) => /\d/.test(s);
/** Clé étendue BIP-32 PRIVÉE (xprv, et les variantes SLIP-132 yprv, zprv, Yprv, Zprv ; tprv, uprv, vprv… sur testnet) :
 *  111 caractères base58, sans ambiguïté (une xpub reste lisible). */
const EXT_PRIV_RE = /(?<![\p{L}\p{N}_])[xyztuvXYZTUV]prv[1-9A-HJ-NP-Za-km-z]{100,108}(?![\p{L}\p{N}_])/gu;

/** Copie de même longueur où les échappements JSON \n \r \t deviennent des blancs (\n reste un saut de ligne) : le
 *  filtre lit aussi bien un texte brut que le JSON d'un résultat d'outil (sinon « abandon\nability » collerait le n
 *  au mot suivant). */
const probeOf = (s: string) => s.replace(/\\n/g, " \n").replace(/\\[rt]/g, "  ");

/** Mot replié : sans accents, sans caractères invisibles (espace sans chasse U+200B, trait d'union conditionnel U+00AD,
 *  liants U+200C/U+200D…, catégorie Cf : collés dans un mot par certains copier-coller), en minuscules. */
const fold = (w: string) => w.normalize("NFD").replace(/[\p{M}\p{Cf}]/gu, "").toLowerCase();

/** Coupe les identifiants (camelCase, snake_case) : « privateKey » → « private Key », « PRIVATE_KEY » → « PRIVATE KEY ». */
const splitIdent = (s: string) => s.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").replace(/_/g, " ");

// ---------------------------------------------------------------- phrases de récupération BIP-39

/** Les dix listes BIP-39 officielles. Les fautes de frappe ne sont cherchées que dans les listes en alphabet latin. */
const LISTS: Array<{ words: readonly string[]; typos: boolean }> = [
  { words: english, typos: true }, { words: french, typos: true }, { words: spanish, typos: true },
  { words: italian, typos: true }, { words: portuguese, typos: true }, { words: czech, typos: true },
  { words: japanese, typos: false }, { words: korean, typos: false },
  { words: simplifiedChinese, typos: false }, { words: traditionalChinese, typos: false },
];

interface WordIndex {
  /** Mot (replié : sans accents, en minuscules) → listes qui le contiennent (un bit par liste). */
  exact: Map<string, number>;
  /** Mot privé d'une lettre → listes (listes latines seulement). */
  minus1: Map<string, number>;
  /** 4 premières lettres → listes (listes latines seulement ; BIP-39 les rend uniques dans chaque liste). */
  prefix4: Map<string, number>;
  typoMask: number;
}
let INDEX: WordIndex | undefined;

const deletions = (w: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < w.length; i++) out.push(w.slice(0, i) + w.slice(i + 1));
  return out;
};

/** Index construit au premier usage (≈ 100 000 entrées). */
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

/** Listes dont `w` (replié) est un mot à une faute près : lettre oubliée, en trop, changée ou inversée avec sa voisine,
 *  ou mot reconnu à ses 4 premières lettres. */
function typoLists(ix: WordIndex, w: string): number {
  if (w.length < 3 || w.length > 12) return 0;
  let m = ix.minus1.get(w) ?? 0; // une lettre oubliée
  for (const d of deletions(w)) m |= (ix.exact.get(d) ?? 0) | (ix.minus1.get(d) ?? 0); // une en trop ; changée ou inversée
  if (w.length >= 4) m |= ix.prefix4.get(w.slice(0, 4)) ?? 0;
  return m & ix.typoMask;
}

/** Numérotation d'une phrase écrite à la main, effacée (blancs de même longueur) avant de compter les mots : « 1. »,
 *  « 2) », « 3: », « 4 - », « #5 », « (6) », « [7] », « "8": », « n°9 », « Mot n°10 : », « Word 11: », « 01. ». */
const NUMBERING = /(?<![\p{L}\p{N}_])(?:(?:mots?|words?)\s*)?(?:(?:n|no|nr|num(?:[eé]ro)?)\s*[°º.]?\s*|#\s*)?(?:\\?[(\[«"'])?\d{1,2}(?:\\?[)\]»"'])?\s*[.:)\]\-–—=]?(?!\p{N})/giu;
const phraseProbe = (s: string) => probeOf(s).replace(NUMBERING, (m) => " ".repeat(m.length));

/** Entre deux mots d'une phrase (numérotation effacée) : blancs, y compris des colonnes alignées et des retours à la
 *  ligne, et ponctuation légère ; sans blanc, un seul séparateur (« a,b », « a-b ») ou le « "," » d'un tableau JSON ;
 *  jamais « : », « = », accolades ni chevrons (clés-valeurs d'un journal JSON), ni la ponctuation collée du code
 *  (« slice(Math.max », « a.b » : les clés « hunt.step.key », « hunt.step.replay »… d'un fichier de traductions
 *  formeraient sinon une suite de mots de la liste). Les mots collés par « . » ou « + » sont vus à part
 *  (maskGluedPhrases). */
function gapOk(gap: string): boolean {
  if (gap.length > 64 || /[:={}<>]/.test(gap) || /\p{N}{3,}/u.test(gap)) return false;
  if (/\s/.test(gap)) return gap.replace(/\s+/g, "").length <= 8;
  return /^(?:[,;|/_·•–—-]|\\?["'],\\?["'])$/.test(gap);
}

/** Mots collés par un même séparateur, « . » ou « + » (« abandon+ability+able… », « abandon.ability.able… ») : une suite
 *  de 8 mots ou plus, d'un seul tenant (sans blanc), est jugée comme si ses mots étaient séparés par des espaces ; si
 *  elle contient une phrase, elle est masquée tout entière. Une clé de traduction ou une chaîne de propriétés
 *  (« hunt.step.key ») n'a pas assez de segments. */
const GLUED_RE = /(?<![\p{L}\p{M}\p{N}_.+])[\p{L}\p{M}]+(?:[.+][\p{L}\p{M}]+){7,}(?![\p{L}\p{M}\p{N}_])/gu;
function maskGluedPhrases(s: string, rule: PhraseRule): string {
  return s.replace(GLUED_RE, (m) => {
    if (new Set(m.match(/[.+]/g)).size !== 1) return m; // un seul séparateur, toujours le même
    const spaced = m.replace(/[.+]/g, " ");
    return maskMnemonics(spaced, rule) === spaced ? m : MASK_PHRASE;
  });
}

/** Seuils d'une phrase : `minWords` mots au moins, une faute tolérée par tranche de `wordsPerTypo` mots (une au moins). */
interface PhraseRule { minWords: number; wordsPerTypo: number }
const PHRASE_RULE: PhraseRule = { minWords: 12, wordsPerTypo: 12 };
/** Message de l'utilisateur qui parle de clé privée ou de phrase de récupération (mentionsSecret) : seuils plus bas. */
const ALERT_PHRASE_RULE: PhraseRule = { minWords: 8, wordsPerTypo: 6 };
const typosAllowed = (r: PhraseRule, total: number) => Math.max(1, Math.floor(total / r.wordsPerTypo));

interface Tok { start: number; end: number; exact: number; typo: number; joined: boolean }

/** Un segment (mots d'une liste, ou fautes isolées, reliés par des blancs permis) : entier s'il passe les seuils (une
 *  faute en bord n'est gardée que si elle est nécessaire), sinon ses plus longues fenêtres qui les passent. */
function judgeSegment(seg: Tok[], bit: number, rule: PhraseRule, spans: Array<[number, number]>) {
  if (seg.length < rule.minWords) return;
  const isTypo = (t: Tok) => (t.exact & bit) === 0;
  const before: number[] = [0]; // fautes avant l'indice k
  for (const t of seg) before.push(before[before.length - 1]! + (isTypo(t) ? 1 : 0));
  const dense = (a: number, z: number) => before[z + 1]! - before[a]! <= typosAllowed(rule, z - a + 1);
  const fits = (a: number, z: number) => z - a + 1 >= rule.minWords && dense(a, z);
  if (fits(0, seg.length - 1)) {
    let a = 0, z = seg.length - 1;
    if (isTypo(seg[a]!) && fits(a + 1, z)) a++; // pas deux fautes de suite dans un segment : une seule à retirer par bord
    if (isTypo(seg[z]!) && fits(a, z - 1)) z--;
    spans.push([seg[a]!.start, seg[z]!.end]);
    return;
  }
  // trop de fautes pour le segment entier : suites exactes reliées par une faute, fenêtre glissante
  const runs: Array<[number, number]> = [];
  let from = -1;
  seg.forEach((t, k) => {
    if (!isTypo(t)) { if (from < 0) from = k; return; }
    if (from >= 0) runs.push([from, k - 1]);
    from = -1;
  });
  if (from >= 0) runs.push([from, seg.length - 1]);
  // chaque fenêtre peut aussi prendre la faute qui la précède ou qui la suit (premier ou dernier mot mal tapé)
  let i = 0;
  for (let j = 0; j < runs.length; j++) {
    while (i < j && !dense(runs[i]![0], runs[j]![1])) i++;
    const a0 = runs[i]![0], z0 = runs[j]![1];
    const aT = a0 > 0 ? a0 - 1 : a0, zT = z0 < seg.length - 1 ? z0 + 1 : z0; // le voisin d'une suite est une faute
    const w = ([[a0, z0], [aT, z0], [a0, zT], [aT, zT]] as const).find(([a, z]) => fits(a, z));
    if (w) spans.push([seg[w[0]]!.start, seg[w[1]]!.end]);
  }
}

/** Les mots d'un texte (numérotation effacée) : positions (les mêmes que dans le texte), listes où ils figurent, et s'ils
 *  sont reliés au mot précédent par un écart permis (gapOk). */
function tokenize(s: string): { probe: string; toks: Tok[]; words: string[] } {
  const probe = phraseProbe(s);
  const ix = wordIndex();
  const toks: Tok[] = [];
  const words: string[] = [];
  let prevEnd = -1;
  // un mot peut contenir des caractères invisibles (Cf), jamais au début ni à la fin
  for (const m of probe.matchAll(/[\p{L}\p{M}](?:[\p{L}\p{M}\p{Cf}]*[\p{L}\p{M}])?/gu)) {
    const start = m.index!, end = start + m[0].length, w = fold(m[0]);
    toks.push({ start, end, exact: ix.exact.get(w) ?? 0, typo: 0, joined: prevEnd >= 0 && gapOk(probe.slice(prevEnd, start)) });
    words.push(w);
    prevEnd = end;
  }
  return { probe, toks, words };
}

/** Listes (un bit chacune) dont le texte contient au moins `min` mots exacts. */
const listsWith = (toks: Tok[], min: number) =>
  LISTS.map((_, i) => 1 << i).filter((bit) => toks.reduce((n, t) => n + (t.exact & bit ? 1 : 0), 0) >= min);

/** Fusionne des intervalles [début, fin[ puis les remplace par `mask`, de la fin vers le début. */
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
  // une liste n'est examinée que si le texte contient assez de ses mots exacts (le cas courant : aucune)
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
  // segments qui se chevauchent (plusieurs listes) fusionnés
  return replaceSpans(s, spans, MASK_PHRASE);
}

// ---------------------------------------------------------------- mode alerte : phrase coupée entre plusieurs messages

/** Un morceau de phrase compte à partir de ce nombre de mots exacts d'une même liste, à la suite. */
const FRAGMENT_MIN = 4;
interface Fragment { bit: number; start: number; end: number; words: number }

/** Ce qui peut précéder un morceau sur sa ligne (après des blancs) : le début du texte, un saut de ligne, « : », « = »,
 *  une puce, un tiret, une parenthèse ou un guillemet ouvrants (« début : abandon ability… », « - abandon… »). */
const FRAGMENT_LEFT = new Set(["\n", ":", "=", ">", "«", "\"", "'", "(", "[", "{", "*", "•", "·", "→", "|", "–", "—", "-"]);
/** Ce qui peut le suivre : de la ponctuation finale, puis la fin de la ligne ou du texte. */
const FRAGMENT_RIGHT = /[ \t.,;!?…)\]}»"']*(?:\r?\n|$)/uy;

/** Le morceau [start, end[ est-il seul sur sa ligne (ou après « : ») ? Une suite de mots courants au milieu d'une phrase
 *  ordinaire (« you have any other way… ») ne l'est pas. */
function standsAlone(probe: string, start: number, end: number): boolean {
  let i = start - 1;
  while (i >= 0 && (probe[i] === " " || probe[i] === "\t")) i--;
  if (i >= 0 && !FRAGMENT_LEFT.has(probe[i]!)) return false;
  FRAGMENT_RIGHT.lastIndex = end;
  return FRAGMENT_RIGHT.test(probe);
}

/** Les morceaux de phrase d'un texte : FRAGMENT_MIN mots exacts ou plus d'une même liste, reliés, seuls sur leur ligne. */
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

/** Mode alerte : les morceaux de phrase répartis dans ces textes (les messages de l'utilisateur, dans l'ordre) qui font
 *  ensemble 12 mots ou plus d'une même liste sont tous masqués. */
function maskPhraseFragments(texts: readonly string[]): string[] {
  const frags = texts.map(phraseFragments);
  const total = new Map<number, number>();
  for (const f of frags.flat()) total.set(f.bit, (total.get(f.bit) ?? 0) + f.words);
  const hit = new Set([...total].filter(([, n]) => n >= PHRASE_RULE.minWords).map(([bit]) => bit));
  if (!hit.size) return [...texts];
  return texts.map((t, k) => replaceSpans(t, frags[k]!.filter((f) => hit.has(f.bit)).map((f): [number, number] => [f.start, f.end]), MASK_PHRASE));
}

// ---------------------------------------------------------------- clés hexadécimales désignées comme secrètes

/** Mots qui désignent un secret À EUX SEULS : le plus proche décide, face au mot public le plus proche. */
const STRONG_SECRET_WORD = /^(?:priv\p{L}*|secr[eèé]t\p{L}*|seeds?|mn[ée]mo\p{L}*|mnemo\p{L}*|pk|sk|passphrases?|passwords?|passwd|mdp|signing)$/iu;
/** Mots AMBIGUS (9/11 au soir) : une clé d'enclave, l'inscription d'une clé, la transaction d'un wallet sont publiques.
 *  Ils ne désignent un secret qu'AVANT la valeur, sans mot public dans la même phrase du libellé ni voisin public (voir
 *  weakLabel). Les wallets qui exportent une clé privée en font partie (« mon export MetaMask : 0x… »). */
const WEAK_SECRET_WORD = /^(?:cl[ée]f?s?|keys?|wallets?|portefeuilles?|metamask|rabby|phantom|keplr)$/iu;
/** Mots d'un contexte public (hash, transaction, clé publique…) : s'ils sont plus proches, la valeur reste lisible. */
const PUBLIC_WORD = /^(?:publi\p{L}*|pub|pubkeys?|x25519|hash\p{L}*|tx\p{L}*|transactions?|workload\p{L}*|quote\p{L}*|pr[ée]dica\p{L}*|manifest\p{L}*|digests?|bloc\p{L}*|block\p{L}*|nonces?|topics?|events?|[ée]v[ée]nements?|empreintes?|fingerprints?|ids?|identifiants?|keccak\p{L}*|sha\d*|merkle|roots?|commits?|signatures?)$/iu;
/** « clé publique », « public key », « x25519 key » : le mot de clé est neutralisé par un voisin public. */
const PUBLIC_NEIGHBOUR = /^(?:publi\p{L}*|pub|pubkeys?|x25519)$/iu;
/** Voisin qui rend publique une clé AMBIGUË ; la clé d'une enclave ne sort jamais de l'enclave : « enclave key »,
 *  « enclave's key », « clé de l'enclave » désignent sa clé publique. */
const WEAK_PUBLIC_NEIGHBOUR = /^(?:publi\p{L}*|pub|pubkeys?|x25519|enclaves?)$/iu;
/** Mots de liaison sautés pour trouver ce voisin. */
const CONNECTOR = /^(?:of|the|for|s|de|du|des|d|l|la|le|les)$/iu;
/** « MetaMask » est coupé en « Meta Mask » par splitIdent : on le recolle avant. */
const brands = (s: string) => s.replace(/meta[\s_-]*mask/gi, "metamask");

type Word = { w: string; start: number; end: number };
const wordsOf = (s: string): Word[] => [...s.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ w: m[0], start: m.index!, end: m.index! + m[0].length }));

/** Distance (en caractères) du mot secret (fort) et du mot public les plus proches. */
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

/** Le libellé AVANT la valeur la désigne-t-il par un mot ambigu (« ma clé : 0x… », « mon wallet 0x… ») ? Seulement dans
 *  sa dernière phrase, sans aucun mot public (hash, tx, transaction…) ni voisin public du mot (« enclave key »). */
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

/** Messages de l'UTILISATEUR seulement (9/11, soir) : un mot ambigu COLLÉ à la valeur la désigne, quels que soient les mots
 *  publics plus loin dans la phrase : le dernier mot avant elle (« I signed the tx with my key: 0x… », « send from this
 *  wallet 0x… »), ou l'un des 4 premiers mots après elle (« 0x… is my metamask key », « 0x… (wallet key) »). Restent
 *  lisibles : un voisin public ou d'enclave (« enclave key: », « transaction of wallet 0x… ») et un libellé qui finit par
 *  un autre mot (« key registration: 0x… »). Les réponses du modèle et les résultats d'outils ne passent pas par là. */
function stuckWeak(before: string, after: string): boolean {
  const publicNeighbour = (w?: Word) => !!w && (WEAK_PUBLIC_NEIGHBOUR.test(w.w) || PUBLIC_WORD.test(w.w));
  const bw = wordsOf(before);
  if (bw.length) {
    const i = bw.length - 1;
    const tail = before.slice(bw[i]!.end);
    if (/^[\s:=(\[{"'`<-]*$/u.test(tail) && WEAK_SECRET_WORD.test(bw[i]!.w)) {
      // on remonte la chaîne de compléments (« Transaction d'inscription de la clé », « transaction of wallet ») : un mot
      // public ou d'enclave dans cette chaîne rend la valeur lisible ; la chaîne s'arrête au premier mot non relié
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
  // une valeur annoncée comme publique juste avant elle (« tx 0x… from my wallet ») n'est pas désignée par ce qui suit
  if (bw.length && PUBLIC_WORD.test(bw[bw.length - 1]!.w) && /^[\s:=(\[{"'`<-]*$/u.test(before.slice(bw[bw.length - 1]!.end))) return false;
  const aw = wordsOf(after).slice(0, 4);
  if (aw.some((x) => PUBLIC_WORD.test(x.w))) return false;
  return aw.some((x, i) => WEAK_SECRET_WORD.test(x.w) && !publicNeighbour(aw[i - 1]) && !publicNeighbour(aw[i + 1]));
}

/** Séparateurs de champs : saut de ligne, « "," » d'un JSON (compact ou indenté), accolades, crochets, « ; », « | ». */
const FIELD_SEP = /\n|"\s*,\s*"?|,\s*"|[{}[\];|]/;

/** Le libellé AVANT la valeur : le champ courant (même ligne, après le dernier séparateur) ; s'il n'a aucun mot (valeur
 *  en début de ligne, premier élément d'un tableau), le champ d'avant (« Ma clé :\n0x… », « "keys":["0x…"] »). */
function zoneBefore(probe: string, start: number): string {
  // un mot coupé par le début de la fenêtre est repris en entier (« ansaction » n'est pas un mot public)
  let a = Math.max(0, start - 64);
  const inWord = (i: number) => /[\p{L}\p{N}]/u.test(probe[i] ?? "");
  for (let k = 0; k < 32 && a > 0 && inWord(a - 1) && inWord(a); k++) a--;
  const win = probe.slice(a, start).split("\n").slice(-2).join("\n");
  const segs = win.split(FIELD_SEP);
  const last = segs[segs.length - 1] ?? "";
  if (/\p{L}/u.test(last) || segs.length < 2) return last;
  return `${segs[segs.length - 2]} ${last}`;
}
/** Le libellé APRÈS la valeur (« 0x… (clé privée) »), jusqu'au premier guillemet ou séparateur : le champ suivant d'un
 *  JSON n'en fait jamais partie. */
const zoneAfter = (probe: string, end: number) => probe.slice(end, end + 48).split(/["\n{}[\];|]/)[0] ?? "";

/** Une valeur (0x + 64 hex…) est-elle désignée comme secrète par son libellé ? Un mot fort (« privée », « secret »,
 *  « seed »…) plus proche que tout mot public, avant ou après elle ; sinon un mot ambigu avant elle (weakLabel). */
function isLabeledSecret(probe: string, start: number, end: number, user = false): boolean {
  const before = splitIdent(brands(zoneBefore(probe, start)));
  const after = splitIdent(brands(zoneAfter(probe, end)));
  const b = nearest(wordsOf(before), (x) => before.length - x.end);
  const a = nearest(wordsOf(after), (x) => x.start);
  const secret = Math.min(b.secret, a.secret), pub = Math.min(b.pub, a.pub);
  return (secret !== Infinity && secret <= pub) || weakLabel(before) || (user && stuckWeak(before, after));
}

/** Masque (MASK_KEY) les valeurs de `re` que `keep` retient et que leur libellé désigne comme secrètes. */
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

/** Masque les secrets d'un texte brut ou d'un JSON (voir l'en-tête). Hors alerte, une clé hexadécimale en groupes et une
 *  clé base58 (Solana, WIF) sont aussi masquées quand un mot secret les désigne (en alerte, elles le sont toujours). */
export function scrubSecrets(s: string, o: { user?: boolean } = {}): string {
  const user = o.user === true;
  let out = scrub(s, PHRASE_RULE, user);
  out = maskLabeled(out, SPLIT_HEX_RE, splitHexKey, user);
  out = maskLabeled(out, SOLANA_KEY_RE, mixedB58, user);
  return maskLabeled(out, WIF_RE, mixedB58, user);
}

/** Le message parle-t-il d'une clé privée, d'une phrase de récupération, d'une clé étendue ? Formulations PRÉCISES
 *  seulement (9/11 au soir) : « export », « seed », « secret key » ou « signing key » seuls ne mettent plus la
 *  conversation en alerte (« export my wallet history to CSV », « seed the liquidity pool », « secret key in RSA »). */
const SECRET_MENTION = /\b(?:cl(?:e|ef)s?\s+privee?s?|private\s*keys?|priv\s*keys?|mnemoni\w*|mnemo|(?:seed|recovery|backup)\s*(?:phrases?|words?)|secret\s*phrases?|phrases?\s+(?:secretes?\s+)?(?:de\s+)?(?:recuperation|mnemoniques?|sauvegarde|restauration)|mots?\s+de\s+recuperation)\b/;
/** Clé étendue privée BIP-32 : xprv, yprv, zprv, tprv, uprv, vprv (repliées en minuscules). */
const EXT_PRIV_MENTION = /(?<![\p{L}\p{N}])[xyztuv]prv/u;
export function mentionsSecret(s: string): boolean {
  // identifiants coupés (« privateKey », « PRIVATE_KEY » → « private key »)
  const f = fold(splitIdent(s)).replace(/[_-]+/g, " ");
  return SECRET_MENTION.test(f) || EXT_PRIV_MENTION.test(f);
}

/** Mode alerte : clé hexadécimale coupée en morceaux (lignes, paires, groupes de 2 à 8 chiffres ou plus, le dernier
 *  groupe pouvant être plus court) ; gardée si elle fait 64 chiffres ou plus, avec des lettres a-f ET des chiffres (une
 *  clé aléatoire a les deux ; une table de nombres ou des mots comme « de ce » n'en sont pas). */
const SPLIT_HEX_RE = /(?<![\p{L}\p{N}_])(?:0x)?[0-9a-fA-F]{2,}(?:(?:[ \t]*\r?\n[ \t]*|[ \t]+|[ \t]*[-:.,][ \t]*)[0-9a-fA-F]{2,})+(?:(?:[ \t]+|[ \t]*[-:.,][ \t]*)[0-9a-fA-F])?(?![\p{L}\p{N}_])/gu;
const splitHexKey = (m: string) => {
  const d = m.replace(/^0x/i, "").replace(/[^0-9a-fA-F]/g, "");
  return d.length >= 64 && /[a-fA-F]/.test(d) && /[0-9]/.test(d);
};
/** Mode alerte : clés base58 (alphabet de Bitcoin : ni 0, ni O, ni I, ni l) — clé Solana (64 octets : 87 ou 88
 *  caractères) et clé Bitcoin WIF (51 caractères commençant par 5, 52 par K ou L) ; gardées si elles mêlent chiffres,
 *  majuscules et minuscules (une clé aléatoire le fait toujours). */
const B58 = "[1-9A-HJ-NP-Za-km-z]";
const SOLANA_KEY_RE = new RegExp(`(?<![\\p{L}\\p{N}_])${B58}{87,88}(?![\\p{L}\\p{N}_])`, "gu");
const WIF_RE = new RegExp(`(?<![\\p{L}\\p{N}_])[5KL]${B58}{50,51}(?![\\p{L}\\p{N}_])`, "gu");
const mixedB58 = (m: string) => /[0-9]/.test(m) && /[A-Z]/.test(m) && /[a-z]/.test(m);
/** Mode alerte : clé Solana en tableau d'octets (fichier de solana-keygen) : 32 à 64 nombres de 0 à 255. */
const BYTE_ARRAY_RE = /\[\s*(?:\d{1,3}\s*,\s*){31,63}\d{1,3}\s*\]/g;
const byteArrayKey = (m: string) => (m.match(/\d+/g) ?? []).every((n) => Number(n) <= 255);
/** Mode alerte (9/11 au soir) : MORCEAU hexadécimal (contigu, ou en groupes d'au moins 2 chiffres) d'au moins 16
 *  chiffres, avec des lettres a-f ET des chiffres : la moitié d'une clé coupée entre deux messages (32 + 32), masquée
 *  dès le premier message. Une adresse (0x + 40 hex) reste lisible. */
const HEX_FRAGMENT_RE = /(?<![\p{L}\p{N}_])(?:0x)?[0-9a-fA-F]{2,}(?:(?:[ \t]*\r?\n[ \t]*|[ \t]+|[ \t]*[-:.,][ \t]*)[0-9a-fA-F]{2,})*(?![\p{L}\p{N}_])/gu;
const hexFragment = (m: string) => {
  if (/^0x[0-9a-fA-F]{40}$/.test(m)) return false;
  const d = m.replace(/^0x/i, "").replace(/[^0-9a-fA-F]/g, "");
  return d.length >= 16 && /[a-fA-F]/.test(d) && /[0-9]/.test(d);
};

/** Filtre sévère (mode alerte) d'un texte : seuils de phrase plus bas, puis toute valeur de 64 hex (contiguë ou en
 *  morceaux), tout morceau hexadécimal de 16 chiffres ou plus, clé base58 ou tableau d'octets de clé masqué quel que soit
 *  son libellé. Une adresse (0x + 40 hex) reste lisible. */
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

/** Filtre d'un message de l'UTILISATEUR pris seul : scrubSecrets, ou, s'il parle de clé privée, de phrase de
 *  récupération ou de clé étendue (mentionsSecret), le mode alerte (voir l'en-tête), morceaux de phrase compris.
 *  Pour une conversation, scrubConversation (l'alerte vaut alors pour tous ses messages). */
export function scrubUserMessage(s: string): string {
  if (!s || !mentionsSecret(s)) return scrubSecrets(s, { user: true });
  return scrubAlert(maskPhraseFragments([s])[0]!);
}

/** La conversation est-elle en mode alerte ? Oui dès qu'un message de l'UTILISATEUR parle de clé privée, de phrase de
 *  récupération ou de clé étendue (mentionsSecret ; les réponses du modèle, qui le mettent souvent en garde, ne comptent pas). */
export function conversationAlert(messages: ReadonlyArray<{ role: string; content: string }>): boolean {
  return messages.some((m) => m.role === "user" && typeof m.content === "string" && mentionsSecret(m.content));
}

/** Filtre de TOUTE une conversation (messages du client, dans l'ordre) : hors alerte, scrubSecrets sur chaque message ;
 *  en mode alerte (conversationAlert), les morceaux de phrase répartis entre les messages de l'utilisateur sont masqués,
 *  puis chaque message (de l'utilisateur ou du modèle) passe par le filtre sévère. Seul `content` change. */
export function scrubConversation<M extends { role: string; content: string }>(messages: readonly M[]): { messages: M[]; alert: boolean } {
  const alert = conversationAlert(messages);
  if (!alert) return { alert, messages: messages.map((m) => ({ ...m, content: scrubSecrets(m.content, { user: m.role === "user" }) })) };
  const users = messages.flatMap((m, i) => (m.role === "user" ? [i] : []));
  const contents = messages.map((m) => m.content);
  maskPhraseFragments(users.map((i) => contents[i]!)).forEach((c, k) => { contents[users[k]!] = c; });
  return { alert, messages: messages.map((m, i) => ({ ...m, content: scrubAlert(contents[i]!) })) };
}

/** Retire d'un texte les secrets du serveur lui-même (la clé du modèle…), quel que soit leur format. */
export function redactLiterals(s: string, secrets: readonly string[] = []): string {
  let out = s;
  for (const k of secrets) if (typeof k === "string" && k.length >= 8 && out.includes(k)) out = out.split(k).join(MASK_KEY);
  return out;
}
