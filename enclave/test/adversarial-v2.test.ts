/**
 * ADVERSARIAL review of the v2 enclave (7 Nov 2026), fixed cases (v2 bis). Each "FIXED v2" (the same convention as the
 * contracts' `test_FIXED_*`) replays the SAME scenario and proves that it no longer passes. Mainnet parameters from
 * F-economie-mainnet-2026-11-07: UNIT_TOKENS=1000, OUT_WEIGHT=4, a price of 200 base units per unit.
 */
import { describe, it, expect } from "vitest";
import { type Address, type Hex, keccak256, numberToHex, toBytes, toHex } from "viem";

import { EnclaveKit } from "../src/kit/enclave-kit";
import { seal } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import { createAttestServer } from "../src/server/attest-server";
import {
  InferenceGateway,
  GatewayError,
  type BlockSource,
  type GatewayConfig,
  type InferenceOk,
  type LlamaClient,
  type SessionReader,
  type SessionView,
} from "../src/services/inference";
import { predicateHash, type EvalContext, type Predicate } from "../src/services/predicate";
import {
  BountyService,
  DeterministicProtocolCipher,
  exploitFingerprint,
  type BountyReader,
  type BountyView,
  type ExploitBundle,
  type ForkRunner,
  type SubmitResult,
} from "../src/services/bounty";
import { exploitFingerprint as anvilExploitFingerprint } from "../src/services/anvil-fork";

const CHAIN = 5042002;
const SESSIONPAY = "0x00000000000000000000000000000000000000aa" as Address;
const SEALED = "0x00000000000000000000000000000000000000bb" as Address;
const REGISTRY = "0x0000000000000000000000000000000000000001" as Address;
const MODEL = ("0x" + "6a".repeat(32)) as Hex;
const MY_PRODUCT = 1n; // the PRODUCT_ID of this inference enclave (kit)
const MY_OPERATOR = "0x0000000000000000000000000000000000000002" as Address;

function chatKit(): EnclaveKit {
  return new EnclaveKit({ productId: MY_PRODUCT, chainId: CHAIN, registry: REGISTRY, mockBlockHash: true });
}

/** A session BOUND to the `kit` enclave (v2 bis), of this enclave's operator, with a distant expiry. */
function session(kit: EnclaveKit, over: Partial<SessionView> = {}): SessionView {
  return {
    owner: "0x0000000000000000000000000000000000000011",
    productId: MY_PRODUCT,
    operator: MY_OPERATOR,
    sessionKey: "0x0000000000000000000000000000000000000003",
    deposit: 10_000_000n, // 10 USDC
    price: 200n, // F §0.2
    paidUnits: 0n,
    expiresAt: 4_000_000_000n, // an 2096
    closed: false,
    enclave: kit.keys.signer,
    param: MODEL,
    unitTokens: 1000n,
    outWeight: 4n,
    ...over,
  };
}

class Reader implements SessionReader {
  constructor(public s: SessionView) {}
  async getSession(): Promise<SessionView> {
    return { ...this.s };
  }
}

const blocks: BlockSource = { current: async () => 1000n };
const NOW_S = 1_800_000_000n; // horloge des tests (2027)

/** A fake model: the sample request of F §2.2 (40,000 tokens read, 2,000 written); counts the calls paid upstream. */
class TypicalLlama implements LlamaClient {
  calls = 0;
  async infer(prompt: string) {
    this.calls++;
    return { text: `answer to ${prompt}`, tokensIn: 40_000, tokensOut: 2_000 };
  }
}

/** The gateway of the `kit` enclave, run by MY_OPERATOR (OPERATOR_ALLOWLIST), UNIT_TOKENS=1000, OUT_WEIGHT=4. */
function gateway(kit: EnclaveKit, reader: SessionReader, llama: LlamaClient, over: Partial<GatewayConfig> = {}): InferenceGateway {
  return new InferenceGateway(
    kit,
    { sessionPay: SESSIONPAY, modelHash: MODEL, unitTokens: 1000n, outWeight: 4n, operators: [MY_OPERATOR], now: () => NOW_S, ...over },
    reader,
    llama,
    blocks,
  );
}

/** The HTTP code of the result: 200 / 402, or the code of a GatewayError, or −1 for any other error. */
async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    return ((await p) as { status: number }).status;
  } catch (e) {
    return e instanceof GatewayError ? e.httpStatus : -1;
  }
}

describe("adversarial v2: the inference gateway, whom does it serve and who pays? (fixed)", () => {
  it("FIXED v2: a session of ANOTHER product, or at price 0, is refused (403) without a call to the model", async () => {
    const kit = chatKit();
    const llama = new TypicalLlama();
    // the Sealed Bounty of F §0.2 (product 2, price 0); on the contract side, SessionPay no longer opens it (ZeroPrice)
    const other = gateway(kit, new Reader(session(kit, { productId: 2n, price: 0n, deposit: 1n })), llama);
    expect(await statusOf(other.handle(1n, 1n, "sample request", {}))).toBe(403);
    const free = gateway(kit, new Reader(session(kit, { price: 0n, deposit: 1n })), llama);
    expect(await statusOf(free.handle(1n, 1n, "sample request", {}))).toBe(403);
    expect(llama.calls, "the operator no longer pays the model for a session that will never pay it").toBe(0);
  });

  it("FIXED v2: a session of another operator, or bound to another enclave, is refused (403) without a call to the model", async () => {
    const kit = chatKit();
    const llama = new TypicalLlama();
    const stranger = "0x000000000000000000000000000000000000dEaD" as Address; // no bond, no enclave
    const gw = gateway(kit, new Reader(session(kit, { operator: stranger })), llama);
    const err = await gw.handle(1n, 1n, "sample request", {}).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).httpStatus).toBe(403);
    expect((err as GatewayError).message).toContain("WrongOperator");

    const elsewhere = gateway(kit, new Reader(session(kit, { enclave: "0x000000000000000000000000000000000000bEEF" })), llama);
    const err2 = await elsewhere.handle(1n, 1n, "sample request", {}).catch((e) => e);
    expect((err2 as GatewayError).httpStatus).toBe(403);
    expect((err2 as GatewayError).message).toContain("WrongEnclave");
    expect(llama.calls).toBe(0);
  });

  it("FIXED v2 (high): an expired session, or one less than a minute from its expiry, is no longer served (410)", async () => {
    const kit = chatKit();
    const llama = new TypicalLlama();
    const expired = gateway(kit, new Reader(session(kit, { expiresAt: 1n })), llama); // expired in 1970
    expect(await statusOf(expired.handle(1n, 1n, "sample request", {}))).toBe(410);
    const almost = gateway(kit, new Reader(session(kit, { expiresAt: NOW_S + 30n })), llama);
    expect(await statusOf(almost.handle(1n, 1n, "sample request", {}))).toBe(410);
    expect(llama.calls).toBe(0);
    const fine = gateway(kit, new Reader(session(kit, { expiresAt: NOW_S + 3600n })), llama);
    expect(await statusOf(fine.handle(1n, 1n, "sample request", {}))).toBe(200);
  });

  it("FIXED v2 (medium): a 402 found AFTER the model keeps the answer; 20 replays = 1 single call; once topped up, the same request receives it", async () => {
    // exactly 1 payable unit is left (deposit 200, price 200); each request costs 48
    const kit = chatKit();
    const llama = new TypicalLlama();
    const reader = new Reader(session(kit, { deposit: 200n }));
    const gw = gateway(kit, reader, llama);
    for (let i = 0; i < 20; i++) expect(await statusOf(gw.handle(1n, 1n, "long prompt", {}))).toBe(402);
    expect(llama.calls, "one single call to the model, never replayed at the operator's expense").toBe(1);
    const r = await gw.handle(1n, 2n, "autre chose", {});
    expect(r.status).toBe(402); // every request of the session waits for the balance to cover the kept answer
    if (r.status === 402) expect(r.pending).toEqual({ seq: 1n, cost: 48n * 200n });
    expect(gw.lastReceipt(1n), "nothing is signed while the answer is not covered").toBeUndefined();

    reader.s.deposit = 10_000_000n; // the owner tops up (SessionPay.topUp)
    expect(await statusOf(gw.handle(1n, 1n, "another prompt", {}))).toBe(409); // only the SAME request
    const served = (await gw.handle(1n, 1n, "long prompt", {})) as InferenceOk;
    expect(served.status).toBe(200);
    expect(served.text).toBe("answer to long prompt");
    expect(served.receipt.cumulativeUnits).toBe(48n);
    expect(llama.calls, "the kept answer is delivered without a second call to the model").toBe(1);
  });

  it("FIXED v2 (high): two enclaves of the same operator; only the session's enclave serves it, the other refuses (403)", async () => {
    const kitA = chatKit();
    const kitB = chatKit();
    const reader = new Reader(session(kitA)); // the session is bound to enclave A
    const llamaB = new TypicalLlama();
    const a = gateway(kitA, reader, new TypicalLlama());
    const b = gateway(kitB, reader, llamaB);
    const ra = (await a.handle(1n, 1n, "question 1", {})) as InferenceOk;
    expect(ra.status).toBe(200);
    expect(ra.receipt.cumulativeUnits).toBe(48n);
    expect(await statusOf(b.handle(1n, 1n, "question 2", {})), "the second enclave no longer serves a session that will not pay it").toBe(403);
    expect(llamaB.calls).toBe(0);
  });
});

describe("adversarial v2: /attest fails CLOSED by default (fixed)", () => {
  it("FIXED v2 (medium): without the OPERATOR_ALLOWLIST line in the compose file, /attest refuses everyone (403); * = explicit development", async () => {
    const saved = process.env.OPERATOR_ALLOWLIST;
    delete process.env.OPERATOR_ALLOWLIST;
    try {
      const kit = chatKit();
      const app = createAttestServer(kit, { registeredOperator: async () => null, warn: () => {} });
      const res = await app.request("/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operator: "0x000000000000000000000000000000000000bEEF", anchorR: "999" }),
      });
      expect(res.status, "a third party no longer gets a quote in ITS name for this enclave's key").toBe(403);

      process.env.OPERATOR_ALLOWLIST = "*";
      const dev = createAttestServer(chatKit(), { registeredOperator: async () => null, warn: () => {} });
      const ok = await dev.request("/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operator: "0x000000000000000000000000000000000000bEEF", anchorR: "999" }),
      });
      expect(ok.status).toBe(200);
    } finally {
      if (saved !== undefined) process.env.OPERATOR_ALLOWLIST = saved;
      else delete process.env.OPERATOR_ALLOWLIST;
    }
  });
});

// ------------------------------------------------------------------------- Sealed Bounty

const TOKEN = "0x0000000000000000000000000000000000000010" as Address;
const HOLDER = "0x0000000000000000000000000000000000000011" as Address;
const HUNTER = "0x0000000000000000000000000000000000000012" as Address;
const NOW = 1_000_000n;
const pred: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: TOKEN, holder: HOLDER, min: "10000000" }] };
const protocol = generateEnclaveKeys();
const bounty: BountyView = {
  predicateHash: predicateHash(pred),
  protocolX25519: protocol.x25519PublicKey,
  tierMinLoss: [10_000_000n], // F §0.3: loss ≥ 10 USDC → 5 USDC
  deadline: 9_000_000n,
};
const bountyReader: BountyReader = { getBounty: async () => bounty };

/** A deterministic replay; returns the OLD fingerprint (keccak256 of the txs' JSON), which the v2 bis service ignores. */
const fork: ForkRunner = {
  async run({ bundle }) {
    const ctx: EvalContext = {
      erc20Drop: () => 20_000_000n,
      nativeDrop: () => 0n,
      attackerProfit: () => 0n,
      viewValue: () => 0n,
      invariantHeld: () => true,
    };
    const fingerprint = keccak256(toHex(new TextEncoder().encode(JSON.stringify(bundle.txs)))) as Hex;
    return { ctx, fingerprint };
  },
};

function bountyEnclave() {
  const kit = new EnclaveKit({ productId: 2n, chainId: CHAIN, registry: REGISTRY, mockBlockHash: true });
  const blk = { current: async () => 2000n, blockHash: async (n: bigint) => keccak256(numberToHex(n, { size: 32 })) };
  const service = new BountyService(kit, { sealedBounty: SEALED }, bountyReader, new DeterministicProtocolCipher(), fork, blk, () => NOW);
  return { kit, service };
}

async function bundleFor(kit: EnclaveKit, txs: Hex[]) {
  const base: ExploitBundle = {
    bountyId: 1n,
    payee: HUNTER,
    capital: 1_000_000_000n,
    predicate: pred,
    txs,
    r: ("0x" + "22".repeat(32)) as Hex,
    cP: "0x",
  };
  const cP = await new DeterministicProtocolCipher().recompute(base, protocol.x25519PublicKey);
  const plain = { bountyId: "1", payee: HUNTER, capital: base.capital.toString(), predicate: pred, txs, r: base.r, cP };
  return seal(toBytes(kit.keys.x25519PublicKey), new TextEncoder().encode(JSON.stringify(plain)));
}

describe("adversarial v2: Sealed Bounty, one exploit, how many payments? (fixed)", () => {
  it("FIXED v2 (high): the SAME exploit in upper-case hexadecimal has the SAME fingerprint; no second claim signed", async () => {
    const { kit, service } = bountyEnclave();
    const first: SubmitResult = await service.submit(await bundleFor(kit, ["0xa9059cbb"]));
    expect(first.status).toBe("proven");
    const second: SubmitResult = await service.submit(await bundleFor(kit, ["0xA9059CBB"])); // the same bytes
    expect(second.status, "same fingerprint: the enclave does not sign a second claim (and SealedBounty would not pay)").toBe("not_proven");

    // the fingerprint is that of the BYTES, computed by the service (the test replay returns a JSON fingerprint, ignored)
    if (first.status === "proven") {
      expect(first.claim.fingerprint).toBe(exploitFingerprint({ txs: ["0xA9059CBB"] }));
      expect(first.claim.fingerprint).not.toBe(keccak256(toHex(new TextEncoder().encode(JSON.stringify(["0xa9059cbb"])))));
    }
    // the same formula as the real replay (src/services/anvil-fork.ts)
    for (const b of [{ txs: ["0xa9059cbb", "0x"] as Hex[] }, { txs: ["0xDEADbeef"] as Hex[], attackCode: "0x6000" as Hex }]) {
      expect(exploitFingerprint(b)).toBe(anvilExploitFingerprint(b));
    }
    // a DIFFERENT exploit keeps a different fingerprint
    expect(exploitFingerprint({ txs: ["0xa9059cbc"] })).not.toBe(exploitFingerprint({ txs: ["0xa9059cbb"] }));
  });

  it("v2 bis: transactions that are not even-length hexadecimal are refused (an unambiguous fingerprint)", async () => {
    const { kit, service } = bountyEnclave();
    const res = await service.submit(await bundleFor(kit, ["0xabc" as Hex]));
    expect(res.status).toBe("not_proven");
    if (res.status === "not_proven") expect(res.reason).toContain("even-length hexadecimal");
  });
});
