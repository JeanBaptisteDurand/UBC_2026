/** api.ts — lecture d'état via notre API (http), pas via des rafales de lectures RPC dans le navigateur.
 *  L'API lit la chaîne une fois côté serveur (avec cache) ; ici on révive les bigint des vues du SDK (pile v2 : fenêtres
 *  de validité des enclaves en blocs, paliers déjà payés des primes, enclave et prix verrouillés des sessions). */
import type { EnclaveView, ProductView, BountyRow } from "@arcvault/sdk";
import { API_URL } from "./config";
import { msg, show, type Msg } from "./msg";

/** Une session de l'adresse connectée. v2 : l'enclave, l'opérateur, le prix et l'échéance sont verrouillés à l'ouverture
 *  (absents d'une API encore en v1 : champs facultatifs). */
export type Session = {
  id: bigint; productId: bigint; deposit: bigint; paid: bigint; closed: boolean;
  enclave?: string; operator?: string; price?: bigint; expiresAt?: bigint; paidUnits?: bigint; verdictWritten?: boolean;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL.replace(/\/$/, "")}${path}`);
  if (!res.ok) throw new Error(`api ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

const B = (x: unknown): bigint => BigInt(String(x ?? "0"));
/** Révive en bigint les champs nommés (chaînes décimales dans le JSON de l'API). */
function bigs<T>(o: any, keys: string[]): T {
  const out = { ...o };
  for (const k of keys) out[k] = B(o?.[k]);
  return out as T;
}

export async function fetchProducts(): Promise<ProductView[]> {
  const raw = await get<any[]>("/products");
  return raw.map((p) => ({
    ...bigs<ProductView>(p, ["id", "price", "minBond", "exposureCap", "version", "activatesAt"]),
    unitTokens: Number(p.unitTokens ?? 1), outWeight: Number(p.outWeight ?? 1),
  }));
}

export async function fetchEnclaves(): Promise<EnclaveView[]> {
  const raw = await get<any[]>("/enclaves");
  return raw.map((e) => ({
    ...bigs<EnclaveView>(e, ["productId", "expiresAt", "fromBlock", "untilBlock", "anchorBlock", "registeredAt"]),
    head: e.head !== undefined ? B(e.head) : undefined, tcbStatus: Number(e.tcbStatus), active: !!e.active,
  }));
}

export async function fetchBounties(): Promise<BountyRow[]> {
  const raw = await get<any[]>("/bounties");
  return raw.map((b) => ({
    ...bigs<BountyRow>(b, ["id", "productId", "balance", "deadline", "singleCap", "paidAmount", "lastPaidBlock", "pausedFromBlock"]),
    k: Number(b.k ?? 1), paused: !!b.paused,
  }));
}

/** /stats. `settledUsdc` : tout ce qui est réglé (sessions + appels x402) ; les champs facultatifs viennent de l'API du 9/11
 *  (pile v2.1 : appels payés x402 à part, verdicts sautés ou sans objet). */
export interface Stats {
  enclaves: number; enclavesActive: number; products: string; productsActive?: number; sessions: number; settlements: number;
  settledUsdc: string; refundedUsdc: string; x402Calls: number; verdicts: number;
  bounties: number; bountyPool: string; bountiesPaid: number; bountyPaidUsdc: string; head: string;
  sessionSettledUsdc?: string; x402SettledUsdc?: string; verdictsSkipped?: number; verdictsNotApplicable?: number;
}
/** Un événement de /activity ; `label` : son libellé anglais (API du 9/11), le site écrit le sien dans sa langue. */
export interface ActivityEvent { contract: string; name: string; args: Record<string, string | number>; block: number; tx: string; ts?: string; logIndex?: number; label?: string }
/** L'issue du verdict ERC-8004 de la session que montre la chaîne de preuves (API du 9/11). */
export type VerdictStatus = "written" | "not_applicable" | "skipped" | "none" | "pending";
export interface Proof {
  /** L'image affichée au maillon 1 : celle du manifeste de l'auteur, mais seulement si `manifestVerified` (keccak256 du
   *  manifeste = manifestHash on-chain) ; sinon l'image par défaut de l'API, qui ne prouve rien. */
  image: string; manifestURI?: string; manifestVerified?: boolean;
  enclave: (Omit<EnclaveView, "productId" | "expiresAt"> & { productId: string; expiresAt: string }) | null;
  registerTx: string | null; settleTx: string | null; settleUsdc: string | null; settleSession: string | null;
  verdictTx: string | null; verdictAgentId: string | null; verdictResponse: number | null;
  verdictSession?: string | null; verdictStatus?: VerdictStatus | null; verdictStatusTx?: string | null;
  verdictReason?: string | null; verdictReasonData?: string | null; verdictSalted?: boolean | null;
  enclaveImage?: { imageId: string; composeHash: string; osImageHash: string; tx: string } | null;
  index?: IndexStatus;
}
export interface IndexStatus { lastBlock: number; head: number; lagBlocks: number | null; events: number; syncing: boolean; lastSyncAt: number | null; lastError: string | null; fromBlock?: number }
export const fetchStats = () => get<Stats>("/stats");
export const fetchActivity = (limit = 12) => get<ActivityEvent[]>(`/activity?limit=${limit}`);
export const fetchProof = () => get<Proof>("/proof");

// ---------- opérateurs : machines, appairage, clés arcop_ ----------
export interface MachineCheck { id: string; label: string; ok: boolean; detail: string }
/** Une machine vue par l'API. Sans lecture signée (`restricted`) : pas de nom (`hostnameHidden`), pas d'adresse http://IP,
 *  ni diagnostic ni journaux ; avec la signature de lecture : tout (détail : diagnostic et journaux). */
export interface Machine {
  machineId: string; operator: string; hostname: string; mode: string; version: string; productId: string | null;
  enclaveUrl: string | null; signer: string | null; status: string; online: boolean; lastSeen: number | null;
  doctorOk: boolean | null; registered: boolean; failing?: string[]; hostnameHidden?: boolean; restricted?: boolean;
  doctor?: { ok: boolean; checks: MachineCheck[] } | null; logs?: string[];
  /** Provenance explicite (API à jour) : « code » = appairée par code (le compte confirmé sur la machine), « key » =
   *  ajoutée ou reprise par une clé arcop_ libre ; null ou absent : machine d'avant ce champ (le site la déduit). */
  pairedBy?: "code" | "key" | null;
  /** l'adresse qui a approuvé (celle du compte), et la clé libre (keyId) d'une machine « key » */
  approvedBy?: string | null; viaKey?: string | null; pairedAt?: number | null;
}
/** `restricted` : vue publique (libellé générique) ; les vrais libellés demandent la lecture signée */
export interface OperatorKey { keyId: string; label: string; machineId: string | null; createdAt: number; lastUsedAt: number | null; revoked: boolean; restricted?: boolean }
/** Une signature du wallet sur un message EIP-4361 (signin.ts) : ce que l'API vérifie. */
export type Signed = { address: string; message: string; signature: string };
/** Nonce de GET /auth/nonce : usage unique, 5 minutes ; « Issued At » reprend issuedAt. */
export interface SignInNonce { nonce: string; issuedAt: string; expiresAt: string; domain?: string; uri?: string; chainId?: number }

/** Erreur de l'API : son statut HTTP, son code stable et ses valeurs (le site traduit par eux : errors.ts), et son texte
 *  (la phrase française de l'API ; ou, `localized`, une phrase écrite par le site : son message, remis en mots dans la
 *  langue du moment à l'affichage). */
export class ApiError extends Error {
  constructor(
    message: string, readonly status: number, readonly code?: string,
    readonly params: Record<string, unknown> = {}, readonly localized: Msg | null = null,
  ) { super(message); this.name = "ApiError"; }
}
/** Une erreur dont la phrase est celle du site (pas celle de l'API). */
const siteError = (m: Msg, status: number) => new ApiError(show(m), status, undefined, {}, m);
/** L'erreur d'une réponse de l'API ({ error, code, params }) ; une API d'avant les codes n'a que `error`. */
function apiErrorOf(j: any, path: string, status: number): ApiError {
  const code = typeof j?.code === "string" ? j.code : undefined;
  const params = j?.params && typeof j.params === "object" && !Array.isArray(j.params) ? j.params : {};
  return new ApiError(typeof j?.error === "string" ? j.error : `api ${path}: ${status}`, status, code, params);
}
/** La signature n'est plus acceptée (échue, déjà servie, ou API redémarrée) : à refaire. */
const SPENT = new Set(["signature_used", "signature_expired", "nonce_unknown", "nonce_expired", "bad_signature"]);
export const isSignatureSpent = (e: unknown) =>
  e instanceof ApiError && (e.code ? SPENT.has(e.code) : e.status === 401 || e.status === 409);

async function send<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw apiErrorOf(j, path, res.status);
  return j as T;
}
/** GET dont le refus porte le message de l'API (« code inconnu ou expiré… ») plutôt qu'un simple statut */
async function getOrExplain<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL.replace(/\/$/, "")}${path}`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw apiErrorOf(j, path, res.status);
  return j as T;
}
/** seuls ces trois champs partent avec une requête signée */
const sig = (s: Signed): Signed => ({ address: s.address, message: s.message, signature: s.signature });

export async function fetchNonce(): Promise<SignInNonce> {
  const res = await fetch(`${API_URL.replace(/\/$/, "")}/auth/nonce`, { cache: "no-store" });
  const j = await res.json().catch(() => ({})) as any;
  // une API d'avant les nonces (route absente) : la phrase du site, dans sa langue, sans préfixe « ArcHive API (404) »
  if (res.status === 404 && typeof j.code !== "string") throw siteError(msg("err.nonce404"), 404);
  if (!res.ok) throw apiErrorOf(j, "/auth/nonce", res.status);
  if (typeof j.nonce !== "string" || typeof j.issuedAt !== "string") throw siteError(msg("err.unreadable", { status: res.status }), res.status);
  return j as SignInNonce;
}
export const fetchMachines = (operator: string) => get<Machine[]>(`/machines?operator=${operator}`);
/** la liste complète de l'opérateur (vrais noms, adresses d'enclave), sur signature de lecture */
export const fetchMachinesSigned = (s: Signed) => send<Machine[]>("/machines/list", sig(s));
/** diagnostic et journaux d'une machine, sur signature de lecture */
export const fetchMachineDetail = (id: string, s: Signed) => send<Machine>(`/machines/${id}/detail`, sig(s));
export const fetchPairing = (code: string) => getOrExplain<{ userCode: string; hostname: string; hostnameHidden?: boolean; mode: string; version: string; expiresAt: number }>(`/pair/${encodeURIComponent(code)}`);
export const approvePairing = (userCode: string, s: Signed) => send<{ ok: boolean; machineId: string; hostname: string }>("/pair/approve", { userCode, ...sig(s) });
export const removeMachine = (id: string, s: Signed) => send<{ ok: boolean }>(`/machines/${id}/remove`, sig(s));
export const fetchOperatorKeys = (address: string) => get<OperatorKey[]>(`/operator/keys?address=${address}`);
/** les clés de l'opérateur avec leurs vrais libellés, sur signature de lecture */
export const fetchOperatorKeysSigned = (s: Signed) => send<OperatorKey[]>("/operator/keys/list", sig(s));
export const createOperatorKey = (label: string, s: Signed) => send<{ key: string; keyId: string; masked: string }>("/operator/keys", { label, ...sig(s) });
export const revokeOperatorKey = (keyId: string, s: Signed) => send<{ ok: boolean }>(`/operator/keys/${keyId}/revoke`, sig(s));

export async function fetchSessions(owner: string): Promise<Session[]> {
  const raw = await get<any[]>(`/sessions/${owner}`);
  return raw.map((s) => ({
    id: B(s.id), productId: B(s.productId), deposit: B(s.deposit), paid: B(s.paid), closed: !!s.closed,
    enclave: s.enclave ?? undefined, operator: s.operator ?? undefined,
    price: s.price !== undefined ? B(s.price) : undefined, expiresAt: s.expiresAt !== undefined ? B(s.expiresAt) : undefined,
    paidUnits: s.paidUnits !== undefined ? B(s.paidUnits) : undefined, verdictWritten: s.verdictWritten,
  }));
}

/** 10/11 : les deux niveaux d'opérateur (GET /levels de l'API). */
export interface LevelsView {
  enabled: boolean;
  contracts?: { machineRegistry: string; proofOfCloudAuditor: string; ed25519Verifier: string; policyEnclaves: string; sealedBountyVerified: string };
  alliance?: { name: string; key: string; peers: string[]; source: string; auditor: string };
  verifiedBounty?: { address: string; canSlash: boolean; slashFrom: number | null };
  enclaves?: {
    signer: string; productId: string; operator: string; ppid: string | null; bindingCurrent: boolean; level: "verified" | "open";
    proofOfCloud: { expiresAt: number; revoked: boolean; lastTokenAt: number } | null; productRequires: "verified" | "open"; meetsProduct: boolean;
  }[];
  products?: { productId: number; requires: "verified" | "open"; auditors: string[]; pending: unknown }[];
}
export async function fetchLevels(): Promise<LevelsView> {
  return get<LevelsView>("/levels");
}
