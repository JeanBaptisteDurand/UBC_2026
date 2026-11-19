// Shared parts of the work pages: the copyable command, the path in real steps, and a page's entry point (shared
// clock without smooth scroll, live reading, __frontReady on the first reading).
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { t, useLang, type TKey } from '../i18n'
import { x } from '../network/actions/strings-x'
import { startClock } from '../clock'
import { startLive, getLive, subscribeLive } from '../data/live'

/** Copies a text: the clipboard API, then the old way (a selected, hidden field). False when the browser refuses both
 *  (an in-app browser, a blocked permission). */
export async function copyText(text: string): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true } } catch { /* refused: the old way */ }
  try {
    const prev = document.activeElement as HTMLElement | null
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.setAttribute('aria-hidden', 'true')
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px'
    document.body.appendChild(ta)
    ta.focus({ preventScroll: true })
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    prev?.focus?.({ preventScroll: true })
    return ok
  } catch { return false }
}
/** Copying was refused: the text is selected on screen, so the visitor copies it by hand. */
export function selectText(el: Element | null) {
  if (!el) return
  try { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r) } catch { /* nothing to select */ }
}
const coarse = () => { try { return matchMedia('(pointer: coarse)').matches } catch { return false } }
/** "Copied", or, when the browser refused, the text selected and how to copy it by hand: never a silent button */
export function useCopy(text: string, el: React.RefObject<Element | null>) {
  const [st, setSt] = useState<'idle' | 'done' | 'hand'>('idle')
  const tm = useRef(0)
  useEffect(() => () => clearTimeout(tm.current), [])
  const copy = () => {
    void copyText(text).then((ok) => {
      if (!ok) selectText(el.current)
      setSt(ok ? 'done' : 'hand')
      clearTimeout(tm.current)
      tm.current = window.setTimeout(() => setSt('idle'), ok ? 1600 : 8000)
    })
  }
  const hint = st === 'hand' ? <p className="lbl copy-h" role="status">{x(coarse() ? 'p.copyHold' : 'p.copySel')}</p> : null
  return { done: st === 'done', copy, hint }
}

// the visitor moved first (a wheel, a touch, a key, a click): a link to a part of the page no longer moves it
let moved = false
for (const k of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) addEventListener(k, () => { moved = true }, { capture: true, passive: true, once: true })
/** Holds the section at the top of the screen while the page around it settles: readings that arrive above it push it
 *  down, a lazy part below it not loaded yet leaves the page too short to bring it up (the old publish.html#act landed
 *  200 px low on a phone). It stops as soon as the visitor moves, when the copilot shows the site, and after 10 s. */
function holdOn(id: string) {
  if (moved) return
  let stop = false
  /** true when it had to scroll */
  const at = () => {
    const e = document.getElementById(id)
    if (!e) return false
    const want = parseFloat(getComputedStyle(e).scrollMarginTop) || 0
    if (Math.abs(e.getBoundingClientRect().top - want) <= 4) return false
    e.scrollIntoView({ block: 'start' })
    return true
  }
  const end = () => { stop = true; ro?.disconnect(); clearTimeout(tm) }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (stop) return
    if (moved || document.querySelector('.gd-pop, .cp-panel.is-driving')) { end(); return }
    // the page grew below the section without a scroll (the steps of a lazy part): what follows the scroll (the copilot
    // button, lifted above a footer that was in view a moment ago) reads the layout again
    if (!at()) dispatchEvent(new Event('scroll'))
  }) : null
  at()
  ro?.observe(document.body)
  const tm = window.setTimeout(end, 10000)
}
/** A link to a part of a page (space.html?tab=machines#keys, space.html?tab=bounties#create): the page scrolls there once what sits
 *  above it has rendered, and holds it there while the rest arrives. The browser's own jump happens before the sections
 *  and the live readings arrive, and left the visitor at the top of the page. Without the readings (an API that does
 *  not answer), the jump still happens after a moment. */
export function useHashScroll(ready: boolean) {
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    let id = ''
    try { id = decodeURIComponent(location.hash.slice(1)) } catch { /* a malformed hash: no section */ }
    if (!/^[\w-]{1,40}$/.test(id)) { started.current = true; return }
    const tm = window.setTimeout(() => { if (!started.current) { started.current = true; holdOn(id) } }, ready ? 120 : 2500)
    return () => clearTimeout(tm)
  }, [ready])
}

/** a copyable terminal command (the console has the same: CopyLine) */
export function Cmd({ cmd }: { cmd: string }) {
  useLang()
  const code = useRef<HTMLElement>(null)
  const c = useCopy(cmd, code)
  return (
    <>
      <div className="cmd">
        {/* where the command wraps (phones, the level cards), it breaks at its spaces, never inside --flag: each word
            is a box of its own (app.css, .cmd-w); the text, copied or selected, is unchanged */}
        <code className="mono cmd-t" ref={code}>{cmd.split(/( +)/).map((p, i) => (i % 2 ? p : <span key={i} className="cmd-w">{p}</span>))}</code>
        <button className="cmd-b" onClick={c.copy} aria-label={`${t('p.copy')}: ${cmd}`}>{c.done ? t('p.copied') : t('p.copy')}</button>
      </div>
      {c.hint}
    </>
  )
}

export interface PathStep { k: string; cmd?: string; proof?: React.ReactNode; extra?: React.ReactNode }
/** a path whose order is real (numbering allowed): each step, what happens, the command, the proof */
export function Path({ steps, prefix }: { steps: PathStep[]; prefix: string }) {
  useLang()
  return (
    <ol className="path unfold">
      {steps.map((s, j) => (
        <li key={s.k} className="row path-s" style={{ ['--j' as string]: j }} data-copilot={`${prefix}-${s.k}`}>
          <span className="path-n mono" aria-hidden="true">{String(j + 1).padStart(2, '0')}</span> {/* numbering of a real sequence */}
          <div className="path-b">
            <h3 className="path-t">{t(`${prefix}.${s.k}.t` as TKey)}</h3>
            <p className="path-d">{t(`${prefix}.${s.k}.d` as TKey)}</p>
            {s.cmd ? <Cmd cmd={s.cmd} /> : null}
            {s.extra}
            {s.proof ? <div className="path-p"><span className="lbl path-pl">{t('p.proof')}</span><div className="path-pv" data-front-free>{/* a sentence with its links: its pieces are not alignment edges */}{s.proof}</div></div> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function bootPage(el: React.ReactElement, docTitle: string) {
  const w = window as unknown as { __frontReady: boolean }
  w.__frontReady = false
  document.documentElement.classList.add('js', 'app-page')
  document.documentElement.dataset.title = docTitle
  document.title = docTitle
  startLive({ levels: true })
  startClock({ smooth: false })
  // first render synchronous: the header is on screen at the page's first frame, so it stays in place across the
// page transition (motion rule M1, ui/motion.ts)
flushSync(() => createRoot(document.getElementById('root')!).render(el))
  const ready = () => { if (getLive().status !== 'loading') { off(); Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => requestAnimationFrame(() => { w.__frontReady = true })) } }
  const off = subscribeLive(ready)
  ready()
  setTimeout(() => { w.__frontReady = true }, 12000)
}
