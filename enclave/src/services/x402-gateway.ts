/**
 * x402-gateway.ts — le produit « inférence payée à l'appel » (rail x402, schéma « exact ») : pas de session, un appel =
 * une requête chiffrée + un paiement.
 *
 * Un appel = une requête chiffrée (HPKE vers la clé X25519 de l'enclave, comme sealed-chat) + un en-tête X-PAYMENT :
 * autorisation EIP-3009 ReceiveWithAuthorization du payeur vers X402Settler, du montant EXACT d'un appel
 * (Product.price × 1 unité). L'enclave :
 *  1. sans paiement : 402 et les exigences x402 (payTo = X402Settler, asset = USDC, prix lu on-chain, domaine EIP-712 de
 *     l'USDC) ; 503 si ses reçus ne seraient pas payés (produit inactif, réglé par un autre contrat, autre modèle épinglé,
 *     enclave non active, opérateur hors OPERATOR_ALLOWLIST) ;
 *  2. avec paiement : contrôles SANS la chaîne (schéma, réseau, payTo, montant exact, fenêtre de validité, signature
 *     canonique du payeur, nonce = engagement sur CETTE requête), puis AU MÊME BLOC (quorum RPC) : produit, enclave active
 *     chez son opérateur, autorisation jamais consommée, payeur sans code (EOA), solde couvrant TOUS ses appels non réglés
 *     chez cette enclave, capacité d'exposition de l'opérateur (règle d'OperatorBond.consumeExposure) ;
 *  3. réserve le montant (synchrone : aucune attente entre les derniers contrôles et la réservation), appelle le modèle,
 *     signe le CallReceipt (domaine X402Settler), chiffre la réponse vers la clé éphémère du client ;
 *  4. garde le triplet (reçu, signature, autorisation) EN ATTENTE pour l'opérateur (GET /x402/pending) jusqu'à ce que la
 *     chaîne dise l'autorisation consommée (POST /x402/settled, signé par l'opérateur et revérifié on-chain, ou le
 *     rapprochement ci-dessous) ou qu'elle expire.
 *
 * Garanties :
 *  - un couple (payeur, nonce) = au plus UN appel au modèle et UN reçu signé : des requêtes identiques concurrentes passent
 *    l'une après l'autre (verrou par clé) ; une requête identique rejouée avec la même autorisation reçoit la MÊME réponse
 *    (reprise idempotente, aucun 2e appel au modèle) ; une autre autorisation pour le même nonce est refusée (409) ;
 *  - rien n'est signé si le modèle échoue (502/504) : rien n'est dû, la même requête peut être renvoyée ;
 *  - l'enclave ne tient aucune clé de paiement et n'envoie aucune transaction : X402Settler.settle est appelé par
 *    l'opérateur (services/registrar) ou par n'importe qui — le contrat ne paie que l'opérateur actif de l'enclave.
 *
 * Limite assumée (règlement différé) : entre la réponse et le règlement, un payeur peut vider son solde ou annuler son
 * autorisation (cancelAuthorization) ; l'appel est alors perdu pour l'opérateur. MAX_PENDING_PER_PAYER ne borne que ce
 * qu'UN compte obtient ainsi par tour ; des comptes neufs ne coûtent rien (preuve 5 du vérificateur, 9/11). Correctifs :
 *  - autorisations courtes : le 402 annonce AUTH_VALIDITY_SECONDS − 60 s (840 s par défaut, 60 s d'écart d'horloge du
 *    client tolérées) et l'enclave refuse toute échéance au-delà de maintenant + AUTH_VALIDITY_SECONDS (900 s) : un appel
 *    impayable ne vit pas plus de 900 s (9/11 au soir : plus de « + 300 s ») ; registrar toutes les 10 s ;
 *  - au plus MAX_PENDING_PER_PAYER appels non réglés par payeur : 3 par défaut (9/11 au soir, au lieu de 20 : remplir la
 *    borne globale demande alors ≈ 100 comptes approvisionnés au lieu de 15) ;
 *  - RAPPROCHEMENT : avant de refuser faute de place (caution, file, fenêtre, limite ou solde d'un payeur), l'enclave relit
 *    par lots, au même bloc et avec un cache court, le solde et l'état des autorisations des payeurs qui ont des appels en
 *    attente : ce que la chaîne dit consommé sort de la file ; ce que le solde du payeur ne couvre plus est retiré du
 *    compte d'exposition (« non couvert » : il reste listé pour l'opérateur, qui le réglera si le payeur se renfloue).
 *    Des appels impayables ne bloquent donc plus la caution des payeurs honnêtes. Les lectures du rapprochement puisent
 *    dans un budget global (1 200 par minute par défaut) : un refus ne peut pas servir à multiplier les lectures RPC ;
 *  - FILE DE L'OPÉRATEUR (9/11 au soir, preuves C et C2) : GET /x402/pending relit d'abord les SOLDES des payeurs en
 *    attente (refreshCoverage : une lecture par payeur, dans le même budget, au plus une fois par reconcileCacheMs) et
 *    liste les appels COUVERTS d'abord, les « non couverts » ensuite ; elle se relève par pages (offset) : des impayables
 *    à échéance courte ne passent plus devant l'appel d'un payeur honnête. Limite connue : la route est publique et le
 *    relevé des soldes vaut 10 s ; un appel servi depuis le dernier relevé (puis vidé) reste listé « couvert » jusqu'au
 *    suivant, et un passage du registrar le revérifie (une lecture par appel) avant d'arriver à l'appel honnête ;
 *  - BORNE GLOBALE : au plus MAX_UNSETTLED_PER_WINDOW appels servis et dont le paiement n'est pas CONFIRMÉ sur
 *    UNSETTLED_WINDOW_SECONDS (300 sur 600 s par défaut) ; au-delà, 503 pour les payeurs sans règlement récent. Un appel
 *    n'en sort que quand l'opérateur signale l'avoir RÉGLÉ par X402Settler (signalement signé, revérifié on-chain) : un
 *    appel annulé (cancelAuthorization) ou consommé autrement y reste compté jusqu'à la fin de la fenêtre (9/11 au soir,
 *    preuve B : la borne est dure). Un payeur dont un appel a été RÉGLÉ par X402Settler depuis moins de 24 h (et sans
 *    appel « non couvert » ni annulé depuis) n'y est pas soumis ; une autorisation annulée, ou seulement vue consommée
 *    par le rapprochement, ne rend jamais un payeur « connu » (preuves B et F) ;
 *  - DÉBIT (9/11 au soir, preuves A et D) : chaque requête payée qui arrive jusqu'à la lecture paymentState (≈ 12 requêtes
 *    RPC par fournisseur) puise dans un seau à jetons GLOBAL (PAYMENT_READS_PER_MINUTE, 120 par défaut, rafale de 30) ;
 *    vide : 503 busy, sans lecture. Les payeurs « connus » ont leur propre seau, de même débit (un flot de clés neuves ne
 *    les bloque pas) ; un payeur « connu » dont la lecture montre un solde qui ne couvre plus l'appel (ou du code) perd ce
 *    statut : il ne peut pas vider ce seau. Les nouveaux payeurs ont en plus un plafond par adresse IP VUE par l'enclave
 *    (PAYMENT_READS_PER_MINUTE_PER_IP, 60 par défaut) : APPROXIMATIF, car derrière la passerelle Phala l'enclave voit la
 *    même adresse (celle de la passerelle) pour tout le monde ; il agit alors comme un second plafond global, plus bas.
 *    Limite connue : un flot de requêtes signées par des clés neuves (gratuites) vide le seau des nouveaux payeurs ; ils
 *    reçoivent alors 503 tant que dure le flot (les payeurs connus restent servis).
 * L'état vit en mémoire : un redémarrage perd les triplets que le registrar n'a pas encore relevés (il les garde de son
 * côté une fois relevés), et la liste des payeurs « connus ».
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

// ---------------------------------------------------------------- ce que l'enclave lit de la chaîne (injecté)

export interface X402ProductView {
  active: boolean;
  /** USDC (6 déc.) par unité ; un appel = X402_UNITS_PER_CALL unité. */
  price: bigint;
  settlement: Address;
  /** Modèle épinglé par le produit (keccak256 de son identifiant). */
  param: Hex;
  exposureCap: bigint;
}

export interface X402Status {
  block: bigint;
  product: X402ProductView;
  /** EnclaveRegistry.activeOperatorAt(enclave, produit, block) : adresse nulle si l'enclave n'est pas active. */
  operator: Address;
}

export interface X402PaymentState extends X402Status {
  /** USDC.authorizationState(payeur, nonce) : vrai si l'autorisation est déjà consommée (réglée ou annulée). */
  authorizationUsed: boolean;
  /** USDC.balanceOf(payeur). */
  balance: bigint;
  /** Le payeur a du code (contrat, ou EOA déléguée EIP-7702) : l'USDC vérifierait la signature par ERC-1271. */
  payerHasCode: boolean;
  /** Exposition encore permise à l'opérateur pour ce produit (OperatorBond), null si inconnue. */
  capacity: bigint | null;
}

/** Soldes et états d'autorisation lus AU MÊME BLOC (rapprochement, signalements de l'opérateur). */
export interface X402PendingSnapshot {
  block: bigint;
  /** USDC.balanceOf, clés = adresses en minuscules. */
  balances: Map<string, bigint>;
  /** USDC.authorizationState, clés = « payeur:nonce » en minuscules. */
  used: Map<string, boolean>;
}

export interface X402ChainReader {
  /** Le produit et l'opérateur actif de l'enclave, au même bloc. */
  status(enclave: Address, productId: bigint): Promise<X402Status>;
  /** Tout ce qu'il faut pour accepter un paiement, lu AU MÊME BLOC (chez tous les fournisseurs du quorum). */
  paymentState(q: { enclave: Address; productId: bigint; payer: Address; nonce: Hex }): Promise<X402PaymentState>;
  /** L'autorisation (payeur, nonce) est-elle consommée on-chain ? */
  authorizationUsed(payer: Address, nonce: Hex): Promise<boolean>;
  /**
   * Lecture GROUPÉE, au même bloc : soldes des payeurs et états de leurs autorisations. Facultative : sans elle, la
   * passerelle lit une à une (paymentState pour un solde, authorizationUsed pour une autorisation), en parallèle borné.
   */
  pendingState?(q: { payers: Address[]; auths: Array<{ payer: Address; nonce: Hex }> }): Promise<X402PendingSnapshot>;
}

// ---------------------------------------------------------------- le modèle (injecté)

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatModelRequest {
  messages: ChatMessage[];
  temperature?: number;
  /** Jetons de sortie, bornés par MAX_OUTPUT_TOKENS (le prix d'un appel est fixe). */
  maxTokens: number;
  seed?: number;
}

export interface ChatModelResult {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ChatModel {
  /** `signal` est déclenché quand la passerelle abandonne l'appel (délai dépassé). */
  complete(r: ChatModelRequest, signal: AbortSignal): Promise<ChatModelResult>;
}

// ---------------------------------------------------------------- erreurs, configuration, formats

export type X402HttpStatus = 400 | 401 | 402 | 403 | 409 | 413 | 429 | 502 | 503 | 504;

/** Refus rendu au client avec un code HTTP ; un 402 porte les exigences x402 à jour (`accepts`). */
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
  /** X402Settler : payTo des autorisations et domaine EIP-712 des reçus. */
  settler: Address;
  usdc: Address;
  /** Nom de réseau x402 (ex. « arc-testnet »). */
  network: string;
  /** Domaine EIP-712 de l'USDC (EIP-3009) : « USDC », « 2 » sur Arc. */
  usdcName: string;
  usdcVersion: string;
  /** keccak256 de l'identifiant du modèle réellement appelé ; doit être le `param` du produit. */
  modelHash: Hex;
  /** Libellé du modèle rendu au client (informatif). */
  modelLabel?: string;
  /**
   * Opérateurs pour lesquels cette enclave sert (OPERATOR_ALLOWLIST) ; ce sont aussi les seuls signataires acceptés de
   * POST /x402/settled. null/absent = non vérifié (développement : tout signataire).
   */
  operators?: readonly Address[] | null;
  /** Validité MAXIMALE acceptée des autorisations, en s à partir de l'horloge de l'enclave (défaut 900) ; le 402 annonce
   *  60 s de moins (maxTimeoutSeconds), pour tolérer l'écart d'horloge des clients. */
  authValiditySeconds?: number;
  /** Une autorisation doit rester valable au moins ce délai (s) pour être acceptée : le temps du règlement (défaut 600). */
  minSettleWindowSeconds?: number;
  /** Taille maximale de la requête en clair, en octets (défaut 32 768). */
  maxRequestBytes?: number;
  /** Plafond de jetons de sortie d'un appel (défaut 1 024) : le prix est fixe par appel. */
  maxOutputTokens?: number;
  /** Appels non encore réglés (ou en cours) par payeur (défaut 3). */
  maxPendingPerPayer?: number;
  /** Appels non réglés (ou en cours) au total (défaut 2 000) ; au-delà : 503. */
  maxStoredCalls?: number;
  /** Borne globale : appels servis et non réglés sur la fenêtre glissante (défaut 300) ; au-delà : 503 (sauf payeurs connus). */
  maxUnsettledPerWindow?: number;
  /** Fenêtre de la borne globale, en s (défaut 600). */
  unsettledWindowSeconds?: number;
  /** Délai maximal d'un appel au modèle, en ms (défaut 120 000). */
  modelTimeoutMs?: number;
  /** Exiger que le solde USDC du payeur couvre ses appels non réglés (défaut vrai). */
  checkBalance?: boolean;
  /** Durée de cache de l'état du produit et de l'enclave pour le 402, en ms (défaut 15 000 ; 0 = sans cache). */
  statusCacheMs?: number;
  /** Rapprochement de toute la file : au plus un par ce délai, en ms (défaut 10 000). */
  reconcileCacheMs?: number;
  /** Rapprochement d'un payeur : au plus un par ce délai et par payeur, en ms (défaut 3 000). */
  payerReconcileCacheMs?: number;
  /** Lectures on-chain au plus par rapprochement (défaut 256). */
  reconcileMaxReads?: number;
  /** Lectures on-chain par minute au plus pour TOUS les rapprochements (défaut 1 200) : un refus ne peut pas servir à
   *  multiplier les lectures RPC (chaque rapprochement prend ses lectures dans ce budget, sinon il n'a pas lieu). */
  reconcileReadsPerMinute?: number;
  /** Signalement de l'opérateur : âge maximal de son horodatage, en s (défaut 120). */
  ackMaxAgeSeconds?: number;
  /** Signalements signés acceptés par minute (défaut 30). */
  ackRequestsPerMinute?: number;
  /** Lectures on-chain par minute au plus pour les signalements (défaut 1 200). */
  ackReadsPerMinute?: number;
  /** Lectures paymentState (requêtes payées) par minute au plus, toutes adresses confondues (défaut 120, rafale du quart) :
   *  un seau pour les nouveaux payeurs, un autre, de même débit, pour les payeurs « connus ». Au-delà : 503 busy. */
  paymentReadsPerMinute?: number;
  /** Les mêmes lectures par minute au plus par adresse IP VUE par l'enclave, pour les nouveaux payeurs (défaut 60, rafale
   *  du tiers). Approximatif : derrière la passerelle Phala, tout le monde a l'adresse de la passerelle. Au-delà : 429. */
  paymentReadsPerMinutePerIp?: number;
  /** Horloge en secondes Unix (défaut : celle du processus). */
  now?: () => bigint;
  /** Journal (défaut : console.warn). Jamais de contenu de requête ni de réponse. */
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

/** Réponse d'un appel payé (la réponse du modèle est chiffrée vers la clé éphémère du client). */
export interface X402CallResponse {
  object: "x402.chat.completion";
  model: string;
  modelHash: Hex;
  enc: Hex;
  ciphertext: Hex;
  /** Le CallReceipt attendu par X402Settler.settle, signé par l'enclave (domaine X402Settler). */
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
    /** Le paiement est réglé plus tard par X402Settler.settle (par l'opérateur, ou par n'importe qui). */
    settlement: "deferred";
  };
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Un appel servi, pas encore réglé : exactement les arguments de X402Settler.settle(cr, enclaveSig, auth). */
export interface X402PendingItem {
  receipt: SerializedCallReceipt;
  signature: Hex;
  auth: { validAfter: string; validBefore: string; nonce: Hex; signature: Hex };
  amount: string;
  servedAt: number;
  /** Au dernier relevé des soldes, celui du payeur couvrait cet appel (faux : « non couvert », listé après les autres). */
  covered: boolean;
}

/** Résultat d'un signalement : clés sorties de la file (consommées on-chain), restées, inconnues ici. */
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
  /** « settled » : la chaîne dit l'autorisation consommée (réglée, ou annulée par le payeur). */
  state: "pending" | "settled";
  /** Au dernier rapprochement, le solde du payeur ne couvrait pas cet appel : hors du compte d'exposition. */
  uncovered: boolean;
  /**
   * Paiement CONFIRMÉ par l'opérateur (signalement signé) : true = réglé par X402Settler ; false = consommé autrement
   * (annulé par le payeur) ; absent = pas encore confirmé (en attente, ou vu consommé par le seul rapprochement). Seul
   * true sort l'appel de la borne globale et rend le payeur « connu ».
   */
  paid?: boolean;
}

/** Un refus de place, et ce qu'un rapprochement pourrait libérer (un payeur, ou toute la file). */
interface Refusal {
  scope: "payer" | "all";
  error: X402Error;
}

const L = (x: string) => x.toLowerCase();
const HEX_EVEN = /^0x(?:[0-9a-fA-F]{2})*$/;
const ROLES = new Set(["system", "user", "assistant"]);
/** Surcoût de ChaCha20-Poly1305 : le chiffré fait 16 octets de plus que le clair. */
const AEAD_TAG = 16;
/** Un payeur dont un appel a été RÉGLÉ par X402Settler (signalement de l'opérateur) reste « connu » ce délai (s) : il
 *  échappe à la borne globale. */
const TRUST_SECONDS = 86_400n;
const MAX_TRUSTED = 10_000;
/** Le 402 annonce une validité plus courte de ce délai (s) que la borne acceptée : écart d'horloge toléré du client. */
const AUTH_CLOCK_SKEW_SECONDS = 60;
/** Adresses IP suivies au plus par le plafond par IP (au-delà, la plus ancienne est oubliée). */
const MAX_IP_BUCKETS = 10_000;
/** Horodatage d'un signalement : avance tolérée sur l'horloge de l'enclave (s). */
const ACK_FUTURE_SKEW_SECONDS = 60n;
/** Lectures on-chain en parallèle au plus, quand le lecteur n'a pas de lecture groupée. */
const READ_CONCURRENCY = 8;

function positiveInt(v: number | undefined, dflt: number, name: string): number {
  const x = v ?? dflt;
  if (!Number.isSafeInteger(x) || x < 1) throw new Error(`${name} doit être un entier ≥ 1 (reçu ${v})`);
  return x;
}

function nonNegativeInt(v: number | undefined, dflt: number, name: string): number {
  const x = v ?? dflt;
  if (!Number.isSafeInteger(x) || x < 0) throw new Error(`${name} doit être un entier ≥ 0 (reçu ${v})`);
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

/** Un seau à jetons par clé (adresse IP vue), mémoire bornée : au-delà de `maxKeys`, la clé la plus ancienne est oubliée
 *  (elle repart d'un seau plein : on échoue ouvert pour elle, jamais fermé pour les autres). */
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

/** Enveloppe de la requête : { enc, ciphertext, clientEphemeralPub } en hexadécimal, tailles bornées. */
export function parseEnvelope(x: unknown, maxRequestBytes: number): CallEnvelope {
  const b = x as Record<string, unknown> | null;
  const bad = (m: string) => new X402Error(400, "invalid_envelope", `enveloppe invalide : ${m}`);
  if (!b || typeof b !== "object" || Array.isArray(b)) throw bad("{ enc, ciphertext, clientEphemeralPub } attendu");
  const { enc, ciphertext, clientEphemeralPub } = b;
  for (const [k, v] of Object.entries({ enc, ciphertext, clientEphemeralPub })) {
    if (typeof v !== "string" || !HEX_EVEN.test(v)) throw bad(`${k} : hexadécimal (octets entiers) attendu`);
  }
  const e = enc as string, c = ciphertext as string, p = clientEphemeralPub as string;
  if ((e.length - 2) / 2 !== 32) throw bad("enc : 32 octets attendus (HPKE X25519)");
  if ((p.length - 2) / 2 !== 32) throw bad("clientEphemeralPub : 32 octets attendus (X25519)");
  const ct = (c.length - 2) / 2;
  if (ct <= AEAD_TAG) throw bad("ciphertext trop court");
  if (ct > maxRequestBytes + AEAD_TAG) throw new X402Error(413, "request_too_large", `requête trop grande : au plus ${maxRequestBytes} octets en clair`);
  return { enc: L(e) as Hex, ciphertext: L(c) as Hex, clientEphemeralPub: L(p) as Hex };
}

/**
 * La requête en clair (JSON UTF-8) : { messages: [{ role, content }], temperature?, max_tokens?, seed?, salt? }.
 * `salt` (aléa du client, ignoré par le modèle) rend le requestHash publié au règlement impossible à deviner.
 */
export function parseChatRequest(plain: Uint8Array, maxOutputTokens: number): ChatModelRequest {
  const bad = (m: string) => new X402Error(400, "invalid_request", `requête invalide : ${m}`);
  let j: any;
  try {
    j = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
  } catch {
    throw bad("JSON UTF-8 attendu ({ messages, temperature?, max_tokens?, seed?, salt? })");
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw bad("objet JSON attendu");
  if (!Array.isArray(j.messages) || j.messages.length === 0 || j.messages.length > 64) throw bad("messages : de 1 à 64 messages");
  const messages: ChatMessage[] = [];
  for (const m of j.messages) {
    if (!m || typeof m !== "object" || !ROLES.has(m.role) || typeof m.content !== "string") {
      throw bad("chaque message : { role: system | user | assistant, content: texte }");
    }
    messages.push({ role: m.role, content: m.content });
  }
  let temperature: number | undefined;
  if (j.temperature !== undefined && j.temperature !== null) {
    if (typeof j.temperature !== "number" || !Number.isFinite(j.temperature) || j.temperature < 0 || j.temperature > 2) {
      throw bad("temperature : nombre entre 0 et 2");
    }
    temperature = j.temperature;
  }
  let maxTokens = maxOutputTokens;
  if (j.max_tokens !== undefined && j.max_tokens !== null) {
    if (!Number.isSafeInteger(j.max_tokens) || j.max_tokens < 1) throw bad("max_tokens : entier ≥ 1");
    maxTokens = Math.min(j.max_tokens, maxOutputTokens);
  }
  let seed: number | undefined;
  if (j.seed !== undefined && j.seed !== null) {
    if (!Number.isSafeInteger(j.seed)) throw bad("seed : entier");
    seed = j.seed;
  }
  return { messages, temperature, maxTokens, seed };
}

// ---------------------------------------------------------------- la passerelle

export class X402Gateway {
  private calls = new Map<string, StoredCall>();
  /** Appels en cours (montant réservé, pas encore signé). */
  private reserved = new Map<string, { payer: string; amount: bigint }>();
  /** Par payeur : appels non réglés + en cours chez cette enclave. */
  private load = new Map<string, { count: number; amount: bigint }>();
  /** Appels non réglés + en cours, au total. */
  private totalCount = 0;
  private locks = new KeyedMutex();
  private statusCache?: { at: number; value: X402Status };
  private statusInFlight?: Promise<X402Status>;
  private operators: Set<string> | null;
  private log: (m: string) => void;
  private now: () => bigint;
  /** Appels servis sur la fenêtre de la borne globale, du plus ancien au plus récent (l'état se lit sur l'appel). */
  private served: Array<{ at: bigint; call: StoredCall }> = [];
  /** Payeurs dont un appel a été RÉGLÉ par X402Settler récemment (signalement de l'opérateur ; aucun « non couvert » ni
   *  annulé depuis) → secondes Unix. */
  private trusted = new Map<string, bigint>();
  /** Payeurs ayant au moins un appel marqué « non couvert ». */
  private uncoveredPayers = new Set<string>();
  private reconcileAllAt = Number.NEGATIVE_INFINITY;
  private reconcileAllInFlight?: Promise<void>;
  private reconcilePayerAt = new Map<string, number>();
  private reconcilePayerInFlight = new Map<string, Promise<void>>();
  private coverageAt = Number.NEGATIVE_INFINITY;
  private coverageInFlight?: Promise<void>;
  /** Lectures d'autorisation en cours, partagées entre signalements concurrents (une lecture par clé). */
  private authInFlight = new Map<string, Promise<boolean | undefined>>();
  private ackReplay = new AckReplayGuard();
  private ackRequests: TokenBucket;
  private ackReads: TokenBucket;
  private reconcileReads: TokenBucket;
  /** Lectures paymentState des requêtes payées : nouveaux payeurs, payeurs « connus », et par adresse IP vue. */
  private newPayerReads: TokenBucket;
  private knownPayerReads: TokenBucket;
  private knownPerPayerReads: KeyedBuckets;
  private ipReads: KeyedBuckets;
  readonly limits: {
    authValiditySeconds: number;
    /** Validité annoncée par le 402 (maxTimeoutSeconds) : authValiditySeconds − 60 s d'écart d'horloge toléré. */
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
    if (!isAddress(cfg.settler) || !isAddress(cfg.usdc)) throw new Error("settler et usdc : adresses attendues");
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
      throw new Error("authValiditySeconds doit dépasser minSettleWindowSeconds d'au moins 120 s (sinon aucun client ne tombe dans la fenêtre)");
    }
    this.operators = cfg.operators ? new Set(cfg.operators.map(L)) : null;
    this.log = cfg.log ?? ((m) => console.warn(m));
    this.now = cfg.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
    // rafale : 1/6 de la minute (au moins 5 signalements, au moins un signalement plein de lectures)
    this.ackRequests = new TokenBucket(Math.max(5, Math.ceil(this.limits.ackRequestsPerMinute / 6)), this.limits.ackRequestsPerMinute / 60);
    this.ackReads = new TokenBucket(Math.max(X402_ACK_MAX_ITEMS, Math.ceil(this.limits.ackReadsPerMinute / 6)), this.limits.ackReadsPerMinute / 60);
    this.reconcileReads = new TokenBucket(2 * this.limits.reconcileMaxReads, this.limits.reconcileReadsPerMinute / 60);
    // requêtes payées : rafale d'un quart de minute (au moins 10) par seau global, d'un tiers (au moins 5) par IP
    const pm = this.limits.paymentReadsPerMinute;
    const ip = this.limits.paymentReadsPerMinutePerIp;
    this.newPayerReads = new TokenBucket(Math.max(10, Math.ceil(pm / 4)), pm / 60);
    this.knownPayerReads = new TokenBucket(Math.max(10, Math.ceil(pm / 4)), pm / 60);
    this.ipReads = new KeyedBuckets(Math.max(5, Math.ceil(ip / 3)), ip / 60, MAX_IP_BUCKETS);
    // 9/11 au soir (K2) : chaque payeur « connu » a aussi son propre petit seau (rafale 3, ≈ 1/6 du débit global) : une
    // rafale concurrente d'UN payeur connu ne vide plus le seau partagé des autres payeurs connus
    this.knownPerPayerReads = new KeyedBuckets(3, Math.max(1, pm / 6) / 60, MAX_IP_BUCKETS);
  }

  /** La clé de signature de cette enclave (signe les reçus, entre dans le nonce de chaque appel). */
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

  // ---------- état on-chain et exigences x402

  /** Produit + enclave (cache court) ; X402Error 503 si un reçu de cette enclave ne serait pas payé. */
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
      throw new X402Error(503, "chain_unavailable", "lecture on-chain impossible (quorum RPC) : rien n'est servi ni facturé, réessayez dans un instant");
    }
    this.statusCache = { at: Date.now(), value: st };
    this.assertPayable(st);
    return st;
  }

  /** Les exigences x402 d'un appel (le prix vient du produit on-chain). */
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
      // 60 s de moins que la borne acceptée : un client dont l'horloge avance d'une minute reste accepté
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

  /** Le 402 : exigences x402 du prochain appel (503 si l'enclave ne peut pas être payée). */
  async challenge(resource: string): Promise<PaymentRequirements[]> {
    return [this.requirementsFor(await this.status(), resource)];
  }

  private assertPayable(st: X402Status): void {
    const p = st.product;
    const no = (code: string, m: string) => new X402Error(503, code, `${m} : rien n'est servi ni facturé`);
    if (!p.active) throw no("product_inactive", `produit #${this.productId} inactif`);
    if (L(p.settlement) !== L(this.cfg.settler)) {
      throw no("wrong_settlement", `le produit #${this.productId} se règle par ${p.settlement}, pas par X402Settler ${this.cfg.settler} (WrongSettlement)`);
    }
    if (p.price <= 0n) throw no("zero_price", `produit #${this.productId} au prix 0 (ZeroAmount)`);
    if (L(p.param) !== L(this.cfg.modelHash)) {
      throw no("model_mismatch", `le produit épingle le modèle ${p.param}, cette enclave appelle ${this.cfg.modelHash}`);
    }
    if (L(st.operator) === zeroAddress) {
      throw no("enclave_inactive", `cette enclave (${this.enclave}) n'est pas inscrite et active pour le produit #${this.productId} : ses reçus ne seraient pas payés (InactiveEnclave)`);
    }
    if (this.operators && !this.operators.has(L(st.operator))) {
      throw no("wrong_operator", `cette enclave est active pour l'opérateur ${st.operator}, absent d'OPERATOR_ALLOWLIST`);
    }
  }

  // ---------- un appel

  /**
   * Traite un appel. Sans X-PAYMENT : X402Error 402 avec les exigences. Avec : contrôle, sert, signe, garde le triplet.
   * Rend la réponse (et `replay` = vrai si c'est la réponse déjà servie pour cette requête et cette autorisation).
   * `clientIp` : l'adresse IP VUE par l'enclave (celle du pair TCP), pour le plafond par IP ; absente, pas de plafond par IP.
   */
  async handle(input: { envelope: unknown; xPayment?: string | null; resource: string; clientIp?: string }): Promise<{ body: X402CallResponse; replay: boolean }> {
    // les exigences à jour (503 si l'enclave ne peut pas être payée) : pour le 402 et les refus de paiement
    const accepts = async () => [this.requirementsFor(await this.status(), input.resource)];
    if (!input.xPayment) {
      throw new X402Error(
        402,
        "payment_required",
        "paiement x402 requis : renvoyer la MÊME requête avec l'en-tête X-PAYMENT (autorisation EIP-3009 ReceiveWithAuthorization vers X402Settler, montant exact, nonce = engagement sur la requête)",
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
        "le nonce de l'autorisation n'engage pas CETTE requête (autorisation rejouée, ou requête modifiée en route) : rien n'est servi",
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
    // reprise idempotente (AVANT toute lecture de la chaîne) : la même requête avec la même autorisation reçoit la même
    // réponse, sans 2e appel au modèle ni 2e reçu
    const done = this.calls.get(key);
    if (done) {
      if (done.authSignature === payment.payload.signature) return { body: done.response, replay: true };
      throw new X402Error(
        409,
        "nonce_reused",
        "cette requête a déjà été servie et payée par une autre autorisation (même nonce) : rien n'est servi ni facturé une 2e fois",
      );
    }
    const req = this.requirementsFor(await this.status(), resource); // 503 si l'enclave ne peut pas être payée

    // contrôles sans la chaîne : schéma, réseau, payTo, montant EXACT, fenêtre, signature canonique du payeur
    const now = this.now();
    const v = await verifyExactPayment(payment, req, this.cfg.chainId, now, {
      minRemainingSeconds: BigInt(this.limits.minSettleWindowSeconds),
      // au plus AUTH_VALIDITY_SECONDS (9/11 au soir : plus de « + 300 s ») ; le 402 en annonce 60 de moins (horloges)
      maxValiditySeconds: BigInt(this.limits.authValiditySeconds),
    });
    if (!v.ok) throw new X402Error(402, v.code, v.reason, [req]);
    const amount = BigInt(authOf(payment).value);
    // place dans la file (avant de déchiffrer et de lire la chaîne) ; un refus est d'abord confronté à la chaîne
    await this.admitOrThrow(() => this.roomRefusal(payer), payer);

    // la requête : déchiffrée par CETTE enclave, lue, bornée
    let plain: Uint8Array;
    try {
      plain = await this.kit.open(toBytes(env.enc), toBytes(env.ciphertext));
    } catch {
      throw new X402Error(400, "undecryptable", "requête indéchiffrable par cette enclave (chiffrée vers une autre clé X25519 ?) : rien n'est servi ni facturé");
    }
    if (plain.length > this.limits.maxRequestBytes) {
      throw new X402Error(413, "request_too_large", `requête trop grande : au plus ${this.limits.maxRequestBytes} octets en clair`);
    }
    const chat = parseChatRequest(plain, this.limits.maxOutputTokens);

    // débit : chaque lecture paymentState (≈ 12 requêtes RPC par fournisseur) puise dans un seau à jetons (503 / 429 sans
    // lecture) ; une requête signée par une clé neuve, même sans aucun USDC, ne multiplie plus les lectures (preuve D)
    this.takePaymentRead(payer, clientIp);

    // 9/11 au soir (K1) : tout refus qui SUIT la lecture on-chain (autorisation déjà consommée ou annulée, mauvais montant,
    // payeur contrat, solde, place…) retire le statut « connu » : rejouer une autorisation annulée, ou envoyer de mauvais
    // montants, ne permet plus de vider le seau des payeurs connus. Une panne de NOTRE lecture (chain_unavailable) ne
    // pénalise pas le payeur.
    let ps: X402PaymentState;
    try {
      // la chaîne, AU MÊME BLOC
      try {
        ps = await this.chain.paymentState({ enclave: this.enclave, productId: this.productId, payer, nonce });
      } catch {
        throw new X402Error(503, "chain_unavailable", "lecture on-chain impossible (quorum RPC) : rien n'est servi ni facturé, réessayez dans un instant");
      }
      this.statusCache = { at: Date.now(), value: { block: ps.block, product: ps.product, operator: ps.operator } };
      this.assertPayable(ps);
      const due = ps.product.price * X402_UNITS_PER_CALL;
      if (due !== amount) {
        throw new X402Error(
          402,
          "invalid_exact_evm_payload_authorization_value",
          `le prix on-chain a changé : un appel coûte maintenant ${due}, l'autorisation porte ${amount}`,
          [this.requirementsFor(ps, resource)],
        );
      }
      if (ps.authorizationUsed) {
        throw new X402Error(402, "authorization_used", "cette autorisation EIP-3009 est déjà consommée on-chain (réglée ou annulée) : rien n'est servi", [req]);
      }
      if (ps.payerHasCode) {
        this.trusted.delete(L(payer)); // un payeur « connu » qui ne peut plus payer n'est plus « connu » (voir plus bas)
        throw new X402Error(
          402,
          "payer_is_contract",
          "le payeur a du code (contrat ou compte délégué EIP-7702) : l'USDC vérifierait sa signature par ERC-1271, que cette enclave ne contrôle pas ; payer depuis un compte simple (EOA)",
          [req],
        );
      }

      // place, solde, borne globale, caution : un refus est d'abord confronté à la chaîne (rapprochement), puis tout est
      // recontrôlé. La réservation suit le DERNIER contrôle SANS AUCUNE ATTENTE (pas d'await entre les deux : les autres
      // requêtes du même payeur voient la réservation, deux requêtes ne passent pas sur le même solde)
      let refusal = this.admission(payer, amount, ps, req);
      if (refusal) {
        await (refusal.scope === "all" ? this.reconcileAll() : this.reconcilePayer(payer));
        refusal = this.admission(payer, amount, ps, req);
        if (refusal) {
          // 9/11 au soir : un payeur « connu » dont le solde ne couvre plus rien perd ce statut ; sinon, ayant payé une fois,
          // il viderait son solde puis épuiserait par des requêtes signées le seau des payeurs connus (les autres : 503)
          if (refusal.error.code === "insufficient_funds") this.trusted.delete(L(payer));
          throw refusal.error;
        }
      }
    } catch (e) {
      if (e instanceof X402Error && e.code !== "chain_unavailable") this.trusted.delete(L(payer));
      throw e;
    }
    // le solde lu couvre TOUS les appels non réglés de ce payeur : plus aucun n'est « non couvert »
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
        anchorBlock: ps.block, // l'enclave était active à ce bloc (lu ci-dessus)
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

  /** Appel au modèle borné dans le temps ; une réponse vide n'est pas facturée. */
  private async callModel(r: ChatModelRequest): Promise<ChatModelResult> {
    const ms = this.limits.modelTimeoutMs;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new X402Error(504, "model_timeout", `le modèle n'a pas répondu en ${ms} ms : rien n'est facturé, la même requête peut être renvoyée`));
      }, ms);
    });
    try {
      const out = await Promise.race([this.model.complete(r, abort.signal), timeout]);
      if (!out || typeof out.text !== "string" || out.text.length === 0) {
        throw new X402Error(502, "model_empty", "le modèle n'a rendu aucun texte : rien n'est facturé, la même requête peut être renvoyée");
      }
      return out;
    } catch (e) {
      if (e instanceof X402Error) throw e;
      this.log(`[sealed-x402] appel au modèle en échec : ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      throw new X402Error(502, "model_error", "le modèle a échoué : rien n'est facturé, la même requête peut être renvoyée");
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- admission (place, solde, borne globale, caution)

  /**
   * Pré-contrôle (avant de déchiffrer et de lire la chaîne) : un refus de place est d'abord confronté à la chaîne
   * (rapprochement, en cache court), puis recontrôlé. Aucune réservation ne suit : le contrôle qui précède la réservation
   * est refait sans attente dans handleLocked.
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
        error: new X402Error(503, "queue_full", "trop d'appels pas encore réglés chez cette enclave : rien n'est servi ni facturé, réessayez dans un instant"),
      };
    }
    if (this.loadOf(payer).count >= this.limits.maxPendingPerPayer) {
      return {
        scope: "payer",
        error: new X402Error(
          429,
          "payer_pending_limit",
          `ce payeur a déjà ${this.limits.maxPendingPerPayer} appels servis et pas encore réglés chez cette enclave : attendre le règlement (quelques dizaines de secondes)`,
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
          `solde USDC du payeur insuffisant : ${ps.balance} pour ${load.amount + amount} (ses appels non encore réglés chez cette enclave compris)`,
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
          `déjà ${this.limits.maxUnsettledPerWindow} appels servis dont le règlement n'est pas confirmé sur les ${this.limits.unsettledWindowSeconds} dernières secondes : rien n'est servi ni facturé, réessayez dans quelques minutes`,
        ),
      };
    }
    if (ps.capacity !== null && ps.capacity < this.exposure() + amount) {
      return {
        scope: "all",
        error: new X402Error(
          503,
          "operator_capacity",
          "la caution de l'opérateur ne couvre plus d'appel de plus sur 24 h (OperatorBond : ½ caution, plafond du produit) : rien n'est servi ni facturé, réessayez plus tard",
        ),
      };
    }
    return null;
  }

  /** Exposition à venir : appels servis non réglés que le solde de leur payeur couvre, et appels en cours. */
  private exposure(): bigint {
    let s = 0n;
    for (const c of this.calls.values()) if (c.state === "pending" && !c.uncovered) s += c.amount;
    for (const r of this.reserved.values()) s += r.amount;
    return s;
  }

  /**
   * Appels servis sur la fenêtre de la borne globale dont le paiement n'est pas CONFIRMÉ par l'opérateur (en attente,
   * échus, annulés, ou vus consommés par le seul rapprochement), plus les appels en cours. Un appel annulé reste donc
   * compté : la borne est dure (preuve B).
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

  /** Un payeur « connu » : SEULEMENT après un règlement par X402Settler signalé par l'opérateur (notePayment). */
  private trust(payer: Address | string): void {
    const k = L(payer);
    if (this.uncoveredPayers.has(k)) return; // un payeur avec un appel non couvert n'est pas « connu »
    this.trusted.delete(k);
    this.trusted.set(k, this.now());
    if (this.trusted.size > MAX_TRUSTED) {
      const oldest = this.trusted.keys().next().value;
      if (oldest !== undefined) this.trusted.delete(oldest);
    }
  }

  /**
   * Ce que l'opérateur dit d'un appel consommé on-chain (signalement signé) : réglé par X402Settler (le payeur devient
   * « connu », l'appel sort de la borne globale), ou consommé autrement — annulé par le payeur — (le payeur perd ce
   * statut, l'appel reste compté dans la borne). Un appel n'est noté qu'une fois.
   */
  private notePayment(c: StoredCall, paid: boolean): void {
    if (c.paid !== undefined) return;
    c.paid = paid;
    if (paid) this.trust(c.payer);
    else this.trusted.delete(L(c.payer));
  }

  /**
   * Débit des lectures paymentState d'une requête payée : un payeur « connu » puise dans son seau (un flot de clés neuves
   * ne le bloque pas) ; un nouveau payeur, dans le plafond de son adresse IP vue (s'il y en a une) puis dans le seau
   * global. Vide : refus SANS lecture (rien n'est servi ni facturé).
   */
  private takePaymentRead(payer: Address, clientIp: string | undefined): void {
    const busy = () =>
      new X402Error(503, "busy", "trop d'appels payés en ce moment (lectures on-chain bornées) : rien n'est servi ni facturé, réessayez dans quelques secondes");
    if (this.isTrusted(payer)) {
      if (!this.knownPerPayerReads.take(L(payer))) {
        throw new X402Error(429, "rate_limited", "trop d'appels payés par ce payeur en même temps : rien n'est servi ni facturé, réessayez dans quelques secondes");
      }
      if (!this.knownPayerReads.take()) throw busy();
      return;
    }
    if (clientIp && !this.ipReads.take(clientIp)) {
      throw new X402Error(429, "rate_limited", "trop d'appels payés depuis cette adresse : rien n'est servi ni facturé, réessayez dans quelques secondes");
    }
    if (!this.newPayerReads.take()) throw busy();
  }

  private clearUncovered(payer: Address): void {
    const k = L(payer);
    if (!this.uncoveredPayers.has(k)) return;
    for (const c of this.calls.values()) if (L(c.payer) === k) c.uncovered = false;
    this.uncoveredPayers.delete(k);
  }

  // ---------- rapprochement : la file confrontée à la chaîne

  /** Toute la file (au plus un passage par reconcileCacheMs ; un seul à la fois). */
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

  /** Les appels d'UN payeur (au plus un passage par payerReconcileCacheMs et par payeur). */
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
   * Avant le relevé de l'opérateur (GET /x402/pending) : relit, au même bloc, le SOLDE de chaque payeur qui a des appels en
   * attente (une lecture par payeur, les plus gros montants d'abord, prise dans le budget global des rapprochements) et
   * classe ses appels couverts / « non couverts », sans lire les autorisations ni rien sortir de la file : l'opérateur
   * reçoit d'abord ce qui sera payé (preuves C et C2). Au plus un passage par reconcileCacheMs, un seul à la fois ; sans
   * budget ou en cas de panne de lecture, le classement précédent reste.
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
      this.log(`[sealed-x402] relevé des soldes impossible (lecture on-chain) : ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      return;
    }
    const noAuthorizations = new Map<string, boolean>(); // rien n'est sorti de la file ici : seulement le classement
    for (const k of payers) this.applyCoverage(k, groups.get(k)!, balances.get(k), noAuthorizations);
  }

  /**
   * Relit on-chain, par lots et au même bloc, les payeurs qui ont des appels en attente (tous, ou un seul) :
   *  1. leurs soldes (les plus gros montants en attente d'abord) : un payeur qui ne couvre même plus son plus petit appel
   *     a tous ses appels « non couverts » (sans lire ses autorisations) ;
   *  2. pour les autres : solde et état de chaque autorisation, au même bloc ; ce qui est consommé sort de la file, puis
   *     le solde couvre les appels dans l'ordre où l'opérateur les règle (échéance la plus proche d'abord), le reste est
   *     « non couvert ». Au plus reconcileMaxReads lectures, prises dans le budget global (reconcileReadsPerMinute) : sans
   *     budget, pas de rapprochement (le refus est maintenu). Une panne de lecture ne change rien (refus maintenu).
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
      this.log("[sealed-x402] rapprochement remis : budget de lectures on-chain épuisé pour cette minute");
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
      // 2) solde + autorisations, au même bloc, pour les payeurs qui couvrent encore quelque chose
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
      this.log(`[sealed-x402] rapprochement impossible (lecture on-chain) : ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      return;
    }
    if (freed || uncovered) {
      this.log(`[sealed-x402] rapprochement : ${freed} appel(s) consommé(s) on-chain sorti(s) de la file, ${uncovered} non couvert(s) par le solde de leur payeur (hors exposition)`);
    }
  }

  /**
   * Applique une lecture on-chain aux appels en attente d'un payeur ; rend ce qui est sorti et ce qui est non couvert. Un
   * appel vu consommé ici sort de la file SANS rendre son payeur « connu » (réglé ou annulé : la chaîne ne le dit pas ;
   * seul le signalement de l'opérateur le dit).
   */
  private applyCoverage(
    k: string,
    calls: StoredCall[],
    balance: bigint | undefined,
    used: Map<string, boolean>,
  ): { settled: number; uncovered: number } {
    // l'état a pu changer pendant la lecture (signalement, échéance) : seulement les appels encore en attente ici
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
   * Soldes de `balanceOf` (un appel par payeur, qui fournit l'adresse et un nonce) et états de `auths`, au même bloc si le
   * lecteur sait lire groupé ; sinon une à une (paymentState pour un solde, authorizationUsed pour une autorisation).
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

  // ---------- la file de l'opérateur

  /**
   * Les appels servis et pas encore réglés, par pages (`offset`) : d'abord ceux que le solde de leur payeur couvrait au
   * dernier relevé (refreshCoverage), puis les « non couverts » ; dans chaque groupe, les plus urgents d'abord (échéance
   * de l'autorisation). Des impayables à échéance courte ne passent donc plus devant un appel couvert (preuve C).
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
   * POST /x402/settled : le signalement de l'opérateur, SIGNÉ (EIP-712, voir x402-ack.ts) par une adresse
   * d'OPERATOR_ALLOWLIST, lié à cette enclave, horodaté, à usage unique, borné en débit. Rien n'est lu on-chain avant que
   * la signature soit vérifiée. Lève X402Error (400 illisible, 401 non signé / périmé / autre enclave, 403 hors liste,
   * 409 rejoué, 429 débit).
   */
  async acknowledgeSigned(body: unknown): Promise<X402AckResult> {
    const raw = body as { items?: unknown; signature?: unknown } | null;
    if (raw && typeof raw === "object" && Array.isArray(raw.items) && raw.signature === undefined) {
      throw new X402Error(401, "ack_unsigned", "signalement non signé : POST /x402/settled est réservé à l'opérateur (signature EIP-712 d'une adresse d'OPERATOR_ALLOWLIST)");
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
        `signalement périmé ou daté du futur (issuedAt ${a.issuedAt}, horloge de l'enclave ${now}, tolérance ${maxAge} s) : le re-signer`,
      );
    }
    if (L(a.enclave) !== L(this.enclave) || a.productId !== this.productId) {
      throw new X402Error(401, "ack_wrong_enclave", `signalement adressé à l'enclave ${a.enclave} (produit #${a.productId}), pas à celle-ci (${this.enclave}, produit #${this.productId})`);
    }
    const signer = await recoverAckSigner(this.cfg.chainId, this.cfg.settler, a);
    if (!signer) throw new X402Error(401, "ack_bad_signature", "signature du signalement illisible : réservé à l'opérateur (EIP-712, OPERATOR_ALLOWLIST)");
    if (this.operators && !this.operators.has(L(signer))) {
      throw new X402Error(403, "ack_not_operator", `signalement signé par ${signer}, absent d'OPERATOR_ALLOWLIST : réservé à l'opérateur`);
    }
    if (this.ackReplay.has(a.ackNonce, now)) throw new X402Error(409, "ack_replayed", "signalement déjà reçu (ackNonce à usage unique) : le re-signer");
    if (!this.ackRequests.take()) throw new X402Error(429, "ack_rate_limited", "trop de signalements : réessayer dans quelques secondes");
    if (!this.ackReplay.claim(a.ackNonce, a.issuedAt + maxAge + ACK_FUTURE_SKEW_SECONDS, now)) {
      throw new X402Error(409, "ack_replayed", "signalement déjà reçu (ackNonce à usage unique) : le re-signer");
    }
    return this.acknowledge(a.items, { readBudget: this.ackReads });
  }

  /**
   * Sort de la file les appels que la chaîne dit consommés (USDC.authorizationState) : rien n'est cru sur parole. Les
   * items sont dédoublonnés ; seules les clés en attente ICI sont lues, chacune une fois (lecture groupée au même bloc,
   * partagée avec un signalement concurrent). `readBudget` : au-delà, les clés restent « pending » (non lues).
   * `settled` (signalement de l'opérateur, 9/11 au soir) : true = réglé par X402Settler (le payeur devient « connu »),
   * false = consommé autrement, annulé par le payeur (il ne l'est pas, ou plus) ; absent : ni l'un ni l'autre.
   * Rend ce qui est sorti, resté, inconnu.
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
        // déjà vu consommé (rapprochement) : l'opérateur dit maintenant comment
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
        // pendant la lecture, l'appel a pu être oublié (échu) ou déjà sorti : libéré une seule fois
        this.markSettled(c, paidOf.get(c.key));
        out.settled.push(c.key);
      } else {
        out.pending.push(c.key);
      }
    }
    return out;
  }

  /** État on-chain des autorisations de ces appels : une lecture par clé au plus (partagée entre appels concurrents). */
  private async authStates(calls: StoredCall[]): Promise<Map<string, boolean | undefined>> {
    const fresh = calls.filter((c) => !this.authInFlight.has(c.key));
    if (fresh.length) {
      const batch = this.readPendingState([], fresh).then(
        (s) => s.used,
        () => new Map<string, boolean>(), // lecture impossible : les clés restent en attente
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
   * Oublie les appels dont l'autorisation a expiré (plus réglables : perdus pour l'opérateur s'ils n'étaient pas réglés)
   * et, au-delà de maxStoredCalls, les plus anciens appels déjà réglés (ils ne servent qu'aux reprises). Rend le nombre
   * d'appels non réglés perdus.
   */
  prune(): number {
    const now = this.now();
    let lost = 0;
    for (const [k, c] of this.calls) {
      if (c.validBefore > now) continue;
      if (c.state === "pending") {
        lost++;
        this.release(c.payer, c.amount);
        this.log(`[sealed-x402] appel non réglé avant l'échéance de son autorisation, perdu pour l'opérateur : payeur ${c.payer}, ${c.amount} unités de base d'USDC`);
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

  /** Diagnostic (sans aucune donnée d'appel). */
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

  /** L'appel est servi : la réservation devient un appel en attente de règlement (mêmes comptes). */
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
   * La chaîne dit l'autorisation consommée : l'appel sort de la file (une seule fois). `paid` : ce qu'en dit l'opérateur
   * (signalement signé) ; absent (rapprochement), le payeur ne devient PAS « connu » : une autorisation annulée est
   * consommée elle aussi (preuves B et F du vérificateur).
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
