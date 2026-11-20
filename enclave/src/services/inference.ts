/**
 * inference.ts — the inference service (O2), v2 bis.
 *
 * The gateway, in order: reads the session on-chain (session key, deposit, cap, price), checks that THIS enclave must
 * serve it (v2 bis) and that `seq` follows, refuses with 402 if the running total exceeds what the contract will pay,
 * runs the local inference, builds the cumulative receipt, signs it through the kit, then returns the answer
 * (encrypted by the HTTP server).
 *
 * v2:
 *  - ATOMICITY PER SESSION: the check of `seq`, the call to the model, the computation of the running total and the
 *    signature run under the session's lock (a FIFO queue). Two concurrent requests can therefore never receive the
 *    same `seq`: the enclave NEVER signs two receipts for the same (sessionId, seq). Otherwise it would be an
 *    equivocation, and SessionPay.reportEquivocation slashes the operator's whole bond (half to the reporter, half to
 *    the session's owner). A session's state is never forgotten while the process lives (forgetting it would reopen
 *    the old `seq` values); a restart regenerates the keys, so the signer changes.
 *  - UNITS: the running total is kept in TOKENS (input, output). units = ceil((input + OUT_WEIGHT × output)
 *    / UNIT_TOKENS), computed on the running total (no rounding per request). `cumulativeUnits` is strictly
 *    increasing: a receipt is worth at least one unit more than the previous one.
 *  - LAST RECEIPT kept in memory per session (GET /v1/session/:id/receipt): the operator settles it.
 *
 * v2 bis (adversarial review of 7 Nov):
 *  - ONE SESSION, ONE ENCLAVE: SessionPay binds each session to the key of ONE enclave (chosen at opening) and pays only
 *    its receipts. BEFORE any call to the model, the gateway refuses (403) a session of another product, bound to
 *    another enclave, of an operator that is not its own (OPERATOR_ALLOWLIST), at price 0, or with another model or
 *    another billed unit than its own: each of its receipts would be unpayable (WrongEnclave, WrongOperator,
 *    ModelMismatch…) and the operator would pay the model for nothing.
 *  - EXPIRY: a session that has expired, or is less than `expiryMarginSeconds` (60 s) from its expiry, is no longer
 *    served (410): its owner can close it from expiry + 1 h, and the operator must be able to settle before that.
 *  - 402 WITHOUT A REPLAY AT THE OPERATOR'S EXPENSE: a request plainly too expensive for the balance (a low estimate,
 *    4 bytes per input token) is refused BEFORE the call to the model. If the model ran and the result exceeds the
 *    balance, the answer is KEPT PENDING, neither signed nor delivered: until the balance covers it, every request of
 *    the session gets 402 WITHOUT a call to the model; once the session is topped up, replaying the SAME request (same
 *    seq) delivers the kept answer, billed normally. The model never runs twice for an unpaid request, and the client
 *    never pays for an answer it did not receive.
 *
 * `llama-server` and the block read are injected (interfaces) to stay testable outside the VM.
 */
import { type Address, type Hex, keccak256, toBytes, verifyMessage } from "viem";
import { EnclaveKit } from "../kit/enclave-kit";
import type { Receipt } from "../kit/eip712";
import { KeyedMutex } from "../kit/keyed-mutex";

export interface SessionView {
  owner: Address;
  productId: bigint;
  operator: Address;
  sessionKey: Address;
  deposit: bigint;
  /** The session's spending cap (0 or absent = the deposit), as in SessionPay.settle. */
  cap?: bigint;
  price: bigint; // USDC (6 decimals) per unit, LOCKED at opening (SessionPay v2: Session.price)
  paidUnits: bigint; // running total already settled on-chain
  expiresAt: bigint; // secondes Unix
  closed: boolean;
  /** v2 bis: the ONLY enclave whose receipts pay this session (Session.enclave). */
  enclave: Address;
  /** v2 bis: the model locked at opening (Session.param); absent = not checked. */
  param?: Hex;
  /** v2 bis: the billed unit locked at opening (Session.unitTokens); absent = not checked. */
  unitTokens?: bigint;
  /** v2 bis: the weight of an output token locked at opening (Session.outWeight); absent = not checked. */
  outWeight?: bigint;
}

export interface SessionReader {
  getSession(sessionId: bigint): Promise<SessionView>;
}

export interface LlamaClient {
  /** `signal` fires when the gateway abandons the call (timeout). */
  infer(
    prompt: string,
    params: InferenceParams,
    signal?: AbortSignal,
  ): Promise<{ text: string; tokensIn: number; tokensOut: number }>;
}

export interface BlockSource {
  current(): Promise<bigint>;
}

export interface InferenceParams {
  temperature?: number;
  seed?: number;
  maxTokens?: number;
}

export interface InferenceOk {
  status: 200;
  text: string;
  receipt: Receipt;
  signature: Hex;
}

export interface InsufficientBalance {
  status: 402;
  error: "insufficient_session_balance";
  balance: bigint;
  /**
   * v2 bis: an answer already computed waits for the balance to cover it (`cost` in USDC, 6 decimals): top up the
   * session, then replay the SAME request with this `seq` (the model does not run a second time).
   */
  pending?: { seq: bigint; cost: bigint };
}

export type InferenceResult = InferenceOk | InsufficientBalance;

export interface SignedReceipt {
  receipt: Receipt;
  signature: Hex;
}

/** An error returned to the client with an HTTP code (seq out of order, closed session, failing model…). */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly httpStatus: 400 | 403 | 409 | 410 | 502 | 504,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export interface Billing {
  /** UNIT_TOKENS: input-equivalent tokens per billed unit (default 1 = the v1 behavior). */
  unitTokens: bigint;
  /** OUT_WEIGHT: an output token counts as OUT_WEIGHT input tokens (default 1 = v1). */
  outWeight: bigint;
}

export interface GatewayConfig {
  sessionPay: Address;
  modelHash: Hex; // = the product's param; must be equal for settlement
  /** v2: input-equivalent tokens per unit (UNIT_TOKENS, default 1). */
  unitTokens?: bigint;
  /** v2: the weight of an output token (OUT_WEIGHT, default 1). */
  outWeight?: bigint;
  /** v1, kept for compatibility: units multiplier per token (default 1). */
  unitPerToken?: bigint;
  /** The maximum duration of a call to the model, in ms (default 120,000): a session's lock is never held forever. */
  inferTimeoutMs?: number;
  /** v2 bis: the operators whose sessions this enclave serves (OPERATOR_ALLOWLIST); absent = not checked. */
  operators?: readonly Address[];
  /** v2 bis: a clock in Unix seconds (default: the process's). */
  now?: () => bigint;
  /** v2 bis: a session is no longer served within this delay of its expiry (seconds, default 60). */
  expiryMarginSeconds?: bigint;
}

/** A session's state in THIS enclave (never erased while the process lives). */
interface SessionState {
  lastSeq: bigint; // the last signed seq
  tokensIn: bigint; // running total of input tokens served by this enclave
  tokensOut: bigint; // cumul des jetons de sortie
  offset: bigint; // units counted outside this enclave (already settled on-chain before it)
  units: bigint; // cumulativeUnits of the last signed receipt (or the on-chain floor)
  last?: SignedReceipt;
  /** v2 bis: a computed answer that the balance does not cover yet (neither signed nor delivered). */
  pending?: PendingResponse;
}

/** A model answer kept while the session's balance does not cover it (v2 bis). */
interface PendingResponse {
  seq: bigint;
  requestHash: Hex;
  paramsHash: Hex;
  text: string;
  tokensIn: bigint;
  tokensOut: bigint;
}

const MAX_UINT64 = 2n ** 64n - 1n;

/** units = ceil((input + outWeight × output) × unitPerToken / unitTokens), on running totals. */
export function unitsForTokens(
  tokensIn: bigint,
  tokensOut: bigint,
  b: Billing & { unitPerToken?: bigint },
): bigint {
  const weighted = (tokensIn + b.outWeight * tokensOut) * (b.unitPerToken ?? 1n);
  return (weighted + b.unitTokens - 1n) / b.unitTokens;
}

/** Reads UNIT_TOKENS and OUT_WEIGHT (integers ≥ 1, default 1). An invalid value stops the start-up. */
export function billingFromEnv(env: Record<string, string | undefined> = process.env): Billing {
  return {
    unitTokens: positiveInteger(env.UNIT_TOKENS, "UNIT_TOKENS"),
    outWeight: positiveInteger(env.OUT_WEIGHT, "OUT_WEIGHT"),
  };
}

function positiveInteger(raw: string | undefined, name: string): bigint {
  if (raw === undefined) return 1n;
  const t = raw.trim();
  if (!/^[0-9]+$/.test(t) || BigInt(t) < 1n || BigInt(t) > MAX_UINT64) {
    throw new Error(`${name} must be an integer ≥ 1 (got "${raw}")`);
  }
  return BigInt(t);
}

export class InferenceGateway {
  private sessions = new Map<string, SessionState>();
  private locks = new KeyedMutex();
  private unitPerToken: bigint;
  private operators: Set<string> | undefined;
  private now: () => bigint;
  private expiryMargin: bigint;
  readonly billing: Billing;

  constructor(
    private kit: EnclaveKit,
    private cfg: GatewayConfig,
    private reader: SessionReader,
    private llama: LlamaClient,
    private blocks: BlockSource,
  ) {
    this.unitPerToken = cfg.unitPerToken ?? 1n;
    this.billing = { unitTokens: cfg.unitTokens ?? 1n, outWeight: cfg.outWeight ?? 1n };
    if (this.billing.unitTokens < 1n) throw new Error("unitTokens (UNIT_TOKENS) must be ≥ 1");
    if (this.billing.outWeight < 1n) throw new Error("outWeight (OUT_WEIGHT) must be ≥ 1");
    if (this.unitPerToken < 1n) throw new Error("unitPerToken must be ≥ 1");
    this.operators = cfg.operators ? new Set(cfg.operators.map((a) => a.toLowerCase())) : undefined;
    this.now = cfg.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
    this.expiryMargin = cfg.expiryMarginSeconds ?? 60n;
    if (this.expiryMargin < 0n) throw new Error("expiryMarginSeconds must be ≥ 0");
  }

  /** Verifies the session key's signature on the envelope (outside the ciphertext). */
  static async verifyEnvelope(sessionKey: Address, envelopeDigest: Hex, signature: Hex): Promise<boolean> {
    try {
      return await verifyMessage({ address: sessionKey, message: { raw: envelopeDigest }, signature });
    } catch {
      return false;
    }
  }

  private key(sessionId: bigint): string {
    return sessionId.toString();
  }

  /** The last receipt signed for the session by this enclave (since it started), if any. */
  lastReceipt(sessionId: bigint): SignedReceipt | undefined {
    return this.sessions.get(this.key(sessionId))?.last;
  }

  /**
   * Handles a request already decrypted and authenticated (session key verified upstream).
   * Serialized per session: the reservation of `seq` and of the running total is atomic.
   */
  handle(sessionId: bigint, seq: bigint, prompt: string, params: InferenceParams): Promise<InferenceResult> {
    return this.locks.run(this.key(sessionId), () => this.handleLocked(sessionId, seq, prompt, params));
  }

  private async handleLocked(
    sessionId: bigint,
    seq: bigint,
    prompt: string,
    params: InferenceParams,
  ): Promise<InferenceResult> {
    const s = await this.reader.getSession(sessionId);
    if (s.closed) throw new GatewayError("session closed", 410);
    this.assertServes(s); // v2 bis: 403 / 410 before any call to the model

    const key = this.key(sessionId);
    const st: SessionState = this.sessions.get(key) ?? {
      lastSeq: 0n,
      tokensIn: 0n,
      tokensOut: 0n,
      offset: s.paidUnits, // resumption: what is already settled on-chain is already counted
      units: s.paidUnits,
    };

    // Defense: if the chain has already settled more than our last receipt, shift so that the next receipt stays
    // settleable (> paidUnits). (v2 bis: the session is bound to this enclave, so this should no longer happen.)
    let offset = st.offset;
    let floor = st.units;
    if (s.paidUnits > floor) {
      offset += s.paidUnits - floor;
      floor = s.paidUnits;
    }

    // The most the contract will pay: the deposit, or the cap if it is lower (SessionPay.settle).
    const ceiling = s.cap !== undefined && s.cap > 0n && s.cap < s.deposit ? s.cap : s.deposit;
    const requestHash = keccak256(toBytes(prompt));
    const paramsHash = keccak256(toBytes(JSON.stringify(params ?? {})));

    // v2 bis: an answer already computed waits for the balance to cover it; never a second call to the model
    if (st.pending) {
      const p = st.pending;
      const units = this.unitsAfter(st, offset, floor, p.tokensIn, p.tokensOut);
      if (units * s.price > ceiling) {
        return insufficient(ceiling, floor, s.price, { seq: p.seq, cost: (units - floor) * s.price });
      }
      if (seq !== p.seq || requestHash !== p.requestHash || paramsHash !== p.paramsHash) {
        throw new GatewayError(
          `expected seq ${p.seq}: the answer already computed for this request is waiting; replay it unchanged`,
          409,
          { expectedSeq: p.seq.toString() },
        );
      }
      return this.commit(key, s, st, sessionId, offset, units, p);
    }

    if (seq !== st.lastSeq + 1n) {
      throw new GatewayError(`expected seq ${st.lastSeq + 1n}, got ${seq}`, 409, {
        expectedSeq: (st.lastSeq + 1n).toString(),
      });
    }

    // Before paying the model: the session must be able to pay at least one more unit, and at least the estimated
    // input of this request (a LOW estimate: 4 bytes per token; nothing is reserved).
    const estimate = this.unitsAfter(st, offset, floor, estimateInputTokens(prompt), 0n);
    if (estimate * s.price > ceiling) return insufficient(ceiling, floor, s.price);

    const out = await this.infer(prompt, params);
    const result: PendingResponse = {
      seq,
      requestHash,
      paramsHash,
      text: out.text,
      tokensIn: tokenCount(out.tokensIn, "input"),
      tokensOut: tokenCount(out.tokensOut, "output"),
    };

    // Units on the running total (no rounding per request), strictly increasing.
    const units = this.unitsAfter(st, offset, floor, result.tokensIn, result.tokensOut);

    // v2 bis: the model ran but the running total exceeds what the contract will pay: the answer is KEPT (neither
    // signed nor delivered, seq reserved); only the same request receives it, once the balance suffices.
    if (units * s.price > ceiling) {
      this.sessions.set(key, { ...st, pending: result });
      return insufficient(ceiling, floor, s.price, { seq, cost: (units - floor) * s.price });
    }
    return this.commit(key, s, st, sessionId, offset, units, result);
  }

  /** Running total of units if these tokens are added, strictly above the floor (at least +1 unit). */
  private unitsAfter(st: SessionState, offset: bigint, floor: bigint, addIn: bigint, addOut: bigint): bigint {
    const units =
      offset + unitsForTokens(st.tokensIn + addIn, st.tokensOut + addOut, { ...this.billing, unitPerToken: this.unitPerToken });
    return units <= floor ? floor + 1n : units;
  }

  /** Signs the receipt of the answer and commits the session's state (the seq is consumed for good). */
  private async commit(
    key: string,
    s: SessionView,
    st: SessionState,
    sessionId: bigint,
    offset: bigint,
    units: bigint,
    r: PendingResponse,
  ): Promise<InferenceOk> {
    const anchorBlock = await this.blocks.current();
    const receipt: Receipt = {
      productId: s.productId,
      sessionId,
      seq: r.seq,
      modelHash: this.cfg.modelHash,
      paramsHash: r.paramsHash,
      requestHash: r.requestHash,
      responseHash: keccak256(toBytes(r.text)),
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      cumulativeUnits: units,
      anchorBlock,
    };
    const signature = await this.kit.signReceipt(this.cfg.sessionPay, receipt);

    // Commitment, synchronous and right after the signature: this seq is consumed for good (no more pending
    // answer).
    this.sessions.set(key, {
      lastSeq: r.seq,
      tokensIn: st.tokensIn + r.tokensIn,
      tokensOut: st.tokensOut + r.tokensOut,
      offset,
      units,
      last: { receipt, signature },
    });
    return { status: 200, text: r.text, receipt, signature };
  }

  /**
   * v2 bis: must this enclave serve the session? Otherwise GatewayError (403, or 410 if expired), BEFORE any call to
   * the model: every receipt would be refused by SessionPay.settle, and the operator would pay upstream for nothing.
   */
  private assertServes(s: SessionView): void {
    const me = this.kit.keys.signer;
    if (s.productId !== this.kit.productId) {
      throw new GatewayError(`session of product ${s.productId}: this enclave serves product ${this.kit.productId}`, 403);
    }
    if (!s.enclave || s.enclave.toLowerCase() !== me.toLowerCase()) {
      throw new GatewayError(
        `session bound to enclave ${s.enclave ?? "(none)"}, not to this one (${me}): its receipts would not be paid (WrongEnclave)`,
        403,
      );
    }
    if (this.operators && !this.operators.has(s.operator.toLowerCase())) {
      throw new GatewayError(
        `session of operator ${s.operator}, who is not this enclave's operator: its receipts would not be paid (WrongOperator)`,
        403,
      );
    }
    if (s.price <= 0n) throw new GatewayError("session at price 0: no receipt would be paid", 403);
    if (s.param !== undefined && s.param.toLowerCase() !== this.cfg.modelHash.toLowerCase()) {
      throw new GatewayError(
        `session opened for model ${s.param}; this enclave serves ${this.cfg.modelHash} (ModelMismatch)`,
        403,
      );
    }
    if (
      (s.unitTokens !== undefined && s.unitTokens !== this.billing.unitTokens) ||
      (s.outWeight !== undefined && s.outWeight !== this.billing.outWeight)
    ) {
      throw new GatewayError(
        `the session's billed unit (UNIT_TOKENS=${s.unitTokens ?? "?"}, OUT_WEIGHT=${s.outWeight ?? "?"}) ≠ ` +
          `this enclave's (${this.billing.unitTokens}, ${this.billing.outWeight})`,
        403,
      );
    }
    const now = this.now();
    if (now + this.expiryMargin >= s.expiresAt) {
      throw new GatewayError(
        `session expired or about to expire (expiry ${s.expiresAt}, now ${now}, margin ${this.expiryMargin} s): ` +
          "its owner could close it before settlement",
        410,
      );
    }
  }

  /** A call to the model bounded in time (the session's lock is held during the call). */
  private async infer(prompt: string, params: InferenceParams) {
    const ms = this.cfg.inferTimeoutMs ?? 120_000;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new GatewayError(`the model did not answer within ${ms} ms`, 504));
      }, ms);
    });
    try {
      return await Promise.race([this.llama.infer(prompt, params, abort.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function insufficient(
  ceiling: bigint,
  units: bigint,
  price: bigint,
  pending?: { seq: bigint; cost: bigint },
): InsufficientBalance {
  const alreadyOwed = units * price;
  return {
    status: 402,
    error: "insufficient_session_balance",
    balance: ceiling > alreadyOwed ? ceiling - alreadyOwed : 0n,
    ...(pending ? { pending } : {}),
  };
}

/** A LOW estimate of a prompt's input tokens (≈ 4 UTF-8 bytes per token), to refuse before the model. */
export function estimateInputTokens(prompt: string): bigint {
  return BigInt(Math.ceil(new TextEncoder().encode(prompt).length / 4));
}

function tokenCount(n: number, what: string): bigint {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new GatewayError(`invalid ${what} token count returned by the model: ${n}`, 502);
  }
  return BigInt(n);
}
