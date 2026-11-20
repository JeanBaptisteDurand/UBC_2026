/** copilot.ts — the agentic RAG copilot (OpenAI-compatible API: OpenAI, DeepSeek, RedPill) assembled from the
 *  environment: system prompt, tools, model, guards. No HTTP server here: server.ts serves it as is (on the server),
 *  enclave-server.ts serves it INSIDE an enclave with the enclave kit (keys in memory, /attest, /pubkeys, encrypted
 *  conversation). Both therefore run exactly the same copilot (same tools, same limits, same prompt).
 *  Variables: OPENAI_API_KEY (secret; in an enclave, an ENCRYPTED variable), OPENAI_BASE_URL and COPILOT_MODEL (in
 *  clear, measured in an enclave), COPILOT_MAX_TOKENS (max_tokens per call, default 2,000), COPILOT_MAX_TOOL_CHARS
 *  (what is added to the history during a request: tool results and model outputs, default 40,000),
 *  COPILOT_MAX_INPUT_CHARS (the summed input of all model calls of a request, default 160,000),
 *  COPILOT_MAX_INPUT_TOKENS (the same, in ESTIMATED tokens: 0.3 per ASCII character, 3 per other character; default
 *  50,000, a hard limit, first call included), ALLOWED_ORIGINS, COPILOT_RATE_PER_MINUTE, COPILOT_RATE_PER_DAY,
 *  COPILOT_GLOBAL_PER_DAY, ENCLAVE_PATH_PREFIXES, COPILOT_ALLOW_PRIVATE_URLS (local development only), RPC_URL,
 *  ARCHIVE_API, ENCLAVE_URL, PORT, DEPLOYMENTS (path to a deployments.*.json: the stack the tools read; without it, the
 *  SDK's built-in `testnet` stack), COPILOT_SURFACE ("console", the default: the console's chat bubble, unchanged;
 *  "site": AskHive, the site's panel, served under /copilot-site/: prompt, interface tools, page context and the
 *  site's knowledge base, see site.ts; any other value stops the start). */
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, http } from "viem";
import { createArcClient, arcTestnet, testnet, deploymentFromJson, type Deployment } from "@arcvault/sdk";
import { TOOL_DEFS, DISPLAY, executeTool, VERIFICATION_STATE, type ToolCtx } from "./tools";
import { DEFAULT_CAPS, type CopilotAppOptions, type Llm } from "./app";
import { openAiLlm } from "./llm";
import { parseOrigins } from "./guard";
import { archiveBase } from "./archive-api";
import { SITE_DISPLAY, SITE_SURFACE, SITE_TOOL_DEFS, SITE_UI_PARAGRAPH, executeSiteTool } from "./site";
import { createLiveNote } from "./site-live";

/** The system prompt (in French; the language instruction is added at the end of each request), in three parts: the
 *  head (role, rules, flows), the paragraph that drives the interface (console or site), and the verification state. */
const SYSTEM_HEAD = `Tu es le copilote du réseau d'enclaves d'Arc (ArcHive). Réponds brièvement, dans la langue fixée par la consigne LANGUE à la fin de cette invite, en citant tes sources via l'outil docs_search.
Règles ABSOLUES : tu n'exécutes jamais de dépense ni de transaction — pour toute action qui engage de l'argent (ouvrir une session, créer une prime, déposer une caution, inscrire une enclave), utilise un outil *prepare* qui RENVOIE les données à signer ; l'utilisateur signe lui-même (navigateur, wallet, ou CLI sur sa machine). Ne demande ni n'affiche jamais de clé privée, de phrase de récupération ni de clé d'accès aek_… ou arcop_… ; si un message contient « [clé masquée] », dis que tu ne l'as pas lue, qu'elle doit être considérée comme compromise, et conseille rotateKey ou closeSession (clé aek_), une nouvelle clé opérateur (arcop_), une nouvelle clé chez le fournisseur (clé d'API sk-…, rpk_…) ou un nouveau wallet (clé privée) ; si un message contient « [phrase de récupération masquée] », dis que tu ne l'as pas lue et conseille de transférer les fonds vers un nouveau wallet ; si un message contient « [valeur masquée par prudence] », c'est que la conversation parle de clé privée ou de phrase de récupération : dis que tu n'as pas lu cette valeur (hexadécimale ou base58) ; si c'était une clé privée, elle doit être considérée comme compromise (nouveau wallet) ; si c'était un hash de transaction, une signature ou un identifiant public, demande de le renvoyer dans une NOUVELLE conversation qui ne parle pas de clé (recharger la page du site en ouvre une). Tout chiffre (prix, solde, caution, délai, part, frais) vient d'un outil, jamais inventé ; si un outil échoue, dis-le au lieu de deviner. Si un outil répond « liste momentanément indisponible », dis-le tel quel et propose de réessayer dans un instant : ne donne jamais de liste de mémoire ni de liste partielle. Quand un outil renvoie aCompleter, demande ces informations à l'utilisateur. Résume les données préparées (montants, contrat, où signer) sans recopier de longs blocs hexadécimaux.
Parcours : (1) répondre à une question → docs_search, avec citations ; (2) « lance-moi un modèle privé à moins de X USDC la requête » → products_list, pricing_quote avec budget = X (inférence : CHAQUE jeton de la question et de la réponse compte 1 unité ; une requête consomme donc autant d'unités que la question et la réponse ont de jetons, bien plus que 2 ; X couvre X ÷ prix jetons par requête), session_prepare_open (choisit un opérateur actif) avec un dépôt de plusieurs fois le budget par requête (exempleDeDepot de pricing_quote), snippet_generate ; pour un appel d'essai → inference_test (jamais de clé côté serveur) ; (3) « je veux devenir fournisseur / opérateur » → operator_plan, puis operator_prepare_bond et operator_prepare_register ; (4) « je veux publier une prime » → bounty_prepare_create (assistant de prédicat : « le solde USDC du contrat X baisse d'au moins T ») ; (5) « je veux faire tourner mon propre service » → appelle product_scaffold IMMÉDIATEMENT, sans rien demander avant (il a des valeurs par défaut lues on-chain), résume le squelette et les étapes d'auteur, puis propose d'ajuster nom, prix, parts et modèle. États : enclaves_status (une enclave par son signataire), session_status (une session par son id), sessions_list (les sessions d'un compte, défaut : le wallet connecté), bounty_list (les primes ; onlyOpen pour les ouvertes), activity_list (l'activité on-chain récente), receipt_verify. Pour déboguer la machine d'un opérateur, utilise machines_list puis machine_diagnostics, et dis-lui exactement quoi corriger. Appelle au plus 4 outils à la fois. Refuse ce qui sort du périmètre.`;
/** The console's paragraph: the bubble drives its screens (ui_navigate, console pages). */
const CONSOLE_UI_PARAGRAPH = `Tu PILOTES l'interface : tu vis dans une bulle en bas à droite du site et tu peux changer la page affichée avec l'outil ui_navigate. Dès que l'utilisateur veut voir, montrer, aller sur ou utiliser quelque chose, appelle ui_navigate avec la bonne page, puis explique en une ou deux phrases ce qu'il voit. Pages : vue = vue d'ensemble (chaîne de preuves, chiffres, activité) ; ruche = les enclaves actives (clique une alvéole pour commander) ; produits = le catalogue ; primes = primes ouvertes et chasse ; playground = l'IA privée ; cles = clés d'accès aek_, clés opérateur arcop_ et sessions ; publier-prime = côté protocole ; operateur = louer sa machine (caution, brancher une machine, l'inscrire) ; publier-produit = côté auteur ; portefeuille = soldes, caution et rapatriement d'USDC par CCTP ; developpeurs = API, SDK, CLI, MCP, contrats. « Ruche », « hive », « les enclaves » = ruche. Pour parler des enclaves, appelle aussi enclaves_list. « Les preuves », « l'enclave est-elle vérifiée » = vue (la chaîne de preuves). Clés d'API : elles EXISTENT (page cles, clés aek_ et mandataire compatible OpenAI) — ne dis jamais le contraire. Avant de répondre sur le fonctionnement du site (pages, clés, SDK, CLI, MCP, machines), appelle docs_search.`;
const SYSTEM_STATE = `ÉTAT DE LA VÉRIFICATION (à dire tel quel si on te demande si c'est réel, vérifié ou simulé ; ne promets jamais plus) : ${VERIFICATION_STATE}`;

/** The console's prompt (the default surface, unchanged: test/console-pin.test.ts pins it). */
export const COPILOT_SYSTEM = [SYSTEM_HEAD, CONSOLE_UI_PARAGRAPH, SYSTEM_STATE].join("\n");
/** The site's prompt (COPILOT_SURFACE=site): the same, with the paragraph that drives the site (site.ts). */
export const SITE_SYSTEM = [SYSTEM_HEAD, SITE_UI_PARAGRAPH, SYSTEM_STATE].join("\n");

/** An integer ≥ min read from the environment, otherwise the default value. */
export function intEnv(name: string, def: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min ? n : def;
}

/** The stack the tools read: DEPLOYMENTS (deployments.*.json) when given, otherwise the SDK's built-in testnet stack. */
export function deploymentFromEnv(path = process.env.DEPLOYMENTS): { deployment: Deployment; source: string } {
  const p = path?.trim();
  if (!p) return { deployment: testnet, source: "v2 du SDK" };
  return { deployment: deploymentFromJson(JSON.parse(readFileSync(p, "utf8"))), source: p };
}

/** The surface served: the console's bubble (default) or the site's panel. */
export type Surface = "console" | "site";

/** COPILOT_SURFACE: absent, empty or "console" → console; "site" → site. Any other value is a configuration error: the
 *  start stops rather than serve the wrong prompt under /copilot-site/. */
export function surfaceFromEnv(raw: string | undefined = process.env.COPILOT_SURFACE): Surface {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "" || v === "console") return "console";
  if (v === "site") return "site";
  throw new Error(`invalid COPILOT_SURFACE: "${String(raw).slice(0, 40)}" (expected: console or site)`);
}

export interface CopilotFromEnv {
  /** The options of createCopilotApp (model, tools, prompt, guards). */
  options: CopilotAppOptions;
  port: number;
  model: string;
  /** OPENAI_BASE_URL, or "openai". */
  provider: string;
  hasKey: boolean;
  deploymentSource: string;
  surface: Surface;
  /** The start-up line (without any secret). */
  banner: string;
}

/** The copilot described by the environment (process.env). `deployment`: the stack already read (otherwise DEPLOYMENTS
 *  or the SDK's built-in stack). */
export function copilotFromEnv(o: { deployment?: Deployment; deploymentSource?: string; fetch?: typeof fetch } = {}): CopilotFromEnv {
  const surface = surfaceFromEnv();
  const site = surface === "site";
  const MODEL = process.env.COPILOT_MODEL ?? "gpt-4o-mini";
  const BASE_URL = process.env.OPENAI_BASE_URL; // ex. https://api.deepseek.com pour DeepSeek
  const PORT = Number(process.env.PORT ?? "8808");
  const RPC = process.env.RPC_URL ?? "https://rpc.testnet.arc.io";
  const dep = o.deployment ? { deployment: o.deployment, source: o.deploymentSource ?? "fournie" } : deploymentFromEnv();
  const D = dep.deployment;
  const chain = D.chainId === arcTestnet.id ? arcTestnet : defineChain({ ...arcTestnet, id: D.chainId, name: `Arc (${D.chainId})` });

  // Arc's public RPC answers 429 to bursts: viem retries with a growing delay
  const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 400 }) });
  const ctx: ToolCtx = { arc: createArcClient({ publicClient: pub as any, deployment: D }) };

  // tools in the OpenAI format (function calling); the site replaces the console's ui_navigate with its own interface tools
  const OAI_TOOLS = (site ? SITE_TOOL_DEFS : TOOL_DEFS).map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema as any },
  }));

  const key = process.env.OPENAI_API_KEY;
  // a model call never holds the request beyond its deadline (signal); one retry only; max_tokens on every call
  // (llm.ts)
  const llm: Llm | null = key ? openAiLlm({ apiKey: key, baseURL: BASE_URL, model: MODEL, ...(o.fetch ? { fetch: o.fetch } : {}) }) : null;

  const allowedOrigins = parseOrigins(process.env.ALLOWED_ORIGINS);
  const rate = {
    perMinute: intEnv("COPILOT_RATE_PER_MINUTE", 20),
    perDay: intEnv("COPILOT_RATE_PER_DAY", 300),
    globalPerDay: intEnv("COPILOT_GLOBAL_PER_DAY", 2_000), // model spending cap, all IPs together (0 = none)
  };
  // bounded cost: output tokens per model call, what is added to the history during a request (tool results and model
  // outputs), and the summed input of all model calls of a request
  const caps = {
    maxTokensPerCall: intEnv("COPILOT_MAX_TOKENS", DEFAULT_CAPS.maxTokensPerCall, 1),
    maxToolCharsPerRequest: intEnv("COPILOT_MAX_TOOL_CHARS", DEFAULT_CAPS.maxToolCharsPerRequest, 1),
    maxInputCharsPerRequest: intEnv("COPILOT_MAX_INPUT_CHARS", DEFAULT_CAPS.maxInputCharsPerRequest, 1),
    maxInputTokensPerRequest: intEnv("COPILOT_MAX_INPUT_TOKENS", DEFAULT_CAPS.maxInputTokensPerRequest, 1),
  };

  const options: CopilotAppOptions = {
    llm, system: site ? SITE_SYSTEM : COPILOT_SYSTEM, tools: OAI_TOOLS, display: site ? SITE_DISPLAY : DISPLAY, allowedOrigins, rate, caps,
    executeTool: site
      ? (name, args, user) => executeSiteTool(name, args, { ...ctx, user })
      : (name, args, user) => executeTool(name, args, { ...ctx, user }),
    health: {
      model: MODEL, provider: BASE_URL ?? "openai", maxTokens: caps.maxTokensPerCall, maxToolChars: caps.maxToolCharsPerRequest,
      maxInputChars: caps.maxInputCharsPerRequest, maxInputTokens: caps.maxInputTokensPerRequest,
      ...(site ? { surface: "site" } : {}),
    },
    secrets: key ? [key] : [], // the model key never leaves: not to the visitor, not to the model, not to the log
    // site: interface tools validated in the loop, page context, the site's language instruction, and the network state
    // read for each answer (site-live.ts: active enclaves, levels, bounties of both levels)
    ...(site ? { site: { ...SITE_SURFACE, liveNote: createLiveNote({ arc: ctx.arc }) } } : {}),
  };
  const banner = `model=${MODEL}  key=${key ? "yes" : "NO"}  origins=${allowedOrigins.join(",")}  rate=${rate.perMinute}/min ${rate.perDay}/day per IP, ${rate.globalPerDay || "∞"}/day in total  max_tokens=${caps.maxTokensPerCall}  history≤${caps.maxToolCharsPerRequest} chars/request  input≤${caps.maxInputCharsPerRequest} chars and ≤${caps.maxInputTokensPerRequest} estimated tokens/request  lists=${archiveBase()}  stack=${dep.source}${site ? "  surface=site" : ""}`;
  return { options, port: PORT, model: MODEL, provider: BASE_URL ?? "openai", hasKey: !!key, deploymentSource: dep.source, surface, banner };
}
