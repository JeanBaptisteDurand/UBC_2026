/** net.ts — HTTP calls (native fetch) with a timeout, network errors put into English words, and the API's refusals
 *  translated by their stable code (the "code" field of each API error; its "error" text is only a fallback). */
import { VERSION } from "./version";

export interface HttpResult {
  status: number;
  ok: boolean;
  json: any;
  text: string;
  headers: Headers;
  ms: number;
  /** local time minus the server's time (Date header), in seconds; null if there is no header */
  skewS: number | null;
}

export interface RequestInit2 {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function deadline(ms: number, signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(ms);
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  return signal && any ? any([t, signal]) : t;
}

export async function request(url: string, init: RequestInit2 = {}): Promise<HttpResult> {
  const t0 = Date.now();
  const hasBody = init.body !== undefined;
  const res = await fetch(url, {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers: {
      "user-agent": `archive-node/${VERSION}`,
      accept: "application/json",
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    body: hasBody ? JSON.stringify(init.body) : undefined,
    signal: deadline(init.timeoutMs ?? 10_000, init.signal),
  });
  const text = await res.text();
  const t1 = Date.now();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const date = Date.parse(res.headers.get("date") ?? "");
  // the Date header is truncated to the second: aim at the middle of that second
  const skewS = Number.isFinite(date) ? ((t0 + t1) / 2 - (date + 500)) / 1000 : null;
  return { status: res.status, ok: res.ok, json, text, headers: res.headers, ms: t1 - t0, skewS };
}

/** "connection refused", "host name not found"… rather than "fetch failed" */
export function netError(e: unknown, timeoutMs = 10_000): string {
  const x = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  if (x?.name === "TimeoutError") return `no answer within ${Math.round(timeoutMs / 1000)} s`;
  if (x?.name === "AbortError") return "request cancelled";
  if (/bad port/i.test(x?.cause?.message ?? x?.message ?? "")) return "port refused by the HTTP client (reserved port: pick another one)";
  switch (x?.cause?.code ?? x?.code) {
    case "ECONNREFUSED":
      return "connection refused (nothing is listening at this address)";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "host name not found (DNS)";
    case "ECONNRESET":
    case "UND_ERR_SOCKET":
      return "connection closed by the server";
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return "connection timed out (firewall?)";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "network unreachable";
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "TLS certificate refused (wrong clock or proxy?)";
  }
  return String(x?.cause?.message ?? x?.message ?? e);
}

type Params = Record<string, unknown>;
const v = (p: Params, k: string, dflt = "?"): string => (p[k] === undefined || p[k] === null ? dflt : String(p[k]));

/** What a refused rate was counting (params.scope of "rate_limited"). */
const SCOPE_EN: Record<string, string> = {
  signatures: "signatures", signed_reads: "signed reads", nonce_requests: "nonce requests", code_requests: "code requests",
  code_lookups: "code lookups", pairing_polls: "pairing polls", pairing_refusals: "pairing refusals", key_reads: "key reads",
  heartbeats: "heartbeats", key_heartbeats: "heartbeats for this key", account_signatures: "signatures for this account",
  account_reads: "signed reads for this account", account_new_reads: "new signed reads for this account",
  invalid_signatures: "invalid signatures",
};

/** The API refusals the agent can receive (pairing, heartbeats, reading its machine), in English, by code. */
const API_EN: Record<string, (p: Params) => string> = {
  rate_limited: (p) => `too many requests (${SCOPE_EN[v(p, "scope")] ?? v(p, "scope")}): try again in ${v(p, "retryAfter")} s`,
  pairings_full: () => "too many pairings in progress: try again in a few minutes",
  pairings_per_ip: (p) => `already ${v(p, "max")} pairings in progress from this address: finish one or wait for it to expire (${v(p, "minutes", "15")} min)`,
  pairings_per_network: (p) => `already ${v(p, "max")} pairings in progress from this network: finish one or wait for it to expire (${v(p, "minutes", "15")} min)`,
  no_free_code: () => "no free code: try again",
  invalid_enum: (p) => `invalid ${v(p, "field")}: expected ${v(p, "allowed")}`,
  invalid_hex: (p) => `invalid ${v(p, "field")}: expected 0x followed by ${v(p, "length")} hex characters`,
  invalid_product_id: () => "invalid productId: an integer of 10 digits at most",
  invalid_enclave_url: (p) => `invalid enclaveUrl: an http(s) address of ${v(p, "max", "200")} characters at most`,
  unreadable_enclave_url: () => "invalid enclaveUrl: unreadable address",
  enclave_url_scheme: () => "invalid enclaveUrl: http:// or https://, without credentials",
  invalid_doctor: () => "invalid doctor: expected { checks: [...] }",
  invalid_logs: () => "invalid logs: expected an array of lines",
  body_too_large: (p) => `request body too large (${v(p, "maxKiB", "64")} KiB at most)`,
  device_code_unknown: () => "unknown pairing request (deviceCode)",
  not_a_machine_key: () => "only the key of a machine paired by code can refuse its pairing",
  key_missing: () => "operator key missing or malformed (expected: Authorization: Bearer arcop_…)",
  key_unknown_or_revoked: () => "unknown or revoked operator key",
  key_invalid: () => "invalid operator key",
  key_forbidden: () => "this key doesn't give access to this machine",
  machine_unknown_for_key: () => "unknown machine for this key: pair again (archive-node pair --force)",
  machine_unknown: () => "unknown machine",
  machine_limit: (p) => `limit of ${v(p, "max")} machines per operator reached: remove one on the Operator page`,
  network_full_machines: () => "the network isn't accepting new machines right now: try again later",
  internal_error: () => "internal error of the operator API",
  server_error: () => "the API failed to answer (server error)",
};

/** The API's refusal in English: by its stable code; otherwise its text as it came, or the start of the answer. */
export function apiMessage(r: HttpResult): string {
  const code = typeof r.json?.code === "string" ? r.json.code : null;
  const params = r.json?.params && typeof r.json.params === "object" ? (r.json.params as Params) : {};
  const en = code && Object.prototype.hasOwnProperty.call(API_EN, code) ? API_EN[code]!(params) : null;
  if (en) return en;
  return typeof r.json?.error === "string" ? r.json.error : r.text.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** "HTTP 404: the API's message" */
export function apiError(r: HttpResult): string {
  const m = apiMessage(r);
  return `HTTP ${r.status}${m ? `: ${m}` : ""}`;
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
