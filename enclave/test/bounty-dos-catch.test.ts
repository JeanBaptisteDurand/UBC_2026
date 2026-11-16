/**
 * Prime scellée v2.1 ter — déni de service et exceptions sans tri (vérification adverse du 9/11, scratchpad
 * verif-failclosed : e4-dos D1–D4, e7-amplification, e8-env-catch).
 *  2. /v1/refute : le jeton du seau est pris APRÈS la forme du corps et claimRecords (réclamation vivante) ; les corps
 *     invalides ont leur propre limite par IP vue, qui ne prive jamais les demandes valides (preuve D1) ;
 *  3. /bounty/submit : débit limité ; même chiffré répété → même résultat sans relire la chaîne (preuve D2) ; prime et
 *     paliers en cache par prime ; un échec du rejeu (budget…) est un 503, jamais « non prouvée » ;
 *  4. file pleine (« busy ») ou réfutations en cours (« refute_busy ») : jamais mémorisées comme échec (preuves D3, D4) ;
 *  5. seules des erreurs DÉTERMINISTES identifiées deviennent une faute ou un refus ; toute autre exception → 503, rien de
 *     signé, rien de mémorisé (preuve e8).
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

/** La chaîne vue par une enclave réfutante, avec lecture bon marché (record) ; compte ses lectures. */
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

/** Une réclamation HONNÊTE (cP réel du bundle) : le contre-rejeu d'okCtx() la confirme. */
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

/** Une réclamation dont le cP est un octet-à-octet quelconque (forgée par des enclaves fautives). */
function forgedClaimFor(cP: Hex): Claim {
  return {
    bountyId: 1n, payee: getAddress(HUNTER), blockN: 10n, blockHashN: zeroHash, predicateHash: view.predicateHash, loss: 5_000_000n, tier: 0,
    fingerprint: keccak256(toBytes("empreinte")), cPHash: keccak256(cP), deadline: 99n,
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
/** Fournisseur RPC émulé : prime #1 (16 paliers, existe), prime #2 (jamais créée : protocol = 0) ; compte par méthode. */
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
// 2. /v1/refute : jeton après la forme du corps et claimRecords ; corps invalides limités à part (preuve D1)
// =====================================================================================================================

describe("2 — /v1/refute : un corps invalide ou une réclamation inventée ne vident plus le seau (preuve D1)", () => {
  const invented = {
    claim: { bountyId: "1", payee: HUNTER, blockN: "1", blockHashN: zeroHash, predicateHash: zeroHash, loss: "1", tier: 0, fingerprint: zeroHash, cPHash: zeroHash, deadline: "1" },
    operators: [OP_A], enc: "0x" + "11".repeat(32), ciphertext: "0x" + "22".repeat(16),
  };

  it("preuve D1 rejouée (débit PAR DÉFAUT) : corps vides en rafale → 400 puis 429 pour EUX seuls, 0 lecture ; la demande valide est TOUJOURS servie, 10 minutes durant", async () => {
    const counter: Record<string, number> = {};
    const kit = newKit();
    const refuter = new RefutationService(kit, { sealedBounty: SEALED }, chainRefuteReader(new RpcQuorum([provider(counter)]), SEALED, REGISTRY), new DeterministicProtocolCipher(), { run: async () => { throw new Error("jamais"); } });
    let clock = 1_000_000;
    const app = createSealedBountyApp({ kit, service: undefined as any, refuter, attest, nowMs: () => clock });
    const post = (b: string) => app.request("/v1/refute", { method: "POST", headers: { "content-type": "application/json" }, body: b });
    const junk: number[] = [];
    for (let i = 0; i < 40; i++) junk.push((await post(i % 2 ? "{}" : "pas du json")).status);
    expect(junk.slice(0, 30)).toEqual(Array(30).fill(400));
    expect(junk.slice(30)).toEqual(Array(10).fill(429)); // limite par IP vue, propre aux corps invalides
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
    expect(served).toBe(tries); // 600 sur 600 (avant : 0 sur 600)
  }, 120_000);

  it("le jeton n'est pris que pour une réclamation VIVANTE, après claimRecords ; une réclamation au résultat mémorisé n'en prend pas", async () => {
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
    expect(await first.json()).toMatchObject({ status: "confirmed" }); // le seul jeton
    // même réclamation : résultat mémorisé, aucun jeton, aucun rejeu de plus
    for (let i = 0; i < 5; i++) expect((await ask(one)).status).toBe(200);
    expect(runs).toBe(1);
    // une AUTRE réclamation vivante, sans résultat : plus de jeton → 429 (lecture bon marché seule), Retry-After
    const fullBefore = chain.reads.full;
    const limited = await ask(two);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: RATE_LIMITED.refute });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(chain.reads.full).toBe(fullBefore);
    // une réclamation INVENTÉE : refusée après la lecture bon marché, jamais 429
    expect(await (await app.request("/v1/refute", json(invented))).json()).toMatchObject({ code: "unknown_claim" });
  });
});

// =====================================================================================================================
// 3. /bounty/submit : débit, déduplication par hachage du chiffré, cache des primes, budget = 503 (preuves D2, E7)
// =====================================================================================================================

describe("3 — /bounty/submit : débit limité, même chiffré = même résultat sans relecture, primes en cache", () => {
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

  it("preuve D2 rejouée : le MÊME chiffré envoyé 50 fois → UNE lecture de la prime (19 appels JSON-RPC au total, pas 950), 50 réponses identiques", async () => {
    const counter: Record<string, number> = {};
    const kit = newKit();
    const svc = new BountyService(kit, { sealedBounty: SEALED }, chainBountyReader(new RpcQuorum([provider(counter)]), SEALED), new DeterministicProtocolCipher(),
      { run: async () => { throw new Error("jamais atteint"); }, validate: () => {} }, { current: async () => 7_000n, blockHash: async () => zeroHash }, () => 1_000n);
    const app = createSealedBountyApp({ kit, service: svc, attest });
    const body = await sealed(kit);
    const texts = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const res = await app.request("/bounty/submit", json({ enc: body.enc, ciphertext: body.ciphertext }));
      expect(res.status).toBe(200);
      texts.add(await res.text());
    }
    expect(texts.size).toBe(1);
    expect(counter.total).toBe(19); // tête + getBounty + 17 paliers, une seule fois
    // un AUTRE chiffré pour la même prime : la prime est en cache (immuable) : AUCUNE lecture de plus
    const other = await sealed(kit, { capital: 5n });
    expect((await app.request("/bounty/submit", json({ enc: other.enc, ciphertext: other.ciphertext }))).status).toBe(200);
    expect(counter.total).toBe(19);
  });

  it("débit : jeton pris APRÈS les contrôles locaux (un bundle illisible n'en prend pas), AVANT toute lecture ; au-delà → 429 sans lecture", async () => {
    const reads = { n: 0 };
    const { kit, svc } = service({ run: async () => ({ ctx: okCtx() }) }, { reads });
    const app = createSealedBountyApp({ kit, service: svc, attest, submitRateLimit: { burst: 2, perMinute: 0.001 } });
    const post = async (b: { enc: string; ciphertext: string }) => app.request("/bounty/submit", json({ enc: b.enc, ciphertext: b.ciphertext }));
    for (let i = 0; i < 5; i++) {
      const res = await post(await sealed(kit, { plain: `{"pas":"un bundle ${i}"` }));
      expect(await res.json()).toMatchObject({ status: "not_proven", reason: "bundle illisible : JSON attendu" });
    }
    expect((await post(await sealed(kit, { capital: 1n }))).status).toBe(200);
    expect((await post(await sealed(kit, { capital: 2n }))).status).toBe(200);
    expect(reads.n).toBe(2);
    const limited = await post(await sealed(kit, { capital: 3n }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: RATE_LIMITED.submit });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(reads.n).toBe(2); // rien n'a été lu
  });

  it("déduplication : soumissions identiques SIMULTANÉES → un seul traitement ; après le délai, relu ; un chiffré indéchiffrable n'est jamais mémorisé", async () => {
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
    expect(reads.n).toBe(2); // délai écoulé : relu (et la MÊME réclamation, par l'anti-équivocation)
    // un chiffré qui ne s'ouvre pas : rien n'est gardé (il ne coûte qu'un essai HPKE)
    const realOpen = kit.open.bind(kit);
    let opens = 0;
    (kit as any).open = async (...a: Parameters<EnclaveKit["open"]>) => { opens++; return realOpen(...a); };
    const bad = await seal(toBytes(generateEnclaveKeys().x25519PublicKey), utf8("{}"));
    for (let i = 0; i < 2; i++) expect(await svc.submit(bad)).toMatchObject({ status: "not_proven", reason: expect.stringMatching(/^cE indéchiffrable/) });
    expect(opens).toBe(2);
  });

  it("un échec du rejeu (budget, RPC) est un 503 — jamais « non prouvée » — gardé 15 s ; une file pleine ou une exception d'environnement : rien n'est gardé", async () => {
    let clock = 0;
    let mode: "budget" | "busy" | "env" | "ok" = "budget";
    let runs = 0;
    const fork: ForkRunner = {
      run: async () => {
        runs++;
        if (mode === "budget") throw new ReplayUnavailableError("budget", "rejeu : budget de lectures du RPC du fork dépassé : rien n'est signé");
        if (mode === "busy") throw new ReplayUnavailableError("busy", "file de rejeu pleine");
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
    expect(runs).toBe(1); // gardé : pas de rejeu répété
    clock += 15_001;
    mode = "busy";
    expect((await post()).status).toBe(503);
    expect(runs).toBe(2);
    mode = "env";
    expect((await post()).status).toBe(503); // file pleine : rien n'était gardé, on rejoue aussitôt
    expect(runs).toBe(3);
    mode = "ok";
    const ok = await post(); // exception d'environnement : rien n'était gardé
    expect(runs).toBe(4);
    expect(await ok.json()).toMatchObject({ status: "proven" });
  });

  it("cache des primes : une prime qui EXISTE est lue une fois (partagé avec la réfutation) ; un identifiant jamais créé n'est jamais figé", async () => {
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
    expect(counter.getBounty).toBe(3); // prime #2 inexistante : relue à chaque fois
    expect(cache.size).toBe(1);
    // la réfutation réutilise la prime en cache : ni getBounty ni paliers ; REFUTE_WINDOW lu une fois
    const refuteReader = chainRefuteReader(q, SEALED, REGISTRY, cache);
    for (let i = 0; i < 3; i++) {
      const v = await refuteReader.read({ claimDigest: zeroHash, bountyId: 1n, signer: HOLDER });
      expect(v.bounty).toEqual(a);
      expect(v.refuteWindow).toBe(WINDOW);
    }
    expect(counter.getBounty).toBe(3);
    expect(counter.tierMinLoss).toBe(17 + 2); // les deux lectures de la prime #2 (fin de tableau dès l'indice 0)
    expect(counter.REFUTE_WINDOW).toBe(1);
  });
});

// =====================================================================================================================
// 4. file pleine : jamais mémorisée comme un échec du rejeu (preuves D3, D4)
// =====================================================================================================================

describe("4 — « busy » et « refute_busy » ne bloquent pas la réclamation 60 s", () => {
  it("preuve D3 rejouée : file pleine à la 1re demande ; 1 s plus tard, file libre → contre-rejeu fait (« confirmée »), pas « échec récent »", async () => {
    const { claim, hunter } = await honestClaim();
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    let busy = true, runs = 0, clock = 0;
    const B = refuterOf(chain, { run: async () => { runs++; if (busy) throw new ReplayUnavailableError("busy", "file de rejeu pleine"); return { ctx: okCtx() }; } }, { nowMs: () => clock });
    await expect(B.service.refute(await refuteRequest(B.kit, claim, hunter))).rejects.toMatchObject({ reason: "busy" });
    busy = false;
    clock += 1_000;
    expect((await B.service.refute(await refuteRequest(B.kit, claim, hunter))).status).toBe("confirmed");
    expect(runs).toBe(2);
  });

  it("preuve D4 (file RÉELLE du moteur pleine) : 503 « occupée », puis dès que la file se libère, la réclamation est rejouée (jamais « échec récent »)", async () => {
    // un RPC du fork qui ne répond pas : le rejeu en tête de file attend (contrôle de l'ancre)
    const hang = createHttpServer(() => { /* jamais de réponse */ });
    await new Promise<void>((r) => hang.listen(0, "127.0.0.1", () => r()));
    const port = (hang.address() as { port: number }).port;
    const runner = new AnvilForkRunner({ forkUrl: `http://127.0.0.1:${port}`, anvilBin: "/nonexistent/anvil", engine: "anvil", log: () => {}, maxQueued: 1 });
    const blocker = runner.run({ blockN: 5n, bundle: { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: pred, txs: [encodeExploitTx({ to: TOKEN, data: "0x" })], r: R, cP: "0x" }, expectedBlockHash: zeroHash });
    blocker.catch(() => {});
    const { claim, hunter } = await honestClaim();
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    // le réfutant partage la file du moteur ; ensuite, un moteur qui confirme
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

  it("refute_busy (réfutations en cours) : refus immédiat, rien de mémorisé ; la réclamation est servie dès qu'une place se libère", async () => {
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
// 5. exceptions : seules des erreurs DÉTERMINISTES identifiées deviennent une faute ; le reste → 503 (preuve e8)
// =====================================================================================================================

describe("5 — catch triés : environnement → 503, rien de signé, rien de mémorisé ; règles déterministes → faute", () => {
  const realDecode = TextDecoder.prototype.decode;
  const realParse = JSON.parse;
  afterEach(() => {
    TextDecoder.prototype.decode = realDecode;
    JSON.parse = realParse;
  });
  const key = { from: "protocol", protocolPrivateKey: toHex(protocol.x25519PrivateKey) };

  it("preuve e8 rejouée : RangeError d'environnement au décodage du clair de cP → 503, AUCUNE réfutation signée, rien de mémorisé (ensuite : « confirmée »)", async () => {
    const { claim, cP } = await honestClaim();
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    const B = refuterOf(chain, { run: async () => ({ ctx: okCtx() }) });
    const app = createSealedBountyApp({ kit: B.kit, service: undefined as any, refuter: B.service, attest });
    const body = httpBody(await refuteRequest(B.kit, claim, { ...key, cP }));
    let fatal = 0;
    TextDecoder.prototype.decode = function (this: TextDecoder, input?: any, opts?: any) {
      if (this.fatal && ++fatal === 2) throw new RangeError("Array buffer allocation failed"); // 1er : la demande ; 2e : le clair de cP
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

  it("JSON.parse, HPKE : une exception d'environnement → 503 (réfutation et soumission), jamais « non canonique », « illisible » ni « indéchiffrable »", async () => {
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
    parseFailing('{"bountyId"'); // le clair de cP (canonicalContent)
    await expect(B.service.refute(await refuteRequest(B.kit, claim, { ...key, cP }))).rejects.toBeInstanceOf(RangeError);
    JSON.parse = realParse;
    parseFailing('{"from"'); // la demande elle-même (establish)
    await expect(B.service.refute(await refuteRequest(B.kit, claim, hunter))).rejects.toBeInstanceOf(RangeError);
    JSON.parse = realParse;
    // HPKE : une erreur de la bibliothèque (déterministe) reste un refus ; une autre exception → 503
    const open = B.kit.open.bind(B.kit);
    (B.kit as any).open = async () => { throw new RangeError("Array buffer allocation failed"); };
    await expect(B.service.refute(await refuteRequest(B.kit, claim, hunter))).rejects.toBeInstanceOf(RangeError);
    (B.kit as any).open = open;
    expect(await B.service.refute({ claim, operators: [OP_A], enc: new Uint8Array(32), ciphertext: new Uint8Array(16) })).toMatchObject({ code: "undecryptable" });
    // rien n'a été mémorisé : la demande saine aboutit
    expect((await B.service.refute(await refuteRequest(B.kit, claim, { ...key, cP }))).status).toBe("confirmed");

    // soumission : JSON.parse du bundle et HPKE
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
    const ok = await post(); // rien de mémorisé : le même chiffré est traité
    expect(await ok.json()).toMatchObject({ status: "proven" });
    expect(runs).toBe(1);
  });

  it("fautes DÉTERMINISTES conservées (clé de la prime) : clé éphémère d'ordre faible, cP trop court, étiquette fausse, UTF-8 invalide, JSON illisible, entier non entier", async () => {
    const P = (1n << 255n) - 19n;
    const le = (n: bigint) => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) { b[i] = Number(n & 255n); n >>= 8n; } return b; };
    const small = [0n, 1n, P - 1n, 325606250916557431795983626356110631294008115727848805560023387167927233504n,
      39382357235489614581723060781553021112529911719440698176882885853963445705823n, P, P + 1n, 1n << 255n];
    const sealOf = (plain: Uint8Array) => deterministicSeal(toBytes(protocol.x25519PublicKey), plain, toBytes(R));
    const cases: Array<[string, Hex, string]> = [
      ...small.map((u, i) => [`point d'ordre faible n° ${i}`, toHex(concat([le(u), new Uint8Array(64).fill(7)])), FAULT.ephemeralKey] as [string, Hex, string]),
      ["cP de 5 octets", "0x0102030405", FAULT.ephemeralKey],
      ["cP de 40 octets (pas d'étiquette)", toHex(concat([x25519.getPublicKey(new Uint8Array(32).fill(3)), new Uint8Array(8)])), FAULT.unreadable],
      ["étiquette fausse", toHex(concat([x25519.getPublicKey(new Uint8Array(32).fill(3)), new Uint8Array(80).fill(1)])), FAULT.unreadable],
      ["clair qui n'est pas de l'UTF-8", sealOf(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])), FAULT.unreadable],
      ["clair qui n'est pas du JSON", sealOf(utf8('{"bountyId":"1",')), FAULT.notCanonical],
      ["bountyId non entier", sealOf(utf8(`{"bountyId":1.5,"payee":"${HUNTER}","capital":"0","predicate":{},"txs":[],"attackCode":null}`)), FAULT.notCanonical],
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

  it("les classifieurs sont épinglés sur les bibliothèques : X25519 d'ordre faible, étiquette ChaCha20-Poly1305, UTF-8, HPKE, BigInt", async () => {
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
    // étiquette invalide : Error exactement, message « invalid tag »
    let tag: unknown;
    try { chacha20poly1305(new Uint8Array(32), new Uint8Array(12)).decrypt(new Uint8Array(20)); } catch (e) { tag = e; }
    expect(isInvalidTagError(tag)).toBe(true);
    expect(isInvalidTagError(new RangeError("invalid tag"))).toBe(false);
    expect(isInvalidTagError(new Error("Array buffer allocation failed"))).toBe(false);
    // UTF-8 invalide : TypeError ERR_ENCODING_INVALID_ENCODED_DATA
    let u8: unknown;
    try { new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff])); } catch (e) { u8 = e; }
    expect(isInvalidUtf8Error(u8)).toBe(true);
    expect(isInvalidUtf8Error(new TypeError("autre"))).toBe(false);
    // HPKE : toutes les erreurs de la bibliothèque sont des HpkeError
    const kit = newKit();
    for (const [enc, ct] of [[randomBytes(32), randomBytes(40)], [randomBytes(5), randomBytes(40)], [new Uint8Array(32), randomBytes(40)], [new Uint8Array(0), new Uint8Array(0)]] as const) {
      const e = await kit.open(enc, ct).catch((x) => x);
      expect(e).toBeInstanceOf(HpkeError);
    }
    // BigInt d'une valeur JSON
    expect(jsonBigInt("12")).toBe(12n);
    expect(jsonBigInt("0x10")).toBe(16n);
    expect(jsonBigInt(7)).toBe(7n);
    expect(jsonBigInt([3])).toBe(3n);
    for (const x of ["1.5", "abc", 1.5, Infinity, null, undefined, {}, [1, 2]]) expect(jsonBigInt(x), String(x)).toBeUndefined();
    expect(() => jsonBigInt({ toString() { throw new RangeError("pile"); } })).toThrow(RangeError);
    void canonicalProtocolPlaintext;
  });
});
