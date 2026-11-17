// Entry of the Network page: Use, Rent and Publish together. The same clock as the app pages (GSAP ticker,
// no smooth scroll), the live read for the header, then the page; the 3D scene (scene.ts) is mounted after the
// first React render and sets __frontReady itself, once its programs are compiled and its textures uploaded.
import { createRoot } from 'react-dom/client'
import '../styles.css'
import '../app/app.css'
import './scene.css'
import './network.css'
import { startClock } from '../clock'
import { startLive } from '../data/live'
import { NetworkPage } from './NetworkPage'

const w = window as unknown as { __frontReady: boolean }
w.__frontReady = false
document.documentElement.classList.add('js', 'app-page')
startLive()
startClock({ smooth: false })
createRoot(document.getElementById('root')!).render(<NetworkPage />)
setTimeout(() => { w.__frontReady = true }, 15000)
