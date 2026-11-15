/**
 * Prime scellée v2.1 — RÉFUTATION avec un VRAI rejeu : AnvilForkRunner, moteur « anvil » (anvil ordinaire de Foundry +
 * émulation de l'USDC d'Arc), qui forke une chaîne LOCALE au bloc N. Ce n'est pas arc-anvil (binaire Linux d'Arc Foundry,
 * celui de l'image Dockerfile.bounty) ni Arc : la chaîne de base est un anvil de test lancé ici, avec un coffre vulnérable.
 * La réclamation est signée par une enclave A qui rejoue pour de vrai ; la chaîne de SealedBounty (claimRecords, fenêtre,
 * opérateurs) reste simulée (FakeChain) : on teste ici le contre-rejeu, pas le contrat.
 *  1. réclamation honnête → l'enclave B rejoue au même bloc N et CONFIRME (rien n'est signé) ;
 *  2. perte gonflée → B mesure la vraie perte et signe « prouvée, perte réelle » ;
 *  3. réclamation ancrée sur un bloc où le coffre n'était pas encore doté → B rejoue à CE bloc et signe « non prouvée ».
 * Ignoré si aucun anvil n'est installé (ANVIL_BIN, sinon ~/.foundry/bin/anvil).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Address, type Hex, getAddress, numberToHex, recoverAddress, toBytes, zeroAddress, zeroHash } from "viem";
import { EnclaveKit } from "../src/kit/enclave-kit";
import { type Claim } from "../src/kit/eip712";
import { seal } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import { predicateHash, type Predicate } from "../src/services/predicate";
import { AnvilForkRunner, encodeExploitTx } from "../src/services/anvil-fork";
import {
  BountyService, DeterministicProtocolCipher, RefutationService, claimDigestOf, claimOperatorsHash, refuteRequestAad,
  type BountyView, type RefuteChainView, type RefuteReader, type RefuteResult, type SubmitResult,
} from "../src/services/bounty";
import { refutationDigestOf } from "../../packages/sdk/src/index";

const ANVIL = [process.env.ANVIL_BIN, join(homedir(), ".foundry", "bin", "anvil")].find(
  (p): p is string => !!p && existsSync(p) && spawnSync(p, ["--version"]).status === 0,
);

const CHAIN = 5042002;
const SEALED = "0x00000000000000000000000000000000000000bb" as Address;
const PRODUCT = 2n;
const VAULT = "0x000000000000000000000000000000000000beef" as Address;
const HUNTER = "0x000000000000000000000000000000000000c0de" as Address;
const OP_A = getAddress("0x000000000000000000000000000000000000a001");
const OP_B = getAddress("0x000000000000000000000000000000000000b002");
const ETH = 10n ** 18n;
/** Coffre vulnérable : CALL(gaz, CALLER, SELFBALANCE, 0, 0, 0, 0) — tout appel vide le coffre vers l'appelant. */
const DRAIN = "0x600060006000600047335af100" as Hex;
const R = ("0x" + "5a".repeat(32)) as Hex;

const utf8 = (s: string) => new TextEncoder().encode(s);
const pred: Predicate = { combine: "OR", clauses: [{ type: "NATIVE_DROP", holder: VAULT, min: (1n * ETH).toString() }] };
const TXS = [encodeExploitTx({ to: VAULT, data: "0x" })];
const protocol = generateEnclaveKeys();
const view: BountyView = { predicateHash: predicateHash(pred), protocolX25519: protocol.x25519PublicKey, tierMinLoss: [1n * ETH, 5n * ETH], deadline: 9_999_999_999n };

async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(`${method} : ${j.error.message}`);
  return j.result;
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

class FakeChain implements RefuteReader {
  records = new Map<string, { acceptedAt: bigint; refuted: boolean; opsHash: Hex }>();
  active = new Map<string, Address>();
  accept(claim: Claim, ops: Address[]): void {
    this.records.set(claimDigestOf(SEALED, claim, CHAIN).toLowerCase(), { acceptedAt: 1n, refuted: false, opsHash: claimOperatorsHash(ops) });
  }
  async read(q: { claimDigest: Hex; signer: Address }): Promise<RefuteChainView> {
    return {
      block: 1n, blockTimestamp: 2n, refuteWindow: 259_200n, bounty: { ...view, productId: PRODUCT },
      record: this.records.get(q.claimDigest.toLowerCase()) ?? { acceptedAt: 0n, refuted: false, opsHash: zeroHash },
      myOperator: this.active.get(q.signer.toLowerCase()) ?? zeroAddress,
    };
  }
}

const newKit = () => new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: "0x0000000000000000000000000000000000000001", mockBlockHash: true });

describe.skipIf(!ANVIL)(`réfutation — rejeu RÉEL par anvil (moteur « anvil » : ${ANVIL ?? "absent"}, chaîne locale)`, () => {
  let base: ChildProcess | undefined;
  let url = "";
  let N0 = 0n; // coffre pas encore doté
  let N1 = 0n; // coffre doté de 7 (unités natives à 18 décimales)

  beforeAll(async () => {
    const port = await freePort();
    base = spawn(ANVIL!, ["--port", String(port), "--chain-id", String(CHAIN), "--silent"], { stdio: "ignore" });
    url = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
      try {
        await rpc(url, "eth_chainId");
        break;
      } catch {
        if (i > 120) throw new Error("anvil de base injoignable");
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await rpc(url, "evm_mine");
    N0 = BigInt(await rpc(url, "eth_blockNumber"));
    await rpc(url, "evm_mine"); // anvil_setCode/setBalance modifient l'état du DERNIER bloc : N0 reste vide
    await rpc(url, "anvil_setCode", [VAULT, DRAIN]);
    await rpc(url, "anvil_setBalance", [VAULT, numberToHex(7n * ETH)]);
    await rpc(url, "evm_mine");
    N1 = BigInt(await rpc(url, "eth_blockNumber"));
    for (let i = 0; i < 3; i++) await rpc(url, "evm_mine");
    expect(await rpc(url, "eth_getCode", [VAULT, numberToHex(N0)])).toBe("0x");
    expect(BigInt(await rpc(url, "eth_getBalance", [VAULT, numberToHex(N1)]))).toBe(7n * ETH);
  }, 60_000);

  afterAll(() => {
    base?.kill("SIGKILL");
  });

  const runner = () => new AnvilForkRunner({ forkUrl: url, anvilBin: ANVIL, engine: "anvil", log: () => {}, timeoutMs: 60_000 });
  const blockHash = async (n: bigint) => (await rpc(url, "eth_getBlockByNumber", [numberToHex(n), false])).hash as Hex;

  it("réclamation honnête confirmée ; perte gonflée → « prouvée, perte réelle » ; mauvais bloc N → « non prouvée »", async () => {
    // l'enclave A prouve l'exploit pour de vrai (rejeu au bloc N1)
    const kitA = newKit();
    const forkA = runner();
    expect(forkA.engine).toBe("anvil");
    const svc = new BountyService(
      kitA, { sealedBounty: SEALED }, { getBounty: async () => view }, new DeterministicProtocolCipher(), forkA,
      { current: async () => BigInt(await rpc(url, "eth_blockNumber")), blockHash }, () => BigInt(Math.floor(Date.now() / 1000)),
    );
    const bundle = { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: pred, txs: TXS, r: R, cP: "0x" as Hex };
    const cP = await new DeterministicProtocolCipher().recompute(bundle, protocol.x25519PublicKey);
    const plain = { bountyId: "1", payee: HUNTER, capital: "0", predicate: pred, txs: TXS, r: R, cP, blockN: N1.toString() };
    const sub = (await svc.submit(await seal(toBytes(kitA.keys.x25519PublicKey), utf8(JSON.stringify(plain))))) as Extract<SubmitResult, { status: "proven" }>;
    expect(sub.status).toBe("proven");
    expect(sub.claim).toMatchObject({ blockN: N1, loss: 7n * ETH, tier: 1 });

    // l'enclave B (autre opérateur) contre-rejoue avec son propre anvil
    const chain = new FakeChain();
    const kitB = newKit();
    chain.active.set(kitB.keys.signer.toLowerCase(), OP_B);
    const B = new RefutationService(kitB, { sealedBounty: SEALED }, chain, new DeterministicProtocolCipher(), runner());
    const ask = async (claim: Claim) => {
      chain.accept(claim, [OP_A]);
      const hunter = { from: "hunter", bountyId: "1", payee: HUNTER, capital: "0", predicate: pred, txs: TXS, r: R };
      const s = await seal(toBytes(kitB.keys.x25519PublicKey), utf8(JSON.stringify(hunter)), refuteRequestAad(claimDigestOf(SEALED, claim, CHAIN)));
      return B.refute({ claim, operators: [OP_A], enc: s.enc, ciphertext: s.ciphertext });
    };
    const signedBy = async (r: Extract<RefuteResult, { status: "refuted" }>) =>
      (await recoverAddress({ hash: refutationDigestOf(SEALED, r.refutation, CHAIN), signature: r.signature })).toLowerCase();

    // 1. honnête : même perte, même palier → confirmée, rien de signé
    const ok = await ask(sub.claim);
    expect(ok.status).toBe("confirmed");
    expect(ok).not.toHaveProperty("signature");
    expect((ok as any).replay).toMatchObject({ replayed: true, satisfied: true, loss: 7n * ETH, tier: 1, blockN: N1 });

    // 2. perte gonflée (même palier) → le vrai rejeu signe la perte réelle
    const inflated = (await ask({ ...sub.claim, loss: 9n * ETH })) as Extract<RefuteResult, { status: "refuted" }>;
    expect(inflated.status).toBe("refuted");
    expect(inflated.refutation).toMatchObject({ proven: true, loss: 7n * ETH, tier: 1 });
    expect(await signedBy(inflated)).toBe(kitB.keys.signer.toLowerCase());

    // 3. même exploit ancré au bloc N0 (coffre vide) : le contre-rejeu à CE bloc ne prouve rien
    const early = (await ask({ ...sub.claim, blockN: N0, blockHashN: await blockHash(N0) })) as Extract<RefuteResult, { status: "refuted" }>;
    expect(early.status).toBe("refuted");
    expect(early.refutation).toMatchObject({ proven: false, loss: 0n, tier: 0 });
    expect(early.replay).toMatchObject({ replayed: true, satisfied: false, blockN: N0 });
    expect(await signedBy(early)).toBe(kitB.keys.signer.toLowerCase());
  }, 180_000);
});
