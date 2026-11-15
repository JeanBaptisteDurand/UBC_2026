/** server.ts — serveur MCP du réseau d'enclaves. Expose nos outils à d'autres agents (Claude Desktop,
 *  Cursor, tout client MCP) : lectures (listes par l'index de l'API ArcHive, états on-chain), et actions PRÉPARÉES
 *  seulement. Ce serveur n'a aucune clé : il ne signe ni n'envoie rien ; tout ce qui dépense revient à l'utilisateur,
 *  qui signe dans son wallet. Les outils sont dans tools.ts (logique partagée avec le copilote :
 *  services/copilot/src/arc-actions.ts). */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, callTool, createMcpContext } from "./tools";

const { arc, actx } = createMcpContext();

const server = new Server({ name: "arc-enclave-network", version: "0.0.3" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(arc, actx, req.params.name, req.params.arguments ?? {}));

await server.connect(new StdioServerTransport());
console.error("serveur MCP arc-enclave-network prêt (stdio)");
