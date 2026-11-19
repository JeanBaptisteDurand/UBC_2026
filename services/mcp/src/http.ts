/** http.ts — entry point of the MCP server over Streamable HTTP (bundle dist-bundles/mcp-http.mjs; a node:22-slim
 *  container behind Caddy, route /mcp; public at https://arc-hive.xyz/mcp, also served at
 *  https://archive.62-171-153-35.sslip.io/mcp). Stateless, JSON responses, the same tools as the stdio server
 *  (server.ts): reads and PREPARED actions only, no key. See http-app.ts.
 *  Variables: MCP_PORT (default 8812), MCP_HOST (default 0.0.0.0), MCP_RATE_PER_MINUTE (60) and MCP_RATE_PER_DAY (3,000)
 *  per IP, MCP_GLOBAL_PER_DAY (0 = no global cap), MCP_MAX_INFLIGHT (16), MCP_TOOL_TIMEOUT_MS (45,000); and the tools'
 *  own: RPC_URL, ARCHIVE_API (on the server: http://api:8809), ENCLAVE_URL, ENCLAVE_PATH_PREFIXES.
 *  MCP_ALLOW_PRIVATE_URLS is ignored here: a public server never reads the private network (/attest, /pubkeys). */
import { createMcpContext } from "./tools";
import { createMcpHttpServer } from "./http-app";

/** An integer ≥ min read from the environment, otherwise the default value. */
function intEnv(name: string, def: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min ? n : def;
}

const { arc, actx } = createMcpContext(process.env);
if (actx.allowPrivateUrls) console.warn("[mcp-http] MCP_ALLOW_PRIVATE_URLS ignored: this server is public, the private network stays closed");
actx.allowPrivateUrls = false;

const port = intEnv("MCP_PORT", 8812, 1);
const host = process.env.MCP_HOST?.trim() || "0.0.0.0";
const rate = {
  perMinute: intEnv("MCP_RATE_PER_MINUTE", 60, 1),
  perDay: intEnv("MCP_RATE_PER_DAY", 3_000, 1),
  globalPerDay: intEnv("MCP_GLOBAL_PER_DAY", 0),
};
const maxInflight = intEnv("MCP_MAX_INFLIGHT", 16, 1);
const toolTimeoutMs = intEnv("MCP_TOOL_TIMEOUT_MS", 45_000, 1_000);

const server = createMcpHttpServer({ arc, actx, rate, maxInflight, toolTimeoutMs });
server.listen(port, host, () => {
  console.log(`ArcHive MCP server (Streamable HTTP, stateless) on http://${host}:${port}/mcp  rate=${rate.perMinute}/min ${rate.perDay}/day per IP, ${rate.globalPerDay || "∞"}/day in total  concurrent≤${maxInflight}  tool timeout=${toolTimeoutMs} ms`);
});

// clean shutdown (docker stop): no new connection, then exit
const stop = () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
