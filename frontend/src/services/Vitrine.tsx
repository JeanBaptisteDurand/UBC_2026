// The Services page (service.html), after JB's product presentation (produits/product1.html): what ArcHive sells, in
// five families, shown as the sleds of one server (a Blender still, public/tex/rack.webp, its sled faces placed from
// rack-bays.json). Nothing scrolls the page to an anchor: a sled, a shop-window row or an index entry opens its chapter
// in the left column, which scrolls by itself (as on Network and the Doc page). ?c=<chapter> follows the open chapter
// (replaceState); ?p=<product> from the landing wall, the Use catalog or the copilot opens that product's family.
// Copy and chapters from JB (vit-content.ts, generated), numbers read live on Arc.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { t, useLang } from '../i18n'
import { useLive } from '../data/live'
import { useCatalog } from '../app/useCatalog'
import { ServiceDetail } from '../app/ServiceDetail'
import { API_DIRECT } from '../data/endpoints'
import { num, usdc, pct } from '../data/fmt'
import { link, networkFor } from '../links'
import { VIT, type VitChapter } from './vit-content'
import './vit-jb.css'
import './vitrine.css'

type Rect = { x: number; y: number; w: number; h: number }
type Bay = { face?: Rect; led?: Rect; recess?: Rect; vent?: boolean }
const SLOT = 'slot'
const FAM = ['bounty', 'private-ai', 'attested-copilot', 'refutation', 'retired'] as const
/** the products of each family, in JB's order */
const PIDS: Record<string, string[]> = { bounty: ['2', '7'], 'private-ai': ['1', '3'], 'attested-copilot': ['4'], refutation: ['5'], retired: ['6'] }
/** a product (landing wall, catalog, copilot links: ?p=<id>) opens its family */
const FAM_OF: Record<string, string> = Object.fromEntries(Object.entries(PIDS).flatMap(([f, ps]) => ps.map((p) => [p, f])))
const IDS = VIT.en.chapters.map((c) => c.id)

function initial(): string | null {
  const q = new URLSearchParams(location.search)
  const c = q.get('c')
  if (c && (IDS.includes(c) || c === SLOT)) return c
  const p = q.get('p')
  return p && FAM_OF[p] ? FAM_OF[p] : null
}

/** the sled faces of the rack render; without them the sleds are a plain list */
function useBays() {
  const [b, setB] = useState<Bay[] | null>(null)
  useEffect(() => {
    let on = true
    fetch('/tex/rack-bays.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (on && j?.bays?.length) setB(j.bays) }).catch(() => {})
    return () => { on = false }
  }, [])
  return b
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

function ChapterView({ c, i, n, go, close, root }: { c: VitChapter; i: number; n: number; go: (id: string) => void; close: () => void; root: React.RefObject<HTMLDivElement | null> }) {
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
      <div className={`vt-body ${c.cls}`} dangerouslySetInnerHTML={{ __html: body }} />
      {fam ? PIDS[c.id].map((pid) => (
        <section className="vt-livesec" key={pid} aria-labelledby={`vt-live-${pid}`}>
          <h3 className="vt-live-h" id={`vt-live-${pid}`}><span className="vit-dot is-live" aria-hidden="true" />{t('vit.live', { id: pid })}</h3>
          <ServiceDetail pid={pid} bare />
        </section>
      )) : null}
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

/** one sled face over the render: JB's lit lettering (name, state word, product numbers) */
function Sled({ id, title, word, lamp, units, bay, on, dim, open }: { id: string; title: string; word: string; lamp: string; units: string; bay?: Bay; on: boolean; dim: boolean; open: () => void }) {
  const f = bay?.face ?? bay?.recess
  const style = f ? { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` } : undefined
  const led = f && bay?.led ? { left: `${((bay.led.x - f.x) / f.w) * 100}%`, top: `${((bay.led.y - f.y) / f.h) * 100}%`, width: `${(bay.led.w / f.w) * 100}%`, height: `${(bay.led.h / f.h) * 100}%` } : undefined
  return (
    <li className={`vt-bay blade${id === SLOT ? ' is-slot' : ''}`} style={style} data-led={lamp} data-on={on ? '1' : '0'} data-dim={dim ? '1' : '0'}>
      <button type="button" className="blade-face vt-sled" aria-pressed={on} onClick={open} aria-label={`${title}, ${word}${units ? `, ${units}` : ''}`}>
        {id === SLOT ? null : <span className="bl-led" style={led} aria-hidden="true"><i /></span>}
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
  const bays = useBays()
  const fam = useFamState()
  const [cur, setCur] = useState<string | null>(initial)
  const col = useRef<HTMLDivElement>(null)
  const all = L.chapters
  const i = cur && cur !== SLOT ? all.findIndex((c) => c.id === cur) : -1
  useEffect(() => { document.title = cur === SLOT ? `ArcHive. ${t('vit.slot')}` : i >= 0 ? `ArcHive. ${all[i].t}` : `ArcHive. ${t('vit.k')}` }, [cur, i, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = useCallback((id: string | null) => {
    setCur(id)
    const u = new URL(location.href)
    u.searchParams.delete('p')
    if (id) u.searchParams.set('c', id); else u.searchParams.delete('c')
    history.replaceState(history.state, '', u)
  }, [])
  // a new chapter starts at its top, its title focused; stacked (phone), the page brings the column into view
  const first = useRef(true)
  useEffect(() => {
    const el = col.current
    if (!el) return
    el.scrollTop = 0
    if (first.current) { first.current = false; return }
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
  const faceBays = bays?.filter((b) => b.face) ?? []
  const slotBay = bays?.find((b) => b.recess)
  const famOpen = cur && (FAM as readonly string[]).includes(cur) ? cur : cur === SLOT ? SLOT : null
  return (
    <div className="vt" data-open={cur ? '1' : '0'}>
      <aside className="vt-col" aria-live="polite">
        <div className="vt-r" ref={col} onClick={onClick}>
          {cur === SLOT ? <SlotView close={() => open(null)} />
            : i >= 0 ? <ChapterView c={all[i]} i={i} n={all.length} go={open} close={() => open(null)} root={col} />
              : <Intro open={open} />}
        </div>
      </aside>
      <section className="vt-srv" aria-label={t('vit.servers')}>
        <div className={`vt-rack ${bays ? 'has-img' : 'no-img'}`}>
          {bays ? <img className="vt-img" src="/tex/rack.webp" srcSet="/tex/rack-s.webp 860w, /tex/rack.webp 1720w" sizes="(max-width: 760px) 100vw, 46vw" alt="" draggable={false} /> : null}
          <ol className="vt-bays">
            {L.faces.map((f, k) => {
              const s = fam(f.id, f.lamp, f.word)
              return <Sled key={f.id} {...f} {...s} bay={faceBays[k]} on={cur === f.id} dim={!!famOpen && famOpen !== f.id} open={() => open(cur === f.id ? null : f.id)} />
            })}
            <Sled id={SLOT} title={t('vit.slot')} word={t('vit.slot.w')} lamp="off" units="" bay={slotBay} on={cur === SLOT} dim={!!famOpen && famOpen !== SLOT} open={() => open(cur === SLOT ? null : SLOT)} />
          </ol>
        </div>
        <p className="vt-hint mono">{L.hint}</p>
      </section>
    </div>
  )
}
