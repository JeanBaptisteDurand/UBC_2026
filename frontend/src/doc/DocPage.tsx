// The doc page: how ArcHive works, from JB's technology page, read the way the rest of the site reads. A stage the
// height of the window: on the right, the server and the chapter index; on the left, a reading column that scrolls
// inside itself (like Network's column). It opens on the introduction; a chapter (index, in-text link, ?c=<id>) opens in
// the column, with previous / next, and Esc or "Back to the start" returns to the introduction. No anchor jumps, the
// page itself does not move.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useLive, rpc } from '../data/live'
import { API_DIRECT } from '../data/endpoints'
import { num, usdc } from '../data/fmt'
import { link } from '../links'
import { DOC, type Chapter } from './content'
import { useDt } from './strings'
import './doc-jb.css'
import './doc.css'
import { reveal } from '../ui/motion'

const ids = DOC.en.chapters.map((c) => c.id)
const initial = () => { const c = new URLSearchParams(location.search).get('c'); return c && ids.includes(c) ? c : null }

/** links rewritten by the converter: the console developers' page and the read API */
const fixHtml = (h: string) => h.replaceAll('href="@dev"', `href="${link.dev}"`).replace(/href="@api\//g, `href="${API_DIRECT}/`)

function Intro({ onStart }: { onStart: () => void }) {
  const { d, lang } = useDt()
  const stats = useLive((s) => s.stats)
  const block = useLive((s) => s.block)
  const hero = DOC[lang].hero
  return (
    <section className="doc-intro" aria-labelledby="doc-h">
      <h1 className="doc-h doc-h1" id="doc-h" tabIndex={-1} data-doc-h>
        <span>{d('doc.h.a')}</span><span className="tc-acc">{d('doc.h.b')}</span><span>{d('doc.h.c')}</span>
        <span className="ttl-rule" aria-hidden="true" />
      </h1>
      <p className="doc-lede">{hero.lede}</p>
      <div className="doc-verdict">
        <p className="doc-v tnum">{stats ? d('doc.verdict', { e: num(stats.enclaves, lang) ?? '', v: num(stats.verdicts, lang) ?? '' }) : d('doc.verdict.r')}</p>
        <p className="lbl muted tnum">{block ? d('doc.readAt', { b: num(block, lang) ?? '' }) : d('doc.reading')}</p>
      </div>
      <p className="tc-roots">{hero.roots}</p>
      {stats ? (
        <p className="tc-status doc-st"><span className={`led ${stats.enclavesActive ? 'led-green' : 'led-amber'}`} aria-hidden="true" /><span>{stats.enclavesActive ? d('doc.st.on', { a: stats.enclavesActive, n: stats.enclaves }) : d('doc.st.off', { n: stats.enclaves })}</span></p>
      ) : null}
      <p className="doc-start"><button type="button" className="btn btn-main" onClick={onStart}><span>{d('doc.start')}</span></button></p>
    </section>
  )
}

/** chapter 10, "On Arc now": the network's counters from /api/stats (the seizure is the 10 Nov refutation, recorded) */
function LiveNumbers() {
  const { d, lang } = useDt()
  const s = useLive((x) => x.stats)
  const status = useLive((x) => x.status)
  if (!s) return <p className="lbl muted">{status === 'error' ? d('doc.n.down') : d('doc.reading')}</p>
  const rows: [string, string | null][] = [
    [d('doc.n.products'), num(s.products, lang)],
    [d('doc.n.enclaves', { a: s.enclavesActive }), num(s.enclaves, lang)],
    [d('doc.n.settled'), usdc(s.settledUsdc, lang)],
    [d('doc.n.x402'), num(s.x402Calls, lang)],
    [d(s.sessions === 1 ? 'doc.n.session1' : 'doc.n.sessions'), num(s.sessions, lang)],
    [d('doc.n.verdicts'), num(s.verdicts, lang)],
    [d('doc.n.bounty'), usdc(s.bountyPaidUsdc, lang)],
    [d('doc.n.seized'), lang === 'fr' ? '1,00 USDC' : '1.00 USDC'],
  ]
  return <dl className="figs tc-live">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="tnum">{v ?? '—'}</dd></div>)}</dl>
}

/** chapter 09: reads the code of every contract of the table on Arc (eth_getCode), in place of JB's button */
function ReadCode({ root }: { root: React.RefObject<HTMLDivElement | null> }) {
  const { d, lang } = useDt()
  const [st, setSt] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    const rows = [...(root.current?.querySelectorAll<HTMLTableRowElement>('tr[id^="c-"]') ?? [])]
    setBusy(true)
    try {
      const b = Number(await rpc<string>('eth_blockNumber', []))
      let ok = 0, n = 0
      for (const tr of rows) {
        const a = tr.querySelector<HTMLAnchorElement>('.tc-ca a')?.href.match(/0x[0-9a-fA-F]{40}/)?.[0]
        const cell = tr.querySelector<HTMLElement>('.tc-cc')
        n++
        setSt(d('doc.code.doing', { a: n, b: rows.length }))
        if (!a || !cell) continue
        const code = await rpc<string>('eth_getCode', [a, 'latest'])
        const bytes = Math.max(0, (code.length - 2) / 2)
        if (bytes) ok++
        cell.innerHTML = bytes ? `<span class="doc-code-ok">${d('doc.code.bytes', { n: num(bytes, lang) ?? '' })}</span>` : `<span class="muted">${d('doc.code.none')}</span>`
      }
      setSt(d('doc.code.done', { a: ok, b: rows.length, k: num(b, lang) ?? '' }))
    } catch { setSt(d('doc.code.err')) } finally { setBusy(false) }
  }
  return (
    <div className="tc-ct-tools">
      <button type="button" className="btn btn-line btn-s" onClick={go} disabled={busy}><span>{d('doc.code.b')}</span></button>
      <p className="lbl tc-ct-st" role="status">{st}</p>
    </div>
  )
}

function ChapterView({ c, i, n, go, close, root }: { c: Chapter; i: number; n: number; go: (id: string) => void; close: () => void; root: React.RefObject<HTMLDivElement | null> }) {
  const { d, lang } = useDt()
  const stats = useLive((s) => s.stats)
  const all = DOC[lang].chapters
  const body = useMemo(() => c.body.map((p) => (typeof p === 'string' ? fixHtml(p) : p)), [c])
  // figures marked "read live" in the static HTML take the live value
  useEffect(() => {
    if (!stats) return
    root.current?.querySelectorAll<HTMLElement>('[data-live-v="verdicts"]').forEach((e) => { e.textContent = num(stats.verdicts, lang) ?? e.textContent })
  }, [stats, c, lang, root])
  return (
    <article className={`tc-ch doc-ch${c.band ? ' tc-band' : ''}`} aria-labelledby="doc-ch-h">
      <div className="doc-bar">
        <button type="button" className="tlink doc-back" onClick={close}><span className="doc-back-i" aria-hidden="true">←</span>{d('doc.back')}</button>
        <span className="doc-step">
          <button type="button" className="doc-nb doc-nb-p" aria-label={d('doc.prev')} disabled={i === 0} onClick={() => go(all[i - 1].id)} />
          <span className="mono doc-of">{d('doc.of', { a: i + 1, b: n })}</span>
          <button type="button" className="doc-nb doc-nb-n" aria-label={d('doc.next')} disabled={i === n - 1} onClick={() => go(all[i + 1].id)} />
        </span>
      </div>
      <p className="tc-kick mono" aria-hidden="true"><span className="tc-kn">{c.n}</span>{c.k}</p>
      <h2 className="doc-h tc-h" id="doc-ch-h" tabIndex={-1} aria-label={c.plain} data-doc-h>
        <span dangerouslySetInnerHTML={{ __html: c.title }} />
        <span className="ttl-rule" aria-hidden="true" />
      </h2>
      {body.map((p, k) => (typeof p === 'string'
        ? <div key={k} className="doc-b" dangerouslySetInnerHTML={{ __html: p }} />
        : <Fragment key={k}>{p.live === 'numbers' ? <LiveNumbers /> : p.live === 'code' ? <ReadCode root={root} /> : null}</Fragment>))}
      {i < n - 1 ? (
        <button type="button" className="doc-nextch" onClick={() => go(all[i + 1].id)}>
          <span className="lbl muted">{d('doc.next')}</span>
          <span className="doc-nextch-t"><span className="mono">{all[i + 1].n}</span> {all[i + 1].k}</span>
        </button>
      ) : null}
    </article>
  )
}

export function DocPage() {
  const { d, lang } = useDt()
  const [cur, setCur] = useState<string | null>(initial)
  const col = useRef<HTMLDivElement>(null)
  const all = DOC[lang].chapters
  const i = cur ? all.findIndex((c) => c.id === cur) : -1
  useEffect(() => { document.title = i >= 0 ? `${d('doc.title')}. ${all[i].k}` : d('doc.title') }, [i, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = useCallback((id: string | null) => {
    setCur(id)
    const u = new URL(location.href)
    if (id) u.searchParams.set('c', id); else u.searchParams.delete('c')
    history.replaceState(history.state, '', u)
  }, [])
  // a new chapter starts at its top, its title focused (keyboard and screen readers); on a phone, the page goes to it
  const first = useRef(true)
  useEffect(() => {
    const el = col.current
    if (!el) return
    el.scrollTop = 0
    if (first.current) { first.current = false; return }
    requestAnimationFrame(() => reveal(el))
    el.querySelector<HTMLElement>('[data-doc-h]')?.focus({ preventScroll: true })
    if (matchMedia('(max-width: 1024px)').matches) el.closest('.doc-col')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [cur])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && cur) { e.preventDefault(); open(null) } }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [cur, open])
  // in-text links to another chapter open it in the column
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-doc-ch]')
    if (!a) return
    const id = a.dataset.docCh!
    if (!ids.includes(id)) return
    e.preventDefault(); open(id)
  }
  return (
    <main className="app doc" id="doc">
      <div className="doc-stage">
        <aside className="doc-col" data-ch={cur ?? 'intro'} aria-live="polite">
          <div className="doc-r" ref={col} onClick={onClick}>
            {i >= 0 ? <ChapterView c={all[i]} i={i} n={all.length} go={open} close={() => open(null)} root={col} /> : <Intro onStart={() => open(all[0].id)} />}
          </div>
        </aside>
        <section className="doc-side" id="doc-idx" aria-label={d('doc.index')}>
          <div className="doc-srv" aria-hidden="true" />
          <nav className="doc-idx">
            <p className="lbl doc-idx-h">{d('doc.index')}</p>
            <ol className="doc-idx-l">
              {DOC[lang].toc.map((x) => {
                const ch = all.find((c) => c.id === x.id)
                return (
                  <li key={x.id}>
                    <a href={`?c=${x.id}`} aria-current={x.id === cur ? 'true' : undefined} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); open(x.id) }}>
                      <span className="mono doc-idx-n">{x.n}</span>
                      <span className="doc-idx-t">{x.t}</span>
                      <span className="doc-idx-p">{ch?.plain}</span>
                    </a>
                  </li>
                )
              })}
            </ol>
          </nav>
        </section>
      </div>
    </main>
  )
}
