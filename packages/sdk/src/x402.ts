/** x402.ts — l'inférence privée payée À L'APPEL (rail x402, schéma « exact ») : pas de session, un appel = une requête
 *  chiffrée + une autorisation EIP-3009 du montant exact, réglée ensuite par X402Settler.settle sur le reçu de l'enclave.
 *
 *  Client (createX402Client) :
 *   1. vérifie la clé de l'enclave sur la chaîne (verifyEnclaveKeys : clé X25519 inscrite, enclave active pour le produit) ;
 *   2. lit le produit on-chain : réglé par X402Settler, actif, prix d'un appel (Product.price × 1) ;
 *   3. chiffre la requête (salée) vers la clé VÉRIFIÉE ; le nonce EIP-3009 = engagement sur cette requête (x402CallNonce) ;
 *   4. gère le 402 : les exigences de l'enclave sont CONFRONTÉES à la chaîne (payTo = X402Settler du déploiement, asset =
 *      USDC, montant = prix on-chain) — un mandataire qui détourne le paiement ou gonfle le prix est refusé, rien n'est
 *      signé — puis signe l'autorisation (domaine EIP-712 de l'USDC pris dans le déploiement, pas dans le 402) ;
 *   5. vérifie le reçu : signé par l'enclave vérifiée, pour ce produit, ce payeur, ce nonce, une unité, le hash de la
 *      requête envoyée et celui du texte reçu (lié à la requête) ; sinon le texte n'est pas rendu ; `settleable` dit si
 *      X402Settler.settle accepterait ce reçu (enclave active au bloc d'ancrage).
 *  Après l'envoi payé (correctif du 9/11, preuves 1 et 2 du vérificateur) : une réponse arrive par un mandataire (proxy du
 *  site, CDN, passerelle Phala) qui peut la garder et renvoyer autre chose. Donc :
 *   - TOUT échec (402 quel qu'il soit, 409, 429, 5xx, délai, coupure, réponse qui ne se vérifie pas) renvoie d'abord la
 *     requête IDENTIQUE (même enveloppe, même autorisation) quelques fois avec un délai : l'enclave est idempotente et rend
 *     la réponse gardée si l'appel a été servi, sans 2e appel ni 2e reçu ;
 *   - une NOUVELLE autorisation n'est signée que si le prix LU ON-CHAIN a réellement changé (jamais sur la seule foi d'un
 *     402 non authentifié), et pour la MÊME requête : même nonce EIP-3009, donc au plus UNE des autorisations peut être
 *     consommée on-chain (un 409 « nonce_reused » dit alors laquelle l'enclave a servie : le client la renvoie) ;
 *   - JAMAIS À UN PRIX PLUS ÉLEVÉ sans accord explicite (9/11 au soir, preuve E3) : le plafond de l'appel (maxPrice) vaut
 *     le prix lu au début de l'appel ; un prix monté au-delà donne X402ChallengeError (avant tout paiement, rien n'est
 *     signé) ou X402PaidCallError « price_increased » (après), avec `newPrice` ; l'accepter :
 *     client.resume(err.pending, { renew: true, maxPrice: err.newPrice }). Un prix BAISSÉ est signé seul (moins cher) ;
 *   - si rien n'aboutit : X402PaidCallError. Elle ne dit JAMAIS « rien n'est dû » (l'appel a PU être servi et PEUT être
 *     réglé) et porte l'enveloppe, la clé éphémère et les autorisations : client.resume(err.pending) reprend (même
 *     requête), client.cancelAuthorization(err.pending) annule on-chain (USDC.cancelAuthorization) tant que rien n'est réglé.
 *     Après un redémarrage de l'enclave (code « enclave_changed »), la réponse est PERDUE : le message ne conseille plus
 *     resume, il dit que le paiement a pu être réglé quand même.
 *  Le règlement est fait par l'opérateur (X402SettlementQueue, services/registrar) ; le payeur peut aussi régler lui-même
 *  (settle) : le contrat ne paie que l'opérateur actif de l'enclave, l'auteur et le réseau. Le registrar signale à
 *  l'enclave ce qui est consommé par un message SIGNÉ de la clé de l'opérateur (EIP-712, x402AckTypes), en disant pour
 *  chaque appel s'il a été RÉGLÉ par X402Settler (reçu de sa transaction, ou événement CallSettled) ou consommé autrement
 *  (annulé) : seul un règlement rend le payeur « connu » de l'enclave. Il relève toute la file par pages, règle d'abord
 *  les appels que le solde de leur payeur couvre, et ne revérifie qu'un nombre borné d'appels « non couverts » par passage.
 *
 *  Ces constructions doivent rester identiques à celles de l'enclave (enclave/src/services/x402.ts) : un test croisé les
 *  vérifie (enclave/test/x402-e2e.test.ts). */
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

// ---------------------------------------------------------------- le protocole (identique à l'enclave)

/** Unités facturées par appel : un appel coûte Product.price × 1 (X402Settler : montant = units × price). */
export const X402_UNITS_PER_CALL = 1n;
/** Étiquette de l'engagement du nonce. */
export const X402_CALL_TAG = "ARC-X402-CALL-v1";
/** Validité maximale d'une autorisation signée par ce client (s) : 1 h. */
export const X402_MAX_VALIDITY_SECONDS = 3600;
/** Code x402 du 402 « montant de l'autorisation ≠ prix » (le prix on-chain a pu changer). */
export const X402_PRICE_CHANGED = "invalid_exact_evm_payload_authorization_value";
/** Délais (ms) des renvois à l'identique après un envoi payé sans réponse vérifiée : 3 renvois. */
export const X402_PAID_RETRY_DELAYS_MS: readonly number[] = [300, 1000, 2500];
/** Au plus ce nombre de nouvelles autorisations (prix on-chain changé) pour une même requête. */
export const X402_MAX_REAUTHORIZATIONS = 2;

/** USDC d'Arc : ce que le rail x402 lit en plus de l'ERC-20 (EIP-3009). */
export const usdcAuthAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

/** USDC (FiatToken v2.2, EIP-3009) : annulation d'une autorisation pas encore consommée, deux variantes (v, r, s ; bytes).
 *  Les deux variantes de FiatToken v2.2 : le client essaie (v, r, s) puis bytes, en simulation d'abord. */
export const usdcCancelAbi = parseAbi([
  "function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function cancelAuthorization(address authorizer, bytes32 nonce, bytes signature)",
]);

/** EIP-3009 : le message signé par le payeur pour annuler son autorisation (domaine EIP-712 de l'USDC). */
export const cancelAuthorizationTypes = {
  CancelAuthorization: [
    { name: "authorizer", type: "address" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// ---------------------------------------------------------------- signalement de l'opérateur à l'enclave (POST /x402/settled)

/** Au plus ce nombre d'items par signalement (l'enclave refuse au-delà). */
export const X402_ACK_MAX_ITEMS = 200;

/** Le signalement « appels consommés on-chain », signé par l'opérateur : identique à enclave/src/services/x402-ack.ts.
 *  `settled` (9/11 au soir) : true = réglé par X402Settler (reçu de la transaction de l'opérateur, ou événement
 *  CallSettled) ; false = consommé autrement (annulé par le payeur). Seul true rend le payeur « connu » de l'enclave. */
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

/** Domaine EIP-712 du signalement (distinct de celui des reçus) : chaîne et X402Settler du déploiement. Version 2 depuis
 *  l'ajout de `settled` (9/11 au soir). */
export function x402AckDomain(settler: Address, chainId: number): TypedDataDomain {
  return { name: "ArcEnclaveNetwork x402 ack", version: "2", chainId, verifyingContract: settler };
}

/** Un appel signalé : consommé on-chain, et réglé par X402Settler (`settled`) ou non. */
export interface X402AckItem { payer: Address; nonce: Hex; settled: boolean }

export interface X402AckMessage {
  enclave: Address;
  productId: bigint;
  issuedAt: bigint;
  ackNonce: Hex;
  items: X402AckItem[];
}

/** Corps de POST /x402/settled pour un message signé. */
export function x402AckBody(m: X402AckMessage, signature: Hex) {
  return {
    enclave: m.enclave, productId: m.productId.toString(), issuedAt: Number(m.issuedAt), ackNonce: m.ackNonce,
    items: m.items.map((i) => ({ payer: i.payer, nonce: i.nonce, settled: i.settled })), signature,
  };
}

/** L'événement de X402Settler.settle : le payeur a réellement payé cet appel (nonce dans les données). */
export const callSettledEvent = parseAbiItem(
  "event CallSettled(uint256 indexed productId, address indexed payer, address indexed operator, uint256 amount, bytes32 nonce)",
);

/** Nom de réseau x402 d'une chaîne Arc. */
export function x402NetworkName(chainId: number): string {
  if (chainId === 5042002) return "arc-testnet";
  if (chainId === 5042) return "arc";
  return `eip155:${chainId}`;
}

/** Le nonce EIP-3009 d'un appel = keccak256(abi.encode("ARC-X402-CALL-v1", chainId, x402Settler, productId, enclave,
 *  keccak256(enc), keccak256(ciphertext), clientEphemeralPub)) : un paiement ne paie qu'UNE requête, pour une enclave. */
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

/** responseHash d'un appel = keccak256(abi.encode(requestHash, keccak256(texte UTF-8))) : lié à la requête (salée). */
export function x402ResponseHash(requestHash: Hex, text: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [requestHash, keccak256(toBytes(text))]));
}

/** Le reçu d'un appel (X402Settler.CallReceipt), signé par l'enclave dans le domaine EIP-712 de X402Settler. */
export const callReceiptTypes = {
  CallReceipt: [
    { name: "productId", type: "uint256" }, { name: "payer", type: "address" }, { name: "requestHash", type: "bytes32" },
    { name: "responseHash", type: "bytes32" }, { name: "units", type: "uint128" }, { name: "anchorBlock", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface CallReceipt {
  productId: bigint; payer: Address; requestHash: Hex; responseHash: Hex; units: bigint; anchorBlock: bigint;
  /** = le nonce de l'autorisation EIP-3009 du payeur (lie paiement et reçu). */
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
  if (typeof x !== "string" || !/^[0-9]{1,78}$/.test(x) || BigInt(x) > max) throw new Error(`${name} : entier décimal attendu`);
  return BigInt(x);
}
function hex32(x: unknown, name: string): Hex {
  if (typeof x !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(x)) throw new Error(`${name} : 32 octets hexadécimaux attendus`);
  return lower(x) as Hex;
}
function sig65(x: unknown, name: string): Hex {
  if (typeof x !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(x)) throw new Error(`${name} : signature de 65 octets attendue`);
  return lower(x) as Hex;
}

/** Reçu d'appel reçu en JSON (chaînes décimales, comme le rend l'enclave) → types du SDK ; lève si illisible. */
export function normalizeCallReceipt(j: any): CallReceipt {
  if (!j || typeof j !== "object") throw new Error("reçu d'appel absent");
  if (typeof j.payer !== "string" || !isAddress(j.payer, { strict: false })) throw new Error("payer : adresse attendue");
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

/** Signature ECDSA rendue canonique pour l'USDC (FiatToken) : v = 27/28 (certains portefeuilles rendent 0/1), s dans la
 *  moitié basse (sinon l'USDC refuse). Même signataire. Lève pour une signature qui n'est pas ECDSA 65 octets. */
export function normalizeEcdsaSignature(sig: Hex): Hex {
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) {
    throw new Error("expected a 65-byte ECDSA signature: this rail accepts EOA payers");
  }
  const r = sig.slice(2, 66);
  let s = BigInt(`0x${sig.slice(66, 130)}`);
  let v = parseInt(sig.slice(130, 132), 16);
  if (v < 27) v += 27;
  if (v !== 27 && v !== 28) throw new Error(`octet v de la signature inattendu (${v})`);
  if (s > SECP256K1_N / 2n) {
    s = SECP256K1_N - s;
    v = v === 27 ? 28 : 27;
  }
  return lower(`0x${r}${s.toString(16).padStart(64, "0")}${v.toString(16)}`) as Hex;
}

/** Ce qui empêcherait l'USDC d'accepter cette signature (null si canonique). */
export function eip3009SignatureProblem(sig: unknown): string | null {
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return "signature ECDSA de 65 octets attendue";
  const s = BigInt(`0x${sig.slice(66, 130)}`);
  const v = parseInt(sig.slice(130, 132), 16);
  if (BigInt(`0x${sig.slice(2, 66)}`) === 0n || s === 0n) return "signature nulle";
  if (s > SECP256K1_N / 2n) return "signature à s haut (refusée par l'USDC)";
  if (v !== 27 && v !== 28) return "octet v ≠ 27/28 (refusé par l'USDC)";
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

/** L'autorisation EIP-3009 signée par le payeur (ReceiveWithAuthorization vers X402Settler). */
export interface X402Authorization {
  from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex; signature: Hex;
}

/** En-tête X-PAYMENT : base64 du JSON (ASCII seulement : hexadécimal et décimaux). */
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

/** Le 402 de l'enclave ne correspond pas à la chaîne (payTo, actif, montant) ou au plafond du client : RIEN n'est signé.
 *  `price` : le prix on-chain a MONTÉ depuis le début de l'appel (`newPrice`) ; relancer l'appel l'accepte. */
export class X402ChallengeError extends Error {
  constructor(
    message: string,
    readonly reason: "amount" | "payTo" | "asset" | "network" | "product" | "cap" | "price" | "format" = "format",
    /** Nouveau prix d'un appel lu on-chain (raison « price »). */
    readonly newPrice?: bigint,
  ) {
    super(`paiement x402 refusé par le client : ${message}`);
    this.name = "X402ChallengeError";
  }
}
/** Refus de paiement (402) par l'enclave. Plus levée par le client depuis le 9/11 : un 402 reçu APRÈS l'envoi payé n'est
 *  pas authentifié (un mandataire peut l'écrire après que l'enclave a servi) → X402PaidCallError. Gardée pour l'API. */
export class X402PaymentRefusedError extends Error {
  constructor(readonly code: string, readonly detail: string) {
    super(`paiement refusé par l'enclave (${code})${detail ? ` : ${detail}` : ""}`);
    this.name = "X402PaymentRefusedError";
  }
}
/** La réponse ne vient pas de l'enclave vérifiée, ou pas pour CETTE requête et CE paiement : le texte n'est pas rendu.
 *  Après l'envoi payé, elle n'est pas levée seule : elle devient la cause (`cause`) d'une X402PaidCallError. */
export class X402ReceiptMismatchError extends Error {
  constructor(message: string) { super(`réponse refusée : ${message}`); this.name = "X402ReceiptMismatchError"; }
}
/** Échec AVANT tout envoi payé (sonde sans X-PAYMENT : 503, 429, 409, 413, 502, 504…) : rien n'a été signé, rien n'est
 *  dû. Après un envoi payé, le client lève X402PaidCallError, jamais celle-ci. */
export class X402CallError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "X402CallError"; }
}

/** Un appel PAYÉ (X-PAYMENT envoyé) resté sans réponse vérifiée : tout ce qu'il faut pour le reprendre ou l'annuler. */
export interface X402PaidRequest {
  /** URL de la passerelle utilisée (informatif : la reprise passe par celle du client). */
  enclaveUrl: string;
  productId: bigint;
  payer: Address;
  /** Signataire de l'enclave VÉRIFIÉE on-chain vers laquelle la requête est chiffrée (il signera le reçu). */
  enclave: Address;
  /** La requête chiffrée, telle qu'envoyée (son engagement est le nonce). */
  envelope: { enc: Hex; ciphertext: Hex; clientEphemeralPub: Hex };
  /** Clé privée X25519 éphémère (32 octets) : la SEULE qui ouvre la réponse. Secrète : ne pas journaliser. */
  ephemeralPrivateKey: Hex;
  /** keccak256 de la requête en clair (salée). */
  requestHash: Hex;
  /** Nonce EIP-3009 = engagement sur cette requête, COMMUN à toutes les autorisations ci-dessous. */
  nonce: Hex;
  /** La dernière autorisation envoyée. */
  authorization: X402Authorization;
  /** Toutes les autorisations signées pour cette requête (même nonce : au plus UNE peut être consommée on-chain). */
  authorizations: X402Authorization[];
  /** Les exigences x402 confrontées à la chaîne (réseau, payTo, asset, validité annoncée). */
  requirement: X402PaymentRequirements;
  /** Plafond d'un appel accepté pour CETTE requête : au-delà, aucune autorisation n'est signée sans accord explicite
   *  (resume(…, { maxPrice })). Défaut : le prix lu au début de l'appel (celui de la 1re autorisation). */
  maxPrice?: bigint;
}

/** Le plafond d'une requête payée : `maxPrice`, sinon le montant de sa 1re autorisation (le prix du début de l'appel). */
function priceCeilingOf(p: X402PaidRequest): bigint {
  return p.maxPrice ?? p.authorizations[0]?.value ?? p.authorization.value;
}

/**
 * Un X-PAYMENT a été envoyé et aucune réponse vérifiée n'est revenue (après les renvois à l'identique). L'enclave a PU
 * servir cet appel et l'opérateur PEUT le régler : rien ne permet de dire que rien n'est dû. `pending` (non énumérable :
 * il contient la clé éphémère) sert à reprendre (client.resume) ou à annuler (client.cancelAuthorization). `status`,
 * `code` et `serverDetail` sont ceux de la dernière réponse, NON authentifiés (un mandataire peut les écrire).
 * Codes du client : « enclave_changed » (l'enclave a redémarré : réponse perdue, reprise inutile), « price_increased »
 * (le prix on-chain a monté au-delà du plafond de l'appel : `newPrice`, à accepter explicitement), « price_above_cap »
 * (au-delà du plafond du client, maxAmount).
 */
export class X402PaidCallError extends Error {
  readonly paid = true as const;
  declare readonly pending: X402PaidRequest;
  constructor(
    /** Dernier statut HTTP (0 : pas de réponse : délai ou coupure). */
    readonly status: number,
    /** Dernier code (« timeout », « network_error », « receipt_mismatch », ou celui du serveur, non authentifié). */
    readonly code: string,
    pending: X402PaidRequest,
    /** Envois de la requête payée (renvois compris). */
    readonly attempts: number,
    /** Texte du serveur, NON authentifié : à ne pas afficher comme un fait. */
    readonly serverDetail?: string,
    cause?: unknown,
    /** Prix d'un appel lu ON-CHAIN au-dessus du plafond de l'appel (code « price_increased ») : rien n'a été signé à ce
     *  prix ; l'accepter : client.resume(err.pending, { renew: true, maxPrice: err.newPrice }). */
    readonly newPrice?: bigint,
  ) {
    const a = pending.authorization;
    const max = pending.authorizations.reduce((m, x) => (x.value > m ? x.value : m), 0n);
    const until = new Date(Number(a.validBefore) * 1000).toISOString();
    const head = `appel x402 payé, sans réponse vérifiée après ${attempts} envoi(s) de la même requête (dernier : ${code}${status ? `, HTTP ${status}` : ""}). `;
    const due = `au plus ${formatUsdc(max)} USDC, une seule fois : même nonce ${pending.nonce.slice(0, 10)}…, autorisation valable jusqu'à ${until}`;
    let message: string;
    if (code === "enclave_changed") {
      // la réponse vivait dans la mémoire de l'enclave : un redémarrage l'a effacée (preuve E6 du vérificateur)
      message =
        `appel x402 payé dont la réponse est PERDUE : l'enclave a redémarré (nouvelle clé), et la réponse qu'elle gardait en mémoire avec elle. ` +
        `Le paiement a PU être réglé quand même (l'opérateur relève les appels avant un redémarrage) : ${due}. ` +
        `Le savoir : USDC.authorizationState(payeur, nonce) on-chain. Tant que rien n'est réglé, client.cancelAuthorization(err.pending) l'annule ; ` +
        `une reprise (resume) ne rendra pas cette réponse.`;
    } else if (code === "price_increased" && newPrice !== undefined) {
      message =
        head +
        `Le prix d'un appel lu on-chain est monté à ${formatUsdc(newPrice)} USDC, au-delà du plafond de cet appel (${formatUsdc(priceCeilingOf(pending))} USDC) : ` +
        `rien n'a été signé à ce prix. L'enclave a PU servir cet appel sous l'autorisation déjà envoyée (${due}) : ` +
        `client.resume(err.pending) la renvoie telle quelle (l'enclave rend la réponse si elle l'a servie). Accepter le nouveau prix : ` +
        `client.resume(err.pending, { renew: true, maxPrice: err.newPrice }) ; sinon, annuler tant que rien n'est réglé : client.cancelAuthorization(err.pending).`;
    } else {
      message =
        head +
        `L'enclave a PU servir cet appel et l'opérateur PEUT le régler (${due}). Reprendre : client.resume(err.pending) ` +
        `(même requête, même autorisation : aucune 2e facturation ; l'enclave ne garde la réponse que jusqu'à ${until}, et seulement si elle ne ` +
        `redémarre pas) ; annuler tant que rien n'est réglé : client.cancelAuthorization(err.pending).`;
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

/** X402PaidRequest → JSON (entiers en chaînes) : pour reprendre plus tard (contient la clé éphémère : à garder secret). */
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

/** L'inverse de serializeX402PaidRequest (lève si illisible). */
export function parseX402PaidRequest(json: string): X402PaidRequest {
  const j = JSON.parse(json);
  if (!j || j.v !== 1) throw new Error("appel payé illisible (version 1 attendue)");
  const addr = (x: unknown, n: string): Address => {
    if (typeof x !== "string" || !isAddress(x, { strict: false })) throw new Error(`${n} : adresse attendue`);
    return getAddress(lower(x));
  };
  const hex = (x: unknown, n: string, bytes?: number): Hex => {
    if (typeof x !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(x) || (bytes !== undefined && x.length !== 2 + 2 * bytes)) throw new Error(`${n} : hexadécimal attendu`);
    return lower(x) as Hex;
  };
  const auth = (x: any, n: string): X402Authorization => ({
    from: addr(x?.from, `${n}.from`), to: addr(x?.to, `${n}.to`), value: dec(x?.value, `${n}.value`, MAX_U256),
    validAfter: dec(x?.validAfter, `${n}.validAfter`, MAX_U256), validBefore: dec(x?.validBefore, `${n}.validBefore`, MAX_U256),
    nonce: hex32(x?.nonce, `${n}.nonce`), signature: sig65(x?.signature, `${n}.signature`),
  });
  if (!Array.isArray(j.authorizations) || j.authorizations.length === 0) throw new Error("authorizations : au moins une");
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

// ---------------------------------------------------------------- le client

export interface X402ClientOptions {
  /** La passerelle du produit x402, en direct ou derrière un mandataire : ses clés sont vérifiées on-chain. */
  enclaveUrl: string;
  /** Le produit payé à l'appel (réglé par X402Settler). */
  productId: bigint;
  /** Le portefeuille du payeur : il signe l'autorisation EIP-3009 (aucune transaction pour payer). */
  walletClient: WalletClient;
  account?: Account;
  /** Lectures on-chain (défaut : le walletClient étendu des actions publiques). */
  publicClient?: PublicClient;
  deployment?: Deployment;
  fetch?: typeof fetch;
  /** Revérifier les clés de l'enclave on-chain au plus tard après ce délai (ms, défaut 5 min). */
  reverifyMs?: number;
  /** Plafond par appel (unités de base d'USDC) : au-delà, rien n'est signé. */
  maxAmount?: bigint;
  /** Validité voulue de l'autorisation (s) ; défaut : celle annoncée par le 402 ; toujours bornée à [60 s, 1 h]. */
  validitySeconds?: number;
  /** Si donné : le produit doit épingler ce modèle (Product.param = keccak256 de l'identifiant). */
  expectedModel?: string;
  /** Délai d'une requête HTTP (ms, défaut 180 000). */
  timeoutMs?: number;
  /** Après un envoi payé sans réponse vérifiée : délais (ms) des renvois de la requête IDENTIQUE (défaut 300, 1 000,
   *  2 500 : trois renvois). [] = aucun renvoi (la reprise reste possible par resume). */
  paidRetryDelaysMs?: readonly number[];
}

export interface X402ProductInfo {
  id: bigint; price: bigint; pricePerCall: bigint; settlement: Address; param: Hex; active: boolean; author: Address;
}

export interface X402Completion {
  text: string;
  receipt: CallReceipt;
  /** Signature EIP-712 du reçu par l'enclave (domaine X402Settler). */
  signature: Hex;
  /** L'enclave vérifiée on-chain qui a signé. */
  signer: Address;
  /** Opérateur actif de l'enclave au bloc d'ancrage (adresse nulle : reçu non réglable). */
  operator: Address;
  /** Ce que le payeur a autorisé (USDC, 6 décimales) : prélevé au règlement. */
  amount: bigint;
  authorization: X402Authorization;
  /** keccak256 de la requête en clair envoyée (JSON salé). */
  requestHash: Hex;
  /** X402Settler.settle accepterait ce reçu (enclave active au bloc d'ancrage). */
  settleable: boolean;
  /** La lecture de l'opérateur actif a échoué (RPC) : `settleable` n'est pas connu (le texte est quand même vérifié). */
  settleableUnknown?: true;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** Vrai si l'enclave a rendu la réponse déjà servie pour cette requête (reprise idempotente). */
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
    // appelée comme fonction, jamais comme méthode : dans un navigateur, fetch appelé avec `this` = ce client lève
    // « Illegal invocation » (Node l'accepte, les tests ne le voyaient pas : vérification navigateur du 9/11)
    this.f = o.fetch ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => globalThis.fetch(input, init));
    const account = o.account ?? o.walletClient.account;
    if (!account) throw new Error("x402 : walletClient sans compte (passer `account`)");
    this.account = account;
    this.pub = o.publicClient ?? (o.walletClient.extend(publicActions) as unknown as PublicClient);
    if (!this.d.x402Settler || lower(this.d.x402Settler) === zeroAddress) throw new Error("x402 : déploiement sans X402Settler");
  }

  /** Le payeur. */
  get address(): Address { return this.account.address; }

  private base() { return this.o.enclaveUrl.replace(/\/+$/, ""); }

  /** Les clés de l'enclave, vérifiées on-chain pour ce produit (refait après `reverifyMs`). */
  async verifiedKeys(force = false): Promise<VerifiedEnclaveKeys> {
    const maxAge = this.o.reverifyMs ?? 5 * 60_000;
    if (!force && this.keys && Date.now() - this.keys.checkedAtMs < maxAge) return this.keys;
    this.keys = await verifyEnclaveKeys(this.o.enclaveUrl, this.o.productId, { publicClient: this.pub, deployment: this.d, fetch: this.f });
    return this.keys;
  }

  /** Le produit, lu on-chain : il doit se payer à l'appel (X402Settler), être actif, avoir un prix. */
  async product(): Promise<X402ProductInfo> {
    const id = this.o.productId;
    const [p, active] = (await Promise.all([
      this.pub.readContract({ address: this.d.productRegistry, abi: productRegistryAbi, functionName: "getProduct", args: [id] }),
      this.pub.readContract({ address: this.d.productRegistry, abi: productRegistryAbi, functionName: "isActive", args: [id] }),
    ])) as [{ author: Address; price: bigint; settlement: Address; param: Hex }, boolean];
    if (!active) throw new X402ChallengeError(`produit #${id} inactif`, "product");
    if (lower(p.settlement) !== lower(this.d.x402Settler)) {
      throw new X402ChallengeError(`le produit #${id} ne se paie pas à l'appel : il se règle par ${p.settlement}, pas par X402Settler ${this.d.x402Settler}`, "product");
    }
    if (p.price <= 0n) throw new X402ChallengeError(`produit #${id} sans prix`, "product");
    if (this.o.expectedModel && lower(p.param) !== lower(keccak256(toBytes(this.o.expectedModel)))) {
      throw new X402ChallengeError(`le produit #${id} épingle le modèle ${p.param}, pas « ${this.o.expectedModel} »`, "product");
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
      throw new X402ChallengeError(`un appel coûte ${amount} (prix on-chain du produit #${productId}), au-dessus du plafond ${this.o.maxAmount} de ce client`, "cap");
    }
  }

  private async create(req: ChatRequest): Promise<X402Completion> {
    if (!req || !Array.isArray(req.messages) || req.messages.length === 0) throw new Error("x402 : au moins un message");
    const keys = await this.verifiedKeys();
    let product = await this.product();
    this.assertCap(product.pricePerCall, product.id);
    // le plafond de CET appel : le prix lu au début ; rien de plus cher n'est signé sans accord explicite (preuve E3)
    const maxPrice = product.pricePerCall;

    // la requête en clair, SALÉE (son hash part on-chain au règlement), chiffrée vers la clé X25519 VÉRIFIÉE on-chain
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

    // 1) sans paiement (rien n'est signé) : le 402 et ses exigences, CONFRONTÉES à la chaîne (le 402 traverse un mandataire)
    let requirement: X402PaymentRequirements;
    try {
      requirement = await this.probe(envelope, product.pricePerCall);
    } catch (e) {
      if (!(e instanceof X402ChallengeError && e.reason === "amount")) throw e;
      // le prix a pu changer entre notre lecture et le 402 : on relit la chaîne ; inchangé, le 402 ment (un mandataire
      // qui gonfle le prix) et rien n'est signé ; MONTÉ, rien n'est signé non plus (relancer l'appel accepte le nouveau
      // prix) ; baissé, on redemande UNE fois le 402, confronté au nouveau prix
      const fresh = await this.product();
      if (fresh.pricePerCall === product.pricePerCall) throw e;
      if (fresh.pricePerCall > maxPrice) {
        throw new X402ChallengeError(
          `le prix d'un appel est monté pendant l'appel (${product.pricePerCall} → ${fresh.pricePerCall}, lu on-chain) : rien n'est signé ; relancer l'appel pour accepter le nouveau prix`,
          "price",
          fresh.pricePerCall,
        );
      }
      this.assertCap(fresh.pricePerCall, fresh.id);
      product = fresh;
      requirement = await this.probe(envelope, product.pricePerCall);
    }

    // 2) l'autorisation EIP-3009 : montant exact, vers X402Settler, nonce = engagement sur CETTE requête
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

    // 3) la requête payée (renvois à l'identique, nouvelle autorisation seulement sur prix on-chain changé, jamais au-delà
    //    du plafond de l'appel)
    return this.sendPaid(pending);
  }

  /** Requête SANS paiement : le 402 et ses exigences confrontées à la chaîne (rien n'est signé, rien n'est dû). */
  private async probe(envelope: X402PaidRequest["envelope"], amount: bigint): Promise<X402PaymentRequirements> {
    const res = await this.post(envelope);
    if (res.status !== 402) {
      if (res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new X402CallError(res.status, "unexpected_free_response", "l'enclave a répondu sans exiger de paiement : réponse ignorée (ce n'est pas un produit x402)");
      }
      throw await callErrorOf(res);
    }
    return this.checkChallenge(await res.json().catch(() => null), amount);
  }

  /**
   * Reprend un appel payé resté sans réponse vérifiée (X402PaidCallError.pending, ou parseX402PaidRequest) : renvoie la
   * MÊME requête avec la MÊME autorisation ; si l'enclave l'a servie, elle rend la réponse gardée (replay), sans 2e appel
   * au modèle ni 2e reçu. `renew` : signe d'abord une autorisation fraîche (prix on-chain actuel, nouvelle échéance) pour
   * le MÊME nonce, utile quand l'ancienne approche de son échéance : au plus une des deux peut être consommée on-chain.
   * `maxPrice` : le plafond accepté pour cette requête (défaut : celui de l'appel, le prix lu à son début) ; c'est la
   * seule façon d'accepter un prix monté (X402PaidCallError « price_increased », `newPrice`).
   * Lève X402PaidCallError si rien n'aboutit (l'objet `pending` d'origine n'est pas modifié).
   */
  async resume(p: X402PaidRequest, o: { renew?: boolean; maxPrice?: bigint } = {}): Promise<X402Completion> {
    if (!p || !Array.isArray(p.authorizations) || p.authorizations.length === 0 || !p.authorization) throw new Error("x402 : reprise sans autorisation");
    if (lower(p.payer) !== lower(this.account.address)) throw new Error(`x402 : appel payé par ${p.payer}, pas par ce client (${this.account.address})`);
    if (p.productId !== this.o.productId) throw new Error(`x402 : appel du produit #${p.productId}, client du produit #${this.o.productId}`);
    if (o.maxPrice !== undefined && (typeof o.maxPrice !== "bigint" || o.maxPrice <= 0n)) throw new Error("x402 : maxPrice : montant positif (bigint) attendu");
    const ceiling = o.maxPrice ?? priceCeilingOf(p);
    const q: X402PaidRequest = { ...p, authorizations: [...p.authorizations], maxPrice: ceiling };
    // clés relues (pas le cache) : l'enclave a pu redémarrer ; injoignable, on renvoie quand même (erreur d'appel payé)
    const keys = await this.verifiedKeys(true).catch(() => null);
    if (keys && lower(keys.signer) !== lower(q.enclave)) {
      // l'enclave a changé de clé (redémarrage) : sa file en mémoire, et la réponse, sont perdues ; l'appel reste
      // réglable si l'opérateur l'a relevé avant le redémarrage
      throw new X402PaidCallError(0, "enclave_changed", q, 0, `l'URL sert maintenant l'enclave ${keys.signer}, la requête était chiffrée pour ${q.enclave}`);
    }
    if (o.renew) {
      const product = await this.product();
      this.assertCap(product.pricePerCall, product.id);
      if (product.pricePerCall > ceiling) {
        // jamais plus cher sans accord explicite : rien n'est signé ; l'accepter : resume(…, { renew: true, maxPrice })
        throw new X402PaidCallError(0, "price_increased", q, 0, `prix on-chain ${product.pricePerCall} au-dessus du plafond ${ceiling} de cet appel`, undefined, product.pricePerCall);
      }
      const a = await this.authorize(q.requirement, q.nonce, product.pricePerCall);
      q.authorizations.push(a);
      q.authorization = a;
    }
    return this.sendPaid(q);
  }

  /**
   * Annule on-chain l'autorisation d'un appel payé (USDC.cancelAuthorization, EIP-3009) : toutes les autorisations de la
   * requête partagent ce nonce, toutes deviennent inutilisables. Le payeur envoie la transaction (gaz). Lève si
   * l'autorisation est déjà consommée (réglée, ou déjà annulée). À n'utiliser que si la réponse est perdue : l'opérateur
   * qui a servi l'appel n'est alors pas payé.
   */
  async cancelAuthorization(p: Pick<X402PaidRequest, "nonce"> & { payer?: Address }): Promise<Hex> {
    const authorizer = this.account.address;
    if (p.payer && lower(p.payer) !== lower(authorizer)) throw new Error(`x402 : l'autorisation est celle de ${p.payer}, pas de ce client (${authorizer})`);
    const used = (await this.pub.readContract({
      address: this.d.usdc, abi: usdcAuthAbi, functionName: "authorizationState", args: [authorizer, p.nonce],
    })) as boolean;
    if (used) throw new Error("x402 : cette autorisation est déjà consommée on-chain (réglée, ou déjà annulée) : rien à annuler");
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
      throw new Error("x402 : paidRetryDelaysMs : au plus 10 délais, chacun entre 0 et 60 000 ms");
    }
    return d;
  }

  /**
   * L'envoi payé et ses renvois. Chaque échec renvoie d'abord la requête IDENTIQUE (même enveloppe, même autorisation)
   * après un délai. Deux exceptions, sans rien croire du serveur :
   *  - 402 « prix changé » ET prix lu on-chain ≠ montant autorisé (après au moins un renvoi à l'identique) : une
   *    nouvelle autorisation pour le MÊME nonce (au plus X402_MAX_REAUTHORIZATIONS), seulement si ce prix ne dépasse pas
   *    le plafond de l'appel (le prix lu à son début, ou celui accepté par resume) ; au-delà, on s'arrête :
   *    X402PaidCallError « price_increased » avec `newPrice` (preuve E3 : un mandataire qui cache la réponse pendant que
   *    l'auteur monte le prix ne fait plus signer ×100) ;
   *  - 409 « nonce_reused » alors que plusieurs autorisations existent : l'enclave a servi cette requête sous une autre de
   *    nos autorisations (même nonce) : on renvoie celle-là (reprise idempotente).
   * Si rien n'aboutit : X402PaidCallError (l'appel a PU être servi).
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
            last = { ...last, code: "price_above_cap", detail: `prix on-chain ${fresh.pricePerCall} au-dessus du plafond ${this.o.maxAmount} de ce client`, newPrice: fresh.pricePerCall };
            break;
          }
          const ceiling = priceCeilingOf(p);
          if (fresh.pricePerCall > ceiling) {
            last = { ...last, code: "price_increased", detail: `prix on-chain ${fresh.pricePerCall} au-dessus du plafond ${ceiling} de cet appel`, newPrice: fresh.pricePerCall };
            break;
          }
          const a = await this.authorize(p.requirement, p.nonce, fresh.pricePerCall); // MÊME nonce
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

  /** Un envoi payé : la complétion vérifiée, ou ce qui a échoué (jamais d'exception : rien n'est perdu de l'appel). */
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
    if (!j || j.x402Version !== 1 || !Array.isArray(j.accepts)) throw new X402ChallengeError("réponse 402 illisible (x402 v1 attendu)");
    const net = x402NetworkName(this.d.chainId);
    const r = j.accepts.find((a: any) => a?.scheme === "exact" && a?.network === net);
    if (!r) throw new X402ChallengeError(`aucune exigence « exact » sur le réseau ${net}`, "network");
    if (typeof r.payTo !== "string" || lower(r.payTo) !== lower(this.d.x402Settler)) {
      throw new X402ChallengeError(`payTo ${String(r.payTo)} n'est pas X402Settler (${this.d.x402Settler}) : rien n'est signé (mandataire qui détourne le paiement ?)`, "payTo");
    }
    if (typeof r.asset !== "string" || lower(r.asset) !== lower(this.d.usdc)) {
      throw new X402ChallengeError(`asset ${String(r.asset)} n'est pas l'USDC du déploiement (${this.d.usdc})`, "asset");
    }
    if (String(r.maxAmountRequired) !== amount.toString()) {
      throw new X402ChallengeError(`montant demandé ${String(r.maxAmountRequired)} ≠ prix on-chain d'un appel (${amount})`, "amount");
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
      throw new X402ReceiptMismatchError("réponse incomplète (enc, ciphertext, receipt, signature attendus)");
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await hpkeOpen(x.ephPriv, toBytes(out.enc as Hex), toBytes(out.ciphertext as Hex)));
    } catch {
      throw new X402ReceiptMismatchError("réponse indéchiffrable avec la clé éphémère de cette requête");
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
    if (lower(signer) !== lower(x.signer)) throw new X402ReceiptMismatchError(`reçu signé par ${signer}, pas par l'enclave vérifiée ${x.signer}`);
    if (cr.productId !== this.o.productId) throw new X402ReceiptMismatchError(`reçu du produit #${cr.productId}, appel du produit #${this.o.productId}`);
    if (lower(cr.payer) !== lower(this.account.address)) throw new X402ReceiptMismatchError(`reçu au nom de ${cr.payer}, pas du payeur ${this.account.address}`);
    if (cr.nonce !== lower(x.nonce)) throw new X402ReceiptMismatchError("le reçu ne porte pas le nonce de ce paiement");
    if (cr.units !== X402_UNITS_PER_CALL) throw new X402ReceiptMismatchError(`le reçu compte ${cr.units} unités pour un appel (1 attendue)`);
    if (cr.requestHash !== lower(x.requestHash)) throw new X402ReceiptMismatchError("le reçu ne porte pas le hash de la requête envoyée");
    if (cr.responseHash !== lower(x402ResponseHash(x.requestHash, text))) throw new X402ReceiptMismatchError("le texte reçu n'est pas celui que l'enclave a signé");

    // réglable par X402Settler.settle ? (enclave active pour ce produit au bloc d'ancrage, grâce comprise) — lecture
    // informative : une panne RPC ici ne fait pas perdre une réponse payée et vérifiée
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

  /** Règle l'appel tout de suite (le payeur paie le gaz) : X402Settler.settle(reçu, signature, autorisation). Le contrat
   *  paie l'opérateur actif de l'enclave, l'auteur et le réseau ; un 2e règlement est impossible (nonce EIP-3009). */
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

  /** L'autorisation de cet appel est-elle consommée on-chain (réglée, ou annulée) ? */
  async isSettled(c: Pick<X402Completion, "receipt">): Promise<boolean> {
    return (await this.pub.readContract({
      address: this.d.usdc, abi: usdcAuthAbi, functionName: "authorizationState", args: [c.receipt.payer, c.receipt.nonce],
    })) as boolean;
  }
}

export function createX402Client(o: X402ClientOptions): X402Client {
  return new X402Client(o);
}

/** Échec de la SONDE (aucun X-PAYMENT envoyé) : rien n'a été signé, donc rien n'est dû. Jamais après un envoi payé. */
async function callErrorOf(res: Response): Promise<X402CallError> {
  const b = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return new X402CallError(
    res.status,
    String(b.code ?? `http_${res.status}`),
    `enclave x402 : HTTP ${res.status} ${b.error ?? ""} (avant tout paiement : aucune autorisation signée, rien n'est dû)`.replace(/\s+/g, " ").trim(),
  );
}

/** Un envoi payé qui n'a pas abouti (statut 0 : pas de réponse). `code` et `detail` viennent du serveur : non authentifiés,
 *  sauf « price_increased » / « price_above_cap » (le client, prix lu on-chain dans `newPrice`). */
interface PaidFailure { status: number; code: string; detail?: string; cause?: unknown; newPrice?: bigint }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- vérification on-chain d'un appel et règlement

/** Un appel servi, pas encore réglé : les arguments de X402Settler.settle (GET /x402/pending de l'enclave). */
export interface PendingCall {
  receipt: CallReceipt;
  signature: Hex;
  auth: { validAfter: bigint; validBefore: bigint; nonce: Hex; signature: Hex };
  amount?: bigint;
  servedAt?: number;
  /** Selon l'enclave (dernier relevé des soldes), le solde du payeur couvre cet appel ; false : « non couvert », réglé
   *  après les autres et revérifié en nombre borné par passage. Absent : couvert. */
  covered?: boolean;
}

/** Entrée de GET /x402/pending → PendingCall ; lève si illisible. */
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

/** Les arguments de X402Settler.settle(cr, enclaveSig, auth). */
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
  /** Signataire du reçu (domaine X402Settler). */
  signer: Address;
  /** Opérateur actif de ce signataire pour le produit au bloc d'ancrage (adresse nulle si aucun) : celui que settle paierait. */
  operator: Address;
  /** units × prix du produit : ce que settle prélèverait. */
  amount: bigint;
  checks: CallCheck[];
  /** Vrai si X402Settler.settle accepterait cet appel maintenant (hors exposition de la caution, vue à la simulation). */
  settleable: boolean;
  /** L'autorisation est déjà consommée (réglée, ou annulée par le payeur) : plus rien à faire. */
  alreadyUsed: boolean;
  /** L'autorisation est expirée (validBefore passé). */
  expired: boolean;
  head: bigint;
  /** Horodatage du bloc de tête (s). */
  now: bigint;
}

/** Vérifie un appel exactement comme X402Settler.settle et l'USDC le feront (lectures seulement, au bloc de tête). */
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

  // l'autorisation paie-t-elle EXACTEMENT ce montant à X402Settler, signée par le payeur, sous une forme que l'USDC accepte ?
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
  /** L'opérateur qui règle : seuls les appels qui le paient sont réglés (le contrat paie l'opérateur actif au bloc d'ancrage). */
  operator: Address;
  /** Relève les appels servis non réglés (GET /x402/pending de l'enclave, toutes les pages). */
  fetchPending: () => Promise<PendingCall[]>;
  /** Signale à l'enclave les appels consommés on-chain (POST /x402/settled, signé par l'opérateur ; l'enclave revérifie
   *  on-chain), chacun avec `settled` : RÉGLÉ par X402Settler (notre transaction réussie, ou l'événement CallSettled de
   *  ce nonce) ou consommé autrement (annulé par le payeur ; seul un règlement rend le payeur « connu » de l'enclave).
   *  Reçoit chaque clé une seule fois par passage ; un signalement en échec est renvoyé au passage suivant. */
  acknowledge?: (items: X402AckItem[]) => Promise<void>;
  /** Envoie X402Settler.settle et attend la transaction. */
  settle: (call: PendingCall) => Promise<X402SettleResult>;
  /** Plus de tentative à moins de ce délai (s) de l'échéance de l'autorisation (défaut 15). */
  minRemainingSeconds?: number;
  /** Après une transaction sans reçu dans le délai : pas de nouvel envoi pendant ce délai (ms, défaut 5 min). */
  coolDownMs?: number;
  /** Appels « non couverts » (selon le dernier relevé de l'enclave) revérifiés on-chain au plus par passage (défaut 25) :
   *  les appels couverts passent toujours d'abord ; les autres non couverts attendent, sans lecture, le passage suivant. */
  maxUncoveredChecks?: number;
  log?: (m: string) => void;
}

export interface X402SettlementReport {
  fetched: number;
  /** Appels encore suivis après ce passage (relevés et pas encore réglés). */
  known: number;
  settled: Array<{ payer: Address; nonce: Hex; amount: bigint; tx: Hex; gasUsed?: bigint }>;
  /** Déjà consommés on-chain (réglés par quelqu'un d'autre, ou annulés) : signalés à l'enclave, rien envoyé. */
  alreadySettled: number;
  /** Parmi eux, ceux dont aucun règlement par X402Settler n'est visible (annulés par le payeur, le plus souvent) :
   *  signalés « consommés autrement » (le payeur ne devient pas « connu »). */
  consumedElsewhere: number;
  /** Expirés avant d'avoir pu être réglés (perdus pour l'opérateur). */
  expired: number;
  /** Écartés définitivement (ne paieraient pas cet opérateur, ou incohérents). */
  dropped: number;
  waiting: Array<{ payer: Address; nonce: Hex; reasons: string[] }>;
  failed: Array<{ payer: Address; nonce: Hex; error: string }>;
  fetchError?: string;
}

/** Ce qui ne s'arrangera pas en attendant : l'appel est écarté. */
const PERMANENT: ReadonlySet<CallCheckId> = new Set<CallCheckId>(["settlement", "operator", "nonce"]);
/** Clés réglées par nos transactions, gardées en mémoire (pour les signaler « réglées » même relevées une 2e fois). */
const MAX_PAID_KEYS = 10_000;
/** Signalements en échec gardés pour le passage suivant, au plus. */
const MAX_UNACKED = 1_000;

/**
 * La file de règlement de l'opérateur, SANS DOUBLE RÈGLEMENT : un passage à la fois (deux appels simultanés de runOnce
 * partagent le même passage), un appel jamais envoyé deux fois en même temps, et chaque envoi précédé d'une vérification
 * on-chain (autorisation déjà consommée → rien n'est envoyé, l'enclave est prévenue). Le contrat l'interdit de toute façon
 * (nonce EIP-3009 à usage unique) ; ceci évite de payer du gaz pour une transaction qui échouerait. Les appels relevés
 * sont gardés jusqu'au règlement ou à l'échéance : un redémarrage de l'enclave ne les perd plus.
 * 9/11 au soir (preuves C et C2) : les appels COUVERTS (selon l'enclave) passent d'abord, échéance la plus proche
 * d'abord ; au plus maxUncoveredChecks appels « non couverts » sont revérifiés par passage : des impayables, même
 * nombreux et à échéance courte, ne retardent plus le règlement d'un payeur honnête.
 */
export class X402SettlementQueue {
  private known = new Map<string, PendingCall>();
  private inFlight = new Set<string>();
  private cooling = new Map<string, number>();
  /** Transaction envoyée sans reçu (délai) : son reçu dira plus tard si NOUS avons réglé l'appel. */
  private sentTx = new Map<string, Hex>();
  /** Clés réglées par nos transactions (réussies). */
  private paidKeys = new Map<string, number>();
  /** Signalements en échec, renvoyés au passage suivant. */
  private unacked = new Map<string, X402AckItem>();
  private running?: Promise<X402SettlementReport>;

  constructor(private o: X402SettlementQueueOptions) {}

  /** Appels relevés et pas encore réglés. */
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
      r.fetchError = (e as Error)?.message ?? String(e); // on règle quand même ce qui est déjà relevé
    }
    // une clé une seule fois (sans doublon) ; d'abord les signalements restés en échec au passage précédent
    const ack = new Map<string, X402AckItem>(this.unacked);
    const minLeft = BigInt(this.o.minRemainingSeconds ?? 15);
    const coolDown = this.o.coolDownMs ?? 5 * 60_000;
    const maxUncovered = this.o.maxUncoveredChecks ?? 25;
    const byDeadline = (a: PendingCall, b: PendingCall) => (a.auth.validBefore < b.auth.validBefore ? -1 : a.auth.validBefore > b.auth.validBefore ? 1 : 0);
    // les appels COUVERTS d'abord (dernier relevé de l'enclave), échéance la plus proche d'abord ; puis les autres
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
          // pas de lecture pour celui-ci à ce passage : échu (horloge locale), il sort ; sinon il attend
          if (call.auth.validBefore <= nowLocal + minLeft) {
            this.known.delete(key);
            this.cooling.delete(key);
            this.sentTx.delete(key);
            r.expired++;
          } else {
            r.waiting.push({ ...id, reasons: ["non couvert par le solde du payeur (dernier relevé de l'enclave) : revérifié à un prochain passage"] });
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
        // consommée : par un RÈGLEMENT X402Settler (le nôtre, ou celui d'un autre), ou annulée ? L'enclave ne rend le
        // payeur « connu » que dans le premier cas (preuves B et F)
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
        log(`appel ${key} : autorisation échue avant le règlement, ${v.amount} perdu pour l'opérateur`);
        continue;
      }
      const failing = v.checks.filter((c) => !c.ok);
      if (failing.length) {
        if (failing.some((c) => PERMANENT.has(c.id))) {
          this.known.delete(key);
          r.dropped++;
          log(`appel ${key} écarté : ${failing.map((c) => c.fr).join(" ; ")}`);
        } else {
          r.waiting.push({ ...id, reasons: failing.map((c) => c.fr) });
        }
        continue;
      }
      const since = this.cooling.get(key);
      if (since !== undefined && Date.now() - since < coolDown) {
        r.waiting.push({ ...id, reasons: ["transaction déjà envoyée, en attente de sa confirmation"] });
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
          ack.set(key, { ...id, settled: true }); // le reçu de NOTRE transaction : réglé par X402Settler
          r.settled.push({ ...id, amount: v.amount, tx: s.tx, ...(s.gasUsed !== undefined ? { gasUsed: s.gasUsed } : {}) });
        } else if (s.status === "timeout") {
          this.cooling.set(key, Date.now());
          this.sentTx.set(key, s.tx);
          r.waiting.push({ ...id, reasons: [`transaction ${s.tx} envoyée, sans reçu pour l'instant`] });
        } else {
          r.failed.push({ ...id, error: `transaction annulée on-chain (${s.tx})` });
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
        log(`signalement à l'enclave impossible : ${(e as Error)?.message ?? e} (renvoyé au passage suivant)`);
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
   * Une autorisation consommée l'a-t-elle été par un RÈGLEMENT X402Settler ? Oui si NOTRE transaction l'a réglée (gardé
   * en mémoire, ou reçu de la transaction restée sans réponse), ou si l'événement CallSettled de ce payeur, pour ce
   * produit, porte ce nonce (depuis le bloc d'ancrage du reçu : le payeur a pu régler lui-même). Sinon — annulée
   * (cancelAuthorization), ou lecture impossible — non : aucune confiance n'est accordée sur un doute.
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

/** La file de règlement branchée sur une enclave x402 (HTTP) et le portefeuille de l'opérateur (transactions). Elle relève
 *  TOUTE la file de l'enclave, page par page (GET /x402/pending?limit&offset ; 9/11 au soir : plus seulement les 200
 *  premiers). Le signalement à l'enclave (POST /x402/settled) est SIGNÉ par la clé de l'opérateur (EIP-712 x402AckTypes :
 *  enclave relue sur GET /x402/pending, produit, horodatage, nonce aléatoire, items avec `settled`), par lots de 200 :
 *  l'enclave refuse tout signalement qui n'est pas signé par une adresse de son OPERATOR_ALLOWLIST. */
export function createX402SettlementQueue(o: {
  enclaveUrl: string;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account?: Account;
  deployment?: Deployment;
  fetch?: typeof fetch;
  log?: (m: string) => void;
  /** Appels relevés par page (défaut 500, au plus 500). */
  limit?: number;
  /** Appels relevés au plus par passage, toutes pages confondues (défaut 10 000). */
  maxItems?: number;
  minRemainingSeconds?: number;
  /** Appels « non couverts » revérifiés au plus par passage (défaut 25). */
  maxUncoveredChecks?: number;
  /** Attente du reçu d'une transaction (ms, défaut 120 000). */
  receiptTimeoutMs?: number;
}): X402SettlementQueue {
  const d = o.deployment ?? testnet;
  const f = o.fetch ?? globalThis.fetch;
  const base = o.enclaveUrl.replace(/\/+$/, "");
  const account = o.account ?? o.walletClient.account;
  if (!account) throw new Error("x402 : walletClient sans compte (passer `account`)");
  // l'enclave et le produit à qui adresser le signalement (relus à chaque relevé : la clé change à chaque redémarrage) ;
  // non authentifiés, mais liés dans le message signé : une enclave qui n'est pas celle-ci le refuse
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
          break; // une page suivante en échec : on règle déjà ce qui est relevé (le reste au passage suivant)
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
        // fin : page incomplète, toute la file relevée, borne du passage, ou enclave qui ignore `offset` (une page)
        if (items.length < pageSize || j.offset !== offset || offset + items.length >= total || offset + items.length >= maxItems) break;
        offset += items.length;
      }
      return out;
    },
    acknowledge: async (items) => {
      if (!target) throw new Error("/x402/settled : enclave inconnue (aucun relevé de /x402/pending réussi)");
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
