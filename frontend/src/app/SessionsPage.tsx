// Prepaid sessions page: open a SessionPay session locked to a verified enclave, talk to the sealed model, verify
// each receipt on Arc, top up (EIP-3009) when the enclave asks, then manage sessions and their aek_ keys (rotation,
// closing). Ported from web/src/screens/Chat.tsx and Keys.tsx.
import { useEffect, useRef, useState } from 'react'
import type { Hex } from 'viem'
import { useLang } from '../i18n'
import { useLive } from '../data/live'
import { short, usdc } from '../data/fmt'
import { ENCLAVE, PRODUCT, abs } from '../data/endpoints'
import { useIn } from '../ui/gestures'
import { Footer } from '../ui/Footer'
import { AppHeader } from './AppFrame'
import { useWallet, onArc } from '../network/actions/store'
import { useEngine, Step, Field, NoteLine, errNote, type St, type Note, type Engine } from '../network/actions/kit'
import { useProbe } from '../network/actions/probe'
import type { SessionRow } from '../network/actions/jbapi'
import { x, xTitle } from '../network/actions/strings-x'
import { ServiceState, WalletLine, ActSec } from './opsui'

type Opened = Awaited<ReturnType<Engine['openSession']>>
type Client = ReturnType<Engine['inferenceClient']>
type Comp = Awaited<ReturnType<Client['chat']['completions']['create']>>
interface Msg { role: 'user' | 'assistant'; content: string; units?: string; verified?: boolean }

const q0 = new URLSearchParams(location.search)

export function SessionsPage() {
  const lang = useLang()
  const main = useRef<HTMLElement>(null)
  useIn(main, 0.94)
  useLive((s) => s.status) // the enclave relay is known after the first API reading
  const url = abs(ENCLAVE.inference)
  const probe = useProbe(url)
  const [reload, setReload] = useState(0)
  useEffect(() => { document.title = xTitle('s.doc') }, [lang])
  return (
    <>
      <a className="skip" href="#open" data-front-free>{x('s.skip')}</a>
      <AppHeader page="sessions" section="nav.sessions" />
      <main className="app work" ref={main}>
        <section className="app-top st-use">
          <div className="app-top-in">
            <h1 className="h2 ttl app-h1"><span className="ttl-m"><span className="ttl-t">{x('s.title')}</span></span><span className="ttl-rule" aria-hidden="true" /></h1>
            <p className="lede">{x('s.lede')}</p>
            <ServiceState p={probe} name={x('s.enc')} url={url} />
          </div>
        </section>
        <Chat url={url} onOpened={() => setReload((n) => n + 1)} />
        <Mine reload={reload} />
      </main>
      <Footer />
    </>
  )
}

function Chat({ url: url0, onOpened }: { url: string; onOpened: () => void }) {
  const lang = useLang()
  const s = useWallet()
  const E = useEngine()
  const ready = onArc(s) && !!E
  const [pid, setPid] = useState(q0.get('p') ?? PRODUCT.inference.toString())
  const [url, setUrl] = useState(url0)
  useEffect(() => { setUrl(url0) }, [url0])
  const [deposit, setDeposit] = useState('2')
  const [key, setKey] = useState<{ st: St; note?: Note; signer?: string }>({ st: 'todo' })
  useEffect(() => {
    if (!ready || !E) { setKey({ st: 'todo' }); return }
    if (!/^https?:\/\/\S+$/.test(url.trim()) || !/^\d+$/.test(pid.trim())) { setKey({ st: 'todo' }); return }
    let alive = true
    setKey({ st: 'doing', note: { tone: 'muted', text: x('s.keyChecking') } })
    const tm = setTimeout(() => {
      E.verifyKey(url, BigInt(pid.trim())).then((k) => { if (alive) setKey({ st: 'done', signer: k.signer, note: { tone: 'ok', text: x('s.keyOk', { e: short(k.signer, 4), o: short(k.operator, 4) }) } }) })
        .catch((e) => {
          if (!alive) return
          const r = String((e as { reason?: string })?.reason ?? '')
          setKey({ st: 'fail', note: r === 'pubkeys_unreachable' ? { tone: 'bad', text: x('svc.offlineLong') } : errNote(E, e) })
        })
    }, 400)
    return () => { alive = false; clearTimeout(tm) }
  }, [ready, E, url, pid])
  const [open, setOpen] = useState<{ st: St; note?: Note }>({ st: 'todo' })
  const [sess, setSess] = useState<Opened | null>(null)
  const [aek, setAek] = useState('')
  const client = useRef<Client | null>(null)
  async function doOpen() {
    if (!E || key.st !== 'done') return
    setOpen({ st: 'doing', note: { tone: 'muted', text: x('s.opening') } })
    try {
      const o = await E.openSession({ productId: BigInt(pid.trim()), deposit: E.parseUsdc(deposit), url: url.trim().replace(/\/+$/, ''), enclave: key.signer as `0x${string}` }, {
        sent: (tx, id) => setOpen({ st: 'doing', note: { tone: 'muted', text: x('s.sent', { id: id.toString() }), hash: tx } }),
      })
      client.current = E.inferenceClient(o)
      setSess(o); setAek(o.aek); setMsgs([]); setLast(null); setRefill(null); setEnded(false)
      setOpen({ st: 'done', note: { tone: 'ok', text: x('s.opened', { id: o.id.toString(), e: short(o.enclave, 4) }), hash: o.tx } })
      onOpened()
    } catch (e) { setOpen({ st: 'fail', note: errNote(E, e) }) }
  }
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [typed, setTyped] = useState<string | null>(null)
  const input = typed ?? x('s.defaultMsg')
  const [busy, setBusy] = useState(false)
  const [chatNote, setChatNote] = useState<Note | null>(null)
  const [last, setLast] = useState<Comp | null>(null)
  const [refill, setRefill] = useState<{ pending: boolean; cost?: bigint; messages: { role: 'user' | 'assistant'; content: string }[] } | null>(null)
  const [ended, setEnded] = useState(false)
  async function ask(call: () => Promise<Comp>, messages: { role: 'user' | 'assistant'; content: string }[]) {
    setBusy(true); setChatNote({ tone: 'muted', text: x('s.calling') })
    try {
      const r = await call()
      setRefill(null)
      setMsgs((m) => [...m, { role: 'assistant', content: r.text, units: r.receipt.cumulativeUnits.toString(), verified: r.verified }])
      setLast(r); setChatNote(null)
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (e?.name === 'InsufficientSessionBalance') { setRefill({ pending: !!e.pending, cost: e.pending?.cost, messages }); setChatNote({ tone: 'muted', text: x('s.402') }); return }
      if (e?.name === 'SessionExpiredError') { setEnded(true); setChatNote({ tone: 'bad', text: x('s.ended') }); return }
      if (e?.name === 'TypeError' || e?.reason === 'pubkeys_unreachable') { setChatNote({ tone: 'bad', text: x('svc.offlineLong') }); return }
      setChatNote(errNote(E, e))
    } finally { setBusy(false) }
  }
  async function send() {
    const c = client.current; const text = input.trim()
    if (!c || !text || busy || refill || ended) return
    const messages = [...msgs.map(({ role, content }) => ({ role, content })), { role: 'user' as const, content: text }]
    setMsgs((m) => [...m, { role: 'user', content: text }]); setTyped('')
    await ask(() => c.chat.completions.create({ messages }), messages)
  }
  const [refAmt, setRefAmt] = useState('1')
  const [refNote, setRefNote] = useState<Note | null>(null)
  async function doRefill() {
    if (!E || !sess || !refill) return
    setRefNote({ tone: 'muted', text: x('s.refilling') })
    try {
      const h = await E.topUp(sess.id, E.parseUsdc(refAmt))
      setRefNote({ tone: 'ok', text: x('s.refilled'), hash: h })
      const c = client.current!; const r = refill
      await ask(() => (r.pending ? c.retryPending() : c.chat.completions.create({ messages: r.messages })), r.messages)
    } catch (e) { setRefNote(errNote(E, e)) }
  }
  return (
    <ActSec id="open" title={x('s.chat')} lede={x('s.chat.lede')}>
      <WalletLine />
      <ol className="na-list" aria-label={x('s.chat')}>
        <Step n={1} part="use" el="" st={key.st} t={x('s.s1')} d={x('s.s1d')} note={key.note} active={!sess && key.st !== 'done'}>
          <div className="na-grid">
            <Field label={x('s.f.product')}><input inputMode="numeric" value={pid} onChange={(e) => setPid(e.target.value)} /></Field>
          </div>
          <Field label={x('s.f.url')} wide><input type="url" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
        </Step>
        <Step n={2} part="use" el="" st={open.st} t={x('s.s2')} d={x('s.s2d')} note={open.note} active={key.st === 'done' && !sess}>
          <div className="na-row">
            <Field label={x('s.f.deposit')}><input inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></Field>
            <button type="button" className="btn btn-main btn-s" id="s-open" onClick={doOpen} disabled={!ready || key.st !== 'done' || open.st === 'doing'}><span>{x('s.openBtn', { a: `${deposit.trim() || '0'} USDC` })}</span></button>
          </div>
          {aek ? <AekReveal aek={aek} onDone={() => setAek('')} /> : null}
        </Step>
        <Step n={3} part="use" el="" st={sess ? (last ? 'done' : busy ? 'doing' : 'todo') : 'todo'} t={x('s.s3')} d={x('s.s3d')} note={chatNote} active={!!sess}>
          {sess ? (
            <>
              <div className="chat-log" aria-live="polite">
                {msgs.length === 0 ? <p className="lbl muted">{x('s.empty')}</p> : msgs.map((m, i) => (
                  <div key={i} className={`chat-m chat-${m.role}`}>
                    <p className="chat-t">{m.content}</p>
                    {m.units ? <p className="lbl mono muted">{`${m.verified ? x('s.receiptOk') : x('s.receiptBad')}, ${x('s.units', { n: m.units })}`}</p> : null}
                  </div>
                ))}
              </div>
              {refill ? (
                <div className="na-row">
                  <Field label={x('s.f.refill')}><input inputMode="decimal" value={refAmt} onChange={(e) => setRefAmt(e.target.value)} /></Field>
                  <button type="button" className="btn btn-main btn-s" onClick={doRefill}><span>{x(refill.pending ? 's.refillPending' : 's.refillBtn')}</span></button>
                </div>
              ) : null}
              {refNote ? <NoteLine n={refNote} /> : null}
              {!ended ? (
                <div className="na-row">
                  <Field label={x('s.f.msg')} wide><input value={input} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send() }} /></Field>
                  <button type="button" className="btn btn-main btn-s" id="s-send" onClick={send} disabled={busy || !!refill || !input.trim()}><span>{x('s.send')}</span></button>
                </div>
              ) : null}
            </>
          ) : null}
        </Step>
        <Step n={4} part="use" el="" st={last ? 'done' : 'todo'} t={x('s.s4')} d={x('s.s4d')} active={!!last}>
          {last && E ? <ReceiptCheck E={E} c={last} /> : null}
        </Step>
      </ol>
    </ActSec>
  )
}

/** the latest receipt, verified on Arc the way SessionPay.settle will */
function ReceiptCheck({ E, c }: { E: Engine; c: Comp }) {
  const lang = useLang()
  const [v, setV] = useState<Awaited<ReturnType<Engine['verifyReceipt']>> | null>(null)
  const [err, setErr] = useState<Note | null>(null)
  useEffect(() => {
    let alive = true; setV(null); setErr(null)
    E.verifyReceipt(c.receipt, c.signature).then((r) => { if (alive) setV(r) }).catch((e) => { if (alive) setErr(errNote(E, e)) })
    return () => { alive = false }
  }, [E, c])
  const r = c.receipt
  return (
    <div className="na-ans">
      <p className="lbl mono">{x('s.rc.head', { seq: r.seq.toString(), id: r.sessionId.toString(), signer: short(c.signer, 4) })}</p>
      <p className="lbl mono muted">{x('s.rc.tokens', { i: r.tokensIn.toString(), o: r.tokensOut.toString(), u: r.cumulativeUnits.toString(), b: r.anchorBlock.toString() })}</p>
      {v ? (
        <>
          <p className="lbl" data-ok={v.settleable ? '1' : '0'}>{v.settleable ? x('s.rc.ok', { a: usdc(v.payableNow.toString(), lang) ?? '' }) : x('s.rc.bad')}</p>
          <ul className="rc-checks">{v.checks.map((k) => <li key={k.id} data-ok={k.ok ? '1' : '0'}><span aria-hidden="true">{k.ok ? '+' : 'x'}</span> {k.id}</li>)}</ul>
        </>
      ) : err ? <NoteLine n={err} /> : <p className="lbl muted">{x('state.reading')}</p>}
    </div>
  )
}

function AekReveal({ aek, onDone }: { aek: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="na-ans aek">
      <p className="na-ans-t">{x('s.aek.title')}</p>
      <p className="mono aek-v">{aek}</p>
      <p className="lbl muted">{x('s.aek.note')}</p>
      <div className="na-row">
        <button type="button" className="btn btn-main btn-s" onClick={() => { navigator.clipboard?.writeText(aek).then(() => setCopied(true)).catch(() => {}) }}><span>{copied ? x('s.aek.copied') : x('s.aek.copy')}</span></button>
        <button type="button" className="tlink" onClick={onDone}>{x('s.aek.saved')}</button>
      </div>
    </div>
  )
}

/** the address's sessions (GET /sessions/:owner), with top-up, key rotation and closing (Keys.tsx) */
function Mine({ reload }: { reload: number }) {
  const lang = useLang()
  const s = useWallet()
  const E = useEngine()
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [err, setErr] = useState<Note | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!E || !s.address) { setRows(null); return }
    let alive = true
    E.fetchSessions(s.address).then((r) => { if (alive) { setRows(r); setErr(null) } }).catch((e) => { if (alive) { setRows([]); setErr(errNote(E, e)) } })
    return () => { alive = false }
  }, [E, s.address, reload, tick])
  const [aek, setAek] = useState('')
  if (!s.address) return null
  return (
    <ActSec id="mine" title={x('s.mine')} lede={x('s.mine.lede')}>
      {err ? <NoteLine n={err} /> : null}
      {aek ? <AekReveal aek={aek} onDone={() => setAek('')} /> : null}
      <div className="tbl-w">
        <table className="tbl">
          <thead><tr><th scope="col">{x('s.h.session')}</th><th scope="col">{x('s.h.deposit')}</th><th scope="col">{x('s.h.paid')}</th><th scope="col">{x('s.h.state')}</th><th scope="col">{x('s.h.act')}</th></tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan={5} className="muted">{x('state.reading')}</td></tr>
              : rows.length === 0 ? <tr><td colSpan={5} className="muted">{x('s.none')}</td></tr>
                : rows.map((r) => <SessionLine key={r.id} r={r} E={E!} lang={lang} onChanged={() => setTick((n) => n + 1)} onKey={setAek} />)}
          </tbody>
        </table>
      </div>
    </ActSec>
  )
}

function SessionLine({ r, E, lang, onChanged, onKey }: { r: SessionRow; E: Engine; lang: string; onChanged: () => void; onKey: (k: string) => void }) {
  const [amt, setAmt] = useState('1')
  const [n, setN] = useState<Note | null>(null)
  const now = Math.floor(Date.now() / 1000)
  const exp = r.expiresAt ? Number(r.expiresAt) : 0
  const expired = exp > 0 && exp <= now
  async function run(f: () => Promise<{ text: string; hash?: Hex }>) {
    setN({ tone: 'muted', text: x('s.l.signing') })
    try { const o = await f(); setN({ tone: 'ok', text: o.text, hash: o.hash }); onChanged() } catch (e) { setN(errNote(E, e)) }
  }
  const id = BigInt(r.id)
  return (
    <>
      <tr>
        <td data-l={x('s.h.session')}>{x('s.row', { id: r.id, p: r.productId })}{r.enclave ? <span className="lbl muted mono"> {short(r.enclave, 4)}</span> : null}</td>
        <td className="mono" data-l={x('s.h.deposit')}>{usdc(r.deposit, lang)}</td>
        <td className="mono" data-l={x('s.h.paid')}>{usdc(r.paid, lang)}</td>
        <td data-l={x('s.h.state')}>{r.closed ? x('s.st.closed') : expired ? x('s.st.expired') : x('s.st.open', { when: exp ? new Date(exp * 1000).toLocaleString(lang) : '?' })}</td>
        <td data-l={x('s.h.act')}>
          {!r.closed ? (
            <span className="na-row s-acts">
              <input aria-label={x('s.f.refill')} className="s-amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
              <button type="button" className="btn btn-line btn-s" onClick={() => run(async () => ({ text: x('s.l.topped'), hash: await E.topUp(id, E.parseUsdc(amt)) }))}><span>{x('s.l.topUp')}</span></button>
              <button type="button" className="btn btn-line btn-s" onClick={() => run(async () => { const o = await E.rotateKey(id); onKey(o.aek); return { text: x('s.l.rotated'), hash: o.tx } })}><span>{x('s.l.rotate')}</span></button>
              <button type="button" className="btn btn-line btn-s" onClick={() => run(async () => { const o = await E.closeSession(id); return { text: x(`s.close.${o.outcome}` as 's.close.written', { why: o.reason ?? '' }), hash: o.tx } })}><span>{x('s.l.close')}</span></button>
            </span>
          ) : null}
        </td>
      </tr>
      {n ? <tr className="dt-sub"><td colSpan={5}><NoteLine n={n} /></td></tr> : null}
    </>
  )
}
