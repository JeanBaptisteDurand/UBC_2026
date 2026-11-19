// Entry point of the Use page (/use/): the same clock as the landing (GSAP ticker) without smooth scroll, the live
// reading, then the page. __frontReady turns true once the first API reading has arrived (or failed) and fonts are
// loaded: the state shown to checks is the real one, never the skeleton.
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import '../styles.css'
import './app.css'
import { startClock } from '../clock'
import { startLive, getLive, subscribeLive } from '../data/live'
import { UsePage } from './UsePage'

const w = window as unknown as { __frontReady: boolean }
w.__frontReady = false
document.documentElement.classList.add('js', 'app-page')
startLive({ levels: true })
startClock({ smooth: false })
// first render synchronous: the header is on screen at the page's first frame, so it stays in place across the
// page transition (motion rule M1, ui/motion.ts)
flushSync(() => createRoot(document.getElementById('root')!).render(<UsePage />))
const ready = () => { if (getLive().status !== 'loading') { off(); Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => requestAnimationFrame(() => { w.__frontReady = true })) } }
const off = subscribeLive(ready)
ready()
setTimeout(() => { w.__frontReady = true }, 12000)
