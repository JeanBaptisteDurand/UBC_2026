/**
 * hpke-exchange.ts — une requête chiffrée vers l'enclave et SA réponse, scellée pour le seul client qui l'a envoyée
 * (côté enclave). Sert à la conversation chiffrée du copilote attesté (services/copilot/src/enclave-app.ts).
 *
 * Construit sur HPKE (RFC 9180, même suite que hpke.ts : DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20-Poly1305),
 * comme l'encapsulation des réponses d'Oblivious HTTP (RFC 9458 §4.4) :
 *  - requête : HPKE en mode de base vers la clé X25519 de l'enclave, avec info = exchangeInfo(étiquette, chaîne,
 *    registre, produit, signataire) : un chiffré préparé pour une AUTRE enclave, un autre produit ou un autre registre ne
 *    s'ouvre pas ici ;
 *  - réponse : secret = Export(« <étiquette> response », 32) du contexte HPKE de la requête ; nonce de réponse aléatoire
 *    de 32 octets ; prk = HKDF-Extract(sel = enc ‖ nonce, secret) ; clé = HKDF-Expand(prk, "key", 32) ;
 *    nonce AEAD = HKDF-Expand(prk, "nonce", 12) ; chiffré = ChaCha20-Poly1305(clé, nonce AEAD, réponse).
 *    Seuls le client (qui a créé le contexte) et l'enclave (clé privée X25519, en mémoire) connaissent ce secret : un
 *    mandataire ne peut ni lire la réponse, ni en fabriquer une, ni rejouer celle d'une autre requête.
 * Le même protocole côté client : packages/sdk/src/sealed-exchange.ts (test croisé : enclave/test/copilot-exchange.test.ts).
 */
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
  return toBytes(
    keccak256(
      encodeAbiParameters(
        [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
        [tag, BigInt(chainId), registry, productId, signer],
      ),
    ),
  );
}

/** Clé et nonce AEAD de la réponse (RFC 9458 §4.4, avec SHA-256 et ChaCha20-Poly1305). */
export function exchangeResponseKeys(secret: Uint8Array, enc: Uint8Array, responseNonce: Uint8Array): { key: Uint8Array; nonce: Uint8Array } {
  const salt = new Uint8Array(enc.length + responseNonce.length);
  salt.set(enc, 0);
  salt.set(responseNonce, enc.length);
  const prk = extract(sha256, secret, salt);
  return { key: expand(sha256, prk, utf8("key"), 32), nonce: expand(sha256, prk, utf8("nonce"), 12) };
}

export interface OpenedExchange {
  /** La requête en clair. */
  plaintext: Uint8Array;
  /** Scelle la réponse à CETTE requête : seul son client peut l'ouvrir (et vérifier qu'elle vient de cette enclave). */
  sealResponse(plaintext: Uint8Array): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }>;
}

/** Ouvre une requête scellée (lève si elle n'est pas pour cette clé, cette info ou si elle a été modifiée). */
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
