// Standalone service page: service.html?p=<product>, or ?slot=<slot> from the landing wall (reload of a URL opened in
// place by the panel). Same content as the Use page panel, read live; a slot without a product keeps the wall card
// (open slot, enclave with no product read).
import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import './styles.css'
import './app/app.css'
import { startLive, getLive, subscribeLive, useLive } from './data/live'
import { startClock } from './clock'
import { t, useLang, type TKey } from './i18n'
import { ServiceBody, useStandaloneSled } from './ui/ServicePanel'
import { AppHeader } from './app/AppFrame'
import { ServiceDetail } from './app/ServiceDetail'
import { useCatalog } from './app/useCatalog'
import { Footer } from './ui/Footer'
import { link, serviceHref, useHref } from './links'
import { usdc } from './data/fmt'
import './ui/blades.css'
import { NSLOTS } from './data/wall'

const q = new URLSearchParams(location.search)
const pid0 = q.get('p')
// A slot outside the wall, or an empty ?p=, reads as "no product", never a blank page or an endless read
const slotN = q.has('slot') ? Number(q.get('slot')) : -1
const slot = Number.isInteger(slotN) && slotN >= 0 && slotN < NSLOTS ? slotN : -1
const badSlot = q.has('slot') && slot < 0

/** service.html with no service given: every service read live, each described (what it does, state, price, enclaves
 *  running), with its page and a button to use it. The same sled faces as the landing wall and the Use catalog */
function ServicesIndex() {
  const lang = useLang()
  const rows = useCatalog()
  const status = useLive((s) => s.status)
  const list = (rows ?? []).filter((r) => r.p.state !== 'Retired')
  useEffect(() => { document.title = `ArcHive. ${t('sv.title.plain')}` }, [lang])
  return (
    <section className="svx" aria-labelledby="svx-h">
      <h1 className="h2 svx-h" id="svx-h">{t('sv.title.plain')}</h1>
      <p className="body svx-l">{t('svx.lede')}</p>
      {!rows ? <p className="lbl muted">{status === 'error' ? t('d.down') : t('d.reading')}</p> : null}
      <ol className="svx-list">
        {list.map((r) => (
          <li key={r.p.id} className="svx-i">
            <a className="blade svx-face" href={serviceHref(r.p.id)} data-led={r.role?.role === 'superseded' ? 'off' : r.led} data-long={r.name.length > 14 ? '1' : '0'} aria-label={`${r.name}, #${r.p.id}`}>
              <span className="blade-face" aria-hidden="true">
                <span className="bl-led"><i /></span>
                <span className="bl-title">{r.name}</span>
                <span className="bl-word">{r.role?.role === 'superseded' ? t('sv.w.replaced') : t(`sv.w.${r.led}` as TKey)}</span>
                <span className="bl-u">{`#${r.p.id} · ${Number(r.p.price) ? usdc(r.p.price, lang) : t('svx.free')}`}</span>
              </span>
            </a>
            <p className="body svx-d">{t(`sv.k.${r.svc}` as TKey)}</p>
            <p className="lbl muted svx-m">{t('svx.run', { a: r.running, b: r.encs.length })}</p>
            <div className="svx-acts">
              {r.role?.role === 'superseded' ? null : <a className="btn btn-main btn-s" href={useHref(r.p.id)}><span>{t('d.use.btn')}</span></a>}
              <a className="tlink" href={serviceHref(r.p.id)}>{t('svx.more')}</a>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Service() {
  const lang = useLang()
  const sled = useStandaloneSled(slot)
  const pid = pid0 ?? sled?.product?.id ?? (badSlot ? '' : null)
  const rows = useCatalog()
  const name = pid ? rows?.find((r) => r.p.id === pid)?.name : undefined
  useEffect(() => { if (pid !== null || slot >= 0) document.title = name ? `ArcHive. ${name}` : `ArcHive. ${t('svc.page')}` }, [name, lang])
  return (
    <>
      <a className="skip" href="#svc" data-front-free>{t('d.skip')}</a>
      <AppHeader page="service" section="svc.page" />
      <main className="app svc-full" id="svc">
        <div className="svc-full-in">
          {pid === null && slot < 0 ? <ServicesIndex /> : <>
            <a className="tlink svc-back" href={link.catalog}>{t('svx.back')}</a>
            {pid !== null ? <ServiceDetail pid={pid} wide /> : <div className="detail"><ServiceBody pid={null} slot={slot} sled={sled} /></div>}
          </>}
        </div>
      </main>
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
