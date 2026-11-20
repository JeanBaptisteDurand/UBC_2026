/**
 * hpke-exchange.ts — a request encrypted to the enclave and ITS reply, sealed for the one client that sent it (enclave
 * side). It carries the encrypted conversation of the attested copilot (services/copilot/src/enclave-app.ts).
 *
 * Built on HPKE (RFC 9180, the same suite as hpke.ts: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20-Poly1305), like
 * the response encapsulation of Oblivious HTTP (RFC 9458 §4.4):
 *  - request: HPKE in base mode to the enclave's X25519 key, with info = exchangeInfo(label, chain, registry, product,
 *    signer): a ciphertext prepared for ANOTHER enclave, another product or another registry does not open here;
 *  - reply: secret = Export("<label> response", 32) of the request's HPKE context; a random reply nonce of 32 bytes;
 *    prk = HKDF-Extract(salt = enc ‖ nonce, secret); key = HKDF-Expand(prk, "key", 32);
 *    AEAD nonce = HKDF-Expand(prk, "nonce", 12); ciphertext = ChaCha20-Poly1305(key, AEAD nonce, reply).
 *    Only the client (which created the context) and the enclave (X25519 private key, in memory) know this secret: a
 *    proxy can neither read the reply, nor forge one, nor replay the reply to another request.
 * The same protocol on the client side: packages/sdk/src/sealed-exchange.ts (cross-test: enclave/test/copilot-exchange.test.ts).
 */
import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { extract, expand } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { type Address, encodeAbiParameters, keccak256, toBytes } from "viem";

/** Length of the reply nonce (max(Nn, Nk) of ChaCha20-Poly1305, as in RFC 9458). */
export const EXCHANGE_RESPONSE_NONCE_BYTES = 32;

const utf8 = (s: string) => new TextEncoder().encode(s);

function suite(): CipherSuite {
  return new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305() });
}

function ab(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** HPKE info of an exchange = keccak256(abi.encode(label, chainId, registry, product, signer)): 32 bytes. */
export function exchangeInfo(tag: string, chainId: bigint | number, registry: Address, productId: bigint, signer: Address): Uint8Array {
  return toBytes(
    keccak256(
      encodeAbiParameters(
        [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
        [tag, BigInt(chainId), registry, productId, signer],
      ),
    ),
  );
}

/** Key and AEAD nonce of the reply (RFC 9458 §4.4, with SHA-256 and ChaCha20-Poly1305). */
export function exchangeResponseKeys(secret: Uint8Array, enc: Uint8Array, responseNonce: Uint8Array): { key: Uint8Array; nonce: Uint8Array } {
  const salt = new Uint8Array(enc.length + responseNonce.length);
  salt.set(enc, 0);
  salt.set(responseNonce, enc.length);
  const prk = extract(sha256, secret, salt);
  return { key: expand(sha256, prk, utf8("key"), 32), nonce: expand(sha256, prk, utf8("nonce"), 12) };
}

export interface OpenedExchange {
  /** The request in clear. */
  plaintext: Uint8Array;
  /** Seals the reply to THIS request: only its client can open it (and check that it comes from this enclave). */
  sealResponse(plaintext: Uint8Array): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }>;
}

/** Opens a sealed request (throws if it is not for this key or this info, or if it was modified). */
export async function openExchange(
  recipientPrivateRaw: Uint8Array,
  tag: string,
  info: Uint8Array,
  enc: Uint8Array,
  ciphertext: Uint8Array,
): Promise<OpenedExchange> {
  const s = suite();
  const sk = await s.kem.importKey("raw", ab(recipientPrivateRaw), false);
  const ctx = await s.createRecipientContext({ recipientKey: sk, enc: ab(enc), info: ab(info) });
  const plaintext = new Uint8Array(await ctx.open(ab(ciphertext)));
  const secret = new Uint8Array(await ctx.export(ab(utf8(`${tag} response`)), 32));
  const encCopy = Uint8Array.from(enc);
  return {
    plaintext,
    async sealResponse(response: Uint8Array) {
      const nonce = crypto.getRandomValues(new Uint8Array(EXCHANGE_RESPONSE_NONCE_BYTES));
      const k = exchangeResponseKeys(secret, encCopy, nonce);
      return { nonce, ciphertext: chacha20poly1305(k.key, k.nonce).encrypt(response) };
    },
  };
}
