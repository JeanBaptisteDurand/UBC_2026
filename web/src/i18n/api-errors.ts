/** api-errors.ts — the ArcHive API's refusals in the site's language (English or French), by their stable code.
 *  Each API error is { error, code, params? } (services/api/src/operators.ts, server.ts): `error` is the API's French
 *  sentence; the site never translates that text when it has the code. A code this version doesn't know returns null:
 *  the caller then falls back on the rules of sdk-messages.en.ts (English) or the API's text (French). */
import { t, type StaticKey } from ".";

type Params = Record<string, unknown>;
const has = <T extends object>(o: T, k: string): k is Extract<keyof T, string> => Object.prototype.hasOwnProperty.call(o, k);
/** a value from params, as text ("?" or the default when it's missing) */
const val = (p: Params, k: string, dflt = "?"): string => (p[k] === undefined || p[k] === null || p[k] === "" ? dflt : String(p[k]));

/** codes whose sentence has no value */
const FIXED = {
  signatures_full: "api.signatures_full", pairings_full: "api.pairings_full", no_free_code: "api.no_free_code",
  network_full_machines: "api.network_full_machines", network_full_keys: "api.network_full_keys",
  invalid_product_id: "api.invalid_product_id", unreadable_enclave_url: "api.unreadable_enclave_url",
  enclave_url_scheme: "api.enclave_url_scheme", invalid_doctor: "api.invalid_doctor", invalid_logs: "api.invalid_logs",
  invalid_address: "api.invalid_address", address_param_expected: "api.address_param_expected",
  operator_param_expected: "api.operator_param_expected", user_code_expected: "api.user_code_expected",
  signed_body_expected: "api.signed_body_expected", bad_message_or_signature: "api.bad_message_or_signature",
  key_missing: "api.key_missing", key_unknown_or_revoked: "api.key_unknown_or_revoked", key_invalid: "api.key_invalid",
  key_forbidden: "api.key_forbidden", not_a_machine_key: "api.not_a_machine_key", address_mismatch: "api.address_mismatch",
  signature_expired: "api.signature_expired", nonce_unknown: "api.nonce_unknown", signature_used: "api.signature_used",
  issued_at_mismatch: "api.issued_at_mismatch", bad_signature: "api.bad_signature", code_unknown: "api.code_unknown",
  pair_already_approved: "err.pairTaken", pair_already_yours: "api.pair_already_yours",
  device_code_unknown: "api.device_code_unknown", machine_unknown_for_key: "api.machine_unknown_for_key",
  machine_unknown: "api.machine_unknown", machine_not_found: "api.machine_not_found", key_not_found: "api.key_not_found",
  receipt_expected: "api.receipt_expected", receipt_unreadable: "api.receipt_unreadable",
  signature_unreadable: "api.signature_unreadable", internal_error: "api.internal_error", server_error: "api.server_error",
} as const satisfies Record<string, StaticKey>;

/** what a rate limit counted (params.scope of "rate_limited") */
const SCOPE = {
  signatures: "api.scope.signatures", signed_reads: "api.scope.signed_reads", nonce_requests: "api.scope.nonce_requests",
  code_requests: "api.scope.code_requests", code_lookups: "api.scope.code_lookups", pairing_polls: "api.scope.pairing_polls",
  pairing_refusals: "api.scope.pairing_refusals", key_reads: "api.scope.key_reads", heartbeats: "api.scope.heartbeats",
  key_heartbeats: "api.scope.key_heartbeats", account_signatures: "api.scope.account_signatures",
  account_reads: "api.scope.account_reads", account_new_reads: "api.scope.account_new_reads",
  invalid_signatures: "api.scope.invalid_signatures",
} as const satisfies Record<string, StaticKey>;

/** the part of a malformed signed message (params.part of "malformed_message") */
function malformedPart(p: Params): string {
  switch (val(p, "part", "")) {
    case "format": return t("api.malformed.format", { n: val(p, "lines", "11") });
    case "header": return t("api.malformed.header");
    case "blank_lines": return t("api.malformed.blank_lines");
    case "uri": return t("api.malformed.uri", { uri: val(p, "uri") });
    case "version": return t("api.malformed.version");
    case "nonce": return t("api.malformed.nonce");
    case "time": return t("api.malformed.time", { line: val(p, "line", "Issued At") });
    case "expiry_window": return t("api.malformed.expiry_window", { min: val(p, "minutes") });
  }
  return t("api.malformed.other");
}

/** The site's sentence for an API error code (current language), or null for a code this version doesn't know. */
export function apiErrorText(code: string, p: Params = {}): string | null {
  if (has(FIXED, code)) return t(FIXED[code]);
  switch (code) {
    case "rate_limited": {
      const scope = val(p, "scope");
      return t("api.rate_limited", { what: has(SCOPE, scope) ? t(SCOPE[scope]) : scope, s: val(p, "retryAfter") });
    }
    case "too_many_wrong_codes": return t("api.too_many_wrong_codes", { s: val(p, "retryAfter") });
    case "pairings_per_ip": return t("api.pairings_per_ip", { max: val(p, "max"), min: val(p, "minutes", "15") });
    case "pairings_per_network": return t("api.pairings_per_network", { max: val(p, "max"), min: val(p, "minutes", "15") });
    case "machine_limit": return t("api.machine_limit", { max: val(p, "max") });
    case "key_limit": return t("api.key_limit", { max: val(p, "max") });
    case "invalid_enum": return t("api.invalid_enum", { field: val(p, "field"), allowed: val(p, "allowed") });
    case "invalid_hex": return t("api.invalid_hex", { field: val(p, "field"), n: val(p, "length") });
    case "invalid_enclave_url": return t("api.invalid_enclave_url", { max: val(p, "max", "200") });
    case "body_too_large": return t("api.body_too_large", { max: val(p, "maxKiB", "64") });
    case "malformed_message": return t("api.malformed", { detail: malformedPart(p) });
    case "wrong_site": return t("api.wrong_site", { site: val(p, "site"), expected: val(p, "expected") });
    case "wrong_chain": return t("api.wrong_chain", { id: val(p, "chainId", "5042002") });
    case "wrong_statement": return t("api.wrong_statement", { statement: val(p, "statement") });
    case "nonce_expired": return t("api.nonce_expired", { min: val(p, "minutes", "5") });
  }
  return null;
}
