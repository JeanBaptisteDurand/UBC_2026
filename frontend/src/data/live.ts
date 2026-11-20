// Live data. The ArcHive API is polled every 4 s, the Arc block every second. Nothing is hard-coded: what has not
// been read yet is "unknown", never zero. /activity is read over its last 100 events: the 25 most recent drive the
// wall, the rest are used to find the last real payment.
import { useSyncExternalStore } from 'react'
import type { ChainState } from './onchain'

import { API_DIRECT, RPC_DIRECT, PROFILE, CONSOLE as CONSOLE_URL, EXPLORER as EXPLORER_URL, setRelay } from './endpoints'

// Addresses come from data/endpoints.ts (one configuration, several build profiles). "relay" profile (dev, previews):
// the app server proxy first (/jb-api, /arc-rpc), then the direct URL if the host has no proxy (json() and rpc() fall
// back on their own). "jb" and "ext" profiles: direct URLs from the start.
const DIRECT_API = API_DIRECT
const DIRECT_RPC = RPC_DIRECT
export let API = PROFILE === 'relay' ? '/jb-api' : DIRECT_API
export let RPC = PROFILE === 'relay' ? '/arc-rpc' : DIRECT_RPC
const direct = () => { API = DIRECT_API; RPC = DIRECT_RPC; setRelay(false) }
export const EXPLORER = EXPLORER_URL
export const CONSOLE = CONSOLE_URL
/** Operator agent install script: a full URL, even when the console is served under a relative path
 *  (VITE_CONSOLE_URL=/console); install.sh then downloads archive-node.mjs from the site root */
export const INSTALL_URL = (import.meta.env as Record<string, string | undefined>).VITE_INSTALL_URL ?? 'https://arc-hive.xyz/install.sh'

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
export interface Bounty {
  id: string; productId: string; balance: string; paidAmount: string; singleCap: string; deadline: string; paused: boolean
  /** From /api/bounties (SDK BountyRow) */
  protocol?: string; predicateHash?: string; k?: number; lastPaidBlock?: string; pausedFromBlock?: string; targetToPause?: string
}
/** GET /levels: the two operator levels */
export interface LevelEnclave {
  signer: string; productId: string; operator: string; ppid: string | null; bindingCurrent: boolean; level: 'verified' | 'open'
  proofOfCloud: { expiresAt: number; revoked: boolean; lastTokenAt: number } | null; productRequires: 'verified' | 'open'; meetsProduct: boolean
}
export interface Levels {
  enabled: boolean
  contracts?: { machineRegistry: string; proofOfCloudAuditor: string; ed25519Verifier: string; policyEnclaves: string; sealedBountyVerified: string }
  alliance?: { name: string; key: string; peers: string[]; source: string; auditor: string }
  verifiedBounty?: { address: string; canSlash: boolean; slashFrom: number | null }
  enclaves?: LevelEnclave[]
  products?: { productId: number; requires: 'verified' | 'open'; auditors: string[]; pending: unknown }[]
}
export type { ChainState } from './onchain'

export type Status = 'loading' | 'ok' | 'error'
export interface LiveState {
  status: Status
  stats?: Stats; enclaves?: Enclave[]; products?: Product[]; activity?: Activity[]; proof?: Proof; bounties?: Bounty[]
  /** /levels: undefined until read, null if the API does not provide it (missing route, error) */
  levels?: Levels | null
  /** Actual state of enclaves and operators, read on Arc (onchain.ts); absent until read */
  chain?: ChainState
  block?: number; blockAt?: number
  error?: string
  /** New events since load */
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
    // the API's head block, when it is newer than the last one read on Arc (touch screens read the block from here; the
    // number never goes back)
    const head = Number(stats.head)
    if (Number.isFinite(head) && head > (state.block ?? 0)) set({ block: head, blockAt: Date.now() })
    pollChain(enclaves)
  } catch (e) {
    set({ status: state.stats ? 'ok' : 'error', error: String((e as Error).message || e) })
  } finally { busy &= ~1 }
}

// Actual state of enclaves and operators in a single eth_call (Multicall3): on the first read, then every 60 s, or 10 s
// after the enclave list changes (or a failure); never on every 4 s read, as the public Arc RPC answers bursts with 429
let chainKey = '', chainAt = 0
function pollChain(enclaves: Enclave[]) {
  if (busy & 8 || !enclaves.length) return
  const key = enclaves.map((e) => `${e.signer}:${e.operator}:${e.active}`).join()
  if (Date.now() - chainAt < (key === chainKey ? 60000 : 10000)) return
  busy |= 8
  chainAt = Date.now()
  import('./onchain')
    .then(({ readChainState }) => readChainState(enclaves.map((e) => e.signer), enclaves.map((e) => e.operator)))
    .then((chain) => { chainKey = key; set({ chain }) })
    .catch(() => { /* the previous read stays */ })
    .finally(() => { busy &= ~8 })
}

async function pollProof() {
  if (busy & 2) return
  busy |= 2
  try { set({ proof: await json<Proof>('/proof') }) } catch { /* the proof chain keeps its last read */ } finally { busy &= ~2 }
}

async function pollBlock() {
  // after an HTTP 429 from Arc's public RPC, the block waits (the API head keeps it moving): the quota of a shared
  // network goes to the reads that matter (the Arc check, the proof chain)
  if (busy & 4 || Date.now() < rpcCool) return
  busy |= 4
  try {
    const n = parseInt(await rpc<string>('eth_blockNumber', [], 0), 16)
    if (Number.isFinite(n) && n > (state.block ?? 0)) set({ block: n, blockAt: Date.now() })
  } catch { /* the API block stays on screen */ } finally { busy &= ~4 }
}

async function pollLevels() {
  // its own busy bit (16): bit 8 is the chain poll's, sharing it let one silence the other
  if (busy & 16) return
  busy |= 16
  try { set({ levels: await json<Levels>('/levels') }) } catch { if (state.levels === undefined) set({ levels: null }) } finally { busy &= ~16 }
}

let started = false
/** levels: also read /levels (app pages; the landing does not use it) */
export function startLive(o: { levels?: boolean } = {}) {
  if (started) return
  started = true
  const lv = !!o.levels
  // The block waits for the first API read: it tells whether the proxy exists (otherwise, direct URLs)
  poll().then(() => { if (API === DIRECT_API) RPC = DIRECT_RPC; pollBlock(); if (lv) pollLevels() }); pollProof()
  // Touch screens (phones, tablets) read less often, so the radio rests between reads: the API every 6 s instead of 4,
  // and the block from the API head (above) with one read on Arc every 15 s, instead of one every second. Many phones
  // on one venue network share the public RPC's quota with the Arc check
  const touch = (() => { try { return matchMedia('(pointer: coarse)').matches } catch { return false } })()
  if (lv) setInterval(() => { if (!document.hidden) pollLevels() }, 30000)
  setInterval(() => { if (!document.hidden) poll() }, touch ? 6000 : 4000)
  setInterval(() => { if (!document.hidden) pollProof() }, 20000)
  setInterval(() => { if (!document.hidden) pollBlock() }, touch ? 15000 : 1000)
}

/** Until then, the block is not read on Arc (an HTTP 429 was answered) */
let rpcCool = 0
const RATE = /rate.?limit|too many requests/i
const pause = (ms: number) => new Promise((res) => setTimeout(res, ms))
/** A JSON-RPC call to Arc testnet (proxied in dev, direct in production). 8 s timeout, so a hanging request does not
 *  block the following reads. A call refused for its rate (HTTP 429, several tabs or a shared network) is made again
 *  after a short wait, `retries` times (twice by default), before it fails. */
export async function rpc<T = unknown>(method: string, params: unknown[], retries = 2): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  const base = RPC
  for (const url of base === DIRECT_RPC ? [base] : [base, DIRECT_RPC]) {
    for (let k = 0; ; k++) {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000)
      let limited = false
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ctl.signal })
        // a rate refusal is not a missing proxy: the same URL again, after a wait
        if (r.status === 429) { limited = true; throw new Error('HTTP 429') }
        if (!r.ok || !/json/.test(r.headers.get('content-type') ?? '')) { if (url !== DIRECT_RPC) { RPC = DIRECT_RPC; break } throw new Error(`HTTP ${r.status}`) }
        const j = await r.json()
        if (j.error) { limited = j.error.code === 429 || RATE.test(String(j.error.message ?? '')); throw new Error(j.error.message ?? 'rpc error') }
        return j.result as T
      } catch (e) {
        if (limited) {
          rpcCool = Date.now() + 15000
          if (k < retries) { await pause(k ? 1500 : 500); continue }
          throw e
        }
        if (url === DIRECT_RPC) throw e
        break
      } finally { clearTimeout(to) }
    }
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
