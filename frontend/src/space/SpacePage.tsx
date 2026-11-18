// My space (space.html): everything tied to the connected wallet on Arc, in tabs. No account: the address is the
// profile. Each tab is the existing work page, moved here as it was (BountyPage, SessionsPage, OperatorPage in embed
// mode: same reads, same signed actions), plus My services (products the address authored, read live, with the
// activation it can sign). A tab shows only when the address has something there, or when the URL asks for it
// (?tab=bounties|sessions|machines|services: the old bounty, sessions and operator pages land here).
import { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { useLive } from '../data/live'
import { short, usdc } from '../data/fmt'
import { addr, link, networkFor } from '../links'
import { Footer } from '../ui/Footer'
import { AppHeader } from '../app/AppFrame'
import { BountyPage } from '../app/BountyPage'
import { SessionsPage } from '../app/SessionsPage'
import { OperatorPage } from '../app/OperatorPage'
import { useWallet, onArc, engine, ARC_ID } from '../network/actions/store'
import { useEngine, NoteLine, errNote, type Note, type Engine } from '../network/actions/kit'
import { useSt, type SpKey } from './strings'
import './space.css'

const TABS = ['bounties', 'sessions', 'machines', 'services'] as const
type Tab = typeof TABS[number]
const TAB_KEY: Record<Tab, SpKey> = { bounties: 'sp.t.bounties', sessions: 'sp.t.sessions', machines: 'sp.t.machines', services: 'sp.t.services' }
const asked = (): Tab | null => { const v = new URLSearchParams(location.search).get('tab'); return (TABS as readonly string[]).includes(v ?? '') ? (v as Tab) : null }
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

type Owned = Record<Tab, boolean | null>
/** what the address holds, read the same way the pages read it (null: still reading) */
function useOwned(address: string | undefined, E: Engine | null): Owned {
  const bounties = useLive((s) => s.bounties)
  const products = useLive((s) => s.products)
  const enclaves = useLive((s) => s.enclaves)
  const [chain, setChain] = useState<{ b: boolean | null; s: boolean | null; m: boolean | null }>({ b: null, s: null, m: null })
  useEffect(() => {
    setChain({ b: null, s: null, m: null })
    if (!address || !E) return
    let alive = true
    const who = address as Address
    // bounties: the verified level is read on the chain (the API does not index it), credits on both levels
    Promise.all([
      E.listBounties('verified').then((bs) => bs.some((b) => same(b.protocol, who))).catch(() => false),
      E.readCredit('open', who).then((c) => c > 0n).catch(() => false),
      E.readCredit('verified', who).then((c) => c > 0n).catch(() => false),
    ]).then((v) => { if (alive) setChain((c) => ({ ...c, b: v.some(Boolean) })) })
    E.fetchSessions(who).then((r) => r.length > 0).catch(() => false).then((v) => { if (alive) setChain((c) => ({ ...c, s: v })) })
    E.fetchMachines(who).then((r) => r.length > 0).catch(() => false).then((v) => { if (alive) setChain((c) => ({ ...c, m: v })) })
    return () => { alive = false }
  }, [address, E])
  if (!address) return { bounties: null, sessions: null, machines: null, services: null }
  const openB = bounties ? bounties.some((b) => same(b.protocol, address)) : null
  const ops = enclaves ? enclaves.some((e) => same(e.operator, address)) : null
  const or = (a: boolean | null, b: boolean | null) => (a || b ? true : a === null || b === null ? null : false)
  return {
    bounties: or(openB, chain.b),
    sessions: chain.s,
    machines: or(ops, chain.m),
    services: products ? products.some((p) => same(p.author, address)) : null,
  }
}

/** My services: the products this address authored (ProductRegistry, via /api/products), the activation it signs */
function MyServices({ address, E }: { address: string; E: Engine | null }) {
  const { s, lang } = useSt()
  const products = useLive((x) => x.products)
  const mine = useMemo(() => (products ?? []).filter((p) => same(p.author, address)), [products, address])
  const [n, setN] = useState<Record<string, Note>>({})
  const now = Date.now() / 1000
  async function activate(id: string) {
    if (!E) return
    setN((m) => ({ ...m, [id]: { tone: 'muted', text: s('sp.s.activating') } }))
    try { const h = await E.activate(BigInt(id), {}); setN((m) => ({ ...m, [id]: { tone: 'ok', text: s('sp.s.activated'), hash: h } })) } catch (e) { setN((m) => ({ ...m, [id]: errNote(E, e) })) }
  }
  return (
    <section className="work-sec sp-svc" aria-labelledby="sp-svc-h">
      <h2 className="work-h" id="sp-svc-h">{s('sp.t.services')}</h2>
      <p className="lbl muted work-lede">{s('sp.s.lede')}</p>
      {!products ? <p className="lbl muted">{s('sp.reading', { a: short(address, 4) })}</p> : !mine.length ? <p className="muted">{s('sp.s.none')}</p> : (
        <div className="tbl-w">
          <table className="tbl">
            <thead><tr><th scope="col">{s('sp.s.h.p')}</th><th scope="col">{s('sp.s.h.state')}</th><th scope="col">{s('sp.s.h.price')}</th><th scope="col">{s('sp.s.h.share')}</th><th scope="col"><span className="sr-only">{s('sp.s.open')}</span></th></tr></thead>
            <tbody>
              {mine.map((p) => {
                const st = (['Proposed', 'Active', 'Retired'].includes(p.state) ? p.state : 'Proposed') as 'Proposed' | 'Active' | 'Retired'
                const at = Number(p.activatesAt ?? 0)
                return (
                  <tr key={p.id}>
                    <td data-l={s('sp.s.h.p')}><a className="tlink" href={`${link.catalog}?p=${p.id}`}>{s('sp.s.row', { id: p.id })}</a></td>
                    <td data-l={s('sp.s.h.state')}>
                      {s(`sp.s.st.${st}` as SpKey)}
                      {st === 'Proposed' && at > now ? <span className="muted">{` ${s('sp.s.on', { when: new Date(at * 1000).toLocaleString(lang) })}`}</span> : null}
                      {n[p.id] ? <NoteLine n={n[p.id]} /> : null}
                    </td>
                    <td className="mono" data-l={s('sp.s.h.price')}>{usdc(p.price, lang)}</td>
                    <td className="mono" data-l={s('sp.s.h.share')}>{`${(p.bpsAuthor / 100).toLocaleString(lang)} %`}</td>
                    <td>{st === 'Proposed' ? <button type="button" className="btn btn-line btn-s" disabled={at > now || !E} onClick={() => activate(p.id)}><span>{s('sp.s.activate')}</span></button> : null}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="lbl muted sp-paid">{s('sp.s.paid')} <a className="tlink" href={addr(address)} target="_blank" rel="noreferrer">{s('sp.s.paid.a')}</a></p>
      <p className="sp-more"><a className="tlink" href={networkFor('publish')}>{s('sp.s.publish')}</a></p>
    </section>
  )
}

function Empty() {
  const { s } = useSt()
  return (
    <section className="work-sec sp-empty" aria-labelledby="sp-empty-h">
      <h2 className="work-h" id="sp-empty-h">{s('sp.empty.h')}</h2>
      <p className="muted">{s('sp.empty.d')}</p>
      <p className="sp-go">
        <a className="btn btn-main" href={link.catalog}><span>{s('sp.empty.use')}</span></a>
        <a className="btn btn-line" href={networkFor('rent')}><span>{s('sp.empty.rent')}</span></a>
        <a className="btn btn-line" href={networkFor('publish')}><span>{s('sp.empty.pub')}</span></a>
      </p>
    </section>
  )
}

export function SpacePage() {
  const { s } = useSt()
  const w = useWallet()
  const E = useEngine()
  const connected = w.phase === 'connected' && !!w.address
  const wrong = connected && w.chainId !== ARC_ID
  const address = connected && onArc(w) ? w.address : undefined
  const owned = useOwned(address, E)
  const [tab, setTab] = useState<Tab | null>(asked)
  useEffect(() => { document.title = s('sp.title') }, [s])
  // without a tab asked, open the first one that holds something
  const first = TABS.find((k) => owned[k])
  const cur: Tab | null = tab ?? first ?? null
  const shown = TABS.filter((k) => owned[k] || k === cur)
  const loaded = TABS.every((k) => owned[k] !== null)
  const pick = (k: Tab) => {
    setTab(k)
    const u = new URL(location.href); u.searchParams.set('tab', k); history.replaceState(history.state, '', u)
  }
  return (
    <>
      <a className="skip" href="#sp-body" data-front-free>{s('sp.skip')}</a>
      <AppHeader page="space" section="svc.page" sectionText={s('sp.sec')} />
      <main className="app work sp" id="sp">
        <section className="app-top sp-top">
          <div className="app-top-in">
            <h1 className="sp-h1"><span>{s('sp.h.a')}</span><span className="sp-acc">{s('sp.h.b')}</span><span>{s('sp.h.c')}</span><span className="ttl-rule" aria-hidden="true" /></h1>
            <p className="lede">{s('sp.lede')}</p>
            {!connected ? (
              <div className="sp-connect">
                <p className="na-note" data-tone="muted" role="status">{s('sp.connect')}</p>
                <button type="button" className="btn btn-main" onClick={() => { void engine().then((e) => e.start()) }} disabled={w.phase === 'loading' || w.phase === 'connecting'}><span>{s('sp.connect.b')}</span></button>
              </div>
            ) : wrong ? <p className="na-note" data-tone="bad" role="status">{s('sp.wrong')}</p>
              : <p className="lbl muted sp-as">{loaded ? s('sp.as', { a: short(w.address!, 4) }) : s('sp.reading', { a: short(w.address!, 4) })}</p>}
            {shown.length ? (
              <div className="sp-tabs" role="tablist" aria-label={s('sp.tabs')}>
                {shown.map((k) => (
                  <button key={k} type="button" role="tab" id={`sp-tab-${k}`} aria-selected={k === cur} aria-controls="sp-body" className="sp-tab" onClick={() => pick(k)}>{s(TAB_KEY[k])}</button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
        <div id="sp-body" className="sp-body" role={cur ? 'tabpanel' : undefined} aria-labelledby={cur ? `sp-tab-${cur}` : undefined}>
          {cur === 'bounties' ? <BountyPage embed key="b" />
            : cur === 'sessions' ? <SessionsPage embed key="s" />
              : cur === 'machines' ? <OperatorPage embed key="m" />
                : cur === 'services' ? (address ? <MyServices address={address} E={E} /> : null)
                  : address && loaded ? <Empty /> : null}
        </div>
      </main>
      <Footer />
    </>
  )
}
