// 2 to 5: the state sections act as the legend. Each frames a real slot of its state in the
// wall, linked to the text by a line, and describes the service, not the metaphor. The carried buttons dock here.
import { useEffect, useRef } from 'react'
import { useLive, type Activity } from '../data/live'
import { num, short, pct, usdc } from '../data/fmt'
import { t, useLang, type TKey } from '../i18n'
import { world, useWallVersion } from '../world'
import { productLabel, priceText, reasonText, slotLabel, whyText, SLOTS, G, type Led } from '../data/wall'
import { roleOf, refutationOfOperator } from '../data/facts'
import { tx } from '../links'
import { useIn } from '../ui/gestures'
import { Slot } from '../ui/Frame'
import { Title } from './Hero'
import { onTick, scrollTo, getLenis, step } from '../clock'
import type { SecId } from '../story'

type Id = 'use' | 'rent' | 'publish' | 'invalid'

/** The product a payment belongs to: a per-call payment (CallSettled) names it; a session payment (Settled) names its
 *  session, whose opening (SessionOpened) names the product */
const payProduct = (a: Activity, all: Activity[]) => a.name === 'CallSettled' ? a.args.productId
  : a.name === 'Settled' ? all.find((x) => x.name === 'SessionOpened' && x.args.sessionId === a.args.sessionId)?.args.productId : undefined
const isPay = (a: Activity) => a.name === 'CallSettled' || a.name === 'Settled'

/** The Use gesture, a counted payment. The last payment settled on Arc (read live; or the one given) counts up from
 *  zero to its amount while the green LED takes it (0.16 to 0.42 of the section, on scroll, reversed when scrolling up) */
function UseCount({ pay }: { pay?: Activity }) {
  const lang = useLang()
  const activity = useLive((s) => s.activity)
  const last = pay ?? activity?.find(isPay)
  const micro = Number(last?.args.amount ?? last?.args.paidDelta ?? 0)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!micro) return
    const full = usdc(micro, lang) ?? ''
    const dec = (full.split(' ')[0].split(/[.,]/)[1] ?? '').length
    return onTick(() => {
      const gp = world.sec.use ?? 0
      // done at 0.30, before the section stop (story.ts, STATE_STOP)
      const c = Math.min(1, Math.max(0, (gp - 0.14) / 0.16))
      const v = (Math.round(micro * c) / 1e6).toFixed(dec)
      const txt = `${lang === 'fr' ? v.replace('.', ',') : v} USDC`
      if (ref.current && ref.current.textContent !== txt) ref.current.textContent = txt
    })
  }, [micro, lang])
  // no payment in the read window is stated, instead of an endless reading
  if (!last) return <>{activity ? t('end.none') : t('state.loading')}</>
  return <span ref={ref} className="tnum">{usdc(micro, lang)}</span>
}
/** The sentence says where the Arc check is (after the protocol) and leads there */
function Why() {
  useLang()
  const [a, b] = t('invalid.why').split('{link}')
  return <p className="why">{a}<a className="tlink" href="#arc" onClick={(e) => { e.preventDefault(); scrollTo('#arc') }}>{t('invalid.link')}</a>{b}</p>
}
const LEDK: Record<Id, Led> = { use: 'green', rent: 'off', publish: 'amber', invalid: 'red' }

export function StateSection({ id }: { id: Id }) {
  const ref = useRef<HTMLElement>(null)
  useIn(ref)
  const lang = useLang()
  useWallVersion()
  const products = useLive((s) => s.products)
  const bounties = useLive((s) => s.bounties)
  const activity = useLive((s) => s.activity)
  const lastPay = activity?.find((a) => a.name === 'CallSettled' || a.name === 'Settled')
  const w = world.wall
  const ex = id === 'use' ? w.ex.use : id === 'rent' ? w.ex.rent : id === 'publish' ? w.ex.publish : w.ex.invalid
  const s = ex >= 0 ? w.sleds[ex] : undefined
  const e = s?.enclave, p = s?.product
  // The Publish section does not refer to amber: its label counts the published services (active products);
// without product 6, replaced by 7
// "published on Arc" counts all active products on Arc, the replaced no. 6 included (7, like the console)
  const count = id === 'publish' ? (products ? products.filter((x) => x.state === 'Active').length : null) : w.counts[LEDK[id]]
  const rows: [string, React.ReactNode][] = []
  // the minimum bond of a real service, neither the refutation demo (product 5) nor the replaced product (6)
  const minBond = products?.filter((x) => x.state === 'Active' && !roleOf(x.id)).reduce((m, x) => Math.min(m, Number(x.minBond)), Infinity)
  const opShare = products?.find((x) => x.state === 'Active')
  if (id === 'use' && s) {
    // "Latest payment" is that of this service (a session payment counts for the product its session was opened on);
    // if this service has none in the read window, the line gives the network's latest and says for which service,
    // never silently attached to the framed slot
    const all = activity ?? []
    const ownPay = p ? all.find((a) => isPay(a) && payProduct(a, all) === p.id) : undefined
    const netPid = lastPay ? payProduct(lastPay, all) : undefined
    const other = !ownPay && netPid ? products?.find((x) => x.id === netPid) : null
    rows.push([t('card.service'), productLabel(p, products, bounties)], [t('card.price'), priceText(p, bounties) ?? '-'], [t('card.operator'), e ? short(e.operator, 4) : '-'], [t('card.anchored'), e ? t('card.block', { n: num(Number(e.anchorBlock), lang)! }) : '-'],
      ownPay || !lastPay ? [t('end.last'), <UseCount pay={ownPay} />] : [t('use.lastNet'), <><UseCount pay={lastPay} />{other ? `, ${productLabel(other, products, bounties)}` : ''}</>])
  }
  if (id === 'rent') {
    rows.push([t('rent.pair'), t('rent.pair.v')], [t('rent.bond'), minBond !== undefined && Number.isFinite(minBond) ? usdc(minBond, lang) : t('state.loading')], [t('rent.share'), opShare ? pct(opShare.bpsOperator, lang) : t('state.loading')])
  }
  if (id === 'publish' && s) {
    // the split in three key, value lines (a list of three unlabelled percentages did not read)
    rows.push([t('card.service'), productLabel(p, products, bounties)], [t('rent.share'), p ? pct(p.bpsOperator, lang) : '-'], [t('split.author'), p ? pct(p.bpsAuthor, lang) : '-'], [t('publish.network'), p ? pct(p.bpsNetwork, lang) : '-'], [t('card.operator'), e ? short(e.operator, 4) : '-'])
  }
  if (id === 'invalid') {
    if (s) rows.push([slotLabel(ex), `${productLabel(p, products, bounties)}, ${whyText(s.why)}`])
    // the refutation demo seizure, with its transaction on Arc (data/facts.ts)
    const rf = s?.why === 'slashed' ? refutationOfOperator(e?.operator) : undefined
    if (rf) rows.push([t('card.reason'), <>{t('reason.refuted', { id: rf.bountyId, a: usdc(rf.seized, lang) ?? '' })} <a className="tlink" href={tx(rf.refuteTx)} target="_blank" rel="noreferrer">{`${t('word.block')} ${num(rf.refuteBlock, lang)}`}</a></>])
    else if (s?.reason) rows.push([t('card.reason'), reasonText(s.reason)])
    // the Invalid section no longer mentions amber (no label, no line for the inactive slot)
  }
  const key = `${id}.key` as TKey
  return (
    <section className={`sec st st-${id}`} data-sec={id} ref={ref} id={id}>
      <div className="txt" data-clip>
        <Title k={`${id}.title` as TKey} />
        <p className="key lbl" data-lead={id}>{id !== 'publish' ? <span className={`led led-${LEDK[id]}`} aria-hidden="true" /> : null}{t(key)}{count !== null ? <span className="tnum key-n" data-front-free>{t(id === 'publish' ? 'publish.count' : 'state.count', { n: count })}</span> : null}</p>
        <p className="lede">{t(`${id}.lede` as TKey)}</p>
        {/* the wall itself is the catalog: a click on a sled opens it in Network's Use part, already picked */}
        {id === 'use' ? <p className="pick-hint lbl" data-front-free><span className="pick-ic" aria-hidden="true"><i className="pick-ring" /><svg viewBox="0 0 16 16"><path d="M4 2 L4 13 L7 10 L9.4 14.6 L11.2 13.7 L8.8 9.2 L13 9.2 Z" /></svg></span><span>{t('use.pick')}</span></p> : null}
        {id === 'publish' && w.replayBlock && s ? <p className="replay lbl">{t('publish.replay', { s: productLabel(p, products, bounties), b: num(w.replayBlock, lang)! })}</p> : null}
        {rows.length ? (
          <dl className="kv unfold">
            {rows.map(([k, v], j) => <div className="row" key={k + j} style={{ ['--j' as string]: j }}><dt className="lbl">{k}</dt><dd className="mono">{v}</dd></div>)}
          </dl>
        ) : null}
        {id === 'invalid' ? <Why /> : <div className="dock"><Slot k={id as 'use' | 'rent' | 'publish'} /></div>}
      </div>
    </section>
  )
}

/** Leader lines: from the section state label to the slot it frames (on screen, to the pixel, every frame).
 *  A line breaks only once, two segments at most. It starts at the end of the label text, makes at most one
 *  elbow, then reaches the slot; it crosses neither text nor another slot. Three
 *  candidate paths, tried in order, each tested against the text lines of the page (real line boxes)
 *  and the faces of all the other slots projected on screen:
 *  D. horizontal from the label to the elbow, then at 45 degrees to the left side of the slot (the common case: the
 *     targeted slot is in the left column of its rack, data/wall.ts picks it that way);
 *  A. slanted from the label to the rack edge, at the slot height, then horizontal to its left
 *     side (face-on arrival);
 *  B. horizontal from the label to the rack edge, then slanted to the left side of the slot;
 *  C. (slot of the right column, whose left side touches its neighbour) slanted to the gap above
 *     (or below) its row, then horizontal in the gap until above the slot, where the dot
 *     sits on its edge.
 *  The choice is re-read every 8 frames (the camera moves), the geometry every frame. window.__leads exposes it to
 *  probes. */
const LEADS: { id: SecId; lab: string; ex: () => number }[] = [
  { id: 'use', lab: 'use', ex: () => world.wall.ex.use },
  { id: 'rent', lab: 'rent', ex: () => world.wall.ex.rent },
  { id: 'publish', lab: 'publish', ex: () => world.wall.ex.publish },
  { id: 'invalid', lab: 'invalid', ex: () => world.wall.ex.invalid },
]
type Pt = [number, number]
type Box = [number, number, number, number]
/** Does segment [a, b] cross the box (x0, y0, x1, y1)? (Liang-Barsky) */
function segHits(a: Pt, b: Pt, r: Box) {
  let t0 = 0, t1 = 1
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const ps = [-dx, dx, -dy, dy], qs = [a[0] - r[0], r[2] - a[0], a[1] - r[1], r[3] - a[1]]
  for (let k = 0; k < 4; k++) {
    if (ps[k] === 0) { if (qs[k] < 0) return false; continue }
    const u = qs[k] / ps[k]
    if (ps[k] < 0) { if (u > t1) return false; if (u > t0) t0 = u } else { if (u < t0) return false; if (u < t1) t1 = u }
  }
  return t1 - t0 > 1e-4
}
const hitsAny = (pts: Pt[], boxes: Box[]) => { let n = 0; for (let k = 1; k < pts.length; k++) for (const b of boxes) if (segHits(pts[k - 1], pts[k], b)) n++; return n }
export function Leads() {
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const rg = document.createRange()
    type Geo = { pts: Pt[]; dot: Pt; d: number; kind: string; hits: number }
    const geo: (Geo | null)[] = LEADS.map(() => null)
    const kinds: string[] = LEADS.map(() => '')
    const blocked: boolean[] = LEADS.map(() => false)
    let frame = 0
    // line boxes of the visible text (titles, labels, paragraphs, rows, buttons): obstacles
    const textBoxes = (): Box[] => {
      const out: Box[] = []
      document.querySelectorAll<HTMLElement>('[data-sec] .txt > *, .carrier .btn, .hd').forEach((el) => {
        const r0 = el.getBoundingClientRect()
        if (r0.bottom < 0 || r0.top > innerHeight || !r0.width) return
        if (el.matches('.btn, .hd')) { out.push([r0.left, r0.top, r0.right, r0.bottom]); return }
        rg.selectNodeContents(el)
        for (const r of rg.getClientRects()) if (r.width > 0.5 && r.height > 0.5) out.push([r.left + 1, r.top + 1, r.right - 1, r.bottom - 1])
      })
      return out
    }
    const P = () => world.toScreen!
    /** The on-screen face of a slot (bounding box), slightly shrunk (the line may touch an edge, not enter) */
    const face = (i: number, z = 0): Box => {
      const s = SLOTS[i], a = P()(s.x - G.FW / 2, s.base + G.FT, z), b = P()(s.x + G.FW / 2, s.base + G.FB, z)
      return [Math.min(a.x, b.x) + 1, Math.min(a.y, b.y) + 1, Math.max(a.x, b.x) - 1, Math.max(a.y, b.y) - 1]
    }
    const sledBoxes = (except: number, ty: number): Box[] => {
      const out: Box[] = []
      for (const s of SLOTS) {
        if (s.i === except) continue
        const b = face(s.i)
        if (b[3] < 0 || b[1] > innerHeight || b[2] < 0 || b[0] > innerWidth) continue
        // only the slots between the label and the targeted slot count (in height, with a margin)
        if (Math.abs((b[1] + b[3]) / 2 - ty) > innerHeight) continue
        out.push(b)
      }
      return out
    }
    const api = { geo, kinds, blocked }
    ;(window as unknown as { __leads: typeof api }).__leads = api
    // the lines are drawn for a page at rest: they vanish at once on the first gesture (before the page moves, so they
    // never stretch) and fade back in once the page has settled
    let hideAt = 0, lastMove = 0
    const hide = () => { hideAt = performance.now(); const el = svg.current; if (el) { el.style.transition = 'none'; el.style.opacity = '0' } }
    addEventListener('wheel', hide, { passive: true }); addEventListener('touchstart', hide, { passive: true }); addEventListener('keydown', hide)
    const offTick = onTick(() => {
      const el = svg.current; if (!el) return
      const lm = getLenis(), now = performance.now()
      if (step.moving || (!!lm && Math.abs(lm.velocity) > 0.05)) lastMove = now
      const rest = now - Math.max(lastMove, hideAt) > 260
      const op = rest ? '1' : '0'
      if (el.style.opacity !== op) { el.style.transition = rest ? 'opacity 320ms var(--productive)' : 'none'; el.style.opacity = op }
      const paths = el.querySelectorAll('path'), dots = el.querySelectorAll('circle')
      const T = world.toScreen
      const relook = frame++ % 8 === 0
      let tb: Box[] | null = null
      LEADS.forEach(({ id, lab: lk, ex: exf }, k) => {
        const lab = document.querySelector<HTMLElement>(`[data-lead="${lk}"]`)
        const ex = exf()
        const r = ex >= 0 ? world.rects.get(ex) : undefined
        const p = world.sec[id] ?? 0
        const on = !!T && !!lab && !!r && r.vis && p > 0.18 && p < 0.86 && innerWidth >= 760
        if (!on) { geo[k] = null; kinds[k] = ''; blocked[k] = false; return }
        rg.selectNodeContents(lab!)
        const a = rg.getBoundingClientRect()
        // text passes under the carried buttons line: the mask (Frame.tsx) gives its cut in data-cut
        const clip = !!lab!.closest<HTMLElement>('[data-clip]')?.dataset.cut
        if (clip && a.bottom > innerHeight - 140) { geo[k] = null; return }
        const s = SLOTS[ex], z = world.lock === ex || world.hover === ex ? 0.03 : 0
        const bayL = T!(G.RX[s.bay] - G.BW / 2, s.base, 0).x
        const fb = face(ex, z)
        const x0 = a.right + 14, y0 = a.top + a.height / 2
        const xa = Math.max(x0 + 16, bayL - 18)
        const ty = (fb[1] + fb[3]) / 2, tx = fb[0] - 1
        // the line draws quickly, on scroll (0.18 to 0.26 of the section), and retracts the same way when scrolling up
        const d0 = Math.min(1, Math.max(0, (p - 0.18) / 0.08)), d = d0 * d0 * (3 - 2 * d0)
        const P0: Pt = [x0, y0]
        // the candidates (at most one elbow each)
        const gyUp = (T!(s.x, s.base + (G.FT + G.PITCH + G.FB) / 2, 0).y), gyDn = T!(s.x, s.base + (G.FB + G.FT - G.PITCH) / 2, 0).y
        const xin = fb[0] + Math.min(14, (fb[2] - fb[0]) * 0.25)
        // D: horizontal to the elbow, then at 45 degrees to the left side (the elbow as close as possible to the rack,
// never in the text column)
        const xd = Math.min(xa, Math.max(x0 + 16, tx - Math.abs(ty - y0)))
        const cands: Record<string, { pts: Pt[]; dot: Pt }> = {
          D: { pts: [P0, [xd, y0], [tx, ty]], dot: [tx + 1, ty] },
          A: { pts: [P0, [xa, ty], [tx, ty]], dot: [tx + 1, ty] },
          B: { pts: [P0, [xa, y0], [tx, ty]], dot: [tx + 1, ty] },
          Cu: { pts: [P0, [xa, gyUp], [xin, gyUp]], dot: [xin, fb[1] - 1] },
          Cd: { pts: [P0, [xa, gyDn], [xin, gyDn]], dot: [xin, fb[3] + 1] },
        }
        const order = s.col & 1 ? ['Cu', 'Cd', 'D', 'A', 'B'] : ['D', 'A', 'B', 'Cu', 'Cd']
        if (relook || (!kinds[k] && !blocked[k])) {
          tb ??= textBoxes()
          const sb = sledBoxes(ex, ty)
          let best = order[0], bh = Infinity
          for (const kk of order) { const h = hitsAny(cands[kk].pts, tb) + hitsAny(cands[kk].pts, sb); if (h < bh) { bh = h; best = kk } if (h === 0) break }
          // keep the current path if it is still clear (no jumping from one path to another for nothing)
          if (kinds[k] && kinds[k] !== best) { const hk = hitsAny(cands[kinds[k]].pts, tb) + hitsAny(cands[kinds[k]].pts, sb); if (hk === 0) best = kinds[k], bh = 0 }
          kinds[k] = best
          geo[k] = { ...cands[best], d, kind: best, hits: bh }
          // no clean path (tablet: the targeted slot passes under the text column): no line rather than a line
// crossing the text or another slot; the label keeps its LED
          // Fallback (a target in the right column, whose every path touches a neighbouring sled): the path that runs in
          // the gap between two rows (Cu, Cd), or else any path, as long as it crosses no text. Only a path through
          // the text is refused (no line rather than a line over the words)
          if (bh > 0) {
            const fb2 = ['Cu', 'Cd', ...order.filter((x) => x !== 'Cu' && x !== 'Cd')].find((kk) => hitsAny(cands[kk].pts, tb!) === 0)
            if (fb2) { best = fb2; bh = 0; kinds[k] = best; geo[k] = { ...cands[best], d, kind: best, hits: 0 } }
          }
          if (bh > 0) { kinds[k] = ''; geo[k] = null; blocked[k] = true } else blocked[k] = false
        } else geo[k] = blocked[k] ? null : { ...cands[kinds[k]], d, kind: kinds[k], hits: geo[k]?.hits ?? 0 }
      })
      geo.forEach((g, k) => {
        const path = paths[k] as SVGPathElement, dot = dots[k] as SVGCircleElement
        if (!g) { if (path.style.opacity !== '0') { path.style.opacity = '0'; dot.style.opacity = '0' } return }
        // two segments at most: one elbow; a zero-length segment is removed
        const pts = g.pts.filter((q, j) => j === 0 || Math.hypot(q[0] - g.pts[j - 1][0], q[1] - g.pts[j - 1][1]) > 0.5)
        path.setAttribute('d', 'M' + pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L'))
        dot.setAttribute('cx', g.dot[0].toFixed(1)); dot.setAttribute('cy', g.dot[1].toFixed(1))
        path.style.strokeDashoffset = (1 - g.d).toFixed(4)
        path.style.opacity = g.d > 0.001 ? '1' : '0'; dot.style.opacity = g.d > 0.97 ? '1' : '0'
      })
    })
    return () => { offTick(); removeEventListener('wheel', hide); removeEventListener('touchstart', hide); removeEventListener('keydown', hide) }
  }, [])
  return (
    <svg className="leads" ref={svg} aria-hidden="true" width="100%" height="100%">
      <path className="ld" pathLength={1} /><path className="ld" pathLength={1} /><path className="ld" pathLength={1} /><path className="ld" pathLength={1} />
      <circle className="ld-p" r="3" /><circle className="ld-p" r="3" /><circle className="ld-p" r="3" /><circle className="ld-p" r="3" />
    </svg>
  )
}
