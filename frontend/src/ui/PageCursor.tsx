// The landing's cursor on the app pages (owner, 19/11: the square cursor and its axes are part of the site's look):
// an outlined square that follows the pointer with the two axes, that stretches to hug a button or a link (8 px
// margin, ui/Sel.tsx), and that, on an element marked data-cur-arm (the Services sleds), loads like on the landing:
// the square stretches to the element's on-screen quadrilateral (its CSS 3D transform included) with the loading bar
// along its bottom edge, then holds it (data-sel="1" on the element) and shows its reading above it. A click opens
// it, as before. Same DOM and classes as the landing cursor (styles.css: .cursor, .axis, .reading).
// Axes: under the header; on a page with a [data-cur-wall] zone (the Services room), only inside that zone, from
// its left edge or right of the [data-cur-text] column laid over it, like the landing keeps them off its text.
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { onTick } from '../clock'
import { selBox } from './Sel'

const ARM_S = 0.9
const USABLE = 'a[href], button:not(:disabled), [role=switch], select, input:not([type=hidden]), textarea, summary, label[for]'

/** the four screen corners (TL, TR, BR, BL) of an element drawn with a CSS 3D transform */
function quadOf(el: HTMLElement): number[] | null {
  const tr = getComputedStyle(el).transform
  const w = el.offsetWidth, h = el.offsetHeight
  const par = el.offsetParent as HTMLElement | null
  if (!par || !w || !h) return null
  const pr = par.getBoundingClientRect()
  const x0 = pr.left + el.offsetLeft, y0 = pr.top + el.offsetTop
  if (!tr || tr === 'none') return [x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h]
  const m = new DOMMatrix(tr)
  const [ox, oy] = getComputedStyle(el).transformOrigin.split(' ').map((v) => parseFloat(v) || 0)
  const out: number[] = []
  for (const [cx, cy] of [[0, 0], [w, 0], [w, h], [0, h]]) {
    const p = m.transformPoint(new DOMPoint(cx - ox, cy - oy, 0, 1))
    const iw = p.w ? 1 / p.w : 1
    out.push(x0 + ox + p.x * iw, y0 + oy + p.y * iw)
  }
  return out
}

export function PageCursor() {
  const box = useRef<HTMLDivElement>(null)
  const ax = useRef<HTMLDivElement>(null)
  const ay = useRef<HTMLDivElement>(null)
  const tag = useRef<HTMLDivElement>(null)
  const poly = useRef<SVGPolygonElement>(null)
  const load = useRef<SVGLineElement>(null)
  const angTl = useRef<SVGPolylineElement>(null)
  const angBr = useRef<SVGPolylineElement>(null)
  useEffect(() => {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const html = document.documentElement
    html.classList.add('pg-cur')
    const P = { x: 0, y: 0, inside: false, moved: false }
    const mv = (e: PointerEvent) => { if (e.pointerType === 'touch') { P.inside = false; return } P.x = e.clientX; P.y = e.clientY; P.inside = true; P.moved = true }
    const lv = () => { P.inside = false }
    addEventListener('pointermove', mv, { passive: true })
    addEventListener('pointerdown', mv, { passive: true })
    html.addEventListener('pointerleave', lv)
    const c4 = [0, 0, 22, 0, 22, 22, 0, 22], t4 = [0, 0, 0, 0, 0, 0, 0, 0]
    let first = true, armEl: HTMLElement | null = null, arming = 0, selEl: HTMLElement | null = null, tagW = 0, prevS = ''
    const sq = (x: number, y: number, w: number, h: number) => { t4[0] = x; t4[1] = y; t4[2] = x + w; t4[3] = y; t4[4] = x + w; t4[5] = y + h; t4[6] = x; t4[7] = y + h }
    const setSel = (el: HTMLElement | null) => {
      if (selEl === el) return
      if (selEl) delete selEl.dataset.sel
      selEl = el
      if (el) el.dataset.sel = '1'
    }
    const off = onTick((_t, dt) => {
      const b = box.current, a = ax.current, c = ay.current, g = tag.current, pg = poly.current, ld = load.current
      if (!b || !a || !c || !g || !pg || !ld) return
      // a dialog or the copilot drawn over the page keeps the native pointer (nothing to frame under it)
      const show = P.inside && P.moved
      { const v = show ? '1' : '0'; if (html.dataset.cur !== v) html.dataset.cur = v }
      if (!show) { if (g.dataset.on !== '0') g.dataset.on = '0'; setSel(null); armEl = null; arming = 0; return }
      const S = 22
      sq(P.x - S / 2, P.y - S / 2, S, S)
      const under = document.elementFromPoint(P.x, P.y) as HTMLElement | null
      const arm = under?.closest<HTMLElement>('[data-cur-arm]') ?? null
      let state = 'free'
      if (arm) {
        if (arm !== armEl) { armEl = arm; arming = 0; setSel(null) }
        arming = Math.min(1, arming + dt / ARM_S)
        const q = quadOf(arm)
        if (q) {
          const k = arming >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * arming)
          for (let j = 0; j < 8; j++) t4[j] += (q[j] - t4[j]) * k
          state = arming >= 1 ? 'lock' : 'arm'
          if (arming >= 1) setSel(arm)
        }
      } else {
        armEl = null; arming = 0; setSel(null)
        const u = under?.closest<HTMLElement>(USABLE)
        if (u && !u.closest('.cursor')) {
          const r = selBox(u)
          if (r && r.w < 656 && r.h < 216) { sq(r.x, r.y, r.w, r.h); state = 'ui' }
        }
      }
      const k = first || state === 'lock' || state === 'arm' ? 1 : 1 - Math.exp(-dt / (state === 'ui' || prevS === 'ui' ? 0.05 : 0.038))
      first = false; prevS = state
      for (let j = 0; j < 8; j++) c4[j] += (t4[j] - c4[j]) * k
      const x0 = Math.min(c4[0], c4[6]), x1 = Math.max(c4[2], c4[4]), y0 = Math.min(c4[1], c4[3]), y1 = Math.max(c4[5], c4[7])
      b.style.transform = `translate3d(${x0.toFixed(1)}px, ${y0.toFixed(1)}px, 0)`
      b.style.width = `${Math.max(1, x1 - x0).toFixed(1)}px`; b.style.height = `${Math.max(1, y1 - y0).toFixed(1)}px`
      const X = (j: number) => c4[j] - x0 + (j === 2 || j === 4 ? -0.5 : 0.5), Y = (j: number) => c4[j + 1] - y0 + (j >= 4 ? -0.5 : 0.5)
      const pts = [0, 2, 4, 6].map((j) => `${X(j).toFixed(1)},${Y(j).toFixed(1)}`).join(' ')
      if (pg.getAttribute('points') !== pts) pg.setAttribute('points', pts)
      const tl = angTl.current, br = angBr.current
      if (tl && br) {
        const armP = (p: number, q: number) => { const dx = X(q) - X(p), dy = Y(q) - Y(p), l = Math.hypot(dx, dy) || 1, kk = Math.min(12, l * 0.3) / l; return `${(X(p) + dx * kk).toFixed(1)},${(Y(p) + dy * kk).toFixed(1)}` }
        const ptl = `${armP(0, 6)} ${X(0).toFixed(1)},${Y(0).toFixed(1)} ${armP(0, 2)}`
        const pbr = `${armP(4, 2)} ${X(4).toFixed(1)},${Y(4).toFixed(1)} ${armP(4, 6)}`
        if (tl.getAttribute('points') !== ptl) tl.setAttribute('points', ptl)
        if (br.getAttribute('points') !== pbr) br.setAttribute('points', pbr)
      }
      const am = state === 'arm' ? arming : 0
      const lk = `${(c4[6] - x0).toFixed(1)} ${(c4[7] - y0 - 1).toFixed(1)} ${(c4[6] - x0 + (c4[4] - c4[6]) * am).toFixed(1)} ${(c4[7] - y0 - 1 + (c4[5] - c4[7]) * am).toFixed(1)}`
      if (ld.dataset.k !== lk) { ld.dataset.k = lk; const v = lk.split(' '); ld.setAttribute('x1', v[0]); ld.setAttribute('y1', v[1]); ld.setAttribute('x2', v[2]); ld.setAttribute('y2', v[3]) }
      if (b.dataset.s !== state) b.dataset.s = state
      // the axes: under the header, inside the wall zone when the page has one
      const top = Math.round(document.querySelector<HTMLElement>('.hd')?.getBoundingClientRect().bottom ?? 0)
      const wall = document.querySelector<HTMLElement>('[data-cur-wall]')
      const wr = wall?.getBoundingClientRect()
      // a text column laid over the wall ([data-cur-text], side by side only) carries no axes, as on the landing
      const tc = wr ? document.querySelector<HTMLElement>('[data-cur-text]')?.getBoundingClientRect() : null
      const side = tc && tc.width && tc.right < innerWidth - 200
      const L = wr && wr.width ? Math.max(0, Math.round(wr.left), side ? Math.round(tc!.right + 24) : 0) : 0
      const on = P.y >= top && (!wr || (P.x >= L && P.x <= wr.right && P.y >= wr.top && P.y <= wr.bottom))
      if (a.dataset.on !== (on ? '1' : '0')) a.dataset.on = c.dataset.on = on ? '1' : '0'
      if (a.dataset.l !== String(L)) { a.dataset.l = String(L); a.style.width = `${Math.max(0, innerWidth - L)}px` }
      const T = Math.max(top, wr ? Math.round(wr.top) : 0)
      if (c.dataset.t !== String(T)) { c.dataset.t = String(T); c.style.height = `${Math.max(0, innerHeight - T)}px` }
      a.style.transform = `translate3d(${L}px, ${P.y}px, 0)`
      c.style.transform = `translate3d(${P.x}px, ${T}px, 0)`
      // the reading of an armed element (its data-cur-read, else its accessible name), above its quadrilateral
      const txt = arm ? arm.dataset.curRead || arm.getAttribute('aria-label') || '' : ''
      if (txt && state !== 'free') {
        if (g.textContent !== txt) { g.textContent = txt; tagW = g.offsetWidth }
        const gx = Math.max(8, Math.min(innerWidth - tagW - 8, Math.min(c4[0], c4[6])))
        const gy = Math.max(top + 8, Math.min(c4[1], c4[3]) - 30)
        g.style.transform = `translate3d(${gx.toFixed(0)}px, ${gy.toFixed(0)}px, 0)`
        if (g.dataset.on !== '1') g.dataset.on = '1'
      } else if (g.dataset.on !== '0') g.dataset.on = '0'
    })
    return () => {
      off(); setSel(null)
      removeEventListener('pointermove', mv); removeEventListener('pointerdown', mv); html.removeEventListener('pointerleave', lv)
      html.classList.remove('pg-cur'); delete html.dataset.cur
    }
  }, [])
  return createPortal(
    <>
      <div className="axis axis-x" ref={ax} aria-hidden="true" />
      <div className="axis axis-y" ref={ay} aria-hidden="true" />
      <div className="cursor" ref={box} aria-hidden="true"><svg className="cur-q"><polygon ref={poly} points="0,0" /><polyline ref={angTl} className="cur-a" points="0,0" /><polyline ref={angBr} className="cur-a" points="0,0" /><line ref={load} className="cur-load" /></svg></div>
      <div className="reading lbl" ref={tag} aria-hidden="true" data-front-free />
    </>,
    document.body,
  )
}
