import { describe, it, expect } from "vitest";
import { type Address, type Hex, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { generateEnclaveKeys } from "../src/kit/keys";
import { deterministicSeal, deterministicOpen } from "../src/kit/deterministic-seal";
import {
  buildChallenge,
  buildPayerAuthorization,
  encodeXPayment,
  decodeXPayment,
  facilitatorVerify,
} from "../src/services/x402";

const USDC = "0x3600000000000000000000000000000000000000" as Address;
const SETTLER = "0x00000000000000000000000000000000000000bb" as Address;
const CHAIN = 5042002;

describe("deterministic-seal (cP reproductible)", () => {
  it("même (clé, message, r) => même cP, et le protocole déchiffre sans r", () => {
    const proto = generateEnclaveKeys(); // sert de clé protocole X25519
    const msg = new TextEncoder().encode("bundle d'exploit");
    const r = new Uint8Array(32).fill(7);

    const cP1 = deterministicSeal(toBytes(proto.x25519PublicKey), msg, r);
    const cP2 = deterministicSeal(toBytes(proto.x25519PublicKey), msg, r);
    expect(cP1).toBe(cP2); // reproductible : deux enclaves signent le même hash

    const back = deterministicOpen(proto.x25519PrivateKey, cP1);
    expect(new TextDecoder().decode(back)).toBe("bundle d'exploit");
  });

  it("r différent => cP différent ; mauvaise clé => échec", () => {
    const proto = generateEnclaveKeys();
    const other = generateEnclaveKeys();
    const msg = new Uint8Array([1, 2, 3]);
    const cPa = deterministicSeal(toBytes(proto.x25519PublicKey), msg, new Uint8Array(32).fill(1));
    const cPb = deterministicSeal(toBytes(proto.x25519PublicKey), msg, new Uint8Array(32).fill(2));
    expect(cPa).not.toBe(cPb);
    expect(() => deterministicOpen(other.x25519PrivateKey, cPa)).toThrow();
  });
});

describe("x402 (couche HTTP)", () => {
  const payerPk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
  const account = privateKeyToAccount(payerPk);

  function req() {
    return buildChallenge({
      network: "arc-testnet",
      amount: 1_000_000n,
      resource: "https://enclave/v1/chat/completions",
      payTo: SETTLER,
      asset: USDC,
      usdcName: "USDC",
      usdcVersion: "2",
    }).accepts[0]!;
  }

  it("challenge -> X-PAYMENT encode/decode -> facilitateur vérifie la signature EIP-3009", async () => {
    const r = req();
    const nonce = ("0x" + "7a".repeat(32)) as Hex;
    const validBefore = 2_000_000_000n;
    const payload = await buildPayerAuthorization(
      (args) => account.signTypedData(args as any),
      r,
      CHAIN,
      account.address,
      nonce,
      validBefore,
    );

    const header = encodeXPayment(payload);
    expect(decodeXPayment(header)).toEqual(payload);

    const v = await facilitatorVerify(payload, r, CHAIN, 1_000_000_000n);
    expect(v.ok).toBe(true);
  });

  it("montant insuffisant => refus", async () => {
    const r = req();
    const nonce = ("0x" + "7b".repeat(32)) as Hex;
    const payload = await buildPayerAuthorization(
      (args) => account.signTypedData(args as any),
      r,
      CHAIN,
      account.address,
      nonce,
      2_000_000_000n,
    );
    // le service exige plus que ce que le payeur a signé
    const stricter = { ...r, maxAmountRequired: "2000000" };
    const v = await facilitatorVerify(payload, stricter, CHAIN, 1_000_000_000n);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("montant");
  });

  it("signataire != from => refus", async () => {
    const r = req();
    const nonce = ("0x" + "7c".repeat(32)) as Hex;
    const payload = await buildPayerAuthorization(
      (args) => account.signTypedData(args as any),
      r,
      CHAIN,
      account.address,
      nonce,
      2_000_000_000n,
    );
    payload.payload.authorization.from = "0x000000000000000000000000000000000000dEaD" as Address;
    const v = await facilitatorVerify(payload, r, CHAIN, 1_000_000_000n);
    expect(v.ok).toBe(false);
  });
});
