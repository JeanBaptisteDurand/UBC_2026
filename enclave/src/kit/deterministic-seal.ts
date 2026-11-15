/**
 * deterministic-seal.ts — scellé HPKE-like DÉTERMINISTE pour la Prime scellée (cP reproductible).
 *
 * Problème : deux enclaves honnêtes doivent produire le MÊME chiffré vers le protocole (cP) pour
 * qu'elles signent le même hash. HPKE standard est randomisé. Ici la clé éphémère est DÉRIVÉE de
 * l'aléa `r` du chasseur (présent dans le bundle), donc le chiffré est identique à (r, message,
 * clé du protocole) donnés. Le protocole déchiffre sans connaître `r` : tout vient de la clé
 * éphémère publique collée en tête (comme une sealed box).
 *
 * Construction : X25519 + HKDF-SHA256 + ChaCha20-Poly1305. cP = ephPub(32) ‖ ciphertext.
 */
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { concatBytes } from "@noble/hashes/utils";
import { type Hex, toBytes, toHex } from "viem";

const utf8 = (s: string) => new TextEncoder().encode(s);
const INFO_KEY = utf8("arc-sealed-key-v1");
const INFO_NONCE = utf8("arc-sealed-nonce-v1");
const INFO_EPH = utf8("arc-sealed-eph-v1");

/** Chiffre `plaintext` vers `recipientPublicRaw`, de façon reproductible à partir de `seedR`. */
export function deterministicSeal(recipientPublicRaw: Uint8Array, plaintext: Uint8Array, seedR: Uint8Array): Hex {
  const ephPriv = hkdf(sha256, seedR, new Uint8Array(), INFO_EPH, 32);
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, recipientPublicRaw);
  const key = hkdf(sha256, shared, ephPub, INFO_KEY, 32);
  const nonce = hkdf(sha256, ephPub, new Uint8Array(), INFO_NONCE, 12);
  const ct = chacha20poly1305(key, nonce).encrypt(plaintext);
  return toHex(concatBytes(ephPub, ct));
}

/** Déchiffre côté protocole, avec sa clé privée seulement (pas besoin de `seedR`). */
export function deterministicOpen(recipientPrivateRaw: Uint8Array, sealed: Hex): Uint8Array {
  const bytes = toBytes(sealed);
  const ephPub = bytes.slice(0, 32);
  const ct = bytes.slice(32);
  const shared = x25519.getSharedSecret(recipientPrivateRaw, ephPub);
  const key = hkdf(sha256, shared, ephPub, INFO_KEY, 32);
  const nonce = hkdf(sha256, ephPub, new Uint8Array(), INFO_NONCE, 12);
  return chacha20poly1305(key, nonce).decrypt(ct);
}
