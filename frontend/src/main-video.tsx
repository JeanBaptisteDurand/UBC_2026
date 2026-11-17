import { startTransition } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './video/video.css'
import App from './AppVideo'
import { startClock } from './clock'
import { startLive } from './data/live'
import { world } from './world'
import { CONSOLE } from './data/endpoints'

// The console lives under /console/: an old shared link to its pages ("/#/ruche", "/?testsigner=…#/vue"…) leads there,
// with its parameters (test mode reads ?testsigner=). The console address comes from endpoints.ts
if (location.hash.startsWith('#/')) location.replace(`${CONSOLE}/` + location.search + location.hash)

;(window as unknown as { __frontReady: boolean }).__frontReady = false
;(window as unknown as { __world: unknown }).__world = world
document.documentElement.classList.add('js', 'film-page')
// Measurement: ?hide=<selectors> hides elements, ?nofilter=1 removes the SVG filters from the titles (to isolate what
// costs frames); no effect without these parameters
{ const q = new URLSearchParams(location.search), css: string[] = []
  if (q.get('hide')) css.push(`${q.get('hide')} { visibility: hidden !important; }`)
  if (q.get('pe')) css.push(`${q.get('pe')} { pointer-events: none !important; }`)
  if (q.get('nofilter')) css.push('.arc-w-t, .ig-l { filter: none !important; }')
  if (css.length) { const st = document.createElement('style'); st.textContent = css.join('\n'); document.head.appendChild(st) } }
startLive()
startClock()
Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => {
  // React's first render runs in slices (transition): a wheel turned from the first byte no longer lands on a 100 to
  // 200 ms task (CPU x4)
  const root = createRoot(document.getElementById('root')!)
  startTransition(() => root.render(<App />))
})
// The site copilot (src/copilot) mounts once the landing is ready (first film draw) and the browser is idle: nothing
// more to load or render before the first screen
{
  const W = window as unknown as { __frontReady?: boolean; requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }
  const go = () => { void import('./copilot/mount').then((m) => m.mountCopilot()) }
  const wait = () => { if (W.__frontReady) { if (W.requestIdleCallback) W.requestIdleCallback(go, { timeout: 2000 }); else setTimeout(go, 500) } else setTimeout(wait, 250) }
  setTimeout(wait, 250)
}
