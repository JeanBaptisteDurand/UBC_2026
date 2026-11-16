// Page order lives in ORDER: moving an id is enough to reorder sections (story, camera, progress and header follow
// the id, never the index). Sections carry data-sec="<id>"; the story position (world.story) is read at mid-viewport,
// and each section has its own progress (world.sec[id]); a pinned page reports progress within its pinned height.
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { onTick, scrollY, REDUCED, getLenis, setScrollBound, setStops, FROZEN_S, type Stop } from './clock'
import { world } from './world'

export const ORDER = ['hero', 'use', 'rent', 'publish', 'invalid', 'protocol', 'arc', 'end'] as const
export type SecId = (typeof ORDER)[number]
export const PINNED: SecId[] = ['protocol', 'arc']

let tops: number[] = [], hs: number[] = [], txts: number[] = []
let total = 1, hdH = 96
function measure() {
  const y = scrollY()
  tops = []; hs = []; txts = []
  for (const id of ORDER) {
    const el = document.querySelector<HTMLElement>(`[data-sec="${id}"]`)
    const r = el?.getBoundingClientRect()
    tops.push(r ? r.top + y : 0); hs.push(r ? r.height : 0)
    // Top of the text block in the section
    const tr = el?.querySelector<HTMLElement>(id === 'end' ? '.chain' : '.txt')?.getBoundingClientRect()
    txts.push(r && tr ? tr.top - r.top : 0)
  }
  total = document.documentElement.scrollHeight
  hdH = document.querySelector<HTMLElement>('.hd')?.getBoundingClientRect().bottom ?? 96
}
// ---- Scroll stops (clock.ts, step mode) ----
// - the hero, at the top;
// - each state section at 0.32 of its progress: title and card read under the header, camera on its slot, the
//   section gesture played;
// - the protocol, at each played step of the exploded view (cam.ts, PT); dwell only counts once the queue (protoQ)
//   has reached the step;
// - Arc, at each step: read (0.08), replay (0.2), recomputed hash (0.64), verdict (0.8);
// - the end: the proof chain under the header, then the bottom of the page.
export const STATE_STOP = 0.32
const PROTO_STOPS: [number, string][] = [[0.13, 'sortie'], [0.235, 'decalage'], [0.45, 'strates'], [0.57, 'capot'], [0.72, 'feuille'], [0.97, 'rentree']]
const ARC_STOPS: [number, string][] = [[0.08, 'lecture'], [0.2, 'rejeu'], [0.64, 'empreinte'], [0.8, 'verdict']]
function stops(): Stop[] {
  const H = innerHeight, l = getLenis(), lim = l ? l.limit : total - H
  const out: Stop[] = [{ y: 0, id: 'hero', k: 'hero' }]
  ORDER.forEach((id, i) => {
    const a = tops[i], h = hs[i]
    if (id === 'use' || id === 'rent' || id === 'publish' || id === 'invalid') {
      out.push({ y: Math.min(a + STATE_STOP * h - H / 2, a + txts[i] - hdH - 24), id, k: id })
    } else if (id === 'protocol' || id === 'arc') {
      const len = Math.max(1, h - H)
      for (const [p, k] of id === 'protocol' ? PROTO_STOPS : ARC_STOPS)
        out.push({ y: a + p * len, id, k: `${id}.${k}`, ready: id === 'protocol' ? () => Math.abs(world.protoQ - p) < 0.004 : undefined })
    } else if (id === 'end') {
      out.push({ y: a + txts[i] - hdH - 24, id, k: 'end.preuves' }, { y: lim, id, k: 'end.fin' })
    }
  })
  // In order, in the page, no duplicates
  const res: Stop[] = []
  for (const x of out) { x.y = Math.round(Math.min(lim, Math.max(0, x.y))); if (!res.length || x.y > res[res.length - 1].y + 8) res.push(x) }
  return res
}
;(window as unknown as { __stops: typeof stops }).__stops = stops
export const secTop = (id: SecId) => tops[ORDER.indexOf(id)] ?? 0
// ---- The exploded view always plays in full, in order ----
// On a fast scroll the first pinned page went by in under a second and the layers never opened. Two mechanisms:
// - a catch-up queue: the 3D reads protoQ, which follows the page progress at a bounded speed, so each step keeps a
//   minimum duration (the sequence from pull-out to sheet landing lasts at least 3 s);
// - the pinned page cannot run ahead: wheel, trackpad and keyboard (clock.ts) cannot push the page more than LAG
//   (8% of the pin) beyond what has been played. Nothing is locked: the page follows the sequence, then catches up.
// A jump (menu, anchor, Home, End) out of the pinned page sets protoQ to its end.
const LAG = 0.08
const rateAt = (q: number) => (q > 0.27 && q < 0.56 ? 0.17 : q > 0.1 && q < 0.72 ? 0.24 : 0.8)
let qLast = performance.now(), pPrev = 0
export function startStory() {
  measure()
  setStops(stops)
  setScrollBound((dir) => {
    const l = getLenis(), i = ORDER.indexOf('protocol')
    if (!l || REDUCED) return null
    const a = tops[i], len = Math.max(1, hs[i] - innerHeight), q = world.protoQ
    if (dir > 0) return q >= 0.999 || l.targetScroll > a + len + 4 ? null : a + Math.min(1, q + LAG) * len
    return q <= 0.001 || l.targetScroll < a - 4 ? null : a + Math.max(0, q - LAG) * len
  })
  addEventListener('resize', measure)
  ScrollTrigger.addEventListener('refresh', measure)
  new ResizeObserver(measure).observe(document.body)
  onTick(() => {
    const y0 = scrollY(), H = innerHeight
    // Reading line at mid-viewport (after the first half screen), so the 3D state is set when the section title reaches
    // the upper third; a pinned page reads its own progress
    const y = y0 + Math.min(y0, H * 0.5)
    let T = 0
    ORDER.forEach((id, i) => {
      const a = tops[i], h = hs[i]
      let p = PINNED.includes(id) ? (y0 - a) / Math.max(1, h - H) : (y - a) / Math.max(1, h)
      // Reduced motion: the first pinned page does not play on scroll; it shows its final readable state as soon as it enters
      if (REDUCED && id === 'protocol' && p < 1 && y0 > a - H) p = 0.72
      world.sec[id] = Math.min(1, Math.max(0, p))
      if (y >= a) T = i + Math.min(1, (y - a) / Math.max(1, (i + 1 < tops.length ? tops[i + 1] : total) - a))
    })
    world.story = T
    { const now = performance.now(), dt = Math.min(0.1, (now - qLast) / 1000); qLast = now
      const i = ORDER.indexOf('protocol'), a = tops[i], len = Math.max(1, hs[i] - H), p = world.sec.protocol ?? 0
      // A teleport (instant scrollTo, dragged scrollbar) also sets the queue; normal scrolling never moves more than
      // 0.05 screen per frame (clock.ts top speed)
      const jump = Math.abs(p - pPrev) > 0.2; pPrev = p
      if (REDUCED || FROZEN_S !== null || jump || y0 > a + len + 0.35 * H || y0 < a - 0.35 * H) world.protoQ = p
      else {
        // Bounded speed, never past a step the scene has not played yet (stage.ts, protoGate)
        const q = world.protoQ, r = rateAt(q) * dt, [lo, hi] = world.protoGate
        let n = q + Math.max(-r, Math.min(r, p - q))
        if (n > q) n = Math.min(n, Math.max(q, hi)); else if (n < q) n = Math.max(n, Math.min(q, lo))
        world.protoQ = Math.min(1, Math.max(0, n)) } }
  })
}
export const progress = () => { const max = document.documentElement.scrollHeight - innerHeight; return max > 0 ? Math.min(1, Math.max(0, scrollY() / max)) : 0 }
/** Id of the section at mid-viewport */
export function sectionAt(): SecId {
  const y = scrollY() + innerHeight * 0.5
  let k = 0
  for (let i = 0; i < tops.length; i++) if (y >= tops[i]) k = i
  return ORDER[k]
}
/** Current section in the story, and the fraction (index + fraction of world.story) */
export const storyAt = () => { const T = world.story; const k = Math.min(ORDER.length - 1, Math.floor(T)); return { id: ORDER[k], f: T - k } }
