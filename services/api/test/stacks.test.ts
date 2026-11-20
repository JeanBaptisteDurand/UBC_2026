/** stacks.test.ts — the stacks the API reads (src/stacks.ts): the live stack from DEPLOYMENTS (v3, its product
 *  numbers: the verified Sealed Bounty is product 5), the previous stack v2.1 read only with the index files the API
 *  already keeps, and how /stats and /activity put the two together. Pure functions: no network.
 *  Run: cd services/api && npx tsx --test test/stacks.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testnet } from "@arcvault/sdk";
import {
  CUMULATIVE_STATS, equivalentProducts, indexSpecs, loadStacks, mergeByBlock, mergeStats, parseStack, railOf, stackName, stackValues,
  supersededBounties, tagEvent, withLevelsFromContracts,
} from "../src/stacks";
import { EventIndexer, abiFingerprint } from "../src/indexer";
import { EVENTS, EVENTS_LEVELS } from "../src/events";

// the two deployment records of the repository, as the API reads them
const json = (f: string) => JSON.parse(readFileSync(new URL(`../../../${f.startsWith("docs/") ? "" : "docs/history/"}${f}`, import.meta.url), "utf8"));
const v3 = json("deployments.v3.testnet.json");
const v21 = json("deployments.v21.testnet.json");

const V3_PATH = "/deploy/deployments.v3.testnet.json";
const files: Record<string, unknown> = { [V3_PATH]: v3, "/deploy/deployments.v21.testnet.json": v21 };
const read = (p: string) => { if (!(p in files)) throw new Error(`no file ${p}`); return files[p]; };
const lower = (x: string) => x.toLowerCase();

test("stack names come from the deployment file's version", () => {
  assert.equal(stackName(v3, "x"), "v3");
  assert.equal(stackName(v21, "x"), "v2.1");
  assert.equal(stackName({ version: "v4" }, "x"), "v4");
  assert.equal(stackName({}, "fallback"), "fallback");
  assert.equal(stackName({ version: "three" }, "fallback"), "fallback");
});

test("without DEPLOYMENTS: the SDK's v2.1 stack, as before, and no previous stack", () => {
  const s = loadStacks({}, read, v21);
  assert.equal(s.live.name, "v2.1");
  assert.equal(s.live.d, testnet);
  assert.equal(s.history, null);
  // DEPLOYMENTS naming the v2.1 file is the same stack: no previous stack either
  const t = loadStacks({ DEPLOYMENTS: "/deploy/deployments.v21.testnet.json" }, read, v21);
  assert.equal(lower(t.live.d.enclaveRegistry), lower(testnet.enclaveRegistry));
  assert.equal(t.history, null);
});

test("DEPLOYMENTS = the v3 file: the live stack is v3 with its levels, the previous one is v2.1, read only", () => {
  const s = loadStacks({ DEPLOYMENTS: ` ${V3_PATH} ` }, read, v21);
  assert.equal(s.live.name, "v3");
  assert.equal(s.live.live, true);
  assert.equal(s.live.source, V3_PATH);
  const C = (v3 as any).contracts;
  assert.equal(s.live.d.enclaveRegistry, C.EnclaveRegistry);
  assert.equal(s.live.d.sessionPay, C.SessionPay);
  assert.equal(s.live.d.sealedBounty, C.SealedBounty);
  assert.equal(s.live.d.x402Settler, C.X402Settler);
  assert.equal(s.live.d.deployBlock, 73075189n);
  assert.equal(s.live.d.levels?.sealedBountyVerified, C.SealedBountyVerified);
  assert.equal(s.live.d.levels?.machineRegistry, C.MachineRegistry);
  // reference products from the settlements: the inference is 1, the open bounty 2, pay per call 3
  assert.deepEqual(s.live.d.products, { inference: 1n, bounty: 2n, x402: 3n });
  assert.ok(s.history);
  assert.equal(s.history!.name, "v2.1");
  assert.equal(s.history!.live, false);
  assert.equal(s.history!.d, testnet);
  assert.deepEqual(s.notes, []);
  // HISTORY=off: the live stack alone
  assert.equal(loadStacks({ DEPLOYMENTS: V3_PATH, HISTORY: "off" }, read, v21).history, null);
  // an unreadable file stops the API (never a silent fallback to another stack)
  assert.throws(() => loadStacks({ DEPLOYMENTS: "/deploy/missing.json" }, read, v21), /no file/);
});

test("a v3 file without its levels block keeps the verified level: the five levels contracts come from `contracts`", () => {
  const { levels: _drop, ...bare } = v3 as any;
  files["/deploy/bare.json"] = bare;
  const w = withLevelsFromContracts(bare);
  assert.equal(w.filled, true);
  for (const k of ["MachineRegistry", "ProofOfCloudAuditor", "Ed25519Verifier", "PolicyEnclaves", "SealedBountyVerified"]) {
    assert.equal(w.json.levels[k], (v3 as any).contracts[k], k);
  }
  const s = loadStacks({ DEPLOYMENTS: "/deploy/bare.json" }, read, v21);
  assert.equal(s.live.d.levels?.sealedBountyVerified, (v3 as any).contracts.SealedBountyVerified);
  assert.match(s.notes.join(" "), /no levels block/);
  // a file that has its levels block is left as it is
  assert.equal(withLevelsFromContracts(v3).filled, false);
  assert.equal(withLevelsFromContracts(v3).json, v3);
  // a file missing one levels contract is not completed (and says that the verified level is not read)
  const { SealedBountyVerified: _x, ...fewer } = bare.contracts;
  files["/deploy/fewer.json"] = { ...bare, contracts: fewer, products: { ...bare.products } };
  assert.equal(withLevelsFromContracts(files["/deploy/fewer.json"]).filled, false);
  const f = loadStacks({ DEPLOYMENTS: "/deploy/fewer.json" }, read, v21);
  assert.equal(f.live.d.levels, undefined);
  assert.match(f.notes.join(" "), /verified level is not read/);
});

test("v3 product numbering: product 5 is the verified Sealed Bounty, and v2.1's product 7 continues there", () => {
  const s = loadStacks({ DEPLOYMENTS: V3_PATH }, read, v21);
  const P = (v3 as any).products;
  const none = new Set<string>();
  assert.deepEqual(railOf(s.live.d, none, P["1"].settlementAddress), { rail: "session" });
  assert.deepEqual(railOf(s.live.d, none, P["2"].settlementAddress), { rail: "bounty", level: "open" });
  assert.deepEqual(railOf(s.live.d, none, P["3"].settlementAddress), { rail: "x402" });
  assert.deepEqual(railOf(s.live.d, none, "0x0000000000000000000000000000000000000000"), { rail: "free" });
  assert.deepEqual(railOf(s.live.d, none, P["5"].settlementAddress), { rail: "bounty", level: "verified" });
  // never mixed: a v2.1 contract is not a v3 rail, and the other way round
  assert.deepEqual(railOf(s.live.d, none, testnet.sessionPay), { rail: "other" });
  assert.deepEqual(railOf(s.live.d, none, testnet.levels!.sealedBountyVerified), { rail: "other" });
  assert.deepEqual(railOf(testnet, none, P["5"].settlementAddress), { rail: "other" });
  // on v2.1: product 7's contract is the verified bounty, the former product 6's is a superseded bounty
  const sup = supersededBounties(v21);
  assert.ok(sup.size >= 1);
  assert.deepEqual(railOf(testnet, sup, testnet.levels!.sealedBountyVerified), { rail: "bounty", level: "verified" });
  assert.deepEqual(railOf(testnet, sup, [...sup][0]!), { rail: "bounty" });
  assert.equal(supersededBounties(v3).size, 0);
  // previous product → live product, from the v3 record (v21Equivalent): 1-4 the same, 7 → 5; 5 and 6 have none
  const m = equivalentProducts(v3, "v2.1");
  assert.deepEqual(Object.fromEntries(m), { "1": "1", "2": "2", "3": "3", "4": "4", "7": "5" });
  assert.equal(m.has("5"), false);
  assert.equal(m.has("6"), false);
  assert.equal(equivalentProducts(v3, "v2").size, 0);
});

test("the previous stack keeps the index files the v2.1 API already has: same names, contracts and start block", () => {
  const s = loadStacks({ DEPLOYMENTS: V3_PATH }, read, v21);
  const h = indexSpecs(s.history!, "/data", "123");
  // the files the live v2.1 API writes today (/opt/archive/data, read on 20 Nov 2026)
  assert.equal(h.main.file, "/data/events-5042002-f627e7f4.json");
  assert.equal(h.levels?.file, "/data/events-5042002-levels-d671013f.json");
  assert.equal(h.fromBlock, 71481927n);
  assert.equal(h.fromSource, "deployment");
  assert.deepEqual(Object.keys(h.main.contracts), ["EnclaveRegistry", "SessionPay", "SealedBounty", "VerdictLog", "X402Settler", "ProductRegistry"]);
  assert.deepEqual(Object.keys(h.levels!.contracts), ["SealedBountyVerified", "OperatorBond", "MachineRegistry", "ProofOfCloudAuditor"]);
  assert.deepEqual(Object.values(h.main.contracts).map(lower), [
    "0xf627e7f40c7a0f50ba3eaff2d459352edb5dc59d", "0x8bf8a8356f53006e9ab359aa6382f783923058a6", "0x182871d34438ab37a7fd4d8689f3e0812e447a9b",
    "0x2b4ab39b461ae2ba9adfb6bc630d34553bab9779", "0xccdb1a5641f2f3f2cf2112c8e14669dbb6e11634", "0x582a3076cf6a1347907565b57ce9f548d33805a4",
  ]);
  assert.deepEqual(Object.values(h.levels!.contracts).map(lower), [
    "0x36a8ddf9fcb1308b9e86425bec9b098e933c7348", "0xe584f7590e4677372ee6259b967672c747eb6850",
    "0xd671013f556b1272b25e3cc17c889d402f4dc26d", "0xcdc4c150344f06d506deb5500332737e8dcc8fab",
  ]);
  // the ABI fingerprints recorded in those files
  assert.equal(abiFingerprint(EVENTS as any), "905deb4ebc0f4781");
  assert.equal(abiFingerprint([...EVENTS, ...EVENTS_LEVELS] as any), "5fb5b5971da93122");
  // the live v3 stack gets its own files, from the v3 deployment block; INDEX_FROM_BLOCK never moves it
  const l = indexSpecs(s.live, "/data", "123");
  assert.equal(l.main.file, "/data/events-5042002-c854eba7.json");
  assert.equal(l.levels?.file, "/data/events-5042002-levels-c64e9556.json");
  assert.equal(l.fromBlock, 73075189n);
  // a live stack without a deployment block starts at INDEX_FROM_BLOCK; a previous stack never reads it
  assert.deepEqual([indexSpecs({ live: true, d: { ...s.live.d, deployBlock: 0n } }, "/d", "123").fromBlock], [123n]);
  assert.equal(indexSpecs({ live: false, d: { ...s.live.d, deployBlock: 0n } }, "/d", "123").fromSource, "genesis");
});

test("an index file with those names, contracts, ABI and start block is reused as it is (nothing read again)", () => {
  const dir = mkdtempSync(join(tmpdir(), "archive-stacks-"));
  try {
    const s = loadStacks({ DEPLOYMENTS: V3_PATH }, read, v21);
    const h = indexSpecs(s.history!, dir);
    const ev = { contract: "SessionPay", name: "SessionOpened", args: { sessionId: "3", owner: "0x1", productId: "1", deposit: "100" }, block: 73100000, logIndex: 2, tx: "0xabc" };
    writeFileSync(h.main.file, JSON.stringify({
      version: 2, chainId: 5042002, contracts: Object.fromEntries(Object.entries(h.main.contracts).map(([k, v]) => [k, lower(v)])),
      abi: abiFingerprint(EVENTS as any), fromBlock: Number(h.fromBlock), lastBlock: 73169006, events: [ev],
    }));
    const idx = new EventIndexer({ pub: {} as any, chainId: 5042002, abi: EVENTS as any, fromBlock: h.fromBlock, file: h.main.file, contracts: h.main.contracts });
    assert.deepEqual(idx.events(), [ev]);
    assert.equal(idx.status().lastBlock, 73169006);
    // the same file under another start block (another stack) is not reused
    const other = new EventIndexer({ pub: {} as any, chainId: 5042002, abi: EVENTS as any, fromBlock: 73075189n, file: h.main.file, contracts: h.main.contracts });
    assert.deepEqual(other.events(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("?stack=: the live stack by default, both on the logs of the past, the previous one by name", () => {
  const N = { live: "v3", history: "v2.1" };
  const route = { allowAll: false, dflt: "live" as const }, log = { allowAll: true, dflt: "all" as const };
  assert.equal(parseStack(undefined, N, route), "live");
  assert.equal(parseStack("", N, route), "live");
  assert.equal(parseStack("v3", N, route), "live");
  assert.equal(parseStack("live", N, route), "live");
  assert.equal(parseStack("v2.1", N, route), "history");
  assert.equal(parseStack("history", N, route), "history");
  assert.equal(parseStack("all", N, route), null); // not on a route that acts on numbers
  assert.equal(parseStack("v2", N, route), null);
  assert.equal(parseStack(undefined, N, log), "all");
  assert.equal(parseStack("all", N, log), "all");
  assert.equal(parseStack("v3", N, log), "live");
  assert.equal(parseStack("v2.1", N, log), "history");
  // without a previous stack: "all" is the live stack, the history does not exist
  const alone = { live: "v2.1", history: null };
  assert.equal(parseStack(undefined, alone, log), "live");
  assert.equal(parseStack("all", alone, log), "live");
  assert.equal(parseStack("history", alone, route), null);
  assert.equal(parseStack("v2.1", alone, route), "live");
  assert.deepEqual(stackValues(N, true), ["v3", "live", "v2.1", "all"]);
  assert.deepEqual(stackValues(N, false), ["v3", "live", "v2.1"]);
  assert.deepEqual(stackValues(alone, true), ["v2.1", "live"]);
});

test("/stats over both stacks: what happened adds up, what the network is now is the live stack's", () => {
  const live = {
    enclaves: 5, enclavesActive: 5, products: 5, productsActive: 5, sessions: 1, settlements: 2, settledUsdc: 30_000n,
    sessionSettledUsdc: 20_000n, refundedUsdc: 0n, x402Calls: 1, x402SettledUsdc: 10_000n, verdicts: 1, verdictsSkipped: 0,
    verdictsNotApplicable: 0, bounties: 0, bountyPool: 0n, bountiesOpen: 0, bountiesByLevel: { open: 0, verified: 0 }, bountiesPaid: 0,
    bountyPaidUsdc: 0n, claimsRefuted: 0, bondSlashedUsdc: 0n, bondPostedUsdc: 10_000_000n, head: 73200000n, index: { lastBlock: 1 },
  };
  const hist = {
    ...live, enclaves: 21, enclavesActive: 5, products: 7, productsActive: 6, sessions: 3, settlements: 3, settledUsdc: 179_200n,
    sessionSettledUsdc: 59_200n, refundedUsdc: 940_800n, x402Calls: 12, x402SettledUsdc: 120_000n, verdicts: 4, bounties: 4,
    bountyPool: 3_000_000n, bountiesPaid: 1, bountyPaidUsdc: 500_000n, claimsRefuted: 1, bondSlashedUsdc: 500_000n, bondPostedUsdc: 40_000_000n,
    head: 73199999n,
  };
  const m = mergeStats(live, hist, { live: "v3", history: "v2.1" }) as any;
  assert.equal(m.stack, "all");
  assert.deepEqual(m.stacks, { live: "v3", history: ["v2.1"] });
  assert.equal(m.sessions, 4);
  assert.equal(m.x402Calls, 13);
  assert.equal(m.verdicts, 5);
  assert.equal(m.settledUsdc, 209_200n);
  assert.equal(m.bountyPaidUsdc, 500_000n);
  assert.equal(m.bondSlashedUsdc, 500_000n);
  assert.equal(m.claimsRefuted, 1);
  // the state: the live stack's (enclaves, products, bounties open now, pool, head, index)
  assert.equal(m.enclaves, 5);
  assert.equal(m.products, 5);
  assert.equal(m.bounties, 0);
  assert.equal(m.bountyPool, 0n);
  assert.equal(m.head, 73200000n);
  assert.deepEqual(m.index, { lastBlock: 1 });
  // each stack alone, named
  assert.equal(m.byStack.v3.sessions, 1);
  assert.equal(m.byStack["v2.1"].sessions, 3);
  assert.equal(m.byStack["v2.1"].stack, "v2.1");
  assert.deepEqual(m.summed, [...CUMULATIVE_STATS]);
  // the summed counters are the cumulative ones only
  for (const k of ["enclaves", "enclavesActive", "products", "productsActive", "bounties", "bountyPool", "bountiesOpen", "head"]) {
    assert.ok(!(CUMULATIVE_STATS as readonly string[]).includes(k), k);
  }
  // already serialised values (strings) add up too
  assert.equal((mergeStats({ settledUsdc: "5" }, { settledUsdc: "7" }, { live: "v3", history: "v2.1" }) as any).settledUsdc, 12n);
  // without a previous stack: the live counters, named
  assert.deepEqual(mergeStats(live, null, { live: "v3", history: null }), { ...live, stack: "v3" });
});

test("/activity over both stacks: one list by block, a v2.1 event says so and names the live product that continues it", () => {
  const live = { name: "v3", live: true, liveProductOf: new Map<string, string>() };
  const prev = { name: "v2.1", live: false, liveProductOf: equivalentProducts(v3, "v2.1") };
  const a = { contract: "EnclaveRegistry", name: "EnclaveRegistered", args: { signer: "0xa", productId: "5" }, block: 73100010, logIndex: 1, tx: "0x1" };
  const t = tagEvent(a, "Enclave 0xa registered (product #5)", live);
  assert.deepEqual(t, { ...a, stack: "v3", label: "Enclave 0xa registered (product #5)" });
  const b = { contract: "SealedBountyVerified", name: "BountyCreated", args: { bountyId: "2", productId: "7" }, block: 73100010, logIndex: 4, tx: "0x2" };
  const tb = tagEvent(b, "Bounty #2 (verified level) posted", prev);
  assert.equal(tb.stack, "v2.1");
  assert.equal(tb.label, "[v2.1] Bounty #2 (verified level) posted");
  assert.equal(tb.liveProductId, "5");
  assert.equal(tb.args.productId, "7"); // as written on Arc
  const demo = tagEvent({ ...b, args: { bountyId: "2", productId: "5" } }, "Claim refuted", prev);
  assert.equal(demo.liveProductId, null); // v2.1's product 5 (the refutation demo) has no v3 successor
  const session = tagEvent({ ...b, name: "Settled", args: { sessionId: "3" } }, "Session #3 settled", prev);
  assert.equal("liveProductId" in session, false);
  const c = { ...a, block: 73000000, logIndex: 9, tx: "0x3" };
  const merged = mergeByBlock([[t], [tb, tagEvent(c, "old", prev)]], 25);
  assert.deepEqual(merged.map((x) => x.tx), ["0x2", "0x1", "0x3"]); // block, then log index inside the block
  assert.deepEqual(mergeByBlock([[t], [tb, tagEvent(c, "old", prev)]], 2).map((x) => x.tx), ["0x2", "0x1"]);
});
