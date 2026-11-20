/**
 * hpke.ts — HPKE encryption (RFC 9180): DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20-Poly1305.
 * It encrypts inference requests and replies to the enclave keys, and the exploit bundle.
 *
 * Note (O3): the Sealed Bounty needs a cP that two enclaves can reproduce (the same ciphertext for the protocol).
 * HPKE is randomized (ephemeral key): the deterministic ciphertext, derived from the randomness r, lives in
 * kit/deterministic-seal.ts (DeterministicProtocolCipher in services/bounty.ts), not in this base module.
 */
import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";

export interface Sealed {
  enc: Uint8Array;
  ciphertext: Uint8Array;
}

function suite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Chacha20Poly1305(),
  });
}

function ab(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** Encrypts `plaintext` to the recipient's raw X25519 public key. */
export async function seal(recipientPublicRaw: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<Sealed> {
  const s = suite();
  const pk = await s.kem.importKey("raw", ab(recipientPublicRaw), true);
  const sender = await s.createSenderContext({ recipientPublicKey: pk });
  const ct = await sender.seal(ab(plaintext), aad ? ab(aad) : undefined);
  return { enc: new Uint8Array(sender.enc), ciphertext: new Uint8Array(ct) };
}

/** Decrypts with the recipient's raw X25519 private key. */
export async function open(
  recipientPrivateRaw: Uint8Array,
  enc: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const s = suite();
  const sk = await s.kem.importKey("raw", ab(recipientPrivateRaw), false);
  const recipient = await s.createRecipientContext({ recipientKey: sk, enc: ab(enc) });
  const pt = await recipient.open(ab(ciphertext), aad ? ab(aad) : undefined);
  return new Uint8Array(pt);
}
