/** receipts.ts — sessions (pile v2) et vérification d'un reçu d'inférence EXACTEMENT comme SessionPay.settle le fera :
 *  session existante et ouverte, même produit, signataire = l'enclave verrouillée à l'ouverture, enclave active pour ce
 *  produit au bloc d'ancrage chez l'opérateur de la session, modèle verrouillé, cumul croissant. */
import { type Address, type Hex, type PublicClient, zeroAddress } from "viem";
import { enclaveRegistryAbi, sessionPayAbi } from "./abis";
import { recoverReceiptSigner, type Receipt } from "./eip712";
import { testnet, type Deployment } from "./network";

/** Une session SessionPay v2 (getSession), avec son identifiant. Prix, enclave, modèle et unité sont VERROUILLÉS à
 *  l'ouverture : un changement du produit ne touche que les sessions ouvertes après. */
export interface SessionInfo {
  id: bigint;
  owner: Address;
  productId: bigint;
  operator: Address;
  sessionKey: Address;
  deposit: bigint;
  /** Plafond de dépense (0 = le dépôt). */
  cap: bigint;
  paidUnits: bigint;
  paid: bigint;
  expiresAt: bigint;
  closed: boolean;
  verdictWritten: boolean;
  /** Prix unitaire verrouillé (USDC, 6 décimales). */
  price: bigint;
  /** La SEULE enclave dont les reçus paient cette session. */
  enclave: Address;
  unitTokens: number;
  outWeight: number;
  /** Modèle verrouillé : les reçus doivent porter modelHash == param. */
  param: Hex;
}

export function toSessionInfo(id: bigint, s: any): SessionInfo {
  return {
    id, owner: s.owner, productId: BigInt(s.productId), operator: s.operator, sessionKey: s.sessionKey,
    deposit: BigInt(s.deposit), cap: BigInt(s.cap), paidUnits: BigInt(s.paidUnits), paid: BigInt(s.paid),
    expiresAt: BigInt(s.expiresAt), closed: !!s.closed, verdictWritten: !!s.verdictWritten, price: BigInt(s.price ?? 0n),
    enclave: (s.enclave ?? zeroAddress) as Address, unitTokens: Number(s.unitTokens ?? 0), outWeight: Number(s.outWeight ?? 0),
    param: (s.param ?? `0x${"00".repeat(32)}`) as Hex,
  };
}

export async function readSession(pub: PublicClient, d: Deployment, id: bigint, blockNumber?: bigint): Promise<SessionInfo> {
  const s = await pub.readContract({ address: d.sessionPay, abi: sessionPayAbi, functionName: "getSession", args: [id], ...(blockNumber !== undefined ? { blockNumber } : {}) });
  return toSessionInfo(id, s);
}

/** Ce que la session peut encore payer (le dépôt, ou le plafond s'il est plus bas), comme SessionPay.settle. */
export function sessionCeiling(s: Pick<SessionInfo, "deposit" | "cap">): bigint {
  return s.cap === 0n ? s.deposit : s.cap < s.deposit ? s.cap : s.deposit;
}

/** Ce qu'un reçu au cumul `cumulativeUnits` ferait payer maintenant (0 s'il n'apporte rien). */
export function payableFor(s: Pick<SessionInfo, "deposit" | "cap" | "paid" | "price">, cumulativeUnits: bigint): bigint {
  const ceiling = sessionCeiling(s);
  const owed = cumulativeUnits * s.price > ceiling ? ceiling : cumulativeUnits * s.price;
  return owed > s.paid ? owed - s.paid : 0n;
}

export interface ReceiptCheck {
  id: "session" | "open" | "product" | "active" | "operator" | "enclave" | "model" | "increasing";
  ok: boolean;
  fr: string;
}

export interface ReceiptVerification {
  /** Signataire du reçu (recouvré de la signature EIP-712, domaine SessionPay). */
  signer: Address;
  session: SessionInfo | null;
  /** Opérateur actif de ce signataire pour le produit de la session au bloc d'ancrage (0x0… si aucun). */
  activeOperatorAtAnchor: Address;
  checks: ReceiptCheck[];
  /** Vrai si SessionPay.settle accepterait ce reçu maintenant. */
  settleable: boolean;
  /** USDC (6 décimales) que settle verserait maintenant. */
  payableNow: bigint;
}

/** Vérifie un reçu comme SessionPay.settle (lectures on-chain, rien n'est envoyé). */
export async function verifyReceiptOnChain(
  pub: PublicClient,
  receipt: Receipt,
  signature: Hex,
  d: Deployment = testnet,
): Promise<ReceiptVerification> {
  const signer = await recoverReceiptSigner(d.sessionPay, receipt, signature, d.chainId);
  const s = await readSession(pub, d, receipt.sessionId);
  const exists = s.owner !== zeroAddress;
  const pid = exists ? s.productId : receipt.productId;
  const op = (await pub.readContract({
    address: d.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "activeOperatorAt", args: [signer, pid, receipt.anchorBlock],
  })) as Address;
  const L = (x: string) => x.toLowerCase();
  const checks: ReceiptCheck[] = [
    { id: "session", ok: exists, fr: exists ? `session #${receipt.sessionId} connue` : `session #${receipt.sessionId} inconnue (SessionMismatch)` },
  ];
  if (exists) {
    checks.push(
      { id: "open", ok: !s.closed, fr: s.closed ? "session close (Closed)" : "session ouverte" },
      { id: "product", ok: receipt.productId === s.productId, fr: receipt.productId === s.productId ? `produit #${s.productId}` : `produit du reçu #${receipt.productId} ≠ produit de la session #${s.productId} (SessionMismatch)` },
      { id: "active", ok: op !== zeroAddress, fr: op !== zeroAddress ? `enclave ${signer} active au bloc d'ancrage ${receipt.anchorBlock}` : `enclave ${signer} non active pour ce produit au bloc ${receipt.anchorBlock} (InactiveEnclave)` },
      { id: "operator", ok: op !== zeroAddress && L(op) === L(s.operator), fr: L(op) === L(s.operator) ? `opérateur ${s.operator}` : `opérateur de l'enclave ${op} ≠ opérateur de la session ${s.operator} (WrongOperator)` },
      { id: "enclave", ok: L(signer) === L(s.enclave), fr: L(signer) === L(s.enclave) ? "signé par l'enclave verrouillée à l'ouverture" : `signé par ${signer}, la session est verrouillée sur ${s.enclave} (WrongEnclave)` },
      { id: "model", ok: L(receipt.modelHash) === L(s.param), fr: L(receipt.modelHash) === L(s.param) ? "modèle verrouillé à l'ouverture" : `modelHash ${receipt.modelHash} ≠ modèle de la session ${s.param} (ModelMismatch)` },
      { id: "increasing", ok: receipt.cumulativeUnits > s.paidUnits, fr: receipt.cumulativeUnits > s.paidUnits ? `cumul ${receipt.cumulativeUnits} > déjà réglé ${s.paidUnits}` : `cumul ${receipt.cumulativeUnits} ≤ déjà réglé ${s.paidUnits} (NotIncreasing)` },
    );
  }
  const settleable = checks.every((c) => c.ok);
  return {
    signer, session: exists ? s : null, activeOperatorAtAnchor: op, checks, settleable,
    payableNow: settleable ? payableFor(s, receipt.cumulativeUnits) : 0n,
  };
}
