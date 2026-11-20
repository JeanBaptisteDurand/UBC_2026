// Sealed bounties page: the live list, creation by a protocol, the hunter flow (sealed submission for the verified
// enclave, replay, reservation, delivery), credit and pool withdrawal, at the open level (product 2) as at the
// verified level (product 5 on v3, 7 on v2.1). Ported from web/src/screens/Bounties.tsx, Bounty.tsx and
// PostBounty.tsx; everything is signed by the visitor's wallet, nothing is simulated.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import { useLang } from '../i18n'
import { useLive } from '../data/live'
import { short, usdc } from '../data/fmt'
import { addr } from '../links'
import { ENCLAVE, PRODUCT, abs } from '../data/endpoints'
import { useIn } from '../ui/gestures'
import { Footer } from '../ui/Footer'
import { AppHeader } from './AppFrame'
import { useWallet, onArc, engine } from '../network/actions/store'
import { useEngine, Step, Field, NoteLine, errNote, type St, type Note, type Engine } from '../network/actions/kit'
import { useProbe } from '../network/actions/probe'
import { x, xTitle } from '../network/actions/strings-x'
import { ServiceState, WalletLine, ActSec } from './opsui'
import { refutationOfBounty } from '../data/facts'
import { useHashScroll } from './parts'

type Level = 'open' | 'verified'
interface Row { id: string; productId: string; protocol: string; balance: bigint; paid: bigint; deadline: bigint; paused: boolean; predicateHash?: string }
const nowS = () => BigInt(Math.floor(Date.now() / 1000))
const big = (v: unknown) => { try { return BigInt(String(v ?? '0')) } catch { return 0n } }

function LevelSwitch({ level, set }: { level: Level; set: (l: Level) => void }) {
  useLang()
  return (
    <div className="lvl-sw" role="radiogroup" aria-label={x('b.level')}>
      {(['open', 'verified'] as Level[]).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={level === l} className="mode" onClick={() => set(l)}>
          <span className="mode-t">{x(l === 'open' ? 'b.lvl.open' : 'b.lvl.verified')}</span>
          <span className="mode-d">{x(l === 'open' ? 'b.lvl.open.d' : 'b.lvl.verified.d')}</span>
        </button>
      ))}
    </div>
  )
}

/** the list: /api/bounties for the open level, the chain for the verified level (the API does not index it). Reading
 *  the chain is public: without a wallet (a phone), the engine loads for this read alone, no wallet is asked for */
function useRows(level: Level, E: Engine | null, tick: number): { rows: Row[] | null; note?: Note } {
  const live = useLive((s) => s.bounties)
  const status = useLive((s) => s.status)
  const [chain, setChain] = useState<{ rows: Row[] | null; note?: Note }>({ rows: null })
  useEffect(() => {
    if (level !== 'verified') return
    let alive = true, tm = 0
    // a list already read stays on screen while it is read again (a wallet connecting, a bounty just posted)
    setChain((c) => (c.rows && !c.note ? c : { rows: null }))
    // the public Arc RPC answers bursts with "limit exceeded": two more tries before saying so. A list that could not
    // be read stays unread (never "no bounty")
    const read = (n: number) => void (E ? Promise.resolve(E) : engine()).then((m) => m.listBounties('verified')
      .then((bs) => { if (alive) setChain({ rows: bs.map((b) => ({ id: b.id.toString(), productId: b.productId.toString(), protocol: b.protocol, balance: b.balance, paid: b.paidAmount, deadline: b.deadline, paused: b.paused, predicateHash: b.predicateHash })) }) })
      .catch((e) => {
        if (!alive) return
        if (n < 2) { tm = window.setTimeout(() => read(n + 1), 1500 * (n + 1)); return }
        setChain({ rows: null, note: errNote(m, e) })
      }))
      .catch((e) => { if (alive) setChain({ rows: null, note: errNote(null, e) }) }) // the engine itself did not load
    read(0)
    return () => { alive = false; clearTimeout(tm) }
  }, [level, E, tick])
  if (level === 'verified') return chain
  if (!live) return { rows: null, note: status === 'error' ? { tone: 'bad', text: x('svc.offline') } : undefined }
  return { rows: live.map((b) => ({ id: b.id, productId: b.productId, protocol: b.protocol ?? '', balance: big(b.balance), paid: big(b.paidAmount), deadline: big(b.deadline), paused: b.paused, predicateHash: b.predicateHash })) }
}

/** embed: inside My space (space.html), without the page frame; the title becomes a section title */
export function BountyPage({ embed = false }: { embed?: boolean } = {}) {
  const Tag = (embed ? 'div' : 'main') as 'main'
  const H = (embed ? 'h2' : 'h1') as 'h1'
  const lang = useLang()
  const s = useWallet()
  const E = useEngine()
  const main = useRef<HTMLElement>(null)
  useIn(main, 0.94)
  const [level, setLevel] = useState<Level>('open')
  const [tick, setTick] = useState(0)
  const { rows, note } = useRows(level, E, tick)
  const levels = useLive((x0) => x0.levels)
  const url = level === 'open' ? ENCLAVE.bounty : ENCLAVE.bountyVerified
  const probe = useProbe(abs(url))
  const [pick, setPick] = useState('')
  const now = nowS()
  useEffect(() => {
    if (!rows || pick) return
    const open = rows.filter((b) => !b.paused && b.deadline >= now)
    const best = open.find((b) => b.paid === 0n) ?? open[0]
    if (best) setPick(best.id)
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPick('') }, [level])
  useEffect(() => { if (!embed) document.title = xTitle('b.doc') }, [lang, embed])
  useHashScroll(rows !== null) // space.html?tab=bounties#hunt lands on its section, once the list above has its rows
  const slashFrom = levels?.verifiedBounty?.slashFrom
  return (
    <>
      {embed ? null : <><a className="skip" href="#list" data-front-free>{x('b.skip')}</a><AppHeader page="bounty" section="nav.bounty" /></>}
      <Tag className={embed ? 'work sp-work' : 'app work'} ref={main}>
        <section className="app-top st-publish">
          <div className="app-top-in">
            <H className="h2 ttl app-h1"><span className="ttl-m"><span className="ttl-t">{x('b.title')}</span></span><span className="ttl-rule" aria-hidden="true" /></H>
            <p className="lede">{x('b.lede')}</p>
            <LevelSwitch level={level} set={setLevel} />
            <ServiceState p={probe} name={x(level === 'open' ? 'b.enc.open' : 'b.enc.verified')} url={abs(url)} />
            {level === 'verified' ? <p className="lbl muted">{slashFrom ? x('b.slashFrom', { when: new Date(slashFrom * 1000).toLocaleString(lang) }) : x('b.slashDate')}</p> : null}
          </div>
        </section>

        <section className="work-sec" id="list" aria-labelledby="list-h">
          <h2 className="work-h" id="list-h">{x('b.list')}</h2>
          {note ? <NoteLine n={note} /> : null}
          <div className="tbl-w">
            <table className="tbl">
              <thead><tr><th scope="col">{x('b.h.bounty')}</th><th scope="col">{x('b.h.protocol')}</th><th scope="col">{x('b.h.pool')}</th><th scope="col">{x('b.h.deadline')}</th><th scope="col">{x('b.h.state')}</th><th scope="col"><span className="sr-only">{x('b.h.act')}</span></th></tr></thead>
              <tbody>
                {rows === null ? (note ? (
                  // not read (the API or Arc did not answer): said as such, never "no bounty"; the verified list is read
                  // again on demand, the open one comes back with the next API reading
                  <tr><td colSpan={6} className="muted b-unread"><span>{x('list.unread')}</span>{level === 'verified' ? <button type="button" className="btn btn-line btn-s" onClick={() => setTick((n) => n + 1)}><span>{x('list.reread')}</span></button> : null}</td></tr>
                ) : <tr><td colSpan={6} className="muted">{x('state.reading')}</td></tr>)
                  : rows.length === 0 ? <tr><td colSpan={6} className="muted">{x('b.none')}</td></tr>
                    : rows.map((b) => {
                      const expired = b.deadline < now
                      // the refutation of 15/11 is bounty 2 of the v2.1 open level (product 5 of v2.1): refutationOfBounty
                      // compares the contract, so no v3 bounty takes it. The verified level numbers its bounties from 1 too
                      const refuted = level === 'open' && refutationOfBounty(b.id)?.productId === String(b.productId)
                      return (
                        <tr key={b.id} data-on={pick === b.id ? '1' : '0'}>
                          <td data-l={x('b.h.bounty')}>{x('b.row', { id: b.id, p: b.productId })}</td>
                          <td className="mono" data-l={x('b.h.protocol')}>{b.protocol ? <a className="tlink mono" href={addr(b.protocol)} target="_blank" rel="noreferrer">{short(b.protocol, 4)}</a> : '?'}</td>
                          <td className="mono" data-l={x('b.h.pool')}>{usdc(b.balance.toString(), lang)}</td>
                          <td data-l={x('b.h.deadline')}>{new Date(Number(b.deadline) * 1000).toLocaleString(lang)}</td>
                          <td className="tbl-long" data-l={x('b.h.state')}>{b.paused ? x('b.st.paused') : expired ? x('b.st.expired') : x('b.st.open')}{refuted ? `, ${x('b.st.refuted')}` : b.paid > 0n ? `, ${x('b.st.paid', { a: usdc(b.paid.toString(), lang) ?? '' })}` : ''}</td>
                          <td>{!b.paused && !expired ? <button type="button" className={`btn btn-s ${pick === b.id ? 'btn-main' : 'btn-line'}`} onClick={() => { setPick(b.id); document.getElementById('hunt')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}><span>{x('b.hunt')}</span></button> : null}</td>
                        </tr>
                      )
                    })}
              </tbody>
            </table>
          </div>
        </section>

        <Credit level={level} E={E} />
        <Hunter level={level} E={E} pick={pick} setPick={setPick} url={url} onDone={() => setTick((n) => n + 1)} />
        <Create level={level} E={E} onDone={() => setTick((n) => n + 1)} />
        <Mine level={level} E={E} rows={rows} address={s.address} onDone={() => setTick((n) => n + 1)} />
      </Tag>
      {embed ? null : <Footer />}
    </>
  )
}

/** a payment whose transfer was refused stays as credit: withdraw it here (the console's CreditNotice) */
function Credit({ level, E }: { level: Level; E: Engine | null }) {
  const lang = useLang()
  const s = useWallet()
  const [credit, setCredit] = useState(0n)
  const [n, setN] = useState<Note | null>(null)
  useEffect(() => {
    if (!E || !s.address || !onArc(s)) { setCredit(0n); return }
    E.readCredit(level, s.address).then(setCredit).catch(() => setCredit(0n))
  }, [E, s.address, s.chainId, level]) // eslint-disable-line react-hooks/exhaustive-deps
  if (credit === 0n && !n) return null
  async function go() {
    if (!E) return
    setN({ tone: 'muted', text: x('b.credit.signing') })
    try { const h = await E.withdrawCredit(level); setN({ tone: 'ok', text: x('b.credit.done', { a: usdc(credit.toString(), lang) ?? '' }), hash: h }); setCredit(0n) } catch (e) { setN(errNote(E, e)) }
  }
  return (
    <section className="work-sec acts" aria-label={x('b.credit')}>
      {credit > 0n ? <p className="body">{x('b.credit.text', { a: usdc(credit.toString(), lang) ?? '' })}</p> : null}
      {credit > 0n ? <button type="button" className="btn btn-main btn-s" onClick={go}><span>{x('b.credit.btn')}</span></button> : null}
      {n ? <NoteLine n={n} /> : null}
    </section>
  )
}

/** the hunter flow: encryption for the verified enclave, replay, reservation, delivery (the console's HunterPanel) */
function Hunter({ level, E, pick, setPick, url, onDone }: { level: Level; E: Engine | null; pick: string; setPick: (v: string) => void; url: string; onDone: () => void }) {
  const lang = useLang()
  const s = useWallet()
  const ready = onArc(s) && !!E
  const [encUrl, setEncUrl] = useState(abs(url))
  useEffect(() => { setEncUrl(abs(url)) }, [url])
  const fresh = (): { st: St; note?: Note }[] => [0, 1, 2, 3].map(() => ({ st: 'todo' as St }))
  const [steps, setSteps] = useState(fresh)
  const [top, setTop] = useState<Note | null>(null)
  const [busy, setBusy] = useState(false)
  const proven = useRef<Awaited<ReturnType<Engine['prove']>> | null>(null)
  const [accepted, setAccepted] = useState(false)
  const set = (i: number, st: St, note?: Note) => setSteps((a) => a.map((v, j) => (j === i ? { st, note } : v)))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hooks: any = {
    step: (i: number, st: 'doing' | 'done', info: { signer?: Address; operator?: Address; loss?: bigint; tier?: number; tx?: Hex; amount?: bigint } = {}) => {
      const k = (['h.s1', 'h.s2', 'h.s3', 'h.s4'] as const)[i]
      if (st === 'doing') { set(i, 'doing', { tone: 'muted', text: x(`${k}.doing` as 'h.s1.doing') }); return }
      if (i === 0) set(0, 'done', { tone: 'ok', text: x('h.s1.done', { e: short(info.signer ?? '', 4), o: short(info.operator ?? '', 4) }) })
      if (i === 1) set(1, 'done', { tone: 'ok', text: x('h.s2.done', { loss: usdc((info.loss ?? 0n).toString(), lang) ?? '', tier: info.tier ?? 0 }) })
      if (i === 2) { setAccepted(true); set(2, 'done', { tone: 'ok', text: x('h.s3.done'), hash: info.tx }) }
      if (i === 3) set(3, 'done', { tone: 'ok', text: info.amount !== undefined ? x('h.s4.paid', { a: usdc(info.amount.toString(), lang) ?? '' }) : x('h.s4.done'), hash: info.tx })
    },
  }
  const current = () => steps.findIndex((v) => v.st === 'doing')
  async function hunt() {
    if (!E || busy) return
    setSteps(fresh()); setTop(null); proven.current = null; setAccepted(false)
    if (!/^\d+$/.test(pick.trim())) { setTop({ tone: 'bad', text: x('h.badId') }); return }
    const id = BigInt(pick.trim())
    setBusy(true)
    try { setTop({ tone: 'muted', text: x('h.reading', { id: pick }) }); await E.precheck(level, id); setTop(null) } catch (e) { setTop(errNote(E, e)); setBusy(false); return }
    let at = 0
    try {
      const p = await E.prove(level, id, encUrl, { step: (i, st, info) => { at = i; hooks.step(i, st, info) } })
      proven.current = p
      at = 2
      await E.pay(level, p, { step: (i, st, info) => { at = i; hooks.step(i, st, info) } })
      onDone()
    } catch (e) { set(at, 'fail', huntErr(E, e)) } finally { setBusy(false) }
  }
  async function retry() {
    const p = proven.current; if (!E || !p || busy) return
    setBusy(true)
    try {
      if (accepted) await E.deliver(level, p, hooks); else await E.pay(level, p, hooks)
      onDone()
    } catch (e) { set(Math.max(2, current()), 'fail', huntErr(E, e)) } finally { setBusy(false) }
  }
  const failedPay = !!proven.current && (steps[2].st === 'fail' || steps[3].st === 'fail')
  const tKeys = ['h.s1', 'h.s2', 'h.s3', 'h.s4'] as const
  return (
    <ActSec id="hunt" title={x('h.title')} lede={x('h.lede')} copilot="hunt">
      <WalletLine />
      <div className="na-row">
        <Field label={x('h.f.bounty')}><input inputMode="numeric" value={pick} onChange={(e) => setPick(e.target.value)} /></Field>
        <Field label={x('h.f.url')} wide><input type="url" spellCheck={false} value={encUrl} onChange={(e) => setEncUrl(e.target.value)} /></Field>
      </div>
      <div className="na-row">
        <button type="button" className="btn btn-main btn-s" id="h-go" onClick={hunt} disabled={!ready || busy || !pick}><span>{x('h.go')}</span></button>
        {failedPay ? <button type="button" className="btn btn-line btn-s" onClick={retry} disabled={busy}><span>{x(accepted ? 'h.deliverOnly' : 'h.retryPay')}</span></button> : null}
      </div>
      {top ? <NoteLine n={top} /> : null}
      <ol className="na-list" aria-label={x('h.title')}>
        {steps.map((v, i) => <Step key={i} n={i + 1} part="use" el="" st={v.st} t={x(tKeys[i])} d={x(`${tKeys[i]}.d` as 'h.s1.d')} note={v.note} active={v.st === 'doing'} />)}
      </ol>
      {accepted && steps[3].st === 'fail' ? <p className="na-note" data-tone="bad">{x('h.deliverWarn')}</p> : null}
    </ActSec>
  )
}
function huntErr(E: Engine, e: unknown): Note {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = String((e as any)?.reason ?? '')
  if (r === 'pubkeys_unreachable' || (e as Error)?.name === 'TypeError') return { tone: 'bad', text: x('svc.offlineLong') }
  return errNote(E, e)
}

/** create a bounty (the console's ProtocolPanel); the protocol key is downloaded once */
/** posting a bounty, alone: the Services page's Sealed Bounty sheet uses it as its action */
export function BountyCreate({ onDone }: { onDone?: () => void }) {
  const E = useEngine()
  return <Create level="open" E={E} onDone={onDone ?? (() => {})} />
}

function Create({ level, E, onDone }: { level: Level; E: Engine | null; onDone: () => void }) {
  const lang = useLang()
  const s = useWallet()
  const ready = onArc(s) && !!E
  const [pid, setPid] = useState((level === 'open' ? PRODUCT.bounty : PRODUCT.bountyVerified).toString())
  useEffect(() => { setPid((level === 'open' ? PRODUCT.bounty : PRODUCT.bountyVerified).toString()) }, [level])
  const [fund, setFund] = useState('2')
  const [hours, setHours] = useState('24')
  const [st, setSt] = useState<{ st: St; note?: Note }>({ st: 'todo' })
  const [key, setKey] = useState<{ id: bigint; pub: Hex; priv: Hex } | null>(null)
  const [fees, setFees] = useState<{ bps: number; min: bigint } | null>(null)
  useEffect(() => { if (E) E.readBountyFees(level).then(setFees).catch(() => setFees(null)) }, [E, level])
  async function go() {
    if (!E) return
    setKey(null)
    try {
      if (!/^\d+$/.test(pid.trim())) throw new Error(x('b.badProduct'))
      const v = E.parseUsdc(fund)
      setSt({ st: 'doing', note: { tone: 'muted', text: x('b.c.signing') } })
      const r = await E.createBounty(level, { productId: BigInt(pid.trim()), funding: v, hours: Number(hours.replace(',', '.')) }, {
        sent: (o) => { setKey({ id: o.bountyId, pub: o.key.publicKey, priv: o.key.privateKey }); setSt({ st: 'doing', note: { tone: 'muted', text: x('b.c.sent', { id: o.bountyId.toString() }), hash: o.tx } }) },
      })
      setKey({ id: r.bountyId, pub: r.publicKey, priv: r.privateKey })
      setSt({ st: 'done', note: { tone: 'ok', text: x('b.c.done', { id: r.bountyId.toString(), a: usdc(v.toString(), lang) ?? '' }), hash: r.tx } })
      onDone()
    } catch (e) {
      if ((e as { kind?: string })?.kind === 'reverted') setKey(null)
      setSt({ st: 'fail', note: errNote(E, e) })
    }
  }
  function download() {
    if (!E || !key) return
    const f = E.protocolKeyFile(key.id, key.pub, key.priv)
    const a = document.createElement('a'); a.href = f.url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(f.url), 1000)
  }
  return (
    <ActSec id="create" title={x('b.c.title')} lede={x('b.c.lede')}>
      <WalletLine />
      <ol className="na-list" aria-label={x('b.c.title')}>
        <Step n={1} part="publish" el="" st={st.st} t={x('b.c.s1')} d={fees ? x('b.c.s1d', { min: usdc(fees.min.toString(), lang) ?? '', fees: (fees.bps / 100).toString() }) : x('b.c.s1d0')} note={st.note} active copilot="fund">
          <div className="na-grid">
            <Field label={x('b.f.product')}><input inputMode="numeric" value={pid} onChange={(e) => setPid(e.target.value)} /></Field>
            <Field label={x('b.f.funding')}><input inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value)} /></Field>
            <Field label={x('b.f.hours')}><input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
          </div>
          <button type="button" className="btn btn-main btn-s" id="b-create" onClick={go} disabled={!ready || st.st === 'doing'}><span>{x('b.c.btn')}</span></button>
        </Step>
      </ol>
      {key ? (
        <div className="na-ans">
          <p className="na-ans-t">{x('b.key.title', { id: key.id.toString() })}</p>
          <p className="lbl muted">{x('b.key.text', { id: key.id.toString() })}</p>
          <div className="na-row"><button type="button" className="btn btn-main btn-s" onClick={download}><span>{x('b.key.dl')}</span></button><button type="button" className="tlink" onClick={() => setKey(null)}>{x('b.key.saved')}</button></div>
        </div>
      ) : null}
    </ActSec>
  )
}

/** bounties posted by the connected address: after the deadline, the protocol withdraws what remains */
function Mine({ level, E, rows, address, onDone }: { level: Level; E: Engine | null; rows: Row[] | null; address?: string; onDone: () => void }) {
  const lang = useLang()
  const mine = useMemo(() => (address && rows ? rows.filter((b) => b.protocol.toLowerCase() === address.toLowerCase()) : []), [rows, address])
  const [n, setN] = useState<Record<string, Note>>({})
  if (!address || !mine.length) return null
  const now = nowS()
  async function withdraw(b: Row) {
    if (!E) return
    setN((m) => ({ ...m, [b.id]: { tone: 'muted', text: x('b.m.signing') } }))
    try { const h = await E.withdrawRemaining(level, BigInt(b.id)); setN((m) => ({ ...m, [b.id]: { tone: 'ok', text: x('b.m.done', { a: usdc(b.balance.toString(), lang) ?? '' }), hash: h } })); onDone() } catch (e) { setN((m) => ({ ...m, [b.id]: errNote(E, e) })) }
  }
  return (
    <ActSec id="mine" title={x('b.m.title')} lede={x('b.m.lede')}>
      <ul className="na-encs">
        {mine.map((b) => {
          const expired = b.deadline < now
          return (
            <li key={b.id}>
              <span className="lbl">{x('b.row', { id: b.id, p: b.productId })}</span>
              <span className="mono">{usdc(b.balance.toString(), lang)}</span>
              {expired && b.balance > 0n ? <button type="button" className="btn btn-line btn-s" onClick={() => withdraw(b)}><span>{x('b.m.btn')}</span></button> : <span className="lbl muted">{expired ? x('b.m.empty') : x('b.m.after')}</span>}
              {n[b.id] ? <NoteLine n={n[b.id]} /> : null}
            </li>
          )
        })}
      </ul>
    </ActSec>
  )
}
