/**
 * x402-ack.ts — le signalement « appels réglés » (POST /x402/settled), RÉSERVÉ À L'OPÉRATEUR (correctif du 9/11).
 *
 * Avant : la route était publique, sans dédoublonnage ; les clés (payeur, nonce) sont publiques (GET /x402/pending) et
 * chaque item déclenchait une lecture on-chain (quorum : chez CHAQUE fournisseur) : 200 copies d'une clé = 200 lectures
 * pour une requête de 26 Ko (preuve 4 du vérificateur). Désormais :
 *  - le corps est SIGNÉ en EIP-712 par une adresse d'OPERATOR_ALLOWLIST (le registrar signe avec la clé de l'opérateur
 *    qu'il tient déjà) ; une signature absente ou invalide : 401 ; un signataire hors liste : 403 ; rien n'est lu ;
 *  - il est lié à CETTE enclave (adresse de l'enclave, produit, chaîne, X402Settler dans le domaine) : il ne se rejoue
 *    pas ailleurs ;
 *  - il est HORODATÉ (issuedAt, à ±ACK_MAX_AGE près) et À USAGE UNIQUE (ackNonce gardé jusqu'à la fin de sa fenêtre) :
 *    un corps capturé ne se rejoue pas (409) ;
 *  - il est borné en taille (200 items, 64 Kio) et en débit (jetons : requêtes signées, puis lectures on-chain) ;
 *  - ses items sont dédoublonnés ; une clé n'est lue on-chain qu'UNE fois, et seulement si elle est en attente ici.
 * 9/11 au soir (preuves B et F du vérificateur) : chaque item dit aussi COMMENT l'autorisation a été consommée —
 * `settled` = true : réglée par X402Settler (le registrar le sait par le reçu de SA transaction, ou par l'événement
 * CallSettled) ; false : consommée autrement (annulée par le payeur, cancelAuthorization). La chaîne ne distingue pas
 * les deux (authorizationState = vrai dans les deux cas) : seul true rend le payeur « connu ». Le type EIP-712 change
 * (domaine en version 2) : un registrar d'avant ce correctif est refusé (signature d'un autre message).
 * Le SDK (packages/sdk/src/x402.ts, createX402SettlementQueue) construit exactement les mêmes octets : le test croisé
 * enclave/test/x402-e2e.test.ts le vérifie (la file du registrar vide celle de l'enclave).
 */
import { type Address, type Hex, getAddress, isAddress, recoverTypedDataAddress } from "viem";

/** Au plus ce nombre d'items par signalement (au-delà : plusieurs signalements). */
export const X402_ACK_MAX_ITEMS = 200;

/** Domaine EIP-712 du signalement : distinct de celui des reçus (même chaîne, même X402Settler). */
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
  /** true : réglée par X402Settler (transaction de l'opérateur, ou événement CallSettled) ; false : consommée autrement. */
  settled: boolean;
}

/** Corps de POST /x402/settled : { enclave, productId, issuedAt, ackNonce, items, signature }. */
export interface X402AckBody {
  enclave: Address;
  productId: bigint;
  /** Secondes Unix (horloge de l'opérateur). */
  issuedAt: bigint;
  /** 32 octets aléatoires : usage unique. */
  ackNonce: Hex;
  items: X402AckItem[];
  /** Signature EIP-712 (65 octets) de l'opérateur. */
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
 * Lit le corps sans rien lui faire confiance (formes et tailles) ; lève X402AckFormatError. Les items doivent tous être
 * bien formés : ce sont exactement eux que couvre la signature.
 */
export function parseAckBody(x: unknown): X402AckBody {
  const bad = (m: string) => new X402AckFormatError(m);
  const b = x as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) throw bad("objet JSON attendu");
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > X402_ACK_MAX_ITEMS) {
    throw bad(`items : de 1 à ${X402_ACK_MAX_ITEMS} { payer, nonce, settled }`);
  }
  if (typeof b.enclave !== "string" || !isAddress(b.enclave, { strict: false })) throw bad("enclave : adresse attendue");
  if (typeof b.productId !== "string" || !/^[0-9]{1,78}$/.test(b.productId)) throw bad("productId : entier décimal (chaîne) attendu");
  if (typeof b.issuedAt !== "number" || !Number.isSafeInteger(b.issuedAt) || b.issuedAt < 0) throw bad("issuedAt : secondes Unix attendues");
  if (typeof b.ackNonce !== "string" || !HEX32.test(b.ackNonce)) throw bad("ackNonce : 32 octets hexadécimaux attendus");
  if (typeof b.signature !== "string" || !SIG65.test(b.signature)) throw bad("signature : 65 octets hexadécimaux attendus");
  const items: X402AckItem[] = [];
  for (const it of b.items) {
    const payer = (it as { payer?: unknown })?.payer;
    const nonce = (it as { nonce?: unknown })?.nonce;
    const settled = (it as { settled?: unknown })?.settled;
    if (
      typeof payer !== "string" || !isAddress(payer, { strict: false }) || typeof nonce !== "string" || !HEX32.test(nonce) ||
      typeof settled !== "boolean"
    ) {
      throw bad("chaque item : { payer: adresse, nonce: 32 octets, settled: booléen }");
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

/** Le signataire du signalement (null si la signature est illisible). */
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

/** Seau à jetons (débit borné), horloge injectable (ms). */
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

  /** Jetons entiers disponibles maintenant. */
  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /** Prend `n` jetons s'ils sont là (sinon rien) ; rend vrai si pris. */
  take(n = 1): boolean {
    this.refill();
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** Les ackNonce déjà vus, gardés jusqu'à la fin de leur fenêtre de fraîcheur (au-delà, issuedAt les refuse seul). */
export class AckReplayGuard {
  private seen = new Map<string, bigint>();

  constructor(private readonly maxEntries = 10_000) {}

  private purge(now: bigint): void {
    for (const [k, until] of this.seen) if (until < now) this.seen.delete(k);
  }

  /** Déjà vu (et encore dans sa fenêtre) ? */
  has(nonce: Hex, now: bigint): boolean {
    const until = this.seen.get(nonce.toLowerCase());
    return until !== undefined && until >= now;
  }

  /** Réserve ce nonce jusqu'à `until` ; faux s'il est déjà pris, ou si la mémoire est pleine (on échoue fermé). */
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
