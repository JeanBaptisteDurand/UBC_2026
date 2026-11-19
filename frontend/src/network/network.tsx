// Entry of the Network page: Use, Rent and Publish together. The same clock as the app pages (GSAP ticker,
// no smooth scroll), the live read for the header, then the page; the 3D scene (scene.ts) is mounted after the
// first React render. The page shows as soon as it has rendered (__frontReady lifts the veil, ui/veil.ts): the column
// lays out the asked part from its first frame and answers taps before the 3D (NetworkPage.tsx), and the room fades
// in when its programs are compiled and its textures uploaded (#stage[data-ready]).
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import '../styles.css'
import '../app/app.css'
import './scene.css'
import './network.css'
import { startClock } from '../clock'
import { startLive } from '../data/live'
import { NetworkPage } from './NetworkPage'
// the demo player's and the part demo's styles (the player fixed under the header, the footer out of the way, the Play
// button) come with the page, not with the 3D code: a page opened on ?focus= is laid out right before the scene loads.
// Imported last, after the stylesheets the page's modules bring (actions.css), as when it came with the scene
import './demo.css'

const w = window as unknown as { __frontReady: boolean }
w.__frontReady = false
// The 3D room's model and baked maps (dressing.ts) start downloading now, with the page, instead of after three.js and
// the scene code: the scene's own requests for the same URLs then come from the browser cache. At low priority (the
// page's scripts and fonts first), with the request modes of three's loaders (fetch, img CORS anonymous); not without
// WebGL 2 or with ?gl=0, where the scene shows its still image. Started from here rather than by <link rel=preload>,
// which logs a console warning whenever the 3D takes more than 3 s after the page load to ask for them.
if ('WebGL2RenderingContext' in window && new URLSearchParams(location.search).get('gl') !== '0') {
  try {
    void fetch('./net/net3d.glb', { priority: 'low' } as RequestInit).then((r) => r.arrayBuffer()).catch(() => null)
    for (const k of ['use', 'rent', 'publish']) for (const m of ['lm', 'rm']) {
      const i = new Image(); i.crossOrigin = 'anonymous'; i.decoding = 'async'; i.setAttribute('fetchpriority', 'low'); i.src = `./net/${m}_${k}.webp`
    }
  } catch { /* nothing warmed: the scene loads them itself */ }
}
document.documentElement.classList.add('js', 'app-page')
startLive()
startClock({ smooth: false })
// first render synchronous: the header is on screen at the page's first frame, so it stays in place across the
// page transition (motion rule M1, ui/motion.ts)
flushSync(() => createRoot(document.getElementById('root')!).render(<NetworkPage />))
// ready once rendered with its fonts (at most 1.5 s), like the other app pages; the 3D does not hold the page back
Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => requestAnimationFrame(() => { w.__frontReady = true }))
