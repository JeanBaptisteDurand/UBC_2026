/** tools.test.ts — the MCP server's tools against a fake LOCAL ArcHive API and a fake Arc client (no outgoing network
 *  call): lists from the API's index, explicit fallback, filtered outputs; enclave URLs with the same network guards as
 *  the copilot (https, port 443, fixed path, no redirect followed, error body never returned; private network only with
 *  MCP_ALLOW_PRIVATE_URLS=1).
 *  Run: cd services/mcp && npx tsx --test test/tools.test.ts */
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { testnet, type ArcClient } from "@arcvault/sdk";
import { TOOLS, callTool, createMcpContext, englishKeys, outputText } from "../src/tools";
import { englishValue } from "../src/english";
import { clearListCache } from "../../copilot/src/archive-api";
import { MASK_KEY } from "../../copilot/src/secrets";
import { DEFAULT_ENCLAVE_PREFIXES } from "../../copilot/src/net-guard";
import { startFakeApi, defaultRoutes, fakeArc, OWNER, type FakeApi } from "../../copilot/test/helpers";

let api: FakeApi;
before(async () => { api = await startFakeApi(); });
after(() => api.close());
beforeEach(() => { clearListCache(); for (const [p, r] of Object.entries(defaultRoutes())) api.set(p, r); });

const actx = () => ({ allowPrivateUrls: true, includeCalldata: true, apiBase: api.base });
/** French left in a tool's output: the copilot's texts are French, this server says them in English (english.ts). */
const FRENCH = /[àâçéèêëîïôûùœ«»]|\b(le|la|les|des|du|une|est|pour|avec|sans|dans|pas|aux|blocs|caution|produit|jamais|aucun|aucune|inconnu|inconnue|attendu|oui|requis|réseau|d'abord)\b/i;
const assertEnglish = (text: string, what: string) => assert.doesNotMatch(text, FRENCH, what);
async function run(name: string, args: Record<string, unknown> = {}) {
  const out = await callTool(fakeArc(), actx(), name, args);
  return { out, text: out.content[0]!.text, json: out.isError ? null : JSON.parse(out.content[0]!.text) };
}

test("the list tools exist and state their source", () => {
  const names = TOOLS.map((t) => t.name);
  for (const n of ["arc_products", "arc_enclaves", "arc_bounties", "arc_sessions", "arc_activity"]) {
    assert.ok(names.includes(n), n);
    assert.match(TOOLS.find((t) => t.name === n)!.description, /ArcHive API index/);
  }
  const { actx: c } = createMcpContext({ ARCHIVE_API: "https://example.invalid/api" } as NodeJS.ProcessEnv);
  assert.equal(c.apiBase, "https://example.invalid/api");
});

test("every list comes from the API's index, never from the explorer", async () => {
  const p = await run("arc_products");
  assert.equal(p.json.products.length, 2);
  const e = await run("arc_enclaves");
  assert.equal(e.json.total, 5);
  assert.match(e.json.index.source, /ArcHive API event index/);
  assert.ok((await run("arc_enclaves", { onlyActive: true })).json.enclaves.every((x: any) => x.active));
  const b = await run("arc_bounties");
  assert.equal(b.json.total, 2);
  assert.equal(b.json.bounties[0].id, "2");
  const s = await run("arc_sessions", { owner: OWNER });
  assert.equal(s.json.total, 2);
  const a = await run("arc_activity", { limit: 4 });
  assert.equal(a.json.count, 4);
  for (const [tool, r] of [["arc_products", p], ["arc_enclaves", e], ["arc_bounties", b], ["arc_sessions", s], ["arc_activity", a]] as const) assertEnglish(r.text, tool);
  for (const path of ["/products", "/enclaves", "/bounties", `/sessions/${OWNER.toLowerCase()}`, "/activity"]) assert.ok(api.hits(path) >= 1, path);
  assert.ok(api.urls.every((u) => !/explorer|blockscout/i.test(u)));
});

test("API down: isError and \"list temporarily unavailable\", never an empty or partial list", async () => {
  for (const [path, tool, args] of [["/enclaves", "arc_enclaves", {}], ["/bounties", "arc_bounties", {}], ["/products", "arc_products", {}], [`/sessions/${OWNER.toLowerCase()}`, "arc_sessions", { owner: OWNER }], ["/activity", "arc_activity", {}]] as const) {
    clearListCache();
    api.set(path, { status: 524, body: {} });
    const r = await run(tool, args);
    assert.equal(r.out.isError, true, tool);
    assert.match(r.text, /list temporarily unavailable/, tool);
    assert.doesNotMatch(r.text, /momentanément|Réessayez|API ArcHive/, tool);
    assertEnglish(r.text, tool);
  }
  assert.equal((await run("arc_sessions", {})).json.available, false, "owner required");
});

test("filtered outputs: a machine log that contains a private key reaches the agent masked", async () => {
  const hex = "9f".repeat(32);
  api.set("/machines/m1", { body: { machine: {
    machineId: "m1", mode: "tdx", online: true,
    doctor: { ok: false, checks: [{ id: "rpc", label: "RPC", ok: false, detail: `PRIVATE_KEY=0x${hex}` }] },
    logs: [`boot, private key 0x${hex}`, `tx 0x${"aa".repeat(32)} confirmed`],
  } } });
  const r = await run("arc_machine_diagnostics", { machineId: "m1" });
  assert.ok(!r.text.includes(hex), "the key got through");
  assert.ok(r.text.includes("[key masked]") && !r.text.includes(MASK_KEY), "the mask, in English");
  assert.ok(r.text.includes(`tx 0x${"aa".repeat(32)}`), "the transaction hash stays readable");
  // what reaches the agent is English: the diagnostics, and the copilot's texts of the other tools (english.ts)
  assertEnglish(r.text, "arc_machine_diagnostics");
  assert.match(r.text, /Arc RPC unreachable: check outgoing network access/);
  assert.equal(englishValue("après dépôt, caution disponible 10 USDC pour une caution minimale de 1 USDC (produit #1)"), "after the deposit, available bond 10 USDC for a minimum bond of 1 USDC (product #1)");
  assert.equal(englishValue("operator : l'adresse de l'opérateur (celle qui signera et inscrira l'enclave)"), "operator: the operator's address (the one that will sign and register the enclave)");
  assert.equal(englishValue("caution libre 0 USDC : une NOUVELLE clé réserve 1 USDC (revert OperatorUnderbonded : retire une ancienne clé ou augmente la caution)"), "free bond 0 USDC: a NEW key reserves 1 USDC (revert OperatorUnderbonded: retire an old key or increase the bond)");
  assert.equal(englishValue("requestUnbond(montant), puis withdraw() après 7 j (UNBOND_DELAY)."), "requestUnbond(amount), then withdraw() after 7 days (UNBOND_DELAY).");
  assert.equal(englishValue("Session #9 inconnue : SessionPay compte 2 session(s), numérotées de 1 à 2."), "Session #9 unknown: SessionPay has 2 session(s), numbered 1 to 2.");
  assert.equal(englishValue("      - UNIT_TOKENS=1   # EN CLAIR (mesuré) : l'unité facturée du produit"), "      - UNIT_TOKENS=1   # IN PLAIN TEXT (measured): the product's billed unit");
  assert.equal(englishValue("0x5724d89D610c3017b8DC161c025248341556f6Ab"), "0x5724d89D610c3017b8DC161c025248341556f6Ab", "a value from the chain is unchanged");
});

// ---------------------------------------------------------------- enclave URLs: the same guards as the copilot

/** The fake Arc client, with the reads operator_prepare_register needs before it calls /attest. */
function registerArc(): ArcClient {
  const base = fakeArc() as any;
  return {
    ...base,
    availableBond: async () => 10_000_000n,
    pub: {
      ...base.pub,
      readContract: async (a: { functionName: string }) => {
        switch (a.functionName) {
          case "getProduct": return { author: OWNER, deterministic: false, price: 100n, bpsOperator: 7_000, bpsAuthor: 2_000, bpsNetwork: 1_000, minBond: 1_000_000n, exposureCap: 0n, settlement: testnet.sessionPay, param: "0x", state: 2 };
          case "freeBond": return 10_000_000n;
          case "banned": return false;
          default: return base.pub.readContract(a);
        }
      },
    },
  } as ArcClient;
}

test("MCP context: private network refused by default (like the copilot), allowed only with MCP_ALLOW_PRIVATE_URLS=1", () => {
  const env = (e: Record<string, string>) => createMcpContext({ ARCHIVE_API: api.base, ...e } as NodeJS.ProcessEnv).actx;
  assert.equal(env({}).allowPrivateUrls, false);
  assert.equal(env({ MCP_ALLOW_PRIVATE_URLS: "0" }).allowPrivateUrls, false);
  assert.equal(env({ MCP_ALLOW_PRIVATE_URLS: "true" }).allowPrivateUrls, false, "only \"1\"");
  assert.equal(env({ MCP_ALLOW_PRIVATE_URLS: "1" }).allowPrivateUrls, true);
  assert.deepEqual(env({}).enclavePathPrefixes, DEFAULT_ENCLAVE_PREFIXES);
  assert.deepEqual(env({ ENCLAVE_PATH_PREFIXES: "/gw/x402" }).enclavePathPrefixes, ["/gw/x402"]);
});

test("malicious enclave URL: no redirect followed, fixed path, error body never returned to the agent", async () => {
  const hits: string[] = [];
  let handler: (req: IncomingMessage, res: ServerResponse) => void = () => {};
  const srv = createServer((req, res) => { req.resume(); req.on("end", () => { hits.push(`${req.method} ${req.url}`); handler(req, res); }); });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = (srv.address() as AddressInfo).port;
  const local = `http://127.0.0.1:${port}`;
  const prep = (actx: any, enclaveUrl: string) => callTool(registerArc(), actx, "arc_operator_prepare_register", { productId: "1", operator: OWNER, enclaveUrl });
  try {
    // an "enclave" that redirects to another URL on the user's network (the case the reviewer measured)
    handler = (req, res) => {
      if (req.url === "/attest") { res.writeHead(302, { location: `${local}/secret-after-redirect` }); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ signer: "0x1111111111111111111111111111111111111111", x25519: `0x${"11".repeat(32)}` }));
    };
    // 1) by default: http, private address and localhost refused before any connection (the copilot's guard messages)
    const def = createMcpContext({ ARCHIVE_API: api.base } as NodeJS.ProcessEnv).actx;
    for (const [url, why] of [[local, /https only/], [`https://127.0.0.1:443`, /private or reserved address/], ["https://localhost", /private network/]] as const) {
      const r = await prep(def, url);
      assert.equal(r.isError, true, url);
      assert.match(r.content[0]!.text, why, url);
      assertEnglish(r.content[0]!.text, url);
    }
    assert.deepEqual(hits, []);
    // 2) local development (MCP_ALLOW_PRIVATE_URLS=1): http allowed, the redirect is refused, its target never read
    const dev = createMcpContext({ ARCHIVE_API: api.base, MCP_ALLOW_PRIVATE_URLS: "1" } as NodeJS.ProcessEnv).actx;
    const r = await prep(dev, local);
    assert.equal(r.isError, true);
    assert.match(r.content[0]!.text, /redirect refused/);
    assert.ok(!r.content[0]!.text.includes("0x1111111111111111111111111111111111111111"), "nothing from the target comes back");
    assert.deepEqual(hits, ["POST /attest"]);
    // 3) free path (the reviewer's "http://[::1]:P/redir"): refused before any connection
    const free = await prep(dev, `http://[::1]:${port}/redir`);
    assert.equal(free.isError, true);
    assert.match(free.content[0]!.text, /fixed path/);
    assert.deepEqual(hits, ["POST /attest"]);
    // 4) error response: only the status reaches the agent
    handler = (_req, res) => { res.writeHead(404, { "content-type": "text/html" }); res.end("<html>INTERNAL-PAGE of the router</html>"); };
    const e404 = await prep(dev, local);
    assert.equal(e404.isError, true);
    assert.match(e404.content[0]!.text, /HTTP 404/);
    assert.ok(!e404.content[0]!.text.includes("INTERNAL-PAGE"), e404.content[0]!.text);
  } finally {
    await new Promise<void>((ok) => { srv.closeAllConnections(); srv.close(() => ok()); });
  }
});


test("output: public keys stay readable, a private key is still masked; the last English fixes", () => {
  const pub = "0x" + "3f9a".repeat(16), priv = "0x" + "c0de".repeat(16), seed = "0x" + "7be1".repeat(16);
  const text = outputText(englishKeys({
    enclaves: [{ signataire: "0x" + "11".repeat(20), clePubliqueX25519: pub }],
    attestation: { signataire: "0x" + "22".repeat(20), clePubliqueX25519: pub },
    clePrivee: priv, operator: { privateKey: seed },
  }));
  assert.equal(text.split(`"x25519PublicKey": "${pub}"`).length - 1, 2, "the enclave's public X25519 key, in clear");
  assert.ok(!text.includes(priv) && !text.includes(seed), "a 32-byte hex under a private-key name got through");
  assert.ok(text.includes("[key masked]") && !text.includes("@@public-key"), "masked in English, nothing left aside");
  assert.deepEqual(Object.keys(englishKeys({ soldeActuelDeLaCible: "1", miseEnPause: "x" })), ["targetCurrentBalance", "pause"]);
  assert.equal(englishValue("95 %"), "95%");
  assert.equal(englishValue("1 USDC natif (gas, 18 décimales)"), "1 native USDC (gas, 18 decimals)");
  assert.equal(englishValue("fournies"), "given");
  assert.equal(englishValue("170000 blocs ≈ 1 j"), "170,000 blocks ≈ 1 day");
  assert.match(englishValue("les parts font 10100 points de base au lieu de 10 000 : propose() reverterait (BadShares)"), /^the shares add up to 10,100 basis points instead of 10,000/);
  assert.equal(englishValue("Toi compris (arc_operator_plan) : caution, VM, registerEnclave."), "Including you (arc_operator_plan): bond, VM, registerEnclave.");
});
