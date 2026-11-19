/** app.ts — l'application HTTP du copilote (Hono), sans état global : server.ts la monte avec le vrai modèle et les vrais
 *  outils (enclave-app.ts aussi, dans une enclave), les tests avec un modèle simulé. Garde-fous de l'audit du 7/11 et des
 *  restes relevés le 8/11 :
 *  - n° 4 : CORS limité au site (ALLOWED_ORIGINS) et requête d'une autre origine refusée côté serveur ; JSON seulement ;
 *    corps ≤ 64 Kio ; conversation validée (rôles user et assistant, texte seulement, 20 messages, 4 000 caractères
 *    chacun, 16 000 au total) ; débit par IP (20 par minute, 300 par jour) et plafond global quotidien ; outils
 *    plafonnés (4 par tour, 10 par requête ; les appels en trop d'un tour ne sont ni exécutés ni renvoyés au modèle) et
 *    6 appels au modèle au plus par requête ; délai global sous celui de Caddy ;
 *  - coût borné : max_tokens à chaque appel au modèle (2 000 par défaut) et plafond CUMULÉ des résultats d'outils
 *    renvoyés au modèle pendant une requête (40 000 caractères par défaut, refus compris) ; au-delà, plus d'outil et
 *    réponse en texte seulement ;
 *  - n° 10 : filtre de secrets sur les messages (plus sévère sur ceux de l'utilisateur), sur CHAQUE résultat d'outil
 *    envoyé au modèle (journaux de machines compris) et sur la réponse ; les secrets du serveur (clé du modèle) sont
 *    retirés de tout ce qui sort ;
 *  - une erreur du fournisseur du modèle n'est jamais renvoyée telle quelle : le visiteur reçoit un message générique et
 *    un code (modele_401, modele_429, modele_delai…), le détail filtré va au journal du serveur.
 *  9/11 :
 *  - langue (i18n.ts) : champ `lang` du corps ("en" | "fr"), sinon la langue du dernier message de l'utilisateur, sinon
 *    Accept-Language, sinon l'anglais ; réponses, refus et messages d'action dans cette langue (les refus d'avant la
 *    lecture du corps suivent Accept-Language) ; chaque refus porte aussi un `code` stable ;
 *  - conversation chiffrée (option `sealed`, copilote en enclave) : POST /chat accepte aussi { sealed, enc, ciphertext },
 *    une conversation chiffrée par HPKE vers la clé X25519 de l'enclave (vérifiée sur Arc par le client) ; tout ce qui
 *    suit son ouverture (refus compris) repart SCELLÉ pour ce seul client, en HTTP 200, le vrai statut dans le chiffré.
 *    Le mode clair reste accepté (compatibilité).
 *  9/11, restes du vérificateur :
 *  - coût : les SORTIES du modèle renvoyées au tour suivant (texte et arguments des appels d'outils) comptent dans le
 *    plafond cumulé de l'historique (COPILOT_MAX_TOOL_CHARS), comme les résultats d'outils ; et un budget d'ENTRÉE
 *    cumulé par requête (COPILOT_MAX_INPUT_CHARS, 160 000 caractères par défaut : invite, définitions d'outils et
 *    historique de CHAQUE appel au modèle) : un tour d'outils n'est permis que si l'appel final qui le suit tient encore
 *    dans ce budget, et aucun appel ne le dépasse (au-delà, réponse locale, code input_budget) ;
 *  - débit par IP du copilote en enclave (option `proxyToken`) : POST /chat exige l'en-tête x-archive-proxy-token du
 *    mandataire du site (comparaison en temps constant), sinon 403 proxy_required, et X-Forwarded-For n'est cru que
 *    s'il est bon ; /health (et, dans l'enclave, /attest et /pubkeys) restent publics. Sans l'option (VPS), rien ne
 *    change.
 *  9/11 au soir (preuve cost-unicode du vérificateur : 98 000 caractères de syllabes yi ≈ 139 000 jetons) : le budget
 *  d'entrée se compte AUSSI en JETONS ESTIMÉS (COPILOT_MAX_INPUT_TOKENS, 50 000 par défaut ; estimateTokens : 0,3 jeton
 *  par caractère ASCII, 3 par autre caractère, sur l'invite, les définitions d'outils et l'historique de CHAQUE appel).
 *  Borne DURE, premier appel compris : l'historique le plus ancien est retiré pour qu'il tienne (sinon, réponse locale,
 *  code input_budget). Le budget en caractères (COPILOT_MAX_INPUT_CHARS) reste, en plus.
 *  18/11 au soir (surface site seulement ; la console ne change pas) : ui_guide validé dans la boucle comme les autres
 *  outils d'interface (notes dans la langue de la réponse) ; filet des guides (une demande claire de faire sans guide joué :
 *  sa page si elle n'est pas affichée, puis sa recette) ; ligne « où tu tournes » du site (whereNote) quand aucune note
 *  d'enclave (systemNote) ne la remplace. */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { type Address, type Hex, toBytes, toHex } from "viem";
import type OpenAI from "openai";
import {
  DEFAULT_BOUNDS, PROXY_TOKEN_HEADER, parseChatRequest, proxyTokenChecker, readBodyCapped, RateLimiter, clientIp, bucketOf,
  originAllowed, type ChatBounds, type RateOptions,
} from "./guard";
import { scrubSecrets, redactLiterals } from "./secrets";
import { DEFAULT_LANG, LANGS, T, detectLang, langFromAcceptLanguage, languageDirective, resolveLang, userTextsOf, type Lang } from "./i18n";

export interface LlmToolCall { id: string; type?: "function"; function: { name: string; arguments: string } }
export interface LlmReply { content?: string | null; tool_calls?: LlmToolCall[] | null }
export interface LlmRequest {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools: OpenAI.Chat.ChatCompletionTool[];
  tool_choice: "auto" | "none";
  /** Jetons de sortie au plus pour cet appel (paramètre max_tokens du fournisseur). */
  max_tokens: number;
  signal: AbortSignal;
}
/** Un appel au modèle (OpenAI ou compatible) : rend le message de la première réponse. */
export type Llm = (req: LlmRequest) => Promise<LlmReply>;

export interface ToolCaps {
  /** Outils exécutés au plus par tour du modèle (les suivants reçoivent un refus). */
  perTurn: number;
  /** Outils exécutés au plus par requête HTTP. */
  perRequest: number;
  /** Appels au modèle au plus par requête HTTP (relance d'une réponse vide et réponse finale comprises). */
  maxModelCalls: number;
  /** Caractères au plus d'un résultat d'outil renvoyé au modèle (le résultat complet reste dans `actions`). */
  maxResultChars: number;
  /** Délai global d'une requête, en ms (sous le read_timeout de 180 s de Caddy). */
  deadlineMs: number;
  /** Jetons de sortie au plus par appel au modèle (max_tokens). */
  maxTokensPerCall: number;
  /** Caractères au plus de TOUT ce qui s'ajoute à l'historique pendant une requête et repart au modèle à chaque appel :
   *  résultats d'outils (refus compris) ET sorties du modèle (texte et arguments des appels d'outils). */
  maxToolCharsPerRequest: number;
  /** Caractères d'entrée au plus envoyés au modèle pendant une requête, tous appels confondus (messages et définitions
   *  d'outils, comptés en JSON) : borne DURE du coût d'entrée d'une requête (seul le premier appel peut la dépasser, si
   *  elle est réglée plus bas que lui). */
  maxInputCharsPerRequest: number;
  /** JETONS d'entrée ESTIMÉS (estimateTokens) au plus envoyés au modèle pendant une requête, tous appels confondus
   *  (messages et définitions d'outils, en JSON) : borne DURE, premier appel compris (l'historique le plus ancien est
   *  retiré pour le faire tenir). Un caractère « dense » (yi, CJK rare…) coûte ≈ 3 jetons : le budget en caractères seul
   *  ne bornait pas le coût (9/11 au soir). */
  maxInputTokensPerRequest: number;
}
export const DEFAULT_CAPS: ToolCaps = {
  perTurn: 4, perRequest: 10, maxModelCalls: 6, maxResultChars: 16_000, deadlineMs: 150_000,
  maxTokensPerCall: 2_000, maxToolCharsPerRequest: 40_000, maxInputCharsPerRequest: 160_000, maxInputTokensPerRequest: 50_000,
};

/** Estimation PRUDENTE du nombre de jetons, par unité UTF-16 : 0,3 jeton par caractère ASCII, 3 par tout autre caractère.
 *  Mesure du vérificateur (9/11, BPE à octets) : anglais 0,25, français 0,27, CJK courant 0,9, yi et CJK rares 2,97
 *  jetons par caractère JS (un caractère hors du plan de base compte deux fois 3). Elle surestime le texte accentué :
 *  c'est une borne de coût, pas une facture. */
export const TOKENS_PER_ASCII_CHAR = 0.3;
export const TOKENS_PER_OTHER_CHAR = 3;
export function estimateTokens(s: string): number {
  let ascii = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 0x80) ascii++;
  return Math.ceil(ascii * TOKENS_PER_ASCII_CHAR + (s.length - ascii) * TOKENS_PER_OTHER_CHAR);
}
/** En dessous de ce reste de budget, un nouvel outil n'est plus exécuté (son résultat serait réduit à la marque de troncature). */
const MIN_TOOL_RESULT = 1_000;
/** Pour prévoir la taille de l'appel suivant : caractères au plus par jeton de sortie (estimation), surcoût du JSON
 *  (guillemets échappés des résultats d'outils) et marge des refus et notes ajoutés à un tour. */
const OUTPUT_CHARS_PER_TOKEN = 4;
const JSON_OVERHEAD = 1.25;
const TURN_MARGIN = 1_000;

/** Résultat d'un outil d'interface du site : l'entrée normalisée (le navigateur l'exécute), ou le refus et sa raison. */
export type UiResult = ({ ok: true } & Record<string, unknown>) | { ok: false; error: string };
/** Les outils d'interface d'UNE requête (page courante, actions déjà acceptées) ; `current` : la page affichée après les
 *  actions acceptées (18/11 au soir : le filet des guides en a besoin). */
export interface UiSession { run(name: string, args: unknown): UiResult; current?(): string | undefined }
/** Une entrée de `tools` dans la réponse du site, dans l'ordre d'exécution : l'outil, son libellé, son entrée ; `result`
 *  pour les outils d'interface (l'écho validé) et les outils prepare (les données complètes, comme dans `actions`). */
export interface SiteToolEntry { tool: string; label: string; input?: unknown; result?: unknown; inline?: true; inferred?: true }
/** 16/11 : la surface « site » (COPILOT_SURFACE=site, implémentée par site.ts). Absente : la console, inchangée. */
export interface SiteSurface {
  /** Les outils d'interface : validés dans la boucle (jamais par executeTool), exécutés par le navigateur. */
  uiTools: ReadonlySet<string>;
  /** Le contexte `page` du corps de la requête : la ligne ajoutée à l'invite et la page de départ ; undefined s'il manque
   *  ou s'il est invalide. */
  pageContext(body: unknown): { line: string; page: string } | undefined;
  /** Les outils d'interface d'une requête, à partir de la page affichée ; `lang` : la langue de la réponse. */
  uiSession(page: string | undefined, lang?: Lang): UiSession;
  /** La consigne de langue de la surface (à la fin de l'invite, à la place de celle de la console) : `lang`, la langue du
   *  site (libellés des pages et des boutons) ; `replyLang`, celle de la réponse (16/11 : celle de la question). */
  languageDirective(lang: Lang, replyLang?: Lang): string;
  /** Un appel d'interface écrit dans le texte au lieu d'être appelé : retiré du texte, rendu comme un appel (ui_navigate,
   *  ou l'outil nommé par `tool`). */
  extractInline(text: string): { text: string; input?: Record<string, unknown>; tool?: string };
  /** 16/11 : la page que la demande montre clairement (mots-clés), quand le modèle n'a rien montré ni préparé. */
  intentNav?(q: string, lang: Lang): Record<string, unknown> | undefined;
  /** 18/11 au soir : le guide que la demande appelle clairement (installer, lancer une enclave…), quand le modèle n'en a
   *  joué aucun : l'ouverture de sa page si elle n'est pas affichée (`navigate`), puis le guide. `prepared` : une carte à
   *  signer est déjà préparée. */
  intentGuide?(q: string, o: { lang: Lang; current?: string; start?: string; prepared?: boolean }): { navigate?: Record<string, unknown>; guide: Record<string, unknown> } | undefined;
  /** 18/11 au soir : où tourne ce copilote, dit en une ligne de l'invite quand aucune `systemNote` ne le dit (enclave). */
  whereNote?: string;
  /** 18/11 au soir : la réponse quand le modèle n'a rien écrit et qu'un guide joue. */
  guideText?(lang: Lang): string;
  /** 19/11 : la phrase qui dit sur quelle page joue un guide ajouté par le filet (le modèle ne l'a pas vu), si la réponse
   *  ne nomme pas déjà cette page ; undefined sinon. */
  guidePageNote?(lang: Lang, page: string, text: string): string | undefined;
  /** 19/11 au soir : ce qui ne s'affiche jamais dans une réponse (libellés internes de l'invite, marques de source de
   *  docs_search, identifiants de page entre crochets), retiré du texte final. */
  stripLabels?(text: string): string;
  /** 19/11 au soir : la réponse fixe et vraie à « ce chat tourne-t-il dans une enclave ? » sur le serveur du site (seulement
   *  avec whereNote : l'enclave du produit 4 la retire, elle garde sa propre réponse). */
  whereAnswer?(text: string, lang: Lang): string | undefined;
  /** 19/11 : l'état du réseau lu AU MOMENT de répondre (site-live.ts : enclaves actives, niveaux, primes ouvertes), en une
   *  ligne de l'invite après celle de la page ; ne lève jamais (ligne de repli), borné dans le temps. */
  liveNote?(): Promise<string | undefined>;
}

/** Une requête chiffrée ouverte : son texte, et de quoi sceller LA réponse pour ce seul client. */
export interface SealedRequest {
  plaintext: Uint8Array;
  seal(response: Uint8Array): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }>;
}
/** Conversation chiffrée (copilote en enclave) : l'enclave ouvre la requête avec sa clé X25519 (kit d'enclave). */
export interface SealedChannel {
  /** Étiquette du protocole : valeur attendue du champ `sealed` (ARC-COPILOT-CHAT-v1). */
  tag: string;
  /** Ouvre une requête (lève si elle n'est pas pour cette enclave ou a été modifiée). */
  open(enc: Uint8Array, ciphertext: Uint8Array): Promise<SealedRequest>;
}

export interface CopilotAppOptions {
  /** null : aucune clé de modèle configurée. */
  llm: Llm | null;
  /** Invite système (la ligne du wallet connecté, les notes de troncature et la consigne de langue y sont ajoutées). */
  system: string;
  tools: OpenAI.Chat.ChatCompletionTool[];
  executeTool: (name: string, args: any, user?: Address) => Promise<{ result: unknown; citations?: string[] }>;
  /** Libellés « à points » des outils (affichage). */
  display?: Record<string, string>;
  /** Outils qui PRÉPARENT une action à signer : leur résultat complet part au navigateur dans `actions`. */
  prepareTools?: Iterable<string>;
  allowedOrigins: string[];
  rate: RateOptions;
  bounds?: ChatBounds;
  caps?: Partial<ToolCaps>;
  /** Champs ajoutés à GET /health. */
  health?: Record<string, unknown>;
  /** Secrets du serveur (clé du modèle…) : retirés de tout ce qui part vers le visiteur, le modèle ou le journal. */
  secrets?: string[];
  /** Journal du serveur (défaut : console.error) ; les lignes y arrivent filtrées. */
  log?: (line: string) => void;
  /** Conversation chiffrée (copilote en enclave) ; absente : une enveloppe chiffrée est refusée (400 sealed_unavailable). */
  sealed?: SealedChannel;
  /** Ligne ajoutée à l'invite système pour chaque requête (ex. : où tourne le copilote, conversation chiffrée ou non). */
  systemNote?: (x: { sealed: boolean; lang: Lang }) => string;
  /** Copilote en enclave : jeton du mandataire du site (COPILOT_PROXY_TOKEN). POST /chat exige alors l'en-tête
   *  x-archive-proxy-token (sinon 403 proxy_required) et X-Forwarded-For n'est cru que s'il est bon. Absent (VPS) :
   *  aucun jeton, X-Forwarded-For cru derrière un proxy local. */
  proxyToken?: string;
  /** 16/11 : la surface « site » (panneau du front, /copilot-site/) : outils d'interface validés ici, contexte `page`
   *  dit en une ligne de l'invite, consigne de langue du site, `tools` détaillé dans la réponse (SiteToolEntry), sans
   *  `navigate`. Absente : la console, exactement comme avant. */
  site?: SiteSurface;
}

const DEFAULT_PREPARE = ["session_prepare_open", "operator_prepare_bond", "operator_prepare_register", "bounty_prepare_create"];

type Status = 200 | 400 | 403 | 413 | 415 | 429;
interface Answer { status: 200 | 400 | 413 | 429; body: Record<string, unknown>; retryAfterSec?: number }

/** Corps d'une enveloppe chiffrée au plus : la conversation (64 Kio) en hexadécimal, plus les champs. */
export const sealedBodyCap = (b: ChatBounds) => 2 * b.maxBodyBytes + 4_096;

const isHexBytes = (x: unknown, bytes?: number): x is Hex =>
  typeof x === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(x) && (bytes === undefined || x.length === 2 + 2 * bytes);

export function createCopilotApp(o: CopilotAppOptions): Hono {
  const bounds = o.bounds ?? DEFAULT_BOUNDS;
  const caps: ToolCaps = { ...DEFAULT_CAPS, ...(o.caps ?? {}) };
  const limiter = new RateLimiter(o.rate);
  const proxyOk = o.proxyToken ? proxyTokenChecker(o.proxyToken) : null;
  const app = new Hono();

  // CORS : seul le site (ALLOWED_ORIGINS) reçoit Access-Control-Allow-Origin ; jamais « * » par défaut
  app.use("*", cors({
    origin: (origin) => (origin && originAllowed(origin, o.allowedOrigins) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type"],
    maxAge: 600,
  }));
  app.get("/health", (c) => c.json({
    ok: true, ...(o.health ?? {}), languages: LANGS, sealed: o.sealed?.tag ?? null, ...(proxyOk ? { proxyTokenRequired: true } : {}),
  }));

  // 5) et 6) : la conversation validée, puis le modèle ; la même suite en clair et chiffré
  const answer = async (json: unknown, lang: Lang, sealed: boolean): Promise<Answer> => {
    // 5) conversation : rôles user/assistant, texte seulement, historique borné, secrets masqués
    const chat = parseChatRequest(json, bounds, lang);
    if (!chat.ok) return { status: 400, body: refusal(chat.error, lang, "bad_conversation") };
    if (!o.llm) return { status: 200, body: { text: T(lang).noKey, tools: [], citations: [] } };
    // 6) plafond global quotidien (dépense du modèle)
    const g = limiter.hitGlobal();
    if (!g.ok) return { status: 429, body: { ...refusal(T(lang).globalCap, lang, "global_cap"), retryAfterSec: g.retryAfterSec }, retryAfterSec: g.retryAfterSec };
    // site : la page affichée (champ `page`), validée ; rien pour la console
    const page = o.site ? o.site.pageContext(json) : undefined;
    return { status: 200, body: await runChat(o, caps, chat.messages, chat.user, { dropped: chat.dropped, truncated: chat.truncated }, lang, sealed, page) };
  };

  // conversation chiffrée : ouverte par l'enclave ; tout ce qui suit repart scellé pour ce seul client
  const sealedChat = async (c: Context, env: Record<string, unknown>, early: Lang, acceptLanguage: string | undefined) => {
    const ch = o.sealed;
    if (!ch) return refuse(c, 400, T(early).sealed.unavailable, early, "sealed_unavailable");
    const { enc, ciphertext } = env;
    if (env.sealed !== ch.tag || !isHexBytes(enc, 32) || !isHexBytes(ciphertext) || ciphertext.length < 2 + 2 * 17) {
      return refuse(c, 400, T(early).sealed.malformed, early, "sealed_malformed");
    }
    let req: SealedRequest;
    try {
      req = await ch.open(toBytes(enc), toBytes(ciphertext));
    } catch {
      return refuse(c, 400, T(early).sealed.undecryptable, early, "sealed_undecryptable");
    }
    const reply = async (a: Answer) => {
      const s = await req.seal(new TextEncoder().encode(JSON.stringify({ status: a.status, body: a.body }, bigintSafe)));
      return c.json({ sealed: ch.tag, nonce: toHex(s.nonce), ciphertext: toHex(s.ciphertext) }, 200);
    };
    if (req.plaintext.byteLength > bounds.maxBodyBytes) {
      return reply({ status: 413, body: refusal(T(early).tooLarge(Math.round(bounds.maxBodyBytes / 1024), bounds.maxMessages), early, "too_large") });
    }
    let inner: unknown;
    try {
      inner = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(req.plaintext));
    } catch {
      return reply({ status: 400, body: refusal(T(early).badJson, early, "bad_json") });
    }
    const lang = resolveLang({ requested: (inner as { lang?: unknown } | null)?.lang, userTexts: userTextsOf(inner), acceptLanguage });
    return reply(await answer(inner, lang, true));
  };

  app.post("/chat", async (c) => {
    const acceptLanguage = c.req.header("accept-language");
    // avant la lecture du corps, seule Accept-Language dit la langue (défaut : anglais)
    const early = langFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LANG;
    // 0) copilote en enclave : seul le mandataire du site (jeton partagé, variable chiffrée) fait dépenser le modèle, et
    //    seul lui fait croire X-Forwarded-For : appeler l'URL Phala directement ne contourne plus le débit par IP
    const proxied = proxyOk ? proxyOk(c.req.header(PROXY_TOKEN_HEADER)) : undefined;
    if (proxyOk && !proxied) return refuse(c, 403, T(early).proxyRequired, early, "proxy_required");
    // 1) origine : une page d'un autre site ne fait pas dépenser le modèle (même sans lire la réponse)
    const origin = c.req.header("origin");
    if (origin && !originAllowed(origin, o.allowedOrigins)) {
      return refuse(c, 403, T(early).originRefused(origin.slice(0, 100)), early, "origin_refused");
    }
    // 2) débit par IP (X-Forwarded-For posé par Caddy) : toute requête compte, même refusée ensuite
    const v = limiter.hit(bucketOf(clientIp(c, proxied)));
    if (!v.ok) {
      c.header("Retry-After", String(v.retryAfterSec));
      return v.scope === "minute"
        ? refuse(c, 429, T(early).rateMinute(v.retryAfterSec), early, "rate_minute")
        : refuse(c, 429, T(early).rateDay(Math.ceil(v.retryAfterSec / 3600)), early, "rate_day");
    }
    // 3) JSON seulement : une requête d'une autre origine passe ainsi toujours par le contrôle préalable CORS
    if (!/^application\/json\s*(;|$)/i.test(c.req.header("content-type") ?? "")) {
      return refuse(c, 415, T(early).jsonOnly, early, "json_only");
    }
    // 4) corps borné (Content-Length annoncé, puis compté au fil de la lecture) ; une enveloppe chiffrée, en
    //    hexadécimal, a droit au double : la conversation qu'elle porte reste bornée à 64 Kio
    const tooLarge = () => refuse(c, 413, T(early).tooLarge(Math.round(bounds.maxBodyBytes / 1024), bounds.maxMessages), early, "too_large");
    const raw = await readBodyCapped(c.req.raw, o.sealed ? sealedBodyCap(bounds) : bounds.maxBodyBytes);
    if (!raw.ok) return raw.status === 413 ? tooLarge() : refuse(c, 400, T(early).badLength, early, "bad_length");
    let json: unknown;
    try { json = JSON.parse(raw.text); } catch { return refuse(c, 400, T(early).badJson, early, "bad_json"); }
    if (json && typeof json === "object" && !Array.isArray(json) && "sealed" in json) {
      return sealedChat(c, json as Record<string, unknown>, early, acceptLanguage);
    }
    if (o.sealed && Buffer.byteLength(raw.text, "utf8") > bounds.maxBodyBytes) return tooLarge();
    const lang = resolveLang({ requested: (json as { lang?: unknown } | null)?.lang, userTexts: userTextsOf(json), acceptLanguage });
    const a = await answer(json, lang, false);
    if (a.retryAfterSec !== undefined) c.header("Retry-After", String(a.retryAfterSec));
    return c.json(a.body, a.status);
  });

  return app;
}

/** Corps d'un refus : `text` est ce que la bulle du site peut afficher tel quel ; `code` est stable (machines). */
function refusal(message: string, lang: Lang, code: string) {
  return { error: message, text: T(lang).refused(message), code, tools: [], citations: [] };
}
function refuse(c: Context, status: Exclude<Status, 200>, message: string, lang: Lang, code: string) {
  return c.json(refusal(message, lang, code), status);
}

// ---------------------------------------------------------------- la boucle d'outils

type ChatMsg = { role: "user" | "assistant"; content: string };

async function runChat(
  o: CopilotAppOptions, caps: ToolCaps, history: ChatMsg[], user: Address | undefined, cut: { dropped: number; truncated: number },
  lang: Lang = "fr", sealed = false, page?: { line: string; page: string },
) {
  const display = o.display ?? {};
  const prepare = new Set(o.prepareTools ?? DEFAULT_PREPARE);
  const secrets = (o.secrets ?? []).filter((k) => typeof k === "string" && k.length >= 8);
  const log = o.log ?? ((line: string) => console.error(line));
  const M = T(lang);
  const walletLine = user
    ? `\nWallet connecté de l'utilisateur : ${user} (adresse par défaut des outils prepare, de machines_list et de sessions_list).`
    : "\nAucun wallet connecté : les outils prepare renvoient des gabarits à compléter avec l'adresse de l'utilisateur.";
  // site : la page affichée, en une ligne de valeurs validées (site.ts) ; jamais pour la console
  const pageLine = o.site && page ? `\n${page.line}` : "";
  // site (19/11) : l'état du réseau lu maintenant (LIVE STATUS), jamais un état écrit d'avance ; rien pour la console
  const live = o.site?.liveNote ? await o.site.liveNote().catch(() => undefined) : undefined;
  const liveLine = live ? `\n${live}` : "";
  const cutLineOf = (dropped: number) => dropped || cut.truncated
    ? `\nNote : la conversation reçue a été raccourcie (${dropped} message(s) ancien(s) retiré(s), ${cut.truncated} message(s) tronqué(s)) ; ne prétends pas avoir lu ce qui manque.`
    : "";
  // où tourne le copilote : la note de l'enclave, sinon (site, 18/11 au soir) celle du serveur du site ; rien pour la console
  const note = o.systemNote ? `\n${o.systemNote({ sealed, lang })}` : o.site?.whereNote ? `\n${o.site.whereNote}` : "";
  // site (16/11) : la réponse suit la langue du dernier message quand on la reconnaît (une question en français sur le
  // site anglais reçoit une réponse en français) ; les libellés des pages restent ceux de l'écran. Le modèle suit mal une
  // consigne souple (« réponds dans sa langue ») : la langue est décidée ici, et la consigne reste ferme.
  // Un message de moins de 3 mots (« hello », « ok ») ne dit pas sa langue : la langue du site.
  const lastUserText = history.filter((m) => m.role === "user").slice(-1)[0]?.content ?? "";
  const longEnough = lastUserText.trim().split(/\s+/).filter(Boolean).length >= 3;
  const replyLang: Lang = o.site && longEnough ? (detectLang(lastUserText) ?? lang) : lang;
  const directive = o.site ? o.site.languageDirective(lang, replyLang) : languageDirective(lang);
  // la consigne de langue en DERNIER : elle prime sur l'invite (rédigée en français)
  const systemOf = (dropped: number): OpenAI.Chat.ChatCompletionMessageParam =>
    ({ role: "system", content: `${o.system}${walletLine}${pageLine}${liveLine}${cutLineOf(dropped)}${note}\n${directive}` });
  // site : les outils d'interface de cette requête (page courante, 3 actions au plus, notes des guides dans la langue de
  // la réponse) et la liste détaillée des outils
  const ui = o.site ? o.site.uiSession(page?.page, replyLang) : null;
  const siteTools: SiteToolEntry[] = [];
  /** 19/11 : la page où s'applique chaque action d'interface acceptée (après elle) : un guide qui joue sur une autre page
   *  rend inutiles les gestes faits avant lui ailleurs (le navigateur ouvrirait une page pour la quitter aussitôt). */
  const pageAt = new Map<SiteToolEntry, string | undefined>();
  // budget en JETONS estimés, premier appel compris : les messages les plus anciens tombent jusqu'à ce qu'il tienne
  const toolsTokens = estimateTokens(JSON.stringify(o.tools ?? []));
  let kept: ChatMsg[] = history;
  let dropped = cut.dropped;
  const firstTokens = () => estimateTokens(JSON.stringify([systemOf(dropped), ...kept])) + toolsTokens;
  while (kept.length > 1 && firstTokens() > caps.maxInputTokensPerRequest) {
    kept = kept.slice(1);
    dropped++;
  }
  const firstTooBig = firstTokens() > caps.maxInputTokensPerRequest;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    systemOf(dropped),
    ...kept.map((m) => ({ role: m.role, content: m.content })),
  ];
  const toolsUsed: string[] = [];
  const citations = new Set<string>();
  let navigate: string | undefined; // page à ouvrir dans le navigateur (le bot pilote le front)
  // actions PRÉPARÉES (jamais exécutées ici) : le navigateur les affiche avec un bouton « Signer avec mon wallet »
  const actions: Array<{ tool: string; input: unknown; result: unknown }> = [];
  const lastUser = history.filter((m) => m.role === "user").slice(-1)[0]?.content ?? "";
  const deadline = Date.now() + caps.deadlineMs;
  let modelCalls = 0, toolsRun = 0, refused = 0;
  // caractères ajoutés à l'historique pendant la requête (chaque appel au modèle les renvoie tous) : résultats d'outils
  // ET sorties du modèle (texte et arguments des appels d'outils)
  let historyChars = 0;
  const budgetLeft = () => caps.maxToolCharsPerRequest - historyChars;
  const budgetMark = caps.maxToolCharsPerRequest.toLocaleString("fr-FR");
  // entrée déjà envoyée au modèle (messages et définitions d'outils de chaque appel, en JSON) : caractères et jetons estimés
  const toolsChars = JSON.stringify(o.tools ?? []).length;
  let inputChars = 0;
  let inputTokens = 0;
  const inputOf = (extra: OpenAI.Chat.ChatCompletionMessageParam[] = []) => {
    const json = JSON.stringify(extra.length ? [...messages, ...extra] : messages);
    return { chars: json.length + toolsChars, tokens: estimateTokens(json) + toolsTokens };
  };

  const ask = (tool_choice: "auto" | "none", extra: OpenAI.Chat.ChatCompletionMessageParam[], size: { chars: number; tokens: number }) => {
    modelCalls++;
    inputChars += size.chars;
    inputTokens += size.tokens;
    return o.llm!({
      messages: [...messages, ...extra], tools: o.tools, tool_choice, max_tokens: caps.maxTokensPerCall,
      signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
    });
  };
  const reply = (text: string, code?: string) => {
    if (o.site && ui) {
      // site : un appel écrit dans le texte devient un vrai appel (ui_navigate, ou ui_guide pour une recette ; validé,
      // dans la limite des 3 actions)
      const fs = o.site.extractInline(text);
      if (fs.input) {
        const tool = fs.tool ?? "ui_navigate";
        const r = ui.run(tool, fs.input);
        if (r.ok) { const e: SiteToolEntry = { tool, label: display[tool] ?? tool, input: fs.input, result: r, inline: true }; siteTools.push(e); pageAt.set(e, ui.current?.()); }
      }
      const played = (t: SiteToolEntry) => o.site!.uiTools.has(t.tool) && (t.result as { ok?: boolean } | undefined)?.ok === true;
      const guided = () => siteTools.some((t) => t.tool === "ui_guide" && played(t));
      // 18/11 au soir : filet des guides — une demande claire de faire (installer l'outil, lancer une enclave…) sans guide
      // joué : sa page (si elle n'est pas affichée), puis sa recette ; rien si l'ouverture de la page est refusée
      if (!code && !guided() && o.site.intentGuide) {
        const g = o.site.intentGuide(lastUser, { lang: replyLang, current: ui.current?.(), start: page?.page, prepared: actions.length > 0 });
        const nav = g?.navigate ? ui.run("ui_navigate", g.navigate) : undefined;
        if (g?.navigate && nav?.ok) siteTools.push({ tool: "ui_navigate", label: display.ui_navigate ?? "ui_navigate", input: g.navigate, result: nav, inferred: true });
        if (g && (!g.navigate || nav?.ok)) {
          const r = ui.run("ui_guide", g.guide);
          if (r.ok) siteTools.push({ tool: "ui_guide", label: display.ui_guide ?? "ui_guide", input: g.guide, result: r, inferred: true });
        }
      }
      // 16/11 : filet — la demande montre clairement une page, et le modèle n'a rien montré ni préparé : on la montre
      const shown = siteTools.some(played);
      if (!code && !shown && !actions.length && o.site.intentNav) {
        const it = o.site.intentNav(lastUser, replyLang);
        const r = it ? ui.run("ui_navigate", it) : undefined;
        if (it && r?.ok) siteTools.push({ tool: "ui_navigate", label: display.ui_navigate ?? "ui_navigate", input: it, result: r, inferred: true });
      }
      const empty = actions.length ? M.actionReady : guided() && o.site.guideText ? o.site.guideText(replyLang) : M.pageShown;
      // 19/11 : un guide joue sur sa page ; les gestes du modèle faits avant lui sur une AUTRE page ne partent pas au
      // navigateur (il les jouerait pour quitter la page aussitôt) ; le modèle en a reçu l'écho, rien d'autre ne change
      const lastGuide = [...siteTools].reverse().find((t) => t.tool === "ui_guide" && played(t));
      const guidePage = (lastGuide?.result as { page?: unknown } | undefined)?.page;
      const shownTools = typeof guidePage === "string"
        ? siteTools.filter((t) => t === lastGuide || !played(t) || !pageAt.has(t) || pageAt.get(t) === guidePage || t.inferred)
        : siteTools;
      // site (19/11) : les marques de citation du modèle, même longues ou non refermées, ne s'affichent jamais ; le libellé
      // interne de la ligne d'état non plus, tel quel (« the LIVE STATUS line shows… » devient « the live status… »)
      // 19/11 au soir : aussi WHERE YOU RUN, FACTS, LIVE STATUS quelle que soit l'espace (U+202F compris), [[site-v4#…]]
      const unmarked = stripCitationMarks(fs.text);
      let shownText = redactLiterals(cleanText(o.site.stripLabels ? o.site.stripLabels(unmarked) : unmarked, lang), secrets)
        .replace(/\bLIVE[\s_-]+STATUS\b/g, "live status").trim();
      // un guide ajouté par le filet : le modèle n'a pas vu sa page, la réponse la nomme (libellé de l'écran)
      const inferredGuide = siteTools.find((t) => t.tool === "ui_guide" && t.inferred && played(t));
      const gPage = (inferredGuide?.result as { page?: unknown } | undefined)?.page;
      const pageNote = shownText && typeof gPage === "string" && o.site.guidePageNote ? o.site.guidePageNote(replyLang, gPage, shownText) : undefined;
      if (pageNote) shownText = `${shownText}\n\n${pageNote}`;
      // 19/11 au soir : où tourne CE chat se dit par un texte fixe sur le serveur du site (le modèle y ajoutait des libellés
      // internes ou taisait la passerelle du fournisseur du modèle)
      const whereFixed = o.site.whereNote && o.site.whereAnswer ? o.site.whereAnswer(lastUser, replyLang) : undefined;
      if (whereFixed) shownText = whereFixed;
      return {
        text: shownText || empty,
        ...(code ? { code } : {}),
        tools: shownTools, citations: [...citations], actions,
        ...(refused ? { outilsNonExecutes: refused } : {}),
      };
    }
    const fx = extractInlineNav(text);
    return {
      text: redactLiterals(cleanText(fx.text, lang), secrets).trim() || (actions.length ? M.actionReady : M.pageShown),
      ...(code ? { code } : {}),
      tools: [...new Set(toolsUsed)], citations: [...citations], navigate: navigate ?? fx.page ?? intentNav(lastUser), actions,
      ...(refused ? { outilsNonExecutes: refused } : {}),
    };
  };

  // même seul, le dernier message ne tient pas dans le budget en jetons : rien n'est envoyé au modèle
  if (firstTooBig) return reply(M.inputBudget, "input_budget");

  try {
    for (;;) {
      if (Date.now() > deadline - 5_000) return reply(M.deadline);
      const size = inputOf();
      const inputLeft = caps.maxInputCharsPerRequest - inputChars;
      const tokensLeft = caps.maxInputTokensPerRequest - inputTokens;
      // budget d'entrée, borne DURE : après le premier appel, un appel qui ne tient plus n'est pas fait (le premier tient
      // toujours en jetons : l'historique a été raccourci pour lui)
      if (modelCalls > 0 && (size.chars > inputLeft || size.tokens > tokensLeft)) return reply(M.inputBudget, "input_budget");
      // un tour d'outils n'est permis que si l'appel final qui le suivra tient encore dans le budget d'entrée : cet
      // appel, puis un appel grossi de tout ce que ce tour peut ajouter à l'historique (reste du plafond de l'historique et
      // une sortie du modèle, plus le JSON) ; en jetons, cette prévision compte du texte ASCII (un résultat dense qui la
      // dépasse est arrêté par la borne dure ci-dessus)
      const growth = Math.ceil(JSON_OVERHEAD * (Math.max(0, budgetLeft()) + caps.maxTokensPerCall * OUTPUT_CHARS_PER_TOKEN)) + TURN_MARGIN;
      const growthTokens = Math.ceil(TOKENS_PER_ASCII_CHAR * growth);
      // dernier appel permis, plus d'outils permis, plafond de l'historique ou budget d'entrée atteint : texte seulement
      const last = modelCalls >= caps.maxModelCalls - 1 || toolsRun >= caps.perRequest || budgetLeft() < MIN_TOOL_RESULT ||
        2 * size.chars + growth > inputLeft || 2 * size.tokens + growthTokens > tokensLeft;
      const msg = await ask(last ? "none" : "auto", [], size);
      const requested = last ? [] : (msg.tool_calls ?? []).filter((tc) => tc && tc.function);
      // au-delà de perTurn, les appels d'un tour ne sont ni exécutés ni renvoyés au modèle (taille de l'historique bornée)
      const calls = requested.slice(0, caps.perTurn);
      if (calls.length) {
        const ignored = requested.length - calls.length;
        refused += ignored;
        const turn = calls.map((tc) => ({ id: tc.id, type: "function" as const, function: { name: String(tc.function.name ?? ""), arguments: String(tc.function.arguments ?? "") } }));
        messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: turn });
        // la sortie du modèle repart à chaque appel suivant : elle compte dans le plafond de l'historique
        historyChars += (msg.content ?? "").length + turn.reduce((n, tc) => n + tc.function.name.length + tc.function.arguments.length, 0);
        for (const [i, tc] of calls.entries()) {
          let content: string;
          if (toolsRun >= caps.perRequest || budgetLeft() < MIN_TOOL_RESULT) {
            refused++;
            const why = toolsRun >= caps.perRequest
              ? `${caps.perRequest} outils par requête au plus`
              : `l'historique de cette requête (résultats d'outils et sorties du modèle) a atteint ${budgetMark} caractères`;
            content = JSON.stringify({ error: `outil non exécuté (${why}) : réponds avec ce que tu as déjà` });
          } else {
            toolsRun++;
            // gpt-oss glisse parfois des jetons de canal dans le nom (« ui_navigate<|channel|>commentary ») : on les retire
            const name = String(tc.function.name ?? "").replace(/<\|[^|]*\|>.*$/s, "").replace(/&lt;\|.*$/s, "").trim();
            toolsUsed.push(display[name] ?? name);
            // site : chaque outil exécuté entre dans `tools`, dans l'ordre
            const entry: SiteToolEntry | undefined = o.site ? { tool: name, label: display[name] ?? name } : undefined;
            if (entry) siteTools.push(entry);
            const isUi = !!(ui && o.site?.uiTools.has(name));
            const room = Math.min(caps.maxResultChars, budgetLeft());
            try {
              const args = JSON.parse(tc.function.arguments || "{}");
              if (entry) entry.input = args;
              if (isUi) {
                // site : un outil d'interface n'est que validé ici (le navigateur l'exécute) ; le modèle reçoit l'écho
                const r = ui!.run(name, args);
                entry!.result = r;
                if (r.ok) pageAt.set(entry!, ui!.current?.());
                content = forModel(JSON.stringify(r), room);
              } else {
                if (name === "ui_navigate" && args?.page) navigate = String(args.page);
                const { result, citations: cits } = await withDeadline(o.executeTool(name, args, user), deadline - Date.now(), name);
                (cits ?? []).forEach((x) => citations.add(x));
                const full = redactLiterals(JSON.stringify(result, bigintSafe) ?? "null", secrets);
                if (prepare.has(name)) {
                  const prepared = JSON.parse(full);
                  actions.push({ tool: name, input: args, result: prepared });
                  if (entry) entry.result = prepared;
                }
                content = forModel(full, room);
              }
            } catch (e: any) {
              if (entry && isUi && entry.result === undefined) entry.result = { ok: false, error: "arguments: invalid JSON" };
              content = forModel(JSON.stringify({ error: toolErrorText(e, secrets) }), room);
            }
          }
          if (ignored > 0 && i === calls.length - 1) {
            content += `\n[${ignored} autre(s) appel(s) d'outil de ce tour ignoré(s) : ${caps.perTurn} par tour au plus ; rappelle-les au tour suivant s'ils sont indispensables]`;
          }
          historyChars += content.length;
          messages.push({ role: "tool", tool_call_id: tc.id, content });
        }
        continue;
      }
      let text = msg.content ?? "";
      if (!text.trim() && modelCalls < caps.maxModelCalls && Date.now() < deadline - 5_000) {
        // réponse vide (le modèle a « pensé » sans écrire) : une relance, texte seulement, si elle tient dans le budget
        const extra: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: M.answerNow }];
        const size = inputOf(extra);
        if (size.chars <= caps.maxInputCharsPerRequest - inputChars && size.tokens <= caps.maxInputTokensPerRequest - inputTokens) {
          text = (await ask("none", extra, size)).content ?? "";
        }
      }
      return reply(text);
    }
  } catch (e: any) {
    // jamais le message du fournisseur tel quel (il peut recopier la clé du serveur) : un texte générique et un code ;
    // le détail, filtré et sans les secrets du serveur, va au journal
    const f = modelFailure(e, lang);
    log(`[copilote] ${f.code} : ${redactLiterals(scrubSecrets(String(e?.message ?? e)), secrets).replace(/\s+/g, " ").slice(0, 300)}`);
    if (o.site) return { text: `${f.text} (code ${f.code})`, code: f.code, tools: siteTools, citations: [...citations] };
    return { text: `${f.text} (code ${f.code})`, code: f.code, tools: [...new Set(toolsUsed)], citations: [...citations], navigate };
  }
}

/** Une erreur du modèle (ou de la boucle) en message générique + code : jamais le texte du fournisseur. */
export function modelFailure(e: any, lang: Lang = "fr"): { code: string; text: string } {
  const M = T(lang).model;
  const name = String(e?.name ?? "");
  const status = typeof e?.status === "number" && Number.isInteger(e.status) ? e.status : undefined;
  if (["AbortError", "TimeoutError", "APIConnectionTimeoutError", "APIUserAbortError"].includes(name)) {
    return { code: "modele_delai", text: M.timeout };
  }
  if (status === 429) return { code: "modele_429", text: M.busy };
  if (status !== undefined && status >= 500) return { code: `modele_${status}`, text: M.outage };
  if (status === 401 || status === 403 || status === 404) return { code: `modele_${status}`, text: M.unavailable };
  if (status !== undefined) return { code: `modele_${status}`, text: M.refused };
  if (name === "APIConnectionError") return { code: "modele_injoignable", text: M.unreachable };
  return { code: "copilote_erreur", text: M.error };
}

/** Erreur d'un outil, pour le modèle : le message court de viem (sans URL ni corps de requête) s'il existe, sans les
 *  secrets du serveur, borné. */
function toolErrorText(e: any, secrets: readonly string[]): string {
  return redactLiterals(String(e?.shortMessage ?? e?.message ?? e), secrets).slice(0, 600);
}

/** Ce qui part vers le modèle : secrets masqués (journaux de machines compris), puis longueur bornée. */
export function forModel(json: string, max: number): string {
  const s = scrubSecrets(json);
  if (s.length <= max) return s;
  const mark = `… [résultat tronqué à ${max.toLocaleString("fr-FR")} caractères : dis-le si la suite manque à ta réponse]`;
  return s.slice(0, Math.max(0, max - mark.length)) + mark;
}

function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`délai dépassé (${what})`)), Math.max(0, ms - 5_000)); }),
  ]).finally(() => clearTimeout(t));
}

function bigintSafe(_k: string, v: unknown) { return typeof v === "bigint" ? v.toString() : v; }

/** Site (19/11) : une marque de citation du modèle (【…】), quelle que soit sa longueur, ou ouverte sans être refermée avant
 *  la fin de la ligne ; le texte qui l'entoure reste. */
export function stripCitationMarks(s: string): string {
  return s.replace(/[ \t]?【[^】\n]*】/g, "").replace(/[ \t]?【[^】\n]*$/gm, "");
}

/** Texte final : secrets masqués, et marques de citation internes du modèle (【…†…】) retirées (les sources sont dans
 *  `citations`) ; espaces avant la ponctuation selon la typographie de la langue (une espace avant : ; ! ? en français,
 *  aucune en anglais). */
function cleanText(s: string, lang: Lang = "fr"): string {
  const t = scrubSecrets(s).replace(/[ \t]?【[^】\n]{0,80}】/g, "");
  return lang === "en"
    ? t.replace(/[ \t]+([.,;:!?)])/g, "$1")
    : t.replace(/[ \t]+([.,;:!?)])/g, (m, p) => (p === ":" || p === ";" || p === "!" || p === "?" ? " " + p : p));
}

/** Filet déterministe : si le modèle n'a pas navigué, on déduit la page de la demande (mots-clés, en français et en
 *  anglais). La navigation de la démo ne dépend donc pas des caprices d'appel d'outils du modèle. */
export function intentNav(q: string): string | undefined {
  const s = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // du plus précis au plus général
  const rules: Array<[RegExp, string]> = [
    [/publier (une|ma) prime|creer une prime|proteger mon (contrat|protocole)|cote protocole|post (a|my|the) bounty|create (a|my) bounty|protect my (contract|protocol)|protocol side/, "publier-prime"],
    [/publier (un|mon) (produit|service)|mon propre service|faire tourner mon service|cote auteur|publish (a|my) (product|service)|my own service|run my (own )?service|author side/, "publier-produit"],
    [/ruche|hive|alveole|enclaves? (actives?|libres?)|les enclaves|active enclaves?|the enclaves/, "ruche"],
    [/brancher|ma machine|archive-node|appair|operateur|louer|loue|caution|fournisseur|inscrire (mon|une|son) enclave|ma puissance|operator|my machine|pair (my|a) machine|\brent\b|\bbond\b|provider|register (my|an|the) enclave|my compute/, "operateur"],
    [/prime|bounty|bounties|exploit|chass|faille|\bhunt|vulnerab/, "primes"],
    [/\bcles?\b|api key|aek_|arcop|programmatique|en boucle|mandataire|proxy|mes sessions|\bkeys?\b|access key|my sessions|in a loop|programmatic/, "cles"],
    [/inference|modele prive|ia privee|chat prive|lancer un modele|session|private model|private ai|private chat|run a model|playground/, "playground"],
    [/cctp|on-?ramp|rapatri|bridge|pont|autres? chaines?|depuis (base|ethereum|sepolia)|(base|ethereum|sepolia).*(vers|sur|to) arc|portefeuille|profil|mon compte|mon solde|mon wallet|my wallet|my balance|my account|other chains?|from (base|ethereum|sepolia)/, "portefeuille"],
    [/developpeur|\bsdk\b|\bcli\b|\bmcp\b|api rest|adresses? des contrats|documentation|developer|rest api|contract addresses|\bdocs\b/, "developpeurs"],
    [/produits?|place de marche|marketplace|catalogue|products?|catalog|pricing|\bprices?\b/, "produits"],
    [/vue d.ensemble|accueil|preuves?|chiffres du reseau|tableau de bord|overview|\bhome\b|\bproofs?\b|dashboard|network stats/, "vue"],
  ];
  for (const [re, page] of rules) if (re.test(s)) return page;
  return undefined;
}

/** Certains modèles écrivent l'appel d'outil dans le texte ({"page":"use",…}) au lieu de l'appeler :
 *  on le transforme en vraie navigation et on le retire du texte affiché. */
export function extractInlineNav(text: string): { text: string; page?: string } {
  const P = "(vue|ruche|produits|primes|playground|cles|publier-prime|operateur|publier-produit|portefeuille|developpeurs|home|hive|use|rent|onramp|profile)";
  const fenced = text.match(new RegExp("```(?:json)?\\s*(\\{[^`]*?\"page\"\\s*:\\s*\"" + P + "\"[^`]*?\\})\\s*```"));
  if (fenced) return { text: text.replace(fenced[0], "").replace(/\n{3,}/g, "\n\n").trim(), page: fenced[2] };
  const bare = text.match(new RegExp("\\{[^{}]*\"page\"\\s*:\\s*\"" + P + "\"[^{}]*\\}"));
  if (bare) return { text: text.replace(bare[0], "").replace(/\n{3,}/g, "\n\n").trim(), page: bare[1] };
  return { text };
}
