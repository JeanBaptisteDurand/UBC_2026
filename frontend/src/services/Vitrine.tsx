// The Services page (service.html), after JB's product presentation (produits/product1.html): what ArcHive sells, in
// five families, next to the landing's room with one rack alone in the aisle (RoomStage.tsx: a Cycles still, its sleds
// lit live, one per product read on Arc, the rest open slots). Nothing scrolls the page to an anchor: a sled, a shop-window row or an index entry opens its chapter
// in the left column, which scrolls by itself (as on Network and the Doc page). ?c=<chapter> follows the open chapter
// (replaceState); ?p=<product> from the landing wall, the Use catalog or the copilot opens that product's family.
// Copy and chapters from JB (vit-content.ts, generated), numbers read live on Arc.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { t, useLang } from '../i18n'
import { useLive } from '../data/live'
import { useCatalog } from '../app/useCatalog'
import { ServiceDetail } from '../app/ServiceDetail'
import { API_DIRECT } from '../data/endpoints'
import { num, usdc, pct } from '../data/fmt'
import { link, networkFor } from '../links'
import { VIT, type VitChapter } from './vit-content'
import { RoomStage, type Plate } from './RoomStage'
// the action of a sheet: the signed flows (wallet engine, SDK) load with the sheet, not with the page
const UseBlock = lazy(() => import('./UseBlock'))
import './vit-jb.css'
import './vitrine.css'

const SLOT = 'slot'
const FAM = ['bounty', 'private-ai', 'attested-copilot', 'refutation', 'retired'] as const
/** the products of each family, in JB's order */
const PIDS: Record<string, string[]> = { bounty: ['2', '7'], 'private-ai': ['1', '3'], 'attested-copilot': ['4'], refutation: ['5'], retired: ['6'] }
/** a product (landing wall, catalog, copilot links: ?p=<id>) opens its family */
const FAM_OF: Record<string, string> = Object.fromEntries(Object.entries(PIDS).flatMap(([f, ps]) => ps.map((p) => [p, f])))
const IDS = VIT.en.chapters.map((c) => c.id)
/** brings a section of the sheet to the top of the reading column (the column scrolls, never the page) */
function toTop(el: HTMLElement | null) {
  const r = el?.closest<HTMLElement>('.vt-r'); if (!el || !r) return
  r.scrollTop += el.getBoundingClientRect().top - r.getBoundingClientRect().top - 16
}
/** ?act=1: the sheet opens on its action */
const ACT0 = new URLSearchParams(location.search).get('act') === '1'

function initial(): string | null {
  const q = new URLSearchParams(location.search)
  const c = q.get('c')
  if (c && (IDS.includes(c) || c === SLOT || /^p-\d+$/.test(c))) return c
  const p = q.get('p')
  return p ? (FAM_OF[p] ?? `p-${p}`) : null
}


/** links the converter left as tokens: the console, the 3D room, the read API */
const fixHtml = (h: string) => h.replaceAll('href="@hive"', `href="${link.hive}" target="_blank" rel="noreferrer"`).replaceAll('href="@dev"', `href="${link.dev}" target="_blank" rel="noreferrer"`)
  .replaceAll('href="@dc"', `href="${link.datacenter}" target="_blank" rel="noreferrer"`).replace(/href="@api\//g, `href="${API_DIRECT}/`)

/** the live state of a family: running if any of its products has an enclave running; JB's word and lamp otherwise
 *  (his "Paused" holds while nothing runs). The refutation and the retired product keep their own words. */
function useFamState() {
  const rows = useCatalog()
  return useCallback((id: string, lamp: string, word: string) => {
    if (id === 'refutation' || id === 'retired' || !rows) return { lamp, word }
    const n = rows.filter((r) => PIDS[id]?.includes(r.p.id)).reduce((a, r) => a + r.running, 0)
    return n > 0 ? { lamp: 'green', word: t('vit.w.on') } : { lamp, word }
  }, [rows])
}

function Title({ text, acc }: { text: string; acc: string }) {
  const k = acc ? text.indexOf(acc) : -1
  return (
    <h1 className="vt-h vt-h1" tabIndex={-1} data-vt-h>
      {k < 0 ? text : <>{text.slice(0, k)}<span className="vt-acc">{acc}</span>{text.slice(k + acc.length)}</>}
      <span className="ttl-rule" aria-hidden="true" />
    </h1>
  )
}

function Intro({ open }: { open: (id: string) => void }) {
  const lang = useLang()
  const L = VIT[lang === 'fr' ? 'fr' : 'en']
  const stats = useLive((s) => s.stats)
  const status = useLive((s) => s.status)
  const fam = useFamState()
  const idle = stats ? stats.enclavesActive === 0 : null
  const go = (id: string) => (e: MouseEvent) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); open(id) }
  const figs: [string, string | null, string][] = stats ? [
    [t('vit.fig.p'), num(stats.products, lang), t('vit.fig.p.s')],
    [t('vit.fig.e'), num(stats.enclaves, lang), t('vit.fig.e.s', { a: num(stats.enclavesActive, lang) ?? '0' })],
    [t('vit.fig.u'), usdc(stats.settledUsdc, lang), t('vit.fig.u.s', { b: usdc(stats.bountyPaidUsdc, lang) ?? '' })],
    [t('vit.fig.v'), num(stats.verdicts, lang), t('vit.fig.v.s')],
  ] : []
  const more = L.chapters.filter((c) => !(FAM as readonly string[]).includes(c.id))
  return (
    <section className="vt-intro" aria-labelledby="vt-h1">
      <Title text={L.hero.title} acc={L.hero.acc} />
      <p className="vt-lede">{L.hero.lede}</p>
      <nav className="rk-in vt-shop" aria-label={t('vit.list')}>
        <p className="rk-k"><span className="rk-k1">{L.shop.k1}</span><span className="rk-k2 mono">{L.shop.k2}</span></p>
        <ol className="rk-list">
          {L.rows.map((r) => {
            const s = fam(r.id, r.lamp, r.word)
            return (
              <li key={r.id}>
                <a className="rk-row" href={`?c=${r.id}`} data-lamp={s.lamp} onClick={go(r.id)}>
                  <span className={`led${s.lamp === 'off' ? '' : ` led-${s.lamp}`}`} aria-hidden="true" />
                  <span className="rk-name">{r.name}</span><span className="rk-word">{s.word}</span>
                  <span className="rk-price mono">{r.price}</span><span className="rk-line">{r.line}</span>
                </a>
              </li>
            )
          })}
        </ol>
        {idle === null ? null : <p className="rk-note">{idle ? L.shop.note : t('vit.run', { a: stats!.enclavesActive, n: stats!.enclaves })}</p>}
      </nav>
      <section className="vit-live vt-live" aria-label={t('vit.src')}>
        {stats ? (
          <dl className="vit-figs">
            {figs.map(([k, v, s]) => (
              <div className="cote-in" key={k}><dt className="lbl"><span className="cote-l" aria-hidden="true" />{k}</dt><dd><span className="mono tnum vit-fig-v cote-v">{v ?? '—'}</span><span className="lbl vit-fig-s">{s}</span></dd></div>
            ))}
          </dl>
        ) : <p className="lbl muted">{status === 'error' ? t('vit.down') : t('vit.reading')}</p>}
        <div className="vit-live-f">
          <p className="lbl vit-src"><span className={`vit-dot${stats ? ' is-live' : ''}`} aria-hidden="true" />{t('vit.src')}</p>
          {idle ? <p className="vit-state"><span className="led led-amber" aria-hidden="true" /><span>{L.state.text} <a className="tlink vit-state-a" href={link.demo}>{L.state.link}</a></span></p> : null}
        </div>
      </section>
      <nav className="vt-more" aria-labelledby="vt-more-h">
        <p className="lbl vt-more-h" id="vt-more-h">{t('vit.more')}</p>
        <ol>
          {more.map((c) => (
            <li key={c.id}><a href={`?c=${c.id}`} onClick={go(c.id)}><span className="vt-more-t">{c.t}</span>{c.plain.replace(/\.$/, '') !== c.t ? <span className="vt-more-p">{c.plain}</span> : null}</a></li>
          ))}
        </ol>
      </nav>
    </section>
  )
}

/** numbers JB's page read live, filled from /api/stats and /api/products */
function useLiveFill(root: React.RefObject<HTMLDivElement | null>, key: string) {
  const lang = useLang()
  const stats = useLive((s) => s.stats)
  const products = useLive((s) => s.products)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const set = (k: string, v: string | null) => el.querySelectorAll<HTMLElement>(`[data-live-v="${k}"]`).forEach((e) => { e.textContent = v ?? '—' })
    if (stats) {
      set('settled', usdc(stats.settledUsdc, lang)); set('bounty', usdc(stats.bountyPaidUsdc, lang))
      set('x402', num(stats.x402Calls, lang)); set('sessions', num(stats.sessions, lang)); set('verdicts', num(stats.verdicts, lang))
    }
    // the shares, when every product on Arc carries the same split (otherwise each product's sheet says its own)
    const sh = el.querySelectorAll<HTMLElement>('[data-live-v="shares"]')
    const p = products?.filter((x) => x.state !== 'Retired') ?? []
    const same = p.length > 0 && p.every((x) => x.bpsOperator === p[0].bpsOperator && x.bpsAuthor === p[0].bpsAuthor && x.bpsNetwork === p[0].bpsNetwork)
    // the three sides' tags: the price of #3, the operator's and the author's share
    const p3 = products?.find((x) => x.id === '3')
    el.querySelectorAll<HTMLElement>('[data-live-v="p3price"]').forEach((e) => { const v = p3 ? usdc(p3.price, lang) : null; if (v) e.textContent = e.textContent!.replace(/^[\d.,\s]+USDC/, v) })
    el.querySelectorAll<HTMLElement>('[data-live-v="op"], [data-live-v="au"]').forEach((e) => { const tag = e.closest<HTMLElement>('.mk-side-tag'); if (tag) tag.hidden = !same; if (same) e.textContent = pct(e.dataset.liveV === 'op' ? p[0].bpsOperator : p[0].bpsAuthor, lang) })
    sh.forEach((e) => { e.hidden = !same; if (same) e.textContent = t('vit.shares', { o: pct(p[0].bpsOperator, lang), a: pct(p[0].bpsAuthor, lang), n: pct(p[0].bpsNetwork, lang), k: products!.length }) })
  }, [root, key, lang, stats, products])
}

/** a family's sheet cut in three: what it is (JB's header, who it is for, price, live state), its action, then the rest
 *  of JB's section and the live blocks of its products, folded under "Technical details" */
function splitFam(html: string, id: string) {
  const tpl = document.createElement('template'); tpl.innerHTML = html
  const hd = tpl.content.querySelector('.vit-fam-hd'); hd?.remove()
  // the recorded event is the "use" of the two families nothing can be bought from
  const pr = id === 'refutation' ? tpl.content.querySelector('.vit-refute') : id === 'retired' ? tpl.content.querySelector('.vit-proofs') : null
  pr?.remove()
  return { head: hd?.outerHTML ?? '', proof: pr?.outerHTML ?? '', rest: tpl.innerHTML }
}
/** JB's offer card of a family (the "Three products" board): who it is for, the price and its line */
function offerOf(all: VitChapter[], id: string) {
  const o = all.find((c) => c.id === 'offers'); if (!o) return null
  const tpl = document.createElement('template'); tpl.innerHTML = o.body
  const li = [...tpl.content.querySelectorAll('li.vit-offer')].find((x) => x.querySelector(`a[data-vt-ch="${id}"]`))
  if (!li) return null
  const rows = [...li.querySelectorAll('.vit-offer-r')]
  return { who: rows[0]?.querySelector('.vit-v')?.textContent ?? '', price: li.querySelector('.vit-price')?.textContent ?? '', priceS: li.querySelector('.vit-price-s')?.textContent ?? '' }
}

function FamSheet({ c, act, back }: { c: VitChapter; act: boolean; back: () => void }) {
  const lang = useLang()
  const L = VIT[lang === 'fr' ? 'fr' : 'en']
  const fam = useFamState()
  const parts = useMemo(() => { const p = splitFam(fixHtml(c.body), c.id); return { ...p, offer: offerOf(L.chapters, c.id) } }, [c, L])
  const row = L.rows.find((x) => x.id === c.id)
  const st = row ? fam(c.id, row.lamp, row.word) : null
  const buy = c.id !== 'refutation' && c.id !== 'retired'
  const useRef_ = useRef<HTMLElement>(null)
  useEffect(() => { if (act) toTop(useRef_.current) }, [act, c.id])
  return (
    <>
      <div className={`vt-body ${c.cls} vt-head`} dangerouslySetInnerHTML={{ __html: parts.head }} />
      <dl className="vt-facts">
        {parts.offer?.who ? <div><dt className="lbl">{t('vit.for')}</dt><dd>{parts.offer.who}</dd></div> : null}
        {buy && (parts.offer?.price || row?.price) ? <div><dt className="lbl">{t('vit.price')}</dt><dd><span className="mono tnum vt-facts-p">{parts.offer?.price || row?.price}</span>{parts.offer?.priceS ? <span className="vt-facts-s">{parts.offer.priceS}</span> : null}</dd></div> : null}
        {st ? <div><dt className="lbl">{t('vit.now')}</dt><dd className="vt-facts-st"><span className={`led${st.lamp === 'off' ? '' : ` led-${st.lamp}`}`} aria-hidden="true" />{st.word}</dd></div> : null}
      </dl>
      <section className="vt-use" id="vt-use" ref={useRef_} aria-labelledby="vt-use-h">
        <h3 className="vt-sec-h" id="vt-use-h">{buy ? t('vit.use') : t('vit.proof')}</h3>
        {buy ? <Suspense fallback={<p className="lbl muted">{t('vit.reading')}</p>}><UseBlock fam={c.id} pid={null} back={back} /></Suspense>
          : <><p className="vt-use-d">{t(c.id === 'refutation' ? 'vit.proof.r' : 'vit.proof.o')}</p><div className={`vt-body ${c.cls}`} dangerouslySetInnerHTML={{ __html: parts.proof }} /></>}
      </section>
      <details className="vt-tech">
        <summary className="vt-tech-s"><span>{t('vit.tech')}</span><span className="lbl muted">{t('vit.tech.d')}</span></summary>
        <div className={`vt-body ${c.cls}`} dangerouslySetInnerHTML={{ __html: parts.rest }} />
        {PIDS[c.id].map((pid) => (
          <section className="vt-livesec" key={pid} aria-labelledby={`vt-live-${pid}`}>
            <h3 className="vt-live-h" id={`vt-live-${pid}`}><span className="vit-dot is-live" aria-hidden="true" />{t('vit.live', { id: pid })}</h3>
            <ServiceDetail pid={pid} bare />
          </section>
        ))}
      </details>
    </>
  )
}

function ChapterView({ c, i, n, go, close, root, act }: { c: VitChapter; i: number; n: number; go: (id: string) => void; close: () => void; root: React.RefObject<HTMLDivElement | null>; act: boolean }) {
  const lang = useLang()
  const all = VIT[lang === 'fr' ? 'fr' : 'en'].chapters
  const body = useMemo(() => fixHtml(c.body), [c])
  useLiveFill(root, c.id)
  const fam = (FAM as readonly string[]).includes(c.id)
  return (
    <article className={`vt-ch is-${c.id}`} aria-label={c.plain}>
      <div className="vt-bar">
        <button type="button" className="tlink vt-back" onClick={close}><span aria-hidden="true">← </span>{t('vit.back')}</button>
        <span className="lbl muted no-touch">Esc</span>
        <span className="vt-step">
          <button type="button" className="vt-nb vt-nb-p" aria-label={t('vit.prev')} disabled={i === 0} onClick={() => go(all[i - 1].id)}>‹</button>
          <span className="mono vt-of">{t('vit.of', { a: i + 1, b: n })}</span>
          <button type="button" className="vt-nb vt-nb-n" aria-label={t('vit.next')} disabled={i === n - 1} onClick={() => go(all[i + 1].id)}>›</button>
        </span>
      </div>
      {c.k ? <p className="mono vt-kick">{c.k}</p> : null}
      {fam ? <FamSheet c={c} act={act} back={close} /> : <div className={`vt-body ${c.cls}`} dangerouslySetInnerHTML={{ __html: body }} />}
      {i < n - 1 ? (
        <button type="button" className="vt-nextch" onClick={() => go(all[i + 1].id)}>
          <span className="lbl muted">{t('vit.next')}</span>
          <span className="vt-nextch-t">{all[i + 1].t}</span>
        </button>
      ) : null}
    </article>
  )
}

function SlotView({ close }: { close: () => void }) {
  useLang()
  return (
    <article className="vt-ch is-slot">
      <div className="vt-bar"><button type="button" className="tlink vt-back" onClick={close}><span aria-hidden="true">← </span>{t('vit.back')}</button><span className="lbl muted no-touch">Esc</span></div>
      <h2 className="vt-h" tabIndex={-1} data-vt-h>{t('vit.slot')}<span className="ttl-rule" aria-hidden="true" /></h2>
      <p className="vt-slot-l">{t('vit.slot.l')}</p>
      <p className="vt-lede">{t('vit.slot.d')}</p>
      <div className="vt-acts">
        <a className="btn btn-main" href={networkFor('publish')}><span>{t('vit.slot.pub')}</span></a>
        <a className="btn btn-line" href={networkFor('rent')}><span>{t('vit.slot.rent')}</span></a>
      </div>
    </article>
  )
}

/** a product with no family chapter yet (a service published after JB's page): its live sheet in the column */
function ProductView({ pid, name, close, act }: { pid: string; name: string; close: () => void; act: boolean }) {
  useLang()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { if (act) toTop(ref.current) }, [act, pid])
  return (
    <article className="vt-ch is-product">
      <div className="vt-bar"><button type="button" className="tlink vt-back" onClick={close}><span aria-hidden="true">← </span>{t('vit.back')}</button><span className="lbl muted no-touch">Esc</span></div>
      <h2 className="vt-h" tabIndex={-1} data-vt-h>{name}<span className="ttl-rule" aria-hidden="true" /></h2>
      <section className="vt-use" id="vt-use" ref={ref} aria-labelledby="vt-use-h">
        <h3 className="vt-sec-h" id="vt-use-h">{t('vit.use')}</h3>
        <Suspense fallback={<p className="lbl muted">{t('vit.reading')}</p>}><UseBlock fam={null} pid={pid} back={close} /></Suspense>
      </section>
      <details className="vt-tech">
        <summary className="vt-tech-s"><span>{t('vit.tech')}</span><span className="lbl muted">{t('vit.tech.d')}</span></summary>
        <section className="vt-livesec" aria-labelledby={`vt-live-${pid}`}>
          <h3 className="vt-live-h" id={`vt-live-${pid}`}><span className="vit-dot is-live" aria-hidden="true" />{t('vit.live', { id: pid })}</h3>
          <ServiceDetail pid={pid} bare />
        </section>
      </details>
    </article>
  )
}

/** a sled of the phone list (the room's plates are too small there): the same plate, as a row */
function Sled({ p }: { p: Plate }) {
  const slot = p.key.startsWith('slot')
  const { title, sub: word, led: lamp, unit: units, on, dim, open } = p
  return (
    <li className={`vt-bay blade${slot ? ' is-slot' : ''}`} data-led={lamp} data-on={on ? '1' : '0'} data-dim={dim ? '1' : '0'}>
      <button type="button" className="blade-face vt-sled" aria-pressed={on} onClick={open} aria-label={p.label}>
        {slot ? null : <span className="bl-led" aria-hidden="true"><i /></span>}
        <span className="bl-title" aria-hidden="true">{title}</span>
        <span className="bl-word" aria-hidden="true">{word}</span>
        {units ? <span className="bl-u" aria-hidden="true">{units}</span> : null}
      </button>
    </li>
  )
}

export function Vitrine() {
  const lang = useLang()
  const L = VIT[lang === 'fr' ? 'fr' : 'en']
  const rows = useCatalog()
  const [cur, setCur] = useState<string | null>(initial)
  const [act, setAct] = useState(ACT0)
  // sleds in view (the still frames the top of the rack; RoomStage counts those clear of the column)
  const [cap, setCap] = useState(12)
  const col = useRef<HTMLDivElement>(null)
  const all = L.chapters
  const i = cur && cur !== SLOT ? all.findIndex((c) => c.id === cur) : -1
  useEffect(() => { document.title = cur === SLOT ? `ArcHive. ${t('vit.slot')}` : i >= 0 ? `ArcHive. ${all[i].t}` : `ArcHive. ${t('vit.k')}` }, [cur, i, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = useCallback((id: string | null) => {
    setCur(id); setAct(false)
    const u = new URL(location.href)
    u.searchParams.delete('p'); u.searchParams.delete('act')
    if (id) u.searchParams.set('c', id); else u.searchParams.delete('c')
    history.replaceState(history.state, '', u)
  }, [])
  // a new chapter starts at its top, its title focused; stacked (phone), the page brings the column into view
  const first = useRef(true)
  useEffect(() => {
    const el = col.current
    if (!el) return
    // ?act=1: the sheet has already brought its action into view (child effects run first)
    if (first.current) { first.current = false; return }
    el.scrollTop = 0
    const h = el.querySelector<HTMLElement>('[data-vt-h], .vt-h')
    h?.setAttribute('tabindex', '-1'); h?.focus({ preventScroll: true })
    if (matchMedia('(max-width: 760px)').matches) el.closest('.vt-col')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [cur])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!cur) return
      if (e.key === 'Escape') { e.preventDefault(); open(null) }
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [cur, open])
  // inside a chapter: links to another chapter open it, in-chapter anchors scroll the column, the copilot link opens
  // the copilot, the copy buttons copy their command
  const onClick = (e: MouseEvent) => {
    const tg = e.target as Element
    const b = tg.closest<HTMLButtonElement>('.cmd-b')
    if (b) {
      const txt = b.parentElement?.querySelector('.cmd-t')?.textContent ?? ''
      navigator.clipboard?.writeText(txt).then(() => { const o = b.textContent; b.textContent = t('vit.copied'); setTimeout(() => { b.textContent = o }, 1400) }).catch(() => {})
      return
    }
    const a = tg.closest<HTMLAnchorElement>('a[data-vt-ch], a[data-vt-in], a[data-vt-copilot]')
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    if (a.dataset.vtCh) open(a.dataset.vtCh)
    else if (a.dataset.vtIn) col.current?.querySelector(`[id="${a.dataset.vtIn}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    else document.querySelector<HTMLButtonElement>('.cp-launch')?.click()
  }
  // the rack: one sled per product read on Arc (by id), its family's chapter on click; the other sleds are open slots.
  // More products than sleds: the last sled counts the rest and leads to the Use catalog, which lists them all.
  const pOpen = cur?.startsWith('p-') ? cur.slice(2) : null
  const list = (rows ?? []).slice().sort((a, b) => Number(a.p.id) - Number(b.p.id))
  const over = list.length > cap - 1 ? list.length - (cap - 2) : 0
  const shown = over ? list.slice(0, cap - 2) : list
  const plates: Plate[] = shown.map((r) => {
    const target = FAM_OF[r.p.id] ?? `p-${r.p.id}`
    const expired = r.led === 'amber' && r.encs.length > 0 && r.encs.every((x) => x.why === 'expired')
    const sub = r.led === 'green' ? 'plate.sub.green' : r.led === 'red' ? 'plate.sub.red' : r.led === 'off' || expired ? 'plate.sub.dim' : 'plate.sub.amber'
    const isOn = cur === target
    return { key: `p${r.p.id}`, title: r.name, sub: t(sub), unit: '', led: r.led === 'off' ? 'off' : r.led, on: isOn, dim: !!cur && !isOn, label: `${r.name}, ${t(sub)}`, open: () => open(isOn ? null : target) }
  })
  if (over) plates.push({ key: 'more', title: `+${over}`, sub: t('vit.more.s'), unit: '', led: 'off', on: false, dim: !!cur, label: t('vit.more.s'), open: () => { location.href = link.use } })
  while (plates.length < cap) {
    const k = plates.length
    plates.push({ key: `slot${k}`, title: t('plate.off'), sub: t('plate.sub.off'), unit: '', led: 'off', on: cur === SLOT, dim: !!cur && cur !== SLOT, label: `${t('plate.off')}, ${t('plate.sub.off')}`, open: () => open(cur === SLOT ? null : SLOT) })
  }
  const pRow = pOpen ? list.find((r) => r.p.id === pOpen) : undefined
  return (
    <div className="vt" data-open={cur ? '1' : '0'}>
      <RoomStage plates={plates} hint={t('vit.hint')} onCap={setCap} />
      <aside className="vt-col" aria-live="polite">
        <div className="vt-r" ref={col} onClick={onClick}>
          {cur === SLOT ? <SlotView close={() => open(null)} />
            : pOpen ? <ProductView pid={pOpen} name={pRow?.name ?? `#${pOpen}`} close={() => open(null)} act={act} />
              : i >= 0 ? <ChapterView c={all[i]} i={i} n={all.length} go={open} close={() => open(null)} root={col} act={act} />
                : <Intro open={open} />}
        </div>
      </aside>
      <section className="vt-list" aria-label={t('vit.servers')}>
        <ol className="vt-bays">
          {plates.filter((p, k) => !p.key.startsWith('slot') || k === shown.length + (over ? 1 : 0)).map((p) => <Sled key={p.key} p={p} />)}
        </ol>
      </section>
    </div>
  )
}
