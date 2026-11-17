// Video landing: the live layer laid over the film. For each sled, two HTML elements in the plane of its facade
// (matrix3d computed from the projection of the displayed frame): the plate (service name in Fragment Mono capitals,
// status word, unit) and the LED (light slit and the light spilling onto the surrounding lacquer). States and gestures
// are those of the real-time scene (stage.ts); colour and intensity are played here.
// The layer follows the frame actually shown (film.shown); intensity is set as opacity on the composited element (no
// paint); off-screen plates use visibility; no object is created per frame; titles are cached; layouts are read on
// resize only.
// The whole layer adds to the image (mix-blend-mode: plus-lighter): the light lights the film, it does not cover it.
import { world } from '../world'
import { REDUCED } from '../clock'
import { ORDER, type SecId } from '../story'
import { SLOTS, NSLOTS, FACE, productLabel, type Sled } from '../data/wall'
import { getLive } from '../data/live'
import { t, getLang } from '../i18n'
import { film, onFilm, projInto, faceInto, zoomNow, zoomAt, CAL } from './film'

// Rendered LED colours (sRGB), measured on the real-time scene (A/B sheet)
const COL = { green: [70, 255, 128], amber: [255, 122, 36], red: [255, 56, 46], white: [196, 206, 222] } as const
type Rgb = readonly [number, number, number]

// ---- Facade geometry (m, sled frame: x at the centre, y from the base) ----
const PX = 0.0005                     // 1 CSS px of the layer = 0.5 mm
const PL = { x0: FACE.PLATE[0], x1: FACE.PLATE[1], y0: FACE.PLATE[2], y1: FACE.PLATE[3] }
const PW = PL.x1 - PL.x0 - 0.004, PH = PL.y1 - PL.y0 - 0.003
const PCX = (PL.x0 + PL.x1) / 2, PCY = (PL.y0 + PL.y1) / 2
const LD = { x: (FACE.LED[0] + FACE.LED[1]) / 2, y: (FACE.LED[2] + FACE.LED[3]) / 2, w: FACE.LED[1] - FACE.LED[0], h: FACE.LED[3] - FACE.LED[2] }
const GLOW = { w: 0.07, h: 0.13 }     // LED light on the lacquer: 70 x 130 mm around the slit
// The scene atlas (plates.ts): title band from 0.40 to 0.90 of the plate, 80 px row, size 70 at most
const CH = 80, BAND = 0.5 * PH, TITLE_W = Math.floor((0.92 * (PL.x1 - PL.x0 - 0.004) / (0.5 * (PL.y1 - PL.y0 - 0.003))) * CH) - 16

const mm = (m: number) => m / PX
const sm = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u) }
const ss = (a: number, b: number, x: number) => sm((x - a) / (b - a))

let layer: HTMLDivElement, stageEl: HTMLElement | null = null
interface El { plate: HTMLDivElement; tl: HTMLSpanElement; sub: HTMLSpanElement; u: HTMLSpanElement; led: HTMLDivElement; key: string; shown: boolean; ledShown: boolean; pm: string | null; lm: string | null; geo: number; pT: string; pC: string; pO: string; lT: string; lC: string; lO: string; hov: boolean }
const els: El[] = []
const meas = document.createElement('canvas').getContext('2d')!

/** The title as in the atlas: size 70 tightening down to 34, otherwise two lines at the size that fits (cached) */
const titles = new Map<string, { lines: string[]; px: number }>()
function fitTitle(text: string): { lines: string[]; px: number } {
  const c = titles.get(text); if (c) return c
  const font = (p: number) => `400 ${p}px "Fragment Mono", ui-monospace, monospace`
  let px = 70; meas.font = font(px)
  let res: { lines: string[]; px: number }
  while (meas.measureText(text).width > TITLE_W && px > 34) { px -= 2; meas.font = font(px) }
  if (meas.measureText(text).width <= TITLE_W) res = { lines: [text], px }
  else {
    const words = text.split(' ')
    let best: [string, string] = [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))], bk = Infinity
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ')
      const k = Math.max(meas.measureText(a).width, meas.measureText(b).width) * (/,$/.test(a) ? 0.85 : 1)
      if (k < bk) { bk = k; best = [a, b] }
    }
    px = 38; meas.font = font(px)
    while (Math.max(meas.measureText(best[0]).width, meas.measureText(best[1]).width) > TITLE_W && px > 16) { px -= 1; meas.font = font(px) }
    res = { lines: best, px }
  }
  titles.set(text, res)
  return res
}
const titleText = (s: string) => s.toUpperCase().replace(/\b0X(?=[0-9A-F])/g, '0x')
/** Wall titles computed ahead, in slices during idle time (never during a frame) */
let warmV = -1
function warmTitles() {
  if (warmV === world.version) return
  warmV = world.version
  const live = getLive(), list: string[] = [titleText(t('plate.off'))]
  for (const s of world.wall.sleds) if (s?.product !== undefined) list.push(titleText(productLabel(s.product, live.products, live.bounties)))
  const idle = (f: (d: { timeRemaining: () => number }) => void) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 1000 }) : setTimeout(() => f({ timeRemaining: () => 8 }), 50))
  let i = 0
  const run = (d: { timeRemaining: () => number }) => { while (i < list.length && d.timeRemaining() > 2) fitTitle(list[i++]); if (i < list.length) idle(run) }
  idle(run)
}

export function mountLames(root: HTMLDivElement) {
  layer = root
  stageEl = root.closest('.stage')
  layer.style.setProperty('--pw', `${mm(PW)}px`); layer.style.setProperty('--ph', `${mm(PH)}px`)
  for (let i = 0; i < NSLOTS; i++) {
    const plate = document.createElement('div'); plate.className = 'lm-plate'
    plate.style.width = `${mm(PW)}px`; plate.style.height = `${mm(PH)}px`
    const tl = document.createElement('span'); tl.className = 'lm-t'
    const sub = document.createElement('span'); sub.className = 'lm-s'
    const u = document.createElement('span'); u.className = 'lm-u'
    plate.append(tl, sub, u)
    const led = document.createElement('div'); led.className = 'lm-led'
    led.style.width = `${mm(GLOW.w)}px`; led.style.height = `${mm(GLOW.h)}px`
    led.innerHTML = '<i class="lm-spill"></i><i class="lm-core"></i>'
    ;(led.lastChild as HTMLElement).style.cssText = `width:${mm(LD.w - 0.0008)}px;height:${mm(LD.h - 0.0008)}px`
    // Layers are created once; off screen they are hidden (visibility), never removed from rendering
    plate.style.visibility = 'hidden'; led.style.visibility = 'hidden'
    layer.append(led, plate)
    els.push({ plate, tl, sub, u, led, key: '', shown: false, ledShown: false, pm: null, lm: null, geo: -1, pT: '', pC: '', pO: '', lT: '', lC: '', lO: '', hov: false })
  }
  measureCatch()
  addEventListener('resize', measureCatch)
  new ResizeObserver(measureCatch).observe(document.body)
  onFilm(frame)
}

// ---- State of a sled (stage.ts: plateText, syncData and the per-section gestures) ----
const SUBK = ['plate.sub.off', 'plate.sub.green', 'plate.sub.amber', 'plate.sub.red', 'plate.sub.dim'] as const
const ST = { title: '', sub: 0, k: 0, led: 'off' as keyof typeof COL | 'off' }
function plateOf(s: Sled | undefined, amber: boolean, admitted: boolean) {
  const live = getLive()
  const name = () => productLabel(s!.product, live.products, live.bounties)
  if (s && admitted) { ST.title = name(); ST.sub = 1; ST.k = 1.9; ST.led = 'green' }
  else if (s && amber) { ST.title = name(); ST.sub = 2; ST.k = 1.4; ST.led = 'amber' }
  else if (s?.led === 'green') { ST.title = name(); ST.sub = 1; ST.k = 1.9; ST.led = 'green' }
  else if (s?.led === 'red') { ST.title = name(); ST.sub = 3; ST.k = 1.4; ST.led = 'red' }
  else if (s?.led === 'amber') { ST.title = name(); ST.sub = s.why === 'expired' ? 4 : 2; ST.k = 1.1; ST.led = 'amber' }
  else { ST.title = t('plate.off'); ST.sub = 0; ST.k = 0; ST.led = 'off' }
  return ST
}
// The failure flicker of the Invalid LED (stage.ts, PANNE)
const PANNE: [number, number][] = [[0, 1], [0.04, 0.03], [0.13, 0.03], [0.15, 1.35], [0.21, 1.1], [0.23, 0.03], [0.38, 0.03], [0.4, 0.55], [0.46, 0.5], [0.48, 0.03], [0.7, 0.03], [0.72, 1.2], [0.78, 1], [0.8, 0.12], [0.88, 0.12], [1.15, 1]]
function panne(x: number) {
  if (x <= 0 || x >= PANNE[PANNE.length - 1][0]) return 1
  let k = 1; while (PANNE[k][0] < x) k++
  const [t0, a] = PANNE[k - 1], [t1, b] = PANNE[k]
  return a + (b - a) * (x - t0) / (t1 - t0)
}
let invAt = -1
// Passes: a full one when the frame, the state or the section changes; otherwise only the animated sleds (amber of the
// replayed sled, failure flicker, payment pulse)
const anim = new Int16Array(NSLOTS), todo = new Int16Array(NSLOTS), mark = new Uint8Array(NSLOTS)
let animN = 0
// The hero headline ("OPEN MARKET."): under it, the engraving of open slots drops by half, with a fade (stage.ts)
// Rectangle in document coordinates, measured on resize only
let catchR: { left: number; right: number; top: number; bottom: number } | null = null
function measureCatch() {
  const r = document.querySelector('.catch .c2')?.getBoundingClientRect()
  const y = window.scrollY
  catchR = r ? { left: r.left, right: r.right, top: r.top + y, bottom: r.bottom + y } : null
}
// Last full pass: what triggers it, as numbers (no string per frame)
const last = { geo: -1, ver: -1, hov: -2, id: -1, gp: -1, amber: false, admit: false, refused: false, L: '', svc: -1, catchTop: -1, phase: '' }

/** CSS matrix (columns): element px (u, v) -> screen, for a facade rectangle with top-left corner (x0, y1) */
const MU = new Float64Array(3), MV = new Float64Array(3), MO = new Float64Array(3), WO = new Float64Array(3)
const r4 = (x: number) => Math.round(x * 1e4) / 1e4
function vp(out: Float64Array, c0: number, c1: number, c2: number, c3: number) {
  const v = film.cur
  out[0] = v[0] * c0 + v[4] * c1 + v[8] * c2 + v[12] * c3
  out[1] = v[1] * c0 + v[5] * c1 + v[9] * c2 + v[13] * c3
  out[2] = v[3] * c0 + v[7] * c1 + v[11] * c2 + v[15] * c3
}
function row(c: Float64Array, W2: number, H2: number, zk: number, zx: number, zy: number) {
  const s = film.s
  const x = W2 * (c[0] + c[2]) * s + film.ox * c[2], y = H2 * (c[2] - c[1]) * s + film.oy * c[2]
  c[0] = zk * x + zx * (1 - zk) * c[2]; c[1] = zk * y + zy * (1 - zk) * c[2]
}
function m3d(i: number, x0: number, y1: number, z: number): string | null {
  const m = film.man!, v = film.cur
  const isRep = i === m.replay && v[26] > 0.5
  // Face · L: columns (facade frame -> world) for u, v, and the origin
  faceInto(WO, i, x0, y1, z)
  if (isRep) {
    vp(MU, v[27] * PX, v[28] * PX, v[29] * PX, 0)
    vp(MV, -v[31] * PX, -v[32] * PX, -v[33] * PX, 0)
  } else { vp(MU, PX, 0, 0, 0); vp(MV, 0, -PX, 0, 0) }
  vp(MO, WO[0], WO[1], WO[2], 1)
  if (MO[2] <= 0.01) return null
  // clip -> film px: x' = (W/2)(x + w), y' = (H/2)(w - y); then film -> screen: ox + s x'; then the zoom toward the
  // open service (scaling around (zx, zy), in homogeneous coordinates)
  const W2 = m.filmW / 2, H2 = m.filmH / 2, z0 = zoomNow(), zk = z0 > 0 ? 1 + 0.14 * z0 : 1, [zx, zy] = zoomAt()
  row(MU, W2, H2, zk, zx, zy); row(MV, W2, H2, zk, zx, zy); row(MO, W2, H2, zk, zx, zy)
  // CSS matrix3d (columns): col0 = u, col1 = v, col2 = z (identity), col3 = origin; rows x, y, z, w
  return `matrix3d(${r4(MU[0])},${r4(MU[1])},0,${r4(MU[2])},${r4(MV[0])},${r4(MV[1])},0,${r4(MV[2])},0,0,1,0,${r4(MO[0])},${r4(MO[1])},0,${r4(MO[2])})`
}
const PC = new Float64Array(4), FW3 = new Float64Array(3)
const hide = (e: El) => { if (e.shown) { e.plate.style.visibility = 'hidden'; e.shown = false } if (e.ledShown) { e.led.style.visibility = 'hidden'; e.ledShown = false } }

if (new URLSearchParams(location.search).get('wc') === '1') document.documentElement.classList.add('wc')
let calEl: HTMLElement[] | null = null
function cal() {
  if (!calEl) {
    const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:14px;display:flex;z-index:2147483647;pointer-events:none'
    calEl = []; for (let b = 0; b < 12; b++) { const c = document.createElement('i'); c.style.cssText = 'flex:1;background:#000'; d.appendChild(c); calEl.push(c) }
    document.body.appendChild(d)
  }
  for (let b = 0; b < 12; b++) calEl[b].style.background = (film.shown >> b) & 1 ? '#fff' : '#000'
}
function frame() {
  const m = film.man; if (!m || film.shown < 0) return
  if (CAL) cal()
  const wall = world.wall
  if (warmV !== world.version) warmTitles()
  const T = world.story, k0 = Math.min(ORDER.length - 1, Math.floor(T)), id = ORDER[k0] as SecId, f = T - k0
  void f
  const inProto = id === 'protocol', inArc = id === 'arc'
  const rep = wall.replay, pA = world.sec.arc ?? 0
  const ord = (k: SecId) => ORDER.indexOf(k)
  const gateOk = world.gate.phase === 'ok'
  const amberOn = rep >= 0 && T >= ord('publish') - 0.45 && (T < ord('arc') || (inArc && (pA < 0.7 || !gateOk)))
  const admitOn = rep >= 0 && !amberOn && gateOk && ((inArc && pA >= 0.7) || T > ord('arc')) && wall.sleds[rep]?.led !== 'green'
  const refused = inArc && pA >= 0.7 && world.gate.phase === 'refused'
  // The amber state is set on .stage (not on <html>, so the whole page style is not recalculated)
  if (stageEl) { const v = amberOn ? '1' : '0'; if (stageEl.dataset.amber !== v) stageEl.dataset.amber = v }
  const now = performance.now() / 1000
  const gp = world.sec[id] ?? 0
  const bump = (a: number, b: number) => { const u = (gp - a) / (b - a); return u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0 }
  const gUse = id === 'use' ? bump(0.12, 0.3) : 0
  const gRent = id === 'rent' ? sm((gp - 0.08) / 0.22) : 0
  const gPub = id === 'publish' ? bump(0.12, 0.3) : 0
  if (id === 'invalid' && gp >= 0.25 && gp < 0.9) { if (invAt < 0) invAt = now } else if (id !== 'invalid' || gp < 0.12) invAt = -1
  const ratee = id === 'invalid' && invAt >= 0 && !REDUCED ? panne(now - invAt) : 1
  const hov = world.svc.slot >= 0 ? world.svc.slot : world.lock >= 0 ? world.lock : world.hover
  const focus = hov >= 0 ? hov : inProto || inArc ? rep : id === 'use' ? wall.ex.use : id === 'rent' ? wall.ex.rent : id === 'publish' ? wall.ex.publish : id === 'invalid' ? wall.ex.invalid : -1
  const dimOn = world.svc.u > 0 ? 0.3 * world.svc.u : id !== 'hero' && id !== 'end' && focus >= 0 ? 0.22 : hov >= 0 ? 0.12 : 0
  if (world.pulses.length) world.pulses = world.pulses.filter((p) => now - p.at < 0.3)
  const ov = film.cur
  const L = getLang()
  const sy0 = window.scrollY
  const cR = sy0 < innerHeight * 1.5 ? catchR : null

  const gpR = Math.round(gp * 1000), svcR = Math.round(world.svc.u * 1000), cTop = cR ? cR.top : -1
  const full = last.geo !== film.geo || last.ver !== world.version || last.hov !== hov || last.id !== k0 || last.gp !== gpR || last.amber !== amberOn || last.admit !== admitOn
    || last.refused !== refused || last.L !== L || last.svc !== svcR || last.catchTop !== cTop || last.phase !== world.gate.phase
  let n = 0
  if (full) {
    last.geo = film.geo; last.ver = world.version; last.hov = hov; last.id = k0; last.gp = gpR; last.amber = amberOn; last.admit = admitOn
    last.refused = refused; last.L = L; last.svc = svcR; last.catchTop = cTop; last.phase = world.gate.phase
    animN = 0
    for (let i = 0; i < NSLOTS; i++) todo[n++] = i
  } else {
    mark.fill(0)
    for (let j = 0; j < animN; j++) { const i = anim[j]; if (!mark[i]) { mark[i] = 1; todo[n++] = i } }
    for (const p of world.pulses) if (!mark[p.slot]) { mark[p.slot] = 1; todo[n++] = p.slot }
  }
  for (let j = 0; j < n; j++) {
    const i = todo[j]
    const e = els[i], s = wall.sleds[i]
    const r = world.rects.get(i)
    const vis = film.vis[i]
    const on = !!r && r.vis !== false && vis >= 5 && r.x + r.w > -40 && r.x < innerWidth + 40 && r.y + r.h > -40 && r.y < innerHeight + 40
    // The fade of the text column (the overlay baked into the film) also covers the layer
    let veil = 0
    if (on) {
      faceInto(FW3, i, PCX, PCY, 0); projInto(PC, FW3[0], FW3[1], FW3[2])
      const ux = PC[0] / m.filmW, uy = PC[1] / m.filmH
      veil = ov[21] > 0.5 ? ss(ov[19] - 0.2, ov[19] + 0.05, uy) : 1 - ss(ov[19] - 0.085, ov[19] + 0.004, ux)
      veil *= ov[20]
    }
    const air = film.fog[i] / 255
    const dim = i === focus || (id === 'invalid' && i === wall.ex.inactive) ? 0 : dimOn
    const fade = Math.max(0, 1 - dim * 0.7) * air * (1 - veil) * (vis >= 6 ? 1 : 0.6)
    if (!on || fade < 0.01) { hide(e); continue }
    const amber = amberOn && i === rep
    const st = plateOf(s?.led !== 'off' || amber || (admitOn && i === rep) ? s : undefined, amber, admitOn && i === rep)
    // ---- The LED: colour and intensity (w, the scene scale: 5.2 for full green) ----
    let col: Rgb | null = null, w = 0
    if (amber || (s && s.led !== 'off')) {
      col = COL[amber ? 'amber' : (s!.led as 'green')]
      w = amber ? (REDUCED ? 5 : 3.4 + 1.7 * (0.5 + 0.5 * Math.cos(now / 2.4 * Math.PI * 2))) : s!.led === 'red' ? 4.0 : s!.led === 'amber' ? 3.0 : 5.2
      if (amber && i === wall.ex.publish) w *= 1 + 1.4 * gPub
      if (i === wall.ex.use && s?.led === 'green') w *= 1 + 1.2 * gUse
      if (i === wall.ex.invalid && s?.led === 'red') w *= ratee
    }
    if (admitOn && i === rep) { col = COL.green; w = 5.2 }
    if (refused && i === rep) { col = COL.red; w = 4.0 }
    if (gRent > 0 && i === wall.ex.rent && (!s || s.led === 'off')) { col = COL.white; w = 1.1 * gRent }
    for (const p of world.pulses) if (p.slot === i) { const q = now - p.at; if (q >= 0 && q < 0.3) { const k = Math.sin(Math.PI * q / 0.3); w = Math.max(w * (1 + 0.9 * k), 8 * k) } }
    // No more green breathing (4%): only the amber of the replayed sled and the Invalid failure animate
    if (full && col && !REDUCED && (amber || (i === wall.ex.invalid && invAt >= 0))) anim[animN++] = i
    const isHov = i === hov
    // ---- The plate ----
    const tkey = st.title + '|' + st.sub + '|' + L
    if (e.key !== tkey) {
      e.key = tkey
      const tt = fitTitle(titleText(st.title))
      const fpx = mm(BAND) * tt.px / CH
      e.tl.textContent = ''
      for (const ln of tt.lines) { const sp = document.createElement('span'); sp.textContent = ln; e.tl.append(sp) }
      e.tl.style.fontSize = `${fpx.toFixed(2)}px`
      e.tl.style.lineHeight = tt.lines.length > 1 ? `${(mm(BAND) * 0.46).toFixed(1)}px` : `${mm(BAND).toFixed(1)}px`
      e.sub.textContent = t(SUBK[st.sub]).toUpperCase()
      e.u.textContent = `U${String(SLOTS[i].u).padStart(2, '0')}`
      e.plate.dataset.st = st.led
    }
    const tint = st.led === 'off' ? null : COL[st.led]
    if (e.geo !== film.geo) { e.geo = film.geo; e.pm = m3d(i, PL.x0 + 0.002, PL.y1 - 0.0015, 0.0006); e.lm = m3d(i, LD.x - GLOW.w / 2, LD.y + GLOW.h / 2, 0.0004) }
    const plM = e.pm
    if (!plM) { hide(e); continue }
    if (!e.shown) { e.plate.style.visibility = 'visible'; e.shown = true }
    if (e.pT !== plM) { e.pT = plM; e.plate.style.transform = plM }
    let under = 0
    if (!tint && cR && r) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2 + sy0
      const dx = Math.max(cR.left - 70 - cx, 0, cx - cR.right - 70), dy = Math.max(cR.top - 30 - cy, 0, cy - cR.bottom - 30)
      under = (1 - sm(dx / 60)) * (1 - sm(dy / 40))
    }
    // The scene passes intensity through a tone curve (AgX) that compresses the gap between states: same compression here
    const ink = tint ? Math.min(1.1, 0.6 + 0.4 * st.k / 1.9) : (i === wall.ex.rent && id === 'rent' ? 0.55 + 0.45 * gRent : 0.42 * (1 - 0.5 * under))
    const pc = tint ? (tint === COL.green ? '70 255 128' : tint === COL.amber ? '255 122 36' : tint === COL.red ? '255 56 46' : '196 206 222') : '170 180 196'
    if (e.pC !== pc) { e.pC = pc; e.plate.style.setProperty('--c', pc) }
    // Intensity as opacity of the composited element: no paint
    const po = Math.min(1, ink * fade * (isHov ? 1.25 : 1)).toFixed(3)
    if (e.pO !== po) { e.pO = po; e.plate.style.opacity = po }
    if (e.hov !== isHov) { e.hov = isHov; e.plate.classList.toggle('hov', isHov) }
    // ---- The LED ----
    if (col && w > 0.02 && e.lm) {
      if (!e.ledShown) { e.led.style.visibility = 'visible'; e.ledShown = true }
      if (e.lT !== e.lm) { e.lT = e.lm; e.led.style.transform = e.lm }
      const lc = col === COL.green ? '70 255 128' : col === COL.amber ? '255 122 36' : col === COL.red ? '255 56 46' : '196 206 222'
      if (e.lC !== lc) { e.lC = lc; e.led.style.setProperty('--c', lc) }
      const lo = Math.min(1, (w < 1.2 ? w / 2.4 : Math.min(1.5, 0.5 + 0.5 * w / 5.2)) * fade * (isHov ? 1.15 : 1)).toFixed(3)
      if (e.lO !== lo) { e.lO = lo; e.led.style.opacity = lo }
      continue
    }
    if (e.ledShown) { e.led.style.visibility = 'hidden'; e.ledShown = false }
  }
}
