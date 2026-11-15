/** usdc.ts — autorisations EIP-3009 (ReceiveWithAuthorization) sur l'USDC d'Arc. */
import { type Address, type Hex, toHex } from "viem";
import { usdcDomain } from "./network";

export interface Auth {
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  signature: Hex;
}

export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
} as const;

export function freshNonce(): Hex {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b); // Web Crypto : navigateur + Node >= 22
  return toHex(b);
}

export type SignTypedDataFn = (args: {
  domain: ReturnType<typeof usdcDomain>;
  types: typeof receiveWithAuthorizationTypes;
  primaryType: "ReceiveWithAuthorization";
  message: Record<string, unknown>;
}) => Promise<Hex>;

/** Construit une autorisation EIP-3009 pour que `to` encaisse `value` de `from`. */
export async function buildReceiveAuthorization(
  signTypedData: SignTypedDataFn,
  params: { usdc: Address; chainId: number; from: Address; to: Address; value: bigint; nonce?: Hex; ttlSeconds?: number; now?: number },
): Promise<Auth> {
  const nonce = params.nonce ?? freshNonce();
  const nowS = params.now ?? Math.floor(Date.now() / 1000);
  const validBefore = BigInt(nowS + (params.ttlSeconds ?? 3600));
  const signature = await signTypedData({
    domain: usdcDomain(params.usdc, params.chainId),
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization",
    message: { from: params.from, to: params.to, value: params.value, validAfter: 0n, validBefore, nonce },
  });
  return { validAfter: 0n, validBefore, nonce, signature };
}
