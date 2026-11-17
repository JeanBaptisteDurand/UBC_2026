// The Network page: the diagram is the first thing seen, under the header; the three choices are in the
// column to its left; a choice opens the focus (the column becomes the steps panel, the scene stays on the right);
// going back to the overview goes through the same column. The visitor's wallet sits in the header, a cross
// closes the focus, the catalog replaces the scene; on focus, the panel steps become actions (actions/Actions.tsx)
// and the diagram follows them. On phones: the diagram, then the choices. The page name fits in one key (net.name).
import { useEffect, useRef, useState } from 'react'
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
  const [keyOpen, setKeyOpen] = useState(false) // on phones, the key folds under the scene
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
              {/* each entry draws the object as it appears in the scene; the packet color is the part's */}
              <button type="button" className="key-t" aria-expanded={keyOpen} aria-controls="key" onClick={() => setKeyOpen((o) => !o)}>{t('net.key')}</button>
              <p className="key" id="key" data-front-free data-open={keyOpen ? '1' : '0'} aria-label={t('net.key')}>
                <span className="key-i" data-k="k0"><svg viewBox="0 0 16 12" aria-hidden="true"><rect x="3.5" y="1.5" width="9" height="9" className="lg-req" /></svg><span>{t('net.k0')}</span></span>
                <span className="key-i" data-k="k1"><svg viewBox="0 0 16 12" aria-hidden="true"><circle cx="8" cy="6" r="5" className="lg-res" /><circle cx="8" cy="6" r="2" className="lg-seal" /></svg><span>{t('net.k1')}</span></span>
                <span className="key-i" data-k="k2"><svg viewBox="0 0 16 12" aria-hidden="true"><path d="M8 1 L13 6 L8 11 L3 6 Z" className="lg-fp" /></svg><span>{t('net.k2')}</span></span>
                <span className="key-i" data-k="k3"><svg viewBox="0 0 28 12" className="lg-w" aria-hidden="true"><path d="M7 1 L12 6 L7 11 L2 6 Z" className="lg-ok" /><path d="M7 3.6 L9.4 6 L7 8.4 L4.6 6 Z" className="lg-okc" /><path d="M21 1 L26 6 L21 11 L16 6 Z" className="lg-no" /></svg><span>{t('net.k3')}</span></span>
                <span className="key-i" data-k="k4"><svg viewBox="0 0 96 96" className="lg-usdc" aria-hidden="true"><circle cx="48" cy="48" r="45.2" fill="none" strokeWidth="3.6" /><path d="M56.4609 13.7778V19.8291C68.5341 23.4716 77.3759 34.6928 77.3759 47.9997C77.3759 61.3066 68.5341 72.5278 56.4609 76.1703V82.2216C71.8534 78.4616 83.2509 64.5672 83.2509 47.9997C83.2509 31.4322 71.8534 17.5378 56.4609 13.7778Z" /><path d="M18.625 47.9997C18.625 34.6928 27.4669 23.4716 39.54 19.8291V13.7778C24.1475 17.5378 12.75 31.4322 12.75 47.9997C12.75 64.5672 24.1475 78.4616 39.54 82.2216V76.1703C27.4669 72.5572 18.625 61.3066 18.625 47.9997Z" /><path d="M60.6319 54.5506C60.6319 42.5362 41.8025 47.4713 41.8025 40.8325C41.8025 38.4531 43.7119 36.9256 47.3544 36.9256C51.7019 36.9256 53.2 39.0406 53.67 41.89H59.6625C59.1279 36.5426 56.0588 33.1662 50.9382 32.1604V27.4375H45.0632V31.9918C39.4534 32.7062 35.9275 35.973 35.9275 40.8325C35.9275 52.9056 54.7863 48.3819 54.7863 54.9031C54.7863 57.3706 52.4069 59.0156 48.3825 59.0156C43.1244 59.0156 41.3913 56.695 40.745 53.4931H34.8994C35.2781 59.3502 38.8897 63.0159 45.0632 63.9307V68.5625H50.9382V63.9923C56.9633 63.2139 60.6319 59.7089 60.6319 54.5506Z" /></svg><span>{t('net.k4')}</span></span>
                <span className="key-i" data-k="k5"><svg viewBox="0 0 40 12" className="lg-w2" aria-hidden="true"><path d="M3.6 1 L7 5.6 L3.6 7.2 L0.2 5.6 Z M3.6 8 L7 6.4 L3.6 11 L0.2 6.4 Z" className="lg-eth" /><circle cx="13.5" cy="6" r="4.6" className="lg-op" /><path d="M19 6 C 26 0.5, 31 0.5, 39 6" className="lg-cctp" /><circle cx="19" cy="6" r="1.4" className="lg-anc" /></svg><span>{t('net.k5')}</span></span>
                <span className="key-i" data-k="k6"><svg viewBox="0 0 24 12" className="lg-w3" aria-hidden="true"><path d="M3 9 C 9 2, 15 2, 21 9" className="lg-link" /><circle cx="3" cy="9" r="1.6" className="lg-anc" /><circle cx="21" cy="9" r="1.6" className="lg-anc lg-anc-arc" /></svg><span>{t('net.k6')}</span></span>
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
