// The doc page (doc.html): how ArcHive works, chapter by chapter (src/doc). App frame, live reading of Arc testnet for
// the few numbers it shows live, footer and copilot like the other app pages.
import { createRoot } from 'react-dom/client'
import './styles.css'
import './app/app.css'
import { startLive, getLive, subscribeLive } from './data/live'
import { startClock } from './clock'
import { AppHeader } from './app/AppFrame'
import { Footer } from './ui/Footer'
import { DocPage } from './doc/DocPage'
import { useDt } from './doc/strings'

function Doc() {
  const { d } = useDt()
  return (
    <>
      <a className="skip" href="#doc-idx" data-front-free>{d('doc.skip')}</a>
      <AppHeader page="doc" section="svc.page" sectionText={d('doc.sec')} />
      <DocPage />
      <Footer />
    </>
  )
}
const w = window as unknown as { __frontReady: boolean }
w.__frontReady = false
document.documentElement.classList.add('js', 'app-page', 'doc-page')
document.documentElement.dataset.title = 'ArcHive. Doc'
startLive()
startClock({ smooth: false })
createRoot(document.getElementById('root')!).render(<Doc />)
const ready = () => { if (getLive().status !== 'loading') { off(); Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => requestAnimationFrame(() => { w.__frontReady = true })) } }
const off = subscribeLive(ready)
ready()
setTimeout(() => { w.__frontReady = true }, 12000)
