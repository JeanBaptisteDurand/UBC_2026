// The steerable demo: how ArcHive works in nine steps, replayed from a real dated recording (src/demo/replay.json:
// the public API and eth_calls on Arc testnet frozen at one block). It plays end to end
// offline: no read on load. The "Check it live on Arc" button redoes, if the network is up, the three verification
// reads (data/gate.ts) and compares. Controls: arrows, space, Home and End, digits 1 to 9, buttons. One step per
// STEPS entry.
import { useCallback, useEffect, useRef, useState } from 'react'
import { t, useLang, type TKey } from '../i18n'
import { num, short, usdc, usdc4, pct } from '../data/fmt'
import { tx as txUrl, addr, link } from '../links'
import { ArcIgnite, plainAcc } from '../ui/ArcGlow'
import { Footer } from '../ui/Footer'
import { AppHeader } from '../app/AppFrame'
import R from './replay.json'

type Node = 'author' | 'machine' | 'arc' | 'user'
type Edge = 'author-arc' | 'machine-arc' | 'user-machine' | 'user-arc'
interface Step { k: string; on: Node[]; edges: Edge[]; lit?: Partial<Record<Node, 'green' | 'red' | 'arc'>> }
const STEPS: Step[] = [
  { k: 's1', on: ['author', 'machine', 'arc', 'user'], edges: [] },
  { k: 's2', on: ['author', 'arc'], edges: ['author-arc'] },
  { k: 's3', on: ['machine'], edges: [] },
  { k: 's4', on: ['machine', 'arc'], edges: ['machine-arc'] },
  { k: 's5', on: ['arc'], edges: ['machine-arc'], lit: { arc: 'arc' } },
  { k: 's6', on: ['arc', 'machine'], edges: ['machine-arc', 'author-arc'], lit: { arc: 'arc', machine: 'green' } },
  { k: 's7', on: ['arc', 'machine'], edges: ['machine-arc'], lit: { arc: 'arc', machine: 'red' } },
  { k: 's8', on: ['user', 'machine', 'arc'], edges: ['user-machine', 'user-arc'], lit: { machine: 'green' } },
  { k: 's9', on: ['author', 'machine', 'arc', 'user'], edges: ['author-arc', 'machine-arc', 'user-machine', 'user-arc'], lit: { machine: 'green', arc: 'arc' } },
]
const N = STEPS.length
const rec = R as unknown as {
  recordedAt: string; head: number; headTime: number
  product: { id: string; price: string; bpsOperator: number; bpsAuthor: number; bpsNetwork: number; minBond: string; author: string; unitTokens: number }
  payProduct: { id: string; bpsOperator: number; bpsAuthor: number; bpsNetwork: number; price: string } | null
  enclave: { signer: string; operator: string; anchorBlock: string; productId: string }
  image: string | null
  /** true only if the API had verified the manifest (proof.manifestVerified) at recording time; absent from the
   *  recording: its "image" is the API's default value, never shown */
  imageVerified?: boolean
  registration: { tx: string; block: number; costUsdc: number; quoteBytes: number; eventLogBytes: number; events: string[]; composeIdx: number; measures: Record<string, string>; allowedId: string; allowedStill: boolean; tcbStatus: number; anchorR: string }
  replay: { ok: Rp; refused: Rp }
  payment: { tx: string; block: number; args: Record<string, string> } | null
  stats: { enclaves: number; enclavesActive: number; products: number; x402Calls: number; settledUsdc: string }
  blocks: Record<string, number>
}
interface Rp { flip: number | null; byteBefore: number | null; byteAfter: number | null; rtmr3: string; imageId: string; composeHash?: string; allowed: boolean; rtmr3Matches: boolean }

const bytes = (h: string) => (h.replace(/^0x/, '').match(/../g) ?? [])
const dateOf = (unix: number | undefined, lang: string) => (unix ? new Date(unix * 1000).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '')
const hx = (n: number | null) => (n === null ? '' : '0x' + n.toString(16).padStart(2, '0')) // a byte shown in hexadecimal (data)

/** the four-actor diagram: edges draw as the flow passes, nodes light up when they act */
function Stage({ s }: { s: Step }) {
  useLang()
  const node = (n: Node, x: number, y: number) => {
    const on = s.on.includes(n), lit = s.lit?.[n]
    return (
      <g className={`dn ${on ? 'on' : ''} ${lit ? `lit-${lit}` : ''}`} transform={`translate(${x} ${y})`}>
        <rect x="-96" y="-34" width="192" height="68" className="dn-box" />
        <rect x="-84" y="-18" width="4" height="36" className="dn-led" />
        <text x="-68" y="-4" className="dn-t">{t(`demo.n.${n}` as TKey)}</text>
        <text x="-68" y="16" className="dn-s">{t(`demo.n.${n}.s` as TKey)}</text>
      </g>
    )
  }
  const P: Record<Node, [number, number]> = { author: [130, 70], arc: [490, 70], machine: [130, 250], user: [490, 250] }
  const edge = (e: Edge) => {
    const [a, b] = e.split('-') as [Node, Node]
    const [x1, y1] = P[a], [x2, y2] = P[b]
    const dx = Math.sign(x2 - x1) * (x1 === x2 ? 0 : 96), dy = Math.sign(y2 - y1) * (y1 === y2 ? 0 : 34)
    return <path key={`${e}-${s.k}`} d={`M${x1 + dx} ${y1 + dy} L${x2 - dx} ${y2 - dy}`} pathLength={1} className={`de ${s.edges.includes(e) ? 'on' : ''}`} />
  }
  return (
    <svg className="stage-svg" viewBox="0 0 620 320" role="img" aria-label={t('demo.stage')}>
      {(['author-arc', 'machine-arc', 'user-machine', 'user-arc'] as Edge[]).map(edge)}
      {node('author', ...P.author)}{node('arc', ...P.arc)}{node('machine', ...P.machine)}{node('user', ...P.user)}
    </svg>
  )
}

function Bytes({ a, b, tone }: { a: string; b?: string; tone: 'arc' | 'ok' | 'diff' }) {
  const A = bytes(a), B = b ? bytes(b) : A
  return (
    <div className={`bytes demo-bytes ${tone === 'ok' ? 'is-ok' : ''}`} style={{ gridTemplateColumns: `repeat(${A.length > 32 ? 24 : 16}, minmax(0, 1fr))` }}>
      {/* the comparison runs column by column, left to right */}
      {A.map((x, i) => <span key={i} className={`by mono ${B[i] === x ? 'on' : 'diff'}`} style={{ ['--c' as string]: i % (A.length > 32 ? 24 : 16) }}>{B[i]}</span>)}
    </div>
  )
}
const KV = ({ rows }: { rows: [TKey | string, React.ReactNode][] }) => (
  <dl className="kv-list demo-kv unfold">{rows.map(([k, v], j) => <div key={k} className="kv-row row" style={{ ['--j' as string]: j }}><dt>{k.includes('.') ? t(k as TKey) : k}</dt><dd>{v}</dd></div>)}</dl>
)
const Tx = ({ h, label }: { h: string; label?: string }) => <a className="tlink mono" href={txUrl(h)} target="_blank" rel="noreferrer">{label ?? short(h, 6)}</a>

/** each step's data, all taken from the recording */
function Data({ k, live }: { k: string; live: LiveCheck }) {
  const lang = useLang()
  const r = rec.registration, p = rec.product, ok = rec.replay.ok, no = rec.replay.refused
  switch (k) {
    case 's1': return <KV rows={[['demo.d.enclaves', <span className="mono">{`${rec.stats.enclavesActive} / ${rec.stats.enclaves}`}</span>], ['demo.d.products', <span className="mono">{rec.stats.products}</span>], ['demo.d.calls', <span className="mono">{num(rec.stats.x402Calls, lang)}</span>], ['demo.d.settled', <span className="mono">{usdc(rec.stats.settledUsdc, lang)}</span>]]} />
    case 's2': return <KV rows={[['demo.d.product', <span className="mono">{`#${p.id}, ${t('svc.ai')}`}</span>], ['d.author', <a className="tlink mono" href={addr(p.author)} target="_blank" rel="noreferrer">{short(p.author, 4)}</a>], ['demo.d.allowed', <span className="mono">{short(r.allowedId, 8)}</span>], ['d.price', <span className="mono">{`${usdc(p.price, lang)} ${t('card.per.token')}`}</span>], ['d.split', <span className="mono">{[p.bpsOperator, p.bpsAuthor, p.bpsNetwork].map((b) => pct(b, lang)).join(', ')}</span>], ['d.bond', <span className="mono">{usdc(p.minBond, lang)}</span>]]} />
    case 's3': return (
      <>
        {/* the image is named only if its manifest was verified; otherwise the image digest and the compose digest,
            as Arc recomputes them (imageIdOf, replayEventLog, at recording time) */}
        <KV rows={[
          ...(rec.imageVerified === true && rec.image
            ? [['demo.d.image', <span className="mono man-i">{rec.image.split('@')[0]}{rec.image.includes('@') ? <>@<wbr />{rec.image.split('@')[1]}</> : null}</span>] as [TKey, React.ReactNode]]
            : [['demo.d.fp', <span className="mono man-i">{ok.imageId}</span>], ...(ok.composeHash ? [['demo.d.compose', <span className="mono man-i">{ok.composeHash}</span>]] : [])] as [TKey, React.ReactNode][]),
          ['demo.d.mrtd', <span className="mono">{short(r.measures.mrtd, 8)}</span>], ['demo.d.quote', <span className="mono">{t('demo.d.bytes', { n: num(r.quoteBytes, lang) ?? '' })}</span>]]} />
        <ol className="bootlog unfold">{r.events.map((e, j) => <li key={e} data-n={String(j + 1).padStart(2, '0')} className={`row mono ${j === r.composeIdx ? 'is-key' : ''}`} style={{ ['--j' as string]: j }}>{e}</li>)}</ol>
        <p className="lbl muted boot-key"><span className="boot-key-m" aria-hidden="true" />{t('demo.d.composeKey')}</p>
      </>
    )
    case 's4': return <KV rows={[['demo.d.tx', <Tx h={r.tx} />], ['demo.d.block', <span className="mono">{`${num(r.block, lang)}, ${dateOf(rec.blocks[r.block], lang)}`}</span>], ['demo.d.anchor', <span className="mono">{num(Number(rec.enclave.anchorBlock), lang)}</span>], ['demo.d.signer', <a className="tlink mono" href={addr(rec.enclave.signer)} target="_blank" rel="noreferrer">{short(rec.enclave.signer, 4)}</a>], ['d.operator', <a className="tlink mono" href={addr(rec.enclave.operator)} target="_blank" rel="noreferrer">{short(rec.enclave.operator, 4)}</a>], ['demo.d.cost', <span className="mono">{usdc4(r.costUsdc, lang)}</span>]]} />
    case 's5': return (
      <div className="demo-cmp">
        <p className="lbl muted">{t('demo.d.signed')}</p><Bytes a={r.measures.rtmr3} tone="arc" />
        <p className="lbl muted">{t('demo.d.replayed')}</p><Bytes a={r.measures.rtmr3} b={ok.rtmr3} tone="arc" />
        <p className="demo-v"><span className={`led ${ok.rtmr3Matches ? 'led-green' : 'led-red'}`} aria-hidden="true" />{ok.rtmr3Matches ? t('demo.v.rtmr') : t('demo.v.rtmrNo')}</p>
        <LiveLine live={live} which="ok" />
      </div>
    )
    case 's6': return (
      <div className="demo-cmp">
        <p className="lbl muted">{t('s5.allowed')}</p><Bytes a={r.allowedId} tone="ok" />
        <p className="lbl muted">{t('s5.recomp')}</p><Bytes a={r.allowedId} b={ok.imageId} tone="ok" />
        <p className="demo-v"><span className={`led ${ok.allowed ? 'led-green' : 'led-red'}`} aria-hidden="true" />{ok.allowed ? t('s5.ok') : t('demo.v.notAllowed')}</p>
        <LiveLine live={live} which="ok" />
      </div>
    )
    case 's7': {
      const n = bytes(r.allowedId).filter((x, i) => bytes(no.imageId)[i] !== x).length
      return (
        <div className="demo-cmp">
          <p className="lbl muted">{t('demo.d.flip', { i: (no.flip ?? 0) + 1, a: hx(no.byteBefore), b: hx(no.byteAfter) })}</p>
          <p className="lbl muted">{t('s5.allowed')}</p><Bytes a={r.allowedId} tone="diff" />
          <p className="lbl muted">{t('s5.recomp')}</p><Bytes a={r.allowedId} b={no.imageId} tone="diff" />
          <p className="demo-v"><span className="led led-red" aria-hidden="true" />{n === 1 ? t('s5.refused1') : t('s5.refused', { n })}</p>
          <LiveLine live={live} which="no" />
        </div>
      )
    }
    case 's8': {
      const pay = rec.payment, pp = rec.payProduct
      if (!pay || !pp) return <p className="body">{t('end.none')}</p>
      const amt = Number(pay.args.amount)
      return <KV rows={[['demo.d.paid', <span className="mono">{`${usdc(pay.args.amount, lang)}, ${t('demo.d.other', { id: pp.id, s: t('svc.x402') })}`}</span>], ['demo.d.payer', <a className="tlink mono" href={addr(pay.args.payer)} target="_blank" rel="noreferrer">{short(pay.args.payer, 4)}</a>], ['demo.d.toOp', <span className="mono">{`${usdc(Math.round((amt * pp.bpsOperator) / 10000), lang)} (${pct(pp.bpsOperator, lang)})`}</span>], ['demo.d.toAuthor', <span className="mono">{`${usdc(Math.round((amt * pp.bpsAuthor) / 10000), lang)} (${pct(pp.bpsAuthor, lang)})`}</span>], ['demo.d.toNet', <span className="mono">{`${usdc(Math.round((amt * pp.bpsNetwork) / 10000), lang)} (${pct(pp.bpsNetwork, lang)})`}</span>], ['demo.d.tx', <Tx h={pay.tx} />], ['demo.d.block', <span className="mono">{`${num(pay.block, lang)}, ${dateOf(rec.blocks[pay.block], lang)}`}</span>]]} />
    }
    default: return (
      <ol className="chain demo-chain unfold">
        {([['demo.c.1', rec.registration.tx], ['demo.c.2', rec.payment?.tx ?? null]] as [TKey, string | null][]).map(([k, h], j) => (
          <li key={k} className="row" style={{ ['--j' as string]: j }}><span className="led led-green" aria-hidden="true" /><span className="c-main"><span className="c-t">{t(k)}</span></span>{h ? <Tx h={h} label={t('proof.open')} /> : <span className="muted">{t('end.none')}</span>}</li>
        ))}
      </ol>
    )
  }
}

// ---- live verification, on demand (if the network is up) ----
interface LiveCheck { state: 'idle' | 'calling' | 'done' | 'error'; ok?: { allowed: boolean; imageId: string }; no?: { allowed: boolean; imageId: string }; block?: number; run: () => void }
function LiveLine({ live, which }: { live: LiveCheck; which: 'ok' | 'no' }) {
  const lang = useLang()
  const recd = which === 'ok' ? rec.replay.ok : rec.replay.refused
  const got = live[which]
  return (
    <div className="demo-live">
      {live.state === 'idle' ? <button className="btn btn-line btn-s" onClick={live.run}><span>{t('demo.live')}</span></button>
        : live.state === 'calling' ? <span className="lbl muted">{t('s5.calling')}</span>
        : live.state === 'error' ? <span className="demo-live-e"><span className="lbl muted">{t('demo.live.off')}</span><button className="btn btn-line btn-s" onClick={live.run}><span>{t('s5.retry')}</span></button></span>
        : got ? <span className="lbl">{(got.imageId.toLowerCase() === recd.imageId.toLowerCase() && got.allowed === recd.allowed ? t('demo.live.same') : t('demo.live.diff')).replace('{n}', num(live.block ?? 0, lang) ?? '')}</span> : null}
    </div>
  )
}
function useLiveCheck(): LiveCheck {
  const [st, setSt] = useState<Omit<LiveCheck, 'run'>>({ state: 'idle' })
  const run = useCallback(() => {
    setSt({ state: 'calling' })
    ;(async () => {
      const { loadGate, replay } = await import('../data/gate')
      const { rpc } = await import('../data/live')
      const g = await loadGate(rec.registration.tx)
      const block = parseInt(await rpc<string>('eth_blockNumber', []), 16)
      const [a, b] = await Promise.all([replay(g, null, block), replay(g, rec.replay.refused.flip, block)])
      setSt({ state: 'done', block, ok: { allowed: a.allowed, imageId: a.imageId }, no: { allowed: b.allowed, imageId: b.imageId } })
    })().catch(() => setSt({ state: 'error' }))
  }, [])
  return { ...st, run }
}

export function DemoPage() {
  const lang = useLang()
  const q = new URLSearchParams(location.search)
  const [i, setI] = useState(() => Math.min(N - 1, Math.max(0, (Number(q.get('step')) || 1) - 1)))
  const live = useLiveCheck()
  const go = useCallback((n: number) => setI((c) => Math.min(N - 1, Math.max(0, typeof n === 'number' ? n : c))), [])
  // the copilot (src/copilot/driver.ts): play, pause, step forward, step back, go to a step. Playback advances one
  // step every 5 s and stops at the last one, or as soon as the user takes control (keyboard, click)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ action?: string; step?: number }>).detail ?? {}
      if (d.action === 'play') { setI((c) => (c >= N - 1 ? 0 : c)); setPlaying(true) }
      else if (d.action === 'pause') setPlaying(false)
      else if (d.action === 'next') setI((c) => Math.min(N - 1, c + 1))
      else if (d.action === 'prev') setI((c) => Math.max(0, c - 1))
      else if (d.action === 'goto' && Number.isInteger(d.step)) setI(Math.min(N - 1, Math.max(0, Number(d.step) - 1)))
    }
    const stop = (e: Event) => { if (e.isTrusted && !(e.target as Element | null)?.closest?.('input, select, textarea, #cp-root')) setPlaying(false) }
    addEventListener('archive:demo', on); addEventListener('keydown', stop); addEventListener('pointerdown', stop)
    return () => { removeEventListener('archive:demo', on); removeEventListener('keydown', stop); removeEventListener('pointerdown', stop) }
  }, [])
  useEffect(() => {
    if (!playing) return
    if (i >= N - 1) { setPlaying(false); return }
    const id = setTimeout(() => setI((c) => Math.min(N - 1, c + 1)), 5000)
    return () => clearTimeout(id)
  }, [playing, i])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null
      if (e.altKey || e.ctrlKey || e.metaKey || tg?.closest?.('input, select, textarea')) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey && !tg?.closest?.('button, a'))) { e.preventDefault(); setI((c) => Math.min(N - 1, c + 1)) }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); setI((c) => Math.max(0, c - 1)) }
      else if (e.key === 'Home') { e.preventDefault(); setI(0) }
      else if (e.key === 'End') { e.preventDefault(); setI(N - 1) }
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= N) setI(Number(e.key) - 1)
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])
  useEffect(() => { const u = new URL(location.href); u.searchParams.set('step', String(i + 1)); history.replaceState(null, '', u) }, [i])
  const s = STEPS[i]
  const panel = useRef<HTMLDivElement>(null)
  // on each step, the entry motions replay: the rule, then the title, then the rows unfolding
  useEffect(() => {
    const el = panel.current; if (!el) return
    const xs = el.querySelectorAll('.ttl, .unfold')
    xs.forEach((x) => x.classList.remove('in'))
    const id = requestAnimationFrame(() => requestAnimationFrame(() => xs.forEach((x) => x.classList.add('in'))))
    return () => cancelAnimationFrame(id)
  }, [i, lang])
  const title = t(`demo.${s.k}.t` as TKey)
  return (
    <>
      <a className="skip" href="#demo" data-front-free>{t('demo.skip')}</a>
      <AppHeader page="demo" section="demo.sec" replay={{ block: rec.head, date: dateOf(rec.headTime, lang) }} />
      <main className="app demo" id="demo">
        <p className="demo-replay lbl" role="note"><span className="demo-rec" aria-hidden="true" />{t('demo.replay', { d: dateOf(rec.headTime, lang), n: num(rec.head, lang) ?? '' })}</p>
        <div className="demo-grid" ref={panel}>
          <section className="demo-txt" aria-live="polite" aria-labelledby="demo-h">
            <p className="lbl muted mono demo-n">{t('step', { n: i + 1, m: N })}</p>
            <h1 className="h2 ttl demo-h" id="demo-h" aria-label={plainAcc(title)} key={`h${i}`}>
              <span className="ttl-m" aria-hidden="true"><span className="ttl-t"><ArcIgnite text={title} /></span></span>
              <span className="ttl-rule" aria-hidden="true" />
            </h1>
            <p className="lede demo-p">{t(`demo.${s.k}.p` as TKey)}</p>
            <p className="lbl muted demo-tech">{t(`demo.${s.k}.x` as TKey, { n: num(rec.head, lang) ?? '' })}</p>
            {s.k === 's8' && rec.payProduct && rec.payProduct.id !== rec.product.id ? <p className="lbl demo-note">{t('demo.s8.note', { id: rec.payProduct.id })}</p> : null}
          </section>
          <section className="demo-stage" aria-label={t('demo.stage')}>
            <Stage s={s} />
            <div className="demo-data" key={`d${i}`}><Data k={s.k} live={live} /></div>
          </section>
        </div>
        <nav className="demo-nav" aria-label={t('demo.nav')}>
          <button className="btn btn-line btn-s" onClick={() => go(i - 1)} disabled={i === 0}><span>{t('demo.prev')}</span></button>
          <ol className="demo-dots">
            {STEPS.map((x, j) => <li key={x.k}><button data-n={j + 1} className={`dot mono ${j === i ? 'is-on' : j < i ? 'is-done' : ''}`} aria-current={j === i ? 'step' : undefined} onClick={() => go(j)} aria-label={`${j + 1}. ${plainAcc(t(`demo.${x.k}.t` as TKey))}`} /></li>)}
          </ol>
          <button className="btn btn-main btn-s" onClick={() => go(i + 1)} disabled={i === N - 1}><span>{t('demo.next')}</span></button>
          <span className="lbl muted demo-keys no-touch">{t('demo.keys')}</span>
        </nav>
        <p className="demo-out lbl"><a className="tlink" href={link.use}>{t('demo.toUse')}</a></p>
      </main>
      <Footer replay />
    </>
  )
}
