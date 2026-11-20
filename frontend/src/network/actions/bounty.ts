// The sealed bounty, ported from the console (web/src/screens/Bounty.tsx, Bounties.tsx, PostBounty.tsx) without
// changing its logic:
// - the protocol creates a bounty (createBounty, funded by ONE EIP-3009 authorization), demo rule ERC20_DROP on
//   DemoVault, one tier; the protocol's X25519 key is generated in the browser and only leaves it through the file
//   it downloads;
// - the hunter seals their exploit for the VERIFIED enclave on Arc (prepareExploit: cP to the protocol, cE to the
//   enclave), the enclave replays it and signs a claim (proveExploit), then acceptClaim reserves the payment and
//   deliver releases it; a refused credit is withdrawn (withdrawCredit), an expired pool is recovered (withdrawRemaining);
// - the VERIFIED level (product 5 on v3, 7 on v2.1) is the same flow on the other contract (SealedBountyVerified) and the
//   other enclave (/enclave/bounty-verified). On v3 it can slash bonds and write verdicts since the stack's
//   initialization (19 Nov, 20:37 UTC: core and levels wired together, no 8-day delay).
import { encodeFunctionData, parseAbi, parseEventLogs, toHex, zeroAddress, type Address, type Hex } from 'viem'
import { createArcClient, encodeExploitTx, generateX25519, predicateHash, sealedBountyAbi, testnet, type ArcClient, type BountyRow, type Deployment, type Predicate, type ProvenClaim } from './sdk'
import { arc, publicClient, needFunds, requireSecure, waitOk, UserFacing } from './wallet'
import { ENCLAVE, PRODUCT, abs } from '../../data/endpoints'
import { x } from './strings-x'

export type BountyLevel = 'open' | 'verified'

/** A level's deployment: the same, with SealedBountyVerified instead of SealedBounty for the verified level. */
export function deploymentOf(level: BountyLevel): Deployment {
  if (level === 'open') return testnet
  if (!testnet.levels) throw new UserFacing(x('b.noLevels'), 'other')
  return { ...testnet, sealedBounty: testnet.levels.sealedBountyVerified }
}
export const productOf = (level: BountyLevel) => (level === 'open' ? PRODUCT.bounty : PRODUCT.bountyVerified)
export const enclaveOf = (level: BountyLevel) => abs(level === 'open' ? ENCLAVE.bounty : ENCLAVE.bountyVerified)

/** The level's Arc client, with the connected wallet (or read-only). */
function arcOf(level: BountyLevel, read = false): ArcClient {
  const d = deploymentOf(level)
  if (read) return createArcClient({ publicClient: publicClient() as never, deployment: d })
  const a = arc()
  return createArcClient({ publicClient: a.pub, walletClient: a.wallet, account: a.account, deployment: d })
}

export const DEMO_PREDICATE: Predicate = {
  combine: 'OR',
  clauses: [{ type: 'ERC20_DROP', token: testnet.usdc, holder: testnet.demoVault, min: '1000000' }],
}
/** The hash pinned by demo bounties: the demo exploit can only be proven against those. */
export const DEMO_PREDICATE_HASH = predicateHash(DEMO_PREDICATE)
const TIER_MIN_LOSS = 1_000_000n
export const TIER_AMOUNT = 1_000_000n
const DEMO_VAULT_ABI = parseAbi(['function migrate(address to)'])
/** The demo exploit: DemoVault's deliberate flaw (migrate without access control), replayed in the enclave. */
export const demoExploitTxs = (payee: Address): Hex[] =>
  [encodeExploitTx({ to: testnet.demoVault, data: encodeFunctionData({ abi: DEMO_VAULT_ABI, functionName: 'migrate', args: [payee] }) })]
const now = () => BigInt(Math.floor(Date.now() / 1000))

/** Network and operator fees read from the level's contract, and the minimum to fund for one tier. */
export async function readBountyFees(level: BountyLevel) {
  const pub = publicClient(), d = deploymentOf(level)
  const [net, op] = (await Promise.all([
    pub.readContract({ address: d.sealedBounty, abi: sealedBountyAbi, functionName: 'networkBountyBps' }),
    pub.readContract({ address: d.sealedBounty, abi: sealedBountyAbi, functionName: 'operatorBountyBps' }),
  ])) as [number, number]
  const bps = Number(net) + Number(op)
  return { bps, min: TIER_AMOUNT + (TIER_AMOUNT * BigInt(bps)) / 10_000n }
}

export interface CreatedBounty { bountyId: bigint; tx: Hex; publicKey: Hex; privateKey: Hex }
/** The console's ProtocolPanel.create: active product settled by the bounty, sufficient funding, protocol key. */
export async function createBounty(level: BountyLevel, o: { productId: bigint; funding: bigint; hours: number }, on: { sent?: (r: { tx: Hex; key: { publicKey: Hex; privateKey: Hex }; bountyId: bigint }) => void } = {}): Promise<CreatedBounty> {
  const a = arcOf(level)
  const d = deploymentOf(level)
  const p = await a.getProduct(o.productId)
  if (p.state !== 'Active') throw new UserFacing(x('b.notActive', { id: o.productId.toString(), state: p.state }), 'other')
  if (!p.deterministic || p.settlement.toLowerCase() !== d.sealedBounty.toLowerCase()) throw new UserFacing(x('b.notSealed', { id: o.productId.toString() }), 'other')
  const fees = await readBountyFees(level)
  if (o.funding < fees.min) throw new UserFacing(x('b.tooLow', { min: (Number(fees.min) / 1e6).toString() }), 'other')
  if (!Number.isFinite(o.hours) || o.hours <= 0) throw new UserFacing(x('b.badHours'), 'other')
  await needFunds(o.funding)
  const k = generateX25519()
  const key = { publicKey: k.publicKey, privateKey: toHex(k.privateKey) }
  const r = await a.createBounty({
    productId: o.productId, predicateHash: DEMO_PREDICATE_HASH, protocolX25519: k.publicKey,
    tierMinLoss: [TIER_MIN_LOSS], tierAmount: [TIER_AMOUNT], singleCap: TIER_AMOUNT, k: 1,
    targetToPause: testnet.demoVault, deadline: now() + BigInt(Math.round(o.hours * 3600)), funding: o.funding,
  })
  on.sent?.({ tx: r.tx, key, bountyId: r.bountyId })
  const rcpt = await waitOk(r.tx)
  const ev = parseEventLogs({ abi: sealedBountyAbi, logs: rcpt.logs, eventName: 'BountyCreated' })[0] as { args: { bountyId: bigint } } | undefined
  return { bountyId: ev ? ev.args.bountyId : r.bountyId, tx: r.tx, ...key }
}

/** The key file read by the CLI (arcvault bounty reports <id> --key <file>). */
export function protocolKeyFile(bountyId: bigint, publicKey: Hex, privateKey: Hex): { name: string; url: string } {
  const body = { kind: 'arcvault-protocol-x25519', publicKey, privateKey, createdAt: new Date().toISOString(), note: `bounty ${bountyId}` }
  return { name: `bounty-${bountyId}-protocol-key.json`, url: URL.createObjectURL(new Blob([`${JSON.stringify(body, null, 2)}\n`], { type: 'application/json' })) }
}

/** A level's bounties read on chain (the verified level is not in /api/bounties). */
export async function listBounties(level: BountyLevel): Promise<BountyRow[]> {
  return arcOf(level, true).listBounties()
}

/** Can the bounty be hunted with the demo exploit? (read-only, the console's precheck) */
export async function precheck(level: BountyLevel, id: bigint) {
  const a = arcOf(level, true)
  const b = await a.getBounty(id)
  if (b.protocol === zeroAddress) throw new UserFacing(x('h.noBounty', { id: id.toString() }), 'other')
  if (b.deadline < now()) throw new UserFacing(x('h.expired', { id: id.toString() }), 'other')
  if (b.paused) throw new UserFacing(x('h.paused', { id: id.toString() }), 'other')
  if (b.predicateHash.toLowerCase() !== DEMO_PREDICATE_HASH.toLowerCase()) throw new UserFacing(x('h.otherRule', { id: id.toString() }), 'other')
  const tiers = await a.bountyTiers(id)
  if (!tiers.some((t) => t.amount > b.paidAmount)) throw new UserFacing(x('h.allPaid', { id: id.toString() }), 'other')
  return b
}

export type HuntStep = 0 | 1 | 2 | 3
export interface HuntHooks {
  step?: (i: HuntStep, st: 'doing' | 'done', info?: { signer?: Address; operator?: Address; loss?: bigint; tier?: number; tx?: Hex; amount?: bigint }) => void
}
/** Encryption for the verified enclave (0), replay and signed claim (1); payment follows (pay). */
export async function prove(level: BountyLevel, id: bigint, enclaveUrl: string, h: HuntHooks = {}): Promise<ProvenClaim> {
  requireSecure()
  const a = arcOf(level)
  const payee = a.account!.address
  h.step?.(0, 'doing')
  const sealed = await a.prepareExploit({ bountyId: id, enclaveUrl: enclaveUrl.trim().replace(/\/+$/, ''), payee, exploit: { predicate: DEMO_PREDICATE, txs: demoExploitTxs(payee), capital: 0n } })
  h.step?.(0, 'done', { signer: sealed.enclave.signer, operator: sealed.enclave.operator })
  h.step?.(1, 'doing')
  const p = await a.proveExploit(sealed)
  h.step?.(1, 'done', { loss: p.claim.loss, tier: Number(p.claim.tier) })
  return p
}

/** acceptClaim (reserve) then deliver (releases cP and pays), tracking each transaction (the console's trackTxs). */
export async function pay(level: BountyLevel, p: ProvenClaim, h: HuntHooks = {}): Promise<{ acceptTx: Hex; deliverTx: Hex; amount?: bigint }> {
  const a = arcOf(level)
  h.step?.(2, 'doing')
  const acceptTx = await a.acceptClaim(p.claim, [p.signature])
  await waitOk(acceptTx)
  h.step?.(2, 'done', { tx: acceptTx })
  return { acceptTx, ...(await deliver(level, p, h)) }
}
export async function deliver(level: BountyLevel, p: ProvenClaim, h: HuntHooks = {}): Promise<{ deliverTx: Hex; amount?: bigint }> {
  const a = arcOf(level)
  h.step?.(3, 'doing')
  const deliverTx = await a.deliver(p.claim.bountyId, p.claim.fingerprint, p.cP)
  const rcpt = await waitOk(deliverTx)
  const paid = parseEventLogs({ abi: sealedBountyAbi, logs: rcpt.logs, eventName: 'BountyPaid' })[0] as { args: { amount: bigint } } | undefined
  h.step?.(3, 'done', { tx: deliverTx, amount: paid?.args.amount })
  return { deliverTx, amount: paid?.args.amount }
}

/** A payment whose transfer was refused stays as a credit on the contract. */
export async function readCredit(level: BountyLevel, who: Address): Promise<bigint> {
  return (await publicClient().readContract({ address: deploymentOf(level).sealedBounty, abi: sealedBountyAbi, functionName: 'credit', args: [who] })) as bigint
}
export async function withdrawCredit(level: BountyLevel): Promise<Hex> { const h = await arcOf(level).withdrawCredit(); await waitOk(h); return h }
/** After the deadline, the protocol withdraws what is left in the pool. */
export async function withdrawRemaining(level: BountyLevel, id: bigint): Promise<Hex> { const h = await arcOf(level).withdrawRemaining(id); await waitOk(h); return h }

/** A "create bounty" action prepared by the copilot (parameters already computed), signed as is. */
export async function createBountyRaw(p: { productId: string; predicateHash: string; protocolX25519: string; tierMinLoss: string[]; tierAmount: string[]; singleCap: string; k: number | string; targetToPause: string; deadline: string; funding: string }): Promise<{ bountyId: bigint; tx: Hex }> {
  const a = arc()
  await needFunds(BigInt(p.funding))
  const r = await a.createBounty({
    productId: BigInt(p.productId), predicateHash: p.predicateHash as Hex, protocolX25519: p.protocolX25519 as Hex,
    tierMinLoss: p.tierMinLoss.map((v) => BigInt(v)), tierAmount: p.tierAmount.map((v) => BigInt(v)),
    singleCap: BigInt(p.singleCap), k: Number(p.k), targetToPause: p.targetToPause as Address, deadline: BigInt(p.deadline), funding: BigInt(p.funding),
  })
  await waitOk(r.tx)
  return r
}
