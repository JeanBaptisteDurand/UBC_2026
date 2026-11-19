/** http-app.ts — the ArcHive MCP server over Streamable HTTP (MCP specification 2025-03-26 and later), STATELESS
 *  (docs/COPILOT-SITE-CONTRACT.md §6): no session and no session id; each POST gets a fresh MCP server and transport
 *  (createMcpServer: the same tools and logic as the stdio server) and a JSON response, never an SSE stream. http.ts
 *  starts it; the tests mount it on a free port.
 *  Routes: POST /mcp (JSON-RPC); GET and DELETE /mcp → 405 (no server stream, no session to close); OPTIONS → CORS
 *  preflight; GET /mcp/health (and /health) → { ok: true }; anything else → 404.
 *  Guards, before any work: per-IP rate limit (429 + Retry-After; the IP is the LAST hop of X-Forwarded-For, set by
 *  Caddy, when the peer is a local or private proxy, otherwise the peer address), bounded concurrent requests (503),
 *  JSON only (415), body ≤ 64 KiB (413, whether announced or counted while reading), invalid JSON (400, -32700);
 *  per-tool-call timeout (createMcpServer). Open CORS ("*", no credentials): the server reads only public data and
 *  prepares only actions that users sign themselves.
 *  Accept: a client that accepts JSON (or anything, "*\/*", or says nothing) is served JSON; the specification asks for
 *  application/json AND text/event-stream, and the SDK checks it next (406 otherwise). */
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { isIP } from "node:net";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ArcClient } from "@arcvault/sdk";
import type { ActionCtx } from "../../copilot/src/arc-actions";
import { RateLimiter, bucketOf, type RateOptions } from "../../copilot/src/guard";
import { isPublicIp } from "../../copilot/src/net-guard";
import { createMcpServer } from "./mcp-server";

export const DEFAULT_MCP_RATE: RateOptions = { perMinute: 60, perDay: 3_000, globalPerDay: 0 };
export const MCP_MAX_BODY_BYTES = 64 * 1024;

export interface McpHttpOptions {
  arc: ArcClient;
  actx: ActionCtx;
  /** Per-IP rate (default: 60 per minute, 3,000 per day, no global cap). */
  rate?: RateOptions;
  /** A request's body, in bytes (default 64 KiB). */
  maxBodyBytes?: number;
  /** POSTs handled at the same time, at most (default 16); beyond that, 503. */
  maxInflight?: number;
  /** Timeout of a tool call, in ms (default 45,000). */
  toolTimeoutMs?: number;
  /** Log of unexpected errors (default console.error); request bodies are never logged. */
  log?: (line: string) => void;
}

const ALLOW_ORIGIN = { "access-control-allow-origin": "*" } as const;
const PREFLIGHT = {
  ...ALLOW_ORIGIN,
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, accept",
  "access-control-max-age": "600",
} as const;

/** A JSON-RPC error without an id (the request was not read, or could not be). */
function rpcError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { "content-type": "application/json", ...ALLOW_ORIGIN, ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { "content-type": "application/json", ...ALLOW_ORIGIN, ...headers });
  res.end(JSON.stringify(body));
}

const unmap = (ip: string) => ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
function stripPort(s: string): string {
  const b = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (b) return b[1]!;
  const p = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(s);
  return p ? p[1]! : s;
}

/** The client's IP: the LAST hop of X-Forwarded-For (set by Caddy) when the connection comes from a local or private
 *  proxy; otherwise (service exposed directly) the peer address, which a header cannot forge. */
export function clientIpOf(req: IncomingMessage): string {
  const peer = unmap(req.socket.remoteAddress ?? "");
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff.join(",") : xff;
  if (raw && (!peer || !isPublicIp(peer))) {
    const hop = unmap(stripPort(raw.split(",").map((s) => s.trim()).filter(Boolean).pop() ?? ""));
    if (isIP(hop)) return hop;
  }
  return peer || "unknown";
}

/** The body, never more than `max` bytes (announced Content-Length, then counted while reading). */
function readBody(req: IncomingMessage, max: number): Promise<{ ok: true; text: string } | { ok: false; status: 400 | 413 }> {
  const cl = req.headers["content-length"];
  if (cl !== undefined) {
    if (!/^\d+$/.test(cl.trim())) return Promise.resolve({ ok: false, status: 400 });
    if (Number(cl) > max) return Promise.resolve({ ok: false, status: 413 });
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let n = 0;
    let done = false;
    const finish = (r: { ok: true; text: string } | { ok: false; status: 400 | 413 }) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    req.on("data", (c: Buffer) => {
      if (done) return;
      n += c.length;
      if (n > max) { req.pause(); finish({ ok: false, status: 413 }); return; }
      chunks.push(c);
    });
    req.on("end", () => finish({ ok: true, text: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", () => finish({ ok: false, status: 400 }));
    req.on("close", () => finish({ ok: false, status: 400 }));
  });
}

/** Accept for the transport: a client that accepts JSON (or anything, or says nothing) gets JSON (enableJsonResponse). */
function acceptFor(a: string | undefined): string {
  const v = (a ?? "").toLowerCase();
  if (v.includes("application/json") && v.includes("text/event-stream")) return a!;
  if (!v.trim() || v.includes("*/*") || v.includes("application/json") || v.includes("application/*")) return "application/json, text/event-stream";
  return a!;
}

/** The HTTP server (created, not listening yet). */
export function createMcpHttpServer(o: McpHttpOptions): HttpServer {
  const limiter = new RateLimiter(o.rate ?? DEFAULT_MCP_RATE);
  const maxBody = o.maxBodyBytes ?? MCP_MAX_BODY_BYTES;
  const maxInflight = o.maxInflight ?? 16;
  const toolTimeoutMs = o.toolTimeoutMs ?? 45_000;
  const log = o.log ?? ((line: string) => console.error(line));
  let inflight = 0;

  const tooLarge = (res: ServerResponse, req: IncomingMessage) => {
    // the rest of the body is not read: the connection closes after the response
    res.once("finish", () => req.destroy());
    rpcError(res, 413, -32000, `Request body too large (${Math.round(maxBody / 1024)} KiB at most)`, { connection: "close" });
  };

  async function post(req: IncomingMessage, res: ServerResponse) {
    // 1) per-IP rate: every POST counts, even one refused later
    const v = limiter.hit(bucketOf(clientIpOf(req)));
    if (!v.ok) {
      return rpcError(res, 429, -32000, v.scope === "minute" ? "Too many requests: try again in a minute" : "Daily request quota reached for this IP", { "retry-after": String(v.retryAfterSec) });
    }
    // 2) bounded concurrent requests (Arc's RPC answers 429 to bursts)
    if (inflight >= maxInflight) return rpcError(res, 503, -32000, "Server busy: try again in a moment", { "retry-after": "2" });
    inflight++;
    try {
      // 3) JSON only; 4) bounded body; 5) valid JSON
      if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) {
        return rpcError(res, 415, -32000, "Unsupported Media Type: Content-Type must be application/json");
      }
      const body = await readBody(req, maxBody);
      if (!body.ok) return body.status === 413 ? tooLarge(res, req) : rpcError(res, 400, -32600, "Invalid Request: bad body");
      let parsed: unknown;
      try { parsed = JSON.parse(body.text); } catch { return rpcError(res, 400, -32700, "Parse error: Invalid JSON"); }

      // 6) MCP: a fresh server and transport, no session, JSON response
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const server = createMcpServer(o.arc, o.actx, { toolTimeoutMs });
      try {
        await server.connect(transport);
        const headers = new Headers({ "content-type": "application/json", accept: acceptFor(req.headers.accept) });
        for (const h of ["mcp-protocol-version", "mcp-session-id"]) {
          const x = req.headers[h];
          if (typeof x === "string") headers.set(h, x);
        }
        const webReq = new Request(new URL(req.url ?? "/mcp", "http://mcp.local"), { method: "POST", headers, body: body.text });
        const answer = await transport.handleRequest(webReq, { parsedBody: parsed });
        const out = Buffer.from(await answer.arrayBuffer());
        if (res.headersSent || res.destroyed) return;
        const h: Record<string, string> = { ...ALLOW_ORIGIN };
        answer.headers.forEach((value, key) => { h[key] = value; });
        res.writeHead(answer.status, h);
        res.end(out);
      } finally {
        await transport.close().catch(() => {});
        await server.close().catch(() => {});
      }
    } finally {
      inflight--;
    }
  }

  const srv = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://mcp.local").pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";
    if (path === "/mcp/health" || path === "/health") {
      if (method === "OPTIONS") { res.writeHead(204, PREFLIGHT); res.end(); return; }
      if (method === "GET" || method === "HEAD") return json(res, 200, { ok: true });
      return json(res, 405, { ok: false, error: "GET only" }, { allow: "GET" });
    }
    if (path !== "/mcp") return json(res, 404, { error: "not found: the MCP endpoint is POST /mcp" });
    if (method === "OPTIONS") { res.writeHead(204, PREFLIGHT); res.end(); return; }
    if (method !== "POST") {
      return rpcError(res, 405, -32000, "Method not allowed: this MCP server is stateless (POST /mcp only, no SSE stream, no session)", { allow: "POST, OPTIONS" });
    }
    post(req, res).catch((e: any) => {
      log(`[mcp-http] erreur : ${String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 300)}`);
      rpcError(res, 500, -32603, "Internal error");
    });
  });
  // a slow request cannot hold a connection open forever
  srv.headersTimeout = 20_000;
  srv.requestTimeout = 30_000;
  srv.keepAliveTimeout = 5_000;
  return srv;
}
