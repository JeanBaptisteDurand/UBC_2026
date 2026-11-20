/** x402.ts — private inference paid PER CALL (the x402 rail, "exact" scheme): no session, one call = one encrypted
 *  request + an EIP-3009 authorization for the exact amount, settled afterwards by X402Settler.settle on the enclave's
 *  receipt.
 *
 *  Client (createX402Client):
 *   1. checks the enclave's key on the chain (verifyEnclaveKeys: registered X25519 key, enclave active for the product);
 *   2. reads the product on-chain: settled by X402Settler, active, price of a call (Product.price × 1);
 *   3. encrypts the (salted) request to the VERIFIED key; the EIP-3009 nonce = a commitment to this request
 *      (x402CallNonce);
 *   4. handles the 402: the enclave's requirements are CHECKED against the chain (payTo = the deployment's X402Settler,
 *      asset = USDC, amount = the on-chain price); a proxy that diverts the payment or inflates the price is refused and
 *      nothing is signed; then it signs the authorization (the USDC EIP-712 domain comes from the deployment, not from
 *      the 402);
 *   5. verifies the receipt: signed by the verified enclave, for this product, this payer, this nonce, one unit, the hash
 *      of the request sent and that of the text received (bound to the request); otherwise the text is not returned;
 *      `settleable` says whether X402Settler.settle would accept this receipt (enclave active at the anchor block).
 *  After the paid send: an answer arrives through a proxy (the site's proxy, a CDN, the Phala gateway) that could keep
 *  it and return something else. So:
 *   - ANY failure (any 402, 409, 429, 5xx, timeout, cut connection, an answer that does not verify) first resends the
 *     IDENTICAL request (same envelope, same authorization) a few times with a delay: the enclave is idempotent and
 *     returns the kept answer if the call was served, with no second call and no second receipt;
 *   - a NEW authorization is signed only if the price READ ON-CHAIN really changed (never on the word of an
 *     unauthenticated 402), and for the SAME request: same EIP-3009 nonce, so at most ONE of the authorizations can be
 *     used on-chain (a 409 "nonce_reused" then says which one the enclave served: the client resends it);
 *   - NEVER AT A HIGHER PRICE without explicit consent: the call's cap (maxPrice) is the price read at the start of the
 *     call; a price raised above it gives X402ChallengeError (before any payment, nothing is signed) or
 *     X402PaidCallError "price_increased" (after), with `newPrice`; to accept it:
 *     client.resume(err.pending, { renew: true, maxPrice: err.newPrice }). A LOWER price is signed on its own (cheaper);
 *   - if nothing succeeds: X402PaidCallError. It NEVER says "nothing is owed" (the call MAY have been served and MAY be
 *     settled) and carries the envelope, the ephemeral key and the authorizations: client.resume(err.pending) resumes
 *     (same request), client.cancelAuthorization(err.pending) cancels on-chain (USDC.cancelAuthorization) as long as
 *     nothing is settled. After an enclave restart (code "enclave_changed"), the answer is LOST: the message no longer
 *     suggests resume, it says the payment may have been settled anyway.
 *  Settlement is done by the operator (X402SettlementQueue, services/registrar); the payer can also settle (settle):
 *  the contract only pays the enclave's active operator, the author and the network. The registrar tells the enclave
 *  what was used by a message SIGNED with the operator's key (EIP-712, x402AckTypes), saying for each call whether it
 *  was SETTLED by X402Settler (its transaction's receipt, or a CallSettled event) or used otherwise (cancelled): only a
 *  settlement makes the payer "known" to the enclave. It reads the whole queue page by page, settles first the calls
 *  their payer's balance covers, and checks again only a bounded number of "uncovered" calls per pass.
 *
 *  These constructions must stay identical to the enclave's (enclave/src/services/x402.ts): a cross test checks them
 *  (enclave/test/x402-e2e.test.ts). */
import {
  type Account, type Address, type Hex, type PublicClient, type TypedDataDomain, type WalletClient,
  encodeAbiParameters, getAddress, isAddress, keccak256, parseAbi, parseAbiItem, publicActions, recoverTypedDataAddress, toBytes, toHex,
  zeroAddress,
} from "viem";
import { arcErrorsAbi, enclaveRegistryAbi, productRegistryAbi, x402Abi } from "./abis";
import { networkDomain, testnet, usdcDomain, type Deployment } from "./network";
import { verifyEnclaveKeys, type VerifiedEnclaveKeys } from "./enclave-keys";
import { generateX25519, hpkeOpen, hpkeSeal } from "./crypto";
import { freshNonce, receiveWithAuthorizationTypes } from "./usdc";
import type { ChatRequest } from "./inference";
import { explainArcError } from "./errors";

// ---------------------------------------------------------------- the protocol (identical to the enclave's)

/** Units billed per call: a call costs Product.price × 1 (X402Settler: amount = units × price). */
export const X402_UNITS_PER_CALL = 1n;
/** Label of the nonce commitment. */
export const X402_CALL_TAG = "ARC-X402-CALL-v1";
/** Longest validity of an authorization this client signs (s): 1 h. */
export const X402_MAX_VALIDITY_SECONDS = 3600;
/** x402 code of the 402 "authorization amount ≠ price" (the on-chain price may have changed). */
export const X402_PRICE_CHANGED = "invalid_exact_evm_payload_authorization_value";
/** Delays (ms) of the identical resends after a paid send with no verified answer: 3 resends. */
export const X402_PAID_RETRY_DELAYS_MS: readonly number[] = [300, 1000, 2500];
/** At most this many new authorizations (on-chain price changed) for one request. */
export const X402_MAX_REAUTHORIZATIONS = 2;

/** Arc's USDC: what the x402 rail reads on top of ERC-20 (EIP-3009). */
export const usdcAuthAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

/** USDC (FiatToken v2.2, EIP-3009): cancelling an authorization not used yet, in two variants (v, r, s; bytes).
 *  receiveWithAuthorization (bytes form) and authorizationState are confirmed on Arc's USDC. cancelAuthorization comes
 *  from the same FiatToken v2.2 family and is not confirmed there yet, so the client tries (v, r, s), then bytes,
 *  simulating first. */
export const usdcCancelAbi = parseAbi([
  "function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function cancelAuthorization(address authorizer, bytes32 nonce, bytes signature)",
]);

/** EIP-3009: the message the payer signs to cancel their authorization (the USDC's EIP-712 domain). */
export const cancelAuthorizationTypes = {
  CancelAuthorization: [
    { name: "authorizer", type: "address" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// ---------------------------------------------------------------- the operator's report to the enclave (POST /x402/settled)

/** At most this many items per report (the enclave refuses more). */
export const X402_ACK_MAX_ITEMS = 200;

/** The "calls used on-chain" report, signed by the operator: identical to enclave/src/services/x402-ack.ts.
 *  `settled`: true = settled by X402Settler (the receipt of the operator's transaction, or a CallSettled event);
 *  false = used otherwise (cancelled by the payer). Only true makes the payer "known" to the enclave. */
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

/** EIP-712 domain of the report (distinct from the receipts' domain): the deployment's chain and X402Settler. Version 2
 *  since `settled` was added. */
export function x402AckDomain(settler: Address, chainId: number): TypedDataDomain {
  return { name: "ArcEnclaveNetwork x402 ack", version: "2", chainId, verifyingContract: settler };
}

/** A reported call: used on-chain, and settled by X402Settler (`settled`) or not. */
export interface X402AckItem { payer: Address; nonce: Hex; settled: boolean }

export interface X402AckMessage {
  enclave: Address;
  productId: bigint;
  issuedAt: bigint;
  ackNonce: Hex;
  items: X402AckItem[];
}

/** Body of POST /x402/settled for a signed message. */
export function x402AckBody(m: X402AckMessage, signature: Hex) {
  return {
    enclave: m.enclave, productId: m.productId.toString(), issuedAt: Number(m.issuedAt), ackNonce: m.ackNonce,
    items: m.items.map((i) => ({ payer: i.payer, nonce: i.nonce, settled: i.settled })), signature,
  };
}

/** The X402Settler.settle event: the payer really paid this call (nonce in the data). */
export const callSettledEvent = parseAbiItem(
  "event CallSettled(uint256 indexed productId, address indexed payer, address indexed operator, uint256 amount, bytes32 nonce)",
);

/** x402 network name of an Arc chain. */
export function x402NetworkName(chainId: number): string {
  if (chainId === 5042002) return "arc-testnet";
  if (chainId === 5042) return "arc";
  return `eip155:${chainId}`;
}

/** The EIP-3009 nonce of a call = keccak256(abi.encode("ARC-X402-CALL-v1", chainId, x402Settler, productId, enclave,
 *  keccak256(enc), keccak256(ciphertext), clientEphemeralPub)): one payment pays for ONE request, to one enclave. */
export function x402CallNonce(i: {
  chainId: number | bigint; settler: Address; productId: bigint; enclave: Address; enc: Hex; ciphertext: Hex; clientEphemeralPub: Hex;
}): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
    ],
    [X402_CALL_TAG, BigInt(i.chainId), i.settler, i.productId, i.enclave, keccak256(i.enc), keccak256(i.ciphertext), i.clientEphemeralPub],
  ));
}

/** responseHash of a call = keccak256(abi.encode(requestHash, keccak256(UTF-8 text))): bound to the (salted) request. */
export function x402ResponseHash(requestHash: Hex, text: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [requestHash, keccak256(toBytes(text))]));
}

/** The receipt of a call (X402Settler.CallReceipt), signed by the enclave in X402Settler's EIP-712 domain. */
export const callReceiptTypes = {
  CallReceipt: [
    { name: "productId", type: "uint256" }, { name: "payer", type: "address" }, { name: "requestHash", type: "bytes32" },
    { name: "responseHash", type: "bytes32" }, { name: "units", type: "uint128" }, { name: "anchorBlock", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface CallReceipt {
  productId: bigint; payer: Address; requestHash: Hex; responseHash: Hex; units: bigint; anchorBlock: bigint;
  /** = the nonce of the payer's EIP-3009 authorization (binds payment and receipt). */
  nonce: Hex;
}

export async function recoverCallReceiptSigner(x402Settler: Address, cr: CallReceipt, signature: Hex, chainId?: number): Promise<Address> {
  return recoverTypedDataAddress({
    domain: networkDomain(x402Settler, chainId) as TypedDataDomain,
    types: callReceiptTypes, primaryType: "CallReceipt", message: cr, signature,
  });
}

const MAX_U64 = 2n ** 64n - 1n;
const MAX_U128 = 2n ** 128n - 1n;
const MAX_U256 = 2n ** 256n - 1n;
const lower = (x: string) => x.toLowerCase();

function dec(x: unknown, name: string, max: bigint): bigint {
  if (typeof x !== "string" || !/^[0-9]{1,78}$/.test(x) || BigInt(x) > max) throw new Error(`${name}: decimal integer expected`);
  return BigInt(x);
}
function hex32(x: unknown, name: string): Hex {
  if (typeof x !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(x)) throw new Error(`${name}: 32 hex bytes expected`);
  return lower(x) as Hex;
}
function sig65(x: unknown, name: string): Hex {
  if (typeof x !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(x)) throw new Error(`${name}: 65-byte signature expected`);
  return lower(x) as Hex;
}

/** A call receipt received as JSON (decimal strings, as the enclave returns it) → SDK types; throws if unreadable. */
export function normalizeCallReceipt(j: any): CallReceipt {
  if (!j || typeof j !== "object") throw new Error("call receipt missing");
  if (typeof j.payer !== "string" || !isAddress(j.payer, { strict: false })) throw new Error("payer: address expected");
  return {
    productId: dec(j.productId, "productId", MAX_U256), payer: getAddress(lower(j.payer)), requestHash: hex32(j.requestHash, "requestHash"),
    responseHash: hex32(j.responseHash, "responseHash"), units: dec(j.units, "units", MAX_U128), anchorBlock: dec(j.anchorBlock, "anchorBlock", MAX_U64),
    nonce: hex32(j.nonce, "nonce"),
  };
}

export function serializeCallReceipt(cr: CallReceipt): Record<string, string> {
  return {
    productId: cr.productId.toString(), payer: cr.payer, requestHash: cr.requestHash, responseHash: cr.responseHash,
    units: cr.units.toString(), anchorBlock: cr.anchorBlock.toString(), nonce: cr.nonce,
  };
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** ECDSA signature made canonical for the USDC (FiatToken): v = 27/28 (some wallets return 0/1), s in the lower half
 *  (otherwise the USDC refuses it). Same signer. Throws for a signature that is not a 65-byte ECDSA one. */
export function normalizeEcdsaSignature(sig: Hex): Hex {
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) {
    throw new Error("expected a 65-byte ECDSA signature: this rail accepts EOA payers");
  }
  const r = sig.slice(2, 66);
  let s = BigInt(`0x${sig.slice(66, 130)}`);
  let v = parseInt(sig.slice(130, 132), 16);
  if (v < 27) v += 27;
  if (v !== 27 && v !== 28) throw new Error(`unexpected signature v byte (${v})`);
  if (s > SECP256K1_N / 2n) {
    s = SECP256K1_N - s;
    v = v === 27 ? 28 : 27;
  }
  return lower(`0x${r}${s.toString(16).padStart(64, "0")}${v.toString(16)}`) as Hex;
}

/** What would stop the USDC from accepting this signature (null if canonical). */
export function eip3009SignatureProblem(sig: unknown): string | null {
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return "65-byte ECDSA signature expected";
  const s = BigInt(`0x${sig.slice(66, 130)}`);
  const v = parseInt(sig.slice(130, 132), 16);
  if (BigInt(`0x${sig.slice(2, 66)}`) === 0n || s === 0n) return "zero signature";
  if (s > SECP256K1_N / 2n) return "high-s signature (refused by USDC)";
  if (v !== 27 && v !== 28) return "v byte ≠ 27/28 (refused by USDC)";
  return null;
}

// ---------------------------------------------------------------- formats x402

export interface X402PaymentRequirements {
  scheme: "exact"; network: string; maxAmountRequired: string; resource?: string; description?: string; mimeType?: string;
  payTo: Address; maxTimeoutSeconds?: number; asset: Address; extra?: Record<string, unknown>;
}

export interface X402PaymentPayload {
  x402Version: 1; scheme: "exact"; network: string;
  payload: { signature: Hex; authorization: { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex } };
}

/** The EIP-3009 authorization signed by the payer (ReceiveWithAuthorization to X402Settler). */
export interface X402Authorization {
  from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex; signature: Hex;
}

/** X-PAYMENT header: base64 of the JSON (ASCII only: hex and decimals). */
export function encodeXPaymentHeader(p: X402PaymentPayload): string {
  return btoa(JSON.stringify(p));
}

export function paymentPayloadOf(a: X402Authorization, network: string): X402PaymentPayload {
  return {
    x402Version: 1, scheme: "exact", network,
    payload: {
      signature: a.signature,
      authorization: {
        from: a.from, to: a.to, value: a.value.toString(), validAfter: a.validAfter.toString(), validBefore: a.validBefore.toString(), nonce: a.nonce,
      },
    },
  };
}

// ---------------------------------------------------------------- erreurs

/** The enclave's 402 does not match the chain (payTo, asset, amount) or the client's cap: NOTHING is signed.
 *  `price`: the on-chain price ROSE since the call started (`newPrice`); calling again accepts it. */
export class X402ChallengeError extends Error {
  constructor(
    message: string,
    readonly reason: "amount" | "payTo" | "asset" | "network" | "product" | "cap" | "price" | "format" = "format",
    /** New on-chain price of a call (reason "price"). */
    readonly newPrice?: bigint,
  ) {
    super(`x402 payment refused by the client: ${message}`);
    this.name = "X402ChallengeError";
  }
}
/** Payment refused (402) by the enclave. The client no longer throws it: a 402 received AFTER the paid send is not
 *  authenticated (a proxy can write it after the enclave served the call) → X402PaidCallError. Kept for the API. */
export class X402PaymentRefusedError extends Error {
  constructor(readonly code: string, readonly detail: string) {
    super(`payment refused by the enclave (${code})${detail ? ` : ${detail}` : ""}`);
    this.name = "X402PaymentRefusedError";
  }
}
/** The answer does not come from the verified enclave, or not for THIS request and THIS payment: the text is not
 *  returned. After the paid send it is not thrown on its own: it becomes the `cause` of an X402PaidCallError. */
export class X402ReceiptMismatchError extends Error {
  constructor(message: string) { super(`answer refused: ${message}`); this.name = "X402ReceiptMismatchError"; }
}
/** Failure BEFORE any paid send (probe without X-PAYMENT: 503, 429, 409, 413, 502, 504…): nothing was signed, nothing
 *  is owed. After a paid send, the client throws X402PaidCallError, never this one. */
export class X402CallError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "X402CallError"; }
}

/** A PAID call (X-PAYMENT sent) left with no verified answer: everything needed to resume or cancel it. */
export interface X402PaidRequest {
  /** URL of the gateway used (for information: a resume goes through the client's own). */
  enclaveUrl: string;
  productId: bigint;
  payer: Address;
  /** Signer of the enclave VERIFIED on-chain that the request is encrypted to (it will sign the receipt). */
  enclave: Address;
  /** The encrypted request, as sent (its commitment is the nonce). */
  envelope: { enc: Hex; ciphertext: Hex; clientEphemeralPub: Hex };
  /** Ephemeral X25519 private key (32 bytes): the ONLY one that opens the answer. Secret: never log it. */
  ephemeralPrivateKey: Hex;
  /** keccak256 of the plaintext (salted) request. */
  requestHash: Hex;
  /** EIP-3009 nonce = a commitment to this request, SHARED by every authorization below. */
  nonce: Hex;
  /** The last authorization sent. */
  authorization: X402Authorization;
  /** Every authorization signed for this request (same nonce: at most ONE can be used on-chain). */
  authorizations: X402Authorization[];
  /** The x402 requirements checked against the chain (network, payTo, asset, announced validity). */
  requirement: X402PaymentRequirements;
  /** Cap on a call accepted for THIS request: above it, no authorization is signed without explicit consent
   *  (resume(…, { maxPrice })). Default: the price read at the start of the call (that of the first authorization). */
  maxPrice?: bigint;
}

/** The cap of a paid request: `maxPrice`, otherwise the amount of its first authorization (the price at the call's start). */
function priceCeilingOf(p: X402PaidRequest): bigint {
  return p.maxPrice ?? p.authorizations[0]?.value ?? p.authorization.value;
}

/**
 * An X-PAYMENT was sent and no verified answer came back (after the identical resends). The enclave MAY have served
 * this call and the operator MAY settle it: nothing allows saying that nothing is owed. `pending` (not enumerable: it
 * holds the ephemeral key) is used to resume (client.resume) or to cancel (client.cancelAuthorization). `status`,
 * `code` and `serverDetail` come from the last answer and are NOT authenticated (a proxy can write them).
 * Client codes: "enclave_changed" (the enclave restarted: the answer is lost, resuming is useless), "price_increased"
 * (the on-chain price rose above the call's cap: `newPrice`, to accept explicitly), "price_above_cap" (above the
 * client's cap, maxAmount).
 */
export class X402PaidCallError extends Error {
  readonly paid = true as const;
  declare readonly pending: X402PaidRequest;
  constructor(
    /** Last HTTP status (0: no answer, a timeout or a cut connection). */
    readonly status: number,
    /** Last code ("timeout", "network_error", "receipt_mismatch", or the server's, not authenticated). */
    readonly code: string,
    pending: X402PaidRequest,
    /** Sends of the paid request (resends included). */
    readonly attempts: number,
    /** The server's text, NOT authenticated: never show it as a fact. */
    readonly serverDetail?: string,
    cause?: unknown,
    /** Price of a call read ON-CHAIN above the call's cap (code "price_increased"): nothing was signed at that
     *  price. To accept it: client.resume(err.pending, { renew: true, maxPrice: err.newPrice }). */
    readonly newPrice?: bigint,
  ) {
    const a = pending.authorization;
    const max = pending.authorizations.reduce((m, x) => (x.value > m ? x.value : m), 0n);
    const until = new Date(Number(a.validBefore) * 1000).toISOString();
    const head = `x402 call paid, with no verified answer after ${attempts} send(s) of the same request (last: ${code}${status ? `, HTTP ${status}` : ""}). `;
    const due = `at most ${formatUsdc(max)} USDC, once: same nonce ${pending.nonce.slice(0, 10)}…, authorization valid until ${until}`;
    let message: string;
    if (code === "enclave_changed") {
      // the answer lived in the enclave's memory: a restart erased it
      message =
        `x402 call paid whose answer is LOST: the enclave restarted (new key), and the answer it kept in memory went with it. ` +
        `The payment MAY still have been settled (the operator collects calls before a restart): ${due}. ` +
        `To find out: USDC.authorizationState(payer, nonce) on-chain. While nothing is settled, client.cancelAuthorization(err.pending) cancels it; ` +
        `a resume will not bring this answer back.`;
    } else if (code === "price_increased" && newPrice !== undefined) {
      message =
        head +
        `The on-chain price of a call rose to ${formatUsdc(newPrice)} USDC, above the ceiling of this call (${formatUsdc(priceCeilingOf(pending))} USDC): ` +
        `nothing was signed at this price. The enclave MAY have served this call under the authorization already sent (${due}): ` +
        `client.resume(err.pending) resends it as is (the enclave returns the answer if it served it). To accept the new price: ` +
        `client.resume(err.pending, { renew: true, maxPrice: err.newPrice }); otherwise, cancel while nothing is settled: client.cancelAuthorization(err.pending).`;
    } else {
      message =
        head +
        `The enclave MAY have served this call and the operator MAY settle it (${due}). To resume: client.resume(err.pending) ` +
        `(same request, same authorization: no second charge; the enclave keeps the answer only until ${until}, and only if it does not ` +
        `restart); to cancel while nothing is settled: client.cancelAuthorization(err.pending).`;
    }
    super(message, cause === undefined ? undefined : { cause });
    this.name = "X402PaidCallError";
    Object.defineProperty(this, "pending", { value: pending, enumerable: false, writable: false });
  }
}

function formatUsdc(v: bigint): string {
  const s = v.toString().padStart(7, "0");
  return `${s.slice(0, -6)},${s.slice(-6)}`.replace(/,?0+$/, "") || "0";
}

/** X402PaidRequest → JSON (integers as strings), to resume later. It holds the ephemeral key: keep it secret. */
export function serializeX402PaidRequest(p: X402PaidRequest): string {
  const a = (x: X402Authorization) => ({
    from: x.from, to: x.to, value: x.value.toString(), validAfter: x.validAfter.toString(), validBefore: x.validBefore.toString(), nonce: x.nonce, signature: x.signature,
  });
  return JSON.stringify({
    v: 1, enclaveUrl: p.enclaveUrl, productId: p.productId.toString(), payer: p.payer, enclave: p.enclave, envelope: p.envelope,
    ephemeralPrivateKey: p.ephemeralPrivateKey, requestHash: p.requestHash, nonce: p.nonce, authorization: a(p.authorization),
    authorizations: p.authorizations.map(a), requirement: p.requirement,
    ...(p.maxPrice !== undefined ? { maxPrice: p.maxPrice.toString() } : {}),
  });
}

/** The inverse of serializeX402PaidRequest (throws if unreadable). */
export function parseX402PaidRequest(json: string): X402PaidRequest {
  const j = JSON.parse(json);
  if (!j || j.v !== 1) throw new Error("unreadable paid call (version 1 expected)");
  const addr = (x: unknown, n: string): Address => {
    if (typeof x !== "string" || !isAddress(x, { strict: false })) throw new Error(`${n}: address expected`);
    return getAddress(lower(x));
  };
  const hex = (x: unknown, n: string, bytes?: number): Hex => {
    if (typeof x !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(x) || (bytes !== undefined && x.length !== 2 + 2 * bytes)) throw new Error(`${n}: hex expected`);
    return lower(x) as Hex;
  };
  const auth = (x: any, n: string): X402Authorization => ({
    from: addr(x?.from, `${n}.from`), to: addr(x?.to, `${n}.to`), value: dec(x?.value, `${n}.value`, MAX_U256),
    validAfter: dec(x?.validAfter, `${n}.validAfter`, MAX_U256), validBefore: dec(x?.validBefore, `${n}.validBefore`, MAX_U256),
    nonce: hex32(x?.nonce, `${n}.nonce`), signature: sig65(x?.signature, `${n}.signature`),
  });
  if (!Array.isArray(j.authorizations) || j.authorizations.length === 0) throw new Error("authorizations: at least one");
  const r = j.requirement;
  if (!r || typeof r !== "object" || typeof r.network !== "string") throw new Error("requirement illisible");
  return {
    enclaveUrl: String(j.enclaveUrl ?? ""), productId: dec(j.productId, "productId", MAX_U256), payer: addr(j.payer, "payer"),
    enclave: addr(j.enclave, "enclave"),
    envelope: { enc: hex(j.envelope?.enc, "enc", 32), ciphertext: hex(j.envelope?.ciphertext, "ciphertext"), clientEphemeralPub: hex(j.envelope?.clientEphemeralPub, "clientEphemeralPub", 32) },
    ephemeralPrivateKey: hex(j.ephemeralPrivateKey, "ephemeralPrivateKey", 32), requestHash: hex32(j.requestHash, "requestHash"),
    nonce: hex32(j.nonce, "nonce"), authorization: auth(j.authorization, "authorization"),
    authorizations: (j.authorizations as unknown[]).map((x, i) => auth(x, `authorizations[${i}]`)), requirement: r as X402PaymentRequirements,
    ...(j.maxPrice !== undefined ? { maxPrice: dec(j.maxPrice, "maxPrice", MAX_U256) } : {}),
  };
}

// ---------------------------------------------------------------- the client

export interface X402ClientOptions {
  /** The gateway of the x402 product, direct or behind a proxy: its keys are verified on-chain. */
  enclaveUrl: string;
  /** The product paid per call (settled by X402Settler). */
  productId: bigint;
  /** The payer's wallet: it signs the EIP-3009 authorization (no transaction to pay). */
  walletClient: WalletClient;
  account?: Account;
  /** On-chain reads (default: the walletClient extended with the public actions). */
  publicClient?: PublicClient;
  deployment?: Deployment;
  fetch?: typeof fetch;
  /** Verify the enclave's keys on-chain again at the latest after this delay (ms, default 5 min). */
  reverifyMs?: number;
  /** Cap per call (USDC base units): above it, nothing is signed. */
  maxAmount?: bigint;
  /** Wanted validity of the authorization (s); default: the one the 402 announces; always bounded to [60 s, 1 h]. */
  validitySeconds?: number;
  /** If given: the product must pin this model (Product.param = keccak256 of its id). */
  expectedModel?: string;
  /** Timeout of an HTTP request (ms, default 180,000). */
  timeoutMs?: number;
  /** After a paid send with no verified answer: delays (ms) of the resends of the IDENTICAL request (default 300, 1,000,
   *  2,500: three resends). [] = no resend (resume still works). */
  paidRetryDelaysMs?: readonly number[];
}

export interface X402ProductInfo {
  id: bigint; price: bigint; pricePerCall: bigint; settlement: Address; param: Hex; active: boolean; author: Address;
}

export interface X402Completion {
  text: string;
  receipt: CallReceipt;
  /** The enclave's EIP-712 signature of the receipt (X402Settler domain). */
  signature: Hex;
  /** The enclave verified on-chain that signed. */
  signer: Address;
  /** The enclave's active operator at the anchor block (zero address: the receipt cannot be settled). */
  operator: Address;
  /** What the payer authorized (USDC, 6 decimals): taken at settlement. */
  amount: bigint;
  authorization: X402Authorization;
  /** keccak256 of the plaintext request sent (salted JSON). */
  requestHash: Hex;
  /** X402Settler.settle would accept this receipt (enclave active at the anchor block). */
  settleable: boolean;
  /** Reading the active operator failed (RPC): `settleable` is unknown (the text is verified anyway). */
  settleableUnknown?: true;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** True if the enclave returned the answer it had already served for this request (idempotent resume). */
  replay: boolean;
}

export class X402Client {
  readonly d: Deployment;
  readonly pub: PublicClient;
  private keys?: VerifiedEnclaveKeys;
  private readonly f: typeof fetch;
  private readonly account: Account;

  constructor(private o: X402ClientOptions) {
    this.d = o.deployment ?? testnet;
    // called as a function, never as a method: in a browser, fetch called with `this` = this client throws
    // "Illegal invocation" (Node accepts it, so the tests did not catch it; a browser check did)
    this.f = o.fetch ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => globalThis.fetch(input, init));
    const account = o.account ?? o.walletClient.account;
    if (!account) throw new Error("x402 : walletClient sans compte (passer `account`)");
    this.account = account;
    this.pub = o.publicClient ?? (o.walletClient.extend(publicActions) as unknown as PublicClient);
    if (!this.d.x402Settler || lower(this.d.x402Settler) === zeroAddress) throw new Error("x402: deployment without X402Settler");
  }

  /** The payer. */
  get address(): Address { return this.account.address; }

  private base() { return this.o.enclaveUrl.replace(/\/+$/, ""); }

  /** The enclave's keys, verified on-chain for this product (checked again after `reverifyMs`). */
  async verifiedKeys(force = false): Promise<VerifiedEnclaveKeys> {
    const maxAge = this.o.reverifyMs ?? 5 * 60_000;
    if (!force && this.keys && Date.now() - this.keys.checkedAtMs < maxAge) return this.keys;
    this.keys = await verifyEnclaveKeys(this.o.enclaveUrl, this.o.productId, { publicClient: this.pub, deployment: this.d, fetch: this.f });
    return this.keys;
  }

  /** The product, read on-chain: it must be paid per call (X402Settler), active, and have a price. */
  async product(): Promise<X402ProductInfo> {
    const id = this.o.productId;
    const [p, active] = (await Promise.all([
      this.pub.readContract({ address: this.d.productRegistry, abi: productRegistryAbi, functionName: "getProduct", args: [id] }),
      this.pub.readContract({ address: this.d.productRegistry, abi: productRegistryAbi, functionName: "isActive", args: [id] }),
    ])) as [{ author: Address; price: bigint; settlement: Address; param: Hex }, boolean];
    if (!active) throw new X402ChallengeError(`produit #${id} inactif`, "product");
    if (lower(p.settlement) !== lower(this.d.x402Settler)) {
      throw new X402ChallengeError(`product #${id} is not paid per call: it settles through ${p.settlement}, not through X402Settler ${this.d.x402Settler}`, "product");
    }
    if (p.price <= 0n) throw new X402ChallengeError(`produit #${id} sans prix`, "product");
    if (this.o.expectedModel && lower(p.param) !== lower(keccak256(toBytes(this.o.expectedModel)))) {
      throw new X402ChallengeError(`product #${id} pins the model ${p.param}, not "${this.o.expectedModel}"`, "product");
    }
    return { id, price: p.price, pricePerCall: p.price * X402_UNITS_PER_CALL, settlement: p.settlement, param: p.param, active, author: p.author };
  }

  get chat() {
    return { completions: { create: (req: ChatRequest) => this.create(req) } };
  }

  private post(envelope: { enc: Hex; ciphertext: Hex; clientEphemeralPub: Hex }, xPayment?: string): Promise<Response> {
    return this.f(`${this.base()}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(xPayment ? { "x-payment": xPayment } : {}) },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 180_000),
    });
  }

  private assertCap(amount: bigint, productId: bigint): void {
    if (this.o.maxAmount !== undefined && amount > this.o.maxAmount) {
      throw new X402ChallengeError(`one call costs ${amount} (on-chain price of product #${productId}), above this client's cap of ${this.o.maxAmount}`, "cap");
    }
  }

  private async create(req: ChatRequest): Promise<X402Completion> {
    if (!req || !Array.isArray(req.messages) || req.messages.length === 0) throw new Error("x402: at least one message");
    const keys = await this.verifiedKeys();
    let product = await this.product();
    this.assertCap(product.pricePerCall, product.id);
    // the cap of THIS call: the price read at the start; nothing dearer is signed without explicit consent
    const maxPrice = product.pricePerCall;

    // the plaintext request, SALTED (its hash goes on-chain at settlement), encrypted to the X25519 key VERIFIED on-chain
    const plain = new TextEncoder().encode(JSON.stringify({
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.max_tokens !== undefined ? { max_tokens: req.max_tokens } : {}),
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      salt: freshNonce(),
    }));
    const requestHash = keccak256(plain);
    const sealed = await hpkeSeal(toBytes(keys.x25519), plain);
    const eph = generateX25519();
    const envelope = { enc: toHex(sealed.enc), ciphertext: toHex(sealed.ciphertext), clientEphemeralPub: eph.publicKey };
    const nonce = x402CallNonce({ chainId: this.d.chainId, settler: this.d.x402Settler, productId: product.id, enclave: keys.signer, ...envelope });

    // 1) without payment (nothing is signed): the 402 and its requirements, CHECKED against the chain (the 402 crosses a proxy)
    let requirement: X402PaymentRequirements;
    try {
      requirement = await this.probe(envelope, product.pricePerCall);
    } catch (e) {
      if (!(e instanceof X402ChallengeError && e.reason === "amount")) throw e;
      // the price may have changed between our read and the 402, so we read the chain again. Unchanged: the 402 lies (a
      // proxy inflating the price) and nothing is signed. RAISED: nothing is signed either (calling again accepts the new
      // price). Lowered: we ask for the 402 ONCE more, checked against the new price
      const fresh = await this.product();
      if (fresh.pricePerCall === product.pricePerCall) throw e;
      if (fresh.pricePerCall > maxPrice) {
        throw new X402ChallengeError(
          `the price of a call rose during the call (${product.pricePerCall} → ${fresh.pricePerCall}, read on-chain): nothing is signed; call again to accept the new price`,
          "price",
          fresh.pricePerCall,
        );
      }
      this.assertCap(fresh.pricePerCall, fresh.id);
      product = fresh;
      requirement = await this.probe(envelope, product.pricePerCall);
    }

    // 2) the EIP-3009 authorization: exact amount, to X402Settler, nonce = a commitment to THIS request
    const authorization = await this.authorize(requirement, nonce, product.pricePerCall);
    const pending: X402PaidRequest = {
      enclaveUrl: this.o.enclaveUrl, productId: product.id, payer: this.account.address, enclave: keys.signer, envelope,
      ephemeralPrivateKey: toHex(eph.privateKey), requestHash, nonce, authorization, authorizations: [authorization],
      requirement: {
        scheme: "exact", network: requirement.network, maxAmountRequired: requirement.maxAmountRequired, payTo: requirement.payTo,
        asset: requirement.asset, ...(requirement.maxTimeoutSeconds !== undefined ? { maxTimeoutSeconds: requirement.maxTimeoutSeconds } : {}),
      },
      maxPrice,
    };

    // 3) the paid request (identical resends, a new authorization only when the on-chain price changed, never above
    //    the call's cap)
    return this.sendPaid(pending);
  }

  /** Request WITHOUT payment: the 402 and its requirements checked against the chain (nothing is signed, nothing is owed). */
  private async probe(envelope: X402PaidRequest["envelope"], amount: bigint): Promise<X402PaymentRequirements> {
    const res = await this.post(envelope);
    if (res.status !== 402) {
      if (res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new X402CallError(res.status, "unexpected_free_response", "the enclave answered without asking for payment: answer ignored (this is not an x402 product)");
      }
      throw await callErrorOf(res);
    }
    return this.checkChallenge(await res.json().catch(() => null), amount);
  }

  /**
   * Resumes a paid call left with no verified answer (X402PaidCallError.pending, or parseX402PaidRequest): it resends the
   * SAME request with the SAME authorization. If the enclave served it, the enclave returns the kept answer (replay),
   * with no second call to the model and no second receipt. `renew`: first signs a fresh authorization (current on-chain
   * price, new expiry) for the SAME nonce, useful when the old one nears its expiry: at most one of the two can be used
   * on-chain. `maxPrice`: the cap accepted for this request (default: the call's, the price read at its start). It is the
   * only way to accept a raised price (X402PaidCallError "price_increased", `newPrice`).
   * Throws X402PaidCallError if nothing succeeds (the original `pending` object is not modified).
   */
  async resume(p: X402PaidRequest, o: { renew?: boolean; maxPrice?: bigint } = {}): Promise<X402Completion> {
    if (!p || !Array.isArray(p.authorizations) || p.authorizations.length === 0 || !p.authorization) throw new Error("x402 : reprise sans autorisation");
    if (lower(p.payer) !== lower(this.account.address)) throw new Error(`x402: call paid by ${p.payer}, not by this client (${this.account.address})`);
    if (p.productId !== this.o.productId) throw new Error(`x402: call for product #${p.productId}, client for product #${this.o.productId}`);
    if (o.maxPrice !== undefined && (typeof o.maxPrice !== "bigint" || o.maxPrice <= 0n)) throw new Error("x402: maxPrice must be a positive amount (bigint)");
    const ceiling = o.maxPrice ?? priceCeilingOf(p);
    const q: X402PaidRequest = { ...p, authorizations: [...p.authorizations], maxPrice: ceiling };
    // keys read again (not the cache): the enclave may have restarted; if unreachable, resend anyway (paid-call error)
    const keys = await this.verifiedKeys(true).catch(() => null);
    if (keys && lower(keys.signer) !== lower(q.enclave)) {
      // the enclave changed its key (a restart): its in-memory queue, and the answer, are lost. The call can still be
      // settled if the operator collected it before the restart
      throw new X402PaidCallError(0, "enclave_changed", q, 0, `the URL now serves enclave ${keys.signer}, the request was encrypted for ${q.enclave}`);
    }
    if (o.renew) {
      const product = await this.product();
      this.assertCap(product.pricePerCall, product.id);
      if (product.pricePerCall > ceiling) {
        // never dearer without explicit consent: nothing is signed. To accept it: resume(…, { renew: true, maxPrice })
        throw new X402PaidCallError(0, "price_increased", q, 0, `on-chain price ${product.pricePerCall} above this call's ceiling of ${ceiling}`, undefined, product.pricePerCall);
      }
      const a = await this.authorize(q.requirement, q.nonce, product.pricePerCall);
      q.authorizations.push(a);
      q.authorization = a;
    }
    return this.sendPaid(q);
  }

  /**
   * Cancels a paid call's authorization on-chain (USDC.cancelAuthorization, EIP-3009): every authorization of the
   * request shares this nonce, so all of them become unusable. The payer sends the transaction (gas). Throws if the
   * authorization is already used (settled, or already cancelled). Use it only when the answer is lost: the operator
   * who served the call is then not paid.
   */
  async cancelAuthorization(p: Pick<X402PaidRequest, "nonce"> & { payer?: Address }): Promise<Hex> {
    const authorizer = this.account.address;
    if (p.payer && lower(p.payer) !== lower(authorizer)) throw new Error(`x402: the authorization belongs to ${p.payer}, not to this client (${authorizer})`);
    const used = (await this.pub.readContract({
      address: this.d.usdc, abi: usdcAuthAbi, functionName: "authorizationState", args: [authorizer, p.nonce],
    })) as boolean;
    if (used) throw new Error("x402: this authorization is already consumed on-chain (settled, or already cancelled): nothing to cancel");
    const raw = await this.o.walletClient.signTypedData({
      account: this.account, domain: usdcDomain(this.d.usdc, this.d.chainId), types: cancelAuthorizationTypes,
      primaryType: "CancelAuthorization", message: { authorizer, nonce: p.nonce },
    } as any);
    const sig = normalizeEcdsaSignature(raw);
    const v = parseInt(sig.slice(130, 132), 16);
    const r = `0x${sig.slice(2, 66)}` as Hex;
    const s = `0x${sig.slice(66, 130)}` as Hex;
    const base = { account: this.account, address: this.d.usdc, abi: usdcCancelAbi, functionName: "cancelAuthorization" } as const;
    let request: unknown;
    try {
      ({ request } = await this.pub.simulateContract({ ...base, args: [authorizer, p.nonce, v, r, s] } as any));
    } catch (first) {
      try {
        ({ request } = await this.pub.simulateContract({ ...base, args: [authorizer, p.nonce, sig] } as any));
      } catch {
        throw first;
      }
    }
    return this.o.walletClient.writeContract(request as any);
  }

  private retryDelays(): readonly number[] {
    const d = this.o.paidRetryDelaysMs ?? X402_PAID_RETRY_DELAYS_MS;
    if (!Array.isArray(d) || d.length > 10 || d.some((x) => typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 60_000)) {
      throw new Error("x402: paidRetryDelaysMs: at most 10 delays, each between 0 and 60,000 ms");
    }
    return d;
  }

  /**
   * The paid send and its resends. Each failure first resends the IDENTICAL request (same envelope, same authorization)
   * after a delay. Two exceptions, believing nothing the server says:
   *  - a 402 "price changed" AND an on-chain price ≠ the authorized amount (after at least one identical resend): a
   *    new authorization for the SAME nonce (at most X402_MAX_REAUTHORIZATIONS), only if that price does not exceed
   *    the call's cap (the price read at its start, or the one accepted by resume). Above it, we stop:
   *    X402PaidCallError "price_increased" with `newPrice`, so a proxy that hides the answer while the author raises
   *    the price can no longer get a signature at 100 times the price;
   *  - a 409 "nonce_reused" while several authorizations exist: the enclave served this request under another of our
   *    authorizations (same nonce), so we resend that one (idempotent resume).
   * If nothing succeeds: X402PaidCallError (the call MAY have been served).
   */
  private async sendPaid(p: X402PaidRequest): Promise<X402Completion> {
    const delays = this.retryDelays();
    let current = p.authorizations.length - 1;
    let resends = 0;
    let reauthorized = 0;
    let switches = 0;
    let attempts = 0;
    let last: PaidFailure;
    for (;;) {
      const auth = p.authorizations[current]!;
      p.authorization = auth;
      attempts++;
      const out = await this.paidAttempt(p, auth);
      if ("completion" in out) return out.completion;
      last = out;
      const n = p.authorizations.length;
      if (last.status === 409 && last.code === "nonce_reused" && n > 1 && switches < 2 * n) {
        switches++;
        current = (current + n - 1) % n;
        continue;
      }
      if (last.status === 402 && last.code === X402_PRICE_CHANGED && resends >= 1 && reauthorized < X402_MAX_REAUTHORIZATIONS) {
        const fresh = await this.product().catch(() => null);
        if (fresh && fresh.pricePerCall !== auth.value) {
          if (this.o.maxAmount !== undefined && fresh.pricePerCall > this.o.maxAmount) {
            last = { ...last, code: "price_above_cap", detail: `on-chain price ${fresh.pricePerCall} above this client's cap of ${this.o.maxAmount}`, newPrice: fresh.pricePerCall };
            break;
          }
          const ceiling = priceCeilingOf(p);
          if (fresh.pricePerCall > ceiling) {
            last = { ...last, code: "price_increased", detail: `on-chain price ${fresh.pricePerCall} above this call's ceiling of ${ceiling}`, newPrice: fresh.pricePerCall };
            break;
          }
          const a = await this.authorize(p.requirement, p.nonce, fresh.pricePerCall); // SAME nonce
          p.authorizations.push(a);
          current = p.authorizations.length - 1;
          reauthorized++;
          continue;
        }
      }
      if (resends >= delays.length) break;
      await sleep(delays[resends]!);
      resends++;
    }
    throw new X402PaidCallError(last.status, last.code, p, attempts, last.detail, last.cause, last.newPrice);
  }

  /** One paid send: the verified completion, or what failed (never an exception: nothing about the call is lost). */
  private async paidAttempt(p: X402PaidRequest, auth: X402Authorization): Promise<{ completion: X402Completion } | PaidFailure> {
    const header = encodeXPaymentHeader(paymentPayloadOf(auth, p.requirement.network));
    let res: Response;
    try {
      res = await this.post(p.envelope, header);
    } catch (e) {
      const timeout = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      return { status: 0, code: timeout ? "timeout" : "network_error", cause: e };
    }
    if (res.ok) {
      const body = await res.json().catch(() => null);
      try {
        return {
          completion: await this.verifyCompletion(body, {
            signer: p.enclave, amount: auth.value, nonce: p.nonce, requestHash: p.requestHash, ephPriv: toBytes(p.ephemeralPrivateKey), authorization: auth,
          }),
        };
      } catch (e) {
        return { status: res.status, code: e instanceof X402ReceiptMismatchError ? "receipt_mismatch" : "client_error", cause: e };
      }
    }
    const b = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown; detail?: unknown };
    const code = res.status === 402 ? String(b.error ?? "payment_refused") : String(b.code ?? `http_${res.status}`);
    const detail = typeof b.detail === "string" ? b.detail : typeof b.error === "string" && res.status !== 402 ? b.error : undefined;
    return { status: res.status, code: code.slice(0, 64), ...(detail ? { detail: detail.slice(0, 300) } : {}) };
  }

  private checkChallenge(j: any, amount: bigint): X402PaymentRequirements {
    if (!j || j.x402Version !== 1 || !Array.isArray(j.accepts)) throw new X402ChallengeError("unreadable 402 answer (x402 v1 expected)");
    const net = x402NetworkName(this.d.chainId);
    const r = j.accepts.find((a: any) => a?.scheme === "exact" && a?.network === net);
    if (!r) throw new X402ChallengeError(`no "exact" requirement on network ${net}`, "network");
    if (typeof r.payTo !== "string" || lower(r.payTo) !== lower(this.d.x402Settler)) {
      throw new X402ChallengeError(`payTo ${String(r.payTo)} is not X402Settler (${this.d.x402Settler}): nothing is signed (a proxy diverting the payment?)`, "payTo");
    }
    if (typeof r.asset !== "string" || lower(r.asset) !== lower(this.d.usdc)) {
      throw new X402ChallengeError(`asset ${String(r.asset)} is not the deployment's USDC (${this.d.usdc})`, "asset");
    }
    if (String(r.maxAmountRequired) !== amount.toString()) {
      throw new X402ChallengeError(`amount requested ${String(r.maxAmountRequired)} ≠ on-chain price of a call (${amount})`, "amount");
    }
    return r as X402PaymentRequirements;
  }

  private async authorize(r: X402PaymentRequirements, nonce: Hex, amount: bigint): Promise<X402Authorization> {
    const announced = Number(r.maxTimeoutSeconds);
    const wanted = this.o.validitySeconds ?? (Number.isFinite(announced) && announced > 0 ? announced : X402_MAX_VALIDITY_SECONDS);
    const validity = BigInt(Math.min(Math.max(Math.floor(wanted), 60), X402_MAX_VALIDITY_SECONDS));
    const validBefore = BigInt(Math.floor(Date.now() / 1000)) + validity;
    const message = { from: this.account.address, to: this.d.x402Settler, value: amount, validAfter: 0n, validBefore, nonce };
    const raw = await this.o.walletClient.signTypedData({
      account: this.account, domain: usdcDomain(this.d.usdc, this.d.chainId), types: receiveWithAuthorizationTypes,
      primaryType: "ReceiveWithAuthorization", message,
    } as any);
    return { ...message, signature: normalizeEcdsaSignature(raw) };
  }

  private async verifyCompletion(
    out: any,
    x: { signer: Address; amount: bigint; nonce: Hex; requestHash: Hex; ephPriv: Uint8Array; authorization: X402Authorization },
  ): Promise<X402Completion> {
    if (!out || typeof out !== "object" || typeof out.enc !== "string" || typeof out.ciphertext !== "string" || typeof out.signature !== "string") {
      throw new X402ReceiptMismatchError("incomplete answer (enc, ciphertext, receipt, signature expected)");
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await hpkeOpen(x.ephPriv, toBytes(out.enc as Hex), toBytes(out.ciphertext as Hex)));
    } catch {
      throw new X402ReceiptMismatchError("answer cannot be decrypted with this request's ephemeral key");
    }
    let cr: CallReceipt;
    let signature: Hex;
    try {
      cr = normalizeCallReceipt(out.receipt);
      signature = sig65(out.signature, "signature");
    } catch (e) {
      throw new X402ReceiptMismatchError((e as Error).message);
    }
    const signer = await recoverCallReceiptSigner(this.d.x402Settler, cr, signature, this.d.chainId).catch(() => zeroAddress as Address);
    if (lower(signer) !== lower(x.signer)) throw new X402ReceiptMismatchError(`receipt signed by ${signer}, not by the verified enclave ${x.signer}`);
    if (cr.productId !== this.o.productId) throw new X402ReceiptMismatchError(`receipt for product #${cr.productId}, call for product #${this.o.productId}`);
    if (lower(cr.payer) !== lower(this.account.address)) throw new X402ReceiptMismatchError(`receipt in the name of ${cr.payer}, not of the payer ${this.account.address}`);
    if (cr.nonce !== lower(x.nonce)) throw new X402ReceiptMismatchError("the receipt does not carry this payment's nonce");
    if (cr.units !== X402_UNITS_PER_CALL) throw new X402ReceiptMismatchError(`the receipt counts ${cr.units} units for one call (1 expected)`);
    if (cr.requestHash !== lower(x.requestHash)) throw new X402ReceiptMismatchError("the receipt does not carry the hash of the request sent");
    if (cr.responseHash !== lower(x402ResponseHash(x.requestHash, text))) throw new X402ReceiptMismatchError("the text received is not the one the enclave signed");

    // can X402Settler.settle take it? (enclave active for this product at the anchor block, grace included). This read
    // is for information: an RPC failure here does not lose a paid, verified answer
    let operator: Address = zeroAddress;
    let operatorKnown = true;
    try {
      operator = (await this.pub.readContract({
        address: this.d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "activeOperatorAt", args: [signer, cr.productId, cr.anchorBlock],
      })) as Address;
    } catch {
      operatorKnown = false;
    }
    return {
      text, receipt: cr, signature, signer, operator, amount: x.amount, authorization: x.authorization, requestHash: lower(x.requestHash) as Hex,
      settleable: lower(operator) !== zeroAddress,
      ...(operatorKnown ? {} : { settleableUnknown: true }),
      ...(out.usage && typeof out.usage === "object" ? { usage: out.usage } : {}),
      replay: out.replay === true,
    };
  }

  /** Settles the call right away (the payer pays the gas): X402Settler.settle(receipt, signature, authorization). The
   *  contract pays the enclave's active operator, the author and the network; a second settlement is impossible (EIP-3009
   *  nonce). */
  async settle(c: Pick<X402Completion, "receipt" | "signature" | "authorization">): Promise<Hex> {
    const call: PendingCall = {
      receipt: c.receipt, signature: c.signature,
      auth: { validAfter: c.authorization.validAfter, validBefore: c.authorization.validBefore, nonce: c.authorization.nonce, signature: c.authorization.signature },
    };
    const { request } = await this.pub.simulateContract({
      account: this.account, address: this.d.x402Settler, abi: [...x402Abi, ...arcErrorsAbi], functionName: "settle", args: settleArgs(call),
    } as any);
    return this.o.walletClient.writeContract(request as any);
  }

  /** Is this call's authorization used on-chain (settled, or cancelled)? */
  async isSettled(c: Pick<X402Completion, "receipt">): Promise<boolean> {
    return (await this.pub.readContract({
      address: this.d.usdc, abi: usdcAuthAbi, functionName: "authorizationState", args: [c.receipt.payer, c.receipt.nonce],
    })) as boolean;
  }
}

export function createX402Client(o: X402ClientOptions): X402Client {
  return new X402Client(o);
}

/** The PROBE failed (no X-PAYMENT sent): nothing was signed, so nothing is owed. Never after a paid send. */
async function callErrorOf(res: Response): Promise<X402CallError> {
  const b = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return new X402CallError(
    res.status,
    String(b.code ?? `http_${res.status}`),
    `x402 enclave: HTTP ${res.status} ${b.error ?? ""} (before any payment: no authorization signed, nothing is owed)`.replace(/\s+/g, " ").trim(),
  );
}

/** A paid send that did not succeed (status 0: no answer). `code` and `detail` come from the server and are not
 *  authenticated, except "price_increased" / "price_above_cap" (from the client, with the on-chain price in `newPrice`). */
interface PaidFailure { status: number; code: string; detail?: string; cause?: unknown; newPrice?: bigint }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- on-chain check of a call, and settlement

/** A served call, not settled yet: the arguments of X402Settler.settle (the enclave's GET /x402/pending). */
export interface PendingCall {
  receipt: CallReceipt;
  signature: Hex;
  auth: { validAfter: bigint; validBefore: bigint; nonce: Hex; signature: Hex };
  amount?: bigint;
  servedAt?: number;
  /** According to the enclave (its last balance reading), the payer's balance covers this call. false: "uncovered",
   *  settled after the others and checked again in bounded numbers per pass. Absent: covered. */
  covered?: boolean;
}

/** An entry of GET /x402/pending → PendingCall; throws if unreadable. */
export function normalizePendingCall(j: any): PendingCall {
  if (!j || typeof j !== "object" || !j.auth || typeof j.auth !== "object") throw new Error("appel en attente illisible");
  return {
    receipt: normalizeCallReceipt(j.receipt),
    signature: sig65(j.signature, "signature"),
    auth: {
      validAfter: dec(j.auth.validAfter, "validAfter", MAX_U256), validBefore: dec(j.auth.validBefore, "validBefore", MAX_U256),
      nonce: hex32(j.auth.nonce, "auth.nonce"), signature: sig65(j.auth.signature, "auth.signature"),
    },
    ...(typeof j.amount === "string" && /^[0-9]{1,78}$/.test(j.amount) ? { amount: BigInt(j.amount) } : {}),
    ...(Number.isSafeInteger(j.servedAt) ? { servedAt: j.servedAt as number } : {}),
    ...(typeof j.covered === "boolean" ? { covered: j.covered } : {}),
  };
}

/** The arguments of X402Settler.settle(cr, enclaveSig, auth). */
export function settleArgs(call: PendingCall) {
  const cr = call.receipt;
  return [
    { productId: cr.productId, payer: cr.payer, requestHash: cr.requestHash, responseHash: cr.responseHash, units: cr.units, anchorBlock: cr.anchorBlock, nonce: cr.nonce },
    call.signature,
    { validAfter: call.auth.validAfter, validBefore: call.auth.validBefore, nonce: call.auth.nonce, signature: call.auth.signature },
  ] as const;
}

export type CallCheckId = "product" | "settlement" | "amount" | "active" | "operator" | "nonce" | "authorization" | "unused" | "window" | "funds";
export interface CallCheck { id: CallCheckId; ok: boolean; fr: string }

export interface CallVerification {
  /** Signer of the receipt (X402Settler domain). */
  signer: Address;
  /** Active operator of this signer for the product at the anchor block (zero address if none): the one settle would pay. */
  operator: Address;
  /** units × the product's price: what settle would take. */
  amount: bigint;
  checks: CallCheck[];
  /** True if X402Settler.settle would accept this call now (apart from the bond exposure, seen in the simulation). */
  settleable: boolean;
  /** The authorization is already used (settled, or cancelled by the payer): nothing left to do. */
  alreadyUsed: boolean;
  /** The authorization has expired (validBefore passed). */
  expired: boolean;
  head: bigint;
  /** Timestamp of the head block (s). */
  now: bigint;
}

/** Checks a call exactly as X402Settler.settle and the USDC will (reads only, at the head block). */
export async function verifyCallOnChain(
  pub: PublicClient,
  call: PendingCall,
  d: Deployment = testnet,
  o: { expectedOperator?: Address } = {},
): Promise<CallVerification> {
  const cr = call.receipt;
  const blk = await pub.getBlock();
  const at = { blockNumber: blk.number } as const;
  const signer = await recoverCallReceiptSigner(d.x402Settler, cr, call.signature, d.chainId).catch(() => zeroAddress as Address);
  const [p, active, operator, used, balance] = (await Promise.all([
    pub.readContract({ address: d.productRegistry, abi: productRegistryAbi, functionName: "getProduct", args: [cr.productId], ...at }),
    pub.readContract({ address: d.productRegistry, abi: productRegistryAbi, functionName: "isActive", args: [cr.productId], ...at }),
    lower(signer) === zeroAddress
      ? Promise.resolve(zeroAddress as Address)
      : pub.readContract({ address: d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "activeOperatorAt", args: [signer, cr.productId, cr.anchorBlock], ...at }),
    pub.readContract({ address: d.usdc, abi: usdcAuthAbi, functionName: "authorizationState", args: [cr.payer, cr.nonce], ...at }),
    pub.readContract({ address: d.usdc, abi: usdcAuthAbi, functionName: "balanceOf", args: [cr.payer], ...at }),
  ])) as [{ price: bigint; settlement: Address }, boolean, Address, boolean, bigint];
  const amount = cr.units * p.price;

  // does the authorization pay EXACTLY this amount to X402Settler, signed by the payer, in a form the USDC accepts?
  let authOk = false;
  const problem = eip3009SignatureProblem(call.auth.signature);
  if (!problem) {
    const from = await recoverTypedDataAddress({
      domain: usdcDomain(d.usdc, d.chainId) as TypedDataDomain, types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization",
      message: { from: cr.payer, to: d.x402Settler, value: amount, validAfter: call.auth.validAfter, validBefore: call.auth.validBefore, nonce: cr.nonce },
      signature: call.auth.signature,
    }).catch(() => zeroAddress as Address);
    authOk = lower(from) === lower(cr.payer);
  }
  const now = blk.timestamp;
  const opOk = lower(operator) !== zeroAddress;
  const checks: CallCheck[] = [
    { id: "product", ok: active, fr: active ? `produit #${cr.productId} actif` : `produit #${cr.productId} inactif (BadProduct)` },
    { id: "settlement", ok: lower(p.settlement) === lower(d.x402Settler), fr: lower(p.settlement) === lower(d.x402Settler) ? "produit réglé par X402Settler" : `produit réglé par ${p.settlement} (WrongSettlement)` },
    { id: "amount", ok: amount > 0n, fr: amount > 0n ? `montant ${amount}` : "montant nul (ZeroAmount)" },
    { id: "active", ok: opOk, fr: opOk ? `enclave ${signer} active au bloc d'ancrage ${cr.anchorBlock}` : `signataire ${signer} non actif pour ce produit au bloc ${cr.anchorBlock} (InactiveEnclave)` },
    {
      id: "operator", ok: !o.expectedOperator || lower(operator) === lower(o.expectedOperator),
      fr: !o.expectedOperator || lower(operator) === lower(o.expectedOperator) ? "opérateur attendu" : `le règlement paierait l'opérateur ${operator}, pas ${o.expectedOperator}`,
    },
    { id: "nonce", ok: lower(call.auth.nonce) === lower(cr.nonce), fr: lower(call.auth.nonce) === lower(cr.nonce) ? "nonce du reçu = nonce de l'autorisation" : "nonce du reçu ≠ nonce de l'autorisation" },
    { id: "authorization", ok: authOk, fr: authOk ? "autorisation EIP-3009 du payeur, montant exact, vers X402Settler" : (problem ?? "l'autorisation ne paie pas exactement ce montant à X402Settler (signature EIP-3009)") },
    { id: "unused", ok: !used, fr: used ? "autorisation déjà consommée (réglée, ou annulée par le payeur)" : "autorisation jamais consommée" },
    {
      id: "window", ok: call.auth.validAfter < now && now < call.auth.validBefore,
      fr: call.auth.validAfter < now && now < call.auth.validBefore ? "autorisation dans sa fenêtre de validité" : "autorisation hors de sa fenêtre de validité",
    },
    { id: "funds", ok: balance >= amount, fr: balance >= amount ? "solde du payeur suffisant" : `solde du payeur ${balance} < ${amount}` },
  ];
  return {
    signer, operator, amount, checks, settleable: checks.every((c) => c.ok), alreadyUsed: used, expired: call.auth.validBefore <= now,
    head: blk.number, now,
  };
}

export interface X402SettleResult { tx: Hex; status: "success" | "reverted" | "timeout"; gasUsed?: bigint }

export interface X402SettlementQueueOptions {
  publicClient: PublicClient;
  deployment?: Deployment;
  /** The operator who settles: only the calls that pay it are settled (the contract pays the operator active at the anchor block). */
  operator: Address;
  /** Collects the served, unsettled calls (the enclave's GET /x402/pending, every page). */
  fetchPending: () => Promise<PendingCall[]>;
  /** Reports to the enclave the calls used on-chain (POST /x402/settled, signed by the operator; the enclave checks
   *  again on-chain), each with `settled`: SETTLED by X402Settler (our successful transaction, or this nonce's
   *  CallSettled event) or used otherwise (cancelled by the payer; only a settlement makes the payer "known" to the
   *  enclave). Receives each key once per pass; a failed report is sent again at the next pass. */
  acknowledge?: (items: X402AckItem[]) => Promise<void>;
  /** Sends X402Settler.settle and waits for the transaction. */
  settle: (call: PendingCall) => Promise<X402SettleResult>;
  /** No more attempts closer than this delay (s) to the authorization's expiry (default 15). */
  minRemainingSeconds?: number;
  /** After a transaction with no receipt in time: no new send during this delay (ms, default 5 min). */
  coolDownMs?: number;
  /** "Uncovered" calls (by the enclave's last reading) checked again on-chain, at most, per pass (default 25). Covered
   *  calls always go first; the other uncovered ones wait for the next pass, with no read. */
  maxUncoveredChecks?: number;
  log?: (m: string) => void;
}

export interface X402SettlementReport {
  fetched: number;
  /** Calls still tracked after this pass (collected and not settled yet). */
  known: number;
  settled: Array<{ payer: Address; nonce: Hex; amount: bigint; tx: Hex; gasUsed?: bigint }>;
  /** Already used on-chain (settled by someone else, or cancelled): reported to the enclave, nothing sent. */
  alreadySettled: number;
  /** Among them, those with no visible settlement by X402Settler (cancelled by the payer, most often): reported as
   *  "used otherwise" (the payer does not become "known"). */
  consumedElsewhere: number;
  /** Expired before they could be settled (lost for the operator). */
  expired: number;
  /** Dropped for good (they would not pay this operator, or they are inconsistent). */
  dropped: number;
  waiting: Array<{ payer: Address; nonce: Hex; reasons: string[] }>;
  failed: Array<{ payer: Address; nonce: Hex; error: string }>;
  fetchError?: string;
}

/** What waiting will not fix: the call is dropped. */
const PERMANENT: ReadonlySet<CallCheckId> = new Set<CallCheckId>(["settlement", "operator", "nonce"]);
/** Keys settled by our transactions, kept in memory (to report them "settled" even when collected a second time). */
const MAX_PAID_KEYS = 10_000;
/** Failed reports kept for the next pass, at most. */
const MAX_UNACKED = 1_000;

/**
 * The operator's settlement queue, with NO DOUBLE SETTLEMENT: one pass at a time (two simultaneous runOnce calls share
 * the same pass), a call never sent twice at the same time, and each send preceded by an on-chain check (authorization
 * already used → nothing is sent, the enclave is told). The contract forbids it anyway (single-use EIP-3009 nonce);
 * this avoids paying gas for a transaction that would fail. Collected calls are kept until settlement or expiry, so an
 * enclave restart no longer loses them.
 * COVERED calls (according to the enclave) go first, nearest expiry first. At most maxUncoveredChecks "uncovered"
 * calls are checked again per pass, so unpayable calls, even many with short expiries, no longer delay the settlement
 * of an honest payer.
 */
export class X402SettlementQueue {
  private known = new Map<string, PendingCall>();
  private inFlight = new Set<string>();
  private cooling = new Map<string, number>();
  /** Transaction sent with no receipt (timeout): its receipt will later say whether WE settled the call. */
  private sentTx = new Map<string, Hex>();
  /** Keys settled by our (successful) transactions. */
  private paidKeys = new Map<string, number>();
  /** Failed reports, sent again at the next pass. */
  private unacked = new Map<string, X402AckItem>();
  private running?: Promise<X402SettlementReport>;

  constructor(private o: X402SettlementQueueOptions) {}

  /** Calls collected and not settled yet. */
  get size(): number { return this.known.size; }

  runOnce(): Promise<X402SettlementReport> {
    this.running ??= this.pass().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async pass(): Promise<X402SettlementReport> {
    const d = this.o.deployment ?? testnet;
    const log = this.o.log ?? (() => {});
    const r: X402SettlementReport = { fetched: 0, known: 0, settled: [], alreadySettled: 0, consumedElsewhere: 0, expired: 0, dropped: 0, waiting: [], failed: [] };
    try {
      const items = await this.o.fetchPending();
      r.fetched = items.length;
      for (const c of items) this.known.set(callKey(c), c);
    } catch (e) {
      r.fetchError = (e as Error)?.message ?? String(e); // settle what is already collected anyway
    }
    // each key once (no duplicates); first the reports that failed at the previous pass
    const ack = new Map<string, X402AckItem>(this.unacked);
    const minLeft = BigInt(this.o.minRemainingSeconds ?? 15);
    const coolDown = this.o.coolDownMs ?? 5 * 60_000;
    const maxUncovered = this.o.maxUncoveredChecks ?? 25;
    const byDeadline = (a: PendingCall, b: PendingCall) => (a.auth.validBefore < b.auth.validBefore ? -1 : a.auth.validBefore > b.auth.validBefore ? 1 : 0);
    // COVERED calls first (the enclave's last reading), nearest expiry first; then the others
    const order = [...this.known.entries()].sort(([, a], [, b]) => {
      const ua = a.covered === false, ub = b.covered === false;
      return ua === ub ? byDeadline(a, b) : ua ? 1 : -1;
    });
    const nowLocal = BigInt(Math.floor(Date.now() / 1000));
    let uncoveredChecks = 0;
    for (const [key, call] of order) {
      if (this.inFlight.has(key)) continue;
      const id = { payer: call.receipt.payer, nonce: call.receipt.nonce };
      if (call.covered === false) {
        if (uncoveredChecks >= maxUncovered) {
          // no read for this one in this pass: if expired (local clock), it leaves; otherwise it waits
          if (call.auth.validBefore <= nowLocal + minLeft) {
            this.known.delete(key);
            this.cooling.delete(key);
            this.sentTx.delete(key);
            r.expired++;
          } else {
            r.waiting.push({ ...id, reasons: ["not covered by the payer's balance (the enclave's latest reading): re-checked on a later pass"] });
          }
          continue;
        }
        uncoveredChecks++;
      }
      let v: CallVerification;
      try {
        v = await verifyCallOnChain(this.o.publicClient, call, d, { expectedOperator: this.o.operator });
      } catch (e) {
        r.failed.push({ ...id, error: explainArcError(e) });
        continue;
      }
      if (v.alreadyUsed) {
        // used: by an X402Settler SETTLEMENT (ours, or someone else's), or cancelled? The enclave makes the payer
        // "known" only in the first case
        const paid = await this.settledByX402(key, call, v.head, d);
        this.known.delete(key);
        this.cooling.delete(key);
        this.sentTx.delete(key);
        ack.set(key, { ...id, settled: paid });
        r.alreadySettled++;
        if (!paid) r.consumedElsewhere++;
        continue;
      }
      if (call.auth.validBefore <= v.now + minLeft) {
        this.known.delete(key);
        this.cooling.delete(key);
        this.sentTx.delete(key);
        r.expired++;
        log(`call ${key}: authorization expired before settlement, ${v.amount} lost for the operator`);
        continue;
      }
      const failing = v.checks.filter((c) => !c.ok);
      if (failing.length) {
        if (failing.some((c) => PERMANENT.has(c.id))) {
          this.known.delete(key);
          r.dropped++;
          log(`call ${key} dropped: ${failing.map((c) => c.fr).join(" ; ")}`);
        } else {
          r.waiting.push({ ...id, reasons: failing.map((c) => c.fr) });
        }
        continue;
      }
      const since = this.cooling.get(key);
      if (since !== undefined && Date.now() - since < coolDown) {
        r.waiting.push({ ...id, reasons: ["transaction already sent, waiting for its confirmation"] });
        continue;
      }
      this.inFlight.add(key);
      try {
        const s = await this.o.settle(call);
        if (s.status === "success") {
          this.known.delete(key);
          this.cooling.delete(key);
          this.sentTx.delete(key);
          this.rememberPaid(key);
          ack.set(key, { ...id, settled: true }); // the receipt of OUR transaction: settled by X402Settler
          r.settled.push({ ...id, amount: v.amount, tx: s.tx, ...(s.gasUsed !== undefined ? { gasUsed: s.gasUsed } : {}) });
        } else if (s.status === "timeout") {
          this.cooling.set(key, Date.now());
          this.sentTx.set(key, s.tx);
          r.waiting.push({ ...id, reasons: [`transaction ${s.tx} sent, no receipt yet`] });
        } else {
          r.failed.push({ ...id, error: `transaction reverted on-chain (${s.tx})` });
        }
      } catch (e) {
        r.failed.push({ ...id, error: explainArcError(e) });
      } finally {
        this.inFlight.delete(key);
      }
    }
    if (ack.size && this.o.acknowledge) {
      try {
        await this.o.acknowledge([...ack.values()]);
        this.unacked.clear();
      } catch (e) {
        log(`report to the enclave failed: ${(e as Error)?.message ?? e} (sent again on the next pass)`);
        this.unacked = new Map([...ack].slice(-MAX_UNACKED));
      }
    }
    r.known = this.known.size;
    return r;
  }

  private rememberPaid(key: string): void {
    this.paidKeys.delete(key);
    this.paidKeys.set(key, Date.now());
    if (this.paidKeys.size > MAX_PAID_KEYS) {
      const oldest = this.paidKeys.keys().next().value;
      if (oldest !== undefined) this.paidKeys.delete(oldest);
    }
  }

  /**
   * Was a used authorization used by an X402Settler SETTLEMENT? Yes if OUR transaction settled it (kept in memory, or
   * the receipt of a transaction left without an answer), or if this payer's CallSettled event, for this product,
   * carries this nonce (from the receipt's anchor block: the payer may have settled it themselves). Otherwise
   * (cancelled with cancelAuthorization, or unreadable): no. No trust is given on a doubt.
   */
  private async settledByX402(key: string, call: PendingCall, head: bigint, d: Deployment): Promise<boolean> {
    if (this.paidKeys.has(key)) return true;
    const tx = this.sentTx.get(key);
    if (tx) {
      try {
        const rc = await this.o.publicClient.getTransactionReceipt({ hash: tx });
        if (rc.status === "success") {
          this.rememberPaid(key);
          return true;
        }
      } catch {
        /* reçu introuvable : on regarde l'événement */
      }
    }
    try {
      const logs = await this.o.publicClient.getLogs({
        address: d.x402Settler,
        event: callSettledEvent,
        args: { productId: call.receipt.productId, payer: call.receipt.payer },
        fromBlock: call.receipt.anchorBlock,
        toBlock: head,
      });
      if (logs.some((l) => typeof l.args.nonce === "string" && lower(l.args.nonce) === lower(call.receipt.nonce))) {
        this.rememberPaid(key);
        return true;
      }
    } catch {
      /* lecture impossible : pas de confiance sur un doute */
    }
    return false;
  }
}

function callKey(c: PendingCall): string {
  return `${lower(c.receipt.payer)}:${lower(c.receipt.nonce)}`;
}

/** The settlement queue wired to an x402 enclave (HTTP) and to the operator's wallet (transactions). It collects the
 *  enclave's WHOLE queue, page by page (GET /x402/pending?limit&offset). The report to the enclave (POST
 *  /x402/settled) is SIGNED by the operator's key (EIP-712 x402AckTypes: the enclave read again on GET /x402/pending,
 *  the product, a timestamp, a random nonce, items with `settled`), in batches of 200. The enclave refuses any report
 *  not signed by an address of its OPERATOR_ALLOWLIST. */
export function createX402SettlementQueue(o: {
  enclaveUrl: string;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account?: Account;
  deployment?: Deployment;
  fetch?: typeof fetch;
  log?: (m: string) => void;
  /** Calls collected per page (default 500, at most 500). */
  limit?: number;
  /** Calls collected at most per pass, all pages together (default 10,000). */
  maxItems?: number;
  minRemainingSeconds?: number;
  /** "Uncovered" calls checked again at most per pass (default 25). */
  maxUncoveredChecks?: number;
  /** Wait for a transaction's receipt (ms, default 120,000). */
  receiptTimeoutMs?: number;
}): X402SettlementQueue {
  const d = o.deployment ?? testnet;
  const f = o.fetch ?? globalThis.fetch;
  const base = o.enclaveUrl.replace(/\/+$/, "");
  const account = o.account ?? o.walletClient.account;
  if (!account) throw new Error("x402 : walletClient sans compte (passer `account`)");
  // the enclave and the product to address the report to (read again at each collection: the key changes at each
  // restart); not authenticated, but bound into the signed message: an enclave that is not this one refuses it
  let target: { enclave: Address; productId: bigint } | undefined;
  const signAck = (m: X402AckMessage): Promise<Hex> => {
    const args = { domain: x402AckDomain(d.x402Settler, d.chainId), types: x402AckTypes, primaryType: "X402Settled" as const, message: m };
    const local = account as { signTypedData?: (a: typeof args) => Promise<Hex> };
    return typeof local.signTypedData === "function"
      ? local.signTypedData(args)
      : o.walletClient.signTypedData({ account, ...args } as any);
  };
  return new X402SettlementQueue({
    publicClient: o.publicClient,
    deployment: d,
    operator: account.address,
    ...(o.log ? { log: o.log } : {}),
    ...(o.minRemainingSeconds !== undefined ? { minRemainingSeconds: o.minRemainingSeconds } : {}),
    ...(o.maxUncoveredChecks !== undefined ? { maxUncoveredChecks: o.maxUncoveredChecks } : {}),
    fetchPending: async () => {
      const pageSize = Math.min(Math.max(Math.floor(o.limit ?? 500), 1), 500);
      const maxItems = Math.max(pageSize, Math.floor(o.maxItems ?? 10_000));
      const out: PendingCall[] = [];
      let offset = 0;
      for (;;) {
        let j: { items?: unknown[]; enclave?: unknown; productId?: unknown; total?: unknown; offset?: unknown };
        try {
          const res = await f(`${base}/x402/pending?limit=${pageSize}&offset=${offset}`, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) throw new Error(`/x402/pending : HTTP ${res.status}`);
          j = (await res.json()) as typeof j;
        } catch (e) {
          if (offset === 0) throw e;
          break; // a next page failed: settle what is already collected (the rest at the next pass)
        }
        if (typeof j.enclave === "string" && isAddress(j.enclave, { strict: false }) && typeof j.productId === "string" && /^[0-9]{1,78}$/.test(j.productId)) {
          target = { enclave: getAddress(lower(j.enclave)), productId: BigInt(j.productId) };
        }
        const items = Array.isArray(j.items) ? j.items : [];
        for (const it of items) {
          try {
            out.push(normalizePendingCall(it));
          } catch {
            /* entrée illisible : ignorée (rien n'est envoyé pour elle) */
          }
        }
        const total = typeof j.total === "number" && Number.isSafeInteger(j.total) ? j.total : 0;
        // end: an incomplete page, the whole queue collected, the pass's limit, or an enclave that ignores `offset` (one page)
        if (items.length < pageSize || j.offset !== offset || offset + items.length >= total || offset + items.length >= maxItems) break;
        offset += items.length;
      }
      return out;
    },
    acknowledge: async (items) => {
      if (!target) throw new Error("/x402/settled: unknown enclave (no successful read of /x402/pending)");
      const seen = new Set<string>();
      const unique = items.filter((i) => {
        const k = `${lower(i.payer)}:${lower(i.nonce)}`;
        return seen.has(k) ? false : (seen.add(k), true);
      });
      for (let i = 0; i < unique.length; i += X402_ACK_MAX_ITEMS) {
        const m: X402AckMessage = {
          enclave: target.enclave, productId: target.productId, issuedAt: BigInt(Math.floor(Date.now() / 1000)), ackNonce: freshNonce(),
          items: unique.slice(i, i + X402_ACK_MAX_ITEMS).map((x) => ({ payer: getAddress(lower(x.payer)), nonce: lower(x.nonce) as Hex, settled: x.settled === true })),
        };
        const signature = await signAck(m);
        const res = await f(`${base}/x402/settled`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x402AckBody(m, signature)), signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { code?: unknown };
          throw new Error(`/x402/settled : HTTP ${res.status}${typeof b.code === "string" ? ` (${b.code.slice(0, 40)})` : ""}`);
        }
      }
    },
    settle: async (call) => {
      const { request } = await o.publicClient.simulateContract({
        account, address: d.x402Settler, abi: [...x402Abi, ...arcErrorsAbi], functionName: "settle", args: settleArgs(call),
      } as any);
      const tx = await o.walletClient.writeContract(request as any);
      try {
        const rc = await o.publicClient.waitForTransactionReceipt({ hash: tx, timeout: o.receiptTimeoutMs ?? 120_000 });
        return { tx, status: rc.status, gasUsed: rc.gasUsed };
      } catch {
        return { tx, status: "timeout" };
      }
    },
  });
}
