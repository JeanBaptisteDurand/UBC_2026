// One callout at a time, at a hand-written position (a corner of the scene, then a fallback position), never
// searched at runtime, never slid from one position to another.
// The connector is 1 px in Arc blue, at most one bend, and starts from the callout corner closest to
// the anchor; if it crosses a title or a link, it is not drawn (the selection frame stays on the object).
// Motion: the connector draws (280 ms), then the callout unfolds (240 ms); it folds in 120 ms. It stays
// open while the pointer is on the element or on it (WCAG 1.4.13); Escape closes it.
import type { Fiche, Place } from './data'

type Pt = [number, number]
export type Box = [number, number, number, number]
const esc = (x: string) => x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
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
// do two segments intersect (excluding their endpoints)?
function segSeg(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}
export const W_CARD = 320
const M = 24

export function makeHoverModal(host: HTMLElement, svg: SVGSVGElement, reduced: boolean) {
  const el = document.createElement('section'); el.className = 'mdl'; el.hidden = true
  el.innerHTML = '<h2 class="m-t"></h2><p class="m-d"></p><dl class="m-body"></dl>'
  host.appendChild(el)
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('class', 'ld'); path.setAttribute('pathLength', '1')
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('class', 'ld-p'); dot.setAttribute('r', '3')
  svg.append(path, dot)
  let id: string | null = null, at = 0, h = 0, place: Place = 'bl', closing = 0, overCard = false
  const api = { busy: false, geo: null as { pts: Pt[]; place: Place } | null, id: () => id, over: () => overCard, onLeave: undefined as undefined | (() => void) }
  el.addEventListener('pointerenter', () => { overCard = true })
  el.addEventListener('pointerleave', () => { overCard = false; api.onLeave?.() })
  function fill(f: Fiche) {
    ;(el.querySelector('.m-t') as HTMLElement).textContent = f.n
    const d = el.querySelector('.m-d') as HTMLElement; d.textContent = f.d ?? ''; d.hidden = !f.d
    const kv = el.querySelector('.m-body') as HTMLElement
    kv.innerHTML = f.d ? '' : (f.kv ?? []).slice(0, 3).map(([k, v]) => `<div class="m-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')
    kv.hidden = !!f.d || !f.kv?.length
  }
  const hideNow = () => { el.hidden = true; path.style.opacity = '0'; dot.style.opacity = '0'; api.geo = null; closing = 0 }
  function set(next: string | null, f?: Fiche, places?: [Place, Place]) {
    if (next === id) return
    if (!next || !f) { if (id) { closing = performance.now(); id = null; api.busy = true } return }
    // switching elements: the old one folds (without sliding), the new one unfolds at its own position
    id = next; closing = 0; fill(f); el.hidden = false; el.style.width = W_CARD + 'px'; h = el.offsetHeight; at = performance.now()
    ;(el as HTMLElement & { _places?: [Place, Place] })._places = places ?? ['bl', 'tl']
    place = (places ?? ['bl'])[0]
  }
  function update(P: { x: number; y: number } | null, Wd: number, Hd: number, block: Box[], segs: Pt[][], left = 0) {
    api.busy = false
    const now = performance.now()
    if (closing) {
      const k = reduced ? 1 : Math.min(1, (now - closing) / 120)
      el.style.clipPath = `inset(0 0 ${(k * 100).toFixed(1)}% 0)`; path.style.opacity = String(1 - k); dot.style.opacity = '0'
      if (k >= 1) hideNow(); else api.busy = true
      return
    }
    if (!id || !P) { if (!id) hideNow(); return }
    // position: the hand-written corner, else the fallback if it covers the anchor; else no callout
    const places = (el as HTMLElement & { _places?: [Place, Place] })._places ?? ['bl', 'tl']
    const boxAt = (p: Place): Box => { const x = p[1] === 'l' ? left + M : Wd - M - W_CARD, y = p[0] === 't' ? M : Hd - M - h; return [x, y, x + W_CARD, y + h] }
    const covers = (b: Box) => P.x > b[0] - 12 && P.x < b[2] + 12 && P.y > b[1] - 12 && P.y < b[3] + 12
    const ok = places.find((p) => !covers(boxAt(p)))
    if (!ok) { hideNow(); return }
    place = ok
    const b = boxAt(place)
    el.style.transform = `translate(${b[0]}px, ${b[1]}px)`
    // the connector: from the corner closest to the anchor, horizontal then diagonal (or vertical then
    // horizontal), at most one bend; no crossing with a title or a link
    const cx = P.x < b[0] ? b[0] : P.x > b[2] ? b[2] : (P.x - b[0] < b[2] - P.x ? b[0] : b[2])
    const cy = P.y < b[1] ? b[1] : b[3]
    const start: Pt = [cx, cy]
    const dx = P.x - cx, dy = P.y - cy
    const run = Math.max(0, Math.abs(dx) - Math.abs(dy))
    const cands: Pt[][] = [[start, [cx + Math.sign(dx) * run, cy], [P.x, P.y]], [start, [cx, P.y], [P.x, P.y]]]
    const clean = (pts: Pt[]) => {
      for (let i = 1; i < pts.length; i++) {
        for (const r of block) if (segHits(pts[i - 1], pts[i], r)) return false
        for (const s of segs) for (let j = 1; j < s.length; j++) if (segSeg(pts[i - 1], pts[i], s[j - 1], s[j])) return false
      }
      return true
    }
    const geo = cands.find(clean) ?? null
    api.geo = geo ? { pts: geo, place } : null
    const tLine = reduced ? 1 : Math.min(1, (now - at) / 280), tOpen = reduced ? 1 : Math.min(1, Math.max(0, (now - at - (geo ? 280 : 0)) / 240))
    if (tLine < 1 || tOpen < 1) api.busy = true
    const ease = (x: number) => 1 - Math.pow(1 - x, 3)
    el.style.clipPath = tOpen < 1 ? `inset(0 0 ${((1 - ease(tOpen)) * 100).toFixed(1)}% 0)` : ''
    if (!geo) { path.style.opacity = '0'; dot.style.opacity = '0'; return }
    const pts = geo.filter((q, j) => j === 0 || Math.hypot(q[0] - geo[j - 1][0], q[1] - geo[j - 1][1]) > 0.5)
    path.setAttribute('d', 'M' + pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L'))
    path.style.strokeDashoffset = (1 - ease(tLine)).toFixed(4); path.style.opacity = '1'
    dot.setAttribute('cx', P.x.toFixed(1)); dot.setAttribute('cy', P.y.toFixed(1)); dot.style.opacity = tLine >= 1 ? '1' : '0'
  }
  return { set, update, api, close: () => set(null) }
}
