/**
 * Relais strict + PREUVES D'ÉTAT (10/11/2026) : devant un RPC scripté qui sert un VRAI bloc d'Arc testnet et ses vraies
 * preuves (test/fixtures/arc-testnet-state-proofs.json), le relais rend au moteur les valeurs PROUVÉES ; chaque mensonge
 * sur l'état (solde, nonce, case, code, stateRoot) devient une violation « state_proof » ou « header » (rien n'est signé),
 * et une preuve indisponible (nœud hors fenêtre) un échec passager (rejeu en échec fermé). Témoin : sans l'option, le même
 * mensonge sur un solde passe (c'est la limite que l'option ferme).
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { RelayViolation, UpstreamFailure, startStrictRelay, type StrictRelay } from "../src/services/rpc-relay.js";
import { slotKey } from "../src/services/state-proof.js";

type Proof = {
  address: Hex; balance: string; nonce: string; codeHash: Hex; storageHash: Hex; accountProof: Hex[];
  storageProof: { key: string; value: string; proof: Hex[] }[];
};
const fx = JSON.parse(readFileSync(new URL("./fixtures/arc-testnet-state-proofs.json", import.meta.url), "utf8")) as {
  block: Record<string, unknown> & { hash: Hex; number: string; stateRoot: Hex };
  proofs: Proof[];
  code: { address: Hex; code: Hex };
};
const N = BigInt(fx.block.number);
const TAG = fx.block.number;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const usdc = fx.proofs[0]!;
const registry = fx.proofs.find((p) => p.address.toLowerCase() === fx.code.address.toLowerCase())!;
const absent = fx.proofs.find((p) => p.address.toLowerCase() === "0x582a0000000000000000000000000000000000aa")!;
const nzSlot = usdc.storageProof.find((s) => BigInt(s.value) !== 0n)!;

type Lie = "none" | "balance" | "node" | "storage" | "code" | "stateRoot" | "window" | "plain-balance";

/** RPC scripté : le vrai bloc N et les vraies preuves, avec un mensonge au choix. */
async function fakeRpc(lie: Lie): Promise<{ url: string; server: Server; calls: string[] }> {
  const calls: string[] = [];
  const answer = (q: { id: unknown; method: string; params: unknown[] }) => {
    calls.push(q.method);
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: q.id, result });
    switch (q.method) {
      case "eth_getBlockByNumber": {
        if (q.params[0] !== TAG) return ok(null);
        const b = clone(fx.block);
        if (lie === "stateRoot") b.stateRoot = usdc.storageHash; // autre racine, même hash annoncé
        return ok(b);
      }
      case "eth_getProof": {
        if (lie === "window") return { jsonrpc: "2.0", id: q.id, error: { code: -32602, message: "distance to target block exceeds maximum proof window" } };
        const [addr, slots] = q.params as [string, string[]];
        const p = clone(fx.proofs.find((x) => x.address.toLowerCase() === addr.toLowerCase())!);
        const sp = slots.map((k) => {
          const s = p.storageProof.find((x) => slotKey(x.key) === slotKey(k));
          if (!s) throw new Error(`case absente du jeu : ${k}`);
          return s;
        });
        const r = { ...p, storageProof: sp };
        if (lie === "balance") r.balance = `0x${(BigInt(r.balance) + 10n ** 18n).toString(16)}`;
        if (lie === "node") r.accountProof[2] = r.accountProof[3]!;
        if (lie === "storage" && sp.length) sp[0]!.value = `0x${(BigInt(sp[0]!.value) + 1n).toString(16)}`;
        return ok(r);
      }
      case "eth_getCode": {
        const [addr] = q.params as [string];
        const code = addr.toLowerCase() === fx.code.address.toLowerCase() ? fx.code.code : "0x";
        return ok(lie === "code" ? `${code}fe` : code);
      }
      case "eth_getBalance": {
        const p = fx.proofs.find((x) => x.address.toLowerCase() === (q.params[0] as string).toLowerCase())!;
        return ok(lie === "plain-balance" ? `0x${(BigInt(p.balance) + 10n ** 18n).toString(16)}` : p.balance);
      }
      default:
        return { jsonrpc: "2.0", id: q.id, error: { code: -32601, message: "méthode inconnue du banc" } };
    }
  };
  const server = createServer((rq, rs) => {
    let body = "";
    rq.on("data", (d) => (body += d));
    rq.on("end", () => {
      const j = JSON.parse(body);
      const out = Array.isArray(j) ? j.map(answer) : answer(j);
      rs.writeHead(200, { "content-type": "application/json" });
      rs.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server, calls };
}

const open: { relay?: StrictRelay; server?: Server }[] = [];
afterEach(async () => {
  for (const o of open.splice(0)) {
    await o.relay?.close();
    await new Promise<void>((r) => (o.server ? o.server.close(() => r()) : r()));
  }
});

async function setup(lie: Lie, proofs = true) {
  const up = await fakeRpc(lie);
  const relay = await startStrictRelay({ upstream: up.url, blockN: N, anchorHash: fx.block.hash, ...(proofs ? { stateProofs: {} } : {}) });
  open.push({ relay, server: up.server });
  return { relay, calls: up.calls };
}

describe("relais strict avec preuves d'état (vrai bloc d'Arc testnet)", () => {
  it("rend les valeurs PROUVÉES : solde, nonce, case non nulle, code, compte absent, eth_getAccountInfo", async () => {
    const { relay, calls } = await setup("none");
    expect(await relay.call("eth_getBalance", [usdc.address, TAG])).toBe(`0x${BigInt(usdc.balance).toString(16)}`);
    expect(await relay.call("eth_getTransactionCount", [registry.address, TAG])).toBe(`0x${BigInt(registry.nonce).toString(16)}`);
    expect(await relay.call("eth_getStorageAt", [usdc.address, nzSlot.key, TAG])).toBe(slotKey(nzSlot.value).toLowerCase());
    expect(await relay.call("eth_getCode", [registry.address, TAG])).toBe(fx.code.code.toLowerCase());
    expect(await relay.call("eth_getBalance", [absent.address, TAG])).toBe("0x0");
    expect(await relay.call("eth_getCode", [absent.address, TAG])).toBe("0x");
    expect(await relay.call("eth_getStorageAt", [absent.address, "0x0", TAG])).toBe(`0x${"0".repeat(64)}`);
    const info = (await relay.call("eth_getAccountInfo", [registry.address, TAG])) as { balance: string; nonce: string; code: string };
    expect(info.code).toBe(fx.code.code.toLowerCase());
    expect(relay.violation).toBeUndefined();
    expect(calls).toContain("eth_getProof");
    expect(calls).not.toContain("eth_getBalance"); // la valeur ne vient jamais d'une lecture non prouvée
  });

  it("un solde annoncé autrement que prouvé → violation « state_proof » (verrou)", async () => {
    const { relay } = await setup("balance");
    await expect(relay.call("eth_getBalance", [usdc.address, TAG])).rejects.toBeInstanceOf(RelayViolation);
    expect(relay.violation?.kind).toBe("state_proof");
  });

  it("un nœud de preuve substitué → « state_proof »", async () => {
    const { relay } = await setup("node");
    await expect(relay.call("eth_getTransactionCount", [usdc.address, TAG])).rejects.toBeInstanceOf(RelayViolation);
    expect(relay.violation?.kind).toBe("state_proof");
  });

  it("une case de stockage gonflée → « state_proof »", async () => {
    const { relay } = await setup("storage");
    await expect(relay.call("eth_getStorageAt", [usdc.address, nzSlot.key, TAG])).rejects.toBeInstanceOf(RelayViolation);
    expect(relay.violation?.kind).toBe("state_proof");
  });

  it("un code qui ne redonne pas le hash prouvé → « state_proof »", async () => {
    const { relay } = await setup("code");
    await expect(relay.call("eth_getCode", [registry.address, TAG])).rejects.toBeInstanceOf(RelayViolation);
    expect(relay.violation?.kind).toBe("state_proof");
  });

  it("un en-tête N au stateRoot changé (même hash annoncé) → « header » : la racine des preuves est celle de l'ancre", async () => {
    const { relay } = await setup("stateRoot");
    await expect(relay.call("eth_getBalance", [usdc.address, TAG])).rejects.toBeInstanceOf(RelayViolation);
    expect(relay.violation?.kind).toBe("header");
  });

  it("preuve indisponible (nœud hors fenêtre) → échec passager, aucune valeur rendue", async () => {
    const { relay } = await setup("window");
    await expect(relay.call("eth_getBalance", [usdc.address, TAG])).rejects.toBeInstanceOf(UpstreamFailure);
    expect(relay.violation).toBeUndefined();
  });

  it("TÉMOIN : sans l'option, le même mensonge sur un solde passe (la limite que les preuves ferment)", async () => {
    const { relay } = await setup("plain-balance", false);
    const lied = await relay.call("eth_getBalance", [usdc.address, TAG]);
    expect(BigInt(lied as string)).toBe(BigInt(usdc.balance) + 10n ** 18n);
    expect(relay.violation).toBeUndefined();
  });

  it("les preuves exigent la politique d'en-tête « arc » et une ancre (sinon en-tête et preuves pourraient être fabriqués ensemble)", async () => {
    await expect(startStrictRelay({ upstream: "http://127.0.0.1:9", blockN: N, anchorHash: fx.block.hash, stateProofs: {}, headerPolicy: "shape" })).rejects.toThrow(/arc/);
    await expect(startStrictRelay({ upstream: "http://127.0.0.1:9", blockN: N, stateProofs: {} })).rejects.toThrow(/ancre/);
  });
});

describe("DURCISSEMENT #4 : le chainId du rejeu est exigé (pas celui d'un RPC menteur)", () => {
  async function relayChainId(served: string, expected?: number): Promise<StrictRelay> {
    const server = createServer((rq, rs) => {
      let body = "";
      rq.on("data", (d) => (body += d));
      rq.on("end", () => {
        const j = JSON.parse(body);
        const one = (q: any) =>
          q.method === "eth_chainId"
            ? { jsonrpc: "2.0", id: q.id, result: served }
            : { jsonrpc: "2.0", id: q.id, error: { code: -32601, message: "hors sujet" } };
        rs.writeHead(200, { "content-type": "application/json" });
        rs.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j)));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const relay = await startStrictRelay({ upstream: url, blockN: N, anchorHash: fx.block.hash, ...(expected !== undefined ? { expectedChainId: expected } : {}) });
    open.push({ relay, server });
    return relay;
  }

  it("la bonne valeur passe ; une autre valeur est une violation « chain » (rien n'est signé)", async () => {
    const good = `0x${(5042002).toString(16)}`;
    expect(await (await relayChainId(good, 5042002)).call("eth_chainId", [])).toBe(good);
    await expect((await relayChainId("0x1", 5042002)).call("eth_chainId", [])).rejects.toBeInstanceOf(RelayViolation);
    // sans expectedChainId : n'importe quelle valeur passe (compatibilité)
    expect(await (await relayChainId("0x1")).call("eth_chainId", [])).toBe("0x1");
  });
});
