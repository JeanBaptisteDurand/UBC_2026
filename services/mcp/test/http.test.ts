/** http.test.ts — the MCP server over Streamable HTTP, stateless (docs/COPILOT-SITE-CONTRACT.md §6), against a fake
 *  LOCAL ArcHive API and a fake Arc client (no outgoing network call): initialize, tools/list and tools/call over HTTP;
 *  no session id; 405 on GET and DELETE; 413 above 64 KiB (announced or counted); 415, 400; CORS preflight;
 *  /mcp/health; per-IP rate (last hop of X-Forwarded-For); bounded concurrent requests; tool timeout; the real MCP SDK
 *  client over HTTP, and the stdio server still working.
 *  Run: cd services/mcp && npx tsx --test test/http.test.ts */
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOLS } from "../src/tools";
import { createMcpHttpServer, clientIpOf, type McpHttpOptions } from "../src/http-app";
import { clearListCache } from "../../copilot/src/archive-api";
import { startFakeApi, defaultRoutes, fakeArc, type FakeApi } from "../../copilot/test/helpers";

const here = dirname(fileURLToPath(import.meta.url));
let api: FakeApi;
before(async () => { api = await startFakeApi(); });
after(() => api.close());
beforeEach(() => { clearListCache(); for (const [p, r] of Object.entries(defaultRoutes())) api.set(p, r); });

const open: HttpServer[] = [];
after(async () => { for (const s of open) { s.closeAllConnections(); await new Promise<void>((ok) => s.close(() => ok())); } });

async function start(over: Partial<McpHttpOptions> = {}) {
  const srv = createMcpHttpServer({
    arc: fakeArc(), actx: { allowPrivateUrls: false, includeCalldata: true, apiBase: api.base },
    rate: { perMinute: 1_000, perDay: 100_000, globalPerDay: 0 }, log: () => {}, ...over,
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  open.push(srv);
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
}

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
let rid = 0;
async function rpc(base: string, method: string, params?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST", headers: { ...MCP_HEADERS, "mcp-protocol-version": "2025-03-26", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, ...(params === undefined ? {} : { params }) }),
  });
  const text = await res.text();
  return { res, status: res.status, json: text ? JSON.parse(text) : null };
}
const INIT = { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } };

test("initialize, notifications/initialized, tools/list and tools/call over HTTP, no session", async () => {
  const base = await start();
  const init = await rpc(base, "initialize", INIT, { "mcp-protocol-version": "" });
  assert.equal(init.status, 200);
  assert.match(init.res.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(init.res.headers.get("mcp-session-id"), null, "stateless: no session id");
  assert.equal(init.res.headers.get("access-control-allow-origin"), "*");
  assert.equal(init.json.result.protocolVersion, "2025-03-26");
  assert.deepEqual(init.json.result.serverInfo, { name: "archive", version: "0.0.5" });
  assert.ok(init.json.result.capabilities.tools);
  assert.match(init.json.result.instructions, /PREPARE actions only/);
  // a notification alone: 202, no body
  const note = await fetch(`${base}/mcp`, { method: "POST", headers: MCP_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal(note.status, 202);
  // tools/list on a fresh (stateless) server: the same tools as the stdio server
  const list = await rpc(base, "tools/list");
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.result.tools.map((t: any) => t.name), TOOLS.map((t) => t.name));
  assert.equal(list.json.result.tools.length, 16);
  // tools/call: a list read from the fake API, then a tool that fails cleanly without a network
  const products = await rpc(base, "tools/call", { name: "arc_products", arguments: {} });
  assert.equal(products.json.result.isError, undefined);
  assert.equal(JSON.parse(products.json.result.content[0].text).products.length, 2);
  assert.ok(api.hits("/products") >= 1);
  const pricing = await rpc(base, "tools/call", { name: "arc_pricing", arguments: { productId: "1", units: "10" } });
  assert.equal(pricing.json.result.isError, true);
  assert.match(pricing.json.result.content[0].text, /^Error: /);
  const unknown = await rpc(base, "tools/call", { name: "arc_nope", arguments: {} });
  assert.equal(unknown.json.result.isError, true);
  assert.match(unknown.json.result.content[0].text, /unknown tool: arc_nope/);
  // two concurrent requests, each with its own server
  const [a, b] = await Promise.all([rpc(base, "tools/list"), rpc(base, "tools/list")]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
});

test("GET and DELETE /mcp: 405 (JSON-RPC error, Allow header); /mcp/health; unknown path: 404", async () => {
  const base = await start();
  for (const method of ["GET", "DELETE"]) {
    const r = await fetch(`${base}/mcp`, { method, headers: { accept: "text/event-stream" } });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.get("allow"), "POST, OPTIONS");
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
    const j = await r.json() as any;
    assert.equal(j.jsonrpc, "2.0");
    assert.equal(j.id, null);
    assert.equal(j.error.code, -32000);
    assert.match(j.error.message, /Method not allowed/);
  }
  const h = await fetch(`${base}/mcp/health`);
  assert.equal(h.status, 200);
  assert.deepEqual(await h.json(), { ok: true });
  assert.equal((await fetch(`${base}/mcp/`, { method: "GET" })).status, 405, "trailing slash: the same route");
  assert.equal((await fetch(`${base}/other`)).status, 404);
});

test("CORS preflight: origin \"*\", headers content-type, mcp-protocol-version, accept", async () => {
  const base = await start();
  const r = await fetch(`${base}/mcp`, { method: "OPTIONS", headers: { origin: "https://claude.ai", "access-control-request-method": "POST", "access-control-request-headers": "content-type, mcp-protocol-version, accept" } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.match(r.headers.get("access-control-allow-methods") ?? "", /POST/);
  const allowed = (r.headers.get("access-control-allow-headers") ?? "").split(",").map((s) => s.trim());
  for (const h of ["content-type", "mcp-protocol-version", "accept"]) assert.ok(allowed.includes(h), h);
  assert.equal(r.headers.get("access-control-allow-credentials"), null, "never credentials");
  const post = await rpc(base, "tools/list", undefined, { origin: "https://claude.ai" });
  assert.equal(post.res.headers.get("access-control-allow-origin"), "*");
});

/** A raw POST (announced Content-Length or a chunked body), for the cases fetch cannot do. */
function rawPost(base: string, chunks: string[], headers: Record<string, string>): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const u = new URL(`${base}/mcp`);
    const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers }, (res) => {
      let b = "";
      res.on("data", (c) => { b += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b, headers: res.headers }));
    });
    req.on("error", (e: any) => (e?.code === "EPIPE" || e?.code === "ECONNRESET" ? undefined : reject(e)));
    for (const c of chunks) req.write(c);
    req.end();
  });
}

test("body > 64 KiB: 413 (announced Content-Length, or counted during a chunked upload); 415; invalid JSON: 400", async () => {
  const base = await start();
  const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(70 * 1024) } });
  const r1 = await fetch(`${base}/mcp`, { method: "POST", headers: MCP_HEADERS, body: big });
  assert.equal(r1.status, 413);
  const j1 = await r1.json() as any;
  assert.equal(j1.error.code, -32000);
  assert.match(j1.error.message, /64 KiB at most/);
  // without Content-Length (transfer-encoding: chunked): counted while reading
  const r2 = await rawPost(base, Array.from({ length: 10 }, () => "y".repeat(8 * 1024)), { ...MCP_HEADERS, "transfer-encoding": "chunked" });
  assert.equal(r2.status, 413);
  assert.match(r2.body, /too large/);
  // just under the limit: accepted
  const fits = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: { pad: "z".repeat(60 * 1024) } } });
  assert.equal((await fetch(`${base}/mcp`, { method: "POST", headers: MCP_HEADERS, body: fits })).status, 200);
  const r3 = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(r3.status, 415);
  const r4 = await fetch(`${base}/mcp`, { method: "POST", headers: MCP_HEADERS, body: "{not json" });
  assert.equal(r4.status, 400);
  assert.equal((await r4.json() as any).error.code, -32700);
});

test("Accept: a client that accepts JSON (or anything, or nothing) is served JSON; text/html alone: 406", async () => {
  const base = await start();
  for (const accept of ["", "*/*", "application/json"]) {
    const r = await rpc(base, "tools/list", undefined, { accept });
    assert.equal(r.status, 200, `accept=${accept}`);
    assert.equal(r.json.result.tools.length, 16);
  }
  assert.equal((await rpc(base, "tools/list", undefined, { accept: "text/html" })).status, 406);
  // unknown protocol version: refused by the SDK
  assert.equal((await rpc(base, "tools/list", undefined, { "mcp-protocol-version": "1999-01-01" })).status, 400);
});

test("per-IP rate: last hop of X-Forwarded-For (set by Caddy); 429 with Retry-After; another IP gets through", async () => {
  const base = await start({ rate: { perMinute: 3, perDay: 100, globalPerDay: 0 } });
  const as = (xff: string) => rpc(base, "tools/list", undefined, { "x-forwarded-for": xff });
  // the first hop (written by the client) does not count: the last one, Caddy's, does
  for (const first of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) assert.equal((await as(`${first}, 198.51.100.9`)).status, 200);
  const r = await as("4.4.4.4, 198.51.100.9");
  assert.equal(r.status, 429);
  assert.ok(Number(r.res.headers.get("retry-after")) >= 1);
  assert.equal(r.json.error.code, -32000);
  assert.match(r.json.error.message, /Too many requests/);
  assert.equal((await as("198.51.100.10")).status, 200);
  // a public peer is not a proxy: its X-Forwarded-For is ignored
  const fake = (remoteAddress: string, xff?: string) => clientIpOf({ socket: { remoteAddress }, headers: xff ? { "x-forwarded-for": xff } : {} } as any);
  assert.equal(fake("172.18.0.5", "203.0.113.1, 198.51.100.7"), "198.51.100.7");
  assert.equal(fake("::ffff:127.0.0.1", "198.51.100.7:4431"), "198.51.100.7");
  assert.equal(fake("8.8.8.8", "198.51.100.7"), "8.8.8.8");
  assert.equal(fake("10.0.0.2", "not-an-ip"), "10.0.0.2");
});

test("bounded concurrent requests (503); a tool that is too slow returns an error in time", async () => {
  api.set("/products", { body: defaultRoutes()["/products"]!.body, delayMs: 600 });
  const base = await start({ maxInflight: 1 });
  const [a, b] = await Promise.all([
    rpc(base, "tools/call", { name: "arc_products", arguments: {} }),
    new Promise((ok) => setTimeout(ok, 100)).then(() => rpc(base, "tools/call", { name: "arc_products", arguments: {} })),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 503);
  assert.equal(b.res.headers.get("retry-after"), "2");
  clearListCache();
  api.set("/products", { body: defaultRoutes()["/products"]!.body, delayMs: 1_500 });
  const slow = await start({ toolTimeoutMs: 200 });
  const t0 = Date.now();
  const r = await rpc(slow, "tools/call", { name: "arc_products", arguments: {} });
  assert.ok(Date.now() - t0 < 1_200, `${Date.now() - t0} ms`);
  assert.equal(r.json.result.isError, true);
  assert.match(r.json.result.content[0].text, /did not answer in time/);
});

test("the official MCP client (StreamableHTTPClientTransport): connect, list and call a tool", async () => {
  const base = await start();
  const client = new Client({ name: "archive-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  try {
    assert.equal(client.getServerVersion()?.name, "archive");
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), TOOLS.map((t) => t.name));
    const out = await client.callTool({ name: "arc_bounties", arguments: { onlyOpen: false } }) as any;
    assert.equal(out.isError, undefined);
    assert.equal(JSON.parse(out.content[0].text).total, 2);
  } finally {
    await client.close();
  }
});

test("the stdio server still works with the updated SDK (same tools)", { timeout: 60_000 }, async () => {
  const client = new Client({ name: "archive-stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/server.ts"], cwd: join(here, ".."), stderr: "pipe" });
  await client.connect(transport);
  try {
    assert.deepEqual(client.getServerVersion(), { name: "archive", version: "0.0.5" });
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), TOOLS.map((t) => t.name));
  } finally {
    await client.close();
  }
});
