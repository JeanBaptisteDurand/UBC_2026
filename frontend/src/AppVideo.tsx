// Video landing shell: the same interface (sections, header, card, panel), but the room is no longer rendered in real
// time: it is a preloaded film driven by the scroll (video/film.ts), with a live HTML layer on top (video/lames.ts:
// sled names and LEDs read live). No 3D engine on this page.
// Section order lives in story.ts (ORDER): the list below follows it, one id per section.
import { useEffect, useRef, useState, startTransition } from 'react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { getLive, subscribeLive, useLive } from './data/live'
import { buildWall } from './data/wall'
import { setWall, world } from './world'
import { onTick } from './clock'
import { startStory, ORDER, type SecId } from './story'
import { Header, Cursor, Fiche, Carrier, usePointer } from './ui/Frame'
import { ServicePanel } from './ui/ServicePanel'
import { Hero } from './sections/Hero'
import { StateSection, Leads } from './sections/States'
import { Protocol, ArcGate, End, Footer } from './sections/Story'
import { t, useLang } from './i18n'

import { mountFilm, film } from './video/film'
import { mountLames } from './video/lames'
import type { Wall } from './data/wall'

/** The staging is filmed on specific sleds (replayed sled, section examples): the live sleds are permuted so that each
 *  role lands on the slot the film camera frames. Slots look identical in the image (plates empty, LEDs off during
 *  capture): only the data moves. */
function pinToFilm(w: Wall): Wall {
  const fm = film.man
  if (!fm) return w
  const sleds = w.sleds.slice()
  const perm = (k: number, a: number, b: number) => (k === a ? b : k === b ? a : k)
  let ex = { ...w.ex }, replay = w.replay
  const swap = (a: number, b: number) => {
    const A = sleds[a], B = sleds[b]
    sleds[a] = { ...B, i: a }; sleds[b] = { ...A, i: b }
    ex = { use: perm(ex.use, a, b), rent: perm(ex.rent, a, b), publish: perm(ex.publish, a, b), invalid: perm(ex.invalid, a, b), inactive: perm(ex.inactive, a, b) }
    replay = perm(replay, a, b)
  }
  if (fm.replay >= 0 && replay >= 0 && replay !== fm.replay) swap(replay, fm.replay)
  for (const k of ['rent', 'invalid', 'inactive', 'use'] as const) {
    const f = fm.ex[k], l = ex[k]
    if (f >= 0 && l >= 0 && f !== l && f !== fm.replay && l !== replay) swap(l, f)
  }
  return { ...w, sleds, ex: { ...ex, publish: replay }, replay }
}

/** The header loading bar: read by the header every frame, without a React render */
const filmLoad = () => { const m = film.man; return m ? Math.min(1, 0.1 + 0.9 * film.loaded / Math.min(m.n, 40)) : 0.05 }

const SECTIONS: Record<SecId, () => React.ReactElement> = {
  hero: () => <Hero />, use: () => <StateSection id="use" />, rent: () => <StateSection id="rent" />,
  publish: () => <StateSection id="publish" />, invalid: () => <StateSection id="invalid" />,
  protocol: () => <Protocol />, arc: () => <ArcGate />, end: () => <End />,
}

export default function App() {
  useLang()
  const canvas = useRef<HTMLCanvasElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const gl = true
  const status = useLive((s) => s.status)
  usePointer()
  // The page mounts section by section (one per idle period), hero first: the first render is no longer a single 60 to
  // 100 ms task (CPU x4) that lands on a wheel turned right at load. The story and the film re-read the sections on
  // every change of page height (ResizeObserver).
  const [nSec, setNSec] = useState(1)
  useEffect(() => {
    if (nSec > ORDER.length) return
    const go = () => startTransition(() => setNSec((n) => n + 1))
    if ('requestIdleCallback' in window) { const h = requestIdleCallback(go, { timeout: 120 }); return () => cancelIdleCallback(h) }
    const h = setTimeout(go, 16); return () => clearTimeout(h)
  }, [nSec])
  const all = nSec > ORDER.length

  // The wall follows the data read on Arc (a single function: buildWall and ledOf)
  useEffect(() => {
    let lastSig = ''
    const up = () => {
      const s = getLive()
      if (!s.enclaves) return
      const w = pinToFilm(buildWall(s.enclaves, s.products, s.bounties, s.activity, s.proof?.enclave?.signer, s.proof?.registerTx, s.chain))
      // The wall (plate atlas, layer textures) only changes when a state really changed: polling every 4 s sends
      // nothing to the GPU while nothing moves
      const sig = JSON.stringify([w.sleds.filter((x) => x.enclave).map((x) => [x.i, x.led, x.why, x.enclave?.productId, x.client]), w.ex, w.replay, w.replayTx, s.products?.length])
      if (sig === lastSig) return
      lastSig = sig
      setWall(w)
    }
    up()
    const iv = setInterval(() => { if (film.man) { clearInterval(iv); lastSig = ''; up() } }, 50)
    // An API read (every 4 s) rebuilds the wall in idle time, never within the current frame
    let pend = false
    const later = () => { if (pend) return; pend = true; const go = () => { pend = false; up() }; if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 400 }); else setTimeout(go, 30) }
    const off = subscribeLive(later)
    return () => { off(); clearInterval(iv) }
  }, [])
  // A real payment read on Arc: a 180 ms pulse on the LED of the green sled of its product
  useEffect(() => subscribeLive(() => {
    const s = getLive()
    for (const a of s.fresh) {
      let pid = a.name === 'CallSettled' ? a.args.productId : undefined
      if (a.name === 'Settled') pid = s.activity?.find((x) => x.name === 'SessionOpened' && x.args.sessionId === a.args.sessionId)?.args.productId
      const sl = pid ? world.wall.sleds.find((x) => x.led === 'green' && x.enclave?.productId === pid) : undefined
      if (sl && !world.pulses.some((p) => p.slot === sl.i)) world.pulses.push({ slot: sl.i, at: performance.now() / 1000 })
    }
  }), [])

  // The tablet veil is removed on pinned pages (the lifted sled passes under the text column); the flag sits on .stage,
  // not on <html>, so the whole page style is not recalculated
  useEffect(() => onTick(() => {
    const id = ORDER[Math.min(ORDER.length - 1, Math.max(0, Math.round(world.story)))]
    const v = id === 'protocol' || id === 'arc' ? '1' : '0'
    const st = canvas.current?.parentElement
    if (st && st.dataset.pin !== v) st.dataset.pin = v
  }), [])

  // The film mounts right away: the first frame (already behind the page, index.html), then the preload that follows the
  // scroll; __frontReady is set once the first frame is drawn and the first API read is in
  useEffect(() => {
    let shown = false, data = getLive().status !== 'loading', drawn = false, done = false
    const go = () => {
      // The ScrollTrigger refresh runs in idle time (never within the first-draw frame)
      if (!shown && drawn) {
        shown = true; document.documentElement.classList.add('scene-ready')
        if ('requestIdleCallback' in window) requestIdleCallback(() => ScrollTrigger.refresh(), { timeout: 300 }); else setTimeout(() => ScrollTrigger.refresh(), 60)
      }
      if (!done && shown && (data || performance.now() > 4000)) { done = true; requestAnimationFrame(() => { (window as unknown as { __frontReady: boolean }).__frontReady = true }) }
    }
    startStory()
    const off = subscribeLive(() => { if (getLive().status !== 'loading') { data = true; go() } })
    if (canvas.current && layer.current) {
      if (new URLSearchParams(location.search).get('couche') !== '0') mountLames(layer.current)
      mountFilm(canvas.current, () => { drawn = true; go() }).catch((e) => { console.error(e); drawn = true; go() })
    }
    const to = setTimeout(() => { data = true; drawn = true; go() }, 8000)
    return () => { off(); clearTimeout(to) }
  }, [])

  return (
    <>
      <a className="skip" href="#wall" data-front-free>{t('nav.skip')}</a>
      <div className={`stage ${gl ? '' : 'nogl'}`} aria-hidden="true">
        {/* No poster under the film canvas: the first frame comes from #poster in index.html */}
        <canvas ref={canvas} className="film" />
        <div ref={layer} className="film-layer" />
        {/* No loading bar in the middle of the page: the header one is enough (Header, loaded) */}
        {/* Tablet: a veil under the text column, so lit drawers do not show through the headline */}
        <div className="veil" />
      </div>
      <Header loaded={filmLoad} />
      <main className={`page ${status}`}>
        {ORDER.slice(0, nSec).map((id) => <div key={id} className="sec-w">{SECTIONS[id]()}</div>)}
        {all ? <Footer /> : null}
      </main>
      <Carrier />
      {gl && all ? <Leads /> : null}
      <Fiche />
      {all ? <ServicePanel /> : null}
      {gl ? <Cursor /> : null}
    </>
  )
}
