// Parts of the pages that sign in place: a plain service status, the wallet line, and the frame of an action section.
// Classes come from the app (app.css) and the actions (actions.css, under .acts).
import type { ReactNode } from 'react'
import { useLang } from '../i18n'
import { short } from '../data/fmt'
import { tx as txUrl } from '../links'
import { useWallet, onArc, ARC_ID } from '../network/actions/store'
import type { Probe } from '../network/actions/probe'
import { x, type XKey } from '../network/actions/strings-x'

const PROBE: Record<Probe, { k: XKey; led: string }> = {
  checking: { k: 'svc.checking', led: 'led' }, up: { k: 'svc.up', led: 'led led-green' }, offline: { k: 'svc.offline', led: 'led led-red' },
  cors: { k: 'svc.cors', led: 'led led-amber' }, insecure: { k: 'svc.insecure', led: 'led led-amber' }, error: { k: 'svc.error', led: 'led led-red' },
}
/** "online", "service offline", "origin refused", "HTTPS required": the status as read, never assumed */
export function ServiceState({ p, name, url }: { p: Probe; name: string; url?: string }) {
  useLang()
  const s = PROBE[p]
  return (
    <p className="svc-state lbl" data-p={p} role="status">
      <span className={s.led} aria-hidden="true" />
      <span className="svc-state-n">{name}</span>
      <span className="svc-state-v">{x(s.k)}</span>
      {url ? <span className="mono muted svc-state-u">{url.replace(/^https?:\/\//, '')}</span> : null}
    </p>
  )
}

/** the visitor's wallet status, with what to do next (the button is at the top right) */
export function WalletLine() {
  useLang()
  const s = useWallet()
  const text = s.phase === 'connected' && s.chainId !== ARC_ID ? x('wl.wrong') : onArc(s) && s.address ? x('wl.ok', { addr: short(s.address, 4) }) : x('wl.need')
  return <p className="na-note wl" data-tone={onArc(s) ? 'ok' : s.phase === 'connected' ? 'bad' : 'muted'} role="status">{text}</p>
}

export function TxA({ hash }: { hash?: string | null }) {
  if (!hash) return null
  return <a className="tlink mono" href={txUrl(hash)} target="_blank" rel="noreferrer">{short(hash, 4)}</a>
}

/** an action section: title, lead, and the steps under .acts; copilot: its name for the copilot's guided tours */
export function ActSec({ id, title, lede, children, side, copilot }: { id: string; title: string; lede?: string; children: ReactNode; side?: ReactNode; copilot?: string }) {
  return (
    <section className="work-sec acts" id={id} aria-labelledby={`${id}-h`} data-copilot={copilot}>
      <div className="acts-top">
        <h2 className="work-h" id={`${id}-h`}>{title}</h2>
        {side}
      </div>
      {lede ? <p className="lbl muted work-lede">{lede}</p> : null}
      {children}
    </section>
  )
}
