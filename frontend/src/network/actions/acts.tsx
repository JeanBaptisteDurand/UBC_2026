// The three flows signed by the visitor's wallet (Use, Rent, Publish), shared by the Network page and the Use, Rent
// and Publish pages of the app. On the Network page, each step plays the diagram (window.__s3d); elsewhere the
// diagram is absent and only the actions matter. Each step carries its name for the copilot's guided tours
// (data-copilot, copilot/guide/registry.ts), and the install command its marker (install-cmd).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLang } from '../../i18n'
import { useLive, CONSOLE, INSTALL_URL } from '../../data/live'
import { short, usdc } from '../../data/fmt'
import { addr, serviceHref } from '../../links'
import { useCatalog } from '../../app/useCatalog'
import { RAIL_NAME, type SvcRow } from '../../app/catalog'
import { Cmd } from '../../app/parts'
import { useWallet, onArc, useUi, setUi } from './store'
import { w, type WKey } from './strings'
import { play, show, usePlay, useEngine, Step, Field, NoteLine, errNote, connectSt, ConnectStep, type St, type Engine, type Note } from './kit'
import { useShow, useTyped, REC } from './showfill'

// The part's demo (store.ts DemoState, showfill.ts): while it plays or once it is over, each flow shows simulated
// values in its own fields and steps (typed in as the scene plays the step), with only recorded hashes and blocks,
// and its buttons are off; the visitor's own state is kept apart and comes back when the demo is reset.
const DemoBadge = () => <p className="na-demo-badge lbl" role="status">{w('show.badge')}</p>

/** a catalog name already carries its number when two products share it ("Sealed Bounty #2"): never twice */
const pickName = (r: SvcRow) => (r.name.endsWith(`#${r.p.id}`) ? r.name : `${r.name}, #${r.p.id}`)
/** where a product that is not paid per call is used on this site: its session, the bounties, or its own page. The
 *  refutation demo (5, not for sale) and a replaced product (6) are not used anywhere: their own page says what they are */
const B = import.meta.env.BASE_URL
const whereOf = (r: SvcRow): { href: string; k: WKey } => (r.role?.role === 'refuteDemo' || r.role?.role === 'superseded' ? { href: serviceHref(r.p.id), k: 'u.go.other' }
  : r.svc === 'ai' ? { href: `${B}space.html?tab=sessions&p=${encodeURIComponent(r.p.id)}`, k: 'u.go.ai' }
    : r.svc === 'bounty' ? { href: `${B}space.html?tab=bounties`, k: 'u.go.bounty' } : { href: serviceHref(r.p.id), k: 'u.go.other' })

// ---------- Use ----------
/** sheet: the Services sheet of one service. The service is fixed and prefilled (no catalog, no change), the wallet
 *  step is the sheet's own button, no CCTP block: the steps left are the key check, then paying and sending. */
export function UseActs({ label, onPick, sheet = false }: { label?: string; onPick?: () => void; sheet?: boolean } = {}) {
  const lang = useLang()
  const s = useWallet()
  const E = useEngine()
  const rows = useCatalog()
  const ready = onArc(s) && !!E
  const { pid: asked, catOpen } = useUi()
  // This form pays per call (x402, X402Settler). A product given by the address (?p=, a sled, a service page) that is
  // paid otherwise (a session, a bounty) is not priced per call: the form stays on the pay-per-call product, and says
  // where that one is used. The Services sheet (sheet) gives its own product.
  const perCall = (rows ?? []).filter((r) => r.svc === 'x402' && r.p.state === 'Active')
  const askedRow = (rows ?? []).find((r) => r.p.id === asked)
  const other = !sheet && askedRow && askedRow.svc !== 'x402' ? askedRow : undefined
  const pid = sheet || askedRow?.svc === 'x402' ? asked : (perCall.find((r) => r.led === 'green') ?? perCall[0])?.p.id ?? ''
  const row = (rows ?? []).find((r) => r.p.id === pid)
  const [price, setPrice] = useState<{ st: St; p?: Awaited<ReturnType<Engine['readX402Price']>>; note?: Note }>({ st: 'todo' })
  useEffect(() => {
    if (!ready || !pid || !E) { setPrice({ st: 'todo' }); return }
    let alive = true
    setPrice({ st: 'doing' })
    E.readX402Price(BigInt(pid)).then((p) => {
      if (!alive) return
      const rail = RAIL_NAME[p.settlement.toLowerCase()] ?? short(p.settlement, 4)
      if (!p.perCall) setPrice({ st: 'fail', p, note: { tone: 'muted', text: w('u.notPerCall', { rail }), href: `${CONSOLE}/#/playground`, hrefLabel: 'Console' } })
      else if (!p.active) setPrice({ st: 'fail', p, note: { tone: 'bad', text: w('u.inactive') } })
      else setPrice({ st: 'done', p })
    }).catch((e) => { if (alive) setPrice({ st: 'fail', note: errNote(E, e) }) })
    return () => { alive = false }
  }, [ready, pid, E])
  const payable = price.st === 'done' ? price.p! : null

  const [url, setUrl] = useState('')
  useEffect(() => { if (pid && E) setUrl(E.KNOWN_ENCLAVE[pid] ?? '') }, [pid, E])
  // a refused key keeps its reason (a string key, or the engine's message); the sentence is written at render, in the
  // current language, and only offers "Change service" when that button is there
  const [key, setKey] = useState<{ st: St; signer?: string; note?: Note; whyK?: WKey; why?: string }>({ st: 'todo' })
  useEffect(() => {
    if (!ready || !payable || !E) { setKey({ st: 'todo' }); return }
    if (!/^https?:\/\/\S+$/.test(url.trim())) { setKey({ st: 'todo', note: { tone: 'muted', text: w('u.keyNoUrl') } }); return }
    let alive = true
    setKey({ st: 'doing', note: { tone: 'muted', text: w('u.keyChecking') } })
    const tm = setTimeout(() => {
      E.verifyKey(url, BigInt(pid)).then((k) => { if (alive) setKey({ st: 'done', signer: k.signer, note: { tone: 'ok', text: w('u.keyOk', { signer: short(k.signer, 4) }) } }) })
        .catch((e) => {
          if (!alive) return
          const r = String((e as { reason?: string })?.reason ?? '')
          const k = ({ pubkeys_unreachable: 'u.k.unreachable', pubkeys_unreadable: 'u.k.unreadable', not_registered: 'u.k.not_registered', wrong_product: 'u.k.wrong_product', x25519_mismatch: 'u.k.x25519_mismatch', inactive: 'u.k.inactive' } as Record<string, WKey>)[r]
          setKey({ st: 'fail', whyK: k, why: k ? undefined : E.explain(e).message })
        })
    }, 400)
    return () => { alive = false; clearTimeout(tm) }
  }, [ready, payable, url, pid, E])

  const [msgText, setMsg] = useState<string | null>(null)
  const message = msgText ?? w('u.defaultMsg')
  const [send, setSend] = useState<{ st: St; note?: Note }>({ st: 'todo' })
  const [answer, setAnswer] = useState<Awaited<ReturnType<Engine['callService']>> | null>(null)
  async function go() {
    if (!E || !payable) return
    setAnswer(null)
    show('use', 'link.useRent', false)
    setSend({ st: 'doing', note: { tone: 'muted', text: w('u.signing', { price: usdc(payable.price.toString(), lang) ?? '' }) } })
    try {
      const a = await E.callService({ url, productId: BigInt(pid), price: payable, message, hooks: { onSigned: () => setSend({ st: 'doing', note: { tone: 'muted', text: w('u.calling') } }) } })
      setAnswer(a); setSend({ st: 'done' })
      show('use', 'use.drone', true)
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (e?.name === 'X402PaidCallError') setSend({ st: 'fail', note: { tone: 'bad', text: w('u.paidLost', { why: String(e?.message ?? '').slice(0, 140) }) } })
      else if (e?.name === 'X402CallError' || (e?.name === 'TypeError' && /fetch/i.test(String(e?.message)))) setSend({ st: 'fail', note: { tone: 'bad', text: w('u.enclaveDown', { why: e?.status ? `HTTP ${e.status}` : 'network' }) } })
      else setSend({ st: 'fail', note: errNote(E, e) })
    }
  }

  const [settle, setSettle] = useState<{ st: St; note?: Note }>({ st: 'todo' })
  useEffect(() => {
    if (!answer || !E) { setSettle({ st: 'todo' }); return }
    let alive = true, n = 0, tm = 0
    const tick = async () => {
      n++
      try {
        const r = await E.settlementOf(answer.ref)
        if (!alive) return
        if (r.state === 'settled') { setSettle({ st: 'done', note: { tone: 'ok', text: w('u.settled', { amount: usdc((r.amount ?? answer.amount).toString(), lang) ?? '' }), hash: r.tx } }); return }
        if (r.state === 'expired') { setSettle({ st: 'fail', note: { tone: 'muted', text: w('u.expired') } }); return }
        setSettle({ st: 'doing', note: { tone: 'muted', text: r.state === 'consumed' ? w('u.consumed') : w('u.settlePending', { until: new Date(Number(answer.ref.validBefore) * 1000).toLocaleTimeString(lang) }) } })
      } catch (e) { if (alive) setSettle({ st: 'doing', note: errNote(E, e) }) }
      if (alive) tm = window.setTimeout(tick, n < 10 ? 3000 : 8000)
    }
    void tick()
    return () => { alive = false; clearTimeout(tm) }
  }, [answer, E, lang])

  const sts: St[] = [connectSt(s), pid ? (price.st === 'todo' && ready ? 'doing' : price.st) : 'todo', key.st, send.st, answer ? 'done' : 'todo', settle.st]
  const active0 = sts.findIndex((x) => x !== 'done')
  usePlay('use', active0, sts, { pid, tx: settle.note?.hash })
  // the part's demo: simulated values in place of the visitor's (their state is untouched)
  const S = useShow('use')
  const dUrl = useTyped(REC.enclaveUrl(), S.at(2), S.past(2), 900), dMsg = useTyped(w('u.defaultMsg'), S.at(3), S.past(3), 2200), dAns = useTyped(w('u.dm.answer'), S.at(4), S.past(4), 2600)
  const dPrice = usdc(REC.price, lang) ?? ''
  const dRow = S.on && (S.at(1) || S.past(1)) ? (rows ?? []).find((r) => r.p.id === REC.pid) : undefined
  const active = S.on ? -1 : active0
  const stOf = (i: number, real: St) => (S.on ? S.st(i) : real)
  const off = S.on
  // "Change service" is only there with a choice (several pay-per-call products) or nothing picked yet
  const canChange = !sheet && (!row || perCall.length > 1)
  const keyNote: Note | undefined = key.st === 'fail' && (key.whyK || key.why !== undefined)
    ? { tone: 'bad', text: w(canChange ? 'u.keyBad' : 'u.keyBad1', { why: key.whyK ? w(key.whyK) : key.why ?? '' }), href: `${CONSOLE}/#/playground`, hrefLabel: w('u.useConsole') }
    : key.note
  return (
    <>
      {S.on ? <DemoBadge /> : null}
      <ol className="na-list" aria-label={label} data-demo={S.on ? '1' : undefined}>
        {sheet ? null : <ConnectStep part="use" el="use.guichet" k="u" active={active === 0} copilot="connect" demo={S.on} />}
        {sheet ? null : <Step n={2} part="use" el="use.guichet" st={stOf(1, pid ? price.st : catOpen ? 'doing' : 'todo')} t={w('u.s2')} d={w('u.s2d')} note={S.on ? null : pid ? price.note : null} active={active === 1} copilot="pick">
          {S.on ? (S.at(1) || S.past(1) ? <p className="lbl na-kv na-pick"><span className="na-pick-n">{dRow ? pickName(dRow) : `#${REC.pid}`}</span> <span className="muted">{w('u.price')}</span> <span className="mono tnum">{dPrice}</span></p> : <p className="lbl muted na-kv">{w('u.none')}</p>)
            : row ? (
            <p className="lbl na-kv na-pick"><span className="na-pick-n">{pickName(row)}</span> <span className="muted">{w('u.price')}</span> <span className="mono tnum">{payable ? usdc(payable.price.toString(), lang) : price.st === 'doing' ? w('u.priceReading') : usdc(row.p.price, lang)}</span></p>
          ) : <p className="lbl muted na-kv">{w('u.none')}</p>}
          {other && !S.on ? <p className="na-note" data-tone="muted">{w('u.notCallOf', { name: other.name.endsWith(`#${other.p.id}`) ? other.name : `${other.name} #${other.p.id}` })} <a className="tlink" href={whereOf(other).href}>{w(whereOf(other).k)}</a></p> : null}
          {/* one pay-per-call product: nothing to change; the catalog only when there is a choice or nothing yet */}
          {S.on || canChange ? <button type="button" className="btn btn-line btn-s" id="u-pick" disabled={off} aria-expanded={catOpen} aria-controls="net-cat" onClick={() => { if (onPick) { onPick(); return } setUi({ catOpen: true }); play('use', 1, 'doing', 'use.guichet', false) }}><span>{row || (S.on && S.past(0)) ? w('u.change') : w('u.pickBtn')}</span></button> : null}
        </Step>}
        <Step n={3} num={sheet ? 1 : undefined} part="use" el="link.useArc" st={stOf(2, key.st)} t={w('u.s3')} d={w('u.s3d')} note={S.on ? (S.past(2) ? { tone: 'ok', text: w('u.dm.key', { signer: short(REC.signer, 4), pid: REC.enclavePid }) } : S.at(2) ? { tone: 'muted', text: w('u.keyChecking') } : null) : keyNote} active={active === 2} copilot="key">
          <Field label={w('u.url')} wide><input type="url" inputMode="url" spellCheck={false} value={S.on ? dUrl : url} readOnly={off} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
        </Step>
        <Step n={4} num={sheet ? 2 : undefined} part="use" el="link.useRent" st={stOf(3, send.st)} t={w('u.s4')} d={w('u.s4d')} note={S.on ? (S.past(3) ? { tone: 'ok', text: w('u.dm.sent') } : S.at(3) ? { tone: 'muted', text: w('u.dm.signing', { price: dPrice }) } : null) : send.note ?? (sheet && price.st === 'fail' ? price.note : null)} active={active === 3} copilot="pay">
          <Field label={w('u.msg')} wide><input value={S.on ? dMsg : message} readOnly={off} onChange={(e) => setMsg(e.target.value)} /></Field>
          <button type="button" className="btn btn-main btn-s" id="u-send" onClick={go} disabled={off || !ready || !payable || key.st !== 'done' || send.st === 'doing' || !message.trim()}>
            <span>{S.on ? w('u.send', { price: dPrice }) : payable ? w('u.send', { price: usdc(payable.price.toString(), lang) ?? '' }) : w('u.sendPlain')}</span>
          </button>
        </Step>
        <Step n={5} num={sheet ? 3 : undefined} part="use" el="use.drone" st={stOf(4, answer ? 'done' : 'todo')} t={w('u.s5')} d={w('u.s5d')} active={active === 4} copilot="answer">
          {S.on ? (S.at(4) || S.past(4) ? (
            <div className="na-ans" data-demo="1">
              <p className="na-ans-t">{dAns}</p>
              {S.past(4) ? <p className="lbl mono muted">{w('u.dm.ansMeta', { signer: short(REC.signer, 4), amount: dPrice })}</p> : null}
            </div>
          ) : null) : answer ? (
            <div className="na-ans">
              <p className="na-ans-t">{answer.text}</p>
              <p className="lbl mono muted">{`${w('u.signedBy', { signer: short(answer.signer, 4) })}, ${w('u.amount', { amount: usdc(answer.amount.toString(), lang) ?? '' })}, ${w('u.anchor', { n: answer.anchorBlock.toString() })}`}</p>
            </div>
          ) : null}
        </Step>
        <Step n={6} num={sheet ? 4 : undefined} part="use" el="link.useArc" st={stOf(5, settle.st)} t={w('u.s6')} d={w('u.s6d')} note={S.on ? (S.past(5) ? { tone: 'ok', text: w('u.dm.paid', { amount: usdc(REC.payAmount, lang) ?? '', block: REC.payBlock }), hash: REC.payTx } : null) : settle.note} active={active === 5} copilot="settled" />
      </ol>
      {sheet ? null : <Cctp />}
    </>
  )
}

export function Cctp() {
  const lang = useLang()
  const s = useWallet()
  const E = useEngine()
  const [rows, setRows] = useState<Record<string, { name: string; domain: number; balance?: bigint; error?: string }>>({})
  const asked = useRef('')
  const read = () => {
    if (!E || !s.address) return
    asked.current = s.address
    setRows(Object.fromEntries(E.OTHER_CHAINS.map((c) => [c.key, { name: c.name, domain: c.cctpDomain }])))
    void E.readOtherChains(s.address, (r) => setRows((x) => ({ ...x, [r.key]: r })))
  }
  // RPCs of the other chains are only called once the wallet is connected
  useEffect(() => { if (s.phase === 'connected' && s.address && E && asked.current !== s.address) read() }, [s.phase, s.address, E]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="cctp" aria-labelledby="cctp-t">
      <h3 className="lbl cctp-t" id="cctp-t">{w('c.title')}</h3>
      <p className="na-d">{w('c.lede')}</p>
      {s.phase === 'connected' ? (
        <ul className="cctp-l">
          {Object.entries(rows).map(([k, r]) => (
            <li key={k}><span>{r.name}</span><span className="mono muted">{`CCTP ${r.domain}`}</span><span className="mono tnum">{r.error ? w('c.err', { why: r.error }) : r.balance === undefined ? w('c.reading') : usdc(r.balance.toString(), lang)}</span></li>
          ))}
        </ul>
      ) : null}
      <div className="cctp-b">
        <button type="button" className="btn btn-line btn-s" disabled aria-describedby="cctp-soon"><span>{w('c.bring')}</span></button>
        <span className="na-st mono" data-st="soon">{w('st.soon')}</span>
      </div>
      <p className="na-note" data-tone="muted" id="cctp-soon">{w('c.soon')}</p>
    </section>
  )
}

// ---------- Rent ----------
export function RentActs({ label }: { label?: string } = {}) {
  const lang = useLang()
  const s = useWallet()
  const E = useEngine()
  const ready = onArc(s) && !!E
  const rows = useCatalog()
  const [bond, setBond] = useState<Awaited<ReturnType<Engine['readBond']>> | null>(null)
  const readB = () => { if (ready && s.address) E!.readBond(s.address).then(setBond).catch(() => setBond(null)) }
  useEffect(readB, [ready, s.address]) // eslint-disable-line react-hooks/exhaustive-deps
  // a bond signed from the copilot's card (copilot/cards.tsx, event archive:signed): read again, so this step (and a
  // guided tour waiting on it) turns done; once more a moment later, in case the RPC answered from an older block
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<{ tool?: string } | null>).detail?.tool !== 'operator_prepare_bond') return
      readB(); window.setTimeout(readB, 3000)
    }
    addEventListener('archive:signed', on)
    return () => removeEventListener('archive:signed', on)
  }, [ready, s.address, E]) // eslint-disable-line react-hooks/exhaustive-deps
  const [amt, setAmt] = useState('4')
  const [b, setB] = useState<{ st: St; note?: Note }>({ st: 'todo' })
  async function doBond() {
    if (!E) return
    show('rent', 'rent.operateur', false)
    try {
      const v = E.parseUsdc(amt)
      setB({ st: 'doing', note: { tone: 'muted', text: w('r.bondSign', { amount: usdc(v.toString(), lang) ?? '' }) } })
      const h = await E.lockBond(v, { sent: (hash) => setB({ st: 'doing', note: { tone: 'muted', text: w('tx.pending'), hash } }) })
      setB({ st: 'done', note: { tone: 'ok', text: w('r.bondDone'), hash: h } }); readB(); void E.refreshBalance()
    } catch (e) { setB({ st: 'fail', note: errNote(E, e) }) }
  }
  const bondSt: St = b.st !== 'todo' ? b.st : bond && bond.bond > 0n ? 'done' : 'todo'
  // bond exit (requestUnbond, then withdraw after the OperatorBond delay), as on the Operator screen
  const [unAmt, setUnAmt] = useState('1')
  const [un, setUn] = useState<Note | null>(null)
  async function doUnbond() {
    if (!E) return
    try {
      const v = E.parseUsdc(unAmt)
      setUn({ tone: 'muted', text: w('r.unbondSign') })
      const h = await E.requestUnbond(v, { sent: (hash) => setUn({ tone: 'muted', text: w('tx.pending'), hash }) })
      setUn({ tone: 'ok', text: w('r.unbondDone', { amount: usdc(v.toString(), lang) ?? '' }), hash: h }); readB()
    } catch (e) { setUn(errNote(E, e)) }
  }
  async function doWithdraw() {
    if (!E || !bond) return
    const amount = bond.pending
    setUn({ tone: 'muted', text: w('r.withdrawSign') })
    try {
      const h = await E.withdrawBond({ sent: (hash) => setUn({ tone: 'muted', text: w('tx.pending'), hash }) })
      setUn({ tone: 'ok', text: w('r.withdrawDone', { amount: usdc(amount.toString(), lang) ?? '' }), hash: h }); readB(); void E.refreshBalance()
    } catch (e) { setUn(errNote(E, e)) }
  }
  const unlocked = !!bond && bond.withdrawableAt > 0n && BigInt(Math.floor(Date.now() / 1000)) >= bond.withdrawableAt

  const [code, setCode] = useState('')
  const [p, setP] = useState<{ st: St; note?: Note }>({ st: 'todo' })
  async function doPair() {
    if (!E) return
    show('rent', 'rent.quai', false)
    setP({ st: 'doing' })
    try {
      const r = await E.pairMachine(code, { signing: () => setP({ st: 'doing', note: { tone: 'muted', text: w('r.pairSign') } }) })
      if (r.kind === 'wrongSite') setP({ st: 'todo', note: { tone: 'muted', text: w('r.wrongSite', { site: r.site }), href: r.consoleUrl, hrefLabel: w('r.openConsole') } })
      else setP({ st: 'done', note: { tone: 'ok', text: w('r.pairDone', { host: r.host || 'the machine' }) } })
    } catch (e) { setP({ st: 'fail', note: errNote(E, e) }) }
  }

  // admission, live: the enclaves registered by the connected address, with the wall's status light
  const mine = useMemo(() => {
    if (!s.address || !rows) return []
    const a = s.address.toLowerCase()
    return rows.flatMap((r) => r.encs.filter((x) => x.e.operator.toLowerCase() === a).map((x) => ({ ...x, pid: r.p.id, name: r.name })))
  }, [rows, s.address])
  const admSt: St = mine.some((x) => x.led === 'green') ? 'done' : mine.length ? 'doing' : 'todo'
  const cmds = [`curl -fsSL ${INSTALL_URL} | sh`, 'archive-node doctor', 'archive-node pair', 'archive-node up --product 1 --tunnel']
  const sts: St[] = [connectSt(s), bondSt, p.st === 'done' || mine.length ? 'done' : 'todo', p.st, admSt]
  const active0 = sts.findIndex((x) => x !== 'done')
  usePlay('rent', active0, sts, { tx: b.note?.hash })
  // the part's demo: simulated values in place of the visitor's (their state is untouched)
  const S = useShow('rent')
  const dAmt = useTyped(REC.bond, S.at(1), S.past(1), 500), dCode = useTyped(REC.pairCode, S.at(3), S.past(3), 1500)
  const active = S.on ? -1 : active0
  const stOf = (i: number, real: St) => (S.on ? S.st(i) : real)
  const off = S.on
  return (
    <>
    {S.on ? <DemoBadge /> : null}
    <ol className="na-list" aria-label={label} data-demo={S.on ? '1' : undefined}>
      <ConnectStep part="rent" el="rent.operateur" k="r" active={active === 0} copilot="connect" demo={S.on} />
      <Step n={2} part="rent" el="rent.operateur" st={stOf(1, bondSt)} t={w('r.s2')} d={w('r.s2d')} note={S.on ? (S.past(1) ? { tone: 'ok', text: w('r.dm.bond', { amount: REC.bond }), hash: REC.bondTx } : null) : b.note} active={active === 1} copilot="bond">
        {bond && !S.on ? <p className="lbl na-kv mono tnum">{w('r.bondNow', { bond: usdc(bond.bond.toString(), lang) ?? '', free: usdc(bond.free.toString(), lang) ?? '' })}</p> : null}
        <div className="na-row">
          <Field label={w('r.amount')}><input inputMode="decimal" value={S.on ? dAmt : amt} readOnly={off} onChange={(e) => setAmt(e.target.value)} /></Field>
          <button type="button" className="btn btn-main btn-s" id="r-bond" onClick={doBond} disabled={off || !ready || b.st === 'doing'}><span>{w('r.bondBtn', { amount: `${(S.on ? REC.bond : amt.trim()) || '0'} USDC` })}</span></button>
        </div>
        {bond && !S.on && (bond.bond > 0n || bond.pending > 0n) ? (
          <div className="na-unbond">
            <p className="lbl muted">{w('r.unbondLede')}</p>
            {bond.pending > 0n ? (
              <div className="na-row">
                <p className="lbl na-kv mono tnum">{w('r.pending', { amount: usdc(bond.pending.toString(), lang) ?? '', when: unlocked ? w('r.now') : bond.withdrawableAt > 0n ? new Date(Number(bond.withdrawableAt) * 1000).toLocaleString(lang) : w('r.readingDelay') })}</p>
                <button type="button" className="btn btn-main btn-s" id="r-withdraw" onClick={doWithdraw} disabled={!ready || !unlocked}><span>{w('r.withdrawBtn')}</span></button>
              </div>
            ) : null}
            <div className="na-row">
              <Field label={w('r.unbondAmount')}><input inputMode="decimal" value={unAmt} onChange={(e) => setUnAmt(e.target.value)} /></Field>
              <button type="button" className="btn btn-line btn-s" id="r-unbond" onClick={doUnbond} disabled={!ready || bond.free === 0n}><span>{w('r.unbondBtn')}</span></button>
            </div>
            {un ? <NoteLine n={un} /> : null}
          </div>
        ) : null}
      </Step>
      <Step n={3} part="rent" el="rent.quai" st={stOf(2, sts[2])} t={w('r.s3')} d={w('r.s3d')} note={S.on && (S.at(2) || S.past(2)) ? { tone: S.past(2) ? 'ok' : 'muted', text: w('r.dm.agent', { q: REC.quoteBytes, n: REC.events }) } : null} active={active === 2} copilot="install">
        {/* the install command's box, for the copilot (copy): a wrapper without a box of its own */}
        <div className="na-cmds">{cmds.map((c, i) => (i === 0 ? <div key={c} data-copilot="install-cmd" style={{ display: 'contents' }}><Cmd cmd={c} /></div> : <Cmd key={c} cmd={c} />))}</div>
      </Step>
      <Step n={4} part="rent" el="rent.quai" st={stOf(3, p.st)} t={w('r.s4')} d={w('r.s4d')} note={S.on ? (S.past(3) ? { tone: 'ok', text: w('r.dm.pair') } : null) : p.note} active={active === 3} copilot="pair">
        <div className="na-row">
          <Field label={w('r.code')}><input value={S.on ? dCode : code} readOnly={off} onChange={(e) => setCode(e.target.value)} placeholder="HIVE-7K2P-QX9M" autoCapitalize="characters" spellCheck={false} /></Field>
          <button type="button" className="btn btn-main btn-s" id="r-pair" onClick={doPair} disabled={off || !ready || p.st === 'doing' || !code.trim()}><span>{w('r.pairBtn')}</span></button>
        </div>
      </Step>
      <Step n={5} part="rent" el="rent.portique" st={stOf(4, admSt)} t={w('r.s5')} d={w('r.s5d')} note={S.on && S.past(4) ? { tone: 'ok', text: w('r.dm.adm', { block: REC.regBlock, gas: lang === 'fr' ? REC.regGas.replace('.', ',') : REC.regGas }), hash: REC.regTx } : null} active={active === 4} copilot="admit">
        {S.on ? (S.past(4) ? (
          <ul className="na-encs" data-demo="1">
            <li><span className="led led-green" aria-hidden="true" /><a className="tlink mono" href={addr(REC.signer)} target="_blank" rel="noreferrer">{short(REC.signer, 4)}</a><span className="lbl muted">{w('r.product', { id: REC.enclavePid })}</span><span className="lbl">{w('r.dm.led')}</span></li>
          </ul>
        ) : null) : s.address ? (mine.length ? (
          <ul className="na-encs">
            {mine.map((x) => (
              <li key={x.e.signer}><span className={`led led-${x.led === 'off' ? 'off' : x.led}`} aria-hidden="true" /><a className="tlink mono" href={addr(x.e.signer)} target="_blank" rel="noreferrer">{short(x.e.signer, 4)}</a><span className="lbl muted">{`${x.name}, ${w('r.product', { id: x.pid })}`}</span><span className="lbl">{w(`r.led.${x.led}` as WKey)}</span></li>
            ))}
          </ul>
        ) : <p className="na-note" data-tone="muted">{w('r.none')}</p>) : null}
      </Step>
    </ol>
    </>
  )
}

// ---------- Publish ----------
const MANIFEST = `{
  "name": "My sealed service",
  "image": "ghcr.io/you/service:1.0",
  "model": "openai/gpt-oss-120b"
}`
export function PublishActs({ label }: { label?: string } = {}) {
  const lang = useLang()
  const s = useWallet()
  const E = useEngine()
  const ready = onArc(s) && !!E
  const products = useLive((x) => x.products)
  const [d, setD] = useState({ manifest: MANIFEST, uri: '', image: '', price: '0.01', minBond: '1', rail: 'x402' as 'x402' | 'session', bpsOperator: 8000, bpsAuthor: 1000, bpsNetwork: 1000 })
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: k.startsWith('bps') ? Math.round(Number(e.target.value.replace(',', '.')) * 100) || 0 : e.target.value }))
  const hash = useMemo(() => { if (!E) return ''; try { JSON.parse(d.manifest); return E.manifestHash(d.manifest) } catch { return '' } }, [E, d.manifest])
  let check: string | null = null
  if (E) { try { E.proposeParams(d) } catch (e) { check = (e as Error).message } }
  const manSt: St = hash && /^(https:\/\/|ipfs:\/\/)\S+$/.test(d.uri.trim()) ? 'done' : 'todo'
  const fpSt: St = /^0x[0-9a-fA-F]{64}$/.test(d.image.trim()) && d.bpsOperator + d.bpsAuthor + d.bpsNetwork === 10000 && d.bpsAuthor <= 3000 && d.bpsNetwork >= 500 ? 'done' : 'todo'
  const [pr, setPr] = useState<{ st: St; note?: Note; id?: bigint }>({ st: 'todo' })
  async function doPropose() {
    if (!E) return
    show('publish', 'link.publishArc', false)
    setPr({ st: 'doing', note: { tone: 'muted', text: w('p.proposeSign') } })
    try {
      const r = await E.propose(d, { sent: (hash) => setPr({ st: 'doing', note: { tone: 'muted', text: w('tx.pending'), hash } }) })
      setPr({ st: 'done', id: r.id, note: { tone: 'ok', text: w('p.proposed', { id: r.id.toString() }), hash: r.tx } })
      setSel(r.id.toString())
    } catch (e) { setPr({ st: 'fail', note: errNote(E, e) }) }
  }
  // review state: this address's products, read live, and the exact state on Arc of the chosen product
  const mine = useMemo(() => (s.address && products ? products.filter((p) => p.author.toLowerCase() === s.address!.toLowerCase()) : []), [products, s.address])
  const [sel, setSel] = useState('')
  useEffect(() => { if (!sel && mine.length) setSel(mine[mine.length - 1].id) }, [mine, sel])
  const [ps, setPs] = useState<Awaited<ReturnType<Engine['readProduct']>> | null>(null)
  const [ac, setAc] = useState<{ st: St; note?: Note }>({ st: 'todo' })
  useEffect(() => {
    if (!ready || !sel || !E) { setPs(null); return }
    let alive = true
    const rd = () => E.readProduct(BigInt(sel)).then((x) => { if (alive) setPs(x) }).catch(() => {})
    void rd(); const iv = window.setInterval(rd, 8000)
    return () => { alive = false; clearInterval(iv) }
  }, [ready, sel, E, ac.st])
  async function doActivate() {
    if (!E || !ps) return
    show('publish', 'arc', false)
    setAc({ st: 'doing', note: { tone: 'muted', text: w('p.activateSign') } })
    try {
      const h = await E.activate(ps.id, { sent: (hash) => setAc({ st: 'doing', note: { tone: 'muted', text: w('tx.pending'), hash } }) })
      setAc({ st: 'done', note: { tone: 'ok', text: w('tx.ok'), hash: h } })
    } catch (e) { setAc({ st: 'fail', note: errNote(E, e) }) }
  }
  const revSt: St = ac.st === 'fail' ? 'fail' : ps?.state === 'Active' ? 'done' : ps || ac.st === 'doing' ? 'doing' : 'todo'
  const sts: St[] = [connectSt(s), manSt, fpSt, pr.st, revSt]
  const active0 = sts.findIndex((x) => x !== 'done')
  usePlay('publish', active0, sts, { pid: pr.id?.toString() ?? sel, tx: ac.note?.hash ?? pr.note?.hash })
  // the part's demo: simulated values in place of the visitor's (their state is untouched)
  const S = useShow('publish')
  const dMan = useTyped(MANIFEST, S.at(1), S.past(1), 1800), dUri = useTyped(REC.manifestUri, S.at(1) && dMan.length === MANIFEST.length, S.past(1), 600)
  const dImg = useTyped(REC.imageId, S.at(2), S.past(2), 900)
  const dP = S.on && (S.at(2) || S.past(2))
  const dv = { price: dP ? usdc(REC.price, 'en')?.replace(/\s*USDC$/, '') ?? '' : '', minBond: dP ? REC.minBond : '', op: dP ? REC.bps[0] / 100 : '', au: dP ? REC.bps[1] / 100 : '', nw: dP ? REC.bps[2] / 100 : '' }
  const active = S.on ? -1 : active0
  const stOf = (i: number, real: St) => (S.on ? S.st(i) : real)
  const off = S.on
  return (
    <>
    {S.on ? <DemoBadge /> : null}
    <ol className="na-list" aria-label={label} data-demo={S.on ? '1' : undefined}>
      <ConnectStep part="publish" el="publish.poste" k="p" active={active === 0} copilot="connect" demo={S.on} />
      <Step n={2} part="publish" el="publish.poste" st={stOf(1, manSt)} t={w('p.s2')} d={w('p.s2d')} active={active === 1} copilot="manifest">
        <Field label={w('p.manifest')} wide><textarea rows={5} spellCheck={false} value={S.on ? dMan : d.manifest} readOnly={off} onChange={set('manifest')} /></Field>
        <Field label={w('p.uri')} wide><input type="url" spellCheck={false} value={S.on ? dUri : d.uri} readOnly={off} onChange={set('uri')} placeholder="https://example.com/manifest.json" /></Field>
        {S.on ? (S.past(1) ? <p className="lbl na-kv"><span className="muted">{`${w('p.hash')}, ${w('p.dm.hash')}`}</span> <span className="mono">{short(REC.manifestHash, 8)}</span></p> : null)
          : hash ? <p className="lbl na-kv"><span className="muted">{w('p.hash')}</span> <span className="mono">{short(hash, 8)}</span></p> : null}
      </Step>
      <Step n={3} part="publish" el="publish.poste" st={stOf(2, fpSt)} t={w('p.s3')} d={w('p.s3d')} active={active === 2} copilot="fingerprint">
        <Field label={w('p.image')} wide><input spellCheck={false} value={S.on ? dImg : d.image} readOnly={off} onChange={set('image')} placeholder="0x" /></Field>
        <div className="na-grid">
          <Field label={w('p.price')}><input inputMode="decimal" value={S.on ? dv.price : d.price} readOnly={off} onChange={set('price')} /></Field>
          <Field label={w('p.minBond')}><input inputMode="decimal" value={S.on ? dv.minBond : d.minBond} readOnly={off} onChange={set('minBond')} /></Field>
          <Field label={w('p.rail')}><span className="na-sel"><select value={S.on ? 'x402' : d.rail} disabled={off} onChange={set('rail')}><option value="x402">{w('p.rail.x402')}</option><option value="session">{w('p.rail.session')}</option></select></span></Field>
          <Field label={w('p.op')}><input inputMode="decimal" value={S.on ? dv.op : d.bpsOperator / 100} readOnly={off} onChange={set('bpsOperator')} /></Field>
          <Field label={w('p.author')}><input inputMode="decimal" value={S.on ? dv.au : d.bpsAuthor / 100} readOnly={off} onChange={set('bpsAuthor')} /></Field>
          <Field label={w('p.network')}><input inputMode="decimal" value={S.on ? dv.nw : d.bpsNetwork / 100} readOnly={off} onChange={set('bpsNetwork')} /></Field>
        </div>
      </Step>
      <Step n={4} part="publish" el="link.publishArc" st={stOf(3, sts[3])} t={w('p.s4')} d={w('p.s4d')} note={S.on ? (S.past(3) ? { tone: 'ok', text: w('p.dm.proposed'), hash: REC.proposeTx } : S.at(3) ? { tone: 'muted', text: w('tx.pending') } : null) : pr.note ?? (ready && check ? { tone: 'muted', text: check } : null)} active={active === 3} copilot="propose">
        <button type="button" className="btn btn-main btn-s" id="p-propose" onClick={doPropose} disabled={off || !ready || !!check || pr.st === 'doing'}><span>{w('p.propose')}</span></button>
      </Step>
      <Step n={5} part="publish" el="arc" st={stOf(4, revSt)} t={w('p.s5')} d={w('p.s5d')} note={S.on ? (S.past(4) ? { tone: 'ok', text: w('p.dm.published'), hash: REC.activateTx } : null) : ac.note} active={active === 4} copilot="activate">
        {S.on ? (S.past(4) ? <p className="lbl na-kv"><span className="muted">{w('p.state')}</span> <span className="mono">{w('p.dm.state')}</span></p> : null) : s.address ? (mine.length ? (
          <>
            <Field label={w('p.mine')}><span className="na-sel"><select value={sel} onChange={(e) => setSel(e.target.value)}>{mine.map((p) => <option key={p.id} value={p.id}>{`#${p.id}`}</option>)}</select></span></Field>
            {ps ? <p className="lbl na-kv"><span className="muted">{w('p.state')}</span> <span className="mono">{w(`p.st.${ps.state}` as WKey)}</span>{ps.state === 'Proposed' && ps.activatesAt > ps.now ? <span className="muted">{` ${w('p.activeOn', { when: new Date(Number(ps.activatesAt) * 1000).toLocaleString(lang) })}`}</span> : null}</p> : null}
            {ps?.state === 'Proposed' ? <button type="button" className="btn btn-line btn-s" onClick={doActivate} disabled={ac.st === 'doing' || ps.activatesAt > ps.now}><span>{w('p.activate')}</span></button> : null}
          </>
        ) : <p className="na-note" data-tone="muted">{w('p.noMine')}</p>) : null}
      </Step>
    </ol>
    </>
  )
}

