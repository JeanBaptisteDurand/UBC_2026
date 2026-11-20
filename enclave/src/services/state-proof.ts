/**
 * state-proof.ts — verification of STATE PROOFS (eth_getProof, EIP-1186) against the stateRoot of a block header.
 *
 * Why (10 Nov 2026): the Sealed Bounty's strict relay already bound each HEADER served to the replay engine to the
 * anchor (keccak256(RLP(header)) = hash, the chain of parentHash values up to block N anchored on-chain), but not the
 * STATE read at block N (balances, nonces, code, storage slots): a lying RPC, constant and well-formed, could change the
 * fork's state without being caught. With one Merkle-Patricia proof per read, checked here against the stateRoot of
 * header N (itself bound to the anchor), NO RPC is trusted any more: even ours can serve only a proven state.
 *
 * Ethereum's state trie (a "secure trie"): an account's key is keccak256(address), a storage slot's key is
 * keccak256(slot on 32 bytes); an account's leaf is RLP([nonce, balance, storageRoot, codeHash]), a slot's leaf is
 * RLP(value without leading zeros). A proof is the list of the path's RLP nodes, from the root to the leaf (or to the
 * point where the path stops: a proof of ABSENCE). A node whose encoding is under 32 bytes is INLINED in its parent (no
 * hash); otherwise the parent carries keccak256(node). CHECKED on 10 Nov on real Arc testnet proofs
 * (test/fixtures/arc-testnet-state-proofs.json: the proofs' balances = eth_getBalance at the same block).
 */
import { fromRlp, keccak256, type Hex } from "viem";

/** Root of an empty trie: keccak256(RLP("")). */
export const EMPTY_TRIE_ROOT: Hex = "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421";
/** Hash of the empty code: keccak256(""). */
export const EMPTY_CODE_HASH: Hex = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
/** 32 zero bytes: what geth announces as the codeHash/storageHash of an absent account (reth announces the empty hashes). */
export const ZERO32: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** An invalid proof (the message is fixed: never a copied value). */
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

/** Maximum size of a proof (nodes) and of a node (bytes): a trie of 64 nibbles has at most 65 levels. */
const MAX_PROOF_NODES = 80;
const MAX_NODE_BYTES = 1 << 13;

function nibblesOf(key: Hex): number[] {
  const out: number[] = [];
  for (let i = 2; i < key.length; i++) out.push(parseInt(key[i]!, 16));
  return out;
}

/** The "hex-prefix" path of a leaf or extension node: a flag (2 = leaf, 1 = odd length), then the nibbles. */
function decodePath(encoded: Hex): { leaf: boolean; path: number[] } {
  const n = nibblesOf(encoded);
  if (n.length === 0) throw new StateProofError("state proof: empty node path");
  const flag = n[0]!;
  if (flag > 3) throw new StateProofError("state proof: invalid path flag");
  const odd = (flag & 1) === 1;
  if (!odd && n[1] !== 0) throw new StateProofError("state proof: even path badly padded");
  return { leaf: (flag & 2) === 2, path: n.slice(odd ? 1 : 2) };
}

function decodeNode(enc: Hex): RlpItem[] {
  let d: RlpItem;
  try {
    d = fromRlp(enc, "hex") as RlpItem;
  } catch {
    throw new StateProofError("state proof: unreadable RLP node");
  }
  if (!Array.isArray(d)) throw new StateProofError("state proof: a node that is not a list");
  return d;
}

type Ref = { hash: string } | { inline: RlpItem[] };

function childRef(c: RlpItem): Ref {
  if (Array.isArray(c)) return { inline: c }; // a node under 32 bytes, inlined in its parent
  if (B32.test(c)) return { hash: c.toLowerCase() };
  throw new StateProofError("state proof: malformed child reference");
}

/**
 * Verifies a Merkle-Patricia proof: `key` is the ALREADY hashed key (32 bytes). Returns the value's bytes (leaf), or
 * null if the proof establishes that the key is ABSENT. Throws StateProofError if the proof proves nothing (a node that
 * does not give back the expected hash, an incomplete proof or one with extra nodes, a malformed node).
 */
export function verifyMptProof(root: Hex, key: Hex, proof: readonly unknown[]): Hex | null {
  if (!B32.test(root) || !B32.test(key)) throw new StateProofError("state proof: 32-byte root and key expected");
  if (!Array.isArray(proof) || proof.length > MAX_PROOF_NODES) throw new StateProofError("state proof: list of nodes expected");
  for (const n of proof) {
    if (typeof n !== "string" || !HEX.test(n) || n.length < 4 || (n.length - 2) / 2 > MAX_NODE_BYTES) {
      throw new StateProofError("state proof: hexadecimal node expected");
    }
  }
  const nodes = proof as readonly Hex[];
  const path = nibblesOf(key);
  let i = 0; // nibbles already consumed
  let p = 0; // proof nodes already read
  const end = (v: Hex | null): Hex | null => {
    if (p !== nodes.length) throw new StateProofError("state proof: extra nodes after the end of the path");
    return v;
  };
  if (root.toLowerCase() === EMPTY_TRIE_ROOT && nodes.length === 0) return null; // empty trie: everything is absent
  let ref: Ref = { hash: root.toLowerCase() };
  for (;;) {
    let node: RlpItem[];
    if ("hash" in ref) {
      if (p >= nodes.length) throw new StateProofError("state proof: incomplete proof");
      const enc = nodes[p++]!;
      if (keccak256(enc) !== ref.hash) throw new StateProofError("state proof: a node that does not give back the expected hash");
      if (enc === "0x80") return end(null); // an empty node (the root of an empty trie served as a node): key absent
      node = decodeNode(enc);
    } else node = ref.inline;

    if (node.length === 17) {
      // branch: 16 children + a value (never used: all the keys are 32 bytes)
      if (i >= path.length) throw new StateProofError("state proof: path longer than the key");
      const child = node[path[i]!]!;
      i++;
      if (child === "0x") return end(null); // empty child: key absent
      ref = childRef(child);
      continue;
    }
    if (node.length === 2) {
      const [encPath, val] = node;
      if (typeof encPath !== "string") throw new StateProofError("state proof: malformed node path");
      const { leaf, path: seg } = decodePath(encPath);
      const rest = path.slice(i);
      const prefix = seg.length <= rest.length && seg.every((x, k) => x === rest[k]);
      if (leaf) {
        if (prefix && seg.length === rest.length) {
          if (typeof val !== "string" || val === "0x") throw new StateProofError("state proof: malformed leaf value");
          return end(val);
        }
        return end(null); // the path leaves the key: key absent
      }
      if (seg.length === 0) throw new StateProofError("state proof: empty extension");
      if (!prefix) return end(null); // the extension leaves the key: key absent
      i += seg.length;
      ref = childRef(val!);
      continue;
    }
    throw new StateProofError("state proof: node of unexpected length");
  }
}

/** An account PROVEN at the block (exists = false: a proof of absence; the values of an empty account). */
export interface ProvedAccount {
  exists: boolean;
  nonce: bigint;
  balance: bigint;
  storageRoot: Hex;
  codeHash: Hex;
}

function rlpUint(v: RlpItem, what: string, maxBytes = 32): bigint {
  if (typeof v !== "string" || (v.length - 2) / 2 > maxBytes) throw new StateProofError(`state proof: ${what} malformed`);
  if (v === "0x") return 0n;
  if (v.startsWith("0x00")) throw new StateProofError(`state proof: ${what} not canonical`);
  return BigInt(v);
}

/** Verifies an account's proof against the block's stateRoot. */
export function verifyAccountProof(stateRoot: Hex, address: Hex, accountProof: readonly unknown[]): ProvedAccount {
  if (!ADDR.test(address)) throw new StateProofError("state proof: address expected");
  const leaf = verifyMptProof(stateRoot, keccak256(address.toLowerCase() as Hex), accountProof);
  if (leaf === null) return { exists: false, nonce: 0n, balance: 0n, storageRoot: EMPTY_TRIE_ROOT, codeHash: EMPTY_CODE_HASH };
  const f = decodeNode(leaf);
  if (f.length !== 4) throw new StateProofError("state proof: account leaf of 4 fields expected");
  const [nonce, balance, storageRoot, codeHash] = f;
  if (typeof storageRoot !== "string" || !B32.test(storageRoot) || typeof codeHash !== "string" || !B32.test(codeHash)) {
    throw new StateProofError("state proof: malformed storage root or code hash");
  }
  return {
    exists: true,
    nonce: rlpUint(nonce!, "nonce", 8),
    balance: rlpUint(balance!, "balance"),
    storageRoot: storageRoot.toLowerCase() as Hex,
    codeHash: codeHash.toLowerCase() as Hex,
  };
}

/** A storage slot on 32 bytes (the key of the proof and of eth_getStorageAt). */
export function slotKey(slot: string): Hex {
  if (!SLOT.test(slot)) throw new StateProofError("state proof: storage slot (≤ 32 bytes) expected");
  return `0x${BigInt(slot).toString(16).padStart(64, "0")}` as Hex;
}

/** Verifies a storage slot's proof against the account's (proven) storage root. Returns its value. */
export function verifyStorageProof(storageRoot: Hex, slot: string, proof: readonly unknown[]): bigint {
  const leaf = verifyMptProof(storageRoot, keccak256(slotKey(slot)), proof);
  if (leaf === null) return 0n;
  let v: RlpItem;
  try {
    v = fromRlp(leaf, "hex") as RlpItem;
  } catch {
    throw new StateProofError("state proof: unreadable slot value");
  }
  const x = rlpUint(v, "slot value");
  if (x === 0n) throw new StateProofError("state proof: zero slot stored (impossible in a real trie)");
  return x;
}

/** The result of eth_getProof, checked and PROVEN: the account and the requested slots. */
export interface ProvedRead {
  account: ProvedAccount;
  /** slot (32 bytes, lower case) → proven value */
  storage: Map<string, bigint>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Checks the answer of eth_getProof(address, slots, N) and PROVES it against `stateRoot` (that of header N, bound to
 * the anchor): shape, address, slots in the requested order, the account's proof, announced fields = proven fields, the
 * proof of each slot. Returns the proven values (they, and not the announced fields, are what the relay gives the engine).
 */
export function checkProofResult(stateRoot: Hex, address: Hex, slots: readonly string[], r: unknown): ProvedRead {
  if (!isObj(r)) throw new StateProofError("state proof: object expected");
  if (typeof r.address !== "string" || r.address.toLowerCase() !== address.toLowerCase()) {
    throw new StateProofError("state proof: proof of another address");
  }
  if (!Array.isArray(r.accountProof) || !Array.isArray(r.storageProof)) throw new StateProofError("state proof: lists of proofs expected");
  const account = verifyAccountProof(stateRoot, address, r.accountProof);
  const qty = (v: unknown) => typeof v === "string" && QTY.test(v);
  if (!qty(r.balance) || !qty(r.nonce) || typeof r.codeHash !== "string" || !B32.test(r.codeHash)
    || typeof r.storageHash !== "string" || !B32.test(r.storageHash)) {
    throw new StateProofError("state proof: malformed account fields");
  }
  // An ABSENT account: reth announces the hashes of the EMPTY account, geth announces ZERO hashes. The proof has already
  // established the absence, so both conventions are accepted for the announced fields (availability, no extra trust).
  const rCode = !account.exists && r.codeHash.toLowerCase() === ZERO32 ? EMPTY_CODE_HASH : (r.codeHash.toLowerCase() as Hex);
  const rStorage = !account.exists && r.storageHash.toLowerCase() === ZERO32 ? EMPTY_TRIE_ROOT : (r.storageHash.toLowerCase() as Hex);
  if (BigInt(r.balance as string) !== account.balance || BigInt(r.nonce as string) !== account.nonce
    || rCode !== account.codeHash || rStorage !== account.storageRoot) {
    throw new StateProofError("state proof: the announced fields are not those the trie proves");
  }
  if (r.storageProof.length !== slots.length) throw new StateProofError("state proof: number of slots differs from the request");
  const storage = new Map<string, bigint>();
  r.storageProof.forEach((s, k) => {
    if (!isObj(s) || typeof s.key !== "string" || !SLOT.test(s.key) || !qty(s.value) || !Array.isArray(s.proof)) {
      throw new StateProofError("state proof: malformed slot proof");
    }
    const want = slotKey(slots[k]!);
    if (slotKey(s.key) !== want) throw new StateProofError("state proof: proof of another slot");
    const v = verifyStorageProof(account.storageRoot, want, s.proof);
    if (BigInt(s.value as string) !== v) throw new StateProofError("state proof: announced slot value differs from the proven value");
    storage.set(want, v);
  });
  return { account, storage };
}

/** Is the code the RPC returns the proven account's code? (empty code ⇔ the hash of the empty code) */
export function checkCode(account: ProvedAccount, code: unknown): Hex {
  if (typeof code !== "string" || !HEX.test(code)) throw new StateProofError("state proof: hexadecimal code expected");
  if (keccak256(code as Hex) !== account.codeHash) throw new StateProofError("state proof: code that does not give back the proven hash");
  return code.toLowerCase() as Hex;
}
