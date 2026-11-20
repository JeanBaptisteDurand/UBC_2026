/** site-live.test.ts — the site copilot's live state (site-live.ts), with a fake local ArcHive API and a fake Arc client
 *  (no network): the LIVE STATUS line (active enclaves per product, verified level, products without an enclave, product
 *  7's settlement, open bounties of both levels), the fallback line when the API is silent, the cache, the line in the
 *  site's prompt (never in the console's) and the site's bounty_list with the verified level.
 *  Run: cd services/copilot && npx tsx --test test/site-live.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { testnet, type ArcClient } from "@arcvault/sdk";
import { getAddress } from "viem";
import { createCopilotApp, type Llm, type LlmRequest } from "../src/app";
import { SITE_SYSTEM } from "../src/copilot";
import { SITE_SURFACE, executeSiteTool } from "../src/site";
import { LIVE_FALLBACK, clearLiveCaches, createLiveNote, readLiveStatus, siteBountyList } from "../src/site-live";
import { clearListCache } from "../src/archive-api";
import { startFakeApi, type Route } from "./helpers";

const SITE = "https://archive.62-171-153-35.sslip.io";
const OP = "0x344f2d2fA5AeAe78871F0B882245069F887c2e1a";
const NOW = 1_795_053_300; // 19/11/2026 01:55 UTC
const hex = (n: number, bytes: number) => `0x${n.toString(16).padStart(bytes * 2, "0")}`;
const addr = (n: number) => hex(n, 20);

function enclave(n: number, productId: number, active: boolean) {
  return {
    signer: addr(0x1000 + n), x25519: hex(n, 32), operator: OP, productId: String(productId), workloadId: hex(n, 32), fmspc: "0x20a06f000000",
    tcbStatus: 0, quoteHash: hex(n, 32), anchorBlock: "72938714", registeredAt: String(NOW - 3_000), expiresAt: String(active ? NOW + 80_000 : NOW - 400_000),
    fromBlock: "72938744", untilBlock: "73108743", active, head: "72945349",
  };
}
function product(id: number) {
  return {
    id: String(id), author: OP, manifestHash: hex(id, 32), deterministic: id === 2 || id === 5 || id === 6 || id === 7, price: "100",
    bpsOperator: 9500, bpsAuthor: 0, bpsNetwork: 500, minBond: "1000000", exposureCap: "1000000", settlement: addr(0x9000 + id), param: "0x",
    version: "1", activatesAt: "0", state: "Active", manifestURI: "",
  };
}
function bounty(id: number, productId: number, deadline: number, balance = "1000000") {
  return {
    id: String(id), protocol: "0x5724d89D610c3017b8DC161c025248341556f6Ab", productId: String(productId), predicateHash: hex(id, 32),
    protocolX25519: hex(id, 32), singleCap: "500000", k: 1, balance, deadline: String(deadline), paused: false,
    targetToPause: "0x250C64fcbb61Ca4B9278330ae3711DCcADD1AB09", paidAmount: "500000", lastPaidBlock: "71584411", pausedFromBlock: "0",
  };
}
/** The state recorded on 19 Nov 2026 at 01:55 UTC: 19 registered enclaves, 4 active (products 7, 1, 2, 3), all at the
 *  verified level; 7 products; two open-level bounties, expired. */
function routes(over: Record<string, Route> = {}): Record<string, Route> {
  const active = [enclave(1, 7, true), enclave(2, 1, true), enclave(3, 2, true), enclave(4, 3, true)];
  const old = Array.from({ length: 15 }, (_, i) => enclave(10 + i, [4, 3, 1, 7, 2, 6, 4, 1, 3, 4, 5, 5, 5, 4, 2][i]!, false));
  return {
    "/enclaves": { body: [...active, ...old] },
    "/products": { body: [1, 2, 3, 4, 5, 6, 7].map(product) },
    "/levels": { body: { enabled: true, verifiedBounty: { canSlash: true }, enclaves: active.map((e) => ({ signer: e.signer, productId: e.productId, level: "verified" })) } },
    "/bounties": { body: [bounty(2, 5, NOW - 180_000), bounty(1, 2, NOW - 200_000, "425000")] },
    "/index": { body: { lastBlock: 72945225, head: 72945225, lagBlocks: 0, lastError: null } },
    ...over,
  };
}

/** A fake Arc client: the verified-level bounty contract (bountyCount, getBounty) and SealedBounty's constants. */
function arcWith(verified: Array<{ productId: number; balance: bigint; deadline: number; paused?: boolean }>, fail = false): ArcClient & { reads: string[] } {
  const reads: string[] = [];
  return {
    d: testnet, reads,
    pub: {
      getBlock: async () => ({ number: 72_945_349n, timestamp: BigInt(NOW) }),
      readContract: async ({ address, functionName, args }: { address: string; functionName: string; args?: unknown[] }) => {
        reads.push(`${address.toLowerCase() === testnet.levels!.sealedBountyVerified.toLowerCase() ? "SBV" : address}.${functionName}`);
        if (fail && functionName === "bountyCount") throw new Error("HTTP 429");
        switch (functionName) {
          case "networkBountyBps": return 1_000;
          case "operatorBountyBps": return 500;
          case "bountyCount": return BigInt(verified.length);
          case "getBounty": {
            const b = verified[Number(args![0]) - 1]!;
            return { protocol: "0x5724d89D610c3017b8DC161c025248341556f6Ab", productId: BigInt(b.productId), balance: b.balance, deadline: BigInt(b.deadline), paused: !!b.paused, paidAmount: 0n };
          }
          default: throw new Error(`unexpected read: ${functionName}`);
        }
      },
    },
  } as unknown as ArcClient & { reads: string[] };
}

const fresh = () => { clearListCache(); clearLiveCaches(); };
/** The address as the tool returns it (EIP-55 checksum). */
const addrOf = (n: number) => getAddress(addr(n));

test("LIVE STATUS: active enclaves per product, verified level, products with no enclave, product 7's settlement, bounties of both levels", async () => {
  fresh();
  const api = await startFakeApi(routes());
  try {
    const line = await readLiveStatus({ base: api.base, arc: arcWith([{ productId: 7, balance: 1_000_000n, deadline: NOW - 30_000 }]), now: () => NOW * 1000 });
    assert.ok(line.startsWith("LIVE STATUS (read at 2026-11-19 01:55 UTC from ArcHive's index of Arc testnet; it overrides the FACTS above and your memory;"), line);
    assert.ok(line.includes("4 of 19 registered enclaves are active: product 1 (Private AI, prepaid session), product 2 (Sealed Bounty, open level), product 3 (Private AI, pay per call (x402)), product 7 (Sealed Bounty, verified level)"), line);
    assert.ok(line.includes("4 of the 4 at the verified level (chip declared by the Proof of Cloud alliance)"), line);
    assert.ok(line.includes("no active enclave for product 4 (attested copilot), product 5 (refutation demo of 10/11), product 6 (retired, replaced by 7)"), line);
    assert.ok(line.includes("product 7's settlement is authorized: it pays proven claims and can seize bonds"), line);
    assert.ok(line.includes("no bounty is open right now (all 3 are past their deadline: 2 at the open level, 1 at the verified level): a hunt needs a new bounty first"), line);
    assert.ok(!/paused|deleted|0 of 15/.test(line), line);
    assert.ok(/^[\x20-\x7e]+$/.test(line), "ASCII seulement (budget en jetons)");
    assert.ok(line.length < 900, `${line.length} characters`);
  } finally { await api.close(); }
});

test("LIVE STATUS: a fresh verified-level bounty is counted; no active enclave is stated as it is", async () => {
  fresh();
  const api = await startFakeApi(routes());
  try {
    const line = await readLiveStatus({ base: api.base, arc: arcWith([{ productId: 7, balance: 1_000_000n, deadline: NOW - 30_000 }, { productId: 7, balance: 2_000_000n, deadline: NOW + 86_400 }]), now: () => NOW * 1000 });
    assert.ok(line.includes("bounties open now: #2 of SealedBountyVerified (product 7, 2 USDC, until 2026-11-20 01:55 UTC); every other bounty is past its deadline (2 at the open level, 2 at the verified level in all)"), line);
  } finally { await api.close(); }
  fresh();
  const none = await startFakeApi(routes({
    "/enclaves": { body: [enclave(1, 7, false), enclave(2, 1, false)] },
    "/levels": { body: { enabled: true, verifiedBounty: { canSlash: false }, enclaves: [] } },
  }));
  try {
    const line = await readLiveStatus({ base: none.base, now: () => NOW * 1000 });
    assert.ok(line.includes("0 of 2 registered enclaves are active: no paid use can be served right now"), line);
    assert.ok(line.includes("product 7's settlement is not authorized yet: it cannot pay a claim"), line);
    assert.ok(!/bounties open now|no bounty is open/.test(line), `without an Arc client, the verified level is not read: nothing is said about open bounties (${line})`);
  } finally { await none.close(); }
});

test("LIVE STATUS: silent or failing API → the fallback line (never a guessed status); success kept 30 s; a missing /levels blocks nothing", async () => {
  fresh();
  const down = await startFakeApi(routes({ "/enclaves": { status: 503, body: { error: "down" } } }));
  try {
    assert.equal(await createLiveNote({ base: down.base })(), LIVE_FALLBACK);
    assert.match(LIVE_FALLBACK, /call enclaves_list \(authoritative\); never guess/);
  } finally { await down.close(); }
  fresh();
  const slow = await startFakeApi(routes({ "/enclaves": { body: [], delayMs: 2_000 } }));
  try {
    const t0 = Date.now();
    assert.equal(await createLiveNote({ base: slow.base, timeoutMs: 300 })(), LIVE_FALLBACK);
    assert.ok(Date.now() - t0 < 1_500, "bounded in time");
  } finally { await slow.close(); }
  fresh();
  const api = await startFakeApi(routes({ "/levels": { status: 404, body: {} } }));
  try {
    const note = createLiveNote({ base: api.base });
    const a = await note();
    assert.ok(a.includes("4 of 19 registered enclaves are active") && !a.includes("verified level (chip"), a);
    api.set("/enclaves", { body: [] });
    clearListCache();
    assert.equal(await note(), a, "the line is kept 30 s");
    assert.equal(api.hits("/enclaves"), 1);
  } finally { await api.close(); }
});

test("the LIVE STATUS line enters the site's prompt, after the page and before the language directive; never in the console", async () => {
  const calls: LlmRequest[] = [];
  const llm: Llm = async (req) => { calls.push(req); return { content: "ok" }; };
  const live = "LIVE STATUS (test): 4 of 19 registered enclaves are active.";
  const app = createCopilotApp({
    llm, system: SITE_SYSTEM, tools: [], allowedOrigins: [SITE], rate: { perMinute: 20, perDay: 300, globalPerDay: 0 },
    executeTool: async () => ({ result: {} }), site: { ...SITE_SURFACE, liveNote: async () => live },
  });
  await app.request("/chat", { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ messages: [{ role: "user", content: "what runs in an enclave right now?" }], lang: "en", page: { name: "home" } }) });
  const sys = String(calls[0]!.messages[0]!.content);
  assert.ok(sys.includes(`\n${live}\n`), sys.slice(-800));
  assert.ok(sys.indexOf("The user is looking at: page=home") < sys.indexOf(live));
  assert.ok(sys.indexOf(live) < sys.indexOf("LANGUAGE (overrides everything above)"));
  // a note that throws never breaks the answer
  const app2 = createCopilotApp({
    llm, system: SITE_SYSTEM, tools: [], allowedOrigins: [SITE], rate: { perMinute: 20, perDay: 300, globalPerDay: 0 },
    executeTool: async () => ({ result: {} }), site: { ...SITE_SURFACE, liveNote: async () => { throw new Error("boom"); } },
  });
  const r2 = await app2.request("/chat", { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ messages: [{ role: "user", content: "hi there you" }], lang: "en" }) });
  assert.equal(r2.status, 200);
  // the site's prompt mentions the line (FACTS); the line itself is missing
  assert.ok(!String(calls.at(-1)!.messages[0]!.content).includes("\nLIVE STATUS"));
  // la console : aucune ligne LIVE STATUS
  const app3 = createCopilotApp({
    llm, system: "CONSOLE", tools: [], allowedOrigins: [SITE], rate: { perMinute: 20, perDay: 300, globalPerDay: 0 }, executeTool: async () => ({ result: {} }),
  });
  await app3.request("/chat", { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], lang: "en" }) });
  assert.ok(!String(calls.at(-1)!.messages[0]!.content).includes("\nLIVE STATUS"));
});

test("site bounty_list: the open level (API) and the verified level (SealedBountyVerified, on-chain); a failure of the second is stated", async () => {
  fresh();
  const api = await startFakeApi(routes());
  const keep = process.env.ARCHIVE_API;
  process.env.ARCHIVE_API = api.base;
  try {
    // bounty_list reads the real clock (no `now` here): a deadline ten years ahead keeps bounty 2 open whenever this runs
    const arc = arcWith([{ productId: 7, balance: 1_000_000n, deadline: NOW - 30_000 }, { productId: 7, balance: 2_000_000n, deadline: NOW + 3_650 * 86_400 }]);
    const { result, citations } = await executeSiteTool("bounty_list", {}, { arc });
    const r = result as any;
    assert.equal(r.niveauOuvert.total, 2);
    assert.equal(r.niveauOuvert.ouvertes, 0);
    assert.equal(r.niveauVerifie.contrat, testnet.levels!.sealedBountyVerified);
    assert.equal(r.niveauVerifie.total, 2);
    assert.equal(r.niveauVerifie.ouvertes, 1);
    assert.deepEqual(r.niveauVerifie.primes.map((b: any) => [b.id, b.produit, b.solde, b.ouverte]), [["2", "7", "2 USDC", true], ["1", "7", "1 USDC", false]]);
    assert.ok(citations!.includes("SealedBountyVerified.getBounty"));
    assert.equal(r.resume, "1 prime(s) ouverte(s) en ce moment (niveau ouvert : 0 sur 2 ; niveau vérifié, produit 7 : 1 sur 2).");
    const open = (await siteBountyList({ onlyOpen: true }, { arc })).result as any;
    assert.deepEqual(open.niveauVerifie.primes.map((b: any) => b.id), ["2"]);
    fresh();
    const bad = (await siteBountyList({}, { arc: arcWith([], true) })).result as any;
    assert.match(bad.niveauVerifie.indisponible, /ne dis pas qu'il n'y a aucune prime à ce niveau/);
    assert.equal(bad.niveauOuvert.total, 2, "the open level is still given");
    assert.match(bad.resume, /lecture incomplète/);
    fresh();
    const none = (await siteBountyList({}, { arc: arcWith([{ productId: 7, balance: 1_000_000n, deadline: NOW - 30_000 }]) })).result as any;
    assert.match(none.resume, /^Aucune prime ouverte en ce moment \(niveau ouvert : 0 sur 2 ; niveau vérifié, produit 7 : 0 sur 1\)/);
  } finally {
    if (keep === undefined) delete process.env.ARCHIVE_API; else process.env.ARCHIVE_API = keep;
    await api.close();
  }
});

test("the model's citation marks (site): removed even when long or unclosed; the rest of the text stays", async () => {
  const { stripCitationMarks } = await import("../src/app");
  assert.equal(stripCitationMarks('No. It runs on the server【{"source":"site-v4#ia-privee","text":"' + "x".repeat(200) + '"}】.'), "No. It runs on the server.");
  assert.equal(stripCitationMarks('listed in the live status line【source":"site-v4#etat"]}.\nNext line.'), "listed in the live status line\nNext line.");
  assert.equal(stripCitationMarks("Plain text, 0x1234 and [brackets]."), "Plain text, 0x1234 and [brackets].");
});


test("site enclaves_list: one summary per product, in number order, before the rows; the console keeps its own", async () => {
  fresh();
  const api = await startFakeApi(routes());
  const keep = process.env.ARCHIVE_API;
  process.env.ARCHIVE_API = api.base;
  try {
    const { result } = await executeSiteTool("enclaves_list", { onlyActive: true }, { arc: arcWith([]) });
    const r = result as any;
    assert.deepEqual(r.activesParProduit.map((x: any) => [x.produit, x.nom, x.signataires]), [
      ["1", "Private AI, prepaid session", [addrOf(0x1002)]], ["2", "Sealed Bounty, open level", [addrOf(0x1003)]],
      ["3", "Private AI, pay per call (x402)", [addrOf(0x1004)]], ["7", "Sealed Bounty, verified level", [addrOf(0x1001)]],
    ]);
    assert.equal(Object.keys(r)[0], "activesParProduit");
    assert.equal(r.actives, 4);
  } finally {
    if (keep === undefined) delete process.env.ARCHIVE_API; else process.env.ARCHIVE_API = keep;
    await api.close();
  }
});
