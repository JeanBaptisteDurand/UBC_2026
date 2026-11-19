import { describe, it, expect } from "vitest";
import { toBytes } from "viem";
import { hpkeSeal, hpkeOpen, deterministicSeal, deterministicOpen, generateSessionKey, generateX25519 } from "../src/crypto";
import { envelopeDigest } from "../src/eip712";
import { testnet, networkDomain, usdcDomain } from "../src/network";

describe("sdk crypto", () => {
  it("HPKE seal/open round-trip", async () => {
    const x = generateX25519();
    const sealed = await hpkeSeal(toBytes(x.publicKey), new TextEncoder().encode("prompt"));
    const back = await hpkeOpen(x.privateKey, sealed.enc, sealed.ciphertext);
    expect(new TextDecoder().decode(back)).toBe("prompt");
  });

  it("deterministic seal is reproducible + open", () => {
    const x = generateX25519();
    const r = new Uint8Array(32).fill(9);
    const a = deterministicSeal(toBytes(x.publicKey), new Uint8Array([1, 2, 3]), r);
    const b = deterministicSeal(toBytes(x.publicKey), new Uint8Array([1, 2, 3]), r);
    expect(a).toBe(b);
    expect([...deterministicOpen(x.privateKey, a)]).toEqual([1, 2, 3]);
  });

  it("session key + deterministic envelope digest", () => {
    const sk = generateSessionKey();
    expect(sk.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const d1 = envelopeDigest(1n, 1n, "0xdead", "0x" + "11".repeat(32) as any);
    const d2 = envelopeDigest(1n, 1n, "0xdead", "0x" + "11".repeat(32) as any);
    expect(d1).toBe(d2);
  });

  it("network + domains", () => {
    expect(testnet.chainId).toBe(5042002);
    expect(networkDomain(testnet.sessionPay).name).toBe("ArcEnclaveNetwork");
    expect(usdcDomain(testnet.usdc).version).toBe("2");
  });
});
