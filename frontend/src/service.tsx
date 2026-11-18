// Standalone service page: service.html?p=<product>, or ?slot=<slot> from the landing wall (reload of a URL opened in
// place by the panel). Same content as the Use page panel, read live; a slot without a product keeps the wall card
// (open slot, enclave with no product read).
import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import './styles.css'
import './app/app.css'
import { startLive, getLive, subscribeLive } from './data/live'
import { startClock } from './clock'
import { t, useLang } from './i18n'
import { ServiceBody, useStandaloneSled } from './ui/ServicePanel'
import { AppHeader } from './app/AppFrame'
import { ServiceDetail } from './app/ServiceDetail'
import { useCatalog } from './app/useCatalog'
import { Footer } from './ui/Footer'
import { link } from './links'
import './ui/blades.css'
import { NSLOTS } from './data/wall'
import { Vitrine } from './services/Vitrine'

const q = new URLSearchParams(location.search)
const pid0 = q.get('p')
// A slot outside the wall, or an empty ?p=, reads as "no product", never a blank page or an endless read
const slotN = q.has('slot') ? Number(q.get('slot')) : -1
const slot = Number.isInteger(slotN) && slotN >= 0 && slotN < NSLOTS ? slotN : -1
const badSlot = q.has('slot') && slot < 0

function Service() {
  const lang = useLang()
  const sled = useStandaloneSled(slot)
  const pid = pid0 ?? sled?.product?.id ?? (badSlot ? '' : null)
  const rows = useCatalog()
  const name = pid ? rows?.find((r) => r.p.id === pid)?.name : undefined
  useEffect(() => { if (slot >= 0 && !pid0) document.title = name ? `ArcHive. ${name}` : `ArcHive. ${t('svc.page')}` }, [name, lang])
  return (
    <>
      <a className="skip" href="#svc" data-front-free>{t('d.skip')}</a>
      <AppHeader page="service" section="svc.page" />
      {/* what ArcHive sells (JB's product1 presentation, 18/11): the server's sleds, each family's chapter opens in the
          left column; a ?slot= without a product keeps the wall card */}
      {slot < 0 || pid0 ? <main className="app vt-main" id="svc"><Vitrine /></main> : (
      <main className="app svc-full" id="svc">
        <div className="svc-full-in">
          <a className="tlink svc-back" href={link.catalog}>{t('svx.back')}</a>
          {pid !== null ? <ServiceDetail pid={pid} wide /> : <div className="detail"><ServiceBody pid={null} slot={slot} sled={sled} /></div>}
        </div>
      </main>)}
      <Footer />
    </>
  )
}
const w = window as unknown as { __frontReady: boolean }
w.__frontReady = false
document.documentElement.classList.add('js', 'app-page')
document.documentElement.dataset.title = 'ArcHive. Service'
startLive({ levels: true })
startClock({ smooth: false })
createRoot(document.getElementById('root')!).render(<Service />)
const ready = () => { if (getLive().status !== 'loading') { off(); Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => requestAnimationFrame(() => { w.__frontReady = true })) } }
const off = subscribeLive(ready)
ready()
setTimeout(() => { w.__frontReady = true }, 12000)
