/**
 * eip712.ts — the receipt (SessionPay) and the claim (SealedBounty), signed by the enclave.
 * The domain is identical to the contracts': name "ArcEnclaveNetwork", version "1".
 */
import {
  type Address,
  type Hex,
  type TypedDataDomain,
  recoverTypedDataAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface DomainParams {
  chainId: number;
  verifyingContract: Address;
}

export function domain({ chainId, verifyingContract }: DomainParams): TypedDataDomain {
  return { name: "ArcEnclaveNetwork", version: "1", chainId, verifyingContract };
}

export const receiptTypes = {
  Receipt: [
    { name: "productId", type: "uint256" },
    { name: "sessionId", type: "uint256" },
    { name: "seq", type: "uint64" },
    { name: "modelHash", type: "bytes32" },
    { name: "paramsHash", type: "bytes32" },
    { name: "requestHash", type: "bytes32" },
    { name: "responseHash", type: "bytes32" },
    { name: "tokensIn", type: "uint64" },
    { name: "tokensOut", type: "uint64" },
    { name: "cumulativeUnits", type: "uint128" },
    { name: "anchorBlock", type: "uint64" },
  ],
} as const;

export const claimTypes = {
  Claim: [
    { name: "bountyId", type: "uint256" },
    { name: "payee", type: "address" },
    { name: "blockN", type: "uint64" },
    { name: "blockHashN", type: "bytes32" },
    { name: "predicateHash", type: "bytes32" },
    { name: "loss", type: "uint256" },
    { name: "tier", type: "uint8" },
    { name: "fingerprint", type: "bytes32" },
    { name: "cPHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export interface Receipt {
  productId: bigint;
  sessionId: bigint;
  seq: bigint;
  modelHash: Hex;
  paramsHash: Hex;
  requestHash: Hex;
  responseHash: Hex;
  tokensIn: bigint;
  tokensOut: bigint;
  cumulativeUnits: bigint;
  anchorBlock: bigint;
}

export interface Claim {
  bountyId: bigint;
  payee: Address;
  blockN: bigint;
  blockHashN: Hex;
  predicateHash: Hex;
  loss: bigint;
  tier: number;
  fingerprint: Hex;
  cPHash: Hex;
  deadline: bigint;
}

/** Signs a receipt with the enclave's secp256k1 key. Returns a 65-byte signature (r‖s‖v). */
export async function signReceipt(privateKey: Hex, dom: DomainParams, receipt: Receipt): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData({
    domain: domain(dom),
    types: receiptTypes,
    primaryType: "Receipt",
    message: receipt,
  });
}

export async function signClaim(privateKey: Hex, dom: DomainParams, claim: Claim): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData({
    domain: domain(dom),
    types: claimTypes,
    primaryType: "Claim",
    message: claim,
  });
}

export async function recoverReceiptSigner(dom: DomainParams, receipt: Receipt, signature: Hex): Promise<Address> {
  return recoverTypedDataAddress({
    domain: domain(dom),
    types: receiptTypes,
    primaryType: "Receipt",
    message: receipt,
    signature,
  });
}

export async function recoverClaimSigner(dom: DomainParams, claim: Claim, signature: Hex): Promise<Address> {
  return recoverTypedDataAddress({
    domain: domain(dom),
    types: claimTypes,
    primaryType: "Claim",
    message: claim,
    signature,
  });
}

// --- CallReceipt: the proof of one call for the x402 rail (X402Settler) ---

export const callReceiptTypes = {
  CallReceipt: [
    { name: "productId", type: "uint256" },
    { name: "payer", type: "address" },
    { name: "requestHash", type: "bytes32" },
    { name: "responseHash", type: "bytes32" },
    { name: "units", type: "uint128" },
    { name: "anchorBlock", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface CallReceipt {
  productId: bigint;
  payer: Address;
  requestHash: Hex;
  responseHash: Hex;
  units: bigint;
  anchorBlock: bigint;
  nonce: Hex; // = the nonce of the payer's EIP-3009 authorization
}

export async function signCallReceipt(privateKey: Hex, dom: DomainParams, cr: CallReceipt): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData({ domain: domain(dom), types: callReceiptTypes, primaryType: "CallReceipt", message: cr });
}

export async function recoverCallReceiptSigner(dom: DomainParams, cr: CallReceipt, signature: Hex): Promise<Address> {
  return recoverTypedDataAddress({ domain: domain(dom), types: callReceiptTypes, primaryType: "CallReceipt", message: cr, signature });
}
