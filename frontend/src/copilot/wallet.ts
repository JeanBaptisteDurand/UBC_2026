// The wallet as seen by the copilot. The site already has ONE wallet (network/actions/store.ts and its engine
// wallet.ts: EIP-6963, choice between several wallets, balance, switch to Arc), the header one. This module keeps the
// copilot panel interface (useWallet, connect, toArc, forget…) and plugs it into that single wallet: the header and
// the panel always say the same thing. Only this wallet signs: the copilot only prepares.
import { getWallet as getSite, setWallet as setSite, useWallet as useSite, engine, ARC_ID, type WalletState as SiteState } from '../network/actions/store'
import { addr, tx } from '../links'

export interface Eip1193 { request(a: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown> }
export const ARC = { id: ARC_ID, explorer: 'https://explorer.testnet.arc.io' } as const
export const txUrl = (h: string) => tx(h) ?? `${ARC.explorer}/tx/${h}`
export const addrUrl = (a: string) => addr(a) ?? `${ARC.explorer}/address/${a}`

export interface WalletState {
  has: boolean
  status: 'idle' | 'connecting' | 'connected'
  address?: string
  chainId?: number
  /** What the wallet answered wrong (refusal, error), to show once. */
  error?: 'rejected' | 'pending' | string
  /** Several wallets in the browser: the choice, in the panel (the landing has no header wallet). */
  pick?: { id: string; name: string; icon?: string }[]
}

const injected = () => typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum
function view(s: SiteState): WalletState {
  const status = s.phase === 'connected' && s.address ? 'connected' : s.phase === 'loading' || s.phase === 'connecting' || s.switching ? 'connecting' : 'idle'
  return {
    // a wallet that only announces itself (EIP-6963, no window.ethereum) is found on the first click: until the
    // search says there is none, Connect is offered
    has: s.phase !== 'none' || injected(),
    status, address: s.address, chainId: s.chainId,
    // a request already open in the wallet is a note, not a failure: shown as it is
    error: s.note && (s.note.tone === 'bad' || s.note.pending) ? s.note.text : undefined,
    pick: s.phase === 'pick' ? s.wallets : undefined,
  }
}
// one stable view per site state (useSyncExternalStore needs the same value while nothing changes)
let lastSite: SiteState | null = null, lastView: WalletState = { has: false, status: 'idle' }
const viewOf = (s: SiteState) => { if (s !== lastSite) { lastSite = s; lastView = view(s) } return lastView }
export const getWallet = () => viewOf(getSite())
export const useWallet = (): WalletState => viewOf(useSite())

/** A provider is present (the panel only offers signing with a wallet); signing goes through the site engine. */
export const provider = (): Eip1193 | null => (getWallet().has ? { request: () => Promise.reject(new Error('use the site wallet')) } : null)
export const onArc = () => { const w = getWallet(); return w.status === 'connected' && w.chainId === ARC.id }

/** The code of an EIP-1193 error (4001 refused, -32002 request already open, 4902 unknown network), wherever it is. */
export function codeOf(e: unknown): number | undefined {
  for (let x: unknown = e, n = 0; x && n < 8; x = (x as { cause?: unknown }).cause, n++) {
    const c = (x as { code?: unknown }).code
    if (typeof c === 'number') return c
    const d = (x as { data?: { originalError?: { code?: unknown } } }).data?.originalError?.code
    if (typeof d === 'number') return d
  }
  return undefined
}

/** Connects the wallet (wallet popup, or choice between several), then switches it to Arc testnet. */
export async function connect(id?: string): Promise<boolean> {
  try {
    const E = await engine()
    if (id) await E.connect(id)
    else await E.start()
    if (getSite().phase !== 'connected') return false
    if (getSite().chainId !== ARC_ID) return toArc()
    return true
  } catch (e) {
    // the wallet module did not load, or the wallet threw outside its own handling: said, never silent
    setSite({ phase: getSite().phase === 'connected' ? 'connected' : 'idle', note: { tone: 'bad', text: String((e as Error)?.message ?? e).slice(0, 200) } })
    return false
  }
}

/** Arc testnet in the wallet: selected if known, added otherwise (the site engine, like the header). */
export async function toArc(): Promise<boolean> {
  try {
    const E = await engine()
    await E.switchToArc()
  } catch (e) { setSite({ switching: false, note: { tone: 'bad', text: String((e as Error)?.message ?? e).slice(0, 200) } }) }
  return getSite().chainId === ARC_ID
}

/** Forgets the wallet here. */
export async function forget() { (await engine()).disconnect() }
export const clearError = () => setSite({ note: undefined })

/** On load: the wallet already connected in this tab comes back without a prompt (the site engine, resume). */
export async function restore() {
  if (getSite().phase === 'connected') return
  try { if (sessionStorage.getItem('archive-wallet') !== '1') return } catch { return }
  await (await engine()).resume()
}
