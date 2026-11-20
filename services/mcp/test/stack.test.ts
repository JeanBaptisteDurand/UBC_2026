/** stack.test.ts — the MCP server on the v3 stack (DEPLOYMENTS=deployments.v3.testnet.json, the record of 19 Nov 2026):
 *  products 1 to 5, the open Sealed Bounty is product 2 and the verified one product 5 (product 7 on v2.1). The tools
 *  name the products each level settles from the API's product list, never a stack's numbers written in advance, and the
 *  SDK call of a prepared bounty loads the v3 file. Against a fake LOCAL ArcHive API and a fake Arc client (no outgoing
 *  network call).
 *  Run: cd services/mcp && npx tsx --test test/stack.test.ts */
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { testnet, type ArcClient, type Deployment } from "@arcvault/sdk";
import { TOOLS, callTool, mcpDeployment, productRail, stackSdkCall } from "../src/tools";
import { clearListCache } from "../../copilot/src/archive-api";
import { startFakeApi, defaultRoutes, fakeArc, OWNER, type FakeApi } from "../../copilot/test/helpers";

const V3_FILE = fileURLToPath(new URL("../../../deployments.v3.testnet.json", import.meta.url));
const V3 = JSON.parse(readFileSync(V3_FILE, "utf8"));
const C = V3.contracts as Record<string, string>;
const ZERO = "0x0000000000000000000000000000000000000000";
const lc = (s: string) => s.toLowerCase();

let api: FakeApi;
before(async () => { api = await startFakeApi(); });
after(() => api.close());
beforeEach(() => { clearListCache(); for (const [p, r] of Object.entries(defaultRoutes())) api.set(p, r); });

const actx = () => ({ allowPrivateUrls: true, includeCalldata: true, apiBase: api.base });

/** A product as the API's /products serves it. */
function product(id: string, settlement: string, price: number, deterministic: boolean) {
  return {
    id, author: OWNER, manifestHash: `0x${"11".repeat(32)}`, deterministic, price: String(price), bpsOperator: 9500, bpsAuthor: 0,
    bpsNetwork: 500, minBond: "1000000", exposureCap: "10000000", settlement, param: `0x${"22".repeat(32)}`, version: "1",
    activatesAt: "1795000000", state: "Active", manifestURI: null, unitTokens: 1, outWeight: 1,
  };
}
/** The 5 products of v3, as published on 19 Nov 2026 (the record's products block). */
const V3_PRODUCTS = [
  product("1", C.SessionPay!, 100, false), product("2", C.SealedBounty!, 0, true), product("3", C.X402Settler!, 10_000, false),
  product("4", ZERO, 0, false), product("5", C.SealedBountyVerified!, 0, true),
];
/** The 7 products of v2.1 (live list of 20 Nov 2026): 5 is the refutation demo, 6 the neutralized former verified bounty. */
const V21_PRODUCTS = [
  product("1", testnet.sessionPay, 100, false), product("2", testnet.sealedBounty, 0, true), product("3", testnet.x402Settler, 10_000, false),
  product("4", ZERO, 0, false), product("5", testnet.sealedBounty, 0, true),
  product("6", "0x242cA1c4D0A5a6fE5A806F215CA5F127422364D2", 0, true), product("7", testnet.levels!.sealedBountyVerified, 0, true),
];

let v3: Deployment;
before(() => { v3 = mcpDeployment({ DEPLOYMENTS: V3_FILE } as NodeJS.ProcessEnv); });

/** The fake Arc client on the v3 stack, with the reads a bounty preparation makes. */
function v3Arc(): ArcClient {
  const base = fakeArc() as any;
  return {
    ...base,
    d: v3,
    usdcBalance: async () => 50_000_000n,
    pub: {
      ...base.pub,
      getCode: async () => "0x6080",
      readContract: async (a: { functionName: string; address: string; args?: unknown[] }) => {
        switch (a.functionName) {
          case "getProduct": {
            const p = V3_PRODUCTS.find((x) => x.id === String(a.args?.[0]));
            if (!p) return { author: ZERO, deterministic: false, price: 0n, bpsOperator: 0, bpsAuthor: 0, bpsNetwork: 0, minBond: 0n, exposureCap: 0n, settlement: ZERO, param: "0x", state: 0 };
            return { author: p.author, deterministic: p.deterministic, price: BigInt(p.price), bpsOperator: 9500, bpsAuthor: 0, bpsNetwork: 500, minBond: 1_000_000n, exposureCap: 10_000_000n, settlement: p.settlement, param: p.param, state: 2 };
          }
          case "isSettlement": return lc(a.address) === lc(v3.operatorBond);
          case "settlementApplyAt": return 0n;
          case "MAX_SIGS": return 5n;
          case "balanceOf": return 7_000_000n;
          default: return base.pub.readContract(a);
        }
      },
    },
  } as ArcClient;
}
async function run(arc: ArcClient, name: string, args: Record<string, unknown> = {}) {
  const out = await callTool(arc, actx(), name, args);
  return { out, text: out.content[0]!.text, json: out.isError ? null : JSON.parse(out.content[0]!.text) };
}
/** A stack's product numbers said for another stack: v2.1's on v3. */
const V21_NUMBERS = /product 7|products 2 and 5|#7|refutation demo|neutralized/;

test("DEPLOYMENTS=deployments.v3.testnet.json: the v3 contracts, its levels and its reference products", () => {
  assert.equal(V3.version, "3");
  assert.equal(v3.enclaveRegistry, "0xc854ebA7C28f4b53f50018EAcF40D617Ba76e38E");
  assert.equal(v3.productRegistry, "0xd2e6f3fD0561C8823774A8C7054B414777E0228d");
  assert.equal(v3.sealedBounty, "0xaA229Eda6b535DF6aEe0B4D892f39e0EC006d308");
  assert.equal(v3.levels?.sealedBountyVerified, "0x8958EA25c9cF7bbee39B32C43187d854B5d73ee6", "the verified level is read on v3");
  assert.equal(v3.levels?.policyEnclaves, "0x12c0C33C62666AbE0ab03B286b428C554De71BF8");
  assert.deepEqual(v3.products, { inference: 1n, bounty: 2n, x402: 3n });
  assert.equal(V3.products["5"].settlement, "SealedBountyVerified", "the record: product 5 is the verified Sealed Bounty");
  assert.notEqual(lc(v3.enclaveRegistry), lc(testnet.enclaveRegistry), "not the SDK's built-in stack (v2.1)");
});

test("the tool descriptions name no stack's product numbers", () => {
  for (const t of TOOLS) assert.doesNotMatch(t.description, /product 7|products 2 and 5|product 5\b/, t.name);
  const create = TOOLS.find((t) => t.name === "arc_bounty_prepare_create")!;
  assert.match((create.inputSchema.properties as any).productId.description, /arc_bounties names the products of each level/);
});

test("v3: product 5 is the verified level, product 2 the open level; v2.1's labels stay on v2.1", () => {
  const a3 = v3Arc(), a21 = fakeArc();
  assert.equal(productRail(a3, "5", C.SealedBountyVerified!), "SealedBountyVerified (Sealed Bounty, verified operator level)");
  assert.equal(productRail(a3, "2", C.SealedBounty!), "SealedBounty (Sealed Bounty, open level)");
  assert.equal(productRail(a3, "5", C.SealedBounty!), "SealedBounty (Sealed Bounty, open level)", "v2.1's refutation demo is not a v3 label");
  assert.match(productRail(a21, "5", testnet.sealedBounty), /refutation demo/);
  assert.match(productRail(a21, "6", "0x242cA1c4D0A5a6fE5A806F215CA5F127422364D2"), /^neutralized, replaced by #7/);
  assert.equal(productRail(a21, "7", testnet.levels!.sealedBountyVerified), "SealedBountyVerified (Sealed Bounty, verified operator level)");
});

test("v3: arc_products lists the 5 products with their rails, and no v2.1 number", async () => {
  api.set("/products", { body: V3_PRODUCTS });
  const r = await run(v3Arc(), "arc_products");
  assert.equal(r.out.isError, undefined, r.text);
  assert.deepEqual(r.json.products.map((p: any) => p.id), ["1", "2", "3", "4", "5"]);
  const byId = Object.fromEntries(r.json.products.map((p: any) => [p.id, p]));
  assert.equal(byId["5"].rail, "SealedBountyVerified (Sealed Bounty, verified operator level)");
  assert.equal(byId["5"].price, "paid from the poster's pool");
  assert.equal(byId["2"].rail, "SealedBounty (Sealed Bounty, open level)");
  assert.equal(byId["3"].price, "0.01 USDC per call");
  assert.doesNotMatch(r.text, V21_NUMBERS);
});

test("arc_bounties: the products of each level come from the API's product list (v3: 2 and 5; v2.1: 2 and 5, then 7)", async () => {
  const until = String(Math.floor(Date.now() / 1000) + 30 * 86_400);
  const row = (id: string, level: "open" | "verified", address: string, productId: string) =>
    ({ id, level, contract: level === "verified" ? "SealedBountyVerified" : "SealedBounty", address, protocol: OWNER, productId, balance: "2000000", deadline: until, paused: false });
  // v3
  api.set("/products", { body: V3_PRODUCTS });
  api.set("/bounties", { body: [row("1", "verified", C.SealedBountyVerified!, "5"), row("1", "open", C.SealedBounty!, "2")] });
  const b3 = await run(v3Arc(), "arc_bounties");
  assert.equal(b3.json.howToRead, "Two levels: open = SealedBounty (product 2), verified = SealedBountyVerified (product 5). A number alone does not name a bounty: read contract + id (ref).");
  assert.equal(b3.json.byLevel.open.address, C.SealedBounty);
  assert.equal(b3.json.byLevel.verified.address, C.SealedBountyVerified);
  assert.deepEqual(b3.json.bounties.map((x: any) => `${x.ref} p${x.productId}`), ["SealedBountyVerified #1 p5", "SealedBounty #1 p2"]);
  assert.doesNotMatch(b3.text, V21_NUMBERS);
  // v2.1 (the live list): the same sentence as before the switch
  clearListCache();
  api.set("/products", { body: V21_PRODUCTS });
  const b21 = await run(fakeArc(), "arc_bounties");
  assert.equal(b21.json.howToRead, "Two levels: open = SealedBounty (products 2 and 5), verified = SealedBountyVerified (product 7). A number alone does not name a bounty: read contract + id (ref).");
  // product list unavailable: the bounties anyway, the levels without their numbers
  clearListCache();
  api.set("/products", { status: 524, body: {} });
  const bx = await run(v3Arc(), "arc_bounties");
  assert.equal(bx.out.isError, undefined, bx.text);
  assert.equal(bx.json.total, 2);
  assert.match(bx.json.howToRead, /^Two levels: open = SealedBounty, verified = SealedBountyVerified\. /);
});

test("v3: a bounty prepared on product 5 is the verified level, on v3's SealedBountyVerified, and its SDK call loads the v3 file", async () => {
  api.set("/products", { body: V3_PRODUCTS });
  const target = "0x1111111111111111111111111111111111111111";
  const r = await run(v3Arc(), "arc_bounty_prepare_create", {
    productId: "5", from: OWNER, target, minDrop: "1", reward: "1", protocolX25519: `0x${"ab".repeat(32)}`,
  });
  assert.equal(r.out.isError, undefined, r.text);
  assert.equal(r.json.contract.address, C.SealedBountyVerified);
  assert.equal(r.json.contract.label, "SealedBountyVerified");
  assert.equal(r.json.product.level, "verified");
  assert.equal(r.json.eip3009Authorization.message.to, C.SealedBountyVerified, "the authorization is signed for v3's contract");
  const call: string = r.json.sdkCall;
  assert.match(call, /import deploymentsJson from "\.\/deployments\.v3\.testnet\.json" with \{ type: "json" \}/);
  assert.match(call, /const stack = deploymentFromJson\(deploymentsJson\);/);
  assert.match(call, /deployment: \{ \.\.\.stack, sealedBounty: stack\.levels!\.sealedBountyVerified \}/);
  assert.doesNotMatch(call, /\.\.\.testnet|testnet\.levels/);
  assert.match(call, /productId: 5n/);
});

test("the SDK call: unchanged on the SDK's own stack; on v3 the open level loads the v3 file too", () => {
  const open = ["// your wallet signs", "const arc = createArcClient({ publicClient, walletClient }); // @arcvault/sdk", "const { tx, bountyId } = await arc.createBounty({", "});"].join("\n");
  const same = { appelSdk: open, x: 1 };
  assert.equal(stackSdkCall(fakeArc(), same), same, "v2.1 (the SDK's testnet): nothing to change");
  const out = stackSdkCall(v3Arc(), same);
  assert.deepEqual(out.appelSdk.split("\n"), [
    "// your wallet signs",
    "import deploymentsJson from \"./deployments.v3.testnet.json\" with { type: \"json\" }; // the repository's deployments.v3.testnet.json: the stack this server reads, not the SDK's built-in testnet",
    "const stack = deploymentFromJson(deploymentsJson); // @arcvault/sdk",
    "const arc = createArcClient({ publicClient, walletClient, deployment: stack }); // @arcvault/sdk",
    "const { tx, bountyId } = await arc.createBounty({",
    "});",
  ]);
  assert.equal(out.x, 1);
  assert.equal(stackSdkCall(v3Arc(), { appelSdk: null }).appelSdk, null, "no call (bounty not ready): nothing to change");
});
