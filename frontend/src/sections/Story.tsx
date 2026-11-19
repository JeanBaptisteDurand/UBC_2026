// 6 and 7: the two pinned pages, each over three screen heights, with their progress; every scroll notch moves
// something forward. 8: the ending, back to the three actions and the proof chain.
import { useEffect, useRef, useState } from 'react'
import { useLive } from '../data/live'
import { num, short, usdc, usdc4 } from '../data/fmt'
import { t, useLang, getLang, type TKey } from '../i18n'
import { link, networkFor, tx } from '../links'
import { world, useWallVersion } from '../world'
import { loadGate, replay, diffCount, type GateInput, type Replay } from '../data/gate'
import { onTick } from '../clock'
import { useIn } from '../ui/gestures'
import { productLabel } from '../data/wall'
import { Title } from './Hero'

/** Height of the text panel of a pinned page (portrait: the scene centres above it) */
function usePinH(id: 'protocol' | 'arc', ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('.txt'); if (!el) return
    const ro = new ResizeObserver(() => { world.pinH[id] = el.offsetHeight })
    ro.observe(el); world.pinH[id] = el.offsetHeight
    return () => ro.disconnect()
  }, [id, ref])
}

/** Phones, upright or sideways (styles.css: under 761 px wide, or under 500 px tall in landscape): a pinned panel taller
 *  than the screen sticks by its bottom instead of its top, so its last lines (the Arc check button and verdict) stay
 *  in view for the whole pinned scroll; its title went by on the way in. The pinned stop keeps its length: the film and
 *  the steps are unchanged. */
const SHORT = '(max-width: 760px), (max-height: 500px) and (orientation: landscape)'
function usePinFit(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const pin = ref.current?.querySelector<HTMLElement>('.pin-in'); if (!pin) return
    const mq = matchMedia(SHORT)
    const fit = () => {
      const over = mq.matches ? pin.offsetHeight - innerHeight : 0
      const v = over > 1 ? `${-Math.ceil(over)}px` : ''
      if (pin.style.top !== v) pin.style.top = v
    }
    const ro = new ResizeObserver(fit)
    ro.observe(pin); fit()
    mq.addEventListener('change', fit); addEventListener('resize', fit)
    return () => { ro.disconnect(); mq.removeEventListener('change', fit); removeEventListener('resize', fit) }
  }, [ref])
}

/** Progress of a pinned page: numbered steps (the real sequence) and a rule that fills */
function Steps({ id, n, label, at }: { id: 'protocol' | 'arc'; n: number; label: (k: number) => string; at?: number[] }) {
  const bar = useRef<HTMLSpanElement>(null)
  const [cur, setCur] = useState(0)
  useLang()
  useEffect(() => onTick(() => {
    const p = world.sec[id] ?? 0
    if (bar.current) bar.current.style.setProperty('--p', p.toFixed(4))
    const k = at ? at.filter((x) => p >= x).length : Math.min(n - 1, Math.floor(p * n * 0.999))
    setCur((c) => (c === k ? c : k))
  }), [id, n])
  return (
    <div className="steps" role="group" aria-label={t('step', { n: cur + 1, m: n })}>
      <span className="steps-rail" aria-hidden="true"><span className="steps-bar" ref={bar} /></span>
      <ol>
        {Array.from({ length: n }, (_, k) => (
          <li key={k} className={k === cur ? 'on' : k < cur ? 'done' : ''}><span className="st-t">{label(k)}</span></li>
        ))}
      </ol>
    </div>
  )
}

/** Labels of the seven layers during the exploded view, linked by elbow lines to the scene layers */
const LAYERS: TKey[] = ['m1.t', 'm2.t', 'm3.t', 'm4.t', 'm5.t', 'm6.t', 'm7.t']
function PartLabels() {
  const svg = useRef<SVGSVGElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const bg = useRef<HTMLDivElement>(null)
  useLang()
  useWallVersion()
  const colR = useRef({ w: 0, r: 0 }).current
  useEffect(() => onTick(() => {
    const s = svg.current, b = box.current, pb = bg.current; if (!s || !b || !pb) return
    const paths = s.querySelectorAll('path'), dots = s.querySelectorAll('circle')
    const els = [...b.querySelectorAll<HTMLElement>('.plab')]
    if (innerWidth < 760) { els.forEach((e) => { e.dataset.on = '0' }); paths.forEach((e) => { e.style.opacity = '0' }); dots.forEach((e) => { e.style.opacity = '0' }); pb.dataset.on = '0'; return }
    const p = world.sec.protocol ?? 0
    const items = LAYERS.map((_, j) => ({ j, a: world.anchors.get(`part.${j}`) }))
    // the first layer (the rear coupling of the tray) carries no label: the exploded view names the six that matter
    const shown = items.filter((x) => x.j !== 0 && !!x.a && x.a.vis > 0.6 && p > 0.29 && p < 0.515).sort((u, v) => u.a!.y - v.a!.y)
    // The labels sit just right of the layers, each at the height of its own (no overlap), linked by a
// short line; the column aligns on the right margin if the slot leaves it too little room
    const lw = shown.reduce((m, x) => Math.max(m, els[x.j]?.offsetWidth ?? 0), 0)
    const gut = Math.min(72, innerWidth * 0.04)
    // the attachment points are on the layers; the column sits right of the right edge of the slot
    const colX = Math.min(Math.max(...shown.map((x) => x.a!.x), 0) + 96, innerWidth - gut - lw)
    // the background never covers the text column; if there is no room on its right (tablet),
// the labels stay silent (the step paragraph already names the layers)
    if (colR.w !== innerWidth) { colR.w = innerWidth; colR.r = s.closest('.pin-in')?.querySelector<HTMLElement>('.txt')?.getBoundingClientRect().right ?? 0 }
    if (colX < colR.r + 24) shown.length = 0
    const pos = new Map<number, number>()
    // bottom to top: the lowest layer keeps its height, the others move up if needed (30 px gap)
    let y = innerHeight - 40
    for (const it of [...shown].reverse()) { const yy = Math.min(y, it.a!.y - 12); pos.set(it.j, yy); y = yy - 30 }
    // No solid background cutting the rack. A light veil under the label column, faded on its
// four edges (the rack stays readable through it), and each line runs from its layer (a dot set on it) to its
// label
    if (pos.size) {
      const ys = [...pos.values()], y0 = Math.min(...ys) - 22, y1 = Math.max(...ys) + 46
      const k = `${colX.toFixed(0)} ${y0.toFixed(0)} ${(lw + 48).toFixed(0)} ${(y1 - y0).toFixed(0)}`
      if (pb.dataset.k !== k) { pb.dataset.k = k; pb.style.transform = `translate3d(${(colX - 24).toFixed(0)}px, ${y0.toFixed(0)}px, 0)`; pb.style.width = `${(lw + 48).toFixed(0)}px`; pb.style.height = `${(y1 - y0).toFixed(0)}px` }
      pb.dataset.on = '1'
    } else pb.dataset.on = '0'
    items.forEach(({ j, a }) => {
      const el = els[j], path = paths[j] as SVGPathElement, dot = dots[j] as SVGCircleElement
      if (!pos.has(j) || !a) { el.dataset.on = '0'; path.style.opacity = '0'; dot.style.opacity = '0'; return }
      const yy = pos.get(j)!
      el.dataset.on = '1'
      el.style.transform = `translate3d(${colX.toFixed(0)}px, ${yy.toFixed(0)}px, 0)`
      const x0 = colX - 4, y0 = yy + 12
      // from the layer, slanted until 16 px before the label, then horizontal up to it
      path.setAttribute('d', `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${Math.max(a.x + 8, x0 - 16).toFixed(1)} ${y0.toFixed(1)}H${x0.toFixed(1)}`)
      dot.setAttribute('cx', a.x.toFixed(1)); dot.setAttribute('cy', a.y.toFixed(1))
      path.style.opacity = '1'; dot.style.opacity = '1'
    })
    // the Arc sheet: a single line, from the checks block (left column) to the placed sheet
    const sh = world.anchors.get('sheet'), lab = document.querySelector<HTMLElement>('[data-lead="sheet"]')
    const path = paths[LAYERS.length] as SVGPathElement
    if (sh && lab && sh.vis > 0.6 && p > 0.66 && p < 0.84) {
      const r = lab.getBoundingClientRect()
      const x0 = r.right + 12, y0 = r.top + 10
      const xm = x0 + Math.max(24, (sh.x - x0) * 0.4)
      path.setAttribute('d', `M${x0.toFixed(1)} ${y0.toFixed(1)}H${xm.toFixed(1)}L${(sh.x - 6).toFixed(1)} ${sh.y.toFixed(1)}`)
      path.style.opacity = '1'
    } else path.style.opacity = '0'
  }), [])
  return (
    <div className="parts-layer" aria-hidden="true">
      <svg ref={svg} width="100%" height="100%">{LAYERS.map((k) => <path key={k} />)}<path className="arc" />{LAYERS.map((k) => <circle key={k} r="2.5" />)}</svg>
      <div ref={bg} className="plab-bg" />
      <div ref={box}>{LAYERS.map((k) => <span key={k} className="plab lbl" data-front-free>{t(k)}</span>)}</div>
    </div>
  )
}

export function Protocol() {
  const ref = useRef<HTMLElement>(null)
  useIn(ref)
  usePinH('protocol', ref)
  usePinFit(ref)
  useLang()
  return (
    <section className="sec pin pin-proto" data-sec="protocol" ref={ref} id="protocol">
      <div className="pin-in">
        <div className="txt">
          <Title k="proto.title" />
          <Steps id="protocol" n={4} at={[0.24, 0.525, 0.76]} label={(k) => t(`proto.${k + 1}.t` as TKey)} />
          <ProtoText />
        </div>
        <PartLabels />
      </div>
    </section>
  )
}
/** The step text; at the third, the checks carried by the Arc sheet, read live */
function ProtoText() {
  const [k, setK] = useState(0)
  const lang = useLang()
  useWallVersion()
  const products = useLive((s) => s.products)
  const bounties = useLive((s) => s.bounties)
  useEffect(() => onTick(() => { const p = world.sec.protocol ?? 0; const n = p < 0.24 ? 0 : p < 0.525 ? 1 : p < 0.76 ? 2 : 3; setK((c) => (c === n ? c : n)) }), [])
  const sl = world.wall.sleds[world.wall.replay]
  const e = sl?.enclave, pr = sl?.product
  const checks: [string, string][] = [
    [t('l1.t'), pr ? `${productLabel(pr, products, bounties)}, ProductRegistry #${pr.id}` : t('state.loading')],
    [t('l1.author'), pr ? short(pr.author, 4) : t('state.loading')],
    [t('chk.opBond'), e && pr ? `${short(e.operator, 4)}, ${usdc(pr.minBond, lang)}` : t('state.loading')],
    // two distinct blocks in the registration data, stated plainly: the block where Arc admitted
// the enclave (registration transaction) and the block its quote is anchored to (anchorBlock)
    [t('l3.t'), e ? (world.wall.replayBlock ? `${short(e.signer, 4)}, ${t('chk.adm', { n: num(world.wall.replayBlock, lang)! })}` : short(e.signer, 4)) : t('state.loading')],
    [t('chk.anchor'), e ? t('card.block', { n: num(Number(e.anchorBlock), lang)! }) : t('state.loading')],
  ]
  return (
    <div className="proto-text">
      <p className="lede swap" key={k}>{t(`proto.${k + 1}.p` as TKey)}</p>
      {k >= 2 ? (
        <dl className="kv checks unfold in" data-lead="sheet">
          {checks.map(([a, b], j) => <div className="row" key={a} style={{ ['--j' as string]: j }}><dt className="lbl">{a}</dt><dd className="mono">{b}</dd></div>)}
        </dl>
      ) : null}
    </div>
  )
}

// ---------------- 7: Arc admits it ----------------
type Phase = 'idle' | 'calling' | 'ok' | 'refused' | 'error'
export function ArcGate() {
  const ref = useRef<HTMLElement>(null)
  useIn(ref)
  usePinH('arc', ref)
  usePinFit(ref)
  const lang = useLang()
  useWallVersion()
  const replayTx = world.wall.replayTx
  const [g, setG] = useState<GateInput | null>(null)
  const [r, setR] = useState<Replay | null>(null)
  const [base, setBase] = useState<Replay | null>(null)
  const [flip, setFlip] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [near, setNear] = useState(false)
  const [late, setLate] = useState(false)
  const started = useRef(false)
  const set = (p: Phase) => { setPhase(p); world.gate.phase = p }
  const run = async (gi: GateInput, f: number | null) => {
    set('calling')
    const t0 = performance.now()
    try {
      // three reads without a transaction; the seal states the original admission block, not the head
      const out = await replay(gi, f)
      await new Promise((res) => setTimeout(res, Math.max(0, 500 - (performance.now() - t0))))
      setR(out); if (f === null) setBase(out)
      set(out.allowed ? 'ok' : 'refused')
    } catch { set('error') }
  }
  const start = (h: string) => {
    started.current = true
    set('calling')
    loadGate(h).then((gi) => { setG(gi); return run(gi, flip) }).catch(() => set('error'))
  }
  // reads start when the section approaches (one and a half screens before): the verdict is ready on arrival
  useEffect(() => {
    const el = ref.current!
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNear(true) }, { rootMargin: '0px 0px 150% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  // reads also start during idle time after loading (the log decoding never lands during
// scrolling)
  useEffect(() => {
    if (!replayTx || started.current) return
    const go = () => { if (!started.current && world.sceneReady) start(replayTx) }
    const id = setTimeout(() => ('requestIdleCallback' in window ? (window as unknown as { requestIdleCallback: (f: () => void, o: object) => void }).requestIdleCallback(go, { timeout: 2500 }) : go()), 2500)
    return () => clearTimeout(id)
  }, [replayTx]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (near && !started.current && replayTx) start(replayTx) }, [near, replayTx]) // eslint-disable-line react-hooks/exhaustive-deps
  // the verdict shows when the 32 cells are validated and the LED turns green (0.70 of the pinned
// page): the end of the page scroll is the admission, written, held over the last third
  useEffect(() => onTick(() => { const b = (world.sec.arc ?? 0) >= 0.7; setLate((v) => (v === b ? v : b)) }), [])
  // bytes are compared one by one with the authorised measurement, with the scroll (each notch changes the image)
  // byte progress (nb) is read in Bytes, not here: each checked cell no longer re-renders the whole
// section (ignited title included), 32 times on the way to the measurement
  const toggle = () => { if (!g || phase === 'calling') return; const nf = flip === null ? 7 : null; setFlip(nf); run(g, nf) }
  const retry = () => { if (g) run(g, flip); else if (replayTx) start(replayTx) }
  // the authorised measurement is only shown if it is indeed that of this registration (it gives back the
// measurement recomputed from the original log): no red line for an enclave since re-registered with another image
  const allowed = g?.allowedId && base && g.allowedId.toLowerCase() === base.imageId.toLowerCase() ? g.allowedId : null
  const diff = r && (allowed || base) ? diffCount(r.imageId, allowed ?? base!.imageId) : 0
  const shown: Phase = (phase === 'ok' || phase === 'refused') && !late ? 'calling' : phase
  return (
    <section className="sec pin pin-arc" data-sec="arc" ref={ref} id="arc">
      <div className="pin-in">
        <div className="txt">
          <Title k="arc.title" />
          <Steps id="arc" n={4} at={[0.12, 0.25, 0.7]} label={(k) => t(`arc.${k + 1}` as TKey)} />
          <p className="lede">{t('arc.lede')}</p>
          <div className="gate unfold" data-ph={shown}>
            {/* the authorised measurement (read on Arc) above the recomputed measurement, compared cell by
                cell. If the authorised one was not read (or is not the image of this registration), a single line */}
            {allowed ? (
              <div className="row fp" style={{ ['--j' as string]: 0 }} data-slot="ALLOWED FINGERPRINT">
                <span className="lbl muted">{t('s5.allowed')}</span>
                <Bytes h={allowed} ref0 />
              </div>
            ) : null}
            <div className="row fp" style={{ ['--j' as string]: 0 }} data-slot="IMAGE FINGERPRINT">
              <span className="lbl muted">{allowed ? t('s5.recomp') : t('s5.image')}</span>
              <Bytes h={r?.imageId} base={allowed ?? base?.imageId} />
            </div>
            <div className="row two" style={{ ['--j' as string]: 1 }}>
              <span><span className="lbl muted">{t('s5.tx')}</span> <span className="mono">{replayTx ? <a href={tx(replayTx)} target="_blank" rel="noreferrer" className="nowrap tlink" aria-label={`tx ${short(replayTx, 4)}, ${t('proof.open')}`}>{short(replayTx, 4)}</a> : t('state.loading')}</span></span>
              <span><span className="lbl muted">{t('s5.cost')}</span> <span className="mono tnum">{g ? (g.gasCostUsdc != null ? usdc4(g.gasCostUsdc, lang) : t('state.unread')) : phase === 'error' ? t('state.unread') : t('state.loading')}</span></span>
            </div>
            <div className={`verdict ph-${shown}`} aria-live="polite">
              {shown === 'ok' ? <Seal ok label={g?.block ?? world.wall.replayBlock ? t('s5.atOk', { n: num((g?.block ?? world.wall.replayBlock)!, lang) ?? '' }) : t('s5.admitted')} key={`ok${flip}`} /> : shown === 'refused' ? <Seal ok={false} label={t('s5.atNo')} key={`no${flip}`} /> : (phase === 'calling' ? <span className="seal-wait">{t('s5.calling')}</span> : null)}
              {/* "its service can run" only if the replayed enclave is still active; an expired registration gets no line
                  (the seal already says Arc admitted it) */}
              {shown === 'ok' && world.wall.sleds[world.wall.replay]?.enclave?.active === false ? null
                : <p>{shown === 'idle' || shown === 'calling' ? t('s5.idle') : shown === 'ok' ? t('s5.ok') : shown === 'refused' ? (diff === 1 ? t('s5.refused1') : t('s5.refused', { n: diff })) : t('s5.unavailable')}</p>}
            </div>
            {phase === 'error'
              ? <button className="btn btn-line btn-s" onClick={retry} data-slot="CALL ARC AGAIN"><span>{t('s5.retry')}</span></button>
              : <button className="btn btn-line btn-s" onClick={toggle} disabled={!g || phase === 'calling'} data-slot="CHANGE ONE BYTE"><span>{flip === null ? t('s5.flip') : t('s5.restore')}</span></button>}
          </div>
        </div>
      </div>
    </section>
  )
}
function Seal({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`seal ${ok ? 'ok' : 'no'}`}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect x="1.5" y="1.5" width="21" height="21" className="seal-box" pathLength={1} />
        {ok ? <path d="M7 12.5 10.5 16 17 8.5" className="seal-mark" pathLength={1} /> : <path d="M7.5 7.5 16.5 16.5M16.5 7.5 7.5 16.5" className="seal-mark" pathLength={1} />}
      </svg>
      <span className="mono">{label}</span>
    </span>
  )
}

/** The measurement in 32 cells: each is checked as it is read; those that differ turn red */
function Bytes({ h, base, ref0 }: { h?: string; base?: string; ref0?: boolean }) {
  // bytes are compared one by one with the authorised measurement, with the scroll (each notch changes the image)
  const [n, setN] = useState(0)
  useEffect(() => onTick(() => { const p = world.sec.arc ?? 0; const c = Math.min(1, Math.max(0, (p - 0.25) / 0.37)); const k = Math.round(32 * c); setN((v) => (v === k ? v : k)) }), [])
  const s = h?.replace(/^0x/, ''), b = base?.replace(/^0x/, '')
  return (
    <span className={`bytes mono${ref0 ? ' ref' : ''}`} data-front-free role="img" aria-label={h ? `0x${s}` : t('state.loading')}>
      {Array.from({ length: 32 }, (_, i) => {
        const x = s?.slice(i * 2, i * 2 + 2)
        const d = !!(x && b && b.slice(i * 2, i * 2 + 2) !== x) && i < n
        return <span key={i} className={`by ${x && i < n ? 'on' : ''} ${d ? 'diff' : ''} ${x && i === n - 1 && n < 32 ? 'cur' : ''}`} style={{ ['--i' as string]: i }}>{x ?? ''}</span>
      })}
    </span>
  )
}

// ---------------- 8: the ending ----------------
/** "A, B and C" with the link names */
const q = (k: string) => (getLang() === 'fr' ? `«\u00a0${k}\u00a0»` : `“${k}”`)
const listOf = (ks: string[]) => (ks.length === 1 ? q(ks[0]) : `${ks.slice(0, -1).map(q).join(', ')} ${t('and')} ${q(ks[ks.length - 1])}`)
function chainNote(h: (string | null)[], names: string[]) {
  const out: string[] = []
  let i = 0
  while (i < h.length) {
    let j = i
    while (h[i] && j + 1 < h.length && h[j + 1] === h[i]) j++
    if (h[i] && j > i) out.push(i === 0 ? t('proof.sameFirst', { n: j + 1 }) : t('proof.same', { a: listOf(names.slice(i, j + 1)) }))
    i = j + 1
  }
  // pending links already say, on their line, when they get written: the note does not repeat it
  return out.join(' ')
}

export function End() {
  const ref = useRef<HTMLElement>(null)
  useIn(ref)
  const lang = useLang()
  const stats = useLive((s) => s.stats)
  const activity = useLive((s) => s.activity)
  const proof = useLive((s) => s.proof)
  const last = activity?.find((a) => a.name === 'CallSettled' || a.name === 'Settled')
  const e = proof?.enclave
  // the admission block, read from the registration transaction of the proof chain
  const admB = proof?.registerTx ? (activity?.find((a) => a.tx === proof.registerTx && a.name === 'EnclaveRegistered')?.block ?? (world.wall.replayTx === proof.registerTx ? world.wall.replayBlock : null)) : null
  // The image is only "pinned" if the API verified its author's manifest (manifestVerified);
// otherwise proof.image is only the API default value (the image of the old v2 stack), which proves nothing: we
// then show the measurement of the image read on Arc (EnclaveImage event of the registration: imageId and compose)
  const pinned = proof?.manifestVerified === true && !!proof.image
  const fp = proof?.enclaveImage
  const links = [
    { k: pinned || !fp ? 'proof.1' : 'proof.1fp', v: pinned ? short(proof!.image.split('@')[1]?.replace('sha256:', '0x'), 4) : fp ? `image ${short(fp.imageId, 4)}, compose ${short(fp.composeHash, 4)}` : null, h: proof?.enclaveImage?.tx },
    { k: 'proof.2', v: e ? `quote ${short(e.quoteHash, 4)}` : null, h: proof?.registerTx },
    { k: 'proof.3', v: e?.anchorBlock ? (admB ? t('proof.anchorAdm', { a: num(Number(e.anchorBlock), lang)!, n: num(admB, lang)! }) : t('proof.anchor', { n: num(Number(e.anchorBlock), lang)! })) : null, h: proof?.registerTx },
    { k: 'proof.4', v: proof?.settleTx ? 'EIP-712' : null, h: proof?.settleTx },
    { k: 'proof.5', v: proof?.settleUsdc ? usdc(proof.settleUsdc, lang) : null, h: proof?.settleTx },
    { k: 'proof.6', v: proof?.verdictTx ? t('proof.written') : null, h: proof?.verdictTx },
  ] as const
  const names = links.map((l) => t(l.k as TKey))
  const gone = e?.active === false
  return (
    <section className="sec end" data-sec="end" ref={ref} id="end">
      <div className="end-in">
        <div className="chain unfold" data-slot="PROOF CHAIN">
          {/* a real section head (title and rule, like the others) */}
          <Title k="proof.title" />
          <ol>
            {links.map((l, i) => {
              const sentence = !l.v && !!proof && i >= 3
              return (
                <li key={l.k} className={`row ${l.h ? 'ok' : 'wait'}`} style={{ ['--j' as string]: i }}>
                  <span className={`led ${l.h ? 'led-green' : ''}`} aria-hidden="true" />
                  <span className="c-main">
                    <span className="c-t">{t(l.k as TKey)}</span>
                    {/* an enclave whose registration is closed will not settle any more sessions: "not written" (the note
                        below says why), not "written when..." */}
                    <span className={sentence ? 'c-v c-s' : 'mono c-v'}>{l.v ?? (!proof ? t('state.loading') : i >= 3 ? (gone ? t('proof.notWritten') : t(`proof.w${i + 1}` as TKey)) : '')}</span>
                  </span>
                  {/* a transaction shared by several links is written only once, on the first (the note says so) */}
                  {l.h && (i === 0 || links[i - 1].h !== l.h) ? <a className="mono c-tx nowrap tlink" href={tx(l.h)} target="_blank" rel="noreferrer" aria-label={`tx ${short(l.h, 4)}, ${t(l.k as TKey)}, ${t('proof.open')}`}>tx {short(l.h, 4)}</a> : <span className="c-tx" />}
                </li>
              )
            })}
          </ol>
          {proof ? <p className="chain-note">{chainNote(links.map((l) => l.h ?? null), names)}{gone && links.slice(3).some((l) => !l.v) ? ` ${t('proof.wNone')}` : ''}</p> : null}
        </div>
        {/* network figures: a row of four columns, label above, value in mono */}
        <dl className="figs unfold" aria-label={t('end.figs')}>
          {([
            ['end.paid', stats ? usdc(stats.settledUsdc, lang) : null],
            ['end.calls', stats ? num(stats.x402Calls, lang) : null],
            ['end.sessions', stats ? num(stats.sessions, lang) : null],
            ['end.last', last ? <a className="tlink" href={tx(last.tx)} target="_blank" rel="noreferrer">{usdc(last.args.amount ?? last.args.paidDelta, lang)}</a> : stats ? t('end.none') : null],
          ] as [TKey, React.ReactNode][]).map(([k, v], j) => (
            <div className="row" key={k} style={{ ['--j' as string]: j }}><dt className="lbl">{t(k)}</dt><dd className="mono tnum">{v ?? t('state.loading')}</dd></div>
          ))}
        </dl>
        {/* the proof first, then the call and the three actions close the page */}
        <div className="end-hd">
          <Title k="end.title" />
          <div className="ctas">
            <a className="btn btn-main" href={networkFor('use')} data-slot="USE"><span>{t('cta.use')}</span></a>
            <a className="btn btn-line" href={networkFor('rent')} data-slot="RENT"><span>{t('cta.rent')}</span></a>
            <a className="btn btn-line" href={networkFor('publish')} data-slot="PUBLISH"><span>{t('cta.publish')}</span></a>
          </div>
          {/* the replayed demo, the same live call as on the first screen */}
          <a className="tlink hero-demo hero-live end-demo" href={link.demo}><svg className="hero-ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.6" className="hero-ic-ring" /><path d="M8.2 6.6 L13.8 10 L8.2 13.4 Z" className="hero-ic-play" /></svg><span>{t('end.demo')}</span></a>
        </div>
      </div>
    </section>
  )
}

export { Footer } from '../ui/Footer'
