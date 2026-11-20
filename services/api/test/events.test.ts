/** events.test.ts — the event index and what the API derives from it (v2.1 stack), with no network: a stub RPC returns
 *  logs encoded by viem with the contracts' ABI; no transaction.
 *  - the index decodes the v2.1 events (EnclaveImage, VerdictNotApplicable, VerdictSkipped, RequestHashSalted,
 *    ManifestURIUpdateProposed / ManifestURIUpdated) and the x402 settlement (CallSettled); it is rebuilt from scratch
 *    when the set of events or the start block changes;
 *  - the outcome of each session's verdict: written (salted or not), not applicable, skipped (reason decoded), none, pending;
 *  - the session the proof chain shows; the /activity labels; the index's start block.
 *  Run: cd services/api && npx tsx --test test/events.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, encodeErrorResult, encodeEventTopics, parseAbi, toHex, type Abi, type Address, type Hex } from "viem";
import { EventIndexer, abiFingerprint, type Ev } from "../src/indexer";
import { EVENTS, decodeSkipReason, eventLabel, indexStartBlock, proofVerdict, sessionVerdicts } from "../src/events";

const A = {
  EnclaveRegistry: "0x1000000000000000000000000000000000000001",
  SessionPay: "0x1000000000000000000000000000000000000002",
  SealedBounty: "0x1000000000000000000000000000000000000003",
  VerdictLog: "0x1000000000000000000000000000000000000004",
  X402Settler: "0x1000000000000000000000000000000000000005",
  ProductRegistry: "0x1000000000000000000000000000000000000006",
} as const satisfies Record<string, Address>;
const SIGNER = "0x2000000000000000000000000000000000000001";
const OP = "0x2000000000000000000000000000000000000002";
const PAYER = "0x2000000000000000000000000000000000000003";
const h = (n: number) => toHex(n, { size: 32 });

type RawLog = { address: Address; topics: Hex[]; data: Hex; blockNumber: bigint; logIndex: number; transactionHash: Hex };
/** a log as eth_getLogs returns it: topics and data encoded with the ABI of the API's events */
function log(address: Address, eventName: string, args: Record<string, unknown>, block: number, logIndex: number, tx: Hex): RawLog {
  const ev = (EVENTS as Abi).find((x) => x.type === "event" && x.name === eventName) as Extract<Abi[number], { type: "event" }>;
  const topics = encodeEventTopics({ abi: [ev], eventName, args: Object.fromEntries(ev.inputs.filter((i) => i.indexed).map((i) => [i.name!, args[i.name!]])) } as any) as Hex[];
  const plain = ev.inputs.filter((i) => !i.indexed);
  const data = plain.length ? encodeAbiParameters(plain, plain.map((i) => args[i.name!]) as any) : "0x";
  return { address, topics, data, blockNumber: BigInt(block), logIndex, transactionHash: tx };
}
function fakeRpc(logs: RawLog[], head: number) {
  let calls = 0;
  return {
    calls: () => calls,
    pub: {
      getBlockNumber: async () => BigInt(head),
      getLogs: async ({ fromBlock, toBlock, address }: { fromBlock: bigint; toBlock: bigint; address: Address[] }) => {
        calls++;
        const want = new Set(address.map((a) => a.toLowerCase()));
        return logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock && want.has(l.address.toLowerCase()));
      },
    },
  };
}

const TX = { reg: h(0xa1), closeOk: h(0xa2), closeSalted: h(0xa3), closeSkip: h(0xa4), closeNA: h(0xa5), x402: h(0xa6), manifest: h(0xa7), twoClosings: h(0xa8), closeNone: h(0xa9) };
const ALREADY_RECORDED = encodeErrorResult({ abi: parseAbi(["error AlreadyRecorded()"]), errorName: "AlreadyRecorded" });
const LOGS: RawLog[] = [
  log(A.EnclaveRegistry, "EnclaveImage", { signer: SIGNER, productId: 1n, imageId: h(7), composeHash: h(8), osImageHash: h(9) }, 1000, 0, TX.reg),
  log(A.EnclaveRegistry, "EnclaveRegistered", { signer: SIGNER, productId: 1n, operator: OP, workloadId: h(7), expiresAt: 99n }, 1000, 1, TX.reg),
  ...[1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n].map((id, i) => log(A.SessionPay, "SessionOpened", { sessionId: id, owner: PAYER, productId: 1n, deposit: 2_000_000n }, 1001 + i, 0, h(0xb0 + i))),
  // session 1: verdict written (100)
  log(A.VerdictLog, "Recorded", { agentId: 897812n, requestHash: h(11), response: 100, tag: "tdx-dcap/inference" }, 1100, 3, TX.closeOk),
  log(A.SessionPay, "SessionClosed", { sessionId: 1n, refund: 500_000n }, 1100, 4, TX.closeOk),
  // session 2: hash already taken, written under a salted hash
  log(A.VerdictLog, "RequestHashSalted", { requestHash: h(12), saltedHash: h(13) }, 1200, 2, TX.closeSalted),
  log(A.VerdictLog, "Recorded", { agentId: 897812n, requestHash: h(13), response: 100, tag: "tdx-dcap/inference" }, 1200, 3, TX.closeSalted),
  log(A.SessionPay, "SessionClosed", { sessionId: 2n, refund: 0n }, 1200, 4, TX.closeSalted),
  // session 3: write refused by the registry (VerdictSkipped, reason AlreadyRecorded())
  log(A.SessionPay, "VerdictSkipped", { requestHash: h(14), reason: ALREADY_RECORDED }, 1300, 1, TX.closeSkip),
  log(A.SessionPay, "SessionClosed", { sessionId: 3n, refund: 1_000_000n }, 1300, 2, TX.closeSkip),
  // session 4: closed without any payment: nothing to attest
  log(A.SessionPay, "VerdictNotApplicable", { sessionId: 4n }, 1400, 0, TX.closeNA),
  log(A.SessionPay, "SessionClosed", { sessionId: 4n, refund: 2_000_000n }, 1400, 1, TX.closeNA),
  // sessions 5 and 6 closed in ONE transaction (a wallet that batches): 5 not applicable, 6 written
  log(A.SessionPay, "VerdictNotApplicable", { sessionId: 5n }, 1500, 0, TX.twoClosings),
  log(A.SessionPay, "SessionClosed", { sessionId: 5n, refund: 2_000_000n }, 1500, 1, TX.twoClosings),
  log(A.VerdictLog, "Recorded", { agentId: 897812n, requestHash: h(16), response: 100, tag: "tdx-dcap/inference" }, 1500, 2, TX.twoClosings),
  log(A.SessionPay, "SessionClosed", { sessionId: 6n, refund: 0n }, 1500, 3, TX.twoClosings),
  // session 7: closed with no verdict and no event (v2 stack, operator banned…)
  log(A.SessionPay, "SessionClosed", { sessionId: 7n, refund: 0n }, 1550, 0, TX.closeNone),
  // session 8: still open
  log(A.X402Settler, "CallSettled", { productId: 3n, payer: PAYER, operator: OP, amount: 1_000n, nonce: h(21) }, 1600, 0, TX.x402),
  log(A.ProductRegistry, "ManifestURIUpdateProposed", { productId: 1n, manifestURI: "https://example.test/m2.json", applyAt: 123n }, 1700, 0, TX.manifest),
  log(A.ProductRegistry, "ManifestURIUpdated", { productId: 1n, manifestURI: "https://example.test/m2.json" }, 1700, 1, TX.manifest),
];

const dir = mkdtempSync(join(tmpdir(), "archive-events-test-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const indexer = (file: string, rpc: ReturnType<typeof fakeRpc>, fromBlock = 900n, abi: Abi = EVENTS as Abi) =>
  new EventIndexer({ pub: rpc.pub as any, chainId: 5042002, contracts: A, abi, fromBlock, file, chunk: 250n, log: () => {} });

test("index: v2.1 events and x402 settlements are decoded, newest first, and stored", async () => {
  const rpc = fakeRpc(LOGS, 1800);
  const file = join(dir, "a.json");
  const idx = indexer(file, rpc);
  await idx.sync(0);
  const ev = idx.events();
  assert.equal(ev.length, LOGS.length, "no event lost (all in the API's ABI)");
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i - 1]!.block > ev[i]!.block || (ev[i - 1]!.block === ev[i]!.block && ev[i - 1]!.logIndex > ev[i]!.logIndex));
  const by = (n: string) => ev.filter((e) => e.name === n);
  assert.equal(by("EnclaveImage")[0]?.args.imageId, h(7));
  assert.equal(by("EnclaveImage")[0]?.contract, "EnclaveRegistry");
  assert.equal(by("VerdictNotApplicable").length, 2);
  assert.equal(by("VerdictSkipped")[0]?.args.reason, ALREADY_RECORDED);
  assert.equal(by("RequestHashSalted")[0]?.args.saltedHash, h(13));
  assert.equal(by("ManifestURIUpdated")[0]?.args.manifestURI, "https://example.test/m2.json");
  assert.equal(by("ManifestURIUpdateProposed")[0]?.args.applyAt, "123", "integers are returned as strings (safe JSON)");
  assert.equal(by("CallSettled")[0]?.contract, "X402Settler");
  assert.equal(by("CallSettled")[0]?.args.amount, "1000");
  assert.equal(idx.status().fromBlock, 900);
  assert.equal(idx.status().lastBlock, 1800);

  // a restart picks up the file and reads nothing again
  const again = fakeRpc(LOGS, 1800);
  const idx2 = indexer(file, again);
  assert.equal(idx2.events().length, LOGS.length);
  await idx2.sync(0);
  assert.equal(again.calls(), 0, "no chunk read again: the index is up to date");
});

test("index: rebuilt from scratch when the known events or the start block change (and for a v1 file)", async () => {
  const file = join(dir, "b.json");
  const OLD = (EVENTS as Abi).filter((x) => !(x.type === "event" && ["EnclaveImage", "VerdictNotApplicable", "VerdictSkipped", "RequestHashSalted", "ManifestURIUpdateProposed", "ManifestURIUpdated"].includes(x.name)));
  assert.notEqual(abiFingerprint(OLD), abiFingerprint(EVENTS as Abi));
  // an index kept with the old ABI (v2) skipped the v2.1 events of the blocks already read…
  const before = indexer(file, fakeRpc(LOGS, 1800), 900n, OLD);
  await before.sync(0);
  assert.equal(before.events().filter((e) => e.name === "VerdictNotApplicable").length, 0);
  // … with the new ABI, it is rebuilt from zero: nothing is lost
  const after = indexer(file, fakeRpc(LOGS, 1800));
  assert.equal(after.events().length, 0, "a file from another ABI: ignored");
  await after.sync(0);
  assert.equal(after.events().filter((e) => e.name === "VerdictNotApplicable").length, 2);
  // another start block: rebuilt too
  const moved = indexer(file, fakeRpc(LOGS, 1800), 1200n);
  assert.equal(moved.events().length, 0);
  await moved.sync(0);
  assert.ok(moved.events().every((e) => e.block >= 1200));
  // a v1 file (before the fingerprint): rebuilt
  const v1 = join(dir, "c.json");
  writeFileSync(v1, JSON.stringify({ version: 1, chainId: 5042002, contracts: Object.fromEntries(Object.entries(A).map(([n, a]) => [n, a.toLowerCase()])), lastBlock: 1800, events: [] }));
  const fromV1 = indexer(v1, fakeRpc(LOGS, 1800));
  assert.equal(fromV1.status().lastBlock, 899);
  await fromV1.sync(0);
  assert.equal(fromV1.events().length, LOGS.length);
  assert.equal(JSON.parse(readFileSync(v1, "utf8")).version, 2);
});

test("each session's verdict: written (salted or not), not applicable, skipped with its reason, none, pending", async () => {
  const idx = indexer(join(dir, "d.json"), fakeRpc(LOGS, 1800));
  await idx.sync(0);
  const v = sessionVerdicts(idx.events());
  assert.deepEqual({ ...v.get("1"), block: undefined }, { sessionId: "1", outcome: "written", tx: TX.closeOk, block: undefined, agentId: "897812", response: 100, requestHash: h(11), salted: false });
  assert.equal(v.get("2")?.outcome, "written");
  assert.equal(v.get("2")?.salted, true, "written under the salted hash (RequestHashSalted)");
  assert.equal(v.get("2")?.requestHash, h(13));
  assert.equal(v.get("3")?.outcome, "skipped");
  assert.equal(v.get("3")?.reason, "AlreadyRecorded()");
  assert.equal(v.get("3")?.reasonData, ALREADY_RECORDED);
  assert.equal(v.get("4")?.outcome, "not_applicable");
  assert.equal(v.get("5")?.outcome, "not_applicable", "two closings in one transaction stay distinct");
  assert.equal(v.get("6")?.outcome, "written");
  assert.equal(v.get("7")?.outcome, "none");
  assert.deepEqual(v.get("8"), { sessionId: "8", outcome: "pending", tx: null, block: null });
  // the order of the events received changes nothing
  const shuffled = sessionVerdicts([...idx.events()].reverse());
  assert.deepEqual([...shuffled.entries()].sort(), [...v.entries()].sort());
});

test("reason for a skipped verdict: known error, Error(string), empty revert, unknown bytes, unreadable data", () => {
  assert.equal(decodeSkipReason(ALREADY_RECORDED), "AlreadyRecorded()");
  assert.equal(decodeSkipReason(encodeErrorResult({ abi: parseAbi(["error Error(string)"]), errorName: "Error", args: ["registry paused"] })), "Error(registry paused)");
  assert.equal(decodeSkipReason("0x"), "empty revert (no reason given)");
  assert.equal(decodeSkipReason("0xdeadbeef"), "0xdeadbeef");
  assert.equal(decodeSkipReason(42), "unreadable revert data");
});

test("proof chain: the written verdict of a served session first; otherwise why not; otherwise pending", async () => {
  const idx = indexer(join(dir, "e.json"), fakeRpc(LOGS, 1800));
  await idx.sync(0);
  const v = sessionVerdicts(idx.events());
  // served: a payment settled on a receipt of the enclave (1, 2, 3); closed without payment and locked to it (4)
  assert.equal(proofVerdict(v, new Set(["1", "2", "3"]), new Set(["4"]), "3")?.sessionId, "2", "the most recent written verdict");
  assert.equal(proofVerdict(v, new Set(["3"]), new Set(["4"]), "3")?.outcome, "not_applicable", "otherwise the most recent closing (4 after 3)");
  const skipped = proofVerdict(v, new Set(["3"]), new Set(), "3");
  assert.equal(skipped?.outcome, "skipped");
  assert.equal(skipped?.reason, "AlreadyRecorded()");
  assert.equal(proofVerdict(v, new Set(["8"]), new Set(), "8")?.outcome, "pending", "settled session still open");
  assert.equal(proofVerdict(v, new Set(), new Set(), null), null);
  // a not-applicable session is never "written" for the chain, even if it is the most recent
  assert.equal(proofVerdict(v, new Set(["1"]), new Set(["5"]), "1")?.outcome, "written");
});

test("/activity labels: every known event has an English sentence; an unknown one keeps its name", async () => {
  const idx = indexer(join(dir, "f.json"), fakeRpc(LOGS, 1800));
  await idx.sync(0);
  const one = (n: string) => eventLabel(idx.events().find((e) => e.name === n)!);
  assert.equal(one("VerdictNotApplicable"), "Session #5 closed without payment: no verdict to write");
  assert.equal(one("VerdictSkipped"), "ERC-8004 verdict skipped (SessionPay): AlreadyRecorded()");
  assert.match(one("EnclaveImage"), /^Enclave image fingerprint recorded \(product #1, image 0x000000…0007\)$/);
  assert.equal(one("RequestHashSalted"), "Verdict request hash was taken: written under a salted hash");
  assert.equal(one("ManifestURIUpdated"), "Product #1 manifest URI changed: https://example.test/m2.json");
  assert.equal(one("CallSettled"), "Pay-per-call settled (x402): 0.001 USDC (product #3)");
  for (const e of idx.events()) assert.notEqual(eventLabel(e), e.name, `missing label: ${e.name}`);
  const unknown: Ev = { contract: "X", name: "Mystery", args: {}, block: 1, logIndex: 0, tx: h(1) };
  assert.equal(eventLabel(unknown), "Mystery");
  // every entry of the ABI has a label
  for (const x of EVENTS as Abi) {
    if (x.type !== "event") continue;
    const e: Ev = { contract: "SessionPay", name: x.name, args: {}, block: 1, logIndex: 0, tx: h(1) };
    assert.notEqual(eventLabel(e), x.name, `missing label: ${x.name}`);
  }
});

test("index start block: the deployment's when known, otherwise INDEX_FROM_BLOCK, otherwise 0", () => {
  assert.deepEqual(indexStartBlock(71481927n, "5"), { block: 71481927n, source: "deployment" });
  assert.deepEqual(indexStartBlock(0n, "71000000"), { block: 71000000n, source: "env" });
  assert.deepEqual(indexStartBlock(undefined, " 42 "), { block: 42n, source: "env" });
  assert.deepEqual(indexStartBlock(0n, "abc"), { block: 0n, source: "genesis" });
  assert.deepEqual(indexStartBlock(null, undefined), { block: 0n, source: "genesis" });
  // the v2.1 deployment file does carry its block
  const d = JSON.parse(readFileSync(new URL("../../../deployments.v21.testnet.json", import.meta.url), "utf8"));
  assert.deepEqual(indexStartBlock(BigInt(d.deployBlock)), { block: 71481927n, source: "deployment" });
});
