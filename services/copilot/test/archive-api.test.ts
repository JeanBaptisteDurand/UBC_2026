/** archive-api.test.ts — the lists read from the ArcHive API's index: timeout, explicit fallback ("liste momentanément
 *  indisponible", list temporarily unavailable), never a partial list, never the explorer. Against a fake LOCAL API.
 *  Run: cd services/copilot && npx tsx --test test/archive-api.test.ts */
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  apiEnclaves, apiBounties, apiProducts, apiSessions, apiActivity, freshness, clearListCache, ListUnavailableError,
} from "../src/archive-api";
import { enclavesList, productsList, sessionsList, activityList, enclaveStatus, operatorPlan, bountyList } from "../src/arc-actions";
import { startFakeApi, defaultRoutes, fixture, fakeArc, OWNER, type FakeApi } from "./helpers";

let api: FakeApi;
// bountyList and enclaveStatus read the default base (ARCHIVE_API): it points to the fake API
before(async () => { api = await startFakeApi(); process.env.ARCHIVE_API = api.base; });
after(() => api.close());
beforeEach(() => { clearListCache(); for (const [p, r] of Object.entries(defaultRoutes())) api.set(p, r); });

test("lists read the API's index: typed rows, normalized addresses", async () => {
  const es = await apiEnclaves({ base: api.base });
  assert.equal(es.length, fixture("enclaves.json").length);
  assert.equal(typeof es[0]!.productId, "bigint");
  assert.equal(typeof es[0]!.untilBlock, "bigint");
  const bs = await apiBounties({ base: api.base });
  assert.equal(bs[0]!.balance, BigInt(fixture("bounties.json")[0].balance));
  const ps = await apiProducts({ base: api.base });
  assert.equal(ps[0]!.state, "Active");
  const ss = await apiSessions(OWNER, { base: api.base });
  assert.equal(ss.length, 2);
  assert.ok(api.urls.includes(`/sessions/${OWNER.toLowerCase()}`));
  const ev = await apiActivity(5, { base: api.base });
  assert.equal(ev.length, 5);
  assert.ok(api.urls.some((u) => u === "/activity?limit=5"));
  await apiActivity(-3, { base: api.base });
  await apiActivity(10_000, { base: api.base });
  assert.ok(api.urls.includes("/activity?limit=1") && api.urls.includes("/activity?limit=100"), "limite bornée de 1 à 100");
});

test("silent API: 8 s timeout by default (200 ms here), then \"list temporarily unavailable\"", async () => {
  api.set("/enclaves", { body: [], delayMs: 2_000 });
  const t0 = Date.now();
  await assert.rejects(apiEnclaves({ base: api.base, timeoutMs: 200 }), (e: unknown) => {
    assert.ok(e instanceof ListUnavailableError);
    assert.match(e.message, /liste momentanément indisponible \(enclaves\).*n'a pas répondu en 0.2 s/);
    assert.match(e.message, /aucune liste partielle/);
    return true;
  });
  assert.ok(Date.now() - t0 < 1_500, "le délai est tenu");
});

test("HTTP error, unreadable JSON, unexpected shape, unreachable API: unavailable, never an empty list", async () => {
  api.set("/bounties", { status: 503, body: { error: "rpc" } });
  await assert.rejects(apiBounties({ base: api.base }), /HTTP 503/);
  api.set("/products", { raw: "<html>524</html>" });
  await assert.rejects(apiProducts({ base: api.base }), /non JSON/);
  api.set("/products", { body: { products: [] } });
  await assert.rejects(apiProducts({ base: api.base }), /tableau attendu/);
  await assert.rejects(apiEnclaves({ base: "http://127.0.0.1:9" }), /injoignable|n'a pas répondu/);
});

test("a single unreadable row makes the WHOLE list unavailable (never a partial list)", async () => {
  const rows = fixture("enclaves.json");
  rows[3].operator = "pas-une-adresse";
  api.set("/enclaves", { body: rows });
  await assert.rejects(apiEnclaves({ base: api.base }), /réponse illisible.*operator/);
  const bs = fixture("bounties.json");
  delete bs[1].balance;
  api.set("/bounties", { body: bs });
  await assert.rejects(apiBounties({ base: api.base }), /balance/);
});

test("15 s cache of successful answers only", async () => {
  const before = api.hits("/products");
  await apiProducts({ base: api.base });
  await apiProducts({ base: api.base });
  assert.equal(api.hits("/products") - before, 1);
  api.set("/bounties", { status: 500, body: {} });
  await assert.rejects(apiBounties({ base: api.base }));
  api.set("/bounties", { body: fixture("bounties.json") });
  assert.equal((await apiBounties({ base: api.base })).length, 2, "un échec n'est jamais gardé");
});

test("freshness: the block up to which the index is complete, a warning when it lags", async () => {
  const ok = await freshness({ base: api.base });
  assert.equal(ok.indexAJourAuBloc, 71389302);
  assert.equal(ok.avertissement, undefined);
  clearListCache();
  api.set("/index", { body: { lastBlock: 100, head: 5_000, lagBlocks: 4_900, lastError: "getLogs 1–5000 : 429" } });
  const late = await freshness({ base: api.base });
  assert.match(String(late.avertissement), /4900 blocs de retard.*429/);
  clearListCache();
  api.set("/index", { status: 500, body: {} });
  assert.match(String((await freshness({ base: api.base })).indexAJourAuBloc), /inconnu/);
});

test("list tools (copilot and MCP): the API only, never the explorer, and the source is stated", async () => {
  const arc = fakeArc();
  const cx = { apiBase: api.base };
  const e = await enclavesList(arc, {}, cx);
  assert.equal(e.total, 5);
  assert.equal((await enclavesList(arc, { onlyActive: true }, cx)).enclaves.every((x) => x.active), true);
  assert.match(String((e.liste as any).source), /index d'événements de l'API ArcHive/);
  const p = await productsList(arc, {}, cx);
  assert.equal(p.produits.length, 2);
  const s = await sessionsList(arc, { owner: OWNER }, cx);
  assert.equal(s.total, 2);
  assert.equal(s.ouvertes, 1);
  assert.deepEqual(await sessionsList(arc, {}, cx), { disponible: false, erreur: "owner requis : l'adresse 0x… du compte (ou connectez votre wallet)." });
  const a = await activityList(arc, { limit: 3 }, cx);
  assert.equal(a.nombre, 3);
  const b = await bountyList(arc, {}); // default base: ARCHIVE_API (set below)
  assert.equal(b.total, 2);
  assert.ok(api.urls.every((u) => !/explorer|blockscout/i.test(u)));
});

test("API down: list tools return an explicit error; tools where the list is only an extra: a warning", async () => {
  const arc = fakeArc();
  const cx = { apiBase: api.base };
  api.set("/enclaves", { status: 524, body: {} });
  api.set("/products", { status: 524, body: {} });
  await assert.rejects(enclavesList(arc, {}, cx), /liste momentanément indisponible \(enclaves\)/);
  await assert.rejects(productsList(arc, {}, cx), /liste momentanément indisponible \(produits\)/);
  const st = await enclaveStatus(arc, "0x344f2d2fA5AeAe78871F0B882245069F887c2e1a");
  assert.match(String((st as any).message), /liste momentanément indisponible/);
  const plan = await operatorPlan(arc, {}, cx);
  assert.ok(plan.avertissements.some((w) => /liste momentanément indisponible \(produits\)/.test(w)));
  assert.equal(plan.produits.length, 0);
});
