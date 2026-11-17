// The visitor's wallet engine, loaded only on the "Connect wallet" click. No wagmi or RainbowKit (too heavy for a
// page): viem on the browser's injected provider (EIP-1193), discovered through EIP-6963 (several wallets) or
// window.ethereum. The Arc client is the SDK's (actions/sdk, a copy of packages/sdk/src): the same functions as the
// console (web/src/useArc.ts, operatorActions.ts, x402.ts).
// No key here: everything is signed by the visitor's wallet.
import { createPublicClient, createWalletClient, custom, http, parseAbi, type Address, type EIP1193Provider, type Hex, type PublicClient, type WalletClient } from 'viem'
import { arcTestnet, createArcClient, testnet, type ArcClient } from './sdk'
import { RPC } from '../../data/live'
import { getWallet, setWallet, ARC_ID, type WalletInfo } from './store'
import { w } from './strings'
import { usdc } from '../../data/fmt'
import { secure } from '../../data/endpoints'
import { ApiError } from './jbapi'
import { x } from './strings-x'

export { testnet }
export type { ArcClient }

// ---------- browser wallet discovery ----------
interface Announced { info: { uuid: string; name: string; icon?: string; rdns?: string }; provider: EIP1193Provider }
const found = new Map<string, Announced>()
let provider: EIP1193Provider | null = null

function discover(): Promise<WalletInfo[]> {
  return new Promise((res) => {
    const on = (e: Event) => { const d = (e as CustomEvent<Announced>).detail; if (d?.info?.uuid && d.provider) found.set(d.info.uuid, d) }
    window.addEventListener('eip6963:announceProvider', on)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', on)
      const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum
      if (eth && ![...found.keys()].some((k) => k !== 'injected')) found.set('injected', { info: { uuid: 'injected', name: 'Browser wallet' }, provider: eth })
      res([...found.values()].map((a) => ({ id: a.info.uuid, name: a.info.name, icon: a.info.icon })))
    }, 220)
  })
}

// ---------- clients ----------
const rpcUrl = () => new URL(RPC, location.href).href
let pub: PublicClient | null = null
export function publicClient(): PublicClient {
  if (!pub) pub = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl(), { retryCount: 1, timeout: 20_000 }) }) as PublicClient
  return pub
}
let wallet: WalletClient | null = null
/** The SDK's Arc client, with the connected wallet (like the console's useArc()). */
export function arc(): ArcClient {
  const s = getWallet()
  if (s.phase !== 'connected' || !s.address || !provider) throw new UserFacing(w('e.noWallet'), 'noWallet')
  if (s.chainId !== ARC_ID) throw new UserFacing(w('e.wrongNet'), 'wrongNet')
  if (!wallet || wallet.account?.address.toLowerCase() !== s.address.toLowerCase()) {
    wallet = createWalletClient({ account: s.address, chain: arcTestnet, transport: custom(provider) })
  }
  return createArcClient({ publicClient: publicClient() as never, walletClient: wallet as never })
}

/** An error already worded for the page (refusal, wrong network, balance, etc.). */
export class UserFacing extends Error {
  constructor(message: string, readonly kind: Kind, readonly hash?: Hex) { super(message); this.name = 'UserFacing' }
}
export type Kind = 'noWallet' | 'wrongNet' | 'refused' | 'funds' | 'rejected' | 'reverted' | 'net' | 'other' | 'wrongSite' | 'offline' | 'cors' | 'insecure'

/** The SDK's HPKE encryption requires a secure context: refused before any call, with the reason. */
export function requireSecure() { if (!secure()) throw new UserFacing(x('e.insecure'), 'insecure') }

// ---------- connection ----------
export async function start() {
  setWallet({ phase: 'loading', note: undefined })
  const ws = await discover()
  if (!ws.length) { setWallet({ phase: 'none', wallets: [], note: { tone: 'muted', text: w('w.none') } }); return }
  if (ws.length === 1) return connect(ws[0].id)
  setWallet({ phase: 'pick', wallets: ws })
}

export async function connect(id: string) {
  const a = found.get(id); if (!a) return
  provider = a.provider
  setWallet({ phase: 'connecting', note: undefined })
  try {
    const accts = (await provider.request({ method: 'eth_requestAccounts' })) as Address[]
    const chainId = Number(await provider.request({ method: 'eth_chainId' }))
    if (!accts?.length) throw new Error('no account')
    setWallet({ phase: 'connected', address: accts[0], chainId, balance: undefined })
    remember(id)
    listen()
    void refreshBalance()
  } catch (e) {
    setWallet({ phase: 'idle', note: { tone: 'bad', text: isRefusal(e) ? w('w.refused.connect') : explain(e).message } })
  }
}

let listening = false
function listen() {
  if (listening || !provider?.on) return
  listening = true
  provider.on('accountsChanged', (accts: readonly Address[]) => {
    if (!accts.length) { disconnect(); return }
    setWallet({ address: accts[0], balance: undefined }); wallet = null; void refreshBalance()
  })
  provider.on('chainChanged', (c: string) => { setWallet({ chainId: Number(c) }); wallet = null; void refreshBalance() })
}

export function disconnect() { wallet = null; remember(null); setWallet({ phase: 'idle', address: undefined, chainId: undefined, balance: undefined, note: undefined }) }

// The wallet follows the visitor from page to page in this tab. The site copilot changes pages in front of the user;
// without this, the wallet would have to be reconnected on each arrival. Only a flag is kept (never an address or a
// key), and the resume needs no prompt: eth_accounts, which the wallet only answers for an already allowed site.
const FLAG = 'archive-wallet', FLAG_ID = 'archive-wallet-id'
function remember(id: string | null) {
  try { if (id) { sessionStorage.setItem(FLAG, '1'); sessionStorage.setItem(FLAG_ID, id) } else { sessionStorage.removeItem(FLAG); sessionStorage.removeItem(FLAG_ID) } } catch { /* storage unavailable */ }
}
/** The wallet already connected in this tab comes back, without a prompt; nothing if it does not respond. */
export async function resume() {
  let id: string | null = null
  try { if (sessionStorage.getItem(FLAG) !== '1') return; id = sessionStorage.getItem(FLAG_ID) } catch { return }
  if (getWallet().phase === 'connected') return
  await discover()
  const a = (id && found.get(id)) || found.get('injected') || [...found.values()][0]
  if (!a) return
  try {
    const accts = (await a.provider.request({ method: 'eth_accounts' })) as Address[]
    if (!accts?.length) return
    provider = a.provider
    const chainId = Number(await a.provider.request({ method: 'eth_chainId' }))
    setWallet({ phase: 'connected', address: accts[0], chainId, balance: undefined })
    listen()
    void refreshBalance()
  } catch { /* the wallet does not respond: the Connect button stays */ }
}

/** Adds and switches to the Arc testnet network (EIP-3085, EIP-3326), as RainbowKit does for the console. */
export async function switchToArc() {
  if (!provider) return
  const chainId = '0x' + ARC_ID.toString(16)
  setWallet({ switching: true, note: undefined })
  try {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
    } catch (e) {
      if (codeOf(e) !== 4902 && !/unrecognized|not added|unknown chain/i.test(String((e as Error)?.message))) throw e
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId, chainName: 'Arc testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: ['https://rpc.testnet.arc.io'], blockExplorerUrls: ['https://explorer.testnet.arc.io'] }],
      })
      // some wallets switch on their own after adding, others do not: ask again
      if (Number(await provider.request({ method: 'eth_chainId' })) !== ARC_ID) await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
    }
    setWallet({ chainId: Number(await provider.request({ method: 'eth_chainId' })) })
    void refreshBalance()
  } catch (e) {
    setWallet({ note: { tone: 'bad', text: isRefusal(e) ? w('w.refused.switch') : explain(e).message } })
  } finally { setWallet({ switching: false }) }
}

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)'])
/** The wallet's USDC balance on Arc (Arc's USDC ERC-20, 6 decimals, like the console). */
export async function refreshBalance() {
  const a = getWallet().address; if (!a) return
  try {
    const b = (await publicClient().readContract({ address: testnet.usdc, abi: ERC20, functionName: 'balanceOf', args: [a] })) as bigint
    if (getWallet().address === a) setWallet({ balance: b })
  } catch { setWallet({ balance: null }) }
}

/** Refuses before any signature if the balance does not cover `need` (6-decimal units). */
export async function needFunds(need: bigint) {
  await refreshBalance()
  const have = getWallet().balance
  if (typeof have === 'bigint' && have < need) throw new UserFacing(w('e.funds', { have: usdc(have.toString()) ?? '0', need: usdc(need.toString()) ?? '' }), 'funds')
}

/** Waits for a transaction to confirm; throws "reverted" if the contract refused it (the console's waitOk). */
export async function waitOk(hash: Hex) {
  const r = await publicClient().waitForTransactionReceipt({ hash, timeout: 180_000 })
  if (r.status !== 'success') throw new UserFacing(w('e.reverted'), 'reverted', hash)
  return r
}

// ---------- errors, in words ----------
const codeOf = (e: unknown): number | undefined => {
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) if (typeof x?.code === 'number') return x.code // eslint-disable-line @typescript-eslint/no-explicit-any
  return undefined
}
export function isRefusal(e: unknown): boolean {
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (x?.code === 4001 || x?.code === 'ACTION_REJECTED' || x?.name === 'UserRejectedRequestError') return true
    if (typeof x?.message === 'string' && /user (rejected|denied)|rejected the request|denied (transaction|message) signature/i.test(x.message)) return true
  }
  return false
}
export function explain(e: unknown): UserFacing {
  if (e instanceof UserFacing) return e
  if (e instanceof ApiError) return new UserFacing(e.message, e.kind === 'refused' ? (e.code === 'wrong_site' ? 'wrongSite' : 'rejected') : e.kind)
  if (isRefusal(e)) return new UserFacing(w('e.refused'), 'refused')
  let why = ''
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (x?.name === 'ChainMismatchError') return new UserFacing(w('e.wrongNet'), 'wrongNet')
    if (x?.name === 'ContractFunctionRevertedError') {
      const en = x.data?.errorName, a0 = x.data?.args?.[0]
      const name: string = en === 'Error' && typeof a0 === 'string' ? a0 : en && en !== 'Error' ? `${en}(${(x.data?.args ?? []).map(String).join(', ')})` : x.reason ?? 'revert'
      if (/balance|insufficient|exceeds/i.test(name)) return new UserFacing(w('e.funds', { have: '?', need: '?' }).replace(/ You have.*| Vous avez.*/, ''), 'funds')
      return new UserFacing(w('e.rejected', { why: name }), 'rejected')
    }
    if (x?.name === 'InsufficientFundsError') return new UserFacing(w('e.funds', { have: '?', need: '?' }).replace(/ You have.*| Vous avez.*/, ''), 'funds')
    if (x?.name === 'HttpRequestError' || x?.name === 'TimeoutError' || (x?.name === 'TypeError' && /fetch|network|load failed/i.test(String(x?.message)))) {
      return new UserFacing(w('e.net', { why: x?.status ? `HTTP ${x.status}` : String(x?.name) }), 'net')
    }
    if (!why && typeof x?.shortMessage === 'string') why = x.shortMessage
  }
  if (!why) why = String((e as Error)?.message ?? e).split('\n')[0].slice(0, 160)
  return new UserFacing(w('e.other', { why }), 'other')
}

export * from './use'
export * from './rent'
export * from './publish'
export * from './cctp'
export * from './siwe'
export * from './bounty'
export * from './sessions'
export * from './operator'
export * from './copilot-engine'
export { isSignatureSpent } from './jbapi'
