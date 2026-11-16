// Landing shell: the real-time scene behind a static hero.
import { useEffect, useRef, useState } from 'react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { getLive, subscribeLive } from './data/live'
import { buildWall } from './data/wall'
import { setWall, world } from './world'
import { NOGL } from './clock'
import { startStory } from './story'

function hasGL() {
  if (NOGL) return false
  try { const c = document.createElement('canvas'); return !!c.getContext('webgl2') } catch { return false }
}

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [gl] = useState(hasGL)

  // The wall follows the data read on Arc (a single function: buildWall and ledOf)
  useEffect(() => {
    let lastSig = ''
    const up = () => {
      const s = getLive()
      if (!s.enclaves) return
      const w = buildWall(s.enclaves, s.products, s.bounties, s.activity, s.proof?.enclave?.signer, s.proof?.registerTx)
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
        st = mountStage(canvas.current, () => {}, () => { wall = true; wallAt = performance.now(); go(); setTimeout(go, 2600) }, () => { all = true; go() })
      }).catch(() => { wall = all = true; go() })
    }
    go()
    // Safety net: with no answer from the scene within 60 s (very slow or offline network), the page is released anyway
    const to = setTimeout(() => { data = true; wall = all = true; go() }, 60000)
    return () => { alive = false; off(); clearTimeout(to); st?.dispose() }
  }, [gl])

  return (
    <>
      <div className={`stage ${gl ? '' : 'nogl'}`} aria-hidden="true">
        {gl ? <canvas ref={canvas} /> : <div className="poster" />}
      </div>
      <main className="page">
        <section className="sec hero" data-sec="hero">
          <div className="txt">
            <h1 className="h1">Sealed machines,<br />open market.</h1>
          </div>
        </section>
      </main>
    </>
  )
}
