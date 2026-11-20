/**
 * x402-ack.ts — the "calls settled" report (POST /x402/settled), RESTRICTED TO THE OPERATOR (fix of 14 Nov).
 *
 * Before, the route was public and without deduplication; the keys (payer, nonce) are public (GET /x402/pending), and
 * each item triggered an on-chain read (quorum: on EACH provider): 200 copies of one key = 200 reads for a 26 KB
 * request (the verifier's proof 4). Now:
 *  - the body is SIGNED with EIP-712 by an address of OPERATOR_ALLOWLIST (the registrar signs with the operator key it
 *    already holds); a missing or invalid signature: 401; a signer outside the list: 403; nothing is read;
 *  - it is bound to THIS enclave (the enclave's address, the product, the chain, X402Settler in the domain): it cannot
 *    be replayed elsewhere;
 *  - it is TIMESTAMPED (issuedAt, within ±ACK_MAX_AGE) and SINGLE-USE (the ackNonce is kept until the end of its
 *    window): a captured body cannot be replayed (409);
 *  - it is bounded in size (200 items, 64 KiB) and in rate (tokens: signed requests, then on-chain reads);
 *  - its items are deduplicated; a key is read on-chain only ONCE, and only if it is pending here.
 * Evening of 14 Nov (the verifier's proofs B and F): each item also says HOW the authorization was consumed.
 * `settled` = true: settled by X402Settler (the registrar knows it from the receipt of ITS transaction, or from the
 * CallSettled event); false: consumed another way (cancelled by the payer, cancelAuthorization). The chain does not
 * tell the two apart (authorizationState = true in both cases): only true makes the payer "known". The EIP-712 type
 * changed (domain version 2): a registrar from before this fix is refused (a signature of another message).
 * The SDK (packages/sdk/src/x402.ts, createX402SettlementQueue) builds exactly the same bytes: the cross-test
 * enclave/test/x402-e2e.test.ts checks it (the registrar's queue empties the enclave's).
 */
import { type Address, type Hex, getAddress, isAddress, recoverTypedDataAddress } from "viem";

/** At most this number of items per report (beyond: several reports). */
export const X402_ACK_MAX_ITEMS = 200;

/** The EIP-712 domain of the report: distinct from the receipts' (same chain, same X402Settler). */
export const X402_ACK_DOMAIN_NAME = "ArcEnclaveNetwork x402 ack";
export const X402_ACK_DOMAIN_VERSION = "2";

export const x402AckTypes = {
  X402Settled: [
    { name: "enclave", type: "address" },
    { name: "productId", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "ackNonce", type: "bytes32" },
    { name: "items", type: "X402SettledItem[]" },
  ],
  X402SettledItem: [
    { name: "payer", type: "address" },
    { name: "nonce", type: "bytes32" },
    { name: "settled", type: "bool" },
  ],
} as const;

export function x402AckDomain(chainId: number, settler: Address) {
  return { name: X402_ACK_DOMAIN_NAME, version: X402_ACK_DOMAIN_VERSION, chainId, verifyingContract: settler } as const;
}

export interface X402AckItem {
  payer: Address;
  nonce: Hex;
  /** true: settled by X402Settler (the operator's transaction, or the CallSettled event); false: consumed another way. */
  settled: boolean;
}

/** The body of POST /x402/settled: { enclave, productId, issuedAt, ackNonce, items, signature }. */
export interface X402AckBody {
  enclave: Address;
  productId: bigint;
  /** Unix seconds (the operator's clock). */
  issuedAt: bigint;
  /** 32 random bytes: single use. */
  ackNonce: Hex;
  items: X402AckItem[];
  /** The operator's EIP-712 signature (65 bytes). */
  signature: Hex;
}

export class X402AckFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402AckFormatError";
  }
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const SIG65 = /^0x[0-9a-fA-F]{130}$/;

/**
 * Reads the body without trusting any of it (shapes and sizes); throws X402AckFormatError. Every item must be well
 * formed: they are exactly what the signature covers.
 */
export function parseAckBody(x: unknown): X402AckBody {
  const bad = (m: string) => new X402AckFormatError(m);
  const b = x as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) throw bad("JSON object expected");
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > X402_ACK_MAX_ITEMS) {
    throw bad(`items: from 1 to ${X402_ACK_MAX_ITEMS} { payer, nonce, settled }`);
  }
  if (typeof b.enclave !== "string" || !isAddress(b.enclave, { strict: false })) throw bad("enclave: address expected");
  if (typeof b.productId !== "string" || !/^[0-9]{1,78}$/.test(b.productId)) throw bad("productId: decimal integer (string) expected");
  if (typeof b.issuedAt !== "number" || !Number.isSafeInteger(b.issuedAt) || b.issuedAt < 0) throw bad("issuedAt: Unix seconds expected");
  if (typeof b.ackNonce !== "string" || !HEX32.test(b.ackNonce)) throw bad("ackNonce: 32 hexadecimal bytes expected");
  if (typeof b.signature !== "string" || !SIG65.test(b.signature)) throw bad("signature: 65 hexadecimal bytes expected");
  const items: X402AckItem[] = [];
  for (const it of b.items) {
    const payer = (it as { payer?: unknown })?.payer;
    const nonce = (it as { nonce?: unknown })?.nonce;
    const settled = (it as { settled?: unknown })?.settled;
    if (
      typeof payer !== "string" || !isAddress(payer, { strict: false }) || typeof nonce !== "string" || !HEX32.test(nonce) ||
      typeof settled !== "boolean"
    ) {
      throw bad("each item: { payer: address, nonce: 32 bytes, settled: boolean }");
    }
    items.push({ payer: getAddress(payer.toLowerCase()), nonce: nonce.toLowerCase() as Hex, settled });
  }
  return {
    enclave: getAddress(b.enclave.toLowerCase()),
    productId: BigInt(b.productId),
    issuedAt: BigInt(b.issuedAt),
    ackNonce: b.ackNonce.toLowerCase() as Hex,
    items,
    signature: b.signature.toLowerCase() as Hex,
  };
}

/** The report's signer (null if the signature is unreadable). */
export async function recoverAckSigner(chainId: number, settler: Address, a: X402AckBody): Promise<Address | null> {
  try {
    return await recoverTypedDataAddress({
      domain: x402AckDomain(chainId, settler),
      types: x402AckTypes,
      primaryType: "X402Settled",
      message: { enclave: a.enclave, productId: a.productId, issuedAt: a.issuedAt, ackNonce: a.ackNonce, items: a.items },
      signature: a.signature,
    });
  } catch {
    return null;
  }
}

/** A token bucket (bounded rate), with an injectable clock (ms). */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly nowMs: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
    this.at = nowMs();
  }

  private refill(): void {
    const t = this.nowMs();
    if (t > this.at) {
      this.tokens = Math.min(this.capacity, this.tokens + ((t - this.at) / 1000) * this.perSecond);
      this.at = t;
    }
  }

  /** Whole tokens available now. */
  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /** Takes `n` tokens if they are there (otherwise nothing); returns true if taken. */
  take(n = 1): boolean {
    this.refill();
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** The ackNonce values already seen, kept until the end of their freshness window (beyond it, issuedAt alone refuses them). */
export class AckReplayGuard {
  private seen = new Map<string, bigint>();

  constructor(private readonly maxEntries = 10_000) {}

  private purge(now: bigint): void {
    for (const [k, until] of this.seen) if (until < now) this.seen.delete(k);
  }

  /** Already seen (and still inside its window)? */
  has(nonce: Hex, now: bigint): boolean {
    const until = this.seen.get(nonce.toLowerCase());
    return until !== undefined && until >= now;
  }

  /** Reserves this nonce until `until`; false if it is already taken, or if the memory is full (it fails closed). */
  claim(nonce: Hex, until: bigint, now: bigint): boolean {
    if (this.has(nonce, now)) return false;
    if (this.seen.size >= this.maxEntries) this.purge(now);
    if (this.seen.size >= this.maxEntries) return false;
    this.seen.set(nonce.toLowerCase(), until);
    return true;
  }

  get size(): number {
    return this.seen.size;
  }
}
