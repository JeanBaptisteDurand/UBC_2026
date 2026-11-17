// The service catalog (/services.html): every product registered on Arc, whatever its state, shown as the face of a
// sled in a drawn rack. Nothing here is written by hand per product: the rows come from the live reading (catalog.ts,
// the same model as the Use page), so a new product appears on its own, with the description of its service type.
// Hover, focus or tap slides the sled out and shows what the service does, its price and who runs it.
import { useMemo, useRef, useState } from 'react'
import { useIn } from '../ui/gestures'
import { useLive } from '../data/live'
import { usdc, num } from '../data/fmt'
import { t, useLang, type TKey } from '../i18n'
import { priceText, svcName, type Service } from '../data/wall'
import { serviceHref } from '../links'
import { AppHeader } from './AppFrame'
import { AppTitle } from './UsePage'
import { Footer } from '../ui/Footer'
import { useCatalog } from './useCatalog'
import { stateLabel, isSupersededRow, verdictOf, type SvcRow } from './catalog'
import './services.css'

type StateF = 'all' | 'green' | 'amber' | 'red'
const KINDS: Service[] = ['copilot', 'ai', 'x402', 'bounty', 'author']

/** the status word on the plate, as on the wall's sleds */
function plateWord(r: SvcRow): string {
  if (isSupersededRow(r)) return t('sv.w.replaced')
  if (r.p.state === 'Proposed') return t('sv.w.proposed')
  return t(`sv.w.${r.led}` as TKey)
}

function Blade({ r, open, onToggle }: { r: SvcRow; open: boolean; onToggle: () => void }) {
  const bounties = useLive((s) => s.bounties)
  const ops = new Set(r.encs.map((x) => x.e.operator.toLowerCase())).size
  const led = isSupersededRow(r) ? 'off' : r.led
  const lang = useLang()
  return (
    <article className={`blade ${open ? 'is-open' : ''}`} data-led={led} data-long={r.name.length > 17 ? '1' : '0'}>
      <button type="button" className="blade-face" aria-expanded={open} onClick={onToggle}>
        <span className="bl-led" aria-hidden="true"><i /></span>
        <span className="bl-title">{r.name}</span>
        <span className="bl-word">{plateWord(r)}</span>
        <span className="bl-u">#{r.p.id}</span>
      </button>
      <div className="blade-drawer">
        <div className="bl-in">
          <p className="bl-desc">{t(`sv.k.${r.svc}` as TKey)}</p>
          <dl className="bl-facts">
            <div><dt>{t('sv.f.state')}</dt><dd>{stateLabel(r)}</dd></div>
            <div><dt>{t('sv.f.price')}</dt><dd className="mono">{priceText(r.p, bounties ?? [])}</dd></div>
            <div><dt>{t('sv.f.run')}</dt><dd className="mono tnum">{num(r.running, lang) ?? '0'}</dd></div>
            <div><dt>{t('sv.f.ops')}</dt><dd className="mono tnum">{num(ops, lang) ?? '0'}</dd></div>
            <div><dt>{t('sv.f.paid')}</dt><dd className="mono tnum">{r.lastPay?.amount ? t('sv.f.paidV', { a: usdc(r.lastPay.amount, lang) ?? '', b: num(r.lastPay.a.block, lang) ?? '' }) : t('sv.f.none')}</dd></div>
          </dl>
          <a className="btn btn-main btn-s" href={serviceHref(r.p.id)}><span>{t('sv.open')}</span></a>
        </div>
      </div>
    </article>
  )
}

export function ServicesPage() {
  useLang()
  const rows = useCatalog()
  const [st, setSt] = useState<StateF>('all')
  const [kind, setKind] = useState<'all' | Service>('all')
  const [openId, setOpen] = useState<string | null>(null)
  const main = useRef<HTMLElement>(null)
  useIn(main, 0.94)
  const kinds = useMemo(() => KINDS.filter((k) => rows?.some((r) => r.svc === k)), [rows])
  const shown = (rows ?? []).filter((r) => (st === 'all' || (!isSupersededRow(r) && r.led === st) || (st === 'red' && isSupersededRow(r))) && (kind === 'all' || r.svc === kind))
  const v = rows ? verdictOf(rows) : null
  const chip = (on: boolean, label: string, f: () => void, key: string) => <button key={key} type="button" className="chip" aria-pressed={on} onClick={f}>{label}</button>
  return (
    <>
      <AppHeader page="services" section="sv.sec" />
      <main className="app services" ref={main}>
        <section className="app-top st-use">
          <div className="app-top-in">
            <AppTitle k="sv.title" />
            <p className="lede">{t('sv.lede')}</p>
            <p className="sv-verdict mono tnum">{v ? t('sv.verdict', { a: v.running, b: v.total }) : t('app.verdict.wait')}</p>
          </div>
        </section>
        <section className="sv-cat" aria-label={t('sv.title.plain')}>
          <div className="sv-filters">
            <div className="sv-f" role="group" aria-label={t('app.f.state')}>
              {chip(st === 'all', t('app.f.all'), () => setSt('all'), 'a')}
              {chip(st === 'green', t('app.f.running'), () => setSt('green'), 'g')}
              {chip(st === 'amber', t('app.f.idle'), () => setSt('amber'), 'm')}
              {chip(st === 'red', t('app.f.retired'), () => setSt('red'), 'r')}
            </div>
            {kinds.length > 1 ? (
              <div className="sv-f" role="group" aria-label={t('app.f.kind')}>
                {chip(kind === 'all', t('app.f.all'), () => setKind('all'), 'ka')}
                {kinds.map((k) => chip(kind === k, svcName(k), () => setKind(k), k))}
              </div>
            ) : null}
          </div>
          <div className="rack" data-empty={rows && !shown.length ? '1' : '0'}>
            <span className="rack-rail l" aria-hidden="true" /><span className="rack-rail r" aria-hidden="true" />
            {!rows ? <p className="sv-wait muted">{t('app.loading')}</p>
              : !shown.length ? <p className="sv-wait muted">{t('sv.empty')}</p>
              : <div className="rack-grid">{shown.map((r) => <Blade key={r.p.id} r={r} open={openId === r.p.id} onToggle={() => setOpen((c) => (c === r.p.id ? null : r.p.id))} />)}</div>}
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
