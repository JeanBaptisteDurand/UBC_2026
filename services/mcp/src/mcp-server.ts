/** mcp-server.ts — le serveur MCP du réseau d'enclaves, commun aux deux transports : stdio (server.ts, un agent local)
 *  et Streamable HTTP (http.ts, les agents distants, https://archive.62-171-153-35.sslip.io/mcp). Mêmes outils (TOOLS)
 *  et même logique (callTool) des deux côtés : lectures et actions PRÉPARÉES seulement ; ce serveur n'a aucune clé, il
 *  ne signe ni n'envoie rien. */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ArcClient } from "@arcvault/sdk";
import type { ActionCtx } from "../../copilot/src/arc-actions";
import { TOOLS, callTool, type ToolOutput } from "./tools";

export const SERVER_INFO = { name: "archive", version: "0.0.5" };

/** Ce que l'agent lit à l'initialisation (anglais, puis français). */
export const SERVER_INSTRUCTIONS =
  "ArcHive on Arc testnet: services run in Intel TDX enclaves verified by Arc contracts and paid in USDC. These tools read the network and PREPARE actions only: nothing is signed or sent, the user signs in their own wallet. "
  + "ArcHive sur Arc testnet : des services dans des enclaves Intel TDX vérifiées par des contrats d'Arc, payés en USDC. Ces outils lisent le réseau et PRÉPARENT des actions seulement : rien n'est signé ni envoyé, l'utilisateur signe dans son propre wallet.";

/** Un appel d'outil au plus `ms` millisecondes : au-delà, une erreur rendue à l'agent (le serveur ne tombe pas). */
function withTimeout(p: Promise<ToolOutput>, ms: number, name: string): Promise<ToolOutput> {
  let t: NodeJS.Timeout | undefined;
  const late = new Promise<ToolOutput>((ok) => {
    t = setTimeout(() => ok({
      content: [{ type: "text", text: `Erreur / Error: ${String(name).slice(0, 64)} n'a pas répondu en ${Math.round(ms / 1000)} s (did not answer in time) : réessayez dans un instant (try again shortly).` }],
      isError: true,
    }), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

/** Le serveur MCP (outils de tools.ts). `toolTimeoutMs` : délai d'un appel d'outil (HTTP ; aucun en stdio). */
export function createMcpServer(arc: ArcClient, actx: ActionCtx, o: { toolTimeoutMs?: number } = {}): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const run = callTool(arc, actx, req.params.name, req.params.arguments ?? {});
    return o.toolTimeoutMs ? withTimeout(run, o.toolTimeoutMs, req.params.name) : run;
  });
  return server;
}
