/** claude-code.ts — ce que le copilote dit de Claude Code avec ArcHive (19/11/2026, demande de JB : « comment mettre en
 *  place ArcHive avec mon Claude Code, par les appels d'inférence et la gestion de ses enclaves ; faire comprendre que
 *  Claude Code lui-même peut tourner sur nos appels d'inférence »). Deux choses, toutes deux vraies :
 *   1. Claude Code GÈRE ArcHive par le serveur MCP (16 outils : lectures et actions préparées, jamais signées) ;
 *   2. Claude Code peut TOURNER sur l'inférence privée d'ArcHive : le mandataire local de la CLI arcvault
 *      (packages/cli/src/proxy.ts) parle l'API OpenAI (/v1/models, /v1/chat/completions) sur http://localhost:8787/v1,
 *      payé par une session prépayée (clé aek_, produit 1) ; Claude Code parle l'API Messages d'Anthropic : une passerelle
 *      compatible Anthropic (LiteLLM) se place devant le mandataire (ANTHROPIC_BASE_URL).
 *  Ce qui est écrit ici vient du code (proxy.ts : messages, temperature, max_tokens et seed seulement, ni outils ni flux) ;
 *  la recette TESTÉE de bout en bout (un autre agent la teste le 19/11 au soir) se met dans CLAUDE_CODE_TESTED_RECIPE :
 *  une seule chaîne, en anglais, ce qui a marché tel quel (commandes, configuration LiteLLM, limites constatées). Tant
 *  qu'elle est vide, le copilote dit les limites du mandataire et que la recette n'est pas encore confirmée. */
import { MCP_ADD_CMD_TEXT, MCP_URL_TEXT } from "./site-urls";

/** LA RECETTE TESTÉE (à remplir par l'agent de bascule avec le résultat du test du pont, sinon null). Exemple de forme :
 *  "Tested on 19/11 with LiteLLM 1.x: litellm --model openai/gpt-oss-120b --api_base http://localhost:8787/v1 --port 4000,
 *  then ANTHROPIC_BASE_URL=http://localhost:4000 ANTHROPIC_AUTH_TOKEN=any claude --model openai/gpt-oss-120b; ..." */
export const CLAUDE_CODE_TESTED_RECIPE: string | null = "Tested on 19/11/2026 against the live product 3 enclave (the claude CLI itself was not run; its exact request shape was replayed): an Anthropic Messages request went to a LiteLLM gateway (setting use_chat_completions_url_for_anthropic_messages: true, model name archive-gpt-oss-120b), then to a local OpenAI-compatible ArcHive bridge that paid the enclave 0.01 USDC per call with x402 from the payer's own wallet and returned the answer only after the enclave's signed receipt was verified against its key registered on Arc; plain, streaming and Claude-Code-shaped requests all answered, and the operator settled each call on Arc (X402Settler) about 20 s later. Claude Code settings: ANTHROPIC_BASE_URL = the LiteLLM gateway's local address, ANTHROPIC_AUTH_TOKEN = its key, ANTHROPIC_DEFAULT_HAIKU_MODEL=archive-gpt-oss-120b, then claude --model archive-gpt-oss-120b. Limits, always say them: chat only (Claude Code's tools are dropped: through this path it cannot read files or run commands); the model is gpt-oss-120b (at RedPill, behind an attested gateway the enclave verifies), not Claude; 32 KB per call, refused before any payment above; the answer streams in one chunk; that bridge is the team's test script, not a published package; the arcvault CLI's session proxy still needs streaming support before it works behind the gateway.";

/** Les limites du mandataire tel qu'il est écrit (proxy.ts), dites tant que la recette testée manque. */
const PROXY_LIMITS = "Not yet confirmed end to end with Claude Code: the arcvault proxy forwards the messages, temperature, max_tokens and seed only (no tool definitions, no streaming), so Claude Code can chat through it, but its tools (reading and editing files, running commands) may not work yet; say so plainly and never call it ready to use.";

/** La fiche « Claude Code » de la base du site (docs_search « claude code »). */
export function claudeCodeText(): string {
  const recipe = CLAUDE_CODE_TESTED_RECIPE?.trim();
  return [
    "ArcHive with Claude Code (or Cursor, or any agent), two ways, both from the user's own machine; ArcHive never signs nor spends for them.",
    `(1) Claude Code MANAGES ArcHive through the MCP server: run ${MCP_ADD_CMD_TEXT} (Cursor: {"mcpServers": {"archive": {"url": "${MCP_URL_TEXT}"}}}). It then has ArcHive's 16 tools: it reads the products, the enclaves (the hive), bounties, sessions, activity and prices, checks an enclave, a session or a receipt, lists and diagnoses an operator's machines, and PREPARES an operator's bond, an enclave's registration, a bounty or a new product (scaffold); it never signs: the user signs in their own wallet. So Claude Code can run an operator's enclaves with them: plan, prepare, diagnose, renew.`,
    "(2) Claude Code itself can RUN ON ArcHive's private inference: its model calls go to an Intel TDX enclave whose key Arc checked, each answer with a signed receipt verified before it is shown, paid in USDC per call (x402, product 3: the tested path) or from a prepaid session (product 1); the enclave forwards the request to the model, gpt-oss-120b, which runs at RedPill behind an attested gateway the enclave verifies (the model does not run in ArcHive's enclave). How: open a session (My space, My sessions, or ask this copilot to prepare one) and keep its aek_ key; on your machine, run the arcvault CLI's local proxy (arcvault proxy --key aek_... --enclave <the product-1 enclave's URL>; the CLI runs from the project's source, packages/cli, it is not on npm yet): it serves the OpenAI API at http://localhost:8787/v1 (/v1/models, /v1/chat/completions), checks the enclave's keys on Arc before listening and verifies every receipt. Claude Code speaks Anthropic's Messages API, so an Anthropic-compatible gateway such as LiteLLM goes in front of that proxy, and Claude Code starts with ANTHROPIC_BASE_URL pointing at the gateway. The model is then gpt-oss-120b (behind RedPill's attested gateway), not Claude; per-call payment (x402, product 3) is not in the proxy.",
    recipe ? `Tested recipe: ${recipe}` : PROXY_LIMITS,
    "On the site: Doc, chapter build (API, MCP, SDK); Services, section build (the MCP server).",
  ].join(" ");
}
