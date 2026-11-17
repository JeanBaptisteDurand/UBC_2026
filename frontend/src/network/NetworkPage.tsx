// The Network page: the diagram is the first thing seen, under the header; the three choices are in the
// column to its left; a choice opens the focus (the column becomes the steps panel, the scene stays on the right);
// going back to the overview goes through the same column. The visitor's wallet sits in the header, a cross
// closes the focus, the catalog replaces the scene; on focus, the panel steps become actions (actions/Actions.tsx)
// and the diagram follows them. On phones: the diagram, then the choices. The page name fits in one key (net.name).
import { useEffect, useRef } from 'react'
import { t, useLang } from '../i18n'
import { Footer } from '../ui/Footer'
import { AppHeader } from '../app/AppFrame'
import { link } from '../links'
import { withArcWords, plainAcc, splitAcc } from '../ui/ArcGlow'
import { useIn } from '../ui/gestures'
import { Actions, HeaderWallet, ServiceCatalog, CloseFocus } from './actions/Actions'

const PARTS = [
  { k: 'use', label: 'cta.use', kind: 'btn-main' },
  { k: 'rent', label: 'cta.rent', kind: 'btn-line' },
  { k: 'publish', label: 'cta.publish', kind: 'btn-line' },
] as const

/** The overview title styled like the hero catchline (sections/Hero.tsx, Catch):
 *  an uppercase h1, split after the comma, the {…}-marked part of net.title in glowing Arc blue */
function NetCatch() {
  const lang = useLang()
  const raw = t('net.title'), full = plainAcc(raw)
  const hl = splitAcc(raw).filter((x) => x.acc).flatMap((x) => x.s.split(/\s+/)).map((w) => w.replace(/[^\p{L}]/gu, '')).filter(Boolean)
  // two lines: split after the comma, else before the glowing part ('Join the / network')
  const k = full.indexOf(','), pa = splitAcc(raw), acc = pa.find((x) => x.acc)
  const a = k >= 0 ? full.slice(0, k + 1) : acc ? pa.filter((x) => !x.acc).map((x) => x.s).join('').trim() : full
  const b = k >= 0 ? full.slice(k + 1).trim() : acc ? acc.s : ''
  // The glowing words stay mounted (hidden on focus) instead of unmounting and remounting on every return to the
  // overview. The measurement waits for a non-zero size (ArcGlow)
  const words = (s: string) => withArcWords(s, hl)
  return (
    <h1 className="h1 catch ttl net-catch" aria-label={full} data-lang={lang}>
      <span className="ttl-m c1" aria-hidden="true"><span className="ttl-t">{words(a)}</span></span>
      {b && <span className="ttl-m c2" aria-hidden="true"><span className="ttl-t">{words(b)}</span></span>}
      <span className="ttl-rule" aria-hidden="true" />
    </h1>
  )
}

export function NetworkPage() {
  useLang()
  const col = useRef<HTMLElement>(null)
  useIn(col, 1)
  useEffect(() => { document.title = t('net.doc') }, [])
  // the scene mounts once the DOM is ready (it reads its elements by id)
  useEffect(() => { import('./scene') }, [])
  return (
    <>
      <a className="skip" href="#choices" data-front-free>{t('net.skip')}</a>
      <AppHeader page="network" section="net.sec" wallet={<HeaderWallet />} />
      <main className="app network">
        <section className="s3d" aria-label={t('net.sec')}>
          <div className="net" id="net">
            <aside className="net-col" id="col" data-col="ensemble">
              {/* The overview has the landing hero interface: the catchline, the support line,
                  the buttons in a row; below, the demo and two discreet entries (Arc, CCTP) */}
              <section className="net-choices txt" id="choices" aria-labelledby="choose-t" ref={col}>
                <NetCatch />
                <p className="support net-support">{t('net.lede')}</p>
                <h2 className="sr-only" id="choose-t">{t('net.choose')}</h2>
                <div className="ctas net-ctas" data-front-free>
                  {PARTS.map((p) => (
                    <button key={p.k} type="button" className={`btn ${p.kind} net-part`} data-view={p.k} data-part={p.k}><span>{t(p.label)}</span></button>
                  ))}
                </div>
                {/* line 2: the demo as an Arc blue button, then the two links */}
                <p className="net-more" data-front-free>
                  <button type="button" className="btn btn-arc net-demo" data-view="demo"><span>{t('net.demo')}</span></button>
                  <button type="button" className="tlink net-arc" data-view="arc">{t('net.arc')}</button>
                  {/* the CCTP system focus, like each room's */}
                  <button type="button" className="tlink net-cctp" data-view="cctp">{t('net.cctp')}</button>
                </p>
              </section>
              <section className="panel" id="panel" aria-live="polite" hidden>
                <CloseFocus />
                <button className="back" type="button" data-view="ensemble">{t('net.back')}</button>
                <p className="kick" id="p-kick" />
                <h2 className="h2 ttl in p-title-w"><span className="ttl-m"><span className="ttl-t" id="p-title" /></span><span className="ttl-rule" aria-hidden="true" /></h2>
                <p className="lead" id="p-actor" />
                <button className="refus-b" id="refus" type="button" hidden>{t('net.refus')}</button>
                <a className="tlink net-browse" id="browse" href={link.use} hidden>{t('net.browse')}</a>
                <ol className="steps" id="steps" />
                <Actions />
              </section>
            </aside>
            <div className="net-scene">
              <div className="stage" id="stage">
                <canvas id="gl" role="img" aria-label={t('net.canvas')} />
                <svg className="mlinks" id="mlinks" aria-hidden="true" width="100%" height="100%" />
                <div className="modals" id="modals" aria-live="polite" />
                <div className="sel" id="sel" aria-hidden="true" />
                <span className="pk-label" id="pk-label" hidden />
                <figure className="net-nogl" id="nogl" hidden>
                  <img src="/net/poster.jpg" alt={t('net.poster')} width="1600" height="1000" />
                  <span className="net-still">{t('net.still')}</span>
                  <figcaption>{t('net.nogl')}</figcaption>
                </figure>
              </div>
              <ServiceCatalog />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
