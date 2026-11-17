// Rent: bond, pairing by code, admission, like the console's Operator screen
// (web/src/screens/Operator.tsx, operatorActions.ts, signin.ts, api.ts):
// - bond: the SDK's arc.bond(amount, "auth"), i.e. an EIP-3009 authorization (ReceiveWithAuthorization to
//   OperatorBond) signed by the wallet, then ONE OperatorBond.bond(amount, authorization) transaction, simulated first;
// - pairing: an EIP-4361 message ("Sign-In with Ethereum") naming the code, with a fresh nonce from the API, signed by
//   the wallet (no transaction), then POST /pair/approve. The API only accepts messages made for its own site: the
//   page reads this from /auth/nonce and says so BEFORE asking for a signature that would be refused;
// - admission: the enclaves registered by the connected address, read live (EnclaveRegistry through the API).
import type { Address, Hex } from 'viem'
import { createSiweMessage } from 'viem/siwe'
import { operatorBondAbi, testnet } from './sdk'
import { arc, needFunds, publicClient, waitOk, UserFacing } from './wallet'
import { API } from '../../data/live'
import { w } from './strings'

/** An operator's bond, read from OperatorBond: total, available (excluding a requested withdrawal), free (excluding the
 *  reserves of registered enclaves), the pending withdrawal and when it becomes withdrawable (the console's Operator.tsx). */
export interface BondRead { bond: bigint; free: bigint; available: bigint; pending: bigint; withdrawableAt: bigint }
export async function readBond(op: Address): Promise<BondRead> {
  const pub = publicClient()
  const rd = (functionName: string) => pub.readContract({ address: testnet.operatorBond, abi: operatorBondAbi, functionName: functionName as 'bondOf', args: [op] }) as Promise<bigint>
  const [bond, free, available, at] = await Promise.all([rd('bondOf'), rd('freeBond'), rd('availableBond'), rd('withdrawableAt').catch(() => 0n)])
  return { bond, free, available, pending: bond > available ? bond - available : 0n, withdrawableAt: BigInt(at) }
}

/** Requests the withdrawal of part of the free bond: the OperatorBond delay then runs (requestUnbond). */
export async function requestUnbond(amount: bigint, on: { signing?: () => void; sent?: (h: Hex) => void } = {}): Promise<Hex> {
  const a = arc()
  const { free } = await readBond(a.account!.address)
  if (amount > free) throw new UserFacing(w('r.unbondTooMuch', { amt: (Number(free) / 1e6).toString() }), 'other')
  on.signing?.()
  const h = await a.requestUnbond(amount)
  on.sent?.(h)
  await waitOk(h)
  return h
}

/** Withdraws the requested bond once the delay has passed (withdraw). */
export async function withdrawBond(on: { signing?: () => void; sent?: (h: Hex) => void } = {}): Promise<Hex> {
  const a = arc()
  on.signing?.()
  const h = await a.withdrawBond()
  on.sent?.(h)
  await waitOk(h)
  return h
}

/** "4", "0.5", "0,5" in 6-decimal units (the console's parseUsdc). */
export function parseUsdc(v: string): bigint {
  const s = v.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new UserFacing(w('r.badAmount'), 'other')
  const [i, f = ''] = s.split('.')
  const out = BigInt(i) * 1_000_000n + BigInt((f + '000000').slice(0, 6))
  if (out <= 0n) throw new UserFacing(w('r.badAmount'), 'other')
  return out
}

/** The console's doBond: arc.bond(amount, "auth"), then wait for the block. */
export async function lockBond(amount: bigint, on: { signing?: () => void; sent?: (h: Hex) => void }): Promise<Hex> {
  const a = arc()
  await needFunds(amount)
  on.signing?.()
  // the SDK signs the EIP-3009 authorization, simulates bond(amount, auth), then asks the wallet for the transaction
  const hash = await a.bond(amount, 'auth')
  on.sent?.(hash)
  await waitOk(hash)
  return hash
}

// ---------- pairing ----------
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
/** The API's normCode: HIVE-XXXX-XXXX, or null. */
export function normCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s_]+/g, '')
  const m = s.match(/^(?:HIVE-?)?([A-Z0-9]{4})-?([A-Z0-9]{4})$/)
  if (!m) return null
  for (const ch of m[1] + m[2]) if (!ALPHA.includes(ch)) return null
  return `HIVE-${m[1]}-${m[2]}`
}
/** The exact statement the API expects (the console's signin.ts, the API's STATEMENT.pair). */
export const pairStatement = (code: string) => `ArcHive: pair the machine showing code ${code} with my account`

interface Nonce { nonce: string; issuedAt: string; domain?: string; uri?: string }
async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; j: T & { code?: string; error?: string } }> {
  const r = await fetch(API.replace(/\/$/, '') + path, { cache: 'no-store', ...init })
  return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }
}

/** The console's buildSignIn: the 11-line EIP-4361 message, for THIS site, expiring in 5 minutes. */
export function buildPairMessage(p: { domain: string; uri: string; address: Address; code: string; nonce: string; issuedAt: string }) {
  const issuedAt = new Date(p.issuedAt)
  return createSiweMessage({
    domain: p.domain, uri: p.uri, address: p.address, chainId: testnet.chainId, version: '1', nonce: p.nonce,
    issuedAt, expirationTime: new Date(issuedAt.getTime() + 5 * 60_000), statement: pairStatement(p.code),
  })
}

export type PairResult = { kind: 'paired'; host: string } | { kind: 'wrongSite'; site: string; consoleUrl: string }
export async function pairMachine(raw: string, on: { signing?: () => void }): Promise<PairResult> {
  const code = normCode(raw)
  if (!code) throw new UserFacing(w('r.badCode'), 'other')
  const a = arc()
  const address = a.account!.address
  // does the code exist? (public read, like the console before offering the signature)
  const look = await api<unknown>(`/pair/${encodeURIComponent(code)}`)
  if (!look.ok) throw new UserFacing(look.status === 404 ? w('r.codeUnknown') : w('e.other', { why: look.j.error ?? `HTTP ${look.status}` }), 'other')
  const n = await api<Nonce>('/auth/nonce')
  if (!n.ok || typeof n.j.nonce !== 'string') throw new UserFacing(w('e.net', { why: `HTTP ${n.status}` }), 'net')
  const host = location.host
  if (n.j.domain && n.j.domain !== host) {
    // the API would refuse the signature (wrong_site): do not ask for it
    return { kind: 'wrongSite', site: n.j.domain, consoleUrl: `${n.j.uri ?? ''}/#/operator?code=${code}` }
  }
  const message = buildPairMessage({ domain: host, uri: location.origin, address, code, nonce: n.j.nonce, issuedAt: n.j.issuedAt })
  on.signing?.()
  const signature = await a.wallet!.signMessage({ account: a.account!, message })
  const r = await api<{ hostname?: string }>('/pair/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userCode: code, address, message, signature }) })
  if (!r.ok) {
    if (r.j.code === 'wrong_site') return { kind: 'wrongSite', site: n.j.domain ?? '', consoleUrl: `${n.j.uri ?? ''}/#/operator?code=${code}` }
    throw new UserFacing(r.status === 404 ? w('r.codeUnknown') : w('e.other', { why: r.j.error ?? `HTTP ${r.status}` }), 'other')
  }
  return { kind: 'paired', host: r.j.hostname ?? '' }
}
