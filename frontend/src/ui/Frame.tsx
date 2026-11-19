// Landing frame: two-row header, a progress bar that is first the loading bar, X and Y axes following the mouse,
// over the server room. The cursor is a square seen only as an outline; resting on a slot, it stretches until it
// hugs it to the pixel (this stretch is the lock loading), then the card stays open and "Open Service" can be
// clicked. Touch: a tap locks. Keyboard: focusing a slot locks it.
import { useEffect, useRef, useState } from 'react'
import { useLive, blockTime, ago } from '../data/live'
import { num, short, usdc } from '../data/fmt'
import { t, useLang, setLang, getLang, type TKey } from '../i18n'
import { link, networkFor } from '../links'
import { world, setLock, useLock, useWallVersion, useLoupe } from '../world'
import { G, SLOTS, NSLOTS, slotLabel, productLabel, priceText, reasonText, stateText, colX, type Sled } from '../data/wall'
import { onTick, REDUCED, getLenis, step } from '../clock'
import { openService, slotHref } from './ServicePanel'
import { MainNav } from './MainNav'
import { HeaderWallet } from '../network/actions/HeaderWallet'
import '../network/actions/actions.css'
import { progress, ORDER } from '../story'
import { Logo } from './Logo'
import { SelLayer, selBox } from './Sel'
import { loadP, isLeaving, arrivedAt, installPageExit } from './pageload'

// ---------------- logo: the rack reduced to two slots, a hexagon in place of the LED ----------------
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="mark">
      <rect x="2" y="3.5" width="20" height="17" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 12h20" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.1 5.65 9.2 6.86v2.42L7.1 10.5 5 9.28V6.86Z" className="mark-hex" />
      <path d="M12 7.75h6.5M12 16.25h6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}

/** Amber state of the replayed sled: on <html> (real-time scene) or on .stage (video landing) */
let stageEl: HTMLElement | null = null
const amberNow = () => document.documentElement.dataset.amber === '1' || (stageEl ??= document.querySelector<HTMLElement>('.stage'))?.dataset.amber === '1'

export function Header({ loaded }: { loaded: number | (() => number) }) {
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const block = useLive((s) => s.block)
  const stats = useLive((s) => s.stats)
  const activity = useLive((s) => s.activity)
  const pay = activity?.find((a) => a.name === 'CallSettled' || a.name === 'Settled')
  // age of the last payment, read from its block time (Arc RPC), recomputed every minute
  const [payAt, setPayAt] = useState<number | null>(null)
  const [, setMin] = useState(0)
  useEffect(() => { let ok = true; setPayAt(null); if (pay?.block) blockTime(pay.block).then((v) => { if (ok) setPayAt(v) }); return () => { ok = false } }, [pay?.block])
  useEffect(() => { const id = setInterval(() => setMin((m) => m + 1), 60000); return () => clearInterval(id) }, [])
  const bar = useRef<HTMLDivElement>(null)
  const pct = useRef<HTMLSpanElement>(null)
  const sec = useRef<HTMLSpanElement>(null)
  const loadedR = useRef(loaded)
  loadedR.current = loaded
  useEffect(() => onTick(() => {
    // first the loading bar (scene steps), then the progress through the page
    // leaving for another page, the bar is the loading bar again (ui/pageload.ts); arriving, it starts where the
    // page before left it
    const own = typeof loadedR.current === 'function' ? loadedR.current() : loadedR.current
    const L = isLeaving() ? loadP() : own < 1 ? Math.max(own, arrivedAt()) : own
    const p = L < 1 ? L : progress()
    if (bar.current) { bar.current.style.transform = `scaleX(${p.toFixed(4)})`; bar.current.dataset.load = L < 1 ? '1' : '0' }
    // the percentage only speaks during loading; afterwards the bar and the section number are enough
    if (pct.current) { const v = L < 1 ? `${Math.round(p * 100)}${getLang() === 'fr' ? '\u00a0' : ''}%` : ''; if (pct.current.textContent !== v) pct.current.textContent = v }
    // the position is told by the section name (the words carry the order, not a 01 / 08 counter)
    if (sec.current) { const s = t(`sec.${ORDER[Math.min(ORDER.length - 1, Math.floor(world.story))]}` as TKey); if (sec.current.textContent !== s) sec.current.textContent = s }
  }), [])
  useEffect(() => { installPageExit() }, [])
  const nav = <MainNav page="home" />
  return (
    <header className="hd" data-ui data-front-free>
      <div className="hd-row1">
        <a className="logo" href={link.home} aria-label="ArcHive"><Logo /></a>
        <nav className="hd-nav" aria-label={t('nav.main')}>{nav}</nav>
        <div className="hd-side">
          <button className="lang" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} lang={lang === 'fr' ? 'en' : 'fr'} aria-label={t('lang.to')}>{lang === 'fr' ? 'EN' : 'FR'}</button>
          {/* the visitor's wallet, as on the app pages */}
          <HeaderWallet />
          <button className="menu-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('nav.close') : t('nav.menu')}</button>
        </div>
      </div>
      <div className="hd-row2 lbl" aria-live="off">
        <span className="band-i"><b>{t('band.net')}</b></span>
        <span className="band-i">{t('band.block')} <span className="mono tnum nowrap">{block ? num(block, lang) : t('band.reading')}</span></span>
        <span className="band-i">{t('band.active')} <span className="mono tnum nowrap">{stats ? `${stats.enclavesActive} / ${stats.enclaves}` : t('band.reading')}</span></span>
        <span className="band-i band-pay">{t('band.paid')} <span className="mono tnum nowrap">{pay ? `${usdc(pay.args.amount ?? pay.args.paidDelta, lang)}, ${t('word.block')} ${num(pay.block, lang)}${payAt ? `, ${ago(payAt, lang)}` : ''}` : activity ? t('end.none') : t('band.reading')}</span></span>
        <span className="band-sec"><span ref={sec} className="sec-n">{t('sec.hero')}</span><span className="prog-pct mono tnum" ref={pct} aria-hidden="true">{lang === 'fr' ? '0\u00a0%' : '0%'}</span></span>
      </div>
      <div className="prog" aria-hidden="true"><div className="prog-bar" ref={bar} /></div>
      {open ? <nav className="hd-drawer" aria-label={t('nav.main')}>{nav}</nav> : null}
      <SelLayer />
    </header>
  )
}

// ---------------- pointer, hover, locking ----------------
const UI_SEL = '[data-ui], a, button, input, .txt, .fiche, .hd, .foot, .end-in, .carrier, h1, h2, p, li, dl'
const overUi = (el: Element | null) => !!el?.closest?.(UI_SEL)
const ARM = 0.9          // seconds of rest before locking (0.8 to 1 s)
const RELEASE = 0.1      // seconds outside the slot, the card and the corridor between them before unlocking
                         // (the card folds about 340 ms after leaving)
// no slot reading in the protocol (oblique view, part labels)
const canPickNow = () => {
  const id = ORDER[Math.min(ORDER.length - 1, Math.floor(world.story))]
  // at the end, back to the hero framing, a slot can be picked again
  return world.sceneReady && id !== 'protocol' && !world.svc.open
}
/** The interactive element under a point (button, link, switch) that the square can hug */
const USABLE = 'a[href], button:not(:disabled), [role=switch]'
const usableAt = (el: Element | null) => {
  const u = el?.closest?.(USABLE) as HTMLElement | null
  // the logo keeps its glow and also gets the frame, fitted to the rectangle (Sel.tsx, selBox)
  if (!u || u.closest('.mirror')) return null
  return u
}

export function usePointer() {
  useEffect(() => {
    const P = world.pointer
    let away = 0, moveAt = 0, scrollAt = 0
    const mv = (e: PointerEvent) => {
      P.x = e.clientX; P.y = e.clientY; P.inside = true; P.moved = true; moveAt = performance.now(); P.touch = e.pointerType === 'touch'
      P.overUi = overUi(e.target as Element | null)
    }
    const lv = () => { P.inside = false }
    // touch: a tap on a slot locks it at once; elsewhere, it releases
    const down = (e: PointerEvent) => {
      mv(e)
      if (e.pointerType !== 'touch') return
      if ((e.target as Element)?.closest('.fiche')) return
      const i = !overUi(e.target as Element) && canPickNow() && world.pick ? world.pick(e.clientX, e.clientY) : -1
      setLock(i >= 0 && i !== world.lock ? i : -1)
    }
    // click on a slot: its service opens in place, the page does not scroll; elsewhere (outside the card), release
    const click = (e: MouseEvent) => {
      if ((e as PointerEvent).pointerType === 'touch') return
      const tg = e.target as Element
      if (tg.closest('.fiche, .svc-panel') || overUi(tg)) { if (!tg.closest('.fiche, .svc-panel') && world.lock >= 0 && !tg.closest('a,button')) setLock(-1); return }
      const i = canPickNow() && world.pick ? world.pick(e.clientX, e.clientY) : -1
      if (i >= 0) openService(i)
      else setLock(-1)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && world.lock >= 0 && !world.svc.open) { setLock(-1); world.arming = 0; (document.activeElement as HTMLElement)?.blur?.() } }
    addEventListener('pointermove', mv, { passive: true })
    addEventListener('pointerdown', down, { passive: true })
    addEventListener('click', click)
    addEventListener('keydown', key)
    document.documentElement.addEventListener('pointerleave', lv)
    let lastHover = -1, lastY = window.scrollY, lockY = 0
    const off = onTick((_t, dt) => {
      // scrolling never loads a lock (the slot passes under a still pointer); an open card closes as soon as the page
// has moved 40 px (a card does not stay on the next section)
      const y = window.scrollY, moved = Math.abs(y - lastY) > 0.5
      lastY = y
      if (moved) { world.arming = 0; scrollAt = performance.now() }
      if (world.lock < 0) lockY = y
      else if (Math.abs(y - lockY) > 40 && document.activeElement?.closest?.('.mirror') == null) { setLock(-1); world.arming = 0 }
      // what is under the pointer also changes when the page scrolls: re-read every frame
      if (P.inside && !P.touch) { const el = document.elementFromPoint(P.x, P.y); P.overUi = overUi(el); world.uiEl = usableAt(el) } else world.uiEl = null
      const can = P.inside && !P.touch && !P.overUi && canPickNow() && !!world.pick
      const i = can ? world.pick!(P.x, P.y) : -1
      world.hover = i
      // the lock loads during the rest, face on only (oblique: plain hover)
      if (i >= 0 && i === lastHover && world.frontal && world.lock !== i && !moved && moveAt > scrollAt) {
        world.arming = Math.min(1, world.arming + dt / (REDUCED ? 0.3 : ARM))
        if (world.arming >= 1) { setLock(i); world.arming = 0 }
      } else if (world.lock !== i) world.arming = Math.max(0, world.arming - dt * 4)
      lastHover = i
      // release: outside the slot and the card long enough, or the slot leaves the frame
      if (world.lock >= 0 && !P.touch && document.activeElement?.closest?.('.mirror') == null) {
        // the card, and the corridor between the slot and it (the leader line), count as the slot: one can pass slowly
        let onFiche = !!document.elementFromPoint(P.x, P.y)?.closest('.fiche')
        const lr = world.rects.get(world.lock), fe = document.querySelector('.fiche.on')
        if (!onFiche && lr && fe) {
          const fr = fe.getBoundingClientRect()
          // the hull of the slot and its card: the path to "Open service" goes through it, even diagonally
          onFiche = P.x >= Math.min(lr.x, fr.x) - 8 && P.x <= Math.max(lr.x + lr.w, fr.right) + 8 && P.y >= Math.min(lr.y, fr.y) - 8 && P.y <= Math.max(lr.y + lr.h, fr.bottom) + 8
        }
        if (i === world.lock || onFiche) away = 0
        else { away += dt; if (away > RELEASE) { setLock(-1); away = 0 } }
      }
      // the rectangle of a just-locked slot (touch, keyboard) is only computed on the next frame: release only on a
// slot that left the frame, or an oblique view
      const r = world.lock >= 0 ? world.rects.get(world.lock) : null
      if (world.lock >= 0 && ((r && !r.vis) || !world.frontal)) setLock(-1)
    })
    return () => { off(); removeEventListener('pointermove', mv); removeEventListener('pointerdown', down); removeEventListener('click', click); removeEventListener('keydown', key); document.documentElement.removeEventListener('pointerleave', lv) }
  }, [])
}

/** After a first lock, the reading no longer repeats the gesture */
let heldOnce = false
let tagW = 200
// The two axes only live in the wall area, right of the text column (they never cut the text) and under the
// header; the column edge is re-read on a change of section or width
let axKey = '', axL = 0, axT = 0
// the column edges of all sections are read at once, outside scrolling (idle time), then only on a change of
// width, language or data; while scrolling, a plain array access
const axR = new Map<string, number>()
let axDirty = true, axBusy = false
function readZones() {
  axBusy = false
  for (const id of ORDER) {
    let r = 0
    document.querySelectorAll<HTMLElement>(`[data-sec="${id}"] .txt, [data-sec="${id}"] .chain, [data-sec="${id}"] .figs, [data-sec="${id}"] .end-hd, [data-sec="${id}"] .ctas`).forEach((e) => { const b = e.getBoundingClientRect(); if (b.width > 0) r = Math.max(r, b.right) })
    axR.set(id, r > 0 ? Math.round(r + 24) : 0)
  }
  axT = Math.round(document.querySelector<HTMLElement>('.hd')?.getBoundingClientRect().bottom ?? 0)
  axDirty = false
}
function wallZone() {
  const key = `${innerWidth}|${innerHeight}|${getLang()}|${world.version}`
  if (key !== axKey && !axBusy) {
    axKey = key; axBusy = true
    const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o: object) => void }).requestIdleCallback
    if (ric) ric(readZones, { timeout: 800 }); else setTimeout(readZones, 200)
  }
  if (axDirty) return
  const id = ORDER[Math.min(ORDER.length - 1, Math.max(0, Math.floor(world.story)))]
  // never left of the fade edge (the text column and its fade carry no axes)
  axL = Math.max(axR.get(id) ?? 0, world.wallX)
}

/** The cursor: an outlined square, the two axes, the lock stretch, the optional magnifier */
export function Cursor() {
  const box = useRef<HTMLDivElement>(null)
  const ax = useRef<HTMLDivElement>(null)
  const ay = useRef<HTMLDivElement>(null)
  const tag = useRef<HTMLDivElement>(null)
  const poly = useRef<SVGPolygonElement>(null)
  const load = useRef<SVGLineElement>(null)
  const angTl = useRef<SVGPolylineElement>(null)
  const angBr = useRef<SVGPolylineElement>(null)
  const loupe = useLoupe()
  useLang()
  useEffect(() => {
    // The frame is a quadrilateral (oblique, the on-screen slot has vertical sides but its top and bottom
// recede): four corners (top left, top right, bottom right, bottom left) that go from the square to the slot; the
// cursor box is their bounding box, the outline is drawn in SVG to the pixel
    const c4 = [0, 0, 22, 0, 22, 22, 0, 22], t4 = [0, 0, 0, 0, 0, 0, 0, 0]
    let first = true
    const sq = (x: number, y: number, w: number, h: number) => { t4[0] = x; t4[1] = y; t4[2] = x + w; t4[3] = y; t4[4] = x + w; t4[5] = y + h; t4[6] = x; t4[7] = y + h }
    return onTick((_t, dt) => {
      const b = box.current, a = ax.current, c = ay.current, g = tag.current, pg = poly.current, ld = load.current
      if (!b || !a || !c || !g || !pg || !ld) return
      const P = world.pointer
      const show = P.inside && !P.touch && P.moved
      { const v = show ? '1' : '0'; if (document.documentElement.dataset.cur !== v) document.documentElement.dataset.cur = v }
      if (!show) { if (g.dataset.on !== '0') g.dataset.on = '0'; return }
      // target: the square under the tip (22 px, magnifier or not: the magnifier acts within the square); framing is
// reserved for slots: on a slot, it stretches with the lock loading, then hugs it
      const S = 22
      sq(P.x - S / 2, P.y - S / 2, S, S)
      const lk = world.lock >= 0 ? world.rects.get(world.lock) : null
      const hv = world.hover >= 0 ? world.rects.get(world.hover) : null
      let state = 'free'
      const toQ = (r: { x: number; y: number; w: number; h: number; q?: number[] }, k: number) => {
        const q = r.q ?? [r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h]
        for (let j = 0; j < 8; j++) t4[j] += (q[j] - t4[j]) * k
      }
      if (lk && lk.vis) { toQ(lk, 1); state = 'lock' }
      else if (hv && world.arming > 0) {
        // the stretch is the loading bar: it ends together with the rest (0.9 s), with no plateau
        toQ(hv, 0.5 - 0.5 * Math.cos(Math.PI * world.arming)); state = 'arm'
      } else if (world.hover >= 0) state = 'over'
      else if (world.uiEl) {
        // on a button or a link, the square stretches until it hugs the element (its edge becomes the outline)
        // the same margin on all four sides (8 px, ui/Sel.tsx), the frame never touches the letters
        const r = selBox(world.uiEl)
        if (r && r.w < 656 && r.h < 216) { sq(r.x, r.y, r.w, r.h); state = 'ui' }
      }
      const k = first || state === 'lock' || state === 'arm' ? 1 : 1 - Math.exp(-dt / (state === 'ui' || b.dataset.s === 'ui' ? 0.05 : 0.038))
      first = false
      for (let j = 0; j < 8; j++) c4[j] += (t4[j] - c4[j]) * k
      const x0 = Math.min(c4[0], c4[6]), x1 = Math.max(c4[2], c4[4]), y0 = Math.min(c4[1], c4[3]), y1 = Math.max(c4[5], c4[7])
      const cur = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
      b.style.transform = `translate3d(${cur.x.toFixed(1)}px, ${cur.y.toFixed(1)}px, 0)`
      b.style.width = `${cur.w.toFixed(1)}px`; b.style.height = `${cur.h.toFixed(1)}px`
      const pts = [0, 2, 4, 6].map((j) => `${(c4[j] - x0 + (j === 2 || j === 4 ? -0.5 : 0.5)).toFixed(1)},${(c4[j + 1] - y0 + (j >= 4 ? -0.5 : 0.5)).toFixed(1)}`).join(' ')
      if (pg.getAttribute('points') !== pts) pg.setAttribute('points', pts)
      // the two opposite corners (top left, bottom right) along the sides of the quadrilateral (oblique, they
// recede with the slot); 12 px arms, at most 30 % of the side
      const tl = angTl.current, br = angBr.current
      if (tl && br) {
        const X = (j: number) => c4[j] - x0 + (j === 2 || j === 4 ? -0.5 : 0.5), Y = (j: number) => c4[j + 1] - y0 + (j >= 4 ? -0.5 : 0.5)
        const arm = (a: number, b: number) => { const dx = X(b) - X(a), dy = Y(b) - Y(a), l = Math.hypot(dx, dy) || 1, k = Math.min(12, l * 0.3) / l; return `${(X(a) + dx * k).toFixed(1)},${(Y(a) + dy * k).toFixed(1)}` }
        const ptl = `${arm(0, 6)} ${X(0).toFixed(1)},${Y(0).toFixed(1)} ${arm(0, 2)}`
        const pbr = `${arm(4, 2)} ${X(4).toFixed(1)},${Y(4).toFixed(1)} ${arm(4, 6)}`
        if (tl.getAttribute('points') !== ptl) tl.setAttribute('points', ptl)
        if (br.getAttribute('points') !== pbr) br.setAttribute('points', pbr)
      }
      // the loading bar runs along the bottom of the slot (it recedes with it)
      const am = state === 'arm' ? world.arming : 0
      // the bar is only written when it changes (one SVG attribute write per frame repaints the cursor)
      const lk_ = `${(c4[6] - x0).toFixed(1)} ${(c4[7] - y0 - 1).toFixed(1)} ${(c4[6] - x0 + (c4[4] - c4[6]) * am).toFixed(1)} ${(c4[7] - y0 - 1 + (c4[5] - c4[7]) * am).toFixed(1)}`
      if (ld.dataset.k !== lk_) { ld.dataset.k = lk_; const v = lk_.split(' '); ld.setAttribute('x1', v[0]); ld.setAttribute('y1', v[1]); ld.setAttribute('x2', v[2]); ld.setAttribute('y2', v[3]) }
      b.dataset.s = state
      b.style.setProperty('--arm', world.arming.toFixed(3))
      wallZone()
      const inWall = P.x >= axL && P.y >= axT
      if (a.dataset.on !== (inWall ? '1' : '0')) { a.dataset.on = c.dataset.on = inWall ? '1' : '0' }
      if (a.dataset.l !== String(axL)) { a.dataset.l = String(axL); a.style.width = `${Math.max(0, innerWidth - axL)}px` }
      if (c.dataset.t !== String(axT)) { c.dataset.t = String(axT); c.style.height = `${Math.max(0, innerHeight - axT)}px` }
      a.style.transform = `translate3d(${axL}px, ${P.y}px, 0)`
      c.style.transform = `translate3d(${P.x}px, ${axT}px, 0)`
      // the reading: rack, unit and state, only on an unlocked slot
      if (world.lock >= 0) heldOnce = true
      const i = world.hover
      // Video landing: while the page moves, the sleds scroll under a still pointer; the readout waits until the page has
      // settled (it no longer passes over the large titles during a trip)
      const lm = getLenis(), pageMoving = step.moving || (!!lm && Math.abs(lm.velocity) > 0.3)
      if (i >= 0 && state !== 'lock' && !world.svc.open && !pageMoving) {
        const s = world.wall.sleds[i]
        const amber = i === world.wall.replay && amberNow()
        // the reading sits above the slot (it never covers its plate); face on, it tells the gesture
        const txt = `${slotLabel(i)}, ${s?.led === 'green' || s?.led === 'red' || s?.led === 'amber' || (amber && s?.enclave) ? productLabel(s!.product) + ', ' : ''}${stateText(s, amber).toLowerCase()}${world.frontal && !heldOnce ? `, ${t('read.hold')}` : ''}`
        // width re-read only when the text changes (no forced layout every frame)
        if (g.textContent !== txt) { g.textContent = txt; tagW = g.offsetWidth }
        // attached to its slot: set on its left edge, just above it (never far away, at the screen edge)
        const hr = world.rects.get(i)
        const gx = hr ? Math.max(8, Math.min(innerWidth - tagW - 8, hr.x)) : P.x + 18
        // above the slot; in the Arc check, below (above, it would cover the gap where the Arc sheet and its blue ray
// pass)
        const below = ORDER[Math.min(ORDER.length - 1, Math.floor(world.story))] === 'arc' && i === world.wall.replay
        const gy = hr ? (below && hr.y + hr.h + 34 < innerHeight ? hr.y + hr.h + 6 : Math.max(92, hr.y - 30)) : P.y + 20
        g.style.transform = `translate3d(${gx.toFixed(0)}px, ${gy.toFixed(0)}px, 0)`
        if (g.dataset.on !== '1') g.dataset.on = '1'
      } else if (g.dataset.on !== '0') g.dataset.on = '0'
    })
  }, [loupe])
  return (
    <>
      <div className="axis axis-x" ref={ax} aria-hidden="true" />
      <div className="axis axis-y" ref={ay} aria-hidden="true" />
      <div className={`cursor ${loupe ? 'loupe' : ''}`} ref={box} aria-hidden="true"><svg className="cur-q"><polygon ref={poly} points="0,0" /><polyline ref={angTl} className="cur-a" points="0,0" /><polyline ref={angBr} className="cur-a" points="0,0" /><line ref={load} className="cur-load" /></svg></div>
      <div className="reading lbl" ref={tag} aria-hidden="true" data-front-free />
    </>
  )
}

// ---------------- the card: stays open while the slot is locked ----------------
// On release, the card folds in 280 ms and the leader line retracts towards the slot in the same movement
// (same duration, same curve); the content stays that of the slot during the fold.
const CLOSE_MS = 240
export function Fiche() {
  const lang = useLang()
  useWallVersion()
  const lock = useLock()
  const [shown, setShown] = useState(-1)
  useEffect(() => {
    if (lock >= 0) { setShown(lock); return }
    const id = setTimeout(() => setShown(-1), CLOSE_MS + 40)
    return () => clearTimeout(id)
  }, [lock])
  const products = useLive((s) => s.products)
  const bounties = useLive((s) => s.bounties)
  const box = useRef<HTMLDivElement>(null)
  const lead = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // the leader line: geometry kept from the last locked slot, scale 0 to 1 on the card curve
    const L = { k: 0, from: 0, t0: 0, dir: 0, x: 0, y: 0, w: 0, h: 1, side: 1 as number }
    const ease = (x: number) => 1 - Math.pow(1 - x, 3)
    return onTick(() => {
      // keyboard: the focused mirror button sits exactly on the slot (visible focus, to the pixel)
      const fb = document.activeElement as HTMLElement | null
      if (fb?.parentElement?.classList.contains('mirror')) {
        const r0 = world.rects.get(Number(fb.dataset.i))
        if (r0) { fb.style.left = `${r0.x.toFixed(0)}px`; fb.style.top = `${r0.y.toFixed(0)}px`; fb.style.width = `${r0.w.toFixed(0)}px`; fb.style.height = `${r0.h.toFixed(0)}px` }
      }
      const b = box.current, l = lead.current
      if (!b || !l) return
      const now = performance.now()
      const want = world.lock >= 0 && innerWidth >= 760 ? 1 : 0
      if (want !== L.dir) { L.from = L.k; L.dir = want; L.t0 = now }
      const u = Math.min(1, (now - L.t0) / (want ? 600 : CLOSE_MS))
      L.k = L.from + (want - L.from) * ease(u)
      const r = world.lock >= 0 ? world.rects.get(world.lock) : null
      if (r && world.lock >= 0) {
        if (innerWidth < 760) { b.style.transform = ''; l.style.opacity = '0'; return }
        const w = b.offsetWidth, h = b.offsetHeight
        // right of the slot if there is room, otherwise left (outside the text column), otherwise below or above,
// aligned on its left edge: the card never covers the framed slot
        const minX = innerWidth * 0.4
        let x = r.x + r.w + 40, y = Math.max(96, Math.min(innerHeight - h - 24, r.y + r.h / 2 - 28))
        let side = 1
        if (x + w > innerWidth - 24) { x = r.x - 40 - w; side = -1 }
        if (side < 0 && x < minX) {
          side = 0
          x = Math.max(minX, Math.min(innerWidth - 24 - w, r.x))
          y = r.y + r.h + 24 + h < innerHeight - 16 ? r.y + r.h + 24 : r.y - 24 - h
        }
        b.style.transform = `translate3d(${x.toFixed(0)}px, ${y.toFixed(0)}px, 0)`
        L.side = side
        if (b.dataset.side !== String(side)) b.dataset.side = String(side)
        if (side) {
          const lx0 = side > 0 ? r.x + r.w : x + w, lx1 = side > 0 ? x : r.x
          L.x = Math.min(lx0, lx1); L.y = r.y + r.h / 2; L.w = Math.abs(lx1 - lx0); L.h = 1
        } else {
          const ya = y > r.y ? r.y + r.h : y + h, yb = y > r.y ? y : r.y
          L.x = x + 24; L.y = ya; L.w = 1; L.h = Math.max(0, yb - ya)
        }
      }
      if (L.k < 0.002) { if (l.style.opacity !== '0') l.style.opacity = '0'; return }
      // the retraction starts from the card and ends in the slot (origin on the slot side)
      l.style.opacity = '1'
      l.style.width = `${L.w.toFixed(0)}px`; l.style.height = `${L.h.toFixed(0)}px`
      const origin = L.side > 0 ? '0 50%' : L.side < 0 ? '100% 50%' : '50% 0'
      if (l.style.transformOrigin !== origin) l.style.transformOrigin = origin
      l.style.transform = `translate3d(${L.x.toFixed(0)}px, ${L.y.toFixed(0)}px, 0) ${L.side ? 'scaleX' : 'scaleY'}(${L.k.toFixed(3)})`
    })
  }, [])
  const cur = lock >= 0 ? lock : shown
  const sl: Sled | undefined = cur >= 0 ? world.wall.sleds[cur] : undefined
  const amber = cur >= 0 && cur === world.wall.replay && amberNow()
  const e = sl?.enclave, pr = sl?.product
  // a registered enclave without a read product shows "Registered enclave", never an empty title
  const name = !sl || !e ? t('plate.off') : productLabel(pr, products, bounties) || t('svc.enclave')
  const price = priceText(pr, bounties)
  const rows: [string, React.ReactNode][] = sl && e ? [
    [t('card.operator'), short(e.operator, 4)],
    [t('card.signer'), short(e.signer, 4)],
    [t('card.anchored'), t('card.block', { n: num(Number(e.anchorBlock), lang) ?? '' })],
    ...(sl.led === 'amber' && sl.why === 'expired' ? [[t('card.until'), num(Number(e.untilBlock), lang)] as [string, React.ReactNode]] : []),
    ...(price ? [[t('card.price'), price] as [string, string]] : []),
    ...(sl.client ? [[t('card.client'), short(sl.client, 4)] as [string, string]] : []),
    ...(sl.reason ? [[t('card.reason'), reasonText(sl.reason)] as [string, string]] : []),
  ] : []
  const led = amber ? 'amber' : sl?.led ?? 'off'
  const open = (ev: React.MouseEvent) => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0 || cur < 0) return; ev.preventDefault(); openService(cur) }
  return (
    <>
      <div className="fiche-lead" ref={lead} aria-hidden="true" />
      <div className={`fiche ${lock >= 0 ? 'on' : ''}`} ref={box} data-front-free role="dialog" aria-label={cur >= 0 ? `${slotLabel(cur)}, ${name}` : undefined} hidden={cur < 0} inert={lock < 0 ? true : undefined} data-ui>
        <div className="fi-head lbl"><span className="mono">{cur >= 0 ? slotLabel(cur) : ''}</span><span className={`fi-st st-${led}`}><i />{stateText(sl, amber)}</span></div>
        <p className="fi-t">{name}</p>
        {!e ? <p className="fi-s">{t('card.empty')}</p> : null}
        {amber && world.wall.replayBlock ? <p className="fi-s">{t('publish.replay', { s: name, b: num(world.wall.replayBlock, lang) ?? '' })}</p> : null}
        <dl className="fi-dl">{rows.map(([k, v]) => <div key={k}><dt className="lbl">{k}</dt><dd className="mono">{v}</dd></div>)}</dl>
        <div className="fi-foot">
          {/* renting out a machine only on a free slot; an occupied slot without a read product has no button */}
          {e && pr
            ? <a className="btn btn-main btn-s" href={cur >= 0 ? slotHref(cur) : '#'} onClick={open} data-slot="OPEN SERVICE"><span>{t('card.open')}</span></a>
            : !e ? <a className="btn btn-line btn-s" href={link.rent}><span>{t('card.rent')}</span></a> : null}
          <span className="lbl muted fi-esc no-touch">{t('card.esc')}</span>
        </div>
      </div>
    </>
  )
}

/** Keyboard mirror of the wall: one button per slot, a single tab stop, the arrow keys; focus locks */
export function WallMirror() {
  useLang()
  useWallVersion()
  const ref = useRef<HTMLDivElement>(null)
  const [cur, setCur] = useState(() => world.wall.ex.use >= 0 ? world.wall.ex.use : SLOTS.findIndex((s) => s.col === 1 && s.y > 1))
  const near = (i: number, dx: number, dy: number) => {
    const s = SLOTS[i]
    if (dy) {
      const col = SLOTS.filter((x) => x.col === s.col).sort((a, b) => a.y - b.y)
      const k = col.findIndex((x) => x.i === i) + dy
      return col[k]?.i ?? i
    }
    const c2 = s.col + dx
    if (c2 < 0 || c2 >= G.NCOLS) return i
    const col = SLOTS.filter((x) => x.col === c2)
    return col.reduce((a, b) => (Math.abs(b.y - s.y) < Math.abs(a.y - s.y) ? b : a), col[0]).i
  }
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const m: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
    if (m[e.key]) {
      e.preventDefault(); const n = near(i, ...m[e.key]); setCur(n)
      ref.current?.querySelector<HTMLButtonElement>(`[data-i="${n}"]`)?.focus()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); openService(i)
    }
  }
  const label = (i: number) => {
    const s = world.wall.sleds[i]
    if (!s?.enclave) return `${slotLabel(i)}, ${t('read.open')}`
    // the product segment is skipped when empty (no doubled comma)
    const pl = productLabel(s.product)
    return `${slotLabel(i)}, ${pl ? `${pl}, ` : ''}${stateText(s)}, ${t('card.operator').toLowerCase()} ${short(s.enclave.operator, 4)}`
  }
  void colX
  return (
    <div className="mirror" ref={ref} role="group" aria-label={t('read.walls')} aria-describedby="wall-keys" id="wall">
      {Array.from({ length: NSLOTS }, (_, i) => (
        <button key={i} data-i={i} tabIndex={i === cur ? 0 : -1} aria-label={label(i)}
          onFocus={() => { setCur(i); setLock(i) }}
          onBlur={(e) => { const st2 = (e.target as HTMLElement).style; st2.left = st2.top = st2.width = st2.height = ''; setTimeout(() => { if (!document.activeElement?.closest('.mirror, .fiche')) setLock(-1) }, 0) }}
          onKeyDown={(e) => onKey(e, i)} />
      ))}
    </div>
  )
}

// ---------------- the three buttons that move down ----------------
export const CTAS = [
  { k: 'use', href: networkFor('use'), label: 'cta.use', kind: 'btn-main' },
  { k: 'rent', href: networkFor('rent'), label: 'cta.rent', kind: 'btn-line' },
  { k: 'publish', href: networkFor('publish'), label: 'cta.publish', kind: 'btn-line' },
] as const
export const carryOn = () => innerWidth >= 1100 && !REDUCED

/** The button in its place (hero, section): rendered for real when the path is cut (mobile, reduced motion) */
export function Slot({ k, home }: { k: (typeof CTAS)[number]['k']; home?: boolean }) {
  useLang()
  const c = CTAS.find((x) => x.k === k)!
  const [carry, setCarry] = useState(carryOn)
  useEffect(() => { const r = () => setCarry(carryOn()); addEventListener('resize', r); return () => removeEventListener('resize', r) }, [])
  if (carry) return <span className={`btn-slot ${c.kind}`} data-home={home ? k : undefined} data-dock={home ? undefined : k} aria-hidden="true"><span>{t(c.label)}</span></span>
  return <a className={`btn ${c.kind}`} href={c.href} data-slot={k.toUpperCase()}><span>{t(c.label)}</span></a>
}

export function Carrier() {
  useLang()
  const refs = useRef<(HTMLAnchorElement | null)[]>([])
  const [carry, setCarry] = useState(carryOn)
  useEffect(() => { const r = () => setCarry(carryOn()); addEventListener('resize', r); return () => removeEventListener('resize', r) }, [])
  useEffect(() => {
    if (!carry) return
    const vs = CTAS.map(() => ({ key: '', v: 1, x: 0, gx: 0, y: 0, cl: null as null | { x: number; y: number; sy: number; c: number; fixed: boolean } }))
    let init = true
    let homeY0: number | null = null
    return onTick((_t, dt) => {
      const H = innerHeight
      const homes = CTAS.map((c) => document.querySelector<HTMLElement>(`[data-home="${c.k}"]`)?.getBoundingClientRect())
      const docks = CTAS.map((c) => document.querySelector<HTMLElement>(`[data-dock="${c.k}"]`)?.getBoundingClientRect())
      if (!homes[0] || !docks[0]) return
      // all layout reads before the first write (no forced layout in the middle of the frame)
      const clips = [...document.querySelectorAll<HTMLElement>('[data-clip]')].map((tEl) => ({ tEl, r: tEl.getBoundingClientRect() }))
      const sy = window.scrollY
      if (homeY0 === null || sy < 2) homeY0 = homes[0].top + (sy < 2 ? 0 : sy)
      // the transport line slides from the button place in the hero to the bottom of the screen (first half screen)
      const k = Math.min(1, Math.max(0, sy / (H * 0.55)))
      const carryY = homeY0 + (H - 112 - homeY0) * (k * k * (3 - 2 * k))
      // Buttons not yet docked keep moving down with the scroll, on the transport line (bottom of the screen), aligned
// on the column; each docks on its section (Use on Use, Rent on Rent, Publish on Publish) when its place there
// crosses the line, with no offset (its place is on the column, like it). A docked button still holding the
// transport line keeps the next ones to its right; once it has left, they return to the column with a shutter
// (closing in place, opening at the new place), never sliding. Scrolling back up replays everything in reverse.
      const x0 = homes[0].left
      // The carried buttons ride on the row of the last docked button while that button is on screen: at every stop
      // they sit aligned with the button of the section, to its right. Once it has scrolled away (above the header
      // zone), they go back to the transport line at the bottom of the screen (with a shutter).
      const MINY = 150
      let rowY = carryY
      for (let j = CTAS.length - 1; j >= 0; j--) {
        const d = docks[j]
        if (d && d.top <= carryY) { if (d.top >= MINY) rowY = d.top; break }
      }
      let rowX = x0, carried = 0, carriedY = Infinity
      const docked: { j: number; top: number }[] = []
      CTAS.forEach((c, j) => {
        const el = refs.current[j]; const h = homes[j]!, d = docks[j]
        if (!el || !d) return
        // a single width per button along the whole path: that of its place in the hero (the section place and the
// carried button rendered 3 px wider, causing small jumps of the following ones)
        const bw = h.width || el.offsetWidth
        const ws = `${bw.toFixed(2)}px`; if (el.style.width !== ws) el.style.width = ws
        const isDock = d.top <= carryY
        const atHome = !isDock && h.top >= carryY - 0.5
        let tx: number, y: number
        if (atHome) { tx = h.left; y = h.top }
        else if (isDock) {
          tx = d.left; y = d.top; docked.push({ j, top: d.top })
          // docked, it still holds the transport line (or will take it back when scrolling up: 140 px margin, so that
// the next one has finished its shutter before it arrives): buttons in transit stay to its right
          if (d.top > carryY - 140 || Math.abs(d.top - rowY) < 1) rowX = Math.max(rowX, d.left + bw + 8)
        } else { tx = rowX; y = rowY; rowX += bw + 8; carried++; carriedY = Math.min(carriedY, y) }
        const st = vs[j], key = atHome ? 'h' : isDock ? 'd' : 'c'
        // a change of place from afar (a button in transit back to the column, or a state jump): shutter, never a slide
        const jump = (key !== st.key && Math.hypot(st.x - tx, st.y - y) > 40) || (key === 'c' && st.key === 'c' && Math.abs(st.x - tx) > 40)
        if (!init && jump) {
          const seen = st.y > -80 && st.y < H + 10 && st.v > 0.02
          st.cl = seen && !REDUCED ? { x: st.x, y: st.y, sy, c: st.v, fixed: st.key !== 'd' } : null
          st.v = REDUCED ? 1 : 0
        }
        st.gx = tx
        st.key = key; st.x = tx; st.y = y
        let rx = st.gx, ry = y, open = 1
        if (st.cl) { st.cl.c -= dt / 0.2; if (st.cl.c <= 0) st.cl = null; else { rx = st.cl.x; ry = st.cl.fixed ? st.cl.y : st.cl.y - (sy - st.cl.sy); open = st.cl.c } }
        if (!st.cl) { st.v = Math.min(1, st.v + dt / 0.42); open = st.v }
        el.style.transform = `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0)`
        // top-to-bottom shutter (curve slowing at the end): the button is revealed in place, without sliding
        const e = 1 - Math.pow(1 - Math.max(0, Math.min(1, open)), 3)
        const cp = e >= 0.999 ? '' : `inset(0 0 ${((1 - e) * 100).toFixed(1)}% 0)`
        if (el.dataset.cp !== cp) { el.dataset.cp = cp; el.style.clipPath = cp }
        el.dataset.state = atHome ? 'home' : isDock ? 'dock' : 'carry'
        // colour by role: in the hero each button keeps its own style; docked on its section it is the main action
        // (white), carried along it stays secondary (grey)
        const cls = `btn ${atHome ? CTAS[j].kind : isDock ? 'btn-main' : 'btn-line'}`
        if (el.className !== cls) el.className = cls
        // no active state on the button of the current section (the frame only appears on hover, press or
// keyboard focus)
      })
      init = false
      // section text never passes under the carried buttons: it appears above their line
      const clipY = carried ? carriedY - 16 : Infinity
      clips.forEach(({ tEl, r }) => {
        // the block of a docked button still holding the transport line has nothing to mask below (otherwise its last
// lines would vanish at the moment of docking)
        const own = docked.some((q) => q.top > clipY - 80 && !!tEl.querySelector(`[data-dock="${CTAS[q.j].k}"]`))
        const cut = own ? 0 : Math.max(0, r.bottom - clipY)
        // short fade instead of a hard cut: a line is never sliced through its letters
        const m = cut > 0 ? `linear-gradient(to bottom, black calc(100% - ${(cut + 28).toFixed(0)}px), transparent calc(100% - ${cut.toFixed(0)}px))` : ''
        if (tEl.dataset.m !== m) { tEl.dataset.m = m; tEl.dataset.cut = cut > 0 ? cut.toFixed(0) : ''; tEl.style.maskImage = m; tEl.style.setProperty('-webkit-mask-image', m) }
      })
    })
  }, [carry])
  if (!carry) return null
  return (
    <div className="carrier" data-ui data-front-free>
      {CTAS.map((c, j) => (
        <a key={c.k} ref={(e) => { refs.current[j] = e }} className={`btn ${c.kind}`} href={c.href} data-slot={c.k.toUpperCase()}><span>{t(c.label)}</span></a>
      ))}
    </div>
  )
}

/** Fine static grain over the interface (the 3D image grain is in the grading) */
export { num }
