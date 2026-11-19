import { describe, it, expect } from "vitest";
import { type Address, type Hex, toBytes, toHex } from "viem";

import { EnclaveKit } from "../src/kit/enclave-kit";
import { recoverReceiptSigner, recoverClaimSigner } from "../src/kit/eip712";
import { seal } from "../src/kit/hpke";
import {
  InferenceGateway,
  type SessionReader,
  type SessionView,
  type LlamaClient,
  type BlockSource,
} from "../src/services/inference";
import {
  canonicalize,
  predicateHash,
  evaluate,
  type Predicate,
  type EvalContext,
} from "../src/services/predicate";
import { BountyService, pickTier, type BountyReader, type BountyView, type ForkRunner, type ProtocolCipher } from "../src/services/bounty";

const CHAIN = 5042002;
const SESSIONPAY = "0x00000000000000000000000000000000000000aa" as Address;
const SEALED = "0x00000000000000000000000000000000000000bb" as Address;
const MODEL = "0x6a1a2eb6000000000000000000000000000000000000000000000000000407e0" as Hex;
const TOKEN = "0x0000000000000000000000000000000000000010" as Address;
const HOLDER = "0x0000000000000000000000000000000000000011" as Address;

function newKit(): EnclaveKit {
  return new EnclaveKit({ productId: 1n, chainId: CHAIN, registry: "0x0000000000000000000000000000000000000001", mockBlockHash: true });
}

class FakeReader implements SessionReader {
  constructor(private s: SessionView) {}
  async getSession(): Promise<SessionView> {
    return this.s;
  }
}

class FakeLlama implements LlamaClient {
  async infer() {
    return { text: "answer", tokensIn: 10, tokensOut: 20 };
  }
}

class FakeBlocks implements BlockSource {
  async current() {
    return 1000n;
  }
}

describe("InferenceGateway (private inference)", () => {
  /** A session bound to the enclave `kit` (only that enclave serves it), with a distant expiry. */
  function session(kit: EnclaveKit, deposit: bigint, price: bigint): SessionView {
    return {
      owner: HOLDER,
      productId: 1n,
      operator: "0x0000000000000000000000000000000000000002",
      sessionKey: "0x0000000000000000000000000000000000000003",
      deposit,
      price,
      paidUnits: 0n,
      expiresAt: 4_000_000_000n, // year 2096
      closed: false,
      enclave: kit.keys.signer,
    };
  }

  it("100 requests => increasing cumulative receipts, each signed by the enclave", async () => {
    const kit = newKit();
    const gw = new InferenceGateway(kit, { sessionPay: SESSIONPAY, modelHash: MODEL }, new FakeReader(session(kit, 10_000_000n, 1n)), new FakeLlama(), new FakeBlocks());
    let prev = 0n;
    for (let i = 1n; i <= 100n; i++) {
      const res = await gw.handle(1n, i, `prompt ${i}`, {});
      expect(res.status).toBe(200);
      if (res.status === 200) {
        expect(res.receipt.cumulativeUnits).toBe(prev + 30n);
        prev = res.receipt.cumulativeUnits;
        const rec = await recoverReceiptSigner({ chainId: CHAIN, verifyingContract: SESSIONPAY }, res.receipt, res.signature);
        expect(rec.toLowerCase()).toBe(kit.keys.signer.toLowerCase());
      }
    }
    expect(prev).toBe(3000n);
  });

  it("empty session => 402 insufficient_session_balance", async () => {
    const kit = newKit();
    const gw = new InferenceGateway(kit, { sessionPay: SESSIONPAY, modelHash: MODEL }, new FakeReader(session(kit, 100n, 1n)), new FakeLlama(), new FakeBlocks());
    // 30 units/req, price 1, deposit 100: req 1,2,3 pass (30,60,90), req 4 (120) -> 402
    for (let i = 1n; i <= 3n; i++) expect((await gw.handle(1n, i, "p", {})).status).toBe(200);
    const res = await gw.handle(1n, 4n, "p", {});
    expect(res.status).toBe(402);
    if (res.status === 402) expect(res.balance).toBe(10n); // 100 - 90
  });
});

describe("predicate (Sealed Bounty)", () => {
  const pred: Predicate = {
    combine: "OR",
    clauses: [{ type: "ERC20_DROP", token: TOKEN, holder: HOLDER, min: "1000000" }],
  };

  it("canonicalization independent of key order + stable hash", () => {
    const a = canonicalize(pred);
    const reordered = { clauses: pred.clauses, combine: pred.combine } as Predicate;
    expect(canonicalize(reordered)).toBe(a);
    expect(predicateHash(pred)).toBe(predicateHash(reordered));
  });

  it("evaluates a balance drop", () => {
    const ctx: EvalContext = {
      erc20Drop: () => 5_000_000n,
      nativeDrop: () => 0n,
      attackerProfit: () => 0n,
      viewValue: () => 0n,
      invariantHeld: () => true,
    };
    const r = evaluate(pred, ctx);
    expect(r.satisfied).toBe(true);
    expect(r.loss).toBe(5_000_000n);
  });

  it("pickTier picks the highest tier reached", () => {
    expect(pickTier([1_000_000n, 10_000_000n, 100_000_000n], 50_000_000n)).toBe(1);
    expect(pickTier([1_000_000n], 10n)).toBe(-1);
  });
});

describe("BountyService (Sealed Bounty)", () => {
  const pred: Predicate = {
    combine: "OR",
    clauses: [{ type: "ERC20_DROP", token: TOKEN, holder: HOLDER, min: "1000000" }],
  };

  class FakeBountyReader implements BountyReader {
    constructor(private v: BountyView) {}
    async getBounty(): Promise<BountyView> {
      return this.v;
    }
  }
  class FakeCipher implements ProtocolCipher {
    async recompute(bundle: { cP: Hex }): Promise<Hex> {
      return bundle.cP; // reproducible (stub)
    }
  }
  class FakeFork implements ForkRunner {
    async run() {
      const ctx: EvalContext = {
        erc20Drop: () => 5_000_000n,
        nativeDrop: () => 0n,
        attackerProfit: () => 0n,
        viewValue: () => 0n,
        invariantHeld: () => true,
      };
      return { ctx, fingerprint: ("0x" + "fe".repeat(32)) as Hex };
    }
  }
  const blocks = {
    async current() {
      return 1002n;
    },
    async blockHash() {
      return ("0x" + "ab".repeat(32)) as Hex;
    },
  };

  async function sealBundle(kit: EnclaveKit, cP: Hex) {
    const bundle = {
      bountyId: "1",
      payee: "0x0000000000000000000000000000000000000012",
      capital: "1000000000",
      predicate: pred,
      txs: ["0xdeadbeef"],
      r: "0x" + "22".repeat(32),
      cP,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(bundle));
    return seal(toBytes(kit.keys.x25519PublicKey), bytes);
  }

  it("valid submission => claim proven and signed by the enclave", async () => {
    const kit = newKit();
    const cP = ("0x" + "cc".repeat(40)) as Hex;
    const reader = new FakeBountyReader({ predicateHash: predicateHash(pred), protocolX25519: ("0x" + "00".repeat(32)) as Hex, tierMinLoss: [1_000_000n, 10_000_000n], deadline: 9_000_000n });
    const svc = new BountyService(kit, { sealedBounty: SEALED }, reader, new FakeCipher(), new FakeFork(), blocks, () => 1_000_000n);

    const enc = await sealBundle(kit, cP);
    const res = await svc.submit(enc);
    expect(res.status).toBe("proven");
    if (res.status === "proven") {
      expect(res.claim.loss).toBe(5_000_000n);
      expect(res.claim.tier).toBe(0); // 5e6 >= 1e6 but < 10e6
      expect(res.claim.blockN).toBe(1000n); // 1002 - 2
      const rec = await recoverClaimSigner({ chainId: CHAIN, verifyingContract: SEALED }, res.claim, res.signature);
      expect(rec.toLowerCase()).toBe(kit.keys.signer.toLowerCase());
    }
  });

  it("mismatched predicate => not proven", async () => {
    const kit = newKit();
    const reader = new FakeBountyReader({ predicateHash: ("0x" + "99".repeat(32)) as Hex, protocolX25519: ("0x" + "00".repeat(32)) as Hex, tierMinLoss: [1_000_000n], deadline: 9_000_000n });
    const svc = new BountyService(kit, { sealedBounty: SEALED }, reader, new FakeCipher(), new FakeFork(), blocks, () => 1_000_000n);
    const enc = await sealBundle(kit, ("0x" + "cc".repeat(40)) as Hex);
    const res = await svc.submit(enc);
    expect(res.status).toBe("not_proven");
  });
});
