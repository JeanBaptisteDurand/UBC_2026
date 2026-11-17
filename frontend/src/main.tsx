import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { startClock } from './clock'
import { startLive } from './data/live'
import { world } from './world'
import { startAssets } from './assets'
import { CONSOLE } from './data/endpoints'

// The console lives under /console/: an old shared link to its pages ("/#/ruche", "/?testsigner=…#/vue"…) leads there,
// with its parameters (test mode reads ?testsigner=). The console address comes from endpoints.ts
if (location.hash.startsWith('#/')) location.replace(`${CONSOLE}/` + location.search + location.hash)

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
// The site copilot (src/copilot) mounts once the landing is ready (scene compiled, first read done) and the browser is
// idle: nothing more to load or render before the first screen
{
  const W = window as unknown as { __frontReady?: boolean; requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }
  const go = () => { void import('./copilot/mount').then((m) => m.mountCopilot()) }
  const wait = () => { if (W.__frontReady) { if (W.requestIdleCallback) W.requestIdleCallback(go, { timeout: 2000 }); else setTimeout(go, 500) } else setTimeout(wait, 250) }
  setTimeout(wait, 250)
}
