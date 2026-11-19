/** site-urls.ts — the public addresses the site copilot may quote in full (one source, no dependency: site.ts and
 *  claude-code.ts read them here). */
export const SITE_ORIGIN_URL = "https://archive.62-171-153-35.sslip.io";
/** Le serveur MCP d'ArcHive (Streamable HTTP, sans état, sans clé) et sa commande pour Claude Code. */
export const MCP_URL_TEXT = `${SITE_ORIGIN_URL}/mcp`;
export const MCP_ADD_CMD_TEXT = `claude mcp add --transport http archive ${MCP_URL_TEXT}`;
/** 19/11 (soir) : Utiliser, Louer et Publier sont les trois rôles de la page Network, une adresse chacun (use.html, rent.html
 *  et publish.html n'y font plus que rediriger) : la seule source de leurs adresses pour l'invite, la base et urlOf. */
export const NETWORK_PART_URL = { use: "/network.html?focus=use", rent: "/network.html?focus=rent", publish: "/network.html?focus=publish" } as const;
/** 19/11 (nuit) : le Pont (bridge.html) : l'USDC de testnet d'Ethereum Sepolia ou de Base Sepolia vers Arc, par CCTP. */
export const BRIDGE_PATH = "/bridge.html";
export const BRIDGE_URL_TEXT = `${SITE_ORIGIN_URL}${BRIDGE_PATH}`;
