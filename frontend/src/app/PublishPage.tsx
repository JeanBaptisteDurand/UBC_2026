// Publish page: publish your service. The console's author path (web/src/i18n/en.ts, pub.s1 to pub.s7) and the
// manifest fields read by the CLI (packages/cli/src/commands/product.ts). Each step that leaves a trace on Arc shows
// it, read live: the allowed digest, the keccak-verified manifest, proposal and activation, the protection delay,
// the split. Publishing is signed in the console.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLive, CONSOLE } from '../data/live'
import { num, short, pct } from '../data/fmt'
import { t, useLang, type TKey } from '../i18n'
import { link, tx, serviceHref } from '../links'
// signed actions, below the first screen: loaded after it
const PublishActs = lazy(() => import('../network/actions/acts').then((m) => ({ default: m.PublishActs })))
import { x } from '../network/actions/strings-x'
import { ActSec } from './opsui'
import { useIn } from '../ui/gestures'
import { Footer } from '../ui/Footer'
import { AppHeader } from './AppFrame'
import { AppTitle } from './UsePage'
import { useCatalog } from './useCatalog'
import { stateLabel } from './catalog'
import { Path, Cmd, type PathStep } from './parts'
import { readTimelock } from './chain'
import { readManifest, type Manifest } from './proofs'

export function PublishPage() {
  const lang = useLang()
  const rows = useCatalog()
  const activity = useLive((s) => s.activity)
  const main = useRef<HTMLElement>(null)
  useIn(main, 0.94)
  const [lock, setLock] = useState<number | null | undefined>(undefined)
  useEffect(() => { readTimelock().then(setLock) }, [])
  // the most recent product that publishes a manifest: its copy verified by keccak against the hash read on Arc
  const withManifest = rows?.filter((r) => r.p.manifestURI).sort((a, b) => Number(b.p.id) - Number(a.p.id))[0]
  const [man, setMan] = useState<Manifest | null>(null)
  useEffect(() => { if (withManifest) readManifest(withManifest.p.manifestURI, withManifest.p.manifestHash).then(setMan) }, [withManifest?.p.id, withManifest?.p.manifestHash]) // eslint-disable-line react-hooks/exhaustive-deps
  const ev = (n: string) => activity?.find((a) => a.name === n)
  const wl = ev('WorkloadAdded'), prop = ev('ProductProposed'), act = ev('ProductActivated')
  const blk = (a?: { tx: string; block: number }) => (a ? <a className="tlink mono" href={tx(a.tx)} target="_blank" rel="noreferrer">{`${t('word.block')} ${num(a.block, lang)}`}</a> : null)
  const steps: PathStep[] = [
    { k: 's1' },
    { k: 's2' },
    { k: 's3', proof: wl ? <span>{t('pp.p3', { w: short(wl.args.workloadId, 6), id: wl.args.productId })} {blk(wl)}</span> : <span className="muted">{activity ? t('end.none') : t('state.loading')}</span> },
    { k: 's4', proof: withManifest ? <span>{man?.state === 'ok' ? t('pp.p4ok', { id: withManifest.p.id }) : man ? t('pp.p4no', { id: withManifest.p.id }) : t('d.img.wait')} <a className="tlink" href={serviceHref(withManifest.p.id)}>{withManifest.name}</a></span> : <span className="muted">{t('state.loading')}</span> },
    { k: 's5', cmd: 'product propose manifest.json --uri <manifestURI>', proof: <span>{prop ? <>{t('pp.p5a', { id: prop.args.productId })} {blk(prop)}. </> : null}{act ? <>{t('pp.p5b', { id: act.args.productId })} {blk(act)}. </> : null}{lock === undefined ? t('state.loading') : lock === null ? t('state.unread') : t('pp.p5c', { s: num(lock, lang) ?? '' })}</span> },
    { k: 's6', extra: <a className="tlink path-x" href={link.rent}>{t('pp.p6')}</a> },
    { k: 's7', proof: <span>{t('pp.p7')}</span> },
  ]
  const running = rows?.filter((r) => r.led === 'green').length
  // "published on Arc" counts every product (no. 6, replaced by 7, stays published on Arc and is marked in the
  // table), as the console and the home page do
  const live = rows
  return (
    <>
      <a className="skip" href="#path" data-front-free>{t('pp.skip')}</a>
      <AppHeader page="publish" section="sec.publish" />
      <main className="app work" ref={main} data-copilot="publish">
        <section className="app-top st-publish">
          <div className="app-top-in">
            <AppTitle k="publish.title" />
            <p className="lede">{t('pp.lede')}</p>
            <div className="verdict-w cote-in">
              <span className="cote-l" aria-hidden="true" />
              <p className="verdict-l tnum cote-v" aria-live="polite">{live ? t('pp.verdict', { a: live.length, prods: t(live.length === 1 ? 'w.prodPub' : 'w.prodsPub'), b: running ?? 0 }) : t('app.verdict.wait')}</p>
              <p className="lbl muted read-at">{t('pp.review')}</p>
            </div>
          </div>
        </section>

        <section className="work-sec" id="path" aria-labelledby="path-h">
          <h2 className="work-h" id="path-h">{t('pp.path')}</h2>
          <Path steps={steps} prefix="pp" />
        </section>

        <section className="work-sec" aria-labelledby="man-h">
          <h2 className="work-h" id="man-h">{t('pp.man')}</h2>
          <p className="lbl muted work-lede">{t('pp.man.lede')}</p>
          <dl className="kv-list rules unfold man-fields">
            {(['price', 'unit', 'shares', 'bond', 'cap', 'rail', 'images', 'det'] as const).map((k, j) => <div key={k} className="kv-row row" style={{ ['--j' as string]: j }}><dt>{t(`pp.f.${k}` as TKey)}</dt><dd>{t(`pp.f.${k}.d` as TKey)}</dd></div>)}
          </dl>
          <p className="lbl muted work-lede">{t('pp.cli')}</p>
          <Cmd cmd="product activate <id>" />
        </section>

        <section className="work-sec" aria-labelledby="now-h">
          <h2 className="work-h" id="now-h">{t('pp.now')}</h2>
          <div className="tbl-w">
            <table className="tbl">
              <thead><tr><th scope="col">{t('app.h.service')}</th><th scope="col">{t('d.author')}</th><th scope="col">{t('d.split')}</th><th scope="col">{t('app.f.state')}</th></tr></thead>
              <tbody>
                {rows ? rows.map((r) => (
                  <tr key={r.p.id}>
                    <td data-l={t('app.h.service')}><a className={`tlink plate is-${r.led}`} href={serviceHref(r.p.id)}>{r.name}</a></td>
                    <td className="mono" data-l={t('d.author')}>{short(r.p.author, 4)}</td>
                    <td className="mono" data-l={t('d.split')}>{[r.p.bpsOperator, r.p.bpsAuthor, r.p.bpsNetwork].map((b) => pct(b, lang)).join(', ')}</td>
                    <td data-l={t('app.f.state')}>{stateLabel(r)}</td>
                  </tr>
                )) : <tr><td colSpan={4} className="muted">{t('state.loading')}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <ActSec id="act" title={x('p.act')} lede={x('p.act.lede')}>
          <Suspense fallback={null}><PublishActs label={x('p.act')} /></Suspense>
        </ActSec>
      </main>
      <Footer />
    </>
  )
}
