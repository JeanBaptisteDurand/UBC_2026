// The Network page: the diagram is the first thing seen, under the header; the three choices are in the
// column to its left; a choice opens the focus (the column becomes the steps panel, the scene stays on the right);
// going back to the overview goes through the same column. The visitor's wallet sits in the header, a cross
// closes the focus, the catalog replaces the scene; on focus, the panel steps become actions (actions/Actions.tsx)
// and the diagram follows them. On phones: the diagram, then the choices. The page name fits in one key (net.name).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t, useLang } from '../i18n'
import { Footer } from '../ui/Footer'
import { AppHeader } from '../app/AppFrame'
import { link } from '../links'
import { withArcWords, plainAcc, splitAcc } from '../ui/ArcGlow'
import { useIn } from '../ui/gestures'
import { Actions, HeaderWallet, CloseFocus } from './actions/Actions'
import { w } from './actions/strings'
import { setUi } from './actions/store'
import { parts } from './data'
import { lg } from './lang'
import { reveal } from '../ui/motion'

// The view asked by the address (?focus=), read before the first render: a page opened on a part is laid out as that
// part from its first frame (no jump when the scene, loaded later, applies it: scene.ts go)
type Focus = 'ensemble' | 'use' | 'rent' | 'publish' | 'cctp' | 'arc' | 'demo'
const F0: Focus = (() => {
  const f = new URLSearchParams(location.search).get('focus')
  return f === 'use' || f === 'rent' || f === 'publish' || f === 'cctp' || f === 'arc' || f === 'demo' ? f : 'ensemble'
})()
const isPart = (v: Focus): v is 'use' | 'rent' | 'publish' => v === 'use' || v === 'rent' || v === 'publish'

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

type ShowPart = 'use' | 'rent' | 'publish'
interface ShowApi { playShow?: (p: ShowPart) => void; stopShow?: () => void; refus?: () => void }
const s3d = () => (window as unknown as { __s3d?: ShowApi }).__s3d
const isView = (v: string | null | undefined): v is Focus => v === 'ensemble' || v === 'use' || v === 'rent' || v === 'publish' || v === 'cctp' || v === 'arc' || v === 'demo'
/** The 3D room is in place (scene.ts start() sets #stage[data-ready]): the scene can play a demo or a refusal. */
const sceneReady = () => document.getElementById('stage')?.dataset.ready === '1'

/** A view asked before the scene's code has arrived (on a slow network the page shows first, the 3D after): the column
 *  switches at once to the layout the address would give (the same as F0 on load), the address keeps the view, and the
 *  scene opens that view when it starts (scene.ts start() reads the address). The arc and cctp panels get their title
 *  here, their body with the scene. */
function preGo(v: Focus) {
  const col = document.getElementById('col'), ch = document.getElementById('choices'), pn = document.getElementById('panel'), stage = document.getElementById('stage')
  if (!col || !ch || !pn || !stage) return
  const put = (id: string, s: string) => { const e = document.getElementById(id); if (e) e.textContent = s }
  if (isPart(v)) { const P = parts()[v]; put('p-kick', P.kicker); put('p-title', P.title); put('p-actor', P.actor) }
  else if (v === 'arc' || v === 'cctp') { put('p-kick', ''); put('p-title', t(v === 'arc' ? 'net.arc' : 'net.cctp')); put('p-actor', '') }
  const r = document.getElementById('refus'); if (r) r.hidden = v !== 'rent'
  ch.hidden = v !== 'ensemble'; pn.hidden = v === 'ensemble' || v === 'demo'
  if (v === 'ensemble') delete stage.dataset.view; else stage.dataset.view = v
  col.setAttribute('data-col', v)
  const u = new URL(location.href)
  if (v === 'ensemble') u.searchParams.delete('focus'); else u.searchParams.set('focus', v)
  history.replaceState(null, '', u)
  // phones and tablets: the part starts at its top, as with the scene (scene.ts go)
  if (v !== 'demo' && scrollY > 0 && matchMedia('(max-width: 1024px)').matches) scrollTo({ top: 0, behavior: 'auto' })
}

/** The part's demo, at the top of a focus: a button that plays the whole flow of the part in the scene (scene.ts
 *  playShow), then reads Stop while it plays and Replay once it is over. A show: no wallet, no form, no transaction.
 *  Asked before the 3D room is ready, it waits for it (the note says so) and starts then; a second tap cancels. */
function PlayDemo() {
  useLang()
  const [part, setPart] = useState<ShowPart | null>(() => (isPart(F0) ? F0 : null))
  const [st, setSt] = useState<{ st: 'idle' | 'wait' | 'on' | 'done'; k: number }>({ st: 'idle', k: -1 })
  const want = useRef<ShowPart | null>(null)
  useEffect(() => {
    const col = document.querySelector('#col'), stage = document.getElementById('stage'); if (!col || !stage) return
    // the scene writes the view again without changing it (its start, a step, a show): only a real change of part
    // resets the button (otherwise a show under way would lose its Stop bar); a real change of view brings the
    // column's new content in block by block (motion rule M2, ui/motion.ts)
    let last: string | null = null
    let was = col.getAttribute('data-col')
    const read = () => {
      const v = col.getAttribute('data-col'); if (v === last) return
      last = v; want.current = null
      if (v !== was) { was = v; requestAnimationFrame(() => reveal(col)) }
      setPart(v === 'use' || v === 'rent' || v === 'publish' ? v : null); setSt({ st: 'idle', k: -1 })
    }
    read()
    const mo = new MutationObserver(read); mo.observe(col, { attributes: true, attributeFilter: ['data-col'] })
    const on = (e: Event) => { const d = (e as CustomEvent<{ st: 'idle' | 'on' | 'done'; k: number }>).detail; setSt({ st: d.st, k: d.k }) }
    addEventListener('net:show', on)
    // the demo asked while the room was loading starts as soon as it is ready
    const mr = new MutationObserver(() => {
      if (!sceneReady()) return
      mr.disconnect()
      const p = want.current, S = s3d(); want.current = null
      if (p && S && col.getAttribute('data-col') === p) { setUi({ catOpen: false }); S.playShow?.(p) } else setSt((s) => (s.st === 'wait' ? { st: 'idle', k: -1 } : s))
    })
    if (!sceneReady()) mr.observe(stage, { attributes: true, attributeFilter: ['data-ready'] })
    return () => { mo.disconnect(); mr.disconnect(); removeEventListener('net:show', on) }
  }, [])
  if (!part) return null
  const click = () => {
    if (st.st === 'wait') { want.current = null; setSt({ st: 'idle', k: -1 }); return }
    const S = s3d()
    if (!S || !sceneReady()) { want.current = part; setSt({ st: 'wait', k: -1 }); return }
    if (st.st === 'on') { S.stopShow?.(); return }
    setUi({ catOpen: false }) // the scene, not the catalog, while the demo plays
    S.playShow?.(part)
  }
  const label = st.st === 'on' ? w('show.stop') : st.st === 'done' ? w('show.replay') : w('show.play')
  return (
    <div className="net-show" data-st={st.st}>
      <div className="net-show-r">
        <button type="button" className="btn btn-line net-show-b" onClick={click} aria-pressed={st.st === 'on' || st.st === 'wait'} aria-busy={st.st === 'wait' || undefined}>
          <svg viewBox="0 0 16 16" aria-hidden="true">{st.st === 'on' ? <path d="M4 4h8v8H4z" /> : st.st === 'done' ? <path d="M12.5 8a4.5 4.5 0 1 1-1.3-3.2M12.5 2.8v2.6H9.9" /> : <path d="M5 3v10l8-5z" />}</svg>
          <span>{label}</span>
        </button>
        {/* once over, the steps keep the demo's values until Reset gives the visitor's own back */}
        {st.st === 'done' ? <button type="button" className="tlink net-show-x" onClick={() => s3d()?.stopShow?.()}>{w('show.reset')}</button> : null}
      </div>
      <p className="net-show-n lbl" data-ok={st.st === 'done' ? '1' : '0'} aria-live="polite">{st.st === 'wait' ? `${lg() === 'fr' ? 'Chargement de la salle en 3D' : 'Loading the 3D room'}…` : st.st === 'on' && st.k > 0 ? w('show.on', { n: Math.min(st.k + 1, part === 'use' ? 6 : 5) }) : st.st === 'done' ? w(`show.ok.${part}`) : w(`show.note.${part}`)}</p>
    </div>
  )
}

/** The column's buttons before the scene: views switch at once (preGo), Escape leaves a part, and a refusal asked before
 *  the room is ready plays once it is (the scene's own buttons take over as soon as its code runs). */
function useEarlyTaps() {
  useEffect(() => {
    let refus = false
    const click = (e: MouseEvent) => {
      if (sceneReady()) return
      const tg = e.target as Element | null
      const rb = tg?.closest?.('#refus') as HTMLButtonElement | null
      if (rb) {
        // the scene restarts its replay when it starts: the refusal waits for the room (the button says it is pending)
        e.stopImmediatePropagation(); refus = true; rb.setAttribute('aria-busy', 'true')
        return
      }
      if (s3d()) return // its code runs: its handlers switch the view, and its start keeps the view asked (the address)
      const b = tg?.closest?.('#net button[data-view], #net .net-x-panel') as HTMLElement | null
      if (!b) return
      const v = b.classList.contains('net-x-panel') ? 'ensemble' : b.dataset.view
      if (isView(v)) preGo(v)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || s3d() || e.defaultPrevented || document.querySelector('.hd-w-pop')) return
      if (document.getElementById('col')?.getAttribute('data-col') !== 'ensemble') preGo('ensemble')
    }
    const stage = document.getElementById('stage')
    const mr = new MutationObserver(() => {
      if (!sceneReady()) return
      mr.disconnect(); document.getElementById('refus')?.removeAttribute('aria-busy')
      if (refus && document.getElementById('col')?.getAttribute('data-col') === 'rent') s3d()?.refus?.()
      refus = false
    })
    if (stage && !sceneReady()) mr.observe(stage, { attributes: true, attributeFilter: ['data-ready'] })
    document.addEventListener('click', click, true); addEventListener('keydown', key)
    return () => { mr.disconnect(); document.removeEventListener('click', click, true); removeEventListener('keydown', key) }
  }, [])
}

export function NetworkPage() {
  useLang()
  const col = useRef<HTMLElement>(null)
  useIn(col, 1)
  useEffect(() => { document.title = t('net.doc') }, [])
  // a page opened on a part: its title and sentence are in place before the first paint (scene.ts renderPanel writes
  // the same texts once the 3D is ready), so the scene below them never moves
  useLayoutEffect(() => {
    if (!isPart(F0)) return
    const P = parts()[F0], put = (id: string, s: string) => { const e = document.getElementById(id); if (e && !e.textContent) e.textContent = s }
    put('p-kick', P.kicker); put('p-title', P.title); put('p-actor', P.actor)
    const r = document.getElementById('refus'); if (r) r.hidden = F0 !== 'rent'
  }, [])
  // the scene mounts once the DOM is ready (it reads its elements by id); until then the column answers by itself
  useEffect(() => { import('./scene') }, [])
  useEarlyTaps()
  return (
    <>
      <a className="skip" href="#choices" data-front-free>{t('net.skip')}</a>
      <AppHeader page="network" section="net.sec" wallet={<HeaderWallet />} />
      <main className="app network">
        <section className="s3d" aria-label={t('net.sec')}>
          <div className="net" id="net">
            <aside className="net-col" id="col" data-col={F0}>
              {/* The overview has the landing hero interface: the catchline, the support line,
                  the buttons in a row; below, the demo and two discreet entries (Arc, CCTP) */}
              <section className="net-choices txt" id="choices" aria-labelledby="choose-t" ref={col} hidden={F0 !== 'ensemble'}>
                <NetCatch />
                <p className="support net-support">{t('net.lede')}</p>
                <h2 className="sr-only" id="choose-t">{t('net.choose')}</h2>
                {/* as on the landing hero: under the text, the two live links (animated icon, soft breathing light), then
                    the three buttons, then the demo */}
                <div className="net-links" data-front-free>
                  <button type="button" className="tlink net-arc net-live" data-view="arc"><svg className="hero-ic net-ic-arc" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16.5 L10 3.5 L16 16.5" className="ic-a" /><path d="M6.6 11.6 H13.4" className="ic-a ic-a2" /><circle cx="10" cy="3.5" r="1.3" className="ic-dot" /></svg><span>{t('net.arc')}</span></button>
                  <button type="button" className="tlink net-cctp net-live" data-view="cctp"><svg className="hero-ic net-ic-cctp" viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="14" r="2.2" className="ic-node" /><circle cx="16" cy="14" r="2.2" className="ic-node" /><path d="M5.6 12.4 C 8 5.5, 12 5.5, 14.4 12.4" className="ic-arc" /><circle r="1.3" className="ic-pkt"><animateMotion dur="2.4s" repeatCount="indefinite" path="M5.6 12.4 C 8 5.5, 12 5.5, 14.4 12.4" /></circle></svg><span>{t('net.cctp')}</span></button>
                </div>
                <div className="ctas net-ctas" data-front-free>
                  {PARTS.map((p) => (
                    <button key={p.k} type="button" className={`btn ${p.kind} net-part`} data-view={p.k} data-part={p.k}><span>{t(p.label)}</span></button>
                  ))}
                </div>
                <p className="net-more" data-front-free>
                  <button type="button" className="btn btn-arc net-demo" data-view="demo"><span>{t('net.demo')}</span></button>
                </p>
              </section>
              <section className="panel" id="panel" aria-live="polite" hidden={F0 === 'ensemble' || F0 === 'demo'}>
                <CloseFocus />
                <button className="back" type="button" data-view="ensemble">{t('net.back')}</button>
                <p className="kick" id="p-kick" />
                <h2 className="h2 ttl in p-title-w"><span className="ttl-m"><span className="ttl-t" id="p-title" /></span><span className="ttl-rule" aria-hidden="true" /></h2>
                <p className="lead" id="p-actor" />
                <PlayDemo />
                <button className="refus-b" id="refus" type="button" hidden>{t('net.refus')}</button>
                <a className="tlink net-browse" id="browse" href={link.catalog} hidden>{t('net.browse')}</a>
                <ol className="steps" id="steps" />
                <Actions />
              </section>
            </aside>
            <div className="net-scene">
              <div className="stage" id="stage" data-view={F0 === 'ensemble' ? undefined : F0}>
                <canvas id="gl" role="img" aria-label={t('net.canvas')} />
                {/* the page shows before the 3D room (on a slow network it can take a few seconds): a quiet line where the
                    room will appear, gone when the scene is ready (network.css) */}
                <p className="net-load mono" aria-hidden="true">{lg() === 'fr' ? 'Chargement de la salle en 3D' : 'Loading the 3D room'}</p>
                <svg className="mlinks" id="mlinks" aria-hidden="true" width="100%" height="100%" />
                <div className="modals" id="modals" aria-live="polite" />
                <div className="sel" id="sel" aria-hidden="true" />
                <span className="pk-label" id="pk-label" hidden />
                <figure className="net-nogl" id="nogl" hidden>
                  <img src="/net/poster.jpg" alt={t('net.poster')} width="1600" height="1000" loading="lazy" decoding="async" />
                  <span className="net-still">{t('net.still')}</span>
                  <figcaption>{t('net.nogl')}</figcaption>
                </figure>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
