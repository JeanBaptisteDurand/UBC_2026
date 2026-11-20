/** guard.ts — the copilot's HTTP guards: bounded body reading, conversation validation (user and assistant roles, text
 *  only, bounded history, secrets filter on the whole conversation), per-IP rate limit, the site proxy's token (copilot
 *  in an enclave), origins. */
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { getAddress, isAddress, type Address } from "viem";
import { isPublicIp, parseV6 } from "./net-guard";
import { scrubConversation } from "./secrets";
import { T, type Lang } from "./i18n";

export interface ChatBounds {
  /** Corps HTTP, en octets. */
  maxBodyBytes: number;
  /** Messages kept (the most recent). */
  maxMessages: number;
  /** Characters per message (beyond that: truncated, and the model knows it). */
  maxCharsPerMessage: number;
  /** Characters of the whole kept history. */
  maxCharsTotal: number;
}
export const DEFAULT_BOUNDS: ChatBounds = { maxBodyBytes: 64 * 1024, maxMessages: 20, maxCharsPerMessage: 4_000, maxCharsTotal: 16_000 };

// ---------------------------------------------------------------- bounded request body

/** Reads a request body without ever exceeding `max` bytes (the announced Content-Length, then counted as it streams). */
export async function readBodyCapped(req: Request, max: number): Promise<{ ok: true; text: string } | { ok: false; status: 400 | 413 }> {
  const cl = req.headers.get("content-length");
  if (cl !== null) {
    if (!/^\d+$/.test(cl.trim())) return { ok: false, status: 400 };
    if (Number(cl) > max) return { ok: false, status: 413 };
  }
  if (!req.body) return { ok: true, text: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); return { ok: false, status: 413 }; }
    chunks.push(value);
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

// ---------------------------------------------------------------- conversation

export interface ClientMessage { role: "user" | "assistant"; content: string }
export type ParsedChat =
  | { ok: true; messages: ClientMessage[]; user?: Address; dropped: number; truncated: number; alert: boolean }
  | { ok: false; error: string };

const TRUNC = (n: number) => `\n[… message tronqué : ${n.toLocaleString("fr-FR")} caractères au plus]`;

/** Validates the conversation sent by the client.
 *  Refused (400): a role other than user/assistant (system, developer, tool…), non-text content, no message, or a last
 *  message that is empty or not from the user. Bounded without refusal: only the last maxMessages messages are kept,
 *  each truncated to maxCharsPerMessage, then the oldest drop until maxCharsTotal. The WHOLE conversation received goes
 *  through the secrets filter BEFORE it is truncated (otherwise a key cut in two by the truncation would be half sent to
 *  the model): scrubConversation, in ALERT MODE for every message as soon as a user message mentions a private key, a
 *  recovery phrase or an extended key (mentionsSecret; no 64-hex value or base58 key, a phrase recognized from 8 words
 *  or split across several messages; `alert` says so). Only role and content are copied. `lang`: the language of the
 *  error messages (default: French). */
export function parseChatRequest(body: unknown, b: ChatBounds = DEFAULT_BOUNDS, lang: Lang = "fr"): ParsedChat {
  const E = T(lang).chat;
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: E.notObject };
  const raw = (body as any).messages;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: E.messagesArray };
  for (const [i, m] of raw.entries()) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, error: E.messageObject(i) };
    if (m.role !== "user" && m.role !== "assistant") return { ok: false, error: E.role(i, String(m.role).slice(0, 20)) };
    if (typeof m.content !== "string") return { ok: false, error: E.nonText(i) };
  }
  const last = raw[raw.length - 1] as ClientMessage;
  if (last.role !== "user") return { ok: false, error: E.lastNotUser };
  if (!last.content.trim()) return { ok: false, error: E.empty };

  // the filter sees the whole conversation received (a private-key mention in an old message also puts the later ones
  // on alert), and only role and content
  const clean = scrubConversation((raw as ClientMessage[]).map((m) => ({ role: m.role, content: m.content })));
  let truncated = 0;
  let kept: ClientMessage[] = clean.messages.slice(-b.maxMessages)
    .filter((m, i, a) => i === a.length - 1 || m.content.trim() !== "")
    .map((m) => {
      if (m.content.length <= b.maxCharsPerMessage) return m;
      truncated++;
      const mark = TRUNC(b.maxCharsPerMessage);
      return { role: m.role, content: m.content.slice(0, b.maxCharsPerMessage - mark.length) + mark };
    });
  let total = kept.reduce((s, m) => s + m.content.length, 0);
  while (kept.length > 1 && total > b.maxCharsTotal) { total -= kept[0]!.content.length; kept = kept.slice(1); }
  const dropped = raw.length - kept.length;
  const messages = kept;
  const u = (body as any).user;
  const user = typeof u === "string" && isAddress(u, { strict: false }) ? getAddress(u.toLowerCase()) : undefined;
  return { ok: true, messages, user, dropped, truncated, alert: clean.alert };
}

// ---------------------------------------------------------------- rate limit

const MINUTE = 60_000;
const DAY = 86_400_000;

export interface RateOptions {
  perMinute: number;
  perDay: number;
  /** Daily global cap on requests sent to the model (0 = none). */
  globalPerDay: number;
  /** Maximum keys tracked (bounded memory). */
  maxKeys?: number;
  now?: () => number;
}
export type RateVerdict = { ok: true } | { ok: false; retryAfterSec: number; scope: "minute" | "jour" | "global" };

/** A sliding one-minute window (the times of the latest requests) and a fixed 24 h window, per key (IP). */
export class RateLimiter {
  private per = new Map<string, { hits: number[]; dayStart: number; dayCount: number }>();
  private glob = { dayStart: 0, count: 0 };
  private n = 0;
  constructor(private o: RateOptions) {}
  private now() { return (this.o.now ?? Date.now)(); }

  /** Counts a request from this key if it passes; otherwise says when to retry. */
  hit(key: string): RateVerdict {
    const now = this.now();
    if (++this.n % 500 === 0 || this.per.size > (this.o.maxKeys ?? 20_000)) this.sweep(now);
    let e = this.per.get(key);
    if (!e) { e = { hits: [], dayStart: now, dayCount: 0 }; this.per.set(key, e); }
    if (now - e.dayStart >= DAY) { e.dayStart = now; e.dayCount = 0; }
    e.hits = e.hits.filter((t) => now - t < MINUTE);
    if (e.dayCount >= this.o.perDay) return { ok: false, scope: "jour", retryAfterSec: Math.max(1, Math.ceil((e.dayStart + DAY - now) / 1000)) };
    if (e.hits.length >= this.o.perMinute) return { ok: false, scope: "minute", retryAfterSec: Math.max(1, Math.ceil((e.hits[0]! + MINUTE - now) / 1000)) };
    e.hits.push(now);
    e.dayCount++;
    return { ok: true };
  }

  /** Global cap: one more request sent to the model today? */
  hitGlobal(): RateVerdict {
    if (!this.o.globalPerDay) return { ok: true };
    const now = this.now();
    if (now - this.glob.dayStart >= DAY) this.glob = { dayStart: now, count: 0 };
    if (this.glob.count >= this.o.globalPerDay) return { ok: false, scope: "global", retryAfterSec: Math.max(1, Math.ceil((this.glob.dayStart + DAY - now) / 1000)) };
    this.glob.count++;
    return { ok: true };
  }

  get size() { return this.per.size; }

  private sweep(now: number) {
    for (const [k, e] of this.per) if (now - e.dayStart >= DAY || (e.dayCount === 0 && e.hits.length === 0)) this.per.delete(k);
    const max = this.o.maxKeys ?? 20_000;
    for (const k of this.per.keys()) { if (this.per.size <= max) break; this.per.delete(k); } // the oldest first
  }
}

// ---------------------------------------------------------------- IP du client

const unmap = (ip: string) => ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
function stripPort(s: string): string {
  const b = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (b) return b[1]!;
  const p = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(s);
  return p ? p[1]! : s;
}

/** The rate key: an IPv4, or the /64 of an IPv6 (one subscriber has billions of them). */
export function bucketOf(ip: string): string {
  const a = unmap(ip);
  if (isIP(a) === 6) {
    const g = parseV6(a);
    if (g) return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
  }
  return a;
}

/** The client's IP, read from X-Forwarded-For when it is trusted, otherwise the peer's address.
 *  - `trustForwarded` absent (the server's copilot): X-Forwarded-For is trusted only when the connection comes from a
 *    local proxy (a private or loopback peer), and its LAST hop counts (set by Caddy, which replaces the client's);
 *    exposed directly, the service takes the peer's address;
 *  - `trustForwarded` given (copilot in an enclave: the peer is ALWAYS Phala's private gateway, whether the request
 *    comes from the site's proxy or from anyone): trusted only when true, that is when the request carries the proxy
 *    token (app.ts, proxyToken). Its FIRST hop then counts: Caddy set it (it replaces any value from the client), and an
 *    intermediary after it (nginx, Phala's gateway) can only append its own address. */
export function clientIp(c: Context, trustForwarded?: boolean): string {
  let peer: string | undefined;
  try { peer = getConnInfo(c).remote.address; } catch { peer = undefined; }
  const trusted = trustForwarded ?? (!peer || !isPublicIp(unmap(peer)));
  const xff = c.req.header("x-forwarded-for");
  if (xff && trusted) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const hop = stripPort((trustForwarded === true ? hops[0] : hops.pop()) ?? "");
    if (isIP(unmap(hop))) return unmap(hop);
  }
  return peer ? unmap(peer) : "inconnue";
}

// ---------------------------------------------------------------- the proxy token (copilot in an enclave)

/** The header the site's proxy (nginx, proxy_set_header) sets on every request to the copilot in an enclave. */
export const PROXY_TOKEN_HEADER = "x-archive-proxy-token";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Checks the proxy token in constant time: it compares SHA-256 digests (same length, whatever the length of the token
 *  received) with timingSafeEqual, so neither the value nor the length of the expected token leaks through the response
 *  time. The token is never logged. */
export function proxyTokenChecker(expected: string): (given: string | null | undefined) => boolean {
  if (!expected) throw new Error("jeton du mandataire vide");
  const want = sha256(expected);
  return (given) => typeof given === "string" && timingSafeEqual(sha256(given), want);
}

// ---------------------------------------------------------------- origines

export const DEFAULT_ORIGINS = ["https://archive.62-171-153-35.sslip.io"];

/** ALLOWED_ORIGINS: a comma-separated list ("*" = all, for development only). */
export function parseOrigins(env: string | undefined): string[] {
  const list = (env ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS;
}
export const originAllowed = (origin: string, allowed: string[]) =>
  allowed.includes("*") || allowed.includes(origin.trim().replace(/\/+$/, "").toLowerCase());
