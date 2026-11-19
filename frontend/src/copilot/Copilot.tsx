// The site copilot: a floating button and a panel in the interface grammar (flat fills without radius, one-pixel
// rules, Montserrat, Fragment Mono for data). The conversation goes to the server copilot ("site" surface) with the
// open page; its interface tools are played on the site (driver.ts), its prepared actions become cards signed by the
// user's wallet (cards.tsx), and the MCP card gives the same tools to an agent. Keyboard: focus stays in the panel
// (Tab, Shift+Tab), Escape closes it and returns focus to the button. Phone (under 640 px): a full-width sheet,
// collapsed while the copilot shows the site.
import { AskHiveMark } from './AskHiveMark'
import { useEnc, useLeg, checkEnclave } from './enclave'
import { EXPLORER } from '../data/endpoints'
import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react'
import { useLang } from '../i18n'
import { ct, suggestions } from './strings'
import { Markdown, Code, short } from './markdown'
import { ActionCard, InfoCard, isInfo } from './cards'
import { useCopilot, getState, setState, setCard, newId, logStep, saveQueue, setOwner, type Msg } from './state'
import { ask, stripCitations, MCP_URL, type UiStep, type ChatTurn } from './api'
import { drive, type DriveHooks } from './driver'
import { pageOf } from './page'
import { useCatalog } from '../app/useCatalog'
import { serviceHref } from '../links'
import { useWallet, getWallet, connect, toArc, forget, clearError, addrUrl, ARC } from './wallet'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
const phone = () => matchMedia('(max-width: 640px)').matches
const touch = () => matchMedia('(pointer: coarse)').matches

/** A response's gestures, played on the site; their log is written below that response. */
export function hooksFor(msgId: string): DriveHooks {
  return {
    log: (line) => logStep(msgId, line),
    leave: (target, rest) => { setState({ open: true }); saveQueue({ at: Date.now(), target, msgId, steps: rest }) },
    drive: (on) => setState({ driving: on }),
    hide: () => setState({ open: false, driving: false }),
  }
}
export function play(msgId: string, steps: UiStep[]) { return drive(steps, hooksFor(msgId)) }

/** Answers that just arrived: they unfold block by block once (JB, 19/11: "the text pops all at once") */
const fresh = new Set<string>()

/** While AskHive answers (JB, 19/11: "nothing shows it is thinking"): the real steps of the round trip. Sealed to the
 *  enclave: the question is sealed here first, then the enclave answers (its signature is checked on arrival). */
function Thinking() {
  useLang()
  // sealed only while the question really goes to the enclave: once it falls back to the server, the line says so
  const enc = useEnc().status, leg = useLeg()
  const sealed = enc === 'on' && leg === 'enclave'
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const t0 = performance.now()
    const h = setInterval(() => setSecs(Math.floor((performance.now() - t0) / 1000)), 250)
    return () => clearInterval(h)
  }, [])
  const step = sealed ? ct(secs < 1 ? 'think.seal' : 'think.enclave') : ct('think.server')
  return (
    <p className="cp-typing" role="status">
      <i /><i /><i />
      <span className="cp-think">{step}{secs >= 3 ? <span className="cp-think-t mono"> · {secs} s</span> : null}</span>
    </p>
  )
}

async function send(text: string) {
  const content = text.trim().slice(0, 4000)
  if (!content || getState().busy || getState().showing) return
  const user: Msg = { id: newId(), role: 'user', content }
  setState((s) => ({ msgs: [...s.msgs, user], busy: true }))
  const history: ChatTurn[] = getState().msgs.filter((m) => !m.local && m.content).map(({ role, content }) => ({ role, content }))
  const a = await ask(history, getWallet().address ?? null, getState().msgs.some((m) => m.sealed))
  const id = newId()
  if (!a.ok) { setState((s) => ({ msgs: [...s.msgs, { id, role: 'assistant', content: a.text, local: true }], busy: false })); return }
  const p = a.parsed
  const msg: Msg = { id, role: 'assistant', content: p.text || (p.cards.length || p.ui.length ? '' : ct('err.empty')), citations: p.citations, tools: p.toolNames, cards: p.cards }
  fresh.add(id)
  setTimeout(() => fresh.delete(id), 4000)
  msg.route = a.route
  if (a.down) msg.down = true
  if (a.route === 'enclave') { msg.sealed = true; setState((s) => ({ msgs: s.msgs.map((m) => (m.id === user.id ? { ...m, sealed: true } : m)) })) }
  if (!p.text && !p.cards.length && !p.ui.length) msg.local = true
  // gestures play before any new question (showing); if they change page, the resume on the new page keeps the
  // same lock (mount.tsx)
  setState((s) => ({ msgs: [...s.msgs, msg], busy: false, showing: p.ui.length > 0 }))
  if (p.ui.length) void play(id, p.ui).finally(() => setState({ showing: false }))
}

/** The enclave badge (JB's, 19/11): what AskHive runs on, read on Arc; a click opens the proof */
function EnclaveBadge({ svc }: { svc?: string }) {
  const lang = useLang()
  const e = useEnc()
  const [open, setOpen] = useState(false)
  useEffect(() => { void checkEnclave() }, [])
  const st = e.status === 'idle' ? 'checking' : e.status
  // the key is verified but the last answer came from the ArcHive server (the enclave did not answer): the badge
  // says so, never "sealed" for an answer that was not
  const lastSrv = useCopilot((s) => s.msgs.filter((m) => m.role === 'assistant' && !m.local).slice(-1)[0]?.route === 'server')
  const d = st === 'on' && lastSrv ? 'srv' : st
  const a = d === 'checking' ? ct('enc.checking') : ct(`enc.${d}.a` as never)
  const b = d === 'checking' ? '' : ct(`enc.${d}.b` as never)
  const k = e.keys
  const ex = (kind: 'address' | 'block', v: string) => `${EXPLORER}/${kind}/${v}`
  const sh = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`
  const time = k ? new Date(k.checkedAtMs).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-US') : ''
  return (
    <div className={`cp-enc-w is-${d === 'srv' ? 'clear' : st}`}>
      <button type="button" className="cp-enc" aria-expanded={open} aria-controls="cp-proof" aria-label={`${a}${b ? `, ${b}` : ''}. ${ct('enc.aria')}`} disabled={st === 'checking'} onClick={() => setOpen(!open)}>
        <svg className="cp-enc-lock" viewBox="0 0 10 12" width="10" height="12" aria-hidden="true"><path d="M2.5 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" strokeWidth="1.2" /><rect x="1" y="5" width="8" height="6.4" fill="currentColor" /></svg>
        <span className="cp-enc-t"><span className="cp-enc-a">{a}</span>{b ? <span className="cp-enc-b">{b}</span> : null}</span>
        <i className="cp-enc-x" aria-hidden="true" />
      </button>
      {open && st !== 'checking' ? (
        <div id="cp-proof" className={`cp-proof ${st === 'on' ? '' : 'is-off'}`}>
          <p className="cp-card-h lbl">{ct('enc.h')}</p>
          {k ? (
            <dl className="cp-proof-l">
              <dt>{ct('enc.key')}</dt><dd><a className="cp-a mono" href={ex('address', k.signer)} target="_blank" rel="noreferrer">{sh(k.signer)}</a></dd>
              <dt>{ct('enc.op')}</dt><dd><a className="cp-a mono" href={ex('address', k.operator)} target="_blank" rel="noreferrer">{sh(k.operator)}</a></dd>
              <dt>{ct('enc.prod')}</dt><dd>{ct('enc.prod.v', { n: String(k.productId) })}</dd>
              <dt>{ct('enc.reg')}</dt><dd><a className="cp-a mono" href={ex('block', String(k.fromBlock))} target="_blank" rel="noreferrer">{ct('enc.blk', { n: String(k.fromBlock) })}</a></dd>
              <dt>{ct('enc.img')}</dt><dd className="mono">{sh(k.workloadId)}</dd>
              <dt>{ct('enc.quote')}</dt><dd>{ct('enc.quote.v', { tcb: k.tcbStatus === 0 ? ct('enc.tcb.0') : ct('enc.tcb.n', { n: k.tcbStatus }) })}</dd>
              <dt>{ct('enc.conv')}</dt><dd>{d === 'on' ? ct('enc.conv.on', { k: sh(k.x25519) }) : d === 'srv' ? ct('enc.conv.srv') : ct('enc.conv.clear')}</dd>
              <dt>{ct('enc.model')}</dt><dd>{ct('enc.model.v')}</dd>
              <dt>{ct('enc.checked')}</dt><dd className={st === 'on' ? 'cp-proof-ok' : ''}>{ct('enc.checked.v', { n: String(k.checkedAtBlock), t: time })}</dd>
            </dl>
          ) : <p className="cp-proof-p">{ct('enc.off.p', { why: ct(e.why === 'mismatch' ? 'enc.why.mismatch' : 'enc.why.unreachable') })}</p>}
          {svc ? <p className="cp-proof-p">{ct('svc')} <a className="cp-svc-a" href={serviceHref(svc)}>{ct('svcL')}<span aria-hidden="true"> →</span></a></p> : null}
          <div className="cp-proof-a"><button type="button" className="cp-ib" onClick={() => void checkEnclave(true)}>{ct('enc.again')}</button></div>
        </div>
      ) : null}
    </div>
  )
}

function WalletBar() {
  useLang()
  const w = useWallet()
  const [how, setHow] = useState(false)
  // the site wallet writes its own sentence (refused, pending, wrong site…): shown as it is
  const err = w.error === 'rejected' ? ct('wal.rejected') : w.error === 'pending' ? ct('wal.pending') : w.error ?? ''
  return (
    <div className="cp-wal" role="group" aria-label={ct('wal.label')}>
      {!w.has ? (
        <>
          <p className="cp-wal-s"><i className="cp-led is-off" aria-hidden="true" />{ct('wal.none')}</p>
          <button type="button" className="cp-ib" aria-expanded={how} onClick={() => setHow(!how)}>{ct('wal.how')}</button>
          {how ? <div className="cp-wal-how"><p>{ct('wal.howText')}</p><a className="cp-a" href="https://faucet.circle.com" target="_blank" rel="noreferrer noopener">{ct('wal.faucet')}</a></div> : null}
        </>
      ) : w.pick?.length && w.status !== 'connected' ? (
        <>
          {/* several wallets in this browser (EIP-6963): the choice, here (the landing has no header wallet) */}
          <p className="cp-wal-s"><i className="cp-led is-off" aria-hidden="true" />{ct('wal.pick')}</p>
          <ul className="cp-wal-pick">
            {w.pick.map((x) => <li key={x.id}><button type="button" className="cp-ib" onClick={() => void connect(x.id)}>{x.icon ? <img src={x.icon} alt="" width="16" height="16" /> : null}<span>{x.name}</span></button></li>)}
          </ul>
        </>
      ) : w.status !== 'connected' ? (
        <>
          <p className="cp-wal-s"><i className="cp-led is-off" aria-hidden="true" />{w.status === 'connecting' ? ct('wal.connecting') : ct('wal.off')}</p>
          <button type="button" className="cp-ib is-main" onClick={() => void connect()} disabled={w.status === 'connecting'}>{ct('wal.connect')}</button>
        </>
      ) : (
        <>
          <p className="cp-wal-s">
            <i className={`cp-led ${w.chainId === ARC.id ? 'is-ok' : 'is-warn'}`} aria-hidden="true" />
            <a className="cp-a mono" href={addrUrl(w.address!)} target="_blank" rel="noreferrer noopener" title={w.address}>{short(w.address!)}</a>
            <span className="cp-wal-n">{w.chainId === ARC.id ? ct('wal.arc') : ct('wal.other')}</span>
          </p>
          {w.chainId !== ARC.id ? <button type="button" className="cp-ib is-main" onClick={() => void toArc()}>{ct('wal.switch')}</button>
            : <button type="button" className="cp-ib" onClick={() => void forget()}>{ct('wal.forget')}</button>}
        </>
      )}
      {err ? <p className="cp-wal-e" role="alert">{err} <button type="button" className="cp-x" onClick={clearError} aria-label={ct('wal.dismiss')}>×</button></p> : null}
    </div>
  )
}

function Mcp() {
  useLang()
  const json = JSON.stringify({ mcpServers: { archive: { url: MCP_URL } } }, null, 2)
  return (
    <div className="cp-mcp">
      <p className="cp-mcp-t">{ct('mcp.title')}</p>
      <p className="cp-mcp-p">{ct('mcp.lede')}</p>
      <p className="cp-card-h lbl">{ct('mcp.server')}</p>
      <Code text={MCP_URL} label={ct('mcp.server')} />
      <p className="cp-card-h lbl">{ct('mcp.json')}</p>
      <Code text={json} label="JSON" />
      <p className="cp-card-h lbl">{ct('mcp.claude')}</p>
      <Code text={`claude mcp add --transport http archive ${MCP_URL}`} label="Claude Code" />
      <p className="cp-mcp-n">{ct('mcp.note')}</p>
    </div>
  )
}

function Message({ m }: { m: Msg }) {
  useLang()
  if (m.role === 'user') return <li className="cp-m is-user"><span className="sr-only">{ct('you')}: </span><p>{m.content}</p></li>
  return (
    <li className={`cp-m is-bot ${m.local ? 'is-err' : ''} ${fresh.has(m.id) ? 'is-fresh' : ''}`}>
      <span className="sr-only">{ct('copilot')}: </span>
      {m.down ? <p className="cp-route">{ct('route.down')}</p> : null}
      {m.content ? (m.local ? <p role="alert">{m.content}</p> : <Markdown text={stripCitations(m.content)} />) : null}
      {m.steps?.length ? <ul className="cp-steps mono" aria-label={ct('driving')}>{m.steps.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
      {m.cards?.map((c) => (isInfo(c) ? <InfoCard key={c.tool} c={c} /> : <ActionCard key={c.tool} c={c} cs={m.cardState?.[c.tool]} msgId={m.id} onAfter={(steps) => void play(m.id, steps)} />))}
      {m.citations?.length ? <p className="cp-src mono">{ct('sources', { list: m.citations.join(', ') })}</p> : null}
      {m.tools?.length ? <p className="cp-src mono">{ct('tools', { list: m.tools.join(', ') })}</p> : null}
    </li>
  )
}

export function Copilot() {
  useLang()
  const open = useCopilot((s) => s.open)
  const view = useCopilot((s) => s.view)
  const msgs = useCopilot((s) => s.msgs)
  const cpRows = useCatalog()
  const cpSvc = cpRows?.find((r) => r.svc === 'copilot' && r.role?.role !== 'superseded' && r.p.state !== 'Retired')?.p.id
  const busy = useCopilot((s) => s.busy)
  const driving = useCopilot((s) => s.driving)
  const showing = useCopilot((s) => s.showing)
  // a question is waiting for the server, or the response's gestures are still playing: send nothing more
  const locked = busy || showing
  // the conversation follows the connected wallet (state.ts setOwner): kept for it, back when it reconnects, off the
  // screen when it leaves; nothing is decided while a wallet is connecting
  const wal = useWallet()
  const owner = wal.status === 'connected' ? wal.address ?? null : wal.status === 'idle' ? null : undefined
  useEffect(() => { if (owner !== undefined) setOwner(owner) }, [owner])
  const [input, setInput] = useState('')
  const panel = useRef<HTMLElement>(null)
  const launch = useRef<HTMLButtonElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const [sheet, setSheet] = useState(phone)
  useEffect(() => { const mq = matchMedia('(max-width: 640px)'); const f = () => setSheet(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f) }, [])

  // on open, focus goes to the field (not on touch: the phone keyboard would cover the page)
  const wasOpen = useRef(open)
  useEffect(() => {
    if (open && !wasOpen.current) setTimeout(() => (touch() ? panel.current?.querySelector<HTMLElement>('.cp-close') : area.current)?.focus({ preventScroll: true }), 30)
    wasOpen.current = open
  }, [open])
  // a transaction sent on another page and not yet confirmed: its confirmation resumes on this one
  useEffect(() => {
    const pending = getState().msgs.flatMap((m) => Object.entries(m.cardState ?? {}).filter(([, cs]) => cs.phase === 'sent' && !!cs.tx).map(([tool, cs]) => ({ id: m.id, tool, cs })))
    if (!pending.length) return
    void import('./sign').then(({ confirm }) => {
      for (const { id, tool, cs } of pending) {
        confirm(cs.tx as `0x${string}`).then(
          () => setCard(id, tool, { ...cs, phase: 'done', note: undefined }),
          (e: { reverted?: boolean }) => setCard(id, tool, e?.reverted ? { ...cs, phase: 'reverted' } : { ...cs, note: ct('ph.unconfirmed') }),
        )
      }
    }).catch(() => {})
  }, [])
  // the conversation follows the last message
  useEffect(() => {
    const el = log.current
    if (!el) return
    // the MCP view and the empty conversation start at their top (the first suggestions, not the last ones)
    if (view === 'mcp' || !msgs.length) { el.scrollTop = 0; return }
    el.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [msgs, busy, open, view])

  const close = () => setState({ open: false, view: 'chat' })
  const onKey = (e: RKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); setTimeout(() => launch.current?.focus({ preventScroll: true }), 30) }
    else if (e.key === 'Tab' && panel.current) {
      const f = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement)
      if (f.length) {
        const first = f[0]!, last = f[f.length - 1]!
        if (e.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    // page shortcuts (demo, wall, scroll, Escape of a service panel) do not see what is typed here
    e.stopPropagation()
  }
  // a question asked while the copilot is still showing the site stays in the field, and is sent on its own once the
  // gestures end (nothing is lost, nothing crosses the running gestures)
  const queued = useRef(false)
  const typed = useRef(input)
  typed.current = input
  // On the landing the floating button stays away while the hero is on screen (the hero carries a copilot bar) and
  // comes back with it; on every other page it is always there
  const landing = useRef(!!document.querySelector('[data-sec="hero"]'))
  const offHero = () => window.scrollY > innerHeight * 0.5
  const [scrolled, setScrolled] = useState(() => !landing.current || offHero())
  useEffect(() => {
    if (!landing.current) return
    const on = () => { const v = offHero(); setScrolled((s) => (s === v ? s : v)) }
    addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [])
  const submit = () => { const v = input; if (!v.trim()) return; if (locked) { queued.current = true; return } setInput(''); void send(v) }
  useEffect(() => {
    if (locked || !queued.current) return
    queued.current = false
    const v = typed.current
    if (v.trim()) { setInput(''); void send(v) }
  }, [locked])

  if (!open) {
    // the floating button: everywhere except over the landing hero (which carries a copilot bar instead). Grey, not
    // white: it is not a main action of the page
    if (!scrolled) return null
    return (
      <button ref={launch} type="button" className="btn btn-line cp-launch" aria-haspopup="dialog" aria-expanded="false" aria-label={ct('launch.aria')} onClick={() => setState({ open: true })} onKeyDown={(e) => e.stopPropagation()} data-ui data-front-free>
        <AskHiveMark size={30} /><span>{ct('launch')}</span>
      </button>
    )
  }
  const page = pageOf()
  return (
    <section ref={panel} id="cp-panel" className={`cp-panel ${driving ? 'is-driving' : ''}`} data-sheet={sheet ? '1' : '0'} data-busy={locked ? '1' : '0'} role="dialog" aria-modal={sheet} aria-labelledby="cp-title" onKeyDown={onKey} data-ui data-front-free>
      <header className="cp-hd">
        <div className="cp-hd-r">
        <h2 id="cp-title" className="cp-title"><AskHiveMark size={28} />{ct('title')}</h2>
        <div className="cp-hd-b">
          {driving ? <button type="button" className="cp-ib" onClick={() => setState({ driving: false })}>{ct('driving.back')}</button> : (
            <>
              <button type="button" className="cp-ib" aria-pressed={view === 'mcp'} aria-label={view === 'mcp' ? ct('mcp.back') : ct('mcp.btn.aria')} onClick={() => setState({ view: view === 'mcp' ? 'chat' : 'mcp' })}>{ct('mcp.btn')}</button>
              {msgs.length ? <button type="button" className="cp-ib" onClick={() => !locked && setState({ msgs: [], view: 'chat' })} disabled={locked}>{ct('new')}</button> : null}
            </>
          )}
          <button type="button" className="cp-ib cp-close" onClick={() => { close(); setTimeout(() => launch.current?.focus({ preventScroll: true }), 30) }} aria-label={ct('close')}>×</button>
        </div>
        </div>
        {/* one line under the title (owner, 19/11): what AskHive runs on; the rest is in the proof it opens */}
        {driving ? <p className="cp-sub">{ct('driving')}</p> : <EnclaveBadge svc={cpSvc} />}
        {/* the copilot's own service page (product read live: the active copilot product, not a replaced one) */}
      </header>
      {driving ? null : (
        <>
          <WalletBar />
          <div className="cp-log" ref={log}>
            {view === 'mcp' ? <Mcp /> : (
              <>
                {!msgs.length ? (
                  <div className="cp-intro">
                    <p>{ct('intro')}</p>
                    <p className="cp-card-h lbl">{ct('suggest')}</p>
                    <ul className="cp-sug">{suggestions(page).map((q) => <li key={q}><button type="button" onClick={() => void send(q)} disabled={locked}>{q}</button></li>)}</ul>
                    <button type="button" className="cp-a cp-intro-mcp" onClick={() => setState({ view: 'mcp' })}>{ct('intro.mcp')}</button>
                  </div>
                ) : null}
                <ol className="cp-msgs" aria-live="polite" aria-relevant="additions">
                  {msgs.map((m) => <Message key={m.id} m={m} />)}
                </ol>
                {busy ? <Thinking /> : null}
              </>
            )}
          </div>
          <form className="cp-in" onSubmit={(e) => { e.preventDefault(); submit() }}>
            <label htmlFor="cp-q" className="sr-only">{ct('input.label')}</label>
            <textarea id="cp-q" ref={area} rows={1} value={input} maxLength={4000} placeholder={ct('placeholder')} autoComplete="off"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} />
            <button type="submit" className="btn btn-main btn-s cp-send" disabled={locked || !input.trim()}><span>{ct('send')}</span></button>
          </form>
        </>
      )}
    </section>
  )
}
