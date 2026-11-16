/**
 * Prime scellée v2.1 bis — ÉCHEC FERMÉ (revue adverse du 9/11, preuves du scratchpad verif-refute : t2, t2b, jit, t4).
 * Règle d'or : l'enclave ne signe JAMAIS (ni réclamation, ni réfutation) un résultat qui dépend d'une erreur de réseau, de
 * RPC, de délai ou d'environnement ; seules des règles DÉTERMINISTES, écrites et testées, donnent une « faute prouvée ».
 *  1. rejeu (anvil-fork.ts) : une lecture du prédicat refusée par le RPC du fork ne vaut jamais 0 ni « invariant non tenu »
 *     (réfutation ET réclamation : rien n'est signé) ; un revert EVM (code 3) reste la valeur de la règle v0 ; ancre (hash
 *     du bloc N) contrôlée ; contrôle du moteur au démarrage ;
 *  2. prédicat : bornes itératives (imbrication, champs, taille) et forme ; hors règles = refus à la soumission, faute
 *     prouvée à la réfutation ; toute autre exception (RangeError, environnement) = 503, rien de signé ;
 *  3. déni de service de /v1/refute : claimRecords lu seul d'abord, échecs mémorisés, concurrence et débit bornés ;
 *  4. fuites : messages fixes (notes de rejeu, réponses HTTP) ;
 *  6. époque des règles : une réclamation acceptée avant n'est pas jugée.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type Address, type Hex, custom, decodeFunctionData, encodeFunctionResult, getAddress, keccak256, numberToHex, pad, parseAbi,
  toBytes, toHex, zeroAddress, zeroHash,
} from "viem";
import { EnclaveKit } from "../src/kit/enclave-kit";
import { type Claim } from "../src/kit/eip712";
import { seal } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import { deterministicSeal } from "../src/kit/deterministic-seal";
import { RpcQuorum } from "../src/kit/rpc-quorum";
import {
  PREDICATE_MAX_BYTES, PREDICATE_MAX_DEPTH, PREDICATE_MAX_FIELDS, PredicateError, checkPredicateBounds, predicateHash,
  validatePredicate, type EvalContext, type Predicate,
} from "../src/services/predicate";
import { AnvilForkRunner, RpcCallError, encodeExploitTx, isEvmRevert } from "../src/services/anvil-fork";
import {
  BountyService, DeterministicProtocolCipher, FAULT, RefutationService, ReplayRuleError, ReplayUnavailableError,
  canonicalProtocolPlaintext, claimDigestOf, claimOperatorsHash, exploitFingerprint, refuteRequestAad,
  type BountyView, type ExploitBundle, type ForkRunner, type RefuteChainView, type RefuteReader, type RefuteResult, type SubmitResult,
} from "../src/services/bounty";
import { UNAVAILABLE, chainRefuteReader, createSealedBountyApp, isJsonRpcRevert } from "../products/sealed-bounty/app";

const ANVIL = [process.env.ANVIL_BIN, join(homedir(), ".foundry", "bin", "anvil")].find(
  (p): p is string => !!p && existsSync(p) && spawnSync(p, ["--version"]).status === 0,
);

const CHAIN = 5042002;
const SEALED = "0x00000000000000000000000000000000000000bb" as Address;
const REGISTRY = "0x0000000000000000000000000000000000000001" as Address;
const PRODUCT = 2n;
const TOKEN = "0x0000000000000000000000000000000000000010" as Address;
const HOLDER = "0x0000000000000000000000000000000000000011" as Address;
const HUNTER = "0x000000000000000000000000000000000000c0de" as Address;
const OP_A = getAddress("0x000000000000000000000000000000000000a001");
const OP_B = getAddress("0x000000000000000000000000000000000000b002");
const R = ("0x" + "31".repeat(32)) as Hex;
const WINDOW = 259_200n;
const utf8 = (s: string) => new TextEncoder().encode(s);
const protocol = generateEnclaveKeys();
const newKit = () => new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: REGISTRY, mockBlockHash: true });
const attest = { operatorAllowlist: null, registeredOperator: async () => null, warn: () => {} };
const deep = (d: number): any => { let x: any = 0; for (let i = 0; i < d; i++) x = [x]; return x; };
/** Le même tableau imbriqué, en TEXTE JSON (le test ne sérialise jamais lui-même une valeur profonde : sa pile varie). */
const deepJson = (d: number) => "[".repeat(d) + "0" + "]".repeat(d);
const clauseJson = (extra: string) => `{"type":"ERC20_DROP","token":"${TOKEN}","holder":"${HOLDER}","min":"1000000","x":${extra}}`;
const erc20Pred: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: TOKEN, holder: HOLDER, min: "1000000" }] };
const okCtx = (loss = 5_000_000n): EvalContext => ({ erc20Drop: () => loss, nativeDrop: () => 0n, attackerProfit: () => 0n, viewValue: () => 0n, invariantHeld: () => true });

/** La chaîne SealedBounty vue par une enclave réfutante ; compte ses lectures (bon marché et complètes). Son heure est celle
 *  de l'horloge locale (comme sur Arc), sauf quand un test la fixe. */
class FakeChain implements RefuteReader {
  records = new Map<string, { acceptedAt: bigint; refuted: boolean; opsHash: Hex }>();
  active = new Map<string, Address>();
  reads = { record: 0, full: 0 };
  now = BigInt(Math.floor(Date.now() / 1000));
  constructor(public view: BountyView) {}
  accept(claim: Claim, ops: Address[], acceptedAt = this.now - 3_600n): Hex {
    const d = claimDigestOf(SEALED, claim, CHAIN);
    this.records.set(d.toLowerCase(), { acceptedAt, refuted: false, opsHash: claimOperatorsHash(ops) });
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
      bounty: { ...this.view, productId: PRODUCT }, myOperator: this.active.get(q.signer.toLowerCase()) ?? zeroAddress,
    };
  }
}

async function refuteRequest(kit: EnclaveKit, claim: Claim, operators: Address[], plaintext: object | string) {
  const text = typeof plaintext === "string" ? plaintext : JSON.stringify(plaintext);
  const s = await seal(toBytes(kit.keys.x25519PublicKey), utf8(text), refuteRequestAad(claimDigestOf(SEALED, claim, CHAIN)));
  return { claim, operators, enc: s.enc, ciphertext: s.ciphertext };
}
const httpBody = (claim: Claim, operators: Address[], q: { enc: Uint8Array; ciphertext: Uint8Array }) => ({
  claim: { ...claim, bountyId: claim.bountyId.toString(), blockN: claim.blockN.toString(), loss: claim.loss.toString(), deadline: claim.deadline.toString() },
  operators, enc: toHex(q.enc), ciphertext: toHex(q.ciphertext),
});

/** Une réclamation ACCEPTÉE quelconque (forgée ou non) sur un contenu de cP donné : ce que voit une enclave réfutante.
 *  `predicateJson` : le prédicat déjà en texte JSON (pour un prédicat profond). */
function forgedClaim(content: { predicate?: unknown; predicateJson?: string; txs: unknown; capital?: bigint }, view: BountyView, o: { predicateHash?: Hex } = {}) {
  const text = content.predicateJson !== undefined
    ? `{"bountyId":"1","payee":"${HUNTER}","capital":"${content.capital ?? 0n}","predicate":${content.predicateJson},"txs":${JSON.stringify(content.txs)},"attackCode":null}`
    : JSON.stringify({ bountyId: "1", payee: HUNTER, capital: String(content.capital ?? 0n), predicate: content.predicate, txs: content.txs, attackCode: null });
  const cP = deterministicSeal(toBytes(protocol.x25519PublicKey), utf8(text), toBytes(R));
  const txs = Array.isArray(content.txs) && content.txs.every((t) => typeof t === "string") ? (content.txs as Hex[]) : ["0x"] as Hex[];
  const claim: Claim = {
    bountyId: 1n, payee: getAddress(HUNTER), blockN: 10n, blockHashN: keccak256(toBytes("bloc 10")), predicateHash: o.predicateHash ?? view.predicateHash,
    loss: 5_000_000n, tier: 0, fingerprint: exploitFingerprint({ txs }), cPHash: keccak256(cP), deadline: 99n,
  };
  return { claim, cP };
}

function refuterOf(chain: FakeChain, fork: ForkRunner, cfg: Partial<ConstructorParameters<typeof RefutationService>[1]> = {}) {
  const kit = newKit();
  chain.active.set(kit.keys.signer.toLowerCase(), OP_B);
  return { kit, service: new RefutationService(kit, { sealedBounty: SEALED, ...cfg }, chain, new DeterministicProtocolCipher(), fork) };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => (typeof a === "object" && a ? resolve(a.port) : reject(new Error("port"))));
    });
  });
}

async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(`${method} : ${j.error.message}`);
  return j.result;
}

/** Mandataire JSON-RPC devant la chaîne de base : fait échouer (-32000 « missing trie node ») les `times` premières
 *  lectures de la case `slot` de `account` — un nœud qui ne sert pas cet état, une fois. */
async function flakyRpc(target: string, account: Address, slot: bigint, times: number) {
  let left = times;
  let hits = 0;
  const one = async (q: any): Promise<unknown> => {
    if (left > 0 && q.method === "eth_getStorageAt" && String(q.params?.[0]).toLowerCase() === account.toLowerCase() && BigInt(q.params?.[1]) === slot) {
      left--;
      hits++;
      return { jsonrpc: "2.0", id: q.id, error: { code: -32000, message: "missing trie node 0000 (path )" } };
    }
    return (await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q) })).json();
  };
  const server: Server = createHttpServer((rq, rs) => {
    let body = "";
    rq.on("data", (d) => (body += d));
    rq.on("end", async () => {
      const j = JSON.parse(body);
      const out = Array.isArray(j) ? await Promise.all(j.map(one)) : await one(j);
      rs.writeHead(200, { "content-type": "application/json" });
      rs.end(JSON.stringify(out));
    });
  });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${port}`, hits: () => hits, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

// =====================================================================================================================
// 1. le rejeu échoue fermé (vrai anvil, chaîne locale)
// =====================================================================================================================

/** T : sans données → slot0 = 42 ; vue → slot0 == 42 ? slot1 : 0 (base : slot1 = 7). */
const T = "0x0000000000000000000000000000000000007777" as Address;
const T_CODE = "0x3615602457600054602a14601857600060005260206000f35b60015460005260206000f35b602a60005500" as Hex;
/** U : sans données → slot0 = 42 ; vue → slot0 == 42 ? slot1 : slot2 (base : slot1 = 7, slot2 = 5 : jamais nulle). */
const U = "0x0000000000000000000000000000000000008888" as Address;
const U_CODE = "0x3615602557600054602a1460195760025460005260206000f35b60015460005260206000f35b602a60005500" as Hex;
/** V : sans données → slot0 = 42 ; vue → slot0 == 42 ? REVERT : 1 (l'invariant tient avant, l'appel revert après). */
const V = "0x0000000000000000000000000000000000009999" as Address;
const V_CODE = "0x3615601e57600054602a14601857600160005260206000f35b60006000fd5b602a60005500" as Hex;

describe.skipIf(!ANVIL)(`1 — le rejeu échoue fermé (anvil réel : ${ANVIL ?? "absent"}, chaîne locale)`, () => {
  let base: ChildProcess | undefined;
  let url = "";
  let N = 0n;

  beforeAll(async () => {
    const port = await freePort();
    base = spawn(ANVIL!, ["--port", String(port), "--chain-id", String(CHAIN), "--silent"], { stdio: "ignore" });
    url = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
      try {
        await rpc(url, "eth_chainId");
        break;
      } catch {
        if (i > 150) throw new Error("anvil de base injoignable");
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await rpc(url, "evm_mine");
    for (const [a, code] of [[T, T_CODE], [U, U_CODE], [V, V_CODE]] as const) await rpc(url, "anvil_setCode", [a, code]);
    await rpc(url, "anvil_setStorageAt", [T, pad("0x01", { size: 32 }), pad("0x07", { size: 32 })]);
    await rpc(url, "anvil_setStorageAt", [U, pad("0x01", { size: 32 }), pad("0x07", { size: 32 })]);
    await rpc(url, "anvil_setStorageAt", [U, pad("0x02", { size: 32 }), pad("0x05", { size: 32 })]);
    await rpc(url, "evm_mine");
    N = BigInt(await rpc(url, "eth_blockNumber"));
    for (let i = 0; i < 3; i++) await rpc(url, "evm_mine");
  }, 60_000);
  afterAll(() => base?.kill("SIGKILL"));

  const logs: string[] = [];
  const runner = (u: string) => new AnvilForkRunner({ forkUrl: u, anvilBin: ANVIL, engine: "anvil", log: (m) => logs.push(m), timeoutMs: 60_000 });
  const blockHash = async (n: bigint) => (await rpc(url, "eth_getBlockByNumber", [numberToHex(n), false])).hash as Hex;
  const viewOf = (p: Predicate): BountyView => ({ predicateHash: predicateHash(p), protocolX25519: protocol.x25519PublicKey, tierMinLoss: [0n], deadline: 9_999_999_999n });

  /** L'enclave de RÉCLAMATION (moteur réel, RPC du fork `forkUrl`). */
  async function claimWith(p: Predicate, target: Address, forkUrl: string, blocks?: { blockHash: (n: bigint) => Promise<Hex> }) {
    const kit = newKit();
    const svc = new BountyService(kit, { sealedBounty: SEALED }, { getBounty: async () => viewOf(p) }, new DeterministicProtocolCipher(), runner(forkUrl),
      { current: async () => BigInt(await rpc(url, "eth_blockNumber")), blockHash: blocks?.blockHash ?? blockHash }, () => BigInt(Math.floor(Date.now() / 1000)));
    const txs = [encodeExploitTx({ to: target, data: "0x" })];
    const b: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: p, txs, r: R, cP: "0x" };
    const cP = await new DeterministicProtocolCipher().recompute(b, protocol.x25519PublicKey);
    const plain = { bountyId: "1", payee: HUNTER, capital: "0", predicate: p, txs, r: R, cP, blockN: N.toString() };
    const cE = await seal(toBytes(kit.keys.x25519PublicKey), utf8(JSON.stringify(plain)));
    return { svc, kit, cE, txs };
  }
  const hunterPlain = (p: Predicate, txs: Hex[]) => ({ from: "hunter", bountyId: "1", payee: HUNTER, capital: "0", predicate: p, txs, r: R });

  it("RÉFUTATION (preuve t2) : le RPC du réfutant rate UNE lecture de vue → 503, AUCUNE réfutation signée ; RPC rétabli → « confirmée »", async () => {
    const p: Predicate = { combine: "OR", clauses: [{ type: "VIEW_CHANGED", target: T, call: "0x01", op: "eq", value: "7" }] };
    const { svc, cE, txs } = await claimWith(p, T, url);
    const sub = (await svc.submit(cE)) as Extract<SubmitResult, { status: "proven" }>;
    expect(sub.status).toBe("proven"); // réclamation HONNÊTE (RPC sain)

    const proxy = await flakyRpc(url, T, 1n, 1);
    try {
      const chain = new FakeChain(viewOf(p));
      chain.accept(sub.claim, [OP_A]);
      let clock = 1_000_000;
      const B = refuterOf(chain, runner(proxy.url), { nowMs: () => clock });
      const app = createSealedBountyApp({ kit: B.kit, service: svc, refuter: B.service, attest, refuteRateLimit: false });
      const q = await refuteRequest(B.kit, sub.claim, [OP_A], hunterPlain(p, txs));
      const res = await app.request("/v1/refute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(httpBody(sub.claim, [OP_A], q)) });
      expect(res.status).toBe(503);
      const j = (await res.json()) as any;
      expect(j).toEqual({ error: UNAVAILABLE.refute }); // message fixe, rien de signé
      expect(proxy.hits()).toBe(1);
      // le même contre-rejeu, demandé de nouveau tout de suite : pas de rejeu complet (échec mémorisé)
      await expect(B.service.refute(await refuteRequest(B.kit, sub.claim, [OP_A], hunterPlain(p, txs)))).rejects.toMatchObject({ reason: "recent_failure" });
      // une minute plus tard, RPC rétabli : la réclamation honnête est CONFIRMÉE (jamais réfutée)
      clock += 61_000;
      const ok = await B.service.refute(await refuteRequest(B.kit, sub.claim, [OP_A], hunterPlain(p, txs)));
      expect(ok.status).toBe("confirmed");
      expect(ok).not.toHaveProperty("signature");
    } finally {
      await proxy.close();
    }
  }, 120_000);

  it("RÉCLAMATION (preuve t2b) : le RPC de l'enclave rate UNE lecture d'invariant → aucune réclamation signée (témoin RPC sain : non prouvée)", async () => {
    const p: Predicate = { combine: "OR", clauses: [{ type: "INVARIANT_BROKEN", target: U, call: "0x01" }] };
    const healthy = await claimWith(p, U, url);
    const ok = await healthy.svc.submit(healthy.cE);
    expect(ok).toMatchObject({ status: "not_proven", reason: "prédicat non satisfait" });

    const proxy = await flakyRpc(url, U, 1n, 1);
    try {
      const flaky = await claimWith(p, U, proxy.url);
      await expect(flaky.svc.submit(flaky.cE)).rejects.toBeInstanceOf(ReplayUnavailableError);
      expect(proxy.hits()).toBe(1);
      // même chose par HTTP : 503, message fixe
      const again = await claimWith(p, U, (await flakyRpc(url, U, 1n, 1)).url);
      const app = createSealedBountyApp({ kit: again.kit, service: again.svc, attest });
      const res = await app.request("/bounty/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enc: toHex(again.cE.enc), ciphertext: toHex(again.cE.ciphertext) }) });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: UNAVAILABLE.submit });
    } finally {
      await proxy.close();
    }
  }, 120_000);

  it("un revert EVM DÉTERMINISTE (code 3) d'une lecture d'invariant reste la règle v0 (invariant non tenu) : réclamation prouvée, puis confirmée", async () => {
    const p: Predicate = { combine: "OR", clauses: [{ type: "INVARIANT_BROKEN", target: V, call: "0x01" }] };
    const { svc, cE, txs } = await claimWith(p, V, url);
    const sub = (await svc.submit(cE)) as Extract<SubmitResult, { status: "proven" }>;
    expect(sub.status).toBe("proven");
    const chain = new FakeChain(viewOf(p));
    chain.accept(sub.claim, [OP_A]);
    const B = refuterOf(chain, runner(url));
    expect((await B.service.refute(await refuteRequest(B.kit, sub.claim, [OP_A], hunterPlain(p, txs)))).status).toBe("confirmed");
    // le journal du rejeu ne dit rien de l'exploit (ni transactions, ni nombre de transactions)
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l).not.toMatch(/transaction/);
  }, 120_000);

  it("ancre : un RPC du fork qui ne sert pas le bloc N de la réclamation (hash différent) → rien n'est signé", async () => {
    const p: Predicate = { combine: "OR", clauses: [{ type: "VIEW_CHANGED", target: T, call: "0x01", op: "eq", value: "7" }] };
    const wrong = await claimWith(p, T, url, { blockHash: async () => keccak256(toBytes("autre chaîne")) });
    await expect(wrong.svc.submit(wrong.cE)).rejects.toMatchObject({ reason: "anchor" });
    const bundle: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: p, txs: wrong.txs, r: R, cP: "0x" };
    await expect(runner(url).run({ blockN: N, bundle, expectedBlockHash: zeroHash })).rejects.toMatchObject({ reason: "anchor" });
    await expect(runner(url).run({ blockN: N, bundle, expectedBlockHash: await blockHash(N) })).resolves.toHaveProperty("ctx");
  }, 120_000);

  it("contrôle du moteur au démarrage : une lecture refusée par le RPC du fork remonte en erreur ; un moteur qui l'avalerait est refusé", async () => {
    const r = runner(url);
    // v2.1 ter : plus les réponses invalides (bloc null, stockage mal formé) refusées par le relais strict, et le contrôle positif
    expect(await r.selfTest()).toMatchObject({
      revertCode: 3,
      checks: [
        "lecture directe : erreur", "stockage mal formé : erreur (relais)", "bloc rendu null : erreur (relais)",
        "contrôle positif : BLOCKHASH et solde identiques au RPC du fork", "exécution (eth_call) : erreur", "transaction : jamais minée",
      ],
    });
    await expect(r.selfTest({ simulateSwallow: true })).rejects.toThrow(/avale les pannes/);
  }, 120_000);
});

describe("1 — classement des erreurs et file de rejeu (sans anvil)", () => {
  it("seul le code JSON-RPC 3 « execution reverted » est un revert ; -32603 (arrêt EVM ou panne du fork), -32000, HTTP n'en sont pas", () => {
    expect(isEvmRevert(new RpcCallError("eth_call", 3, "execution reverted"))).toBe(true);
    expect(isEvmRevert(new RpcCallError("eth_call", 3, "execution reverted: Panic"))).toBe(true);
    expect(isEvmRevert(new RpcCallError("eth_call", -32603, "failed to get storage for 0x… : missing trie node"))).toBe(false);
    expect(isEvmRevert(new RpcCallError("eth_call", -32603, "EVM error OutOfGas"))).toBe(false);
    expect(isEvmRevert(new RpcCallError("eth_call", -32000, "execution reverted"))).toBe(false);
    expect(isEvmRevert(new RpcCallError("eth_call", undefined, "HTTP 503"))).toBe(false);
    expect(isEvmRevert(new Error("execution reverted"))).toBe(false);
  });

  it("file de rejeu bornée : au-delà de maxQueued, refus immédiat (503), rien de signé", async () => {
    // un RPC du fork qui ne répond jamais : le premier rejeu occupe la file (contrôle de l'ancre en attente)
    const hang = createHttpServer(() => { /* jamais de réponse */ });
    const port = await freePort();
    await new Promise<void>((r) => hang.listen(port, "127.0.0.1", () => r()));
    const r = new AnvilForkRunner({ forkUrl: `http://127.0.0.1:${port}`, anvilBin: "/nonexistent/anvil", engine: "arc", log: () => {}, maxQueued: 1 });
    const bundle: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: erc20Pred, txs: [encodeExploitTx({ to: TOKEN, data: "0x" })], r: R, cP: "0x" };
    const first = r.run({ blockN: 5n, bundle, expectedBlockHash: zeroHash });
    first.catch(() => {});
    await expect(r.run({ blockN: 5n, bundle })).rejects.toMatchObject({ reason: "busy" });
    hang.closeAllConnections();
    hang.close();
    await expect(first).rejects.toBeInstanceOf(ReplayUnavailableError);
  });

  it("règles du rejeu : erreurs typées à message fixe (jamais le message de viem, jamais les octets de la transaction)", () => {
    const r = new AnvilForkRunner({ forkUrl: "http://127.0.0.1:1", anvilBin: "/nonexistent", engine: "arc", log: () => {} });
    const SECRET_TX = "0xa9059cbb000000000000000000000000c0ffee000000000000000000" as Hex; // 28 octets
    const b = (o: Partial<ExploitBundle>): ExploitBundle => ({ bountyId: 1n, payee: HUNTER, capital: 0n, predicate: erc20Pred, txs: [SECRET_TX], r: R, cP: "0x", ...o });
    for (const [bundle, rule] of [
      [b({}), "tx_format"], [b({ txs: [] }), "txs_empty"], [b({ txs: Array(11).fill(encodeExploitTx({ to: TOKEN, data: "0x" })) }), "txs_count"],
      [b({ txs: ["0x" + "00".repeat(64 * 1024 + 1)] as Hex[] }), "tx_size"], [b({ txs: [encodeExploitTx({ to: TOKEN, data: "0x" })], capital: 10n ** 15n + 1n }), "capital"],
    ] as const) {
      let err: unknown;
      try { r.validate(bundle); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ReplayRuleError);
      expect((err as ReplayRuleError).rule).toBe(rule);
      expect((err as Error).message).not.toContain(SECRET_TX.slice(2, 20));
      expect((err as Error).message).not.toMatch(/viem|Version/);
    }
  });
});

// =====================================================================================================================
// 2. prédicats : règles déterministes ; toute autre exception = 503
// =====================================================================================================================

describe("2 — prédicat : bornes itératives et forme (règles P1–P4)", () => {
  const withAnnex = (x: unknown): Predicate => ({ combine: "OR", clauses: [{ ...erc20Pred.clauses[0]!, x } as any] });
  const ruleOf = (p: unknown) => {
    try {
      validatePredicate(p as Predicate);
      return "ok";
    } catch (e) {
      expect(e).toBeInstanceOf(PredicateError);
      return (e as PredicateError).rule;
    }
  };

  it("imbrication : 8 niveaux acceptés, 9 refusés ; champs : 256 acceptés, 257 refusés ; taille canonique : 16 Kio", () => {
    expect(ruleOf(withAnnex(deep(PREDICATE_MAX_DEPTH - 3)))).toBe("ok"); // racine 1, clauses 2, clause 3, annexe 4…8
    expect(ruleOf(withAnnex(deep(PREDICATE_MAX_DEPTH - 2)))).toBe("depth");
    const base = 2 + 1 + 4; // combine, clauses, 1 élément, 4 clés de clause
    expect(ruleOf(withAnnex(Array(PREDICATE_MAX_FIELDS - base - 1).fill(1)))).toBe("ok"); // + la clé « x »
    expect(ruleOf(withAnnex(Array(PREDICATE_MAX_FIELDS - base).fill(1)))).toBe("fields");
    const sized = (n: number) => withAnnex("a".repeat(n));
    const room = PREDICATE_MAX_BYTES - new TextEncoder().encode(JSON.stringify({ clauses: [{ holder: HOLDER, min: "1000000", token: TOKEN, type: "ERC20_DROP", x: "" }], combine: "OR" })).length;
    expect(ruleOf(sized(room))).toBe("ok");
    expect(ruleOf(sized(room + 1))).toBe("size");
    expect(ruleOf(withAnnex("é".repeat(Math.ceil(room / 2) + 1)))).toBe("size"); // octets UTF-8, pas caractères
  });

  it("JSON pur et forme des clauses : valeurs non JSON, type inconnu, adresse, entier, op, call → PredicateError à message fixe", () => {
    const c0 = erc20Pred.clauses[0]!;
    const cases: Array<[unknown, string]> = [
      [null, "json"], [[], "json"], [withAnnex(undefined), "json"], [withAnnex(NaN), "json"], [withAnnex(1n), "json"], [withAnnex(new Date(0)), "json"],
      [{ ...erc20Pred, combine: "XOR" }, "combine"], [{ combine: "OR", clauses: [] }, "clauses"], [{ combine: "OR", clauses: Array(9).fill(c0) }, "clauses"],
      [{ combine: "OR", clauses: [{ ...c0, type: "erc20_drop" }] }, "clause"], [{ combine: "OR", clauses: [{ ...c0, token: "0x123" }] }, "clause"],
      [{ combine: "OR", clauses: [{ ...c0, min: "-1" }] }, "clause"], [{ combine: "OR", clauses: [{ ...c0, min: "0x10" }] }, "clause"],
      [{ combine: "OR", clauses: [{ ...c0, min: "9".repeat(79) }] }, "clause"], [{ combine: "OR", clauses: [{ ...c0, min: 1.5 }] }, "clause"],
      [{ combine: "OR", clauses: [{ type: "VIEW_CHANGED", target: TOKEN, call: "0x01", op: "xor", value: "1" }] }, "clause"],
      [{ combine: "OR", clauses: [{ type: "INVARIANT_BROKEN", target: TOKEN, call: "0x0" }] }, "clause"],
    ];
    for (const [p, rule] of cases) expect(ruleOf(p)).toBe(rule);
    // admis : entier sûr en nombre, annexes bornées, clé __proto__ venue de JSON
    expect(ruleOf({ combine: "AND", clauses: [{ ...c0, min: 1_000_000 }] })).toBe("ok");
    expect(ruleOf(JSON.parse(`{"combine":"OR","clauses":[{"type":"NATIVE_DROP","holder":"${HOLDER}","min":"1","__proto__":{"a":1}}],"note":"démo"}`))).toBe("ok");
    // le message ne recopie rien du prédicat
    try { validatePredicate({ combine: "OR", clauses: [{ ...c0, token: "0xSECRETSECRET" }] } as any); } catch (e) { expect((e as Error).message).not.toContain("SECRET"); }
  });

  it("les prédicats valides gardent EXACTEMENT leur predicateHash d'avant les règles (JSON canonique inchangé)", () => {
    // l'implémentation v0 (avant le 9/11), recopiée ici telle quelle
    const v0 = (v: any): string => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(v0).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + v0(v[k])).join(",") + "}");
    const corpus: Predicate[] = [
      erc20Pred,
      { combine: "AND", clauses: [{ type: "NATIVE_DROP", holder: HOLDER, min: "1" }, { type: "ATTACKER_PROFIT", token: TOKEN, min: "0" }] },
      { combine: "OR", clauses: [{ type: "VIEW_CHANGED", target: T, call: "0x01", op: "gt", value: "7" }, { type: "INVARIANT_BROKEN", target: U, call: "0xdeadbeef" }] },
      { clauses: [{ min: "5", holder: HOLDER, token: TOKEN, type: "ERC20_DROP", note: "« dépôt » ☃ 🚀", meta: { tags: ["a", 1, true, null] } } as any], combine: "OR", v: 2 } as any,
    ];
    for (const p of corpus) expect(predicateHash(p)).toBe(keccak256(toBytes(v0(p))));
  });

  it("un prédicat imbriqué sur 100 000 niveaux est refusé par la RÈGLE, jamais par une pile épuisée, même presque sans pile (preuve jit)", () => {
    const huge = withAnnex(deep(100_000));
    const atDepth = (k: number, f: () => unknown): unknown => (k === 0 ? f() : atDepth(k - 1, f));
    // cadres de pile disponibles ici, mesurés avec la fonction qui s'en sert (le JIT change la taille des cadres : le plus
    // petit des 3 relevés)
    let room = Number.MAX_SAFE_INTEGER;
    for (let rep = 0; rep < 3; rep++) {
      let best = 0;
      for (let lo = 1, hi = 2_000_000; lo <= hi;) {
        const mid = (lo + hi) >> 1;
        try { atDepth(mid, () => 0); best = mid; lo = mid + 1; } catch { hi = mid - 1; }
      }
      room = Math.min(room, best);
    }
    for (const left of [3_000, 1_000, 300]) {
      // le banc de test lui-même peut déborder avant d'appeler validatePredicate (cadres de taille variable) : on recule
      // jusqu'à y entrer ; une fois dedans, la règle répond, jamais la pile
      let err: unknown;
      let entered = false;
      for (let k = Math.max(0, room - left); !entered && k >= 0; k -= 500) {
        err = undefined;
        try { atDepth(k, () => { entered = true; return validatePredicate(huge); }); } catch (e) { err = e; }
      }
      expect(entered).toBe(true);
      expect(err).toBeInstanceOf(PredicateError);
      expect((err as PredicateError).rule).toBe("depth");
    }
    expect(() => checkPredicateBounds(huge)).toThrow(PredicateError);
  });
});

describe("2 — soumission et réfutation : hors règles = refus / faute prouvée ; autre exception = 503", () => {
  const view: BountyView = { predicateHash: predicateHash(erc20Pred), protocolX25519: protocol.x25519PublicKey, tierMinLoss: [1_000_000n], deadline: 9_000_000n };

  it("soumission : prédicat de 7 000 niveaux → « non prouvée » (règle), SANS lecture on-chain ni rejeu (preuve jit/a-warm-claim)", async () => {
    let reads = 0;
    let runs = 0;
    const kit = newKit();
    const svc = new BountyService(kit, { sealedBounty: SEALED }, { getBounty: async () => { reads++; return view; } }, new DeterministicProtocolCipher(),
      { run: async () => { runs++; return { ctx: okCtx() }; } }, { current: async () => 2_000n, blockHash: async () => zeroHash }, () => 1_000n);
    const p = `{"combine":"OR","clauses":[${clauseJson(deepJson(7_000))}]}`;
    const text = `{"bountyId":"1","payee":"${HUNTER}","capital":"0","predicate":${p},"txs":["0x${"00".repeat(96)}"],"r":"${R}","cP":"0x","blockN":"1990"}`;
    const res = await svc.submit(await seal(toBytes(kit.keys.x25519PublicKey), utf8(text)));
    expect(res).toMatchObject({ status: "not_proven" });
    expect((res as any).reason).toMatch(/^prédicat hors règles : prédicat : imbrication de plus de 8 niveaux$/);
    expect(reads + runs).toBe(0);
  });

  it("réfutation, clé de la prime : rapport hors bornes → faute prouvée, la MÊME quelle que soit la pile (« non prouvée » signée, note fixe)", async () => {
    const deepPred = `{"combine":"OR","clauses":[${clauseJson(deepJson(5_000))}]}`;
    const { claim, cP } = forgedClaim({ predicateJson: deepPred, txs: ["0x" + "00".repeat(96)] }, view);
    const chain = new FakeChain(view);
    chain.accept(claim, [OP_A]);
    let runs = 0;
    const B = refuterOf(chain, { run: async () => { runs++; return { ctx: okCtx() }; } });
    const r = await B.service.refute(await refuteRequest(B.kit, claim, [OP_A], { from: "protocol", cP, protocolPrivateKey: toHex(protocol.x25519PrivateKey) }));
    expect(r).toMatchObject({ status: "refuted", refutation: { proven: false, loss: 0n, tier: 0 }, replay: { replayed: false, note: FAULT.tooDeep } });
    expect(runs).toBe(0);
    // par le secret de ce rapport (déchiffrement non prouvé) ou par le chasseur : REFUS, rien n'est signé
    const C = refuterOf(chain, { run: async () => ({ ctx: okCtx() }) });
    const shared = toHex(new Uint8Array(await import("@noble/curves/ed25519").then((m) => m.x25519.getSharedSecret(protocol.x25519PrivateKey, toBytes(cP).slice(0, 32)))));
    expect(await C.service.refute(await refuteRequest(C.kit, claim, [OP_A], { from: "protocol", cP, sharedSecret: shared }))).toMatchObject({ status: "refused", code: "exploit_mismatch" });
    const hunterText = `{"from":"hunter","bountyId":"1","payee":"${HUNTER}","capital":"0","predicate":${deepPred},"txs":["0x${"00".repeat(96)}"],"r":"${R}"}`;
    expect(await C.service.refute(await refuteRequest(C.kit, claim, [OP_A], hunterText))).toMatchObject({ status: "refused", code: "bad_request" });
  });

  it("réfutation : prédicat de forme invalide (op inconnu) dans cP → faute prouvée par la règle P4, note fixe", async () => {
    const bad = { combine: "OR", clauses: [{ type: "VIEW_CHANGED", target: TOKEN, call: "0x01", op: "xor", value: "1" }] };
    const { claim, cP } = forgedClaim({ predicate: bad, txs: ["0x" + "00".repeat(96)] }, view);
    const chain = new FakeChain(view);
    chain.accept(claim, [OP_A]);
    const B = refuterOf(chain, { run: async () => ({ ctx: okCtx() }) });
    const r = await B.service.refute(await refuteRequest(B.kit, claim, [OP_A], { from: "protocol", cP, protocolPrivateKey: toHex(protocol.x25519PrivateKey) }));
    expect(r).toMatchObject({ status: "refuted", refutation: { proven: false }, replay: { replayed: false, note: `${FAULT.predicate} (clause 1 : op doit valoir eq, neq, gt ou lt)` } });
  });

  it("une exception qui n'est PAS une règle (RangeError, erreur d'environnement) → 503, rien de signé ; règle du rejeu (ReplayRuleError) → faute", async () => {
    const txs = ["0x" + "00".repeat(96)] as Hex[];
    const chainFor = () => {
      const { claim, cP } = forgedClaim({ predicate: erc20Pred, txs }, view);
      const chain = new FakeChain(view);
      chain.accept(claim, [OP_A]);
      return { claim, cP, chain };
    };
    const key = { from: "protocol", protocolPrivateKey: toHex(protocol.x25519PrivateKey) };
    const forks: ForkRunner[] = [
      { run: async () => ({ ctx: okCtx() }), validate: () => { throw new RangeError("Maximum call stack size exceeded"); } },
      { run: async () => ({ ctx: okCtx() }), validate: () => { throw new Error("environnement"); } },
      { run: async () => ({ ctx: { ...okCtx(), erc20Drop: () => { throw new RangeError("Maximum call stack size exceeded"); } } }) },
      { run: async () => { throw new TypeError("fetch failed"); } },
    ];
    for (const fork of forks) {
      const { claim, cP, chain } = chainFor();
      const B = refuterOf(chain, fork);
      const app = createSealedBountyApp({ kit: B.kit, service: undefined as any, refuter: B.service, attest, refuteRateLimit: false });
      const q = await refuteRequest(B.kit, claim, [OP_A], { ...key, cP });
      const res = await app.request("/v1/refute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(httpBody(claim, [OP_A], q)) });
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).not.toMatch(/stack|environnement|fetch failed|signature/);
    }
    // ReplayRuleError : une règle déterministe → faute prouvée (note fixe)
    const { claim, cP, chain } = chainFor();
    const B = refuterOf(chain, { run: async () => ({ ctx: okCtx() }), validate: () => { throw new ReplayRuleError("txs_count", "au plus 10 transactions"); } });
    const r = await B.service.refute(await refuteRequest(B.kit, claim, [OP_A], { ...key, cP }));
    expect(r).toMatchObject({ status: "refuted", replay: { replayed: false, note: `${FAULT.replayRules} (au plus 10 transactions)` } });
  });
});

// =====================================================================================================================
// 3. déni de service de /v1/refute
// =====================================================================================================================

describe("3 — /v1/refute : lecture bon marché d'abord, échecs mémorisés, concurrence et débit bornés", () => {
  const view: BountyView = { predicateHash: predicateHash(erc20Pred), protocolX25519: protocol.x25519PublicKey, tierMinLoss: [1_000_000n], deadline: 9_000_000n };
  const abi = parseAbi([
    "struct Bounty { address protocol; uint256 productId; bytes32 predicateHash; bytes32 protocolX25519; uint256 singleCap; uint8 k; address targetToPause; uint64 deadline; uint256 balance; bool paused; }",
    "function getBounty(uint256 id) view returns (Bounty)",
    "function tierMinLoss(uint256 bountyId, uint256 index) view returns (uint256)",
    "function claimRecords(bytes32) view returns (uint64 acceptedAt, bool refuted, bytes32 opsHash)",
    "function REFUTE_WINDOW() view returns (uint64)",
    "function activeOperatorAt(address signer, uint256 productId, uint256 blockNumber) view returns (address)",
  ]);
  /** Un fournisseur RPC émulé (prime à 16 paliers) : compte ses appels JSON-RPC. */
  function provider(state: { acceptedAt: bigint; refuted: boolean }, counter: { n: number }, tierError?: "internal") {
    return custom({
      async request({ method, params }: { method: string; params?: any }) {
        counter.n++;
        if (method === "eth_blockNumber") return numberToHex(7_000n);
        if (method === "eth_getBlockByNumber") return { number: params[0], hash: pad("0x07", { size: 32 }), timestamp: numberToHex(1_000n), parentHash: zeroHash, transactions: [], logsBloom: null, nonce: null };
        const { functionName, args } = decodeFunctionData({ abi, data: params[0].data });
        switch (functionName) {
          case "claimRecords": return encodeFunctionResult({ abi, functionName, result: [state.acceptedAt, state.refuted, zeroHash] });
          case "REFUTE_WINDOW": return encodeFunctionResult({ abi, functionName, result: WINDOW });
          case "getBounty": return encodeFunctionResult({ abi, functionName, result: { protocol: HOLDER, productId: PRODUCT, predicateHash: zeroHash, protocolX25519: zeroHash, singleCap: 1n, k: 1, targetToPause: HOLDER, deadline: 1n, balance: 1n, paused: false } });
          case "tierMinLoss":
            if (tierError === "internal" && Number(args![1]) === 1) throw Object.assign(new Error("internal error"), { code: -32603 });
            if (Number(args![1]) >= 16) throw Object.assign(new Error("execution reverted"), { code: 3 }); // comme le RPC public d'Arc : sans données
            return encodeFunctionResult({ abi, functionName, result: BigInt(Number(args![1]) + 1) });
          case "activeOperatorAt": return encodeFunctionResult({ abi, functionName, result: zeroAddress });
        }
        throw new Error(String(functionName));
      },
    }, { retryCount: 0 });
  }
  const inventedBody = {
    claim: { bountyId: "1", payee: HUNTER, blockN: "1", blockHashN: zeroHash, predicateHash: zeroHash, loss: "1", tier: 0, fingerprint: zeroHash, cPHash: zeroHash, deadline: "1" },
    operators: [OP_A], enc: "0x" + "11".repeat(32), ciphertext: "0x" + "22".repeat(16),
  };
  const noFork: ForkRunner = { run: async () => { throw new Error("jamais"); } };

  it("réclamation inventée (preuve T4a) : 2 appels JSON-RPC par fournisseur (tête + claimRecords) au lieu de 23 ; réfutée : idem", async () => {
    for (const state of [{ acceptedAt: 0n, refuted: false }, { acceptedAt: 5n, refuted: true }]) {
      const counter = { n: 0 };
      const rpcQ = new RpcQuorum([provider(state, counter), provider(state, counter), provider(state, counter)]);
      const kit = newKit();
      const refuter = new RefutationService(kit, { sealedBounty: SEALED }, chainRefuteReader(rpcQ, SEALED, REGISTRY), new DeterministicProtocolCipher(), noFork);
      const app = createSealedBountyApp({ kit, service: undefined as any, refuter, attest, refuteRateLimit: false });
      const res = await app.request("/v1/refute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(inventedBody) });
      const j = (await res.json()) as any;
      expect(j.code).toBe(state.refuted ? "already_refuted" : "unknown_claim");
      expect(counter.n).toBe(6); // 3 fournisseurs × (eth_blockNumber + claimRecords)
    }
  });

  it("paliers : une erreur INTERNE du nœud (-32603) ne tronque plus les paliers (elle remonte) ; la fin de tableau est un revert (code 3)", async () => {
    const counter = { n: 0 };
    const ok = await chainRefuteReader(new RpcQuorum([provider({ acceptedAt: 5n, refuted: false }, counter)]), SEALED, REGISTRY).read({ claimDigest: zeroHash, bountyId: 1n, signer: HOLDER });
    expect(ok.bounty.tierMinLoss).toEqual(Array.from({ length: 16 }, (_, i) => BigInt(i + 1)));
    await expect(chainRefuteReader(new RpcQuorum([provider({ acceptedAt: 5n, refuted: false }, counter, "internal")]), SEALED, REGISTRY).read({ claimDigest: zeroHash, bountyId: 1n, signer: HOLDER })).rejects.toThrow();
    expect(isJsonRpcRevert(Object.assign(new Error("x"), { cause: { code: 3 } }))).toBe(true);
    expect(isJsonRpcRevert(Object.assign(new Error("x"), { cause: { code: -32603 } }))).toBe(false);
  });

  it("hors fenêtre (fenêtre connue) : arrêt après la lecture bon marché, sans lecture complète", async () => {
    const { claim } = forgedClaim({ predicate: erc20Pred, txs: ["0x" + "00".repeat(96)] }, view);
    const chain = new FakeChain(view);
    chain.now = 1_000_000n + 3_600n;
    chain.accept(claim, [OP_A], 1_000_000n);
    let clock = Number(1_000_000n + 3_600n) * 1000;
    const B = refuterOf(chain, noFork, { nowMs: () => clock });
    // première demande : lecture complète (la fenêtre devient connue), indéchiffrable
    expect(await B.service.refute({ claim, operators: [OP_A], enc: new Uint8Array(32), ciphertext: new Uint8Array(16) })).toMatchObject({ code: "undecryptable" });
    expect(chain.reads).toEqual({ record: 1, full: 1 });
    clock += Number(WINDOW + 3_600n) * 1000;
    expect(await B.service.refute({ claim, operators: [OP_A], enc: new Uint8Array(32), ciphertext: new Uint8Array(16) })).toMatchObject({ code: "window_over" });
    expect(chain.reads).toEqual({ record: 2, full: 1 });
  });

  it("rejeu en échec (preuve T4b) : 10 demandes → UN rejeu ; les suivantes 503 « échec récent » ; après le délai, un nouveau rejeu", async () => {
    const txs = ["0x" + "00".repeat(96)] as Hex[];
    const b: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: erc20Pred, txs, r: R, cP: "0x" };
    const cP = await new DeterministicProtocolCipher().recompute(b, protocol.x25519PublicKey);
    const claim: Claim = { bountyId: 1n, payee: getAddress(HUNTER), blockN: 10n, blockHashN: zeroHash, predicateHash: view.predicateHash, loss: 5_000_000n, tier: 0, fingerprint: exploitFingerprint(b), cPHash: keccak256(cP), deadline: 99n };
    const chain = new FakeChain(view);
    chain.accept(claim, [OP_A]);
    let runs = 0;
    let clock = 0;
    const B = refuterOf(chain, { run: async () => { runs++; throw new ReplayUnavailableError("timeout", "rejeu trop long : rien n'est signé"); } }, { nowMs: () => clock });
    const ask = async () => B.service.refute(await refuteRequest(B.kit, claim, [OP_A], { from: "hunter", bountyId: "1", payee: HUNTER, capital: "0", predicate: erc20Pred, txs, r: R }));
    await expect(ask()).rejects.toMatchObject({ reason: "timeout" });
    for (let i = 0; i < 9; i++) await expect(ask()).rejects.toMatchObject({ reason: "recent_failure" });
    expect(runs).toBe(1);
    expect(chain.reads.full).toBe(1); // les demandes rejetées ne relisent même pas la chaîne
    clock += 60_001;
    await expect(ask()).rejects.toMatchObject({ reason: "timeout" });
    expect(runs).toBe(2);
  });

  it("concurrence bornée : au-delà de maxInFlight réfutations en cours, refus immédiat (503 « occupée »)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const chain = new FakeChain(view);
    const B = refuterOf(chain, { run: async () => { await gate; return { ctx: okCtx() }; } }, { maxInFlight: 2 });
    const pending: Promise<RefuteResult>[] = [];
    for (let i = 0; i < 3; i++) {
      const { claim, cP } = forgedClaim({ predicate: erc20Pred, txs: ["0x" + "00".repeat(96)], capital: BigInt(i) }, view);
      chain.accept(claim, [OP_A]);
      const q = await refuteRequest(B.kit, claim, [OP_A], { from: "protocol", cP, protocolPrivateKey: toHex(protocol.x25519PrivateKey) });
      pending.push(B.service.refute(q));
    }
    await expect(pending[2]).rejects.toMatchObject({ reason: "refute_busy" });
    release();
    for (const p of pending.slice(0, 2)) expect((await p).status).toBe("confirmed"); // les deux premières aboutissent
  });

  it("débit : au-delà du seau à jetons → 429 (lecture bon marché seule, aucune lecture complète) ; le seau se remplit avec le temps ; corps trop gros → 413", async () => {
    // v2.1 ter : le jeton n'est pris qu'APRÈS claimRecords, pour une réclamation VIVANTE (acceptée, non réfutée, dans la fenêtre)
    const counter = { n: 0 };
    const state = { acceptedAt: BigInt(Math.floor(Date.now() / 1000)), refuted: false };
    const kit = newKit();
    const refuter = new RefutationService(kit, { sealedBounty: SEALED }, chainRefuteReader(new RpcQuorum([provider(state, counter)]), SEALED, REGISTRY), new DeterministicProtocolCipher(), noFork);
    let clock = 0;
    const app = createSealedBountyApp({ kit, service: undefined as any, refuter, attest, refuteRateLimit: { burst: 2, perMinute: 2 }, nowMs: () => clock });
    const post = (b: unknown) => app.request("/v1/refute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    expect((await post(inventedBody)).status).toBe(200); // lecture complète : opérateurs faux (bad_ops)
    expect((await post(inventedBody)).status).toBe(200);
    const n = counter.n;
    const limited = await post(inventedBody);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(counter.n).toBe(n + 2); // tête + claimRecords, rien d'autre
    clock += 30_000;
    expect((await post(inventedBody)).status).toBe(200);
    const big = await app.request("/v1/refute", { method: "POST", headers: { "content-type": "application/json", "content-length": String(5 * 1024 * 1024) }, body: "x".repeat(5 * 1024 * 1024) });
    expect(big.status).toBe(413);
  });
});

// =====================================================================================================================
// 4. fuites : messages fixes
// =====================================================================================================================

describe("4 — fuites : notes de rejeu et réponses HTTP à message fixe", () => {
  const view: BountyView = { predicateHash: predicateHash(erc20Pred), protocolX25519: protocol.x25519PublicKey, tierMinLoss: [1_000_000n], deadline: 9_000_000n };

  it("preuve T5 : cP forgé dont une transaction n'est pas abi.encode → note FIXE, sans un octet de la transaction", async () => {
    const SECRET_TX = "0xa9059cbb000000000000000000000000c0ffee000000000000000000" as Hex;
    const b = { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: erc20Pred, txs: [SECRET_TX] };
    const cP = deterministicSeal(toBytes(protocol.x25519PublicKey), utf8(canonicalProtocolPlaintext(b)), toBytes(R));
    const claim: Claim = { bountyId: 1n, payee: getAddress(HUNTER), blockN: 10n, blockHashN: zeroHash, predicateHash: view.predicateHash, loss: 5_000_000n, tier: 0, fingerprint: exploitFingerprint(b), cPHash: keccak256(cP), deadline: 99n };
    const chain = new FakeChain(view);
    chain.accept(claim, [OP_A]);
    const realRules = new AnvilForkRunner({ forkUrl: "http://127.0.0.1:1", anvilBin: "/nonexistent", engine: "arc", log: () => {} });
    const B = refuterOf(chain, realRules);
    const app = createSealedBountyApp({ kit: B.kit, service: undefined as any, refuter: B.service, attest, refuteRateLimit: false });
    const q = await refuteRequest(B.kit, claim, [OP_A], { from: "protocol", cP, protocolPrivateKey: toHex(protocol.x25519PrivateKey) });
    const res = await app.request("/v1/refute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(httpBody(claim, [OP_A], q)) });
    const text = await res.text();
    const j = JSON.parse(text);
    expect(j.status).toBe("refuted");
    expect(j.replay.note).toBe(`${FAULT.replayRules} (transaction qui n'est pas abi.encode(address to, uint256 value, bytes data))`);
    expect(text.toLowerCase()).not.toContain("c0ffee");
    expect(text).not.toMatch(/viem|Data size/);
  });

  it("/bounty/submit : bundle illisible → raison fixe (ni extrait du JSON, ni valeur refusée par BigInt)", async () => {
    const kit = newKit();
    const svc = new BountyService(kit, { sealedBounty: SEALED }, { getBounty: async () => view }, new DeterministicProtocolCipher(), { run: async () => ({ ctx: okCtx() }) }, { current: async () => 2_000n, blockHash: async () => zeroHash }, () => 1_000n);
    const app = createSealedBountyApp({ kit, service: svc, attest });
    for (const plain of ['{"secret":"0xdeadbeefcafe", oops}', JSON.stringify({ bountyId: "0xzz-SECRET", payee: HUNTER, capital: "0", predicate: erc20Pred, txs: [], r: R, cP: "0x" })]) {
      const cE = await seal(toBytes(kit.keys.x25519PublicKey), utf8(plain));
      const res = await app.request("/bounty/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enc: toHex(cE.enc), ciphertext: toHex(cE.ciphertext) }) });
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(JSON.parse(text).reason).toMatch(/^bundle illisible : (JSON attendu|bountyId : entier attendu)$/);
      expect(text).not.toMatch(/deadbeef|SECRET|position/);
    }
    // bénéficiaire qui n'est pas une adresse (ou objet imbriqué) : refus déterministe, sans le recopier
    for (const payee of ['"0xSECRET"', `{"a":${deepJson(50_000)}}`]) {
      const text = `{"bountyId":"1","payee":${payee},"capital":"0","predicate":${JSON.stringify(erc20Pred)},"txs":[],"r":"${R}","cP":"0x"}`;
      const cE = await seal(toBytes(kit.keys.x25519PublicKey), utf8(text));
      expect(await svc.submit(cE)).toEqual({ status: "not_proven", reason: "bundle illisible : payee : adresse attendue (EIP-55 si casse mixte)" });
    }
  });

  it("503 : jamais le message de l'exception (lecture on-chain en échec, rejeu en échec)", async () => {
    const kit = newKit();
    const refuter = new RefutationService(kit, { sealedBounty: SEALED }, { read: async () => { throw new Error("SECRET-RPC 0xc0ffee"); } }, new DeterministicProtocolCipher(), { run: async () => ({ ctx: okCtx() }) });
    const svc = new BountyService(kit, { sealedBounty: SEALED }, { getBounty: async () => view }, new DeterministicProtocolCipher(),
      { run: async () => { throw new Error("eth_sendTransaction 0xa9059cbb000000000000c0ffee"); } }, { current: async () => 2_000n, blockHash: async () => zeroHash }, () => 1_000n);
    const app = createSealedBountyApp({ kit, service: svc, refuter, attest, refuteRateLimit: false });
    const { claim } = forgedClaim({ predicate: erc20Pred, txs: ["0x" + "00".repeat(96)] }, view);
    const r1 = await app.request("/v1/refute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(httpBody(claim, [OP_A], { enc: new Uint8Array(32), ciphertext: new Uint8Array(16) })) });
    expect(r1.status).toBe(503);
    expect(await r1.json()).toEqual({ error: UNAVAILABLE.refute });
    const b: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: erc20Pred, txs: ["0x" + "00".repeat(96)] as Hex[], r: R, cP: "0x" };
    const cP = await new DeterministicProtocolCipher().recompute(b, protocol.x25519PublicKey);
    const cE = await seal(toBytes(kit.keys.x25519PublicKey), utf8(JSON.stringify({ bountyId: "1", payee: HUNTER, capital: "0", predicate: erc20Pred, txs: b.txs, r: R, cP, blockN: "1990" })));
    const r2 = await app.request("/bounty/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enc: toHex(cE.enc), ciphertext: toHex(cE.ciphertext) }) });
    expect(r2.status).toBe(503);
    expect(await r2.json()).toEqual({ error: UNAVAILABLE.submit });
  });
});

// =====================================================================================================================
// 6. époque des règles
// =====================================================================================================================

describe("6 — époque des règles (REFUTE_ACCEPTED_FROM) : une réclamation acceptée avant n'est pas jugée", () => {
  it("acceptée avant l'époque → refus « rules_epoch » dès la lecture bon marché, rien n'est déchiffré ni rejoué ; après → jugée", async () => {
    const view: BountyView = { predicateHash: predicateHash(erc20Pred), protocolX25519: protocol.x25519PublicKey, tierMinLoss: [1_000_000n], deadline: 9_000_000n };
    const old = forgedClaim({ predicate: erc20Pred, txs: ["0x" + "00".repeat(96)] }, view);
    const recent = forgedClaim({ predicate: erc20Pred, txs: ["0x" + "00".repeat(96)], capital: 1n }, view);
    const chain = new FakeChain(view);
    chain.accept(old.claim, [OP_A], chain.now - 7_200n);
    chain.accept(recent.claim, [OP_A], chain.now - 600n);
    let runs = 0;
    const B = refuterOf(chain, { run: async () => { runs++; return { ctx: okCtx(0n) }; } }, { acceptedFrom: chain.now - 3_600n });
    const key = { from: "protocol", protocolPrivateKey: toHex(protocol.x25519PrivateKey) };
    const r1 = await B.service.refute(await refuteRequest(B.kit, old.claim, [OP_A], { ...key, cP: old.cP }));
    expect(r1).toMatchObject({ status: "refused", code: "rules_epoch" });
    expect(chain.reads).toEqual({ record: 1, full: 0 });
    expect(runs).toBe(0);
    const r2 = await B.service.refute(await refuteRequest(B.kit, recent.claim, [OP_A], { ...key, cP: recent.cP }));
    expect(r2.status).toBe("refuted"); // perte 0 au contre-rejeu : « non prouvée »
    expect(runs).toBe(1);
  });
});
