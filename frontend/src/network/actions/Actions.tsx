// The usage page: in the column, the visitor's wallet, then, when a part is focused, its steps turned into actions.
// Each step is a state of the flow (to do, in progress, done, failed), with its transaction and its explorer link;
// the step being opened or run highlights its element in the diagram (window.__s3d).
// The pieces are shared with the app pages (kit.tsx, acts.tsx, HeaderWallet.tsx).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLang, t, type TKey } from '../../i18n'
import '../../ui/blades.css'
import { short, usdc, pct, num } from '../../data/fmt'
import { useCatalog } from '../../app/useCatalog'
import { RAIL_NAME, type SvcRow } from '../../app/catalog'
import { parts, type Part } from '../data'
import { useUi, setUi, getUi } from './store'
import { w } from './strings'
import { play, exitFocus } from './kit'
import { UseActs, RentActs, PublishActs, Cctp } from './acts'

export { HeaderWallet } from './HeaderWallet'
export { exitFocus } from './kit'

/** The part open in the column (scene.ts writes it to #col[data-col]). */
function useView(): 'ensemble' | Part {
  const [v, setV] = useState<'ensemble' | Part>(() => (document.querySelector('#col')?.getAttribute('data-col') as Part) ?? 'ensemble')
  useEffect(() => {
    const col = document.querySelector('#col'); if (!col) return
    const mo = new MutationObserver(() => setV((col.getAttribute('data-col') as Part) ?? 'ensemble'))
    mo.observe(col, { attributes: true, attributeFilter: ['data-col'] })
    return () => mo.disconnect()
  }, [])
  return v
}


// ---------- the catalog, on the right in place of the scene, while a service is chosen (Use) ----------
const ledCls = (l: string) => (l === 'off' ? 'led' : `led led-${l}`)
export function ServiceCatalog() {
  const lang = useLang()
  const { catOpen, pid } = useUi()
  const rows = useCatalog()
  const [q, setQ] = useState('')
  const list = useMemo(() => (rows ?? []).filter((r) => r.p.state !== 'Retired'), [rows])
  // search: name, number, kind and state words, ignoring case and accents
  const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const shown = useMemo(() => {
    const k = fold(q.trim()); if (!k) return list
    return list.filter((r) => fold(`${r.name} #${r.p.id} ${r.p.id} ${r.svc} ${t(`sv.w.${r.led}` as TKey)}`).includes(k))
  }, [list, q, lang])
  const sel = list.find((r) => r.p.id === pid)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    document.querySelector('#net')?.setAttribute('data-cat', catOpen ? '1' : '0')
    if (catOpen) { const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('.net-cat-q input')?.focus({ preventScroll: true }), 280); return () => clearTimeout(t) }
  }, [catOpen])
  const close = () => { setUi({ catOpen: false }); document.getElementById('u-pick')?.focus() }
  // picking keeps the catalog open: the service is described at the top, the steps on the left move on
  const choose = (id: string) => { setUi({ pid: id }); play('use', 2, 'todo', 'link.useArc', false); ref.current?.querySelector('.net-cat-sc')?.scrollTo({ top: 0, behavior: 'smooth' }) }
  return (
    <div className="net-cat" id="net-cat" ref={ref} data-on={catOpen ? '1' : '0'} inert={!catOpen ? true : undefined} aria-hidden={!catOpen} role="region" aria-labelledby="net-cat-h">
      <div className="net-cat-in">
        <div className="net-cat-top">
          <h2 className="net-cat-h" id="net-cat-h">{w('u.catTitle')}</h2>
          <button type="button" className="net-x" onClick={close} aria-label={w('u.catClose')} title={w('u.catClose')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3 L13 13 M13 3 L3 13" /></svg></button>
        </div>
        <label className="net-cat-q">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" /><path d="M10.4 10.4 L14 14" /></svg>
          <span className="sr-only">{w('u.search')}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={w('u.searchPh')} spellCheck={false} autoComplete="off" />
          {q ? <span className="net-cat-n lbl mono tnum">{`${shown.length} / ${list.length}`}</span> : null}
        </label>
        <div className="net-cat-sc">
          {sel ? <SvcSheet r={sel} /> : <p className="lbl muted net-cat-l">{w('u.catLede')}</p>}
          {/* the catalog as sleds, the same faces as the landing wall: one click picks the service */}
          <ol className="bay sled-bay" aria-label={w('u.catTitle')}>
            {shown.map((r) => (
              <li key={r.p.id} className="blade" data-led={r.role?.role === 'superseded' ? 'off' : r.led} data-long={r.name.length > 14 ? '1' : '0'}>
                <button type="button" className="blade-face" onClick={() => choose(r.p.id)} aria-pressed={r.p.id === pid} aria-label={w('u.chooseAria', { name: `${r.name}, #${r.p.id}` })} data-pid={r.p.id}>
                  <span className="bl-led" aria-hidden="true"><i /></span>
                  <span className="bl-title">{r.name}</span>
                  <span className="bl-word">{r.running ? w('u.runningNow', { n: r.running }) : r.led === 'red' ? w('u.retiredW') : w('u.waitingW')}</span>
                  <span className="bl-u">{`#${r.p.id} · ${Number(r.p.price) ? usdc(r.p.price, lang) : w('u.free')}`}</span>
                </button>
              </li>
            ))}
          </ol>
          {!shown.length ? <p className="lbl muted net-cat-l">{t('sv.empty')}</p> : null}
        </div>
      </div>
    </div>
  )
}

/** The chosen service, described: what it does, its state, price, author, revenue split, enclaves and last payment
 *  (the content of the former landing panel, read live) */
function SvcSheet({ r }: { r: SvcRow }) {
  const lang = useLang()
  const word = r.role?.role === 'superseded' ? t('sv.w.replaced') : t(`sv.w.${r.led}` as TKey)
  const rows: [string, React.ReactNode][] = [
    [t('sv.f.state'), word],
    [t('sv.f.price'), Number(r.p.price) ? usdc(r.p.price, lang) : w('u.free')],
    [t('l1.author'), short(r.p.author, 4)],
    [t('sv.f.run'), `${r.running} / ${r.encs.length}`],
    [t('rent.share'), pct(r.p.bpsOperator, lang)],
    [t('split.author'), pct(r.p.bpsAuthor, lang)],
    [t('publish.network'), pct(r.p.bpsNetwork, lang)],
    [t('sv.f.paid'), r.lastPay ? t('sv.f.paidV', { a: usdc(r.lastPay.amount, lang) ?? '', b: num(r.lastPay.a.block, lang) ?? '' }) : t('sv.f.none')],
  ]
  return (
    <section className="net-cat-sheet blade" data-led={r.role?.role === 'superseded' ? 'off' : r.led} aria-live="polite">
      <p className="lbl muted mono">{`${t('svc.page')} #${r.p.id}`}</p>
      <h3 className="net-cat-sheet-t">{r.name}</h3>
      <p className="net-cat-sheet-d">{t(`sv.k.${r.svc}` as TKey)}</p>
      <dl className="net-cat-dl">{rows.map(([k, v]) => <div key={k}><dt className="lbl">{k}</dt><dd className="mono tnum">{v}</dd></div>)}</dl>
    </section>
  )
}

/** The panel's close button: back to the overview (the scene's overview()). */
export function CloseFocus() {
  useLang()
  return <button type="button" className="net-x net-x-panel" onClick={exitFocus} aria-label={w('x.close')} title={w('x.close')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3 L13 13 M13 3 L3 13" /></svg></button>
}

/** The actions of the open part, below the panel title. */
export function Actions() {
  useLang()
  const v = useView()
  // the catalog closes when the visitor leaves the Use part (not while the page is still arriving on it)
  const wasUse = useRef(false)
  // arriving on Use opens the catalog (browse and pick at once)
  useEffect(() => { if (v === 'use') { wasUse.current = true; if (!getUi().catOpen) setUi({ catOpen: true }) } else if (wasUse.current && getUi().catOpen) setUi({ catOpen: false }) }, [v])
  // Escape: closes the catalog if open, otherwise leaves the focus
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.hd-w-pop')) return
      // capture phase and stopped: scene.ts also listens to Escape (back to the overview), the catalog comes first
      if (getUi().catOpen) { e.stopPropagation(); setUi({ catOpen: false }); document.getElementById('u-pick')?.focus(); return }
      if (v !== 'ensemble') { exitFocus(); document.querySelector<HTMLElement>('#choices .net-part')?.focus() }
    }
    addEventListener('keydown', k, true)
    return () => removeEventListener('keydown', k, true)
  }, [v])
  if (v === 'ensemble') return null
  // CCTP focus: the real balances read on the other chains
  if ((v as string) === 'arc' || (v as string) === 'demo') return null // Arc and demo focus have no actions
  if ((v as string) === 'cctp') return <div className="net-acts" data-part="cctp"><Cctp /></div>
  return <div className="net-acts" data-part={v}>{v === 'use' ? <UseActs label={parts().use.title} /> : v === 'rent' ? <RentActs label={parts().rent.title} /> : <PublishActs label={parts().publish.title} />}</div>
}
