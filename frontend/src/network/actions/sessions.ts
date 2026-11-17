// Prepaid sessions (SessionPay), ported from the console (web/src/screens/Chat.tsx and Keys.tsx):
// - opening: the key of the enclave served at this address is checked against the chain, then ONE openSession
//   transaction whose deposit is an EIP-3009 authorization; the session is locked to that enclave;
// - conversation: the SDK inference client encrypts each request for the verified enclave and checks each signed
//   receipt; a 402 means a top-up is needed (topUp, EIP-3009), and the already computed response is delivered without
//   rerunning the model (retryPending);
// - aek_ keys: the session private key, encoded for the CLI and the proxy, shown once; rotation (rotateKey) and
//   closing (closeSession, with what became of the ERC-8004 verdict).
import { decodeErrorResult, parseAbi, parseEventLogs, type Hex, type Log } from 'viem'
import {
  arcErrorsAbi, createInferenceClient, encodeAek, generateSessionKey, maskAek, serializeReceipt, testnet,
  type ChatMessage, type Completion, type InferenceClient, type Receipt, type ReceiptVerification, type SessionKey,
} from './sdk'
import { arc, needFunds, requireSecure, waitOk, UserFacing } from './wallet'
import { apiGet, type SessionRow } from './jbapi'
import { x } from './strings-x'

export { maskAek, serializeReceipt }
export type { ChatMessage, Completion, Receipt, ReceiptVerification }

export interface OpenedSession { id: bigint; enclave: string; operator: string; expiresAt: bigint; tx: Hex; aek: string; key: SessionKey; url: string }

/** Opens a session locked to the enclave served by `url` (its key checked on Arc first). */
export async function openSession(o: { productId: bigint; deposit: bigint; url: string; hours?: number; enclave?: `0x${string}`; operator?: `0x${string}` }, on: { sent?: (tx: Hex, id: bigint) => void } = {}): Promise<OpenedSession> {
  requireSecure()
  const a = arc()
  await needFunds(o.deposit)
  const r = await a.openSession({
    productId: o.productId, deposit: o.deposit, enclaveUrl: o.url, enclave: o.enclave, operator: o.operator,
    ...(o.hours ? { expiresInSeconds: Math.round(o.hours * 3600) } : {}),
  })
  on.sent?.(r.tx, r.sessionId)
  await waitOk(r.tx)
  return { id: r.sessionId, enclave: r.enclave, operator: r.operator, expiresAt: r.expiresAt, tx: r.tx, aek: encodeAek('arctest', r.sessionId, r.sessionKey.privateKey), key: r.sessionKey, url: o.url }
}

/** The client of a session opened here (the session key never leaves the page). */
export function inferenceClient(s: OpenedSession): InferenceClient {
  requireSecure()
  return createInferenceClient({ enclaveUrl: s.url, sessionId: s.id, sessionKey: s.key, publicClient: arc().pub as never })
}

/** Top-up (EIP-3009) of an open session. */
export async function topUp(id: bigint, amount: bigint): Promise<Hex> {
  const a = arc()
  await needFunds(amount)
  const h = await a.topUp(id, amount)
  await waitOk(h)
  return h
}

/** New session key: the old aek_ is void; the new one is returned only once. */
export async function rotateKey(id: bigint): Promise<{ tx: Hex; aek: string }> {
  const a = arc()
  const k = generateSessionKey()
  const h = await a.rotateKey(id, k.address)
  await waitOk(h)
  return { tx: h, aek: encodeAek('arctest', id, k.privateKey) }
}

const CLOSE_EVENTS = parseAbi([
  'event Recorded(uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string tag)',
  'event VerdictNotApplicable(uint256 indexed sessionId)',
  'event VerdictSkipped(bytes32 indexed requestHash, bytes reason)',
])
const REASON_ABI = [...arcErrorsAbi, ...parseAbi(['error AlreadyRecorded()'])]
function skipReason(data: unknown): string {
  if (typeof data !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(data)) return '?'
  if (data === '0x') return 'revert'
  try { const d = decodeErrorResult({ abi: REASON_ABI as never, data: data as Hex }); return `${d.errorName}(${(d.args ?? []).map(String).join(', ')})` } catch { return data.slice(0, 10) }
}
/** The console's closeOutcome: what became of the closed session's ERC-8004 verdict. */
function closeOutcome(logs: readonly Log[]): { outcome: 'written' | 'not_applicable' | 'skipped' | 'none'; reason?: string } {
  const at = (addr: string) => (l: Log) => l.address.toLowerCase() === addr.toLowerCase()
  const pay = parseEventLogs({ abi: CLOSE_EVENTS, logs: logs.filter(at(testnet.sessionPay)) as Log[] })
  const log = parseEventLogs({ abi: CLOSE_EVENTS, logs: logs.filter(at(testnet.verdictLog)) as Log[] })
  if (pay.some((e) => e.eventName === 'VerdictNotApplicable')) return { outcome: 'not_applicable' }
  if (log.some((e) => e.eventName === 'Recorded')) return { outcome: 'written' }
  const skip = pay.find((e) => e.eventName === 'VerdictSkipped') as { args: { reason: Hex } } | undefined
  if (skip) return { outcome: 'skipped', reason: skipReason(skip.args.reason) }
  return { outcome: 'none' }
}

/** Close: only after expiry plus grace (or earlier if the enclave can no longer settle), like the console. */
export async function closeSession(id: bigint): Promise<{ tx: Hex; outcome: string; reason?: string }> {
  const a = arc()
  const c = await a.sessionClosability(id)
  if (!c.closableNow) throw new UserFacing(x('s.tooEarly', { when: new Date(Number(c.atTime) * 1000).toLocaleString() }), 'other')
  const h = await a.closeSession(id)
  const rcpt = await waitOk(h)
  return { tx: h, ...closeOutcome(rcpt.logs) }
}

/** Checks a receipt on Arc, exactly as SessionPay.settle will (reads only). */
export function verifyReceipt(r: Receipt, sig: Hex): Promise<ReceiptVerification> { return arc().verifyReceipt(r, sig) }

/** The address's sessions, read through the API (GET /sessions/:owner). */
export function fetchSessions(owner: string): Promise<SessionRow[]> { return apiGet<SessionRow[]>(`/sessions/${owner}`) }
