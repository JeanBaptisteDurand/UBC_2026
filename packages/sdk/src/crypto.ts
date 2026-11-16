/** crypto.ts — HPKE (chiffrer vers l'enclave), scellé déterministe (cP de la prime), clés de session. */
import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { concatBytes } from "@noble/hashes/utils";
import { type Hex, toHex, toBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

function suite(): CipherSuite {
  return new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305() });
}
function ab(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export interface Sealed {
  enc: Uint8Array;
  ciphertext: Uint8Array;
}

/** HPKE vers une clé X25519 d'enclave (requêtes d'inférence, cE de la prime). */
export async function hpkeSeal(recipientPublicRaw: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<Sealed> {
  const s = suite();
  const pk = await s.kem.importKey("raw", ab(recipientPublicRaw), true);
  const sender = await s.createSenderContext({ recipientPublicKey: pk });
  const ct = await sender.seal(ab(plaintext), aad ? ab(aad) : undefined);
  return { enc: new Uint8Array(sender.enc), ciphertext: new Uint8Array(ct) };
}

export async function hpkeOpen(recipientPrivateRaw: Uint8Array, enc: Uint8Array, ciphertext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const s = suite();
  const sk = await s.kem.importKey("raw", ab(recipientPrivateRaw), false);
  const r = await s.createRecipientContext({ recipientKey: sk, enc: ab(enc) });
  return new Uint8Array(await r.open(ab(ciphertext), aad ? ab(aad) : undefined));
}

const utf8 = (x: string) => new TextEncoder().encode(x);
const INFO_KEY = utf8("arc-sealed-key-v1");
const INFO_NONCE = utf8("arc-sealed-nonce-v1");
const INFO_EPH = utf8("arc-sealed-eph-v1");

/** Scellé DÉTERMINISTE (reproductible en `r`) : cP de la Prime scellée. Identique à l'enclave. */
export function deterministicSeal(recipientPublicRaw: Uint8Array, plaintext: Uint8Array, seedR: Uint8Array): Hex {
  const ephPriv = hkdf(sha256, seedR, new Uint8Array(), INFO_EPH, 32);
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, recipientPublicRaw);
  const key = hkdf(sha256, shared, ephPub, INFO_KEY, 32);
  const nonce = hkdf(sha256, ephPub, new Uint8Array(), INFO_NONCE, 12);
  const ct = chacha20poly1305(key, nonce).encrypt(plaintext);
  return toHex(concatBytes(ephPub, ct));
}

export function deterministicOpen(recipientPrivateRaw: Uint8Array, sealed: Hex): Uint8Array {
  const bytes = toBytes(sealed);
  const ephPub = bytes.slice(0, 32);
  const ct = bytes.slice(32);
  const shared = x25519.getSharedSecret(recipientPrivateRaw, ephPub);
  const key = hkdf(sha256, shared, ephPub, INFO_KEY, 32);
  const nonce = hkdf(sha256, ephPub, new Uint8Array(), INFO_NONCE, 12);
  return chacha20poly1305(key, nonce).decrypt(ct);
}

export interface SessionKey {
  privateKey: Hex;
  address: Hex;
}

/** Clé de session secp256k1, née côté client (jamais envoyée). */
export function generateSessionKey(): SessionKey {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

/** Paire X25519 éphémère du client pour recevoir la réponse d'inférence chiffrée. */
export function generateX25519(): { privateKey: Uint8Array; publicKey: Hex } {
  const priv = x25519.utils.randomPrivateKey();
  return { privateKey: priv, publicKey: toHex(x25519.getPublicKey(priv)) };
}
