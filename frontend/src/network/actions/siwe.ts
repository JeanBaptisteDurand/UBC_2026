// Operator actions signed with an EIP-4361 message ("Sign-In with Ethereum"), like the console's signin.ts and
// operatorActions.ts: a fresh nonce from the API (single use, 5 minutes), the message for THIS site, the wallet's
// signature. No transaction, no fee. The statements are the API's, in English and ASCII (they must stay identical to
// STATEMENT in services/api/src/operators.ts).
// The API only accepts a message for its own domain (WEB_URL) or an origin in SIGN_ORIGINS: /auth/nonce says so, and
// the page refuses BEFORE asking for a signature that would be refused ("signature not allowed from this address").
import { createSiweMessage } from 'viem/siwe'
import { testnet } from './sdk'
import { arc, UserFacing } from './wallet'
import { apiGet, ApiError, type Nonce } from './jbapi'
import { x } from './strings-x'

export type SignedAction =
  | { kind: 'pair'; code: string }
  | { kind: 'createKey' }
  | { kind: 'revokeKey'; keyId: string }
  | { kind: 'removeMachine'; machineId: string }
  | { kind: 'read' }

export const ACTION_TTL_MS = 5 * 60_000
export const READ_TTL_MS = 10 * 60_000

export function statementOf(a: SignedAction): string {
  switch (a.kind) {
    case 'pair': return `ArcHive: pair the machine showing code ${a.code} with my account`
    case 'createKey': return 'ArcHive: create an operator key (arcop_) that cannot spend funds'
    case 'revokeKey': return `ArcHive: revoke operator key arcop_${a.keyId}`
    case 'removeMachine': return `ArcHive: remove machine ${a.machineId} from my account (its key is revoked)`
    case 'read': return 'ArcHive: read my operator data for 10 minutes (diagnostics, logs, machine and key names)'
  }
}

export interface Signed { address: string; message: string; signature: string }

/** The nonce, and the refusal before signing if the API does not recognize this site. */
export async function nonceForThisSite(): Promise<Nonce> {
  let n: Nonce
  try { n = await apiGet<Nonce>('/auth/nonce') } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new UserFacing(x('e.noNonce'), 'offline')
    throw e
  }
  if (typeof n.nonce !== 'string' || typeof n.issuedAt !== 'string') throw new UserFacing(x('e.apiRefused', { why: 'nonce' }), 'other')
  if (n.domain && n.domain !== location.host) throw new UserFacing(x('e.wrongSite', { site: n.domain }), 'wrongSite')
  return n
}

export async function signAction(action: SignedAction): Promise<Signed & { expiresAt: number }> {
  const a = arc()
  const address = a.account!.address
  const n = await nonceForThisSite()
  const issuedAt = new Date(n.issuedAt)
  if (!Number.isFinite(issuedAt.getTime())) throw new UserFacing(x('e.apiRefused', { why: 'issuedAt' }), 'other')
  const expirationTime = new Date(issuedAt.getTime() + (action.kind === 'read' ? READ_TTL_MS : ACTION_TTL_MS))
  const message = createSiweMessage({
    domain: location.host, uri: location.origin, address, chainId: testnet.chainId, version: '1',
    nonce: n.nonce, issuedAt, expirationTime, statement: statementOf(action),
  })
  const signature = await a.wallet!.signMessage({ account: a.account!, message })
  return { address, message, signature, expiresAt: expirationTime.getTime() }
}

// ---------- reserved read: one signature, 10 minutes, kept in memory (readAccess.ts) ----------
const MARGIN_MS = 30_000
let held: { signed: Signed; expiresAt: number } | null = null
let pending: Promise<Signed> | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((f) => f())
export const onReadAccess = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }

export function readSignature(address?: string | null): Signed | null {
  if (!held || !address || held.signed.address.toLowerCase() !== address.toLowerCase()) return null
  return Date.now() < held.expiresAt - MARGIN_MS ? held.signed : null
}
export function requestReadAccess(address: string): Promise<Signed> {
  const have = readSignature(address)
  if (have) return Promise.resolve(have)
  pending ??= signAction({ kind: 'read' }).then(({ expiresAt, ...signed }) => {
    held = { signed, expiresAt }
    setTimeout(notify, Math.max(0, expiresAt - MARGIN_MS - Date.now()) + 50)
    notify()
    return signed
  }).finally(() => { pending = null })
  return pending
}
export function dropReadAccess() { held = null; notify() }
