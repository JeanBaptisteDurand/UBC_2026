/** archive-api.test.ts — les listes lues dans l'index de l'API ArcHive (audit du 7/11, n° 7) : délai, repli explicite
 *  (« liste momentanément indisponible »), jamais de liste partielle, jamais l'explorateur. Contre une fausse API LOCALE.
 *  Lancer : cd services/copilot && npx tsx --test test/archive-api.test.ts */
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  apiEnclaves, apiBounties, apiProducts, apiSessions, apiActivity, freshness, clearListCache, ListUnavailableError,
} from "../src/archive-api";
import { enclavesList, productsList, sessionsList, activityList, enclaveStatus, operatorPlan, bountyList } from "../src/arc-actions";
import { startFakeApi, defaultRoutes, fixture, fakeArc, OWNER, type FakeApi } from "./helpers";

let api: FakeApi;
// bountyList et enclaveStatus lisent la base par défaut (ARCHIVE_API) : elle pointe vers la fausse API
before(async () => { api = await startFakeApi(); process.env.ARCHIVE_API = api.base; });
after(() => api.close());
beforeEach(() => { clearListCache(); for (const [p, r] of Object.entries(defaultRoutes())) api.set(p, r); });

test("les listes lisent l'index de l'API : lignes typées, adresses normalisées", async () => {
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

test("API muette : délai de 8 s par défaut (ici 200 ms), puis « liste momentanément indisponible »", async () => {
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

test("erreur HTTP, JSON illisible, forme inattendue, API injoignable : indisponible, jamais une liste vide", async () => {
  api.set("/bounties", { status: 503, body: { error: "rpc" } });
  await assert.rejects(apiBounties({ base: api.base }), /HTTP 503/);
  api.set("/products", { raw: "<html>524</html>" });
  await assert.rejects(apiProducts({ base: api.base }), /non JSON/);
  api.set("/products", { body: { products: [] } });
  await assert.rejects(apiProducts({ base: api.base }), /tableau attendu/);
  await assert.rejects(apiEnclaves({ base: "http://127.0.0.1:9" }), /injoignable|n'a pas répondu/);
});

test("une seule ligne illisible rend TOUTE la liste indisponible (jamais une liste partielle)", async () => {
  const rows = fixture("enclaves.json");
  rows[3].operator = "pas-une-adresse";
  api.set("/enclaves", { body: rows });
  await assert.rejects(apiEnclaves({ base: api.base }), /réponse illisible.*operator/);
  const bs = fixture("bounties.json");
  delete bs[1].balance;
  api.set("/bounties", { body: bs });
  await assert.rejects(apiBounties({ base: api.base }), /balance/);
});

test("cache de 15 s des seules réponses réussies", async () => {
  const before = api.hits("/products");
  await apiProducts({ base: api.base });
  await apiProducts({ base: api.base });
  assert.equal(api.hits("/products") - before, 1);
  api.set("/bounties", { status: 500, body: {} });
  await assert.rejects(apiBounties({ base: api.base }));
  api.set("/bounties", { body: fixture("bounties.json") });
  assert.equal((await apiBounties({ base: api.base })).length, 2, "un échec n'est jamais gardé");
});

test("fraîcheur : bloc jusqu'auquel l'index est complet, avertissement s'il traîne", async () => {
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

test("outils de liste (copilote et MCP) : l'API seulement, jamais l'explorateur, et la source est dite", async () => {
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
  const b = await bountyList(arc, {}); // base par défaut : ARCHIVE_API (posée ci-dessous)
  assert.equal(b.total, 2);
  assert.ok(api.urls.every((u) => !/explorer|blockscout/i.test(u)));
});

test("API en panne : outils de liste en erreur explicite ; outils où la liste n'est qu'un complément : avertissement", async () => {
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
