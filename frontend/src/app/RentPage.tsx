// Rent page: rent out your machine. The console's real path (web/src/screens/Operator.tsx and the copilot,
// services/copilot/src/tools.ts): bond, agent, pairing by code, enclave, admission by Arc, payment. Each step shows
// its proof read live on Arc; signatures happen in the console.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useLive, CONSOLE, INSTALL_URL } from '../data/live'
import { num, short, usdc } from '../data/fmt'
import { t, useLang, type TKey } from '../i18n'
import { link, tx, addr } from '../links'
import { useIn } from '../ui/gestures'
import { Footer } from '../ui/Footer'
import { AppHeader } from './AppFrame'
import { AppTitle } from './UsePage'
import { useCatalog } from './useCatalog'
import { Path, type PathStep } from './parts'
import { readBonds, OPERATOR_BOND, type Bond } from './chain'
// signed actions, below the first screen: loaded after it
const RentActs = lazy(() => import('../network/actions/acts').then((m) => ({ default: m.RentActs })))
import { x } from '../network/actions/strings-x'
import { ActSec } from './opsui'
import { LevelsCard } from './levels'

type Mode = 'cloud' | 'bare' | 'rent'
const u6 = (v: bigint) => usdc(v.toString())

export function RentPage() {
  const lang = useLang()
  const rows = useCatalog()
  const enclaves = useLive((s) => s.enclaves)
  const activity = useLive((s) => s.activity)
  const stats = useLive((s) => s.stats)
  const chain = useLive((s) => s.chain)
  const main = useRef<HTMLElement>(null)
  useIn(main, 0.94)
  const [mode, setMode] = useState<Mode>('cloud')
  // operators that registered an enclave, and their bond read on OperatorBond
  const ops = useMemo(() => {
    const m = new Map<string, { op: string; active: number; total: number }>()
    for (const e of enclaves ?? []) { const k = e.operator.toLowerCase(); const x = m.get(k) ?? { op: e.operator, active: 0, total: 0 }; x.total++; if (e.active) x.active++; m.set(k, x) }
    return [...m.values()].sort((a, b) => b.active - a.active || b.total - a.total)
  }, [enclaves])
  const [bonds, setBonds] = useState<Record<string, Bond | null>>({})
  const opsKey = ops.map((o) => o.op).join()
  useEffect(() => {
    if (!ops.length) return
    let alive = true
    readBonds(ops.map((o) => o.op)).then((bs) => { if (alive) setBonds(Object.fromEntries(bs.map((b, i) => [ops[i].op.toLowerCase(), b]))) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsKey])
  const bonded = Object.values(bonds).filter((b) => b && b.bond > 0n) as Bond[]
  const totalBond = bonded.reduce((s, b) => s + b.bond, 0n)
  const lastReg = activity?.find((a) => a.name === 'EnclaveRegistered')
  const lastPay = activity?.find((a) => a.name === 'CallSettled' && a.args.operator)
  const minBond = rows?.find((r) => r.p.id === '1')?.p.minBond
  const steps: PathStep[] = [
    { k: 's1', proof: <span>{t('r.p1', { c: short(OPERATOR_BOND, 4) })} <a className="tlink mono" href={addr(OPERATOR_BOND)} target="_blank" rel="noreferrer">OperatorBond</a>{Object.keys(bonds).length ? <span className="mono">{`, ${t('r.p1b', { n: bonded.length, ops: t(bonded.length === 1 ? 'w.operator' : 'w.operators'), a: u6(totalBond) ?? '' })}`}</span> : null}</span> },
    { k: 's2', cmd: `curl -fsSL ${INSTALL_URL} | sh`, extra: mode === 'rent' ? <p className="lbl muted">{t('r.rentHint')}</p> : null },
    { k: 's3', cmd: 'archive-node doctor' },
    { k: 's4', cmd: 'archive-node pair' },
    { k: 's5', cmd: 'archive-node up --product 1 --tunnel' },
    { k: 's6', proof: lastReg ? <span>{t('r.p6')} <a className="tlink mono" href={tx(lastReg.tx)} target="_blank" rel="noreferrer">{`${t('word.block')} ${num(lastReg.block, lang)}`}</a>. <a className="tlink" href={link.demo}>{t('r.p6demo')}</a></span> : <span className="muted">{t('state.loading')}</span> },
    { k: 's7', proof: lastPay ? <span>{t('r.p7', { a: usdc(lastPay.args.amount, lang) ?? '', o: short(lastPay.args.operator, 4) })} <a className="tlink mono" href={tx(lastPay.tx)} target="_blank" rel="noreferrer">{`${t('word.block')} ${num(lastPay.block, lang)}`}</a></span> : <span className="muted">{activity ? t('end.none') : t('state.loading')}</span> },
  ]
  return (
    <>
      <a className="skip" href="#path" data-front-free>{t('r.skip')}</a>
      <AppHeader page="rent" section="sec.rent" />
      <main className="app work" ref={main} data-copilot="rent">
        <section className="app-top st-rent">
          <div className="app-top-in">
            <AppTitle k="rent.title" />
            <p className="lede">{t('r.lede')}</p>
            <div className="verdict-w cote-in">
              <span className="cote-l" aria-hidden="true" />
              <p className="verdict-l tnum cote-v" aria-live="polite">{stats && Object.keys(bonds).length ? t(bonded.length === 1 ? 'r.verdict1' : 'r.verdict', { a: bonded.length, b: stats.enclavesActive, m: usdc(minBond ?? '1000000', lang) ?? '' }) : t('r.verdict.wait')}</p>
              <p className="lbl muted read-at">{t('r.verdict.src')}</p>
            </div>
          </div>
        </section>

        <section className="work-sec" aria-labelledby="where-h">
          <h2 className="work-h" id="where-h">{t('r.where')}</h2>
          <div className="modes" role="radiogroup" aria-label={t('r.where')}>
            {(['cloud', 'bare', 'rent'] as Mode[]).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} className="mode" onClick={() => setMode(m)}>
                <span className="mode-t">{t(`r.m.${m}.t` as TKey)}</span>
                <span className="mode-d">{t(`r.m.${m}.d` as TKey)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="work-sec" id="path" aria-labelledby="path-h">
          <h2 className="work-h" id="path-h">{t('r.path')}</h2>
          <Path steps={steps} prefix="r" />
        </section>

        <ActSec id="act" title={x('r.act')} lede={x('r.act.lede')} side={<a className="tlink" href={link.operator}>{x('r.toOperator')}</a>}>
          <Suspense fallback={null}><RentActs label={x('r.act')} /></Suspense>
        </ActSec>

        <LevelsCard />

        <section className="work-sec" aria-labelledby="ops-h">
          <h2 className="work-h" id="ops-h">{t('r.ops')}</h2>
          <p className="lbl muted work-lede">{t('r.ops.lede')}</p>
          <div className="tbl-w">
            <table className="tbl">
              <thead><tr><th scope="col">{t('d.operator')}</th><th scope="col">{t('r.c.bond')}</th><th scope="col">{t('r.c.free')}</th><th scope="col">{t('r.c.res')}</th><th scope="col">{t('r.c.enc')}</th><th scope="col">{t('r.c.agent')}</th></tr></thead>
              <tbody>
                {ops.length ? ops.map((o) => {
                  const b = bonds[o.op.toLowerCase()]
                  const v = (x?: bigint) => (b === undefined ? t('state.loading') : b === null || x === undefined ? t('state.unread') : u6(x))
                  return (
                    <tr key={o.op}>
                      {/* an operator banned on Arc (OperatorBond.banned, read by onchain.ts) shows it */}
                      <td data-l={t('d.operator')}><a className="tlink mono" href={addr(o.op)} target="_blank" rel="noreferrer">{short(o.op, 4)}</a>{chain?.banned[o.op.toLowerCase()] ? <span className="lbl muted"> {t('r.banned')}</span> : null}</td>
                      <td className="mono" data-l={t('r.c.bond')}>{v(b?.bond)}</td><td className="mono" data-l={t('r.c.free')}>{v(b?.free)}</td><td className="mono" data-l={t('r.c.res')}>{v(b?.reserved)}</td>
                      <td className="mono" data-l={t('r.c.enc')}>{t('r.c.encV', { a: o.active, b: o.total })}</td>
                      <td className="mono" data-l={t('r.c.agent')}>{b === undefined ? t('state.loading') : b && b.agent > 0n ? `#${b.agent.toString()}` : t('r.c.none')}</td>
                    </tr>
                  )
                }) : <tr><td colSpan={6} className="muted">{t('state.loading')}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="work-sec" aria-labelledby="rules-h">
          <h2 className="work-h" id="rules-h">{t('r.rules')}</h2>
          <p className="lbl muted work-lede">{t('r.rules.lede')}</p>
          <dl className="kv-list rules unfold">
            {(['cap', 'delay', 'slash', 'machine'] as const).map((k, j) => <div key={k} className="kv-row row" style={{ ['--j' as string]: j }}><dt>{t(`r.rule.${k}` as TKey)}</dt><dd>{t(`r.rule.${k}.d` as TKey)}</dd></div>)}
          </dl>
        </section>
      </main>
      <Footer />
    </>
  )
}
