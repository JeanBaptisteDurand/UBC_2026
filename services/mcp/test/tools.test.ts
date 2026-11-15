/** tools.test.ts — les outils du serveur MCP contre une fausse API ArcHive LOCALE et un faux client Arc (aucun appel
 *  réseau sortant) : listes par l'index de l'API (audit du 7/11, n° 7), repli explicite, sorties filtrées (n° 10) ;
 *  restes du 8/11 : URL d'enclave avec les mêmes gardes réseau que le copilote (https, port 443, chemin fixe, aucune
 *  redirection suivie, corps d'erreur jamais renvoyé ; réseau privé seulement avec MCP_ALLOW_PRIVATE_URLS=1).
 *  Lancer : cd services/mcp && npx tsx --test test/tools.test.ts */
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { testnet, type ArcClient } from "@arcvault/sdk";
import { TOOLS, callTool, createMcpContext } from "../src/tools";
import { clearListCache } from "../../copilot/src/archive-api";
import { MASK_KEY } from "../../copilot/src/secrets";
import { DEFAULT_ENCLAVE_PREFIXES } from "../../copilot/src/net-guard";
import { startFakeApi, defaultRoutes, fakeArc, OWNER, type FakeApi } from "../../copilot/test/helpers";

let api: FakeApi;
before(async () => { api = await startFakeApi(); });
after(() => api.close());
beforeEach(() => { clearListCache(); for (const [p, r] of Object.entries(defaultRoutes())) api.set(p, r); });

const actx = () => ({ allowPrivateUrls: true, includeCalldata: true, apiBase: api.base });
async function run(name: string, args: Record<string, unknown> = {}) {
  const out = await callTool(fakeArc(), actx(), name, args);
  return { out, text: out.content[0]!.text, json: out.isError ? null : JSON.parse(out.content[0]!.text) };
}

test("les outils de liste existent et disent leur source", () => {
  const names = TOOLS.map((t) => t.name);
  for (const n of ["arc_products", "arc_enclaves", "arc_bounties", "arc_sessions", "arc_activity"]) {
    assert.ok(names.includes(n), n);
    assert.match(TOOLS.find((t) => t.name === n)!.description, /index de l'API ArcHive/);
  }
  const { actx: c } = createMcpContext({ ARCHIVE_API: "https://exemple.invalid/api" } as NodeJS.ProcessEnv);
  assert.equal(c.apiBase, "https://exemple.invalid/api");
});

test("chaque liste vient de l'index de l'API, jamais de l'explorateur", async () => {
  const p = await run("arc_products");
  assert.equal(p.json.produits.length, 2);
  const e = await run("arc_enclaves");
  assert.equal(e.json.total, 5);
  assert.match(e.json.liste.source, /index d'événements de l'API ArcHive/);
  assert.ok((await run("arc_enclaves", { onlyActive: true })).json.enclaves.every((x: any) => x.active));
  const b = await run("arc_bounties");
  assert.equal(b.json.total, 2);
  assert.equal(b.json.primes[0].id, "2");
  const s = await run("arc_sessions", { owner: OWNER });
  assert.equal(s.json.total, 2);
  const a = await run("arc_activity", { limit: 4 });
  assert.equal(a.json.nombre, 4);
  for (const path of ["/products", "/enclaves", "/bounties", `/sessions/${OWNER.toLowerCase()}`, "/activity"]) assert.ok(api.hits(path) >= 1, path);
  assert.ok(api.urls.every((u) => !/explorer|blockscout/i.test(u)));
});

test("API en panne : isError et « liste momentanément indisponible », jamais une liste vide ou partielle", async () => {
  for (const [path, tool, args] of [["/enclaves", "arc_enclaves", {}], ["/bounties", "arc_bounties", {}], ["/products", "arc_products", {}], [`/sessions/${OWNER.toLowerCase()}`, "arc_sessions", { owner: OWNER }], ["/activity", "arc_activity", {}]] as const) {
    clearListCache();
    api.set(path, { status: 524, body: {} });
    const r = await run(tool, args);
    assert.equal(r.out.isError, true, tool);
    assert.match(r.text, /liste momentanément indisponible/, tool);
  }
  assert.equal((await run("arc_sessions", {})).json.disponible, false, "owner requis");
});

test("sorties filtrées : un journal de machine qui contient une clé privée part masqué vers l'agent", async () => {
  const hex = "9f".repeat(32);
  api.set("/machines/m1", { body: { machine: {
    machineId: "m1", mode: "tdx", online: true,
    doctor: { ok: false, checks: [{ id: "rpc", label: "RPC", ok: false, detail: `PRIVATE_KEY=0x${hex}` }] },
    logs: [`démarrage, clé privée 0x${hex}`, `tx 0x${"aa".repeat(32)} confirmée`],
  } } });
  const r = await run("arc_machine_diagnostics", { machineId: "m1" });
  assert.ok(!r.text.includes(hex), "la clé est passée");
  assert.ok(r.text.includes(MASK_KEY));
  assert.ok(r.text.includes(`tx 0x${"aa".repeat(32)}`), "le hash de transaction reste lisible");
});

// ---------------------------------------------------------------- URL d'enclave : mêmes gardes que le copilote

/** Le faux client Arc, avec les lectures dont operator_prepare_register a besoin avant d'appeler /attest. */
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

test("contexte MCP : réseau privé refusé par défaut (comme le copilote), permis seulement avec MCP_ALLOW_PRIVATE_URLS=1", () => {
  const env = (e: Record<string, string>) => createMcpContext({ ARCHIVE_API: api.base, ...e } as NodeJS.ProcessEnv).actx;
  assert.equal(env({}).allowPrivateUrls, false);
  assert.equal(env({ MCP_ALLOW_PRIVATE_URLS: "0" }).allowPrivateUrls, false);
  assert.equal(env({ MCP_ALLOW_PRIVATE_URLS: "true" }).allowPrivateUrls, false, "seulement « 1 »");
  assert.equal(env({ MCP_ALLOW_PRIVATE_URLS: "1" }).allowPrivateUrls, true);
  assert.deepEqual(env({}).enclavePathPrefixes, DEFAULT_ENCLAVE_PREFIXES);
  assert.deepEqual(env({ ENCLAVE_PATH_PREFIXES: "/gw/x402" }).enclavePathPrefixes, ["/gw/x402"]);
});

test("URL d'enclave piégée : aucune redirection suivie, chemin fixe, corps d'erreur jamais renvoyé à l'agent", async () => {
  const hits: string[] = [];
  let handler: (req: IncomingMessage, res: ServerResponse) => void = () => {};
  const srv = createServer((req, res) => { req.resume(); req.on("end", () => { hits.push(`${req.method} ${req.url}`); handler(req, res); }); });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = (srv.address() as AddressInfo).port;
  const local = `http://127.0.0.1:${port}`;
  const prep = (actx: any, enclaveUrl: string) => callTool(registerArc(), actx, "arc_operator_prepare_register", { productId: "1", operator: OWNER, enclaveUrl });
  try {
    // une « enclave » qui redirige vers une autre URL du réseau de l'utilisateur (le cas mesuré par le vérificateur)
    handler = (req, res) => {
      if (req.url === "/attest") { res.writeHead(302, { location: `${local}/secret-after-redirect` }); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ signer: "0x1111111111111111111111111111111111111111", x25519: `0x${"11".repeat(32)}` }));
    };
    // 1) par défaut : http, adresse privée et localhost refusés avant toute connexion
    const def = createMcpContext({ ARCHIVE_API: api.base } as NodeJS.ProcessEnv).actx;
    for (const [url, why] of [[local, /https seulement/], [`https://127.0.0.1:443`, /adresse privée ou réservée/], ["https://localhost", /réseau privé/]] as const) {
      const r = await prep(def, url);
      assert.equal(r.isError, true, url);
      assert.match(r.content[0]!.text, why, url);
    }
    assert.deepEqual(hits, []);
    // 2) développement local (MCP_ALLOW_PRIVATE_URLS=1) : http permis, la redirection est refusée, sa cible jamais lue
    const dev = createMcpContext({ ARCHIVE_API: api.base, MCP_ALLOW_PRIVATE_URLS: "1" } as NodeJS.ProcessEnv).actx;
    const r = await prep(dev, local);
    assert.equal(r.isError, true);
    assert.match(r.content[0]!.text, /redirection refusée/);
    assert.ok(!r.content[0]!.text.includes("0x1111111111111111111111111111111111111111"), "rien de la cible ne revient");
    assert.deepEqual(hits, ["POST /attest"]);
    // 3) chemin libre (« http://[::1]:P/redir » du vérificateur) : refusé avant toute connexion
    const free = await prep(dev, `http://[::1]:${port}/redir`);
    assert.equal(free.isError, true);
    assert.match(free.content[0]!.text, /chemin fixe/);
    assert.deepEqual(hits, ["POST /attest"]);
    // 4) réponse d'erreur : seul le statut revient à l'agent
    handler = (_req, res) => { res.writeHead(404, { "content-type": "text/html" }); res.end("<html>PAGE-INTERNE du routeur</html>"); };
    const e404 = await prep(dev, local);
    assert.equal(e404.isError, true);
    assert.match(e404.content[0]!.text, /HTTP 404/);
    assert.ok(!e404.content[0]!.text.includes("PAGE-INTERNE"), e404.content[0]!.text);
  } finally {
    await new Promise<void>((ok) => { srv.closeAllConnections(); srv.close(() => ok()); });
  }
});
