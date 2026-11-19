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

/** Plafonds de stockage (un wallet neuf ne coûte rien : chaque opérateur, et l'ensemble, sont bornés). */
const LIMITS = {
  freeKeysPerOperator: 10, // clés libres actives (CLI, MCP) ; les clés de machine suivent le plafond des machines
  revokedKeptPerOperator: 20, // clés révoquées gardées pour l'historique (les plus anciennes sont effacées)
  machinesPerOperator: 20,
  keysTotal: 5_000, // clés actives, tous opérateurs
  machinesTotal: 1_000,
  pendingPairsTotal: 5_000, // ≈ 300 octets chacun ; 15 minutes au plus
  pendingPairsPerIp: 20, // toute une salle derrière un même Wi-Fi partage son adresse
  pendingPairsPerNet: 50, // par /24 (IPv4) ou /48 (IPv6) : remplir la table demande au moins 100 réseaux
  /** nonces consommés, gardés jusqu'à leur échéance (≈ 140 octets pour une action, 230 pour une lecture). Chaque entrée
   *  coûte une signature VALIDE, vérifiée ici ; ce plafond ne protège que la mémoire (≈ 120 Mo au pire) : au débit de
   *  vérification d'un processeur (≈ 500 par seconde), 10 minutes de lectures en remplissent 300 000. */
  consumedTotal: 500_000,
};
/** Débit par IP et par minute : assez pour une salle entière derrière un même Wi-Fi (une démo en salle : des dizaines
 *  d'opérateurs, une seule adresse ; le site lit la liste toutes les 10 s et un détail toutes les 15 s). */
const RATE = { pairStart: 30, pairLookup: 30, pairPoll: 600, signed: 120, signedRead: 600, nonce: 240, keyList: 300, heartbeatIp: 600, heartbeatKey: 30 };
/** Signatures INVALIDES par IP et par minute : au-delà, plus aucune vérification pour cette IP jusqu'à la fin de la
 *  minute. Une vérification coûte ≈ 2 ms de processeur (ou un appel au RPC pour un smart wallet) ; une signature invalide
 *  ne coûte rien à produire : c'est elle qu'on borne par adresse. Un humain n'en produit jamais (son wallet signe juste). */
const BAD_SIGNATURES_PER_IP = 30;
/** Par compte (adresse) et par minute, comptés APRÈS la vérification de la signature : chaque unité coûte une signature
 *  valide et un nonce neuf, et personne ne peut épuiser le budget d'un autre compte. Un humain signe quelques actions par
 *  minute et ouvre une lecture toutes les 10 minutes. */
const ACCOUNT_RATE = { signed: 30, readOpen: 10, read: 300 };
/** Codes faux (recherche ou approbation) par réseau (/24 en IPv4, /48 en IPv6) et par minute : au-delà, plus de recherche
 *  de code depuis ce réseau jusqu'à la fin de la minute. Aucun plafond global (30 IP suffisaient à bloquer tout
 *  appairage) : un code de 8 signes (31^8 ≈ 8,5·10^11) ne se devine pas à ce débit. */
const FAILS_PER_NET = 60;
const PAIR_TTL_MS = 15 * 60_000;
const PAIR_PURGE_GRACE_MS = 2 * 60_000; // l'agent interroge jusqu'à l'échéance + 30 s : on garde la trace un peu plus
/** Un nonce sert UNE fois, dans les 5 minutes qui suivent son émission. */
const NONCE_TTL_MS = 5 * 60_000;
/** « Expiration Time » au plus 5 minutes après « Issued At » pour une action, 10 minutes pour la lecture (réutilisable). */
const ACTION_TTL_MS = 5 * 60_000;
const READ_TTL_MS = 10 * 60_000;
/** tolérance d'horloge sur « Issued At » (le site reprend l'heure renvoyée par /auth/nonce : aucun écart en pratique) */
const CLOCK_SKEW_MS = 60_000;
const BODY_MAX = 64 * 1024;
const LOG_LINES = 100;
const LOG_LINE_MAX = 400;
const HIDDEN_NAME = "nom affiché après la signature";

// ---------------------------------------------------------------- stockage

function load(): Store {
  const empty: Store = { keys: {}, pairs: {}, machines: {} };
  try {
    if (existsSync(DATA_DIR)) accessSync(DATA_DIR, fsc.R_OK | fsc.W_OK | fsc.X_OK);
  } catch {
    console.error(`opérateurs : le dossier ${DATA_DIR} n'est pas lisible ET inscriptible par ce processus (uid ${process.getuid?.() ?? "?"}) : clés et machines ne seront ni lues ni enregistrées. Vérifiez les droits du volume de données.`);
  }
  try {
    if (!existsSync(FILE)) return empty;
    const raw = JSON.parse(readFileSync(FILE, "utf8")) ?? {};
    const s: Store = { keys: raw.keys ?? {}, pairs: raw.pairs ?? {}, machines: raw.machines ?? {} };
    for (const m of Object.values(s.machines) as Array<Machine & { logs?: unknown }>) delete m.logs; // plus jamais sur disque
    // machines d'avant « pairedBy » : une clé liée à la machine ne naît que d'un appairage par code ; sinon, inconnu
    const bound = new Set(Object.values(s.keys).map((k) => k.machineId).filter(Boolean));
    for (const m of Object.values(s.machines)) {
      if (!m.pairedBy && bound.has(m.machineId)) Object.assign(m, { pairedBy: "code", approvedBy: m.operator, viaKey: null });
    }
    return s;
  } catch (e) {
    console.error(`opérateurs : ${FILE} illisible (${(e as Error).message}) : on repart à vide`);
    return empty;
  }
}
const db: Store = load();
/** journaux des machines : en mémoire seulement (100 lignes au plus par machine, renvoyées à chaque battement) */
const logsOf = new Map<string, string[]>();

let saveTimer: NodeJS.Timeout | null = null;
let saveDue = 0;
/** Écriture différée : 200 ms pour un changement d'état (clé, appairage, retrait), 5 s pour un simple battement. */
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
    renameSync(FILE + ".tmp", FILE); // écriture atomique
  } catch (e) { console.error("sauvegarde opérateurs impossible :", (e as Error).message); }
}

// ---------------------------------------------------------------- outils

/** Les codes d'erreur stables : chaque réponse d'erreur porte { error, code, params? }. `error` reste la phrase française
 *  (humains, anciens clients) ; le site (EN et FR) et l'agent (EN) traduisent par `code`, avec les valeurs de `params`.
 *  Un code ne change jamais de sens ; un nouveau cas reçoit un nouveau code. */
export type ErrorCode =
  // validation des champs
  | "invalid_enum" | "invalid_hex" | "invalid_product_id" | "invalid_enclave_url" | "unreadable_enclave_url" | "enclave_url_scheme"
  | "invalid_doctor" | "invalid_logs" | "body_too_large" | "invalid_address" | "address_param_expected" | "operator_param_expected"
  | "user_code_expected" | "signed_body_expected" | "bad_message_or_signature"
  // débit et capacité
  | "rate_limited" | "too_many_wrong_codes" | "signatures_full" | "pairings_full" | "pairings_per_ip" | "pairings_per_network"
  | "no_free_code" | "machine_limit" | "key_limit" | "network_full_machines" | "network_full_keys"
  // clés opérateur (Authorization: Bearer arcop_…)
  | "key_missing" | "key_unknown_or_revoked" | "key_invalid" | "key_forbidden" | "not_a_machine_key"
  // messages signés par le wallet (EIP-4361)
  | "malformed_message" | "wrong_site" | "address_mismatch" | "wrong_chain" | "wrong_statement" | "signature_expired"
  | "nonce_unknown" | "nonce_expired" | "signature_used" | "issued_at_mismatch" | "bad_signature"
  // appairage, machines, clés
  | "code_unknown" | "pair_already_approved" | "pair_already_yours" | "device_code_unknown" | "machine_unknown_for_key"
  | "machine_unknown" | "machine_not_found" | "key_not_found"
  // lecture (server.ts) et imprévu ; 19/11 : paramètres de lecture refusés, produit ou enclave inconnus, route inconnue
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
/** le corps JSON d'une erreur : { error, code, params? } */
export const errorBody = (code: ErrorCode, error: string, params?: Params) => ({ error, code, ...(params ? { params } : {}) });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 signes, sans I, L, O, 0, 1 (lisibles à voix haute)
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEYID_RE = /^[0-9a-f]{8}$/;
const mask = (k: string) => k.replace(/^(arcop_[0-9a-f]+_)(.{4}).*(.{4})$/, "$1$2…$3");

/** n signes de ALPHA, sans biais (tirage rejeté au-delà de 248 = 8 × 31) */
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
/** « hive-7k2p qx9m », « HIVE-7K2PQX9M », « 7K2P-QX9M » → « HIVE-7K2P-QX9M » ; null si ce n'est pas un code */
function normCode(raw: unknown): string | null {
  const s = String(raw ?? "").toUpperCase().replace(/[\s_]+/g, "");
  const m = s.match(/^(?:HIVE-?)?([A-Z0-9]{4})-?([A-Z0-9]{4})$/);
  if (!m) return null;
  const body = m[1]! + m[2]!;
  for (const ch of body) if (!ALPHA.includes(ch)) return null;
  return `HIVE-${m[1]}-${m[2]}`;
}

/** texte libre affichable : sans caractères de contrôle, de séquences ANSI ni d'inversion bidirectionnelle */
function cleanText(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
    .slice(0, max);
}
/** nom d'hôte : lettres, chiffres, point, tiret, souligné ; le reste devient « - » */
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
  if (!allowed.has(s)) throw new HttpError(400, "invalid_enum", `${field} invalide : attendu ${list}`, { params: { field, allowed: list } });
  return s;
}
function optHex(v: unknown, nHex: number, field: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${nHex}}$`).test(v)) {
    throw new HttpError(400, "invalid_hex", `${field} invalide : attendu 0x suivi de ${nHex} caractères hexadécimaux`, { params: { field, length: nHex } });
  }
  return v.toLowerCase();
}
function optProductId(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = typeof v === "number" ? (Number.isSafeInteger(v) && v >= 0 ? String(v) : "") : typeof v === "string" ? v : "";
  if (!/^\d{1,10}$/.test(s)) throw new HttpError(400, "invalid_product_id", "productId invalide : un entier de 10 chiffres au plus");
  return BigInt(s).toString();
}
function optUrl(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || v.length > 200) {
    throw new HttpError(400, "invalid_enclave_url", "enclaveUrl invalide : une adresse http(s) de 200 caractères au plus", { params: { max: 200 } });
  }
  let u: URL;
  try { u = new URL(v); } catch { throw new HttpError(400, "unreadable_enclave_url", "enclaveUrl invalide : adresse illisible"); }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) {
    throw new HttpError(400, "enclave_url_scheme", "enclaveUrl invalide : http:// ou https://, sans identifiants");
  }
  return v;
}

const bodyTooLarge = () => errorBody("body_too_large", `corps de requête trop volumineux (${BODY_MAX / 1024} Kio au plus)`, { maxKiB: BODY_MAX / 1024 });
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

// ---------------------------------------------------------------- IP du client et débit

function isPrivatePeer(a: string): boolean {
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;
  if (isIP(v4) === 4) {
    const [x, y] = v4.split(".").map(Number) as [number, number];
    return x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
  }
  return a === "::1" || /^f[cd][0-9a-f]{2}:/i.test(a);
}
/** IPv4 telle quelle ; IPv6 réduite à son /64 (une machine IPv6 dispose souvent de tout le préfixe) */
function ipKey(raw: string): string {
  const ip = raw.replace(/%.*$/, "");
  const v4 = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) return v4;
  if (isIP(ip) !== 6) return "inconnue";
  const [head, tail] = ip.toLowerCase().split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const groups = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
/** L'IP du client : la dernière entrée de X-Forwarded-For (posée par Caddy, qui ne transmet pas celle du client),
 *  seulement si la connexion vient du réseau interne (Caddy) ; sinon l'adresse de la connexion elle-même. */
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
/** Le réseau d'une IP (telle que clientIp la rend) : /24 en IPv4, /48 en IPv6 (un fournisseur en donne au moins autant à
 *  un seul client). Les codes faux et les appairages en cours s'y comptent aussi. */
export function netOf(ipk: string): string {
  if (isIP(ipk) === 4) return ipk.split(".").slice(0, 3).join(".") + ".0/24";
  const g = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):/.exec(ipk);
  return g ? `${g[1]}:${g[2]}:${g[3]}::/48` : ipk;
}

/** La clé (tirée au démarrage, en mémoire seulement) qui répartit les clés de débit dans la table partagée. */
const LIMIT_KEY = randomBytes(32);
const SHARED_SLOTS = 1 << 16;

/** Débit par fenêtre fixe d'une minute, par clé (IP, réseau, compte, clé d'opérateur). Exact pour les `maxKeys` premières
 *  clés de la minute ; au-delà (une inondation d'adresses différentes, par exemple des milliers de /64 IPv6), une clé
 *  NOUVELLE compte dans une table fixe de 65 536 cases, choisie par un HMAC à clé secrète : rien ne grandit, et personne
 *  n'est refusé d'office (l'ancienne table, une fois pleine, refusait toute adresse nouvelle pendant une minute). Deux
 *  clés dans la même case partagent leur budget : rare, et impossible à viser sans la clé du hachage. */
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
  /** compte un passage ; false au-delà de la limite */
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
  /** ce que `key` a compté dans sa minute en cours */
  count(key: string, now = Date.now()): number {
    const b = this.live(key, now);
    if (b) return b.n;
    if (!this.sharedT || !this.sharedN) return 0;
    const i = this.slot(key);
    return now - this.sharedT[i]! >= this.windowMs ? 0 : this.sharedN[i]!;
  }
  /** secondes avant la fin de la minute en cours de `key` */
  retryAfter(key: string, now = Date.now()): number {
    const b = this.live(key, now);
    const t = b ? b.t : this.sharedT ? this.sharedT[this.slot(key)]! : now;
    return Math.max(1, Math.ceil((t + this.windowMs - now) / 1000));
  }
  /** efface les minutes finies ; hors purge périodique (`force`), une fois par seconde au plus : sous une inondation, la
   *  table pleine ne coûte pas un parcours complet à chaque requête */
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
/** Ce que compte un débit refusé : un identifiant stable (params.scope de l'erreur « rate_limited ») et son libellé
 *  français (dans « error »). */
const SCOPE_FR = {
  signatures: "signatures", signed_reads: "lectures signées", nonce_requests: "demandes de nonce", code_requests: "demandes de code",
  code_lookups: "recherches de code", pairing_polls: "attente d'appairage", pairing_refusals: "refus d'appairage",
  key_reads: "lectures de clés", heartbeats: "battements", key_heartbeats: "battements de cette clé",
  account_signatures: "signatures de ce compte", account_reads: "lectures signées de ce compte",
  account_new_reads: "nouvelles lectures signées de ce compte", invalid_signatures: "signatures invalides",
} as const;
export type RateScope = keyof typeof SCOPE_FR;
const rateLimited = (scope: RateScope, s: number) =>
  new HttpError(429, "rate_limited", `trop de requêtes (${SCOPE_FR[scope]}) : réessayez dans ${s} s`, { retryAfter: s, params: { scope, retryAfter: s } });
function limit(l: Limiter, key: string, scope: RateScope) {
  if (!l.take(key)) throw rateLimited(scope, l.retryAfter(key));
}
/** codes faux : plafond par réseau (/24, /48), jamais global */
function guardFails(net: string) {
  if (lim.fails.count(net) >= FAILS_PER_NET) {
    const s = lim.fails.retryAfter(net);
    throw new HttpError(429, "too_many_wrong_codes", `trop de codes faux essayés : réessayez dans ${s} s`, { retryAfter: s, params: { retryAfter: s } });
  }
}
const ipTag = (ip: string) => sha("archive-ip:" + ip).slice(0, 16);
const netTag = (net: string) => sha("archive-net:" + net).slice(0, 16);

// ---------------------------------------------------------------- clés opérateur

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
  if (!m) throw new HttpError(401, "key_missing", "clé opérateur manquante ou mal formée (attendu : Authorization: Bearer arcop_…)");
  const rec = db.keys[m[1]!];
  if (!rec || rec.revoked) throw new HttpError(401, "key_unknown_or_revoked", "clé opérateur inconnue ou révoquée");
  const a = Buffer.from(sha(m[2]!)), b = Buffer.from(rec.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "key_invalid", "clé opérateur invalide");
  rec.lastUsedAt = Date.now();
  save(false);
  return rec;
}

const activeKeys = () => Object.values(db.keys).filter((k) => !k.revoked);
function revoke(k: Key) { if (!k.revoked) { k.revoked = true; k.revokedAt = Date.now(); } }
/** au-delà de LIMITS.revokedKeptPerOperator clés révoquées, les plus anciennes sont effacées */
function pruneRevoked(operator: string) {
  const old = Object.values(db.keys).filter((k) => k.operator === operator && k.revoked)
    .sort((x, y) => (y.revokedAt ?? y.createdAt) - (x.revokedAt ?? x.createdAt));
  for (const k of old.slice(LIMITS.revokedKeptPerOperator)) delete db.keys[k.keyId];
}

// ---------------------------------------------------------------- messages signés par le wallet (EIP-4361)

/** Les sites qui font signer : WEB_URL (le site public), plus SIGN_ORIGINS pour le développement (origines séparées par
 *  des virgules, par exemple http://localhost:5173). Le domaine (« archive.62-171-153-35.sslip.io ») et l'URI
 *  (« https://archive.62-171-153-35.sslip.io ») d'un message viennent du même site. */
const ORIGINS: Array<{ domain: string; uri: string }> = (() => {
  const out: Array<{ domain: string; uri: string }> = [];
  for (const raw of [WEB_URL, ...String(process.env.SIGN_ORIGINS ?? "").split(",")]) {
    const s = raw.trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if ((u.protocol === "https:" || u.protocol === "http:") && !out.some((o) => o.domain === u.host)) out.push({ domain: u.host, uri: u.origin });
    } catch { console.error(`opérateurs : origine de signature illisible ignorée (« ${s.slice(0, 80)} »)`); }
  }
  if (!out.length) out.push({ domain: "archive.62-171-153-35.sslip.io", uri: "https://archive.62-171-153-35.sslip.io" });
  return out;
})();
/** le réseau des signatures : Arc testnet (5042002) */
const CHAIN_ID: number = arcTestnet.id;

/** La phrase de chaque signature (ligne « statement » d'EIP-4361), en anglais : on la lit dans son wallet.
 *  En ASCII : c'est la grammaire d'EIP-4361, et un wallet ne contrôle le domaine que d'un message qu'il sait lire. Le
 *  site écrit exactement les mêmes (web/src/signin.ts ; services/api/test/security.test.ts vérifie qu'elles concordent).
 *  Toutes commencent par STATEMENT_PREFIX (le mode test ne signe que ces messages-là). */
export const STATEMENT_PREFIX = "ArcHive: ";
export const STATEMENT = {
  pair: (code: string) => `${STATEMENT_PREFIX}pair the machine showing code ${code} with my account`,
  createKey: () => `${STATEMENT_PREFIX}create an operator key (arcop_) that cannot spend funds`,
  revokeKey: (keyId: string) => `${STATEMENT_PREFIX}revoke operator key arcop_${keyId}`,
  removeMachine: (machineId: string) => `${STATEMENT_PREFIX}remove machine ${machineId} from my account (its key is revoked)`,
  read: () => `${STATEMENT_PREFIX}read my operator data for 10 minutes (diagnostics, logs, machine and key names)`,
} as const;
/** ce que la grammaire d'EIP-4361 permet dans « statement » : lettres et chiffres ASCII, espace, ponctuation d'URI */
const STATEMENT_CHARS = /^[A-Za-z0-9 :/?#[\]@!$&'()*+,;=._~-]{1,200}$/;
const RFC3339 = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

/** Nonces SANS table : nonce = heure d'émission (12 hex, ms) + aléa (16 hex) + HMAC-SHA-256 tronqué à 128 bits (32 hex)
 *  de ces deux champs, sous une clé tirée au démarrage et gardée en mémoire seulement. 60 caractères alphanumériques
 *  (grammaire d'EIP-4361). L'API le vérifie sans rien stocker ; un redémarrage invalide les nonces en circulation
 *  (5 minutes au plus : le site en redemande un). */
const NONCE_KEY = randomBytes(32);
const NONCE_RE = /^([0-9a-f]{12})([0-9a-f]{16})([0-9a-f]{32})$/;
const nonceMac = (t: string, r: string) => createHmac("sha256", NONCE_KEY).update(`archive-nonce/1/${t}/${r}`).digest().subarray(0, 16);
function issueNonce(now: number): string {
  const t = now.toString(16).padStart(12, "0");
  const r = randomBytes(8).toString("hex");
  return t + r + nonceMac(t, r).toString("hex");
}
/** Un nonce émis ici : son heure d'émission et sa clé dans la liste des nonces consommés ; null sinon (forme, ou HMAC
 *  comparé en temps constant). La clé est une chaîne neuve et courte : elle ne retient pas le message signé en mémoire. */
function openNonce(nonce: string): { issuedAt: number; id: string } | null {
  const m = NONCE_RE.exec(nonce);
  if (!m || !timingSafeEqual(nonceMac(m[1]!, m[2]!), Buffer.from(m[3]!, "hex"))) return null;
  return { issuedAt: parseInt(m[1]!, 16), id: Buffer.from(m[1]! + m[2]!, "hex").toString("base64") };
}

/** Les nonces CONSOMMÉS, seuls gardés : jusqu'à l'échéance du nonce, ou de la lecture qu'il a ouverte si elle est plus
 *  tardive (après quoi le nonce comme le message sont refusés d'eux-mêmes). Pour une lecture : l'empreinte de
 *  (adresse, message) qu'il a ouverte, et celle de la signature déjà vérifiée (la même, présentée de nouveau pendant les
 *  10 minutes, n'est pas revérifiée : la liste et le détail se relisent toutes les 10 à 15 s). */
const consumed = new Map<string, { until: number; read?: string; sig?: string }>();
const digest16 = (s: string) => createHash("sha256").update(s).digest().subarray(0, 16).toString("base64");
const readSessionOf = (address: string, message: string) => digest16(address.toLowerCase() + "\n" + message);

let signInsSweptAt = 0;
/** efface les nonces consommés échus ; hors purge périodique (`force`), une fois par seconde au plus */
function sweepSignIns(now = Date.now(), force = true) {
  if (!force && now - signInsSweptAt < 1_000) return;
  signInsSweptAt = now;
  for (const [k, v] of consumed) if (v.until < now) consumed.delete(k);
}

/** « message signé mal formé : … » : code « malformed_message », la partie fautive dans params.part (format, header,
 *  blank_lines, uri, version, nonce, time, expiry_window) et ses valeurs */
const malformed = (part: string, detailFr: string, params: Params = {}) =>
  new HttpError(400, "malformed_message", `message signé mal formé : ${detailFr}`, { params: { part, ...params } });

function timeLine(line: string, label: string): number {
  const v = line.startsWith(`${label}: `) ? line.slice(label.length + 2) : "";
  const t = RFC3339.test(v) ? Date.parse(v) : NaN;
  if (!Number.isFinite(t)) throw malformed("time", `ligne « ${label}: <date RFC 3339> » attendue (par exemple 2026-11-07T18:00:00.000Z)`, { line: label });
  return t;
}

/** Lit un message EIP-4361 ligne à ligne et vérifie tout ce qui ne dépend pas de l'action ni du nonce :
 *  « <domaine> wants you to sign in with your Ethereum account: » / adresse EIP-55 / « » / phrase / « » / « URI: … » /
 *  « Version: 1 » / « Chain ID: 5042002 » / « Nonce: … » / « Issued At: … » / « Expiration Time: … » ; rien d'autre. */
function readSignIn(message: string, address: string) {
  const l = message.split("\n");
  if (l.length !== 11) {
    throw malformed("format", "le format EIP-4361 (« Sign-In with Ethereum ») du site est attendu, en 11 lignes ; rechargez la page et signez à nouveau", { lines: 11 });
  }
  const dm = /^(\S{1,253}) wants you to sign in with your Ethereum account:$/.exec(l[0]!);
  if (!dm) throw malformed("header", "1re ligne « <site> wants you to sign in with your Ethereum account: » attendue");
  const origin = ORIGINS.find((o) => o.domain === dm[1]);
  if (!origin) {
    const site = dm[1]!.slice(0, 80), expected = ORIGINS[0]!.domain;
    throw new HttpError(400, "wrong_site", `message signé pour un autre site (« ${site} ») : ArcHive n'accepte que ${expected}. Ne signez de message ArcHive que sur ce site.`, { params: { site, expected } });
  }
  if (l[1] !== getAddress(address)) throw new HttpError(400, "address_mismatch", "l'adresse du message ne correspond pas à celle du wallet (attendue en entier, avec sa casse EIP-55)");
  if (l[2] !== "" || l[4] !== "") throw malformed("blank_lines", "une ligne vide est attendue avant et après la phrase de l'action");
  if (l[5] !== `URI: ${origin.uri}`) throw malformed("uri", `ligne « URI: ${origin.uri} » attendue`, { uri: origin.uri });
  if (l[6] !== "Version: 1") throw malformed("version", "ligne « Version: 1 » attendue");
  if (l[7] !== `Chain ID: ${CHAIN_ID}`) {
    throw new HttpError(400, "wrong_chain", `message signé pour un autre réseau : ligne « Chain ID: ${CHAIN_ID} » (Arc testnet) attendue`, { params: { chainId: CHAIN_ID } });
  }
  const nm = /^Nonce: ([A-Za-z0-9]{8,64})$/.exec(l[8]!);
  if (!nm) throw malformed("nonce", "ligne « Nonce: <nonce de GET /auth/nonce> » attendue");
  return { statement: l[3]!, nonce: nm[1]!, issuedAt: timeLine(l[9]!, "Issued At"), expiresAt: timeLine(l[10]!, "Expiration Time") };
}

/** Pour le wallet du mode test (testSigner.ts) : la phrase du message si c'est une connexion ArcHive (EIP-4361) pour l'un
 *  de nos sites, au nom de `address`, avec un nonce émis ici, ni servi ni échu, et une durée de 10 minutes au plus ;
 *  null sinon. N'engage rien : la route qui recevra la signature refait toutes les vérifications. */
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

/** présence de code à une adresse (smart wallet ERC-1271), mise en cache 10 min ; un RPC en panne n'est PAS mis en
 *  cache (sinon un smart wallet serait refusé 10 minutes après une panne passagère) */
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
/** EOA : vérification locale (aucun appel RPC) ; smart wallet (code à l'adresse, ou signature ERC-6492) : par le RPC */
async function verifySignature(pub: PublicClient, address: Address, message: string, signature: Hex): Promise<boolean> {
  if (signature.length === 132) {
    try {
      const rec = await recoverMessageAddress({ message, signature });
      if (rec.toLowerCase() === address.toLowerCase()) return true;
    } catch { /* signature mal formée : seul un smart wallet peut encore la valider */ }
    if (!(await hasCode(pub, address))) return false;
  }
  try { return await pub.verifyMessage({ address, message, signature }); } catch { return false; }
}

/** Ce qu'une route attend d'une signature : la phrase exacte de son action ; `read` pour la lecture réservée, que la
 *  même signature ouvre pendant ses 10 minutes (son nonce ne sert qu'une fois : au premier usage). */
type Expect = { statement: string; read?: boolean };

const spentError = () => new HttpError(409, "signature_used", "signature déjà utilisée (son nonce a servi) : signez à nouveau");

/** Signature du wallet sur un message EIP-4361 construit par le site, vérifiée LIGNE À LIGNE (readSignIn), puis : la
 *  phrase de l'action, l'échéance (5 min pour une action, 10 pour la lecture), le nonce (émis ici, servi une fois,
 *  dans les 5 minutes), « Issued At » (pas avant l'émission du nonce, pas dans le futur), enfin la signature (EOA en
 *  local ; smart wallet ERC-1271 ou ERC-6492 par le RPC). Coût : tout ce qui précède la vérification est gratuit (texte,
 *  HMAC, table) ; une vérification ratée se compte par IP (`ip`), une réussie par compte, avant de consommer le nonce.
 *  Rend l'adresse (minuscules). */
async function walletAuth(pub: PublicClient, body: any, want: Expect, ip: string): Promise<string> {
  const { address, message, signature } = body ?? {};
  if (typeof address !== "string" || typeof message !== "string" || typeof signature !== "string") {
    throw new HttpError(400, "signed_body_expected", "attendu { address, message, signature }");
  }
  if (!ADDR_RE.test(address)) throw new HttpError(400, "invalid_address", "adresse invalide (0x + 40 caractères hexadécimaux)");
  if (message.length > 2000 || !/^0x[0-9a-fA-F]+$/.test(signature) || signature.length < 132 || signature.length > 20_000 || signature.length % 2) {
    throw new HttpError(400, "bad_message_or_signature", "message ou signature mal formés");
  }
  const now = Date.now();
  const m = readSignIn(message, address);
  if (m.statement !== want.statement) {
    throw new HttpError(400, "wrong_statement", `message signé inattendu : cette action demande la phrase « ${want.statement} »`, { params: { statement: want.statement } });
  }
  if (m.expiresAt <= now) throw new HttpError(401, "signature_expired", "signature expirée : signez à nouveau");
  const life = want.read ? READ_TTL_MS : ACTION_TTL_MS;
  if (m.expiresAt <= m.issuedAt || m.expiresAt - m.issuedAt > life) {
    throw malformed("expiry_window", `« Expiration Time » doit suivre « Issued At » de ${life / 60_000} minutes au plus`, { minutes: life / 60_000 });
  }
  const n = openNonce(m.nonce);
  if (!n || n.issuedAt > now + CLOCK_SKEW_MS) {
    throw new HttpError(401, "nonce_unknown", "nonce inconnu ou échu : signez à nouveau (le site demande un nonce neuf à chaque signature)");
  }
  // une lecture déjà ouverte par ce même message (son nonce a servi au premier usage) vaut jusqu'à son échéance
  const session = want.read ? readSessionOf(address, message) : undefined;
  const sig = digest16(signature.toLowerCase());
  const spent = consumed.get(n.id);
  const reuse = !!spent && !!session && spent.read === session;
  if (spent && !reuse) throw spentError();
  if (!reuse) {
    if (now > n.issuedAt + NONCE_TTL_MS) {
      const minutes = NONCE_TTL_MS / 60_000;
      throw new HttpError(401, "nonce_expired", `nonce expiré (il sert dans les ${minutes} minutes qui suivent son émission) : signez à nouveau`, { params: { minutes } });
    }
    if (m.issuedAt < n.issuedAt - CLOCK_SKEW_MS || m.issuedAt > now + CLOCK_SKEW_MS) {
      throw new HttpError(400, "issued_at_mismatch", "« Issued At » incohérent avec l'émission du nonce : reprenez l'heure renvoyée par GET /auth/nonce");
    }
  }
  // la vérification coûte (≈ 2 ms de processeur, ou le RPC) : sautée pour la signature déjà vérifiée de cette lecture,
  // refusée d'office à une IP qui a déjà présenté trop de signatures invalides dans la minute
  if (!(reuse && spent.sig === sig)) {
    if (lim.badSignatures.count(ip) >= BAD_SIGNATURES_PER_IP) throw rateLimited("invalid_signatures", lim.badSignatures.retryAfter(ip));
    if (!(await verifySignature(pub, address as Address, message, signature as Hex))) {
      lim.badSignatures.take(ip);
      throw new HttpError(401, "bad_signature", "signature invalide");
    }
  }
  const operator = address.toLowerCase();
  // relu APRÈS l'attente de la vérification : de deux requêtes simultanées portant le même message, une seule consomme le nonce
  const now2 = Date.now();
  const again = consumed.get(n.id);
  if (again) {
    if (!(session && again.read === session)) throw spentError();
    limit(lim.accountRead, operator, "account_reads");
    return operator;
  }
  // premier usage : les plafonds du compte (signatures valides seulement), PUIS le nonce est consommé (un refus pour
  // débit ne brûle pas la signature : elle resservira dans la minute suivante, avant son échéance)
  if (session) {
    limit(lim.accountRead, operator, "account_reads");
    limit(lim.accountReadOpen, operator, "account_new_reads");
  } else limit(lim.accountSigned, operator, "account_signatures");
  if (consumed.size >= LIMITS.consumedTotal) {
    sweepSignIns(now2, false);
    if (consumed.size >= LIMITS.consumedTotal) {
      throw new HttpError(503, "signatures_full", "trop de signatures en attente : réessayez dans une minute", { retryAfter: 60 });
    }
  }
  consumed.set(n.id, { until: Math.max(n.issuedAt + NONCE_TTL_MS, m.expiresAt), ...(session ? { read: session, sig } : {}) });
  return operator;
}

// ---------------------------------------------------------------- vues des machines

const regCache = new Map<string, { t: number; v: boolean }>();
async function isRegistered(arc: ArcClient, m: Machine): Promise<boolean> {
  if (!m.signer) return false;
  const k = `${m.signer}:${m.operator}`;
  const hit = regCache.get(k);
  if (hit && Date.now() - hit.t < 30_000) return hit.v;
  let v = false;
  try {
    // v2 : inscrite = active pour son produit au bloc de tête, pour CET opérateur (la validité se compte en blocs)
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
/** Ce que tout le monde voit : l'état utile, sans nom de machine, sans adresse http://IP, sans journaux ni détail. */
function publicView(m: Machine, registered: boolean) {
  return {
    machineId: m.machineId, operator: m.operator, hostname: `machine ${m.machineId.slice(0, 8)}`, hostnameHidden: true,
    mode: m.mode, version: m.version, productId: m.productId,
    enclaveUrl: m.enclaveUrl && m.enclaveUrl.startsWith("https://") ? m.enclaveUrl : null,
    signer: m.signer, status: m.status, online: isOnline(m), lastSeen: m.lastSeen, createdAt: m.createdAt,
    doctorOk: m.doctor?.ok ?? null, failing: failingOf(m), registered, restricted: true,
    // provenance explicite (null : machine d'avant ce champ) ; l'adresse qui a approuvé est celle du compte
    pairedBy: m.pairedBy ?? null, approvedBy: m.approvedBy ?? null, viaKey: m.viaKey ?? null, pairedAt: m.pairedAt ?? null,
  };
}
/** Ce que voit l'opérateur dans sa liste (sans les journaux) */
function ownerListView(m: Machine, registered: boolean) {
  return { ...publicView(m, registered), hostname: m.hostname, hostnameHidden: false, enclaveUrl: m.enclaveUrl, x25519: m.x25519, restricted: false };
}
/** Le détail complet, pour l'opérateur seul : diagnostic et journaux */
function ownerDetailView(m: Machine, registered: boolean) {
  return { ...ownerListView(m, registered), doctor: m.doctor, logs: logsOf.get(m.machineId) ?? [] };
}

type Reader = { operator: string; machineId: string | null };
/** une clé arcop_ dans Authorization (facultative) ; une clé présente mais fausse → 401 */
function readerFromBearer(c: Context): Reader | null {
  const h = c.req.header("authorization");
  if (!h) return null;
  const k = bearer(h);
  return { operator: k.operator, machineId: k.machineId };
}
/** une clé de machine ne lit que SA machine ; une clé libre lit toutes les machines de son opérateur */
const canRead = (r: Reader | null, m: Machine) => !!r && r.operator === m.operator && (!r.machineId || r.machineId === m.machineId);

const machinesOf = (op: string) => Object.values(db.machines).filter((m) => m.operator === op);
const pendingByCode = (code: string, now = Date.now()) =>
  Object.values(db.pairs).find((p) => p.userCode === code && p.status === "pending" && p.expiresAt > now);

/** l'appairage (déjà approuvé ou servi, pas encore échu) de ce code, s'il y en a un */
const takenByCode = (code: string, now = Date.now()) =>
  Object.values(db.pairs).find((p) => p.userCode === code && p.status !== "pending" && p.expiresAt > now);
const codeUnknown = () => new HttpError(404, "code_unknown", "code inconnu ou expiré : relancez « archive-node pair » sur la machine");
const machineNotFound = () => new HttpError(404, "machine_not_found", "machine inconnue pour cette adresse");
const machineLimit = () => new HttpError(409, "machine_limit",
  `limite de ${LIMITS.machinesPerOperator} machines par opérateur atteinte : retirez-en une sur la page Opérateur`, { params: { max: LIMITS.machinesPerOperator } });

function keyView(k: Key, full: boolean) {
  const { hash: _h, ...rest } = k;
  return full ? { ...rest, restricted: false } : { ...rest, label: k.machineId ? "clé de machine" : "clé libre (CLI, MCP)", restricted: true };
}
const keysOf = (op: string) => Object.values(db.keys).filter((k) => k.operator === op).sort((x, y) => y.createdAt - x.createdAt);

// ---------------------------------------------------------------- purge

/** Appairages expirés (tous statuts) effacés. Une approbation jamais remise à la machine : sa clé est révoquée et la
 *  machine, jamais vue, retirée (keyPlain ne reste pas sur disque). */
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
      console.error("opérateurs :", String(e?.stack ?? e).slice(0, 400));
      return c.json(errorBody("internal_error", "erreur interne de l'API opérateurs"), 500);
    }
  };
  const tooBig = (c: Context) => c.json(bodyTooLarge(), 413);
  for (const p of ["/pair/*", "/operator/*", "/machines/*"]) app.use(p, bodyLimit({ maxSize: BODY_MAX, onError: tooBig }));

  purge(); // au démarrage
  setInterval(() => purge(), 60_000).unref();

  // ---- connexion signée (EIP-4361) : un nonce neuf pour chaque signature du wallet ----
  // L'heure d'émission est rendue telle quelle : le site la reprend dans « Issued At » (aucun écart d'horloge possible).
  // Rien n'est stocké ici : le nonce porte sa propre preuve (HMAC) ; seul son usage le sera.
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

  // ---- appairage par code (flux « appareil ») ----
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
      throw new HttpError(503, "pairings_full", "trop d'appairages en cours : réessayez dans quelques minutes", { retryAfter: 60 });
    }
    const tag = ipTag(ip), ntag = netTag(netOf(ip));
    const ttlMin = PAIR_TTL_MS / 60_000;
    if (pending.filter((p) => p.ip === tag).length >= LIMITS.pendingPairsPerIp) {
      throw new HttpError(429, "pairings_per_ip", `déjà ${LIMITS.pendingPairsPerIp} appairages en cours depuis cette adresse : terminez-en un ou attendez son expiration (${ttlMin} min)`,
        { retryAfter: 60, params: { max: LIMITS.pendingPairsPerIp, minutes: ttlMin } });
    }
    if (pending.filter((p) => p.net === ntag).length >= LIMITS.pendingPairsPerNet) {
      throw new HttpError(429, "pairings_per_network", `déjà ${LIMITS.pendingPairsPerNet} appairages en cours depuis ce réseau : terminez-en un ou attendez son expiration (${ttlMin} min)`,
        { retryAfter: 60, params: { max: LIMITS.pendingPairsPerNet, minutes: ttlMin } });
    }
    let code = newUserCode();
    for (let tries = 1; pendingByCode(code, now); tries++) {
      if (tries >= 8) throw new HttpError(503, "no_free_code", "aucun code libre : réessayez");
      code = newUserCode();
    }
    const deviceCode = randomBytes(16).toString("hex");
    db.pairs[deviceCode] = { deviceCode, userCode: code, hostname, mode, version, createdAt: now, expiresAt: now + PAIR_TTL_MS, status: "pending", ip: tag, net: ntag };
    save();
    // « #/operator » : la route anglaise (alias du site), lue telle quelle dans le terminal de l'opérateur
    return c.json({ deviceCode, userCode: code, verifyUrl: `${WEB_URL}/#/operator?code=${code}`, expiresIn: PAIR_TTL_MS / 1000, interval: 3 });
  }));

  // le site vérifie qu'un code existe ; le nom de la machine n'est remis qu'après la signature (réponse de /pair/approve)
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
    if (!raw || raw.length > 32) throw new HttpError(400, "user_code_expected", "userCode attendu (le code affiché par la machine)");
    const code = normCode(raw);
    if (!code) {
      lim.fails.take(net);
      throw codeUnknown();
    }
    // la signature nomme LE code (forme normalisée HIVE-XXXX-XXXX) : elle n'approuve aucune autre machine
    const operator = await walletAuth(pub, b, { statement: STATEMENT.pair(code) }, ip);
    const p = pendingByCode(code);
    if (!p) {
      // déjà approuvé (pas encore échu) : par un AUTRE compte (409, la machine montrera son adresse : refusez-la là-bas),
      // ou par ce compte-ci (un autre onglet, un double envoi) ; sinon inconnu ou échu (404, compté comme code faux).
      // Seul le signataire d'un message qui nomme CE code l'apprend : la différence ne révèle aucun code à deviner.
      const taken = takenByCode(code);
      if (taken?.operator && taken.operator !== operator) {
        throw new HttpError(409, "pair_already_approved", "ce code vient d'être approuvé par un autre compte : relancez « archive-node pair » sur la machine et vérifiez l'adresse qu'elle affiche");
      }
      if (taken?.operator === operator) {
        throw new HttpError(409, "pair_already_yours", "vous avez déjà approuvé ce code : la machine affiche votre adresse et demande de confirmer");
      }
      lim.fails.take(net);
      throw codeUnknown();
    }
    if (machinesOf(operator).length >= LIMITS.machinesPerOperator) throw machineLimit();
    if (Object.keys(db.machines).length >= LIMITS.machinesTotal || activeKeys().length >= LIMITS.keysTotal) {
      throw new HttpError(503, "network_full_machines", "le réseau n'accepte plus de nouvelle machine pour l'instant : réessayez plus tard");
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
    if (!p) throw new HttpError(404, "device_code_unknown", "deviceCode inconnu");
    if (p.status === "pending") return c.json({ status: p.expiresAt > Date.now() ? "pending" : "expired" });
    if (p.status === "consumed" || !p.keyPlain) return c.json({ status: "consumed" });
    const key = p.keyPlain;
    p.keyPlain = undefined; p.status = "consumed"; save(); // la clé ne sort qu'UNE fois
    return c.json({ status: "approved", key, machineId: p.machineId, operator: p.operator });
  }));

  // La machine refuse l'appairage : l'humain, devant l'adresse complète du compte qui a approuvé son code, a répondu
  // « non » (ce n'est pas son wallet). Sa clé meurt, et la machine, jamais vue, disparaît du compte qui l'avait approuvée.
  app.post("/pair/reject", wrap(async (c) => {
    limit(lim.signed, clientIp(c), "pairing_refusals");
    const k = bearer(c.req.header("authorization"));
    if (!k.machineId) throw new HttpError(400, "not_a_machine_key", "seule la clé d'une machine appairée par code peut refuser son appairage");
    revoke(k);
    const m = db.machines[k.machineId];
    if (m && !m.lastSeen) { delete db.machines[k.machineId]; logsOf.delete(k.machineId); }
    save();
    return c.json({ ok: true });
  }));

  // ---- clés opérateur (pour la machine, la CLI, le serveur MCP) ----
  app.post("/operator/keys", wrap(async (c) => {
    const ip = clientIp(c);
    limit(lim.signed, ip, "signatures");
    const b = await readJson(c);
    const operator = await walletAuth(pub, b, { statement: STATEMENT.createKey() }, ip);
    const label = cleanText(b.label ?? "clé opérateur", 48).trim() || "clé opérateur";
    const free = activeKeys().filter((k) => k.operator === operator && !k.machineId).length;
    if (free >= LIMITS.freeKeysPerOperator) {
      throw new HttpError(409, "key_limit", `limite de ${LIMITS.freeKeysPerOperator} clés actives par opérateur atteinte : révoquez-en une`, { params: { max: LIMITS.freeKeysPerOperator } });
    }
    if (activeKeys().length >= LIMITS.keysTotal) {
      throw new HttpError(503, "network_full_keys", "le réseau n'accepte plus de nouvelle clé pour l'instant : réessayez plus tard");
    }
    pruneRevoked(operator);
    const { key, rec } = newKey(operator, label, null);
    save();
    return c.json({ key, keyId: rec.keyId, masked: mask(key) });
  }));

  // liste : complète avec une clé arcop_ libre de cet opérateur ; sinon sans les libellés (qui peuvent nommer la machine)
  app.get("/operator/keys", wrap(async (c) => {
    limit(lim.keyList, clientIp(c), "key_reads");
    const a = String(c.req.query("address") ?? "");
    if (!ADDR_RE.test(a)) throw new HttpError(400, "address_param_expected", "paramètre address attendu (0x + 40 caractères hexadécimaux)");
    const op = a.toLowerCase();
    const r = readerFromBearer(c);
    const full = !!r && r.operator === op && !r.machineId;
    return c.json(keysOf(op).map((k) => keyView(k, full)));
  }));
  // liste complète (vrais libellés) sur signature de lecture (la même ouvre tout pendant 10 min)
  app.post("/operator/keys/list", wrap(async (c) => {
    const ip = clientIp(c);
    limit(lim.signedRead, ip, "signed_reads");
    const operator = await walletAuth(pub, await readJson(c), { statement: STATEMENT.read(), read: true }, ip);
    return c.json(keysOf(operator).map((k) => keyView(k, true)));
  }));

  const keyNotFound = () => new HttpError(404, "key_not_found", "clé inconnue pour cette adresse");
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
    // validation stricte des champs typés (un champ faux → 400, rien n'est enregistré)
    const hostname = cleanHostname(b.hostname);
    const mode = b.mode === undefined ? undefined : enumOf(b.mode, MODES, "mode");
    const status = enumOf(b.status ?? "running", STATUSES, "status");
    const productId = optProductId(b.productId);
    const enclaveUrl = optUrl(b.enclaveUrl);
    const signer = optHex(b.signer, 40, "signer");
    const x25519 = optHex(b.x25519, 64, "x25519");
    let doctor: Machine["doctor"] | undefined;
    if (b.doctor !== undefined && b.doctor !== null) {
      if (typeof b.doctor !== "object" || !Array.isArray(b.doctor.checks)) throw new HttpError(400, "invalid_doctor", "doctor invalide : attendu { checks: [...] }");
      const checks: Check[] = (b.doctor.checks as unknown[]).slice(0, 30)
        .filter((x: any) => x && typeof x === "object" && typeof x.id === "string" && /^[a-z0-9_-]{1,32}$/.test(x.id))
        .map((x: any) => ({ id: x.id, label: cleanText(x.label, 80), ok: x.ok === true, detail: cleanText(x.detail, 300) }));
      // tdx_guest, tsm_report, dstack_socket : une seule des trois voies d'attestation suffit
      doctor = checks.length ? { ok: checks.every((x) => x.ok || ["tdx_guest", "tsm_report", "dstack_socket"].includes(x.id)), checks } : undefined;
    }
    if (b.logs !== undefined && !Array.isArray(b.logs)) throw new HttpError(400, "invalid_logs", "logs invalide : attendu un tableau de lignes");
    const logs = Array.isArray(b.logs)
      ? (b.logs as unknown[]).filter((l): l is string => typeof l === "string").slice(-LOG_LINES).map((l) => cleanText(l, LOG_LINE_MAX))
      : undefined;

    let m = key.machineId ? db.machines[key.machineId] : machinesOf(key.operator).find((x) => x.hostname === hostname);
    if (key.machineId && !m) throw new HttpError(401, "machine_unknown_for_key", "machine inconnue pour cette clé : appairez à nouveau (archive-node pair --force)");
    if (!m) {
      if (machinesOf(key.operator).length >= LIMITS.machinesPerOperator) throw machineLimit();
      if (Object.keys(db.machines).length >= LIMITS.machinesTotal) {
        throw new HttpError(503, "network_full_machines", "le réseau n'accepte plus de nouvelle machine pour l'instant");
      }
      const machineId = randomUUID();
      const now = Date.now();
      m = db.machines[machineId] = {
        machineId, operator: key.operator, hostname, mode: mode ?? "demo", version: "", productId: null, enclaveUrl: null,
        signer: null, x25519: null, status: "starting", doctor: null, lastSeen: null, createdAt: now,
        pairedBy: "key", approvedBy: key.operator, viaKey: key.keyId, pairedAt: now,
      };
    } else if (!key.machineId && (m.pairedBy !== "key" || m.viaKey !== key.keyId)) {
      // une clé LIBRE reprend une machine existante (même nom) : ce qu'elle annonce désormais n'a été confirmé sur aucune
      // machine ; le site redemande confirmation avant l'inscription
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

  // liste d'un opérateur (?operator= obligatoire) : vue publique, ou complète (sans journaux) avec sa clé arcop_
  app.get("/machines", wrap(async (c) => {
    const a = String(c.req.query("operator") ?? "");
    if (!ADDR_RE.test(a)) throw new HttpError(400, "operator_param_expected", "paramètre operator attendu (0x + 40 caractères hexadécimaux)");
    const r = readerFromBearer(c);
    const list = machinesOf(a.toLowerCase()).sort((x, y) => (y.lastSeen ?? 0) - (x.lastSeen ?? 0));
    const regs = await Promise.all(list.map((m) => isRegistered(arc, m)));
    return c.json(list.map((m, i) => (canRead(r, m) ? ownerListView(m, regs[i]!) : publicView(m, regs[i]!))));
  }));

  // une machine : vue publique ; diagnostic et journaux avec une clé arcop_ de son opérateur
  app.get("/machines/:id", wrap(async (c) => {
    const id = c.req.param("id");
    const m = UUID_RE.test(id) ? db.machines[id] : undefined;
    if (!m) throw new HttpError(404, "machine_unknown", "machine inconnue");
    const r = readerFromBearer(c);
    if (r && !canRead(r, m)) throw new HttpError(403, "key_forbidden", "cette clé ne donne pas accès à cette machine");
    const reg = await isRegistered(arc, m);
    return c.json(r ? ownerDetailView(m, reg) : publicView(m, reg));
  }));
  // la liste de l'opérateur en entier (noms des machines, adresses d'enclave) sur signature de lecture (10 min)
  app.post("/machines/list", wrap(async (c) => {
    const ip = clientIp(c);
    limit(lim.signedRead, ip, "signed_reads");
    const operator = await walletAuth(pub, await readJson(c), { statement: STATEMENT.read(), read: true }, ip);
    const list = machinesOf(operator).sort((x, y) => (y.lastSeen ?? 0) - (x.lastSeen ?? 0));
    const regs = await Promise.all(list.map((m) => isRegistered(arc, m)));
    return c.json(list.map((m, i) => ownerListView(m, regs[i]!)));
  }));

  // diagnostic et journaux sur signature de lecture (la même ouvre tout pendant 10 min)
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
    for (const k of Object.values(db.keys)) if (k.machineId === id) revoke(k); // sa clé meurt avec elle
    delete db.machines[id]; logsOf.delete(id); save();
    return c.json({ ok: true });
  }));
}
