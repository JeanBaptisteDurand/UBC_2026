/** enclave-keys.ts — nothing is EVER encrypted to a key read from /pubkeys without checking it against the chain.
 *
 *  Why: /pubkeys goes through a proxy (the server's same-origin proxy, a CDN, a tunnel…). Whoever controls it can
 *  serve THEIR OWN X25519 key there and read every prompt or every exploit bundle. The only trustworthy key is the one
 *  EnclaveRegistry accepted: the REPORTDATA of an Intel TDX quote verified on-chain (DCAP) binds it to the enclave's
 *  signer, its product and its operator.
 *
 *  verifyEnclaveKeys(enclaveUrl, productId, …) reads /pubkeys, then EnclaveRegistry.enclaveOf(signer) and
 *  activeOperatorAt(signer, productId, head) AT THE SAME BLOCK, and requires:
 *   1. an enclave registered for this signer, on this product;
 *   2. enclaveOf(signer).x25519 == the X25519 key announced by /pubkeys;
 *   3. the enclave active for this product at the head block (activeOperatorAt ≠ 0);
 *   4. for a session: signer == the enclave locked at opening (Session.enclave), same product, same operator.
 *  Otherwise: EnclaveKeyMismatchError (the enclave's key does not match the one registered on Arc: nothing is sent).
 *  The result (VerifiedEnclaveKeys) is the ONLY type the encrypting functions accept (inference, Sealed Bounty). */
import { type Address, type Hex, type PublicClient, getAddress, isAddress, isHex, size, zeroAddress } from "viem";
import { enclaveRegistryAbi, sessionPayAbi } from "./abis";
import { testnet, type Deployment } from "./network";

/** The required message (French): shown as is to the user, followed by the detail. */
export const ENCLAVE_KEY_MISMATCH_FR = "la clé de l'enclave ne correspond pas à celle inscrite sur Arc : envoi refusé";
/** The enclave does not answer (or answers badly): nothing is sent, since its key cannot be checked. */
export const ENCLAVE_UNREACHABLE_FR = "l'enclave ne répond pas, sa clé n'a pas pu être vérifiée sur Arc : envoi refusé, réessayez dans un instant";

export type EnclaveKeyMismatchReason =
  | "pubkeys_unreachable" // /pubkeys unreachable (network, timeout, HTTP): fail closed, "does not answer" message
  | "pubkeys_unreadable" // invalid /pubkeys answer, or keys passed without an on-chain check
  | "not_registered" // no enclave registered for this signer
  | "wrong_product" // registered for another product
  | "x25519_mismatch" // the X25519 key from /pubkeys is not the registered one
  | "inactive" // not active for this product at the head block (expired, removed, invalidated)
  | "session_unknown" // the session does not exist
  | "wrong_session_enclave" // the session is locked to another enclave
  | "wrong_operator"; // the active operator is not the expected one (session)

export class EnclaveKeyMismatchError extends Error {
  readonly code = "ENCLAVE_KEY_MISMATCH" as const;
  constructor(
    readonly reason: EnclaveKeyMismatchReason,
    readonly detail: string,
    readonly facts: { enclaveUrl: string; productId: bigint; signer?: Address; announcedX25519?: Hex; registeredX25519?: Hex; block?: bigint } ,
  ) {
    // an unreachable enclave is not a "key that does not match": same refusal (fail closed), with the exact message
    super(reason === "pubkeys_unreachable" ? `${ENCLAVE_UNREACHABLE_FR} (${detail})` : `${ENCLAVE_KEY_MISMATCH_FR} (${detail})`);
    this.name = "EnclaveKeyMismatchError";
  }
}

/** An enclave's keys CHECKED against the chain: the only form accepted for encrypting to an enclave. */
export interface VerifiedEnclaveKeys {
  readonly verified: true;
  enclaveUrl: string;
  productId: bigint;
  /** The enclave's signing key (it signs receipts and claims). */
  signer: Address;
  /** The X25519 key REGISTERED on-chain (= the one from /pubkeys): encrypt to it only. */
  x25519: Hex;
  /** Active operator of this enclave for this product at the block of the check. */
  operator: Address;
  workloadId: Hex;
  tcbStatus: number;
  /** Current validity window (blocks): receipts anchored in it can be settled until the end of the grace period. */
  fromBlock: bigint;
  untilBlock: bigint;
  /** Head block at which the chain was read. */
  checkedAtBlock: bigint;
  /** Local clock (ms) of the check: to run it again from time to time. */
  checkedAtMs: number;
}

export interface VerifyEnclaveKeysOptions {
  publicClient: PublicClient;
  deployment?: Deployment;
  /** For a session: its locked enclave (Session.enclave). The signer from /pubkeys must be this one. */
  expectedSigner?: Address;
  /** For a session: its operator (Session.operator). */
  expectedOperator?: Address;
  /** Shortcut: reads SessionPay.getSession(sessionId) and applies expectedSigner, expectedOperator and the product. */
  sessionId?: bigint;
  /** fetch to use (tests, environments without a global fetch). */
  fetch?: typeof fetch;
  /** Timeout of /pubkeys (ms, default 15,000). */
  timeoutMs?: number;
}

const lower = (x: string) => x.toLowerCase();
const base = (u: string) => u.replace(/\/+$/, "");

/** GET {enclaveUrl}/pubkeys, with no trust at all: a well-formed { signer, x25519 }, or EnclaveKeyMismatchError. */
export async function fetchEnclavePubkeys(
  enclaveUrl: string,
  productId: bigint,
  o: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ signer: Address; x25519: Hex }> {
  const f = o.fetch ?? globalThis.fetch;
  const facts = { enclaveUrl, productId };
  let j: any;
  try {
    const res = await f(`${base(enclaveUrl)}/pubkeys`, { signal: AbortSignal.timeout(o.timeoutMs ?? 15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    j = await res.json();
  } catch (e) {
    throw new EnclaveKeyMismatchError("pubkeys_unreachable", `${base(enclaveUrl)}/pubkeys injoignable : ${(e as Error).message}`, facts);
  }
  if (typeof j?.signer !== "string" || !isAddress(j.signer, { strict: false })) {
    throw new EnclaveKeyMismatchError("pubkeys_unreadable", "/pubkeys ne donne pas d'adresse de signataire valide", facts);
  }
  if (typeof j?.x25519 !== "string" || !isHex(j.x25519) || size(j.x25519 as Hex) !== 32) {
    throw new EnclaveKeyMismatchError("pubkeys_unreadable", "/pubkeys ne donne pas de clé X25519 de 32 octets", facts);
  }
  return { signer: getAddress(lower(j.signer)), x25519: lower(j.x25519) as Hex };
}

/**
 * Reads /pubkeys and checks it against EnclaveRegistry (see the header). Returns verified keys, or throws
 * EnclaveKeyMismatchError with the key-mismatch message (ENCLAVE_KEY_MISMATCH_FR).
 */
export async function verifyEnclaveKeys(
  enclaveUrl: string,
  productId: bigint,
  o: VerifyEnclaveKeysOptions,
): Promise<VerifiedEnclaveKeys> {
  const d = o.deployment ?? testnet;
  const pub = o.publicClient;
  const pk = await fetchEnclavePubkeys(enclaveUrl, productId, o);
  const facts = { enclaveUrl, productId, signer: pk.signer, announcedX25519: pk.x25519 };

  // Everything is read AT THE SAME BLOCK (the head), so that no answer mixes two states of the chain.
  const block = await pub.getBlockNumber();
  let expectedSigner = o.expectedSigner;
  let expectedOperator = o.expectedOperator;
  if (o.sessionId !== undefined) {
    const s = (await pub.readContract({
      address: d.sessionPay, abi: sessionPayAbi, functionName: "getSession", args: [o.sessionId], blockNumber: block,
    })) as { owner: Address; productId: bigint; operator: Address; enclave: Address };
    if (s.owner === zeroAddress) {
      throw new EnclaveKeyMismatchError("session_unknown", `session #${o.sessionId} inconnue de SessionPay`, { ...facts, block });
    }
    if (s.productId !== productId) {
      throw new EnclaveKeyMismatchError(
        "wrong_product", `la session #${o.sessionId} est du produit #${s.productId}, pas du produit #${productId}`, { ...facts, block },
      );
    }
    expectedSigner ??= s.enclave;
    expectedOperator ??= s.operator;
  }

  const [e, op] = await Promise.all([
    pub.readContract({ address: d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "enclaveOf", args: [pk.signer], blockNumber: block }),
    pub.readContract({ address: d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "activeOperatorAt", args: [pk.signer, productId, block], blockNumber: block }),
  ]) as [
    { signer: Address; x25519: Hex; productId: bigint; operator: Address; workloadId: Hex; tcbStatus: number; fromBlock: bigint; untilBlock: bigint },
    Address,
  ];
  const at = { ...facts, block, registeredX25519: e.signer === zeroAddress ? undefined : (lower(e.x25519) as Hex) };

  if (e.signer === zeroAddress) {
    throw new EnclaveKeyMismatchError("not_registered", `le signataire ${pk.signer} annoncé par /pubkeys n'est inscrit dans aucune enclave d'Arc`, at);
  }
  if (e.productId !== productId) {
    throw new EnclaveKeyMismatchError("wrong_product", `l'enclave ${pk.signer} est inscrite pour le produit #${e.productId}, pas pour le produit #${productId}`, at);
  }
  if (lower(e.x25519) !== pk.x25519) {
    throw new EnclaveKeyMismatchError(
      "x25519_mismatch",
      `/pubkeys annonce la clé X25519 ${pk.x25519}, la chaîne a inscrit ${lower(e.x25519)} pour ${pk.signer}`,
      at,
    );
  }
  if (op === zeroAddress) {
    throw new EnclaveKeyMismatchError(
      "inactive", `l'enclave ${pk.signer} n'est pas active pour le produit #${productId} au bloc ${block} (expirée, retirée ou invalidée)`, at,
    );
  }
  if (expectedSigner && lower(expectedSigner) !== lower(pk.signer)) {
    throw new EnclaveKeyMismatchError(
      "wrong_session_enclave",
      `la session est verrouillée sur l'enclave ${getAddress(lower(expectedSigner))}, ${base(enclaveUrl)} sert ${pk.signer}`,
      at,
    );
  }
  if (expectedOperator && lower(expectedOperator) !== lower(op)) {
    throw new EnclaveKeyMismatchError(
      "wrong_operator", `l'enclave ${pk.signer} est active pour l'opérateur ${op}, la session attend ${getAddress(lower(expectedOperator))}`, at,
    );
  }

  return {
    verified: true,
    enclaveUrl: base(enclaveUrl),
    productId,
    signer: pk.signer,
    x25519: pk.x25519,
    operator: getAddress(lower(op)),
    workloadId: e.workloadId,
    tcbStatus: Number(e.tcbStatus),
    fromBlock: BigInt(e.fromBlock),
    untilBlock: BigInt(e.untilBlock),
    checkedAtBlock: block,
    checkedAtMs: Date.now(),
  };
}

/** Type guard: refuses any object that did not come out of verifyEnclaveKeys (e.g. a raw /pubkeys answer). */
export function assertVerifiedEnclaveKeys(k: unknown): asserts k is VerifiedEnclaveKeys {
  const v = k as Partial<VerifiedEnclaveKeys> | undefined;
  if (!v || v.verified !== true || !v.signer || !v.x25519 || v.checkedAtBlock === undefined) {
    throw new EnclaveKeyMismatchError(
      "pubkeys_unreadable", "clés d'enclave non vérifiées on-chain (verifyEnclaveKeys d'abord)", { enclaveUrl: String(v?.enclaveUrl ?? "?"), productId: BigInt(v?.productId ?? 0n) },
    );
  }
}
