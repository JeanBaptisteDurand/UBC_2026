// Publish: propose a product on ProductRegistry, like the console's ProposeCard (web/src/screens/Operator.tsx) and
// the SDK (proposeProduct, activateProduct): one propose(ProposeParams) transaction, simulated first, then activate()
// once the registry delay has passed (0 on testnet). One intended difference: the manifest is not "ipfs://demo" with
// a dummy hash, it is the one the author writes, hashed here (keccak256 of its bytes, which the API checks).
import { keccak256, parseEventLogs, stringToBytes, type Address, type Hex } from 'viem'
import { productRegistryAbi, testnet } from './sdk'
import { arc, publicClient, waitOk, UserFacing } from './wallet'
import { parseUsdc } from './rent'
import { w } from './strings'

export const manifestHash = (text: string): Hex => keccak256(stringToBytes(text))

export interface Draft {
  manifest: string; uri: string; image: string; price: string; minBond: string
  rail: 'x402' | 'session'; bpsOperator: number; bpsAuthor: number; bpsNetwork: number
}

/** propose() parameters, checked like the contract does (BadShares, AuthorShareTooHigh, NetworkShareTooLow). */
export function proposeParams(d: Draft) {
  try { JSON.parse(d.manifest) } catch { throw new UserFacing(w('p.badJson'), 'other') }
  if (!/^(https:\/\/|ipfs:\/\/)\S+$/.test(d.uri.trim())) throw new UserFacing(w('p.badUri'), 'other')
  if (!/^0x[0-9a-fA-F]{64}$/.test(d.image.trim())) throw new UserFacing(w('p.badImage'), 'other')
  if (d.bpsOperator + d.bpsAuthor + d.bpsNetwork !== 10_000 || d.bpsAuthor > 3000 || d.bpsNetwork < 500) throw new UserFacing(w('p.badShares'), 'other')
  return {
    manifestHash: manifestHash(d.manifest), manifestURI: d.uri.trim(), workloadIds: [d.image.trim() as Hex], deterministic: false,
    price: parseUsdc(d.price), bpsOperator: d.bpsOperator, bpsAuthor: d.bpsAuthor, bpsNetwork: d.bpsNetwork,
    // same values as the console for what is not asked here: 1,000,000 USDC cap, no parameters, no notice
    minBond: parseUsdc(d.minBond), exposureCap: 1_000_000_000_000n,
    settlement: (d.rail === 'x402' ? testnet.x402Settler : testnet.sessionPay) as Address,
    param: ('0x' + '00'.repeat(32)) as Hex, advisoryIds: [] as string[], unitTokens: 1, outWeight: 1,
  }
}

export async function propose(d: Draft, on: { signing?: () => void; sent?: (h: Hex) => void }): Promise<{ tx: Hex; id: bigint; activatesAt: bigint }> {
  const a = arc()
  const q = proposeParams(d)
  on.signing?.()
  const r = await a.proposeProduct(q)
  on.sent?.(r.tx)
  const rcpt = await waitOk(r.tx)
  const ev = parseEventLogs({ abi: productRegistryAbi, logs: rcpt.logs, eventName: 'ProductProposed' })[0] as { args: { productId: bigint; activatesAt: bigint | number } } | undefined
  return { tx: r.tx, id: ev ? ev.args.productId : r.productId, activatesAt: ev ? BigInt(ev.args.activatesAt) : 0n }
}

export async function activate(id: bigint, on: { signing?: () => void; sent?: (h: Hex) => void }): Promise<Hex> {
  const a = arc()
  on.signing?.()
  const h = await a.activateProduct(id)
  on.sent?.(h)
  await waitOk(h)
  return h
}

export interface ProductState { id: bigint; state: 'Proposed' | 'Active' | 'Retired'; activatesAt: bigint; now: bigint }
const STATES = [null, 'Proposed', 'Active', 'Retired'] as const // IProductRegistry.State: None, Proposed, Active, Retired
export async function readProduct(id: bigint): Promise<ProductState> {
  const pub = publicClient()
  const [p, b] = await Promise.all([
    pub.readContract({ address: testnet.productRegistry, abi: productRegistryAbi, functionName: 'getProduct', args: [id] }) as Promise<{ state: number; activatesAt: bigint | number }>,
    pub.getBlock(),
  ])
  return { id, state: STATES[Number(p.state)] ?? 'Proposed', activatesAt: BigInt(p.activatesAt), now: b.timestamp }
}
