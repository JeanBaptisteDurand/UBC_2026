/** receipts.ts — sessions and the check of an inference receipt EXACTLY as SessionPay.settle will do it: the session
 *  exists and is open, same product, signer = the enclave locked at opening, enclave active for this product at the
 *  anchor block for the session's operator, locked model, increasing cumulative total. */
import { type Address, type Hex, type PublicClient, zeroAddress } from "viem";
import { enclaveRegistryAbi, sessionPayAbi } from "./abis";
import { recoverReceiptSigner, type Receipt } from "./eip712";
import { testnet, type Deployment } from "./network";

/** A SessionPay session (getSession), with its id. Price, enclave, model and unit are LOCKED at opening: a change to
 *  the product only affects sessions opened afterwards. */
export interface SessionInfo {
  id: bigint;
  owner: Address;
  productId: bigint;
  operator: Address;
  sessionKey: Address;
  deposit: bigint;
  /** Spending cap (0 = the deposit). */
  cap: bigint;
  paidUnits: bigint;
  paid: bigint;
  expiresAt: bigint;
  closed: boolean;
  verdictWritten: boolean;
  /** Locked unit price (USDC, 6 decimals). */
  price: bigint;
  /** The ONLY enclave whose receipts this session pays. */
  enclave: Address;
  unitTokens: number;
  outWeight: number;
  /** Locked model: receipts must carry modelHash == param. */
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

/** What the session can still pay (the deposit, or the cap if lower), as SessionPay.settle computes it. */
export function sessionCeiling(s: Pick<SessionInfo, "deposit" | "cap">): bigint {
  return s.cap === 0n ? s.deposit : s.cap < s.deposit ? s.cap : s.deposit;
}

/** What a receipt with cumulative total `cumulativeUnits` would pay now (0 if it adds nothing). */
export function payableFor(s: Pick<SessionInfo, "deposit" | "cap" | "paid" | "price">, cumulativeUnits: bigint): bigint {
  const ceiling = sessionCeiling(s);
  const owed = cumulativeUnits * s.price > ceiling ? ceiling : cumulativeUnits * s.price;
  return owed > s.paid ? owed - s.paid : 0n;
}

export interface ReceiptCheck {
  id: "session" | "open" | "product" | "active" | "operator" | "enclave" | "model" | "increasing";
  ok: boolean;
  /** The check in French (the console shows it as is). */
  fr: string;
  /** The same check in English. */
  en: string;
}

export interface ReceiptVerification {
  /** Signer of the receipt (recovered from the EIP-712 signature, SessionPay domain). */
  signer: Address;
  session: SessionInfo | null;
  /** Active operator of this signer for the session's product at the anchor block (0x0… if none). */
  activeOperatorAtAnchor: Address;
  checks: ReceiptCheck[];
  /** True if SessionPay.settle would accept this receipt now. */
  settleable: boolean;
  /** USDC (6 decimals) that settle would pay out now. */
  payableNow: bigint;
}

/** Verifies a receipt as SessionPay.settle does (on-chain reads, nothing is sent). */
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
    { id: "session", ok: exists, fr: exists ? `session #${receipt.sessionId} connue` : `session #${receipt.sessionId} inconnue (SessionMismatch)`, en: exists ? `session #${receipt.sessionId} known` : `session #${receipt.sessionId} unknown (SessionMismatch)` },
  ];
  if (exists) {
    checks.push(
      { id: "open", ok: !s.closed, fr: s.closed ? "session close (Closed)" : "session ouverte", en: s.closed ? "session closed (Closed)" : "session open" },
      { id: "product", ok: receipt.productId === s.productId, fr: receipt.productId === s.productId ? `produit #${s.productId}` : `produit du reçu #${receipt.productId} ≠ produit de la session #${s.productId} (SessionMismatch)`, en: receipt.productId === s.productId ? `product #${s.productId}` : `receipt's product #${receipt.productId} ≠ session's product #${s.productId} (SessionMismatch)` },
      { id: "active", ok: op !== zeroAddress, fr: op !== zeroAddress ? `enclave ${signer} active au bloc d'ancrage ${receipt.anchorBlock}` : `enclave ${signer} non active pour ce produit au bloc ${receipt.anchorBlock} (InactiveEnclave)`, en: op !== zeroAddress ? `enclave ${signer} active at anchor block ${receipt.anchorBlock}` : `enclave ${signer} not active for this product at block ${receipt.anchorBlock} (InactiveEnclave)` },
      { id: "operator", ok: op !== zeroAddress && L(op) === L(s.operator), fr: L(op) === L(s.operator) ? `opérateur ${s.operator}` : `opérateur de l'enclave ${op} ≠ opérateur de la session ${s.operator} (WrongOperator)`, en: L(op) === L(s.operator) ? `operator ${s.operator}` : `enclave's operator ${op} ≠ session's operator ${s.operator} (WrongOperator)` },
      { id: "enclave", ok: L(signer) === L(s.enclave), fr: L(signer) === L(s.enclave) ? "signé par l'enclave verrouillée à l'ouverture" : `signé par ${signer}, la session est verrouillée sur ${s.enclave} (WrongEnclave)`, en: L(signer) === L(s.enclave) ? "signed by the enclave locked at opening" : `signed by ${signer}, the session is locked to ${s.enclave} (WrongEnclave)` },
      { id: "model", ok: L(receipt.modelHash) === L(s.param), fr: L(receipt.modelHash) === L(s.param) ? "modèle verrouillé à l'ouverture" : `modelHash ${receipt.modelHash} ≠ modèle de la session ${s.param} (ModelMismatch)`, en: L(receipt.modelHash) === L(s.param) ? "model locked at opening" : `modelHash ${receipt.modelHash} ≠ session's model ${s.param} (ModelMismatch)` },
      { id: "increasing", ok: receipt.cumulativeUnits > s.paidUnits, fr: receipt.cumulativeUnits > s.paidUnits ? `cumul ${receipt.cumulativeUnits} > déjà réglé ${s.paidUnits}` : `cumul ${receipt.cumulativeUnits} ≤ déjà réglé ${s.paidUnits} (NotIncreasing)`, en: receipt.cumulativeUnits > s.paidUnits ? `cumulative ${receipt.cumulativeUnits} > already settled ${s.paidUnits}` : `cumulative ${receipt.cumulativeUnits} ≤ already settled ${s.paidUnits} (NotIncreasing)` },
    );
  }
  const settleable = checks.every((c) => c.ok);
  return {
    signer, session: exists ? s : null, activeOperatorAtAnchor: op, checks, settleable,
    payableNow: settleable ? payableFor(s, receipt.cumulativeUnits) : 0n,
  };
}
