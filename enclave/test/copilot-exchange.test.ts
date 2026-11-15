/**
 * Échange scellé requête/réponse (hpke-exchange.ts, conversation chiffrée du copilote attesté) : le kit d'enclave et le
 * client du SDK (packages/sdk/src/sealed-exchange.ts) doivent produire et ouvrir exactement les mêmes octets.
 * HPKE (RFC 9180) vers la clé X25519 de l'enclave, info liée à la chaîne, au registre, au produit et au signataire ; réponse
 * encapsulée comme Oblivious HTTP (RFC 9458 §4.4) avec un secret exporté du contexte de la requête.
 */
import { describe, it, expect } from "vitest";
import { type Address, toBytes } from "viem";
import { EnclaveKit } from "../src/kit/enclave-kit";
import { exchangeInfo as enclaveInfo, EXCHANGE_RESPONSE_NONCE_BYTES } from "../src/kit/hpke-exchange";
import { exchangeInfo as sdkInfo, sealExchange, COPILOT_SEALED_TAG } from "../../packages/sdk/src/index";

const REG = "0x00000000000000000000000000000000000000c2" as Address;
const TAG = COPILOT_SEALED_TAG;
const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

function kit(productId = 4n): EnclaveKit {
  return new EnclaveKit({ productId, chainId: 5042002, registry: REG, mockBlockHash: true });
}
/** Ce que le client du SDK envoie à CETTE enclave (info calculée côté client). */
async function sealFor(k: EnclaveKit, plaintext: string, o: { productId?: bigint; registry?: Address; chainId?: number; tag?: string; signer?: Address } = {}) {
  const info = sdkInfo(o.tag ?? TAG, o.chainId ?? 5042002, o.registry ?? REG, o.productId ?? 4n, o.signer ?? k.keys.signer);
  return sealExchange(toBytes(k.keys.x25519PublicKey), TAG, info, utf8(plaintext));
}

describe("échange scellé (copilote attesté) : kit d'enclave ↔ SDK", () => {
  it("même info des deux côtés ; aller-retour : l'enclave lit la requête, seul ce client lit la réponse", async () => {
    const k = kit();
    expect(sdkInfo(TAG, 5042002, REG, 4n, k.keys.signer)).toEqual(enclaveInfo(TAG, 5042002, REG, 4n, k.keys.signer));
    expect(k.exchangeInfo(TAG)).toEqual(sdkInfo(TAG, 5042002, REG, 4n, k.keys.signer));
    const sx = await sealFor(k, '{"messages":[{"role":"user","content":"bonjour"}]}');
    expect(sx.enc.length).toBe(32);
    const opened = await k.openExchange(TAG, sx.enc, sx.ciphertext);
    expect(text(opened.plaintext)).toBe('{"messages":[{"role":"user","content":"bonjour"}]}');
    const r = await opened.sealResponse(utf8("réponse de l'enclave"));
    expect(r.nonce.length).toBe(EXCHANGE_RESPONSE_NONCE_BYTES);
    expect(text(sx.openResponse(r.nonce, r.ciphertext))).toBe("réponse de l'enclave");
    // deux réponses scellées ne se ressemblent pas (nonce de réponse aléatoire)
    const r2 = await opened.sealResponse(utf8("réponse de l'enclave"));
    expect(Buffer.from(r2.ciphertext).equals(Buffer.from(r.ciphertext))).toBe(false);
  });

  it("une requête liée à un autre produit, registre, chaîne, signataire ou protocole ne s'ouvre pas ; ni chez une autre enclave", async () => {
    const k = kit();
    const other = kit();
    for (const o of [{ productId: 5n }, { registry: "0x00000000000000000000000000000000000000c3" as Address }, { chainId: 5042 }, { tag: "ARC-AUTRE-v1" }, { signer: other.keys.signer }]) {
      const sx = await sealFor(k, "x", o);
      await expect(k.openExchange(TAG, sx.enc, sx.ciphertext)).rejects.toThrow();
    }
    // chiffrée pour k : l'autre enclave (autre clé X25519) ne l'ouvre pas, même en se disant k
    const sx = await sealFor(k, "x");
    await expect(other.openExchange(TAG, sx.enc, sx.ciphertext)).rejects.toThrow();
    // même produit, même registre, autre produit déclaré par l'enclave : ne s'ouvre pas
    await expect(kit(7n).openExchange(TAG, sx.enc, sx.ciphertext)).rejects.toThrow();
  });

  it("modifications détectées : requête ou réponse altérée, réponse d'une autre requête, mauvais nonce", async () => {
    const k = kit();
    const a = await sealFor(k, "requête A");
    const b = await sealFor(k, "requête B");
    const flipped = Uint8Array.from(a.ciphertext);
    flipped[0]! ^= 1;
    await expect(k.openExchange(TAG, a.enc, flipped)).rejects.toThrow();
    const oa = await k.openExchange(TAG, a.enc, a.ciphertext);
    const ra = await oa.sealResponse(utf8("réponse à A"));
    const bad = Uint8Array.from(ra.ciphertext);
    bad[bad.length - 1]! ^= 1;
    expect(() => a.openResponse(ra.nonce, bad)).toThrow();
    expect(() => b.openResponse(ra.nonce, ra.ciphertext)).toThrow(); // la réponse à A ne passe pas pour une réponse à B
    const nonce = Uint8Array.from(ra.nonce);
    nonce[0]! ^= 1;
    expect(() => a.openResponse(nonce, ra.ciphertext)).toThrow();
    expect(() => a.openResponse(ra.nonce.slice(0, 12), ra.ciphertext)).toThrow(/32 octets/);
    expect(text(a.openResponse(ra.nonce, ra.ciphertext))).toBe("réponse à A");
  });
});
