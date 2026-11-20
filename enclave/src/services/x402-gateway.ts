/**
 * x402-gateway.ts — the "inference paid per call" product (x402 rail, "exact" scheme): no session, one call = one
 * encrypted request + one payment.
 *
 * A call = an encrypted request (HPKE to the enclave's X25519 key, as in sealed-chat) + an X-PAYMENT header: the payer's
 * EIP-3009 ReceiveWithAuthorization to X402Settler, for the EXACT amount of one call (Product.price × 1 unit). The
 * enclave:
 *  1. without a payment: 402 and the x402 requirements (payTo = X402Settler, asset = USDC, price read on-chain, USDC's
 *     EIP-712 domain); 503 if its receipts would not be paid (inactive product, settled by another contract, another
 *     pinned model, inactive enclave, operator outside OPERATOR_ALLOWLIST);
 *  2. with a payment: checks WITHOUT the chain (scheme, network, payTo, exact amount, validity window, the payer's
 *     canonical signature, nonce = a commitment to THIS request), then AT ONE BLOCK (RPC quorum): the product, the
 *     enclave active under its operator, an authorization never consumed, a payer without code (EOA), a balance that
 *     covers ALL its unsettled calls at this enclave, the operator's exposure capacity (OperatorBond.consumeExposure's rule);
 *  3. reserves the amount (synchronously: no wait between the last checks and the reservation), calls the model, signs
 *     the CallReceipt (X402Settler domain), and encrypts the answer to the client's ephemeral key;
 *  4. keeps the triple (receipt, signature, authorization) PENDING for the operator (GET /x402/pending) until the chain
 *     says the authorization is consumed (POST /x402/settled, signed by the operator and checked again on-chain, or the
 *     reconciliation below) or until it expires.
 *
 * Guarantees:
 *  - a (payer, nonce) pair = at most ONE call to the model and ONE signed receipt: identical concurrent requests go one
 *    after the other (a lock per key); an identical request replayed with the same authorization receives the SAME
 *    answer (idempotent resumption, no second call to the model); another authorization for the same nonce is refused (409);
 *  - nothing is signed if the model fails (502/504): nothing is owed, and the same request can be sent again;
 *  - the enclave holds no payment key and sends no transaction: X402Settler.settle is called by the operator
 *    (services/registrar) or by anyone; the contract pays only the enclave's active operator.
 *
 * An accepted limit (deferred settlement): between the answer and the settlement, a payer can empty their balance or
 * cancel their authorization (cancelAuthorization); the call is then lost for the operator. MAX_PENDING_PER_PAYER bounds
 * only what ONE account gets this way per round; new accounts cost nothing (the verifier's proof 5, 9 Nov). Mitigations:
 *  - short authorizations: the 402 announces AUTH_VALIDITY_SECONDS − 60 s (840 s by default, 60 s of client clock skew
 *    tolerated) and the enclave refuses any deadline beyond now + AUTH_VALIDITY_SECONDS (900 s): an unpayable call lives
 *    no longer than 900 s (evening of 9 Nov: no more "+ 300 s"); the registrar runs every 10 s;
 *  - at most MAX_PENDING_PER_PAYER unsettled calls per payer: 3 by default (evening of 9 Nov, instead of 20: filling the
 *    global bound then takes ≈ 100 funded accounts instead of 15);
 *  - RECONCILIATION: before refusing for lack of room (bond, queue, window, a payer's limit or balance), the enclave
 *    reads again, in batches, at one block and with a short cache, the balance and the authorization state of the payers
 *    with pending calls: what the chain says is consumed leaves the queue; what the payer's balance no longer covers is
 *    removed from the exposure count ("not covered": it stays listed for the operator, who settles it if the payer
 *    funds the account again). Unpayable calls therefore no longer block the bond for honest payers. The
 *    reconciliation's reads draw from a global budget (1,200 per minute by default): a refusal cannot be used to
 *    multiply RPC reads;
 *  - THE OPERATOR'S QUEUE (evening of 9 Nov, proofs C and C2): GET /x402/pending first reads again the BALANCES of the
 *    pending payers (refreshCoverage: one read per payer, in the same budget, at most once per reconcileCacheMs) and
 *    lists the COVERED calls first, the "not covered" ones after; it is read in pages (offset): unpayable calls with a
 *    short deadline no longer pass ahead of an honest payer's call. A known limit: the route is public and the balance
 *    snapshot lasts 10 s; a call served since the last snapshot (then emptied) stays listed as "covered" until the
 *    next one, and a registrar pass checks it again (one read per call) before reaching the honest call;
 *  - GLOBAL BOUND: at most MAX_UNSETTLED_PER_WINDOW served calls whose payment is not CONFIRMED over
 *    UNSETTLED_WINDOW_SECONDS (300 over 600 s by default); beyond it, 503 for payers without a recent settlement. A call
 *    leaves it only when the operator reports it SETTLED through X402Settler (a signed report, checked again on-chain):
 *    a cancelled call (cancelAuthorization) or one consumed another way stays counted until the end of the window
 *    (evening of 9 Nov, proof B: the bound is hard). A payer with a call SETTLED through X402Settler less than 24 h ago
 *    (and no "not covered" or cancelled call since) is not subject to it; a cancelled authorization, or one only seen
 *    consumed by the reconciliation, never makes a payer "known" (proofs B and F);
 *  - RATE (evening of 9 Nov, proofs A and D): each paid request that reaches the paymentState read (≈ 12 RPC requests
 *    per provider) draws from a GLOBAL token bucket (PAYMENT_READS_PER_MINUTE, 120 by default, burst of 30); empty: 503
 *    busy, without a read. "Known" payers have their own bucket, at the same rate (a flood of new keys does not block
 *    them); a "known" payer whose read shows a balance that no longer covers the call (or code) loses that status: they
 *    cannot empty this bucket. New payers also have a cap per IP address SEEN by the enclave
 *    (PAYMENT_READS_PER_MINUTE_PER_IP, 60 by default): it is APPROXIMATE, because behind the Phala gateway the enclave
 *    sees the same address (the gateway's) for everyone; it then acts as a second, lower, global cap.
 *    A known limit: a flood of requests signed by new (free) keys empties the new payers' bucket; they then receive 503
 *    while the flood lasts (known payers stay served).
 * The state lives in memory: a restart loses the triples that the registrar has not collected yet (it keeps them on
 * its side once collected), and the list of "known" payers.
 */
import { type Address, type Hex, getAddress, isAddress, keccak256, toBytes, toHex, zeroAddress } from "viem";
import type { EnclaveKit } from "../kit/enclave-kit";
import type { CallReceipt } from "../kit/eip712";
import { KeyedMutex } from "../kit/keyed-mutex";
import {
  buildChallenge,
  callNonce,
  callResponseHash,
  parseXPayment,
  verifyExactPayment,
  X402PayloadError,
  X402_CALL_TAG,
  X402_UNITS_PER_CALL,
  type CallEnvelope,
  type PaymentPayload,
  type PaymentRequirements,
} from "./x402";
import { AckReplayGuard, TokenBucket, X402_ACK_MAX_ITEMS, parseAckBody, recoverAckSigner, type X402AckBody } from "./x402-ack";

// ---------------------------------------------------------------- what the enclave reads from the chain (injected)

export interface X402ProductView {
  active: boolean;
  /** USDC (6 decimals) per unit; one call = X402_UNITS_PER_CALL unit. */
  price: bigint;
  settlement: Address;
  /** The model pinned by the product (keccak256 of its id). */
  param: Hex;
  exposureCap: bigint;
}

export interface X402Status {
  block: bigint;
  product: X402ProductView;
  /** EnclaveRegistry.activeOperatorAt(enclave, product, block): the zero address if the enclave is not active. */
  operator: Address;
}

export interface X402PaymentState extends X402Status {
  /** USDC.authorizationState(payer, nonce): true if the authorization is already consumed (settled or cancelled). */
  authorizationUsed: boolean;
  /** USDC.balanceOf(payeur). */
  balance: bigint;
  /** The payer has code (a contract, or an EOA delegated by EIP-7702): USDC would verify the signature through ERC-1271. */
  payerHasCode: boolean;
  /** The exposure still allowed to the operator for this product (OperatorBond), null if unknown. */
  capacity: bigint | null;
}

/** Balances and authorization states read AT ONE BLOCK (reconciliation, the operator's reports). */
export interface X402PendingSnapshot {
  block: bigint;
  /** USDC.balanceOf, keys = lower-case addresses. */
  balances: Map<string, bigint>;
  /** USDC.authorizationState, keys = "payer:nonce" in lower case. */
  used: Map<string, boolean>;
}

export interface X402ChainReader {
  /** The product and the enclave's active operator, at one block. */
  status(enclave: Address, productId: bigint): Promise<X402Status>;
  /** Everything needed to accept a payment, read AT ONE BLOCK (on every provider of the quorum). */
  paymentState(q: { enclave: Address; productId: bigint; payer: Address; nonce: Hex }): Promise<X402PaymentState>;
  /** Is the authorization (payer, nonce) consumed on-chain? */
  authorizationUsed(payer: Address, nonce: Hex): Promise<boolean>;
  /**
   * A BATCHED read, at one block: the payers' balances and the states of their authorizations. Optional: without it,
   * the gateway reads one by one (paymentState for a balance, authorizationUsed for an authorization), in bounded parallel.
   */
  pendingState?(q: { payers: Address[]; auths: Array<{ payer: Address; nonce: Hex }> }): Promise<X402PendingSnapshot>;
}

// ---------------------------------------------------------------- the model (injected)

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatModelRequest {
  messages: ChatMessage[];
  temperature?: number;
  /** Output tokens, bounded by MAX_OUTPUT_TOKENS (the price of a call is fixed). */
  maxTokens: number;
  seed?: number;
}

export interface ChatModelResult {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ChatModel {
  /** `signal` fires when the gateway abandons the call (timeout). */
  complete(r: ChatModelRequest, signal: AbortSignal): Promise<ChatModelResult>;
}

// ---------------------------------------------------------------- erreurs, configuration, formats

export type X402HttpStatus = 400 | 401 | 402 | 403 | 409 | 413 | 429 | 502 | 503 | 504;

/** A refusal returned to the client with an HTTP code; a 402 carries the current x402 requirements (`accepts`). */
export class X402Error extends Error {
  constructor(
    readonly httpStatus: X402HttpStatus,
    readonly code: string,
    message: string,
    readonly accepts?: PaymentRequirements[],
  ) {
    super(message);
    this.name = "X402Error";
  }
}

export interface X402GatewayConfig {
  chainId: number;
  /** X402Settler: the payTo of the authorizations and the EIP-712 domain of the receipts. */
  settler: Address;
  usdc: Address;
  /** The x402 network name (e.g. "arc-testnet"). */
  network: string;
  /** USDC's EIP-712 domain (EIP-3009): "USDC", "2" on Arc. */
  usdcName: string;
  usdcVersion: string;
  /** keccak256 of the id of the model really called; must be the product's `param`. */
  modelHash: Hex;
  /** The model label returned to the client (informative). */
  modelLabel?: string;
  /**
   * The operators this enclave serves (OPERATOR_ALLOWLIST); they are also the only accepted signers of
   * POST /x402/settled. null/absent = not checked (development: any signer).
   */
  operators?: readonly Address[] | null;
  /** The MAXIMUM accepted validity of authorizations, in s from the enclave's clock (default 900); the 402 announces
   *  60 s less (maxTimeoutSeconds), to tolerate the clients' clock skew. */
  authValiditySeconds?: number;
  /** An authorization must stay valid at least this long (s) to be accepted: the time of settlement (default 600). */
  minSettleWindowSeconds?: number;
  /** The maximum size of the plaintext request, in bytes (default 32,768). */
  maxRequestBytes?: number;
  /** The cap on output tokens of one call (default 1,024): the price is fixed per call. */
  maxOutputTokens?: number;
  /** Calls not settled yet (or in progress) per payer (default 3). */
  maxPendingPerPayer?: number;
  /** Unsettled (or in-progress) calls in total (default 2,000); beyond: 503. */
  maxStoredCalls?: number;
  /** The global bound: served and unsettled calls over the sliding window (default 300); beyond: 503 (except known payers). */
  maxUnsettledPerWindow?: number;
  /** The window of the global bound, in s (default 600). */
  unsettledWindowSeconds?: number;
  /** The maximum duration of a call to the model, in ms (default 120,000). */
  modelTimeoutMs?: number;
  /** Require the payer's USDC balance to cover their unsettled calls (default true). */
  checkBalance?: boolean;
  /** Cache duration of the product and enclave state for the 402, in ms (default 15,000; 0 = no cache). */
  statusCacheMs?: number;
  /** Reconciliation of the whole queue: at most one per this delay, in ms (default 10,000). */
  reconcileCacheMs?: number;
  /** Reconciliation of one payer: at most one per this delay and per payer, in ms (default 3,000). */
  payerReconcileCacheMs?: number;
  /** The maximum number of on-chain reads per reconciliation (default 256). */
  reconcileMaxReads?: number;
  /** The maximum number of on-chain reads per minute for ALL reconciliations (default 1,200): a refusal cannot be used
   *  to multiply RPC reads (each reconciliation takes its reads from this budget, otherwise it does not happen). */
  reconcileReadsPerMinute?: number;
  /** The operator's report: the maximum age of its timestamp, in s (default 120). */
  ackMaxAgeSeconds?: number;
  /** Signed reports accepted per minute (default 30). */
  ackRequestsPerMinute?: number;
  /** The maximum number of on-chain reads per minute for the reports (default 1,200). */
  ackReadsPerMinute?: number;
  /** The maximum number of paymentState reads (paid requests) per minute, all addresses together (default 120, burst of
   *  a quarter): one bucket for new payers, another one, at the same rate, for "known" payers. Beyond: 503 busy. */
  paymentReadsPerMinute?: number;
  /** The same reads per minute at most per IP address SEEN by the enclave, for new payers (default 60, burst of a
   *  third). Approximate: behind the Phala gateway, everyone has the gateway's address. Beyond: 429. */
  paymentReadsPerMinutePerIp?: number;
  /** A clock in Unix seconds (default: the process's). */
  now?: () => bigint;
  /** Log (default: console.warn). Never any request or answer content. */
  log?: (m: string) => void;
}

export interface SerializedCallReceipt {
  productId: string;
  payer: Address;
  requestHash: Hex;
  responseHash: Hex;
  units: string;
  anchorBlock: string;
  nonce: Hex;
}

export function serializeCallReceipt(cr: CallReceipt): SerializedCallReceipt {
  return {
    productId: cr.productId.toString(),
    payer: cr.payer,
    requestHash: cr.requestHash,
    responseHash: cr.responseHash,
    units: cr.units.toString(),
    anchorBlock: cr.anchorBlock.toString(),
    nonce: cr.nonce,
  };
}

/** The answer to a paid call (the model's answer is encrypted to the client's ephemeral key). */
export interface X402CallResponse {
  object: "x402.chat.completion";
  model: string;
  modelHash: Hex;
  enc: Hex;
  ciphertext: Hex;
  /** The CallReceipt that X402Settler.settle expects, signed by the enclave (X402Settler domain). */
  receipt: SerializedCallReceipt;
  signature: Hex;
  payment: {
    scheme: "exact";
    network: string;
    payer: Address;
    amount: string;
    nonce: Hex;
    payTo: Address;
    asset: Address;
    /** The payment is settled later through X402Settler.settle (by the operator, or by anyone). */
    settlement: "deferred";
  };
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** A served call, not settled yet: exactly the arguments of X402Settler.settle(cr, enclaveSig, auth). */
export interface X402PendingItem {
  receipt: SerializedCallReceipt;
  signature: Hex;
  auth: { validAfter: string; validBefore: string; nonce: Hex; signature: Hex };
  amount: string;
  servedAt: number;
  /** At the last balance snapshot, the payer's balance covered this call (false: "not covered", listed after the others). */
  covered: boolean;
}

/** The result of a report: keys out of the queue (consumed on-chain), kept, unknown here. */
export interface X402AckResult {
  settled: string[];
  pending: string[];
  unknown: string[];
}

interface StoredCall {
  key: string;
  payer: Address;
  nonce: Hex;
  amount: bigint;
  authSignature: Hex;
  validAfter: bigint;
  validBefore: bigint;
  receipt: CallReceipt;
  signature: Hex;
  response: X402CallResponse;
  servedAt: number;
  /** "settled": the chain says the authorization is consumed (settled, or cancelled by the payer). */
  state: "pending" | "settled";
  /** At the last reconciliation, the payer's balance did not cover this call: outside the exposure count. */
  uncovered: boolean;
  /**
   * Payment CONFIRMED by the operator (a signed report): true = settled by X402Settler; false = consumed another way
   * (cancelled by the payer); absent = not confirmed yet (pending, or seen consumed only by the reconciliation). Only
   * true takes the call out of the global bound and makes the payer "known".
   */
  paid?: boolean;
}

/** A refusal for lack of room, and what a reconciliation could free (one payer, or the whole queue). */
interface Refusal {
  scope: "payer" | "all";
  error: X402Error;
}

const L = (x: string) => x.toLowerCase();
const HEX_EVEN = /^0x(?:[0-9a-fA-F]{2})*$/;
const ROLES = new Set(["system", "user", "assistant"]);
/** ChaCha20-Poly1305 overhead: the ciphertext is 16 bytes longer than the plaintext. */
const AEAD_TAG = 16;
/** A payer with a call SETTLED through X402Settler (the operator's report) stays "known" for this delay (s): they
 *  escape the global bound. */
const TRUST_SECONDS = 86_400n;
const MAX_TRUSTED = 10_000;
/** The 402 announces a validity shorter by this delay (s) than the accepted bound: the client's tolerated clock skew. */
const AUTH_CLOCK_SKEW_SECONDS = 60;
/** The maximum number of IP addresses tracked by the per-IP cap (beyond it, the oldest is forgotten). */
const MAX_IP_BUCKETS = 10_000;
/** The timestamp of a report: the tolerated lead over the enclave's clock (s). */
const ACK_FUTURE_SKEW_SECONDS = 60n;
/** The maximum number of parallel on-chain reads, when the reader has no batched read. */
const READ_CONCURRENCY = 8;

function positiveInt(v: number | undefined, dflt: number, name: string): number {
  const x = v ?? dflt;
  if (!Number.isSafeInteger(x) || x < 1) throw new Error(`${name} must be an integer ≥ 1 (got ${v})`);
  return x;
}

function nonNegativeInt(v: number | undefined, dflt: number, name: string): number {
  const x = v ?? dflt;
  if (!Number.isSafeInteger(x) || x < 0) throw new Error(`${name} must be an integer ≥ 0 (got ${v})`);
  return x;
}

async function mapLimit<T, R>(xs: readonly T[], limit: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await f(xs[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, worker));
  return out;
}

/** One token bucket per key (seen IP address), bounded memory: beyond `maxKeys`, the oldest key is forgotten (it
 *  starts again from a full bucket: it fails open for that key, never closed for the others). */
class KeyedBuckets {
  private buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly maxKeys: number,
  ) {}

  take(key: string): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      b = new TokenBucket(this.capacity, this.perSecond);
      this.buckets.set(key, b);
    }
    return b.take();
  }
}

/** The request's envelope: { enc, ciphertext, clientEphemeralPub } in hexadecimal, bounded sizes. */
export function parseEnvelope(x: unknown, maxRequestBytes: number): CallEnvelope {
  const b = x as Record<string, unknown> | null;
  const bad = (m: string) => new X402Error(400, "invalid_envelope", `invalid envelope: ${m}`);
  if (!b || typeof b !== "object" || Array.isArray(b)) throw bad("{ enc, ciphertext, clientEphemeralPub } expected");
  const { enc, ciphertext, clientEphemeralPub } = b;
  for (const [k, v] of Object.entries({ enc, ciphertext, clientEphemeralPub })) {
    if (typeof v !== "string" || !HEX_EVEN.test(v)) throw bad(`${k}: hexadecimal (whole bytes) expected`);
  }
  const e = enc as string, c = ciphertext as string, p = clientEphemeralPub as string;
  if ((e.length - 2) / 2 !== 32) throw bad("enc: 32 bytes expected (HPKE X25519)");
  if ((p.length - 2) / 2 !== 32) throw bad("clientEphemeralPub: 32 bytes expected (X25519)");
  const ct = (c.length - 2) / 2;
  if (ct <= AEAD_TAG) throw bad("ciphertext trop court");
  if (ct > maxRequestBytes + AEAD_TAG) throw new X402Error(413, "request_too_large", `request too large: at most ${maxRequestBytes} bytes in clear`);
  return { enc: L(e) as Hex, ciphertext: L(c) as Hex, clientEphemeralPub: L(p) as Hex };
}

/**
 * The plaintext request (UTF-8 JSON): { messages: [{ role, content }], temperature?, max_tokens?, seed?, salt? }.
 * `salt` (the client's randomness, ignored by the model) makes the requestHash published at settlement impossible to guess.
 */
export function parseChatRequest(plain: Uint8Array, maxOutputTokens: number): ChatModelRequest {
  const bad = (m: string) => new X402Error(400, "invalid_request", `invalid request: ${m}`);
  let j: any;
  try {
    j = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
  } catch {
    throw bad("UTF-8 JSON expected ({ messages, temperature?, max_tokens?, seed?, salt? })");
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw bad("JSON object expected");
  if (!Array.isArray(j.messages) || j.messages.length === 0 || j.messages.length > 64) throw bad("messages: from 1 to 64 messages");
  const messages: ChatMessage[] = [];
  for (const m of j.messages) {
    if (!m || typeof m !== "object" || !ROLES.has(m.role) || typeof m.content !== "string") {
      throw bad("each message: { role: system | user | assistant, content: text }");
    }
    messages.push({ role: m.role, content: m.content });
  }
  let temperature: number | undefined;
  if (j.temperature !== undefined && j.temperature !== null) {
    if (typeof j.temperature !== "number" || !Number.isFinite(j.temperature) || j.temperature < 0 || j.temperature > 2) {
      throw bad("temperature: a number between 0 and 2");
    }
    temperature = j.temperature;
  }
  let maxTokens = maxOutputTokens;
  if (j.max_tokens !== undefined && j.max_tokens !== null) {
    if (!Number.isSafeInteger(j.max_tokens) || j.max_tokens < 1) throw bad("max_tokens: integer ≥ 1");
    maxTokens = Math.min(j.max_tokens, maxOutputTokens);
  }
  let seed: number | undefined;
  if (j.seed !== undefined && j.seed !== null) {
    if (!Number.isSafeInteger(j.seed)) throw bad("seed: integer");
    seed = j.seed;
  }
  return { messages, temperature, maxTokens, seed };
}

// ---------------------------------------------------------------- the gateway

export class X402Gateway {
  private calls = new Map<string, StoredCall>();
  /** Calls in progress (amount reserved, not signed yet). */
  private reserved = new Map<string, { payer: string; amount: bigint }>();
  /** Per payer: unsettled + in-progress calls at this enclave. */
  private load = new Map<string, { count: number; amount: bigint }>();
  /** Unsettled + in-progress calls, in total. */
  private totalCount = 0;
  private locks = new KeyedMutex();
  private statusCache?: { at: number; value: X402Status };
  private statusInFlight?: Promise<X402Status>;
  private operators: Set<string> | null;
  private log: (m: string) => void;
  private now: () => bigint;
  /** Calls served over the global bound's window, from the oldest to the most recent (the state is read on the call). */
  private served: Array<{ at: bigint; call: StoredCall }> = [];
  /** Payers with a call SETTLED through X402Settler recently (the operator's report; no "not covered" or cancelled call
   *  since) → Unix seconds. */
  private trusted = new Map<string, bigint>();
  /** Payers with at least one call marked "not covered". */
  private uncoveredPayers = new Set<string>();
  private reconcileAllAt = Number.NEGATIVE_INFINITY;
  private reconcileAllInFlight?: Promise<void>;
  private reconcilePayerAt = new Map<string, number>();
  private reconcilePayerInFlight = new Map<string, Promise<void>>();
  private coverageAt = Number.NEGATIVE_INFINITY;
  private coverageInFlight?: Promise<void>;
  /** Authorization reads in progress, shared between concurrent reports (one read per key). */
  private authInFlight = new Map<string, Promise<boolean | undefined>>();
  private ackReplay = new AckReplayGuard();
  private ackRequests: TokenBucket;
  private ackReads: TokenBucket;
  private reconcileReads: TokenBucket;
  /** paymentState reads of paid requests: new payers, "known" payers, and per seen IP address. */
  private newPayerReads: TokenBucket;
  private knownPayerReads: TokenBucket;
  private knownPerPayerReads: KeyedBuckets;
  private ipReads: KeyedBuckets;
  readonly limits: {
    authValiditySeconds: number;
    /** The validity announced by the 402 (maxTimeoutSeconds): authValiditySeconds − 60 s of tolerated clock skew. */
    announcedValiditySeconds: number;
    minSettleWindowSeconds: number;
    maxRequestBytes: number;
    maxOutputTokens: number;
    maxPendingPerPayer: number;
    maxStoredCalls: number;
    maxUnsettledPerWindow: number;
    unsettledWindowSeconds: number;
    modelTimeoutMs: number;
    statusCacheMs: number;
    reconcileCacheMs: number;
    payerReconcileCacheMs: number;
    reconcileMaxReads: number;
    reconcileReadsPerMinute: number;
    ackMaxAgeSeconds: number;
    ackRequestsPerMinute: number;
    ackReadsPerMinute: number;
    paymentReadsPerMinute: number;
    paymentReadsPerMinutePerIp: number;
  };

  constructor(
    private kit: EnclaveKit,
    private cfg: X402GatewayConfig,
    private chain: X402ChainReader,
    private model: ChatModel,
  ) {
    if (!isAddress(cfg.settler) || !isAddress(cfg.usdc)) throw new Error("settler and usdc: addresses expected");
    const authValiditySeconds = positiveInt(cfg.authValiditySeconds, 900, "authValiditySeconds");
    this.limits = {
      authValiditySeconds,
      announcedValiditySeconds: authValiditySeconds - AUTH_CLOCK_SKEW_SECONDS,
      minSettleWindowSeconds: positiveInt(cfg.minSettleWindowSeconds, 600, "minSettleWindowSeconds"),
      maxRequestBytes: positiveInt(cfg.maxRequestBytes, 32_768, "maxRequestBytes"),
      maxOutputTokens: positiveInt(cfg.maxOutputTokens, 1024, "maxOutputTokens"),
      maxPendingPerPayer: positiveInt(cfg.maxPendingPerPayer, 3, "maxPendingPerPayer"),
      maxStoredCalls: positiveInt(cfg.maxStoredCalls, 2000, "maxStoredCalls"),
      maxUnsettledPerWindow: positiveInt(cfg.maxUnsettledPerWindow, 300, "maxUnsettledPerWindow"),
      unsettledWindowSeconds: positiveInt(cfg.unsettledWindowSeconds, 600, "unsettledWindowSeconds"),
      modelTimeoutMs: positiveInt(cfg.modelTimeoutMs, 120_000, "modelTimeoutMs"),
      statusCacheMs: nonNegativeInt(cfg.statusCacheMs, 15_000, "statusCacheMs"),
      reconcileCacheMs: nonNegativeInt(cfg.reconcileCacheMs, 10_000, "reconcileCacheMs"),
      payerReconcileCacheMs: nonNegativeInt(cfg.payerReconcileCacheMs, 3_000, "payerReconcileCacheMs"),
      reconcileMaxReads: positiveInt(cfg.reconcileMaxReads, 256, "reconcileMaxReads"),
      reconcileReadsPerMinute: positiveInt(cfg.reconcileReadsPerMinute, 1200, "reconcileReadsPerMinute"),
      ackMaxAgeSeconds: positiveInt(cfg.ackMaxAgeSeconds, 120, "ackMaxAgeSeconds"),
      ackRequestsPerMinute: positiveInt(cfg.ackRequestsPerMinute, 30, "ackRequestsPerMinute"),
      ackReadsPerMinute: positiveInt(cfg.ackReadsPerMinute, 1200, "ackReadsPerMinute"),
      paymentReadsPerMinute: positiveInt(cfg.paymentReadsPerMinute, 120, "paymentReadsPerMinute"),
      paymentReadsPerMinutePerIp: positiveInt(cfg.paymentReadsPerMinutePerIp, 60, "paymentReadsPerMinutePerIp"),
    };
    if (this.limits.authValiditySeconds < this.limits.minSettleWindowSeconds + 120) {
      throw new Error("authValiditySeconds must exceed minSettleWindowSeconds by at least 120 s (otherwise no client falls inside the window)");
    }
    this.operators = cfg.operators ? new Set(cfg.operators.map(L)) : null;
    this.log = cfg.log ?? ((m) => console.warn(m));
    this.now = cfg.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
    // burst: 1/6 of the minute (at least 5 reports, at least one report full of reads)
    this.ackRequests = new TokenBucket(Math.max(5, Math.ceil(this.limits.ackRequestsPerMinute / 6)), this.limits.ackRequestsPerMinute / 60);
    this.ackReads = new TokenBucket(Math.max(X402_ACK_MAX_ITEMS, Math.ceil(this.limits.ackReadsPerMinute / 6)), this.limits.ackReadsPerMinute / 60);
    this.reconcileReads = new TokenBucket(2 * this.limits.reconcileMaxReads, this.limits.reconcileReadsPerMinute / 60);
    // paid requests: a burst of a quarter minute (at least 10) per global bucket, a third (at least 5) per IP
    const pm = this.limits.paymentReadsPerMinute;
    const ip = this.limits.paymentReadsPerMinutePerIp;
    this.newPayerReads = new TokenBucket(Math.max(10, Math.ceil(pm / 4)), pm / 60);
    this.knownPayerReads = new TokenBucket(Math.max(10, Math.ceil(pm / 4)), pm / 60);
    this.ipReads = new KeyedBuckets(Math.max(5, Math.ceil(ip / 3)), ip / 60, MAX_IP_BUCKETS);
    // evening of 9 Nov (K2): each "known" payer also has its own small bucket (burst 3, ≈ 1/6 of the global rate): a
    // concurrent burst from ONE known payer no longer empties the bucket shared by the other known payers
    this.knownPerPayerReads = new KeyedBuckets(3, Math.max(1, pm / 6) / 60, MAX_IP_BUCKETS);
  }

  /** This enclave's signing key (it signs the receipts and enters the nonce of each call). */
  get enclave(): Address {
    return this.kit.keys.signer;
  }

  get productId(): bigint {
    return this.kit.productId;
  }

  get settler(): Address {
    return this.cfg.settler;
  }

  get chainId(): number {
    return this.cfg.chainId;
  }

  get network(): string {
    return this.cfg.network;
  }

  get usdc(): Address {
    return this.cfg.usdc;
  }

  get modelHash(): Hex {
    return this.cfg.modelHash;
  }

  get modelLabel(): string {
    return this.cfg.modelLabel ?? "arc-sealed-x402";
  }

  // ---------- on-chain state and x402 requirements

  /** Product + enclave (short cache); X402Error 503 if a receipt of this enclave would not be paid. */
  async status(): Promise<X402Status> {
    const c = this.statusCache;
    if (c && Date.now() - c.at < this.limits.statusCacheMs) {
      this.assertPayable(c.value);
      return c.value;
    }
    this.statusInFlight ??= this.chain
      .status(this.enclave, this.productId)
      .finally(() => {
        this.statusInFlight = undefined;
      });
    let st: X402Status;
    try {
      st = await this.statusInFlight;
    } catch {
      throw new X402Error(503, "chain_unavailable", "on-chain read failed (RPC quorum): nothing is served or billed, try again in a moment");
    }
    this.statusCache = { at: Date.now(), value: st };
    this.assertPayable(st);
    return st;
  }

  /** The x402 requirements of a call (the price comes from the on-chain product). */
  requirementsFor(st: X402Status, resource: string): PaymentRequirements {
    return buildChallenge({
      network: this.cfg.network,
      amount: st.product.price * X402_UNITS_PER_CALL,
      resource,
      description: `One private AI inference call in an Intel TDX enclave verified on Arc (product #${this.productId})`,
      payTo: this.cfg.settler,
      asset: this.cfg.usdc,
      usdcName: this.cfg.usdcName,
      usdcVersion: this.cfg.usdcVersion,
      // 60 s less than the accepted bound: a client whose clock runs a minute ahead stays accepted
      maxTimeoutSeconds: this.limits.announcedValiditySeconds,
      extra: {
        productId: this.productId.toString(),
        unitsPerCall: X402_UNITS_PER_CALL.toString(),
        enclave: this.enclave,
        chainId: String(this.cfg.chainId),
        nonce: `keccak256(abi.encode("${X402_CALL_TAG}", chainId, payTo, productId, enclave, keccak256(enc), keccak256(ciphertext), clientEphemeralPub))`,
        minValiditySeconds: String(this.limits.minSettleWindowSeconds),
        settlement: "deferred: X402Settler.settle(receipt, enclaveSig, auth) by the operator, or by anyone",
      },
    }).accepts[0]!;
  }

  /** The 402: the x402 requirements of the next call (503 if the enclave cannot be paid). */
  async challenge(resource: string): Promise<PaymentRequirements[]> {
    return [this.requirementsFor(await this.status(), resource)];
  }

  private assertPayable(st: X402Status): void {
    const p = st.product;
    const no = (code: string, m: string) => new X402Error(503, code, `${m}: nothing is served or billed`);
    if (!p.active) throw no("product_inactive", `produit #${this.productId} inactif`);
    if (L(p.settlement) !== L(this.cfg.settler)) {
      throw no("wrong_settlement", `product #${this.productId} settles through ${p.settlement}, not through X402Settler ${this.cfg.settler} (WrongSettlement)`);
    }
    if (p.price <= 0n) throw no("zero_price", `produit #${this.productId} au prix 0 (ZeroAmount)`);
    if (L(p.param) !== L(this.cfg.modelHash)) {
      throw no("model_mismatch", `the product pins model ${p.param}; this enclave calls ${this.cfg.modelHash}`);
    }
    if (L(st.operator) === zeroAddress) {
      throw no("enclave_inactive", `this enclave (${this.enclave}) is not registered and active for product #${this.productId}: its receipts would not be paid (InactiveEnclave)`);
    }
    if (this.operators && !this.operators.has(L(st.operator))) {
      throw no("wrong_operator", `this enclave is active for operator ${st.operator}, who is not in OPERATOR_ALLOWLIST`);
    }
  }

  // ---------- one call

  /**
   * Handles a call. Without X-PAYMENT: X402Error 402 with the requirements. With it: checks, serves, signs, keeps the
   * triple. Returns the answer (and `replay` = true if it is the answer already served for this request and this
   * authorization). `clientIp`: the IP address SEEN by the enclave (the TCP peer's), for the per-IP cap; absent, no per-IP cap.
   */
  async handle(input: { envelope: unknown; xPayment?: string | null; resource: string; clientIp?: string }): Promise<{ body: X402CallResponse; replay: boolean }> {
    // the current requirements (503 if the enclave cannot be paid): for the 402 and the payment refusals
    const accepts = async () => [this.requirementsFor(await this.status(), input.resource)];
    if (!input.xPayment) {
      throw new X402Error(
        402,
        "payment_required",
        "x402 payment required: send the SAME request again with the X-PAYMENT header (EIP-3009 ReceiveWithAuthorization to X402Settler, exact amount, nonce = a commitment to the request)",
        await accepts(),
      );
    }
    const env = parseEnvelope(input.envelope, this.limits.maxRequestBytes);
    let payment: PaymentPayload;
    try {
      payment = parseXPayment(input.xPayment);
    } catch (e) {
      const pe = e as X402PayloadError;
      throw new X402Error(402, pe.code ?? "invalid_payload", pe.message, await accepts());
    }
    const a = payment.payload.authorization;
    const payer = getAddress(a.from);
    const nonce = a.nonce;
    const expected = callNonce({ chainId: this.cfg.chainId, settler: this.cfg.settler, productId: this.productId, enclave: this.enclave, ...env });
    if (nonce !== expected) {
      throw new X402Error(
        402,
        "nonce_not_bound",
        "the authorization's nonce does not commit to THIS request (a replayed authorization, or a request modified on the way): nothing is served",
        await accepts(),
      );
    }
    const key = `${L(payer)}:${nonce}`;
    return this.locks.run(key, () => this.handleLocked(key, env, payment, payer, nonce, input.resource, input.clientIp));
  }

  private async handleLocked(
    key: string,
    env: CallEnvelope,
    payment: PaymentPayload,
    payer: Address,
    nonce: Hex,
    resource: string,
    clientIp?: string,
  ): Promise<{ body: X402CallResponse; replay: boolean }> {
    this.prune();
    // idempotent resumption (BEFORE any read of the chain): the same request with the same authorization receives the
    // same answer, without a second call to the model or a second receipt
    const done = this.calls.get(key);
    if (done) {
      if (done.authSignature === payment.payload.signature) return { body: done.response, replay: true };
      throw new X402Error(
        409,
        "nonce_reused",
        "this request was already served and paid by another authorization (same nonce): nothing is served or billed a second time",
      );
    }
    const req = this.requirementsFor(await this.status(), resource); // 503 if the enclave cannot be paid

    // checks without the chain: scheme, network, payTo, EXACT amount, window, the payer's canonical signature
    const now = this.now();
    const v = await verifyExactPayment(payment, req, this.cfg.chainId, now, {
      minRemainingSeconds: BigInt(this.limits.minSettleWindowSeconds),
      // at most AUTH_VALIDITY_SECONDS (evening of 9 Nov: no more "+ 300 s"); the 402 announces 60 s less (clocks)
      maxValiditySeconds: BigInt(this.limits.authValiditySeconds),
    });
    if (!v.ok) throw new X402Error(402, v.code, v.reason, [req]);
    const amount = BigInt(authOf(payment).value);
    // room in the queue (before decrypting and reading the chain); a refusal is first checked against the chain
    await this.admitOrThrow(() => this.roomRefusal(payer), payer);

    // the request: decrypted by THIS enclave, read, bounded
    let plain: Uint8Array;
    try {
      plain = await this.kit.open(toBytes(env.enc), toBytes(env.ciphertext));
    } catch {
      throw new X402Error(400, "undecryptable", "request cannot be decrypted by this enclave (encrypted to another X25519 key?): nothing is served or billed");
    }
    if (plain.length > this.limits.maxRequestBytes) {
      throw new X402Error(413, "request_too_large", `request too large: at most ${this.limits.maxRequestBytes} bytes in clear`);
    }
    const chat = parseChatRequest(plain, this.limits.maxOutputTokens);

    // rate: each paymentState read (≈ 12 RPC requests per provider) draws from a token bucket (503 / 429 without a
    // read); a request signed by a new key, even without any USDC, no longer multiplies the reads (proof D)
    this.takePaymentRead(payer, clientIp);

    // evening of 9 Nov (K1): any refusal that FOLLOWS the on-chain read (an authorization already consumed or
    // cancelled, a wrong amount, a contract payer, the balance, the room…) removes the "known" status: replaying a
    // cancelled authorization, or sending wrong amounts, can no longer empty the known payers' bucket. An outage of OUR
    // read (chain_unavailable) does not penalize the payer.
    let ps: X402PaymentState;
    try {
      // the chain, AT ONE BLOCK
      try {
        ps = await this.chain.paymentState({ enclave: this.enclave, productId: this.productId, payer, nonce });
      } catch {
        throw new X402Error(503, "chain_unavailable", "on-chain read failed (RPC quorum): nothing is served or billed, try again in a moment");
      }
      this.statusCache = { at: Date.now(), value: { block: ps.block, product: ps.product, operator: ps.operator } };
      this.assertPayable(ps);
      const due = ps.product.price * X402_UNITS_PER_CALL;
      if (due !== amount) {
        throw new X402Error(
          402,
          "invalid_exact_evm_payload_authorization_value",
          `the on-chain price changed: a call now costs ${due}, the authorization carries ${amount}`,
          [this.requirementsFor(ps, resource)],
        );
      }
      if (ps.authorizationUsed) {
        throw new X402Error(402, "authorization_used", "this EIP-3009 authorization is already consumed on-chain (settled or cancelled): nothing is served", [req]);
      }
      if (ps.payerHasCode) {
        this.trusted.delete(L(payer)); // a "known" payer who can no longer pay is no longer "known" (see below)
        throw new X402Error(
          402,
          "payer_is_contract",
          "the payer has code (a contract or an EIP-7702 delegated account): USDC would verify its signature through ERC-1271, which this enclave does not check; pay from a plain account (EOA)",
          [req],
        );
      }

      // room, balance, global bound, bond: a refusal is first checked against the chain (reconciliation), then
      // everything is checked again. The reservation follows the LAST check WITHOUT ANY WAIT (no await between the two:
      // the other requests of the same payer see the reservation, so two requests cannot pass on the same balance)
      let refusal = this.admission(payer, amount, ps, req);
      if (refusal) {
        await (refusal.scope === "all" ? this.reconcileAll() : this.reconcilePayer(payer));
        refusal = this.admission(payer, amount, ps, req);
        if (refusal) {
          // evening of 9 Nov: a "known" payer whose balance no longer covers anything loses that status; otherwise, having
          // paid once, they could empty their balance and then drain the known payers' bucket with signed requests (the others: 503)
          if (refusal.error.code === "insufficient_funds") this.trusted.delete(L(payer));
          throw refusal.error;
        }
      }
    } catch (e) {
      if (e instanceof X402Error && e.code !== "chain_unavailable") this.trusted.delete(L(payer));
      throw e;
    }
    // the balance read covers ALL this payer's unsettled calls: none is "not covered" any more
    if (this.cfg.checkBalance !== false) this.clearUncovered(payer);
    this.reserve(key, payer, amount);
    try {
      const out = await this.callModel(chat);
      const requestHash = keccak256(plain);
      const receipt: CallReceipt = {
        productId: this.productId,
        payer,
        requestHash,
        responseHash: callResponseHash(requestHash, out.text),
        units: X402_UNITS_PER_CALL,
        anchorBlock: ps.block, // the enclave was active at this block (read above)
        nonce,
      };
      const signature = await this.kit.signCallReceipt(this.cfg.settler, receipt);
      const sealed = await this.kit.seal(toBytes(env.clientEphemeralPub), new TextEncoder().encode(out.text));
      const body: X402CallResponse = {
        object: "x402.chat.completion",
        model: this.cfg.modelLabel ?? "arc-sealed-x402",
        modelHash: this.cfg.modelHash,
        enc: toHex(sealed.enc),
        ciphertext: toHex(sealed.ciphertext),
        receipt: serializeCallReceipt(receipt),
        signature,
        payment: {
          scheme: "exact",
          network: this.cfg.network,
          payer,
          amount: amount.toString(),
          nonce,
          payTo: this.cfg.settler,
          asset: this.cfg.usdc,
          settlement: "deferred",
        },
        ...(out.tokensIn !== undefined || out.tokensOut !== undefined
          ? { usage: { prompt_tokens: out.tokensIn, completion_tokens: out.tokensOut } }
          : {}),
      };
      const auth = authOf(payment);
      this.commit({
        key,
        payer,
        nonce,
        amount,
        authSignature: payment.payload.signature,
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        receipt,
        signature,
        response: body,
        servedAt: Number(this.now()),
        state: "pending",
        uncovered: false,
      });
      return { body, replay: false };
    } catch (e) {
      this.unreserve(key);
      throw e;
    }
  }

  /** A call to the model bounded in time; an empty answer is not billed. */
  private async callModel(r: ChatModelRequest): Promise<ChatModelResult> {
    const ms = this.limits.modelTimeoutMs;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new X402Error(504, "model_timeout", `the model did not answer within ${ms} ms: nothing is billed, the same request can be sent again`));
      }, ms);
    });
    try {
      const out = await Promise.race([this.model.complete(r, abort.signal), timeout]);
      if (!out || typeof out.text !== "string" || out.text.length === 0) {
        throw new X402Error(502, "model_empty", "the model returned no text: nothing is billed, the same request can be sent again");
      }
      return out;
    } catch (e) {
      if (e instanceof X402Error) throw e;
      this.log(`[sealed-x402] call to the model failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      throw new X402Error(502, "model_error", "the model failed: nothing is billed, the same request can be sent again");
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- admission (place, solde, borne globale, caution)

  /**
   * Pre-check (before decrypting and reading the chain): a refusal for lack of room is first checked against the chain
   * (reconciliation, with a short cache), then checked again. No reservation follows: the check that precedes the
   * reservation is redone without a wait in handleLocked.
   */
  private async admitOrThrow(check: () => Refusal | null, payer: Address): Promise<void> {
    const first = check();
    if (!first) return;
    await (first.scope === "all" ? this.reconcileAll() : this.reconcilePayer(payer));
    const again = check();
    if (again) throw again.error;
  }

  private roomRefusal(payer: Address): Refusal | null {
    if (this.totalCount >= this.limits.maxStoredCalls) {
      return {
        scope: "all",
        error: new X402Error(503, "queue_full", "too many calls not settled yet at this enclave: nothing is served or billed, try again in a moment"),
      };
    }
    if (this.loadOf(payer).count >= this.limits.maxPendingPerPayer) {
      return {
        scope: "payer",
        error: new X402Error(
          429,
          "payer_pending_limit",
          `this payer already has ${this.limits.maxPendingPerPayer} calls served and not settled yet at this enclave: wait for the settlement (a few tens of seconds)`,
        ),
      };
    }
    return null;
  }

  private admission(payer: Address, amount: bigint, ps: X402PaymentState, req: PaymentRequirements): Refusal | null {
    const room = this.roomRefusal(payer);
    if (room) return room;
    const load = this.loadOf(payer);
    if (this.cfg.checkBalance !== false && ps.balance < load.amount + amount) {
      return {
        scope: "payer",
        error: new X402Error(
          402,
          "insufficient_funds",
          `the payer's USDC balance is insufficient: ${ps.balance} for ${load.amount + amount} (including their calls not settled yet at this enclave)`,
          [req],
        ),
      };
    }
    if (!this.isTrusted(payer) && this.unsettledInWindow() >= this.limits.maxUnsettledPerWindow) {
      return {
        scope: "all",
        error: new X402Error(
          503,
          "unsettled_backlog",
          `already ${this.limits.maxUnsettledPerWindow} calls served whose settlement is not confirmed over the last ${this.limits.unsettledWindowSeconds} seconds: nothing is served or billed, try again in a few minutes`,
        ),
      };
    }
    if (ps.capacity !== null && ps.capacity < this.exposure() + amount) {
      return {
        scope: "all",
        error: new X402Error(
          503,
          "operator_capacity",
          "the operator's bond no longer covers one more call over 24 h (OperatorBond: ½ of the bond, the product's cap): nothing is served or billed, try again later",
        ),
      };
    }
    return null;
  }

  /** Upcoming exposure: served unsettled calls that their payer's balance covers, and calls in progress. */
  private exposure(): bigint {
    let s = 0n;
    for (const c of this.calls.values()) if (c.state === "pending" && !c.uncovered) s += c.amount;
    for (const r of this.reserved.values()) s += r.amount;
    return s;
  }

  /**
   * Calls served over the global bound's window whose payment is not CONFIRMED by the operator (pending, expired,
   * cancelled, or seen consumed only by the reconciliation), plus the calls in progress. A cancelled call therefore
   * stays counted: the bound is hard (proof B).
   */
  private unsettledInWindow(): number {
    const from = this.now() - BigInt(this.limits.unsettledWindowSeconds);
    let drop = 0;
    while (drop < this.served.length && this.served[drop]!.at < from) drop++;
    if (drop) this.served.splice(0, drop);
    let n = this.reserved.size;
    for (const e of this.served) if (e.call.paid !== true) n++;
    return n;
  }

  private isTrusted(payer: Address): boolean {
    const t = this.trusted.get(L(payer));
    return t !== undefined && this.now() - t < TRUST_SECONDS;
  }

  /** A "known" payer: ONLY after a settlement through X402Settler reported by the operator (notePayment). */
  private trust(payer: Address | string): void {
    const k = L(payer);
    if (this.uncoveredPayers.has(k)) return; // a payer with a call that is not covered is not "known"
    this.trusted.delete(k);
    this.trusted.set(k, this.now());
    if (this.trusted.size > MAX_TRUSTED) {
      const oldest = this.trusted.keys().next().value;
      if (oldest !== undefined) this.trusted.delete(oldest);
    }
  }

  /**
   * What the operator says about a call consumed on-chain (a signed report): settled through X402Settler (the payer
   * becomes "known", the call leaves the global bound), or consumed another way, cancelled by the payer (the payer
   * loses that status, the call stays counted in the bound). A call is noted only once.
   */
  private notePayment(c: StoredCall, paid: boolean): void {
    if (c.paid !== undefined) return;
    c.paid = paid;
    if (paid) this.trust(c.payer);
    else this.trusted.delete(L(c.payer));
  }

  /**
   * The rate of the paymentState reads of a paid request: a "known" payer draws from their bucket (a flood of new keys
   * does not block it); a new payer draws from the cap of their seen IP address (if there is one), then from the
   * global bucket. Empty: a refusal WITHOUT a read (nothing is served or billed).
   */
  private takePaymentRead(payer: Address, clientIp: string | undefined): void {
    const busy = () =>
      new X402Error(503, "busy", "too many paid calls right now (bounded on-chain reads): nothing is served or billed, try again in a few seconds");
    if (this.isTrusted(payer)) {
      if (!this.knownPerPayerReads.take(L(payer))) {
        throw new X402Error(429, "rate_limited", "too many paid calls from this payer at once: nothing is served or billed, try again in a few seconds");
      }
      if (!this.knownPayerReads.take()) throw busy();
      return;
    }
    if (clientIp && !this.ipReads.take(clientIp)) {
      throw new X402Error(429, "rate_limited", "too many paid calls from this address: nothing is served or billed, try again in a few seconds");
    }
    if (!this.newPayerReads.take()) throw busy();
  }

  private clearUncovered(payer: Address): void {
    const k = L(payer);
    if (!this.uncoveredPayers.has(k)) return;
    for (const c of this.calls.values()) if (L(c.payer) === k) c.uncovered = false;
    this.uncoveredPayers.delete(k);
  }

  // ---------- reconciliation: the queue checked against the chain

  /** The whole queue (at most one pass per reconcileCacheMs; one at a time). */
  private reconcileAll(): Promise<void> {
    if (this.reconcileAllInFlight) return this.reconcileAllInFlight;
    if (Date.now() - this.reconcileAllAt < this.limits.reconcileCacheMs) return Promise.resolve();
    const p = this.runReconcile(null).finally(() => {
      this.reconcileAllAt = Date.now();
      this.reconcileAllInFlight = undefined;
    });
    this.reconcileAllInFlight = p;
    return p;
  }

  /** The calls of ONE payer (at most one pass per payerReconcileCacheMs and per payer). */
  private reconcilePayer(payer: Address): Promise<void> {
    const k = L(payer);
    const inFlight = this.reconcilePayerInFlight.get(k);
    if (inFlight) return inFlight;
    const at = this.reconcilePayerAt.get(k);
    if (at !== undefined && Date.now() - at < this.limits.payerReconcileCacheMs) return Promise.resolve();
    const p = this.runReconcile(k).finally(() => {
      this.reconcilePayerInFlight.delete(k);
      if (this.reconcilePayerAt.size > 4096) {
        for (const [x, t] of this.reconcilePayerAt) if (Date.now() - t >= this.limits.payerReconcileCacheMs) this.reconcilePayerAt.delete(x);
      }
      this.reconcilePayerAt.set(k, Date.now());
    });
    this.reconcilePayerInFlight.set(k, p);
    return p;
  }

  /**
   * Before the operator's collection (GET /x402/pending): reads again, at one block, the BALANCE of each payer with
   * pending calls (one read per payer, the largest amounts first, taken from the reconciliations' global budget) and
   * sorts their calls into covered / "not covered", without reading the authorizations or removing anything from the
   * queue: the operator first receives what will be paid (proofs C and C2). At most one pass per reconcileCacheMs, one
   * at a time; without budget or on a read outage, the previous sorting stays.
   */
  refreshCoverage(): Promise<void> {
    if (this.coverageInFlight) return this.coverageInFlight;
    if (Date.now() - this.coverageAt < this.limits.reconcileCacheMs) return Promise.resolve();
    const p = this.runCoverage().finally(() => {
      this.coverageAt = Date.now();
      this.coverageInFlight = undefined;
    });
    this.coverageInFlight = p;
    return p;
  }

  private async runCoverage(): Promise<void> {
    const groups = new Map<string, StoredCall[]>();
    for (const c of this.calls.values()) {
      if (c.state !== "pending") continue;
      const k = L(c.payer);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(c);
    }
    if (groups.size === 0) return;
    const budget = Math.min(this.limits.reconcileMaxReads, this.reconcileReads.available());
    if (budget < 1) return;
    const sum = (cs: StoredCall[]) => cs.reduce((s, c) => s + c.amount, 0n);
    const payers = [...groups.entries()]
      .sort(([, a], [, b]) => {
        const x = sum(a), y = sum(b);
        return x > y ? -1 : x < y ? 1 : 0;
      })
      .slice(0, budget)
      .map(([k]) => k);
    this.reconcileReads.take(payers.length);
    let balances: Map<string, bigint>;
    try {
      balances = (await this.readPendingState(payers.map((k) => groups.get(k)![0]!), [])).balances;
    } catch (e) {
      this.log(`[sealed-x402] balance snapshot failed (on-chain read): ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      return;
    }
    const noAuthorizations = new Map<string, boolean>(); // nothing leaves the queue here: only the sorting
    for (const k of payers) this.applyCoverage(k, groups.get(k)!, balances.get(k), noAuthorizations);
  }

  /**
   * Reads again on-chain, in batches and at one block, the payers with pending calls (all of them, or one):
   *  1. their balances (the largest pending amounts first): a payer who no longer covers even their smallest call has
   *     all their calls "not covered" (without reading their authorizations);
   *  2. for the others: the balance and the state of each authorization, at one block; what is consumed leaves the
   *     queue, then the balance covers the calls in the order the operator settles them (the nearest deadline first),
   *     and the rest is "not covered". At most reconcileMaxReads reads, taken from the global budget
   *     (reconcileReadsPerMinute): without budget, no reconciliation (the refusal stands). A read outage changes nothing
   *     (the refusal stands).
   */
  private async runReconcile(only: string | null): Promise<void> {
    const groups = new Map<string, StoredCall[]>();
    for (const c of this.calls.values()) {
      if (c.state !== "pending") continue;
      const k = L(c.payer);
      if (only !== null && k !== only) continue;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(c);
    }
    if (groups.size === 0) return;
    const budget = Math.min(this.limits.reconcileMaxReads, this.reconcileReads.available());
    if (budget < 1) {
      this.log("[sealed-x402] reconciliation postponed: on-chain read budget exhausted for this minute");
      return;
    }
    const sum = (cs: StoredCall[]) => cs.reduce((s, c) => s + c.amount, 0n);
    const payers = [...groups.entries()]
      .sort(([, a], [, b]) => {
        const x = sum(a), y = sum(b);
        return x > y ? -1 : x < y ? 1 : 0;
      })
      .slice(0, budget)
      .map(([k]) => k);
    let freed = 0;
    let uncovered = 0;
    try {
      // 1) soldes
      this.reconcileReads.take(payers.length);
      const first = await this.readPendingState(payers.map((k) => groups.get(k)![0]!), []); // soldes seulement
      let reads = payers.length;
      const detail: string[] = [];
      for (const k of payers) {
        const bal = first.balances.get(k);
        if (bal === undefined) continue;
        const cs = groups.get(k)!;
        const smallest = cs.reduce((m, c) => (c.amount < m ? c.amount : m), cs[0]!.amount);
        if (bal < smallest) uncovered += this.applyCoverage(k, cs, bal, first.used).uncovered;
        else detail.push(k);
      }
      // 2) balance + authorizations, at one block, for the payers who still cover something
      const chosen: string[] = [];
      for (const k of detail) {
        const n = 1 + groups.get(k)!.length;
        if (reads + n > budget) continue;
        reads += n;
        chosen.push(k);
      }
      if (chosen.length) {
        const auths = chosen.flatMap((k) => groups.get(k)!);
        this.reconcileReads.take(chosen.length + auths.length);
        const snap = await this.readPendingState(chosen.map((k) => groups.get(k)![0]!), auths);
        for (const k of chosen) {
          const r = this.applyCoverage(k, groups.get(k)!, snap.balances.get(k), snap.used);
          freed += r.settled;
          uncovered += r.uncovered;
        }
      }
    } catch (e) {
      this.log(`[sealed-x402] reconciliation failed (on-chain read): ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      return;
    }
    if (freed || uncovered) {
      this.log(`[sealed-x402] reconciliation: ${freed} call(s) consumed on-chain removed from the queue, ${uncovered} not covered by their payer's balance (outside the exposure)`);
    }
  }

  /**
   * Applies an on-chain read to a payer's pending calls; returns what left and what is not covered. A call seen
   * consumed here leaves the queue WITHOUT making its payer "known" (settled or cancelled: the chain does not say which;
   * only the operator's report says it).
   */
  private applyCoverage(
    k: string,
    calls: StoredCall[],
    balance: bigint | undefined,
    used: Map<string, boolean>,
  ): { settled: number; uncovered: number } {
    // the state may have changed during the read (a report, an expiry): only the calls still pending here
    const live = calls
      .filter((c) => c.state === "pending" && this.calls.get(c.key) === c)
      .sort((x, y) => (x.validBefore < y.validBefore ? -1 : x.validBefore > y.validBefore ? 1 : x.servedAt - y.servedAt));
    let settled = 0;
    for (const c of live) if (used.get(c.key) === true && this.markSettled(c)) settled++;
    if (balance === undefined) return { settled, uncovered: 0 };
    let left = balance;
    let uncovered = 0;
    for (const c of live) {
      if (c.state !== "pending") continue;
      if (left >= c.amount) {
        left -= c.amount;
        c.uncovered = false;
      } else {
        c.uncovered = true;
        uncovered++;
      }
    }
    if (uncovered) {
      this.uncoveredPayers.add(k);
      this.trusted.delete(k);
    } else {
      this.uncoveredPayers.delete(k);
    }
    return { settled, uncovered };
  }

  /**
   * Balances from `balanceOf` (one call per payer, which supplies the address and a nonce) and states of `auths`, at
   * one block if the reader can read in batches; otherwise one by one (paymentState for a balance, authorizationUsed for an authorization).
   */
  private async readPendingState(payerCalls: StoredCall[], auths: StoredCall[]): Promise<X402PendingSnapshot> {
    if (this.chain.pendingState) {
      return this.chain.pendingState({
        payers: payerCalls.map((c) => c.payer),
        auths: auths.map((c) => ({ payer: c.payer, nonce: c.nonce })),
      });
    }
    const balances = new Map<string, bigint>();
    const used = new Map<string, boolean>();
    let block = 0n;
    await mapLimit(payerCalls, READ_CONCURRENCY, async (c) => {
      const ps = await this.chain.paymentState({ enclave: this.enclave, productId: this.productId, payer: c.payer, nonce: c.nonce });
      balances.set(L(c.payer), ps.balance);
      used.set(c.key, ps.authorizationUsed);
      if (ps.block > block) block = ps.block;
    });
    await mapLimit(
      auths.filter((c) => !used.has(c.key)),
      READ_CONCURRENCY,
      async (c) => {
        used.set(c.key, await this.chain.authorizationUsed(c.payer, c.nonce));
      },
    );
    return { block, balances, used };
  }

  // ---------- the operator's queue

  /**
   * The calls served and not settled yet, in pages (`offset`): first those that their payer's balance covered at the
   * last snapshot (refreshCoverage), then the "not covered" ones; in each group, the most urgent first (the
   * authorization's deadline). Unpayable calls with a short deadline therefore no longer pass ahead of a covered call (proof C).
   */
  pending(limit = 100, offset = 0): { total: number; items: X402PendingItem[] } {
    this.prune();
    const all = [...this.calls.values()]
      .filter((c) => c.state === "pending")
      .sort((x, y) => {
        if (x.uncovered !== y.uncovered) return x.uncovered ? 1 : -1;
        return x.validBefore < y.validBefore ? -1 : x.validBefore > y.validBefore ? 1 : x.servedAt - y.servedAt;
      });
    const from = Math.max(0, Math.floor(offset));
    return { total: all.length, items: all.slice(from, from + Math.max(0, limit)).map(toPendingItem) };
  }

  /**
   * POST /x402/settled: the operator's report, SIGNED (EIP-712, see x402-ack.ts) by an address of OPERATOR_ALLOWLIST,
   * bound to this enclave, timestamped, single-use, rate-bounded. Nothing is read on-chain before the signature is
   * verified. Throws X402Error (400 unreadable, 401 unsigned / stale / another enclave, 403 outside the list, 409
   * replayed, 429 rate).
   */
  async acknowledgeSigned(body: unknown): Promise<X402AckResult> {
    const raw = body as { items?: unknown; signature?: unknown } | null;
    if (raw && typeof raw === "object" && Array.isArray(raw.items) && raw.signature === undefined) {
      throw new X402Error(401, "ack_unsigned", "unsigned report: POST /x402/settled is restricted to the operator (an EIP-712 signature by an address of OPERATOR_ALLOWLIST)");
    }
    let a: X402AckBody;
    try {
      a = parseAckBody(body);
    } catch (e) {
      throw new X402Error(400, "invalid_ack", `signalement illisible : ${(e as Error).message}`);
    }
    const now = this.now();
    const maxAge = BigInt(this.limits.ackMaxAgeSeconds);
    if (a.issuedAt + maxAge < now || a.issuedAt > now + ACK_FUTURE_SKEW_SECONDS) {
      throw new X402Error(
        401,
        "ack_stale",
        `stale or future-dated report (issuedAt ${a.issuedAt}, enclave clock ${now}, tolerance ${maxAge} s): sign it again`,
      );
    }
    if (L(a.enclave) !== L(this.enclave) || a.productId !== this.productId) {
      throw new X402Error(401, "ack_wrong_enclave", `report addressed to enclave ${a.enclave} (product #${a.productId}), not to this one (${this.enclave}, product #${this.productId})`);
    }
    const signer = await recoverAckSigner(this.cfg.chainId, this.cfg.settler, a);
    if (!signer) throw new X402Error(401, "ack_bad_signature", "unreadable report signature: restricted to the operator (EIP-712, OPERATOR_ALLOWLIST)");
    if (this.operators && !this.operators.has(L(signer))) {
      throw new X402Error(403, "ack_not_operator", `report signed by ${signer}, who is not in OPERATOR_ALLOWLIST: restricted to the operator`);
    }
    if (this.ackReplay.has(a.ackNonce, now)) throw new X402Error(409, "ack_replayed", "report already received (single-use ackNonce): sign it again");
    if (!this.ackRequests.take()) throw new X402Error(429, "ack_rate_limited", "too many reports: try again in a few seconds");
    if (!this.ackReplay.claim(a.ackNonce, a.issuedAt + maxAge + ACK_FUTURE_SKEW_SECONDS, now)) {
      throw new X402Error(409, "ack_replayed", "report already received (single-use ackNonce): sign it again");
    }
    return this.acknowledge(a.items, { readBudget: this.ackReads });
  }

  /**
   * Takes out of the queue the calls that the chain says are consumed (USDC.authorizationState): nothing is taken on
   * trust. The items are deduplicated; only the keys pending HERE are read, each one once (a batched read at one block,
   * shared with a concurrent report). `readBudget`: beyond it, the keys stay "pending" (not read).
   * `settled` (the operator's report, evening of 9 Nov): true = settled by X402Settler (the payer becomes "known"),
   * false = consumed another way, cancelled by the payer (they are not "known", or no longer); absent: neither.
   * Returns what left, what stayed, what is unknown.
   */
  async acknowledge(items: unknown[], o: { readBudget?: TokenBucket } = {}): Promise<X402AckResult> {
    const out: X402AckResult = { settled: [], pending: [], unknown: [] };
    const seen = new Set<string>();
    const toRead: StoredCall[] = [];
    const paidOf = new Map<string, boolean>();
    for (const it of items.slice(0, X402_ACK_MAX_ITEMS)) {
      const payer = (it as { payer?: unknown })?.payer;
      const nonce = (it as { nonce?: unknown })?.nonce;
      const settled = (it as { settled?: unknown })?.settled;
      if (typeof payer !== "string" || !isAddress(payer, { strict: false }) || typeof nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(nonce)) {
        const k = String(nonce ?? "?");
        if (!seen.has(k)) {
          seen.add(k);
          out.unknown.push(k);
        }
        continue;
      }
      const key = `${L(payer)}:${L(nonce)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (typeof settled === "boolean") paidOf.set(key, settled);
      const c = this.calls.get(key);
      if (!c) out.unknown.push(key);
      else if (c.state === "settled") {
        // already seen consumed (reconciliation): the operator now says how
        if (typeof settled === "boolean") this.notePayment(c, settled);
        out.settled.push(key);
      } else toRead.push(c);
    }
    let readable = toRead;
    if (o.readBudget && toRead.length) {
      const n = Math.min(toRead.length, o.readBudget.available());
      o.readBudget.take(n);
      readable = toRead.slice(0, n);
      for (const c of toRead.slice(n)) out.pending.push(c.key);
    }
    const used = await this.authStates(readable);
    for (const c of readable) {
      if (used.get(c.key) === true) {
        // during the read, the call may have been forgotten (expired) or already removed: freed only once
        this.markSettled(c, paidOf.get(c.key));
        out.settled.push(c.key);
      } else {
        out.pending.push(c.key);
      }
    }
    return out;
  }

  /** The on-chain state of these calls' authorizations: at most one read per key (shared between concurrent calls). */
  private async authStates(calls: StoredCall[]): Promise<Map<string, boolean | undefined>> {
    const fresh = calls.filter((c) => !this.authInFlight.has(c.key));
    if (fresh.length) {
      const batch = this.readPendingState([], fresh).then(
        (s) => s.used,
        () => new Map<string, boolean>(), // read failed: the keys stay pending
      );
      for (const c of fresh) {
        const p = batch.then((m) => m.get(c.key));
        this.authInFlight.set(c.key, p);
        void p.finally(() => {
          if (this.authInFlight.get(c.key) === p) this.authInFlight.delete(c.key);
        });
      }
    }
    const entries = await Promise.all(calls.map(async (c) => [c.key, await this.authInFlight.get(c.key)] as const));
    return new Map(entries);
  }

  /**
   * Forgets the calls whose authorization has expired (no longer settleable: lost for the operator if they were not
   * settled) and, beyond maxStoredCalls, the oldest calls already settled (they only serve resumptions). Returns the
   * number of unsettled calls lost.
   */
  prune(): number {
    const now = this.now();
    let lost = 0;
    for (const [k, c] of this.calls) {
      if (c.validBefore > now) continue;
      if (c.state === "pending") {
        lost++;
        this.release(c.payer, c.amount);
        this.log(`[sealed-x402] call not settled before its authorization's deadline, lost for the operator: payer ${c.payer}, ${c.amount} base units of USDC`);
      }
      this.calls.delete(k);
    }
    if (this.calls.size > this.limits.maxStoredCalls) {
      const settled = [...this.calls.values()].filter((c) => c.state === "settled").sort((x, y) => x.servedAt - y.servedAt);
      for (const c of settled) {
        if (this.calls.size <= this.limits.maxStoredCalls) break;
        this.calls.delete(c.key);
      }
    }
    return lost;
  }

  /** Diagnostics (without any call data). */
  stats(): {
    pending: number;
    pendingAmount: string;
    inFlight: number;
    stored: number;
    uncovered: number;
    exposure: string;
    unsettledInWindow: number;
  } {
    const pending = [...this.calls.values()].filter((c) => c.state === "pending");
    return {
      pending: pending.length,
      pendingAmount: pending.reduce((s, c) => s + c.amount, 0n).toString(),
      inFlight: this.reserved.size,
      stored: this.calls.size,
      uncovered: pending.filter((c) => c.uncovered).length,
      exposure: this.exposure().toString(),
      unsettledInWindow: this.unsettledInWindow(),
    };
  }

  // ---------- comptes internes

  private loadOf(payer: Address): { count: number; amount: bigint } {
    return this.load.get(L(payer)) ?? { count: 0, amount: 0n };
  }

  private reserve(key: string, payer: Address, amount: bigint): void {
    this.reserved.set(key, { payer: L(payer), amount });
    const l = this.loadOf(payer);
    this.load.set(L(payer), { count: l.count + 1, amount: l.amount + amount });
    this.totalCount++;
  }

  /** The call is served: the reservation becomes a call awaiting settlement (same counts). */
  private commit(c: StoredCall): void {
    this.reserved.delete(c.key);
    this.calls.set(c.key, c);
    this.served.push({ at: this.now(), call: c });
  }

  private unreserve(key: string): void {
    const r = this.reserved.get(key);
    if (!r) return;
    this.reserved.delete(key);
    this.release(r.payer as Address, r.amount);
  }

  /**
   * The chain says the authorization is consumed: the call leaves the queue (only once). `paid`: what the operator says
   * about it (a signed report); absent (reconciliation), the payer does NOT become "known": a cancelled authorization
   * is consumed too (the verifier's proofs B and F).
   */
  private markSettled(c: StoredCall, paid?: boolean): boolean {
    if (paid !== undefined) this.notePayment(c, paid);
    if (c.state !== "pending" || this.calls.get(c.key) !== c) return false;
    c.state = "settled";
    c.uncovered = false;
    this.release(c.payer, c.amount);
    return true;
  }

  private release(payer: Address | string, amount: bigint): void {
    const k = L(payer);
    const l = this.load.get(k);
    if (l) {
      const next = { count: Math.max(0, l.count - 1), amount: l.amount > amount ? l.amount - amount : 0n };
      if (next.count === 0) this.load.delete(k);
      else this.load.set(k, next);
    }
    this.totalCount = Math.max(0, this.totalCount - 1);
  }
}

function authOf(p: PaymentPayload) {
  return p.payload.authorization;
}

function toPendingItem(c: StoredCall): X402PendingItem {
  return {
    receipt: serializeCallReceipt(c.receipt),
    signature: c.signature,
    auth: { validAfter: c.validAfter.toString(), validBefore: c.validBefore.toString(), nonce: c.nonce, signature: c.authSignature },
    amount: c.amount.toString(),
    servedAt: c.servedAt,
    covered: !c.uncovered,
  };
}
