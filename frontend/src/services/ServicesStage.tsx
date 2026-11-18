// The Services page (service.html), after JB's product presentation (produits/product2.html): every product is a
// module of one server (a Blender still, public/tex/chassis.webp, its module faces given by chassis-bays.json), and
// picking a module opens its sheet in the left column, which scrolls by itself, as on Network. The page does not jump
// to an anchor: ?p=<id> follows the open product (replaceState), so a link from the landing wall, the Use catalog or
// the copilot opens the same sheet. Copy from JB, state read live (app/catalog.ts).
import { useEffect, useMemo, useRef, useState } from 'react'
import { t, useLang, type TKey } from '../i18n'
import { ArcIgnite, plainAcc } from '../ui/ArcGlow'
import { useCatalog } from '../app/useCatalog'
import { ServiceDetail, stateLine, ledClass } from '../app/ServiceDetail'
import { useLive } from '../data/live'
import { link, networkFor, useHref, serviceHref } from '../links'
import type { SvcRow } from '../app/catalog'
import { COPY, GLYPH, SLOT_GLYPH, CAT, type Cat, type PCopy } from './products'
import './services.css'

type Rect = { x: number; y: number; w: number; h: number }
type Bays = { bays: { face?: Rect; recess?: Rect; led?: Rect; empty?: boolean }[] }
const SLOT = 'slot'
const WORDS: Record<'en' | 'fr', string[]> = {
  en: ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'],
  fr: ['Aucun', 'Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf', 'Dix', 'Onze', 'Douze'],
}

/** the module faces of the chassis render; until it is read (or without it), the tiles take a plain grid */
function useBays() {
  const [b, setB] = useState<Bays | null>(null)
  useEffect(() => {
    let on = true
    fetch('/tex/chassis-bays.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (on && j?.bays?.length) setB(j) }).catch(() => {})
    return () => { on = false }
  }, [])
  return b
}

const copyOf = (lang: string, id: string): PCopy | undefined => COPY[lang === 'fr' ? 'fr' : 'en'][id]
const isOff = (r: SvcRow) => r.role?.role === 'superseded' || r.p.state === 'Retired'
const wordOf = (r: SvcRow) => (r.role?.role === 'superseded' ? t('sv.w.replaced') : r.role?.role === 'refuteDemo' ? (document.documentElement.lang === 'fr' ? 'Démo' : 'Demo') : t(`sv.w.${r.led}` as TKey))

function Glyph({ id }: { id: string }) {
  const g = id === SLOT ? SLOT_GLYPH : GLYPH[id]
  return g ? <span className="sv-gw" aria-hidden="true" dangerouslySetInnerHTML={{ __html: g }} /> : <span className="sv-gw" aria-hidden="true" />
}

/** one module face: the glyph, the number and state, the name, the line, the chips */
function Face({ r, c, big = false }: { r: SvcRow; c?: PCopy; big?: boolean }) {
  return (
    <span className={`sv-face ${big ? 'is-big' : ''}`}>
      <Glyph id={r.p.id} />
      <span className="sv-side"><span className="sv-u mono">#{r.p.id}</span><span className="sv-st mono">{wordOf(r)}</span></span>
      <span className="sv-id">
        <span className="sv-name">{c?.name ?? r.name}</span>
        <span className="sv-line">{c?.line ?? t(`sv.k.${r.svc}` as TKey)}</span>
      </span>
      <span className="sv-chips">
        {c?.price ? <span className="sv-chip mono">{c.price}</span> : null}
        {c?.who ? <span className="sv-chip sv-who"><span className="sr-only">{t('svs.for')} </span>{c.who}</span> : null}
      </span>
    </span>
  )
}

/** the page title, the site's lettering (the rule draws, the title rises, the {…} part ignites) */
function TitleIn({ text }: { text: string }) {
  const [on, setOn] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true))); return () => cancelAnimationFrame(id) }, [])
  return (
    <h1 className={`h2 ttl svs-t ${on ? 'in' : ''}`} aria-label={plainAcc(text)}>
      <span className="ttl-m" aria-hidden="true"><span className="ttl-t"><ArcIgnite text={text} /></span></span>
      <span className="ttl-rule" aria-hidden="true" />
    </h1>
  )
}

/** the left column, by default: what ArcHive sells, the live count, the filters, who pays whom, why trust it */
function Intro({ rows, cat, setCat }: { rows: SvcRow[] | undefined; cat: Cat | 'all'; setCat: (c: Cat | 'all') => void }) {
  const lang = useLang()
  const status = useLive((s) => s.status)
  const n = rows?.filter((r) => !isOff(r)).reduce((a, r) => a + r.running, 0) ?? 0
  const count = rows?.length ?? 7
  return (
    <div className="svs-intro">
      <p className="lbl muted">{t('svs.k')}</p>
      <TitleIn text={t('svs.h', { w: WORDS[lang === 'fr' ? 'fr' : 'en'][count] ?? String(count) })} />
      <p className="body svs-lede">{t('svs.lede')}</p>
      <p className="svs-live">{rows ? <><span className={n ? 'led led-green' : 'led led-amber'} aria-hidden="true" />{n === 0 ? t('svs.run0') : n === 1 ? t('svs.run1') : t('svs.runN', { n })}</> : status === 'error' ? t('d.down') : t('d.reading')}</p>
      <div className="svs-f" role="group" aria-label={t('svs.f')}>
        {(['all', 'apps', 'agents', 'defi'] as const).map((k) => (
          <button key={k} type="button" className="svs-fb" aria-pressed={cat === k} onClick={() => setCat(k)}>{t(`svs.f.${k}` as TKey)}</button>
        ))}
      </div>
      <p className="pick-hint svs-pick"><span className="pick-ic" aria-hidden="true"><span className="pick-ring" /><svg viewBox="0 0 16 16"><path d="M3 1.5v11.2l3-2.8 2 4.6 2-.9-2-4.5h4.2z" /></svg></span>{t('svs.pick')}</p>

      <section className="svs-sec" aria-labelledby="svs-pays">
        <h2 className="svs-h" id="svs-pays">{t('svs.pays')}</h2>
        <div className="svs-pay">
          <p className="svs-pay-t">{t('svs.pays.use')}</p>
          <div className="svs-bar" aria-hidden="true"><i className="b-op" style={{ flexGrow: 65 }} /><i className="b-au" style={{ flexGrow: 30 }} /><i className="b-net" style={{ flexGrow: 5 }} /></div>
          <dl className="svs-pay-l"><div><dt><i className="b-op" />{t('svs.op')}</dt><dd className="mono">95%</dd></div><div><dt><i className="b-net" />{t('svs.net')}</dt><dd className="mono">5%</dd></div><div><dt><i className="b-au" />{t('svs.au')}</dt><dd className="mono">{t('svs.upto', { p: '30%' })}</dd></div></dl>
        </div>
        <div className="svs-pay">
          <p className="svs-pay-t">{t('svs.pays.pool')}</p>
          <div className="svs-bar" aria-hidden="true"><i className="b-op" style={{ flexGrow: 85 }} /><i className="b-net" style={{ flexGrow: 10 }} /><i className="b-au" style={{ flexGrow: 5 }} /></div>
          <dl className="svs-pay-l"><div><dt><i className="b-op" />{t('svs.hunter')}</dt><dd className="mono">{t('svs.tier')}</dd></div><div><dt><i className="b-net" />{t('svs.net')}</dt><dd className="mono">+10%</dd></div><div><dt><i className="b-au" />{t('svs.ops')}</dt><dd className="mono">+5%</dd></div></dl>
        </div>
      </section>
      <section className="svs-sec" aria-labelledby="svs-trust">
        <h2 className="svs-h" id="svs-trust">{t('svs.trust')}</h2>
        <p className="body">{t('svs.trust.t')}</p>
        <a className="tlink" href="/doc.html?c=admission">{t('svs.trust.l')}</a>
      </section>
    </div>
  )
}

/** a product's secondary action from JB's page, mapped to this site */
function Cta({ c }: { c: PCopy }) {
  if (!c.cta) return null
  const [k, label] = c.cta
  if (k === 'copilot') return <button type="button" className="btn btn-line btn-s" onClick={() => document.querySelector<HTMLButtonElement>('.cp-launch')?.click()}><span>{label}</span></button>
  const href = k === 'demo' ? link.demo : k === 'bounty' ? link.bounty : k === 'hive' ? link.hive : k === 'p7' ? serviceHref('7') : null
  if (!href) return null
  const ext = k === 'hive'
  return <a className="btn btn-line btn-s" href={href} {...(ext ? { target: '_blank', rel: 'noreferrer' } : {})}><span>{k === 'demo' ? t('svs.cta.demo') : k === 'p7' ? t('svs.cta.p7') : label}</span></a>
}

/** the open product, in the left column */
function Sheet({ r, i, n, go, close }: { r: SvcRow; i: number; n: number; go: (d: number) => void; close: () => void }) {
  const lang = useLang()
  const c = copyOf(lang, r.p.id)
  // the copilot note ("paused, the site copilot answers meanwhile") holds only while no enclave runs it
  const note = c?.note && !(r.p.id === '4' && r.running > 0) ? c.note : ''
  const off = isOff(r)
  return (
    <div className="svs-sheet" data-led={r.led}>
      <div className="svs-top">
        <button type="button" className="svc-x" onClick={close}>{`← ${t('svs.close')}`}</button>
        <span className="lbl muted no-touch">Esc</span>
        <span className="svs-step">
          <button type="button" className="svs-nb" aria-label={t('svs.prev')} onClick={() => go(-1)}>‹</button>
          <span className="mono">{t('svs.of', { a: i + 1, b: n })}</span>
          <button type="button" className="svs-nb" aria-label={t('svs.next')} onClick={() => go(1)}>›</button>
        </span>
      </div>
      <h1 className="sr-only">{c?.name ?? r.name}</h1>
      <div className="svs-card" data-led={r.led}><span className="sv-ledw" aria-hidden="true"><span className={ledClass(r.led)} /></span><Face r={r} c={c} big /></div>
      <p className="svs-state" aria-live="polite"><span className={ledClass(r.led)} aria-hidden="true" /><span className="svs-st-t">{stateLine(r)}</span>{note ? <span className="svs-note">{note}</span> : null}</p>
      {c?.pts.length ? <ul className="svs-pts">{c.pts.map((p) => <li key={p}>{p}</li>)}</ul> : <p className="body">{t(`sv.k.${r.svc}` as TKey)}</p>}
      {c?.proof ? (
        <p className="svs-proof">
          <a className="tlink" href={c.proof[0]} target="_blank" rel="noreferrer">{c.proof[1]}</a>
          <span className="mono svs-hash">{`${c.proof[0].split('/').pop()!.slice(0, 8)}…${c.proof[0].slice(-4)}`}</span>
        </p>
      ) : null}
      <div className="svs-acts">
        {off ? null : <a className="btn btn-main btn-s" href={useHref(r.p.id)}><span>{t('d.use.btn')}</span></a>}
        {c ? <Cta c={c} /> : null}
      </div>
      <a className="tlink svs-doc" href="/doc.html?c=admission">{t('svs.doc')}</a>
      <section className="svs-livesec" aria-label={t('svs.live')}>
        <h2 className="svs-h">{t('svs.live')}</h2>
        <ServiceDetail pid={r.p.id} bare />
      </section>
    </div>
  )
}

function SlotSheet({ close }: { close: () => void }) {
  useLang()
  return (
    <div className="svs-sheet">
      <div className="svs-top"><button type="button" className="svc-x" onClick={close}>{`← ${t('svs.close')}`}</button><span className="lbl muted no-touch">Esc</span></div>
      <div className="svs-card is-slot"><span className="sv-face is-big"><Glyph id={SLOT} /><span className="sv-id"><span className="sv-name">{t('svs.slot')}</span><span className="sv-line">{t('svs.slot.l')}</span></span></span></div>
      <p className="body svs-slot-d">{t('svs.slot.d')}</p>
      <div className="svs-acts">
        <a className="btn btn-main btn-s" href={networkFor('publish')}><span>{t('svs.slot.pub')}</span></a>
        <a className="btn btn-line btn-s" href={networkFor('rent')}><span>{t('svs.slot.rent')}</span></a>
      </div>
    </div>
  )
}

export function ServicesStage({ pid0 }: { pid0: string | null }) {
  const lang = useLang()
  const rows = useCatalog()
  const bays = useBays()
  const [sel, setSel] = useState<string | null>(pid0)
  const [cat, setCat] = useState<Cat | 'all'>('all')
  const col = useRef<HTMLDivElement>(null)
  // the modules in product order (JB's: #1 to #7), then the open slot
  const order = useMemo(() => [...(rows ?? [])].sort((a, b) => Number(a.p.id) - Number(b.p.id)), [rows])
  const ids = useMemo(() => [...order.map((r) => r.p.id), SLOT], [order])
  const cur = sel && sel !== SLOT ? order.find((r) => r.p.id === sel) : undefined

  const open = (id: string | null) => {
    setSel(id)
    const u = new URL(location.href)
    if (id && id !== SLOT) u.searchParams.set('p', id); else u.searchParams.delete('p')
    history.replaceState(history.state, '', u)
    col.current?.scrollTo({ top: 0 })
    // stacked layout: bring the sheet into view under the server
    if (id && matchMedia('(max-width: 1024px)').matches) requestAnimationFrame(() => col.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const go = (d: number) => { const k = ids.indexOf(sel ?? ''); open(ids[(k + d + ids.length) % ids.length]) }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!sel) return
      if (e.key === 'Escape') { e.preventDefault(); open(null) }
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !(e.target instanceof HTMLInputElement)) go(e.key === 'ArrowRight' ? 1 : -1)
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  })
  useEffect(() => { document.title = cur ? `ArcHive. ${copyOf(lang, cur.p.id)?.name ?? cur.name}` : `ArcHive. ${t('svs.k')}` }, [cur, lang])

  const dim = (id: string) => cat !== 'all' && (id === SLOT || CAT[id] !== cat)
  const tile = (id: string, k: number) => {
    const r = id === SLOT ? undefined : order.find((x) => x.p.id === id)
    const bb = bays?.bays[k]
    const f = bb?.face ?? bb?.recess
    const bay = f ? { face: f, led: bb?.led } : undefined
    const style = bay ? { left: `${bay.face.x * 100}%`, top: `${bay.face.y * 100}%`, width: `${bay.face.w * 100}%`, height: `${bay.face.h * 100}%` } : undefined
    const led = bay?.led ? { left: `${((bay.led.x - bay.face.x) / bay.face.w) * 100}%`, top: `${((bay.led.y - bay.face.y) / bay.face.h) * 100}%`, width: `${(bay.led.w / bay.face.w) * 100}%`, height: `${(bay.led.h / bay.face.h) * 100}%` } : undefined
    const c = r ? copyOf(lang, id) : undefined
    return (
      <li key={id} className="svs-bay" style={style} data-on={sel === id ? '1' : '0'} data-dim={dim(id) ? '1' : '0'} data-led={r ? (isOff(r) ? 'off' : r.led) : 'slot'}>
        <button type="button" className="svs-mod" aria-pressed={sel === id} onClick={() => open(sel === id ? null : id)} aria-label={r ? `${c?.name ?? r.name}, #${id}, ${wordOf(r)}` : t('svs.slot')}>
          {r ? <><span className="sv-led" style={led} aria-hidden="true" /><Face r={r} c={c} /></> : <span className="sv-face is-slot"><Glyph id={SLOT} /><span className="sv-id"><span className="sv-name">{t('svs.slot')}</span><span className="sv-line">{t('svs.slot.l')}</span></span></span>}
        </button>
      </li>
    )
  }

  return (
    <div className="svs" data-open={sel ? '1' : '0'}>
      <div className="svs-col" ref={col}>
        <div className="txt svs-txt">
          {sel === SLOT ? <SlotSheet close={() => open(null)} />
            : cur ? <Sheet r={cur} i={ids.indexOf(cur.p.id)} n={ids.length - 1} go={go} close={() => open(null)} />
              : sel && rows ? <div className="svs-sheet"><p className="body">{t('d.none')}</p><button type="button" className="svc-x" onClick={() => open(null)}>{`← ${t('svs.close')}`}</button></div>
                : <Intro rows={rows} cat={cat} setCat={setCat} />}
        </div>
      </div>
      <div className="svs-srv" aria-label={t('svs.k')}>
        <div className={`svs-chassis ${bays ? 'has-img' : 'no-img'}`}>
          {bays ? <img className="svs-img" src="/tex/chassis.webp" srcSet="/tex/chassis-s.webp 860w, /tex/chassis.webp 1720w" sizes="(max-width: 1024px) 100vw, 56vw" alt="" draggable={false} /> : null}
          <ol className="svs-bays">{[...order.slice(0, 7).map((r) => r.p.id), SLOT].map((id, k) => tile(id, k))}</ol>
        </div>
      </div>
    </div>
  )
}
