// The API as seen by the actions, without viem: JSON reads and posts, and an honest wording of what does not respond.
// An API refusal keeps its stable code (wrong_site, signature_used…) and its message; a request without a response is
// diagnosed (origin refused by CORS, or service offline), never presented as a success.
import { API } from '../../data/live'
import { diagnose, isNetErr } from '../../data/endpoints'
import { x } from './strings-x'

/** An API refusal (status, stable code, API message) or a missing response (kind). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly kind: 'refused' | 'offline' | 'cors' = 'refused') {
    super(message); this.name = 'ApiError'
  }
}

const base = () => API.replace(/\/+$/, '')

async function unreachable(path: string, e: unknown): Promise<never> {
  if (!isNetErr(e) && (e as Error)?.name !== 'TimeoutError' && (e as Error)?.name !== 'AbortError') throw e
  const d = await diagnose(`${base()}/health`)
  if (d === 'cors') throw new ApiError(x('e.apiCors'), 0, 'cors', 'cors')
  throw new ApiError(x('e.apiOffline', { path }), 0, 'offline', 'offline')
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response
  try { r = await fetch(base() + path, { cache: 'no-store', signal: AbortSignal.timeout(20_000), ...init }) } catch (e) { return unreachable(path, e) }
  const j = (await r.json().catch(() => null)) as (T & { code?: string; error?: string }) | null
  if (!r.ok || j === null) {
    if (r.status === 502 || r.status === 503 || r.status === 504) throw new ApiError(x('e.apiOffline', { path }), r.status, 'offline', 'offline')
    const code = typeof j?.code === 'string' ? j.code : undefined
    const said = typeof j?.error === 'string' ? j.error : `HTTP ${r.status}`
    throw new ApiError(code && CODE[code] ? x(CODE[code]) : x('e.apiRefused', { why: said }), r.status, code)
  }
  return j
}

/** API refusal codes (services/api/src/operators.ts) that have a site message. */
const CODE: Record<string, Parameters<typeof x>[0]> = {
  wrong_site: 'e.wrongSite', signature_used: 'e.sigSpent', signature_expired: 'e.sigSpent', nonce_unknown: 'e.sigSpent',
  nonce_expired: 'e.sigSpent', bad_signature: 'e.sigBad', code_unknown: 'e.codeUnknown', pair_already_approved: 'e.pairTaken',
  not_owner: 'e.notOwner', rate_limited: 'e.rate',
}
const SPENT = new Set(['signature_used', 'signature_expired', 'nonce_unknown', 'nonce_expired', 'bad_signature'])
export const isSignatureSpent = (e: unknown) => e instanceof ApiError && (e.code ? SPENT.has(e.code) : e.status === 401 || e.status === 409)

export const apiGet = <T>(path: string) => call<T>(path)
export const apiPost = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// ---------- API views (web/src/api.ts) ----------
export interface MachineCheck { id: string; label: string; ok: boolean; detail: string }
export interface Machine {
  machineId: string; operator: string; hostname: string; mode: string; version: string; productId: string | null
  enclaveUrl: string | null; signer: string | null; status: string; online: boolean; lastSeen: number | null
  doctorOk: boolean | null; registered: boolean; failing?: string[]; hostnameHidden?: boolean; restricted?: boolean
  doctor?: { ok: boolean; checks: MachineCheck[] } | null; logs?: string[]
  pairedBy?: 'code' | 'key' | null; approvedBy?: string | null; viaKey?: string | null; pairedAt?: number | null
}
export interface OperatorKey { keyId: string; label: string; machineId: string | null; createdAt: number; lastUsedAt: number | null; revoked: boolean; restricted?: boolean }
export interface SessionRow {
  id: string; productId: string; deposit: string; paid: string; closed: boolean
  enclave?: string; operator?: string; price?: string; expiresAt?: string; paidUnits?: string; verdictWritten?: boolean
}
export interface Nonce { nonce: string; issuedAt: string; expiresAt?: string; domain?: string; uri?: string; chainId?: number }
