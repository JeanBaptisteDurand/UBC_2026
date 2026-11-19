// Shared parts of the work pages: the copyable command, the path in real steps, and a page's entry point (shared
// clock without smooth scroll, live reading, __frontReady on the first reading).
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { t, useLang, type TKey } from '../i18n'
import { startClock } from '../clock'
import { startLive, getLive, subscribeLive } from '../data/live'

/** a copyable terminal command (the console has the same: CopyLine) */
export function Cmd({ cmd }: { cmd: string }) {
  useLang()
  const [done, setDone] = useState(false)
  const copy = () => { navigator.clipboard?.writeText(cmd).then(() => { setDone(true); setTimeout(() => setDone(false), 1600) }).catch(() => {}) }
  return (
    <div className="cmd">
      <code className="mono cmd-t">{cmd}</code>
      <button className="cmd-b" onClick={copy} aria-label={`${t('p.copy')}: ${cmd}`}>{done ? t('p.copied') : t('p.copy')}</button>
    </div>
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
