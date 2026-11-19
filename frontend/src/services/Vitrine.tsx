// The Services page (service.html), from the product presentation: what ArcHive sells, in
// five families, next to the landing's room with one rack alone in the aisle (RoomStage.tsx: a Cycles still, its sleds
// lit live, one per product read on Arc, the rest open slots). Nothing scrolls the page to an anchor: a sled, a shop-window row or an index entry opens its chapter
// in the left column, which scrolls by itself (as on Network and the Doc page). ?c=<chapter> follows the open chapter
// (replaceState); ?p=<product> from the landing wall, the Use catalog or the copilot opens that product's family.
// Copy and chapters from vit-content.ts (generated), numbers read live on Arc.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { t, useLang, getLang } from '../i18n'
import { useLive } from '../data/live'
import { useCatalog } from '../app/useCatalog'
import { isSupersededRow } from '../app/catalog'
import { ServiceDetail } from '../app/ServiceDetail'
import { API_DIRECT } from '../data/endpoints'
import { num, usdc, pct } from '../data/fmt'
import { link, networkFor, consoleFor } from '../links'
import { VIT, type VitChapter } from './vit-content'
import { RoomStage, type Plate } from './RoomStage'
import { reveal, grow } from '../ui/motion'
// the action of a sheet: the signed flows (wallet engine, SDK) load with the sheet, not with the page
const UseBlock = lazy(() => import('./UseBlock'))
import './vit-chapters.css'
import './vitrine.css'

/** the call and the room's hint as a touch screen and a stacked page read them (the shared table, i18n.ts, has the
 *  mouse wording only): "tap", and on a phone or a tablet held upright the sleds are below, not on the right */
const TOUCH_STR = {
  en: { cta: 'The sleds on the right are interactive: tap one to see its service and use it.', ctaM: 'The sleds below are interactive: tap one to see its service and use it.', hint: 'Tap a sled to open its sheet.' },
  fr: { cta: 'Les lames à droite sont interactives : touchez-en une pour voir son service et l’utiliser.', ctaM: 'Les lames ci-dessous sont interactives : touchez-en une pour voir son service et l’utiliser.', hint: 'Touchez une lame pour ouvrir sa fiche.' },
} as const
const ts = (k: keyof typeof TOUCH_STR.en) => TOUCH_STR[getLang() === 'fr' ? 'fr' : 'en'][k]
const isTouch = () => typeof matchMedia === 'function' && matchMedia('(hover: none), (pointer: coarse)').matches

const SLOT = 'slot'
const FAM = ['bounty', 'private-ai', 'attested-copilot', 'refutation', 'retired'] as const
/** the products of each family, in the presentation's order */
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

/** the live state of a family: running if any of its products has an enclave running; the presentation's word and lamp otherwise
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

/** the sections of the introduction, after the presentation's chapters (its "offer" board is left out: the sleds and their sheets
 *  say it). "Build on it" is the MCP server and its SDK: it is named so. */
const SECS = ['notary', 'compare', 'market', 'build', 'faq'] as const
const isSec = (id: string) => (SECS as readonly string[]).includes(id) || id === 'offers'
/** the families, in order: the sheets the arrows walk through */
const FAMS = (all: VitChapter[]) => all.filter((c) => (FAM as readonly string[]).includes(c.id))
const secHtml = (c: VitChapter) => {
  const h = fixHtml(c.body)
  if (c.id !== 'build') return h
  // the section is the MCP server: its title says so
  return h.replace(/<h2 aria-label="[^"]*" class="vt-h vit-h2" id="build-h">[\s\S]*?<span class="ttl-rule"/, '<h2 aria-label="MCP" class="vt-h vit-h2" id="build-h">MCP<span class="ttl-rule"')
}

function Intro({ root, to }: { root: React.RefObject<HTMLDivElement | null>; to: string | null }) {
  const lang = useLang()
  const L = VIT[lang === 'fr' ? 'fr' : 'en']
  useLiveFill(root, 'intro')
  // a link to a section (?c=market, or from a sheet) brings it to the top of the column
  // the sections are a table of contents: each title opens its section in place (the reader sees what
  // is there and opens what interests them). A link to a section (?c=market, or from a sheet) opens it and brings it
  // to the top of the column. Closed bodies stay in the DOM (hidden) so the live figures are filled in them too.
  const [openId, setOpenId] = useState<string | null>(to && to !== 'offers' ? to : null)
  useEffect(() => { if (to && to !== 'offers') { setOpenId(to); requestAnimationFrame(() => toTop(document.getElementById(`vt-s-${to}`))) } }, [to])
  const secs = SECS.map((id) => L.chapters.find((c) => c.id === id)).filter(Boolean) as VitChapter[]
  const name = (c: VitChapter) => (c.id === 'build' ? 'MCP' : c.t)
  // the section's own heading (its h2), shown in the row so the reader knows what is inside before opening it
  const head = (c: VitChapter) => { const h = /<h2 aria-label="([^"]*)"/.exec(c.body)?.[1] ?? ''; return c.id === 'build' || h.replace(/[.\s]+$/, '') === c.t ? '' : h }
  return (
    <section className="vt-intro" aria-labelledby="vt-h1">
      <Title text={L.hero.title} acc={L.hero.acc} />
      <p className="vt-lede">{L.hero.lede}</p>
      {/* the call to the room, as on the landing: the sleds are the shop window */}
      <p className="vt-cta">
        <svg className="hero-ic" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.4" y="3" width="15.2" height="4" rx="0.6" /><rect x="2.4" y="8" width="15.2" height="4" rx="0.6" /><rect x="2.4" y="13" width="15.2" height="4" rx="0.6" /><path d="M4.6 4.2 V5.8" className="hero-ic-led l1" /><path d="M4.6 9.2 V10.8" className="hero-ic-led l2" /><path d="M4.6 14.2 V15.8" className="hero-ic-led l3" /></svg>
        <span className="vt-cta-d">{isTouch() ? ts('cta') : t('vit.cta')}</span>
        <span className="vt-cta-m">{ts('ctaM')}</span>
      </p>
      <div className="vt-toc">
        <p className="mono vt-toc-k">{t('vit.toc')}</p>
        {secs.map((c, k) => {
          const isOpen = openId === c.id
          return (
            <section className={`vt-sec is-${c.id}`} id={`vt-s-${c.id}`} key={c.id} data-open={isOpen ? '1' : '0'}>
              <h2 className="vt-sec-t">
                <button type="button" className="vt-sec-b" aria-expanded={isOpen} aria-controls={`vt-sb-${c.id}`} onClick={() => { setOpenId(isOpen ? null : c.id); if (!isOpen) requestAnimationFrame(() => grow(document.getElementById(`vt-sb-${c.id}`))) }}>
                  <span className="mono vt-sec-n">{String(k + 1).padStart(2, '0')}</span>
                  <span className="vt-sec-tx">{head(c) ? <><span className="mono vt-sec-l">{name(c)}</span><span className="vt-sec-h2">{head(c)}</span></> : <span className="vt-sec-h2">{name(c)}</span>}</span>
                  <span className="vt-sec-i" aria-hidden="true" />
                </button>
              </h2>
              <div id={`vt-sb-${c.id}`} className={`vt-body ${c.cls}`} hidden={!isOpen} dangerouslySetInnerHTML={{ __html: secHtml(c) }} />
            </section>
          )
        })}
      </div>
    </section>
  )
}

/** the live words of the sled faces and of the sheets' "Today" lines (the shared table, i18n.ts, does not carry them
 *  yet), English and French in step */
const LIVE_STR = {
  en: { wDown: 'State unknown', wRead: 'Reading…', p4on: 'Runs in its own enclave, admitted on Arc, registration valid until {t}.', off: 'No enclave runs it right now, read live on Arc. Every past payment stays readable.', none: 'No enclave runs right now, read live on Arc.' },
  fr: { wDown: 'État inconnu', wRead: 'Lecture…', p4on: 'Tourne dans sa propre enclave, admise sur Arc, inscription valable jusqu’au {t}.', off: 'Aucune enclave ne le fait tourner en ce moment, lu en direct sur Arc. Chaque paiement passé reste lisible.', none: 'Aucune enclave ne tourne en ce moment, lu en direct sur Arc.' },
} as const
const ls = (k: keyof typeof LIVE_STR.en, v?: Record<string, string>) => {
  let x: string = LIVE_STR[getLang() === 'fr' ? 'fr' : 'en'][k]
  for (const [a, b] of Object.entries(v ?? {})) x = x.split(`{${a}}`).join(b)
  return x
}
const utcDay = (unix: number, lang: string) => `${new Date(unix * 1000).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`

/** the presentation's sentences that name the products running on 19 November ("#1, #2, #3 and #7"), read live: the products whose
 *  enclave runs now. Another list drops the daily cost of 4 VMs that went with it; none running, one short line. The
 *  original text is kept per text node. */
const RUNS = /#1, #2, #3 and #7|n°\s1, 2, 3 et 7/
const COST = /,\sat about 5\.8\s\$ a day for 4\sVMs|,\spour environ 5,8\s\$ par jour pour 4\sVM/
const SENT = /(The verified enclaves of products|Les enclaves vérifiées des produits)[^.]*\./
const runOrig = new WeakMap<Text, string>()
function fillRuns(el: HTMLElement, ids: string[] | null, lang: string) {
  const hits: Text[] = []
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) { const x = n as Text; if (runOrig.has(x) || RUNS.test(x.data)) hits.push(x) }
  const last = ids?.[ids.length - 1]
  const list = !ids?.length ? '' : lang === 'fr'
    ? `n° ${ids.length > 1 ? `${ids.slice(0, -1).join(', ')} et ` : ''}${last}`
    : `${ids.length > 1 ? `${ids.slice(0, -1).map((i) => `#${i}`).join(', ')} and ` : ''}#${last}`
  for (const x of hits) {
    if (!runOrig.has(x)) runOrig.set(x, x.data)
    const o = runOrig.get(x)!
    const v = !ids || ids.join() === '1,2,3,7' ? o : !ids.length ? o.replace(COST, '').replace(SENT, ls('none')) : o.replace(COST, '').replace(RUNS, list)
    if (x.data !== v) x.data = v
  }
}

/** the numbers the presentation reads live, filled from /api/stats and /api/products */
function useLiveFill(root: React.RefObject<HTMLDivElement | null>, key: string) {
  const lang = useLang()
  const stats = useLive((s) => s.stats)
  const products = useLive((s) => s.products)
  const status = useLive((s) => s.status)
  const rows = useCatalog()
  // the sled faces and the "Today" lines of the sheets take the live state of their products (the static
  // lamps and words are only the state before the first read)
  useEffect(() => {
    const el = root.current
    if (!el) return
    // before the catalog is read (or while the API does not answer), nothing is said as if read: quiet lamps, "Reading"
    const wait = !rows
    // the column's content can be laid again just after it arrives (a sheet's parts, the motion of its blocks): the
    // live words are written now and once more when it has settled
    const fill = () => {
    const running = (ids: string[]) => (rows ?? []).filter((r) => ids.includes(r.p.id)).reduce((a, r) => a + r.running, 0)
    // a sled face (#2 #7 in its unit line): green and "Running" while one of its products runs
    el.querySelectorAll<HTMLElement>('.vit-face').forEach((f) => {
      const ids = (f.querySelector('.bl-u')?.textContent ?? '').match(/\d+/g) ?? []
      const w = f.querySelector<HTMLElement>('.bl-word')
      if (f.dataset.origLed === undefined) f.dataset.origLed = f.dataset.led ?? ''
      if (!ids.length || !w || f.dataset.origLed === 'red' || f.dataset.origLed === 'off') return
      if (w.dataset.orig === undefined) w.dataset.orig = w.textContent ?? ''
      const on = running(ids) > 0
      f.dataset.led = wait ? 'off' : on ? 'green' : f.dataset.origLed || 'amber'
      w.textContent = wait ? ls(status === 'error' ? 'wDown' : 'wRead') : on ? t('vit.w.on') : w.dataset.orig
    })
    // the "Today" line of a family sheet: its lamp follows the family's products; a family that sells (bounty, private
    // AI) and runs nothing says so; the attested copilot (#4), while its enclave runs, says until when its
    // registration holds
    const fam = PIDS[key]
    if (fam && (key === 'bounty' || key === 'private-ai' || key === 'attested-copilot')) {
      const on = running(fam) > 0
      const until = Math.max(0, ...(rows ?? []).filter((r) => fam.includes(r.p.id)).flatMap((r) => r.encs.filter((x) => x.led === 'green').map((x) => Number(x.e.expiresAt) || 0)))
      el.querySelectorAll<HTMLElement>('.vit-side-today, .vit-offer-r .led').forEach((x) => {
        const p = x.classList.contains('led') ? x.parentElement : x
        const led = p?.querySelector<HTMLElement>('.led')
        if (led) { led.classList.toggle('led-green', !wait && on); led.classList.toggle('led-amber', !wait && !on) }
        if (!p) return
        const txt = [...p.childNodes].find((n) => n.nodeType === 3 && n.textContent?.trim())
        if (!txt) return
        if ((p as HTMLElement).dataset.orig === undefined) (p as HTMLElement).dataset.orig = txt.textContent ?? ''
        const orig = (p as HTMLElement).dataset.orig!
        txt.textContent = wait ? t(status === 'error' ? 'vit.down' : 'vit.reading')
          : key === 'attested-copilot' ? (on && until ? ls('p4on', { t: utcDay(until, lang) }) : orig)
            : on ? orig : ls('off')
      })
    }
    // the introduction's lines that name the running products (the state of 19 November), read live
    if (key === 'intro') fillRuns(el, rows ? rows.filter((r) => r.running > 0 && !isSupersededRow(r)).map((r) => r.p.id).sort((a, b) => Number(a) - Number(b)) : null, lang)
    }
    fill()
    const a = setTimeout(fill, 400), b = setTimeout(fill, 1400)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [root, key, lang, rows, status])
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

/** a family's sheet cut in three: what it is (its header, who it is for, price, live state), its action, then the rest
 *  of its section and the live blocks of its products, folded under "Technical details" */
function splitFam(html: string, id: string) {
  const tpl = document.createElement('template'); tpl.innerHTML = html
  const hd = tpl.content.querySelector('.vit-fam-hd'); hd?.remove()
  const nm = hd?.querySelector('.vit-fam-name'); if (nm) nm.insertAdjacentHTML('afterbegin', '<span class="vt-led-slot"></span>')
  // the recorded event is the "use" of the two families nothing can be bought from
  const pr = id === 'refutation' ? tpl.content.querySelector('.vit-refute') : id === 'retired' ? tpl.content.querySelector('.vit-proofs') : null
  pr?.remove()
  return { head: hd?.outerHTML ?? '', proof: pr?.outerHTML ?? '', rest: tpl.innerHTML }
}
/** the offer card of a family (the "Three products" board): who it is for, the price and its line */
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
      <div className={`vt-body ${c.cls} vt-head`} dangerouslySetInnerHTML={{ __html: st ? parts.head.replace('<span class="vt-led-slot"></span>', `<span class="led vt-h-led${st.lamp === 'off' ? '' : ` led-${st.lamp}`}" aria-hidden="true"></span>`) : parts.head }} />
      <p className="vt-meta">
        {st ? <span className="vt-meta-st">{st.word}</span> : null}
        {buy && (parts.offer?.price || row?.price) ? <span className="mono tnum vt-meta-p" title={parts.offer?.priceS || undefined}>{row?.price || parts.offer?.price}</span> : null}
        {parts.offer?.who ? <span className="vt-meta-f"><span className="lbl">{t('vit.for')}</span> {parts.offer.who}</span> : null}
      </p>
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
  const all = FAMS(VIT[lang === 'fr' ? 'fr' : 'en'].chapters)
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

/** a product with no family chapter yet (a service published after the presentation): its live sheet in the column */
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
  const all = FAMS(L.chapters)
  const sec = cur && isSec(cur) ? cur : null
  const i = cur && cur !== SLOT && !sec ? all.findIndex((c) => c.id === cur) : -1
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
    // motion rule M2 (ui/motion.ts): the new content of the column arrives block by block
    requestAnimationFrame(() => reveal(el))
    // a section of the introduction: the column brings it to its top (Intro.tsx does it on the first load)
    if (cur && isSec(cur)) { if (cur !== 'offers') toTop(el.querySelector<HTMLElement>(`#vt-s-${cur}`)); else el.scrollTop = 0; return }
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
  if (over) plates.push({ key: 'more', title: `+${over}`, sub: t('vit.more.s'), unit: '', led: 'off', on: false, dim: !!cur, label: t('vit.more.s'), open: () => { location.href = consoleFor() } })
  while (plates.length < cap) {
    const k = plates.length
    plates.push({ key: `slot${k}`, title: t('plate.off'), sub: t('plate.sub.off'), unit: '', led: 'off', on: cur === SLOT, dim: !!cur && cur !== SLOT, label: `${t('plate.off')}, ${t('plate.sub.off')}`, open: () => open(cur === SLOT ? null : SLOT) })
  }
  const pRow = pOpen ? list.find((r) => r.p.id === pOpen) : undefined
  return (
    <div className="vt" data-open={cur ? '1' : '0'}>
      <RoomStage plates={plates} hint={isTouch() ? ts('hint') : t('vit.hint')} onCap={setCap} />
      <aside className="vt-col" aria-live="polite" data-cur-text>
        <div className="vt-r" ref={col} onClick={onClick}>
          {cur === SLOT ? <SlotView close={() => open(null)} />
            : pOpen ? <ProductView pid={pOpen} name={pRow?.name ?? `#${pOpen}`} close={() => open(null)} act={act} />
              : i >= 0 ? <ChapterView c={all[i]} i={i} n={all.length} go={open} close={() => open(null)} root={col} act={act} />
                : <Intro root={col} to={sec} />}
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
