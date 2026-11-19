// The bridge page (bridge.html): the connected wallet brings its USDC from another testnet to Arc testnet with CCTP
// V2, in three steps it signs itself (burn on the source chain, Circle's attestation, mint on Arc). The addresses and
// calls are in ./cctp.ts (verified on-chain); a started transfer is kept in localStorage and resumes after a reload.
// Every transfer is a standard one, free (maxFee 0, threshold 2000): 1 USDC sent = 1 USDC received, after Circle has
// waited for the burn to be final (15 to 19 minutes from Ethereum Sepolia, cctp.ts).
import { useEffect, useRef, useState } from 'react'
import { createWalletClient, custom, formatUnits, parseUnits, type Address, type EIP1193Provider, type Hex } from 'viem'
import { useLang, getLang } from '../i18n'
import { short } from '../data/fmt'
import { RPC } from '../data/live'
import { Footer } from '../ui/Footer'
import { useIn } from '../ui/gestures'
import { AppHeader } from '../app/AppFrame'
import { HeaderWallet } from '../network/actions/HeaderWallet'
import { useWallet, setWallet, engine } from '../network/actions/store'
import { ARC, SOURCES, netByKey, txLink, usdcOf, gasOf, standardFeeBps, approveIfNeeded, burn, confirmed, attestation, decodeMessage, received, mint, setRpc, FAST, STANDARD, type Net } from './cctp'
import { bt } from './strings'
import './bridge.css'

// Arc is read through the site's own RPC setting (the dev proxy locally, rpc.testnet.arc.io once built)
try { setRpc('arc', new URL(RPC, location.href).href) } catch { /* keeps the default */ }

type St = 'todo' | 'doing' | 'done' | 'fail'
/** sr: what the live region says instead of text (step 2's wait, once a minute), the visible text then stays silent */
interface Note { tone: 'ok' | 'muted' | 'bad'; text: string; href?: string; hrefLabel?: string; sr?: string }
interface Job {
  v: 1; owner: string; src: Net['key']; amount: string; maxFee: string; thr: number; t0: number
  approve?: Hex; burn?: Hex; burnOk?: boolean; tAtt?: number; message?: Hex; att?: Hex; mint?: Hex; minted?: string; relayed?: boolean
}

// ---------- the unfinished transfer, per address, in this browser ----------
const KEY = 'archive-bridge-v1'
const readAll = (): Record<string, Job> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {} } catch { return {} } }
const load = (owner: string): Job | null => { const j = readAll()[owner.toLowerCase()]; return j && j.v === 1 ? j : null }
function save(j: Job) { try { const all = readAll(); all[j.owner.toLowerCase()] = j; localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* storage unavailable */ } }
function drop(owner: string) { try { const all = readAll(); delete all[owner.toLowerCase()]; localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* storage unavailable */ } }

// ---------- formatting ----------
const fmt = (units: bigint | string | undefined | null, dec = 6) => {
  if (units === undefined || units === null) return ''
  const n = Number(formatUnits(BigInt(units), dec))
  return n.toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: dec === 6 ? 6 : 4 })
}
const usd = (u: bigint | string | undefined | null) => `${fmt(u)} USDC`
/** Circle's usual wait from this chain, in words (cctp.ts, Net.wait) */
const waitOf = (n: Net) => bt(n.key === 'base-sepolia' ? 'wait.base-sepolia' : 'wait.eth-sepolia')
const rangeOf = (n: Net) => { const w = n.wait ?? { from: 15, to: 19, upTo: 19 }; return bt(w.upTo > w.to ? 'range.up' : 'range', w) }
/** seconds as "4 min 07 s" */
const elapsed = (secs: number) => bt('elapsed', { m: Math.floor(secs / 60), s: String(secs % 60).padStart(2, '0') })
// the amount: in French the comma is the decimal point (0,5); in English it groups thousands (1,000 is a thousand)
const FR_RE = /^\d{0,9}([.,]\d{0,6})?$/
const typing = (v: string) => (getLang() === 'fr' ? FR_RE : /^\d{0,9}(,\d{0,3}){0,3}(\.\d{0,6})?$/).test(v)
const toUnits = (s: string): bigint | null => {
  if (!s || !/\d/.test(s)) return null
  const fr = getLang() === 'fr'
  if (fr ? !FR_RE.test(s) : !/^(\d{0,9}|\d{1,3}(,\d{3}){1,3})(\.\d{0,6})?$/.test(s)) return null
  try { return parseUnits(fr ? s.replace(',', '.') : s.replace(/,/g, ''), 6) } catch { return null }
}
/** an amount in units, as the field shows it (never toLocaleString: 1,000 would read back as 1 in French) */
const plain = (units: string) => formatUnits(BigInt(units), 6)

// ---------- the wallet ----------
async function providerOf(): Promise<EIP1193Provider> {
  const E = await engine()
  const p = E.injected()
  if (!p) throw Object.assign(new Error('no wallet'), { name: 'NoWallet' })
  return p
}
const codeOf = (e: unknown): number | undefined => {
  for (let x: any = e, n = 0; x && n < 12; x = x.cause ?? x.data?.originalError, n++) if (typeof x?.code === 'number') return x.code // eslint-disable-line @typescript-eslint/no-explicit-any
  return undefined
}
class SwitchError extends Error { constructor(readonly net: Net) { super('switch'); this.name = 'SwitchError' } }
/** switches the wallet to `n`, adding the network first if the wallet does not know it (EIP-3326, EIP-3085) */
async function switchTo(p: EIP1193Provider, n: Net) {
  const id = `0x${n.chainId.toString(16)}`
  if (Number(await p.request({ method: 'eth_chainId' })) === n.chainId) return
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: id }] })
  } catch (e) {
    if (codeOf(e) !== 4902 && !/unrecognized|not added|unknown chain|not been added/i.test(String((e as Error)?.message))) throw e
    await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: id, chainName: n.name, nativeCurrency: n.chain.nativeCurrency, rpcUrls: [n.walletRpc], blockExplorerUrls: [n.explorer] }] })
    if (Number(await p.request({ method: 'eth_chainId' })) !== n.chainId) await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: id }] })
  }
  const now = Number(await p.request({ method: 'eth_chainId' }))
  setWallet({ chainId: now })
  if (now !== n.chainId) throw new SwitchError(n)
}

/** an error, in plain words */
async function say(e: unknown, n: Net, step: 1 | 3): Promise<Note> {
  const E = await engine().catch(() => null)
  if (E?.isRefusal(e)) return { tone: 'bad', text: bt(step === 3 ? 'e.refused3' : 'e.refused') }
  if (e instanceof SwitchError) return { tone: 'bad', text: bt('e.switch', { net: e.net.name }) }
  let why = ''
  for (let x: any = e, k = 0; x && k < 12; x = x.cause, k++) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (x?.name === 'ChainMismatchError') return { tone: 'bad', text: bt('e.chain', { net: n.name }) }
    if (x?.name === 'InsufficientFundsError' || /insufficient funds/i.test(String(x?.message))) return { tone: 'bad', text: bt('e.gas', { gas: n.gas, net: n.name }) }
    if (x?.name === 'Reverted') return { tone: 'bad', text: bt('e.revert', { net: n.name }) }
    if (x?.name === 'ContractFunctionRevertedError') return { tone: 'bad', text: `${bt('e.revert', { net: n.name })} ${x.reason ?? x.data?.errorName ?? ''}`.trim() }
    if (x?.name === 'HttpRequestError' || x?.name === 'TimeoutError' || x?.name === 'WaitForTransactionReceiptTimeoutError' || (x?.name === 'TypeError' && /fetch|network|load failed/i.test(String(x?.message)))) return { tone: 'bad', text: bt('e.net', { net: n.name, why: x?.status ? `HTTP ${x.status}` : String(x?.name) }) }
    if (x?.name === 'NoWallet') return { tone: 'bad', text: bt('w.need') }
    if (!why && typeof x?.shortMessage === 'string') why = x.shortMessage
  }
  if (!why) why = String((e as Error)?.message ?? e).split('\n')[0].slice(0, 160)
  return { tone: 'bad', text: bt('e.other', { why: why.replace(/[\s.]+$/, '') }) }
}

// ---------- the page ----------
export function BridgePage() {
  const lang = useLang()
  const s = useWallet()
  const me = s.phase === 'connected' && s.address ? s.address : undefined
  useEffect(() => { document.title = bt('doc') }, [lang])
  // the titles rise in as they enter the screen, like the other app pages (ui/gestures.ts)
  const main = useRef<HTMLElement>(null)
  useIn(main, 0.94)
  const busy = s.phase === 'loading' || s.phase === 'connecting'
  return (
    <>
      <a className="skip" href="#bridge" data-front-free>{bt('skip')}</a>
      <AppHeader page="bridge" section="nav.home" sectionText={bt('sec')} wallet={<HeaderWallet quiet />} />
      <main className="app work br" ref={main}>
        <section className="app-top st-use" id={me ? undefined : 'bridge'}>
          <div className="app-top-in">
            <h1 className="h2 ttl app-h1"><span className="ttl-m"><span className="ttl-t">{bt('title')}</span></span><span className="ttl-rule" aria-hidden="true" /></h1>
            <p className="lede">{bt('lede')}</p>
            <p className="na-note wl br-who" data-tone={me ? 'ok' : 'muted'} role="status">{me ? bt('w.ok', { addr: short(me, 4) }) : bt('w.need')}</p>
            {me ? null : (
              <button type="button" className="btn btn-main br-btn" disabled={busy} onClick={() => { setWallet({ phase: 'loading', note: undefined }); void engine().then((e) => e.start()).catch(() => setWallet({ phase: 'idle' })) }}>
                <span>{bt('w.connect')}</span>
              </button>
            )}
          </div>
        </section>
        {me ? <Bridge me={me} key={me.toLowerCase()} /> : null}
        <section className="work-sec br-how" aria-labelledby="br-how-h">
          <h2 className="work-h" id="br-how-h">{bt('how')}</h2>
          <p className="br-p">{bt('how.d')}</p>
          <p className="br-p muted">{bt('testnet')}</p>
        </section>
      </main>
      <Footer />
    </>
  )
}

type Bal = { usdc?: bigint | null; gas?: bigint | null }
const FAUCET = 'https://faucet.circle.com'
const ETH_FAUCET: Record<string, string> = { 'eth-sepolia': 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia', 'base-sepolia': 'https://docs.base.org/base-chain/tools/network-faucets' }

function Bridge({ me }: { me: Address }) {
  useLang()
  const [job, setJobS] = useState<Job | null>(() => load(me))
  const resumed = useRef(!!job?.burn && !job?.minted)
  const setJob = (j: Job | null) => { if (j) save(j); else drop(me); setJobS(j ? { ...j } : null) }
  const [srcKey, setSrcKey] = useState<Net['key']>(() => job?.src ?? 'eth-sepolia')
  const src = netByKey(job?.src ?? srcKey) ?? SOURCES[0]
  const [amount, setAmount] = useState(() => (job && !job.burn ? plain(job.amount) : ''))
  const [bals, setBals] = useState<Record<string, Bal>>({})
  // Circle's fee for a standard transfer from the chosen chain, read to check the "free" line (0; null: not read)
  const [stdFee, setStdFee] = useState<number | null | undefined>(undefined)
  const [run, setRun] = useState<0 | 1 | 3>(0)
  const [n1, setN1] = useState<Note | null>(null)
  const [iris, setIris] = useState<{ seen: boolean; err?: string } | null>(null)
  const [n3, setN3] = useState<Note | null>(null)
  const [tick, setTick] = useState(0)
  const [reload, setReload] = useState(0)

  // balances: USDC and gas on every source chain, and on Arc
  useEffect(() => {
    let alive = true
    for (const n of [...SOURCES, ARC]) {
      usdcOf(n, me).then((v) => alive && setBals((b) => ({ ...b, [n.key]: { ...b[n.key], usdc: v } }))).catch(() => alive && setBals((b) => ({ ...b, [n.key]: { ...b[n.key], usdc: null } })))
      gasOf(n, me).then((v) => alive && setBals((b) => ({ ...b, [n.key]: { ...b[n.key], gas: v } }))).catch(() => alive && setBals((b) => ({ ...b, [n.key]: { ...b[n.key], gas: null } })))
    }
    return () => { alive = false }
  }, [me, reload])
  useEffect(() => { let alive = true; setStdFee(undefined); standardFeeBps(src).then((v) => alive && setStdFee(v)).catch(() => alive && setStdFee(null)); return () => { alive = false } }, [src.key])

  // step 2: ask Circle until the burn is attested (also after a reload)
  useEffect(() => {
    if (!job?.burn || !job.burnOk || job.att) return
    let alive = true, timer = 0
    const j = job
    const ask = async () => {
      try {
        const a = await attestation(src, j.burn!)
        if (!alive) return
        if (a.status === 'complete' && a.message && a.attestation) {
          const nj: Job = { ...j, message: a.message, att: a.attestation, tAtt: Date.now() }
          setIris(null)
          // received already (a relayer, or this page in another tab): nothing left to sign
          if (await received(a.message).catch(() => false)) { const d = decodeMessage(a.message); nj.minted = (d.amount - d.feeExecuted).toString(); nj.relayed = true; nj.mint = a.mintTx; setN3({ tone: 'ok', text: bt('n.already') }); setReload((r) => r + 1) }
          if (alive) setJob(nj)
          return
        }
        setIris({ seen: a.status !== 'unknown' })
      } catch (e) { if (alive) setIris({ seen: false, err: String((e as Error)?.message ?? e).slice(0, 80) }) }
      if (alive) timer = window.setTimeout(ask, j.thr === FAST ? 4000 : 10000)
    }
    void ask()
    return () => { alive = false; clearTimeout(timer) }
  }, [job?.burn, job?.burnOk, job?.att]) // eslint-disable-line react-hooks/exhaustive-deps
  // the seconds counter while Circle attests
  useEffect(() => { if (!job?.burnOk || job.att) return; const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id) }, [job?.burnOk, job?.att])

  // a burn sent before a reload, never confirmed on this page: confirm it now
  useEffect(() => {
    if (!job?.burn || job.burnOk) return
    let alive = true
    const j = job
    setN1({ tone: 'muted', text: bt('n.burning', { net: src.name }) })
    confirmed(src, j.burn!).then(() => { if (alive) { setN1({ tone: 'ok', text: bt('n.burned', { v: usd(j.amount), net: src.name }) }); setJob({ ...j, burnOk: true }) } })
      .catch(async (e) => { if (!alive) return; setN1(await say(e, src, 1)); if ((e as Error)?.name === 'Reverted') setJob({ ...j, burn: undefined }) })
    return () => { alive = false }
  }, [job?.burn]) // eslint-disable-line react-hooks/exhaustive-deps

  // a mint sent before a reload, never confirmed on this page: wait for it now (or find it received on Arc)
  useEffect(() => {
    if (!job?.mint || job.minted || !job.message || run === 3) return
    let alive = true
    const j = job
    setN3({ tone: 'muted', text: bt('n.minting') })
    confirmed(ARC, j.mint!).then(() => { if (alive) minted(j, false) })
      .catch(async (e) => {
        if (!alive) return
        if (await received(j.message!).catch(() => false)) { if (alive) minted(j, true); return }
        if (!alive) return
        setN3(await say(e, ARC, 3)); setJob({ ...j, mint: undefined })
      })
    return () => { alive = false }
  }, [job?.mint]) // eslint-disable-line react-hooks/exhaustive-deps

  const units = toUnits(amount)
  // the page sends nothing if Circle ever starts charging standard transfers on this route
  const notFree = typeof stdFee === 'number' && stdFee > 0
  const b = bals[src.key] ?? {}
  const started = !!job?.burn
  const done = !!job?.minted

  // the step that is active, focused after Send or Receive (their button goes away)
  const list = useRef<HTMLOListElement>(null)
  const focusStep = (n: number) => window.setTimeout(() => list.current?.querySelector<HTMLElement>(`.br-step:nth-child(${n}) .br-h`)?.focus(), 0)
  /** the USDC is on Arc: the job is done, the balances read again (the header wallet's too) */
  function minted(j: Job, relayed: boolean) {
    const d = decodeMessage(j.message!)
    const v = d.amount - d.feeExecuted
    setJob({ ...j, minted: v.toString(), ...(relayed ? { relayed: true } : {}) })
    setN3({ tone: 'ok', text: relayed ? bt('n.already') : bt('n.done', { v: usd(v) }) })
    setReload((r) => r + 1)
    void engine().then((e) => e.refreshBalance()).catch(() => undefined)
  }

  async function start() {
    if (run) return
    setN1(null); setIris(null); setN3(null)
    if (!units || units <= 0n || (typeof b.usdc === 'bigint' && units > b.usdc)) { setN1({ tone: 'bad', text: typeof b.usdc === 'bigint' && units && units > b.usdc ? bt('e.funds', { have: usd(b.usdc), net: src.name, need: usd(units) }) : bt('e.amount') }); return }
    if (notFree) { setN1({ tone: 'bad', text: bt('e.notfree', { net: src.name }) }); return }
    if (b.gas === 0n) { setN1({ tone: 'bad', text: bt('gas.src', { gas: src.gas, net: src.name }), href: ETH_FAUCET[src.key], hrefLabel: bt(src.key === 'base-sepolia' ? 'faucet.base' : 'faucet.eth') }); return }
    const j: Job = { v: 1, owner: me, src: src.key, amount: units.toString(), maxFee: '0', thr: STANDARD, t0: Date.now() }
    setRun(1)
    let atBurn = false
    try {
      const p = await providerOf()
      setN1({ tone: 'muted', text: bt('n.switch', { net: src.name }) })
      await switchTo(p, src)
      const w = createWalletClient({ account: me, chain: src.chain, transport: custom(p) })
      setN1({ tone: 'muted', text: bt('n.approve', { v: usd(units) }) })
      const ah = await approveIfNeeded(w, src, units)
      if (ah) { j.approve = ah; setJob(j); setN1({ tone: 'muted', text: bt('n.approving', { net: src.name }) }); await confirmed(src, ah) }
      setN1({ tone: 'muted', text: bt('n.burn') })
      atBurn = true
      const bh = await burn(w, src, units, me)
      j.burn = bh; j.t0 = Date.now(); setJob(j)
      focusStep(1)
      // the confirmation is the effect above (it also serves a reload)
    } catch (e) {
      // the approval went through (now or on an earlier try) and the burn was declined: say so, not "nothing was sent"
      const E = await engine().catch(() => null)
      setN1(atBurn && (j.approve || job?.approve) && E?.isRefusal(e) ? { tone: 'bad', text: bt('e.refusedBurn') } : await say(e, src, 1))
    } finally { setRun(0) }
  }

  async function receive() {
    if (run || !job?.message || !job.att) return
    const j = job
    setRun(3); setN3(null)
    try {
      if (await received(j.message!)) { minted(j, true); focusStep(3); return }
      const gas = await gasOf(ARC, me).catch(() => null)
      if (gas === 0n) { setN3({ tone: 'bad', text: bt('gas.arc'), href: FAUCET, hrefLabel: bt('faucet') }); return }
      const p = await providerOf()
      setN3({ tone: 'muted', text: bt('n.switch', { net: ARC.name }) })
      await switchTo(p, ARC)
      const w = createWalletClient({ account: me, chain: ARC.chain, transport: custom(p) })
      setN3({ tone: 'muted', text: bt('n.mint') })
      const h = await mint(w, j.message!, j.att!)
      const nj: Job = { ...j, mint: h }
      setJob(nj)
      setN3({ tone: 'muted', text: bt('n.minting') })
      await confirmed(ARC, h)
      minted(nj, false)
      focusStep(3)
    } catch (e) {
      // refused on Arc because someone received it meanwhile: it is done all the same
      if (await received(j.message!).catch(() => false)) { minted(j, true); focusStep(3) }
      else { setN3(await say(e, ARC, 3)); setJob({ ...j, mint: undefined }) }
    } finally { setRun(0) }
  }

  function again() { setJob(null); setN1(null); setIris(null); setN3(null); setAmount(''); resumed.current = false; setReload((r) => r + 1) }

  const s1: St = job?.burnOk ? 'done' : run === 1 || (job?.burn && !job.burnOk) ? 'doing' : n1?.tone === 'bad' ? 'fail' : 'todo'
  const s2: St = job?.att ? 'done' : job?.burnOk ? 'doing' : 'todo'
  const s3: St = done ? 'done' : run === 3 || job?.mint ? 'doing' : job?.att ? (n3?.tone === 'bad' ? 'fail' : 'todo') : 'todo'
  const active = s1 !== 'done' ? 1 : s2 !== 'done' ? 2 : 3
  const secs = job?.burnOk && !job.att ? Math.max(0, Math.round((Date.now() - job.t0) / 1000)) : 0
  void tick
  const arc = bals.arc ?? {}
  const jSrc = netByKey(job?.src) ?? src
  const late = secs > 60 * (jSrc.wait?.upTo ?? 19)

  return (
    <section className="work-sec acts br-sec" id="bridge" aria-labelledby="br-h">
      <div className="br-grid">
        <div className="br-form">
          <h2 className="work-h" id="br-h">{bt('from.h')}</h2>
          <p className="lbl muted work-lede">{bt('from.lede')}</p>
          {resumed.current && !done ? <p className="na-note br-resume" data-tone="muted" role="status">{bt('n.resume', { date: new Date(job!.t0).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) })}</p> : null}
          <div className="br-nets" role="radiogroup" aria-label={bt('from.h')}>
            {SOURCES.map((n) => {
              const v = bals[n.key] ?? {}
              const on = n.key === src.key
              return (
                <button key={n.key} type="button" role="radio" aria-checked={on} className="br-net" disabled={started || run !== 0} onClick={() => setSrcKey(n.key)}>
                  <span className="br-net-n">{n.name}</span>
                  <span className="br-net-v mono tnum">{v.usdc === undefined ? bt('bal.reading') : v.usdc === null ? bt('bal.fail') : usd(v.usdc)}</span>
                  <span className="br-net-g lbl muted">{bt('bal.gas', { v: v.gas === undefined ? bt('bal.reading') : v.gas === null ? bt('bal.fail') : `${fmt(v.gas, 18)} ${n.gas}` })}</span>
                </button>
              )
            })}
          </div>
          {b.usdc === 0n && !started ? <p className="na-note" data-tone="muted">{bt('src.none', { net: src.name })} <a className="tlink" href={FAUCET} target="_blank" rel="noreferrer">{bt('faucet')}</a></p> : null}
          <div className="br-amt">
            <label className="na-f br-f" htmlFor="br-amount"><span className="lbl">{bt('amount')}</span></label>
            <div className="br-row">
              <input id="br-amount" className="br-in mono tnum" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.5" value={started ? plain(job!.amount) : amount} disabled={started || run !== 0}
                onChange={(e) => { const v = e.target.value.trim(); if (v === '' || typing(v)) setAmount(v) }} aria-describedby="br-fee" />
              <button type="button" className="btn btn-line br-max" disabled={started || run !== 0 || typeof b.usdc !== 'bigint' || b.usdc === 0n} onClick={() => typeof b.usdc === 'bigint' && setAmount(formatUnits(b.usdc, 6))}><span>{bt('max')}</span></button>
            </div>
            {started && job!.maxFee !== '0' ? <p className="br-fee lbl muted" id="br-fee">{bt('fee.old', { fee: usd(job!.maxFee) })}</p> : notFree && !started ? <p className="br-fee lbl muted" id="br-fee">{bt('e.notfree', { net: src.name })}</p> : (
              <div className="br-fee" id="br-fee">
                <p className="br-free">{bt('free')}</p>
                <p className="lbl muted">{bt('free.d', { net: jSrc.name, wait: waitOf(jSrc) })}</p>
              </div>
            )}
            {units && !started && !notFree ? <p className="br-get">{bt('get', { v: usd(units) })}</p> : null}
          </div>
          {started ? null : <button type="button" className="btn btn-main br-btn br-go" onClick={start} disabled={run !== 0}><span>{bt('go')}</span></button>}
          {done ? <button type="button" className="btn btn-line br-btn" onClick={again}><span>{bt('new')}</span></button> : null}
          <dl className="br-arc">
            <div><dt className="lbl">{bt('arc.h')}</dt><dd className="mono tnum">{arc.usdc === undefined ? bt('bal.reading') : arc.usdc === null ? bt('bal.fail') : usd(arc.usdc)}</dd></div>
          </dl>
        </div>
        <div className="br-steps">
          <h2 className="work-h">{bt('steps')}</h2>
          <ol className="na-list" aria-label={bt('steps')} ref={list}>
            <StepRow n={1} st={s1} on={active === 1} t={bt('s1.t', { net: jSrc.name })} d={bt('s1.d', { net: jSrc.name, gas: jSrc.gas })} note={n1}
              links={[{ net: jSrc, h: job?.approve, k: 'approve' }, { net: jSrc, h: job?.burn, k: 'depositForBurn' }]} />
            <StepRow n={2} st={s2} on={active === 2} t={bt('s2.t')} d={bt('s2.d', { net: jSrc.name, wait: waitOf(jSrc) })} note={s2 === 'done' ? { tone: 'ok', text: bt('n.attested') } : s2 !== 'doing' ? null : iris?.err ? { tone: 'bad', text: bt('e.iris', { why: iris.err }) } : { tone: 'muted', text: bt(late ? 'n.late' : iris?.seen ? 'n.wait' : 'n.unseen', { t: elapsed(secs), range: rangeOf(jSrc) }), sr: bt(late ? 'n.late' : iris?.seen ? 'n.wait' : 'n.unseen', { t: bt('elapsed.m', { m: Math.floor(secs / 60) }), range: rangeOf(jSrc) }) }}>
              {/* the wait against Circle's usual longest one (never full before the attestation) */}
              {s2 === 'doing' && job?.thr !== FAST ? <div className="br-wait" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(0.97, secs / (60 * (jSrc.wait?.upTo ?? 19))).toFixed(4)})` }} /></div> : null}
            </StepRow>
            <StepRow n={3} st={s3} on={active === 3} t={bt('s3.t')} d={bt('s3.d')} note={done && !n3 ? { tone: 'ok', text: job?.relayed ? bt('n.already') : bt('n.done', { v: usd(job!.minted) }) } : n3}
              links={[{ net: ARC, h: job?.mint, k: 'receiveMessage' }]}>
              {job?.att && !done ? (
                <>
                  <p className="lbl muted br-gas">{bt('arc.gas', { v: arc.gas === undefined ? bt('bal.reading') : arc.gas === null ? bt('bal.fail') : `${fmt(arc.gas, 18)} USDC` })}{arc.gas === 0n ? <> <a className="tlink" href={FAUCET} target="_blank" rel="noreferrer">{bt('faucet')}</a></> : null}</p>
                  <button type="button" className="btn btn-main br-btn" onClick={receive} disabled={run !== 0 || !!job.mint}><span>{bt('mint.go')}</span></button>
                </>
              ) : null}
              {done ? <p className="br-get">{bt('arc.now', { v: arc.usdc === undefined ? bt('bal.reading') : arc.usdc === null ? bt('bal.fail') : usd(arc.usdc) })}</p> : null}
            </StepRow>
          </ol>
        </div>
      </div>
    </section>
  )
}

function StepRow({ n, st, on, t, d, note, links, children }: { n: number; st: St; on: boolean; t: string; d: string; note?: Note | null; links?: { net: Net; h?: Hex; k: string }[]; children?: React.ReactNode }) {
  const ls = (links ?? []).filter((l) => l.h)
  return (
    <li className="na br-step" data-st={st} data-on={on ? '1' : '0'}>
      <div className="na-h br-h" aria-current={on ? 'step' : undefined} tabIndex={-1}>
        <span className="na-n tnum">{String(n).padStart(2, '0')}</span>
        <span className="na-t">{t}</span>
        <span className="na-st mono" data-st={st}>{bt(`st.${st}`)}</span>
      </div>
      <p className="na-d br-d">{d}</p>
      {note && note.sr !== undefined ? <><p className="na-note" data-tone={note.tone} aria-hidden="true">{note.text}</p><p className="sr-only" role="status">{note.sr}</p></> : null}
      {note && note.sr === undefined ? <p className="na-note" data-tone={note.tone} role={note.tone === 'bad' ? 'alert' : 'status'}>{note.text}{note.href ? <> <a className="tlink" href={note.href} target="_blank" rel="noreferrer">{note.hrefLabel}</a></> : null}</p> : null}
      {ls.length ? (
        <ul className="br-tx">
          {ls.map((l) => <li key={l.k}><a className="tlink mono" href={txLink(l.net, l.h)} target="_blank" rel="noreferrer"><span className="lbl">{l.k}</span> {short(l.h!, 4)}</a></li>)}
        </ul>
      ) : null}
      {children ? <div className="na-b">{children}</div> : null}
    </li>
  )
}
