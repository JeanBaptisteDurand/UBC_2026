// Service catalog: a single function derives from the live reading (/products, /enclaves, /activity, /bounties)
// everything the Use page and a service page display. An enclave's status is the wall's (ledOf, badOf from wall.ts):
// the same LED on the landing and in the app.
// No hand-written numbers: what is not read stays "unknown", never zero. Only roles the chain does not state
// (product 5 at the verified operator level on v3) come from data/facts.ts.
import type { Activity, Bounty, Enclave, LiveState, Product } from '../data/live'
import { ledOf, badOf, serviceOf, svcName, signerHistory, type Led, type RedWhy, type Service } from '../data/wall'
import { C, C21, roleOf, type ProductRole } from '../data/facts'
import { t, getLang, type TKey } from '../i18n'

export interface EncRow { e: Enclave; led: Led; why?: RedWhy; reason?: string; reg?: Activity }
export interface SvcRow {
  p: Product; svc: Service; name: string
  /** service status: green running, amber published but not running, red withdrawn by its author; off: a replaced
   *  product, excluded from counters */
  led: Led
  encs: EncRow[]; running: number
  lastPay?: { a: Activity; amount?: string }
  bounties: Bounty[]
  /** latest events of this product (newest first) */
  events: Activity[]
  /** role taken from deployments.v3 (verified level); the v2.1 roles (refutation demo, replaced) are history */
  role?: ProductRole
}

const RANK: Record<Led, number> = { green: 0, amber: 1, red: 2, off: 3 }
const SESSION_EVENTS = /^(Settled|SessionClosed|SessionToppedUp|SessionKeyRotated|VerdictNotApplicable)$/

/** the product of an event: by its productId; a session event through the session opening; a bounty event through
 *  the bounty (/api/bounties: bountyId to productId); an invalidation, withdrawal or seizure through the enclave
 *  registration; a verdict (Recorded) through another event of the same transaction */
export function productOfEvent(a: Activity, all: Activity[], bySigner?: Map<string, string>, byBounty?: Map<string, string>, depth = 0): string | undefined {
  if (a.args.productId !== undefined) return String(a.args.productId)
  if (a.args.sessionId !== undefined && SESSION_EVENTS.test(a.name)) return all.find((x) => x.name === 'SessionOpened' && x.args.sessionId === a.args.sessionId)?.args.productId
  if (a.args.bountyId !== undefined) return byBounty?.get(String(a.args.bountyId))
  if (a.args.signer) return bySigner?.get(a.args.signer.toLowerCase())
  if (depth === 0) {
    const sib = all.find((x) => x !== a && x.tx === a.tx && (x.args.productId !== undefined || x.args.bountyId !== undefined || x.args.sessionId !== undefined || x.args.signer))
    if (sib) return productOfEvent(sib, all, bySigner, byBounty, 1)
  }
  return undefined
}
export const isPay = (a: Activity) => a.name === 'CallSettled' || a.name === 'Settled'
export const payAmount = (a: Activity) => a.args.amount ?? a.args.paidDelta
export const isSupersededRow = (r: SvcRow) => r.role?.role === 'superseded'

export function catalog(s: Pick<LiveState, 'products' | 'enclaves' | 'activity' | 'bounties' | 'chain'>): SvcRow[] | undefined {
  if (!s.products) return undefined
  const activity = s.activity ?? [], enclaves = s.enclaves ?? [], bounties = s.bounties ?? []
  const { last } = signerHistory(activity)
  const bad = badOf(enclaves, activity, s.chain)
  const desc = [...activity].sort((a, b) => b.block - a.block || b.logIndex - a.logIndex)
  const bySigner = new Map(enclaves.map((e) => [e.signer.toLowerCase(), e.productId]))
  const byBounty = new Map(bounties.map((b) => [b.id, b.productId]))
  const names = new Map<Service, number>()
  for (const p of s.products) { const k = serviceOf(p, bounties); names.set(k, (names.get(k) ?? 0) + 1) }
  const rows = s.products.map((p): SvcRow => {
    const svc = serviceOf(p, bounties)
    const role = roleOf(p.id)
    const encs = enclaves.filter((e) => e.productId === p.id).map((e): EncRow => ({ e, ...ledOf(e, p, bad), reg: last.get(e.signer.toLowerCase()) }))
      .sort((a, b) => RANK[a.led] - RANK[b.led] || Number(b.e.registeredAt) - Number(a.e.registeredAt))
    const running = encs.filter((x) => x.led === 'green').length
    // the refutation demo (product 5 of v2.1) is the operator caught lying: red with "Bond seized" (stateLabel), as on
    // the landing and its family face, never "waiting" as if it would run again
    const led: Led = role?.role === 'superseded' ? 'off' : p.state === 'Retired' || role?.role === 'refuteDemo' ? 'red' : running > 0 ? 'green' : 'amber'
    const events = desc.filter((a) => productOfEvent(a, activity, bySigner, byBounty) === p.id && a.name !== 'EnclaveImage')
    const pay = events.find(isPay)
    return {
      p, svc, name: (names.get(svc) ?? 0) > 1 ? `${svcName(svc)} #${p.id}` : svcName(svc), led, encs, running,
      lastPay: pay ? { a: pay, amount: payAmount(pay) } : undefined,
      bounties: bounties.filter((b) => b.productId === p.id), events, role,
    }
  })
  return rows.sort((a, b) => RANK[a.led] - RANK[b.led] || Number(a.p.id) - Number(b.p.id))
}

/** the first-screen verdict, derived from the same rows; a replaced product does not count */
export function verdictOf(rows: SvcRow[]) {
  const live = rows.filter((r) => !isSupersededRow(r))
  return { running: live.filter((r) => r.led === 'green').length, total: live.length, enclaves: live.reduce((n, r) => n + r.running, 0) }
}

/** a service status in two or three words (catalog, Publish page) */
export function stateLabel(r: SvcRow) {
  if (r.role?.role === 'superseded') return t('app.st.superseded', { id: r.role.by })
  if (r.role?.role === 'refuteDemo') return getLang() === 'fr' ? 'Caution saisie' : 'Bond seized'
  if (r.p.state === 'Proposed') return t('app.st.proposed')
  return t(`app.st.${r.led}` as TKey)
}

export type StateFilter = 'all' | 'green' | 'amber' | 'red'
export type KindFilter = 'all' | Service

/** search: name, number (#3 or 3), author, operator or enclave address (prefix or fragment) */
export function matches(r: SvcRow, q: string) {
  const s = q.trim().toLowerCase()
  if (!s) return true
  const id = s.replace(/^#/, '')
  if (/^\d+$/.test(id)) return r.p.id === id
  const hay = [r.name, svcName(r.svc), r.p.author, ...r.encs.flatMap((x) => [x.e.operator, x.e.signer])].join(' ').toLowerCase()
  return s.split(/\s+/).every((w) => hay.includes(w))
}
export const kindsOf = (rows: SvcRow[]) => [...new Set(rows.map((r) => r.svc))]

/** name of the settlement contract (deployments.v3.testnet.json, and the v2.1 ones for history, via data/facts.ts), or
 *  its short address */
export const RAIL_NAME: Record<string, string> = {
  [C.SessionPay.toLowerCase()]: 'SessionPay',
  [C.X402Settler.toLowerCase()]: 'X402Settler',
  [C.SealedBounty.toLowerCase()]: 'SealedBounty',
  [C.SealedBountyVerified.toLowerCase()]: 'SealedBountyVerified',
  [C21.SessionPay.toLowerCase()]: 'SessionPay',
  [C21.X402Settler.toLowerCase()]: 'X402Settler',
  [C21.SealedBounty.toLowerCase()]: 'SealedBounty',
  [C21.SealedBountyVerified.toLowerCase()]: 'SealedBountyVerified',
  [C21.SealedBountyVerifiedOld.toLowerCase()]: 'SealedBountyVerified (16/11)',
}
/** a product's type line (catalog, service page): its settlement rail, and its role if any */
export const railKey = (p: Product): TKey => {
  const s = p.settlement.toLowerCase()
  if (/^0x0+$/.test(s)) return 'app.rail.free'
  const role = roleOf(p.id)?.role
  if (role === 'superseded') return 'app.rail.superseded'
  const n = RAIL_NAME[s]
  if (n === 'SealedBountyVerified') return 'app.rail.bountyVerified'
  if (n === 'SealedBounty') return role === 'refuteDemo' ? 'app.rail.refuteDemo' : 'app.rail.bounty'
  return n === 'SessionPay' ? 'app.rail.session' : n === 'X402Settler' ? 'app.rail.x402' : 'app.rail.other'
}
