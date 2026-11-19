/**
 * Sealed request/response exchange (hpke-exchange.ts, the attested copilot's encrypted conversation): the enclave kit and
 * the SDK client (packages/sdk/src/sealed-exchange.ts) must produce and open exactly the same bytes.
 * HPKE (RFC 9180) to the enclave's X25519 key, with info bound to the chain, the registry, the product and the signer; the
 * response is encapsulated as in Oblivious HTTP (RFC 9458 §4.4) with a secret exported from the request's context.
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
/** What the SDK client sends to this enclave (info computed on the client side). */
async function sealFor(k: EnclaveKit, plaintext: string, o: { productId?: bigint; registry?: Address; chainId?: number; tag?: string; signer?: Address } = {}) {
  const info = sdkInfo(o.tag ?? TAG, o.chainId ?? 5042002, o.registry ?? REG, o.productId ?? 4n, o.signer ?? k.keys.signer);
  return sealExchange(toBytes(k.keys.x25519PublicKey), TAG, info, utf8(plaintext));
}

describe("sealed exchange (attested copilot): enclave kit ↔ SDK", () => {
  it("same info on both sides; round trip: the enclave reads the request, only this client reads the response", async () => {
    const k = kit();
    expect(sdkInfo(TAG, 5042002, REG, 4n, k.keys.signer)).toEqual(enclaveInfo(TAG, 5042002, REG, 4n, k.keys.signer));
    expect(k.exchangeInfo(TAG)).toEqual(sdkInfo(TAG, 5042002, REG, 4n, k.keys.signer));
    const sx = await sealFor(k, '{"messages":[{"role":"user","content":"bonjour"}]}');
    expect(sx.enc.length).toBe(32);
    const opened = await k.openExchange(TAG, sx.enc, sx.ciphertext);
    expect(text(opened.plaintext)).toBe('{"messages":[{"role":"user","content":"bonjour"}]}');
    const r = await opened.sealResponse(utf8("the enclave's response"));
    expect(r.nonce.length).toBe(EXCHANGE_RESPONSE_NONCE_BYTES);
    expect(text(sx.openResponse(r.nonce, r.ciphertext))).toBe("the enclave's response");
    // two sealed responses differ (random response nonce)
    const r2 = await opened.sealResponse(utf8("the enclave's response"));
    expect(Buffer.from(r2.ciphertext).equals(Buffer.from(r.ciphertext))).toBe(false);
  });

  it("a request bound to another product, registry, chain, signer or protocol does not open; nor at another enclave", async () => {
    const k = kit();
    const other = kit();
    for (const o of [{ productId: 5n }, { registry: "0x00000000000000000000000000000000000000c3" as Address }, { chainId: 5042 }, { tag: "ARC-AUTRE-v1" }, { signer: other.keys.signer }]) {
      const sx = await sealFor(k, "x", o);
      await expect(k.openExchange(TAG, sx.enc, sx.ciphertext)).rejects.toThrow();
    }
    // encrypted for k: the other enclave (another X25519 key) cannot open it, even claiming to be k
    const sx = await sealFor(k, "x");
    await expect(other.openExchange(TAG, sx.enc, sx.ciphertext)).rejects.toThrow();
    // same registry, but the enclave declares another product: does not open
    await expect(kit(7n).openExchange(TAG, sx.enc, sx.ciphertext)).rejects.toThrow();
  });

  it("tampering detected: altered request or response, response to another request, wrong nonce", async () => {
    const k = kit();
    const a = await sealFor(k, "request A");
    const b = await sealFor(k, "request B");
    const flipped = Uint8Array.from(a.ciphertext);
    flipped[0]! ^= 1;
    await expect(k.openExchange(TAG, a.enc, flipped)).rejects.toThrow();
    const oa = await k.openExchange(TAG, a.enc, a.ciphertext);
    const ra = await oa.sealResponse(utf8("response to A"));
    const bad = Uint8Array.from(ra.ciphertext);
    bad[bad.length - 1]! ^= 1;
    expect(() => a.openResponse(ra.nonce, bad)).toThrow();
    expect(() => b.openResponse(ra.nonce, ra.ciphertext)).toThrow(); // the response to A does not pass as a response to B
    const nonce = Uint8Array.from(ra.nonce);
    nonce[0]! ^= 1;
    expect(() => a.openResponse(nonce, ra.ciphertext)).toThrow();
    expect(() => a.openResponse(ra.nonce.slice(0, 12), ra.ciphertext)).toThrow(/32 octets/);
    expect(text(a.openResponse(ra.nonce, ra.ciphertext))).toBe("response to A");
  });
});
