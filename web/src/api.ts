/** api.ts — reads state through the ArcHive HTTP API instead of bursts of RPC reads in the browser.
 *  The API reads the chain once on the server (cached); this file revives the bigints of the SDK views (v2.1 stack:
 *  enclave validity windows in blocks, bounty tiers already paid, the enclave and price locked by each session). */
import type { EnclaveView, ProductView, BountyRow } from "@arcvault/sdk";
import { API_URL } from "./config";
import { msg, show, type Msg } from "./msg";

/** A session of the connected address. The enclave, the operator, the price and the expiry are locked when it opens
 *  (optional fields: older API responses omit them). */
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
/** Revives the named fields as bigints (decimal strings in the API's JSON). */
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

/** The state of an enclave key as reported by the API (active, withdrawn by its operator, invalidated, expired); absent
 *  from older API responses. */
export type EnclaveStatus = "active" | "retired" | "invalidated" | "expired";
export type Enclave = EnclaveView & { status?: EnclaveStatus; statusReason?: string };

export async function fetchEnclaves(): Promise<Enclave[]> {
  const raw = await get<any[]>("/enclaves");
  return raw.map((e) => ({
    ...bigs<EnclaveView>(e, ["productId", "expiresAt", "fromBlock", "untilBlock", "anchorBlock", "registeredAt"]),
    head: e.head !== undefined ? B(e.head) : undefined, tcbStatus: Number(e.tcbStatus), active: !!e.active,
    status: typeof e.status === "string" ? e.status as EnclaveStatus : undefined, statusReason: e.statusReason ?? undefined,
  }));
}

/** A bounty at one of the TWO levels: open (SealedBounty) or verified (SealedBountyVerified, product 7). Numbers exist
 *  at both levels (open #2 and verified #2), so a bounty is identified by its level AND its number.
 *  `paidOut`: the USDC actually paid (the sum of BountyPaid); `paidAmount` is the on-chain field (the tier reserved or
 *  paid since arming), which stays at 0.5 after a REFUTED claim: it proves no payment. */
export type BountyLevel = "open" | "verified";
export type Bounty = BountyRow & {
  level: BountyLevel; contract: string; address?: string;
  /** null: an older API without this field (nothing is then shown as paid) */
  paidOut: bigint | null; claimsAccepted: number; claimsRefuted: number;
};
export const bountyKey = (b: Pick<Bounty, "level" | "id">) => `${b.level}:${b.id.toString()}`;

export async function fetchBounties(): Promise<Bounty[]> {
  const raw = await get<any[]>("/bounties?level=all");
  return raw.map((b) => ({
    ...bigs<BountyRow>(b, ["id", "productId", "balance", "deadline", "singleCap", "paidAmount", "lastPaidBlock", "pausedFromBlock"]),
    k: Number(b.k ?? 1), paused: !!b.paused,
    level: b.level === "verified" ? "verified" : "open", contract: String(b.contract ?? "SealedBounty"), address: b.address ?? undefined,
    paidOut: b.paidOut !== undefined ? B(b.paidOut) : null, claimsAccepted: Number(b.claimsAccepted ?? 0), claimsRefuted: Number(b.claimsRefuted ?? 0),
  }));
}

/** /stats. `settledUsdc`: everything settled (sessions + x402 calls); older API responses omit the optional fields
 *  (v2.1 stack: paid x402 calls counted apart, skipped or not-applicable verdicts). */
export interface Stats {
  enclaves: number; enclavesActive: number; products: string; productsActive?: number; sessions: number; settlements: number;
  settledUsdc: string; refundedUsdc: string; x402Calls: number; verdicts: number;
  bounties: number; bountyPool: string; bountiesPaid: number; bountyPaidUsdc: string; head: string;
  sessionSettledUsdc?: string; x402SettledUsdc?: string; verdictsSkipped?: number; verdictsNotApplicable?: number;
  /** bounties at both levels, the ones that can be hunted now, refuted claims, seized bonds */
  bountiesOpen?: number; claimsRefuted?: number; bondSlashedUsdc?: string;
}
/** An event from /activity; `label`: its English label from the API, while the site writes its own in its language. */
export interface ActivityEvent { contract: string; name: string; args: Record<string, string | number>; block: number; tx: string; ts?: string; logIndex?: number; label?: string }
/** The outcome of the ERC-8004 verdict of the session shown by the proof chain; "no_verdict_rail": a product whose rail
 *  writes no verdict (a paid x402 call, a free product). */
export type VerdictStatus = "written" | "not_applicable" | "skipped" | "none" | "pending" | "no_verdict_rail";
/** The settlement rail of the product of the enclave shown. */
export type ProofRail = "session" | "x402" | "bounty" | "free" | "other";
export interface Proof {
  /** The image shown at link 1: the one from the author's manifest, but only if `manifestVerified` (the keccak256 of the
   *  manifest equals the on-chain manifestHash); otherwise the API's default image, which proves nothing. */
  image: string; manifestURI?: string; manifestVerified?: boolean; imageSource?: "manifest" | "deployments" | "unknown";
  enclave: (Omit<EnclaveView, "productId" | "expiresAt"> & { productId: string; expiresAt: string; status?: EnclaveStatus }) | null;
  registerTx: string | null; settleTx: string | null; settleUsdc: string | null; settleSession: string | null;
  rail?: ProofRail | null; settleBounty?: string | null; settleLevel?: BountyLevel | null;
  verdictTx: string | null; verdictAgentId: string | null; verdictResponse: number | null;
  verdictSession?: string | null; verdictStatus?: VerdictStatus | null; verdictStatusTx?: string | null;
  verdictReason?: string | null; verdictReasonData?: string | null; verdictSalted?: boolean | null;
  enclaveImage?: { imageId: string; composeHash: string; osImageHash: string; tx: string } | null;
  index?: IndexStatus;
}
export interface IndexStatus { lastBlock: number; head: number; lagBlocks: number | null; events: number; syncing: boolean; lastSyncAt: number | null; lastError: string | null; fromBlock?: number }
export const fetchStats = () => get<Stats>("/stats");
export const fetchActivity = (limit = 12) => get<ActivityEvent[]>(`/activity?limit=${limit}`);
/** the proof chain of the inference enclave, or of a given enclave key (?signer=) */
export const fetchProof = (signer?: string) => get<Proof>(signer ? `/proof?signer=${signer}` : "/proof");

// ---------- operators: machines, pairing, arcop_ keys ----------
export interface MachineCheck { id: string; label: string; ok: boolean; detail: string }
/** A machine as seen by the API. Without a signed read (`restricted`): no name (`hostnameHidden`), no http://IP address,
 *  no diagnostics and no logs; with the read signature: everything (details: diagnostics and logs). */
export interface Machine {
  machineId: string; operator: string; hostname: string; mode: string; version: string; productId: string | null;
  enclaveUrl: string | null; signer: string | null; status: string; online: boolean; lastSeen: number | null;
  doctorOk: boolean | null; registered: boolean; failing?: string[]; hostnameHidden?: boolean; restricted?: boolean;
  doctor?: { ok: boolean; checks: MachineCheck[] } | null; logs?: string[];
  /** Explicit origin: "code" = paired by code (the account confirmed on the machine), "key" = added or taken over with a
   *  free arcop_ key; null or absent: a machine registered before this field existed (the site infers it). */
  pairedBy?: "code" | "key" | null;
  /** the address that approved it (the account's), and the free key (keyId) of a "key" machine */
  approvedBy?: string | null; viaKey?: string | null; pairedAt?: number | null;
}
/** `restricted`: the public view (generic label); the real labels require the signed read */
export interface OperatorKey { keyId: string; label: string; machineId: string | null; createdAt: number; lastUsedAt: number | null; revoked: boolean; restricted?: boolean }
/** A wallet signature on an EIP-4361 message (signin.ts): what the API verifies. */
export type Signed = { address: string; message: string; signature: string };
/** Nonce from GET /auth/nonce: single use, 5 minutes; "Issued At" takes issuedAt. */
export interface SignInNonce { nonce: string; issuedAt: string; expiresAt: string; domain?: string; uri?: string; chainId?: number }

/** An API error: its HTTP status, its stable code and its values (the site translates from them: errors.ts), and its
 *  text (the API's own sentence; or, when `localized`, a sentence written by the site, put back into words in the
 *  current language when it is displayed). */
export class ApiError extends Error {
  constructor(
    message: string, readonly status: number, readonly code?: string,
    readonly params: Record<string, unknown> = {}, readonly localized: Msg | null = null,
  ) { super(message); this.name = "ApiError"; }
}
/** An error whose sentence is the site's (not the API's). */
const siteError = (m: Msg, status: number) => new ApiError(show(m), status, undefined, {}, m);
/** The error of an API response ({ error, code, params }); an older API without codes only sends `error`. */
function apiErrorOf(j: any, path: string, status: number): ApiError {
  const code = typeof j?.code === "string" ? j.code : undefined;
  const params = j?.params && typeof j.params === "object" && !Array.isArray(j.params) ? j.params : {};
  return new ApiError(typeof j?.error === "string" ? j.error : `api ${path}: ${status}`, status, code, params);
}
/** The signature is no longer accepted (expired, already used, or the API restarted): sign again. */
const SPENT = new Set(["signature_used", "signature_expired", "nonce_unknown", "nonce_expired", "bad_signature"]);
export const isSignatureSpent = (e: unknown) =>
  e instanceof ApiError && (e.code ? SPENT.has(e.code) : e.status === 401 || e.status === 409);

async function send<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw apiErrorOf(j, path, res.status);
  return j as T;
}
/** A GET whose refusal carries the API's message ("unknown or expired code…") rather than a bare status */
async function getOrExplain<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL.replace(/\/$/, "")}${path}`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw apiErrorOf(j, path, res.status);
  return j as T;
}
/** only these three fields are sent with a signed request */
const sig = (s: Signed): Signed => ({ address: s.address, message: s.message, signature: s.signature });

export async function fetchNonce(): Promise<SignInNonce> {
  const res = await fetch(`${API_URL.replace(/\/$/, "")}/auth/nonce`, { cache: "no-store" });
  const j = await res.json().catch(() => ({})) as any;
  // an older API without nonces (route missing): the site's sentence, in its language, without the "ArcHive API (404)" prefix
  if (res.status === 404 && typeof j.code !== "string") throw siteError(msg("err.nonce404"), 404);
  if (!res.ok) throw apiErrorOf(j, "/auth/nonce", res.status);
  if (typeof j.nonce !== "string" || typeof j.issuedAt !== "string") throw siteError(msg("err.unreadable", { status: res.status }), res.status);
  return j as SignInNonce;
}
export const fetchMachines = (operator: string) => get<Machine[]>(`/machines?operator=${operator}`);
/** the operator's full list (real names, enclave addresses), behind a read signature */
export const fetchMachinesSigned = (s: Signed) => send<Machine[]>("/machines/list", sig(s));
/** a machine's diagnostics and logs, behind a read signature */
export const fetchMachineDetail = (id: string, s: Signed) => send<Machine>(`/machines/${id}/detail`, sig(s));
export const fetchPairing = (code: string) => getOrExplain<{ userCode: string; hostname: string; hostnameHidden?: boolean; mode: string; version: string; expiresAt: number }>(`/pair/${encodeURIComponent(code)}`);
export const approvePairing = (userCode: string, s: Signed) => send<{ ok: boolean; machineId: string; hostname: string }>("/pair/approve", { userCode, ...sig(s) });
export const removeMachine = (id: string, s: Signed) => send<{ ok: boolean }>(`/machines/${id}/remove`, sig(s));
export const fetchOperatorKeys = (address: string) => get<OperatorKey[]>(`/operator/keys?address=${address}`);
/** the operator's keys with their real labels, behind a read signature */
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

/** The two operator levels (GET /levels on the API). */
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
