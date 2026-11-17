// "Prepare, then sign" (console: web/src/screens/CopilotActions.tsx): the copilot prepares an action, it never spends;
// the card shows what will be signed, the checks made while preparing it, and a button; the user's wallet signs
// (sign.ts, loaded at that moment). A failed check blocks signing, whatever the action: the transaction would be
// refused. Once sent: the hash, its explorer link, then the place on the site that shows the change. Info cards
// (price, code, skeleton, test call) sign nothing.
import { useState, type ReactNode } from 'react'
import { useLang, getLang } from '../i18n'
import { ct } from './strings'
import { Code, short } from './markdown'
import { useWallet, getWallet, connect, toArc, provider, codeOf, txUrl, ARC } from './wallet'
import { setCard, type CardState } from './state'
import { INFO_TOOLS, type Prepared, type UiStep } from './api'
import { pageOf, type PageName } from './page'
import { link } from '../links'

type R = Record<string, any>
const isAddr = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x)
const s = (x: unknown) => (x === undefined || x === null ? '' : String(x))

/** The copilot's checks (`verifications: [{ ok, quoi }]`), as it writes them. */
function checksOf(r: R): { ok: boolean; what: string }[] {
  const v = r.verifications ?? r.controles
  return Array.isArray(v) ? v.filter((x) => x && typeof x.quoi === 'string').map((x) => ({ ok: x.ok === true, what: String(x.quoi) })) : []
}
const warningsOf = (r: R): string[] => [r.avertissements, r.attention].flat().filter((x): x is string => typeof x === 'string' && !!x.trim())

interface Described { title: string; lines: string[]; ready: boolean; why?: string; info?: string; preparedFor?: string; register?: boolean }
function describe(c: Prepared): Described {
  const r = c.result as R
  const todo = (fallback: string) => (Array.isArray(r.aCompleter) && r.aCompleter.length ? r.aCompleter.join(', ') : fallback)
  const from = isAddr(r.autorisationEIP3009?.message?.from) ? r.autorisationEIP3009.message.from : undefined
  switch (c.tool) {
    case 'session_prepare_open': {
      // the session is locked to ONE active enclave: without it, nothing to sign (and the card says why)
      const p = r.openSessionParams ?? {}
      const ok = isAddr(p.operator) && isAddr(p.enclave)
      return {
        title: ct('card.session'), ready: ok && r.pret !== false, why: todo(ct('todo.incomplete')), info: ok ? undefined : ct('session.none'), preparedFor: from,
        lines: [ct('l.product', { id: s(p.productId ?? r.produit?.id) }), isAddr(p.enclave) ? ct('l.enclave', { e: short(p.enclave) }) : '', isAddr(p.operator) ? ct('l.operator', { o: short(p.operator) }) : '', r.depot ? ct('l.deposit', { d: s(r.depot) }) : ''].filter(Boolean),
      }
    }
    case 'operator_prepare_bond': {
      if (r.rienANSigner) return { title: ct('card.bond'), lines: [], ready: false, info: s(r.message) }
      const amt = r.voieA_uneTransaction?.args?.amount
      return {
        title: ct('card.bond'), ready: !!amt && r.pret !== false, why: todo(ct('todo.amount')), preparedFor: isAddr(r.operateur) ? r.operateur : from,
        lines: [r.montant ? ct('l.amount', { a: s(r.montant) }) : '', r.apres?.disponible ? ct('l.after', { a: s(r.apres.disponible) }) : ''].filter(Boolean),
      }
    }
    case 'operator_prepare_register':
      // registration needs a fresh Intel quote, read on the operator's machine: the console handles it
      return { title: ct('card.register'), ready: false, register: true, lines: [ct('l.product', { id: s(r.produit?.id ?? '?') })] }
    case 'bounty_prepare_create': {
      const p = r.createBountyParams
      return {
        title: ct('card.bounty'), ready: !!p && r.pret !== false, why: todo(p ? ct('todo.incomplete') : ct('todo.bounty')), preparedFor: from,
        lines: p ? [ct('l.product', { id: s(p.productId) }), ct('l.funding', { f: s(r.economie?.financement) }), ct('l.deadline', { d: s(r.economie?.echeance) })] : [],
      }
    }
  }
  return { title: ct('card.unknown'), lines: [], ready: false }
}

/** After confirmation, the place on the site that shows the change (the page, then the element). A new operator's
 *  bond only enters the Rent page table with its first enclave: step 1 of the path is shown, done. */
function afterOf(c: Prepared, cs: CardState): { page: PageName; steps: UiStep[] } | null {
  const r = c.result as R
  if (c.tool === 'operator_prepare_bond') return { page: 'rent', steps: [{ tool: 'ui_navigate', args: { page: 'rent' } }, { tool: 'ui_highlight', args: { target: 'r-s1', note: ct('after.bond', { a: s(r.montant) }) } }] }
  const id = c.tool === 'bounty_prepare_create' ? s(r.createBountyParams?.productId) : c.tool === 'session_prepare_open' ? s(r.openSessionParams?.productId) : ''
  if (!/^\d{1,10}$/.test(id)) return null
  const note = ct(c.tool === 'bounty_prepare_create' ? 'after.bounty' : 'after.session', { id: cs.ref ?? '' })
  return { page: 'use', steps: [{ tool: 'ui_navigate', args: { page: 'use', query: '' } }, { tool: 'ui_highlight', args: { target: `product:${id}`, note } }] }
}

const Led = ({ tone }: { tone: 'ok' | 'no' | 'warn' }) => <i className={`cp-led is-${tone}`} aria-hidden="true" />

function Phase({ cs, tool }: { cs: CardState; tool: string }) {
  useLang()
  const label = cs.phase === 'switch' ? ct('ph.switch') : cs.phase === 'sign' ? ct('ph.sign') : cs.phase === 'sent' ? ct('ph.sent') : cs.phase === 'done' ? ct('ph.done')
    : cs.phase === 'reverted' ? ct('ph.reverted') : cs.phase === 'rejected' ? ct('ph.rejected') : cs.note ?? ''
  const tone = cs.phase === 'done' ? 'ok' : cs.phase === 'reverted' || cs.phase === 'error' ? 'no' : cs.phase === 'rejected' ? 'warn' : null
  return (
    <div className="cp-ph" role="status" data-phase={cs.phase}>
      <p className="cp-ph-l">{tone ? <Led tone={tone} /> : <i className="cp-spin" aria-hidden="true" />}<span>{label}</span></p>
      {cs.phase === 'sent' && cs.note ? <p className="cp-ph-r">{cs.note}</p> : null}
      {cs.ref ? <p className="cp-ph-r mono">{ct(tool === 'session_prepare_open' ? 'session.id' : 'bounty.id', { id: cs.ref })}</p> : null}
      {cs.tx ? (
        <p className="cp-ph-tx">
          <span className="lbl">{ct('tx')}</span>{' '}
          <a className="cp-a mono" href={txUrl(cs.tx)} target="_blank" rel="noreferrer noopener" title={cs.tx} data-tx={cs.tx}>{short(cs.tx, 6)}</a>{' '}
          <a className="cp-a" href={txUrl(cs.tx)} target="_blank" rel="noreferrer noopener">{ct('tx.open')}</a>
        </p>
      ) : null}
    </div>
  )
}

function Aek({ aek }: { aek: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="cp-aek">
      <p className="cp-aek-t">{ct('aek.title')}</p>
      {/* shortened aek_ key, as the console panel shows it */}
      <p className="mono cp-aek-k">{`${aek.slice(0, 14)}…${aek.slice(-6)}`}</p>
      <button type="button" className="btn btn-line btn-s" onClick={() => navigator.clipboard?.writeText(aek).then(() => { setDone(true); setTimeout(() => setDone(false), 1600) }).catch(() => {})}><span>{done ? ct('copied') : ct('aek.copy')}</span></button>
      <p className="cp-aek-n">{ct('aek.note')}</p>
    </div>
  )
}

export function ActionCard({ c, cs, msgId, onAfter }: { c: Prepared; cs?: CardState; msgId: string; onAfter: (steps: UiStep[]) => void }) {
  useLang()
  const w = useWallet()
  const d = describe(c)
  const r = c.result as R
  const checks = checksOf(r)
  const warnings = warningsOf(r)
  const failed = checks.filter((x) => !x.ok).length
  const busy = !!cs && (cs.phase === 'switch' || cs.phase === 'sign' || cs.phase === 'sent')
  const sent = !!cs && (cs.phase === 'sent' || cs.phase === 'done')
  const other = !!(d.preparedFor && w.address && d.preparedFor.toLowerCase() !== w.address.toLowerCase())
  const onArc = w.status === 'connected' && w.chainId === ARC.id

  async function run() {
    if (busy || sent || failed || other || !d.ready) return
    if (w.status !== 'connected') { await connect(); return }
    const p = provider()
    if (!p) return
    if (getWallet().chainId !== ARC.id) {
      setCard(msgId, c.tool, { phase: 'switch' })
      if (!(await toArc())) {
        const e = getWallet().error
        setCard(msgId, c.tool, e === 'rejected' ? { phase: 'rejected' } : { phase: 'error', note: ct('ph.error', { e: s(e) }) })
        return
      }
    }
    setCard(msgId, c.tool, { phase: 'sign' })
    let last: CardState = { phase: 'sign' }
    let sign: typeof import('./sign') | null = null
    try {
      sign = await import('./sign')
      const o = await sign.execute(c, p, getWallet().address!, (ph, x) => {
        last = { ...last, phase: ph, ...(x?.tx ? { tx: x.tx } : {}), ...(x?.ref ? { ref: x.ref } : {}), ...(x?.aek ? { aek: x.aek } : {}) }
        setCard(msgId, c.tool, last)
      })
      last = { ...last, phase: 'done', tx: o.tx }
      setCard(msgId, c.tool, last)
      // the change, shown on the site: in place if on the right page, otherwise through the card's button
      const after = afterOf(c, last)
      if (after && pageOf() === after.page) onAfter(after.steps)
    } catch (e) {
      const ex = e as { reverted?: boolean; tx?: string; status?: number; shortMessage?: string; message?: string }
      if (ex.reverted) { setCard(msgId, c.tool, { ...last, phase: 'reverted', tx: ex.tx ?? last.tx }); return }
      // sent but not yet confirmed (timeout, silent RPC): never a new Sign button, which would send it twice
      if (last.tx) { setCard(msgId, c.tool, { ...last, phase: 'sent', note: ct('ph.unconfirmed') }); return }
      if (codeOf(e) === 4001) { setCard(msgId, c.tool, { ...last, phase: 'rejected' }); return }
      const named = sign?.contractError(e, getLang())
      // a refusal already worded by the site engine (balance, network, service offline) is shown as is
      const said = named ? undefined : await sign?.siteError(e).catch(() => undefined)
      const rpcBusy = ex.status === 429 || /HTTP 429/.test(String(ex.message ?? ''))
      const note = named ? ct('ph.refused', { e: named }) : rpcBusy ? ct('ph.rpc') : ct('ph.error', { e: said ?? s(ex.shortMessage ?? ex.message ?? e).slice(0, 240) })
      setCard(msgId, c.tool, { ...last, phase: 'error', note })
    }
  }

  const after = cs?.phase === 'done' ? afterOf(c, cs) : null
  const btn = w.status !== 'connected' ? ct('sign.connect') : !onArc ? ct('sign.switch') : ct('sign')
  // a refused or cancelled send can be retried; a sent or confirmed transaction is never sent twice by mistake
  const again = !cs || cs.phase === 'rejected' || cs.phase === 'error'
  return (
    <section className="cp-card" aria-label={d.title} data-tool={c.tool}>
      <p className="cp-card-k lbl">{ct('card.prepared')}</p>
      <p className="cp-card-t">{d.title}</p>
      {d.lines.length ? <ul className="cp-card-l">{d.lines.map((l) => <li key={l}>{l}</li>)}</ul> : null}
      {checks.length ? (
        <div className="cp-card-s">
          <p className="cp-card-h lbl">{ct('checks')}</p>
          <ul className="cp-checks">{checks.map((x, i) => <li key={i} className={x.ok ? '' : 'is-no'}><Led tone={x.ok ? 'ok' : 'no'} /><span>{x.what}</span></li>)}</ul>
        </div>
      ) : null}
      {warnings.length ? (
        <div className="cp-card-s">
          <p className="cp-card-h lbl">{ct('warnings')}</p>
          <ul className="cp-checks">{warnings.map((x, i) => <li key={i}><Led tone="warn" /><span>{x}</span></li>)}</ul>
        </div>
      ) : null}
      {d.register ? (
        <div className="cp-card-a">
          <p className="cp-card-why">{ct('register.why')}</p>
          <a className="btn btn-line btn-s" href={link.operator}><span>{ct('register.open')}</span></a>
        </div>
      ) : d.info ? <p className="cp-card-why">{d.info}</p>
        : d.ready ? (
          <div className="cp-card-a">
            {other ? <p className="cp-card-why is-no">{ct('other.addr', { a: short(d.preparedFor!), b: short(w.address!) })}</p> : null}
            {again ? <button type="button" className="btn btn-main btn-s cp-sign" onClick={run} disabled={busy || failed > 0 || other} aria-describedby={failed ? `${msgId}-${c.tool}-f` : undefined}><span>{btn}</span></button> : null}
            {failed > 0 ? <p className="cp-card-why is-no" id={`${msgId}-${c.tool}-f`}>{ct('checks.failed')}</p> : null}
          </div>
        ) : <p className="cp-card-why is-warn">{ct('todo', { why: d.why ?? '' })}</p>}
      {cs ? <Phase cs={cs} tool={c.tool} /> : null}
      {cs?.aek ? <Aek aek={cs.aek} /> : null}
      {after && pageOf() !== after.page ? <button type="button" className="btn btn-line btn-s cp-after" onClick={() => onAfter(after.steps)}><span>{ct('after.show')}</span></button> : null}
    </section>
  )
}

function Rows({ rows }: { rows: [string, unknown][] }) {
  const kept = rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
  return kept.length ? <ul className="cp-card-l">{kept.map(([k]) => <li key={k}>{k}</li>)}</ul> : null
}

/** An info card: nothing to sign. */
export function InfoCard({ c }: { c: Prepared }) {
  useLang()
  const r = c.result as R
  let title = ct('card.unknown'), body: ReactNode = null
  if (c.tool === 'pricing_quote') {
    title = ct('card.quote')
    body = <Rows rows={[[ct('l.price', { p: s(r.pricePerUnit) }), r.pricePerUnit], [ct('l.units', { u: s(r.units) }), r.units], [ct('l.total', { t: s(r.total) }), r.total], [ct('l.budget', { b: s(r.budgetParRequete) }), r.budgetParRequete], [ct('l.maxUnits', { u: s(r.unitesMaxParRequete) }), r.unitesMaxParRequete], [ct('l.example', { d: s(r.exempleDeDepot?.depot) }), r.exempleDeDepot?.depot]]} />
  } else if (c.tool === 'snippet_generate') {
    title = ct('card.snippet')
    body = typeof r.code === 'string' ? <Code text={r.code} label={ct('card.snippet')} /> : null
  } else if (c.tool === 'product_scaffold') {
    title = ct('card.scaffold')
    body = (
      <>
        <Rows rows={[[ct('l.name', { n: s(r.nom) }), r.nom], [ct('l.rail', { r: s(r.rail) }), r.rail], [ct('l.price', { p: s(r.prixParUnite) }), r.prixParUnite], [ct('l.minBond', { b: s(r.cautionMinimale) }), r.cautionMinimale], [s(r.parts?.lecture), r.parts?.lecture]]} />
        {Array.isArray(r.etapes) && r.etapes.length ? (
          <div className="cp-card-s"><p className="cp-card-h lbl">{ct('steps')}</p><ol className="cp-card-o">{r.etapes.map((e: R, i: number) => <li key={i}>{s(e?.titre ?? e)}</li>)}</ol></div>
        ) : null}
        {pageOf() !== 'publish' ? <a className="btn btn-line btn-s" href={link.publish}><span>{ct('open.publish')}</span></a> : null}
      </>
    )
  } else if (c.tool === 'inference_test') {
    title = ct('card.test')
    const checks = checksOf(r)
    body = (
      <>
        {r.produit ? <Rows rows={[[ct('l.product', { id: s(r.produit.id) }), r.produit.id], [ct('l.price', { p: s(r.produit.prixParUnite) }), r.produit.prixParUnite]]} /> : null}
        {checks.length ? <div className="cp-card-s"><p className="cp-card-h lbl">{ct('checks')}</p><ul className="cp-checks">{checks.map((x, i) => <li key={i} className={x.ok ? '' : 'is-no'}><Led tone={x.ok ? 'ok' : 'no'} /><span>{x.what}</span></li>)}</ul></div> : null}
        {typeof r.codeSdk === 'string' ? <Code text={r.codeSdk} label={ct('card.test')} /> : null}
      </>
    )
  }
  return (
    <section className="cp-card is-info" aria-label={title} data-tool={c.tool}>
      <p className="cp-card-k lbl">{ct('card.info')}</p>
      <p className="cp-card-t">{title}</p>
      {body}
    </section>
  )
}

export const isInfo = (c: Prepared) => INFO_TOOLS.has(c.tool)
