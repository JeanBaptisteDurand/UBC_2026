// Live data. The ArcHive API is polled every 4 s, the Arc block every second. Nothing is hard-coded: what has not
// been read yet is "unknown", never zero. /activity is read over its last 100 events: the 25 most recent drive the
// wall, the rest are used to find the last real payment.
import { useSyncExternalStore } from 'react'

const env = import.meta.env as Record<string, string | undefined>
const DIRECT_API = (env.VITE_API_URL ?? 'https://archive.62-171-153-35.sslip.io/api').replace(/\/+$/, '')
const DIRECT_RPC = env.VITE_ARC_RPC ?? 'https://rpc.testnet.arc.io'
// The dev and preview servers proxy the API and the Arc RPC on the same origin. A static host without that proxy
// answers 404 or index.html on the first read, and each read then falls back to the direct URL on its own
// (see json() and rpc() below).
export let API = '/jb-api'
export let RPC = '/arc-rpc'
const direct = () => { API = DIRECT_API; RPC = DIRECT_RPC }
export const EXPLORER = 'https://explorer.testnet.arc.io'
export const CONSOLE = env.VITE_CONSOLE_URL ?? 'https://archive.62-171-153-35.sslip.io'

export interface Stats {
  refundedUsdc?: string
  enclaves: number; enclavesActive: number; products: number; productsActive: number; sessions: number
  settlements: number; settledUsdc: string; sessionSettledUsdc: string; x402Calls: number; x402SettledUsdc: string
  verdicts: number; bounties: number; bountyPool: string; bountiesPaid: number; bountyPaidUsdc: string; head: string
}
export interface Enclave {
  x25519?: string; fmspc?: string
  signer: string; operator: string; productId: string; workloadId: string; tcbStatus: number; quoteHash: string
  registeredAt: string; expiresAt: string; active: boolean; anchorBlock: string; fromBlock?: string; untilBlock?: string; head?: string
}
export interface Product {
  id: string; author: string; manifestHash: string; deterministic: boolean; price: string; bpsOperator: number
  bpsAuthor: number; bpsNetwork: number; minBond: string; state: string; manifestURI: string; unitTokens: number
  settlement: string
  /** From /api/products, used by the service page */
  exposureCap?: string; version?: string; activatesAt?: string; outWeight?: number; param?: string
}
export interface Activity { contract: string; name: string; args: Record<string, string>; block: number; logIndex: number; tx: string; label: string }
export interface Proof {
  image: string; manifestURI: string; manifestVerified: boolean
  enclave: Enclave | null; registerTx: string | null; settleTx: string | null; settleUsdc: string | null
  verdictTx: string | null; verdictAgentId: string | null; verdictResponse: number | null; verdictStatus: string | null
  enclaveImage: { imageId: string; composeHash: string; osImageHash: string; tx: string } | null
}
export interface Bounty { id: string; productId: string; balance: string; paidAmount: string; singleCap: string; deadline: string; paused: boolean }

export type Status = 'loading' | 'ok' | 'error'
export interface LiveState {
  status: Status
  stats?: Stats; enclaves?: Enclave[]; products?: Product[]; activity?: Activity[]; proof?: Proof; bounties?: Bounty[]
  block?: number; blockAt?: number
  error?: string
  /** Count of new events since load */
  fresh: Activity[]
}

let state: LiveState = { status: 'loading', fresh: [] }
const subs = new Set<() => void>()
const set = (patch: Partial<LiveState>) => { state = { ...state, ...patch }; subs.forEach((f) => f()) }
export const getLive = () => state
export const subscribeLive = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export function useLive<T>(sel: (s: LiveState) => T): T {
  return useSyncExternalStore(subscribeLive, () => sel(state))
}

async function json<T>(path: string): Promise<T> {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000)
  try {
    // The base is frozen before the call: five reads run together and each must be able to fall back to the direct API on
    // its own when a static host answers index.html (200) instead of the proxy
    const base = API
    let r: Response | null = null
    try { r = await fetch(base + path, { signal: ctl.signal, cache: 'no-store' }) } catch (e) { if (base !== DIRECT_API) { direct(); return json<T>(path) } throw e }
    if (!r.ok || !/json/.test(r.headers.get('content-type') ?? '')) {
      if (base !== DIRECT_API) { direct(); return json<T>(path) }
      throw new Error(`HTTP ${r.status}`)
    }
    return (await r.json()) as T
  } finally { clearTimeout(to) }
}

const seen = new Set<string>()
const keyOf = (a: Activity) => `${a.block}:${a.logIndex}:${a.name}`
let first = true

// One read at a time: on a slow network reads no longer pile up and steal bandwidth from the scene while it loads
let busy = 0
async function poll() {
  if (busy & 1) return
  busy |= 1
  try {
    const [stats, enclaves, products, activity, bounties] = await Promise.all([
      json<Stats>('/stats'), json<Enclave[]>('/enclaves'), json<Product[]>('/products'), json<Activity[]>('/activity?limit=100'),
      json<Bounty[]>('/bounties'),
    ])
    const fresh: Activity[] = []
    for (const a of activity) { const k = keyOf(a); if (!seen.has(k)) { seen.add(k); if (!first) fresh.push(a) } }
    first = false
    set({ status: 'ok', stats, enclaves, products, activity, bounties, error: undefined, fresh: fresh.length ? fresh : state.fresh })
    if (!state.block) set({ block: Number(stats.head), blockAt: Date.now() })
  } catch (e) {
    set({ status: state.stats ? 'ok' : 'error', error: String((e as Error).message || e) })
  } finally { busy &= ~1 }
}

async function pollProof() {
  if (busy & 2) return
  busy |= 2
  try { set({ proof: await json<Proof>('/proof') }) } catch { /* the proof chain keeps its last read */ } finally { busy &= ~2 }
}

async function pollBlock() {
  if (busy & 4) return
  busy |= 4
  try {
    const n = parseInt(await rpc<string>('eth_blockNumber', []), 16)
    if (Number.isFinite(n)) set({ block: n, blockAt: Date.now() })
  } catch { /* the API block stays on screen */ } finally { busy &= ~4 }
}

let started = false
export function startLive() {
  if (started) return
  started = true
  // The block waits for the first API read: it tells whether the proxy exists (otherwise, direct URLs)
  poll().then(() => { if (API === DIRECT_API) RPC = DIRECT_RPC; pollBlock() }); pollProof()
  setInterval(() => { if (!document.hidden) poll() }, 4000)
  setInterval(() => { if (!document.hidden) pollProof() }, 20000)
  setInterval(() => { if (!document.hidden) pollBlock() }, 1000)
}

/** A JSON-RPC call to Arc testnet (proxied in dev, direct when static). */
export async function rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  const base = RPC
  for (const url of base === DIRECT_RPC ? [base] : [base, DIRECT_RPC]) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      if (!r.ok || !/json/.test(r.headers.get('content-type') ?? '')) { if (url !== DIRECT_RPC) RPC = DIRECT_RPC; continue }
      const j = await r.json()
      if (j.error) throw new Error(j.error.message ?? 'rpc error')
      return j.result as T
    } catch (e) { if (url === DIRECT_RPC) throw e }
  }
  throw new Error('rpc unreachable')
}

// Timestamp of a block, read once from the Arc RPC (eth_getBlockByNumber) and cached
const blockTimes = new Map<number, Promise<number | null>>()
export function blockTime(n: number): Promise<number | null> {
  let p = blockTimes.get(n)
  if (!p) {
    p = rpc<{ timestamp: string } | null>('eth_getBlockByNumber', [`0x${n.toString(16)}`, false]).then((b) => (b ? parseInt(b.timestamp, 16) * 1000 : null)).catch(() => { blockTimes.delete(n); return null })
    blockTimes.set(n, p)
  }
  return p
}
/** "6 days ago" / "il y a 6 jours" */
export function ago(ms: number, lang: string) {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  const f = new Intl.RelativeTimeFormat(lang === 'fr' ? 'fr' : 'en', { numeric: 'always' })
  if (s < 3600) return f.format(-Math.max(1, Math.round(s / 60)), 'minute')
  if (s < 86400) return f.format(-Math.round(s / 3600), 'hour')
  return f.format(-Math.round(s / 86400), 'day')
}
