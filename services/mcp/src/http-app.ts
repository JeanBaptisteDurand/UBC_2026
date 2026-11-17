/** http-app.ts — le serveur MCP du réseau d'enclaves en Streamable HTTP (spécification MCP 2025-03-26 et suivantes),
 *  SANS ÉTAT (CONTRACT.md §6) : ni session ni identifiant de session ; chaque POST reçoit un serveur MCP et un transport
 *  neufs (createMcpServer : les mêmes outils et la même logique que le serveur stdio) et une réponse JSON, jamais un flux
 *  SSE. http.ts le démarre ; les tests le montent sur un port libre.
 *  Routes : POST /mcp (JSON-RPC) ; GET et DELETE /mcp → 405 (pas de flux serveur, pas de session à fermer) ;
 *  OPTIONS → contrôle préalable CORS ; GET /mcp/health (et /health) → { ok: true } ; le reste → 404.
 *  Garde-fous, avant tout travail : débit par IP (429 + Retry-After ; l'IP est le DERNIER maillon de X-Forwarded-For,
 *  posé par Caddy, si le pair est un proxy local ou privé, sinon l'adresse du pair), requêtes simultanées bornées (503),
 *  JSON seulement (415), corps ≤ 64 Kio (413, annoncé ou compté au fil de la lecture), JSON invalide (400, -32700) ;
 *  délai par appel d'outil (createMcpServer). CORS ouvert (« * », sans identifiants) : l'API ne lit que des données
 *  publiques et ne prépare que des actions que l'utilisateur signe lui-même.
 *  Accept : un client qui accepte du JSON (ou tout, « *\/* », ou rien de dit) est servi en JSON ; la spécification
 *  demande application/json ET text/event-stream, le SDK le vérifie ensuite (406 sinon). */
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
  /** Débit par IP (défaut : 60 par minute, 3 000 par jour, sans plafond global). */
  rate?: RateOptions;
  /** Corps d'une requête, en octets (défaut 64 Kio). */
  maxBodyBytes?: number;
  /** POST traités en même temps, au plus (défaut 16) ; au-delà, 503. */
  maxInflight?: number;
  /** Délai d'un appel d'outil, en ms (défaut 45 000). */
  toolTimeoutMs?: number;
  /** Journal des erreurs inattendues (défaut console.error) ; jamais de corps de requête. */
  log?: (line: string) => void;
}

const ALLOW_ORIGIN = { "access-control-allow-origin": "*" } as const;
const PREFLIGHT = {
  ...ALLOW_ORIGIN,
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, accept",
  "access-control-max-age": "600",
} as const;

/** Une erreur JSON-RPC sans id (la requête n'a pas été lue, ou n'a pas pu l'être). */
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

/** L'IP du client : le DERNIER maillon de X-Forwarded-For (Caddy le pose) quand la connexion vient d'un proxy local ou
 *  privé ; sinon (service exposé directement) l'adresse du pair, qu'un en-tête ne peut pas falsifier. */
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

/** Le corps, sans jamais dépasser `max` octets (Content-Length annoncé, puis compté au fil de la lecture). */
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

/** Accept pour le transport : un client qui accepte du JSON (ou tout, ou rien de dit) reçoit du JSON (enableJsonResponse). */
function acceptFor(a: string | undefined): string {
  const v = (a ?? "").toLowerCase();
  if (v.includes("application/json") && v.includes("text/event-stream")) return a!;
  if (!v.trim() || v.includes("*/*") || v.includes("application/json") || v.includes("application/*")) return "application/json, text/event-stream";
  return a!;
}

/** Le serveur HTTP (pas encore à l'écoute). */
export function createMcpHttpServer(o: McpHttpOptions): HttpServer {
  const limiter = new RateLimiter(o.rate ?? DEFAULT_MCP_RATE);
  const maxBody = o.maxBodyBytes ?? MCP_MAX_BODY_BYTES;
  const maxInflight = o.maxInflight ?? 16;
  const toolTimeoutMs = o.toolTimeoutMs ?? 45_000;
  const log = o.log ?? ((line: string) => console.error(line));
  let inflight = 0;

  const tooLarge = (res: ServerResponse, req: IncomingMessage) => {
    // le reste du corps n'est pas lu : la connexion se ferme après la réponse
    res.once("finish", () => req.destroy());
    rpcError(res, 413, -32000, `Request body too large (${Math.round(maxBody / 1024)} KiB at most)`, { connection: "close" });
  };

  async function post(req: IncomingMessage, res: ServerResponse) {
    // 1) débit par IP : chaque POST compte, même refusé ensuite
    const v = limiter.hit(bucketOf(clientIpOf(req)));
    if (!v.ok) {
      return rpcError(res, 429, -32000, v.scope === "minute" ? "Too many requests: try again in a minute" : "Daily request quota reached for this IP", { "retry-after": String(v.retryAfterSec) });
    }
    // 2) requêtes simultanées bornées (le RPC d'Arc répond 429 en rafale)
    if (inflight >= maxInflight) return rpcError(res, 503, -32000, "Server busy: try again in a moment", { "retry-after": "2" });
    inflight++;
    try {
      // 3) JSON seulement ; 4) corps borné ; 5) JSON valide
      if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) {
        return rpcError(res, 415, -32000, "Unsupported Media Type: Content-Type must be application/json");
      }
      const body = await readBody(req, maxBody);
      if (!body.ok) return body.status === 413 ? tooLarge(res, req) : rpcError(res, 400, -32600, "Invalid Request: bad body");
      let parsed: unknown;
      try { parsed = JSON.parse(body.text); } catch { return rpcError(res, 400, -32700, "Parse error: Invalid JSON"); }

      // 6) MCP : un serveur et un transport neufs, sans session, réponse JSON
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
  // une requête lente à arriver ne tient pas une connexion indéfiniment
  srv.headersTimeout = 20_000;
  srv.requestTimeout = 30_000;
  srv.keepAliveTimeout = 5_000;
  return srv;
}
