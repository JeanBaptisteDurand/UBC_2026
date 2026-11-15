/**
 * state-proof.ts — vérification des PREUVES D'ÉTAT (eth_getProof, EIP-1186) contre le stateRoot d'un en-tête de bloc.
 *
 * Pourquoi (10/11/2026) : le relais strict de la Prime liait déjà chaque EN-TÊTE servi au moteur de rejeu à l'ancre
 * (keccak256(RLP(en-tête)) = hash, chaîne des parentHash jusqu'au bloc N ancré on-chain), mais pas l'ÉTAT lu au bloc N
 * (soldes, nonces, code, cases de stockage) : un RPC menteur, constant et bien formé, pouvait changer l'état du fork sans
 * être pris. Avec une preuve Merkle-Patricia par lecture, vérifiée ici contre le stateRoot de l'en-tête N (lui-même lié à
 * l'ancre), AUCUN RPC n'est plus de confiance : même le nôtre ne peut servir qu'un état prouvé.
 *
 * Arbre d'état d'Ethereum (« secure trie ») : la clé d'un compte est keccak256(adresse), celle d'une case de stockage
 * keccak256(case sur 32 octets) ; la feuille d'un compte est RLP([nonce, balance, storageRoot, codeHash]), celle d'une case
 * RLP(valeur sans zéros de tête). Une preuve est la liste des nœuds RLP du chemin, de la racine à la feuille (ou au point où
 * le chemin s'arrête : preuve d'ABSENCE). Un nœud dont l'encodage fait moins de 32 octets est INCLUS dans son parent (pas de
 * hash) ; sinon le parent porte keccak256(nœud). VÉRIFIÉ le 10/11 sur de vraies preuves d'Arc testnet
 * (test/fixtures/arc-testnet-state-proofs.json : soldes des preuves = eth_getBalance au même bloc).
 */
import { fromRlp, keccak256, type Hex } from "viem";

/** Racine d'un arbre vide : keccak256(RLP("")). */
export const EMPTY_TRIE_ROOT: Hex = "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421";
/** Hash du code vide : keccak256(""). */
export const EMPTY_CODE_HASH: Hex = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
/** 32 octets nuls : ce que geth annonce comme codeHash/storageHash d'un compte absent (reth annonce les hash du vide). */
export const ZERO32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Preuve invalide (le message est fixe : jamais de valeur recopiée). */
export class StateProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateProofError";
  }
}

type RlpItem = Hex | RlpItem[];

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const B32 = /^0x[0-9a-fA-F]{64}$/;
const QTY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const SLOT = /^0x[0-9a-fA-F]{1,64}$/;

/** Taille maximale d'une preuve (nœuds) et d'un nœud (octets) : un arbre de 64 quartets a au plus 65 niveaux. */
const MAX_PROOF_NODES = 80;
const MAX_NODE_BYTES = 1 << 13;

function nibblesOf(key: Hex): number[] {
  const out: number[] = [];
  for (let i = 2; i < key.length; i++) out.push(parseInt(key[i]!, 16));
  return out;
}

/** Chemin « hex-prefix » d'un nœud feuille ou extension : drapeau (2 = feuille, 1 = longueur impaire) puis quartets. */
function decodePath(encoded: Hex): { leaf: boolean; path: number[] } {
  const n = nibblesOf(encoded);
  if (n.length === 0) throw new StateProofError("preuve d'état : chemin de nœud vide");
  const flag = n[0]!;
  if (flag > 3) throw new StateProofError("preuve d'état : drapeau de chemin invalide");
  const odd = (flag & 1) === 1;
  if (!odd && n[1] !== 0) throw new StateProofError("preuve d'état : chemin pair mal rembourré");
  return { leaf: (flag & 2) === 2, path: n.slice(odd ? 1 : 2) };
}

function decodeNode(enc: Hex): RlpItem[] {
  let d: RlpItem;
  try {
    d = fromRlp(enc, "hex") as RlpItem;
  } catch {
    throw new StateProofError("preuve d'état : nœud RLP illisible");
  }
  if (!Array.isArray(d)) throw new StateProofError("preuve d'état : nœud qui n'est pas une liste");
  return d;
}

type Ref = { hash: string } | { inline: RlpItem[] };

function childRef(c: RlpItem): Ref {
  if (Array.isArray(c)) return { inline: c }; // nœud de moins de 32 octets, inclus dans son parent
  if (B32.test(c)) return { hash: c.toLowerCase() };
  throw new StateProofError("preuve d'état : référence d'enfant mal formée");
}

/**
 * Vérifie une preuve Merkle-Patricia : `key` est la clé DÉJÀ hachée (32 octets). Rend les octets de la valeur (feuille),
 * ou null si la preuve établit que la clé est ABSENTE. Lève StateProofError si la preuve ne prouve rien (nœud qui ne redonne
 * pas le hash attendu, preuve incomplète ou avec des nœuds en trop, nœud mal formé).
 */
export function verifyMptProof(root: Hex, key: Hex, proof: readonly unknown[]): Hex | null {
  if (!B32.test(root) || !B32.test(key)) throw new StateProofError("preuve d'état : racine et clé de 32 octets attendues");
  if (!Array.isArray(proof) || proof.length > MAX_PROOF_NODES) throw new StateProofError("preuve d'état : liste de nœuds attendue");
  for (const n of proof) {
    if (typeof n !== "string" || !HEX.test(n) || n.length < 4 || (n.length - 2) / 2 > MAX_NODE_BYTES) {
      throw new StateProofError("preuve d'état : nœud hexadécimal attendu");
    }
  }
  const nodes = proof as readonly Hex[];
  const path = nibblesOf(key);
  let i = 0; // quartets déjà consommés
  let p = 0; // nœuds de la preuve déjà lus
  const end = (v: Hex | null): Hex | null => {
    if (p !== nodes.length) throw new StateProofError("preuve d'état : nœuds en trop après la fin du chemin");
    return v;
  };
  if (root.toLowerCase() === EMPTY_TRIE_ROOT && nodes.length === 0) return null; // arbre vide : tout est absent
  let ref: Ref = { hash: root.toLowerCase() };
  for (;;) {
    let node: RlpItem[];
    if ("hash" in ref) {
      if (p >= nodes.length) throw new StateProofError("preuve d'état : preuve incomplète");
      const enc = nodes[p++]!;
      if (keccak256(enc) !== ref.hash) throw new StateProofError("preuve d'état : nœud qui ne redonne pas le hash attendu");
      if (enc === "0x80") return end(null); // nœud vide (racine d'un arbre vide servie comme nœud) : clé absente
      node = decodeNode(enc);
    } else node = ref.inline;

    if (node.length === 17) {
      // branche : 16 enfants + une valeur (jamais employée : toutes les clés font 32 octets)
      if (i >= path.length) throw new StateProofError("preuve d'état : chemin plus long que la clé");
      const child = node[path[i]!]!;
      i++;
      if (child === "0x") return end(null); // enfant vide : clé absente
      ref = childRef(child);
      continue;
    }
    if (node.length === 2) {
      const [encPath, val] = node;
      if (typeof encPath !== "string") throw new StateProofError("preuve d'état : chemin de nœud mal formé");
      const { leaf, path: seg } = decodePath(encPath);
      const rest = path.slice(i);
      const prefix = seg.length <= rest.length && seg.every((x, k) => x === rest[k]);
      if (leaf) {
        if (prefix && seg.length === rest.length) {
          if (typeof val !== "string" || val === "0x") throw new StateProofError("preuve d'état : valeur de feuille mal formée");
          return end(val);
        }
        return end(null); // le chemin s'écarte de la clé : clé absente
      }
      if (seg.length === 0) throw new StateProofError("preuve d'état : extension vide");
      if (!prefix) return end(null); // l'extension s'écarte de la clé : clé absente
      i += seg.length;
      ref = childRef(val!);
      continue;
    }
    throw new StateProofError("preuve d'état : nœud de longueur inattendue");
  }
}

/** Un compte PROUVÉ au bloc (exists = false : preuve d'absence ; valeurs d'un compte vide). */
export interface ProvedAccount {
  exists: boolean;
  nonce: bigint;
  balance: bigint;
  storageRoot: Hex;
  codeHash: Hex;
}

function rlpUint(v: RlpItem, what: string, maxBytes = 32): bigint {
  if (typeof v !== "string" || (v.length - 2) / 2 > maxBytes) throw new StateProofError(`preuve d'état : ${what} mal formé`);
  if (v === "0x") return 0n;
  if (v.startsWith("0x00")) throw new StateProofError(`preuve d'état : ${what} non canonique`);
  return BigInt(v);
}

/** Vérifie la preuve d'un compte contre le stateRoot du bloc. */
export function verifyAccountProof(stateRoot: Hex, address: Hex, accountProof: readonly unknown[]): ProvedAccount {
  if (!ADDR.test(address)) throw new StateProofError("preuve d'état : adresse attendue");
  const leaf = verifyMptProof(stateRoot, keccak256(address.toLowerCase() as Hex), accountProof);
  if (leaf === null) return { exists: false, nonce: 0n, balance: 0n, storageRoot: EMPTY_TRIE_ROOT, codeHash: EMPTY_CODE_HASH };
  const f = decodeNode(leaf);
  if (f.length !== 4) throw new StateProofError("preuve d'état : feuille de compte de 4 champs attendue");
  const [nonce, balance, storageRoot, codeHash] = f;
  if (typeof storageRoot !== "string" || !B32.test(storageRoot) || typeof codeHash !== "string" || !B32.test(codeHash)) {
    throw new StateProofError("preuve d'état : racine de stockage ou hash de code mal formés");
  }
  return {
    exists: true,
    nonce: rlpUint(nonce!, "nonce", 8),
    balance: rlpUint(balance!, "solde"),
    storageRoot: storageRoot.toLowerCase() as Hex,
    codeHash: codeHash.toLowerCase() as Hex,
  };
}

/** Une case de stockage sur 32 octets (clé de la preuve et de eth_getStorageAt). */
export function slotKey(slot: string): Hex {
  if (!SLOT.test(slot)) throw new StateProofError("preuve d'état : case de stockage (≤ 32 octets) attendue");
  return `0x${BigInt(slot).toString(16).padStart(64, "0")}` as Hex;
}

/** Vérifie la preuve d'une case de stockage contre la racine de stockage du compte (prouvée). Rend sa valeur. */
export function verifyStorageProof(storageRoot: Hex, slot: string, proof: readonly unknown[]): bigint {
  const leaf = verifyMptProof(storageRoot, keccak256(slotKey(slot)), proof);
  if (leaf === null) return 0n;
  let v: RlpItem;
  try {
    v = fromRlp(leaf, "hex") as RlpItem;
  } catch {
    throw new StateProofError("preuve d'état : valeur de case illisible");
  }
  const x = rlpUint(v, "valeur de case");
  if (x === 0n) throw new StateProofError("preuve d'état : case nulle stockée (impossible dans un vrai arbre)");
  return x;
}

/** Résultat d'eth_getProof contrôlé et PROUVÉ : le compte et les cases demandées. */
export interface ProvedRead {
  account: ProvedAccount;
  /** case (32 octets, minuscules) → valeur prouvée */
  storage: Map<string, bigint>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Contrôle la réponse d'eth_getProof(address, slots, N) et la PROUVE contre `stateRoot` (celui de l'en-tête N, lié à
 * l'ancre) : forme, adresse, cases dans l'ordre demandé, preuve du compte, champs annoncés = champs prouvés, preuve de
 * chaque case. Rend les valeurs prouvées (ce sont elles, et non les champs annoncés, que le relais rend au moteur).
 */
export function checkProofResult(stateRoot: Hex, address: Hex, slots: readonly string[], r: unknown): ProvedRead {
  if (!isObj(r)) throw new StateProofError("preuve d'état : objet attendu");
  if (typeof r.address !== "string" || r.address.toLowerCase() !== address.toLowerCase()) {
    throw new StateProofError("preuve d'état : preuve d'une autre adresse");
  }
  if (!Array.isArray(r.accountProof) || !Array.isArray(r.storageProof)) throw new StateProofError("preuve d'état : listes de preuves attendues");
  const account = verifyAccountProof(stateRoot, address, r.accountProof);
  const qty = (v: unknown) => typeof v === "string" && QTY.test(v);
  if (!qty(r.balance) || !qty(r.nonce) || typeof r.codeHash !== "string" || !B32.test(r.codeHash)
    || typeof r.storageHash !== "string" || !B32.test(r.storageHash)) {
    throw new StateProofError("preuve d'état : champs du compte mal formés");
  }
  // Un compte ABSENT : reth annonce les hash du compte VIDE, geth des hash NULS. La preuve, elle, a déjà établi
  // l'absence ; on accepte donc les deux conventions pour les champs annoncés (disponibilité, pas de confiance en plus).
  const rCode = !account.exists && r.codeHash.toLowerCase() === ZERO32 ? EMPTY_CODE_HASH : (r.codeHash.toLowerCase() as Hex);
  const rStorage = !account.exists && r.storageHash.toLowerCase() === ZERO32 ? EMPTY_TRIE_ROOT : (r.storageHash.toLowerCase() as Hex);
  if (BigInt(r.balance as string) !== account.balance || BigInt(r.nonce as string) !== account.nonce
    || rCode !== account.codeHash || rStorage !== account.storageRoot) {
    throw new StateProofError("preuve d'état : les champs annoncés ne sont pas ceux que prouve l'arbre");
  }
  if (r.storageProof.length !== slots.length) throw new StateProofError("preuve d'état : nombre de cases différent de la demande");
  const storage = new Map<string, bigint>();
  r.storageProof.forEach((s, k) => {
    if (!isObj(s) || typeof s.key !== "string" || !SLOT.test(s.key) || !qty(s.value) || !Array.isArray(s.proof)) {
      throw new StateProofError("preuve d'état : preuve de case mal formée");
    }
    const want = slotKey(slots[k]!);
    if (slotKey(s.key) !== want) throw new StateProofError("preuve d'état : preuve d'une autre case");
    const v = verifyStorageProof(account.storageRoot, want, s.proof);
    if (BigInt(s.value as string) !== v) throw new StateProofError("preuve d'état : valeur de case annoncée différente de la valeur prouvée");
    storage.set(want, v);
  });
  return { account, storage };
}

/** Le code rendu par le RPC est-il celui du compte prouvé ? (code vide ⇔ hash du code vide) */
export function checkCode(account: ProvedAccount, code: unknown): Hex {
  if (typeof code !== "string" || !HEX.test(code)) throw new StateProofError("preuve d'état : code hexadécimal attendu");
  if (keccak256(code as Hex) !== account.codeHash) throw new StateProofError("preuve d'état : code qui ne redonne pas le hash prouvé");
  return code.toLowerCase() as Hex;
}
