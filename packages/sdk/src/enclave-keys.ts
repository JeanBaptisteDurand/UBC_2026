/** enclave-keys.ts — on ne chiffre JAMAIS vers une clé lue sur /pubkeys sans la confronter à la chaîne.
 *
 *  Pourquoi : /pubkeys passe par un mandataire (le proxy de même origine du VPS, un CDN, un tunnel…). Celui qui le
 *  contrôle peut y servir SA clé X25519 et lire chaque invite ou chaque bundle d'exploit. La seule clé digne de
 *  confiance est celle que l'EnclaveRegistry a acceptée : elle est liée par le REPORTDATA d'un quote Intel TDX vérifié
 *  on-chain (DCAP) au signataire de l'enclave, à son produit et à son opérateur.
 *
 *  verifyEnclaveKeys(enclaveUrl, productId, …) lit /pubkeys, puis EnclaveRegistry.enclaveOf(signer) et
 *  activeOperatorAt(signer, productId, tête) AU MÊME BLOC, et exige :
 *   1. une enclave inscrite pour ce signataire, sur ce produit ;
 *   2. enclaveOf(signer).x25519 == la clé X25519 annoncée par /pubkeys ;
 *   3. l'enclave active pour ce produit au bloc de tête (activeOperatorAt ≠ 0) ;
 *   4. pour une session : signer == l'enclave verrouillée à l'ouverture (Session.enclave), même produit, même opérateur.
 *  Sinon : EnclaveKeyMismatchError (« la clé de l'enclave ne correspond pas à celle inscrite sur Arc : envoi refusé »).
 *  Le résultat (VerifiedEnclaveKeys) est le SEUL type accepté par les fonctions qui chiffrent (inférence, Prime scellée). */
import { type Address, type Hex, type PublicClient, getAddress, isAddress, isHex, size, zeroAddress } from "viem";
import { enclaveRegistryAbi, sessionPayAbi } from "./abis";
import { testnet, type Deployment } from "./network";

/** Le message exigé : affiché tel quel à l'utilisateur, suivi du détail. */
export const ENCLAVE_KEY_MISMATCH_FR = "la clé de l'enclave ne correspond pas à celle inscrite sur Arc : envoi refusé";
/** L'enclave ne répond pas (ou mal) : rien n'est envoyé, faute de pouvoir vérifier sa clé. */
export const ENCLAVE_UNREACHABLE_FR = "l'enclave ne répond pas, sa clé n'a pas pu être vérifiée sur Arc : envoi refusé, réessayez dans un instant";

export type EnclaveKeyMismatchReason =
  | "pubkeys_unreachable" // /pubkeys injoignable (réseau, délai, HTTP) : on échoue fermé, message « ne répond pas »
  | "pubkeys_unreadable" // réponse de /pubkeys invalide, ou clés passées sans vérification on-chain
  | "not_registered" // aucune enclave inscrite pour ce signataire
  | "wrong_product" // inscrite pour un autre produit
  | "x25519_mismatch" // la clé X25519 de /pubkeys n'est pas celle inscrite
  | "inactive" // pas active pour ce produit au bloc de tête (expirée, retirée, invalidée)
  | "session_unknown" // la session n'existe pas
  | "wrong_session_enclave" // la session est verrouillée sur une autre enclave
  | "wrong_operator"; // l'opérateur actif n'est pas celui attendu (session)

export class EnclaveKeyMismatchError extends Error {
  readonly code = "ENCLAVE_KEY_MISMATCH" as const;
  constructor(
    readonly reason: EnclaveKeyMismatchReason,
    readonly detail: string,
    readonly facts: { enclaveUrl: string; productId: bigint; signer?: Address; announcedX25519?: Hex; registeredX25519?: Hex; block?: bigint } ,
  ) {
    // une enclave injoignable n'est pas une « clé qui ne correspond pas » : même refus (on échoue fermé), message exact
    super(reason === "pubkeys_unreachable" ? `${ENCLAVE_UNREACHABLE_FR} (${detail})` : `${ENCLAVE_KEY_MISMATCH_FR} (${detail})`);
    this.name = "EnclaveKeyMismatchError";
  }
}

/** Clés d'une enclave CONFRONTÉES à la chaîne : la seule forme acceptée pour chiffrer vers une enclave. */
export interface VerifiedEnclaveKeys {
  readonly verified: true;
  enclaveUrl: string;
  productId: bigint;
  /** Clé de signature de l'enclave (signe les reçus et les réclamations). */
  signer: Address;
  /** Clé X25519 INSCRITE on-chain (= celle de /pubkeys) : chiffrer vers elle seulement. */
  x25519: Hex;
  /** Opérateur actif de cette enclave pour ce produit au bloc de la vérification. */
  operator: Address;
  workloadId: Hex;
  tcbStatus: number;
  /** Fenêtre de validité en cours (blocs) : les reçus ancrés dedans sont réglables jusqu'à la fin de la grâce. */
  fromBlock: bigint;
  untilBlock: bigint;
  /** Bloc de tête auquel la chaîne a été lue. */
  checkedAtBlock: bigint;
  /** Horloge locale (ms) de la vérification : pour la refaire de temps en temps. */
  checkedAtMs: number;
}

export interface VerifyEnclaveKeysOptions {
  publicClient: PublicClient;
  deployment?: Deployment;
  /** Pour une session : son enclave verrouillée (Session.enclave). Le signataire de /pubkeys doit être celui-ci. */
  expectedSigner?: Address;
  /** Pour une session : son opérateur (Session.operator). */
  expectedOperator?: Address;
  /** Raccourci : lit SessionPay.getSession(sessionId) et applique expectedSigner, expectedOperator et le produit. */
  sessionId?: bigint;
  /** fetch à utiliser (tests, environnements sans fetch global). */
  fetch?: typeof fetch;
  /** Délai de /pubkeys (ms, défaut 15 000). */
  timeoutMs?: number;
}

const lower = (x: string) => x.toLowerCase();
const base = (u: string) => u.replace(/\/+$/, "");

/** GET {enclaveUrl}/pubkeys, sans aucune confiance : { signer, x25519 } bien formés, sinon EnclaveKeyMismatchError. */
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
 * Lit /pubkeys et le confronte à l'EnclaveRegistry (voir l'en-tête). Rend des clés vérifiées, ou lève
 * EnclaveKeyMismatchError avec le message « la clé de l'enclave ne correspond pas à celle inscrite sur Arc : envoi refusé ».
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

  // Tout est lu AU MÊME BLOC (tête), pour qu'aucune réponse ne mélange deux états de la chaîne.
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

/** Garde de type : refuse tout objet qui n'est pas sorti de verifyEnclaveKeys (ex. une réponse brute de /pubkeys). */
export function assertVerifiedEnclaveKeys(k: unknown): asserts k is VerifiedEnclaveKeys {
  const v = k as Partial<VerifiedEnclaveKeys> | undefined;
  if (!v || v.verified !== true || !v.signer || !v.x25519 || v.checkedAtBlock === undefined) {
    throw new EnclaveKeyMismatchError(
      "pubkeys_unreadable", "clés d'enclave non vérifiées on-chain (verifyEnclaveKeys d'abord)", { enclaveUrl: String(v?.enclaveUrl ?? "?"), productId: BigInt(v?.productId ?? 0n) },
    );
  }
}
