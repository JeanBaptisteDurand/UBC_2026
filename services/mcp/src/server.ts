/** server.ts — the ArcHive MCP server over stdio, for a local agent (Claude Desktop, Cursor, any MCP client): reads
 *  (lists from the ArcHive API's index, on-chain state) and PREPARED actions only. This server holds no key: it neither
 *  signs nor sends anything; whatever spends is left to the user, who signs in their own wallet. The server and its
 *  tools are in mcp-server.ts and tools.ts (logic shared with the copilot: services/copilot/src/arc-actions.ts); the
 *  same server is also offered over Streamable HTTP (http.ts). */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpContext } from "./tools";
import { createMcpServer } from "./mcp-server";

const { arc, actx } = createMcpContext();

const server = createMcpServer(arc, actx);

await server.connect(new StdioServerTransport());
console.error("ArcHive MCP server ready (stdio)");
