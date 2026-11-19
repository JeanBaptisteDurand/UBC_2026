// Operator page: paired machines (diagnostics, logs, removal), arcop_ operator keys, enclave registration through
// real DCAP and its removal, the bond and its withdrawal, and the card of the two levels.
// Ported from web/src/screens/Operator.tsx and Keys.tsx. API signatures (EIP-4361) are only valid for a site the API
// recognizes (SIGN_ORIGINS): the page says so before asking for anything.
import { useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { useLang } from '../i18n'
import { useLive } from '../data/live'
import { short } from '../data/fmt'
import { addr } from '../links'
import { useIn } from '../ui/gestures'
import { Footer } from '../ui/Footer'
import { AppHeader } from './AppFrame'
import { useWallet, onArc } from '../network/actions/store'
import { useEngine, Step, Field, NoteLine, errNote, type St, type Note, type Engine } from '../network/actions/kit'
import { RentActs } from '../network/actions/acts'
import type { Machine, OperatorKey } from '../network/actions/jbapi'
import { x, xTitle } from '../network/actions/strings-x'
import { WalletLine, ActSec } from './opsui'
import { LevelsCard } from './levels'
import { useCopy, useHashScroll } from './parts'

/** embed: inside My space (space.html), without the page frame; the title becomes a section title */
export function OperatorPage({ embed = false }: { embed?: boolean } = {}) {
  const Tag = (embed ? 'div' : 'main') as 'main'
  const H = (embed ? 'h2' : 'h1') as 'h1'
  const lang = useLang()
  const main = useRef<HTMLElement>(null)
  useIn(main, 0.94)
  useEffect(() => { if (!embed) document.title = xTitle('o.doc') }, [lang, embed])
  useHashScroll(true) // space.html?tab=machines#keys lands on its section
  return (
    <>
      {embed ? null : <><a className="skip" href="#machines" data-front-free>{x('o.skip')}</a><AppHeader page="operator" section="nav.operator" /></>}
      <Tag className={embed ? 'work sp-work' : 'app work'} ref={main}>
        <section className="app-top st-rent">
          <div className="app-top-in">
            <H className="h2 ttl app-h1"><span className="ttl-m"><span className="ttl-t">{x('o.title')}</span></span><span className="ttl-rule" aria-hidden="true" /></H>
            <p className="lede">{x('o.lede')}</p>
            <WalletLine />
          </div>
        </section>
        <ActSec id="bond" title={x('o.bond')} lede={x('o.bond.lede')}><RentActs label={x('o.bond')} /></ActSec>
        <Machines />
        <Register />
        <Keys />
        <LevelsCard />
      </Tag>
      {embed ? null : <Footer />}
    </>
  )
}

/** the restricted reading (one signature, 10 minutes, in memory) and its end */
function useRead(E: Engine | null, address?: string) {
  const [, redraw] = useState(0)
  useEffect(() => (E ? E.onReadAccess(() => redraw((n) => n + 1)) : undefined), [E])
  return E && address ? E.readSignature(address) : null
}

function Machines() {
  const lang = useLang()
  const s = useWallet()
  const E = useEngine()
  const read = useRead(E, s.address)
  const [ms, setMs] = useState<Machine[] | null>(null)
  const [n, setN] = useState<Note | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!E || !s.address) { setMs(null); return }
    let alive = true
    const load = () => (read ? E.fetchMachinesSigned(read) : E.fetchMachines(s.address!)).then((m) => { if (alive) { setMs(m); setN(null) } })
      // a list that could not be read stays unread (never "no machine paired"); the previous list, if any, stays
      .catch((e) => { if (!alive) return; if (read && E.isSignatureSpent(e)) { E.dropReadAccess(); setN({ tone: 'muted', text: x('o.readExpired') }) } else setN(errNote(E, e)) })
    void load()
    const iv = setInterval(load, 15_000)
    return () => { alive = false; clearInterval(iv) }
  }, [E, s.address, read, tick])
  async function unlock() {
    if (!E || !s.address) return
    setN({ tone: 'muted', text: x('o.readSign') })
    try { await E.requestReadAccess(s.address); setN(null) } catch (e) { setN(errNote(E, e)) }
  }
  const masked = !read && !!ms?.some((m) => m.restricted || m.hostnameHidden)
  return (
    <ActSec id="machines" title={x('o.m.title')} lede={x('o.m.lede')} side={masked ? <button type="button" className="btn btn-line btn-s" onClick={unlock} disabled={!onArc(s)}><span>{x('o.readBtn')}</span></button> : null} copilot="machines">
      {!s.address ? <WalletLine /> : null}
      {n ? <NoteLine n={n} /> : null}
      {s.address ? (
        <div className="tbl-w">
          <table className="tbl">
            <thead><tr><th scope="col">{x('o.m.h.name')}</th><th scope="col">{x('o.m.h.state')}</th><th scope="col">{x('o.m.h.doctor')}</th><th scope="col">{x('o.m.h.arc')}</th><th scope="col">{x('o.m.h.act')}</th></tr></thead>
            <tbody>
              {ms === null ? (n?.tone === 'bad' ? <tr><td colSpan={5} className="muted b-unread"><span>{x('list.unread')}</span><button type="button" className="btn btn-line btn-s" onClick={() => { setN(null); setTick((v) => v + 1) }}><span>{x('list.reread')}</span></button></td></tr>
                : <tr><td colSpan={5} className="muted">{x('state.reading')}</td></tr>)
                : ms.length === 0 ? <tr><td colSpan={5} className="muted">{x('o.m.none')}</td></tr>
                  : ms.map((m) => <MachineLine key={m.machineId} m={m} E={E!} lang={lang} read={read} onChanged={() => setTick((v) => v + 1)} unlock={unlock} />)}
            </tbody>
          </table>
        </div>
      ) : null}
    </ActSec>
  )
}

function MachineLine({ m, E, lang, read, onChanged, unlock }: { m: Machine; E: Engine; lang: string; read: ReturnType<Engine['readSignature']>; onChanged: () => void; unlock: () => void }) {
  const [open, setOpen] = useState(false)
  const [n, setN] = useState<Note | null>(null)
  const [d, setD] = useState<Machine | null>(null)
  useEffect(() => {
    if (!open || !read) { setD(null); return }
    let alive = true
    E.fetchMachineDetail(m.machineId, read).then((v) => { if (alive) setD(v) }).catch((e) => { if (alive) setN(errNote(E, e)) })
    return () => { alive = false }
  }, [open, read, m.machineId, E])
  const ago = m.lastSeen ? Math.round((Date.now() - m.lastSeen) / 60000) : null
  async function remove() {
    setN({ tone: 'muted', text: x('o.m.removeSign') })
    try { await E.removeMachine(m.machineId); setN({ tone: 'ok', text: x('o.m.removed') }); onChanged() } catch (e) { setN(errNote(E, e)) }
  }
  async function register() {
    if (!m.enclaveUrl || !m.productId) return
    setN({ tone: 'muted', text: x('o.reg.reading') })
    try {
      const r = await E.registerMachineEnclave(BigInt(m.productId), m.enclaveUrl, (k, tx) => { if (k === 'sent') setN({ tone: 'muted', text: x('o.reg.sent'), hash: tx }) })
      setN({ tone: 'ok', text: x('o.reg.done', { e: short(r.signer, 4), by: x(r.admittedBy === 'image' ? 'o.reg.image' : 'o.reg.workload') }), hash: r.tx }); onChanged()
    } catch (e) { setN(errNote(E, e)) }
  }
  return (
    <>
      <tr>
        {/* one box per cell: on phones a cell is a grid (label, value), a second child fell under the label */}
        <td data-l={x('o.m.h.name')}>
          <span><button type="button" className="tlink" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{m.hostname || x('o.m.hidden')}</button>
          <span className="lbl muted"> {m.mode === 'demo' ? x('o.m.noTdx') : m.mode.toUpperCase()}</span></span>
        </td>
        <td data-l={x('o.m.h.state')}><span><span className={`led ${m.online ? 'led-green' : ''}`} aria-hidden="true" />{m.online ? m.status : ago !== null ? x('o.m.offline', { n: ago }) : x('o.m.never')}</span></td>
        <td className="tbl-long" data-l={x('o.m.h.doctor')}>{m.doctorOk === null ? x('o.m.pending') : m.failing?.length ? m.failing.join(', ') : x('o.m.green')}</td>
        <td data-l={x('o.m.h.arc')}>{m.registered ? x('o.m.registered') : <button type="button" className="btn btn-line btn-s" onClick={register} disabled={!m.online || !m.enclaveUrl || m.mode === 'demo'}><span>{x('o.m.register')}</span></button>}</td>
        <td data-l={x('o.m.h.act')}><button type="button" className="btn btn-line btn-s" onClick={remove}><span>{x('o.m.remove')}</span></button></td>
      </tr>
      {open || n ? (
        <tr className="dt-sub"><td colSpan={5}>
          {n ? <NoteLine n={n} /> : null}
          {open ? (read ? (
            d ? (
              <div className="m-detail">
                <ul className="rc-checks">{(d.doctor?.checks ?? []).map((c) => <li key={c.id} data-ok={c.ok ? '1' : '0'}><span aria-hidden="true">{c.ok ? '+' : 'x'}</span> {c.label} <span className="muted">{c.detail}</span></li>)}</ul>
                <p className="lbl mono muted">{`${d.enclaveUrl ?? '?'}, ${d.signer ? short(d.signer, 4) : '?'}, ${x('o.m.product', { id: d.productId ?? '?' })}`}</p>
                <pre className="m-logs">{(d.logs ?? []).slice(-30).join('\n') || x('o.m.noLogs')}</pre>
              </div>
            ) : <p className="lbl muted">{x('state.reading')}</p>
          ) : <p className="na-note" data-tone="muted">{x('o.m.reserved')} <button type="button" className="tlink" onClick={unlock}>{x('o.readBtn')}</button></p>) : null}
          <span hidden>{lang}</span>
        </td></tr>
      ) : null}
    </>
  )
}

/** register an enclave through real DCAP (its machine's address), and remove those of the address */
function Register() {
  const lang = useLang()
  const s = useWallet()
  const E = useEngine()
  const ready = onArc(s) && !!E
  const enclaves = useLive((v) => v.enclaves)
  const [pid, setPid] = useState('1')
  const [url, setUrl] = useState('')
  const [st, setSt] = useState<{ st: St; note?: Note }>({ st: 'todo' })
  async function go() {
    if (!E) return
    setSt({ st: 'doing', note: { tone: 'muted', text: x('o.reg.reading') } })
    try {
      if (!/^\d+$/.test(pid.trim())) throw new Error(x('b.badProduct'))
      const r = await E.registerMachineEnclave(BigInt(pid.trim()), url, (k, tx) => { if (k === 'sent') setSt({ st: 'doing', note: { tone: 'muted', text: x('o.reg.sent'), hash: tx } }) })
      setSt({ st: 'done', note: { tone: 'ok', text: x('o.reg.done', { e: short(r.signer, 4), by: x(r.admittedBy === 'image' ? 'o.reg.image' : 'o.reg.workload') }), hash: r.tx } })
    } catch (e) { setSt({ st: 'fail', note: errNote(E, e) }) }
  }
  const mine = (enclaves ?? []).filter((e) => s.address && e.operator.toLowerCase() === s.address.toLowerCase() && e.active)
  const [ret, setRet] = useState<Record<string, Note>>({})
  async function retire(signer: string) {
    if (!E) return
    setRet((m) => ({ ...m, [signer]: { tone: 'muted', text: x('o.ret.signing') } }))
    try { const h = await E.retireEnclave(signer as Address); setRet((m) => ({ ...m, [signer]: { tone: 'ok', text: x('o.ret.done'), hash: h } })) } catch (e) { setRet((m) => ({ ...m, [signer]: errNote(E, e) })) }
  }
  return (
    <ActSec id="register" title={x('o.reg.title')} lede={x('o.reg.lede')}>
      <ol className="na-list" aria-label={x('o.reg.title')}>
        <Step n={1} part="rent" el="" st={st.st} t={x('o.reg.s1')} d={x('o.reg.s1d')} note={st.note} active copilot="register">
          <div className="na-grid"><Field label={x('o.f.product')}><input inputMode="numeric" value={pid} onChange={(e) => setPid(e.target.value)} /></Field></div>
          <Field label={x('o.f.url')} wide><input type="url" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.trycloudflare.com" /></Field>
          <button type="button" className="btn btn-main btn-s" id="o-register" data-copilot="o-register" onClick={go} disabled={!ready || st.st === 'doing' || !url.trim()}><span>{x('o.reg.btn')}</span></button>
        </Step>
        <Step n={2} part="rent" el="" st={mine.length ? 'done' : 'todo'} t={x('o.ret.title')} d={x('o.ret.d')} copilot="retire">
          {mine.length ? (
            <ul className="na-encs">
              {mine.map((e) => (
                <li key={e.signer}>
                  <span className="led led-green" aria-hidden="true" />
                  <a className="tlink mono" href={addr(e.signer)} target="_blank" rel="noreferrer">{short(e.signer, 4)}</a>
                  <span className="lbl muted">{x('o.m.product', { id: e.productId })}</span>
                  <button type="button" className="btn btn-line btn-s" onClick={() => retire(e.signer)} disabled={!ready}><span>{x('o.ret.btn')}</span></button>
                  {ret[e.signer] ? <NoteLine n={ret[e.signer]} /> : null}
                </li>
              ))}
            </ul>
          ) : <p className="na-note" data-tone="muted">{s.address ? x('o.ret.none') : x('wl.need')}</p>}
          <span hidden>{lang}</span>
        </Step>
      </ol>
    </ActSec>
  )
}

/** a new arcop_ key, shown once: its Copy button says "Copied", or selects the key when the browser refuses */
function FreshKey({ k, onDone }: { k: string; onDone: () => void }) {
  useLang()
  const v = useRef<HTMLParagraphElement>(null)
  const c = useCopy(k, v)
  return (
    <div className="na-ans aek">
      <p className="na-ans-t">{x('o.k.fresh')}</p>
      <p className="mono aek-v" ref={v}>{k}</p>
      <div className="na-row"><button type="button" className="btn btn-main btn-s" onClick={c.copy}><span>{c.done ? x('s.aek.copied') : x('s.aek.copy')}</span></button><button type="button" className="tlink" onClick={onDone}>{x('s.aek.saved')}</button></div>
      {c.hint}
    </div>
  )
}

/** arcop_ operator keys: they report, they do not spend (Keys.tsx, OperatorKeys) */
function Keys() {
  const lang = useLang()
  const s = useWallet()
  const E = useEngine()
  const read = useRead(E, s.address)
  const [keys, setKeys] = useState<OperatorKey[] | null>(null)
  const [label, setLabel] = useState('archive-node')
  const [fresh, setFresh] = useState('')
  const [n, setN] = useState<Note | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!E || !s.address) { setKeys(null); return }
    let alive = true
    ;(read ? E.fetchOperatorKeysSigned(read) : E.fetchOperatorKeys(s.address)).then((k) => { if (alive) setKeys(k) })
      .catch((e) => { if (!alive) return; if (read && E.isSignatureSpent(e)) E.dropReadAccess(); else setN(errNote(E, e)) }) // unread, never "no key yet"
    return () => { alive = false }
  }, [E, s.address, read, tick])
  async function create() {
    if (!E) return
    setN({ tone: 'muted', text: x('o.k.signCreate') })
    try { const r = await E.createOperatorKey(label); setFresh(r.key); setN(null); setTick((v) => v + 1) } catch (e) { setN(errNote(E, e)) }
  }
  async function revoke(id: string) {
    if (!E) return
    setN({ tone: 'muted', text: x('o.k.signRevoke') })
    try { await E.revokeOperatorKey(id); setN({ tone: 'ok', text: x('o.k.revoked') }); setTick((v) => v + 1) } catch (e) { setN(errNote(E, e)) }
  }
  return (
    <ActSec id="keys" title={x('o.k.title')} lede={x('o.k.lede')} copilot="keys">
      <div className="na-row">
        <Field label={x('o.k.name')}><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <button type="button" className="btn btn-main btn-s" id="o-key" data-copilot="o-key" onClick={create} disabled={!onArc(s) || !E}><span>{x('o.k.create')}</span></button>
      </div>
      {fresh ? <FreshKey k={fresh} onDone={() => setFresh('')} /> : null}
      {n ? <NoteLine n={n} /> : null}
      {s.address ? (
        <div className="tbl-w">
          <table className="tbl">
            <thead><tr><th scope="col">{x('o.k.h.key')}</th><th scope="col">{x('o.k.h.bound')}</th><th scope="col">{x('o.k.h.used')}</th><th scope="col">{x('o.k.h.state')}</th><th scope="col"><span className="sr-only">{x('o.m.h.act')}</span></th></tr></thead>
            <tbody>
              {keys === null ? (n?.tone === 'bad' ? <tr><td colSpan={5} className="muted b-unread"><span>{x('list.unread')}</span><button type="button" className="btn btn-line btn-s" onClick={() => { setN(null); setTick((v) => v + 1) }}><span>{x('list.reread')}</span></button></td></tr>
                : <tr><td colSpan={5} className="muted">{x('state.reading')}</td></tr>)
                : keys.length === 0 ? <tr><td colSpan={5} className="muted">{x('o.k.none')}</td></tr>
                  : keys.map((k) => (
                    <tr key={k.keyId}>
                      <td className="mono" data-l={x('o.k.h.key')}><span>{`arcop_${k.keyId}_`} <span className="lbl muted">{k.restricted ? x(k.machineId ? 'o.k.machineKey' : 'o.k.freeKey') : k.label}</span></span></td>
                      <td data-l={x('o.k.h.bound')}>{k.machineId ? x('o.k.machine') : x('o.k.free')}</td>
                      <td data-l={x('o.k.h.used')}>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString(lang) : x('o.k.never')}</td>
                      <td data-l={x('o.k.h.state')}>{k.revoked ? x('o.k.st.revoked') : x('o.k.st.active')}</td>
                      <td>{!k.revoked ? <button type="button" className="btn btn-line btn-s" onClick={() => revoke(k.keyId)}><span>{x('o.k.revoke')}</span></button> : null}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      ) : <WalletLine />}
    </ActSec>
  )
}
