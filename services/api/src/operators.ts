/** operators.ts — how an operator's machine joins, from a bare machine to the network:
 *  pairing by code (like a TV: the machine shows HIVE-7K2P-QX9M, a person approves it by signing with their wallet),
 *  limited-scope operator keys (arcop_…, only a hash is stored), heartbeats, diagnostics.
 *  An operator key can spend NOTHING: the bond and the on-chain registration stay signed by the wallet.
 *
 *  Guardrails (from a security audit and its re-check):
 *  - rate limits per IP (the client's, set by Caddy in X-Forwarded-For), high enough for a whole room behind the same
 *    Wi-Fi (a live demo). Abuse is held back by cost, not by address: an INVALID signature counts per IP (30 per minute,
 *    then no more verification for that IP during the minute); a VALID signature counts per account (30 actions, 10 open
 *    reads, 300 reads per minute), and no one can exhaust another account's budget; wrong codes count per network (/24
 *    in IPv4, /48 in IPv6), with no global cap; a rate table never saturates (beyond 50,000 keys in the minute, new keys
 *    count in a fixed shared table, with no blanket refusal);
 *  - bounded storage: expired pairings purged (at startup, then every minute), 10 free active keys and 20 machines per
 *    operator, global caps, bodies of 64 KiB at most, every field validated (type, format, size), logs kept in memory
 *    only (never rewritten to disk at each heartbeat);
 *  - 8-character pairing codes drawn without bias (31^8 ≈ 8.5·10^11); the machine's name is shown only to whoever
 *    signed the pairing;
 *  - a machine's logs and diagnostics are reserved to its operator: an arcop_ key (Authorization header) or a read
 *    signature ("read my operator data", valid 10 min); the public view keeps only the useful state (online,
 *    registered, failed checks), with no machine name, no http://IP address and no logs.
 *
 *  Wallet signatures: EIP-4361 format ("Sign-In with Ethereum"). The wallet recognizes this format and compares the
 *  message's domain with the page's: an impostor site is flagged. The API checks EVERY line (the site's domain and URI,
 *  EIP-55 address, the action's exact statement, version, Chain ID 5042002, nonce, Issued At, Expiration Time); the
 *  nonce is issued here (GET /auth/nonce) and is used once, within 5 minutes. It is NOT stored when issued: it is a
 *  token signed by the API (issue time, randomness, HMAC with a key drawn at startup), verifiable without a table; only
 *  consumed nonces are kept, until they expire. Requesting nonces therefore fills nothing.
 *  The machine, for its part, shows the full address that approved it and asks for confirmation before keeping its key;
 *  if the person refuses, POST /pair/reject revokes the key. */
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { accessSync, constants as fsc, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { getAddress, recoverMessageAddress, type Address, type Hex, type PublicClient } from "viem";
import { arcTestnet, type ArcClient } from "@arcvault/sdk";

type Key = { keyId: string; hash: string; operator: string; label: string; machineId: string | null; createdAt: number; lastUsedAt: number | null; revoked: boolean; revokedAt?: number };
type Pair = {
  deviceCode: string; userCode: string; hostname: string; mode: string; version: string; createdAt: number; expiresAt: number;
  status: "pending" | "approved" | "consumed"; operator?: string; machineId?: string; keyPlain?: string;
  /** short hash of the IP that requested the code (cap on pending pairings per address); never the IP in clear */
  ip?: string;
  /** short hash of its network (/24 in IPv4, /48 in IPv6): cap on pending pairings per network */
  net?: string;
};
type Check = { id: string; label: string; ok: boolean; detail: string };
type Machine = {
  machineId: string; operator: string; hostname: string; mode: string; version: string; productId: string | null;
  enclaveUrl: string | null; signer: string | null; x25519: string | null; status: string;
  doctor: { ok: boolean; checks: Check[] } | null; lastSeen: number | null; createdAt: number;
  /** Where what the machine announces comes from: "code" (paired by code, the person confirmed the account on the
   *  machine) or "key" (heartbeat of a free arcop_ key, with no confirmation on the machine; a free key that takes over
   *  a machine paired by code switches it to "key"). Absent: a machine recorded before this field, origin unknown. */
  pairedBy?: "code" | "key";
  /** the approving address: the account that signed the pairing, or the one that created the free key */
  approvedBy?: string;
  /** the free key (keyId) that added or took over the machine ("key" only) */
  viaKey?: string | null;
  pairedAt?: number;
};
type Store = { keys: Record<string, Key>; pairs: Record<string, Pair>; machines: Record<string, Machine> };

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const FILE = join(DATA_DIR, "operators.json");
const WEB_URL = (process.env.WEB_URL ?? "http://62.171.153.35:8900").replace(/\/$/, "");

/** Storage caps (a new wallet costs nothing, so each operator, and the whole, are bounded). */
const LIMITS = {
  freeKeysPerOperator: 10, // active free keys (CLI, MCP); machine keys follow the machine cap
  revokedKeptPerOperator: 20, // revoked keys kept for history (the oldest are erased)
  machinesPerOperator: 20,
  keysTotal: 5_000, // active keys, all operators
  machinesTotal: 1_000,
  pendingPairsTotal: 5_000, // ≈ 300 bytes each; 15 minutes at most
  pendingPairsPerIp: 20, // a whole room behind one Wi-Fi shares its address
  pendingPairsPerNet: 50, // per /24 (IPv4) or /48 (IPv6): filling the table takes at least 100 networks
  /** consumed nonces, kept until they expire (≈ 140 bytes for an action, 230 for a read). Each entry
   *  costs a VALID signature, verified here; this cap only protects memory (≈ 120 MB at worst): at the verification
   *  rate of one processor (≈ 500 per second), 10 minutes of reads fill 300,000. */
  consumedTotal: 500_000,
};
/** Rate per IP and per minute: enough for a whole room behind one Wi-Fi (a room demo: dozens of operators, a single
 *  address; the site reads the list every 10 s and a detail every 15 s). */
const RATE = { pairStart: 30, pairLookup: 30, pairPoll: 600, signed: 120, signedRead: 600, nonce: 240, keyList: 300, heartbeatIp: 600, heartbeatKey: 30 };
/** INVALID signatures per IP and per minute: above this, no more verification for this IP until the end of the
 *  minute. A verification costs ≈ 2 ms of processor time (or an RPC call for a smart wallet); an invalid signature
 *  costs nothing to produce, so it is the one capped per address. A person never produces one (their wallet just signs). */
const BAD_SIGNATURES_PER_IP = 30;
/** Per account (address) and per minute, counted AFTER the signature check: each unit costs a valid signature and a
 *  fresh nonce, and nobody can exhaust another account's budget. A person signs a few actions per minute and opens a
 *  read every 10 minutes. */
const ACCOUNT_RATE = { signed: 30, readOpen: 10, read: 300 };
/** Wrong codes (lookup or approval) per network (/24 in IPv4, /48 in IPv6) and per minute: above this, no more code
 *  lookups from this network until the end of the minute. No global cap (30 IPs were enough to block all pairing):
 *  an 8-character code (31^8 ≈ 8.5·10^11) cannot be guessed at this rate. */
const FAILS_PER_NET = 60;
const PAIR_TTL_MS = 15 * 60_000;
const PAIR_PURGE_GRACE_MS = 2 * 60_000; // the agent polls until the expiry + 30 s, so the record is kept a little longer
/** A nonce serves ONCE, within the 5 minutes after it was issued. */
const NONCE_TTL_MS = 5 * 60_000;
/** "Expiration Time" at most 5 minutes after "Issued At" for an action, 10 minutes for the read (reusable). */
const ACTION_TTL_MS = 5 * 60_000;
const READ_TTL_MS = 10 * 60_000;
/** clock tolerance on "Issued At" (the site reuses the time /auth/nonce returns: no drift in practice) */
const CLOCK_SKEW_MS = 60_000;
const BODY_MAX = 64 * 1024;
const LOG_LINES = 100;
const LOG_LINE_MAX = 400;
const HIDDEN_NAME = "name shown after the signature";

// ---------------------------------------------------------------- stockage

function load(): Store {
  const empty: Store = { keys: {}, pairs: {}, machines: {} };
  try {
    if (existsSync(DATA_DIR)) accessSync(DATA_DIR, fsc.R_OK | fsc.W_OK | fsc.X_OK);
  } catch {
    console.error(`operators: the folder ${DATA_DIR} is not readable AND writable by this process (uid ${process.getuid?.() ?? "?"}): keys and machines will be neither read nor saved. Check the rights of the data volume.`);
  }
  try {
    if (!existsSync(FILE)) return empty;
    const raw = JSON.parse(readFileSync(FILE, "utf8")) ?? {};
    const s: Store = { keys: raw.keys ?? {}, pairs: raw.pairs ?? {}, machines: raw.machines ?? {} };
    for (const m of Object.values(s.machines) as Array<Machine & { logs?: unknown }>) delete m.logs; // never on disk again
    // machines from before "pairedBy": a machine-bound key is only born from a pairing by code; otherwise, unknown
    const bound = new Set(Object.values(s.keys).map((k) => k.machineId).filter(Boolean));
    for (const m of Object.values(s.machines)) {
      if (!m.pairedBy && bound.has(m.machineId)) Object.assign(m, { pairedBy: "code", approvedBy: m.operator, viaKey: null });
    }
    return s;
  } catch (e) {
    console.error(`operators: ${FILE} unreadable (${(e as Error).message}): starting empty`);
    return empty;
  }
}
const db: Store = load();
/** machine logs: in memory only (100 lines at most per machine, sent back with each heartbeat) */
const logsOf = new Map<string, string[]>();

let saveTimer: NodeJS.Timeout | null = null;
let saveDue = 0;
/** Deferred write: 200 ms for a state change (key, pairing, removal), 5 s for a plain heartbeat. */
function save(urgent = true) {
  const delay = urgent ? 200 : 5_000;
  const due = Date.now() + delay;
  if (saveTimer && saveDue <= due) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveDue = due;
  saveTimer = setTimeout(flush, delay);
  saveTimer.unref?.();
}
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(FILE + ".tmp", JSON.stringify(db), { mode: 0o600 });
    renameSync(FILE + ".tmp", FILE); // atomic write
  } catch (e) { console.error("operators: save failed:", (e as Error).message); }
}

// ---------------------------------------------------------------- outils

/** Stable error codes: every error answer carries { error, code, params? }. `error` is an English sentence for
 *  people and simple clients; the site (EN and FR) and the agent (EN) translate from `code`, with the `params` values.
 *  A code never changes meaning; a new case gets a new code. */
export type ErrorCode =
  // field validation
  | "invalid_enum" | "invalid_hex" | "invalid_product_id" | "invalid_enclave_url" | "unreadable_enclave_url" | "enclave_url_scheme"
  | "invalid_doctor" | "invalid_logs" | "body_too_large" | "invalid_address" | "address_param_expected" | "operator_param_expected"
  | "user_code_expected" | "signed_body_expected" | "bad_message_or_signature"
  // rate and capacity
  | "rate_limited" | "too_many_wrong_codes" | "signatures_full" | "pairings_full" | "pairings_per_ip" | "pairings_per_network"
  | "no_free_code" | "machine_limit" | "key_limit" | "network_full_machines" | "network_full_keys"
  // operator keys (Authorization: Bearer arcop_…)
  | "key_missing" | "key_unknown_or_revoked" | "key_invalid" | "key_forbidden" | "not_a_machine_key"
  // messages signed by the wallet (EIP-4361)
  | "malformed_message" | "wrong_site" | "address_mismatch" | "wrong_chain" | "wrong_statement" | "signature_expired"
  | "nonce_unknown" | "nonce_expired" | "signature_used" | "issued_at_mismatch" | "bad_signature"
  // pairing, machines, keys
  | "code_unknown" | "pair_already_approved" | "pair_already_yours" | "device_code_unknown" | "machine_unknown_for_key"
  | "machine_unknown" | "machine_not_found" | "key_not_found"
  // reading (server.ts) and the unexpected: refused read parameters, unknown product or enclave, unknown route
  | "receipt_expected" | "receipt_unreadable" | "signature_unreadable" | "internal_error" | "server_error"
  | "invalid_param" | "unknown_param" | "unknown_product" | "unknown_enclave" | "not_found";
type Params = Record<string, string | number | boolean>;
export class HttpError extends Error {
  readonly retryAfter?: number;
  readonly params?: Params;
  constructor(public status: number, public code: ErrorCode, msg: string, o: { retryAfter?: number; params?: Params } = {}) {
    super(msg);
    this.retryAfter = o.retryAfter;
    this.params = o.params;
  }
}
/** an error's JSON body: { error, code, params? } */
export const errorBody = (code: ErrorCode, error: string, params?: Params) => ({ error, code, ...(params ? { params } : {}) });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 characters, without I, L, O, 0, 1 (easy to read aloud)
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEYID_RE = /^[0-9a-f]{8}$/;
const mask = (k: string) => k.replace(/^(arcop_[0-9a-f]+_)(.{4}).*(.{4})$/, "$1$2…$3");

/** n characters of ALPHA, without bias (draws above 248 = 8 × 31 are rejected) */
function randomChars(n: number): string {
  let out = "";
  while (out.length < n) {
    for (const b of randomBytes(2 * n)) {
      if (b >= 248) continue;
      out += ALPHA[b % ALPHA.length];
      if (out.length === n) break;
    }
  }
  return out;
}
const newUserCode = () => { const s = randomChars(8); return `HIVE-${s.slice(0, 4)}-${s.slice(4)}`; };
/** "hive-7k2p qx9m", "HIVE-7K2PQX9M", "7K2P-QX9M" → "HIVE-7K2P-QX9M"; null if it is not a code */
function normCode(raw: unknown): string | null {
  const s = String(raw ?? "").toUpperCase().replace(/[\s_]+/g, "");
  const m = s.match(/^(?:HIVE-?)?([A-Z0-9]{4})-?([A-Z0-9]{4})$/);
  if (!m) return null;
  const body = m[1]! + m[2]!;
  for (const ch of body) if (!ALPHA.includes(ch)) return null;
  return `HIVE-${m[1]}-${m[2]}`;
}

/** free text fit for display: no control characters, ANSI sequences or bidirectional overrides */
function cleanText(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
    .slice(0, max);
}
/** host name: letters, digits, dot, dash, underscore; anything else becomes "-" */
function cleanHostname(v: unknown): string {
  const h = cleanText(v ?? "machine", 64).trim().replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  return h || "machine";
}
const cleanVersion = (v: unknown) => cleanText(v ?? "", 32).replace(/[^0-9A-Za-z.+-]/g, "");
const MODES = new Set(["tdx", "dstack", "demo"]);
const STATUSES = new Set(["starting", "running", "error", "stopped"]);
function enumOf(v: unknown, allowed: Set<string>, field: string): string {
  const s = String(v ?? "");
  const list = [...allowed].join(", ");
  if (!allowed.has(s)) throw new HttpError(400, "invalid_enum", `invalid ${field}: expected ${list}`, { params: { field, allowed: list } });
  return s;
}
function optHex(v: unknown, nHex: number, field: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${nHex}}$`).test(v)) {
    throw new HttpError(400, "invalid_hex", `invalid ${field}: expected 0x followed by ${nHex} hex characters`, { params: { field, length: nHex } });
  }
  return v.toLowerCase();
}
function optProductId(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = typeof v === "number" ? (Number.isSafeInteger(v) && v >= 0 ? String(v) : "") : typeof v === "string" ? v : "";
  if (!/^\d{1,10}$/.test(s)) throw new HttpError(400, "invalid_product_id", "invalid productId: an integer of 10 digits at most");
  return BigInt(s).toString();
}
function optUrl(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || v.length > 200) {
    throw new HttpError(400, "invalid_enclave_url", "invalid enclaveUrl: an http(s) address of 200 characters at most", { params: { max: 200 } });
  }
  let u: URL;
  try { u = new URL(v); } catch { throw new HttpError(400, "unreadable_enclave_url", "invalid enclaveUrl: unreadable address"); }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) {
    throw new HttpError(400, "enclave_url_scheme", "invalid enclaveUrl: http:// or https://, without credentials");
  }
  return v;
}

const bodyTooLarge = () => errorBody("body_too_large", `request body too large (${BODY_MAX / 1024} KiB at most)`, { maxKiB: BODY_MAX / 1024 });
async function readJson(c: Context): Promise<any> {
  try {
    const b = await c.req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? b : {};
  } catch (e: any) {
    if (e?.name === "BodyLimitError" || /payload too large/i.test(String(e?.message))) {
      const b = bodyTooLarge();
      throw new HttpError(413, b.code, b.error, { params: b.params });
    }
    return {};
  }
}

// ---------------------------------------------------------------- client IP and rate

function isPrivatePeer(a: string): boolean {
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;
  if (isIP(v4) === 4) {
    const [x, y] = v4.split(".").map(Number) as [number, number];
    return x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
  }
  return a === "::1" || /^f[cd][0-9a-f]{2}:/i.test(a);
}
/** IPv4 as is; IPv6 reduced to its /64 (an IPv6 machine often has the whole prefix) */
function ipKey(raw: string): string {
  const ip = raw.replace(/%.*$/, "");
  const v4 = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) return v4;
  if (isIP(ip) !== 6) return "unknown";
  const [head, tail] = ip.toLowerCase().split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const groups = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
/** The client's IP: the last entry of X-Forwarded-For (set by Caddy, which does not pass on the client's own),
 *  only if the connection comes from the internal network (Caddy); otherwise the connection's own address. */
export function clientIp(c: Context): string {
  const peer = String((c.env as any)?.incoming?.socket?.remoteAddress ?? "");
  let ip = peer;
  const xff = c.req.header("x-forwarded-for");
  if (xff && (!peer || isPrivatePeer(peer))) {
    const last = xff.split(",").map((s) => s.trim()).filter(Boolean).pop() ?? "";
    if (isIP(last.replace(/%.*$/, ""))) ip = last;
  }
  return ipKey(ip);
}
/** The network of an IP (as clientIp returns it): /24 in IPv4, /48 in IPv6 (a provider gives at least that much to
 *  a single customer). Wrong codes and pending pairings are counted there too. */
export function netOf(ipk: string): string {
  if (isIP(ipk) === 4) return ipk.split(".").slice(0, 3).join(".") + ".0/24";
  const g = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):/.exec(ipk);
  return g ? `${g[1]}:${g[2]}:${g[3]}::/48` : ipk;
}

/** The key (drawn at startup, in memory only) that spreads the rate keys over the shared table. */
const LIMIT_KEY = randomBytes(32);
const SHARED_SLOTS = 1 << 16;

/** Rate per fixed one-minute window, per key (IP, network, account, operator key). Exact for the first `maxKeys` keys
 *  of the minute; beyond that (a flood of different addresses, for example thousands of IPv6 /64s), a NEW key counts
 *  in a fixed table of 65,536 slots, chosen by an HMAC with a secret key: nothing grows, and nobody is refused
 *  outright (the old table, once full, refused every new address for a minute). Two keys in the same slot share
 *  their budget: rare, and impossible to aim at without the hash key. */
export class Limiter {
  private exact = new Map<string, { t: number; n: number }>();
  private sharedT: Float64Array | null = null;
  private sharedN: Uint32Array | null = null;
  private sweptAt = 0;
  constructor(readonly limit: number, readonly windowMs = 60_000, readonly maxKeys = 50_000) {}
  private slot(key: string): number {
    return createHmac("sha256", LIMIT_KEY).update(key).digest().readUInt32BE(0) % SHARED_SLOTS;
  }
  private live(key: string, now: number) {
    const b = this.exact.get(key);
    if (b && now - b.t >= this.windowMs) { this.exact.delete(key); return undefined; }
    return b;
  }
  /** counts one pass; false above the limit */
  take(key: string, now = Date.now()): boolean {
    let b = this.live(key, now);
    if (!b) {
      if (this.exact.size >= this.maxKeys) this.sweep(now, false);
      if (this.exact.size >= this.maxKeys) {
        const i = this.slot(key);
        const t = (this.sharedT ??= new Float64Array(SHARED_SLOTS));
        const n = (this.sharedN ??= new Uint32Array(SHARED_SLOTS));
        if (now - t[i]! >= this.windowMs) { t[i] = now; n[i] = 0; }
        if (n[i]! <= this.limit) n[i] = n[i]! + 1;
        return n[i]! <= this.limit;
      }
      b = { t: now, n: 0 };
      this.exact.set(key, b);
    }
    if (b.n <= this.limit) b.n++;
    return b.n <= this.limit;
  }
  /** what `key` counted in its current minute */
  count(key: string, now = Date.now()): number {
    const b = this.live(key, now);
    if (b) return b.n;
    if (!this.sharedT || !this.sharedN) return 0;
    const i = this.slot(key);
    return now - this.sharedT[i]! >= this.windowMs ? 0 : this.sharedN[i]!;
  }
  /** seconds before the end of `key`'s current minute */
  retryAfter(key: string, now = Date.now()): number {
    const b = this.live(key, now);
    const t = b ? b.t : this.sharedT ? this.sharedT[this.slot(key)]! : now;
    return Math.max(1, Math.ceil((t + this.windowMs - now) / 1000));
  }
  /** erases finished minutes; outside the periodic purge (`force`), at most once per second: under a flood, the
   *   full table does not cost a complete scan on every request */
  sweep(now = Date.now(), force = true) {
    if (!force && now - this.sweptAt < 1_000) return;
    this.sweptAt = now;
    for (const [k, b] of this.exact) if (now - b.t >= this.windowMs) this.exact.delete(k);
  }
}
const lim = {
  pairStart: new Limiter(RATE.pairStart), pairLookup: new Limiter(RATE.pairLookup), pairPoll: new Limiter(RATE.pairPoll),
  signed: new Limiter(RATE.signed), signedRead: new Limiter(RATE.signedRead), nonce: new Limiter(RATE.nonce),
  keyList: new Limiter(RATE.keyList), heartbeatIp: new Limiter(RATE.heartbeatIp), heartbeatKey: new Limiter(RATE.heartbeatKey),
  badSignatures: new Limiter(BAD_SIGNATURES_PER_IP),
  accountSigned: new Limiter(ACCOUNT_RATE.signed), accountReadOpen: new Limiter(ACCOUNT_RATE.readOpen), accountRead: new Limiter(ACCOUNT_RATE.read),
  fails: new Limiter(FAILS_PER_NET),
};
/** What a refused rate counts: a stable identifier (params.scope of the "rate_limited" error) and its label
 *  (in "error"). */
const SCOPE_LABEL = {
  signatures: "signatures", signed_reads: "signed reads", nonce_requests: "nonce requests", code_requests: "code requests",
  code_lookups: "code lookups", pairing_polls: "pairing polls", pairing_refusals: "pairing refusals",
  key_reads: "key reads", heartbeats: "heartbeats", key_heartbeats: "heartbeats for this key",
  account_signatures: "signatures for this account", account_reads: "signed reads for this account",
  account_new_reads: "new signed reads for this account", invalid_signatures: "invalid signatures",
} as const;
export type RateScope = keyof typeof SCOPE_LABEL;
const rateLimited = (scope: RateScope, s: number) =>
  new HttpError(429, "rate_limited", `too many requests (${SCOPE_LABEL[scope]}): try again in ${s} s`, { retryAfter: s, params: { scope, retryAfter: s } });
function limit(l: Limiter, key: string, scope: RateScope) {
  if (!l.take(key)) throw rateLimited(scope, l.retryAfter(key));
}
/** wrong codes: capped per network (/24, /48), never globally */
function guardFails(net: string) {
  if (lim.fails.count(net) >= FAILS_PER_NET) {
    const s = lim.fails.retryAfter(net);
    throw new HttpError(429, "too_many_wrong_codes", `too many wrong codes tried: try again in ${s} s`, { retryAfter: s, params: { retryAfter: s } });
  }
}
const ipTag = (ip: string) => sha("archive-ip:" + ip).slice(0, 16);
const netTag = (net: string) => sha("archive-net:" + net).slice(0, 16);

// ---------------------------------------------------------------- operator keys

function newKey(operator: string, label: string, machineId: string | null): { key: string; rec: Key } {
  let keyId = randomBytes(4).toString("hex");
  while (db.keys[keyId]) keyId = randomBytes(4).toString("hex");
  const secret = b64url(randomBytes(24));
  const rec: Key = { keyId, hash: sha(secret), operator, label, machineId, createdAt: Date.now(), lastUsedAt: null, revoked: false };
  db.keys[keyId] = rec;
  return { key: `arcop_${keyId}_${secret}`, rec };
}

function bearer(auth?: string | null): Key {
  const m = (auth ?? "").match(/^Bearer\s+arcop_([0-9a-f]{8})_([A-Za-z0-9_-]{16,64})$/);
  if (!m) throw new HttpError(401, "key_missing", "operator key missing or malformed (expected: Authorization: Bearer arcop_…)");
  const rec = db.keys[m[1]!];
  if (!rec || rec.revoked) throw new HttpError(401, "key_unknown_or_revoked", "unknown or revoked operator key");
  const a = Buffer.from(sha(m[2]!)), b = Buffer.from(rec.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "key_invalid", "invalid operator key");
  rec.lastUsedAt = Date.now();
  save(false);
  return rec;
}

const activeKeys = () => Object.values(db.keys).filter((k) => !k.revoked);
function revoke(k: Key) { if (!k.revoked) { k.revoked = true; k.revokedAt = Date.now(); } }
/** above LIMITS.revokedKeptPerOperator revoked keys, the oldest are erased */
function pruneRevoked(operator: string) {
  const old = Object.values(db.keys).filter((k) => k.operator === operator && k.revoked)
    .sort((x, y) => (y.revokedAt ?? y.createdAt) - (x.revokedAt ?? x.createdAt));
  for (const k of old.slice(LIMITS.revokedKeptPerOperator)) delete db.keys[k.keyId];
}

// ---------------------------------------------------------------- messages signed by the wallet (EIP-4361)

/** The sites that ask for signatures: WEB_URL (the public site), plus SIGN_ORIGINS for development (comma-separated
 *  origins, for example http://localhost:5173). A message's domain ("archive.62-171-153-35.sslip.io") and URI
 *  ("https://archive.62-171-153-35.sslip.io") come from the same site. */
const ORIGINS: Array<{ domain: string; uri: string }> = (() => {
  const out: Array<{ domain: string; uri: string }> = [];
  for (const raw of [WEB_URL, ...String(process.env.SIGN_ORIGINS ?? "").split(",")]) {
    const s = raw.trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if ((u.protocol === "https:" || u.protocol === "http:") && !out.some((o) => o.domain === u.host)) out.push({ domain: u.host, uri: u.origin });
    } catch { console.error(`operators: unreadable signing origin ignored ("${s.slice(0, 80)}")`); }
  }
  if (!out.length) out.push({ domain: "archive.62-171-153-35.sslip.io", uri: "https://archive.62-171-153-35.sslip.io" });
  return out;
})();
/** the signatures' network: Arc testnet (5042002) */
const CHAIN_ID: number = arcTestnet.id;

/** The sentence of each signature (the "statement" line of EIP-4361), in English: it is read in the wallet.
 *  In ASCII: that is EIP-4361's grammar, and a wallet only checks the domain of a message it can read. The
 *  site writes exactly the same ones (web/src/signin.ts; services/api/test/security.test.ts checks that they match).
 *  All start with STATEMENT_PREFIX (test mode signs only these messages). */
export const STATEMENT_PREFIX = "ArcHive: ";
export const STATEMENT = {
  pair: (code: string) => `${STATEMENT_PREFIX}pair the machine showing code ${code} with my account`,
  createKey: () => `${STATEMENT_PREFIX}create an operator key (arcop_) that cannot spend funds`,
  revokeKey: (keyId: string) => `${STATEMENT_PREFIX}revoke operator key arcop_${keyId}`,
  removeMachine: (machineId: string) => `${STATEMENT_PREFIX}remove machine ${machineId} from my account (its key is revoked)`,
  read: () => `${STATEMENT_PREFIX}read my operator data for 10 minutes (diagnostics, logs, machine and key names)`,
} as const;
/** what EIP-4361's grammar allows in "statement": ASCII letters and digits, space, URI punctuation */
const STATEMENT_CHARS = /^[A-Za-z0-9 :/?#[\]@!$&'()*+,;=._~-]{1,200}$/;
const RFC3339 = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

/** Nonces WITHOUT a table: nonce = issue time (12 hex, ms) + randomness (16 hex) + HMAC-SHA-256 truncated to 128 bits
 *  (32 hex) of those two fields, under a key drawn at startup and kept in memory only. 60 alphanumeric characters
 *  (EIP-4361's grammar). The API checks it without storing anything; a restart invalidates the nonces in circulation
 *  (5 minutes at most: the site asks for a new one). */
const NONCE_KEY = randomBytes(32);
const NONCE_RE = /^([0-9a-f]{12})([0-9a-f]{16})([0-9a-f]{32})$/;
const nonceMac = (t: string, r: string) => createHmac("sha256", NONCE_KEY).update(`archive-nonce/1/${t}/${r}`).digest().subarray(0, 16);
function issueNonce(now: number): string {
  const t = now.toString(16).padStart(12, "0");
  const r = randomBytes(8).toString("hex");
  return t + r + nonceMac(t, r).toString("hex");
}
/** A nonce issued here: its issue time and its key in the list of consumed nonces; null otherwise (shape, or HMAC
 *  compared in constant time). The key is a new short string: it does not keep the signed message in memory. */
function openNonce(nonce: string): { issuedAt: number; id: string } | null {
  const m = NONCE_RE.exec(nonce);
  if (!m || !timingSafeEqual(nonceMac(m[1]!, m[2]!), Buffer.from(m[3]!, "hex"))) return null;
  return { issuedAt: parseInt(m[1]!, 16), id: Buffer.from(m[1]! + m[2]!, "hex").toString("base64") };
}

/** The CONSUMED nonces, the only ones kept: until the nonce's expiry, or that of the read it opened if later (after
 *  which the nonce and the message are refused by themselves). For a read: the fingerprint of the (address, message)
 *  it opened, and that of the signature already verified (the same one, presented again during the 10 minutes, is not
 *  verified again: the list and the detail are read again every 10 to 15 s). */
const consumed = new Map<string, { until: number; read?: string; sig?: string }>();
const digest16 = (s: string) => createHash("sha256").update(s).digest().subarray(0, 16).toString("base64");
const readSessionOf = (address: string, message: string) => digest16(address.toLowerCase() + "\n" + message);

let signInsSweptAt = 0;
/** erases expired consumed nonces; outside the periodic purge (`force`), at most once per second */
function sweepSignIns(now = Date.now(), force = true) {
  if (!force && now - signInsSweptAt < 1_000) return;
  signInsSweptAt = now;
  for (const [k, v] of consumed) if (v.until < now) consumed.delete(k);
}

/** "malformed signed message: …": code "malformed_message", the faulty part in params.part (format, header,
 *  blank_lines, uri, version, nonce, time, expiry_window) and its values */
const malformed = (part: string, detail: string, params: Params = {}) =>
  new HttpError(400, "malformed_message", `malformed signed message: ${detail}`, { params: { part, ...params } });

function timeLine(line: string, label: string): number {
  const v = line.startsWith(`${label}: `) ? line.slice(label.length + 2) : "";
  const t = RFC3339.test(v) ? Date.parse(v) : NaN;
  if (!Number.isFinite(t)) throw malformed("time", `line "${label}: <RFC 3339 date>" expected (for example 2026-11-13T18:00:00.000Z)`, { line: label });
  return t;
}

/** Reads an EIP-4361 message line by line and checks everything that does not depend on the action or the nonce:
 *  "<domain> wants you to sign in with your Ethereum account:" / EIP-55 address / "" / statement / "" / "URI: …" /
 *  "Version: 1" / "Chain ID: 5042002" / "Nonce: …" / "Issued At: …" / "Expiration Time: …"; nothing else. */
function readSignIn(message: string, address: string) {
  const l = message.split("\n");
  if (l.length !== 11) {
    throw malformed("format", "the site's EIP-4361 (\"Sign-In with Ethereum\") format is expected, in 11 lines; reload the page and sign again", { lines: 11 });
  }
  const dm = /^(\S{1,253}) wants you to sign in with your Ethereum account:$/.exec(l[0]!);
  if (!dm) throw malformed("header", "first line \"<site> wants you to sign in with your Ethereum account:\" expected");
  const origin = ORIGINS.find((o) => o.domain === dm[1]);
  if (!origin) {
    const site = dm[1]!.slice(0, 80), expected = ORIGINS[0]!.domain;
    throw new HttpError(400, "wrong_site", `message signed for another site ("${site}"): ArcHive accepts only ${expected}. Sign ArcHive messages on this site only.`, { params: { site, expected } });
  }
  if (l[1] !== getAddress(address)) throw new HttpError(400, "address_mismatch", "the message's address does not match the wallet's (expected in full, with its EIP-55 case)");
  if (l[2] !== "" || l[4] !== "") throw malformed("blank_lines", "a blank line is expected before and after the action's statement");
  if (l[5] !== `URI: ${origin.uri}`) throw malformed("uri", `line "URI: ${origin.uri}" expected`, { uri: origin.uri });
  if (l[6] !== "Version: 1") throw malformed("version", "line \"Version: 1\" expected");
  if (l[7] !== `Chain ID: ${CHAIN_ID}`) {
    throw new HttpError(400, "wrong_chain", `message signed for another network: line "Chain ID: ${CHAIN_ID}" (Arc testnet) expected`, { params: { chainId: CHAIN_ID } });
  }
  const nm = /^Nonce: ([A-Za-z0-9]{8,64})$/.exec(l[8]!);
  if (!nm) throw malformed("nonce", "line \"Nonce: <nonce from GET /auth/nonce>\" expected");
  return { statement: l[3]!, nonce: nm[1]!, issuedAt: timeLine(l[9]!, "Issued At"), expiresAt: timeLine(l[10]!, "Expiration Time") };
}

/** For the test-mode wallet (testSigner.ts): the message's statement if it is an ArcHive sign-in (EIP-4361) for one
 *  of our sites, in the name of `address`, with a nonce issued here, neither used nor expired, and a lifetime of 10
 *  minutes at most; null otherwise. It commits to nothing: the route that receives the signature redoes every check. */
export function arcHiveSignInStatement(text: string, address: string): string | null {
  try {
    if (text.length > 2000) return null;
    const now = Date.now();
    const m = readSignIn(text, address);
    if (!m.statement.startsWith(STATEMENT_PREFIX) || !STATEMENT_CHARS.test(m.statement)) return null;
    const n = openNonce(m.nonce);
    if (!n || consumed.has(n.id) || now > n.issuedAt + NONCE_TTL_MS || n.issuedAt > now + CLOCK_SKEW_MS) return null;
    if (m.issuedAt < n.issuedAt - CLOCK_SKEW_MS || m.issuedAt > now + CLOCK_SKEW_MS) return null;
    if (m.expiresAt <= now || m.expiresAt <= m.issuedAt || m.expiresAt - m.issuedAt > READ_TTL_MS) return null;
    return m.statement;
  } catch { return null; }
}

/** code at an address (ERC-1271 smart wallet), cached for 10 min; a failing RPC is NOT cached (otherwise a smart
 *  wallet would be refused for 10 minutes after a passing outage) */
const codeCache = new Map<string, { t: number; v: boolean }>();
async function hasCode(pub: PublicClient, a: Address): Promise<boolean> {
  const k = a.toLowerCase();
  const hit = codeCache.get(k);
  if (hit && Date.now() - hit.t < 10 * 60_000) return hit.v;
  let code: Hex | undefined;
  try { code = await pub.getCode({ address: a }); } catch { return false; }
  const v = !!code && code !== "0x";
  if (codeCache.size > 10_000) codeCache.clear();
  codeCache.set(k, { t: Date.now(), v });
  return v;
}
/** EOA: local check (no RPC call); smart wallet (code at the address, or an ERC-6492 signature): through the RPC */
async function verifySignature(pub: PublicClient, address: Address, message: string, signature: Hex): Promise<boolean> {
  if (signature.length === 132) {
    try {
      const rec = await recoverMessageAddress({ message, signature });
      if (rec.toLowerCase() === address.toLowerCase()) return true;
    } catch { /* malformed signature: only a smart wallet can still validate it */ }
    if (!(await hasCode(pub, address))) return false;
  }
  try { return await pub.verifyMessage({ address, message, signature }); } catch { return false; }
}

/** What a route expects from a signature: the exact statement of its action; `read` for the reserved read, which
 *  the same signature opens for its 10 minutes (its nonce serves only once: at first use). */
type Expect = { statement: string; read?: boolean };

const spentError = () => new HttpError(409, "signature_used", "signature already used (its nonce has served): sign again");

/** The wallet's signature on an EIP-4361 message built by the site, checked LINE BY LINE (readSignIn), then: the
 *  action's statement, the expiry (5 min for an action, 10 for the read), the nonce (issued here, used once, within
 *  5 minutes), "Issued At" (not before the nonce was issued, not in the future), and finally the signature (EOA
 *  locally; ERC-1271 or ERC-6492 smart wallet through the RPC). Cost: everything before the verification is free (text,
 *  HMAC, table); a failed verification counts per IP (`ip`), a successful one per account, before the nonce is consumed.
 *  Returns the address (lower case). */
async function walletAuth(pub: PublicClient, body: any, want: Expect, ip: string): Promise<string> {
  const { address, message, signature } = body ?? {};
  if (typeof address !== "string" || typeof message !== "string" || typeof signature !== "string") {
    throw new HttpError(400, "signed_body_expected", "expected { address, message, signature }");
  }
  if (!ADDR_RE.test(address)) throw new HttpError(400, "invalid_address", "invalid address (0x + 40 hex characters)");
  if (message.length > 2000 || !/^0x[0-9a-fA-F]+$/.test(signature) || signature.length < 132 || signature.length > 20_000 || signature.length % 2) {
    throw new HttpError(400, "bad_message_or_signature", "malformed message or signature");
  }
  const now = Date.now();
  const m = readSignIn(message, address);
  if (m.statement !== want.statement) {
    throw new HttpError(400, "wrong_statement", `unexpected signed message: this action needs the statement "${want.statement}"`, { params: { statement: want.statement } });
  }
  if (m.expiresAt <= now) throw new HttpError(401, "signature_expired", "signature expired: sign again");
  const life = want.read ? READ_TTL_MS : ACTION_TTL_MS;
  if (m.expiresAt <= m.issuedAt || m.expiresAt - m.issuedAt > life) {
    throw malformed("expiry_window", `"Expiration Time" must follow "Issued At" by ${life / 60_000} minutes at most`, { minutes: life / 60_000 });
  }
  const n = openNonce(m.nonce);
  if (!n || n.issuedAt > now + CLOCK_SKEW_MS) {
    throw new HttpError(401, "nonce_unknown", "unknown or expired nonce: sign again (the site asks for a fresh nonce for each signature)");
  }
  // a read already opened by this same message (its nonce served at first use) is valid until its expiry
  const session = want.read ? readSessionOf(address, message) : undefined;
  const sig = digest16(signature.toLowerCase());
  const spent = consumed.get(n.id);
  const reuse = !!spent && !!session && spent.read === session;
  if (spent && !reuse) throw spentError();
  if (!reuse) {
    if (now > n.issuedAt + NONCE_TTL_MS) {
      const minutes = NONCE_TTL_MS / 60_000;
      throw new HttpError(401, "nonce_expired", `nonce expired (it serves within ${minutes} minutes of its issue): sign again`, { params: { minutes } });
    }
    if (m.issuedAt < n.issuedAt - CLOCK_SKEW_MS || m.issuedAt > now + CLOCK_SKEW_MS) {
      throw new HttpError(400, "issued_at_mismatch", "\"Issued At\" does not match the nonce's issue time: reuse the time GET /auth/nonce returned");
    }
  }
  // the verification costs (≈ 2 ms of processor time, or the RPC): skipped for this read's already verified signature,
  // refused outright to an IP that already presented too many invalid signatures in the minute
  if (!(reuse && spent.sig === sig)) {
    if (lim.badSignatures.count(ip) >= BAD_SIGNATURES_PER_IP) throw rateLimited("invalid_signatures", lim.badSignatures.retryAfter(ip));
    if (!(await verifySignature(pub, address as Address, message, signature as Hex))) {
      lim.badSignatures.take(ip);
      throw new HttpError(401, "bad_signature", "invalid signature");
    }
  }
  const operator = address.toLowerCase();
  // read again AFTER waiting for the verification: of two simultaneous requests carrying the same message, only one consumes the nonce
  const now2 = Date.now();
  const again = consumed.get(n.id);
  if (again) {
    if (!(session && again.read === session)) throw spentError();
    limit(lim.accountRead, operator, "account_reads");
    return operator;
  }
  // first use: the account's caps (valid signatures only), THEN the nonce is consumed (a refusal for the rate does not
  // burn the signature: it can serve again in the next minute, before its expiry)
  if (session) {
    limit(lim.accountRead, operator, "account_reads");
    limit(lim.accountReadOpen, operator, "account_new_reads");
  } else limit(lim.accountSigned, operator, "account_signatures");
  if (consumed.size >= LIMITS.consumedTotal) {
    sweepSignIns(now2, false);
    if (consumed.size >= LIMITS.consumedTotal) {
      throw new HttpError(503, "signatures_full", "too many signatures pending: try again in a minute", { retryAfter: 60 });
    }
  }
  consumed.set(n.id, { until: Math.max(n.issuedAt + NONCE_TTL_MS, m.expiresAt), ...(session ? { read: session, sig } : {}) });
  return operator;
}

// ---------------------------------------------------------------- machine views

const regCache = new Map<string, { t: number; v: boolean }>();
async function isRegistered(arc: ArcClient, m: Machine): Promise<boolean> {
  if (!m.signer) return false;
  const k = `${m.signer}:${m.operator}`;
  const hit = regCache.get(k);
  if (hit && Date.now() - hit.t < 30_000) return hit.v;
  let v = false;
  try {
    // registered = active for its product at the head block, for THIS operator (validity is counted in blocks)
    const e = await arc.getEnclave(m.signer as Address);
    if (e && e.signer !== "0x0000000000000000000000000000000000000000") {
      const op = await arc.activeOperatorAt(m.signer as Address, BigInt(e.productId));
      v = String(op).toLowerCase() === m.operator;
    }
  } catch { v = false; }
  regCache.set(k, { t: Date.now(), v });
  return v;
}

const isOnline = (m: Machine) => !!m.lastSeen && Date.now() - m.lastSeen < 90_000;
const failingOf = (m: Machine) => (m.doctor?.checks ?? []).filter((x) => !x.ok).map((x) => x.id);
/** What everyone sees: the useful state, without a machine name, an http://IP address, logs or details. */
function publicView(m: Machine, registered: boolean) {
  return {
    machineId: m.machineId, operator: m.operator, hostname: `machine ${m.machineId.slice(0, 8)}`, hostnameHidden: true,
    mode: m.mode, version: m.version, productId: m.productId,
    enclaveUrl: m.enclaveUrl && m.enclaveUrl.startsWith("https://") ? m.enclaveUrl : null,
    signer: m.signer, status: m.status, online: isOnline(m), lastSeen: m.lastSeen, createdAt: m.createdAt,
    doctorOk: m.doctor?.ok ?? null, failing: failingOf(m), registered, restricted: true,
    // explicit provenance (null: a machine from before this field); the approving address is the account's
    pairedBy: m.pairedBy ?? null, approvedBy: m.approvedBy ?? null, viaKey: m.viaKey ?? null, pairedAt: m.pairedAt ?? null,
  };
}
/** What the operator sees in their list (without the logs) */
function ownerListView(m: Machine, registered: boolean) {
  return { ...publicView(m, registered), hostname: m.hostname, hostnameHidden: false, enclaveUrl: m.enclaveUrl, x25519: m.x25519, restricted: false };
}
/** The full detail, for the operator alone: diagnosis and logs */
function ownerDetailView(m: Machine, registered: boolean) {
  return { ...ownerListView(m, registered), doctor: m.doctor, logs: logsOf.get(m.machineId) ?? [] };
}

type Reader = { operator: string; machineId: string | null };
/** an arcop_ key in Authorization (optional); a key present but wrong → 401 */
function readerFromBearer(c: Context): Reader | null {
  const h = c.req.header("authorization");
  if (!h) return null;
  const k = bearer(h);
  return { operator: k.operator, machineId: k.machineId };
}
/** a machine key reads only ITS machine; a free key reads all of its operator's machines */
const canRead = (r: Reader | null, m: Machine) => !!r && r.operator === m.operator && (!r.machineId || r.machineId === m.machineId);

const machinesOf = (op: string) => Object.values(db.machines).filter((m) => m.operator === op);
const pendingByCode = (code: string, now = Date.now()) =>
  Object.values(db.pairs).find((p) => p.userCode === code && p.status === "pending" && p.expiresAt > now);

/** this code's pairing (already approved or served, not expired yet), if there is one */
const takenByCode = (code: string, now = Date.now()) =>
  Object.values(db.pairs).find((p) => p.userCode === code && p.status !== "pending" && p.expiresAt > now);
const codeUnknown = () => new HttpError(404, "code_unknown", "unknown or expired code: run \"archive-node pair\" again on the machine");
const machineNotFound = () => new HttpError(404, "machine_not_found", "unknown machine for this address");
const machineLimit = () => new HttpError(409, "machine_limit",
  `limit of ${LIMITS.machinesPerOperator} machines per operator reached: remove one on the Operator page`, { params: { max: LIMITS.machinesPerOperator } });

function keyView(k: Key, full: boolean) {
  const { hash: _h, ...rest } = k;
  return full ? { ...rest, restricted: false } : { ...rest, label: k.machineId ? "machine key" : "free key (CLI, MCP)", restricted: true };
}
const keysOf = (op: string) => Object.values(db.keys).filter((k) => k.operator === op).sort((x, y) => y.createdAt - x.createdAt);

// ---------------------------------------------------------------- purge

/** Expired pairings (any status) are erased. An approval never handed to the machine: its key is revoked and the
 *  machine, never seen, is removed (keyPlain does not stay on disk). */
function purge(now = Date.now()) {
  let changed = false;
  for (const [dc, p] of Object.entries(db.pairs)) {
    if (now <= p.expiresAt + PAIR_PURGE_GRACE_MS) continue;
    if (p.status === "approved" && p.keyPlain && p.machineId) {
      for (const k of Object.values(db.keys)) if (k.machineId === p.machineId) revoke(k);
      const m = db.machines[p.machineId];
      if (m && !m.lastSeen) { delete db.machines[p.machineId]; logsOf.delete(p.machineId); }
    }
    delete db.pairs[dc];
    changed = true;
  }
  sweepSignIns(now);
  for (const [k, v] of regCache) if (now - v.t > 5 * 60_000) regCache.delete(k);
  for (const l of Object.values(lim)) l.sweep(now);
  if (changed) save();
}

// ---------------------------------------------------------------- routes

export function registerOperatorRoutes(app: Hono, arc: ArcClient) {
  const pub = arc.pub as PublicClient;
  const wrap = (fn: (c: Context) => Promise<Response>) => async (c: Context) => {
    try { return await fn(c); } catch (e: any) {
      if (e instanceof HttpError) {
        if (e.retryAfter) c.header("Retry-After", String(e.retryAfter));
        return c.json(errorBody(e.code, e.message, e.params), e.status as any);
      }
      console.error("operators:", String(e?.stack ?? e).slice(0, 400));
      return c.json(errorBody("internal_error", "internal error of the operators API"), 500);
    }
  };
  const tooBig = (c: Context) => c.json(bodyTooLarge(), 413);
  for (const p of ["/pair/*", "/operator/*", "/machines/*"]) app.use(p, bodyLimit({ maxSize: BODY_MAX, onError: tooBig }));

  purge(); // at startup
  setInterval(() => purge(), 60_000).unref();

  // ---- signed sign-in (EIP-4361): a new nonce for each wallet signature ----
  // The issue time is returned as is: the site reuses it in "Issued At" (no clock drift possible).
  // Nothing is stored here: the nonce carries its own proof (HMAC); only its use will be.
  app.get("/auth/nonce", wrap(async (c) => {
    limit(lim.nonce, clientIp(c), "nonce_requests");
    const now = Date.now();
    const nonce = issueNonce(now);
    c.header("Cache-Control", "no-store");
    const o = ORIGINS[0]!;
    return c.json({
      nonce, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + NONCE_TTL_MS).toISOString(),
      domain: o.domain, uri: o.uri, chainId: CHAIN_ID, version: "1",
      expirationMinutes: { action: ACTION_TTL_MS / 60_000, read: READ_TTL_MS / 60_000 },
    });
  }));

  // ---- pairing by code ("device" flow) ----
  app.post("/pair/start", wrap(async (c) => {
    const ip = clientIp(c);
    limit(lim.pairStart, ip, "code_requests");
    const b = await readJson(c);
    const hostname = cleanHostname(b.hostname);
    const mode = enumOf(b.mode ?? "demo", MODES, "mode");
    const version = cleanVersion(b.version);
    const now = Date.now();
    const pending = Object.values(db.pairs).filter((p) => p.status === "pending" && p.expiresAt > now);
    if (pending.length >= LIMITS.pendingPairsTotal) {
      throw new HttpError(503, "pairings_full", "too many pairings in progress: try again in a few minutes", { retryAfter: 60 });
    }
    const tag = ipTag(ip), ntag = netTag(netOf(ip));
    const ttlMin = PAIR_TTL_MS / 60_000;
    if (pending.filter((p) => p.ip === tag).length >= LIMITS.pendingPairsPerIp) {
      throw new HttpError(429, "pairings_per_ip", `already ${LIMITS.pendingPairsPerIp} pairings in progress from this address: finish one or wait for it to expire (${ttlMin} min)`,
        { retryAfter: 60, params: { max: LIMITS.pendingPairsPerIp, minutes: ttlMin } });
    }
    if (pending.filter((p) => p.net === ntag).length >= LIMITS.pendingPairsPerNet) {
      throw new HttpError(429, "pairings_per_network", `already ${LIMITS.pendingPairsPerNet} pairings in progress from this network: finish one or wait for it to expire (${ttlMin} min)`,
        { retryAfter: 60, params: { max: LIMITS.pendingPairsPerNet, minutes: ttlMin } });
    }
    let code = newUserCode();
    for (let tries = 1; pendingByCode(code, now); tries++) {
      if (tries >= 8) throw new HttpError(503, "no_free_code", "no free code: try again");
      code = newUserCode();
    }
    const deviceCode = randomBytes(16).toString("hex");
    db.pairs[deviceCode] = { deviceCode, userCode: code, hostname, mode, version, createdAt: now, expiresAt: now + PAIR_TTL_MS, status: "pending", ip: tag, net: ntag };
    save();
    // "#/operator": the English route (an alias of the site), read as is in the operator's terminal
    return c.json({ deviceCode, userCode: code, verifyUrl: `${WEB_URL}/#/operator?code=${code}`, expiresIn: PAIR_TTL_MS / 1000, interval: 3 });
  }));

  // the site checks that a code exists; the machine's name is given only after the signature (answer of /pair/approve)
  app.get("/pair/:code", wrap(async (c) => {
    const ip = clientIp(c), net = netOf(ip);
    limit(lim.pairLookup, ip, "code_lookups");
    guardFails(net);
    const code = normCode(c.req.param("code"));
    const p = code ? pendingByCode(code) : undefined;
    if (!p) {
      lim.fails.take(net);
      throw codeUnknown();
    }
    return c.json({ userCode: p.userCode, hostname: HIDDEN_NAME, hostnameHidden: true, mode: p.mode, version: "", expiresAt: p.expiresAt });
  }));

  app.post("/pair/approve", wrap(async (c) => {
    const ip = clientIp(c), net = netOf(ip);
    limit(lim.signed, ip, "signatures");
    guardFails(net);
    const b = await readJson(c);
    const raw = typeof b.userCode === "string" ? b.userCode.trim() : "";
    if (!raw || raw.length > 32) throw new HttpError(400, "user_code_expected", "userCode expected (the code the machine shows)");
    const code = normCode(raw);
    if (!code) {
      lim.fails.take(net);
      throw codeUnknown();
    }
    // the signature names THE code (normalized form HIVE-XXXX-XXXX): it approves no other machine
    const operator = await walletAuth(pub, b, { statement: STATEMENT.pair(code) }, ip);
    const p = pendingByCode(code);
    if (!p) {
      // already approved (not expired yet): by ANOTHER account (409, the machine will show its address: refuse it there),
      // or by this account (another tab, a double send); otherwise unknown or expired (404, counted as a wrong code).
      // Only the signer of a message that names THIS code learns it: the difference reveals no code to guess.
      const taken = takenByCode(code);
      if (taken?.operator && taken.operator !== operator) {
        throw new HttpError(409, "pair_already_approved", "this code was just approved by another account: run \"archive-node pair\" again on the machine and check the address it shows");
      }
      if (taken?.operator === operator) {
        throw new HttpError(409, "pair_already_yours", "you already approved this code: the machine shows your address and asks for confirmation");
      }
      lim.fails.take(net);
      throw codeUnknown();
    }
    if (machinesOf(operator).length >= LIMITS.machinesPerOperator) throw machineLimit();
    if (Object.keys(db.machines).length >= LIMITS.machinesTotal || activeKeys().length >= LIMITS.keysTotal) {
      throw new HttpError(503, "network_full_machines", "the network accepts no new machine for now: try again later");
    }
    const machineId = randomUUID();
    const now = Date.now();
    db.machines[machineId] = {
      machineId, operator, hostname: p.hostname, mode: p.mode, version: p.version, productId: null, enclaveUrl: null,
      signer: null, x25519: null, status: "paired", doctor: null, lastSeen: null, createdAt: now,
      pairedBy: "code", approvedBy: operator, viaKey: null, pairedAt: now,
    };
    const { key } = newKey(operator, `machine ${p.hostname}`, machineId);
    Object.assign(p, { status: "approved", operator, machineId, keyPlain: key });
    save();
    return c.json({ ok: true, machineId, hostname: p.hostname });
  }));

  app.post("/pair/poll", wrap(async (c) => {
    limit(lim.pairPoll, clientIp(c), "pairing_polls");
    const b = await readJson(c);
    const dc = typeof b.deviceCode === "string" ? b.deviceCode : "";
    const p = /^[0-9a-f]{32}$/.test(dc) ? db.pairs[dc] : undefined;
    if (!p) throw new HttpError(404, "device_code_unknown", "unknown deviceCode");
    if (p.status === "pending") return c.json({ status: p.expiresAt > Date.now() ? "pending" : "expired" });
    if (p.status === "consumed" || !p.keyPlain) return c.json({ status: "consumed" });
    const key = p.keyPlain;
    p.keyPlain = undefined; p.status = "consumed"; save(); // the key leaves only ONCE
    return c.json({ status: "approved", key, machineId: p.machineId, operator: p.operator });
  }));

  // The machine refuses the pairing: the person, shown the full address of the account that approved their code,
  // answered "no" (it is not their wallet). Its key dies, and the machine, never seen, leaves the account that approved it.
  app.post("/pair/reject", wrap(async (c) => {
    limit(lim.signed, clientIp(c), "pairing_refusals");
    const k = bearer(c.req.header("authorization"));
    if (!k.machineId) throw new HttpError(400, "not_a_machine_key", "only the key of a machine paired by code can refuse its pairing");
    revoke(k);
    const m = db.machines[k.machineId];
    if (m && !m.lastSeen) { delete db.machines[k.machineId]; logsOf.delete(k.machineId); }
    save();
    return c.json({ ok: true });
  }));

  // ---- operator keys (for the machine, the CLI, the MCP server) ----
  app.post("/operator/keys", wrap(async (c) => {
    const ip = clientIp(c);
    limit(lim.signed, ip, "signatures");
    const b = await readJson(c);
    const operator = await walletAuth(pub, b, { statement: STATEMENT.createKey() }, ip);
    const label = cleanText(b.label ?? "operator key", 48).trim() || "operator key";
    const free = activeKeys().filter((k) => k.operator === operator && !k.machineId).length;
    if (free >= LIMITS.freeKeysPerOperator) {
      throw new HttpError(409, "key_limit", `limit of ${LIMITS.freeKeysPerOperator} active keys per operator reached: revoke one`, { params: { max: LIMITS.freeKeysPerOperator } });
    }
    if (activeKeys().length >= LIMITS.keysTotal) {
      throw new HttpError(503, "network_full_keys", "the network accepts no new key for now: try again later");
    }
    pruneRevoked(operator);
    const { key, rec } = newKey(operator, label, null);
    save();
    return c.json({ key, keyId: rec.keyId, masked: mask(key) });
  }));

  // list: complete with a free arcop_ key of this operator; otherwise without the labels (which can name the machine)
  app.get("/operator/keys", wrap(async (c) => {
    limit(lim.keyList, clientIp(c), "key_reads");
    const a = String(c.req.query("address") ?? "");
    if (!ADDR_RE.test(a)) throw new HttpError(400, "address_param_expected", "address parameter expected (0x + 40 hex characters)");
    const op = a.toLowerCase();
    const r = readerFromBearer(c);
    const full = !!r && r.operator === op && !r.machineId;
    return c.json(keysOf(op).map((k) => keyView(k, full)));
  }));
  // complete list (real labels) with a read signature (the same one opens everything for 10 min)
  app.post("/operator/keys/list", wrap(async (c) => {
    const ip = clientIp(c);
    limit(lim.signedRead, ip, "signed_reads");
    const operator = await walletAuth(pub, await readJson(c), { statement: STATEMENT.read(), read: true }, ip);
    return c.json(keysOf(operator).map((k) => keyView(k, true)));
  }));

  const keyNotFound = () => new HttpError(404, "key_not_found", "unknown key for this address");
  app.post("/operator/keys/:keyId/revoke", wrap(async (c) => {
    const ip = clientIp(c);
    limit(lim.signed, ip, "signatures");
    const keyId = c.req.param("keyId");
    if (!KEYID_RE.test(keyId)) throw keyNotFound();
    const b = await readJson(c);
    const operator = await walletAuth(pub, b, { statement: STATEMENT.revokeKey(keyId) }, ip);
    const k = db.keys[keyId];
    if (!k || k.operator !== operator) throw keyNotFound();
    revoke(k); save();
    return c.json({ ok: true });
  }));

  // ---- machines ----
  app.post("/machines/heartbeat", wrap(async (c) => {
    limit(lim.heartbeatIp, clientIp(c), "heartbeats");
    const key = bearer(c.req.header("authorization"));
    limit(lim.heartbeatKey, key.keyId, "key_heartbeats");
    const b = await readJson(c);
    // strict validation of the typed fields (one wrong field → 400, nothing is saved)
    const hostname = cleanHostname(b.hostname);
    const mode = b.mode === undefined ? undefined : enumOf(b.mode, MODES, "mode");
    const status = enumOf(b.status ?? "running", STATUSES, "status");
    const productId = optProductId(b.productId);
    const enclaveUrl = optUrl(b.enclaveUrl);
    const signer = optHex(b.signer, 40, "signer");
    const x25519 = optHex(b.x25519, 64, "x25519");
    let doctor: Machine["doctor"] | undefined;
    if (b.doctor !== undefined && b.doctor !== null) {
      if (typeof b.doctor !== "object" || !Array.isArray(b.doctor.checks)) throw new HttpError(400, "invalid_doctor", "invalid doctor: expected { checks: [...] }");
      const checks: Check[] = (b.doctor.checks as unknown[]).slice(0, 30)
        .filter((x: any) => x && typeof x === "object" && typeof x.id === "string" && /^[a-z0-9_-]{1,32}$/.test(x.id))
        .map((x: any) => ({ id: x.id, label: cleanText(x.label, 80), ok: x.ok === true, detail: cleanText(x.detail, 300) }));
      // tdx_guest, tsm_report, dstack_socket: any one of the three attestation paths is enough
      doctor = checks.length ? { ok: checks.every((x) => x.ok || ["tdx_guest", "tsm_report", "dstack_socket"].includes(x.id)), checks } : undefined;
    }
    if (b.logs !== undefined && !Array.isArray(b.logs)) throw new HttpError(400, "invalid_logs", "invalid logs: expected an array of lines");
    const logs = Array.isArray(b.logs)
      ? (b.logs as unknown[]).filter((l): l is string => typeof l === "string").slice(-LOG_LINES).map((l) => cleanText(l, LOG_LINE_MAX))
      : undefined;

    let m = key.machineId ? db.machines[key.machineId] : machinesOf(key.operator).find((x) => x.hostname === hostname);
    if (key.machineId && !m) throw new HttpError(401, "machine_unknown_for_key", "unknown machine for this key: pair again (archive-node pair --force)");
    if (!m) {
      if (machinesOf(key.operator).length >= LIMITS.machinesPerOperator) throw machineLimit();
      if (Object.keys(db.machines).length >= LIMITS.machinesTotal) {
        throw new HttpError(503, "network_full_machines", "the network accepts no new machine for now");
      }
      const machineId = randomUUID();
      const now = Date.now();
      m = db.machines[machineId] = {
        machineId, operator: key.operator, hostname, mode: mode ?? "demo", version: "", productId: null, enclaveUrl: null,
        signer: null, x25519: null, status: "starting", doctor: null, lastSeen: null, createdAt: now,
        pairedBy: "key", approvedBy: key.operator, viaKey: key.keyId, pairedAt: now,
      };
    } else if (!key.machineId && (m.pairedBy !== "key" || m.viaKey !== key.keyId)) {
      // a FREE key takes over an existing machine (same name): what it announces from now on was confirmed on no
      // machine; the site asks for confirmation again before the registration
      Object.assign(m, { pairedBy: "key", approvedBy: key.operator, viaKey: key.keyId, pairedAt: Date.now() });
    }
    Object.assign(m, {
      hostname, status, lastSeen: Date.now(),
      ...(mode ? { mode } : {}),
      ...(b.version !== undefined ? { version: cleanVersion(b.version) } : {}),
      ...(productId !== null ? { productId } : {}),
      ...(enclaveUrl !== null ? { enclaveUrl } : {}),
      ...(signer !== null ? { signer } : {}),
      ...(x25519 !== null ? { x25519 } : {}),
      ...(doctor ? { doctor } : {}),
    });
    if (logs) logsOf.set(m.machineId, logs);
    save(false);
    return c.json({ ok: true, machineId: m.machineId, operator: m.operator, next: { registered: await isRegistered(arc, m) } });
  }));

  // an operator's list (?operator= required): public view, or complete (without logs) with its arcop_ key
  app.get("/machines", wrap(async (c) => {
    const a = String(c.req.query("operator") ?? "");
    if (!ADDR_RE.test(a)) throw new HttpError(400, "operator_param_expected", "operator parameter expected (0x + 40 hex characters)");
    const r = readerFromBearer(c);
    const list = machinesOf(a.toLowerCase()).sort((x, y) => (y.lastSeen ?? 0) - (x.lastSeen ?? 0));
    const regs = await Promise.all(list.map((m) => isRegistered(arc, m)));
    return c.json(list.map((m, i) => (canRead(r, m) ? ownerListView(m, regs[i]!) : publicView(m, regs[i]!))));
  }));

  // one machine: public view; diagnosis and logs with an arcop_ key of its operator
  app.get("/machines/:id", wrap(async (c) => {
    const id = c.req.param("id");
    const m = UUID_RE.test(id) ? db.machines[id] : undefined;
    if (!m) throw new HttpError(404, "machine_unknown", "unknown machine");
    const r = readerFromBearer(c);
    if (r && !canRead(r, m)) throw new HttpError(403, "key_forbidden", "this key gives no access to this machine");
    const reg = await isRegistered(arc, m);
    return c.json(r ? ownerDetailView(m, reg) : publicView(m, reg));
  }));
  // the operator's whole list (machine names, enclave addresses) with a read signature (10 min)
  app.post("/machines/list", wrap(async (c) => {
    const ip = clientIp(c);
    limit(lim.signedRead, ip, "signed_reads");
    const operator = await walletAuth(pub, await readJson(c), { statement: STATEMENT.read(), read: true }, ip);
    const list = machinesOf(operator).sort((x, y) => (y.lastSeen ?? 0) - (x.lastSeen ?? 0));
    const regs = await Promise.all(list.map((m) => isRegistered(arc, m)));
    return c.json(list.map((m, i) => ownerListView(m, regs[i]!)));
  }));

  // diagnosis and logs with a read signature (the same one opens everything for 10 min)
  app.post("/machines/:id/detail", wrap(async (c) => {
    const ip = clientIp(c);
    limit(lim.signedRead, ip, "signed_reads");
    const id = c.req.param("id");
    const operator = await walletAuth(pub, await readJson(c), { statement: STATEMENT.read(), read: true }, ip);
    const m = UUID_RE.test(id) ? db.machines[id] : undefined;
    if (!m || m.operator !== operator) throw machineNotFound();
    return c.json(ownerDetailView(m, await isRegistered(arc, m)));
  }));

  app.post("/machines/:id/remove", wrap(async (c) => {
    const ip = clientIp(c);
    limit(lim.signed, ip, "signatures");
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) throw machineNotFound();
    const b = await readJson(c);
    const operator = await walletAuth(pub, b, { statement: STATEMENT.removeMachine(id) }, ip);
    const m = db.machines[id];
    if (!m || m.operator !== operator) throw machineNotFound();
    for (const k of Object.values(db.keys)) if (k.machineId === id) revoke(k); // its key dies with it
    delete db.machines[id]; logsOf.delete(id); save();
    return c.json({ ok: true });
  }));
}
