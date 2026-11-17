// A service page: everything is read live from the API and Arc testnet. Shared by the Use page panel (sliding in
// from the right) and by service.html (standalone). Includes the second reading: the cost and its split, the enclaves
// serving it, what Arc verified (manifest, image digests), the latest writes on Arc. No signing: the action links to
// the console.
import { useEffect, useRef, useState } from 'react'
import { useLive, ago } from '../data/live'
import { short, usdc, pct, num } from '../data/fmt'
import { t, useLang, type TKey } from '../i18n'
import { priceText, whyText, type Led } from '../data/wall'
import { actFor, consoleFor, link, tx, addr, serviceHref } from '../links'
import { LevelBadge, useServiceLevel } from './levels'
import { x as xs } from '../network/actions/strings-x'
import { useCatalog } from './useCatalog'
import { RAIL_NAME, railKey, isPay, payAmount, type SvcRow, type EncRow } from './catalog'
import { readManifest, isAllowed, type Manifest } from './proofs'
import { refutationOfBounty } from '../data/facts'
import { useIn } from '../ui/gestures'
import type { Activity, Bounty } from '../data/live'

const dateOf = (unix: string | number | undefined, lang: string, time = false) => {
  const n = Number(unix)
  if (!n) return null
  return new Date(n * 1000).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', time ? { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'long', year: 'numeric' })
}
const encWord = (n: number) => t(n === 1 ? 'w.enclave' : 'w.enclaves')
export const ledClass = (l: Led) => (l === 'off' ? 'led' : `led led-${l}`)

/** a service status in one sentence */
export function stateLine(r: SvcRow) {
  if (r.role?.role === 'superseded') return t('d.state.superseded', { id: r.role.by })
  if (r.p.state === 'Proposed') return t('d.state.proposed')
  if (r.led === 'red') return t('d.state.red')
  if (r.led === 'green') return r.encs.length === 1 ? t('d.state.green1') : t('d.state.green', { a: r.running, b: r.encs.length, enc: encWord(r.encs.length) })
  return r.encs.length ? t('d.state.amber') : t('d.state.amberNone')
}
/** the price as the product charges it (zero-price bounty: paid from the reserve) */
export function priceOf(r: SvcRow) {
  if (r.svc === 'bounty' && !Number(r.p.price)) return t('app.pool')
  return priceText(r.p) ?? ''
}

function Ext({ href, children }: { href?: string; children: React.ReactNode }) {
  return href ? <a className="tlink mono" href={href} target="_blank" rel="noreferrer">{children}</a> : <span className="mono">{children}</span>
}

function Split({ r }: { r: SvcRow }) {
  const lang = useLang()
  const parts: [TKey, number, string][] = [['d.op', r.p.bpsOperator, 'sp-op'], ['d.author', r.p.bpsAuthor, 'sp-au'], ['d.net', r.p.bpsNetwork, 'sp-net']]
  return (
    <div className="split">
      <div className="split-bar" aria-hidden="true">{parts.filter((x) => x[1] > 0).map(([k, v, c]) => <i key={k} className={c} style={{ flexGrow: v }} />)}</div>
      <dl className="split-l">{parts.map(([k, v, c]) => <div key={k}><dt><i className={c} aria-hidden="true" />{t(k)}</dt><dd className="mono tnum">{pct(v, lang)}</dd></div>)}</dl>
    </div>
  )
}

function encState(x: EncRow) {
  if (x.led === 'green') return t('led.green')
  return whyText(x.why)
}

function Enclaves({ r }: { r: SvcRow }) {
  const lang = useLang()
  if (!r.encs.length) return <p className="body">{t('d.noenc')}</p>
  return (
    <ul className="encs unfold">
      {r.encs.map((x, j) => {
        const until = Number(x.e.expiresAt) * 1000
        const open = x.e.active && until > Date.now()
        return (
          <li key={x.e.signer} className="row enc" style={{ ['--j' as string]: j }}>
            <span className={ledClass(x.led)} aria-hidden="true" />
            {/* a small table per enclave: labels and values aligned from one enclave to the next */}
            <dl className="enc-g">
              <dt><Ext href={addr(x.e.signer)}>{short(x.e.signer, 4)}</Ext></dt><dd className="enc-st">{encState(x)} <LevelBadge signer={x.e.signer} /></dd>
              <dt>{t('d.operator')}</dt><dd><Ext href={addr(x.e.operator)}>{short(x.e.operator, 4)}</Ext></dd>
              <dt>{t('d.tcb')}</dt><dd>{x.e.tcbStatus === 0 ? t('d.tcb.ok') : t('d.tcb.review')}</dd>
              <dt>{t('d.reg')}</dt>
              <dd className="enc-reg">
                <span>{open ? t('d.win.open', { t: dateOf(x.e.expiresAt, lang, true) ?? '' }) : t('d.win.closed', { t: ago(until, lang) })}</span>
                {x.reg ? <Ext href={tx(x.reg.tx)}>{`${t('d.regtx')}, ${t('word.block')} ${num(x.reg.block, lang)}`}</Ext> : <span>{t('d.noreg')}</span>}
              </dd>
            </dl>
          </li>
        )
      })}
    </ul>
  )
}

function Images({ r }: { r: SvcRow }) {
  const ids = [...new Set(r.encs.map((x) => x.e.workloadId))]
  const [ok, setOk] = useState<Record<string, boolean | null | undefined>>({})
  useEffect(() => {
    let alive = true
    ids.forEach((w) => isAllowed(r.p.id, w).then((v) => { if (alive) setOk((o) => ({ ...o, [w]: v })) }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.p.id, ids.join()])
  if (!ids.length) return null
  return (
    <div className="kv-row">
      <dt>{t('d.images')}</dt>
      <dd>
        <ul className="imgs">{ids.map((w) => (
          <li key={w}><span className="mono">{short(w, 6)}</span> <span className={`img-st ${ok[w] === true ? 'is-ok' : ok[w] === false ? 'is-no' : ''}`}>{ok[w] === true ? t('d.img.ok') : ok[w] === false ? t('d.img.no') : t('d.img.wait')}</span></li>
        ))}</ul>
      </dd>
    </div>
  )
}

function ManifestBlock({ r }: { r: SvcRow }) {
  const [m, setM] = useState<Manifest | null>(null)
  useEffect(() => { let alive = true; setM(null); readManifest(r.p.manifestURI, r.p.manifestHash).then((v) => { if (alive) setM(v) }); return () => { alive = false } }, [r.p.manifestURI, r.p.manifestHash])
  return (
    <>
      <div className="kv-row"><dt>{t('d.manifest')}</dt><dd className="mono">{short(r.p.manifestHash, 6)}</dd></div>
      <div className="kv-row kv-wide">
        <dd>
          {!m ? <span className="muted">{t('d.img.wait')}</span>
            : m.state === 'ok' ? (
              <div className="man">
                <p className="man-t">{m.product}</p>
                {m.image ? <p className="mono man-i">{m.image}</p> : null}
                <p className="lbl muted">{t('d.manifest.ok')} <a className="tlink" href={m.uri} target="_blank" rel="noreferrer">{t('d.manifest.open')}</a></p>
              </div>
            ) : m.state === 'none' ? <span className="muted">{t('d.manifest.none')}</span>
            // product 6 shares product 7's manifest address; a missing or unreadable copy is not a "changed"
            // manifest
            : r.role?.role === 'superseded' ? <span className="muted">{t('d.manifest.superseded', { id: r.role.by })} <a className="tlink" href={m.uri} target="_blank" rel="noreferrer">{t('d.manifest.open')}</a></span>
            : m.state === 'unread' ? <span className="muted">{t('d.manifest.unread')} <a className="tlink" href={m.uri} target="_blank" rel="noreferrer">{t('d.manifest.open')}</a></span>
            : <span className="muted">{t('d.manifest.changed')} <a className="tlink" href={m.uri} target="_blank" rel="noreferrer">{t('d.manifest.open')}</a></span>}
        </dd>
      </div>
    </>
  )
}

function evText(a: Activity) {
  const s = a.args.signer ? short(a.args.signer, 4) : ''
  const id = a.args.bountyId ?? ''
  switch (a.name) {
    case 'CallSettled': case 'Settled': return t('ev.pay', { a: usdc(payAmount(a)) ?? '' })
    case 'EnclaveRegistered': return t('ev.reg', { s })
    // an image withdrawn by the author replaces the enclave, it does not condemn it
    case 'EnclaveInvalidated': return a.args.reason === 'workload-retired' ? t('ev.replaced', { s }) : t('ev.inv', { s })
    case 'EnclaveRetired': return t('ev.ret', { s })
    case 'EquivocationSlashed': return t('ev.slash', { s })
    case 'ProductUpdated': case 'ManifestURIUpdated': return t('ev.prod')
    case 'WorkloadAdded': return t('ev.work')
    case 'WorkloadRetired': return t('ev.workRet')
    case 'ProductActivated': return t('ev.act')
    case 'ProductProposed': return t('ev.prop')
    // bounties and their verdicts (a refutation shows here, linked to the product through /api/bounties)
    case 'BountyCreated': return t('ev.bCreated', { id, a: usdc(a.args.funding) ?? '' })
    case 'BountyFunded': return t('ev.bFunded', { id, a: usdc(a.args.amount) ?? '' })
    case 'ClaimAccepted': return t('ev.claimOk', { id, a: usdc(a.args.amount) ?? '' })
    case 'ClaimRefuted': return t('ev.claimNo', { id })
    case 'BountyPaid': return t('ev.bPaid', { id, a: usdc(a.args.amount) ?? '' })
    case 'ExploitDelivered': return t('ev.delivered', { id })
    case 'BountyReopened': return t('ev.reopen', { id })
    case 'BountyPauseSet': return t(String(a.args.paused) === 'true' ? 'ev.paused' : 'ev.resumed', { id })
    case 'UndeliveredCancelled': return t('ev.cancel', { id })
    case 'RemainingWithdrawn': return t('ev.withdraw', { id, a: usdc(a.args.amount) ?? '' })
    case 'Recorded': return t('ev.verdict', { r: a.args.response ?? '', tag: a.args.tag ?? '' })
    default: return null
  }
}
const evLed = (a: Activity): Led => (
  isPay(a) || a.name === 'EnclaveRegistered' || a.name === 'ProductActivated' || a.name === 'BountyPaid' || a.name === 'BountyCreated' ? 'green'
    : a.name === 'ClaimRefuted' || a.name === 'EquivocationSlashed' || (a.name === 'Recorded' && Number(a.args.response) === 0) ? 'red'
      : a.name === 'EnclaveInvalidated' || a.name === 'EnclaveRetired' || a.name === 'ClaimAccepted' ? 'amber' : 'off'
)

function Events({ r }: { r: SvcRow }) {
  const lang = useLang()
  const list = r.events.filter((a) => evText(a)).slice(0, 6)
  if (!list.length) return <p className="body">{t('d.activity.none')}</p>
  return (
    <ol className="evs unfold">
      {list.map((a, j) => (
        <li key={`${a.tx}-${a.logIndex}`} className="row ev" style={{ ['--j' as string]: j }}>
          <span className={ledClass(evLed(a))} aria-hidden="true" />
          <span className="ev-t">{evText(a)}</span>
          <a className="tlink mono tnum" href={tx(a.tx)} target="_blank" rel="noreferrer">{`${t('word.block')} ${num(a.block, lang)}`}</a>
        </li>
      ))}
    </ol>
  )
}

/** What was actually paid. Bounty.paidAmount is only "the highest tier granted since the last arming"
 *  (SealedBounty.sol): set as soon as a claim is accepted, it remains after a refutation. The paid amount is therefore
 *  read from the BountyPaid events of the read window, and the demo refutation (bounty 2), too old for that window,
 *  from data/facts.ts */
function bountyTruth(b: Bounty, events: Activity[]) {
  const mine = events.filter((a) => String(a.args.bountyId) === b.id)
  const paid = mine.filter((a) => a.name === 'BountyPaid').reduce((s, a) => s + BigInt(a.args.amount ?? 0), 0n)
  const refutedEv = mine.find((a) => a.name === 'ClaimRefuted')
  return { paid, refuted: refutationOfBounty(b.id), refutedEv }
}
function Bounties({ r }: { r: SvcRow }) {
  const lang = useLang()
  if (!r.bounties.length) return null
  return (
    <section className="d-sec">
      <h3 className="d-h">{t('d.bounties')}</h3>
      {r.bounties.map((b) => {
        const { paid, refuted, refutedEv } = bountyTruth(b, r.events)
        // a bounty past its deadline is closed (the console does the same)
        const closed = Number(b.deadline) > 0 && Number(b.deadline) * 1000 < Date.now()
        return (
          <dl key={b.id} className="kv-list">
            <div className="kv-row"><dt>{t('d.b.balance')}</dt><dd className="mono">{usdc(b.balance)}{b.paused ? `, ${t('d.b.paused')}` : ''}</dd></div>
            {paid > 0n ? (
              <div className="kv-row"><dt>{t('d.b.paid')}</dt><dd className="mono">{usdc(paid.toString(), lang)}</dd></div>
            ) : refuted ? (
              <div className="kv-row"><dt>{t('d.b.paid')}</dt><dd className="mono">{t('d.b.nothing')}</dd></div>
            ) : (
              <div className="kv-row"><dt>{t('d.b.granted')}</dt><dd className="mono">{usdc(b.paidAmount, lang)}{refutedEv ? `, ${t('d.b.refutedEv')}` : ''}</dd></div>
            )}
            {refuted ? <div className="kv-row"><dt>{t('d.b.refuted')}</dt><dd><span className="mono">{t('d.b.refutedV', { a: usdc(refuted.seized, lang) ?? '' })}</span> <Ext href={tx(refuted.refuteTx)}>{`${t('word.block')} ${num(refuted.refuteBlock, lang)}`}</Ext></dd></div> : null}
            <div className="kv-row"><dt>{t('d.b.cap')}</dt><dd className="mono">{usdc(b.singleCap, lang)}</dd></div>
            <div className="kv-row"><dt>{t(closed ? 'd.b.closed' : 'd.b.deadline')}</dt><dd className="mono">{dateOf(b.deadline, lang) ?? t('state.unread')}</dd></div>
          </dl>
        )
      })}
    </section>
  )
}

/** what the chain does not say about a product (data/facts.ts): refutation demo, replaced, verified level */
function RoleNote({ r }: { r: SvcRow }) {
  const lang = useLang()
  const role = r.role
  if (!role) return null
  const text = role.role === 'refuteDemo' ? t('d.role.refuteDemo')
    : role.role === 'superseded' ? t('d.role.superseded', { id: role.by })
      : t('d.role.verified', { t: new Date(role.slashFrom * 1000).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) })
  return (
    <p className="body d-role">
      {text}
      {role.role === 'superseded' ? <> <a className="tlink" href={serviceHref(role.by)}>{t('d.role.open', { id: role.by })}</a></> : null}
    </p>
  )
}

/** the action: the console (the front only reads). The text follows the product's settlement (the Copilot is free,
 *  a bounty pays from its reserve), says when no enclave is running, and points a replaced product to its replacement */
function UseIt({ r, inPanel }: { r: SvcRow; inPanel: boolean }) {
  useLang()
  const free = /^0x0+$/.test(r.p.settlement)
  const pay = free ? t('d.use.free') : r.svc === 'bounty' && !Number(r.p.price) ? t('d.use.bounty') : t('d.use.paid')
  return (
    <>
      <p className="body">{r.role?.role === 'superseded' ? t('d.use.superseded', { id: r.role.by }) : `${t('d.use.lede')} ${pay}${r.running === 0 ? ` ${t('d.use.none')}` : ''}`}</p>
      <div className="d-acts">
        {r.role?.role === 'superseded'
          ? <a className="btn btn-main" href={serviceHref(r.role.by)}><span>{t('d.role.open', { id: r.role.by })}</span></a>
          : <a className="btn btn-main" href={actFor(r.svc, r.p.id)}><span>{t('d.use.btn')}</span></a>}
        <a className="tlink" href={link.dev}>{t('d.dev')}</a>
        {inPanel ? <a className="tlink" href={serviceHref(r.p.id)}>{t('d.page')}</a> : null}
      </div>
    </>
  )
}

/** a service body: header, status, cost, enclaves, proofs, activity, action */
export function ServiceDetail({ pid, inPanel = false, headingId, wide = false }: { pid: string; inPanel?: boolean; headingId?: string; wide?: boolean }) {
  const lang = useLang()
  const rows = useCatalog()
  const status = useLive((s) => s.status)
  const box = useRef<HTMLDivElement>(null)
  useIn(box, 1)
  const r = rows?.find((x) => x.p.id === pid)
  if (!r) {
    const none = rows && status !== 'loading'
    // an unreachable API must not leave "Reading" forever: say so, and re-read on demand
    const down = !rows && status === 'error'
    return (
      <div className={`detail ${none || down ? '' : 'is-reading'}`} ref={box}>
        {/* the exact slot of the type line: the title does not move when the data arrives (CLS) */}
        <p className="lbl muted" aria-hidden="true">{'\u00a0'}</p>
        <h2 className="d-name" id={headingId} tabIndex={-1} data-svc-h>{none ? t('d.none') : down ? t('svc.page') : t('d.reading')}</h2>
        {none ? <p className="body">{t('d.none.hint')}</p> : null}
        {down ? <p className="body">{t('d.down')}</p> : null}
        {down ? <button className="btn btn-line btn-s" onClick={() => location.reload()}><span>{t('app.retry')}</span></button> : null}
        {none ? <a className="tlink" href={link.use}>{t('d.back')}</a> : null}
      </div>
    )
  }
  const rail = RAIL_NAME[r.p.settlement.toLowerCase()]
  return (
    <div className="detail" ref={box} data-led={r.led}>
      <p className="lbl muted">{t('d.kind', { k: t(railKey(r.p) as TKey), id: r.p.id })}</p>
      <h2 className={`d-name plate is-${r.led}`} id={headingId} tabIndex={-1} data-svc-h>{r.name}</h2>
      <p className="d-state"><span className={ledClass(r.led)} aria-hidden="true" />{stateLine(r)}</p>
      <SvcLevel pid={r.p.id} />
      <RoleNote r={r} />
      {r.lastPay ? <p className="lbl d-pay">{t('end.last')} <a className="tlink mono" href={tx(r.lastPay.a.tx)} target="_blank" rel="noreferrer">{`${usdc(r.lastPay.amount) ?? ''}, ${t('word.block')} ${num(r.lastPay.a.block, lang)}`}</a></p> : null}

      {/* standalone page in two columns on desktop (cost and action on the left, proofs on the right);
          in the panel, a single column */}
      {wide ? (
        <>
        <div className="d-cols">
          <div className="d-col">
      <section className="d-sec">
        <h3 className="d-h">{t('d.cost')}</h3>
        <dl className="kv-list unfold">
          <div className="kv-row row" style={{ ['--j' as string]: 0 }}><dt>{t('d.price')}</dt><dd className="mono">{priceOf(r)}</dd></div>
          {r.svc === 'ai' && Number(r.p.price) ? <div className="kv-row row" style={{ ['--j' as string]: 1 }}><dt>{t('d.unit')}</dt><dd className="mono">{t(Number(r.p.unitTokens) === 1 ? 'd.unit.v1' : 'd.unit.v', { n: r.p.unitTokens })}</dd></div> : null}
          <div className="kv-row row" style={{ ['--j' as string]: 2 }}><dt>{t('d.rail')}</dt><dd>{/^0x0+$/.test(r.p.settlement) ? <span className="mono">{t('app.rail.free')}</span> : <Ext href={addr(r.p.settlement)}>{rail ? `${rail} ${short(r.p.settlement, 4)}` : short(r.p.settlement, 4)}</Ext>}</dd></div>
          <div className="kv-row row" style={{ ['--j' as string]: 3 }}><dt>{t('d.bond')}</dt><dd className="mono">{usdc(r.p.minBond)}</dd></div>
          {r.p.exposureCap ? <div className="kv-row row" style={{ ['--j' as string]: 4 }}><dt>{t('d.cap')}</dt><dd className="mono">{usdc(r.p.exposureCap)}</dd></div> : null}
          <div className="kv-row kv-wide row" style={{ ['--j' as string]: 5 }}><dt>{t('d.split')}</dt><dd><Split r={r} /></dd></div>
        </dl>
      </section>

      <section className="d-sec d-use">
        <h3 className="d-h">{t('d.use')}</h3>
        <UseIt r={r} inPanel={inPanel} />
      </section>
          </div>
          <div className="d-col">
      <section className="d-sec">
        <h3 className="d-h">{t('d.runs')}</h3>
        {r.encs.length ? <p className="lbl muted d-lede">{t('d.runs.lede')}</p> : null}
        <Enclaves r={r} />
      </section>

      <section className="d-sec">
        <h3 className="d-h">{t('d.proof')}</h3>
        <dl className="kv-list">
          <div className="kv-row"><dt>{t('d.author')}</dt><dd><Ext href={addr(r.p.author)}>{short(r.p.author, 4)}</Ext></dd></div>
          <ManifestBlock r={r} />
          <Images r={r} />
          {r.p.activatesAt ? <div className="kv-row"><dt>{t('d.active')}</dt><dd className="mono">{dateOf(r.p.activatesAt, lang)}</dd></div> : null}
          <div className="kv-row"><dt>{t('d.det')}</dt><dd className="mono">{r.p.deterministic ? t('d.yes') : t('d.no')}</dd></div>
          {r.p.version ? <div className="kv-row"><dt>{t('d.version')}</dt><dd className="mono">{r.p.version}</dd></div> : null}
        </dl>
      </section>

      <Bounties r={r} />


          </div>
        </div>
        <div className="d-full">
      <section className="d-sec">
        <h3 className="d-h">{t('d.activity')}</h3>
        <Events r={r} />
      </section>
        </div>
        </>
      ) : (
        <>
      <section className="d-sec">
        <h3 className="d-h">{t('d.cost')}</h3>
        <dl className="kv-list unfold">
          <div className="kv-row row" style={{ ['--j' as string]: 0 }}><dt>{t('d.price')}</dt><dd className="mono">{priceOf(r)}</dd></div>
          {r.svc === 'ai' && Number(r.p.price) ? <div className="kv-row row" style={{ ['--j' as string]: 1 }}><dt>{t('d.unit')}</dt><dd className="mono">{t(Number(r.p.unitTokens) === 1 ? 'd.unit.v1' : 'd.unit.v', { n: r.p.unitTokens })}</dd></div> : null}
          <div className="kv-row row" style={{ ['--j' as string]: 2 }}><dt>{t('d.rail')}</dt><dd>{/^0x0+$/.test(r.p.settlement) ? <span className="mono">{t('app.rail.free')}</span> : <Ext href={addr(r.p.settlement)}>{rail ? `${rail} ${short(r.p.settlement, 4)}` : short(r.p.settlement, 4)}</Ext>}</dd></div>
          <div className="kv-row row" style={{ ['--j' as string]: 3 }}><dt>{t('d.bond')}</dt><dd className="mono">{usdc(r.p.minBond)}</dd></div>
          {r.p.exposureCap ? <div className="kv-row row" style={{ ['--j' as string]: 4 }}><dt>{t('d.cap')}</dt><dd className="mono">{usdc(r.p.exposureCap)}</dd></div> : null}
          <div className="kv-row kv-wide row" style={{ ['--j' as string]: 5 }}><dt>{t('d.split')}</dt><dd><Split r={r} /></dd></div>
        </dl>
      </section>

      <section className="d-sec">
        <h3 className="d-h">{t('d.runs')}</h3>
        {r.encs.length ? <p className="lbl muted d-lede">{t('d.runs.lede')}</p> : null}
        <Enclaves r={r} />
      </section>

      <section className="d-sec">
        <h3 className="d-h">{t('d.proof')}</h3>
        <dl className="kv-list">
          <div className="kv-row"><dt>{t('d.author')}</dt><dd><Ext href={addr(r.p.author)}>{short(r.p.author, 4)}</Ext></dd></div>
          <ManifestBlock r={r} />
          <Images r={r} />
          {r.p.activatesAt ? <div className="kv-row"><dt>{t('d.active')}</dt><dd className="mono">{dateOf(r.p.activatesAt, lang)}</dd></div> : null}
          <div className="kv-row"><dt>{t('d.det')}</dt><dd className="mono">{r.p.deterministic ? t('d.yes') : t('d.no')}</dd></div>
          {r.p.version ? <div className="kv-row"><dt>{t('d.version')}</dt><dd className="mono">{r.p.version}</dd></div> : null}
        </dl>
      </section>

      <Bounties r={r} />

      <section className="d-sec">
        <h3 className="d-h">{t('d.activity')}</h3>
        <Events r={r} />
      </section>

      <section className="d-sec d-use">
        <h3 className="d-h">{t('d.use')}</h3>
        <UseIt r={r} inPanel={inPanel} />
      </section>
        </>
      )}
    </div>
  )
}

/** the service's operator level, read from /levels (nothing if the API does not say) */
function SvcLevel({ pid }: { pid: string }) {
  useLang()
  const l = useServiceLevel(pid)
  if (!l) return null
  return <p className="lbl d-lvl">{l.requires === 'verified' ? xs('lvl.svc.requires') : l.verified ? xs('lvl.svc.some', { n: l.verified }) : xs('lvl.svc.open')}</p>
}
