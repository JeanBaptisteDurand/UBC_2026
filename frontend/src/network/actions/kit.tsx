// Shared pieces of the signed actions: steps, fields, notes, the wallet engine loaded on demand, and the link with the
// Network page diagram (window.__s3d, absent elsewhere: nothing moves then).
// This module pulls in neither three nor the scene: app pages import it without weighing down their load.
import { useEffect, useState, type ReactNode } from 'react'
import { short } from '../../data/fmt'
import { tx as txUrl } from '../../links'
import { useWallet, engine, onArc, ARC_ID, type WalletState } from './store'
import { w, type WKey } from './strings'

export type Part = 'use' | 'rent' | 'publish'
export type St = 'todo' | 'doing' | 'done' | 'fail' | 'soon'
export type Engine = Awaited<ReturnType<typeof engine>>
export interface Note { tone: 'bad' | 'muted' | 'ok'; text: string; hash?: string; href?: string; hrefLabel?: string }

// ---------- the diagram follows the step ----------
interface S3d { go?: (v: string, el?: string) => void; focusCamera?: (p: string, el?: string) => void; seekPlay?: (t: number) => void; overview?: () => void; playStep?: (p: string, i: number, st?: string) => void }
const s3d = () => (window as unknown as { __s3d?: S3d }).__s3d
/** The animation follows the flow: __s3d.playStep(part, action step index, state) when the scene exposes it.
 *  Index: Use 0 connect, 1 choice, 2 key, 3 sealed and paid, 4 response, 5 settlement; Rent 0 connect, 1 bond,
 *  2 agent, 3 pairing, 4 admission; Publish 0 connect, 1 manifest, 2 hash and shares, 3 proposal, 4 review. */
export function play(part: Part, i: number, st: St, el: string, user: boolean) {
  const S = s3d(); if (!S) return
  if (S.playStep) { S.playStep(part, i, st); return }
  if (user) show(part, el, true)
}
/** When the active step or its state changes, the scene replays the step (only if playStep exists: otherwise nothing moves). */
/** What the page knows about the flow, for the scene: the real state of each step, and the context.
 *  window.__netFlow keeps it up to date; the "net:flow" event (detail = the same object) fires on each change. */
export interface NetFlow { part: Part; active: number; steps: St[]; connected: boolean; onArc: boolean; address?: string; pid?: string; tx?: string }
export function usePlay(part: Part, active: number, sts: St[], ctx: { pid?: string; tx?: string } = {}) {
  const s = useWallet()
  const key = `${active}:${sts.join(',')}:${ctx.pid ?? ''}:${ctx.tx ?? ''}:${s.address ?? ''}:${s.chainId ?? ''}`
  useEffect(() => {
    const flow: NetFlow = { part, active, steps: sts, connected: s.phase === 'connected', onArc: onArc(s), address: s.address, pid: ctx.pid, tx: ctx.tx }
    ;(window as unknown as { __netFlow?: NetFlow }).__netFlow = flow
    dispatchEvent(new CustomEvent('net:flow', { detail: flow }))
    const S = s3d()
    // the active step with its real state; once everything is done, the last one as "done" (the scene chains its final steps)
    if (active >= 0) S?.playStep?.(part, active, sts[active])
    else S?.playStep?.(part, sts.length - 1, 'done')
  }, [part, key]) // eslint-disable-line react-hooks/exhaustive-deps
}
export function exitFocus() { const S = s3d(); if (S?.overview) S.overview(); else S?.go?.('ensemble') }
export function show(part: Part, el: string, replay: boolean) {
  const S = s3d(); if (!S) return
  // focusCamera(part) when the scene exposes it; otherwise go(part, el)
  if (S.focusCamera) S.focusCamera(part, el); else S.go?.(part, el)
  void replay // playStep drives the replay
}

export function useEngine(): Engine | null {
  const s = useWallet()
  const [e, setE] = useState<Engine | null>(null)
  useEffect(() => { if (s.phase !== 'idle' || e) engine().then(setE) }, [s.phase, e])
  return e
}

// ---------- pieces ----------
const ST_KEY: Record<St, WKey> = { todo: 'st.todo', doing: 'st.doing', done: 'st.done', fail: 'st.fail', soon: 'st.soon' }
export function Step({ n, part, el, st, t, d, children, note, active }: { n: number; part: Part; el: string; st: St; t: string; d: string; children?: ReactNode; note?: Note | null; active?: boolean }) {
  return (
    <li className="na" data-st={st} data-on={active ? '1' : '0'}>
      <button type="button" className="na-h" onClick={() => play(part, n - 1, st, el, true)} aria-current={active ? 'step' : undefined}>
        <span className="na-n tnum">{String(n).padStart(2, '0')}</span>
        <span className="na-t">{t}</span>
        <span className="na-st mono">{w(ST_KEY[st])}</span>
      </button>
      <p className="na-d">{d}</p>
      {children ? <div className="na-b">{children}</div> : null}
      {note ? <NoteLine n={note} /> : null}
    </li>
  )
}
export function NoteLine({ n }: { n: Note }) {
  return (
    <p className="na-note" data-tone={n.tone} role={n.tone === 'bad' ? 'alert' : 'status'}>
      {n.text}
      {n.hash ? <> <a className="tlink mono" href={txUrl(n.hash)} target="_blank" rel="noreferrer">{`${w('tx.label')} ${short(n.hash, 4)}`}</a></> : null}
      {n.href ? <> <a className="tlink" href={n.href} target="_blank" rel="noreferrer">{n.hrefLabel}</a></> : null}
    </p>
  )
}
export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`na-f${wide ? ' na-f-w' : ''}`}><span className="lbl">{label}</span>{children}</label>
}
export const errNote = (E: Engine | null, e: unknown): Note => {
  const x = E ? E.explain(e) : { message: String((e as Error)?.message ?? e), hash: undefined }
  return { tone: 'bad', text: x.message, hash: x.hash }
}

/** Step 1 of each part: connected on Arc. */
export function connectSt(s: WalletState): St { return onArc(s) ? 'done' : s.phase === 'connecting' || s.phase === 'loading' || s.switching ? 'doing' : 'todo' }
export function ConnectStep({ part, el, k, active }: { part: Part; el: string; k: 'u' | 'r' | 'p'; active: boolean }) {
  const s = useWallet()
  // a plain state, read in the header: the wallet button only lives up there
  const note: Note = s.phase === 'connected' && s.chainId !== ARC_ID ? { tone: 'bad', text: w('e.wrongNet') }
    : onArc(s) && s.address ? { tone: 'ok', text: w('s1.ok', { addr: short(s.address, 4) }) } : { tone: 'muted', text: s.note?.text ?? w('s1.need') }
  return <Step n={1} part={part} el={el} st={connectSt(s)} t={w(`${k}.s1` as WKey)} d={w(`${k}.s1d` as WKey)} note={note} active={active} />
}
