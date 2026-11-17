// Use: call a catalog service, paid per call (x402), like the console's playground
// (web/src/x402.ts and web/src/screens/X402Chat.tsx), without changing its logic:
// - the price of a call is READ ON ARC (ProductRegistry.getProduct and isActive at the same block), shown before any
//   signature;
// - the enclave key is checked against EnclaveRegistry (the SDK's verifyEnclaveKeys) before any encryption;
// - the SDK x402 client (createX402Client) seals the request for that enclave only (HPKE to its registered X25519 key)
//   and pays with ONE EIP-3009 signature (ReceiveWithAuthorization to X402Settler), capped at the displayed price, with
//   the same guard as the console: the wallet only sees that authorization, for at most that price;
// - the receipt signed by the enclave is checked by the SDK before the text is rendered, then settlement is read on Arc.
import type { Address, Hex } from 'viem'
import { callSettledEvent, createArcClient, createX402Client, productRegistryAbi, usdcAuthAbi, X402_UNITS_PER_CALL, type ChatMessage, type X402Completion, type VerifiedEnclaveKeys } from './sdk'
import { arc, publicClient, needFunds, testnet, UserFacing } from './wallet'
import { getLive } from '../../data/live'
import { ENCLAVE, abs } from '../../data/endpoints'
import { usdc } from '../../data/fmt'
import { w } from './strings'

const lower = (x: unknown) => String(x ?? '').toLowerCase()

/** A product's known public URL: the one the console uses (deploy/build.sh, VITE_X402_URL). */
export const KNOWN_ENCLAVE: Record<string, string> = { get '3'() { return abs(ENCLAVE.x402) } }

export interface X402Price { productId: bigint; price: bigint; block: bigint; exists: boolean; perCall: boolean; active: boolean; settlement: Address }
/** The console's readX402Price (web/src/x402.ts), as is. */
export async function readX402Price(productId: bigint): Promise<X402Price> {
  const pub = publicClient()
  const block = await pub.getBlockNumber()
  const [p, active] = (await Promise.all([
    pub.readContract({ address: testnet.productRegistry, abi: productRegistryAbi, functionName: 'getProduct', args: [productId], blockNumber: block }),
    pub.readContract({ address: testnet.productRegistry, abi: productRegistryAbi, functionName: 'isActive', args: [productId], blockNumber: block }),
  ])) as [{ author: Address; price: bigint; settlement: Address }, boolean]
  const zero = /^0x0{40}$/i
  return {
    productId, price: p.price * X402_UNITS_PER_CALL, block, active, settlement: p.settlement,
    exists: !zero.test(p.author) || !zero.test(p.settlement), perCall: lower(p.settlement) === lower(testnet.x402Settler),
  }
}

/** The enclave key, checked against the chain (the console's useVerifiedEnclave): read-only. */
export function verifyKey(url: string, productId: bigint): Promise<VerifiedEnclaveKeys> {
  return arcRead().verifyEnclaveKeys(url.trim().replace(/\/+$/, ''), productId)
}
// a read does not need the wallet: the Arc client without a wallet
const arcRead = () => createArcClient({ publicClient: publicClient() as never })

export interface PayHooks { onSign?: (amount: bigint) => void; onSigned?: () => void; onRequest?: (r: { method: string; params: unknown }) => void }

/** The console's payingWallet: only the EIP-3009 authorization of ONE call, to X402Settler, on Arc's USDC, for at most
 *  `cap` reaches the wallet; any other signature request is refused first. */
export function payingWallet<W extends object>(wl: W, cap: bigint, hooks: PayHooks = {}): W {
  return new Proxy(wl, {
    get(target, prop, receiver) {
      if (prop !== 'signTypedData') return Reflect.get(target, prop, receiver)
      return async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const m = args?.message ?? {}, d = args?.domain ?? {}
        const value: bigint = typeof m.value === 'bigint' ? m.value : -1n
        const ok = args?.primaryType === 'ReceiveWithAuthorization' && lower(m.to) === lower(testnet.x402Settler)
          && Number(d.chainId) === testnet.chainId && lower(d.verifyingContract) === lower(testnet.usdc) && value > 0n && value <= cap
        if (!ok) throw new UserFacing(w('e.other', { why: w('u.capWhy', { cap: usdc(cap.toString()) ?? '' }) }), 'other')
        hooks.onSign?.(value)
        const sig = await (target as any).signTypedData(args) // eslint-disable-line @typescript-eslint/no-explicit-any
        hooks.onSigned?.()
        return sig
      }
    },
  })
}

export interface Answer {
  text: string; signer: Address; operator: Address; amount: bigint; anchorBlock: bigint; settleable: boolean
  ref: PaidCallRef
}
export interface PaidCallRef { payer: Address; nonce: Hex; productId: bigint; fromBlock: bigint; validBefore: bigint; amount: bigint }

/** One call: price capped at the displayed one, sealed request, signed payment, response and receipt checked by the SDK. */
export async function callService(o: { url: string; productId: bigint; price: X402Price; message: string; hooks?: PayHooks }): Promise<Answer> {
  const a = arc()
  await needFunds(o.price.price)
  const cap = o.price.price
  const client = createX402Client({
    enclaveUrl: o.url.trim().replace(/\/+$/, ''), productId: o.productId, walletClient: payingWallet(a.wallet!, cap, o.hooks) as never,
    publicClient: a.pub as never, deployment: testnet, maxAmount: cap,
  })
  const messages: ChatMessage[] = [{ role: 'user', content: o.message }]
  const c: X402Completion = await client.chat.completions.create({ messages })
  return {
    text: c.text, signer: c.signer, operator: c.operator, amount: c.amount, anchorBlock: c.receipt.anchorBlock, settleable: c.settleable,
    ref: {
      payer: c.receipt.payer, nonce: c.receipt.nonce, productId: c.receipt.productId,
      fromBlock: c.receipt.anchorBlock < o.price.block ? c.receipt.anchorBlock : o.price.block, validBefore: c.authorization.validBefore, amount: c.amount,
    },
  }
}

export type Settlement = { state: 'pending' } | { state: 'settled'; tx: Hex; amount?: bigint } | { state: 'consumed' } | { state: 'expired' }
/** The console's settlementOf: the consumed authorization, then the CallSettled event (chain, then API activity). */
export async function settlementOf(c: PaidCallRef): Promise<Settlement> {
  const pub = publicClient()
  const used = (await pub.readContract({ address: testnet.usdc, abi: usdcAuthAbi, functionName: 'authorizationState', args: [c.payer, c.nonce] })) as boolean
  if (!used) return BigInt(Math.floor(Date.now() / 1000)) > c.validBefore + 30n ? { state: 'expired' } : { state: 'pending' }
  try {
    const logs = await pub.getLogs({ address: testnet.x402Settler, event: callSettledEvent, args: { productId: c.productId, payer: c.payer }, fromBlock: c.fromBlock, toBlock: 'latest' })
    const hit = logs.find((l) => lower(l.args.nonce) === lower(c.nonce))
    if (hit) return { state: 'settled', tx: hit.transactionHash as Hex, amount: hit.args.amount }
  } catch { /* range refused by the RPC: the page reads the activity */ }
  const ev = getLive().activity?.find((e) => e.name === 'CallSettled' && lower(e.args.nonce) === lower(c.nonce))
  if (ev) return { state: 'settled', tx: ev.tx as Hex, amount: /^\d+$/.test(ev.args.amount ?? '') ? BigInt(ev.args.amount) : undefined }
  return { state: 'consumed' }
}
