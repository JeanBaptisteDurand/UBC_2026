/**
 * Sealed Bounty v2.1 ter: denial of service and unsorted exceptions (adversarial verification of 9 Nov: cases D1–D4,
 * amplification, environment exceptions).
 *  2. /v1/refute: the bucket's token is taken AFTER the body's shape and claimRecords (a live claim); invalid bodies have
 *     their own limit per seen IP, which never starves valid requests (proof D1);
 *  3. /bounty/submit: a limited rate; the same ciphertext repeated → the same result without reading the chain again
 *     (proof D2); bounty and tiers cached per bounty; a replay failure (budget…) is a 503, never "not proven";
 *  4. a full queue ("busy") or refutations in progress ("refute_busy"): never cached as a failure (proofs D3, D4);
 *  5. only identified DETERMINISTIC errors become a fault or a refusal; any other exception → 503, nothing signed,
 *     nothing cached (proof e8).
 */
import { describe, it, expect, afterEach } from "vitest";
import { createServer as createHttpServer } from "node:http";
import { randomBytes } from "node:crypto";
import {
  type Address, type Hex, concat, custom, decodeFunctionData, encodeFunctionResult, getAddress, keccak256, numberToHex, parseAbi,
  toBytes, toHex, zeroAddress, zeroHash,
} from "viem";
import { x25519 } from "@noble/curves/ed25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { HpkeError } from "@hpke/core";
import { EnclaveKit } from "../src/kit/enclave-kit";
import { type Claim } from "../src/kit/eip712";
import { seal } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import { deterministicSeal } from "../src/kit/deterministic-seal";
import { RpcQuorum } from "../src/kit/rpc-quorum";
import { predicateHash, type EvalContext, type Predicate } from "../src/services/predicate";
import { AnvilForkRunner, encodeExploitTx } from "../src/services/anvil-fork";
import {
  BountyService, DeterministicProtocolCipher, FAULT, RefutationService, ReplayUnavailableError, canonicalProtocolPlaintext, claimDigestOf,
  claimOperatorsHash, exploitFingerprint, isInvalidTagError, isInvalidUtf8Error, isSmallOrderX25519, jsonBigInt, refuteRequestAad,
  type BountyView, type ExploitBundle, type ForkRunner, type RefuteChainView, type RefuteReader, type RefuteResult,
} from "../src/services/bounty";
import {
  BountyCache, RATE_LIMITED, UNAVAILABLE, chainBountyReader, chainRefuteReader, createSealedBountyApp,
} from "../products/sealed-bounty/app";

const CHAIN = 5042002;
const SEALED = "0x00000000000000000000000000000000000000bb" as Address;
const REGISTRY = "0x0000000000000000000000000000000000000001" as Address;
const PRODUCT = 2n;
const TOKEN = "0x0000000000000000000000000000000000000010" as Address;
const HOLDER = "0x0000000000000000000000000000000000000011" as Address;
const HUNTER = "0x000000000000000000000000000000000000c0de" as Address;
const OP_A = getAddress("0x000000000000000000000000000000000000a001");
const OP_B = getAddress("0x000000000000000000000000000000000000b002");
const R = ("0x" + "44".repeat(32)) as Hex;
const WINDOW = 259_200n;
const utf8 = (s: string) => new TextEncoder().encode(s);
const protocol = generateEnclaveKeys();
const newKit = () => new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: REGISTRY, mockBlockHash: true });
const attest = { operatorAllowlist: null, registeredOperator: async () => null, warn: () => {} };
const pred: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: TOKEN, holder: HOLDER, min: "1000000" }] };
const view: BountyView = { predicateHash: predicateHash(pred), protocolX25519: protocol.x25519PublicKey, tierMinLoss: [1_000_000n], deadline: 9_000_000n };
const okCtx = (loss = 5_000_000n): EvalContext => ({ erc20Drop: () => loss, nativeDrop: () => 0n, attackerProfit: () => 0n, viewValue: () => 0n, invariantHeld: () => true });
const json = (o: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

/** The chain as a refuting enclave sees it, with the cheap read (record); counts its reads. */
class FakeChain implements RefuteReader {
  records = new Map<string, { acceptedAt: bigint; refuted: boolean; opsHash: Hex }>();
  active = new Map<string, Address>();
  reads = { record: 0, full: 0 };
  now = BigInt(Math.floor(Date.now() / 1000));
  constructor(public v: BountyView = view) {}
  accept(claim: Claim, ops: Address[]): Hex {
    const d = claimDigestOf(SEALED, claim, CHAIN);
    this.records.set(d.toLowerCase(), { acceptedAt: this.now - 600n, refuted: false, opsHash: claimOperatorsHash(ops) });
    return d;
  }
  private rec(d: Hex) {
    return this.records.get(d.toLowerCase()) ?? { acceptedAt: 0n, refuted: false, opsHash: zeroHash };
  }
  async record(q: { claimDigest: Hex }) {
    this.reads.record++;
    return { block: 5_000n, record: this.rec(q.claimDigest) };
  }
  async read(q: { claimDigest: Hex; signer: Address }): Promise<RefuteChainView> {
    this.reads.full++;
    return {
      block: 5_000n, blockTimestamp: this.now, record: this.rec(q.claimDigest), refuteWindow: WINDOW,
      bounty: { ...this.v, productId: PRODUCT }, myOperator: this.active.get(q.signer.toLowerCase()) ?? zeroAddress,
    };
  }
}

/** An HONEST claim (the bundle's real cP): the counter-replay of okCtx() confirms it. */
async function honestClaim(capital = 0n) {
  const txs = [encodeExploitTx({ to: HOLDER, data: "0x" })];
  const b: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital, predicate: pred, txs, r: R, cP: "0x" };
  const cP = await new DeterministicProtocolCipher().recompute(b, protocol.x25519PublicKey);
  const claim: Claim = {
    bountyId: 1n, payee: getAddress(HUNTER), blockN: 10n, blockHashN: zeroHash, predicateHash: view.predicateHash, loss: 5_000_000n, tier: 0,
    fingerprint: exploitFingerprint(b), cPHash: keccak256(cP), deadline: 99n,
  };
  return { claim, cP, txs, hunter: { from: "hunter", bountyId: "1", payee: HUNTER, capital: capital.toString(), predicate: pred, txs, r: R } };
}

/** A claim whose cP is arbitrary bytes (forged by faulty enclaves). */
function forgedClaimFor(cP: Hex): Claim {
  return {
    bountyId: 1n, payee: getAddress(HUNTER), blockN: 10n, blockHashN: zeroHash, predicateHash: view.predicateHash, loss: 5_000_000n, tier: 0,
    fingerprint: keccak256(toBytes("fingerprint")), cPHash: keccak256(cP), deadline: 99n,
  };
}

function refuterOf(chain: FakeChain, fork: ForkRunner, cfg: Partial<ConstructorParameters<typeof RefutationService>[1]> = {}) {
  const kit = newKit();
  chain.active.set(kit.keys.signer.toLowerCase(), OP_B);
  return { kit, service: new RefutationService(kit, { sealedBounty: SEALED, ...cfg }, chain, new DeterministicProtocolCipher(), fork) };
}

async function refuteRequest(kit: EnclaveKit, claim: Claim, plaintext: object | string, operators: Address[] = [OP_A]) {
  const text = typeof plaintext === "string" ? plaintext : JSON.stringify(plaintext);
  const s = await seal(toBytes(kit.keys.x25519PublicKey), utf8(text), refuteRequestAad(claimDigestOf(SEALED, claim, CHAIN)));
  return { claim, operators, enc: s.enc, ciphertext: s.ciphertext };
}
const httpBody = (q: { claim: Claim; operators: Address[]; enc: Uint8Array; ciphertext: Uint8Array }) => ({
  claim: { ...q.claim, bountyId: q.claim.bountyId.toString(), blockN: q.claim.blockN.toString(), loss: q.claim.loss.toString(), deadline: q.claim.deadline.toString() },
  operators: q.operators, enc: toHex(q.enc), ciphertext: toHex(q.ciphertext),
});

const abi = parseAbi([
  "struct Bounty { address protocol; uint256 productId; bytes32 predicateHash; bytes32 protocolX25519; uint256 singleCap; uint8 k; address targetToPause; uint64 deadline; uint256 balance; bool paused; }",
  "function getBounty(uint256 id) view returns (Bounty)",
  "function tierMinLoss(uint256 bountyId, uint256 index) view returns (uint256)",
  "function claimRecords(bytes32) view returns (uint64 acceptedAt, bool refuted, bytes32 opsHash)",
  "function REFUTE_WINDOW() view returns (uint64)",
  "function activeOperatorAt(address signer, uint256 productId, uint256 blockNumber) view returns (address)",
]);
/** An emulated RPC provider: bounty #1 (16 tiers, exists), bounty #2 (never created: protocol = 0); counts per method. */
function provider(counter: Record<string, number>, state: { acceptedAt: bigint } = { acceptedAt: 0n }) {
  const count = (k: string) => { counter[k] = (counter[k] ?? 0) + 1; counter.total = (counter.total ?? 0) + 1; };
  return custom({
    async request({ method, params }: { method: string; params?: any }) {
      if (method === "eth_blockNumber") { count("head"); return numberToHex(7_000n); }
      if (method === "eth_getBlockByNumber") { count("block"); return { number: params[0], hash: zeroHash, timestamp: numberToHex(state.acceptedAt + 10n), parentHash: zeroHash, transactions: [], logsBloom: null, nonce: null }; }
      const { functionName, args } = decodeFunctionData({ abi, data: params[0].data });
      count(functionName);
      switch (functionName) {
        case "claimRecords": return encodeFunctionResult({ abi, functionName, result: [state.acceptedAt, false, zeroHash] });
        case "REFUTE_WINDOW": return encodeFunctionResult({ abi, functionName, result: WINDOW });
        case "getBounty": {
          const exists = args![0] === 1n;
          return encodeFunctionResult({ abi, functionName, result: { protocol: exists ? HOLDER : zeroAddress, productId: exists ? PRODUCT : 0n, predicateHash: exists ? keccak256("0x01") : zeroHash, protocolX25519: exists ? protocol.x25519PublicKey : zeroHash, singleCap: 1n, k: 1, targetToPause: zeroAddress, deadline: 9n, balance: 1n, paused: false } });
        }
        case "tierMinLoss":
          if (args![0] !== 1n || Number(args![1]) >= 16) throw Object.assign(new Error("execution reverted"), { code: 3 });
          return encodeFunctionResult({ abi, functionName, result: BigInt(Number(args![1]) + 1) });
        case "activeOperatorAt": return encodeFunctionResult({ abi, functionName, result: zeroAddress });
      }
      throw new Error(String(functionName));
    },
  }, { retryCount: 0 });
}

// =====================================================================================================================
// 2. /v1/refute: the token after the body's shape and claimRecords; invalid bodies limited separately (proof D1)
// =====================================================================================================================

describe("2 — /v1/refute: an invalid body or an invented claim no longer empties the bucket (proof D1)", () => {
  const invented = {
    claim: { bountyId: "1", payee: HUNTER, blockN: "1", blockHashN: zeroHash, predicateHash: zeroHash, loss: "1", tier: 0, fingerprint: zeroHash, cPHash: zeroHash, deadline: "1" },
    operators: [OP_A], enc: "0x" + "11".repeat(32), ciphertext: "0x" + "22".repeat(16),
  };

  it("proof D1 replayed (DEFAULT rate): a burst of empty bodies → 400 then 429 for THEM alone, 0 reads; the valid request is ALWAYS served, for 10 minutes", async () => {
    const counter: Record<string, number> = {};
    const kit = newKit();
    const refuter = new RefutationService(kit, { sealedBounty: SEALED }, chainRefuteReader(new RpcQuorum([provider(counter)]), SEALED, REGISTRY), new DeterministicProtocolCipher(), { run: async () => { throw new Error("never"); } });
    let clock = 1_000_000;
    const app = createSealedBountyApp({ kit, service: undefined as any, refuter, attest, nowMs: () => clock });
    const post = (b: string) => app.request("/v1/refute", { method: "POST", headers: { "content-type": "application/json" }, body: b });
    const junk: number[] = [];
    for (let i = 0; i < 40; i++) junk.push((await post(i % 2 ? "{}" : "not json")).status);
    expect(junk.slice(0, 30)).toEqual(Array(30).fill(400));
    expect(junk.slice(30)).toEqual(Array(10).fill(429)); // the limit per seen IP, specific to invalid bodies
    expect(counter.total ?? 0).toBe(0);
    const legit = await post(JSON.stringify(invented));
    expect(legit.status).toBe(200);
    expect(await legit.json()).toMatchObject({ status: "refused", code: "unknown_claim" });
    let served = 0, tries = 0;
    for (let t = 0; t < 600_000; t += 50) {
      clock += 50;
      await post("{}");
      if (t % 1000 === 0) { tries++; if ((await post(JSON.stringify(invented))).status === 200) served++; }
    }
    expect(served).toBe(tries); // 600 out of 600 (before: 0 out of 600)
  }, 120_000);

  it("the token is taken only for a LIVE claim, after claimRecords; a claim with a cached result takes none", async () => {
    const chain = new FakeChain();
    const one = await honestClaim(0n);
    const two = await honestClaim(1n);
    chain.accept(one.claim, [OP_A]);
    chain.accept(two.claim, [OP_A]);
    let runs = 0;
    const B = refuterOf(chain, { run: async () => { runs++; return { ctx: okCtx() }; } });
    const app = createSealedBountyApp({ kit: B.kit, service: undefined as any, refuter: B.service, attest, refuteRateLimit: { burst: 1, perMinute: 0.001 } });
    const ask = async (c: Awaited<ReturnType<typeof honestClaim>>) => app.request("/v1/refute", json(httpBody(await refuteRequest(B.kit, c.claim, c.hunter))));
    const first = await ask(one);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "confirmed" }); // the only token
    // the same claim: a cached result, no token, no further replay
    for (let i = 0; i < 5; i++) expect((await ask(one)).status).toBe(200);
    expect(runs).toBe(1);
    // ANOTHER live claim, without a result: no more tokens → 429 (cheap read only), Retry-After
    const fullBefore = chain.reads.full;
    const limited = await ask(two);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: RATE_LIMITED.refute });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(chain.reads.full).toBe(fullBefore);
    // an INVENTED claim: refused after the cheap read, never 429
    expect(await (await app.request("/v1/refute", json(invented))).json()).toMatchObject({ code: "unknown_claim" });
  });
});

// =====================================================================================================================
// 3. /bounty/submit: rate, deduplication by the ciphertext's hash, bounty cache, budget = 503 (proofs D2, E7)
// =====================================================================================================================

describe("3 — /bounty/submit: a limited rate, the same ciphertext = the same result without a new read, bounties cached", () => {
  async function sealed(kit: EnclaveKit, o: { capital?: bigint; predicate?: Predicate; plain?: string } = {}) {
    const p = o.predicate ?? pred;
    const txs = [encodeExploitTx({ to: HOLDER, data: "0x" })];
    const b: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital: o.capital ?? 0n, predicate: p, txs, r: R, cP: "0x" };
    const cP = await new DeterministicProtocolCipher().recompute(b, protocol.x25519PublicKey);
    const text = o.plain ?? JSON.stringify({ bountyId: "1", payee: HUNTER, capital: String(o.capital ?? 0n), predicate: p, txs, r: R, cP, blockN: "6990" });
    const s = await seal(toBytes(kit.keys.x25519PublicKey), utf8(text));
    return { enc: toHex(s.enc), ciphertext: toHex(s.ciphertext), raw: s };
  }
  function service(fork: ForkRunner, o: { reads?: { n: number }; nowMs?: () => number } = {}) {
    const kit = newKit();
    const reader = { getBounty: async () => { if (o.reads) o.reads.n++; return view; } };
    const svc = new BountyService(kit, { sealedBounty: SEALED, nowMs: o.nowMs }, reader, new DeterministicProtocolCipher(), fork, { current: async () => 7_000n, blockHash: async () => zeroHash }, () => 1_000n);
    return { kit, svc };
  }

  it("proof D2 replayed: the SAME ciphertext sent 50 times → ONE read of the bounty (19 JSON-RPC calls in all, not 950), 50 identical answers", async () => {
    const counter: Record<string, number> = {};
    const kit = newKit();
    const svc = new BountyService(kit, { sealedBounty: SEALED }, chainBountyReader(new RpcQuorum([provider(counter)]), SEALED), new DeterministicProtocolCipher(),
      { run: async () => { throw new Error("never reached"); }, validate: () => {} }, { current: async () => 7_000n, blockHash: async () => zeroHash }, () => 1_000n);
    const app = createSealedBountyApp({ kit, service: svc, attest });
    const body = await sealed(kit);
    const texts = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const res = await app.request("/bounty/submit", json({ enc: body.enc, ciphertext: body.ciphertext }));
      expect(res.status).toBe(200);
      texts.add(await res.text());
    }
    expect(texts.size).toBe(1);
    expect(counter.total).toBe(19); // head + getBounty + 17 tiers, only once
    // ANOTHER ciphertext for the same bounty: the bounty is cached (immutable): NO further read
    const other = await sealed(kit, { capital: 5n });
    expect((await app.request("/bounty/submit", json({ enc: other.enc, ciphertext: other.ciphertext }))).status).toBe(200);
    expect(counter.total).toBe(19);
  });

  it("rate: the token is taken AFTER the local checks (an unreadable bundle takes none), BEFORE any read; beyond → 429 without a read", async () => {
    const reads = { n: 0 };
    const { kit, svc } = service({ run: async () => ({ ctx: okCtx() }) }, { reads });
    const app = createSealedBountyApp({ kit, service: svc, attest, submitRateLimit: { burst: 2, perMinute: 0.001 } });
    const post = async (b: { enc: string; ciphertext: string }) => app.request("/bounty/submit", json({ enc: b.enc, ciphertext: b.ciphertext }));
    for (let i = 0; i < 5; i++) {
      const res = await post(await sealed(kit, { plain: `{"not":"a bundle ${i}"` }));
      expect(await res.json()).toMatchObject({ status: "not_proven", reason: "unreadable bundle: JSON expected" });
    }
    expect((await post(await sealed(kit, { capital: 1n }))).status).toBe(200);
    expect((await post(await sealed(kit, { capital: 2n }))).status).toBe(200);
    expect(reads.n).toBe(2);
    const limited = await post(await sealed(kit, { capital: 3n }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: RATE_LIMITED.submit });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(reads.n).toBe(2); // nothing was read
  });

  it("deduplication: SIMULTANEOUS identical submissions → one processing; after the delay, read again; an undecryptable ciphertext is never cached", async () => {
    let clock = 0;
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const reads = { n: 0 };
    const { kit, svc } = service({ run: async () => { runs++; await gate; return { ctx: okCtx() }; } }, { reads, nowMs: () => clock });
    const b = await sealed(kit);
    const pending = Array.from({ length: 10 }, () => svc.submit(b.raw));
    await new Promise((r) => setTimeout(r, 20));
    release();
    const out = await Promise.all(pending);
    expect(new Set(out.map((x) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v)))).size).toBe(1);
    expect(out[0]!.status).toBe("proven");
    expect(runs).toBe(1);
    expect(reads.n).toBe(1);
    clock += 61_000;
    await svc.submit(b.raw);
    expect(reads.n).toBe(2); // delay elapsed: read again (and the SAME claim, through the anti-equivocation)
    // a ciphertext that does not open: nothing is kept (it costs only one HPKE attempt)
    const realOpen = kit.open.bind(kit);
    let opens = 0;
    (kit as any).open = async (...a: Parameters<EnclaveKit["open"]>) => { opens++; return realOpen(...a); };
    const bad = await seal(toBytes(generateEnclaveKeys().x25519PublicKey), utf8("{}"));
    for (let i = 0; i < 2; i++) expect(await svc.submit(bad)).toMatchObject({ status: "not_proven", reason: expect.stringMatching(/^cE cannot be decrypted/) });
    expect(opens).toBe(2);
  });

  it("a replay failure (budget, RPC) is a 503, never \"not proven\", kept 15 s; a full queue or an environment exception: nothing is kept", async () => {
    let clock = 0;
    let mode: "budget" | "busy" | "env" | "ok" = "budget";
    let runs = 0;
    const fork: ForkRunner = {
      run: async () => {
        runs++;
        if (mode === "budget") throw new ReplayUnavailableError("budget", "replay: the read budget of the fork's RPC is exceeded: nothing is signed");
        if (mode === "busy") throw new ReplayUnavailableError("busy", "replay queue full");
        if (mode === "env") throw new RangeError("Array buffer allocation failed");
        return { ctx: okCtx() };
      },
    };
    const { kit, svc } = service(fork, { nowMs: () => clock });
    const app = createSealedBountyApp({ kit, service: svc, attest, submitRateLimit: false });
    const b = await sealed(kit);
    const post = () => app.request("/bounty/submit", json({ enc: b.enc, ciphertext: b.ciphertext }));
    const r1 = await post();
    expect(r1.status).toBe(503);
    expect(await r1.json()).toEqual({ error: UNAVAILABLE.submit });
    expect((await post()).status).toBe(503);
    expect(runs).toBe(1); // kept: no repeated replay
    clock += 15_001;
    mode = "busy";
    expect((await post()).status).toBe(503);
    expect(runs).toBe(2);
    mode = "env";
    expect((await post()).status).toBe(503); // full queue: nothing was kept, the replay runs again at once
    expect(runs).toBe(3);
    mode = "ok";
    const ok = await post(); // environment exception: nothing was kept
    expect(runs).toBe(4);
    expect(await ok.json()).toMatchObject({ status: "proven" });
  });

  it("bounty cache: a bounty that EXISTS is read once (shared with the refutation); an id never created is never frozen", async () => {
    const counter: Record<string, number> = {};
    const q = new RpcQuorum([provider(counter, { acceptedAt: BigInt(Math.floor(Date.now() / 1000)) })]);
    const cache = new BountyCache();
    const reader = chainBountyReader(q, SEALED, cache);
    const a = await reader.getBounty(1n);
    const b = await reader.getBounty(1n);
    expect(b).toEqual(a);
    expect(counter.getBounty).toBe(1);
    expect(counter.tierMinLoss).toBe(17);
    await reader.getBounty(2n);
    await reader.getBounty(2n);
    expect(counter.getBounty).toBe(3); // bounty #2 does not exist: read again each time
    expect(cache.size).toBe(1);
    // the refutation reuses the cached bounty: neither getBounty nor tiers; REFUTE_WINDOW read once
    const refuteReader = chainRefuteReader(q, SEALED, REGISTRY, cache);
    for (let i = 0; i < 3; i++) {
      const v = await refuteReader.read({ claimDigest: zeroHash, bountyId: 1n, signer: HOLDER });
      expect(v.bounty).toEqual(a);
      expect(v.refuteWindow).toBe(WINDOW);
    }
    expect(counter.getBounty).toBe(3);
    expect(counter.tierMinLoss).toBe(17 + 2); // the two reads of bounty #2 (end of the array from index 0)
    expect(counter.REFUTE_WINDOW).toBe(1);
  });
});

// =====================================================================================================================
// 4. a full queue: never cached as a replay failure (proofs D3, D4)
// =====================================================================================================================

describe("4 — \"busy\" and \"refute_busy\" do not block the claim for 60 s", () => {
  it("proof D3 replayed: queue full at the first request; 1 s later, free queue → counter-replay done (\"confirmed\"), not \"recent failure\"", async () => {
    const { claim, hunter } = await honestClaim();
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    let busy = true, runs = 0, clock = 0;
    const B = refuterOf(chain, { run: async () => { runs++; if (busy) throw new ReplayUnavailableError("busy", "replay queue full"); return { ctx: okCtx() }; } }, { nowMs: () => clock });
    await expect(B.service.refute(await refuteRequest(B.kit, claim, hunter))).rejects.toMatchObject({ reason: "busy" });
    busy = false;
    clock += 1_000;
    expect((await B.service.refute(await refuteRequest(B.kit, claim, hunter))).status).toBe("confirmed");
    expect(runs).toBe(2);
  });

  it("proof D4 (the engine's REAL queue full): 503 \"busy\", then as soon as the queue frees up, the claim is replayed (never \"recent failure\")", async () => {
    // a fork RPC that does not answer: the replay at the head of the queue waits (anchor check)
    const hang = createHttpServer(() => { /* never an answer */ });
    await new Promise<void>((r) => hang.listen(0, "127.0.0.1", () => r()));
    const port = (hang.address() as { port: number }).port;
    const runner = new AnvilForkRunner({ forkUrl: `http://127.0.0.1:${port}`, anvilBin: "/nonexistent/anvil", engine: "anvil", log: () => {}, maxQueued: 1 });
    const blocker = runner.run({ blockN: 5n, bundle: { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: pred, txs: [encodeExploitTx({ to: TOKEN, data: "0x" })], r: R, cP: "0x" }, expectedBlockHash: zeroHash });
    blocker.catch(() => {});
    const { claim, hunter } = await honestClaim();
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    // the refuter shares the engine's queue; then, an engine that confirms
    let useRunner = true;
    const B = refuterOf(chain, { run: async (i) => (useRunner ? runner.run(i) : { ctx: okCtx() }), validate: (b) => runner.validate(b) });
    const app = createSealedBountyApp({ kit: B.kit, service: undefined as any, refuter: B.service, attest });
    const res = await app.request("/v1/refute", json(httpBody(await refuteRequest(B.kit, claim, hunter))));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: UNAVAILABLE.busy });
    hang.closeAllConnections();
    hang.close();
    await expect(blocker).rejects.toBeInstanceOf(ReplayUnavailableError);
    useRunner = false;
    const again = await app.request("/v1/refute", json(httpBody(await refuteRequest(B.kit, claim, hunter))));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: "confirmed" });
  });

  it("refute_busy (refutations in progress): immediate refusal, nothing cached; the claim is served as soon as a slot frees up", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const chain = new FakeChain();
    const a = await honestClaim(0n);
    const b = await honestClaim(1n);
    chain.accept(a.claim, [OP_A]);
    chain.accept(b.claim, [OP_A]);
    const B = refuterOf(chain, { run: async () => { await gate; return { ctx: okCtx() }; } }, { maxInFlight: 1 });
    const first = B.service.refute(await refuteRequest(B.kit, a.claim, a.hunter));
    await expect(B.service.refute(await refuteRequest(B.kit, b.claim, b.hunter))).rejects.toMatchObject({ reason: "refute_busy" });
    release();
    expect((await first).status).toBe("confirmed");
    expect((await B.service.refute(await refuteRequest(B.kit, b.claim, b.hunter))).status).toBe("confirmed");
  });
});

// =====================================================================================================================
// 5. exceptions: only identified DETERMINISTIC errors become a fault; the rest → 503 (proof e8)
// =====================================================================================================================

describe("5 — sorted catches: environment → 503, nothing signed, nothing cached; deterministic rules → fault", () => {
  const realDecode = TextDecoder.prototype.decode;
  const realParse = JSON.parse;
  afterEach(() => {
    TextDecoder.prototype.decode = realDecode;
    JSON.parse = realParse;
  });
  const key = { from: "protocol", protocolPrivateKey: toHex(protocol.x25519PrivateKey) };

  it("proof e8 replayed: an environment RangeError while decoding cP's plaintext → 503, NO refutation signed, nothing cached (then: \"confirmed\")", async () => {
    const { claim, cP } = await honestClaim();
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    const B = refuterOf(chain, { run: async () => ({ ctx: okCtx() }) });
    const app = createSealedBountyApp({ kit: B.kit, service: undefined as any, refuter: B.service, attest });
    const body = httpBody(await refuteRequest(B.kit, claim, { ...key, cP }));
    let fatal = 0;
    TextDecoder.prototype.decode = function (this: TextDecoder, input?: any, opts?: any) {
      if (this.fatal && ++fatal === 2) throw new RangeError("Array buffer allocation failed"); // 1st: the request; 2nd: cP's plaintext
      return realDecode.call(this, input, opts);
    };
    const res = await app.request("/v1/refute", json(body));
    TextDecoder.prototype.decode = realDecode;
    expect(fatal).toBe(2);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toMatch(/signature|Array buffer/);
    const again = await app.request("/v1/refute", json(httpBody(await refuteRequest(B.kit, claim, { ...key, cP }))));
    expect(await again.json()).toMatchObject({ status: "confirmed" });
  });

  it("JSON.parse, HPKE: an environment exception → 503 (refutation and submission), never \"not canonical\", \"unreadable\" or \"undecryptable\"", async () => {
    const { claim, cP, hunter } = await honestClaim();
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    const B = refuterOf(chain, { run: async () => ({ ctx: okCtx() }) });
    const env = () => { throw new RangeError("Maximum call stack size exceeded"); };
    const parseFailing = (prefix: string) => {
      JSON.parse = function (text: string, reviver?: any) {
        if (typeof text === "string" && text.startsWith(prefix)) env();
        return realParse.call(JSON, text, reviver);
      } as typeof JSON.parse;
    };
    parseFailing('{"bountyId"'); // cP's plaintext (canonicalContent)
    await expect(B.service.refute(await refuteRequest(B.kit, claim, { ...key, cP }))).rejects.toBeInstanceOf(RangeError);
    JSON.parse = realParse;
    parseFailing('{"from"'); // the request itself (establish)
    await expect(B.service.refute(await refuteRequest(B.kit, claim, hunter))).rejects.toBeInstanceOf(RangeError);
    JSON.parse = realParse;
    // HPKE: an error of the library (deterministic) stays a refusal; another exception → 503
    const open = B.kit.open.bind(B.kit);
    (B.kit as any).open = async () => { throw new RangeError("Array buffer allocation failed"); };
    await expect(B.service.refute(await refuteRequest(B.kit, claim, hunter))).rejects.toBeInstanceOf(RangeError);
    (B.kit as any).open = open;
    expect(await B.service.refute({ claim, operators: [OP_A], enc: new Uint8Array(32), ciphertext: new Uint8Array(16) })).toMatchObject({ code: "undecryptable" });
    // nothing was cached: the healthy request succeeds
    expect((await B.service.refute(await refuteRequest(B.kit, claim, { ...key, cP }))).status).toBe("confirmed");

    // submission: JSON.parse of the bundle and HPKE
    const kit = newKit();
    let runs = 0;
    const svc = new BountyService(kit, { sealedBounty: SEALED }, { getBounty: async () => view }, new DeterministicProtocolCipher(), { run: async () => { runs++; return { ctx: okCtx() }; } }, { current: async () => 7_000n, blockHash: async () => zeroHash }, () => 1_000n);
    const app = createSealedBountyApp({ kit, service: svc, attest });
    const b: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: pred, txs: [encodeExploitTx({ to: HOLDER, data: "0x" })], r: R, cP: "0x" };
    const cPs = await new DeterministicProtocolCipher().recompute(b, protocol.x25519PublicKey);
    const s = await seal(toBytes(kit.keys.x25519PublicKey), utf8(JSON.stringify({ bountyId: "1", payee: HUNTER, capital: "0", predicate: pred, txs: b.txs, r: R, cP: cPs, blockN: "6990" })));
    const post = () => app.request("/bounty/submit", json({ enc: toHex(s.enc), ciphertext: toHex(s.ciphertext) }));
    parseFailing('{"bountyId"');
    expect((await post()).status).toBe(503);
    JSON.parse = realParse;
    const kopen = kit.open.bind(kit);
    (kit as any).open = async () => { throw new TypeError("environnement"); };
    expect((await post()).status).toBe(503);
    (kit as any).open = kopen;
    const ok = await post(); // nothing cached: the same ciphertext is processed
    expect(await ok.json()).toMatchObject({ status: "proven" });
    expect(runs).toBe(1);
  });

  it("DETERMINISTIC faults kept (the bounty's key): low-order ephemeral key, cP too short, false tag, invalid UTF-8, unreadable JSON, non-integer integer", async () => {
    const P = (1n << 255n) - 19n;
    const le = (n: bigint) => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) { b[i] = Number(n & 255n); n >>= 8n; } return b; };
    const small = [0n, 1n, P - 1n, 325606250916557431795983626356110631294008115727848805560023387167927233504n,
      39382357235489614581723060781553021112529911719440698176882885853963445705823n, P, P + 1n, 1n << 255n];
    const sealOf = (plain: Uint8Array) => deterministicSeal(toBytes(protocol.x25519PublicKey), plain, toBytes(R));
    const cases: Array<[string, Hex, string]> = [
      ...small.map((u, i) => [`low-order point no. ${i}`, toHex(concat([le(u), new Uint8Array(64).fill(7)])), FAULT.ephemeralKey] as [string, Hex, string]),
      ["cP of 5 bytes", "0x0102030405", FAULT.ephemeralKey],
      ["cP of 40 bytes (no tag)", toHex(concat([x25519.getPublicKey(new Uint8Array(32).fill(3)), new Uint8Array(8)])), FAULT.unreadable],
      ["false tag", toHex(concat([x25519.getPublicKey(new Uint8Array(32).fill(3)), new Uint8Array(80).fill(1)])), FAULT.unreadable],
      ["plaintext that is not UTF-8", sealOf(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])), FAULT.unreadable],
      ["plaintext that is not JSON", sealOf(utf8('{"bountyId":"1",')), FAULT.notCanonical],
      ["non-integer bountyId", sealOf(utf8(`{"bountyId":1.5,"payee":"${HUNTER}","capital":"0","predicate":{},"txs":[],"attackCode":null}`)), FAULT.notCanonical],
    ];
    for (const [what, cP, note] of cases) {
      const claim = forgedClaimFor(cP);
      const chain = new FakeChain();
      chain.accept(claim, [OP_A]);
      const B = refuterOf(chain, { run: async () => ({ ctx: okCtx() }) });
      const r = await B.service.refute(await refuteRequest(B.kit, claim, { ...key, cP }));
      expect(r, what).toMatchObject({ status: "refuted", refutation: { proven: false, loss: 0n, tier: 0 }, replay: { replayed: false, note } });
    }
  });

  it("the classifiers are pinned to the libraries: low-order X25519, ChaCha20-Poly1305 tag, UTF-8, HPKE, BigInt", async () => {
    const P = (1n << 255n) - 19n;
    const le = (n: bigint) => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) { b[i] = Number(n & 255n); n >>= 8n; } return b; };
    const k = randomBytes(32);
    const throwsX = (u: Uint8Array) => { try { x25519.getSharedSecret(k, u); return false; } catch { return true; } };
    for (const v of [0n, 1n, P - 1n, P, P + 1n, P + 19n, P + 20n, 325606250916557431795983626356110631294008115727848805560023387167927233504n,
      39382357235489614581723060781553021112529911719440698176882885853963445705823n]) {
      expect(isSmallOrderX25519(le(v)), v.toString()).toBe(true);
      expect(throwsX(le(v)), v.toString()).toBe(true);
    }
    for (let i = 0; i < 2_000; i++) {
      const u = randomBytes(32);
      expect(isSmallOrderX25519(u)).toBe(throwsX(u));
    }
    for (let v = 2n; v < 600n; v++) expect(isSmallOrderX25519(le(v))).toBe(throwsX(le(v)));
    expect(isSmallOrderX25519(new Uint8Array(31))).toBe(false);
    // an invalid tag: exactly Error, message "invalid tag"
    let tag: unknown;
    try { chacha20poly1305(new Uint8Array(32), new Uint8Array(12)).decrypt(new Uint8Array(20)); } catch (e) { tag = e; }
    expect(isInvalidTagError(tag)).toBe(true);
    expect(isInvalidTagError(new RangeError("invalid tag"))).toBe(false);
    expect(isInvalidTagError(new Error("Array buffer allocation failed"))).toBe(false);
    // invalid UTF-8: TypeError ERR_ENCODING_INVALID_ENCODED_DATA
    let u8: unknown;
    try { new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff])); } catch (e) { u8 = e; }
    expect(isInvalidUtf8Error(u8)).toBe(true);
    expect(isInvalidUtf8Error(new TypeError("other"))).toBe(false);
    // HPKE: every error of the library is an HpkeError
    const kit = newKit();
    for (const [enc, ct] of [[randomBytes(32), randomBytes(40)], [randomBytes(5), randomBytes(40)], [new Uint8Array(32), randomBytes(40)], [new Uint8Array(0), new Uint8Array(0)]] as const) {
      const e = await kit.open(enc, ct).catch((x) => x);
      expect(e).toBeInstanceOf(HpkeError);
    }
    // BigInt of a JSON value
    expect(jsonBigInt("12")).toBe(12n);
    expect(jsonBigInt("0x10")).toBe(16n);
    expect(jsonBigInt(7)).toBe(7n);
    expect(jsonBigInt([3])).toBe(3n);
    for (const x of ["1.5", "abc", 1.5, Infinity, null, undefined, {}, [1, 2]]) expect(jsonBigInt(x), String(x)).toBeUndefined();
    expect(() => jsonBigInt({ toString() { throw new RangeError("pile"); } })).toThrow(RangeError);
    void canonicalProtocolPlaintext;
  });
});
