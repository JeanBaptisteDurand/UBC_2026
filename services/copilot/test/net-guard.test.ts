/** net-guard.test.ts — calls to a URL given by the user: refused addresses, refused URLs, and the anti-rebinding guard
 *  (the host is resolved ONCE and the connection goes to THAT address). No outgoing network call: a local server, a
 *  simulated resolver and requester.
 *  Run: cd services/copilot && npx tsx --test test/net-guard.test.ts */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import {
  isPublicIp, resolvePinned, safeFetch, checkUrl, enclaveEndpoint, enclaveRouteUrl, parsePrefixes, DEFAULT_ENCLAVE_PREFIXES,
  BlockedUrlError, type Requester,
} from "../src/net-guard";

test("addresses: private, local, reserved and IPv6 forms that embed a private IPv4 are refused", () => {
  const refused = [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "192.0.2.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1",
    "2002:7f00:1::1", "2002:a00:1::1", "64:ff9b::7f00:1", "2001:db8::1", "2001::1", "3fff::1", "not-an-ip",
  ];
  for (const ip of refused) assert.equal(isPublicIp(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "62.171.153.35", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2002:808:808::1"]) assert.equal(isPublicIp(ip), true, ip);
});

test("URL: http(s) only, no credentials; enclave URL with no query or fragment, gateway prefix kept", () => {
  for (const bad of ["file:///etc/passwd", "gopher://x", "ftp://x.example/", "https://user:pw@x.example/", "pas une url"]) {
    assert.throws(() => checkUrl(bad), BlockedUrlError, bad);
  }
  assert.throws(() => enclaveEndpoint("https://x.example/api?q=", "/attest"), BlockedUrlError);
  assert.throws(() => enclaveEndpoint("https://x.example/#frag", "/attest"), BlockedUrlError);
  assert.throws(() => enclaveEndpoint("https://x.example/?", "/attest"), BlockedUrlError);
  assert.equal(enclaveEndpoint("https://archive.example/enclave/inference/", "/pubkeys").href, "https://archive.example/enclave/inference/pubkeys");
  assert.equal(enclaveEndpoint("https://abc-8802.dstack.phala.network", "/attest").href, "https://abc-8802.dstack.phala.network/attest");
});

test("enclave URL: https only, port 443 only, fixed path (root or a known gateway, then /attest or /pubkeys)", () => {
  const ok: Array<[string, string, string]> = [
    ["https://abc-8802.dstack-pha1-prod9.phala.network", "/attest", "https://abc-8802.dstack-pha1-prod9.phala.network/attest"],
    ["https://abc.example:443/", "/pubkeys", "https://abc.example/pubkeys"],
    ["https://archive.example/enclave/inference", "/pubkeys", "https://archive.example/enclave/inference/pubkeys"],
    ["https://archive.example/enclave/bounty/", "/attest", "https://archive.example/enclave/bounty/attest"],
  ];
  for (const [base, route, href] of ok) assert.equal(enclaveEndpoint(base, route).href, href, base);
  const refused: Array<[string, string, RegExp]> = [
    ["http://abc.example", "/attest", /https only/],
    ["https://abc.example:8443", "/attest", /port 443 only/],
    ["https://abc.example:80", "/pubkeys", /port 443 only/],
    ["https://abc.example/e404", "/attest", /fixed path/], // the reviewer's relay: a free prefix
    ["https://abc.example/admin/secret", "/pubkeys", /fixed path/],
    ["https://abc.example/enclave/inference/../../admin", "/pubkeys", /fixed path/],
    ["https://abc.example/enclave%2Finference", "/pubkeys", /fixed path/],
    ["https://abc.example", "/health", /\/attest or \/pubkeys only/],
    ["https://abc.example", "/v1/chat/completions", /\/attest or \/pubkeys only/],
  ];
  for (const [base, route, why] of refused) assert.throws(() => enclaveEndpoint(base, route), (e: any) => e instanceof BlockedUrlError && why.test(e.message), `${base} ${route}`);
  // configurable prefixes (ENCLAVE_PATH_PREFIXES); "none" = the root only
  assert.equal(enclaveEndpoint("https://x.example/gw/sealed-x402", "/attest", { prefixes: parsePrefixes("/gw/sealed-x402") }).href, "https://x.example/gw/sealed-x402/attest");
  assert.throws(() => enclaveEndpoint("https://x.example/enclave/inference", "/attest", { prefixes: parsePrefixes("none") }), BlockedUrlError);
  assert.deepEqual(parsePrefixes(undefined), DEFAULT_ENCLAVE_PREFIXES);
  assert.deepEqual(parsePrefixes(" /a/b/ , c ,, /a/b , ../x , /y?z "), ["/a/b", "/c"]);
  // local development: http and any port allowed, the path always fixed
  const dev = { allowPrivate: true };
  assert.equal(enclaveEndpoint("http://localhost:8802", "/attest", dev).href, "http://localhost:8802/attest");
  assert.equal(enclaveEndpoint("http://192.168.1.20:8802/enclave/inference", "/pubkeys", dev).href, "http://192.168.1.20:8802/enclave/inference/pubkeys");
  assert.throws(() => enclaveEndpoint("http://[::1]:8802/redir", "/attest", dev), /fixed path/);
  assert.throws(() => enclaveEndpoint("file:///etc/passwd", "/attest", dev), BlockedUrlError);
});

test("full URL of an enclave route (the one the SDK calls): the same rules", () => {
  assert.equal(enclaveRouteUrl("https://archive.example/enclave/inference/pubkeys").href, "https://archive.example/enclave/inference/pubkeys");
  assert.equal(enclaveRouteUrl("https://abc.example/attest").href, "https://abc.example/attest");
  for (const bad of [
    "https://abc.example/pubkeys?x=1", "https://abc.example/secret", "https://abc.example/x/pubkeys", "http://abc.example/pubkeys",
    "https://abc.example:8443/pubkeys", "https://user:pw@abc.example/pubkeys", "https://abc.example/pubkeys#frag",
  ]) assert.throws(() => enclaveRouteUrl(bad), BlockedUrlError, bad);
  assert.equal(enclaveRouteUrl("http://127.0.0.1:8802/pubkeys", { allowPrivate: true }).href, "http://127.0.0.1:8802/pubkeys");
});

test("resolution in local development (allowPrivate): private names and addresses allowed", async () => {
  assert.deepEqual(await resolvePinned("localhost", { allowPrivate: true, resolve: async () => [{ address: "127.0.0.1", family: 4 }] }), { address: "127.0.0.1", family: 4 });
  assert.deepEqual(await resolvePinned("10.0.0.7", { allowPrivate: true }), { address: "10.0.0.7", family: 4 });
  await assert.rejects(resolvePinned("localhost", { resolve: async () => [{ address: "127.0.0.1", family: 4 }] }), BlockedUrlError);
});

test("resolution: localhost and internal names refused; a single private answer is enough to refuse", async () => {
  for (const h of ["localhost", "x.localhost", "printer.local", "db.internal", "nas.lan", "box.home.arpa", "127.0.0.1", "[::1]", "169.254.169.254"]) {
    await assert.rejects(resolvePinned(h, { resolve: async () => [{ address: "8.8.8.8", family: 4 }] }), BlockedUrlError, h);
  }
  await assert.rejects(resolvePinned("mixed.example", { resolve: async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.5", family: 4 }] }), BlockedUrlError);
  await assert.rejects(resolvePinned("v6.example", { resolve: async () => [{ address: "::ffff:127.0.0.1", family: 6 }] }), BlockedUrlError);
  await assert.rejects(resolvePinned("empty.example", { resolve: async () => [] }), BlockedUrlError);
  assert.deepEqual(await resolvePinned("ok.example", { resolve: async () => [{ address: "2606:4700::1", family: 6 }, { address: "1.1.1.1", family: 4 }] }), { address: "1.1.1.1", family: 4 });
});

// ---------------------------------------------------------------- serveur local (127.0.0.1)

let base = "";
let port = 0;
const seen: Array<{ method: string; url: string; host: string; body: string }> = [];
let handler: (req: IncomingMessage, res: ServerResponse) => void = () => {};
const srv = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => { seen.push({ method: req.method ?? "", url: req.url ?? "", host: req.headers.host ?? "", body }); handler(req, res); });
});
before(async () => {
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  port = (srv.address() as AddressInfo).port;
  base = `http://rebind.test:${port}`;
});
after(() => new Promise<void>((ok) => { srv.closeAllConnections(); srv.close(() => ok()); }));

test("anti-rebinding: the host is resolved ONCE and the connection goes to the checked address", async () => {
  handler = (_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"signer":"0x01","x25519":"0x02"}'); };
  let calls = 0;
  // 1st answer: the checked address; any new resolution would point elsewhere (classic rebinding)
  const resolve = async () => (++calls === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.255.255.1", family: 4 }]);
  seen.length = 0;
  const res = await safeFetch(`${base}/pubkeys`, {}, { resolve, isAllowed: () => true, timeoutMs: 5_000 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { signer: "0x01", x25519: "0x02" });
  assert.equal(calls, 1, "une seule résolution DNS");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.host, `rebind.test:${port}`, "le nom d'hôte est gardé dans Host");
  // POST : corps et Content-Length transmis
  seen.length = 0;
  const p = await safeFetch(`${base}/attest`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"operator":"0xabc"}' }, { resolve: async () => [{ address: "127.0.0.1", family: 4 }], isAllowed: () => true });
  assert.equal(p.status, 200);
  assert.equal(seen[0]!.method, "POST");
  assert.equal(seen[0]!.body, '{"operator":"0xabc"}');
});

test("anti-rebinding: a public then a private answer → only the public one is used (observed requester, HTTPS with SNI)", async () => {
  let calls = 0;
  const resolve = async () => (++calls === 1 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
  let captured: any = null;
  let lookedUp: unknown = null;
  const request: Requester = (opts, cb) => {
    captured = opts;
    // what net.connect would get from the resolution (the "all" form, as with autoSelectFamily)
    (opts.lookup as any)("evil.example", { all: true }, (_e: unknown, addrs: unknown) => { lookedUp = addrs; });
    const req = new EventEmitter() as any;
    req.write = () => true;
    req.destroy = () => req;
    req.end = () => {
      const res = Readable.from([Buffer.from('{"ok":true}')]) as any;
      res.statusCode = 200; res.statusMessage = "OK"; res.headers = { "content-type": "application/json" }; res.complete = true;
      setImmediate(() => cb(res));
    };
    return req;
  };
  const res = await safeFetch("https://evil.example/pubkeys", {}, { resolve, request });
  assert.equal(res.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(lookedUp, [{ address: "93.184.216.34", family: 4 }]);
  assert.equal(captured.servername, "evil.example", "le certificat TLS reste vérifié pour le nom d'hôte");
  assert.equal(captured.agent, false, "pas d'agent partagé : pas de connexion réutilisée vers une autre adresse");
  // and when the only resolution is private: refused, no connection
  captured = null;
  await assert.rejects(safeFetch("https://evil.example/pubkeys", {}, { resolve: async () => [{ address: "127.0.0.1", family: 4 }], request }), BlockedUrlError);
  assert.equal(captured, null);
});

test("refused: redirect, response too large, timeout", async () => {
  const pin = { resolve: async () => [{ address: "127.0.0.1", family: 4 }], isAllowed: () => true };
  handler = (_req, res) => { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); res.end(); };
  await assert.rejects(safeFetch(`${base}/attest`, {}, pin), /redirect refused/);

  handler = (_req, res) => { res.writeHead(200); res.end("x".repeat(50_000)); };
  const big = await safeFetch(`${base}/attest`, {}, { ...pin, maxBytes: 1_000 });
  await assert.rejects(big.text(), /too large/);

  handler = () => { /* ne répond jamais */ };
  const t0 = Date.now();
  await assert.rejects(safeFetch(`${base}/attest`, {}, { ...pin, timeoutMs: 300 }), /timed out/);
  assert.ok(Date.now() - t0 < 3_000);
});
