/** server.ts — serveur MCP du réseau d'enclaves en stdio, pour un agent local (Claude Desktop, Cursor, tout client MCP) :
 *  lectures (listes par l'index de l'API ArcHive, états on-chain), et actions PRÉPARÉES seulement. Ce serveur n'a aucune
 *  clé : il ne signe ni n'envoie rien ; tout ce qui dépense revient à l'utilisateur, qui signe dans son wallet. Le
 *  serveur et ses outils sont dans mcp-server.ts et tools.ts (logique partagée avec le copilote :
 *  services/copilot/src/arc-actions.ts) ; le même serveur est aussi offert en Streamable HTTP (http.ts). */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpContext } from "./tools";
import { createMcpServer } from "./mcp-server";

const { arc, actx } = createMcpContext();

const server = createMcpServer(arc, actx);

await server.connect(new StdioServerTransport());
console.error("serveur MCP arc-enclave-network prêt (stdio)");
