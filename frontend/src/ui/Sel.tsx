// The two opposite corners grammar, top left and bottom right.
// - PageAngles: two thin corners framing the page, under the header on the left and at the bottom right, in margins;
// - SelFrame: the selection frame for pages without a drawn cursor (app, landing without WebGL) on hover, and
//   everywhere on keyboard focus: a one-pixel rule and its two corners, 8 px from the target box on all four sides
//   (on a slot, the frame hugs it to the pixel, like the locked cursor). The focus rule is also the outline of
//   the element (styles.css); here, the corners. The logo has no frame: it lights up (styles.css, .logo).
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { onTick } from '../clock'

export const SEL_PAD = 8
const USABLE = 'a[href], button:not(:disabled), [role=switch], select, input:not([type=hidden]), summary'
const target = (el: Element | null) => {
  const u = el?.closest?.(USABLE) as HTMLElement | null
  if (!u || u.closest('.cursor')) return null
  return u
}
/** Frame margin around a target: 8 px, except the slot (the mirror button covers the slot to the pixel) */
export const padOf = (el: Element) => (el.closest('.mirror') ? 0 : SEL_PAD)
// On the logo, the frame hugs the rectangle exactly, flush with its outer stroke, with no margin and without the
// overhanging arrow. In the viewBox (152.477 x 83.40358) the rectangle runs from x 0 to 152.477 and from
// y 22.41246 to 83.40358: it is taken from the SVG box (transforms included, the footer moves it up)
const LOGO_Y0 = 22.412462 / 83.40358
/** Selection frame rectangle of a target (CSS px, on screen) */
export function selBox(el: Element): { x: number; y: number; w: number; h: number } | null {
  // a field inside a framed control (the catalog search: icon, input, count) is framed as the whole control
  const box = el.closest('.net-cat-q')
  if (box) { const r = box.getBoundingClientRect(), m = SEL_PAD; return r.width ? { x: r.x - m, y: r.y - m, w: r.width + 2 * m, h: r.height + 2 * m } : null }
  if (el.closest('.logo')) {
    const svg = el.closest('.logo')!.querySelector('svg.logo-svg') ?? el.querySelector('svg.logo-svg')
    const r = svg?.getBoundingClientRect(); if (!r || !r.width) return null
    return { x: r.x, y: r.y + r.height * LOGO_Y0, w: r.width, h: r.height * (1 - LOGO_Y0) }
  }
  const r = el.getBoundingClientRect(); if (!r.width) return null
  const m = padOf(el)
  return { x: r.x - m, y: r.y - m, w: r.width + 2 * m, h: r.height + 2 * m }
}

function Frame({ kind }: { kind: 'hover' | 'focus' }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const P = { x: -1, y: -1, fine: matchMedia('(hover: hover) and (pointer: fine)').matches, in: false }
    const mv = (e: PointerEvent) => { P.x = e.clientX; P.y = e.clientY; P.in = e.pointerType !== 'touch' }
    const lv = () => { P.in = false }
    if (kind === 'hover') { addEventListener('pointermove', mv, { passive: true }); document.documentElement.addEventListener('pointerleave', lv) }
    const cur = { x: 0, y: 0, w: 0, h: 0 }
    let on = false, last: Element | null = null
    const off = onTick((_t, dt) => {
      const f = ref.current
      if (!f) return
      let el: HTMLElement | null = null
      if (kind === 'focus') {
        const a = document.activeElement as HTMLElement | null
        if (a && a !== document.body && a.matches(':focus-visible')) el = a
      } else if (P.fine && P.in && document.documentElement.dataset.cur !== '1') {
        el = target(document.elementFromPoint(P.x, P.y))
        // the target already has keyboard focus: a single frame
        if (el && el === document.activeElement && el.matches(':focus-visible')) el = null
      }
      let t = el ? selBox(el) : null
      if (t && (t.y + t.h < 0 || t.y > innerHeight)) t = null
      if (!t || !el) { if (on) { on = false; f.dataset.on = '0' } last = null; return }
      // appears in place; from one target to the next, the frame slides (same constant as the landing cursor)
      const k = !on || el === last ? 1 : 1 - Math.exp(-dt / 0.05)
      cur.x += (t.x - cur.x) * k; cur.y += (t.y - cur.y) * k; cur.w += (t.w - cur.w) * k; cur.h += (t.h - cur.h) * k
      if (Math.abs(t.x - cur.x) < 0.3 && Math.abs(t.y - cur.y) < 0.3) last = el
      f.style.transform = `translate3d(${cur.x.toFixed(1)}px, ${cur.y.toFixed(1)}px, 0)`
      f.style.width = `${cur.w.toFixed(1)}px`; f.style.height = `${cur.h.toFixed(1)}px`
      f.dataset.lame = el.closest('.mirror') ? '1' : '0'
      if (!on) { on = true; f.dataset.on = '1' }
    })
    return () => { off(); removeEventListener('pointermove', mv); document.documentElement.removeEventListener('pointerleave', lv) }
  }, [kind])
  return <div className={`self self-${kind}`} ref={ref} data-on="0" aria-hidden="true" data-front-free />
}

export function PageAngles() {
  return (
    <div className="pg-ang" aria-hidden="true" data-front-free>
      <i className="pg-a pg-tl" /><i className="pg-a pg-br" />
    </div>
  )
}

/** Mounted once per page, with the header (landing and app) */
export function SelLayer() {
  return createPortal(<><PageAngles /><Frame kind="hover" /><Frame kind="focus" /></>, document.body)
}
