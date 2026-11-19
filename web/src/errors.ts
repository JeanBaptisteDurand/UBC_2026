/** errors.ts — refusals explained in the site's language (English or French), for the whole site (v2.1 stack).
 *  - contract refusals: decoded by the SDK (arcErrorOf: every contract error of the stack, by name, even from a called
 *    contract). French: the SDK's own sentence (explainArcError, unchanged). English: the name, its arguments and the
 *    English table (i18n/contract-errors.en.ts), or a generic sentence with the name for an error it doesn't know;
 *  - ArcHive API refusals: by their stable code, in both languages (i18n/api-errors.ts); an API without codes (or a
 *    code this version doesn't know): its French text, translated in English by the rules below;
 *  - what isn't a contract refusal: the wallet (signature rejected, wrong network, gas), the enclaves (key that
 *    doesn't match the chain, session to top up or over, answer refused), the network, an RPC that limits the rate or
 *    fails (viem's "HTTP request failed.", now put into words in both languages);
 *  - pay per call (x402) and the attested copilot: from the error's fields (reason, status, code, amounts), never from
 *    a server's text (not authenticated);
 *  - French messages from the SDK or an enclave: shown as they came in French, translated in English by the
 *    rules of i18n/sdk-messages.en.ts (the message as it came if no rule knows it);
 *  - the site's own refusals (MsgError, msg.ts): their message, put into words again in the current language;
 *  - any other error: its message as it came, except in French when it isn't French (the browser, a library):
 *    « erreur inattendue (TypeError) », never an English message as it came.
 *  An error kept in a status line is explained when it is DISPLAYED (msg.ts, fail): the sentence follows the language. */
import { arcErrorOf, explainArcError } from "@arcvault/sdk";
import { fmtUnix, getLang, t } from "./i18n";
import { apiErrorText } from "./i18n/api-errors";
import { ARC_ERRORS_EN } from "./i18n/contract-errors.en";
import { englishOf, toEnglish } from "./i18n/sdk-messages.en";
import { short, usdc } from "./fmt";
import { MsgError, show } from "./msg";

/** The error and its causes (viem nests errors), without `instanceof`: several copies of viem can coexist. */
function causes(e: unknown): any[] {
  const out: any[] = [];
  for (let x: any = e; x && out.length < 12; x = x.cause) out.push(x);
  return out;
}

/** A fetch that never got an answer (offline, DNS, CORS, server down): the browser's wording varies. */
const NETWORK = /^(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|fetch failed|Network request failed)$/i;

/** EnclaveKeyMismatchError: an enclave that doesn't answer, isn't active, serves another product or runs for another
 *  operator isn't a "wrong key", but nothing is sent either way. */
function enclaveKeyError(first: any, fr: boolean): string {
  const detail = fr ? String(first.detail ?? "") : toEnglish(String(first.detail ?? ""));
  switch (first.reason) {
    case "pubkeys_unreachable": return t("err.enclave.unreachable", { detail: unreachableDetail(first) });
    case "pubkeys_unreadable": return t("err.enclave.unreadable", { detail });
    case "inactive": return t("err.enclave.inactive", { detail });
    case "wrong_product": return t("err.enclave.wrongProduct", { detail });
    case "wrong_operator": {
      const { op, expected } = wrongOperatorOf(first);
      return t("err.enclave.wrongOperator", { op: op && short(op, 4), expected: expected && short(expected, 4) });
    }
  }
  // « la clé de l'enclave ne correspond pas à celle inscrite sur Arc : envoi refusé (…) »
  return fr ? String(first.message) : t("err.enclave.mismatch", { detail });
}

/** The two operators of a "wrong_operator" refusal (the enclave's key is the registered one, but it is active for
 *  another operator than the one expected), read from the SDK's detail (« l'enclave X est active pour l'opérateur A, la
 *  session attend B »): full addresses, "" when absent. */
export function wrongOperatorOf(first: any): { op: string; expected: string } {
  const d = String(first?.detail ?? "");
  return {
    op: /pour l'opérateur (0x[0-9a-fA-F]{40})/.exec(d)?.[1] ?? "",
    expected: /attend (0x[0-9a-fA-F]{40})/.exec(d)?.[1] ?? "",
  };
}

/** The detail of an enclave that didn't answer: the /pubkeys address and an HTTP status if there was one, never the
 *  browser's own wording (« Failed to fetch », « signal timed out »), which isn't in the site's language. */
function unreachableDetail(first: any): string {
  const url = `${String(first.facts?.enclaveUrl ?? "").replace(/\/+$/, "")}/pubkeys`;
  const status = /: HTTP (\d{3})$/.exec(String(first.detail ?? ""))?.[1];
  return status ? `${url}, HTTP ${status}` : url;
}

/** An ArcHive API refusal (ApiError, api.ts): by its code; a sentence the site wrote itself (`localized`: its message,
 *  in the current language); else the API's French text, translated in English by the rules (with the status if no
 *  rule knows it). */
function explainApiError(e: any, fr: boolean): string {
  const byCode = typeof e.code === "string" ? apiErrorText(e.code, e.params ?? {}) : null;
  if (byCode) return byCode;
  if (e.localized && typeof e.localized === "object") return show(e.localized);
  const msg = String(e.message ?? "");
  if (e.localized || fr) return msg;
  return englishOf(msg) ?? t("err.api", { status: String(e.status ?? "?"), msg });
}

/** Readable message for a transaction, simulation, wallet, enclave or API error, in the current language. */
export function explainError(e: unknown): string {
  if (e instanceof MsgError) return show(e.msg); // the site's own refusal: its message, in the current language
  const chain = causes(e);
  if (chain.some((x) => x?.name === "UserRejectedRequestError" || x?.code === 4001)) return t("err.rejected");
  if (chain.some((x) => x?.name === "ChainMismatchError" || x?.name === "SwitchChainNotSupportedError")) return t("err.wrongNetwork");
  const fr = getLang() === "fr";
  const first: any = chain[0];
  switch (first?.name) {
    case "EnclaveKeyMismatchError":
      return enclaveKeyError(first, fr);
    case "InsufficientSessionBalance":
      return first.pending
        ? t("err.session.pending", { cost: usdc(first.pending.cost) })
        : t("err.session.low", { balance: usdc(first.balance) });
    case "SessionExpiredError":
      return t("err.session.expired", { msg: fr ? String(first.message) : toEnglish(String(first.message)) });
    case "ReceiptMismatchError":
      return t("err.receipt", { msg: fr ? String(first.message) : toEnglish(String(first.message)) });
    case "ExploitNotProvenError":
      return fr ? String(first.message) : t("err.notProven", { reason: toEnglish(String(first.reason ?? "")) });
  }
  const x402 = x402Error(first);
  if (x402 !== null) return x402;
  if (chain.some((x) => x?.name === "InsufficientFundsError")) return t("err.gas");
  if (chain.some((x) => x?.name === "WaitForTransactionReceiptTimeoutError")) return t("err.timeout");
  if (first?.name === "ApiError") return explainApiError(first, fr);

  const hit = arcErrorOf(e);
  if (hit) {
    if (fr) return explainArcError(e); // « refusé par le contrat : Nom(args) — explication »
    const args = hit.args.length ? ` (${hit.args.map((a) => (typeof a === "bigint" ? a.toString() : String(a))).join(", ")})` : "";
    const why = ARC_ERRORS_EN[hit.name];
    return why ? t("err.contract", { name: hit.name, args, why }) : t("err.contractGeneric", { name: hit.name, args });
  }
  // a JSON-RPC request that failed (viem: "HTTP request failed.", in English in both languages until now): the RPC
  // limits the rate, answers with an error status, or doesn't answer at all
  const http = chain.find((x) => x?.name === "HttpRequestError");
  if (http) {
    if (http.status === 429) return t("err.rpc429");
    return typeof http.status === "number" && http.status > 0 ? t("err.rpcHttp", { status: http.status }) : t("err.network");
  }
  if (chain.some((x) => x?.name === "TimeoutError")) return t("err.slow");
  const msg = String(first?.shortMessage ?? first?.message ?? e);
  if (NETWORK.test(msg.trim())) return t("err.network");
  // an error this file doesn't know: its message as it came (in English, French messages translated by the rules); in
  // French, only a French message (the SDK's own checks, an enclave's refusal) or one without words (« HTTP 502 »):
  // anything else (the browser, a library: English) gives a French sentence with the error's name
  const unexpected = !msg.trim() || msg === "[object Object]" || (fr && !frenchOrNeutral(msg));
  if (unexpected) return t("err.unexpected", { name: errorName(first) });
  return fr ? msg : toEnglish(msg);
}

/** French text: accents, French typography (a space before « : ; ! ? », guillemets) or an elision; else more common
 *  French words than English ones; or a message the translation rules know (always French). The SDK and the enclaves
 *  write in French; the browser and the libraries, in English. (No lookbehind: older Safari can't parse it.) */
const FRENCH_MARK = /[àâçéèêëîïôûùüÿœæ«»]|\s[:;!?](?=\s|$)|(?:^|[^\p{L}'’-])(?:[cdjlmnst]|qu)['’]\p{L}/iu;
const FRENCH_WORD = /(?:^|[^\p{L}'’-])(?:le|la|les|de|des|du|un|une|en|et|ou|au|aux|ne|est|sont|pas|sans|trop|aucun|aucune|pour|dans|avec|sur|cette|ces|requis|requise|introuvable|illisible|inconnu|inconnue|inexistant|inexistante|absente|attendu|attendue|attente|octets)(?![\p{L}'’-])/giu;
const ENGLISH_WORD = /(?:^|[^\p{L}'’-])(?:the|a|an|to|of|in|on|at|by|for|with|from|is|are|was|were|be|been|has|have|not|no|cannot|can't|isn't|doesn't|failed|invalid|unexpected|unknown|missing|undefined|null)(?![\p{L}'’-])/giu;
function frenchOrNeutral(msg: string): boolean {
  if (FRENCH_MARK.test(msg) || englishOf(msg) !== null) return true;
  const frWords = msg.match(FRENCH_WORD)?.length ?? 0;
  if (frWords > 0) return frWords > (msg.match(ENGLISH_WORD)?.length ?? 0);
  // no word at all once a status and hex values are set aside (« HTTP 502 », « 0x… »): nothing to translate
  return !/\p{L}{2,}/u.test(msg.replace(/\bHTTP\b/g, "").replace(/0x[0-9a-fA-F]+/g, ""));
}

/** The name of an error (« TypeError », « ContractFunctionExecutionError »), « Error » when it has none. */
function errorName(first: any): string {
  const n = first?.name;
  return typeof n === "string" && /^[A-Za-z_$][\w$]{0,63}$/.test(n) ? n : "Error";
}

/** What an enclave refused before any payment (X402CallError: nothing signed, nothing due), by its code. */
export function x402RefusalText(status: number, code: string): string {
  switch (code) {
    case "busy": return t("x402.why.busy");
    case "queue_full":
    case "unsettled_backlog": return t("x402.why.backlog");
    case "operator_capacity": return t("x402.why.capacity");
    case "chain_unavailable": return t("x402.why.chain");
    case "rate_limited": return t("x402.why.rate");
    case "request_too_large": return t("x402.why.tooLarge");
    case "unexpected_free_response": return t("x402.why.free");
    case "invalid_envelope":
    case "invalid_request":
    case "undecryptable": return t("x402.why.format", { code });
  }
  return t("x402.why.other", { status: status || "—", code: code || "—" });
}

/** The pay-per-call client's errors (SDK x402.ts) and the attested copilot's, put into words from their FIELDS (never
 *  the server's text, which isn't authenticated); null for any other error. */
function x402Error(first: any): string | null {
  switch (first?.name) {
    case "X402ChallengeError": {
      const reason = String(first.reason ?? "format");
      if (reason === "price" && typeof first.newPrice === "bigint") return t("err.x402.price", { price: usdc(first.newPrice) });
      const key = ({
        cap: "err.x402.cap", price: "err.x402.cap", payTo: "err.x402.payTo", asset: "err.x402.asset", amount: "err.x402.amount",
        network: "err.x402.network", product: "err.x402.product",
      } as const)[reason as "cap"] ?? "err.x402.format";
      return t(key);
    }
    case "X402CallError":
      return t("err.x402.call", { why: x402RefusalText(Number(first.status ?? 0), String(first.code ?? "")) });
    case "X402PaidCallError": {
      const { max, cap, until, priceUp } = paidFacts(first);
      if (first.code === "enclave_changed") return t("err.x402.lost", { max, until });
      if (priceUp) return t("err.x402.priceUp", { price: priceUp, cap, max, until });
      return t("err.x402.paid", { n: Math.max(1, Number(first.attempts ?? 1)), max, until });
    }
    case "X402ReceiptMismatchError":
      return t("err.x402.receipt");
    case "X402PaymentRefusedError":
      return t("err.x402.call", { why: x402RefusalText(402, String(first.code ?? "")) });
    case "CopilotResponseError":
      return t("err.copilot.response");
  }
  return null;
}

/** What a paid call left without a verified answer (X402PaidCallError) involves, from its fields: the most it can
 *  cost (its largest authorization), the price accepted for it, when its authorization expires, and the new on-chain
 *  price when that price went up beyond what was accepted (read on-chain by the SDK, not the server's word). */
function paidFacts(e: any): { max: string; cap: string; until: string; priceUp: string | null } {
  const p = e?.pending;
  const max: bigint = Array.isArray(p?.authorizations)
    ? p.authorizations.reduce((m: bigint, a: any) => (typeof a?.value === "bigint" && a.value > m ? a.value : m), 0n)
    : 0n;
  const cap: bigint = typeof p?.maxPrice === "bigint" ? p.maxPrice : typeof p?.authorizations?.[0]?.value === "bigint" ? p.authorizations[0].value : max;
  const until = typeof p?.authorization?.validBefore === "bigint" ? fmtUnix(p.authorization.validBefore) : "—";
  const up = (e?.code === "price_increased" || e?.code === "price_above_cap") && typeof e?.newPrice === "bigint";
  return { max: usdc(max), cap: usdc(cap), until, priceUp: up ? usdc(e.newPrice) : null };
}

/** The box of a paid call left without a verified answer (X402Chat), under its title: what happened, in whole sentences
 *  that don't repeat the title, from the error's fields (never the server's text). */
export function paidCallText(e: any): string {
  const { max, cap, until, priceUp } = paidFacts(e);
  if (e?.code === "enclave_changed") return t("x402.paid.lostBody", { max, until });
  if (priceUp) return t("x402.paid.priceUpBody", { price: priceUp, cap, max, until });
  // the last answer received didn't match the receipt the enclave signed for it (a relay that altered it?): not shown
  if (e?.code === "receipt_mismatch") return t("x402.paid.receiptBody", { max, until });
  return t("x402.paid.body", { n: Math.max(1, Number(e?.attempts ?? 1)), max, until });
}
