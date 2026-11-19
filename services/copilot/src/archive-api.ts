/** archive-api.ts — the network's LISTS (enclaves, bounties, products, an account's sessions, activity, counters) read
 *  from the event index of ArcHive's public API (services/api: an RPC index kept on disk, never partial), for the
 *  copilot AND the MCP server.
 *  - Timeout: 8 s per call (AbortSignal.timeout), bounded body, 15 s cache of successful answers only.
 *  - EXPLICIT fallback: an API that is silent, failing or unreadable → ListUnavailableError, "liste momentanément
 *    indisponible" (list temporarily unavailable); never the explorer (Blockscout), never a partial list presented as
 *    complete: a single malformed row makes the whole list unavailable.
 *  SINGLE reads (one enclave, one session, one bounty, one product) stay on-chain reads. */
import { getAddress, type Address, type Hex } from "viem";
import type { EnclaveView, BountyRow, ProductView, ProductState } from "@arcvault/sdk";

export const DEFAULT_ARCHIVE_API = "https://archive.62-171-153-35.sslip.io/api";
export const LIST_TIMEOUT_MS = 8_000;
const LIST_TTL_MS = 15_000;
const MAX_BYTES = 4_000_000;

export class ListUnavailableError extends Error {
  constructor(readonly list: string, readonly reason: string) {
    super(`liste momentanément indisponible (${list}) : ${reason}. Réessayez dans un instant ; aucune liste partielle n'est donnée à la place.`);
    this.name = "ListUnavailableError";
  }
}
export const isListUnavailable = (e: unknown): e is ListUnavailableError => e instanceof ListUnavailableError;

export interface ApiOptions {
  /** Base de l'API (défaut : env ARCHIVE_API, sinon l'API publique). */
  base?: string;
  /** fetch (tests). */
  fetch?: typeof fetch;
  /** Délai par appel, en ms (défaut : 8 000). */
  timeoutMs?: number;
}

export const archiveBase = (base?: string) => (base || process.env.ARCHIVE_API || DEFAULT_ARCHIVE_API).replace(/\/+$/, "");

// ---------------------------------------------------------------- lecture HTTP

async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); throw new Error(`réponse trop grande (plus de ${max} octets)`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const why = (e: any, ms: number) =>
  e?.name === "TimeoutError" || e?.name === "AbortError"
    ? `l'API ArcHive n'a pas répondu en ${ms / 1000} s`
    : `API ArcHive injoignable (${String(e?.cause?.code ?? e?.message ?? e).slice(0, 120)})`;

async function getJson(list: string, path: string, o: ApiOptions): Promise<unknown> {
  const ms = o.timeoutMs ?? LIST_TIMEOUT_MS;
  const f = o.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${archiveBase(o.base)}${path}`, { signal: AbortSignal.timeout(ms), headers: { accept: "application/json" } });
  } catch (e) { throw new ListUnavailableError(list, why(e, ms)); }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new ListUnavailableError(list, `l'API ArcHive a répondu HTTP ${res.status}`);
  }
  let text: string;
  try { text = await readCapped(res, MAX_BYTES); } catch (e) { throw new ListUnavailableError(list, why(e, ms)); }
  try { return JSON.parse(text); } catch { throw new ListUnavailableError(list, "réponse non JSON de l'API ArcHive"); }
}

// ---------------------------------------------------------------- cache (succès seulement)

const cache = new Map<string, { t: number; v: Promise<unknown> }>();
/** Entrées gardées au plus (les sessions sont lues par adresse : sans borne, la mémoire grandirait à chaque adresse). */
const MAX_ENTRIES = 512;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.t < LIST_TTL_MS) return hit.v as Promise<T>;
  if (cache.size >= MAX_ENTRIES) {
    for (const [k, e] of cache) if (now - e.t >= LIST_TTL_MS) cache.delete(k); // périmées d'abord
    for (const k of cache.keys()) { if (cache.size < MAX_ENTRIES) break; cache.delete(k); } // puis les plus anciennes
  }
  const v = fn();
  cache.delete(key); // réinsérée en fin : l'ordre de la Map reste celui des lectures
  cache.set(key, { t: now, v });
  v.catch(() => { if (cache.get(key)?.v === v) cache.delete(key); }); // un échec n'est jamais gardé
  return v;
}
/** Vide le cache (tests). */
export function clearListCache() { cache.clear(); }

// ---------------------------------------------------------------- lecture stricte des lignes

class Malformed extends Error {}
const fail = (what: string): never => { throw new Malformed(what); };
const asAddr = (x: unknown, what: string): Address =>
  typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x) ? getAddress(x.toLowerCase()) : fail(`${what} : adresse attendue`);
const asHex = (x: unknown, what: string): Hex =>
  typeof x === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(x) ? (x.toLowerCase() as Hex) : fail(`${what} : hexadécimal attendu`);
const asBig = (x: unknown, what: string): bigint =>
  typeof x === "string" && /^\d{1,78}$/.test(x) ? BigInt(x)
    : typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? BigInt(x) : fail(`${what} : entier attendu`);
const asNum = (x: unknown, what: string): number => {
  const n = typeof x === "string" && /^\d{1,15}$/.test(x) ? Number(x) : x;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : fail(`${what} : entier attendu`);
};
const asBool = (x: unknown, what: string): boolean => (typeof x === "boolean" ? x : fail(`${what} : booléen attendu`));
const asObj = (x: unknown, what: string): Record<string, any> =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, any>) : fail(`${what} : objet attendu`);
const STATES: ProductState[] = ["None", "Proposed", "Active", "Retired"];

/** Toute la liste, ou rien : une ligne illisible rend la liste indisponible. */
async function listOf<T>(list: string, path: string, o: ApiOptions, row: (x: unknown, i: number) => T): Promise<T[]> {
  const j = await getJson(list, path, o);
  if (!Array.isArray(j)) throw new ListUnavailableError(list, "réponse inattendue de l'API ArcHive (tableau attendu)");
  try { return j.map(row); } catch (e) {
    if (e instanceof Malformed) throw new ListUnavailableError(list, `réponse illisible de l'API ArcHive (${e.message})`);
    throw e;
  }
}

function enclaveRow(x: unknown, i: number): EnclaveView {
  const e = asObj(x, `enclave ${i}`);
  return {
    signer: asAddr(e.signer, "signer"), x25519: asHex(e.x25519, "x25519"), operator: asAddr(e.operator, "operator"),
    productId: asBig(e.productId, "productId"), workloadId: asHex(e.workloadId, "workloadId"), fmspc: asHex(e.fmspc, "fmspc"),
    tcbStatus: asNum(e.tcbStatus, "tcbStatus"), quoteHash: asHex(e.quoteHash, "quoteHash"), anchorBlock: asBig(e.anchorBlock, "anchorBlock"),
    registeredAt: asBig(e.registeredAt, "registeredAt"), expiresAt: asBig(e.expiresAt, "expiresAt"),
    fromBlock: asBig(e.fromBlock, "fromBlock"), untilBlock: asBig(e.untilBlock, "untilBlock"), active: asBool(e.active, "active"),
    head: e.head === undefined || e.head === null ? undefined : asBig(e.head, "head"),
  };
}

function bountyRow(x: unknown, i: number): BountyRow {
  const b = asObj(x, `prime ${i}`);
  return {
    id: asBig(b.id, "id"), protocol: asAddr(b.protocol, "protocol"), productId: asBig(b.productId, "productId"),
    predicateHash: asHex(b.predicateHash, "predicateHash"), protocolX25519: asHex(b.protocolX25519, "protocolX25519"),
    singleCap: asBig(b.singleCap, "singleCap"), k: asNum(b.k, "k"), balance: asBig(b.balance, "balance"), deadline: asBig(b.deadline, "deadline"),
    paused: asBool(b.paused, "paused"), targetToPause: asAddr(b.targetToPause, "targetToPause"), paidAmount: asBig(b.paidAmount ?? "0", "paidAmount"),
    lastPaidBlock: asBig(b.lastPaidBlock ?? "0", "lastPaidBlock"), pausedFromBlock: asBig(b.pausedFromBlock ?? "0", "pausedFromBlock"),
  };
}

function productRow(x: unknown, i: number): ProductView {
  const p = asObj(x, `produit ${i}`);
  const state = STATES.includes(p.state) ? (p.state as ProductState) : fail(`state : ${String(p.state).slice(0, 20)}`);
  return {
    id: asBig(p.id, "id"), author: asAddr(p.author, "author"), manifestHash: asHex(p.manifestHash, "manifestHash"),
    deterministic: asBool(p.deterministic, "deterministic"), price: asBig(p.price, "price"),
    bpsOperator: asNum(p.bpsOperator, "bpsOperator"), bpsAuthor: asNum(p.bpsAuthor, "bpsAuthor"), bpsNetwork: asNum(p.bpsNetwork, "bpsNetwork"),
    minBond: asBig(p.minBond, "minBond"), exposureCap: asBig(p.exposureCap, "exposureCap"), settlement: asAddr(p.settlement, "settlement"),
    param: asHex(p.param, "param"), version: asBig(p.version ?? "0", "version"), activatesAt: asBig(p.activatesAt ?? "0", "activatesAt"),
    state, manifestURI: typeof p.manifestURI === "string" ? p.manifestURI : "",
    unitTokens: asNum(p.unitTokens ?? 1, "unitTokens"), outWeight: asNum(p.outWeight ?? 1, "outWeight"),
  };
}

export interface ApiSession {
  id: bigint; productId: bigint; deposit: bigint; paid: bigint; closed: boolean; enclave: Address; operator: Address;
  price: bigint; expiresAt: bigint; paidUnits: bigint; verdictWritten: boolean;
}
function sessionRow(x: unknown, i: number): ApiSession {
  const s = asObj(x, `session ${i}`);
  return {
    id: asBig(s.id, "id"), productId: asBig(s.productId, "productId"), deposit: asBig(s.deposit, "deposit"), paid: asBig(s.paid, "paid"),
    closed: asBool(s.closed, "closed"), enclave: asAddr(s.enclave, "enclave"), operator: asAddr(s.operator, "operator"),
    price: asBig(s.price, "price"), expiresAt: asBig(s.expiresAt, "expiresAt"), paidUnits: asBig(s.paidUnits ?? "0", "paidUnits"),
    verdictWritten: asBool(s.verdictWritten ?? false, "verdictWritten"),
  };
}

export interface ApiEvent { contract: string; name: string; args: Record<string, unknown>; block: number; logIndex: number; tx: Hex }
function eventRow(x: unknown, i: number): ApiEvent {
  const e = asObj(x, `événement ${i}`);
  if (typeof e.name !== "string" || typeof e.contract !== "string") fail("contrat ou nom d'événement manquant");
  return { contract: e.contract, name: e.name, args: asObj(e.args, "args"), block: asNum(e.block, "block"), logIndex: asNum(e.logIndex, "logIndex"), tx: asHex(e.tx, "tx") };
}

// ---------------------------------------------------------------- les listes

const key = (o: ApiOptions, path: string) => `${archiveBase(o.base)}${path}`;

/** La ruche : toutes les enclaves inscrites, avec leur état au bloc de tête de l'API. */
export const apiEnclaves = (o: ApiOptions = {}) => cached(key(o, "/enclaves"), () => listOf("enclaves", "/enclaves", o, enclaveRow));
/** Toutes les primes scellées. */
export const apiBounties = (o: ApiOptions = {}) => cached(key(o, "/bounties"), () => listOf("primes", "/bounties", o, bountyRow));
/** Tous les produits (tous états). */
export const apiProducts = (o: ApiOptions = {}) => cached(key(o, "/products"), () => listOf("produits", "/products", o, productRow));
/** Les sessions ouvertes par un compte. */
export function apiSessions(owner: Address, o: ApiOptions = {}): Promise<ApiSession[]> {
  const path = `/sessions/${owner.toLowerCase()}`;
  return cached(key(o, path), () => listOf("sessions", path, o, sessionRow));
}
/** L'activité on-chain récente (du plus récent au plus ancien), 1 à 100 événements. */
export function apiActivity(limit: number, o: ApiOptions = {}): Promise<ApiEvent[]> {
  const n = Math.min(100, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 10)));
  const path = `/activity?limit=${n}`;
  return cached(key(o, path), async () => (await listOf("activité", path, o, eventRow)).slice(0, n));
}
/** Les compteurs du réseau (/stats). */
export function apiStats(o: ApiOptions = {}): Promise<Record<string, unknown>> {
  return cached(key(o, "/stats"), async () => {
    const j = await getJson("compteurs du réseau", "/stats", o);
    if (!j || typeof j !== "object" || Array.isArray(j)) throw new ListUnavailableError("compteurs du réseau", "réponse inattendue de l'API ArcHive");
    return j as Record<string, unknown>;
  });
}

/** 19/11 : les niveaux d'opérateur (/levels : niveau de chaque enclave active, Prime du niveau vérifié autorisée ou non),
 *  pour la ligne LIVE STATUS du site (site-live.ts) ; objet brut, lu prudemment par son seul lecteur. */
export function apiLevels(o: ApiOptions = {}): Promise<Record<string, any>> {
  return cached(key(o, "/levels"), async () => {
    const j = await getJson("niveaux", "/levels", o);
    if (!j || typeof j !== "object" || Array.isArray(j)) throw new ListUnavailableError("niveaux", "réponse inattendue de l'API ArcHive");
    return j as Record<string, any>;
  });
}

export interface IndexStatus { lastBlock: number; head: number | null; lagBlocks: number | null; lastError: string | null }
/** État de l'index de l'API (jusqu'à quel bloc il est complet) ; null s'il n'est pas lisible (jamais d'exception). */
export function apiIndexStatus(o: ApiOptions = {}): Promise<IndexStatus | null> {
  return cached(key(o, "/index"), async () => {
    const j = asObj(await getJson("index", "/index", o), "index");
    const opt = (x: unknown) => (typeof x === "number" && Number.isSafeInteger(x) ? x : null);
    if (typeof j.lastBlock !== "number") throw new ListUnavailableError("index", "réponse inattendue");
    return { lastBlock: j.lastBlock, head: opt(j.head), lagBlocks: opt(j.lagBlocks), lastError: typeof j.lastError === "string" ? j.lastError.slice(0, 160) : null };
  }).catch(() => null);
}

/** Ce qu'on dit de la fraîcheur d'une liste : complète jusqu'au bloc N de l'index (et un avertissement s'il traîne). */
export async function freshness(o: ApiOptions = {}): Promise<Record<string, unknown>> {
  const s = await apiIndexStatus(o);
  const source = `index d'événements de l'API ArcHive (${archiveBase(o.base)})`;
  if (!s) return { source, indexAJourAuBloc: "inconnu (état de l'index illisible)" };
  const late = (s.lagBlocks ?? 0) > 600 || !!s.lastError;
  return {
    source, indexAJourAuBloc: s.lastBlock, retardDeLIndexEnBlocs: s.lagBlocks,
    ...(late ? { avertissement: `l'index de l'API a ${s.lagBlocks ?? "?"} blocs de retard${s.lastError ? ` (${s.lastError})` : ""} : un événement plus récent que le bloc ${s.lastBlock} peut manquer` } : {}),
  };
}
