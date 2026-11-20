/** enclave-probe.test.ts — les sondes /attest et /pubkeys du copilote et du MCP (arc-actions.ts, restes du 8/11) :
 *  https seulement, port 443 seulement, chemin fixe, aucune redirection suivie, corps d'une réponse d'erreur jamais lu ni
 *  renvoyé, réponse non JSON refusée sans rien recopier. Aucun appel réseau sortant : un serveur local (127.0.0.1, en mode
 *  « développement local ») ou un résolveur et un requêteur simulés (mode public).
 *  Lancer : cd services/copilot && npx tsx --test test/enclave-probe.test.ts */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { fetchEnclavePubkeys, EnclaveKeyMismatchError } from "@arcvault/sdk";
import { fetchEnclaveJson, guardedFetch, enclavePolicyOf } from "../src/arc-actions";
import { BlockedUrlError, type Requester } from "../src/net-guard";

const BODY = "<html><body>PAGE-DU-SERVEUR-VISE : contenu renvoyé par l'hôte, RRRR</body></html>";
const KEYS = { signer: "0x1111111111111111111111111111111111111111", x25519: `0x${"22".repeat(32)}` };

let base = "";
const seen: string[] = [];
let handler: (req: IncomingMessage, res: ServerResponse) => void = () => {};
const srv = createServer((req, res) => {
  req.resume();
  req.on("end", () => { seen.push(`${req.method} ${req.url}`); handler(req, res); });
});
before(async () => {
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((ok) => { srv.closeAllConnections(); srv.close(() => ok()); }));

const dev = enclavePolicyOf({ allowPrivateUrls: true });
const reply = (status: number, body: string, headers: Record<string, string> = { "content-type": "text/html" }) =>
  (_req: IncomingMessage, res: ServerResponse) => { res.writeHead(status, headers); res.end(body); };

test("context: https, 443 and a public address except in local development; gateway prefixes taken from the context", () => {
  assert.deepEqual(enclavePolicyOf({}), { allowPrivate: false, prefixes: undefined });
  assert.deepEqual(enclavePolicyOf({ allowPrivateUrls: true, enclavePathPrefixes: ["/gw"] }), { allowPrivate: true, prefixes: ["/gw"] });
});

test("/attest answering an error: only the status comes back, never the body", async () => {
  for (const status of [404, 500, 401]) {
    handler = reply(status, BODY);
    await assert.rejects(
      fetchEnclaveJson(base, "/attest", { operator: "0xabc" }, dev),
      (e: any) => new RegExp(`HTTP ${status}`).test(e.message) && !e.message.includes("PAGE-DU-SERVEUR") && !e.message.includes("RRRR"),
    );
  }
});

test("redirect: refused, and the target is never contacted (the reviewer's relay)", async () => {
  handler = (req, res) => {
    if (req.url === "/attest") { res.writeHead(302, { location: `${base}/secret-after-redirect` }); res.end(); return; }
    reply(200, JSON.stringify(KEYS), { "content-type": "application/json" })(req, res);
  };
  seen.length = 0;
  await assert.rejects(fetchEnclaveJson(base, "/attest", { operator: "0xabc" }, dev), /redirect refused/);
  assert.deepEqual(seen, ["POST /attest"]);
  // même chose pour le /pubkeys lu par le SDK
  handler = (req, res) => { res.writeHead(301, { location: `${base}/secret-after-redirect` }); res.end(); };
  seen.length = 0;
  await assert.rejects(fetchEnclavePubkeys(base, 1n, { fetch: guardedFetch(dev) }), (e: any) => e instanceof EnclaveKeyMismatchError && /redirect refused/.test(e.message));
  assert.deepEqual(seen, ["GET /pubkeys"]);
});

test("a 200 answer that is not JSON: refused without copying anything; JSON: returned", async () => {
  handler = reply(200, BODY);
  await assert.rejects(fetchEnclaveJson(base, "/attest", {}, dev), (e: any) => /response not JSON/.test(e.message) && !e.message.includes("PAGE-DU-SERVEUR"));
  await assert.rejects(fetchEnclavePubkeys(base, 1n, { fetch: guardedFetch(dev) }), (e: any) => !e.message.includes("PAGE-DU-SERVEUR") && !e.message.includes("<html"));
  handler = reply(200, JSON.stringify(KEYS), { "content-type": "application/json" });
  assert.deepEqual(await fetchEnclaveJson(base, "/attest", {}, dev), KEYS);
  assert.deepEqual(await fetchEnclavePubkeys(base, 1n, { fetch: guardedFetch(dev) }), KEYS);
});

test("/pubkeys read by the SDK: an error answer returned WITHOUT its body (the SDK's message quotes only the status)", async () => {
  handler = reply(404, BODY);
  await assert.rejects(fetchEnclavePubkeys(base, 1n, { fetch: guardedFetch(dev) }), (e: any) => {
    assert.ok(e instanceof EnclaveKeyMismatchError && e.reason === "pubkeys_unreachable");
    assert.match(e.message, /HTTP 404/);
    assert.ok(!e.message.includes("PAGE-DU-SERVEUR"), e.message);
    return true;
  });
  const r = await guardedFetch(dev)(`${base}/pubkeys`);
  assert.equal(r.status, 404);
  assert.equal(await r.text(), "", "le corps de l'erreur n'est jamais lu");
});

test("free path, a route other than /attest or /pubkeys: refused BEFORE any connection", async () => {
  handler = reply(200, JSON.stringify(KEYS), { "content-type": "application/json" });
  seen.length = 0;
  await assert.rejects(fetchEnclaveJson(`${base}/redir`, "/attest", {}, dev), BlockedUrlError);
  await assert.rejects(fetchEnclaveJson(base, "/health" as any, undefined, dev), BlockedUrlError);
  await assert.rejects(guardedFetch(dev)(`${base}/secret`), BlockedUrlError);
  await assert.rejects(guardedFetch(dev)(`${base}/x/pubkeys`), BlockedUrlError);
  assert.deepEqual(seen, []);
});

test("public mode (copilot, MCP by default): http, non-standard port and private network refused before any connection", async () => {
  const pub = enclavePolicyOf({});
  seen.length = 0;
  await assert.rejects(fetchEnclaveJson(base, "/attest", {}, pub), /https only/);
  await assert.rejects(fetchEnclaveJson("https://127.0.0.1", "/attest", {}, pub), /private or reserved address/);
  await assert.rejects(fetchEnclaveJson("https://localhost", "/attest", {}, pub), /private network/);
  await assert.rejects(fetchEnclaveJson("https://abc.example:8443", "/attest", {}, pub), /port 443 only/);
  await assert.rejects(guardedFetch(pub)(`${base}/pubkeys`), /https only/);
  assert.deepEqual(seen, []);
});

/** Un requêteur simulé : note les options de connexion et répond `status` avec `body`. */
function fakeRequester(status: number, body: string, headers: Record<string, string>) {
  const calls: any[] = [];
  const request: Requester = (opts, cb) => {
    calls.push(opts);
    let lookedUp: unknown;
    (opts.lookup as any)(opts.hostname, { all: true }, (_e: unknown, a: unknown) => { lookedUp = a; });
    calls[calls.length - 1].lookedUp = lookedUp;
    const req = new EventEmitter() as any;
    req.write = () => true;
    req.destroy = () => req;
    req.end = () => {
      const res = Readable.from([Buffer.from(body)]) as any;
      res.statusCode = status; res.statusMessage = ""; res.headers = headers; res.complete = true;
      setImmediate(() => cb(res));
    };
    return req;
  };
  return { request, calls };
}

test("public mode: https on port 443, fixed path, pinned public address; error body never returned", async () => {
  const pub = enclavePolicyOf({});
  const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
  const ok = fakeRequester(200, JSON.stringify(KEYS), { "content-type": "application/json" });
  assert.deepEqual(await fetchEnclaveJson("https://enclave.example/enclave/inference/", "/attest", { operator: "0xabc" }, pub, { resolve, request: ok.request }), KEYS);
  const c = ok.calls[0];
  assert.equal(c.protocol, "https:");
  assert.equal(c.port, undefined, "port par défaut : 443");
  assert.equal(c.path, "/enclave/inference/attest");
  assert.equal(c.method, "POST");
  assert.equal(c.servername, "enclave.example", "certificat TLS vérifié pour le nom d'hôte");
  assert.deepEqual(c.lookedUp, [{ address: "93.184.216.34", family: 4 }]);
  const err = fakeRequester(502, BODY, { "content-type": "text/html" });
  await assert.rejects(
    fetchEnclaveJson("https://enclave.example", "/attest", {}, pub, { resolve, request: err.request }),
    (e: any) => /HTTP 502/.test(e.message) && !e.message.includes("PAGE-DU-SERVEUR"),
  );
  const r = await guardedFetch(pub, { resolve, request: err.request })("https://enclave.example/pubkeys");
  assert.equal(r.status, 502);
  assert.equal(await r.text(), "");
});
