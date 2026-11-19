/** sealed-exchange.ts — an encrypted request to an enclave and ITS answer, sealed for this one client (client side).
 *
 *  HPKE (RFC 9180: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20-Poly1305), answer encapsulated as in Oblivious HTTP
 *  (RFC 9458 §4.4) :
 *   - request: HPKE in base mode to the enclave's X25519 key VERIFIED on-chain, info = exchangeInfo(label, chain,
 *     registry, product, signer): only the enclave registered for this product, on this registry, can open it;
 *   - answer: secret = Export("<label> response", 32) of the request's context; AEAD key and nonce derived by HKDF
 *     from the salt enc ‖ answer nonce; ChaCha20-Poly1305. Only the client and the enclave know this secret: an answer
 *     that opens comes from the enclave and answers THIS request (a proxy can neither read it, nor change it, nor
 *     replay the answer to another request).
 *  The same protocol on the enclave side: enclave/src/kit/hpke-exchange.ts (cross test: enclave/test/copilot-exchange.test.ts). */
import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { extract, expand } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { type Address, encodeAbiParameters, keccak256, toBytes } from "viem";

/** Length of the answer nonce (max(Nn, Nk) of ChaCha20-Poly1305, as in RFC 9458). */
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
  return toBytes(keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
    [tag, BigInt(chainId), registry, productId, signer],
  )));
}

/** AEAD key and nonce of the answer (RFC 9458 §4.4, with SHA-256 and ChaCha20-Poly1305). */
export function exchangeResponseKeys(secret: Uint8Array, enc: Uint8Array, responseNonce: Uint8Array): { key: Uint8Array; nonce: Uint8Array } {
  const salt = new Uint8Array(enc.length + responseNonce.length);
  salt.set(enc, 0);
  salt.set(responseNonce, enc.length);
  const prk = extract(sha256, secret, salt);
  return { key: expand(sha256, prk, utf8("key"), 32), nonce: expand(sha256, prk, utf8("nonce"), 12) };
}

export interface SealedExchange {
  /** HPKE encapsulated key (32 bytes). */
  enc: Uint8Array;
  /** The encrypted request. */
  ciphertext: Uint8Array;
  /** Opens the enclave's answer to THIS request; throws if it does not come from the enclave or was changed. */
  openResponse(responseNonce: Uint8Array, ciphertext: Uint8Array): Uint8Array;
}

/** Encrypts a request to an enclave's X25519 key (raw, 32 bytes) and prepares the opening of its answer. */
export async function sealExchange(recipientPublicRaw: Uint8Array, tag: string, info: Uint8Array, plaintext: Uint8Array): Promise<SealedExchange> {
  const s = suite();
  const pk = await s.kem.importKey("raw", ab(recipientPublicRaw), true);
  const sender = await s.createSenderContext({ recipientPublicKey: pk, info: ab(info) });
  const ciphertext = new Uint8Array(await sender.seal(ab(plaintext)));
  const secret = new Uint8Array(await sender.export(ab(utf8(`${tag} response`)), 32));
  const enc = new Uint8Array(sender.enc);
  return {
    enc,
    ciphertext,
    openResponse(responseNonce: Uint8Array, ct: Uint8Array): Uint8Array {
      if (responseNonce.length !== EXCHANGE_RESPONSE_NONCE_BYTES) throw new Error(`answer nonce: ${EXCHANGE_RESPONSE_NONCE_BYTES} bytes expected`);
      const k = exchangeResponseKeys(secret, enc, responseNonce);
      return chacha20poly1305(k.key, k.nonce).decrypt(ct);
    },
  };
}
