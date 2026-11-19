/** http.ts — point d'entrée du serveur MCP en Streamable HTTP (bundle dist-bundles/mcp-http.mjs ; conteneur node:22-slim
 *  derrière Caddy, route /mcp ; public : https://archive.62-171-153-35.sslip.io/mcp). Sans état, réponses JSON, mêmes
 *  outils que le serveur stdio (server.ts) : lectures et actions PRÉPARÉES seulement, aucune clé. Voir http-app.ts.
 *  Variables : MCP_PORT (défaut 8812), MCP_HOST (défaut 0.0.0.0), MCP_RATE_PER_MINUTE (60) et MCP_RATE_PER_DAY (3 000)
 *  par IP, MCP_GLOBAL_PER_DAY (0 = aucun plafond global), MCP_MAX_INFLIGHT (16), MCP_TOOL_TIMEOUT_MS (45 000) ; et
 *  celles des outils : RPC_URL, ARCHIVE_API (sur le VPS : http://api:8809), ENCLAVE_URL, ENCLAVE_PATH_PREFIXES.
 *  MCP_ALLOW_PRIVATE_URLS est ignoré ici : un serveur public ne lit jamais le réseau privé (/attest, /pubkeys). */
import { createMcpContext } from "./tools";
import { createMcpHttpServer } from "./http-app";

/** Entier ≥ min lu dans l'environnement, sinon la valeur par défaut. */
function intEnv(name: string, def: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min ? n : def;
}

const { arc, actx } = createMcpContext(process.env);
if (actx.allowPrivateUrls) console.warn("[mcp-http] MCP_ALLOW_PRIVATE_URLS ignoré : ce serveur est public, le réseau privé reste fermé");
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
  console.log(`serveur MCP arc-enclave-network (Streamable HTTP, sans état) sur http://${host}:${port}/mcp  débit=${rate.perMinute}/min ${rate.perDay}/jour par IP, ${rate.globalPerDay || "∞"}/jour au total  simultanées≤${maxInflight}  délai d'outil=${toolTimeoutMs} ms`);
});

// arrêt propre (docker stop) : plus de nouvelle connexion, puis sortie
const stop = () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
