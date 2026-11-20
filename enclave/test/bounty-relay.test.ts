/**
 * Prime scellée v2.1 ter — RELAIS STRICT entre le moteur de rejeu et le RPC du fork (src/services/rpc-relay.ts).
 * Vérification adverse du 9/11 (cas e1-blockhash-null, matrices, e7-amplification) : le moteur
 * prenait des réponses INVALIDES du RPC du fork pour des valeurs (bloc rendu null → BLOCKHASH = keccak256(""), « 0x » pour
 * une case de stockage → 0) et l'enclave signait. Règle d'or : une enclave ne signe JAMAIS un résultat qui dépend d'une
 * panne ou d'une réponse invalide du RPC : 503, rien de signé.
 *  1. le relais seul, devant un RPC du fork scripté : formes, blocs ≤ N jamais null, chaîne ancrée, lectures au bloc N,
 *     méthodes permises, erreurs du RPC, budget, verrou ;
 *  2. moteur réel (anvil ; arc-anvil si ARC_ANVIL_BIN) : BLOCKHASH null (preuve e1, réclamation et réfutation), case de
 *     stockage mal formée, budget de lectures (preuve e7 : 503, jamais « non prouvée »), contrôle du démarrage ;
 *  3. replay() compare le hash du bloc N chargé par le moteur à l'ancre (faux moteur).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type Address, type Hex, getAddress, keccak256, numberToHex, pad, toBytes, toHex, zeroAddress, zeroHash } from "viem";
import { EnclaveKit } from "../src/kit/enclave-kit";
import { seal } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import { predicateHash, type Predicate } from "../src/services/predicate";
import { AnvilForkRunner, encodeExploitTx } from "../src/services/anvil-fork";
import { DEFAULT_MAX_FORK_REQUESTS, RelayViolation, blockHeaderHash, checkBlockShape, startStrictRelay } from "../src/services/rpc-relay";
import {
  BountyService, DeterministicProtocolCipher, RefutationService, ReplayUnavailableError, claimDigestOf, claimOperatorsHash, isMemorizableFailure,
  refuteRequestAad, type BountyView, type ExploitBundle, type RefuteChainView, type RefuteReader, type SubmitResult,
} from "../src/services/bounty";
import { UNAVAILABLE, createSealedBountyApp } from "../products/sealed-bounty/app";
import { type Claim } from "../src/kit/eip712";

const ANVIL = [process.env.ANVIL_BIN, join(homedir(), ".foundry", "bin", "anvil")].find(
  (p): p is string => !!p && existsSync(p) && spawnSync(p, ["--version"]).status === 0,
);
/** arc-anvil (Arc Foundry), facultatif : ARC_ANVIL_BIN=/chemin/vers/arc-anvil. */
const ARC_ANVIL = [process.env.ARC_ANVIL_BIN].find((p): p is string => !!p && existsSync(p) && spawnSync(p, ["--version"]).status === 0);

const CHAIN = 5042002;
const SEALED = "0x00000000000000000000000000000000000000bb" as Address;
const PRODUCT = 2n;
const HUNTER = "0x000000000000000000000000000000000000c0de" as Address;
const OP_A = getAddress("0x000000000000000000000000000000000000a001");
const OP_B = getAddress("0x000000000000000000000000000000000000b002");
const R = ("0x" + "5a".repeat(32)) as Hex;
const utf8 = (s: string) => new TextEncoder().encode(s);
const protocol = generateEnclaveKeys();
const newKit = () => new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: "0x0000000000000000000000000000000000000001", mockBlockHash: true });
const attest = { operatorAllowlist: null, registeredOperator: async () => null, warn: () => {} };

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
/** Requête JSON-RPC brute (le relais rend toujours une enveloppe JSON-RPC, erreur comprise). */
async function raw(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

// =====================================================================================================================
// 1. le relais seul, devant un RPC du fork scripté
// =====================================================================================================================

const h32 = (s: string) => keccak256(toBytes(s));
const N = 100n;
/** Un bloc bien formé (les 21 champs d'en-tête d'Arc, relevé du 9/11). v2.1 quater : le relais LIE l'en-tête à son hash :
 *  `hash` = keccak256(RLP(en-tête)) (blockHeaderHash), recalculé APRÈS `o` (un bloc « d'une autre chaîne » ou au numéro faux
 *  garde un hash cohérent avec son contenu) ; si `o` rend l'en-tête incalculable (champ retiré), un hash quelconque. */
function blockOf(n: bigint, parentHash: Hex, o: Record<string, unknown> = {}) {
  const b: Record<string, unknown> = {
    number: numberToHex(n), parentHash, timestamp: numberToHex(1_700_000_000n + n), gasLimit: "0x1c9c380", gasUsed: "0x0",
    miner: "0xc77d31f2e5ee695181f14a8d4b0c78ff3b1ff7f0", stateRoot: h32("state"), transactionsRoot: h32("txs"), receiptsRoot: h32("rcpts"),
    logsBloom: "0x" + "00".repeat(256), extraData: "0x00000004a817c800", baseFeePerGas: "0x4a817c800", difficulty: "0x0",
    mixHash: zeroHash, nonce: "0x0000000000000000", sha3Uncles: h32("uncles"), size: "0x4ad", uncles: [], withdrawals: [],
    withdrawalsRoot: h32("w"), blobGasUsed: "0x0", excessBlobGas: "0x0", parentBeaconBlockRoot: parentHash, requestsHash: h32("requests"),
    transactions: [], ...o,
  };
  let hash: Hex;
  try {
    hash = blockHeaderHash(b);
  } catch {
    hash = h32(`bloc ${n} incomplet`);
  }
  return { ...b, hash };
}
/** Une petite chaîne cohérente : hash(n) = keccak256(RLP(en-tête n)), parentHash(n) = hash(n − 1). */
const chain: Hex[] = [];
const hashOf = (n: bigint): Hex => {
  if (n < 0n) return zeroHash;
  for (let i = chain.length; i <= Number(n); i++) chain.push(blockOf(BigInt(i), i === 0 ? zeroHash : chain[i - 1]!).hash);
  return chain[Number(n)]!;
};
const goodBlock = (n: bigint, o: Record<string, unknown> = {}) => blockOf(n, hashOf(n - 1n), o);

type Answer = { result: unknown } | { error: { code: number; message: string } } | { http: number } | { body: string } | { wrongId: true };

/** Un RPC du fork scripté : `answer(method, params)` ; compte et journalise ses requêtes. */
async function scriptedUpstream(answer: (method: string, params: any[]) => Answer) {
  const calls: Array<{ method: string; params: any[] }> = [];
  const server: Server = createHttpServer((rq, rs) => {
    let body = "";
    rq.on("data", (d) => (body += d));
    rq.on("end", () => {
      const q = JSON.parse(body);
      calls.push({ method: q.method, params: q.params });
      const a = answer(q.method, q.params ?? []);
      if ("http" in a) {
        rs.writeHead(a.http, { "content-type": "text/html" });
        rs.end("<html>bad gateway</html>");
        return;
      }
      rs.writeHead(200, { "content-type": "application/json" });
      if ("body" in a) rs.end(a.body);
      else if ("wrongId" in a) rs.end(JSON.stringify({ jsonrpc: "2.0", id: q.id + 1000, result: "0x1" }));
      else rs.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, ...a }));
    });
  });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

/** Le RPC sain de la petite chaîne : blocs ≤ N, état quelconque bien formé. */
const healthy = (method: string, params: any[]): Answer => {
  switch (method) {
    case "eth_chainId": return { result: "0x4cef52" };
    case "eth_gasPrice": return { result: "0x5d21dba00" };
    case "eth_blockNumber": return { result: numberToHex(N + 2n) };
    case "eth_getBlockByNumber": {
      const n = BigInt(params[0]);
      return { result: n > N + 2n ? null : goodBlock(n) };
    }
    case "eth_getStorageAt": return { result: pad("0x07", { size: 32 }) };
    case "eth_getBalance": return { result: "0x75bcd15" };
    case "eth_getTransactionCount": return { result: "0x0" };
    case "eth_getCode": return { result: "0x6001" };
    case "eth_getAccountInfo": return { result: { balance: "0x75bcd15", nonce: "0x1", code: "0x" } };
    case "eth_getTransactionReceipt": return { result: null };
    default: return { error: { code: -32601, message: "method not found" } };
  }
};

describe("1 — relais strict : chaque réponse du RPC du fork est contrôlée avant d'être rendue au moteur", () => {
  const A = "0x0000000000000000000000000000000000007777";
  const atN = numberToHex(N);

  it("formes : stockage = 32 octets, quantités canoniques, code pair, compte { balance, nonce, code }, reçu null ; sinon erreur + violation", async () => {
    const cases: Array<[string, unknown[], unknown, "ok" | string]> = [
      ["eth_getStorageAt", [A, "0x1", atN], pad("0x07", { size: 32 }), "ok"],
      ["eth_getStorageAt", [A, "0x1", atN], "0x", "shape"], // la matrice : 0 en silence
      ["eth_getStorageAt", [A, "0x1", atN], 5, "shape"], // la matrice : 5 en silence
      ["eth_getStorageAt", [A, "0x1", atN], "0x" + "00".repeat(31), "shape"],
      ["eth_getStorageAt", [A, "0x1", atN], null, "shape"],
      ["eth_getBalance", [A, atN], "0x75bcd15", "ok"],
      ["eth_getBalance", [A, atN], "0x075bcd15", "shape"], // zéro de tête : pas canonique
      ["eth_getBalance", [A, atN], 123456789, "shape"],
      ["eth_getBalance", [A, atN], "0x", "shape"],
      ["eth_getTransactionCount", [A, atN], "0x0", "ok"],
      ["eth_getTransactionCount", [A, atN], "0x00", "shape"],
      ["eth_getCode", [A, atN], "0x", "ok"], // compte sans code : réponse VALIDE
      ["eth_getCode", [A, atN], "0x600", "shape"],
      ["eth_getAccountInfo", [A, atN], { balance: "0x1", nonce: "0x0", code: "0x" }, "ok"],
      ["eth_getAccountInfo", [A, atN], { balance: "0x1", nonce: "0x0" }, "shape"],
      ["eth_getAccountInfo", [A, atN], { balance: 5, nonce: "0x0", code: "0x" }, "shape"],
      ["eth_getAccountInfo", [A, atN], "0x", "shape"],
      ["eth_getAccountInfo", [A, atN], null, "shape"],
      ["eth_getTransactionReceipt", [h32("tx")], null, "ok"],
      ["eth_getTransactionReceipt", [h32("tx")], { status: "0x1" }, "shape"], // une transaction du fork, « connue » du RPC : faux
      ["eth_chainId", [], "0x4cef52", "ok"],
      ["eth_chainId", [], "0x04cef52", "shape"],
      ["eth_gasPrice", [], 5, "shape"],
      ["eth_blockNumber", [], numberToHex(N + 5n), "ok"],
      ["eth_blockNumber", [], numberToHex(N - 1n), "shape"], // tête avant N : le RPC ne peut pas servir le bloc N
    ];
    for (const [method, params, result, want] of cases) {
      const up = await scriptedUpstream(() => ({ result }));
      const relay = await startStrictRelay({ upstream: up.url, blockN: N });
      try {
        const out = await raw(relay.url, { jsonrpc: "2.0", id: 7, method, params });
        if (want === "ok") {
          expect(out, `${method} ${JSON.stringify(result)}`).toEqual({ jsonrpc: "2.0", id: 7, result });
          expect(relay.violation).toBeUndefined();
        } else {
          expect(out.error?.code, `${method} ${JSON.stringify(result)}`).toBe(-32603);
          expect(out).not.toHaveProperty("result");
          expect(relay.violation?.kind).toBe(want);
        }
      } finally {
        await relay.close();
        await up.close();
      }
    }
  });

  it("bloc ≤ N rendu null (réponse d'un nœud en retard) → erreur JSON-RPC au moteur, violation null_block MÉMORISÉE même si la suite est saine", async () => {
    let nullOnce = true;
    const up = await scriptedUpstream((m, p) => {
      if (m === "eth_getBlockByNumber" && BigInt(p[0]) === N - 1n && nullOnce) {
        nullOnce = false;
        return { result: null };
      }
      return healthy(m, p);
    });
    const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: hashOf(N) });
    try {
      const first = await raw(relay.url, { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [numberToHex(N - 1n), false] });
      expect(first.error).toMatchObject({ code: -32603 });
      expect(relay.violation).toBeInstanceOf(RelayViolation);
      expect(relay.violation?.kind).toBe("null_block");
      // le moteur réessaie : la réponse est saine cette fois, mais le verrou reste (le rejeu ne sera pas signé)
      const retry = await raw(relay.url, { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: [numberToHex(N - 1n), false] });
      expect(retry.result.hash).toBe(hashOf(N - 1n));
      expect(relay.violation?.kind).toBe("null_block");
    } finally {
      await relay.close();
      await up.close();
    }
  });

  it("chaîne : bloc N = ancre ; bloc n < N rattaché par les parentHash (lus au besoin) ; champ d'en-tête mal formé ou numéro faux → refusé", async () => {
    // RPC dont le bloc N − 3 est celui d'une autre chaîne (en-tête cohérent avec son hash, mais pas le parentHash de N − 2)
    const up = await scriptedUpstream((m, p) => {
      if (m === "eth_getBlockByNumber" && BigInt(p[0]) === N - 3n) return { result: goodBlock(N - 3n, { stateRoot: h32("autre chaîne") }) };
      return healthy(m, p);
    });
    const get = async (relay: Awaited<ReturnType<typeof startStrictRelay>>, n: bigint) =>
      raw(relay.url, { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [numberToHex(n), false] });
    try {
      const ok = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: hashOf(N) });
      expect((await get(ok, N - 2n)).result.hash).toBe(hashOf(N - 2n)); // rattaché par N, N − 1
      expect(ok.violation).toBeUndefined();
      expect((await get(ok, N - 3n)).error).toMatchObject({ code: -32603 });
      expect(ok.violation?.kind).toBe("chain");
      await ok.close();

      const wrongAnchor = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: h32("autre bloc N") });
      await expect(wrongAnchor.anchor()).rejects.toMatchObject({ kind: "chain" });
      expect((await get(wrongAnchor, N)).error).toBeDefined();
      await wrongAnchor.close();

      const beyond = await startStrictRelay({ upstream: up.url, blockN: N });
      const before = up.calls.length;
      expect((await get(beyond, N + 1n)).error).toBeDefined(); // au-delà de N : refusé sans rien transmettre
      expect(up.calls.length).toBe(before);
      expect(beyond.violation?.kind).toBe("params");
      await beyond.close();
    } finally {
      await up.close();
    }
    for (const [what, bad] of [
      ["sans parentHash", { parentHash: undefined }], ["mixHash de 31 octets", { mixHash: "0x" + "00".repeat(31) }],
      ["timestamp non canonique", { timestamp: "0x0065" }], ["numéro faux", { number: numberToHex(N - 7n) }],
      ["transactions qui ne sont pas des hashes", { transactions: ["0x1234"] }], ["logsBloom tronqué", { logsBloom: "0x00" }],
    ] as const) {
      const up2 = await scriptedUpstream((m, p) => (m === "eth_getBlockByNumber" ? { result: goodBlock(BigInt(p[0]), bad as any) } : healthy(m, p)));
      const relay = await startStrictRelay({ upstream: up2.url, blockN: N });
      try {
        expect((await get(relay, N)).error, what).toBeDefined();
        expect(relay.violation?.kind, what).toBe("shape");
      } finally {
        await relay.close();
        await up2.close();
      }
    }
    // transactions complètes : objets avec hash
    expect(checkBlockShape("m", goodBlock(N, { transactions: [{ hash: h32("t"), from: HUNTER }] }), true).number).toBe(N);
    expect(() => checkBlockShape("m", goodBlock(N, { transactions: [h32("t")] }), true)).toThrow(RelayViolation);
    expect(() => checkBlockShape("m", null, false)).toThrow(expect.objectContaining({ kind: "null_block" }));
  });

  it("état lu AU BLOC N seulement ; méthode non prévue : refusée SANS rien transmettre au RPC du fork", async () => {
    const up = await scriptedUpstream(healthy);
    const relay = await startStrictRelay({ upstream: up.url, blockN: N });
    try {
      for (const [method, params] of [
        ["eth_getStorageAt", [A, "0x1", "latest"]], ["eth_getStorageAt", [A, "0x1", numberToHex(N - 1n)]],
        ["eth_getBalance", [A, { blockHash: hashOf(N) }]], ["eth_getCode", [A]], ["eth_getStorageAt", [A, "0x" + "1".repeat(65), numberToHex(N)]],
        ["eth_call", [{ to: A, data: "0x" }, numberToHex(N)]], ["eth_sendRawTransaction", ["0x02"]], ["debug_traceTransaction", [h32("x")]],
        ["eth_getBlockByNumber", ["latest", false]],
      ] as const) {
        const out = await raw(relay.url, { jsonrpc: "2.0", id: 3, method, params });
        expect(out.error, method).toBeDefined();
      }
      expect(up.calls).toEqual([]);
      expect(new Set(relay.violations.map((v) => v.kind))).toEqual(new Set(["params", "method"]));
    } finally {
      await relay.close();
      await up.close();
    }
  });

  it("échecs PASSAGERS du RPC du fork rendus tels quels au moteur, sans verrou (erreur JSON-RPC, même statut HTTP, 502) ; enveloppe invalide → violation mémorisée", async () => {
    for (const [what, ans, want] of [
      ["erreur JSON-RPC (relayée telle quelle)", { error: { code: -32005, message: "rate limited, retry later" } }, { rpc: { code: -32005, message: "rate limited, retry later" } }],
      ["HTTP 429 (même statut)", { http: 429 }, { http: 429 }],
      ["HTTP 503 (même statut)", { http: 503 }, { http: 503 }],
      ["JSON tronqué (502)", { body: '{"jsonrpc":"2.0","id":1,"res' }, { http: 502 }],
      ["mauvais id", { wrongId: true }, { violation: "envelope" }],
      ["result ET error", { body: '{"jsonrpc":"2.0","id":1,"result":"0x1","error":{"code":1,"message":"x"}}' }, { violation: "envelope" }],
    ] as const) {
      const up = await scriptedUpstream(() => ans as Answer);
      const relay = await startStrictRelay({ upstream: up.url, blockN: N });
      try {
        const res = await fetch(relay.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [A, numberToHex(N)] }) });
        if ("http" in want) {
          expect(res.status, what).toBe(want.http);
          expect(relay.violation, what).toBeUndefined();
          expect(relay.upstreamFailures, what).toBe(1);
        } else {
          expect(res.status, what).toBe(200);
          const out = (await res.json()) as any;
          if ("rpc" in want) {
            expect(out.error, what).toEqual(want.rpc);
            expect(relay.violation, what).toBeUndefined();
          } else {
            expect(out.error, what).toMatchObject({ code: -32603 });
            expect(relay.violation?.kind, what).toBe(want.violation);
          }
        }
      } finally {
        await relay.close();
        await up.close();
      }
    }
  });

  it("budget : au-delà de maxRequests, plus RIEN n'est transmis (violation « budget ») ; failFast : après une violation, plus rien non plus", async () => {
    const up = await scriptedUpstream(healthy);
    const relay = await startStrictRelay({ upstream: up.url, blockN: N, maxRequests: 5 });
    try {
      const outs = [];
      for (let i = 0; i < 8; i++) outs.push(await raw(relay.url, { jsonrpc: "2.0", id: i, method: "eth_getBalance", params: [A, numberToHex(N)] }));
      expect(outs.filter((o) => o.result).length).toBe(5);
      expect(up.calls.length).toBe(5);
      expect(relay.requests).toBe(5);
      expect(relay.violation?.kind).toBe("budget");
    } finally {
      await relay.close();
      await up.close();
    }
    const up2 = await scriptedUpstream((m, p) => (m === "eth_getCode" ? { result: "0x0" } : healthy(m, p)));
    const ff = await startStrictRelay({ upstream: up2.url, blockN: N, failFast: true });
    try {
      expect((await raw(ff.url, { jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [A, numberToHex(N)] })).error).toBeDefined();
      const n = up2.calls.length;
      expect((await raw(ff.url, { jsonrpc: "2.0", id: 2, method: "eth_getBalance", params: [A, numberToHex(N)] })).error).toBeDefined();
      expect(up2.calls.length).toBe(n);
      // lot JSON-RPC : chaque élément a sa réponse
      const batch = await raw(ff.url, [{ jsonrpc: "2.0", id: 3, method: "eth_chainId", params: [] }, { jsonrpc: "2.0", id: 4, method: "eth_gasPrice", params: [] }]);
      expect(batch.map((x: any) => x.id)).toEqual([3, 4]);
    } finally {
      await ff.close();
      await up2.close();
    }
    expect(DEFAULT_MAX_FORK_REQUESTS).toBeGreaterThanOrEqual(1_000);
  });
});

// =====================================================================================================================
// 2. moteur réel : les preuves e1 (BLOCKHASH null), matrices (stockage mal formé), e7 (budget)
// =====================================================================================================================

/** COIN_PLAY : vide sa caisse vers l'appelant si blockhash(numéro − 2) == SLOAD(0). */
const COIN_PLAY_CODE = "0x600243034060005414600d57005b600060006000600047335af100" as Hex;
/** COIN_NOT : vide sa caisse si blockhash(numéro − 2) != SLOAD(0). */
const COIN_NOT_CODE = "0x60024303406000541415600e57005b600060006000600047335af100" as Hex;
/** USDC minimal d'une chaîne de base locale (0x3600…) : balanceOf(a) = solde natif / 1e12, comme sur Arc. */
const FAKE_USDC_CODE = "0x64e8d4a51000600435310460005260206000f3" as Hex;
/** T : sans données → slot0 = 42 ; vue → slot0 == 42 ? slot1 : 0 (base : slot1 = 7). */
const T_CODE = "0x3615602457600054602a14601857600060005260206000f35b60015460005260206000f35b602a60005500" as Hex;
/** SPRAY : lit 6 000 cases froides (0x1000…) : chacune est une requête au RPC du fork (preuve e7). */
const SPRAY_CODE = ("0x6117706000" + "5b8181101560" + "1a5780611000" + "0154506001016005565b00") as Hex;

const USDC = "0x3600000000000000000000000000000000000000" as Address;
const COIN_PLAY = "0x000000000000000000000000000000000000c014" as Address;
const COIN_NOT = "0x000000000000000000000000000000000000c015" as Address;
const T = "0x0000000000000000000000000000000000007777" as Address;
const SPRAY = "0x0000000000000000000000000000000000005a5a" as Address;
const KECCAK_EMPTY = keccak256("0x");

type Forged = { result: unknown } | { error: { code: number; message: string } } | { http: number };
/** Mandataire devant la chaîne de base : `fault(q)` rend une réponse forgée, une erreur JSON-RPC ou un statut HTTP (au plus
 *  `times` fois). */
async function forgingProxy(target: string, fault: (q: any) => Forged | undefined, times = 1) {
  let hits = 0;
  const one = async (q: any): Promise<unknown> => {
    const f = hits < times ? fault(q) : undefined;
    if (f) {
      hits++;
      if ("http" in f) return f;
      return { jsonrpc: "2.0", id: q.id, ...f };
    }
    return (await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q) })).json();
  };
  const server: Server = createHttpServer((rq, rs) => {
    let body = "";
    rq.on("data", (d) => (body += d));
    rq.on("end", async () => {
      const j = JSON.parse(body);
      const out = Array.isArray(j) ? await Promise.all(j.map(one)) : await one(j);
      if (!Array.isArray(out) && out && typeof out === "object" && "http" in out) {
        rs.writeHead((out as { http: number }).http, { "content-type": "text/html" });
        rs.end("<html>trop de requêtes</html>");
        return;
      }
      rs.writeHead(200, { "content-type": "application/json" });
      rs.end(JSON.stringify(out));
    });
  });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${port}`, hits: () => hits, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

class FakeChain implements RefuteReader {
  records = new Map<string, { acceptedAt: bigint; refuted: boolean; opsHash: Hex }>();
  active = new Map<string, Address>();
  now = BigInt(Math.floor(Date.now() / 1000));
  constructor(public view: BountyView) {}
  accept(claim: Claim, ops: Address[]): Hex {
    const d = claimDigestOf(SEALED, claim, CHAIN);
    this.records.set(d.toLowerCase(), { acceptedAt: this.now - 60n, refuted: false, opsHash: claimOperatorsHash(ops) });
    return d;
  }
  async record(q: { claimDigest: Hex }) {
    return { block: 5_000n, record: this.records.get(q.claimDigest.toLowerCase()) ?? { acceptedAt: 0n, refuted: false, opsHash: zeroHash } };
  }
  async read(q: { claimDigest: Hex; signer: Address }): Promise<RefuteChainView> {
    return {
      block: 5_000n, blockTimestamp: this.now, refuteWindow: 259_200n, bounty: { ...this.view, productId: PRODUCT },
      record: this.records.get(q.claimDigest.toLowerCase()) ?? { acceptedAt: 0n, refuted: false, opsHash: zeroHash },
      myOperator: this.active.get(q.signer.toLowerCase()) ?? zeroAddress,
    };
  }
}

const engines: Array<[string, string | undefined, "anvil" | "arc"]> = [["anvil", ANVIL, "anvil"], ["arc-anvil", ARC_ANVIL, "arc"]];

for (const [ename, bin, engine] of engines) {
  describe.skipIf(!ANVIL || !bin)(`2 — moteur réel « ${ename} » derrière le relais strict (chaîne de base locale)`, () => {
    let base: ChildProcess | undefined;
    let url = "";
    let Nb = 0n;
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
      await rpc(url, "anvil_setCode", [USDC, FAKE_USDC_CODE]);
      for (const [a, code] of [[COIN_PLAY, COIN_PLAY_CODE], [COIN_NOT, COIN_NOT_CODE]] as const) {
        await rpc(url, "anvil_setCode", [a, code]);
        await rpc(url, "anvil_setStorageAt", [a, pad("0x00", { size: 32 }), KECCAK_EMPTY]);
        await rpc(url, "anvil_setBalance", [a, numberToHex(5n * 10n ** 18n)]);
      }
      await rpc(url, "anvil_setCode", [T, T_CODE]);
      await rpc(url, "anvil_setStorageAt", [T, pad("0x01", { size: 32 }), pad("0x07", { size: 32 })]);
      await rpc(url, "anvil_setCode", [SPRAY, SPRAY_CODE]);
      for (let i = 0; i < 5; i++) await rpc(url, "evm_mine");
      Nb = BigInt(await rpc(url, "eth_blockNumber"));
      for (let i = 0; i < 3; i++) await rpc(url, "evm_mine");
    }, 60_000);
    afterAll(() => base?.kill("SIGKILL"));

    const runner = (u: string, o: { maxForkRequests?: number } = {}) =>
      new AnvilForkRunner({ forkUrl: u, anvilBin: bin, engine, log: () => {}, timeoutMs: 90_000, ...o });
    const blockHash = async (n: bigint) => (await rpc(url, "eth_getBlockByNumber", [numberToHex(n), false])).hash as Hex;
    const nullAt = (n: () => bigint) => (q: any) => (q.method === "eth_getBlockByNumber" && BigInt(q.params?.[0]) === n() ? { result: null } : undefined);

    async function claimWith(p: Predicate, target: Address, data: Hex, forkUrl: string, o: { maxForkRequests?: number } = {}) {
      const view: BountyView = { predicateHash: predicateHash(p), protocolX25519: protocol.x25519PublicKey, tierMinLoss: [1n], deadline: 9_999_999_999n };
      const kit = newKit();
      const svc = new BountyService(kit, { sealedBounty: SEALED }, { getBounty: async () => view }, new DeterministicProtocolCipher(), runner(forkUrl, o),
        { current: async () => BigInt(await rpc(url, "eth_blockNumber")), blockHash }, () => BigInt(Math.floor(Date.now() / 1000)));
      const txs = [encodeExploitTx({ to: target, data })];
      const b: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: p, txs, r: R, cP: "0x" };
      const cP = await new DeterministicProtocolCipher().recompute(b, protocol.x25519PublicKey);
      const cE = await seal(toBytes(kit.keys.x25519PublicKey), utf8(JSON.stringify({ bountyId: "1", payee: HUNTER, capital: "0", predicate: p, txs, r: R, cP, blockN: Nb.toString() })));
      return { svc, kit, cE, txs, view };
    }

    it("preuve e1-A : un RPC qui rend null UNE fois le bloc N − 1 → AUCUNE réclamation signée (503) ; témoin sain : « non prouvée »", async () => {
      const p: Predicate = { combine: "OR", clauses: [{ type: "NATIVE_DROP", holder: COIN_PLAY, min: "1" }] };
      const ok = await claimWith(p, COIN_PLAY, "0x", url);
      expect(await ok.svc.submit(ok.cE)).toMatchObject({ status: "not_proven", reason: "predicate not satisfied" });
      const proxy = await forgingProxy(url, nullAt(() => Nb - 1n));
      try {
        const bad = await claimWith(p, COIN_PLAY, "0x", proxy.url);
        const app = createSealedBountyApp({ kit: bad.kit, service: bad.svc, attest });
        const res = await app.request("/bounty/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enc: toHex(bad.cE.enc), ciphertext: toHex(bad.cE.ciphertext) }) });
        expect(proxy.hits()).toBe(1);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: UNAVAILABLE.submit });
      } finally {
        await proxy.close();
      }
    }, 240_000);

    it("preuve e1-B : réclamation VRAIE ; le réfutant dont le RPC rend null une fois → 503, AUCUNE réfutation signée ; RPC sain → « confirmée »", async () => {
      const p: Predicate = { combine: "OR", clauses: [{ type: "NATIVE_DROP", holder: COIN_NOT, min: "1" }] };
      const c = await claimWith(p, COIN_NOT, "0x", url);
      const sub = (await c.svc.submit(c.cE)) as Extract<SubmitResult, { status: "proven" }>;
      expect(sub.status).toBe("proven");
      const chain = new FakeChain(c.view);
      chain.accept(sub.claim, [OP_A]);
      const ask = async (forkUrl: string) => {
        const kitB = newKit();
        chain.active.set(kitB.keys.signer.toLowerCase(), OP_B);
        const B = new RefutationService(kitB, { sealedBounty: SEALED }, chain, new DeterministicProtocolCipher(), runner(forkUrl));
        const s = await seal(toBytes(kitB.keys.x25519PublicKey), utf8(JSON.stringify({ from: "hunter", bountyId: "1", payee: HUNTER, capital: "0", predicate: p, txs: c.txs, r: R })), refuteRequestAad(claimDigestOf(SEALED, sub.claim, CHAIN)));
        return B.refute({ claim: sub.claim, operators: [OP_A], enc: s.enc, ciphertext: s.ciphertext });
      };
      const proxy = await forgingProxy(url, nullAt(() => Nb - 1n));
      try {
        await expect(ask(proxy.url)).rejects.toMatchObject({ reason: "relay" });
        expect(proxy.hits()).toBe(1);
      } finally {
        await proxy.close();
      }
      expect((await ask(url)).status).toBe("confirmed");
    }, 240_000);

    it("échec PASSAGER (limite de débit -32005, HTTP 429, HTTP 503) : rendu tel quel au moteur, qui réessaie → même réclamation qu'avec un RPC sain (pas de 503)", async () => {
      const p: Predicate = { combine: "OR", clauses: [{ type: "NATIVE_DROP", holder: COIN_NOT, min: "1" }] };
      const ref = await claimWith(p, COIN_NOT, "0x", url);
      const want = (await ref.svc.submit(ref.cE)) as Extract<SubmitResult, { status: "proven" }>;
      expect(want.status).toBe("proven");
      const magicRead = (q: any) => q.method === "eth_getStorageAt" && String(q.params?.[0]).toLowerCase() === COIN_NOT.toLowerCase() && BigInt(q.params?.[1]) === 0n;
      for (const f of [{ error: { code: -32005, message: "rate limited, retry later" } }, { http: 429 }, { http: 503 }] as Forged[]) {
        const proxy = await forgingProxy(url, (q) => (magicRead(q) ? f : undefined));
        try {
          const c = await claimWith(p, COIN_NOT, "0x", proxy.url);
          const got = await c.svc.submit(c.cE);
          expect(proxy.hits(), JSON.stringify(f)).toBe(1);
          expect(got, JSON.stringify(f)).toMatchObject({ status: "proven", claim: { loss: want.claim.loss, tier: want.claim.tier, fingerprint: want.claim.fingerprint } });
        } finally {
          await proxy.close();
        }
      }
    }, 240_000);

    it("matrice : une case de stockage rendue « 0x » (au lieu de 32 octets) pour une lecture de vue → 503, jamais la valeur 0", async () => {
      // vue = slot1 de T (7 sur la chaîne) : « eq 0 » n'est vrai que si la case est lue 0 — ce qu'un « 0x » faisait en silence
      const p: Predicate = { combine: "OR", clauses: [{ type: "VIEW_CHANGED", target: T, call: "0x01", op: "eq", value: "0" }] };
      const healthyClaim = await claimWith(p, T, "0x", url);
      expect(await healthyClaim.svc.submit(healthyClaim.cE)).toMatchObject({ status: "not_proven" });
      const proxy = await forgingProxy(url, (q) => (q.method === "eth_getStorageAt" && String(q.params?.[0]).toLowerCase() === T.toLowerCase() && BigInt(q.params?.[1]) === 1n ? { result: "0x" } : undefined));
      try {
        const bad = await claimWith(p, T, "0x", proxy.url);
        await expect(bad.svc.submit(bad.cE)).rejects.toMatchObject({ reason: "relay" });
        expect(proxy.hits()).toBe(1);
      } finally {
        await proxy.close();
      }
    }, 240_000);

    it("preuve e7 : un exploit qui lit 6 000 cases froides dépasse le budget du rejeu → 503 « budget », jamais « non prouvée » ; sans budget serré : « non prouvée »", async () => {
      const p: Predicate = { combine: "OR", clauses: [{ type: "NATIVE_DROP", holder: COIN_PLAY, min: "1" }] };
      const tight = await claimWith(p, SPRAY, "0x01", url, { maxForkRequests: 300 });
      await expect(tight.svc.submit(tight.cE)).rejects.toMatchObject({ reason: "budget" });
      const again = await claimWith(p, SPRAY, "0x01", url, { maxForkRequests: 300 });
      const res = await createSealedBountyApp({ kit: again.kit, service: again.svc, attest }).request("/bounty/submit", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enc: toHex(again.cE.enc), ciphertext: toHex(again.cE.ciphertext) }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: UNAVAILABLE.submit });
      const wide = await claimWith(p, SPRAY, "0x01", url, { maxForkRequests: 20_000 });
      expect(await wide.svc.submit(wide.cE)).toMatchObject({ status: "not_proven", reason: "predicate not satisfied" });
    }, 240_000);

    it("contrôle du démarrage : réponses invalides refusées par le relais (bloc null, stockage mal formé), contrôle positif ; relais transparent → refus de démarrer", async () => {
      const r = runner(url);
      const st = await r.selfTest();
      expect(st.checks).toEqual([
        "direct read: error", "malformed storage: error (relay)", "null block: error (relay)",
        "positive check: BLOCKHASH and balance identical to the fork's RPC", "execution (eth_call): error", "transaction: never mined",
      ]);
      expect(st.revertCode).toBe(3);
      // sans les contrôles du relais, le moteur avale les deux réponses invalides : le contrôle le voit et refuse de démarrer
      const lax = await r.selfTest({ simulateLaxRelay: true }).catch((e) => e as Error);
      expect(lax).toBeInstanceOf(Error);
      expect((lax as Error).message).toMatch(/MAL FORMÉE/);
      expect((lax as Error).message).toMatch(/NULL/);
      expect((lax as Error).message).toMatch(/refusing to start/);
      await expect(r.selfTest({ simulateSwallow: true })).rejects.toThrow(/swallows the fork RPC's failures/);
    }, 240_000);
  });
}

// =====================================================================================================================
// 3. replay() compare le hash du bloc N CHARGÉ PAR LE MOTEUR à l'ancre (faux moteur, sans anvil)
// =====================================================================================================================

describe("3 — le bloc N chargé par le moteur doit être celui de l'ancre", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "faux-moteur-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Un « moteur » minimal : sert eth_chainId, eth_blockNumber (N, ou `head`) et un bloc N dont le hash est `servedHash`. */
  function fakeEngine(servedHash: Hex, head?: string): string {
    const file = join(dir, `moteur-${servedHash.slice(2, 10)}-${head ?? "n"}.mjs`);
    writeFileSync(file, `#!${process.execPath}
import { createServer } from "node:http";
const a = process.argv.slice(2);
const port = Number(a[a.indexOf("--port") + 1]);
const n = BigInt(a[a.indexOf("--fork-block-number") + 1]);
const forkUrl = a[a.indexOf("--fork-url") + 1];
// comme un vrai moteur : lit le bloc N au RPC du fork (le relais) au démarrage
await fetch(forkUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), true] }) });
createServer((rq, rs) => {
  let b = ""; rq.on("data", (d) => (b += d)); rq.on("end", () => {
    const q = JSON.parse(b);
    const result = q.method === "eth_chainId" ? "0x4cef52" : q.method === "eth_blockNumber" ? ${head === undefined ? `"0x" + n.toString(16)` : JSON.stringify(head)}
      : q.method === "eth_getBlockByNumber" ? { number: "0x" + n.toString(16), hash: "${servedHash}", timestamp: "0x1" } : null;
    rs.writeHead(200, { "content-type": "application/json" }); rs.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, result }));
  });
}).listen(port, "127.0.0.1");
`);
    chmodSync(file, 0o755);
    return file;
  }

  it("RPC du fork sain (ancre vérifiée par le relais) mais moteur qui charge un AUTRE bloc N → ReplayUnavailableError « anchor », rien n'est mesuré", async () => {
    const up = await scriptedUpstream(healthy);
    try {
      const bundle: ExploitBundle = {
        bountyId: 1n, payee: HUNTER, capital: 0n, predicate: { combine: "OR", clauses: [{ type: "NATIVE_DROP", holder: HUNTER, min: "1" }] },
        txs: [encodeExploitTx({ to: HUNTER, data: "0x" })], r: R, cP: "0x",
      };
      const liar = new AnvilForkRunner({ forkUrl: up.url, anvilBin: fakeEngine(h32("un autre bloc N")), engine: "anvil", log: () => {}, timeoutMs: 20_000 });
      const err = await liar.run({ blockN: N, bundle, expectedBlockHash: hashOf(N) }).catch((e) => e);
      expect(err).toBeInstanceOf(ReplayUnavailableError);
      expect(err.reason).toBe("anchor");
      expect(err.message).toMatch(/engine did not load the claim's block N/);
      // et un RPC du fork qui ne sert pas l'ancre est arrêté AVANT de lancer le moteur
      const before = up.calls.length;
      const wrong = new AnvilForkRunner({ forkUrl: up.url, anvilBin: "/nonexistent/anvil", engine: "anvil", log: () => {} });
      await expect(wrong.run({ blockN: N, bundle, expectedBlockHash: h32("autre ancre") })).rejects.toMatchObject({ reason: "anchor" });
      expect(up.calls.length).toBe(before + 1);
      // exception INATTENDUE pendant le rejeu (ici : le moteur rend une tête illisible, BigInt lève) : 503 « internal »,
      // jamais mémorisée comme un échec du rejeu (point 5 : rien de mémorisé)
      const odd = new AnvilForkRunner({ forkUrl: up.url, anvilBin: fakeEngine(hashOf(N), "pas-un-nombre"), engine: "anvil", log: () => {}, timeoutMs: 20_000 });
      const e2 = await odd.run({ blockN: N, bundle, expectedBlockHash: hashOf(N) }).catch((e) => e);
      expect(e2).toMatchObject({ reason: "internal" });
      expect(isMemorizableFailure(e2)).toBe(false);
      expect(isMemorizableFailure(new ReplayUnavailableError("rpc", "x"))).toBe(true);
      expect(isMemorizableFailure(new ReplayUnavailableError("busy", "x"))).toBe(false);
    } finally {
      await up.close();
    }
  }, 60_000);
});
