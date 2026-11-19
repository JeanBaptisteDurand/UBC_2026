/** sealed-exchange.ts — une requête chiffrée vers une enclave et SA réponse, scellée pour ce seul client (côté client).
 *
 *  HPKE (RFC 9180 : DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20-Poly1305), réponse encapsulée comme Oblivious HTTP
 *  (RFC 9458 §4.4) :
 *   - requête : HPKE en mode de base vers la clé X25519 VÉRIFIÉE on-chain de l'enclave, info = exchangeInfo(étiquette,
 *     chaîne, registre, produit, signataire) : seule l'enclave inscrite pour ce produit, sur ce registre, l'ouvre ;
 *   - réponse : secret = Export(« <étiquette> response », 32) du contexte de la requête ; clé et nonce AEAD tirés par
 *     HKDF du sel enc ‖ nonce de réponse ; ChaCha20-Poly1305. Ce secret n'est connu que du client et de l'enclave : une
 *     réponse qui s'ouvre vient de l'enclave et répond à CETTE requête (un mandataire ne peut ni la lire, ni la modifier,
 *     ni rejouer celle d'une autre requête).
 *  Le même protocole côté enclave : enclave/src/kit/hpke-exchange.ts (test croisé : enclave/test/copilot-exchange.test.ts). */
import { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { extract, expand } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { type Address, encodeAbiParameters, keccak256, toBytes } from "viem";

/** Longueur du nonce de réponse (max(Nn, Nk) de ChaCha20-Poly1305, comme RFC 9458). */
export const EXCHANGE_RESPONSE_NONCE_BYTES = 32;

const utf8 = (s: string) => new TextEncoder().encode(s);

function suite(): CipherSuite {
  return new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305() });
}
function ab(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** info HPKE d'un échange = keccak256(abi.encode(étiquette, chainId, registre, produit, signataire)) : 32 octets. */
export function exchangeInfo(tag: string, chainId: bigint | number, registry: Address, productId: bigint, signer: Address): Uint8Array {
  return toBytes(keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
    [tag, BigInt(chainId), registry, productId, signer],
  )));
}

/** Clé et nonce AEAD de la réponse (RFC 9458 §4.4, avec SHA-256 et ChaCha20-Poly1305). */
export function exchangeResponseKeys(secret: Uint8Array, enc: Uint8Array, responseNonce: Uint8Array): { key: Uint8Array; nonce: Uint8Array } {
  const salt = new Uint8Array(enc.length + responseNonce.length);
  salt.set(enc, 0);
  salt.set(responseNonce, enc.length);
  const prk = extract(sha256, secret, salt);
  return { key: expand(sha256, prk, utf8("key"), 32), nonce: expand(sha256, prk, utf8("nonce"), 12) };
}

export interface SealedExchange {
  /** Clé encapsulée HPKE (32 octets). */
  enc: Uint8Array;
  /** La requête chiffrée. */
  ciphertext: Uint8Array;
  /** Ouvre la réponse de l'enclave à CETTE requête ; lève si elle ne vient pas de l'enclave ou a été modifiée. */
  openResponse(responseNonce: Uint8Array, ciphertext: Uint8Array): Uint8Array;
}

/** Chiffre une requête vers la clé X25519 (brute, 32 octets) d'une enclave et prépare l'ouverture de sa réponse. */
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
      if (responseNonce.length !== EXCHANGE_RESPONSE_NONCE_BYTES) throw new Error(`nonce de réponse : ${EXCHANGE_RESPONSE_NONCE_BYTES} octets attendus`);
      const k = exchangeResponseKeys(secret, enc, responseNonce);
      return chacha20poly1305(k.key, k.nonce).decrypt(ct);
    },
  };
}
