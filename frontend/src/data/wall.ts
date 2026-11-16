// The landing wall: rack columns, slots, and the live state of each slot.
// One function decides the state of a slot (ledOf): LED, plate, card, sections and counters all read the same object.
//   off    open slot (no enclave in it);
//   amber  usable but not running: pending (product not active yet) or inactive (registration window closed);
//          also the replayed sled before its registration;
//   green  active enclave and active product: the service is running;
//   red    service or enclave invalidated: invalid, retired, slashed, product retired.
// No enclave is made up: only those from /api/enclaves fill a slot.
// three.js frame: x right, y up, facades on the z = 0 plane, +z towards the room.
import type { Activity, Bounty, Enclave, Product } from './live'
import { t, getLang } from '../i18n'
import { usdc } from './fmt'

export type Led = 'off' | 'amber' | 'green' | 'red'
export type RedWhy = 'expired' | 'idle' | 'invalidated' | 'retired' | 'slashed' | 'productRetired'
export type Service = 'ai' | 'x402' | 'bounty' | 'copilot' | 'author'

// ---- Geometry (metres) ----
// A sled facade is FW x (FT - FB), sitting on the shelf of its row (base), with its face on the z = 0 plane.
// Sled 0.268 x 0.086 x 0.78, pitch 0.094, column 0.278, rack 0.616 x 2.004 x 1.08, first slot at 0.26 m;
// four racks 0.75 m apart (the hero rack at x = 0 and its three neighbours).
export const K = 1
export const G = {
  RX: [0.0, 0.75, 1.5, 2.25], NB: 4, COLS: 2, ROWS: 16, CP: 0.278, PITCH: 0.094, Z0: 0.26,
  FB: -0.0025, FT: -0.0025 + 0.094 - 0.003, FW: 0.278 - 0.003, FT_: 0.009, SW: 0.268, SH: 0.086, SD: 0.78, Y0: 0.01,
  BW: 0.616, BH: 0.26 + 16 * 0.094 + 0.19 + 0.05, BD: 1.08, SETBACK: 0.014, IW: 0.556,
  /** Sled columns across the room (two per rack) */
  NCOLS: 8,
}
// Facade: LED slit, title plate under smoked glass, folded intake tile (sled frame: x centred, y from the base)
export const FACE = { LED: [-0.12678, -0.12173, 0.01429, 0.07321], PLATE: [-0.11457, 0.06234, 0.01071, 0.07679], FACET: [0.09098, 0.04375] } as const
export const colX = (c: number) => G.RX[c >> 1] + ((c & 1) - 0.5) * G.CP

export interface Slot {
  i: number; bay: number; col: number; row: number
  /** Facade centre (x, y), facade height, base (top of the shelf), unit (U01 at the bottom) */
  x: number; y: number; h: number; base: number; u: number
}
export const SLOTS: Slot[] = (() => {
  const out: Slot[] = []
  for (let c = 0; c < G.NCOLS; c++) for (let r = 0; r < G.ROWS; r++) {
    const base = G.Z0 + r * G.PITCH
    out.push({ i: out.length, bay: c >> 1, col: c, row: r, x: colX(c), y: base + (G.FB + G.FT) / 2, h: G.FT - G.FB, base, u: r * 2 + 1 })
  }
  return out
})()
export const NSLOTS = SLOTS.length

/** Title plate (world): edges, half height, vertical centre */
export const plateOf = (s: Slot) => ({ x0: s.x + FACE.PLATE[0], x1: s.x + FACE.PLATE[1], th: (FACE.PLATE[3] - FACE.PLATE[2]) / 2, y: s.base + (FACE.PLATE[2] + FACE.PLATE[3]) / 2 })
/** LED slit (world) */
export const ledOf3 = (s: Slot) => ({ x: s.x + (FACE.LED[0] + FACE.LED[1]) / 2, w: FACE.LED[1] - FACE.LED[0], h: FACE.LED[3] - FACE.LED[2], y: s.base + (FACE.LED[2] + FACE.LED[3]) / 2 })

// Deterministic random (mulberry32): the same wall on every visit
function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t2 = a; t2 = Math.imul(t2 ^ (t2 >>> 15), t2 | 1); t2 ^= t2 + Math.imul(t2 ^ (t2 >>> 7), t2 | 61); return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296 }
}

const p2 = (n: number) => String(n).padStart(2, '0')
export const slotLabel = (i: number) => { const s = SLOTS[i]; return `${t('bay')} ${p2(s.bay + 1)}${s.col & 1 ? 'B' : 'A'}, U${p2(s.u)}` }
export const unitText = (i: number) => `U${p2(SLOTS[i].u)}`

// ---- Services ----
// Settlement rails, as in productName() of the ArcHive SDK
const RAIL: Record<string, Service> = {
  '0x8bf8a8356f53006e9ab359aa6382f783923058a6': 'ai',
  '0xccdb1a5641f2f3f2cf2112c8e14669dbb6e11634': 'x402',
  '0x182871d34438ab37a7fd4d8689f3e0812e447a9b': 'bounty',
  '0x0000000000000000000000000000000000000000': 'copilot',
}
export function serviceOf(p?: Product | null, bounties?: Bounty[]): Service {
  if (!p) return 'author'
  const s = RAIL[p.settlement?.toLowerCase()]
  if (s) return s
  if (bounties?.some((b) => b.productId === p.id) || /bounty/i.test(p.manifestURI)) return 'bounty'
  return 'author'
}
export const svcName = (s?: Service) => t(`svc.${s ?? 'author'}` as 'svc.ai')
/** Display name of a product: the service, plus its number when two products share a name */
export function productLabel(p: Product | undefined, all: Product[] = [], bounties?: Bounty[]) {
  if (!p) return ''
  const s = serviceOf(p, bounties)
  const same = all.filter((q) => serviceOf(q, bounties) === s).length
  return same > 1 ? `${svcName(s)} #${p.id}` : svcName(s)
}

export interface Sled {
  i: number; led: Led; why?: RedWhy; reason?: string
  enclave?: Enclave; product?: Product; svc?: Service
  regBlock?: number; firstReg?: Activity; lastReg?: Activity
  client?: string
}

/** State of a slot, the single source for the whole screen */
export function ledOf(e: Enclave | undefined, p: Product | undefined, bad: Map<string, { why: RedWhy; reason?: string }>): Pick<Sled, 'led' | 'why' | 'reason'> {
  if (!e) return { led: 'off' }
  const b = bad.get(e.signer.toLowerCase())
  if (b) return { led: 'red', why: b.why, reason: b.reason }
  if (p?.state === 'Retired') return { led: 'red', why: 'productRetired' }
  if (!e.active) return { led: 'amber', why: 'expired' }
  if (p?.state === 'Active') return { led: 'green' }
  return { led: 'amber', why: 'idle' }
}

// Placement: every enclave lives in the hero rack (x = 0). The proof sled sits in the hero slot (row 9, left), valid
// enclaves around it at eye level, invalid and inactive ones lower; the neighbouring racks only hold open slots.
// Only the state is data; where a sled sits on the wall is not.
const i86 = (i: number) => (i % 2) * G.ROWS + Math.floor(i / 2)
export const HERO_SLOT = i86(16)
const LIVE_ORDER = [18, 15, 20, 13, 17, 19, 22, 11, 21, 14, 23, 12, 24, 10, 25, 9, 26, 27].map(i86)
const LAPSED_ORDER = [6, 3, 8, 1, 5, 7, 2, 4, 0, 28, 29, 30, 31].map(i86)
export const PLACES: number[] = [HERO_SLOT, ...LIVE_ORDER, ...LAPSED_ORDER]

// History of each signer read from /activity: first and last registration, and the reason for a red state
// (invalidated, retired, slashed; a re-registration clears an invalidation, never a retirement).
// Shared by the wall and the app (one source of state).
export function signerHistory(activity: Activity[] = []) {
  const asc = [...activity].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)
  const first = new Map<string, Activity>(), last = new Map<string, Activity>()
  const bad = new Map<string, { why: RedWhy; reason?: string }>()
  for (const a of asc) {
    const s = a.args.signer?.toLowerCase()
    if (a.name === 'EnclaveRegistered' && s) { if (!first.has(s)) first.set(s, a); last.set(s, a) }
    if (a.name === 'EnclaveInvalidated' && s) bad.set(s, { why: 'invalidated', reason: a.args.reason })
    if (a.name === 'EnclaveRetired' && s) bad.set(s, { why: 'retired' })
    if (a.name === 'EquivocationSlashed' && s) bad.set(s, { why: 'slashed' })
    if (a.name === 'EnclaveRegistered' && s && bad.has(s) && bad.get(s)!.why !== 'retired') bad.delete(s)
  }
  return { first, last, bad }
}

export interface Wall {
  sleds: Sled[]
  /** Examples for the state sections and the replayed sled */
  ex: { use: number; rent: number; publish: number; invalid: number; inactive: number }
  /** The replayed sled: its real registration (protocol replay and Arc check) */
  replay: number; replayTx: string | null; replayBlock: number | null
  running: string[]
  counts: Record<Led, number>
}

export function buildWall(enclaves: Enclave[] = [], products: Product[] = [], bounties: Bounty[] = [], activity: Activity[] = [], proofSigner?: string, proofTx?: string | null): Wall {
  const sleds: Sled[] = SLOTS.map((s) => ({ i: s.i, led: 'off' as Led }))
  const byP = new Map(products.map((p) => [p.id, p]))
  const asc = [...activity].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)
  const { first, last, bad } = signerHistory(activity)
  const lastClient = new Map<string, string>()
  for (const a of asc) {
    if (a.name === 'SessionOpened' && a.args.owner) lastClient.set(a.args.productId, a.args.owner)
    if (a.name === 'CallSettled' && a.args.productId && a.args.payer) lastClient.set(a.args.productId, a.args.payer)
  }
  const byAge = [...enclaves].sort((a, b) => Number(a.fromBlock ?? a.anchorBlock) - Number(b.fromBlock ?? b.anchorBlock) || Number(a.registeredAt) - Number(b.registeredAt))
  let li = 0, xi = 0
  const heroSig = proofSigner?.toLowerCase()
  const heroTaken = !!heroSig && byAge.some((e) => e.signer.toLowerCase() === heroSig)
  byAge.forEach((e) => {
    const p = byP.get(e.productId)
    const s = e.signer.toLowerCase()
    const st = ledOf(e, p, bad)
    let i: number | undefined
    if (heroTaken && s === heroSig) i = HERO_SLOT
    // Inactive (window closed) stays low with the invalid ones
    else if (st.led === 'red' || st.why === 'expired') i = LAPSED_ORDER[xi++] ?? LIVE_ORDER[li++]
    else i = LIVE_ORDER[li++] ?? LAPSED_ORDER[xi++]
    if (i === undefined || sleds[i].enclave) return
    Object.assign(sleds[i], { ...st, enclave: e, product: p, svc: serviceOf(p, bounties), firstReg: first.get(s), lastReg: last.get(s), regBlock: Number(e.fromBlock ?? e.anchorBlock) || undefined })
  })
  const greensOf = new Map<string, number>()
  for (const sl of sleds) if (sl.led === 'green' && sl.enclave) greensOf.set(sl.enclave.productId, (greensOf.get(sl.enclave.productId) ?? 0) + 1)
  for (const sl of sleds) if (sl.led === 'green' && sl.enclave && greensOf.get(sl.enclave.productId) === 1) sl.client = lastClient.get(sl.enclave.productId)
  const running = products.filter((p) => greensOf.has(p.id)).map((p) => p.id)
  // Examples: an active service for "Use a service", a replayed sled of another green service for "Publish" and the
  // protocol, a nearby open slot, an invalid one and an inactive one
  const greens = sleds.filter((x) => x.led === 'green')
  // The Use section shows the green service that received the last settled payment on Arc, so its price and its last
  // payment belong to the same service; otherwise Copilot
  const paid = asc.filter((a) => (a.name === 'CallSettled' || a.name === 'Settled') && a.args.productId).pop()?.args.productId
  const use = (greens.find((x) => paid !== undefined && x.enclave?.productId === paid) ?? greens.find((x) => x.svc === 'copilot') ?? greens[0])?.i ?? -1
  const proof = proofSigner ? sleds.find((x) => x.enclave?.signer.toLowerCase() === proofSigner.toLowerCase() && x.led === 'green' && x.i !== use) : undefined
  // The replayed sled replays a past registration and must not depend on a running enclave: when every testnet
  // enclave has expired, fall back to the proof sled whatever its state (except red), then the last registered one
  // that is not invalidated
  const lastOk = sleds.filter((x) => x.enclave && x.led !== 'red' && x.lastReg && x.i !== use).sort((a, b) => (b.lastReg!.block - a.lastReg!.block))[0]
  const proofAny = proofSigner ? sleds.find((x) => x.enclave?.signer.toLowerCase() === proofSigner.toLowerCase() && x.led !== 'red' && x.i !== use) : undefined
  const rep = proof ?? greens.find((x) => x.i !== use && x.lastReg) ?? greens.find((x) => x.lastReg) ?? proofAny ?? lastOk
  const replay = rep?.i ?? -1
  const replayTx = rep ? (rep === proof && proofTx ? proofTx : rep.lastReg?.tx ?? null) : null
  // The admission block is the one of the replayed registration transaction
  const replayBlock = (replayTx ? activity.find((a) => a.tx === replayTx && a.name === 'EnclaveRegistered')?.block : undefined) ?? rep?.lastReg?.block ?? null
  const near = (i: number) => (i >= 0 ? SLOTS[i] : SLOTS[PLACES[0]])
  const u0 = near(use)
  // The open slot is taken in the hero rack near the Use sled, preferably in the left column (its left side faces the
  // aisle, so the leader line reaches it with a single bend); otherwise in the next rack
  const rent = sleds.filter((x) => x.led === 'off' && !x.enclave && SLOTS[x.i].row >= 3 && SLOTS[x.i].row <= 13)
    .sort((a, b) => SLOTS[a.i].bay - SLOTS[b.i].bay || (SLOTS[a.i].col & 1) - (SLOTS[b.i].col & 1) || Math.abs(SLOTS[a.i].y - u0.y) - Math.abs(SLOTS[b.i].y - u0.y) || SLOTS[a.i].x - SLOTS[b.i].x)[0]?.i ?? -1
  const reds = sleds.filter((x) => x.led === 'red')
  // The Invalid section shows the inactive slot next to the invalid one. The pair is chosen so that the inactive one
  // is below the invalid one (labels in that order, so their lines never cross), in the same rack if possible
  const fulls = reds, dims = sleds.filter((x) => x.led === 'amber' && x.why === 'expired')
  let best: [number, number] | null = null, bestK = Infinity
  for (const a of fulls) for (const d of dims) {
    const A = SLOTS[a.i], D = SLOTS[d.i]
    if (D.y >= A.y || A.bay !== D.bay) continue
    // Invalid in the left column first (single-bend leader line)
    const k = Math.abs(D.y - A.y) + (A.col === D.col ? 0 : 0.5) + (a === fulls[0] ? 0 : 0.05) + (A.col & 1 ? 2 : 0)
    if (k < bestK) { bestK = k; best = [a.i, d.i] }
  }
  const invalid = best ? best[0] : (fulls.find((x) => !(SLOTS[x.i].col & 1)) ?? fulls[0] ?? reds[0])?.i ?? -1
  const iv = invalid >= 0 ? SLOTS[invalid] : null
  const inactive = best ? best[1] : dims.filter((x) => x.i !== invalid && iv && SLOTS[x.i].col === iv.col)
    .sort((a, b) => Math.abs(SLOTS[a.i].y - iv!.y) - Math.abs(SLOTS[b.i].y - iv!.y))[0]?.i ?? -1
  const counts = { off: 0, amber: 0, green: 0, red: 0 } as Record<Led, number>
  for (const s of sleds) if (s.enclave) counts[s.led]++
  // "open slots" only counts empty slots (a registered sled without an active product is not open)
  counts.off = sleds.filter((s) => !s.enclave).length
  return { sleds, ex: { use, rent, publish: replay, invalid, inactive }, replay, replayTx, replayBlock, running, counts }
}

// ---- oklch to linear sRGB for three.js (three does not read oklch()) ----
export function oklchToLinear(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const c = (x: number) => Math.max(0, x)
  return [c(r), c(g), c(bb)]
}

/** Price as the product bills it: per call (x402), per token (private AI session), otherwise the bare price */
export function priceText(p?: Product, bounties?: Bounty[]) {
  if (!p) return null
  if (!Number(p.price)) return t('card.free')
  const s = serviceOf(p, bounties)
  if (s === 'x402') return `${usdc(p.price)} ${t('card.per.call')}`
  if (s === 'ai' && Number(p.unitTokens) === 1) return `${usdc(p.price)} ${t('card.per.token')}`
  return usdc(p.price)
}
export const reasonText = (r?: string) => (r === 'collateral-or-policy' ? t('reason.policy') : r === 'workload-retired' ? t('reason.workload') : r)
export const one = (n: number) => (getLang() === 'fr' ? n <= 1 : n === 1)
/** Status text of a slot (card, cursor readout) */
export function stateText(s?: Sled, amber = false) {
  if (amber) return t('led.replay')
  // A registered enclave whose product is not active is not an open slot: amber, pending
  if (!s || s.led === 'off') return t('led.off')
  if (s.led === 'amber') return s.why === 'expired' ? t('why.expiredShort') : t('led.amber')
  if (s.led === 'red') return t(`why.${s.why ?? 'invalidated'}` as 'why.retired')
  return t(`led.${s.led}` as 'led.green')
}
/** The section that explains the state of a slot (click on a slot) */
export const sectionOfLed = (led: Led) => (led === 'green' ? 'use' : led === 'amber' ? 'publish' : led === 'red' ? 'invalid' : 'rent')
