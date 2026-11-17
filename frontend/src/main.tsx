import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { startClock } from './clock'
import { startLive } from './data/live'
import { world } from './world'
import { startAssets } from './assets'
import { TOURNAGE, setFilmT, setFilmY, getLenis } from './clock'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SLOTS } from './data/wall'

;(window as unknown as { __frontReady: boolean }).__frontReady = false
;(window as unknown as { __world: unknown }).__world = world
document.documentElement.classList.add('js')
// The scene starts loading on the first line: its files (wall batch first) and its code (three.js), without waiting
// for fonts, React or the first API read
startAssets()
if (new URLSearchParams(location.search).get('gl') !== '0') import('./scene/stage').catch(() => null)
startLive()
startClock()
// Slot plates and layer labels are drawn with the rendered font: wait for both faces (1.5 s at most)
Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => {
  createRoot(document.getElementById('root')!).render(<App />)
})

// Video landing: film capture. The HTML stays in place (same page measurements, same camera) but invisible; the
// capture script sets the page to a position and the scene time, then reads the frame and its metadata
if (TOURNAGE) {
  document.documentElement.classList.add('tournage')
  const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
  ;(window as unknown as { __filmGo: unknown }).__filmGo = async (y: number, tMs: number) => {
    setFilmT(tMs)
    // the page scrolls by whole pixels; the scene reads the exact (fractional) position
    setFilmY(y)
    world.gate.phase = 'ok'
    const l = getLenis()
    if (l) l.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y)
    ScrollTrigger.update()
    await raf(); world.gate.phase = 'ok'; await raf(); await raf()
    return (window as unknown as { __filmMeta: unknown }).__filmMeta
  }
  // For the sampling plan: facade centres and stops of the filmed page
  ;(window as unknown as { __filmSlots: unknown }).__filmSlots = () => SLOTS.map((s) => [s.x, s.y])
  ;(window as unknown as { __filmStops: unknown }).__filmStops = () => ((window as unknown as { __stops?: () => { y: number; k: string }[] }).__stops?.() ?? []).map((x) => ({ y: x.y, k: x.k }))
  ;(window as unknown as { __filmPage: unknown }).__filmPage = () => {
    const secs = [...document.querySelectorAll<HTMLElement>('[data-sec]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.sec, top: r.top + (getLenis()?.animatedScroll ?? scrollY), h: r.height } })
    return { W: innerWidth, H: innerHeight, total: document.documentElement.scrollHeight, max: getLenis()?.limit ?? document.documentElement.scrollHeight - innerHeight, secs }
  }
}
