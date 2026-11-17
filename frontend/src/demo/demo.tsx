// Demo entry point (/demo.html): no network read on load, everything comes from replay.json. The same clock as the
// rest of the app (GSAP ticker) for the title glow, without smooth scroll.
import { createRoot } from 'react-dom/client'
import '../styles.css'
import '../app/app.css'
import './demo.css'
import { startClock } from '../clock'
import { t } from '../i18n'
import { DemoPage } from './DemoPage'

const w = window as unknown as { __frontReady: boolean }
w.__frontReady = false
document.documentElement.classList.add('js', 'app-page', 'demo-page')
document.documentElement.dataset.title = t('demo.doc')
document.title = t('demo.doc')
startClock({ smooth: false })
createRoot(document.getElementById('root')!).render(<DemoPage />)
Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => requestAnimationFrame(() => { w.__frontReady = true }))
