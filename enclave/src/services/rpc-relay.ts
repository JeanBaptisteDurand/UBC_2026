/**
 * rpc-relay.ts — a STRICT JSON-RPC RELAY between the replay engine (anvil / arc-anvil) and the fork's RPC (FORK_RPC_URL).
 *
 * Why (adversarial review of 9 Nov, proof verif-failclosed/e1-blockhash-null): the engine takes some INVALID answers of
 * the fork's RPC for values, without an error. `null` for a recent block (the normal answer of a node that does not have
 * that block yet) becomes BLOCKHASH = keccak256(""); "0x" or a JSON number for a storage slot becomes 0 or 5. The
 * replay then returned false measurements, and the enclave signed them (a false claim, or a refutation of a true
 * claim). So the engine no longer talks to the fork's RPC: it talks to this relay (127.0.0.1, an ephemeral port, one
 * relay per replay and per start-up check), which forwards each request and CHECKS the shape of each result before
 * returning it:
 *  - allowed methods: those that anvil 1.5.1 and arc-anvil v0.8.0-4 use to fork (recorded on 9 Nov); any other method
 *    is refused;
 *  - state read AT BLOCK N ONLY (block tag = N in hexadecimal): never "latest", never another block;
 *  - eth_getStorageAt: exactly 32 bytes; quantities (balance, nonce, block number, chainId, gas price) in canonical
 *    hexadecimal; eth_getCode: even-length hexadecimal ("0x" allowed: an account without code); eth_getAccountInfo:
 *    { balance, nonce, code } of these shapes;
 *  - blocks ≤ N: never null; number = the one requested; hash and header fields in the right format; the hash of block
 *    N = the anchor (a hash verified through the quorum or on-chain); the hash of a block n < N tied to the anchor by
 *    the chain of parentHash values (n+1 … N);
 *  - receipts and transactions requested by hash (fork transactions only): null required.
 * Any INVALID answer (shape, null block, chain, a false JSON-RPC envelope: version, id, result AND error), any method or
 * parameter not provided for, and any overrun of the replay's request BUDGET is a VIOLATION: the engine receives a
 * JSON-RPC error, and the violation is REMEMBERED (a lock): the replay that suffered it fails closed
 * (ReplayUnavailableError, HTTP 503, nothing is signed), even if the engine retried and then got a good answer.
 * A replay is signed only if no invalid answer was seen.
 * A PASSING failure of the fork's RPC (a JSON-RPC error, an HTTP status ≠ 200, network, timeout, an unreadable body) is
 * not a value: it goes back to the engine AS IT IS (the JSON-RPC error as it is, the same HTTP status; 502 for the
 * network or an unreadable body), as if the engine were talking to the fork's RPC. Either the engine fails (the replay
 * fails closed), or it retries (rate limit, 429, 503: checked, it finds the right value again), and the retried answer
 * is checked like the others. Each attempt counts in the budget.
 *
 * v2.1 quater (adversarial verification, evening of 9 Nov, proofs verif-relay r1-B, r1-E, r1-G, r2, r3-1a), a LYING RPC:
 *  - HEADER BOUND TO ITS HASH ("arc" policy, the DEFAULT): the 21 Arc header fields (London → Prague) are REQUIRED and
 *    keccak256(RLP(header)) must give back `hash` (CHECKED on 9 Nov on real Arc testnet blocks and on anvil 1.5.1).
 *    With the anchor (the hash of block N verified through the quorum or on-chain) and the chain of parentHash values,
 *    each header served to the engine is the real chain's: the timestamp, base fee, PREVRANDAO (mixHash), miner,
 *    gasLimit and excessBlobGas of block N, and BLOCKHASH(N − k). A header with the right hash but changed content: a
 *    "header" violation;
 *  - redirects are NEVER followed (the JSON-RPC body never goes to another host): a passing failure (502);
 *  - answers are read AS A STREAM, cut beyond MAX_RESPONSE_BYTES (no giant answer kept in memory): a passing failure
 *    (502);
 *  - MEMORY OF THE REPLAY'S ANSWERS: the state at block N and the blocks ≤ N are immutable. The same read (the same
 *    canonical key: lower-case address, slot as an integer; balance, nonce and code cross-checked between
 *    eth_getAccountInfo and the separate reads; a block by number or by hash) that comes back with another value: an
 *    "inconsistent" violation. eth_blockNumber and eth_gasPrice (which change over time) are exempt.
 * A limit: WITHOUT the stateProofs option, the relay binds the headers to the anchor, not the STATE served at block N;
 * an RPC that lies about the state with well-formed, constant answers is then not detected. A block's transaction list
 * is not recomputed against transactionsRoot (the engine does not execute them).
 *
 * 10 Nov 2026, STATE PROOFS (stateProofs option): each state read at block N (balance, nonce, code, storage slot,
 * eth_getAccountInfo) is requested as eth_getProof (EIP-1186) from the proof RPC and CHECKED against the stateRoot of
 * header N (itself bound to the anchor): the relay returns the PROVEN values to the engine, and the code only if it
 * gives back the proven code hash. A false proof: a "state_proof" violation (nothing is signed); an unavailable proof
 * (a node outside its window, an outage): a passing failure, so the replay fails closed. No RPC is trusted for the
 * state any more.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { keccak256, toRlp, type Hex } from "viem";
import { StateProofError, checkCode, checkProofResult, slotKey, type ProvedAccount } from "./state-proof.js";

/** Default budget: requests to the fork's RPC for ONE replay (relay included). Beyond it: a violation, fail closed (503). */
export const DEFAULT_MAX_FORK_REQUESTS = 2_000;
/** Timeout of a request to the fork's RPC. */
export const RELAY_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 1 << 20; // the engine's requests are small
/** v2.1 quater: the maximum size of an answer of the fork's RPC, in bytes, READ AS A STREAM (beyond it: the read is cut,
 *  the connection closed, a passing failure 502). An Arc block with its full transactions fits far below it. */
export const MAX_RESPONSE_BYTES = 64 << 20;
/** The JSON-RPC code returned to the engine for a refused answer (internal error: the engine does not retry it like a limit). */
export const RELAY_ERROR_CODE = -32603;

export type RelayViolationKind =
  | "budget" // more requests than the replay's budget
  | "method" // a method not provided for
  | "params" // unexpected parameters (a block other than N, a non-numeric tag, a block beyond N…)
  | "shape" // a result of unexpected shape
  | "null_block" // null for a block ≤ N
  | "chain" // a block hash that is not the anchor's, or that is not tied to it by the parentHash values
  | "envelope" // an invalid JSON-RPC envelope from the fork's RPC: version, id of another request, result AND error
  | "header" // v2.1 quater: a header whose content does not give back the hash (keccak256(RLP(header)) ≠ hash)
  | "inconsistent" // v2.1 quater: the same read (state at block N, block ≤ N, chainId) returned with two different values
  | "state_proof" // 10 Nov: a state proof (eth_getProof) that does not verify against the stateRoot of the anchored header N
  | "internal"; // an unexpected exception in the relay (fail closed)

/** An answer of the fork's RPC refused by the relay (remembered). FIXED message (never a copied value or parameter). */
export class RelayViolation extends Error {
  constructor(readonly kind: RelayViolationKind, readonly method: string, message: string) {
    super(message);
    this.name = "RelayViolation";
  }
}

/**
 * A PASSING failure of the fork's RPC (not a value, not remembered): a JSON-RPC error (`rpcError`, returned as it is to
 * the engine) or an HTTP / network / timeout / unreadable-body failure (`http`: the status returned to the engine, 502 for the network).
 */
export class UpstreamFailure extends Error {
  constructor(readonly method: string, readonly failure: { http: number } | { rpcError: { code: number; message: string } }) {
    super("http" in failure ? `fork RPC: HTTP or network failure (${failure.http})` : "fork RPC: JSON-RPC error");
    this.name = "UpstreamFailure";
  }
}

// ---------- formes ----------

const QTY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const B32 = /^0x[0-9a-fA-F]{64}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const EVEN_HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const BLOOM = /^0x[0-9a-fA-F]{512}$/;
const NONCE8 = /^0x[0-9a-fA-F]{16}$/;
const SLOT = /^0x[0-9a-fA-F]{1,64}$/;

const isQty = (v: unknown): v is string => typeof v === "string" && QTY.test(v);
const isB32 = (v: unknown): v is string => typeof v === "string" && B32.test(v);
const isAddr = (v: unknown): v is string => typeof v === "string" && ADDR.test(v);
const isEvenHex = (v: unknown): v is string => typeof v === "string" && EVEN_HEX.test(v);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/**
 * v2.1 quater: the header contract of the blocks the fork's RPC returns.
 *  - "arc" (the DEFAULT, the image's): the 21 Arc header fields (HEADER_FIELDS) are REQUIRED and BOUND to the hash:
 *    keccak256(RLP(header)) = hash, otherwise a "header" violation;
 *  - "shape" (TESTS ONLY, or a chain with another format): the shape alone (v2.1 ter): 12 fields required, the others
 *    checked if present, content NOT bound to the hash (a lying RPC can then change the timestamp of block N without
 *    changing its hash: proof r3-1a).
 */
export type HeaderPolicy = "arc" | "shape";

type FieldKind = "b32" | "addr" | "bloom" | "qty" | "bytes" | "nonce8";
/** The 21 Arc header fields, in protocol order (London → Prague): the order of the RLP behind the block hash (recorded
 *  on 9 Nov: Arc testnet's RPC always returns them; so does anvil 1.5.1). */
const HEADER_FIELDS: ReadonlyArray<readonly [string, FieldKind]> = [
  ["parentHash", "b32"], ["sha3Uncles", "b32"], ["miner", "addr"], ["stateRoot", "b32"], ["transactionsRoot", "b32"],
  ["receiptsRoot", "b32"], ["logsBloom", "bloom"], ["difficulty", "qty"], ["number", "qty"], ["gasLimit", "qty"],
  ["gasUsed", "qty"], ["timestamp", "qty"], ["extraData", "bytes"], ["mixHash", "b32"], ["nonce", "nonce8"],
  ["baseFeePerGas", "qty"], ["withdrawalsRoot", "b32"], ["blobGasUsed", "qty"], ["excessBlobGas", "qty"],
  ["parentBeaconBlockRoot", "b32"], ["requestsHash", "b32"],
];
const KIND_OK: Record<FieldKind, (v: unknown) => boolean> = {
  b32: isB32,
  addr: isAddr,
  bloom: (v) => typeof v === "string" && BLOOM.test(v),
  qty: isQty,
  bytes: isEvenHex,
  nonce8: (v) => typeof v === "string" && NONCE8.test(v),
};
/** The shape of each known field of a block: the 21 header fields, the hash, and the fields outside the header (not bound
 *  to the hash; the engine does not use them to execute). Every known field that is PRESENT is checked, whatever the policy. */
const BLOCK_FIELDS: Record<string, (v: unknown) => boolean> = {
  ...Object.fromEntries(HEADER_FIELDS.map(([k, kind]) => [k, KIND_OK[kind]])),
  hash: isB32,
  totalDifficulty: isQty,
  size: isQty,
  uncles: (v) => Array.isArray(v) && v.every(isB32),
  withdrawals: (v) => Array.isArray(v) && v.every(isPlainObject),
};
/** REQUIRED fields per policy ("shape": those of v2.1 ter; "arc": the 21 header fields and the hash). */
const REQUIRED: Record<HeaderPolicy, readonly string[]> = {
  arc: [...HEADER_FIELDS.map(([k]) => k), "hash"],
  shape: ["number", "hash", "parentHash", "timestamp", "gasLimit", "gasUsed", "miner", "stateRoot", "transactionsRoot", "receiptsRoot", "logsBloom", "extraData"],
};

/** A JSON-RPC quantity as an RLP integer: minimal big-endian bytes, zero = the empty string. */
function rlpQuantity(q: string): Hex {
  const h = BigInt(q).toString(16);
  return h === "0" ? "0x" : (`0x${h.length % 2 ? "0" : ""}${h}` as Hex);
}

/**
 * v2.1 quater: keccak256(RLP(header)): the 21 Arc header fields in protocol order (HEADER_FIELDS), quantities as minimal
 * integers, the other fields as raw bytes. This is the block hash (CHECKED on 9 Nov on real Arc testnet blocks and on
 * anvil 1.5.1). The block must have the shape of the "arc" policy (checkBlockShape).
 */
export function blockHeaderHash(b: Record<string, unknown>): Hex {
  return keccak256(toRlp(HEADER_FIELDS.map(([k, kind]) => (kind === "qty" ? rlpQuantity(b[k] as string) : (b[k] as Hex)))));
}

/**
 * Checks a block returned by the fork's RPC (`full`: full transactions or hashes) under the header policy (default
 * "arc": 21 fields required, the header bound to the hash). Throws RelayViolation ("null_block", "shape", "header").
 */
export function checkBlockShape(method: string, b: unknown, full: boolean, policy: HeaderPolicy = "arc"): { number: bigint; hash: string; parentHash: string; stateRoot: string } {
  if (b === null) throw new RelayViolation("null_block", method, "block missing (null) instead of a block ≤ N: nothing is signed");
  if (!isPlainObject(b)) throw new RelayViolation("shape", method, "block: object expected");
  for (const k of REQUIRED[policy]) {
    if (b[k] === undefined) throw new RelayViolation("shape", method, `block: field ${k} missing`);
  }
  for (const [k, ok] of Object.entries(BLOCK_FIELDS)) {
    if (b[k] !== undefined && !ok(b[k])) throw new RelayViolation("shape", method, `block: field ${k} malformed`);
  }
  const txs = b.transactions;
  if (!Array.isArray(txs)) throw new RelayViolation("shape", method, "block: transactions (array) expected");
  for (const t of txs) {
    const ok = full ? isPlainObject(t) && isB32(t.hash) : isB32(t);
    if (!ok) throw new RelayViolation("shape", method, `block: ${full ? "full transactions (objects with a hash)" : "transactions (32-byte hashes)"} expected`);
  }
  const hash = (b.hash as string).toLowerCase();
  // v2.1 quater: the CONTENT of the header is bound to its hash (and, through the anchor and the parentHash values, to the real chain)
  if (policy === "arc" && blockHeaderHash(b) !== hash) {
    throw new RelayViolation("header", method, "block: the header does not give back its hash (keccak256(RLP(header)) ≠ hash): nothing is signed");
  }
  return { number: BigInt(b.number as string), hash, parentHash: (b.parentHash as string).toLowerCase(), stateRoot: (b.stateRoot as string).toLowerCase() };
}

/** v2.1 quater: the canonical form of a JSON value (lower-case hexadecimal, sorted keys) and its fingerprint. */
function canonical(v: unknown): unknown {
  if (typeof v === "string") return v.toLowerCase();
  if (Array.isArray(v)) return v.map(canonical);
  if (isPlainObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}
const fingerprint = (v: unknown): string => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");

/**
 * v2.1 quater: reads the body of an HTTP answer AS A STREAM, at most `maxBytes` bytes; beyond it (or if Content-Length
 * announces it), the read is cut (the body is cancelled, the connection closed) and it returns undefined. UTF-8
 * decoding as in Response.text(). Read errors (the signal's timeout, a cut connection) propagate as they are.
 */
export async function readBodyBounded(res: Response, maxBytes: number): Promise<string | undefined> {
  const declared = Number(res.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks, size));
}

// ---------- the relay ----------

export interface StrictRelayOptions {
  /** The fork's RPC (FORK_RPC_URL). */
  upstream: string;
  /** Block N of the replay: all the state is read at this block; no block beyond it. */
  blockN: bigint;
  /** The expected hash of block N (the anchor). When absent: pinned at the first read of block N. */
  anchorHash?: Hex;
  /** Request budget for the fork's RPC (default DEFAULT_MAX_FORK_REQUESTS). */
  maxRequests?: number;
  /** Timeout of a request to the fork's RPC (default RELAY_TIMEOUT_MS). */
  timeoutMs?: number;
  /** After the first violation, refuse every request without forwarding it (replay: true; start-up check: false, its
   *  points are independent). */
  failFast?: boolean;
  /** TESTS ONLY: false = a transparent relay (no check of shape or chain, budget included), to show what the relay
   *  prevents (the start-up check must then refuse the engine). */
  checks?: boolean;
  /** v2.1 quater: the header contract of the blocks (default "arc": 21 fields required, the header bound to the hash;
   *  "shape": tests with synthetic blocks only). */
  headerPolicy?: HeaderPolicy;
  /** v2.1 quater: the maximum size of an answer of the fork's RPC, in bytes (default MAX_RESPONSE_BYTES). */
  maxResponseBytes?: number;
  /** 10 Nov: STATE PROOFS. When present, each state read at block N is proven (eth_getProof checked against the stateRoot
   *  of the anchored header N); `upstream` = the proof RPC (default: the fork's RPC). Requires the "arc" header policy. */
  stateProofs?: { upstream?: string };
  /** 11 Nov: the replay's expected chainId. When present, the relay REQUIRES `eth_chainId` of the fork's RPC to be exactly
   *  this value (otherwise a "chain" violation, nothing is signed); without it, a lying RPC would set the replay's CHAINID. */
  expectedChainId?: number;
}

export interface StrictRelay {
  /** The URL to give the engine (--fork-url). */
  readonly url: string;
  /** Requests made to the fork's RPC (budget). */
  readonly requests: number;
  /** The first violation (the lock), or undefined. */
  readonly violation: RelayViolation | undefined;
  /** All the violations (bounded). */
  readonly violations: readonly RelayViolation[];
  /** Passing failures of the fork's RPC returned to the engine (not remembered as violations). */
  readonly upstreamFailures: number;
  /** The hash of block N returned by the fork's RPC, checked (shape, anchor); throws RelayViolation or UpstreamFailure. */
  anchor(): Promise<string>;
  /** A call by the relay itself (the same checks as for the engine); throws RelayViolation or UpstreamFailure. */
  call(method: string, params: unknown[]): Promise<unknown>;
  close(): Promise<void>;
}

const MAX_KEPT_VIOLATIONS = 32;

/** The answer of one item to the engine: a JSON-RPC envelope, or an HTTP status to return as it is (a passing failure). */
type Answer = { rpc: unknown } | { http: number };

class Relay implements StrictRelay {
  url = "";
  requests = 0;
  violations: RelayViolation[] = [];
  upstreamFailures = 0;
  private server: Server | undefined;
  private seq = 0;
  private readonly max: number;
  private readonly checks: boolean;
  private readonly policy: HeaderPolicy;
  private readonly maxResponseBytes: number;
  /** Block hashes tied to the anchor (lower case), from `lowest` to N without a gap. */
  private hashes = new Map<bigint, string>();
  private lowest: bigint;
  /** Headers already read and checked (by the engine or by the relay). */
  private headers = new Map<bigint, Promise<{ hash: string; parentHash: string; stateRoot: string }>>();
  /** 10 Nov: accounts, slots and codes PROVEN at block N (key: lower-case address; address:slot on 32 bytes). */
  private provedAccounts = new Map<string, Promise<ProvedAccount>>();
  private provedSlots = new Map<string, Promise<bigint>>();
  private provedCodes = new Map<string, Promise<Hex>>();
  private rootN: Promise<Hex> | undefined;
  /** v2.1 quater: the fingerprint of the first valid answer of each read (canonical key); bounded by the budget. */
  private memo = new Map<string, string>();

  constructor(private o: StrictRelayOptions) {
    this.max = o.maxRequests ?? DEFAULT_MAX_FORK_REQUESTS;
    this.checks = o.checks !== false;
    this.policy = o.headerPolicy ?? "arc";
    this.maxResponseBytes = o.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    this.lowest = o.blockN;
    if (o.anchorHash !== undefined) this.hashes.set(o.blockN, o.anchorHash.toLowerCase());
    // a state proof is worth something only against a stateRoot BOUND to the block hash: the "arc" policy is required
    if (o.stateProofs && this.policy !== "arc") throw new Error("strict relay: state proofs require the \"arc\" header policy");
    // without an anchor, a lying RPC would forge header N AND proofs consistent with it: the anchor is required
    if (o.stateProofs && o.anchorHash === undefined) throw new Error("strict relay: state proofs require the anchor (the verified hash of block N)");
  }

  get violation(): RelayViolation | undefined {
    return this.violations[0];
  }

  private violate(v: RelayViolation): RelayViolation {
    if (this.violations.length < MAX_KEPT_VIOLATIONS) this.violations.push(v);
    return v;
  }

  async listen(): Promise<void> {
    this.server = createServer((rq, rs) => {
      if (rq.method !== "POST") {
        rs.writeHead(405);
        rs.end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let tooBig = false;
      rq.on("data", (d: Buffer) => {
        size += d.length;
        if (size > MAX_REQUEST_BYTES) tooBig = true;
        else chunks.push(d);
      });
      rs.on("error", () => undefined); // the engine stopped during a request: nothing to answer it
      rq.on("end", () => {
        void this.respond(tooBig ? undefined : Buffer.concat(chunks).toString("utf8")).then(
          (out) => {
            if (rs.destroyed || rs.writableEnded) return;
            if ("http" in out) {
              // a passing failure of the fork's RPC: the same status, as if the engine were talking to it (it retries or fails)
              rs.writeHead(out.http, { "content-type": "text/plain" });
              rs.end("strict relay: passing failure of the fork's RPC");
            } else {
              rs.writeHead(200, { "content-type": "application/json" });
              rs.end(out.json);
            }
          },
          () => {
            this.violate(new RelayViolation("internal", "?", "unexpected exception in the relay"));
            if (rs.destroyed || rs.writableEnded) return;
            rs.writeHead(500);
            rs.end();
          },
        );
      });
      rq.on("error", () => rs.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  close(): Promise<void> {
    const s = this.server;
    if (!s) return Promise.resolve();
    return new Promise<void>((r) => {
      s.closeAllConnections?.();
      s.close(() => r());
    });
  }

  /** A request (or a batch) from the engine → the answer (JSON, or the HTTP status of a passing failure to return as it is). */
  private async respond(body: string | undefined): Promise<{ json: string } | { http: number }> {
    let j: unknown;
    try {
      if (body === undefined) throw new SyntaxError("too large");
      j = JSON.parse(body);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      this.violate(new RelayViolation("params", "?", "unreadable request from the engine"));
      return { json: JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "strict relay: unreadable request" } }) };
    }
    const answers = Array.isArray(j) ? await Promise.all(j.map((q) => this.one(q))) : [await this.one(j)];
    const failed = answers.find((a): a is { http: number } => "http" in a);
    if (failed) return failed; // a batch: like the fork's RPC, one status for the whole answer
    const rpc = answers.map((a) => (a as { rpc: unknown }).rpc);
    return { json: JSON.stringify(Array.isArray(j) ? rpc : rpc[0]) };
  }

  private async one(q: unknown): Promise<Answer> {
    const id = isPlainObject(q) && (typeof q.id === "number" || typeof q.id === "string") ? q.id : null;
    const method = isPlainObject(q) && typeof q.method === "string" ? q.method : "?";
    const refused = (kind: string) => ({ rpc: { jsonrpc: "2.0", id, error: { code: RELAY_ERROR_CODE, message: `relais strict : ${kind}` } } });
    try {
      if (!isPlainObject(q) || method === "?" || (q.params !== undefined && !Array.isArray(q.params))) {
        throw this.violate(new RelayViolation("params", method, "malformed JSON-RPC request from the engine"));
      }
      if (this.o.failFast && this.violation) return refused(`replay already failed (${this.violation.kind})`); // nothing is forwarded any more
      return { rpc: { jsonrpc: "2.0", id, result: await this.call(method, (q.params as unknown[] | undefined) ?? []) } };
    } catch (e) {
      if (e instanceof UpstreamFailure) {
        this.upstreamFailures++;
        return "http" in e.failure ? { http: e.failure.http } : { rpc: { jsonrpc: "2.0", id, error: e.failure.rpcError } };
      }
      const v = e instanceof RelayViolation ? e : this.violate(new RelayViolation("internal", method, "unexpected exception in the relay"));
      return refused(`answer refused (${v.kind})`);
    }
  }

  /**
   * A request to the fork's RPC. A passing failure (HTTP ≠ 200, a redirect, network, timeout, an unreadable or too large
   * body, a JSON-RPC error): UpstreamFailure (returned as it is to the engine, not remembered). An invalid envelope
   * (version, id, result AND error): a remembered violation.
   */
  private async upstream(method: string, params: unknown[], url: string = this.o.upstream): Promise<unknown> {
    if (this.checks && this.requests >= this.max) {
      throw this.violate(new RelayViolation("budget", method, `more than ${this.max} requests to the fork's RPC for this replay: nothing is signed`));
    }
    this.requests++;
    const id = ++this.seq;
    let text: string | undefined;
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        // v2.1 quater: a redirect is NEVER followed (fetch throws): the body never goes to another host
        redirect: "error",
        signal: AbortSignal.timeout(this.o.timeoutMs ?? RELAY_TIMEOUT_MS),
      });
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined);
        throw new UpstreamFailure(method, { http: res.status >= 400 && res.status <= 599 ? res.status : 502 });
      }
      // v2.1 quater: read as a stream, cut beyond the bound (never a giant answer in memory)
      text = await readBodyBounded(res, this.maxResponseBytes);
    } catch (e) {
      if (e instanceof UpstreamFailure) throw e;
      throw new UpstreamFailure(method, { http: 502 }); // network, redirect, cut connection, timeout
    }
    if (text === undefined) throw new UpstreamFailure(method, { http: 502 }); // beyond the bound: the read is cut
    let j: unknown;
    try {
      j = JSON.parse(text);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      throw new UpstreamFailure(method, { http: 502 }); // a truncated or unreadable body: it is not a value
    }
    const rpcError = (x: Record<string, unknown>) => {
      const err = x.error;
      return isPlainObject(err) && typeof err.code === "number" && typeof err.message === "string"
        ? { code: err.code, message: err.message.slice(0, 200) } : { code: RELAY_ERROR_CODE, message: "fork RPC error" };
    };
    if (!this.checks) {
      if (isPlainObject(j) && j.error !== undefined) throw new UpstreamFailure(method, { rpcError: rpcError(j) });
      return isPlainObject(j) ? j.result : undefined;
    }
    if (!isPlainObject(j) || j.jsonrpc !== "2.0" || j.id !== id || ("result" in j) === ("error" in j)) {
      throw this.violate(new RelayViolation("envelope", method, "fork RPC answer: invalid JSON-RPC envelope (version, id, result/error)"));
    }
    if ("error" in j) throw new UpstreamFailure(method, { rpcError: rpcError(j) });
    return j.result;
  }

  /** The block tag of a state read: N in hexadecimal, nothing else. */
  private atN(method: string, tag: unknown): void {
    if (!isQty(tag) || BigInt(tag) !== this.o.blockN) {
      throw this.violate(new RelayViolation("params", method, "state read at a block other than N (or a non-numeric tag)"));
    }
  }

  private arity(method: string, params: unknown[], n: number): void {
    if (params.length !== n) throw this.violate(new RelayViolation("params", method, `${n} parameter(s) expected`));
  }

  private shape(method: string, ok: boolean, what: string): void {
    if (!ok) throw this.violate(new RelayViolation("shape", method, `malformed result: ${what} expected`));
  }

  /** v2.1 quater: the same read (canonical key) returns the same value throughout the replay (the state at block N, the
   *  blocks ≤ N and the chainId are immutable); otherwise an "inconsistent" violation. Only the value's fingerprint is kept. */
  private same(method: string, key: string, value: unknown): void {
    const f = fingerprint(value);
    const prev = this.memo.get(key);
    if (prev === undefined) this.memo.set(key, f);
    else if (prev !== f) {
      throw this.violate(new RelayViolation("inconsistent", method, "the fork's RPC returned two different values for the same read: nothing is signed"));
    }
  }

  async call(method: string, params: unknown[]): Promise<unknown> {
    if (!this.checks) return this.upstream(method, params);
    switch (method) {
      case "eth_chainId":
      case "eth_gasPrice": {
        this.arity(method, params, 0);
        const r = await this.upstream(method, params);
        this.shape(method, isQty(r), "a canonical hexadecimal quantity");
        if (method === "eth_chainId") {
          this.same(method, "chainId", r); // eth_gasPrice changes over time: no memory
          if (this.o.expectedChainId !== undefined && BigInt(r as string) !== BigInt(this.o.expectedChainId)) {
            throw this.violate(new RelayViolation("chain", method, "the fork's RPC announces another chainId than the expected one: nothing is signed"));
          }
        }
        return r;
      }
      case "eth_blockNumber": {
        this.arity(method, params, 0);
        const r = await this.upstream(method, params);
        this.shape(method, isQty(r), "a canonical hexadecimal quantity");
        if (BigInt(r as string) < this.o.blockN) throw this.violate(new RelayViolation("shape", method, "the fork RPC's head is before block N"));
        return r;
      }
      case "eth_getBlockByNumber": {
        this.arity(method, params, 2);
        const [tag, full] = params;
        if (!isQty(tag) || typeof full !== "boolean") throw this.violate(new RelayViolation("params", method, "block number (hexadecimal) and boolean expected"));
        const n = BigInt(tag);
        if (n > this.o.blockN) throw this.violate(new RelayViolation("params", method, "a block beyond N requested"));
        const r = await this.upstream(method, params);
        const b = this.block(method, r, full);
        if (b.number !== n) throw this.violate(new RelayViolation("shape", method, "returned block: number differs from the one requested"));
        await this.onChain(method, b);
        this.same(method, `block:${b.number}:${full}`, r);
        return r;
      }
      case "eth_getBlockByHash": {
        this.arity(method, params, 2);
        const [hash, full] = params;
        if (!isB32(hash) || typeof full !== "boolean") throw this.violate(new RelayViolation("params", method, "block hash and boolean expected"));
        const r = await this.upstream(method, params);
        const b = this.block(method, r, full);
        if (b.hash !== hash.toLowerCase()) throw this.violate(new RelayViolation("shape", method, "returned block: hash differs from the one requested"));
        if (b.number > this.o.blockN) throw this.violate(new RelayViolation("params", method, "a block beyond N"));
        await this.onChain(method, b);
        this.same(method, `block:${b.number}:${full}`, r); // the same key as by number: the two reads are cross-checked
        return r;
      }
      case "eth_getStorageAt": {
        this.arity(method, params, 3);
        if (!isAddr(params[0]) || typeof params[1] !== "string" || !SLOT.test(params[1])) {
          throw this.violate(new RelayViolation("params", method, "address and slot (≤ 32 bytes) expected"));
        }
        this.atN(method, params[2]);
        if (this.o.stateProofs) {
          // 10 Nov: the value returned to the engine is the one the trie PROVES at block N (not the one an RPC announces)
          const v = await this.provedSlot(method, params[0], params[1]);
          const r = `0x${v.toString(16).padStart(64, "0")}`;
          this.same(method, `storage:${params[0].toLowerCase()}:${BigInt(params[1]).toString(16)}`, r);
          return r;
        }
        const r = await this.upstream(method, params);
        this.shape(method, isB32(r), "32 hexadecimal bytes");
        this.same(method, `storage:${params[0].toLowerCase()}:${BigInt(params[1]).toString(16)}`, r);
        return r;
      }
      case "eth_getBalance":
      case "eth_getTransactionCount": {
        this.arity(method, params, 2);
        if (!isAddr(params[0])) throw this.violate(new RelayViolation("params", method, "address expected"));
        this.atN(method, params[1]);
        if (this.o.stateProofs) {
          const a = await this.provedAccount(method, params[0]);
          const r = `0x${(method === "eth_getBalance" ? a.balance : a.nonce).toString(16)}`;
          this.same(method, `${method === "eth_getBalance" ? "balance" : "nonce"}:${params[0].toLowerCase()}`, r);
          return r;
        }
        const r = await this.upstream(method, params);
        this.shape(method, isQty(r), "a canonical hexadecimal quantity");
        this.same(method, `${method === "eth_getBalance" ? "balance" : "nonce"}:${params[0].toLowerCase()}`, r);
        return r;
      }
      case "eth_getCode": {
        this.arity(method, params, 2);
        if (!isAddr(params[0])) throw this.violate(new RelayViolation("params", method, "address expected"));
        this.atN(method, params[1]);
        if (this.o.stateProofs) {
          const r = await this.provedCode(method, params[0]);
          this.same(method, `code:${params[0].toLowerCase()}`, r);
          return r;
        }
        const r = await this.upstream(method, params);
        this.shape(method, isEvenHex(r), "even-length hexadecimal");
        this.same(method, `code:${params[0].toLowerCase()}`, r);
        return r;
      }
      case "eth_getAccountInfo": {
        this.arity(method, params, 2);
        if (!isAddr(params[0])) throw this.violate(new RelayViolation("params", method, "address expected"));
        this.atN(method, params[1]);
        if (this.o.stateProofs) {
          const a0 = params[0].toLowerCase();
          const acct = await this.provedAccount(method, params[0]);
          const proved = { balance: `0x${acct.balance.toString(16)}`, nonce: `0x${acct.nonce.toString(16)}`, code: await this.provedCode(method, params[0]) };
          this.same(method, `balance:${a0}`, proved.balance);
          this.same(method, `nonce:${a0}`, proved.nonce);
          this.same(method, `code:${a0}`, proved.code);
          return proved;
        }
        const r = await this.upstream(method, params);
        this.shape(method, isPlainObject(r) && isQty(r.balance) && isQty(r.nonce) && isEvenHex(r.code), "{ balance, nonce, code }");
        // cross-checked with eth_getBalance, eth_getTransactionCount and eth_getCode of the same account
        const a = params[0].toLowerCase();
        const info = r as { balance: string; nonce: string; code: string };
        this.same(method, `balance:${a}`, info.balance);
        this.same(method, `nonce:${a}`, info.nonce);
        this.same(method, `code:${a}`, info.code);
        return r;
      }
      case "eth_getTransactionReceipt":
      case "eth_getTransactionByHash": {
        // the engine asks only for the fork's transactions, unknown to the fork's RPC: null required
        this.arity(method, params, 1);
        if (!isB32(params[0])) throw this.violate(new RelayViolation("params", method, "transaction hash expected"));
        const r = await this.upstream(method, params);
        this.shape(method, r === null, "null (a fork transaction unknown to the fork's RPC)");
        return r;
      }
      default:
        throw this.violate(new RelayViolation("method", method, "method not provided for by the strict relay"));
    }
  }

  private block(method: string, r: unknown, full: boolean) {
    try {
      return checkBlockShape(method, r, full, this.policy);
    } catch (e) {
      if (e instanceof RelayViolation) throw this.violate(e);
      throw e;
    }
  }

  /** The header of block h read by the relay itself (shape, header bound to the hash, number), remembered. */
  private header(h: bigint): Promise<{ hash: string; parentHash: string; stateRoot: string }> {
    let p = this.headers.get(h);
    if (!p) {
      p = (async () => {
        const method = "eth_getBlockByNumber";
        const r = await this.upstream(method, [`0x${h.toString(16)}`, false]);
        const b = this.block(method, r, false);
        if (b.number !== h) throw this.violate(new RelayViolation("shape", method, "returned block: number differs from the one requested"));
        this.same(method, `block:${h}:false`, r); // cross-checked with the engine's reads of the same block
        return { hash: b.hash, parentHash: b.parentHash, stateRoot: b.stateRoot };
      })();
      this.headers.set(h, p);
      p.catch(() => this.headers.delete(h));
    }
    return p;
  }

  /** The hash of block n tied to the anchor (n ≤ N): walks down step by step through the parentHash values. */
  private async anchored(method: string, n: bigint): Promise<string> {
    const N = this.o.blockN;
    if (!this.hashes.has(N)) {
      const h = await this.header(N); // no anchor: the first read of block N pins it
      if (!this.hashes.has(N)) this.hashes.set(N, h.hash);
    }
    while (this.lowest > n) {
      const h = this.lowest;
      const hdr = await this.header(h);
      const want = this.hashes.get(h)!;
      if (hdr.hash !== want) throw this.violate(new RelayViolation("chain", method, "a block that is not tied to the claim's block N"));
      this.hashes.set(h - 1n, hdr.parentHash);
      if (this.lowest > h - 1n) this.lowest = h - 1n;
    }
    return this.hashes.get(n)!;
  }

  /** Is the returned block on the anchor's chain? (block N: the anchor; block n < N: the chain of parentHash values). */
  private async onChain(method: string, b: { number: bigint; hash: string; parentHash: string; stateRoot: string }): Promise<void> {
    if (b.number === this.o.blockN && !this.hashes.has(b.number)) this.hashes.set(b.number, b.hash); // pinned (without an anchor)
    const want = await this.anchored(method, b.number);
    if (b.hash !== want) throw this.violate(new RelayViolation("chain", method, "a block hash that differs from the chain anchored at block N"));
    if (!this.headers.has(b.number)) this.headers.set(b.number, Promise.resolve({ hash: b.hash, parentHash: b.parentHash, stateRoot: b.stateRoot }));
  }

  // ---------- 10 Nov: state proofs ----------

  /** The stateRoot of header N, after checking that header N is the anchor's (header bound to its hash: "arc" policy). */
  private stateRootN(): Promise<Hex> {
    if (!this.rootN) {
      this.rootN = (async () => {
        await this.anchor();
        return (await this.header(this.o.blockN)).stateRoot as Hex;
      })();
      this.rootN.catch(() => { this.rootN = undefined; });
    }
    return this.rootN;
  }

  /** eth_getProof(address, slots, N) from the proof RPC, CHECKED against the stateRoot of N; a false proof is a violation. */
  private async prove(method: string, address: string, slots: string[]) {
    const root = await this.stateRootN();
    const r = await this.upstream("eth_getProof", [address, slots.map(slotKey), `0x${this.o.blockN.toString(16)}`], this.o.stateProofs?.upstream ?? this.o.upstream);
    try {
      return checkProofResult(root, address as Hex, slots, r);
    } catch (e) {
      if (e instanceof StateProofError) throw this.violate(new RelayViolation("state_proof", method, `${e.message}: nothing is signed`));
      throw e;
    }
  }

  private cached<T>(m: Map<string, Promise<T>>, k: string, f: () => Promise<T>): Promise<T> {
    let p = m.get(k);
    if (!p) {
      p = f();
      m.set(k, p);
      p.catch(() => m.delete(k)); // a passing failure can be retried by the engine
    }
    return p;
  }

  private provedAccount(method: string, address: string): Promise<ProvedAccount> {
    const a = address.toLowerCase();
    return this.cached(this.provedAccounts, a, async () => (await this.prove(method, a, [])).account);
  }

  private provedSlot(method: string, address: string, slot: string): Promise<bigint> {
    const a = address.toLowerCase();
    const k = slotKey(slot);
    return this.cached(this.provedSlots, `${a}:${k}`, async () => {
      const r = await this.prove(method, a, [k]);
      // the same root, the same key: necessarily the same account (a key has only one leaf under a root); keep it
      this.provedAccounts.set(a, this.provedAccounts.get(a) ?? Promise.resolve(r.account));
      return r.storage.get(k)!;
    });
  }

  /** The account's code: returned by the proof RPC, accepted only if it gives back the PROVEN code hash. */
  private provedCode(method: string, address: string): Promise<Hex> {
    const a = address.toLowerCase();
    return this.cached(this.provedCodes, a, async () => {
      const acct = await this.provedAccount(method, a);
      const code = await this.upstream("eth_getCode", [a, `0x${this.o.blockN.toString(16)}`], this.o.stateProofs?.upstream ?? this.o.upstream);
      try {
        return checkCode(acct, code);
      } catch (e) {
        if (e instanceof StateProofError) throw this.violate(new RelayViolation("state_proof", method, `${e.message}: nothing is signed`));
        throw e;
      }
    });
  }

  async anchor(): Promise<string> {
    const h = await this.header(this.o.blockN);
    if (!this.hashes.has(this.o.blockN)) this.hashes.set(this.o.blockN, h.hash);
    if (h.hash !== this.hashes.get(this.o.blockN)) {
      throw this.violate(new RelayViolation("chain", "eth_getBlockByNumber", "the fork's RPC does not serve the claim's block N (different hash)"));
    }
    return h.hash;
  }
}

/** Starts a strict relay (127.0.0.1, ephemeral port) in front of `o.upstream`. */
export async function startStrictRelay(o: StrictRelayOptions): Promise<StrictRelay> {
  const r = new Relay(o);
  await r.listen();
  return r;
}
