/**
 * Sealed Bounty v2.1 — the hardened relay with the real engines (anvil; arc-anvil if ARC_ANVIL_BIN), on a local anvil
 * base chain (never Arc). The cases from the relay review of 9 Nov 2026 (r3-1a, r2, r3-1b, poisoned parentHash), replayed
 * end to end: BountyService.submit → AnvilForkRunner → strict relay → the fork's lying RPC (a proxy) → base chain.
 *  - r3-1a: a block N with the same hash but a timestamp shifted by +1,000 s used to get a false claim signed (TIME_COIN
 *    pays if TIMESTAMP > T): now 503, nothing signed; control (headerPolicy "shape", the old contract): signed;
 *  - r2 / r3-1b: a block N without baseFeePerGas (arc-anvil took another BASEFEE without an error) or without mixHash: 503;
 *  - poisoned parentHash: a forged BLOCKHASH(N − 2) (BH_COIN pays if BLOCKHASH(number − 3) == SLOAD(0) = the forged hash):
 *    503; control "shape": false claim signed;
 *  - start-up check: healthy chain → the 6 checks unchanged; an RPC whose headers do not reproduce their hash →
 *    refuses to start, with the reason.
 * Skipped if no anvil is installed (ANVIL_BIN, otherwise ~/.foundry/bin/anvil).
 * Labels and messages that the enclave code prints are matched as it prints them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { keccak256, numberToHex, toBytes, type Address, type Hex } from "viem";
import { EnclaveKit } from "../src/kit/enclave-kit";
import { seal } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import { predicateHash, type Predicate } from "../src/services/predicate";
import { AnvilForkRunner, encodeExploitTx } from "../src/services/anvil-fork";
import { BountyService, DeterministicProtocolCipher, ReplayUnavailableError, type BountyView, type ExploitBundle } from "../src/services/bounty";
import type { HeaderPolicy } from "../src/services/rpc-relay";

const ANVIL = [process.env.ANVIL_BIN, join(homedir(), ".foundry", "bin", "anvil")].find(
  (p): p is string => !!p && existsSync(p) && spawnSync(p, ["--version"]).status === 0,
);
/** arc-anvil (Arc Foundry), facultatif : ARC_ANVIL_BIN=/chemin/vers/arc-anvil. */
const ARC_ANVIL = [process.env.ARC_ANVIL_BIN].find((p): p is string => !!p && existsSync(p) && spawnSync(p, ["--version"]).status === 0);

const CHAIN = 5042002;
const SEALED = "0x00000000000000000000000000000000000000bb" as Address;
const HUNTER = "0x000000000000000000000000000000000000c0de" as Address;
const R = ("0x" + "5a".repeat(32)) as Hex;
const USDC = "0x3600000000000000000000000000000000000000" as Address;
/** Minimal USDC of a local base chain (0x3600…): balanceOf(a) = native balance / 1e12, as on Arc. */
const FAKE_USDC_CODE = "0x64e8d4a51000600435310460005260206000f3" as Hex;
const TIME_COIN = "0x0000000000000000000000000000000000071e00" as Address;
const BASEFEE_COIN = "0x000000000000000000000000000000000000bf00" as Address;
const BH_COIN = "0x000000000000000000000000000000000000b400" as Address;
/** BASEFEE_COIN : vide sa caisse vers l'appelant si BASEFEE == 0. */
const BASEFEE_COIN_CODE = "0x4815600657005b600060006000600047335af100" as Hex;
/** BH_COIN: drains its till to the caller if BLOCKHASH(number − 3) == SLOAD(0) (the transaction is mined at block N + 1:
 *  BLOCKHASH(N − 2)). */
const BH_COIN_CODE = "0x600343034060005414600d57005b600060006000600047335af100" as Hex;
const protocol = generateEnclaveKeys();
const utf8 = (s: string) => new TextEncoder().encode(s);

async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j: any = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.code} ${j.error.message}`);
  return j.result;
}

/** The fork's lying RPC in front of the base chain: `lie(q, real answer)` returns a forged result, or undefined (relayed). */
async function lyingRpc(target: string, lie: (q: any, real: any) => unknown) {
  let lies = 0;
  const one = async (q: any) => {
    const real = await (await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q) })).json();
    const forged = lie(q, real);
    if (forged === undefined) return real;
    lies++;
    return { ...(real as object), result: forged };
  };
  const server: Server = createHttpServer((rq, rs) => {
    let body = "";
    rq.on("data", (d) => (body += d));
    rq.on("end", async () => {
      try {
        const j = JSON.parse(body);
        const out = Array.isArray(j) ? await Promise.all(j.map(one)) : await one(j);
        rs.writeHead(200, { "content-type": "application/json" });
        rs.end(JSON.stringify(out));
      } catch {
        rs.writeHead(502);
        rs.end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    lies: () => lies,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

const engines: Array<[string, string | undefined, "anvil" | "arc"]> = [["anvil", ANVIL, "anvil"], ["arc-anvil", ARC_ANVIL, "arc"]];

for (const [ename, bin, engine] of engines) {
  describe.skipIf(!ANVIL || !bin)(`hardened relay — real engine "${ename}" (local base chain)`, () => {
    let base: ChildProcess | undefined;
    let url = "";
    let N = 0n;
    let T = 0n;
    /** Le faux bloc N − 2 : son hash est celui que BH_COIN attend. */
    const FORGED = keccak256(toBytes("faux bloc N-2"));

    beforeAll(async () => {
      const port = await new Promise<number>((resolve) => {
        const s = createHttpServer();
        s.listen(0, "127.0.0.1", () => {
          const p = (s.address() as AddressInfo).port;
          s.close(() => resolve(p));
        });
      });
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
      T = BigInt((await rpc(url, "eth_getBlockByNumber", ["latest", false])).timestamp) + 500n;
      /** TIME_COIN : vide sa caisse vers l'appelant si TIMESTAMP > T. */
      const TIME_COIN_CODE = `0x63${T.toString(16).padStart(8, "0")}4211600b57005b600060006000600047335af100` as Hex;
      await rpc(url, "anvil_setCode", [USDC, FAKE_USDC_CODE]);
      for (const [a, code] of [[TIME_COIN, TIME_COIN_CODE], [BASEFEE_COIN, BASEFEE_COIN_CODE], [BH_COIN, BH_COIN_CODE]] as const) {
        await rpc(url, "anvil_setCode", [a, code]);
        await rpc(url, "anvil_setBalance", [a, numberToHex(5n * 10n ** 18n)]);
      }
      await rpc(url, "anvil_setStorageAt", [BH_COIN, numberToHex(0n, { size: 32 }), FORGED]);
      for (let i = 0; i < 5; i++) await rpc(url, "evm_mine");
      N = BigInt(await rpc(url, "eth_blockNumber"));
      for (let i = 0; i < 3; i++) await rpc(url, "evm_mine");
    }, 60_000);
    afterAll(() => base?.kill("SIGKILL"));

    const blockHash = async (n: bigint) => (await rpc(url, "eth_getBlockByNumber", [numberToHex(n), false])).hash as Hex;
    const runner = (forkUrl: string, headerPolicy?: HeaderPolicy) =>
      new AnvilForkRunner({ forkUrl, anvilBin: bin, engine, log: () => {}, timeoutMs: 90_000, ...(headerPolicy ? { headerPolicy } : {}) });

    /** A claim "the till of `coin` drops" by the real replay; the anchor is block N's real hash (quorum). */
    async function claim(coin: Address, forkUrl: string, headerPolicy?: HeaderPolicy): Promise<string> {
      const p: Predicate = { combine: "OR", clauses: [{ type: "NATIVE_DROP", holder: coin, min: "1" }] };
      const view: BountyView = { predicateHash: predicateHash(p), protocolX25519: protocol.x25519PublicKey, tierMinLoss: [1n], deadline: 9_999_999_999n };
      const kit = new EnclaveKit({ productId: 2n, chainId: CHAIN, registry: "0x0000000000000000000000000000000000000001", mockBlockHash: true });
      const svc = new BountyService(kit, { sealedBounty: SEALED }, { getBounty: async () => view }, new DeterministicProtocolCipher(), runner(forkUrl, headerPolicy),
        { current: async () => BigInt(await rpc(url, "eth_blockNumber")), blockHash }, () => BigInt(Math.floor(Date.now() / 1000)));
      const txs = [encodeExploitTx({ to: coin, data: "0x" })];
      const b: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: p, txs, r: R, cP: "0x" };
      const cP = await new DeterministicProtocolCipher().recompute(b, protocol.x25519PublicKey);
      const cE = await seal(toBytes(kit.keys.x25519PublicKey), utf8(JSON.stringify({ bountyId: "1", payee: HUNTER, capital: "0", predicate: p, txs, r: R, cP, blockN: N.toString() })));
      try {
        const r = await svc.submit(cE);
        return r.status === "proven" ? "PROUVÉE, SIGNÉE" : "non prouvée";
      } catch (e) {
        if (e instanceof ReplayUnavailableError) return `503 ${e.reason}`;
        throw e;
      }
    }
    const isBlock = (q: any, n: bigint) =>
      q?.method === "eth_getBlockByNumber" && typeof q.params?.[0] === "string" && /^0x[0-9a-fA-F]+$/.test(q.params[0]) && BigInt(q.params[0]) === n;

    it("r3-1a: block N with the same hash, timestamp +1,000 s (every read) → 503 \"anchor\", nothing signed; lie served to the engine only → 503 \"relay\"; control \"shape\": false claim signed", async () => {
      expect(await claim(TIME_COIN, url)).toBe("non prouvée"); // healthy RPC: TIMESTAMP ≤ T
      const shift = (real: any) => ({ ...real.result, timestamp: numberToHex(BigInt(real.result.timestamp) + 1000n) });
      const everywhere = await lyingRpc(url, (q, real) => (isBlock(q, N) && real.result ? shift(real) : undefined));
      let blockNReads = 0;
      const engineOnly = await lyingRpc(url, (q, real) => (isBlock(q, N) && real.result && ++blockNReads >= 2 ? shift(real) : undefined));
      try {
        expect(await claim(TIME_COIN, everywhere.url)).toBe("503 anchor");
        expect(await claim(TIME_COIN, engineOnly.url)).toBe("503 relay"); // the anchor (first read) was healthy
        expect(engineOnly.lies()).toBeGreaterThan(0);
        // the old contract (shape only): the engine takes the forged timestamp and the enclave signs a false claim
        expect(await claim(TIME_COIN, everywhere.url, "shape")).toBe("PROUVÉE, SIGNÉE");
      } finally {
        await everywhere.close();
        await engineOnly.close();
      }
    }, 240_000);

    it("r2 / r3-1b: block N without baseFeePerGas, without mixHash or without blob fields (invalid answers for Arc) → 503, nothing signed", async () => {
      const healthy = await claim(BASEFEE_COIN, url);
      expect(["non prouvée", "PROUVÉE, SIGNÉE"]).toContain(healthy); // anvil (--base-fee 0) pays, arc-anvil does not: irrelevant here
      for (const drop of [["baseFeePerGas"], ["mixHash"], ["blobGasUsed", "excessBlobGas", "parentBeaconBlockRoot"]]) {
        const proxy = await lyingRpc(url, (q, real) => {
          if (!isBlock(q, N) || !real.result) return undefined;
          const b = { ...real.result };
          for (const k of drop) delete b[k];
          return b;
        });
        try {
          expect(await claim(BASEFEE_COIN, proxy.url), drop.join(",")).toBe("503 anchor");
          expect(proxy.lies(), drop.join(",")).toBeGreaterThan(0);
        } finally {
          await proxy.close();
        }
      }
    }, 240_000);

    it("poisoned parentHash: N − 1 with the right hash but a forged parentHash, N − 2 with the forged hash → BLOCKHASH(N − 2): 503, nothing signed; control \"shape\": false claim signed", async () => {
      expect(await claim(BH_COIN, url)).toBe("non prouvée"); // healthy RPC: BLOCKHASH(N − 2) is the real hash
      const proxy = await lyingRpc(url, (q, real) => {
        if (!real.result) return undefined;
        if (isBlock(q, N - 1n)) return { ...real.result, parentHash: FORGED };
        if (isBlock(q, N - 2n)) return { ...real.result, hash: FORGED };
        return undefined;
      });
      try {
        expect(await claim(BH_COIN, proxy.url)).toBe("503 relay");
        expect(await claim(BH_COIN, proxy.url, "shape")).toBe("PROUVÉE, SIGNÉE");
        expect(proxy.lies()).toBeGreaterThan(0);
      } finally {
        await proxy.close();
      }
    }, 240_000);

    it("start-up check (\"arc\" policy, the default): healthy chain → the 6 checks; an RPC whose headers do not reproduce their hash → refuses to start, reason \"header\"", async () => {
      const st = await runner(url).selfTest();
      expect(st.checks).toEqual([
        "lecture directe : erreur", "stockage mal formé : erreur (relais)", "bloc rendu null : erreur (relais)",
        "contrôle positif : BLOCKHASH et solde identiques au RPC du fork", "exécution (eth_call) : erreur", "transaction : jamais minée",
      ]);
      expect(st.revertCode).toBe(3);
      const proxy = await lyingRpc(url, (q, real) => (q?.method === "eth_getBlockByNumber" && real.result ? { ...real.result, timestamp: numberToHex(BigInt(real.result.timestamp) + 1n) } : undefined));
      try {
        const err = await runner(proxy.url).selfTest().catch((e) => e as Error);
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toMatch(/refusé par le relais strict \(header/);
        expect(err.message).toMatch(/refus de démarrer/);
      } finally {
        await proxy.close();
      }
    }, 240_000);
  });
}
