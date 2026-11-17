// Landing shell: the real-time scene behind, the interface in front.
// Section order lives in story.ts (ORDER): the list below follows it, one id per section.
import { useEffect, useRef, useState } from 'react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { getLive, subscribeLive, useLive } from './data/live'
import { buildWall } from './data/wall'
import { setWall, world } from './world'
import { NOGL, onTick } from './clock'
import { startStory, ORDER, type SecId } from './story'
import { Header, Cursor, Fiche, Carrier, usePointer } from './ui/Frame'
import { NoGl } from './ui/NoGl'
import { ServicePanel } from './ui/ServicePanel'
import { Hero } from './sections/Hero'
import { StateSection, Leads } from './sections/States'
import { Protocol, ArcGate, End, Footer } from './sections/Story'
import { t, useLang } from './i18n'

function hasGL() {
  if (NOGL) return false
  try { const c = document.createElement('canvas'); return !!c.getContext('webgl2') } catch { return false }
}

const SECTIONS: Record<SecId, () => React.ReactElement> = {
  hero: () => <Hero />, use: () => <StateSection id="use" />, rent: () => <StateSection id="rent" />,
  publish: () => <StateSection id="publish" />, invalid: () => <StateSection id="invalid" />,
  protocol: () => <Protocol />, arc: () => <ArcGate />, end: () => <End />,
}

export default function App() {
  useLang()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [gl] = useState(hasGL)
  const [loaded, setLoaded] = useState(gl ? 0.05 : 1)
  const status = useLive((s) => s.status)
  usePointer()

  // The wall follows the data read on Arc (a single function: buildWall and ledOf)
  useEffect(() => {
    let lastSig = ''
    const up = () => {
      const s = getLive()
      if (!s.enclaves) return
      // The state read on Arc (s.chain: banned operators, replaced or stopped enclaves) decides the red LEDs
      const w = buildWall(s.enclaves, s.products, s.bounties, s.activity, s.proof?.enclave?.signer, s.proof?.registerTx, s.chain)
      // The wall (plate atlas, layer textures) only changes when a state really changed: polling every 4 s sends
      // nothing to the GPU while nothing moves
      const sig = JSON.stringify([w.sleds.filter((x) => x.enclave).map((x) => [x.i, x.led, x.why, x.enclave?.productId, x.client]), w.ex, w.replay, w.replayTx, s.products?.length])
      if (sig === lastSig) return
      lastSig = sig
      setWall(w)
    }
    up()
    return subscribeLive(up)
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

  // The tablet veil is removed on pinned pages (the lifted sled passes under the text column)
  useEffect(() => onTick(() => {
    const id = ORDER[Math.min(ORDER.length - 1, Math.max(0, Math.round(world.story)))]
    const v = id === 'protocol' || id === 'arc' ? '1' : '0'
    if (document.documentElement.dataset.pin !== v) document.documentElement.dataset.pin = v
  }), [])

  // The scene mounts right away (its files are already on their way from main.tsx), without waiting for the API.
  // The wall shows once it is ready and the first API read is in (its plates carry the real services), or 2.5 s after
  // it is ready if the API is late; __frontReady is set once everything is ready and the intro has finished.
  useEffect(() => {
    let wall = !gl, all = !gl, data = false, shown = false, done = false, wallAt = 0
    let st: { dispose: () => void; reveal: () => void } | undefined
    const go = () => {
      if (!shown && wall && (data || (wallAt && performance.now() - wallAt > 2500))) {
        shown = true
        st?.reveal()
        ScrollTrigger.refresh()
        document.documentElement.classList.add('scene-ready')
      }
      if (!done && shown && all) { done = true; requestAnimationFrame(() => { (window as unknown as { __frontReady: boolean }).__frontReady = true }) }
    }
    startStory()
    const off = subscribeLive(() => { if (getLive().status !== 'loading') { data = true; go() } })
    if (getLive().status !== 'loading') data = true
    let alive = true
    if (gl) {
      import('./scene/stage').then(({ mountStage }) => {
        if (!alive || !canvas.current) return
        st = mountStage(canvas.current, (k) => setLoaded(k), () => { wall = true; wallAt = performance.now(); go(); setTimeout(go, 2600) }, () => { all = true; go() })
      }).catch(() => { wall = all = true; setLoaded(1); go() })
    }
    go()
    // Safety net: with no answer from the scene within 60 s (very slow or offline network), the page is released anyway;
    // until then the loading bar follows the bytes received (a wall that is not ready is never shown)
    const to = setTimeout(() => { data = true; wall = all = true; setLoaded(1); go() }, 60000)
    return () => { alive = false; off(); clearTimeout(to); st?.dispose() }
  }, [gl])

  return (
    <>
      <a className="skip" href="#wall" data-front-free>{t('nav.skip')}</a>
      <div className={`stage ${gl ? '' : 'nogl'}`} aria-hidden="true">
        {/* With WebGL, a clean load, then the wall opens in one move; the poster is only the no-WebGL fallback */}
        {gl ? <canvas ref={canvas} /> : <div className="poster" />}
        {/* Tablet: a veil under the text column, so lit drawers do not show through the headline */}
        <div className="veil" />
      </div>
      <Header loaded={loaded} />
      <main className={`page ${status}`}>
        {!gl ? <NoGl /> : null}
        {ORDER.map((id) => <div key={id} className="sec-w">{SECTIONS[id]()}</div>)}
        <Footer />
      </main>
      <Carrier />
      {gl ? <Leads /> : null}
      <Fiche />
      <ServicePanel />
      {gl ? <Cursor /> : null}
    </>
  )
}
