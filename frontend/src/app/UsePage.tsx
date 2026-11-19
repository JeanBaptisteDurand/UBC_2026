// The Use page, the app's entry: the catalog of services read live on Arc testnet, each as a blade (its LED, its name
// backlit in its status color, one LED per real enclave), search and filters, and a service page sliding in from the
// right (?p= in the URL, Escape to close).
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useLive, getLive } from '../data/live'
import { num, pct, usdc } from '../data/fmt'
import { t, useLang, type TKey } from '../i18n'
import { svcName, type Led, type Service } from '../data/wall'
import { serviceHref } from '../links'
// signed actions, below the first screen: loaded after it
const UseActs = lazy(() => import('../network/actions/acts').then((m) => ({ default: m.UseActs })))
import { setUi } from '../network/actions/store'
import { ENCLAVE, abs } from '../data/endpoints'
import { useProbe } from '../network/actions/probe'
import { x } from '../network/actions/strings-x'
import { ActSec, ServiceState } from './opsui'
import { useIn } from '../ui/gestures'
import { ArcIgnite, plainAcc } from '../ui/ArcGlow'
import { Footer } from '../ui/Footer'
import { AppHeader } from './AppFrame'
import { useCatalog } from './useCatalog'
import { verdictOf, matches, kindsOf, productOfEvent, isPay, railKey, stateLabel, isSupersededRow, type SvcRow, type StateFilter, type KindFilter } from './catalog'

const loadDetail = () => import('./ServiceDetail')
const ServiceDetail = lazy(() => loadDetail().then((m) => ({ default: m.ServiceDetail })))
const ledClass = (l: Led) => (l === 'off' ? 'led' : `led led-${l}`)

/** the page title: the rule before it, the title rising from behind it, then its blue part lighting up */
export function AppTitle({ k, id }: { k: TKey; id?: string }) {
  useLang()
  return (
    <h1 className="h2 ttl app-h1" id={id} aria-label={plainAcc(t(k))}>
      <span className="ttl-m" aria-hidden="true"><span className="ttl-t"><ArcIgnite text={t(k)} /></span></span>
      <span className="ttl-rule" aria-hidden="true" />
    </h1>
  )
}

function Verdict({ rows }: { rows?: SvcRow[] }) {
  const lang = useLang()
  const block = useLive((s) => s.block)
  const v = rows ? verdictOf(rows) : null
  return (
    <div className="verdict-w cote-in">
      <span className="cote-l" aria-hidden="true" />
      {/* tabular figures (fixed width per digit): the sentence does not move when a digit changes */}
      <p className="verdict-l tnum cote-v" aria-live="polite">{v ? t('app.verdict', { a: v.running, b: v.total, c: v.enclaves, enc: t(v.enclaves === 1 ? 'w.enclave' : 'w.enclaves') }) : t('app.verdict.wait')}</p>
      <p className="lbl muted read-at tnum">{block ? t('app.readAt', { n: num(block, lang) ?? '' }) : t('band.reading')}</p>
    </div>
  )
}

function Row({ r, j, pulse, onOpen }: { r: SvcRow; j: number; pulse: boolean; onOpen: (id: string, el: HTMLElement) => void }) {
  const lang = useLang()
  const enc = r.encs.length
  return (
    <li className={`row svc is-${r.led}`} style={{ ['--j' as string]: j }}>
      <a className="svc-b" href={serviceHref(r.p.id)} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); onOpen(r.p.id, e.currentTarget) }} onPointerEnter={() => { void loadDetail() }} onFocus={() => { void loadDetail() }} data-pid={r.p.id}>
        <span className={`${ledClass(r.led)} svc-led ${pulse ? 'pulse' : ''}`} aria-hidden="true" />
        <span className="svc-id">
          <span className={`plate is-${r.led}`}>{r.name}</span>
          <span className="lbl muted">{`#${r.p.id}, ${t(railKey(r.p) as TKey)}`}</span>
        </span>
        <span className="svc-st lbl"><span className="sr-only">{t('app.f.state')}: </span>{stateLabel(r)}</span>
        <span className="svc-price mono"><span className="sr-only">{t('app.h.price')}: </span>{r.svc === 'bounty' && !Number(r.p.price) ? t('app.pool') : priceShort(r)}</span>
        <span className="svc-split mono tnum"><span className="sr-only">{t('app.h.split')}: </span>{[r.p.bpsOperator, r.p.bpsAuthor, r.p.bpsNetwork].map((b) => pct(b, lang)).join(', ')}</span>
        <span className="svc-encs">
          <span className="diodes" aria-hidden="true">{r.encs.slice(0, 12).map((x) => <i key={x.e.signer} className={`d-${x.led}`} />)}</span>
          <span className="lbl muted">{enc ? t('app.encs', { a: r.running, b: enc }) : t('app.encs.none')}</span>
        </span>
        <span className="svc-go" aria-hidden="true">{t('app.open')}</span>
      </a>
    </li>
  )
}
function priceShort(r: SvcRow) {
  if (!Number(r.p.price)) return t('card.free')
  const u = usdc(r.p.price) ?? ''
  return r.svc === 'x402' ? `${u} ${t('card.per.call')}` : r.svc === 'ai' && Number(r.p.unitTokens) === 1 ? `${u} ${t('card.per.token')}` : u
}

function Skeleton() {
  return (
    <>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <li key={i} className="row svc is-skel" aria-hidden="true" style={{ ['--j' as string]: i }}>
          <span className="svc-b"><span className="led svc-led" /><span className="svc-id"><span className="skel w1" /><span className="skel w2" /></span></span>
        </li>
      ))}
    </>
  )
}

const q0 = new URLSearchParams(location.search)
const STATES: StateFilter[] = ['all', 'green', 'amber', 'red']
const stateKey = (s: StateFilter): TKey => (s === 'all' ? 'app.f.all' : s === 'green' ? 'app.f.running' : s === 'amber' ? 'app.f.idle' : 'app.f.retired')

function Catalog({ rows, onOpen }: { rows?: SvcRow[]; onOpen: (id: string, el: HTMLElement) => void }) {
  useLang()
  const status = useLive((s) => s.status)
  const error = useLive((s) => s.error)
  const fresh = useLive((s) => s.fresh)
  const [q, setQ] = useState(q0.get('q') ?? '')
  const [st, setSt] = useState<StateFilter>((STATES as string[]).includes(q0.get('state') ?? '') ? (q0.get('state') as StateFilter) : 'all')
  const [kind, setKind] = useState<KindFilter>((q0.get('kind') as KindFilter) || 'all')
  const [pulse, setPulse] = useState<Set<string>>(new Set())
  // the copilot (src/copilot/driver.ts) types the search and toggles the filters in front of the user
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ q?: unknown; state?: unknown; kind?: unknown }>).detail ?? {}
      if (typeof d.q === 'string') setQ(d.q.slice(0, 60))
      if ((STATES as unknown[]).includes(d.state)) setSt(d.state as StateFilter)
      if (typeof d.kind === 'string' && /^(all|ai|x402|bounty|copilot|author)$/.test(d.kind)) setKind(d.kind as KindFilter)
    }
    addEventListener('archive:catalog', on)
    return () => removeEventListener('archive:catalog', on)
  }, [])
  // the URL keeps the search and filters (shareable link), without a history entry
  useEffect(() => {
    const u = new URL(location.href)
    for (const [k, v, d] of [['q', q.trim(), ''], ['state', st, 'all'], ['kind', kind, 'all']] as const) { if (v && v !== d) u.searchParams.set(k, v); else u.searchParams.delete(k) }
    if (u.href !== location.href) history.replaceState(history.state, '', u)
  }, [q, st, kind])
  // a real payment read during the visit pulses the paid service's LED once, then it holds steady
  const seen = useRef(fresh)
  useEffect(() => {
    if (fresh === seen.current) return
    seen.current = fresh
    const all = getLive().activity ?? []
    const ids = new Set(fresh.filter(isPay).map((a) => productOfEvent(a, all)).filter((x): x is string => !!x))
    if (!ids.size) return
    setPulse(ids)
    const id = setTimeout(() => setPulse(new Set()), 700)
    return () => clearTimeout(id)
  }, [fresh])

  const kinds = rows ? kindsOf(rows) : []
  const byKind = rows?.filter((r) => kind === 'all' || r.svc === kind) ?? []
  // the filter follows the label. A proposed product ("Awaiting activation") is not "online": it only appears under
  // "All". A replaced product (LED off) goes under "Withdrawn or replaced": the three filters add up to the total
  const inState = (r: SvcRow, s: StateFilter) => s === 'all' || ((r.led === s || (s === 'red' && isSupersededRow(r))) && r.p.state !== 'Proposed')
  const shown = byKind.filter((r) => inState(r, st) && matches(r, q))
  const count = (s: StateFilter) => byKind.filter((r) => inState(r, s) && matches(r, q)).length
  const countK = (k: KindFilter) => (rows ?? []).filter((r) => (k === 'all' || r.svc === k) && inState(r, st) && matches(r, q)).length
  const clear = () => { setQ(''); setSt('all'); setKind('all') }
  return (
    <section className="cat" id="catalog" aria-labelledby="cat-h">
      <h2 className="sr-only" id="cat-h">{t('app.cat')}</h2>
      <div className="cat-tools">
        <div className="field">
          <label htmlFor="cat-q" className="lbl">{t('app.search')}</label>
          <input id="cat-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('app.search.ph')} autoComplete="off" spellCheck={false} />
        </div>
        <div className="chips chips-st" role="group" aria-label={t('app.f.state')}>
          {STATES.map((s) => (
            <button key={s} className={`chip ${s !== 'all' ? `chip-${s}` : ''}`} aria-pressed={st === s} onClick={() => setSt(s)}>
              {s !== 'all' ? <i className={ledClass(s as Led)} aria-hidden="true" /> : null}{rows ? `${t(stateKey(s))} ${count(s)}` : t(stateKey(s))}
            </button>
          ))}
        </div>
        {kinds.length > 1 ? (
          <div className="field field-kind">
            <label htmlFor="cat-k" className="lbl">{t('app.f.kind')}</label>
            <span className="sel"><select id="cat-k" value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
              {(['all', ...kinds] as KindFilter[]).map((k) => <option key={k} value={k}>{`${k === 'all' ? t('app.f.all') : svcName(k as Service)} (${countK(k)})`}</option>)}
            </select></span>
          </div>
        ) : null}
      </div>
      <div className="cat-cols lbl muted" aria-hidden="true">
        <span>{t('app.h.service')}</span><span>{t('app.f.state')}</span><span>{t('app.h.price')}</span><span>{t('app.h.split')}</span><span>{t('app.h.enclaves')}</span>
      </div>
      {status === 'error' && !rows ? (
        <div className="cat-msg is-err" role="status">
          <p className="body">{t('app.error')}</p>
          <p className="lbl muted mono">{error}</p>
          <button className="btn btn-line btn-s" onClick={() => location.reload()}><span>{t('app.retry')}</span></button>
        </div>
      ) : null}
      {rows && error ? <p className="cat-stale lbl" role="status">{t('app.stale')}</p> : null}
      <ol className={`bay unfold slot-in ${rows ? '' : 'is-loading'}`} aria-busy={!rows} aria-label={rows ? t('app.shown', { n: shown.length, m: rows.length }) : t('app.loading')}>
        {!rows ? (status === 'error' ? null : <Skeleton />) : shown.map((r, j) => <Row key={r.p.id} r={r} j={j} pulse={pulse.has(r.p.id)} onOpen={onOpen} />)}
      </ol>
      {!rows && status !== 'error' ? <p className="lbl muted cat-load">{t('app.loading')}</p> : null}
      {rows && !shown.length ? (
        <div className="cat-msg" role="status">
          <p className="body">{t('app.empty')}</p>
          <p className="lbl muted">{t('app.empty.hint')}</p>
          <button className="btn btn-line btn-s" onClick={clear}><span>{t('app.clear')}</span></button>
        </div>
      ) : null}
      {rows ? <p className="lbl muted cat-n" aria-live="polite">{t('app.shown', { n: shown.length, m: rows.length })}</p> : null}
    </section>
  )
}

/** the service panel: slides in from the right, the page stays where it is (the landing's motion) */
function Sheet({ pid, onClose }: { pid: string | null; onClose: () => void }) {
  useLang()
  const box = useRef<HTMLDivElement>(null)
  const last = useRef<string | null>(null)
  if (pid) last.current = pid
  const id = last.current
  useEffect(() => {
    if (!pid) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    addEventListener('keydown', k)
    const h = setTimeout(() => box.current?.querySelector<HTMLElement>('[data-svc-h]')?.focus({ preventScroll: true }), 120)
    if (box.current) box.current.scrollTop = 0
    return () => { removeEventListener('keydown', k); clearTimeout(h) }
  }, [pid, onClose])
  return (
    <aside className={`sheet ${pid ? 'on' : ''}`} ref={box} role="dialog" aria-modal="true" aria-labelledby="sheet-h" aria-hidden={!pid} inert={!pid ? true : undefined} data-front-free>
      <div className="sheet-in">
        <div className="sheet-top">
          <button className="svc-x" onClick={onClose}>{t('d.back')}</button>
          <span className="lbl muted no-touch">{t('card.esc')}</span>
        </div>
        {id ? <Suspense fallback={<p className="d-name">{t('d.reading')}</p>}><ServiceDetail key={id} pid={id} inPanel headingId="sheet-h" /></Suspense> : null}
      </div>
    </aside>
  )
}

export function UsePage() {
  const lang = useLang()
  const rows = useCatalog()
  const main = useRef<HTMLElement>(null)
  useIn(main, 0.94)
  const [pid, setPid] = useState<string | null>(q0.get('p'))
  const back = useRef<HTMLElement | null>(null)
  // the URL follows the panel (?p=): browser Back closes it, a reload reopens it
  useEffect(() => {
    const pop = () => setPid(new URLSearchParams(location.search).get('p'))
    addEventListener('popstate', pop)
    return () => removeEventListener('popstate', pop)
  }, [])
  useEffect(() => { document.documentElement.classList.toggle('sheet-open', !!pid) }, [pid])
  const open = useMemo(() => (id: string, el: HTMLElement) => {
    back.current = el
    const u = new URL(location.href); u.searchParams.set('p', id)
    if (new URLSearchParams(location.search).get('p')) history.replaceState({ p: id }, '', u); else history.pushState({ p: id }, '', u)
    setPid(id)
  }, [])
  const close = useMemo(() => () => {
    if ((history.state as { p?: string } | null)?.p) history.back()
    else { const u = new URL(location.href); u.searchParams.delete('p'); history.replaceState(null, '', u); setPid(null) }
    const b = back.current ?? document.querySelector<HTMLElement>(`[data-pid="${new URLSearchParams(location.search).get('p') ?? ''}"]`)
    setTimeout(() => b?.focus({ preventScroll: true }), 60)
  }, [])
  // the tab title: the page, or the open service
  const name = pid ? rows?.find((r) => r.p.id === pid)?.name : undefined
  useEffect(() => { document.title = name ? `ArcHive. ${name}` : t('app.use.doc') }, [name, lang])
  return (
    <>
      <a className="skip" href="#catalog" data-front-free>{t('app.skip')}</a>
      <AppHeader page="use" section="app.sec.use" />
      <main className="app use" ref={main} inert={pid ? true : undefined}>
        <section className="app-top st-use">
          <div className="app-top-in">
            <AppTitle k="use.title" />
            <p className="lede">{t('app.use.lede')}</p>
            <Verdict rows={rows} />
          </div>
        </section>
        <Catalog rows={rows} onOpen={open} />
        <CallSec />
        <Paid />
      </main>
      <Footer />
      <Sheet pid={pid} onClose={close} />
    </>
  )
}

/** call a pay-per-call service (x402) in place, signed by the visitor's wallet (actions/acts.tsx) */
const act0 = new URLSearchParams(location.search).get('act')
if (act0 && /^\d+$/.test(act0)) setUi({ pid: act0 })
function CallSec() {
  useLang()
  useLive((s) => s.status) // the enclave relay is known after the first API reading
  const p = useProbe(abs(ENCLAVE.x402))
  return (
    <ActSec id="act" title={x('u.act')} lede={x('u.act.lede')}>
      <ServiceState p={p} name={x('u.enc')} url={abs(ENCLAVE.x402)} />
      <Suspense fallback={null}><UseActs label={x('u.act')} onPick={() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} /></Suspense>
    </ActSec>
  )
}

/** what the market has already paid in USDC, counted by the API from contract events */
function Paid() {
  const lang = useLang()
  const stats = useLive((s) => s.stats)
  const f = (v?: string | number | null) => (v === undefined || v === null ? t('state.unread') : String(v))
  return (
    <section className="paid" aria-labelledby="paid-h">
      <h2 className="paid-h" id="paid-h">{t('end.figs')}</h2>
      <dl className="figs paid-figs">
        <div className="cote-in"><dt className="lbl"><span className="cote-l" aria-hidden="true" />{t('end.paid')}</dt><dd className="mono tnum"><span className="cote-v">{f(stats ? usdc(stats.settledUsdc, lang) : null)}</span></dd></div>
        <div className="cote-in"><dt className="lbl"><span className="cote-l" aria-hidden="true" />{t('end.calls')}</dt><dd className="mono tnum"><span className="cote-v">{f(stats ? num(stats.x402Calls, lang) : null)}</span></dd></div>
        <div className="cote-in"><dt className="lbl"><span className="cote-l" aria-hidden="true" />{t('end.sessions')}</dt><dd className="mono tnum"><span className="cote-v">{f(stats ? num(stats.sessions, lang) : null)}</span></dd></div>
        <div className="cote-in"><dt className="lbl"><span className="cote-l" aria-hidden="true" />{t('band.active')}</dt><dd className="mono tnum"><span className="cote-v">{f(stats ? `${stats.enclavesActive} / ${stats.enclaves}` : null)}</span></dd></div>
      </dl>
    </section>
  )
}
