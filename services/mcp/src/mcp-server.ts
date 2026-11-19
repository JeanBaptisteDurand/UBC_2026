/** mcp-server.ts — the ArcHive MCP server, shared by both transports: stdio (server.ts, a local agent) and Streamable
 *  HTTP (http.ts, remote agents, https://arc-hive.xyz/mcp). The same tools (TOOLS) and the same logic (callTool) on
 *  both sides: reads and PREPARED actions only; this server holds no key, it neither signs nor sends anything. */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ArcClient } from "@arcvault/sdk";
import type { ActionCtx } from "../../copilot/src/arc-actions";
import { TOOLS, callTool, type ToolOutput } from "./tools";

export const SERVER_INFO = { name: "archive", version: "0.0.5" };

/** What the agent reads at initialization (English, then French: the site and AskHive speak both). */
export const SERVER_INSTRUCTIONS =
  "ArcHive on Arc testnet: services run in Intel TDX enclaves verified by Arc contracts and paid in USDC. These tools read the network and PREPARE actions only: nothing is signed or sent, the user signs in their own wallet. "
  + "ArcHive sur Arc testnet : des services dans des enclaves Intel TDX vérifiées par des contrats d'Arc, payés en USDC. Ces outils lisent le réseau et PRÉPARENT des actions seulement : rien n'est signé ni envoyé, l'utilisateur signe dans son propre wallet.";

/** A tool call lasts at most `ms` milliseconds: beyond that, an error is returned to the agent (the server stays up). */
function withTimeout(p: Promise<ToolOutput>, ms: number, name: string): Promise<ToolOutput> {
  let t: NodeJS.Timeout | undefined;
  const late = new Promise<ToolOutput>((ok) => {
    t = setTimeout(() => ok({
      content: [{ type: "text", text: `Error: ${String(name).slice(0, 64)} did not answer in time (${Math.round(ms / 1000)} s): try again shortly.` }],
      isError: true,
    }), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

/** The MCP server (tools from tools.ts). `toolTimeoutMs`: timeout of a tool call (HTTP; none over stdio). */
export function createMcpServer(arc: ArcClient, actx: ActionCtx, o: { toolTimeoutMs?: number } = {}): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const run = callTool(arc, actx, req.params.name, req.params.arguments ?? {});
    return o.toolTimeoutMs ? withTimeout(run, o.toolTimeoutMs, req.params.name) : run;
  });
  return server;
}
