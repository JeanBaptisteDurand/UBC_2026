/** app.ts — the copilot's HTTP app (Hono), with no global state: server.ts mounts it with the real model and the real
 *  tools (so does enclave-app.ts, in an enclave), the tests with a simulated model. Guards:
 *  - CORS limited to the site (ALLOWED_ORIGINS) and a request from another origin refused server-side; JSON only;
 *    body ≤ 64 KiB; conversation validated (user and assistant roles, text only, 20 messages, 4,000 characters each,
 *    16,000 in total); per-IP rate (20 per minute, 300 per day) and a global daily cap; tools capped (4 per round, 10 per
 *    request; extra calls in a round are neither run nor returned to the model) and at most 6 model calls per request;
 *    a global timeout below Caddy's;
 *  - bounded cost: max_tokens on every model call (2,000 by default) and a SUMMED cap on the tool results returned to
 *    the model during a request (40,000 characters by default, refusals included); beyond it, no more tools and a
 *    text-only answer;
 *  - secrets filter on the messages (stricter on the user's), on EACH tool result sent to the model (machine logs
 *    included) and on the answer; the server's secrets (the model key) are removed from everything that goes out;
 *  - a model provider's error is never returned as is: the visitor gets a generic message and a code (modele_401,
 *    modele_429, modele_delai…), the filtered detail goes to the server's log;
 *  - language (i18n.ts): the body's `lang` field ("en" | "fr"), else the language of the user's last message, else
 *    Accept-Language, else English; answers, refusals and action messages in that language (refusals before the body
 *    is read follow Accept-Language); every refusal also carries a stable `code`;
 *  - encrypted conversation (`sealed` option, copilot in an enclave): POST /chat also accepts { sealed, enc, ciphertext },
 *    a conversation encrypted with HPKE to the enclave's X25519 key (checked on Arc by the client); everything after it
 *    is opened (refusals included) goes back SEALED for that client only, with HTTP 200 and the real status inside the
 *    ciphertext. Clear mode stays accepted (compatibility);
 *  - cost: the model's OUTPUTS sent back at the next round (text and tool-call arguments) count in the summed history
 *    cap (COPILOT_MAX_TOOL_CHARS), like tool results; and a summed INPUT budget per request (COPILOT_MAX_INPUT_CHARS,
 *    160,000 characters by default: prompt, tool definitions and history of EACH model call): a tool round is allowed
 *    only if the final call after it still fits the budget, and no call exceeds it (beyond it, a local answer with code
 *    input_budget);
 *  - per-IP rate of the copilot in an enclave (`proxyToken` option): POST /chat requires the site proxy's
 *    x-archive-proxy-token header (constant-time comparison), otherwise 403 proxy_required, and X-Forwarded-For is
 *    trusted only when it is right; /health (and, in the enclave, /attest and /pubkeys) stay public. Without the option
 *    (on the server), nothing changes;
 *  - the input budget is ALSO counted in ESTIMATED TOKENS (COPILOT_MAX_INPUT_TOKENS, 50,000 by default; estimateTokens:
 *    0.3 token per ASCII character, 3 per other character, over the prompt, tool definitions and history of EACH call),
 *    because 98,000 characters of Yi syllables make about 139,000 tokens. A HARD limit, first call included: the oldest
 *    history is dropped so that it fits (otherwise a local answer, code input_budget). The character budget
 *    (COPILOT_MAX_INPUT_CHARS) stays as well;
 *  - site surface only (the console does not change): ui_guide validated in the loop like the other interface tools
 *    (notes in the answer's language); the guide fallback (a clear request to do something with no guide played: its
 *    page if it is not on screen, then its recipe); the site's "where you run" line (whereNote) when no enclave note
 *    (systemNote) replaces it. */
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
  /** Maximum output tokens for this call (the provider's max_tokens parameter). */
  max_tokens: number;
  signal: AbortSignal;
}
/** One call to the model (OpenAI or compatible): returns the message of the first choice. */
export type Llm = (req: LlmRequest) => Promise<LlmReply>;

export interface ToolCaps {
  /** Maximum tools run per model turn (the rest receive a refusal). */
  perTurn: number;
  /** Maximum tools run per HTTP request. */
  perRequest: number;
  /** Maximum model calls per HTTP request (the retry of an empty answer and the final answer included). */
  maxModelCalls: number;
  /** Maximum characters of a tool result sent back to the model (the full result stays in `actions`). */
  maxResultChars: number;
  /** Overall deadline of a request, in ms (below Caddy's 180 s read_timeout). */
  deadlineMs: number;
  /** Maximum output tokens per model call (max_tokens). */
  maxTokensPerCall: number;
  /** Maximum characters of EVERYTHING added to the history during a request, which goes back to the model on every
   *  call: tool results (refusals included) AND model outputs (text and tool-call arguments). */
  maxToolCharsPerRequest: number;
  /** Maximum input characters sent to the model during a request, all calls together (messages and tool definitions,
   *  counted as JSON). This is the HARD bound on a request's input cost; only the first call can exceed it, when the
   *  bound is set below that call's size. */
  maxInputCharsPerRequest: number;
  /** Maximum ESTIMATED input TOKENS (estimateTokens) sent to the model during a request, all calls together (messages
   *  and tool definitions, as JSON). This is a HARD bound, first call included: the oldest history is dropped to make it
   *  fit. A "dense" character (Yi, rare CJK…) costs about 3 tokens, so a budget in characters alone would not bound the
   *  cost. */
  maxInputTokensPerRequest: number;
}
export const DEFAULT_CAPS: ToolCaps = {
  perTurn: 4, perRequest: 10, maxModelCalls: 6, maxResultChars: 16_000, deadlineMs: 150_000,
  maxTokensPerCall: 2_000, maxToolCharsPerRequest: 40_000, maxInputCharsPerRequest: 160_000, maxInputTokensPerRequest: 50_000,
};

/** A CAUTIOUS token estimate, per UTF-16 unit: 0.3 token per ASCII character, 3 per any other character.
 *  Measured on a byte-level BPE tokenizer: English 0.25, French 0.27, common CJK 0.9, Yi and rare CJK 2.97 tokens per
 *  JS character (a character outside the Basic Multilingual Plane counts twice 3). It overestimates accented text: it is
 *  a cost bound, not an invoice. */
export const TOKENS_PER_ASCII_CHAR = 0.3;
export const TOKENS_PER_OTHER_CHAR = 3;
export function estimateTokens(s: string): number {
  let ascii = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 0x80) ascii++;
  return Math.ceil(ascii * TOKENS_PER_ASCII_CHAR + (s.length - ascii) * TOKENS_PER_OTHER_CHAR);
}
/** Below this remaining budget, no new tool runs (its result would shrink to the truncation mark). */
const MIN_TOOL_RESULT = 1_000;
/** To predict the size of the next call: maximum characters per output token (estimate), the JSON overhead (escaped
 *  quotes in tool results) and a margin for the refusals and notes added to a turn. */
const OUTPUT_CHARS_PER_TOKEN = 4;
const JSON_OVERHEAD = 1.25;
const TURN_MARGIN = 1_000;

/** The result of a site interface tool: the normalized input (the browser runs it), or the refusal and its reason. */
export type UiResult = ({ ok: true } & Record<string, unknown>) | { ok: false; error: string };
/** The interface tools of ONE request (current page, actions already accepted); `current` is the page shown after the
 *  accepted actions (the guide fallback needs it). */
export interface UiSession { run(name: string, args: unknown): UiResult; current?(): string | undefined }
/** One entry of `tools` in the site's response, in execution order: the tool, its label and its input; `result` for the
 *  interface tools (the validated echo) and the prepare tools (the full data, as in `actions`). */
export interface SiteToolEntry { tool: string; label: string; input?: unknown; result?: unknown; inline?: true; inferred?: true }
/** The "site" surface (COPILOT_SURFACE=site, implemented by site.ts). When absent: the console, unchanged. */
export interface SiteSurface {
  /** The interface tools: validated in the loop (never by executeTool), run by the browser. */
  uiTools: ReadonlySet<string>;
  /** The `page` context of the request body: the line added to the prompt and the starting page; undefined when it is
   *  missing or invalid. */
  pageContext(body: unknown): { line: string; page: string } | undefined;
  /** The interface tools of one request, from the page shown; `lang` is the language of the answer. */
  uiSession(page: string | undefined, lang?: Lang): UiSession;
  /** The surface's language instruction (at the end of the prompt, in place of the console's): `lang` is the site's
   *  language (page and button labels); `replyLang` is the answer's language (the question's language). */
  languageDirective(lang: Lang, replyLang?: Lang): string;
  /** An interface call written in the text instead of being called: removed from the text and turned into a call
   *  (ui_navigate, or the tool named by `tool`). */
  extractInline(text: string): { text: string; input?: Record<string, unknown>; tool?: string };
  /** The page the request clearly points to (keywords), when the model showed and prepared nothing. */
  intentNav?(q: string, lang: Lang): Record<string, unknown> | undefined;
  /** The guide the request clearly calls for (install, launch an enclave…), when the model played none: first its page
   *  when it is not shown (`navigate`), then the guide. `prepared`: a card to sign is already prepared. */
  intentGuide?(q: string, o: { lang: Lang; current?: string; start?: string; prepared?: boolean }): { navigate?: Record<string, unknown>; guide: Record<string, unknown> } | undefined;
  /** Where this copilot runs, said in one prompt line when no `systemNote` says it (enclave). */
  whereNote?: string;
  /** The answer when the model wrote nothing and a guide plays. */
  guideText?(lang: Lang): string;
  /** The sentence that names the page a fallback guide plays on (the model did not see it), when the answer does not
   *  name that page already; undefined otherwise. */
  guidePageNote?(lang: Lang, page: string, text: string): string | undefined;
  /** What never shows in an answer (internal prompt labels, docs_search source marks, page ids in brackets): removed
   *  from the final text. */
  stripLabels?(text: string): string;
  /** The fixed, true answer to "does this chat run in an enclave?" on the site's server (only with whereNote: product
   *  4's enclave removes it and keeps its own answer). */
  whereAnswer?(text: string, lang: Lang): string | undefined;
  /** A fixed, true answer WITH its interface gestures (the MCP, the tokenomics, AskHive's place), on the site's server
   *  only (with whereNote): the text replaces the model's, and the gestures replace those of the model and fallbacks. */
  fixedAnswer?(text: string, lang: Lang): { text: string; ui: Array<{ tool: string; input: Record<string, unknown> }> } | undefined;
  /** The network state read AT ANSWER TIME (site-live.ts: active enclaves, levels, open bounties), in one prompt line
   *  after the page line. It never throws (fallback line) and is bounded in time. */
  liveNote?(): Promise<string | undefined>;
}

/** An opened sealed request: its text, and what is needed to seal THE answer for this client only. */
export interface SealedRequest {
  plaintext: Uint8Array;
  seal(response: Uint8Array): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }>;
}
/** Sealed conversation (copilot in an enclave): the enclave opens the request with its X25519 key (enclave kit). */
export interface SealedChannel {
  /** Protocol tag: the expected value of the `sealed` field (ARC-COPILOT-CHAT-v1). */
  tag: string;
  /** Opens a request (throws when it is not for this enclave or was modified). */
  open(enc: Uint8Array, ciphertext: Uint8Array): Promise<SealedRequest>;
}

export interface CopilotAppOptions {
  /** null: no model key configured. */
  llm: Llm | null;
  /** System prompt (the connected wallet's line, the truncation notes and the language instruction are added to it). */
  system: string;
  tools: OpenAI.Chat.ChatCompletionTool[];
  executeTool: (name: string, args: any, user?: Address) => Promise<{ result: unknown; citations?: string[] }>;
  /** The tools' "dotted" labels (display). */
  display?: Record<string, string>;
  /** Tools that PREPARE an action to sign: their full result goes to the browser in `actions`. */
  prepareTools?: Iterable<string>;
  allowedOrigins: string[];
  rate: RateOptions;
  bounds?: ChatBounds;
  caps?: Partial<ToolCaps>;
  /** Fields added to GET /health. */
  health?: Record<string, unknown>;
  /** The server's secrets (the model key…): removed from everything sent to the visitor, the model or the log. */
  secrets?: string[];
  /** The server log (default: console.error); lines arrive filtered. */
  log?: (line: string) => void;
  /** Sealed conversation (copilot in an enclave); when absent, a sealed envelope is refused (400 sealed_unavailable). */
  sealed?: SealedChannel;
  /** A line added to the system prompt for each request (e.g. where the copilot runs, sealed conversation or not). */
  systemNote?: (x: { sealed: boolean; lang: Lang }) => string;
  /** Copilot in an enclave: the site proxy's token (COPILOT_PROXY_TOKEN). POST /chat then requires the
   *  x-archive-proxy-token header (otherwise 403 proxy_required), and X-Forwarded-For is trusted only when the token is
   *  right. When absent (VPS): no token, and X-Forwarded-For is trusted behind a local proxy. */
  proxyToken?: string;
  /** The "site" surface (the front's panel, /copilot-site/): interface tools validated here, the `page` context said in
   *  one prompt line, the site's language instruction, and a detailed `tools` list in the response (SiteToolEntry),
   *  without `navigate`. When absent: the console, exactly as before. */
  site?: SiteSurface;
}

const DEFAULT_PREPARE = ["session_prepare_open", "operator_prepare_bond", "operator_prepare_register", "bounty_prepare_create"];

type Status = 200 | 400 | 403 | 413 | 415 | 429;
interface Answer { status: 200 | 400 | 413 | 429; body: Record<string, unknown>; retryAfterSec?: number }

/** Maximum body of a sealed envelope: the conversation (64 KiB) in hexadecimal, plus the fields. */
export const sealedBodyCap = (b: ChatBounds) => 2 * b.maxBodyBytes + 4_096;

const isHexBytes = (x: unknown, bytes?: number): x is Hex =>
  typeof x === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(x) && (bytes === undefined || x.length === 2 + 2 * bytes);

export function createCopilotApp(o: CopilotAppOptions): Hono {
  const bounds = o.bounds ?? DEFAULT_BOUNDS;
  const caps: ToolCaps = { ...DEFAULT_CAPS, ...(o.caps ?? {}) };
  const limiter = new RateLimiter(o.rate);
  const proxyOk = o.proxyToken ? proxyTokenChecker(o.proxyToken) : null;
  const app = new Hono();

  // CORS: only the site (ALLOWED_ORIGINS) receives Access-Control-Allow-Origin; never "*" by default
  app.use("*", cors({
    origin: (origin) => (origin && originAllowed(origin, o.allowedOrigins) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type"],
    maxAge: 600,
  }));
  app.get("/health", (c) => c.json({
    ok: true, ...(o.health ?? {}), languages: LANGS, sealed: o.sealed?.tag ?? null, ...(proxyOk ? { proxyTokenRequired: true } : {}),
  }));

  // 5) and 6): the validated conversation, then the model; the same sequence in clear and sealed
  const answer = async (json: unknown, lang: Lang, sealed: boolean): Promise<Answer> => {
    // 5) conversation: user/assistant roles, text only, bounded history, secrets masked
    const chat = parseChatRequest(json, bounds, lang);
    if (!chat.ok) return { status: 400, body: refusal(chat.error, lang, "bad_conversation") };
    if (!o.llm) return { status: 200, body: { text: T(lang).noKey, tools: [], citations: [] } };
    // 6) daily global cap (model spending)
    const g = limiter.hitGlobal();
    if (!g.ok) return { status: 429, body: { ...refusal(T(lang).globalCap, lang, "global_cap"), retryAfterSec: g.retryAfterSec }, retryAfterSec: g.retryAfterSec };
    // site: the page shown (the `page` field), validated; nothing for the console
    const page = o.site ? o.site.pageContext(json) : undefined;
    return { status: 200, body: await runChat(o, caps, chat.messages, chat.user, { dropped: chat.dropped, truncated: chat.truncated }, lang, sealed, page) };
  };

  // sealed conversation: opened by the enclave; everything after it goes back sealed for this client only
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
    // before the body is read, only Accept-Language gives the language (default: English)
    const early = langFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LANG;
    // 0) copilot in an enclave: only the site's proxy (shared token, encrypted variable) can spend the model, and only
    //    its X-Forwarded-For is trusted: calling the Phala URL directly no longer bypasses the per-IP rate limit
    const proxied = proxyOk ? proxyOk(c.req.header(PROXY_TOKEN_HEADER)) : undefined;
    if (proxyOk && !proxied) return refuse(c, 403, T(early).proxyRequired, early, "proxy_required");
    // 1) origin: a page from another site cannot spend the model (even without reading the answer)
    const origin = c.req.header("origin");
    if (origin && !originAllowed(origin, o.allowedOrigins)) {
      return refuse(c, 403, T(early).originRefused(origin.slice(0, 100)), early, "origin_refused");
    }
    // 2) per-IP rate limit (X-Forwarded-For set by Caddy): every request counts, even one refused later
    const v = limiter.hit(bucketOf(clientIp(c, proxied)));
    if (!v.ok) {
      c.header("Retry-After", String(v.retryAfterSec));
      return v.scope === "minute"
        ? refuse(c, 429, T(early).rateMinute(v.retryAfterSec), early, "rate_minute")
        : refuse(c, 429, T(early).rateDay(Math.ceil(v.retryAfterSec / 3600)), early, "rate_day");
    }
    // 3) JSON only: a request from another origin then always goes through the CORS preflight
    if (!/^application\/json\s*(;|$)/i.test(c.req.header("content-type") ?? "")) {
      return refuse(c, 415, T(early).jsonOnly, early, "json_only");
    }
    // 4) bounded body (the announced Content-Length, then counted while reading); a sealed envelope, in hexadecimal,
    //    gets twice as much: the conversation it carries stays bounded to 64 KiB
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

/** The body of a refusal: `text` is what the site's bubble can show as is; `code` is stable (for machines). */
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
  // site: the page shown, as one line of validated values (site.ts); never for the console
  const pageLine = o.site && page ? `\n${page.line}` : "";
  // site: the network state read now (LIVE STATUS), never a state written in advance; nothing for the console
  const live = o.site?.liveNote ? await o.site.liveNote().catch(() => undefined) : undefined;
  const liveLine = live ? `\n${live}` : "";
  const cutLineOf = (dropped: number) => dropped || cut.truncated
    ? `\nNote : la conversation reçue a été raccourcie (${dropped} message(s) ancien(s) retiré(s), ${cut.truncated} message(s) tronqué(s)) ; ne prétends pas avoir lu ce qui manque.`
    : "";
  // where the copilot runs: the enclave's note; otherwise (site) the site server's note; none for the console
  const note = o.systemNote ? `\n${o.systemNote({ sealed, lang })}` : o.site?.whereNote ? `\n${o.site.whereNote}` : "";
  // site: the answer follows the language of the last message when it is recognized (a French question on the English
  // site gets a French answer); page labels stay those of the screen. The model follows a soft instruction ("answer in
  // their language") poorly, so the language is decided here and the instruction stays firm.
  // A message under 3 words ("hello", "ok") does not reveal its language: the site's language applies.
  const lastUserText = history.filter((m) => m.role === "user").slice(-1)[0]?.content ?? "";
  const longEnough = lastUserText.trim().split(/\s+/).filter(Boolean).length >= 3;
  const replyLang: Lang = o.site && longEnough ? (detectLang(lastUserText) ?? lang) : lang;
  const directive = o.site ? o.site.languageDirective(lang, replyLang) : languageDirective(lang);
  // the language instruction comes LAST: it overrides the prompt (written in French)
  const systemOf = (dropped: number): OpenAI.Chat.ChatCompletionMessageParam =>
    ({ role: "system", content: `${o.system}${walletLine}${pageLine}${liveLine}${cutLineOf(dropped)}${note}\n${directive}` });
  // site: the interface tools of this request (current page, at most 3 actions, guide notes in the answer's language)
  // and the detailed list of tools
  const ui = o.site ? o.site.uiSession(page?.page, replyLang) : null;
  const siteTools: SiteToolEntry[] = [];
  /** The page each accepted interface action applies to (after it): a guide that plays on another page makes the
   *  gestures made elsewhere before it useless (the browser would open a page only to leave it at once). */
  const pageAt = new Map<SiteToolEntry, string | undefined>();
  // budget in estimated TOKENS, first call included: the oldest messages drop until it fits
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
  let navigate: string | undefined; // page to open in the browser (the bot drives the front)
  // PREPARED actions (never run here): the browser shows them with a "Sign with my wallet" button
  const actions: Array<{ tool: string; input: unknown; result: unknown }> = [];
  const lastUser = history.filter((m) => m.role === "user").slice(-1)[0]?.content ?? "";
  const deadline = Date.now() + caps.deadlineMs;
  let modelCalls = 0, toolsRun = 0, refused = 0;
  // characters added to the history during the request (every model call sends them all again): tool results AND
  // model outputs (text and tool-call arguments)
  let historyChars = 0;
  const budgetLeft = () => caps.maxToolCharsPerRequest - historyChars;
  const budgetMark = caps.maxToolCharsPerRequest.toLocaleString("fr-FR");
  // input already sent to the model (messages and tool definitions of each call, as JSON): characters and estimated tokens
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
      // site: a call written in the text becomes a real call (ui_navigate, or ui_guide for a recipe; validated, within
      // the 3-action limit)
      const fs = o.site.extractInline(text);
      if (fs.input) {
        const tool = fs.tool ?? "ui_navigate";
        const r = ui.run(tool, fs.input);
        if (r.ok) { const e: SiteToolEntry = { tool, label: display[tool] ?? tool, input: fs.input, result: r, inline: true }; siteTools.push(e); pageAt.set(e, ui.current?.()); }
      }
      const played = (t: SiteToolEntry) => o.site!.uiTools.has(t.tool) && (t.result as { ok?: boolean } | undefined)?.ok === true;
      const guided = () => siteTools.some((t) => t.tool === "ui_guide" && played(t));
      // guide fallback: a clear request to do something (install the tool, launch an enclave…) with no guide played:
      // its page (when it is not shown), then its recipe; nothing when opening the page is refused
      if (!code && !guided() && o.site.intentGuide) {
        const g = o.site.intentGuide(lastUser, { lang: replyLang, current: ui.current?.(), start: page?.page, prepared: actions.length > 0 });
        const nav = g?.navigate ? ui.run("ui_navigate", g.navigate) : undefined;
        if (g?.navigate && nav?.ok) siteTools.push({ tool: "ui_navigate", label: display.ui_navigate ?? "ui_navigate", input: g.navigate, result: nav, inferred: true });
        if (g && (!g.navigate || nav?.ok)) {
          const r = ui.run("ui_guide", g.guide);
          if (r.ok) siteTools.push({ tool: "ui_guide", label: display.ui_guide ?? "ui_guide", input: g.guide, result: r, inferred: true });
        }
      }
      // fallback: the request clearly points to a page, and the model showed and prepared nothing: show that page
      const shown = siteTools.some(played);
      if (!code && !shown && !actions.length && o.site.intentNav) {
        const it = o.site.intentNav(lastUser, replyLang);
        const r = it ? ui.run("ui_navigate", it) : undefined;
        if (it && r?.ok) siteTools.push({ tool: "ui_navigate", label: display.ui_navigate ?? "ui_navigate", input: it, result: r, inferred: true });
      }
      const empty = actions.length ? M.actionReady : guided() && o.site.guideText ? o.site.guideText(replyLang) : M.pageShown;
      // a guide plays on its page; the model's gestures made before it on ANOTHER page do not go to the browser (it would
      // play them only to leave the page at once); the model received their echo, nothing else changes
      const lastGuide = [...siteTools].reverse().find((t) => t.tool === "ui_guide" && played(t));
      const guidePage = (lastGuide?.result as { page?: unknown } | undefined)?.page;
      const shownTools = typeof guidePage === "string"
        ? siteTools.filter((t) => t === lastGuide || !played(t) || !pageAt.has(t) || pageAt.get(t) === guidePage || t.inferred)
        : siteTools;
      // site: the model's citation marks, even long or unclosed, never show; neither does the status line's internal
      // label as is ("the LIVE STATUS line shows…" becomes "the live status…"); the same holds for WHERE YOU RUN, FACTS
      // and LIVE STATUS whatever the space (U+202F included), and for [[site-v4#…]]
      const unmarked = stripCitationMarks(fs.text);
      let shownText = redactLiterals(cleanText(o.site.stripLabels ? o.site.stripLabels(unmarked) : unmarked, lang), secrets)
        .replace(/\bLIVE[\s_-]+STATUS\b/g, "live status").trim();
      // a fallback guide: the model did not see its page, so the answer names it (the screen's label)
      const inferredGuide = siteTools.find((t) => t.tool === "ui_guide" && t.inferred && played(t));
      const gPage = (inferredGuide?.result as { page?: unknown } | undefined)?.page;
      const pageNote = shownText && typeof gPage === "string" && o.site.guidePageNote ? o.site.guidePageNote(replyLang, gPage, shownText) : undefined;
      if (pageNote) shownText = `${shownText}\n\n${pageNote}`;
      // where THIS chat runs is said by a fixed text on the site's server (the model added internal labels to it, or
      // left out the model provider's gateway)
      const whereFixed = o.site.whereNote && o.site.whereAnswer ? o.site.whereAnswer(lastUser, replyLang) : undefined;
      if (whereFixed) shownText = whereFixed;
      // the MCP, the tokenomics (split, escrow, bonds, treasury) and AskHive's place: a fixed, true text and ITS gestures,
      // validated in a fresh interface session (those of the model and the fallbacks are not sent)
      const fixed = !whereFixed && o.site.whereNote && o.site.fixedAnswer ? o.site.fixedAnswer(lastUser, replyLang) : undefined;
      let toolsOut = shownTools;
      if (fixed) {
        shownText = fixed.text;
        const fresh = o.site.uiSession(page?.page, replyLang);
        const forced: SiteToolEntry[] = [];
        for (const g of fixed.ui) {
          const r = fresh.run(g.tool, g.input);
          if (r.ok) forced.push({ tool: g.tool, label: display[g.tool] ?? g.tool, input: g.input, result: r, inferred: true });
        }
        toolsOut = [...shownTools.filter((t) => !o.site!.uiTools.has(t.tool)), ...forced];
      }
      return {
        text: shownText || empty,
        ...(code ? { code } : {}),
        tools: toolsOut, citations: [...citations], actions,
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

  // even alone, the last message does not fit the token budget: nothing is sent to the model
  if (firstTooBig) return reply(M.inputBudget, "input_budget");

  try {
    for (;;) {
      if (Date.now() > deadline - 5_000) return reply(M.deadline);
      const size = inputOf();
      const inputLeft = caps.maxInputCharsPerRequest - inputChars;
      const tokensLeft = caps.maxInputTokensPerRequest - inputTokens;
      // input budget, HARD bound: after the first call, a call that no longer fits is not made (the first call always
      // fits in tokens: the history was shortened for it)
      if (modelCalls > 0 && (size.chars > inputLeft || size.tokens > tokensLeft)) return reply(M.inputBudget, "input_budget");
      // a tool turn is allowed only if the final call after it still fits the input budget: this call, then a call grown
      // by everything this turn can add to the history (the rest of the history cap and one model output, plus the JSON);
      // in tokens, this forecast counts ASCII text (a dense result that exceeds it is stopped by the hard bound above)
      const growth = Math.ceil(JSON_OVERHEAD * (Math.max(0, budgetLeft()) + caps.maxTokensPerCall * OUTPUT_CHARS_PER_TOKEN)) + TURN_MARGIN;
      const growthTokens = Math.ceil(TOKENS_PER_ASCII_CHAR * growth);
      // last call allowed, no more tools allowed, history cap or input budget reached: text only
      const last = modelCalls >= caps.maxModelCalls - 1 || toolsRun >= caps.perRequest || budgetLeft() < MIN_TOOL_RESULT ||
        2 * size.chars + growth > inputLeft || 2 * size.tokens + growthTokens > tokensLeft;
      const msg = await ask(last ? "none" : "auto", [], size);
      const requested = last ? [] : (msg.tool_calls ?? []).filter((tc) => tc && tc.function);
      // beyond perTurn, a turn's calls are neither run nor sent back to the model (bounded history size)
      const calls = requested.slice(0, caps.perTurn);
      if (calls.length) {
        const ignored = requested.length - calls.length;
        refused += ignored;
        const turn = calls.map((tc) => ({ id: tc.id, type: "function" as const, function: { name: String(tc.function.name ?? ""), arguments: String(tc.function.arguments ?? "") } }));
        messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: turn });
        // the model's output goes back on every later call: it counts toward the history cap
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
            // gpt-oss sometimes slips channel tokens into the name ("ui_navigate<|channel|>commentary"): they are removed
            const name = String(tc.function.name ?? "").replace(/<\|[^|]*\|>.*$/s, "").replace(/&lt;\|.*$/s, "").trim();
            toolsUsed.push(display[name] ?? name);
            // site: every tool run enters `tools`, in order
            const entry: SiteToolEntry | undefined = o.site ? { tool: name, label: display[name] ?? name } : undefined;
            if (entry) siteTools.push(entry);
            const isUi = !!(ui && o.site?.uiTools.has(name));
            const room = Math.min(caps.maxResultChars, budgetLeft());
            try {
              const args = JSON.parse(tc.function.arguments || "{}");
              if (entry) entry.input = args;
              if (isUi) {
                // site: an interface tool is only validated here (the browser runs it); the model receives the echo
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
        // empty answer (the model "thought" without writing): one retry, text only, if it fits the budget
        const extra: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: M.answerNow }];
        const size = inputOf(extra);
        if (size.chars <= caps.maxInputCharsPerRequest - inputChars && size.tokens <= caps.maxInputTokensPerRequest - inputTokens) {
          text = (await ask("none", extra, size)).content ?? "";
        }
      }
      return reply(text);
    }
  } catch (e: any) {
    // never the provider's message as is (it can copy the server's key): a generic text and a code; the detail,
    // filtered and without the server's secrets, goes to the log
    const f = modelFailure(e, lang);
    log(`[copilote] ${f.code} : ${redactLiterals(scrubSecrets(String(e?.message ?? e)), secrets).replace(/\s+/g, " ").slice(0, 300)}`);
    if (o.site) return { text: `${f.text} (code ${f.code})`, code: f.code, tools: siteTools, citations: [...citations] };
    return { text: `${f.text} (code ${f.code})`, code: f.code, tools: [...new Set(toolsUsed)], citations: [...citations], navigate };
  }
}

/** A model (or loop) error as a generic message plus a code: never the provider's text. */
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

/** A tool error, for the model: viem's short message (without URL or request body) when there is one, without the
 *  server's secrets, bounded. */
function toolErrorText(e: any, secrets: readonly string[]): string {
  return redactLiterals(String(e?.shortMessage ?? e?.message ?? e), secrets).slice(0, 600);
}

/** What goes to the model: secrets masked (machine logs included), then a bounded length. */
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
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`timed out (${what})`)), Math.max(0, ms - 5_000)); }),
  ]).finally(() => clearTimeout(t));
}

function bigintSafe(_k: string, v: unknown) { return typeof v === "bigint" ? v.toString() : v; }

/** Site: a model citation mark (【…】) of any length, or one opened and not closed before the end of the line; the text
 *  around it stays. */
export function stripCitationMarks(s: string): string {
  return s.replace(/[ \t]?【[^】\n]*】/g, "").replace(/[ \t]?【[^】\n]*$/gm, "");
}

/** The final text: secrets masked, and the model's internal citation marks (【…†…】) removed (the sources are in
 *  `citations`); spaces before punctuation follow the language's typography (a space before : ; ! ? in French, none in
 *  English). */
function cleanText(s: string, lang: Lang = "fr"): string {
  const t = scrubSecrets(s).replace(/[ \t]?【[^】\n]{0,80}】/g, "");
  return lang === "en"
    ? t.replace(/[ \t]+([.,;:!?)])/g, "$1")
    : t.replace(/[ \t]+([.,;:!?)])/g, (m, p) => (p === ":" || p === ";" || p === "!" || p === "?" ? " " + p : p));
}

/** A deterministic fallback: when the model did not navigate, the page is inferred from the request (keywords, in
 *  French and English). The demo's navigation therefore does not depend on the model's tool-calling whims. */
export function intentNav(q: string): string | undefined {
  const s = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // from the most specific to the most general
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

/** Some models write the tool call in the text ({"page":"use",…}) instead of calling it: it is turned into a real
 *  navigation and removed from the text shown. */
export function extractInlineNav(text: string): { text: string; page?: string } {
  const P = "(vue|ruche|produits|primes|playground|cles|publier-prime|operateur|publier-produit|portefeuille|developpeurs|home|hive|use|rent|onramp|profile)";
  const fenced = text.match(new RegExp("```(?:json)?\\s*(\\{[^`]*?\"page\"\\s*:\\s*\"" + P + "\"[^`]*?\\})\\s*```"));
  if (fenced) return { text: text.replace(fenced[0], "").replace(/\n{3,}/g, "\n\n").trim(), page: fenced[2] };
  const bare = text.match(new RegExp("\\{[^{}]*\"page\"\\s*:\\s*\"" + P + "\"[^{}]*\\}"));
  if (bare) return { text: text.replace(bare[0], "").replace(/\n{3,}/g, "\n\n").trim(), page: bare[1] };
  return { text };
}
