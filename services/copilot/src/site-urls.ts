/** site-urls.ts — the public addresses the site copilot may quote in full (one source, no dependency: site.ts and
 *  claude-code.ts read them here). */
export const SITE_ORIGIN_URL = "https://archive.62-171-153-35.sslip.io";
/** ArcHive's MCP server (Streamable HTTP, stateless, keyless) and its command for Claude Code. */
export const MCP_URL_TEXT = `${SITE_ORIGIN_URL}/mcp`;
export const MCP_ADD_CMD_TEXT = `claude mcp add --transport http archive ${MCP_URL_TEXT}`;
/** Use, Rent and Publish are the three roles of the Network page, one address each (use.html, rent.html and
 *  publish.html now only redirect there): the single source of their addresses for the prompt, the knowledge base and
 *  urlOf. */
export const NETWORK_PART_URL = { use: "/network.html?focus=use", rent: "/network.html?focus=rent", publish: "/network.html?focus=publish" } as const;
/** The Bridge (bridge.html): testnet USDC from Ethereum Sepolia or Base Sepolia to Arc, through CCTP. */
export const BRIDGE_PATH = "/bridge.html";
export const BRIDGE_URL_TEXT = `${SITE_ORIGIN_URL}${BRIDGE_PATH}`;
