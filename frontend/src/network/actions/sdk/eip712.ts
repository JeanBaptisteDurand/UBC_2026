/** eip712.ts — types EIP-712 du réseau et vérification des messages signés par les enclaves (côté client) :
 *  le reçu (SessionPay), la réclamation de prime (SealedBounty) et, en v2, la réfutation d'une réclamation. */
import {
  type Address, type Hex, keccak256, encodeAbiParameters, hashTypedData, recoverTypedDataAddress, type TypedDataDomain,
} from "viem";
import { networkDomain } from "./network";

export const receiptTypes = {
  Receipt: [
    { name: "productId", type: "uint256" }, { name: "sessionId", type: "uint256" }, { name: "seq", type: "uint64" },
    { name: "modelHash", type: "bytes32" }, { name: "paramsHash", type: "bytes32" }, { name: "requestHash", type: "bytes32" },
    { name: "responseHash", type: "bytes32" }, { name: "tokensIn", type: "uint64" }, { name: "tokensOut", type: "uint64" },
    { name: "cumulativeUnits", type: "uint128" }, { name: "anchorBlock", type: "uint64" },
  ],
} as const;

export const claimTypes = {
  Claim: [
    { name: "bountyId", type: "uint256" }, { name: "payee", type: "address" }, { name: "blockN", type: "uint64" },
    { name: "blockHashN", type: "bytes32" }, { name: "predicateHash", type: "bytes32" }, { name: "loss", type: "uint256" },
    { name: "tier", type: "uint8" }, { name: "fingerprint", type: "bytes32" }, { name: "cPHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/** v2 : le verdict d'un contre-rejeu sur une réclamation ACCEPTÉE (SealedBounty.refute). `claimDigest` = digest
 *  EIP-712 de la réclamation ; `proven` faux = l'exploit ne se prouve pas, sinon `loss`/`tier` mesurés autrement. */
export const refutationTypes = {
  Refutation: [
    { name: "claimDigest", type: "bytes32" }, { name: "proven", type: "bool" }, { name: "loss", type: "uint256" },
    { name: "tier", type: "uint8" },
  ],
} as const;

export interface Receipt {
  productId: bigint; sessionId: bigint; seq: bigint; modelHash: Hex; paramsHash: Hex; requestHash: Hex;
  responseHash: Hex; tokensIn: bigint; tokensOut: bigint; cumulativeUnits: bigint; anchorBlock: bigint;
}

/** Réclamation de la Prime scellée, signée par une (ou k) enclave(s) (SealedBounty.Claim). */
export interface Claim {
  bountyId: bigint; payee: Address; blockN: bigint; blockHashN: Hex; predicateHash: Hex; loss: bigint;
  tier: number; fingerprint: Hex; cPHash: Hex; deadline: bigint;
}

export interface Refutation { claimDigest: Hex; proven: boolean; loss: bigint; tier: number; }

export async function recoverReceiptSigner(sessionPay: Address, receipt: Receipt, signature: Hex, chainId?: number): Promise<Address> {
  return recoverTypedDataAddress({
    domain: networkDomain(sessionPay, chainId) as TypedDataDomain,
    types: receiptTypes, primaryType: "Receipt", message: receipt, signature,
  });
}

export async function recoverClaimSigner(sealedBounty: Address, claim: Claim, signature: Hex, chainId?: number): Promise<Address> {
  return recoverTypedDataAddress({
    domain: networkDomain(sealedBounty, chainId) as TypedDataDomain,
    types: claimTypes, primaryType: "Claim", message: claim, signature,
  });
}

/** Digest EIP-712 d'une réclamation : ce que signent les enclaves, la clé de ClaimAccepted / claimRecords, et ce
 *  que porte une réfutation (= SealedBounty.claimDigest, calculé hors chaîne). */
export function claimDigestOf(sealedBounty: Address, claim: Claim, chainId?: number): Hex {
  return hashTypedData({
    domain: networkDomain(sealedBounty, chainId) as TypedDataDomain,
    types: claimTypes, primaryType: "Claim", message: claim,
  });
}

export async function recoverRefutationSigner(sealedBounty: Address, f: Refutation, signature: Hex, chainId?: number): Promise<Address> {
  return recoverTypedDataAddress({
    domain: networkDomain(sealedBounty, chainId) as TypedDataDomain,
    types: refutationTypes, primaryType: "Refutation", message: f, signature,
  });
}

/** Réclamation reçue en JSON (chaînes décimales, comme la rend l'enclave O3) → types du SDK. */
export function normalizeClaim(c: any): Claim {
  return {
    bountyId: BigInt(c.bountyId), payee: c.payee as Address, blockN: BigInt(c.blockN), blockHashN: c.blockHashN as Hex,
    predicateHash: c.predicateHash as Hex, loss: BigInt(c.loss), tier: Number(c.tier), fingerprint: c.fingerprint as Hex,
    cPHash: c.cPHash as Hex, deadline: BigInt(c.deadline),
  };
}

/** Reçu reçu en JSON (chaînes décimales, comme le rend l'enclave O2) → types du SDK. */
export function normalizeReceipt(r: any): Receipt {
  return {
    productId: BigInt(r.productId), sessionId: BigInt(r.sessionId), seq: BigInt(r.seq),
    modelHash: r.modelHash, paramsHash: r.paramsHash, requestHash: r.requestHash, responseHash: r.responseHash,
    tokensIn: BigInt(r.tokensIn), tokensOut: BigInt(r.tokensOut), cumulativeUnits: BigInt(r.cumulativeUnits), anchorBlock: BigInt(r.anchorBlock),
  };
}

/** Reçu → JSON (chaînes décimales), le format de l'enclave et de /verify-receipt. */
export function serializeReceipt(r: Receipt): Record<string, string> {
  return {
    productId: r.productId.toString(), sessionId: r.sessionId.toString(), seq: r.seq.toString(), modelHash: r.modelHash,
    paramsHash: r.paramsHash, requestHash: r.requestHash, responseHash: r.responseHash, tokensIn: r.tokensIn.toString(),
    tokensOut: r.tokensOut.toString(), cumulativeUnits: r.cumulativeUnits.toString(), anchorBlock: r.anchorBlock.toString(),
  };
}

/** Digest de l'enveloppe d'une requête d'inférence, signé par la clé de session. */
export function envelopeDigest(sessionId: bigint, seq: bigint, ciphertext: Hex, clientEphemeralPub: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes32" }],
      [sessionId, seq, keccak256(ciphertext), clientEphemeralPub],
    ),
  );
}
