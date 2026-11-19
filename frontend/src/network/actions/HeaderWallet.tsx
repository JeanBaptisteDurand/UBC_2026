// The visitor's wallet in the header, top right, on every page of the app (AppFrame).
// Nothing heavy on first render: the engine (viem, the SDK) loads on the "Connect wallet" click.
import { useEffect, useRef, useState } from 'react'
import { useLang } from '../../i18n'
import { short, usdc } from '../../data/fmt'
import { addr } from '../../links'
import { useWallet, setWallet, engine, ARC_ID, onPhone } from './store'
import { w } from './strings'
import { useEngine } from './kit'
import { spText } from '../../space/strings'

// ---------- the wallet, in the header (top right, next to Console and the language) ----------
/** quiet: the popup does not open on its own on another network (the bridge page moves the wallet across chains) */
export function HeaderWallet({ quiet = false }: { quiet?: boolean } = {}) {
  const lang = useLang()
  const s = useWallet()
  const E = useEngine()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // the wallet connected in this tab comes back on another page, without a prompt (wallet.ts, resume)
  useEffect(() => { try { if (sessionStorage.getItem('archive-wallet') === '1') void engine().then((e) => e.resume()) } catch { /* storage unavailable */ } }, [])
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    // Escape first closes the wallet popup, without leaving the scene focus
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); e.stopPropagation(); box.current?.querySelector<HTMLElement>('.hd-w-b')?.focus() } }
    addEventListener('pointerdown', out); addEventListener('keydown', esc, true)
    return () => { removeEventListener('pointerdown', out); removeEventListener('keydown', esc, true) }
  }, [open])
  // a refusal, an error or the choice between several wallets shows below the button
  useEffect(() => { if (s.phase === 'pick' || s.note) setOpen(true) }, [s.phase, s.note])
  const connected = s.phase === 'connected' && !!s.address
  const wrong = connected && s.chainId !== ARC_ID
  // connected on another network: the popup opens on its own, with the Switch to Arc button in view
  useEffect(() => { if (wrong && !quiet) setOpen(true) }, [wrong, quiet])
  const busy = s.phase === 'loading' || s.phase === 'connecting'
  // no wallet in this browser, on a touch screen: browser extensions cannot be installed there, so the page offers
  // to open itself in a wallet app, or the demo, which needs no wallet
  const phone = s.phase === 'none' && onPhone()
  // the engine (viem, the SDK) loads on the first click: the button says it is waiting at once, a load that fails says so
  const begin = () => {
    setOpen(false)
    setWallet({ phase: 'loading', note: undefined })
    engine().then((e) => e.start()).catch(() => setWallet({ phase: 'idle', note: { tone: 'bad', text: w('w.loadFail') } }))
  }
  // hovering or focusing the button already fetches the engine, so the click answers sooner
  const warm = () => { void engine().catch(() => undefined) }
  const click = () => { if (!connected && s.phase !== 'pick' && !busy) begin(); else setOpen((o) => !o) }
  // while the wallet answers, phones show a short label (actions.css, .hd-w-s): the full one stays the button's name
  const name = connected ? `${short(s.address!, 4)}, ${wrong ? w('w.wrong') : w('w.arc')}` : busy ? w('w.connecting') : w('w.connect')
  return (
    <div className="hd-wallet" ref={box} data-st={connected ? (wrong ? 'wrong' : 'ok') : 'off'}>
      <button type="button" className="lang hd-w-b" id="connect" onClick={click} onPointerEnter={warm} onFocus={warm} aria-label={name} data-busy={busy ? '1' : undefined} aria-expanded={connected || s.phase === 'pick' || s.note ? open : undefined} aria-haspopup={connected ? 'dialog' : undefined} disabled={busy}>
        {connected ? (
          <><span className="hd-w-dot" aria-hidden="true" /><span className="mono">{short(s.address!, 4)}</span><span className="hd-w-net">{wrong ? w('w.wrong') : w('w.arc')}</span></>
        ) : <><span className="hd-w-l">{busy ? w('w.connecting') : w('w.connect')}</span>{busy ? <span className="hd-w-s" aria-hidden="true">{w('w.connectingS')}</span> : null}</>}
      </button>
      {open ? (
        <div className="hd-w-pop" role="dialog" aria-label={w('w.menu')}>
          {s.phase === 'pick' ? (
            <div className="wb-pick" role="group" aria-label={w('w.pick')}>
              <p className="lbl muted">{w('w.pick')}</p>
              {s.wallets.map((x) => <button key={x.id} type="button" className="btn btn-line btn-s" onClick={() => E?.connect(x.id)}>{x.icon ? <img src={x.icon} alt="" width="16" height="16" /> : null}<span>{x.name}</span></button>)}
            </div>
          ) : null}
          {connected ? (
            <dl className="wb">
              <div><dt className="lbl">{w('w.addr')}</dt><dd><a className="tlink mono" href={addr(s.address)} target="_blank" rel="noreferrer">{short(s.address!, 6)}</a></dd></div>
              <div><dt className="lbl">{w('w.net')}</dt><dd className="mono" data-ok={wrong ? '0' : '1'}>{wrong ? w('w.wrong') : w('w.arc')}</dd></div>
              <div><dt className="lbl">{w('w.bal')}</dt><dd className="mono tnum">{wrong ? w('w.switchToRead') : s.balance === undefined ? w('w.reading') : s.balance === null ? w('w.unread') : usdc(s.balance.toString(), lang)}</dd></div>
            </dl>
          ) : null}
          {phone ? <p className="na-note" data-tone="muted" role="status">{w('w.nonePhone')}</p> : s.note ? <p className="na-note" data-tone={s.note.tone} role="status">{s.note.text}</p> : null}
          {phone ? (
            <div className="hd-w-apps">
              <a className="btn btn-main btn-s" href={`https://metamask.app.link/dapp/${location.host}${location.pathname}${location.search}`}><span>{w('w.openIn', { app: 'MetaMask' })}</span></a>
              <a className="btn btn-line btn-s" href={`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(location.href)}`}><span>{w('w.openIn', { app: 'Coinbase Wallet' })}</span></a>
              <a className="btn btn-line btn-s" href={`${import.meta.env.BASE_URL}network.html?focus=demo`}><span>{w('show.play')}</span></a>
            </div>
          ) : null}
          {connected || (s.phase !== 'pick' && !phone) ? (
            <div className="wb-acts">
              {wrong ? <button type="button" className="btn btn-main btn-s" onClick={() => E?.switchToArc()} disabled={s.switching}><span>{s.switching ? w('w.switching') : w('w.switch')}</span></button> : null}
              {connected && !wrong ? <a className="btn btn-line btn-s wb-space" href={`${import.meta.env.BASE_URL}space.html`}><span>{spText(lang, 'sp.nav')}</span></a> : null}
              {connected ? <button type="button" className="tlink wb-off" onClick={() => { E?.disconnect(); setOpen(false) }}>{w('w.disconnect')}</button> : null}
              {!connected ? <button type="button" className="btn btn-main btn-s" onClick={begin}><span>{w('w.connect')}</span></button> : null}
              {/* no wallet in this browser: the demo needs none */}
              {s.phase === 'none' ? <a className="btn btn-line btn-s" href={`${import.meta.env.BASE_URL}network.html?focus=demo`}><span>{w('show.play')}</span></a> : null}
            </div>
          ) : null}
          {!connected ? <p className="lbl muted wb-who">{w('w.who')}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
