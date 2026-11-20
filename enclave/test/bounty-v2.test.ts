/**
 * Sealed Bounty v2: block N and the deadline are supplied by the hunter, so that k enclaves sign the same claim;
 * anti-equivocation by (bountyId, fingerprint); tiers read on-chain.
 * The service's refusal messages are matched as the enclave code prints them.
 */
import { describe, it, expect } from "vitest";
import {
  type Address,
  type Hex,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  numberToHex,
  pad,
  parseAbi,
  toBytes,
  toHex,
} from "viem";

import { EnclaveKit } from "../src/kit/enclave-kit";
import { claimTypes, domain, recoverClaimSigner, type Claim } from "../src/kit/eip712";
import { seal } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import { RpcQuorum } from "../src/kit/rpc-quorum";
import { predicateHash, type EvalContext, type Predicate } from "../src/services/predicate";
import {
  BountyService,
  DeterministicProtocolCipher,
  type BountyReader,
  type BountyView,
  type ExploitBundle,
  type ForkRunner,
  type SubmitResult,
} from "../src/services/bounty";
import { chainBountyReader, createSealedBountyApp } from "../products/sealed-bounty/app";

const CHAIN = 5042002;
const SEALED = "0x00000000000000000000000000000000000000bb" as Address;
const TOKEN = "0x0000000000000000000000000000000000000010" as Address;
const HOLDER = "0x0000000000000000000000000000000000000011" as Address;
const HUNTER = "0x0000000000000000000000000000000000000012" as Address;
const OTHER_HUNTER = "0x0000000000000000000000000000000000000013" as Address;
const NOW = 1_000_000n;

const pred: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: TOKEN, holder: HOLDER, min: "1000000" }] };
const protocol = generateEnclaveKeys(); // the protocol's X25519 key
const bounty: BountyView = {
  predicateHash: predicateHash(pred),
  protocolX25519: protocol.x25519PublicKey,
  tierMinLoss: [1_000_000n, 10_000_000n],
  deadline: 9_000_000n,
};
const reader: BountyReader = { getBounty: async () => bounty };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function newKit(): EnclaveKit {
  return new EnclaveKit({ productId: 2n, chainId: CHAIN, registry: "0x0000000000000000000000000000000000000001", mockBlockHash: true });
}

/** Deterministic replay (like arc-anvil at a fixed block): fixed loss, fingerprint = hash of the transactions. */
function fork(delayMs = 0): ForkRunner {
  return {
    async run({ bundle }) {
      if (delayMs) await sleep(Math.floor(Math.random() * delayMs));
      const ctx: EvalContext = {
        erc20Drop: () => 5_000_000n,
        nativeDrop: () => 0n,
        attackerProfit: () => 0n,
        viewValue: () => 0n,
        invariantHeld: () => true,
      };
      return { ctx, fingerprint: keccak256(toHex(new TextEncoder().encode(JSON.stringify(bundle.txs)))) };
    },
  };
}

/** An enclave (its kit, its view of the chain head and of the time). */
function enclave(head: bigint, now: bigint, delayMs = 0) {
  const kit = newKit();
  const blocks = { current: async () => head, blockHash: async (n: bigint) => keccak256(numberToHex(n, { size: 32 })) };
  const service = new BountyService(kit, { sealedBounty: SEALED }, reader, new DeterministicProtocolCipher(), fork(delayMs), blocks, () => now);
  return { kit, service };
}

/** The hunter: deterministic cP to the protocol, then an encrypted bundle (cE) to one enclave. */
async function bundleFor(kit: EnclaveKit, o: { txs?: Hex[]; payee?: Address; blockN?: bigint | string; deadline?: bigint | string } = {}) {
  const base: ExploitBundle = {
    bountyId: 1n,
    payee: o.payee ?? HUNTER,
    capital: 1_000_000_000n,
    predicate: pred,
    txs: o.txs ?? ["0xdeadbeef"],
    r: ("0x" + "22".repeat(32)) as Hex,
    cP: "0x",
  };
  const cP = await new DeterministicProtocolCipher().recompute(base, protocol.x25519PublicKey);
  const plain = {
    bountyId: "1", payee: base.payee, capital: base.capital.toString(), predicate: pred, txs: base.txs, r: base.r, cP,
    ...(o.blockN !== undefined ? { blockN: o.blockN.toString() } : {}),
    ...(o.deadline !== undefined ? { deadline: o.deadline.toString() } : {}),
  };
  return seal(toBytes(kit.keys.x25519PublicKey), new TextEncoder().encode(JSON.stringify(plain)));
}

function proven(r: SubmitResult) {
  expect(r.status).toBe("proven");
  return r as Extract<SubmitResult, { status: "proven" }>;
}
function refused(r: SubmitResult) {
  expect(r.status).toBe("not_proven");
  return (r as Extract<SubmitResult, { status: "not_proven" }>).reason;
}
const digest = (c: Claim) => hashTypedData({ domain: domain({ chainId: CHAIN, verifyingContract: SEALED }), types: claimTypes, primaryType: "Claim", message: c });
const bytes = (c: Claim) =>
  encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }],
    [c.bountyId, c.payee, c.blockN, c.blockHashN, c.predicateHash, c.loss, c.tier, c.fingerprint, c.cPHash, c.deadline],
  );

describe("bounties with k enclaves: (N, deadline) supplied by the hunter", () => {
  it("two enclaves, same bundle, same (N, deadline) => claims identical byte for byte, only the signatures differ", async () => {
    // two enclaves that see neither the same head nor the same time
    const A = enclave(2_000n, NOW);
    const B = enclave(2_003n, NOW + 7n);
    const N = 1_990n;
    const deadline = NOW + 300n;

    const a = proven(await A.service.submit(await bundleFor(A.kit, { blockN: N, deadline })));
    const b = proven(await B.service.submit(await bundleFor(B.kit, { blockN: N, deadline })));

    expect(bytes(a.claim)).toBe(bytes(b.claim)); // same ABI encoding, byte for byte
    expect(digest(a.claim)).toBe(digest(b.claim)); // hence the same EIP-712 digest (what each enclave signs)
    expect(a.claim.blockN).toBe(N);
    expect(a.claim.deadline).toBe(deadline);
    expect(a.cP).toBe(b.cP);
    expect(a.signature).not.toBe(b.signature);

    // both signatures are valid on the one claim: SealedBounty.claim(claim, [sigA, sigB], cP) counts 2 enclaves
    const dom = { chainId: CHAIN, verifyingContract: SEALED };
    expect((await recoverClaimSigner(dom, a.claim, a.signature)).toLowerCase()).toBe(A.kit.keys.signer.toLowerCase());
    expect((await recoverClaimSigner(dom, a.claim, b.signature)).toLowerCase()).toBe(B.kit.keys.signer.toLowerCase());
  });

  it("without (N, deadline): defaults (head − 2, now + 600 s), so two enclaves diverge", async () => {
    const A = enclave(2_000n, NOW);
    const B = enclave(2_003n, NOW + 7n);
    const a = proven(await A.service.submit(await bundleFor(A.kit)));
    const b = proven(await B.service.submit(await bundleFor(B.kit)));
    expect(a.claim.blockN).toBe(1_998n);
    expect(a.claim.deadline).toBe(NOW + 600n);
    expect(b.claim.blockN).toBe(2_001n);
    expect(digest(a.claim)).not.toBe(digest(b.claim)); // the problem that v2 fixes
  });

  it("bounds: N in [head − 256, head − 2], deadline in ]now, now + 10 min]; out of bounds => explicit refusal", async () => {
    const { kit, service } = enclave(2_000n, NOW);
    const tx = (i: number) => [("0x" + i.toString(16).padStart(8, "0")) as Hex]; // distinct fingerprints

    expect(refused(await service.submit(await bundleFor(kit, { txs: tx(1), blockN: 1_999n })))).toContain("[1744, 1998]");
    expect(refused(await service.submit(await bundleFor(kit, { txs: tx(2), blockN: 1_743n })))).toContain("block N 1743 refused");
    expect(refused(await service.submit(await bundleFor(kit, { txs: tx(3), deadline: NOW })))).toContain("deadline");
    expect(refused(await service.submit(await bundleFor(kit, { txs: tx(4), deadline: NOW + 601n })))).toContain("deadline");
    expect(refused(await service.submit(await bundleFor(kit, { txs: tx(5), blockN: "not-a-block" })))).toContain("blockN invalid");

    expect(proven(await service.submit(await bundleFor(kit, { txs: tx(6), blockN: 1_744n }))).claim.blockN).toBe(1_744n);
    expect(proven(await service.submit(await bundleFor(kit, { txs: tx(7), blockN: 1_998n }))).claim.blockN).toBe(1_998n);
    expect(proven(await service.submit(await bundleFor(kit, { txs: tx(8), deadline: NOW + 600n }))).claim.deadline).toBe(NOW + 600n);
    expect(proven(await service.submit(await bundleFor(kit, { txs: tx(9), deadline: NOW + 1n }))).claim.deadline).toBe(NOW + 1n);
  });
});

describe("anti-equivocation: never two different claims for the same (bounty, fingerprint)", () => {
  it("resubmission: same (N, deadline) or no values => the same claim; different (N, deadline) or another payee => refused", async () => {
    const { kit, service } = enclave(2_000n, NOW);
    const first = proven(await service.submit(await bundleFor(kit, { blockN: 1_990n, deadline: NOW + 300n })));

    const other = refused(await service.submit(await bundleFor(kit, { blockN: 1_991n, deadline: NOW + 300n })));
    expect(other).toContain("already signed");
    expect(other).toContain("block N 1990"); // the hunter knows what to align its other enclaves on
    refused(await service.submit(await bundleFor(kit, { blockN: 1_990n, deadline: NOW + 301n })));

    const again = proven(await service.submit(await bundleFor(kit, { blockN: 1_990n, deadline: NOW + 300n })));
    expect(again.claim).toEqual(first.claim);
    expect(again.signature).toBe(first.signature); // idempotent: no new signature

    const retry = proven(await service.submit(await bundleFor(kit))); // retry with no values: the claim already signed
    expect(retry.claim).toEqual(first.claim);
    expect(retry.signature).toBe(first.signature);

    expect(refused(await service.submit(await bundleFor(kit, { payee: OTHER_HUNTER })))).toContain("another claim");
  });

  it("concurrent submissions of the same exploit at different (N, deadline) => only one signed", async () => {
    const { kit, service } = enclave(2_000n, NOW, 15);
    const results = await Promise.all(
      [1_980n, 1_981n, 1_982n, 1_983n, 1_984n].map(async (N) => service.submit(await bundleFor(kit, { blockN: N, deadline: NOW + 300n }))),
    );
    const signed = results.filter((r) => r.status === "proven") as Extract<SubmitResult, { status: "proven" }>[];
    expect(signed).toHaveLength(1);
    expect(results.filter((r) => r.status === "not_proven")).toHaveLength(4);
  });
});

describe("Sealed Bounty v2 server", () => {
  const abi = parseAbi([
    "struct Bounty { address protocol; uint256 productId; bytes32 predicateHash; bytes32 protocolX25519; uint256 singleCap; uint8 k; address targetToPause; uint64 deadline; uint256 balance; bool paused; }",
    "function getBounty(uint256 id) view returns (Bounty)",
    "function tierMinLoss(uint256 bountyId, uint256 index) view returns (uint256)",
  ]);
  /** Fake SealedBounty: bounty #1 with the given tiers; an out-of-range index reverts (Panic 0x32). */
  function fakeChain(tiers: bigint[]) {
    return custom(
      {
        async request({ method, params }: { method: string; params?: any }) {
          if (method === "eth_blockNumber") return numberToHex(2_000n);
          if (method !== "eth_call") throw new Error(`unexpected method ${method}`);
          const { functionName, args } = decodeFunctionData({ abi, data: params[0].data });
          if (functionName === "getBounty") {
            return encodeFunctionResult({
              abi, functionName: "getBounty",
              result: {
                protocol: HOLDER, productId: 2n, predicateHash: bounty.predicateHash, protocolX25519: bounty.protocolX25519,
                singleCap: 50_000_000n, k: 2, targetToPause: HOLDER, deadline: 9_000_000n, balance: 60_000_000n, paused: false,
              },
            });
          }
          const i = Number(args[1]);
          if (i >= tiers.length) {
            throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x4e487b71" + pad("0x32", { size: 32 }).slice(2) });
          }
          return encodeFunctionResult({ abi, functionName: "tierMinLoss", result: tiers[i]! });
        },
      },
      { retryCount: 0 },
    );
  }

  it("tiers read on-chain (up to the end-of-array revert), never the request's", async () => {
    const r = chainBountyReader(new RpcQuorum([fakeChain([1_000_000n, 10_000_000n]), fakeChain([1_000_000n, 10_000_000n])]), SEALED);
    const v = await r.getBounty(1n);
    expect(v.tierMinLoss).toEqual([1_000_000n, 10_000_000n]);
    expect(v.predicateHash).toBe(bounty.predicateHash);
    expect(v.deadline).toBe(9_000_000n);

    const sixteen = Array.from({ length: 16 }, (_, i) => BigInt(i + 1));
    expect((await chainBountyReader(new RpcQuorum([fakeChain(sixteen)]), SEALED).getBounty(1n)).tierMinLoss).toEqual(sixteen);
    await expect(chainBountyReader(new RpcQuorum([fakeChain([...sixteen, 17n])]), SEALED).getBounty(1n)).rejects.toThrow(/more than 16 tiers/);
  });

  it("POST /bounty/submit: one service for the enclave's whole life; the tiers sent by the hunter are ignored", async () => {
    const kit = newKit();
    const blocks = { current: async () => 2_000n, blockHash: async (n: bigint) => keccak256(numberToHex(n, { size: 32 })) };
    const service = new BountyService(
      kit, { sealedBounty: SEALED }, chainBountyReader(new RpcQuorum([fakeChain([1_000_000n, 10_000_000n])]), SEALED),
      new DeterministicProtocolCipher(), fork(), blocks, () => NOW,
    );
    const app = createSealedBountyApp({ kit, service, attest: { operatorAllowlist: null, registeredOperator: async () => null, warn: () => {} } });
    const post = async (o: Parameters<typeof bundleFor>[1]) => {
      const cE = await bundleFor(kit, o);
      const res = await app.request("/bounty/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // the hunter claims a tier at 0: ignored, the 5 USDC loss stays at the real tier 0 (≥ 1 USDC, < 10 USDC)
        body: JSON.stringify({ enc: toHex(cE.enc), ciphertext: toHex(cE.ciphertext), tierMinLoss: ["0", "0", "0"] }),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as any;
    };
    const one = await post({ blockN: 1_990n, deadline: NOW + 300n });
    expect(one.status).toBe("proven");
    expect(one.claim).toMatchObject({ blockN: "1990", deadline: String(NOW + 300n), tier: 0, loss: "5000000" });
    const two = await post({ blockN: 1_995n, deadline: NOW + 300n }); // same service: the memory holds between requests
    expect(two.status).toBe("not_proven");
    expect(two.reason).toContain("already signed");
  });
});
