/** site-urls.ts — les adresses publiques que le copilote du site peut citer en entier (une seule source, sans dépendance :
 *  site.ts et claude-code.ts les lisent ici). */
export const SITE_ORIGIN_URL = "https://archive.62-171-153-35.sslip.io";
/** Le serveur MCP d'ArcHive (Streamable HTTP, sans état, sans clé) et sa commande pour Claude Code. */
export const MCP_URL_TEXT = `${SITE_ORIGIN_URL}/mcp`;
export const MCP_ADD_CMD_TEXT = `claude mcp add --transport http archive ${MCP_URL_TEXT}`;
