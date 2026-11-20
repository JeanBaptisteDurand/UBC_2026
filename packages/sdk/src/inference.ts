/** inference.ts — an OpenAI-compatible client: encrypts to the enclave, signs with the session key, calls the
 *  inference product, verifies every receipt. Built for the "one call = one receipt" loop.
 *
 *  The X25519 key is NEVER taken as is from /pubkeys (which goes through a proxy). Before the first encryption, and
 *  again every `reverifyMs`, verifyEnclaveKeys requires: X25519 key = the one registered on-chain for this signer,
 *  enclave active for the session's product at the head block, signer = the enclave LOCKED when the session opened,
 *  same operator. Otherwise EnclaveKeyMismatchError, and nothing is sent.
 *
 *  Every answer is authenticated end to end: the receipt must be signed by THIS enclave and carry the session and the
 *  request's seq, the hash of the prompt sent (requestHash) and that of the text received (responseHash); otherwise
 *  ReceiptMismatchError (the text is not returned). `verified` also says whether SessionPay.settle would pay this
 *  receipt (enclave active at the anchor block for the session's operator, locked model). */
import { type Address, type Hex, type PublicClient, keccak256, toBytes, toHex, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hpkeSeal, hpkeOpen, generateX25519, type SessionKey } from "./crypto";
import { envelopeDigest, normalizeReceipt, recoverReceiptSigner, type Receipt } from "./eip712";
import { enclaveRegistryAbi } from "./abis";
import { testnet, type Deployment } from "./network";
import { verifyEnclaveKeys, type VerifiedEnclaveKeys } from "./enclave-keys";
import { readSession, type SessionInfo } from "./receipts";

export interface InferenceClientOptions {
  /** The product's gateway, direct or behind a proxy: its keys are verified on-chain. */
  enclaveUrl: string;
  sessionId: bigint;
  /** Session key (the address is recomputed from the private key if it is missing or zero). */
  sessionKey: SessionKey;
  publicClient: PublicClient;
  deployment?: Deployment;
  /** Check the enclave's keys on-chain again at the latest after this delay (ms, default 5 min). */
  reverifyMs?: number;
  fetch?: typeof fetch;
}

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }
export interface ChatRequest { messages: ChatMessage[]; temperature?: number; max_tokens?: number; seed?: number; }
/** `signature`: the enclave's EIP-712 signature of the receipt. Keep a session's latest (receipt, signature) pair: it
 *  proves what you owe, and anyone can settle it on-chain (settle) for the operator. */
export interface Completion { text: string; receipt: Receipt; signature: Hex; signer: Address; verified: boolean; }

/** 402: the session's balance does not cover this request. `pending`: an answer already computed is waiting (top up
 *  the session, then `retryPending()` delivers it without running the model again). */
export class InsufficientSessionBalance extends Error {
  constructor(public balance: bigint, public pending?: { seq: bigint; cost: bigint }) {
    super(pending
      ? `insufficient session balance: a computed answer is waiting (cost ${pending.cost} in USDC base units); top up the session, then replay it`
      : "insufficient_session_balance");
    this.name = "InsufficientSessionBalance";
  }
}
/** 410: session closed, expired, or less than 60 s from its expiry (the enclave no longer serves it). */
export class SessionExpiredError extends Error {
  constructor(message: string) { super(message); this.name = "SessionExpiredError"; }
}
/** The answer does not come from the verified enclave, or does not match the request: its text is not returned. */
export class ReceiptMismatchError extends Error {
  constructor(message: string) { super(`answer refused: ${message}`); this.name = "ReceiptMismatchError"; }
}

/** The prompt as the enclave hashes it (requestHash = keccak256 of this text). */
export function promptOf(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}
/** The parameters as the enclave hashes them (paramsHash = keccak256(JSON)). */
function paramsOf(req: ChatRequest) {
  return { temperature: req.temperature, maxTokens: req.max_tokens, seed: req.seed };
}

export class InferenceClient {
  private seq = 0n;
  private keys?: VerifiedEnclaveKeys;
  private session?: SessionInfo;
  private pending?: { seq: bigint; req: ChatRequest };
  private readonly d: Deployment;
  private readonly f: typeof fetch;
  private readonly account;

  constructor(private o: InferenceClientOptions) {
    this.d = o.deployment ?? testnet;
    // called as a function, never as a method: in a browser, fetch called with `this` = this client throws
    // "Illegal invocation" (Node accepts it, so only a browser check shows it)
    this.f = o.fetch ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => globalThis.fetch(input, init));
    this.account = privateKeyToAccount(o.sessionKey.privateKey); // the address comes from the key, never from a parameter
  }

  private base() { return this.o.enclaveUrl.replace(/\/$/, ""); }

  /** The enclave's keys, verified on-chain against the session (done again after `reverifyMs`). */
  async verifiedKeys(force = false): Promise<VerifiedEnclaveKeys> {
    const maxAge = this.o.reverifyMs ?? 5 * 60_000;
    if (!force && this.keys && Date.now() - this.keys.checkedAtMs < maxAge) return this.keys;
    const s = await readSession(this.o.publicClient, this.d, this.o.sessionId);
    if (s.owner === zeroAddress) throw new Error(`session #${this.o.sessionId} unknown to SessionPay`);
    if (s.closed) throw new SessionExpiredError(`session #${this.o.sessionId} close`);
    if (s.sessionKey.toLowerCase() !== this.account.address.toLowerCase()) {
      throw new Error(`the session key given (${this.account.address}) is not the key of session #${this.o.sessionId} (${s.sessionKey}): rotated or wrong key`);
    }
    this.keys = await verifyEnclaveKeys(this.o.enclaveUrl, s.productId, {
      publicClient: this.o.publicClient, deployment: this.d, expectedSigner: s.enclave, expectedOperator: s.operator, fetch: this.f,
    });
    this.session = s;
    return this.keys;
  }

  get models() {
    return { list: async () => (await this.f(`${this.base()}/v1/models`)).json() };
  }

  get chat() {
    return { completions: { create: (req: ChatRequest) => this.create(req) } };
  }

  /** After a 402 with an answer waiting and a top-up of the session: delivers the answer the enclave kept. */
  async retryPending(): Promise<Completion> {
    if (!this.pending) throw new Error("no answer waiting");
    return this.create(this.pending.req);
  }

  private async create(req: ChatRequest, resynced = false): Promise<Completion> {
    if (this.pending && JSON.stringify(this.pending.req) !== JSON.stringify(req)) {
      throw new Error(`an answer already computed is waiting (seq ${this.pending.seq}): top up the session, then replay the same request (retryPending)`);
    }
    const keys = await this.verifiedKeys();
    const prompt = promptOf(req.messages);
    const params = paramsOf(req);
    const eph = generateX25519();
    const sealed = await hpkeSeal(toBytes(keys.x25519), new TextEncoder().encode(prompt)); // key VERIFIED on-chain
    const ciphertext = toHex(sealed.ciphertext);
    const enc = toHex(sealed.enc);
    const seq = this.pending?.seq ?? this.seq + 1n;
    this.seq = seq;
    const digest = envelopeDigest(this.o.sessionId, seq, ciphertext, eph.publicKey);
    const signature = await this.account.signMessage({ message: { raw: digest } });

    const res = await this.f(`${this.base()}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: this.o.sessionId.toString(), seq: seq.toString(), enc, ciphertext, clientEphemeralPub: eph.publicKey, signature, params,
      }),
    });
    if (res.status === 402) {
      const b = await res.json().catch(() => ({})) as { balance?: string; pendingSeq?: string; pendingCost?: string };
      const pending = b.pendingSeq ? { seq: BigInt(b.pendingSeq), cost: BigInt(b.pendingCost ?? "0") } : undefined;
      if (pending) this.pending = { seq: pending.seq, req };
      else this.seq = seq - 1n; // refused before the model: this seq is not used up
      throw new InsufficientSessionBalance(BigInt(b.balance ?? "0"), pending);
    }
    if (res.status === 409) {
      const b = await res.json().catch(() => ({})) as { error?: string; expectedSeq?: string };
      // Another instance served this session (shared aek_ key, restart): resync ONCE with the enclave.
      if (!resynced && !this.pending && b.expectedSeq && /^\d+$/.test(b.expectedSeq)) {
        this.seq = BigInt(b.expectedSeq) - 1n;
        return this.create(req, true);
      }
      throw new Error(`inference: 409 ${b.error ?? ""}`);
    }
    if (res.status === 410) {
      const b = await res.json().catch(() => ({})) as { error?: string };
      throw new SessionExpiredError(`session #${this.o.sessionId} no longer served: ${b.error ?? "closed or expired"}`);
    }
    if (res.status === 403) {
      this.keys = undefined; // to check again: the enclave says it does not serve this session
      const b = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(`inference refused by the enclave (403): ${b.error ?? ""}`);
    }
    if (!res.ok) throw new Error(`inference: ${res.status} ${await res.text()}`);
    const out = await res.json() as { enc: Hex; ciphertext: Hex; receipt: any; signature: Hex };
    const plain = await hpkeOpen(eph.privateKey, toBytes(out.enc), toBytes(out.ciphertext));
    const text = new TextDecoder().decode(plain);
    this.pending = undefined;

    // Authenticity of the answer: a receipt signed by the verified enclave, for THIS request and THIS text.
    const receipt = normalizeReceipt(out.receipt);
    const signer = await recoverReceiptSigner(this.d.sessionPay, receipt, out.signature, this.d.chainId);
    if (signer.toLowerCase() !== keys.signer.toLowerCase()) throw new ReceiptMismatchError(`receipt signed by ${signer}, not by the verified enclave ${keys.signer}`);
    if (receipt.sessionId !== this.o.sessionId || receipt.seq !== seq) throw new ReceiptMismatchError(`receipt of session #${receipt.sessionId} seq ${receipt.seq}, request #${this.o.sessionId} seq ${seq}`);
    if (receipt.requestHash.toLowerCase() !== keccak256(toBytes(prompt)).toLowerCase()) throw new ReceiptMismatchError("the receipt does not carry the hash of the prompt sent");
    if (receipt.responseHash.toLowerCase() !== keccak256(toBytes(text)).toLowerCase()) throw new ReceiptMismatchError("the text received is not the one the enclave signed");
    if (receipt.paramsHash.toLowerCase() !== keccak256(toBytes(JSON.stringify(params))).toLowerCase()) throw new ReceiptMismatchError("the receipt does not carry the parameters sent");

    // Payable by SessionPay.settle? (the contract's own checks, at the receipt's anchor block)
    const s = this.session!;
    const op = await this.o.publicClient.readContract({
      address: this.d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "activeOperatorAt", args: [signer, s.productId, receipt.anchorBlock],
    }) as Address;
    const verified = receipt.productId === s.productId && signer.toLowerCase() === s.enclave.toLowerCase()
      && op.toLowerCase() === s.operator.toLowerCase() && receipt.modelHash.toLowerCase() === s.param.toLowerCase();
    return { text, receipt, signature: out.signature, signer, verified };
  }
}

export function createInferenceClient(o: InferenceClientOptions): InferenceClient { return new InferenceClient(o); }
