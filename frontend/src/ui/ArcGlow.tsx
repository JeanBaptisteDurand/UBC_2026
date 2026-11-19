// "MACHINES" and "MARKET" in glowing Arc blue. A light effect set on real text (the DOM keeps the whole sentence,
// read by screen readers):
// - the filament: an SVG filter per word. The body of each letter takes the kit navy (--arc-navy) on its edges,
//   the core of the stroke (the letter eroded then softened) a light electric blue, almost white at the centre; a very
//   low blue halo barely overflows. The radii follow the text size (measured on every size change): the core stays
//   in the middle of the stroke from phone to large screen. The filter is computed once, then the image is reused;
// - the crackle: a light canvas per word, where small sparks are born on the letters themselves (glyph mask
//   rendered once with the same font) and rise gently while twinkling, then fade out. About thirty
//   sparks per word, drawn only while the hero is on screen, on the single clock (clock.ts). With
//   reduced motion, the filament alone, without sparks.
import { useEffect, useId, useRef } from 'react'
import { onTick, scrollY, REDUCED } from '../clock'

/** Sparks are turned off, in the film and in the page alike: particles now move only with the scroll. The filament and
 *  the title ignition stay; no spark canvas is mounted, no glyph mask is read (getImageData), nothing runs every
 *  frame. */
const SPARKS = false

/** The filter of a word: its radii follow the thickness of its stroke (text size and weight), set by tune().
 *  For the headline (full), the stroke stays solid: electric blue covers the whole letter (no erosion
 *  hollowing it), light blue then the almost white core add up in the middle of the stroke, and the kit navy only
 *  lives in the halo, around it. Section titles keep their filament */
function Filter({ id, full = false }: { id: string; full?: boolean }) {
  if (full) return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }} focusable="false">
      <filter id={id} x="-25%" y="-70%" width="150%" height="240%" colorInterpolationFilters="sRGB">
        {/* the body: the whole letter, electric blue */}
        <feFlood style={{ floodColor: 'var(--arc-elec)' }} result="blueC" />
        <feComposite in="blueC" in2="SourceAlpha" operator="in" result="blue" />
        {/* the light blue: the stroke without its rim, softened (the rim stays electric blue, never empty) */}
        <feMorphology in="SourceAlpha" operator="erode" radius="1" result="e1" data-k="0.14" />
        <feGaussianBlur in="e1" stdDeviation="1" result="b1" data-k="0.16" />
        <feComposite in="b1" in2="SourceAlpha" operator="in" result="m1" />
        <feFlood style={{ floodColor: 'var(--arc-light)' }} result="lightC" />
        <feComposite in="lightC" in2="m1" operator="in" result="light" />
        {/* the core: the middle of the stroke, almost white */}
        <feMorphology in="SourceAlpha" operator="erode" radius="2" result="e2" data-k="0.3" />
        <feGaussianBlur in="e2" stdDeviation="1" result="b2" data-k="0.18" />
        <feComposite in="b2" in2="SourceAlpha" operator="in" result="m2" />
        <feFlood style={{ floodColor: 'var(--arc-core)' }} result="hotC" />
        <feComposite in="hotC" in2="m2" operator="in" result="hot" />
        {/* the overflowing light: a near blue halo, a wide halo ending in navy */}
        <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="h0" data-k="0.7" />
        <feFlood style={{ floodColor: 'var(--arc-halo)', floodOpacity: 0.55 }} result="haloC" />
        <feComposite in="haloC" in2="h0" operator="in" result="halo" />
        <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="h1" data-k="1.5" />
        <feFlood style={{ floodColor: 'var(--arc-halo2)', floodOpacity: 0.26 }} result="halo2C" />
        <feComposite in="halo2C" in2="h1" operator="in" result="halo2" />
        <feGaussianBlur in="SourceAlpha" stdDeviation="20" result="h2" data-k="2.6" />
        <feFlood style={{ floodColor: 'var(--arc-navy)', floodOpacity: 0.5 }} result="navyC" />
        <feComposite in="navyC" in2="h2" operator="in" result="navy" />
        <feMerge><feMergeNode in="navy" /><feMergeNode in="halo2" /><feMergeNode in="halo" /><feMergeNode in="blue" /><feMergeNode in="light" /><feMergeNode in="hot" /></feMerge>
      </filter>
    </svg>
  )
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }} focusable="false">
      <filter id={id} x="-20%" y="-40%" width="140%" height="180%" colorInterpolationFilters="sRGB">
        {/* the body: kit navy, at the edge of the letters */}
        <feFlood style={{ floodColor: 'var(--arc-navy)' }} result="navyC" />
        <feComposite in="navyC" in2="SourceAlpha" operator="in" result="navy" />
        {/* the electric blue: almost the whole letter, barely eroded and softened (navy only stays at the edge) */}
        <feMorphology in="SourceAlpha" operator="erode" radius="1" result="e1" data-k="0.12" />
        <feGaussianBlur in="e1" stdDeviation="1" result="b1" data-k="0.16" />
        <feComposite in="b1" in2="SourceAlpha" operator="in" result="m1" />
        <feFlood style={{ floodColor: 'var(--arc-elec)' }} result="blueC" />
        <feComposite in="blueC" in2="m1" operator="in" result="blue" />
        {/* the core: the middle of the stroke, almost white glacier blue */}
        <feMorphology in="SourceAlpha" operator="erode" radius="2" result="e2" data-k="0.26" />
        <feGaussianBlur in="e2" stdDeviation="1" result="b2" data-k="0.2" />
        <feComposite in="b2" in2="SourceAlpha" operator="in" result="m2" />
        <feFlood style={{ floodColor: 'var(--arc-core)' }} result="hotC" />
        <feComposite in="hotC" in2="m2" operator="in" result="hot" />
        {/* the light overflowing into the air: a near halo and a wide halo, low */}
        <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="h0" data-k="0.8" />
        <feFlood style={{ floodColor: 'var(--arc-halo)', floodOpacity: 0.5 }} result="haloC" />
        <feComposite in="haloC" in2="h0" operator="in" result="halo" />
        <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="h1" data-k="2.6" />
        <feFlood style={{ floodColor: 'var(--arc-halo2)', floodOpacity: 0.22 }} result="halo2C" />
        <feComposite in="halo2C" in2="h1" operator="in" result="halo2" />
        <feMerge><feMergeNode in="halo2" /><feMergeNode in="halo" /><feMergeNode in="navy" /><feMergeNode in="blue" /><feMergeNode in="hot" /></feMerge>
      </filter>
    </svg>
  )
}

/** Sets the filter radii from the stroke thickness (Montserrat: 11.5 % of the size at 500, 7.5 % at 300) */
// Section titles (compact) keep the weight of the white title (electric blue goes almost to the
// edge, navy is only a thin rim) and a short glow that fits in the copy margin (0.3 em): it no longer
// overflows onto the rule or the state label that follow
const COMPACT: Record<string, number> = { e1: 0.05, b1: 0.1, h0: 0.5, h1: 1.1 }
function tune(id: string, fontPx: number, weight: number, compact = false) {
  const f = document.getElementById(id); if (!f) return
  const stroke = fontPx * (0.075 + (Math.min(800, Math.max(300, weight)) - 300) * 0.0002)
  f.querySelectorAll<SVGElement>('[data-k]').forEach((n) => {
    const r = n.getAttribute('result') ?? ''
    const k = compact && r in COMPACT ? COMPACT[r] : Number(n.dataset.k)
    const v = Math.max(0.3, Math.round(k * stroke * 100) / 100).toString()
    if (n.tagName === 'feMorphology') n.setAttribute('radius', v); else n.setAttribute('stdDeviation', v)
  })
}

interface Spark { x: number; y: number; vx: number; vy: number; age: number; life: number; r: number; ph: number }
const N_MAX = 34

/** A glowing word, with its spark canvas */
export function ArcWord({ children }: { children: string }) {
  const host = useRef<HTMLSpanElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const fid = 'arc-inc-' + useId().replace(/[^a-zA-Z0-9]/g, '')
  useEffect(() => {
    const el = host.current, c = cv.current ?? document.createElement('canvas'); if (!el) return
    const g = c.getContext('2d')!
    let pts: Float32Array = new Float32Array(0) // emission points on the glyphs (x, y in canvas CSS px)
    let W = 0, H = 0, dpr = 1, padX = 0, padY = 0
    const sparks: Spark[] = []
    const measure = () => {
      const cs = getComputedStyle(el)
      const fs = parseFloat(cs.fontSize) || 60
      tune(fid, fs, parseFloat(cs.fontWeight) || 400)
      if (!SPARKS) return
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return // hidden title (column removed during the demo): nothing to measure
      padX = Math.round(fs * 0.25); padY = Math.round(fs * 0.9)
      W = Math.ceil(r.width + 2 * padX); H = Math.ceil(r.height + padY + fs * 0.2)
      dpr = Math.min(2, devicePixelRatio || 1)
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
      c.style.width = `${W}px`; c.style.height = `${H}px`; c.style.left = `${-padX}px`; c.style.top = `${-padY}px`
      // glyph mask: the word rendered once with the same font, points taken in the upper half of the letters
      const m = document.createElement('canvas'); const mw = Math.ceil(r.width), mh = Math.ceil(r.height)
      m.width = mw; m.height = mh
      const mg = m.getContext('2d', { willReadFrequently: true })!
      mg.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`
      mg.textBaseline = 'alphabetic'
      ;(mg as unknown as { letterSpacing: string }).letterSpacing = cs.letterSpacing
      const tm = mg.measureText(children.toUpperCase())
      const base = (mh + tm.actualBoundingBoxAscent - tm.actualBoundingBoxDescent) / 2
      mg.fillStyle = 'white'; mg.fillText(children.toUpperCase(), 0, base)
      const d = mg.getImageData(0, 0, mw, mh).data
      const out: number[] = []
      for (let y = 0; y < mh; y += 2) for (let x = 0; x < mw; x += 2) {
        if (d[(y * mw + x) * 4 + 3] < 128) continue
        // a letter crackles mostly from the top: keep the pixels whose upper neighbour is empty (the upper
// edge of the strokes), and a few from the inside
        const above = y >= 3 ? d[((y - 3) * mw + x) * 4 + 3] : 0
        if (above < 128 || (x * 7 + y * 13) % 23 === 0) out.push(x + padX, y + padY)
      }
      pts = new Float32Array(out)
    }
    let ok = false
    const go = () => { measure(); ok = true }
    document.fonts.ready.then(go)
    // measure only if the size really changed (to the pixel): the observer fired during the scene animation
// and re-measuring (canvas, getImageData) cost 50 to 200 ms frames
    let lastSz = ''
    const ro = new ResizeObserver((es) => { const r = es[0]?.contentRect; const sz = r ? `${Math.round(r.width)}x${Math.round(r.height)}` : ''; if (sz === lastSz) return; const first = !lastSz; lastSz = sz; if (ok && !first) measure() }); ro.observe(el)
    let acc = 0, was = true
    const off = onTick((_t, dt) => {
      if (!SPARKS || !ok || REDUCED || !pts.length) return
      const on = scrollY() < innerHeight * 1.05 && !document.hidden
      if (!on) { if (was) { g.clearRect(0, 0, c.width, c.height); sparks.length = 0; was = false } return }
      was = true
      // birth: about a dozen per second, never more than N_MAX in flight
      acc += dt * 13
      while (acc >= 1) {
        acc -= 1
        if (sparks.length >= N_MAX) continue
        const k = (Math.random() * (pts.length / 2)) | 0
        sparks.push({ x: pts[k * 2], y: pts[k * 2 + 1], vx: (Math.random() - 0.5) * 6, vy: -(7 + Math.random() * 14), age: 0, life: 1.1 + Math.random() * 1.6, r: 0.5 + Math.random() * 0.9, ph: Math.random() * 6.28 })
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, W, H)
      g.globalCompositeOperation = 'lighter'
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.age += dt
        if (s.age >= s.life) { sparks[i] = sparks[sparks.length - 1]; sparks.pop(); continue }
        // rise that slows down, a small sinuous drift (the hot air above the filament)
        s.vy *= 1 - 0.35 * dt
        s.x += (s.vx + 3 * Math.sin(s.age * 3.1 + s.ph)) * dt; s.y += s.vy * dt
        const u = s.age / s.life
        const flick = 0.65 + 0.35 * Math.sin(s.age * 23 + s.ph * 3)
        const a = Math.min(1, u * 6) * (1 - u) * (1 - u) * flick
        // bluish white core, electric blue fringe
        g.fillStyle = `rgba(70,120,255,${(a * 0.35).toFixed(3)})`
        g.beginPath(); g.arc(s.x, s.y, s.r * 2.6, 0, 6.2832); g.fill()
        g.fillStyle = `rgba(214,232,255,${a.toFixed(3)})`
        g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.2832); g.fill()
      }
      g.globalCompositeOperation = 'source-over'
    })
    return () => { off(); ro.disconnect() }
  }, [children, fid])
  return (
    <span className="arc-w" ref={host}>
      <span className="arc-w-t" style={{ filter: `url(#${fid})` }}>{children}</span>
      <Filter id={fid} full />
      {SPARKS ? <canvas ref={cv} className="arc-w-c" aria-hidden="true" /> : null}
    </span>
  )
}

/** Splits a sentence and makes the words of the list glow (compared case-insensitively) */
export function withArcWords(text: string, words: string[]) {
  const lw = words.map((w) => w.toLowerCase())
  return text.split(/(\s+)/).map((tok, i) => {
    const m = tok.match(/^([\p{L}]+)(.*)$/u)
    // punctuation stays attached to the word (at 768 px, the comma of "MACHINES," wrapped alone to the line start)
    if (m && lw.includes(m[1].toLowerCase())) return <span key={i} className="nowrap"><ArcWord>{m[1]}</ArcWord>{m[2]}</span>
    return <span key={i}>{tok}</span>
  })
}

// ---- section title ignition ----
// Only the accented part of the title (marked {...} in the i18n key) ignites; the rest stays white, weight 600.
// The ignition is born in the stroke and radiates (no front rising like a fill): each accented word
// carries three filtered copies, rasterised once, of which only the opacity changes (compositor layers):
// - the body: the whole letter turns electric blue, light blue then the almost white core in the middle of the stroke;
//   slow then fast rise (power curve), with two misfires at the start, like a filament catching;
// - the near halo: born when the stroke heats up, rises fast, then drops a little (bloom);
// - the wide halo: later and slower, it ends in the kit navy.
// Three radii, three clocks: the glow leaves the letter and spreads around it. Words do not light up from
// left to right: each has a small delay of its own (0 to 0.2 of the gesture), never a sweep. The gesture follows the
// scroll (the title position on screen), but never runs faster than 1.5 s when igniting (0.6 s when fading): a fast
// scroll still sees it play. The headline sparks are born on the lit words. Reduced motion: lit,
// without sparks.
const IG_PAD = 0.6 // em around each copy (the wide halo glow is not clipped by the filter box)
function IgniteFilters({ id }: { id: string }) {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }} focusable="false">
      <filter id={`${id}-b`} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
        <feFlood style={{ floodColor: 'var(--arc-elec)' }} result="blueC" />
        <feComposite in="blueC" in2="SourceAlpha" operator="in" result="blue" />
        <feMorphology in="SourceAlpha" operator="erode" radius="1" result="ie1" data-k="0.14" />
        <feGaussianBlur in="ie1" stdDeviation="1" result="ib1" data-k="0.16" />
        <feComposite in="ib1" in2="SourceAlpha" operator="in" result="m1" />
        <feFlood style={{ floodColor: 'var(--arc-light)' }} result="lightC" />
        <feComposite in="lightC" in2="m1" operator="in" result="light" />
        <feMorphology in="SourceAlpha" operator="erode" radius="2" result="ie2" data-k="0.3" />
        <feGaussianBlur in="ie2" stdDeviation="1" result="ib2" data-k="0.18" />
        <feComposite in="ib2" in2="SourceAlpha" operator="in" result="m2" />
        <feFlood style={{ floodColor: 'var(--arc-core)' }} result="hotC" />
        <feComposite in="hotC" in2="m2" operator="in" result="hot" />
        {/* the glow that barely leaves the stroke (within the thickness of the glass) */}
        <feGaussianBlur in="SourceAlpha" stdDeviation="1" result="it0" data-k="0.22" />
        <feFlood style={{ floodColor: 'var(--arc-halo)', floodOpacity: 0.7 }} result="tC" />
        <feComposite in="tC" in2="it0" operator="in" result="tight" />
        <feMerge><feMergeNode in="tight" /><feMergeNode in="blue" /><feMergeNode in="light" /><feMergeNode in="hot" /></feMerge>
      </filter>
      <filter id={`${id}-n`} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="in0" data-k="0.55" />
        <feFlood style={{ floodColor: 'var(--arc-halo)', floodOpacity: 0.55 }} result="nC" />
        <feComposite in="nC" in2="in0" operator="in" />
      </filter>
      <filter id={`${id}-f`} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceAlpha" stdDeviation="8" result="if1" data-k="1.25" />
        <feFlood style={{ floodColor: 'var(--arc-halo2)', floodOpacity: 0.26 }} result="f1C" />
        <feComposite in="f1C" in2="if1" operator="in" result="f1" />
        <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="if2" data-k="2.3" />
        <feFlood style={{ floodColor: 'var(--arc-navy)', floodOpacity: 0.45 }} result="f2C" />
        <feComposite in="f2C" in2="if2" operator="in" result="f2" />
        <feMerge><feMergeNode in="f2" /><feMergeNode in="f1" /></feMerge>
      </filter>
    </svg>
  )
}

/** Splits a marked key: "Use {a service}." gives [Use ][a service][.] */
export function splitAcc(s: string): { s: string; acc: boolean }[] {
  const out: { s: string; acc: boolean }[] = []
  const re = /\{([^}]*)\}/g; let i = 0; let m: RegExpExecArray | null
  while ((m = re.exec(s))) { if (m.index > i) out.push({ s: s.slice(i, m.index), acc: false }); out.push({ s: m[1], acc: true }); i = m.index + m[0].length }
  if (i < s.length) out.push({ s: s.slice(i), acc: false })
  return out
}
export const plainAcc = (s: string) => s.replace(/[{}]/g, '')

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2))
/** The three clocks of a word, for its progress w (0 off, 1 lit) */
function curves(w: number): [number, number, number] {
  // the body: slow then sharp rise (power curve), two misfires at the start
  let b = Math.pow(ss(0.04, 0.62, w), 1.7)
  b *= 1 - 0.5 * bump(w, 0.17, 0.028) - 0.35 * bump(w, 0.27, 0.022)
  // the near halo: born when the stroke heats up, blooms, then drops a little
  const x = (w - 0.2) / 0.48
  const n = w <= 0.2 ? 0 : x < 1 ? 1 - Math.pow(1 - x, 3) : 1 - 0.3 * ss(0.68, 1, w)
  // the wide halo: later, slower
  const f = w <= 0.34 ? 0 : 1 - Math.pow(1 - (w - 0.34) / 0.66, 3)
  return [Math.max(0, Math.min(1, b)), Math.max(0, Math.min(1, n)), Math.max(0, Math.min(1, f))]
}

/** A section title: the white text and its accented words that ignite */
export function ArcIgnite({ text }: { text: string }) {
  const host = useRef<HTMLSpanElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const fid = 'arc-ig-' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const parts = splitAcc(text)
  // the accented words, and the punctuation following the last accented word attached to it (never alone on a new line)
  const nodes: React.ReactNode[] = []
  let wi = 0
  parts.forEach((p, pi) => {
    if (!p.acc) {
      const prevAcc = pi > 0 && parts[pi - 1].acc
      const m = prevAcc ? p.s.match(/^([.,!?:]+)(.*)$/s) : null
      if (m && nodes.length) { const last = nodes.pop(); nodes.push(<span className="nowrap" key={`p${pi}`} data-front-free>{last}{m[1]}</span>); if (m[2]) nodes.push(m[2]) } else nodes.push(p.s)
      return
    }
    p.s.split(/(\s+)/).forEach((tok, ti) => {
      if (!tok) return
      if (/^\s+$/.test(tok)) { nodes.push(tok); return }
      const i = wi++
      nodes.push(
        // the words of one title are not alignment edges: data-front-free
        <span className="ig" key={`w${pi}-${ti}`} data-i={i} data-front-free>
          <span className="ig-t">{tok}</span>
          <span className="ig-l" aria-hidden="true" style={{ filter: `url(#${fid}-f)` }}>{tok}</span>
          <span className="ig-l" aria-hidden="true" style={{ filter: `url(#${fid}-n)` }}>{tok}</span>
          <span className="ig-l" aria-hidden="true" style={{ filter: `url(#${fid}-b)` }}>{tok}</span>
        </span>,
      )
    })
  })
  useEffect(() => {
    const el = host.current, c = cv.current ?? document.createElement('canvas'); if (!el) return
    const g = c.getContext('2d')!
    const ttl = el.closest<HTMLElement>('.ttl')
    const words = [...el.querySelectorAll<HTMLElement>('.ig')].map((w, i) => {
      // a delay of its own for each word (shuffled, never left to right)
      const d = (((i * 7919 + 13) % 11) / 10) * 0.2
      const ls = [...w.querySelectorAll<HTMLElement>('.ig-l')]
      return { base: w.querySelector<HTMLElement>('.ig-t')!, far: ls[0], near: ls[1], body: ls[2], d, last: [-1, -1, -1, -1], lit: 0, wc: [0, 0, 0], lt: [0, 0, 0] }
    })
    let pts = new Float32Array(0), W = 0, Hc = 0, dpr = 1, padX = 0, padY = 0, ok = false, vis = false
    const sparks: Spark[] = []
    const measure = () => {
      const cs = getComputedStyle(el)
      const fs = parseFloat(cs.fontSize) || 40, wt = parseFloat(cs.fontWeight) || 600
      for (const s of ['b', 'n', 'f']) tune(`${fid}-${s}`, fs, wt)
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return // hidden title: nothing to measure
      if (!SPARKS) { ok = true; return }
      padX = Math.round(fs * 0.25); padY = Math.round(fs * 0.9)
      W = Math.ceil(r.width + 2 * padX); Hc = Math.ceil(r.height + padY + fs * 0.2)
      dpr = Math.min(2, devicePixelRatio || 1)
      c.width = Math.round(W * dpr); c.height = Math.round(Hc * dpr)
      c.style.width = `${W}px`; c.style.height = `${Hc}px`; c.style.left = `${-padX}px`; c.style.top = `${-padY}px`
      // emission points: the accented words only, rendered in place, top edge of the strokes
      const mw = Math.max(1, Math.ceil(r.width)), mh = Math.max(1, Math.ceil(r.height))
      const m = document.createElement('canvas'); m.width = mw; m.height = mh
      const mg = m.getContext('2d', { willReadFrequently: true })!
      mg.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`
      ;(mg as unknown as { letterSpacing: string }).letterSpacing = cs.letterSpacing
      mg.fillStyle = 'white'; mg.textBaseline = 'alphabetic'
      for (const w of words) {
        const wr = w.base.getBoundingClientRect(), tm = mg.measureText(w.base.textContent ?? '')
        mg.fillText(w.base.textContent ?? '', wr.left - r.left, wr.top - r.top + (wr.height + tm.actualBoundingBoxAscent - tm.actualBoundingBoxDescent) / 2)
      }
      const d = mg.getImageData(0, 0, mw, mh).data
      const out: number[] = []
      for (let y = 0; y < mh; y += 2) for (let x = 0; x < mw; x += 2) {
        if (d[(y * mw + x) * 4 + 3] < 128) continue
        const above = y >= 3 ? d[((y - 3) * mw + x) * 4 + 3] : 0
        if (above < 128 || (x * 7 + y * 13) % 23 === 0) out.push(x + padX, y + padY)
      }
      pts = new Float32Array(out)
      ok = true
    }
    document.fonts.ready.then(measure)
    // measure only if the size really changed (to the pixel): the observer fired during the scene animation
// and re-measuring (canvas, getImageData) cost 50 to 200 ms frames
    let lastSz = ''
    const ro = new ResizeObserver((es) => { const r = es[0]?.contentRect; const sz = r ? `${Math.round(r.width)}x${Math.round(r.height)}` : ''; if (sz === lastSz) return; const first = !lastSz; lastSz = sz; if (ok && !first) measure() }); ro.observe(el)
    const io = new IntersectionObserver((es) => { vis = es.some((e) => e.isIntersecting) }, { rootMargin: '10% 0px 10% 0px' })
    io.observe(el)
    let u = REDUCED ? 1 : 0, tIn = -1, lit = false, acc = 0, drawn = false, first = true
    // the glow blooms (halos open from 90 to 100 %, the body from 99 to 100 %) while it heats up,
// never a plain opacity
    // A filtered copy is a compositor layer (will-change) only while it moves; once settled, it is painted with its
    // title. Otherwise the 3 copies per word stayed as many render surfaces (up to 53 filters at once on a phone): tile
    // memory was exceeded and a frame was dropped on every gesture
    const put = (e: HTMLElement, k: number, v: number, w: (typeof words)[number]) => { if (Math.abs(w.last[k] - v) > 0.003 || (v === 0 && w.last[k] !== 0) || (v === 1 && w.last[k] !== 1)) { w.last[k] = v; if (k < 3) { if (!w.wc[k]) { w.wc[k] = 1; e.style.willChange = 'opacity, transform' } w.lt[k] = performance.now() } e.style.opacity = v.toFixed(3); if (k < 3) e.style.transform = `scale(${(k === 0 ? 0.99 + 0.01 * v : 0.9 + 0.1 * v).toFixed(4)})` } }
    const settle = (w: (typeof words)[number]) => { const t = performance.now(); for (let k = 0; k < 3; k++) if (w.wc[k] && t - w.lt[k] > 350) { w.wc[k] = 0; (k === 0 ? w.body : k === 1 ? w.near : w.far).style.willChange = 'auto' } }
    const off = onTick((_t, dt) => {
      if (!ok) return
      if (!vis && !first) { if (drawn) { g.clearRect(0, 0, c.width, c.height); sparks.length = 0; drawn = false } for (const w of words) if (w.wc[0] || w.wc[1] || w.wc[2]) settle(w); return }
      first = false
      // The titles of the state sections are sticky: their position is read on screen
      const top = el.getBoundingClientRect().top, H = innerHeight
      let f = REDUCED ? 1 : Math.min(1, Math.max(0, (0.86 * H - top) / (0.3 * H)))
      // the title rises white in its lettering mask (rule then title, 120 + 420 ms), then ignites
      if (!REDUCED && ttl) {
        if (!ttl.classList.contains('in')) tIn = -1
        else if (tIn < 0) tIn = performance.now()
        if (tIn < 0 || performance.now() - tIn < 580) f = 0
      }
      const du = Math.min(dt, 0.05)
      u = f > u ? Math.min(f, u + du / 1.5) : Math.max(f, u - du / 0.6)
      const on = u > 0.001
      if (ttl && on !== lit) { lit = on; ttl.dataset.lit = on ? '1' : '' }
      let heat = 0
      for (const w of words) {
        const wp = Math.min(1, Math.max(0, (u * 1.2 - w.d) / 1))
        const [b, n, fa] = curves(wp)
        put(w.body, 0, b, w); put(w.near, 1, n, w); put(w.far, 2, fa, w); put(w.base, 3, 1 - b, w); settle(w)
        w.lit = b; heat += b
      }
      heat /= Math.max(1, words.length)
      if (!SPARKS || REDUCED || document.hidden) return
      if (heat > 0.5) {
        acc += dt * 11 * heat
        while (acc >= 1) {
          acc -= 1
          if (sparks.length >= N_MAX || !pts.length) continue
          const k = (Math.random() * (pts.length / 2)) | 0
          sparks.push({ x: pts[k * 2], y: pts[k * 2 + 1], vx: (Math.random() - 0.5) * 6, vy: -(7 + Math.random() * 14), age: 0, life: 1.1 + Math.random() * 1.6, r: 0.5 + Math.random() * 0.8, ph: Math.random() * 6.28 })
        }
      }
      if (!sparks.length && !drawn) return
      drawn = sparks.length > 0
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, W, Hc)
      g.globalCompositeOperation = 'lighter'
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.age += dt
        if (s.age >= s.life) { sparks[i] = sparks[sparks.length - 1]; sparks.pop(); continue }
        s.vy *= 1 - 0.35 * dt
        s.x += (s.vx + 3 * Math.sin(s.age * 3.1 + s.ph)) * dt; s.y += s.vy * dt
        const q = s.age / s.life
        const a = Math.min(1, q * 6) * (1 - q) * (1 - q) * (0.65 + 0.35 * Math.sin(s.age * 23 + s.ph * 3))
        g.fillStyle = `rgba(70,120,255,${(a * 0.35).toFixed(3)})`
        g.beginPath(); g.arc(s.x, s.y, s.r * 2.6, 0, 6.2832); g.fill()
        g.fillStyle = `rgba(214,232,255,${a.toFixed(3)})`
        g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.2832); g.fill()
      }
      g.globalCompositeOperation = 'source-over'
    })
    return () => { off(); ro.disconnect(); io.disconnect() }
  }, [text, fid])
  return (
    <span className="ig-host" ref={host} style={{ ['--ig-pad' as string]: `${IG_PAD}em` }}>
      {nodes}
      <IgniteFilters id={fid} />
      {SPARKS ? <canvas ref={cv} className="arc-w-c" aria-hidden="true" /> : null}
    </span>
  )
}
