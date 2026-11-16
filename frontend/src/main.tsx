import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { startClock } from './clock'
import { startLive } from './data/live'
import { world } from './world'
import { startAssets } from './assets'

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
