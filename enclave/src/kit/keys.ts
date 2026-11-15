/**
 * keys.ts — les clés de l'enclave, nées EN MÉMOIRE au démarrage, jamais écrites sur disque.
 *  - une clé secp256k1 de signature (adresse `signer`) ;
 *  - une clé X25519 de chiffrement (HPKE).
 */
import { type Address, type Hex, toHex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { x25519 } from "@noble/curves/ed25519";

export interface EnclaveKeys {
  signerPrivateKey: Hex; // secret, en mémoire
  signer: Address; // public
  x25519PrivateKey: Uint8Array; // secret, en mémoire
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
