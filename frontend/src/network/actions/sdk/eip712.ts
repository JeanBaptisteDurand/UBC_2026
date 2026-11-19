/** eip712.ts — the network's EIP-712 types and the client-side check of messages signed by enclaves:
 *  the receipt (SessionPay), the bounty claim (SealedBounty) and the refutation of a claim. */
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

/** The verdict of a counter-replay on an ACCEPTED claim (SealedBounty.refute). `claimDigest` = the claim's EIP-712
 *  digest; `proven` false = the exploit does not prove itself, otherwise `loss`/`tier` measured differently. */
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

/** A Sealed Bounty claim, signed by one (or k) enclave(s) (SealedBounty.Claim). */
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

/** EIP-712 digest of a claim: what the enclaves sign, the key of ClaimAccepted / claimRecords, and what a
 *  refutation carries (= SealedBounty.claimDigest, computed off-chain). */
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

/** A claim received as JSON (decimal strings, as the enclave O3 returns it) → SDK types. */
export function normalizeClaim(c: any): Claim {
  return {
    bountyId: BigInt(c.bountyId), payee: c.payee as Address, blockN: BigInt(c.blockN), blockHashN: c.blockHashN as Hex,
    predicateHash: c.predicateHash as Hex, loss: BigInt(c.loss), tier: Number(c.tier), fingerprint: c.fingerprint as Hex,
    cPHash: c.cPHash as Hex, deadline: BigInt(c.deadline),
  };
}

/** A receipt received as JSON (decimal strings, as the enclave O2 returns it) → SDK types. */
export function normalizeReceipt(r: any): Receipt {
  return {
    productId: BigInt(r.productId), sessionId: BigInt(r.sessionId), seq: BigInt(r.seq),
    modelHash: r.modelHash, paramsHash: r.paramsHash, requestHash: r.requestHash, responseHash: r.responseHash,
    tokensIn: BigInt(r.tokensIn), tokensOut: BigInt(r.tokensOut), cumulativeUnits: BigInt(r.cumulativeUnits), anchorBlock: BigInt(r.anchorBlock),
  };
}

/** Receipt → JSON (decimal strings), the format of the enclave and of /verify-receipt. */
export function serializeReceipt(r: Receipt): Record<string, string> {
  return {
    productId: r.productId.toString(), sessionId: r.sessionId.toString(), seq: r.seq.toString(), modelHash: r.modelHash,
    paramsHash: r.paramsHash, requestHash: r.requestHash, responseHash: r.responseHash, tokensIn: r.tokensIn.toString(),
    tokensOut: r.tokensOut.toString(), cumulativeUnits: r.cumulativeUnits.toString(), anchorBlock: r.anchorBlock.toString(),
  };
}

/** Digest of an inference request's envelope, signed by the session key. */
export function envelopeDigest(sessionId: bigint, seq: bigint, ciphertext: Hex, clientEphemeralPub: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes32" }],
      [sessionId, seq, keccak256(ciphertext), clientEphemeralPub],
    ),
  );
}
