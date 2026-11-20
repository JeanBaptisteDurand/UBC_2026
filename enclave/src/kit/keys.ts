/**
 * keys.ts — the enclave's keys, created IN MEMORY at start-up and never written to disk:
 *  - a secp256k1 signing key (address `signer`);
 *  - an X25519 encryption key (HPKE).
 */
import { type Address, type Hex, toHex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { x25519 } from "@noble/curves/ed25519";

export interface EnclaveKeys {
  signerPrivateKey: Hex; // secret, in memory
  signer: Address; // public
  x25519PrivateKey: Uint8Array; // secret, in memory
  x25519PublicKey: Hex; // public (32 octets)
}

export function generateEnclaveKeys(): EnclaveKeys {
  const signerPrivateKey = generatePrivateKey();
  const account = privateKeyToAccount(signerPrivateKey);
  const xPriv = x25519.utils.randomPrivateKey();
  const xPub = x25519.getPublicKey(xPriv);
  return {
    signerPrivateKey,
    signer: account.address,
    x25519PrivateKey: xPriv,
    x25519PublicKey: toHex(xPub),
  };
}
