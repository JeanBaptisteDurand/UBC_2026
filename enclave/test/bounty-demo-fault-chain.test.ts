/**
 * Sealed Bounty v2.1 — the refutation demo end to end on a local chain (anvil), with the real contracts
 * (contracts/out: ProductRegistry, OperatorBond, EnclaveRegistry, VerdictLog, SealedBounty, DemoVault; only USDC, the
 * attestation module, the ERC-8004 registry and the EIP-2935 history are test doubles) and the real replay (AnvilForkRunner,
 * "anvil" engine, a fork of this chain at block N). This is the path of scripts/refute-demo.ts:
 *  1. three operators (ERC-8004 identity, VerdictLog allowed, 1 USDC bond, agentId) and three registered enclaves: A runs
 *     DEMO_FAULT=inflate-loss, B and C are honest;
 *  2. a DemoVault funded with 1 USDC, a bounty (pool 1 USDC, tier 0.5 USDC for a loss ≥ 1 USDC, ERC20_DROP);
 *  3. the hunter (SDK: key verified on-chain, sealed exploit) submits to A: a claim signed with a loss of 2 USDC;
 *     acceptClaim;
 *  4. before delivery, the protocol requests the refutation (SDK requestRefutations, source "protocol"): A is left out
 *     (the claim's operator), B and C replay at block N and sign Refutation { proven, loss 1 USDC, tier 0 };
 *  5. the contract refuses a refutation from a single operator, or one signed by the claim's operator; refute(claim, [A],
 *     f, [sigB, sigC]) passes: ClaimRefuted, A's bond seized (half to the reporter, half to the protocol) and A banned,
 *     the reserved payment returned to the pool, ERC-8004 verdict "refuted" (0) for A's agent; nothing left to deliver.
 * Skipped if no anvil is installed (ANVIL_BIN, otherwise ~/.foundry/bin/anvil).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type Abi, type Address, type Hex, createPublicClient, createWalletClient, defineChain, encodeAbiParameters, encodeFunctionData, getAddress,
  http, keccak256, parseAbi, parseEther, parseEventLogs, recoverAddress, toBytes, toHex, zeroAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { x25519 } from "@noble/curves/ed25519";
import { EnclaveKit } from "../src/kit/enclave-kit";
import { domain } from "../src/kit/eip712";
import { RpcQuorum } from "../src/kit/rpc-quorum";
import { computeWorkloadId } from "../src/kit/binding";
import { AnvilForkRunner, encodeExploitTx } from "../src/services/anvil-fork";
import { BountyService, DeterministicProtocolCipher, RefutationService, refutationTypes, type BlockSource } from "../src/services/bounty";
import { predicateHash, type Predicate } from "../src/services/predicate";
import { BountyCache, chainBountyReader, chainRefuteReader, createSealedBountyApp } from "../products/sealed-bounty/app";
import * as sdk from "../../packages/sdk/src/index";

const ANVIL = [process.env.ANVIL_BIN, join(homedir(), ".foundry", "bin", "anvil")].find(
  (p): p is string => !!p && existsSync(p) && spawnSync(p, ["--version"]).status === 0,
);

const CHAIN_ID = 5042002;
const HISTORY: Address = "0x0000F90827F1C53a10cb7A02335B175320002935";
/** EIP-2935 history of the local chain: returns BLOCKHASH(n) (the last 256 blocks), hence the real hash, as on Arc. */
const HISTORY_SHIM: Hex = "0x6000354060005260206000f3";
const USDC6 = 1_000_000n;
const OUT = new URL("../../contracts/out/", import.meta.url);
const art = (file: string, name = file) => JSON.parse(readFileSync(new URL(`${file}.sol/${name}.json`, OUT), "utf8")) as { abi: Abi; bytecode: { object: Hex } };

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

/** TDX measurements declared to the test attestation module (the same for the three enclaves: one image). */
const M = {
  ok: true, version: 4, bodyType: 2, tcbStatus: 0, fmspc: "0x112233445566" as Hex,
  mrtd: ("0x" + "11".repeat(48)) as Hex, rtmr0: ("0x" + "22".repeat(48)) as Hex, rtmr1: ("0x" + "33".repeat(48)) as Hex,
  rtmr2: ("0x" + "44".repeat(48)) as Hex, rtmr3: ("0x" + "55".repeat(48)) as Hex, mrConfigId: ("0x" + "66".repeat(48)) as Hex,
  xfam: "0x00000000000e0003" as Hex, tdAttributes: "0x0000000000000000" as Hex, advisories: [] as string[],
};
const WORKLOAD = computeWorkloadId(M);

describe.skipIf(!ANVIL)(`refutation demo on a local chain (real contracts, replay by ${ANVIL ?? "anvil, absent"})`, () => {
  let base: ChildProcess | undefined;
  let url = "";

  beforeAll(async () => {
    const port = await freePort();
    base = spawn(ANVIL!, ["--port", String(port), "--chain-id", String(CHAIN_ID), "--silent"], { stdio: "ignore" });
    url = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
        if (r.ok) break;
      } catch {
        if (i > 120) throw new Error("local anvil unreachable");
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 60_000);

  afterAll(() => {
    base?.kill("SIGKILL");
  });

  it("A lies (doubled loss), B and C refute: A's bond seized, payment returned to the pool, verdict \"refuted\" (0)", async () => {
    const chain = defineChain({ id: CHAIN_ID, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
    const pub = createPublicClient({ chain, transport: http(url) });
    const rpc = async (method: string, params: unknown[]) => (pub as any).request({ method, params });
    const roles = { deployer: generatePrivateKey(), hunter: generatePrivateKey(), A: generatePrivateKey(), B: generatePrivateKey(), C: generatePrivateKey() };
    const acct = Object.fromEntries(Object.entries(roles).map(([k, pk]) => [k, privateKeyToAccount(pk)])) as Record<keyof typeof roles, PrivateKeyAccount>;
    for (const a of Object.values(acct)) await rpc("anvil_setBalance", [a.address, toHex(parseEther("1000"))]);
    const wallet = (a: PrivateKeyAccount) => createWalletClient({ account: a, chain, transport: http(url) });
    const W = Object.fromEntries(Object.entries(acct).map(([k, a]) => [k, wallet(a)])) as Record<keyof typeof roles, ReturnType<typeof wallet>>;

    const deploy = async (file: string, name: string, args: unknown[] = []) => {
      const a = art(file, name);
      const hash = await W.deployer.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args } as any);
      const r = await pub.waitForTransactionReceipt({ hash });
      expect(r.status).toBe("success");
      return { address: r.contractAddress! as Address, abi: a.abi };
    };
    type C = Awaited<ReturnType<typeof deploy>>;
    const send = async (who: keyof typeof roles, c: C, functionName: string, args: unknown[]) => {
      const { request } = await pub.simulateContract({ account: acct[who], address: c.address, abi: c.abi, functionName, args } as any);
      const hash = await W[who].writeContract(request as any);
      const r = await pub.waitForTransactionReceipt({ hash });
      expect(r.status).toBe("success");
      return r;
    };
    const read = (c: C, functionName: string, args: unknown[] = []) => pub.readContract({ address: c.address, abi: c.abi, functionName, args } as any) as Promise<any>;

    // ---- the v2.1 stack, deployed as DeployTestnet does (doubles: USDC, attestation module, ERC-8004, history) ----
    const usdc = await deploy("MockUSDC3009", "MockUSDC3009");
    const mod = await deploy("MockAttestationModule", "MockAttestationModule");
    const identity = await deploy("MockERC8004", "MockIdentityRegistry");
    const validation = await deploy("MockERC8004", "MockValidationRegistry");
    const products = await deploy("ProductRegistry", "ProductRegistry", [0n]);
    const bond = await deploy("OperatorBond", "OperatorBond", [usdc.address, acct.deployer.address, acct.deployer.address, identity.address]);
    const registry = await deploy("EnclaveRegistry", "EnclaveRegistry", [mod.address, products.address, bond.address, false, 5_000n, 4_000n, 509n]);
    const verdict = await deploy("VerdictLog", "VerdictLog", [validation.address, acct.deployer.address]);
    const sealed = await deploy("SealedBounty", "SealedBounty", [usdc.address, products.address, registry.address, bond.address, verdict.address, acct.deployer.address, 1000, 500]);
    await send("deployer", bond, "initialize", [registry.address, [sealed.address]]);
    await send("deployer", verdict, "initialize", [[sealed.address]]);
    await rpc("anvil_setCode", [HISTORY, HISTORY_SHIM]);

    // ---- the demo product, settled by SealedBounty ----
    await send("deployer", products, "propose", [{
      manifestHash: keccak256(toBytes("refute demo manifest")), manifestURI: "https://example.org/manifests/sealed-bounty-refute-demo-v21.json",
      workloadIds: [WORKLOAD], deterministic: true, price: 0n, bpsOperator: 9500, bpsAuthor: 0, bpsNetwork: 500, minBond: 250_000n,
      exposureCap: 10n * USDC6, settlement: sealed.address, param: keccak256(toBytes("refute demo")), advisoryIds: [], unitTokens: 1, outWeight: 1,
    }]);
    const PRODUCT = (await read(products, "productCount")) as bigint;
    await send("deployer", products, "activate", [PRODUCT]);

    // ---- three operators: ERC-8004 identity, VerdictLog allowed, 1 USDC bond, agentId ----
    const agentId: Record<string, bigint> = {};
    for (const op of ["A", "B", "C"] as const) {
      await send(op, identity, "register", [`data:,refute-demo-operator-${op}`]);
      agentId[op] = (await read(identity, "count")) as bigint;
      await send(op, identity, "setApprovalForAll", [verdict.address, true]);
      await send("deployer", usdc, "mint", [acct[op].address, 10n * USDC6]);
      await send(op, usdc, "approve", [bond.address, USDC6]);
      await send(op, bond, "bondFrom", [USDC6]);
      await send(op, bond, "setAgentId", [agentId[op]]);
    }

    // ---- three enclaves: A (DEMO_FAULT=inflate-loss), B and C (honest), each registered by its own operator ----
    const quorum = new RpcQuorum([url]);
    const blocks: BlockSource = { current: () => quorum.commonHead(), blockHash: (n) => quorum.blockHash(n) };
    const runner = () => new AnvilForkRunner({ forkUrl: url, anvilBin: ANVIL, engine: "anvil", log: () => {}, timeoutMs: 60_000 });
    const now = () => BigInt(Math.floor(Date.now() / 1000));
    const attest = { operatorAllowlist: null, registeredOperator: async () => null, warn: () => {} };
    const node = (op: "A" | "B" | "C", demoFault?: "inflate-loss") => {
      const kit = new EnclaveKit({ productId: PRODUCT, chainId: CHAIN_ID, registry: registry.address, rpc: quorum });
      const cache = new BountyCache();
      const service = new BountyService(
        kit, { sealedBounty: sealed.address, ...(demoFault ? { demoFault } : {}) }, chainBountyReader(quorum, sealed.address, cache),
        new DeterministicProtocolCipher(), runner(), blocks, now,
      );
      const refuter = new RefutationService(kit, { sealedBounty: sealed.address }, chainRefuteReader(quorum, sealed.address, registry.address, cache), new DeterministicProtocolCipher(), runner());
      return { op, kit, app: createSealedBountyApp({ kit, service, refuter, attest }), url: `https://enclave-${op.toLowerCase()}.example` };
    };
    const nodes = [node("A", "inflate-loss"), node("B"), node("C")];
    for (const n of nodes) {
      const anchorR = (await pub.getBlockNumber()) - 1n;
      const a = await n.kit.attest({ operator: acct[n.op].address, anchorR });
      const reportData = toHex(toBytes(a.quote).slice(12, 76)); // the simulated quote carries REPORTDATA after its marker
      await send("deployer", mod, "setMeasurements", [a.quote, { ...M, reportData }]);
      await send(n.op, registry, "registerEnclave", [PRODUCT, a.quote, anchorR, a.signer, a.x25519, "0x"]);
    }
    const fetchFn = (async (u: any, init?: any) => {
      const href = String(u);
      const n = nodes.find((x) => href.startsWith(x.url));
      if (!n) throw new Error(`unknown host ${href}`);
      return n.app.request(href.slice(n.url.length), init);
    }) as typeof fetch;
    const health = (await (await fetchFn(`${nodes[0]!.url}/health`)).json()) as any;
    expect(health.demoFault).toBe("inflate-loss");
    expect(((await (await fetchFn(`${nodes[1]!.url}/health`)).json()) as any).demoFault).toBeUndefined();

    const dep: sdk.Deployment = {
      version: "v2", chainId: CHAIN_ID, deployBlock: 0n, usdc: usdc.address, erc8004Validation: validation.address, erc8004Identity: identity.address,
      history: HISTORY, attestationModule: mod.address, productRegistry: products.address, operatorBond: bond.address, enclaveRegistry: registry.address,
      verdictLog: verdict.address, sessionPay: zeroAddress, sealedBounty: sealed.address, x402Settler: zeroAddress, demoVault: zeroAddress, attestation: "dev",
    };

    // ---- the protocol: a DemoVault funded with 1 USDC, a bounty (pool 1 USDC, tier 0.5 USDC for a loss ≥ 1 USDC) ----
    const vault = await deploy("DemoVault", "DemoVault", [usdc.address]);
    await send("deployer", usdc, "mint", [vault.address, USDC6]);
    await send("deployer", usdc, "mint", [acct.deployer.address, 10n * USDC6]);
    const protoPriv = x25519.utils.randomPrivateKey();
    const protoPub = toHex(x25519.getPublicKey(protoPriv));
    const predicate: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: usdc.address, holder: vault.address, min: USDC6.toString() }] };
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const validBefore = now() + 3_600n;
    const authSig = await acct.deployer.signTypedData({
      domain: { name: "USD Coin", version: "2", chainId: CHAIN_ID, verifyingContract: usdc.address },
      types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
      primaryType: "ReceiveWithAuthorization", message: { from: acct.deployer.address, to: sealed.address, value: USDC6, validAfter: 0n, validBefore, nonce },
    });
    const created = await send("deployer", sealed, "createBounty", [{
      productId: PRODUCT, predicateHash: predicateHash(predicate), protocolX25519: protoPub, tierMinLoss: [USDC6], tierAmount: [USDC6 / 2n],
      singleCap: USDC6 / 2n, k: 1, targetToPause: vault.address, deadline: now() + 7n * 86_400n, funding: USDC6,
      auth: { validAfter: 0n, validBefore, nonce, signature: authSig },
    }]);
    const bountyId = (parseEventLogs({ abi: sealed.abi, logs: created.logs, eventName: "BountyCreated" })[0] as any).args.bountyId as bigint;
    for (let i = 0; i < 3; i++) await rpc("evm_mine", []); // block N (head − 2) sees the funded vault and the registered enclaves

    // ---- the hunter: A's key verified on-chain, sealed exploit (DemoVault.migrate(hunter)), A's claim ----
    const liarKeys = await sdk.verifyEnclaveKeys(nodes[0]!.url, PRODUCT, { publicClient: pub as any, deployment: dep, fetch: fetchFn });
    expect(liarKeys.operator).toBe(acct.A.address);
    const exploit = { predicate, txs: [encodeExploitTx({ to: vault.address, data: encodeFunctionData({ abi: parseAbi(["function migrate(address to)"]), functionName: "migrate", args: [acct.hunter.address] }) })], capital: 0n };
    const r = crypto.getRandomValues(new Uint8Array(32));
    const sealedExploit = await sdk.sealExploitForEnclave({ bountyId, payee: acct.hunter.address, exploit, protocolX25519: protoPub, enclave: liarKeys, r });
    const proven = await sdk.submitSealedExploit(sealedExploit, { sealedBounty: sealed.address, chainId: CHAIN_ID, fetch: fetchFn });
    expect(proven.claim.loss).toBe(2n * USDC6); // the vault holds only 1 USDC: the loss is doubled
    expect(proven.claim.tier).toBe(0);
    const accepted0 = await send("hunter", sealed, "acceptClaim", [proven.claim, [proven.signature]]);
    const ev = parseEventLogs({ abi: sealed.abi, logs: accepted0.logs, eventName: "ClaimAccepted" })[0] as any;
    expect(ev.args.operators).toEqual([acct.A.address]);
    expect(ev.args.amount).toBe(USDC6 / 2n);
    const digest = ev.args.claimDigest as Hex;

    // ---- before delivery: the protocol requests the refutation (source "protocol": cP + this report's secret) ----
    let fresh = await pub.getBlockNumber({ cacheTime: 0 });
    while (fresh < accepted0.blockNumber) { await new Promise((r) => setTimeout(r, 100)); fresh = await pub.getBlockNumber({ cacheTime: 0 }); }
    const accepted = await sdk.readAcceptedClaim(pub as any, { claimDigest: digest, deployment: dep, fromBlock: accepted0.blockNumber, toBlock: fresh } as any);
    const round = await sdk.requestRefutations({
      accepted, source: sdk.protocolRefuteSource({ cP: proven.cP, protocolPrivateKey: protoPriv }), enclaveUrls: nodes.map((n) => n.url),
      productId: PRODUCT, protocolX25519: protoPub, publicClient: pub as any, deployment: dep, fetch: fetchFn,
    });
    expect(round.results.map((x) => x.status)).toEqual(["excluded", "refuted", "refuted"]);
    expect(round.status).toBe("ready");
    const f = round.refutation!;
    expect(f).toEqual({ claimDigest: digest, proven: true, loss: USDC6, tier: 0 }); // the real loss, measured by B and C
    expect(round.refuters).toEqual([acct.B.address, acct.C.address]);
    expect(round.results[1]!.replay).toMatchObject({ replayed: true, satisfied: true, loss: USDC6, tier: 0, blockN: proven.claim.blockN });

    // ---- the contract itself: a single operator, or the claim's operator → refused; B + C → refuted ----
    const [sigB, sigC] = round.signatures!;
    const asDeployer = (args: unknown[]) => pub.simulateContract({ account: acct.deployer, address: sealed.address, abi: sealed.abi, functionName: "refute", args } as any);
    await expect(asDeployer([proven.claim, [acct.A.address], f, [sigB]])).rejects.toThrow(/NeedMoreRefuters/);
    await expect(asDeployer([proven.claim, [acct.A.address], f, [sigB, sigB]])).rejects.toThrow(/NeedMoreRefuters/);
    const sigA = await privateKeyToAccount(nodes[0]!.kit.keys.signerPrivateKey).signTypedData({
      domain: domain({ chainId: CHAIN_ID, verifyingContract: sealed.address }), types: refutationTypes, primaryType: "Refutation", message: f,
    });
    await expect(asDeployer([proven.claim, [acct.A.address], f, [sigA, sigB, sigC]])).rejects.toThrow(/RefuterIsClaimOperator/);
    await expect(asDeployer([proven.claim, [acct.A.address], { ...f, loss: proven.claim.loss }, [sigB, sigC]])).rejects.toThrow(/NotARefutation/);

    const before = {
      bondA: (await read(bond, "bondOf", [acct.A.address])) as bigint,
      pool: ((await read(sealed, "getBounty", [bountyId])) as any).balance as bigint,
      deployerUsdc: (await read(usdc, "balanceOf", [acct.deployer.address])) as bigint,
      pending: ((await read(sealed, "pendingOf", [bountyId, proven.claim.fingerprint])) as any).payee as Address,
    };
    expect(before.bondA).toBe(USDC6);
    expect(before.pool).toBe(USDC6 - (USDC6 / 2n) * 115n / 100n); // 0.5 USDC + 10 % network + 5 % operators reserved
    expect(before.pending).toBe(acct.hunter.address);

    const call = sdk.prepareRefuteCall(accepted, round, dep);
    const rr = await send("deployer", sealed, call.functionName, [...call.args]);
    const refutedEv = parseEventLogs({ abi: sealed.abi, logs: rr.logs, eventName: "ClaimRefuted" })[0] as any;
    expect(refutedEv.args).toMatchObject({ bountyId, claimDigest: digest, reporter: acct.deployer.address });
    const slashed = parseEventLogs({ abi: bond.abi, logs: rr.logs, eventName: "Slashed" })[0] as any;
    expect(slashed.args).toMatchObject({ operator: acct.A.address, reporter: acct.deployer.address, victim: acct.deployer.address, amount: USDC6 });
    const recorded = parseEventLogs({ abi: verdict.abi, logs: rr.logs, eventName: "Recorded" })[0] as any;
    const requestHash = keccak256(encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "string" }, { type: "uint256" }, { type: "bytes32" }],
      [BigInt(CHAIN_ID), sealed.address, "refuted", bountyId, digest],
    ));
    expect(recorded.args).toMatchObject({ agentId: agentId.A, requestHash, response: 0, tag: "tdx-dcap/refuted" });
    expect(parseEventLogs({ abi: sealed.abi, logs: rr.logs, eventName: "VerdictSkipped" })).toEqual([]);

    expect(await read(bond, "bondOf", [acct.A.address])).toBe(0n);
    expect(await read(bond, "banned", [acct.A.address])).toBe(true);
    expect(await read(bond, "bondOf", [acct.B.address])).toBe(USDC6); // the refuters keep their bond
    expect(((await read(sealed, "getBounty", [bountyId])) as any).balance).toBe(USDC6); // payment returned to the pool
    expect(((await read(sealed, "pendingOf", [bountyId, proven.claim.fingerprint])) as any).payee).toBe(zeroAddress);
    expect((await read(usdc, "balanceOf", [acct.deployer.address])) - before.deployerUsdc).toBe(USDC6); // ½ reporter + ½ protocol
    expect(((await read(sealed, "claimRecords", [digest])) as any)[1]).toBe(true);
    // nothing left to deliver or refute
    await expect(pub.simulateContract({ account: acct.hunter, address: sealed.address, abi: sealed.abi, functionName: "deliver", args: [bountyId, proven.claim.fingerprint, proven.cP] } as any)).rejects.toThrow(/NothingToDeliver/);
    await expect(asDeployer([...call.args])).rejects.toThrow(/AlreadyRefuted/);
    // the signatures are indeed enclaves B's and C's (over the digest the contract recovers)
    const d = sdk.refutationDigestOf(sealed.address, f, CHAIN_ID);
    expect((await recoverAddress({ hash: d, signature: sigB! })).toLowerCase()).toBe(nodes[1]!.kit.keys.signer.toLowerCase());
    expect((await recoverAddress({ hash: d, signature: sigC! })).toLowerCase()).toBe(nodes[2]!.kit.keys.signer.toLowerCase());
    expect(getAddress(slashed.args.operator)).not.toBe(getAddress(acct.B.address));
  }, 240_000);
});
