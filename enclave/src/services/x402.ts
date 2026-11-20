/**
 * x402.ts — the HTTP layer of the x402 protocol ("exact" scheme, adapted to ArcHive's settlement).
 *
 * Flow: the service answers `402 Payment Required` with the payment requirements; the client sends back an
 * `X-PAYMENT` header (base64) holding a signed EIP-3009 authorization; the facilitator verifies it, then settles
 * on-chain through `X402Settler.settle` (with the call receipt signed by the enclave).
 *
 * Adaptation: `payTo` = the X402Settler contract, which collects through `receiveWithAuthorization`
 * (`to == msg.sender`), splits, and requires the enclave's proof: payment + proof + split are atomic.
 *
 * v2.1 (the "inference paid per call" product, enclave/products/sealed-x402):
 *  - EXACT AMOUNT: X402Settler collects `units × price` and the EIP-3009 signature covers `value`: an authorization
 *    for another amount (more OR less) never settles. Strict equality is therefore required.
 *  - CANONICAL SIGNATURE: USDC (FiatToken) refuses a signature with a high `s` or a `v` ≠ 27/28, which viem accepts;
 *    a call paid that way would be served and then unpayable (free). 65 bytes, a low `s` and `v` = 27 or 28 are required.
 *  - NONCE BOUND TO THE REQUEST: the EIP-3009 nonce = a commitment to the encrypted request (callNonce). An X-PAYMENT
 *    header replayed on another request (a proxy, a replay) no longer matches: refused before any call to the model.
 *  - responseHash BOUND TO THE REQUEST (callResponseHash): the receipt goes on-chain at settlement; a bare hash of a
 *    short answer ("yes", "42") could be guessed. Mixed with the requestHash (a request salted by the client), it cannot.
 */
import { type Address, type Hex, encodeAbiParameters, getAddress, isAddress, keccak256, recoverTypedDataAddress, toBytes } from "viem";

export interface PaymentRequirements {
  scheme: "exact";
  network: string; // ex. "arc-testnet"
  maxAmountRequired: string; // atomic units (USDC, 6 decimals)
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address; // = X402Settler
  maxTimeoutSeconds: number;
  asset: Address; // USDC
  /** The token's EIP-712 domain (name, version); our extensions (product, enclave, nonce rule…) are added to it. */
  extra: { name: string; version: string; [k: string]: string };
}

export interface Challenge {
  x402Version: 1;
  error: string;
  accepts: PaymentRequirements[];
}

export interface Eip3009Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface PaymentPayload {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: { signature: Hex; authorization: Eip3009Authorization };
}

export interface ChallengeInput {
  network: string;
  amount: bigint;
  resource: string;
  description?: string;
  payTo: Address; // X402Settler
  asset: Address; // USDC
  usdcName: string; // "USDC"
  usdcVersion: string; // "2"
  maxTimeoutSeconds?: number;
  /** Our extensions, added to the token's domain in `extra` (x402 clients ignore what they do not know). */
  extra?: Record<string, string>;
  /** The x402 error code of the 402 (default "payment_required"). */
  error?: string;
}

export function buildChallenge(i: ChallengeInput): Challenge {
  return {
    x402Version: 1,
    error: i.error ?? "payment_required",
    accepts: [
      {
        scheme: "exact",
        network: i.network,
        maxAmountRequired: i.amount.toString(),
        resource: i.resource,
        description: i.description ?? "",
        mimeType: "application/json",
        payTo: i.payTo,
        maxTimeoutSeconds: i.maxTimeoutSeconds ?? 120,
        asset: i.asset,
        extra: { ...(i.extra ?? {}), name: i.usdcName, version: i.usdcVersion },
      },
    ],
  };
}

export function encodeXPayment(p: PaymentPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64");
}

export function decodeXPayment(header: string): PaymentPayload {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
}

const RECEIVE_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Signs the EIP-3009 authorization (client side). `signTypedData` is injected (no key here). */
export async function buildPayerAuthorization(
  signTypedData: (args: {
    domain: { name: string; version: string; chainId: number; verifyingContract: Address };
    types: typeof RECEIVE_TYPES;
    primaryType: "ReceiveWithAuthorization";
    message: Record<string, unknown>;
  }) => Promise<Hex>,
  req: PaymentRequirements,
  chainId: number,
  from: Address,
  nonce: Hex,
  validBefore: bigint,
  value: bigint = BigInt(req.maxAmountRequired),
): Promise<PaymentPayload> {
  const authorization: Eip3009Authorization = {
    from,
    to: req.payTo,
    value: value.toString(),
    validAfter: "0",
    validBefore: validBefore.toString(),
    nonce,
  };
  const signature = await signTypedData({
    domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: req.asset },
    types: RECEIVE_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from,
      to: req.payTo,
      value,
      validAfter: 0n,
      validBefore,
      nonce,
    },
  });
  return { x402Version: 1, scheme: "exact", network: req.network, payload: { signature, authorization } };
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/** A detailed result: `code` follows the x402 error codes when they exist; `reason` explains it in words. */
export type ExactVerifyResult = { ok: true } | { ok: false; code: string; reason: string };

export interface ExactVerifyOptions {
  /** The authorization must stay valid at least this long (s): the time the operator needs to settle. Default 0. */
  minRemainingSeconds?: bigint;
  /** The maximum accepted validity (s) from now; absent = no bound. */
  maxValiditySeconds?: bigint;
}

/** n/2 of secp256k1: above it, USDC (FiatToken's ECRecover) refuses the signature ("invalid signature 's' value"). */
const SECP256K1_HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

/**
 * What would make USDC refuse this EIP-3009 signature although viem accepts it, or null if it is canonical:
 * 65 bytes, r ≠ 0, 0 < s ≤ n/2, v = 27 or 28.
 */
export function eip3009SignatureProblem(sig: unknown): string | null {
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return "65-byte ECDSA signature expected (r ‖ s ‖ v)";
  const r = BigInt(`0x${sig.slice(2, 66)}`);
  const s = BigInt(`0x${sig.slice(66, 130)}`);
  const v = parseInt(sig.slice(130, 132), 16);
  if (r === 0n || s === 0n) return "signature nulle";
  if (s > SECP256K1_HALF_N) return "malleable signature (s in the upper half): USDC would refuse it at settlement";
  if (v !== 27 && v !== 28) return `byte v = ${v}: USDC requires 27 or 28`;
  return null;
}

/**
 * STRICT verification of an "exact" payment to X402Settler (without reading the chain): scheme, network, payTo, EXACT
 * amount, validity window, canonical signature and signer = `from`.
 */
export async function verifyExactPayment(
  p: PaymentPayload,
  req: PaymentRequirements,
  chainId: number,
  nowSeconds: bigint,
  o: ExactVerifyOptions = {},
): Promise<ExactVerifyResult> {
  const no = (code: string, reason: string): ExactVerifyResult => ({ ok: false, code, reason });
  if (p.x402Version !== 1) return no("invalid_x402_version", "x402 version 1 expected");
  if (p.scheme !== "exact" || req.scheme !== "exact") return no("unsupported_scheme", "\"exact\" scheme expected");
  if (p.network !== req.network) return no("invalid_network", `network "${req.network}" expected`);
  const a = p.payload.authorization;
  if (!isAddress(a.from, { strict: false }) || !isAddress(a.to, { strict: false })) return no("invalid_payload", "invalid addresses in the authorization");
  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) {
    return no("invalid_exact_evm_payload_recipient_mismatch", `the authorization must name X402Settler (${req.payTo}) as the recipient`);
  }
  const value = BigInt(a.value);
  const validAfter = BigInt(a.validAfter);
  const validBefore = BigInt(a.validBefore);
  if (value !== BigInt(req.maxAmountRequired)) {
    return no(
      "invalid_exact_evm_payload_authorization_value",
      `amount ${value} ≠ the ${req.maxAmountRequired} required (X402Settler collects exactly the price; any other amount does not settle)`,
    );
  }
  if (validAfter >= nowSeconds) return no("invalid_exact_evm_payload_authorization_valid_after", "authorization not valid yet (validAfter)");
  if (validBefore <= nowSeconds + (o.minRemainingSeconds ?? 0n)) {
    return no(
      "invalid_exact_evm_payload_authorization_valid_before",
      o.minRemainingSeconds
        ? `authorization expired or too short: it must stay valid at least ${o.minRemainingSeconds} s, the time of settlement`
        : "authorization expired",
    );
  }
  if (o.maxValiditySeconds !== undefined && validBefore > nowSeconds + o.maxValiditySeconds) {
    return no("authorization_validity_too_long", `authorization valid for too long: at most ${o.maxValiditySeconds} s`);
  }
  const problem = eip3009SignatureProblem(p.payload.signature);
  if (problem) return no("invalid_exact_evm_payload_signature", problem);

  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({
      domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: req.asset },
      types: RECEIVE_TYPES,
      primaryType: "ReceiveWithAuthorization",
      message: { from: a.from, to: a.to, value, validAfter, validBefore, nonce: a.nonce },
      signature: p.payload.signature,
    });
  } catch {
    return no("invalid_exact_evm_payload_signature", "unreadable EIP-3009 signature");
  }
  if (signer.toLowerCase() !== a.from.toLowerCase()) {
    return no("invalid_exact_evm_payload_signature", "EIP-3009 signature that is not the payer's (from)");
  }
  return { ok: true };
}

const LEGACY_REASONS: Record<string, string> = {
  invalid_x402_version: "scheme/network",
  unsupported_scheme: "scheme/network",
  invalid_network: "scheme/network",
  invalid_exact_evm_payload_recipient_mismatch: "payTo",
  invalid_exact_evm_payload_authorization_value: "amount",
  invalid_exact_evm_payload_authorization_valid_after: "not valid yet",
  invalid_exact_evm_payload_authorization_valid_before: "expired",
  invalid_exact_evm_payload_signature: "signature",
};

/**
 * Verifies the structure, the amount (EXACT, v2.1), the freshness and the EIP-3009 signature (facilitator).
 * A short reason ("amount", "payTo", "expired", "signature"…).
 */
export async function facilitatorVerify(
  p: PaymentPayload,
  req: PaymentRequirements,
  chainId: number,
  nowSeconds: bigint,
): Promise<VerifyResult> {
  const r = await verifyExactPayment(p, req, chainId, nowSeconds);
  if (r.ok) return { ok: true };
  return { ok: false, reason: LEGACY_REASONS[r.code] ?? r.reason };
}

/** Hands the on-chain settlement to a client (which calls X402Settler.settle with the enclave's receipt). */
export interface SettlerClient {
  settleCall(
    callReceipt: unknown,
    enclaveSig: Hex,
    auth: { validAfter: bigint; validBefore: bigint; nonce: Hex; signature: Hex },
  ): Promise<Hex>;
}

export function authFromPayload(p: PaymentPayload): {
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  signature: Hex;
} {
  const a = p.payload.authorization;
  return {
    validAfter: BigInt(a.validAfter),
    validBefore: BigInt(a.validBefore),
    nonce: a.nonce,
    signature: p.payload.signature,
  };
}

// ---------------------------------------------------------------- v2.1: the paid call (sealed-x402 product)

/** Billed units per call: one call costs Product.price × 1 (X402Settler: amount = units × price). */
export const X402_UNITS_PER_CALL = 1n;

/** The label of the nonce commitment (callNonce): changing the construction means changing the label. */
export const X402_CALL_TAG = "ARC-X402-CALL-v1";

/** The maximum accepted length of the X-PAYMENT header (base64). */
export const MAX_X_PAYMENT_LENGTH = 4096;

/** The x402 network name of an Arc chain. */
export function x402NetworkName(chainId: number): string {
  if (chainId === 5042002) return "arc-testnet";
  if (chainId === 5042) return "arc";
  return `eip155:${chainId}`;
}

/** The encrypted request of a call (HPKE to the enclave's X25519 key; the answer is encrypted to clientEphemeralPub). */
export interface CallEnvelope {
  enc: Hex;
  ciphertext: Hex;
  clientEphemeralPub: Hex; // 32 bytes
}

/**
 * The EIP-3009 nonce of an x402 call = a commitment to the encrypted request, for THIS enclave, this product, this
 * settlement contract and this chain:
 *   keccak256(abi.encode("ARC-X402-CALL-v1", chainId, x402Settler, productId, enclave, keccak256(enc),
 *                        keccak256(ciphertext), clientEphemeralPub))
 * The same X-PAYMENT header therefore pays only ONE request; replayed on another one (or on a request modified on the
 * way), it is refused before any call to the model. The SDK computes exactly the same value (packages/sdk/src/x402.ts).
 */
export function callNonce(
  i: { chainId: number | bigint; settler: Address; productId: bigint; enclave: Address } & CallEnvelope,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [X402_CALL_TAG, BigInt(i.chainId), i.settler, i.productId, i.enclave, keccak256(i.enc), keccak256(i.ciphertext), i.clientEphemeralPub],
    ),
  );
}

/** The responseHash of an x402 call = keccak256(abi.encode(requestHash, keccak256(UTF-8 text))): bound to the request. */
export function callResponseHash(requestHash: Hex, text: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [requestHash, keccak256(toBytes(text))]));
}

/** An unreadable X-PAYMENT header: an x402 `code` and a reason. */
export class X402PayloadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "X402PayloadError";
  }
}

const DEC = /^[0-9]{1,78}$/;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

/**
 * Decodes and VALIDATES the X-PAYMENT header (base64 of an x402 v1 JSON, "exact" scheme) without trusting any of it:
 * bounded sizes, addresses, decimal integers, a 32-byte nonce. Throws X402PayloadError.
 */
export function parseXPayment(header: string): PaymentPayload {
  if (typeof header !== "string" || header.length === 0 || header.length > MAX_X_PAYMENT_LENGTH) {
    throw new X402PayloadError("invalid_payload", `X-PAYMENT header missing or too long (at most ${MAX_X_PAYMENT_LENGTH} characters)`);
  }
  if (!/^[A-Za-z0-9+/=_-]+$/.test(header.trim())) throw new X402PayloadError("invalid_payload", "X-PAYMENT header: base64 expected");
  let j: any;
  try {
    j = JSON.parse(Buffer.from(header.trim(), "base64").toString("utf8"));
  } catch {
    throw new X402PayloadError("invalid_payload", "X-PAYMENT header: unreadable JSON");
  }
  if (!j || typeof j !== "object") throw new X402PayloadError("invalid_payload", "X-PAYMENT header: object expected");
  if (j.x402Version !== 1) throw new X402PayloadError("invalid_x402_version", "x402Version 1 expected");
  if (j.scheme !== "exact") throw new X402PayloadError("unsupported_scheme", "\"exact\" scheme expected");
  if (typeof j.network !== "string" || j.network.length > 64) throw new X402PayloadError("invalid_network", "unreadable network");
  const sig = j.payload?.signature;
  const a = j.payload?.authorization;
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{2,1024}$/.test(sig)) throw new X402PayloadError("invalid_payload", "unreadable signature");
  if (!a || typeof a !== "object") throw new X402PayloadError("invalid_payload", "authorization missing");
  if (typeof a.from !== "string" || !isAddress(a.from, { strict: false })) throw new X402PayloadError("invalid_payload", "from: invalid address");
  if (typeof a.to !== "string" || !isAddress(a.to, { strict: false })) throw new X402PayloadError("invalid_payload", "to: invalid address");
  for (const k of ["value", "validAfter", "validBefore"] as const) {
    if (typeof a[k] !== "string" || !DEC.test(a[k])) throw new X402PayloadError("invalid_payload", `${k}: decimal integer expected`);
  }
  if (typeof a.nonce !== "string" || !HEX32.test(a.nonce)) throw new X402PayloadError("invalid_payload", "nonce: 32 hexadecimal bytes expected");
  return {
    x402Version: 1,
    scheme: "exact",
    network: j.network,
    payload: {
      signature: sig.toLowerCase() as Hex,
      authorization: {
        from: getAddress(a.from.toLowerCase()),
        to: getAddress(a.to.toLowerCase()),
        value: a.value,
        validAfter: a.validAfter,
        validBefore: a.validBefore,
        nonce: a.nonce.toLowerCase() as Hex,
      },
    },
  };
}
