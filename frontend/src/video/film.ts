// Video landing: the landing as a preloaded film. The real-time scene was captured frame by frame, at constant
// motion (one frame each time the screen moves by 8 px). Here, a 2D canvas shows on every refresh the best frame
// available for the scroll position, and sets in `world` what the scene used to set there (projection, sled
// rectangles, pointing, anchors) from the metadata of the frame shown.
// Goal: no stall, no lag, no freeze:
// - decoding in workers (createImageBitmap), in the order the frames are about to be shown: the scroll path is known
//   ahead (stop mode: start, destination, duration, curve; free wheel: Lenis smoothing);
// - the nearest available frame, redrawn as soon as a nearer one arrives; in slow motion the next frame is blended
//   over it, and at rest the view settles on a single whole frame;
// - a shadow track always in memory: one frame in 4 at 1/8 resolution, in 8 x 8 sheets; there is always a frame at
//   most 2 frames from the target, even after a scrollbar jump;
// - a window bounded in bytes, measured throughput, automatic step-down fallback; never any wait for a frame;
// - a per-refresh log (window.__filmLog) for measurement tools.
import { world } from '../world'
import { onTick, scrollY, REDUCED, getLenis, step, tick } from '../clock'
import { ORDER, PINNED, qStep, protoVel } from '../story'
import { SLOTS, G, NSLOTS } from '../data/wall'
import { lockScroll, showGate, updateGate, closeGate, gateShown } from './gate'

export interface Sheets { dir: string; ext: string; every: number; cols: number; rows: number; tw: number; th: number; n: number }
export interface Manifest {
  v: number; n: number; ext: string; w: number; h: number; filmW: number; filmH: number; nf: number; ns: number; ys: number[]
  geo: { max: number; total: number; secs: { id: string; top: number; h: number }[] }
  ex: Record<string, number>; replay: number; sh?: Sheets; ysFrom?: string
}
const Q = new URLSearchParams(location.search)
// The film manifests are inlined by the build as a JSON data block (not a script: the server's CSP forbids inline
// scripts); without it, each set's manifest.json is fetched
try { (window as unknown as { __FILM_MAN?: unknown }).__FILM_MAN = JSON.parse(document.getElementById('film-man')?.textContent || 'null') } catch { /* manifest.json */ }
export const PHONE = matchMedia('(max-width: 760px)').matches
/** A phone, upright or sideways (a landscape phone gets the desktop frames, but a phone's memory and radio): the phone
 *  decode budget, one worker, and a bounded network window */
const LIGHT = PHONE || matchMedia('(pointer: coarse) and (max-height: 500px)').matches
/** Phones fetch the film as the visitor moves through it: the frames within NET_WIN of the position (and the trip to the
 *  first stop, and the shadow-track sheets), never the 2,500 frames at once; fewer on a data saver or a slow link */
const CONN = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number } }).connection
/** A slow or metered link (data saver, 2g/3g, or under 3 Mbit/s announced by the browser) */
const SLOW = !!CONN && (!!CONN.saveData || /(^|-)(2g|3g)$/.test(CONN.effectiveType ?? '') || (CONN.downlink ?? 10) < 3)
const NET_WIN = !LIGHT ? Infinity : SLOW ? 60 : 160
const FIREFOX = /Firefox\//.test(navigator.userAgent)
/** Off-thread mode: the first worker holds the canvas (OffscreenCanvas), keeps the frames and draws them; uploading
 *  frames to the GPU no longer goes through the main thread (?off=0: main-thread canvas) */
// Disabled by default (?off=1 to bring it back). The worker presented its frame at its own pace, one frame ahead of or
// behind the HTML layer (set on the main thread): LEDs and names drifted by 15 to 30 px during motion. The main-thread
// canvas is composited in the same frame as the layer; with ?off=0 the same number of slow frames was measured.
export const CAL = Q.get('cal') === '1'
const OFF = !FIREFOX && typeof HTMLCanvasElement !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype && Q.get('off') === '1'
type W = Window & { __FILM_MAN?: Record<string, Manifest> }
/** The frame set: the one the first HTML image picked (<picture>), otherwise the same rule */
export function pickSet(): string {
  if (Q.get('set')) return Q.get('set')!
  // Firefox decodes the 2880 px AVIF in 22-25 ms on the main thread; it fell behind and showed the shadow track (18-21%
  // of frames in motion), so the video lagged and looked very blurry. At 1920 px: 10 ms, no thumbnail at all
  if (FIREFOX && !PHONE) return 'desktop'
  const src = document.querySelector<HTMLImageElement>('#poster img')?.currentSrc
  const m = src ? /\/film\/(\w+)\/f0000\./.exec(src) : null
  // Retina frames weigh 1.75 times the desktop ones and decode 2.25 times the pixels: under 8 Mbit/s announced (Chrome),
  // the desktop set, sharp and in time, rather than Retina frames that arrive after the scroll. A browser that announces
  // nothing (Safari, Firefox) counts as not fast: a Retina Mac in Safari gets the desktop set (?set=retina forces it)
  const fast = !!CONN && !SLOW && (CONN.downlink ?? 0) >= 8
  if (m) return m[1] === 'retina' && !fast ? 'desktop' : m[1]
  if (PHONE) return 'phone'
  // Retina for a dense, wide screen with a mouse or trackpad only (index.html says the same): a tablet gets desktop
  return fast && devicePixelRatio > 1.5 && innerWidth * devicePixelRatio > 2300 && matchMedia('(pointer: fine)').matches ? 'retina' : 'desktop'
}
export let SET = pickSet()
const ROOT = `${import.meta.env.BASE_URL}film/`
let BASE = `${ROOT}${SET}/`
/** ?v=<film version> on every frame and sheet: the ETag of meta.bin (new at every build), so the server can serve them
 *  as immutable (a return visit reads the whole film from the disk cache, without one request per frame) */
let VQ = ''
const name = (k: number, ext: string) => `${BASE}f${String(k).padStart(4, '0')}.${ext}${VQ}`

// ---- State ----
export const film = {
  man: null as Manifest | null,
  fl: new Float32Array(0), by: new Uint8Array(0),
  /** Target position in the film (frame index, fractional) */
  pos: 0,
  /** Frame shown (index) and its resolution: 0 full, 1 half, 2 shadow track */
  shown: -1, def: 0,
  /** Metadata of the frame shown */
  cur: new Float32Array(67),
  vis: new Uint8Array(NSLOTS), fog: new Uint8Array(NSLOTS),
  /** Film -> screen transform (CSS px): x' = ox + x * s, then the zoom toward the open service */
  s: 1, ox: 0, oy: 0,
  ready: false, drawn: 0, loaded: 0, total: 1,
  version: 0,
  /** Geometry counter: changes when the frame shown, the framing or the zoom change */
  geo: 0,
  /** Fallback level (0: none; 2: one frame in k in flight; 3: Retina brought down to desktop; 4: shadow track in flight) */
  level: 0, k: 1, decMs: 12, cap: 160, budget: LIGHT ? 100e6 : SET === 'retina' ? 480e6 : 300e6, bytes: 0, set: SET,
  /** Light frames received (light pass) */
  liteN: 0,
  /** Download rate measured on the film pack (Mbit/s, 0 until measured; ?gate=1 path) */
  rate: 0,
  /** Sharp bitmaps kept for the rests (?gate=1 path) */
  sharpN: 0,
}
;(window as unknown as { __film: typeof film }).__film = film
;(window as unknown as { __filmDbg: unknown }).__filmDbg = () => ({ bm: [...bm.keys()].sort((a, b) => a - b), dec: [...state].reduce((a, v, i) => (v === 1 ? a.concat(i) : a), [] as number[]), want: [...want.subarray(0, wantN)], pos: film.pos, shown: film.shown, def: film.def, jobs: jobs.size, busy: workers.map((w) => w.busy), sheets: sheets.map((x) => !!x), off: OFF, lite: { state: liteState, n: film.liteN, w: liteW, h: liteH, bm: bmLite.reduce((a, v) => a + v, 0) } })

// ---- Per-refresh log (measurement tools) ----
const LOGN = 1 << 15
const log = { n: 0, t: new Float64Array(LOGN), p: new Float32Array(LOGN), s: new Int16Array(LOGN), d: new Uint8Array(LOGN), ms: new Float32Array(LOGN), mv: new Uint8Array(LOGN), tk: new Float32Array(LOGN), pos: new Float32Array(LOGN), kind: new Uint8Array(LOGN), held: new Uint8Array(LOGN) }
;(window as unknown as { __filmLog: unknown }).__filmLog = {
  reset: () => { log.n = 0 },
  /** [t, target (fractional), shown, resolution, draw duration (ms), moving, tick, drawn position, kind (0 today's film,
   *  1 motion level, 2 sharp frame at rest, ?gate=1), held (the drawn position stayed while the target moved by half a
   *  frame or more)] from entry i */
  read: (i = 0) => { const out: number[][] = []; for (let j = Math.max(i, log.n - LOGN); j < log.n; j++) { const q = j & (LOGN - 1); out.push([log.t[q], log.p[q], log.s[q], log.d[q], log.ms[q], log.mv[q], log.tk[q], log.pos[q], log.kind[q], log.held[q]]) } return out },
  get n() { return log.n },
}

// ---- Light pass ----
// One frame in 2 of the film, reduced to a third and at a low quality, in one file streamed first (lite.bin, made by
// scripts/film-lite.mjs: 1.9 MB on desktop and Retina, 2.3 MB on phones as sent, ordered 1 frame in 8, then 4, then 2):
// a first visit has a coherent frame everywhere within seconds instead of the shadow track or a held frame. A sharp
// frame within 2 frames always goes first; the sharp frame replaces the light one as soon as it is decoded. Off with
// ?lite=0 and on a data saver. Measured 19/11 from a Mac (cold visit, moving refreshes more than 2.5 frames off or on
// the shadow track): desktop 4.8% -> 0%, phone 30.4% -> 1.2%.
const LITE_ON = Q.get('lite') !== '0' && !CONN?.saveData
const liteB: (Blob | null)[] = []
/** 1: the bitmap kept for this frame is the light one */
let bmLite = new Uint8Array(0)
/** 0 not started, 1 streaming, 2 complete, 3 unavailable (the shadow-track sheets are fetched then); liteCoarse: one
 *  frame in 4 of the whole film has arrived (a light frame at most 2 frames from any position) */
let liteState = 0, liteW = 0, liteH = 0, liteCoarse = false
/** Fingerprint of meta.bin, as scripts/film-lite.mjs computes it: a light file made for another capture is ignored */
function fingerprint(b: Uint8Array) {
  let h = 0x811c9dc5
  for (let i = 0; i < b.length; i += 61) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0 }
  return (h ^ b.length) >>> 0
}
async function loadLite(url: string, n: number, fp: number) {
  liteState = 1
  try {
    const r = await fetch(url, { priority: 'high' } as RequestInit)
    if (!r.ok) throw new Error(String(r.status))
    let buf = new Uint8Array(1 << 16), len = 0, count = -1, hdr = 0, at = 0, i = 0, ks: number[] = [], ls: number[] = []
    const take = (c: Uint8Array) => {
      if (len + c.length > buf.length) { const nb = new Uint8Array(Math.max(buf.length * 2, len + c.length)); nb.set(buf.subarray(0, len)); buf = nb }
      buf.set(c, len); len += c.length
      const dv = new DataView(buf.buffer)
      if (count < 0 && len >= 20) {
        if (dv.getUint32(0, true) !== 0x31544c46 || dv.getUint32(12, true) !== n || dv.getUint32(16, true) !== fp) throw new Error('other film')
        count = dv.getUint32(4, true); liteW = dv.getUint16(8, true); liteH = dv.getUint16(10, true); hdr = 20 + count * 8
      }
      if (count >= 0 && !ks.length && len >= hdr) {
        let total = hdr
        for (let j = 0; j < count; j++) { ks.push(dv.getUint32(20 + j * 8, true)); ls.push(dv.getUint32(24 + j * 8, true)); total += ls[j] }
        if (buf.length < total) { const nb = new Uint8Array(total); nb.set(buf.subarray(0, len)); buf = nb }
        at = hdr
      }
      // every light frame complete in what has arrived
      while (ks.length && i < count && at + ls[i] <= len) {
        const k = ks[i]
        if (k < n && !liteB[k]) { liteB[k] = new Blob([buf.slice(at, at + ls[i])], { type: 'image/avif' }); film.liteN++ }
        at += ls[i]; i++
      }
      if (i >= Math.ceil(n / 4)) liteCoarse = true
    }
    const rd = r.body?.getReader()
    if (!rd) take(new Uint8Array(await r.arrayBuffer()))
    else for (;;) { const { done: end, value } = await rd.read(); if (end) break; if (value) take(value) }
    liteState = 2
  } catch { liteState = 3 }
  if (liteState === 3 || !film.liteN) { liteState = 3; pump() }
}

// ---- Memory ----
const blobs: (Blob | null)[] = []
const fetching = new Set<number>()
const bm = new Map<number, ImageBitmap | null>(), bmBytes = new Map<number, number>()
let state = new Uint8Array(0)      // 0 nothing, 1 decoding, 2 decoded
const FRAME_BYTES = () => film.man!.w * film.man!.h * 4
const sheets: (ImageBitmap | true | null)[] = [], sheetBlobs: (Blob | null)[] = [], sheetFetch = new Set<number>(), sheetDec = new Set<number>()
let dir = 1, lastPos = 0, firstStopK = 0, allLoaded = false, vel = 0

// ---- Live page against filmed page: same sequence of sections, positions matched ----
let liveA: number[] = [], filmA: number[] = [], liveTops: Record<string, [number, number]> = {}
let protoF: { top: number; h: number } | null = null
function measure() {
  const m = film.man; if (!m) return
  const H = innerHeight, y0 = scrollY()
  const fH = m.filmH
  liveA = []; filmA = []; liveTops = {}
  for (const id of ORDER) {
    const el = document.querySelector<HTMLElement>(`[data-sec="${id}"]`)
    const fs = m.geo.secs.find((x) => x.id === id)
    if (!el || !fs) continue
    const r = el.getBoundingClientRect(), top = r.top + y0
    liveTops[id] = [top, r.height]
    liveA.push(top); filmA.push(fs.top)
    if (PINNED.includes(id as never)) { liveA.push(top + Math.max(1, r.height - H)); filmA.push(fs.top + Math.max(1, fs.h - fH)) }
  }
  protoF = m.geo.secs.find((x) => x.id === 'protocol') ?? null
  const max = document.documentElement.scrollHeight - H
  liveA.push(max); filmA.push(m.geo.max)
  // Strictly increasing
  for (let i = 1; i < liveA.length; i++) if (liveA[i] <= liveA[i - 1]) liveA[i] = liveA[i - 1] + 1
  firstStopK = 0
  segs()
  const st = (window as unknown as { __stops?: () => { y: number }[] }).__stops?.()
  // the first trips are fetched first: with a held section, the first stop may not move the film at all
  if (st && st.length > 1) firstStopK = Math.min(m.n - 1, Math.ceil(Math.max(...st.slice(1, 3).map((x) => posAt(x.y, 0)))) + 2)
}
// ---- The film advances at a steady screen speed between two stops ----
// Frames are laid at constant screen motion (6 px): the frame index IS the on-screen motion. Between two scroll stops
// (story.ts), the linear page packed the large camera moves into a few dozen px (hero -> Use: 100 frames in 166 px;
// protocol exit: 117 frames in 150 px): at trip speed, the camera jumped. Between two stops, the film position now
// tends toward a steady progression of the indices (UNI of the difference): stops land on the same frames as before
// (same framings, same title reading), and the motion between them is spread over the whole distance. The pinned
// protocol page keeps its state queue (protoQ).
// UNI is 1. At 0.8, the remaining 20% followed the linear page, whose slope changes at every section edge: the film
// speed broke in the middle of a trip (hero -> Use: -75% in one frame). Between two stops, the film is now strictly
// proportional to the page trip (whose curve starts and ends smoothly).
const UNI = Q.has('uni') ? Number(Q.get('uni')) : 1
let SY: number[] = [], SF: number[] = [], segTry = 0, protoIn: [number, number] = [Infinity, -Infinity]
/** ?gate=1: film positions of the stops, ascending (their sharp frames are prefetched; at rest the way to the next one
 *  is decoded first) */
let stopF: number[] = []
function segs() {
  SY = []; SF = []
  const m = film.man; if (!m || UNI <= 0) return
  const st = (window as unknown as { __stops?: () => { y: number }[] }).__stops?.()
  if (!st || st.length < 2) return
  const ys = st.map((x) => x.y)
  const pr = liveTops.protocol
  // The edges of the pinned page no longer cut the trips (protocol exit: the state queue played the last 3% at constant
  // speed, then the frame was held until the edge); the queue drives the film only between the first and the last stop
  // of the pinned page
  protoIn = [Infinity, -Infinity]
  for (const x of st as { y: number; id?: string }[]) if (x.id === 'protocol') { protoIn[0] = Math.min(protoIn[0], x.y); protoIn[1] = Math.max(protoIn[1], x.y) }
  // On phones (no stop mode: the page can run ahead of the queue), the whole pinned page stays driven by the queue
  if (PHONE && pr) protoIn = [pr[0], pr[0] + Math.max(1, pr[1] - innerHeight)]
  // The steady trip stopped at the first protocol stop while the state queue, slower, was already driving the scene: at
  // the hand-over the film went back 20 frames (the sled came out, went back in and came out again). The queue now
  // drives from the edge of the pinned page, which becomes a node of the steady trip (queue at 0: same frames).
  if (pr) { protoIn[0] = Math.min(protoIn[0], pr[0]) }
  ys.push(0, document.documentElement.scrollHeight - innerHeight)
  if (pr) ys.push(pr[0])
  ys.sort((a, b) => a - b)
  for (const y of ys) {
    if (SY.length && y < SY[SY.length - 1] + 2) continue
    // At the stops of the pinned page, the state queue is set on the step (protoQ = progress)
    const q = pr ? Math.min(1, Math.max(0, (y - pr[0]) / Math.max(1, pr[1] - innerHeight))) : 0
    SY.push(y); SF.push(posOf(filmYAt(y, q)))
  }
  const qOf = (y: number) => (pr ? Math.min(1, Math.max(0, (y - pr[0]) / Math.max(1, pr[1] - innerHeight))) : 0)
  stopF = st.map((x) => posAt(x.y, qOf(x.y))).sort((a, b) => a - b)
}
/** Film position (fractional index) for page position y and state queue q of the pinned page */
function posAt(y: number, q: number): number {
  const lin = posOf(filmYAt(y, q))
  const n = SY.length
  if (n < 2 || y <= SY[0] || y >= SY[n - 1]) return lin
  if (y >= protoIn[0] && y <= protoIn[1]) return lin
  let lo = 0, hi = n - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (SY[mid] <= y) lo = mid; else hi = mid }
  const u = (y - SY[lo]) / Math.max(1e-6, SY[hi] - SY[lo])
  const uni = SF[lo] + u * (SF[hi] - SF[lo])
  return lin + UNI * (uni - lin)
}
/** Number of film frames between two page positions (with the pinned page queue set on the page): the duration of a
 *  trip from stop to stop is tuned on it (clock.ts) */
export function filmSpan(y0: number, y1: number): number {
  if (!film.man) return 0
  const pr = liveTops.protocol
  const qOf = (y: number) => (pr ? Math.min(1, Math.max(0, (y - pr[0]) / Math.max(1, pr[1] - innerHeight))) : 0)
  return Math.abs(posAt(y1, qOf(y1)) - posAt(y0, qOf(y0)))
}
;(window as unknown as { __filmSpan: typeof filmSpan }).__filmSpan = filmSpan
/** Film position for page position y (pinned page 1 plays on its state queue q, like the scene) */
function filmYAt(y: number, q: number): number {
  const m = film.man!
  const pr = liveTops.protocol
  if (pr && protoF && y >= pr[0] && y <= pr[0] + pr[1] - innerHeight) return protoF.top + q * Math.max(1, protoF.h - m.filmH)
  if (!liveA.length || y <= liveA[0]) return filmA[0] ?? 0
  for (let i = 1; i < liveA.length; i++) if (y <= liveA[i]) return filmA[i - 1] + ((y - liveA[i - 1]) / (liveA[i] - liveA[i - 1])) * (filmA[i] - filmA[i - 1])
  return filmA[filmA.length - 1]
}
function posOf(fy: number) {
  const ys = film.man!.ys
  if (fy <= ys[0]) return 0
  let lo = 0, hi = ys.length - 1
  if (fy >= ys[hi]) return hi
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ys[mid] <= fy) lo = mid; else hi = mid }
  return lo + (fy - ys[lo]) / Math.max(1e-6, ys[hi] - ys[lo])
}

// ---- Path ahead: film positions at the next refreshes ----
// Stop mode: the Lenis trip (start, destination, duration, curve); otherwise the Lenis smoothing (lerp 0.1: a damping
// of 6 per second, frame-rate independent); pinned page 1: its state queue at bounded speed (story.ts, rateAt)
const HZ = 1 / 60, HORIZON = 30
const fut = new Float64Array(49)
function predict(HOR = HORIZON): number {
  const l = getLenis(), now = performance.now()
  let y = l ? l.animatedScroll : window.scrollY
  const tgt = l ? l.targetScroll : y
  let q = world.protoQ, qv = protoVel()
  const pr = liveTops.protocol, H = innerHeight
  const tr = step.trip
  fut[0] = film.pos
  let n = 0
  for (let i = 1; i <= HOR; i++) {
    const t = now + i * HZ * 1000
    if (tr) { const u = Math.min(1, Math.max(0, (t - tr.t0) / (tr.dur * 1000))); y = tr.y0 + (tr.y1 - tr.y0) * tr.ease(u) }
    else y = tgt + (y - tgt) * Math.exp(-6 * HZ)
    if (pr) {
      const a = pr[0], len = Math.max(1, pr[1] - H), p = Math.min(1, Math.max(0, (y - a) / len))
      if (y > a + len + 0.35 * H || y < a - 0.35 * H) { q = p; qv = 0 }
      else { const s = qStep(q, qv, p, HZ); q = s[0]; qv = s[1] }
    }
    fut[i] = posAt(y, q); n = i
    if (!tr && Math.abs(y - tgt) < 0.5) break
  }
  // Native scrolling (touch, scrollbar): Lenis has no target ahead; the measured velocity, damped
  if (!tr && n <= 1 && Math.abs(vel) > 3) {
    let p = film.pos, v = vel
    for (let i = 1; i <= 18; i++) { p += v * HZ; v *= 0.94; fut[i] = Math.min(film.man!.n - 1, Math.max(0, p)) }
    n = 18
  }
  return n
}

// ---- Decoding workers ----
type Job = { k: number; sheet: boolean; half: boolean; wi: number; lite?: boolean }
const NW = FIREFOX && Q.get('fw') !== '1' ? 0 : LIGHT ? 1 : 2
const workers: { w: Worker; busy: number }[] = []
const jobs = new Map<number, Job>()
let jobId = 0, decN = 0, decSum = 0, t0dec = 0
function startWorkers() {
  for (let i = 0; i < NW; i++) {
    try {
      const w = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' })
      const slot = { w, busy: 0 }
      const wi = i
      w.onmessage = (e: MessageEvent<{ id: number; bmp?: ImageBitmap; ms?: number; err?: string; sent?: boolean; drawn?: number; w?: number; h?: number }>) => {
        const d = e.data
        if (d.drawn !== undefined) { lastDrawMs = d.ms ?? 0; return }
        if (d.sent) { slot.busy--; return }
        const job = jobs.get(d.id)
        if (!job || job.wi === wi || !OFF) slot.busy--
        done(d.id, d.bmp ?? null, d.ms ?? 0, d.err, d.w ?? 0, d.h ?? 0)
      }
      workers.push(slot)
    } catch { /* no worker: decoding on the main thread */ }
  }
  if (OFF && workers.length) {
    const off = cv.transferControlToOffscreen()
    workers[0].w.postMessage({ type: 'init', canvas: off }, [off])
    for (let i = 1; i < workers.length; i++) { const ch = new MessageChannel(); workers[0].w.postMessage({ type: 'port', port: ch.port1 }, [ch.port1]); workers[i].w.postMessage({ type: 'port', port: ch.port2 }, [ch.port2]) }
  }
}
function decode(job: Job, blob: Blob): boolean {
  const id = ++jobId
  const m = film.man!
  const rw = job.half ? Math.round(m.w / 2) : 0, rh = job.half ? Math.round(m.h / 2) : 0
  if (workers.length) {
    let best = workers[0]
    for (const w of workers) if (w.busy < best.busy) best = w
    if (best.busy >= 2) return false
    best.busy++; job.wi = workers.indexOf(best); jobs.set(id, job)
    best.w.postMessage({ type: 'dec', id, k: job.k, sheet: false, blob, rw, rh })
    return true
  }
  // Firefox (worker decoding stalls there) or no worker: img.decode() then createImageBitmap on the main thread
  if (mainBusy >= 2) return false
  mainBusy++; jobs.set(id, job)
  const t0 = performance.now(), url = URL.createObjectURL(blob), img = new Image()
  img.src = url
  img.decode().then(() => createImageBitmap(img, rw ? { resizeWidth: rw, resizeHeight: rh } : {}))
    .then((b) => { mainBusy--; URL.revokeObjectURL(url); done(id, b, performance.now() - t0) })
    .catch((e) => { mainBusy--; URL.revokeObjectURL(url); done(id, null, 0, String(e)) })
  return true
}
let mainBusy = 0
let lastDrawMs = 0
function done(id: number, bmp: ImageBitmap | null, ms: number, err?: string, ow = 0, oh = 0) {
  const job = jobs.get(id); jobs.delete(id)
  if (!job) { bmp?.close(); return }
  const ok = !!bmp || (OFF && ow > 0)
  if (job.sheet) {
    sheetDec.delete(job.k)
    if (ok) { sheets[job.k] = bmp ?? true; dirty = true }
    pump(); return
  }
  const k = job.k
  if (!ok) {
    state[k] = 0
    // Memory pressure (iOS): the window is halved
    if (err && /memory|allocat|quota/i.test(err)) film.budget = Math.max(40e6, film.budget / 2)
    return
  }
  // Measured throughput (moving average), on the sharp frames only (a light frame decodes ten times faster)
  if (!job.lite) {
    decN++; decSum += ms
    film.decMs = film.decMs * 0.85 + ms * 0.15
    film.cap = Math.max(1, workers.length || 1) * 1000 / Math.max(1, film.decMs)
  }
  if (state[k] !== 1) { if (bmp) bmp.close(); else workers[0].w.postMessage({ type: 'drop', k }); return }
  const bytes = bmp ? bmp.width * bmp.height * 4 : ow * oh * 4
  // the sharp frame replaces the light one kept until now
  if (bm.has(k)) { bm.get(k)?.close(); film.bytes -= bmBytes.get(k) ?? 0 }
  bm.set(k, bmp); bmBytes.set(k, bytes); state[k] = 2; film.bytes += bytes; bmLite[k] = job.lite ? 1 : 0
  evict()
  // A frame nearer the target than the one shown: redraw
  if (Math.abs(k - film.pos) < Math.abs(film.shown - film.pos) + 0.01 || film.def) dirty = true
  schedule()
}
function drop(k: number) {
  if (!bm.has(k)) return
  const b = bm.get(k)
  film.bytes -= bmBytes.get(k) ?? 0; bmBytes.delete(k)
  if (b) b.close(); else workers[0].w.postMessage({ type: 'drop', k })
  bm.delete(k); state[k] = 0; bmLite[k] = 0
}
// What is wanted, in order (the path), is protected from eviction
let want = new Int32Array(0), wantN = 0, stamp = new Uint32Array(0), stampV = 1
function evict(need = 0, from = 0) {
  const lim = film.budget - need
  if (film.bytes <= lim) return
  const p = film.pos
  // First what moves away from the path: behind counts as farther than ahead
  const cand: number[] = []
  for (const k of bm.keys()) if (k !== film.shown && k !== shownB && stamp[k] !== stampV) cand.push(k)
  cand.sort((a, b) => score(b, p) - score(a, p))
  for (const k of cand) { if (film.bytes <= lim) break; drop(k) }
  // Still too much: the end of the wanted path
  for (let i = wantN - 1; i >= from && film.bytes > lim; i--) { const k = want[i]; if (k !== film.shown && k !== shownB && bm.has(k)) drop(k) }
}
const score = (k: number, p: number) => ((k - p) * dir >= 0 ? Math.abs(k - p) : Math.abs(k - p) * 1.6)

// ---- Scheduling ----
function addWant(k: number) {
  if (k < 0 || k >= film.man!.n || stamp[k] === stampV || wantN >= want.length) return
  stamp[k] = stampV; want[wantN++] = k
}
const nearestIdx = (p: number) => { const a = Math.floor(p), t = p - a; return t > 0.5 || (t === 0.5 && dir > 0) ? a + 1 : a }
let moving = false
function schedule() {
  const m = film.man; if (!m) return
  stampV++; wantN = 0
  const fb = FRAME_BYTES(), maxF = Math.max(6, Math.floor(film.budget / fb) - 2)
  if (want.length !== maxF) want = new Int32Array(maxF)
  const k0 = Math.min(m.n - 1, nearestIdx(film.pos))
  addWant(k0)
  const n = predict()
  const travel = n > 0 && Math.abs(fut[n] - fut[0]) > 0.5
  moving = travel
  if (travel && film.level < 4) {
    // The frames each refresh will show, in time order; beyond the throughput, one in k
    let uniq = 0, last = -1
    for (let i = 1; i <= n; i++) { const k = nearestIdx(fut[i]); if (k !== last) { uniq++; last = k } }
    const secs = n * HZ
    film.k = Math.max(1, Math.ceil(uniq / secs / (film.cap * 0.85)))
    if (film.k > 1 && film.level < 2) film.level = 2
    last = -1; let c = 0
    for (let i = 1; i <= n; i++) {
      const k = nearestIdx(fut[i])
      if (k === last) continue
      last = k
      if (c++ % film.k === 0 || i === n) addWant(k)
    }
    addWant(nearestIdx(fut[n]))
  }
  if (!travel) {
    // Resting at a stop: the way to the next stop and to the previous one, alternated
    const R = Math.min(20, Math.floor((maxF - 5) / 2))
    for (let i = 1; i <= R; i++) { addWant(k0 + i * dir); addWant(k0 - i * dir) }
  }
  for (let i = 1; i <= 2; i++) { addWant(k0 + i * dir); addWant(k0 - i * dir) }
  // Decode in the wanted order: the sharp frame when it is there (also over a light frame already decoded), otherwise
  // the light one
  for (let i = 0; i < wantN; i++) {
    const k = want[i]
    const b = blobs[k]
    if (state[k] === 1 || (state[k] === 2 && !(bmLite[k] && b))) continue
    const src = b ?? liteB[k]
    if (!src) continue
    const need = b ? fb : liteW * liteH * 4
    // Never beyond the window: evict what is not wanted first
    if (film.bytes + need > film.budget) { evict(need, i + 1); if (film.bytes + need > film.budget) break }
    if (!decode({ k, sheet: false, half: false, wi: 0, lite: !b }, src)) break
    state[k] = 1
  }
  if (!allLoaded) pump()
}

// ---- Loading: the first frame (already there), the shadow-track sheets, the trip to the first stop, then everything
// else by distance to the position, 6 requests at a time ----
// Requests in flight: a frame weighs 30 to 50 KB, so with 6 in flight a 150 ms round trip capped the film at 30 frames per
// second whatever the bandwidth (measured from a client on another continent: 200 ms per frame); 16 on a computer, 10 on a phone, 6 on a
// slow link (where more in flight only delays the urgent frames)
const MAXF = SLOW ? 6 : LIGHT ? 10 : 16
/** Until the light pass covers the whole film (one frame in 4), a few sharp requests only (the frames at the position
 *  and on the way): over HTTP/2 the light file shares the link with every request in flight */
const maxF = () => (liteState === 1 && !liteCoarse ? (SLOW ? 2 : LIGHT ? 4 : 8) : MAXF)
let nLoaded = 0
/** Fetch order around the position: its neighbours first (ahead first), then the whole window coarse to fine (one frame
 *  in 8, in 4, in 2, then all). A visitor who scrolls faster than the link always finds a sharp frame at most 2 frames
 *  from the target (choose()) instead of the blurry shadow track or a held frame. Rebuilt when the position moves by
 *  16 frames or the direction flips; a cursor skips what is loaded or in flight. */
let order = new Int32Array(0), orderN = 0, orderAt = 0, orderC = -1e9, orderDir = 0
function nextInOrder(n: number): number {
  if (Math.abs(film.pos - orderC) > 16 || dir !== orderDir || order.length !== n) {
    const c = Math.min(n - 1, Math.max(0, Math.round(film.pos))), win = Math.min(n, NET_WIN)
    if (order.length !== n) order = new Int32Array(n)
    orderC = film.pos; orderDir = dir; orderAt = 0; orderN = 0
    const mark = new Uint8Array(n)
    const put = (k: number) => { if (k >= 0 && k < n && !mark[k]) { mark[k] = 1; order[orderN++] = k } }
    for (let d = 0; d <= 12; d++) { put(c + d * dir); put(c - d * dir) }
    for (const s of [8, 4, 2, 1]) for (let d = 0; d < win; d++) { const a = c + d * dir, b = c - d * dir; if (a % s === 0) put(a); if (b >= 0 && b % s === 0) put(b) }
  }
  while (orderAt < orderN) { const q = order[orderAt]; if (!blobs[q] && !fetching.has(q)) return q; orderAt++ }
  return -1
}
const MIME: Record<string, string> = { avif: 'image/avif', webp: 'image/webp', jpg: 'image/jpeg' }
function fetchOne(url: string, hi: boolean, ok: (b: Blob | null) => void) {
  // The type is set from the extension (a static server may answer application/octet-stream)
  const path = url.split('?')[0], type = MIME[path.slice(path.lastIndexOf('.') + 1)] ?? ''
  fetch(url, { priority: hi ? 'high' : 'low' } as RequestInit).then((r) => (r.ok ? r.blob() : null)).then((b) => (b && type && b.type !== type ? b.slice(0, b.size, type) : b)).catch(() => null).then(ok)
}
/** Phones: the frames left far behind give their memory back (fetched again if the visitor returns there) */
let prunedAt = -1e9
function prune() {
  if (!LIGHT || Math.abs(film.pos - prunedAt) < 40) return
  prunedAt = film.pos
  const keep = NET_WIN * 2.5
  for (let k = 0; k < blobs.length; k++) {
    if (blobs[k] && Math.abs(k - film.pos) > keep && state[k] !== 1 && !fetching.has(k)) { blobs[k] = null; nLoaded-- }
  }
  film.loaded = nLoaded
}
function pump() {
  const m = film.man; if (!m || allLoaded) return
  // nothing is fetched for a hidden tab (the frames come back with it, through the next refresh)
  if (document.hidden) return
  prune()
  // the shadow-track sheets only without the light pass (it covers the whole film, sharper)
  const sh = LITE_ON && liteState !== 3 ? undefined : m.sh
  while (fetching.size + sheetFetch.size < maxF()) {
    // 1. The sheets (the first one first)
    let sj = -1
    if (sh) for (let j = 0; j < sh.n; j++) if (!sheetBlobs[j] && !sheetFetch.has(j)) { sj = j; break }
    // Sheet 0 and the trip to the first stop go before the other sheets
    let k = -1
    // The path ahead (want, in time order); while travelling, one frame in 4 of it first, so that the slots in flight
    // cover the whole trip
    if (moving) for (let i = 0; i < wantN; i++) { const q = want[i]; if (q % 4 === 0 && !blobs[q] && !fetching.has(q)) { k = q; break } }
    if (k < 0) for (let i = 0; i < wantN; i++) { const q = want[i]; if (!blobs[q] && !fetching.has(q)) { k = q; break } }
    if (k < 0 && (sj > 0 || !sh)) for (let q = 0; q <= firstStopK; q++) if (!blobs[q] && !fetching.has(q)) { k = q; break }
    if (sj >= 0 && (sj === 0 || k < 0)) {
      sheetFetch.add(sj)
      const j = sj
      fetchOne(`${ROOT}${sh!.dir}/s${String(j).padStart(2, '0')}.${sh!.ext}${VQ}`, true, (b) => { sheetFetch.delete(j); sheetBlobs[j] = b; if (b) decodeSheet(j); pump() })
      continue
    }
    if (k < 0) k = nextInOrder(m.n)
    if (k < 0) { if (!fetching.size && !sheetFetch.size && nLoaded >= m.n) allLoaded = true; return }
    const q = k
    fetching.add(q)
    fetchOne(name(q, m.ext), Math.abs(q - film.pos) < 20, (b) => {
      fetching.delete(q)
      if (b && !blobs[q]) { blobs[q] = b; nLoaded++; film.loaded = nLoaded }
      if (stamp[q] === stampV) schedule(); else pump()
    })
  }
}
function decodeSheet(j: number) {
  if (sheets[j] || sheetDec.has(j)) return
  const b = sheetBlobs[j]; if (!b) return
  // A sheet decoded on a worker thread, like a frame; it goes before the frames
  const id = ++jobId
  const wi = workers.length ? j % workers.length : 0
  jobs.set(id, { k: j, sheet: true, half: false, wi })
  sheetDec.add(j)
  if (workers.length) { const w = workers[wi]; w.busy++; w.w.postMessage({ type: 'dec', id, k: j, sheet: true, blob: b }) }
  else createImageBitmap(b).then((x) => done(id, x, 0)).catch(() => done(id, null, 0))
}

// ---- Drawing ----
let cv: HTMLCanvasElement, g: CanvasRenderingContext2D, dirty = true
/** ?gate=1: the sharp layer over the motion canvas (#film-sharp), shown only at rest */
let cvS: HTMLCanvasElement | null = null, gS: CanvasRenderingContext2D | null = null
let zoom = 0, zx = 0, zy = 0, lastVW = 0, lastVH = 0
function place() {
  const m = film.man; if (!m) return
  const vw = innerWidth, vh = innerHeight
  // Phone: the address bar showing or hiding does not change the framing (height only, under 140 px)
  if (PHONE && vw === lastVW && Math.abs(vh - lastVH) < 140 && lastVH) return
  lastVW = vw; lastVH = vh
  film.s = Math.max(vw / m.filmW, vh / m.filmH)
  film.ox = (vw - m.filmW * film.s) / 2
  // On phones the top of the frame is kept (the scene rises there above the text)
  film.oy = PHONE ? 0 : (vh - m.filmH * film.s) / 2
  for (const c of cvS ? [cv, cvS] : [cv]) {
    const st = c.style
    st.width = `${m.filmW * film.s}px`; st.height = `${m.filmH * film.s}px`
    st.left = `${film.ox}px`; st.top = `${film.oy}px`
  }
  measure(); applyZoom(); film.geo++
}
function applyZoom() {
  for (const c of cvS ? [cv, cvS] : [cv]) {
    c.style.transformOrigin = `${zx - film.ox}px ${zy - film.oy}px`
    c.style.transform = zoom > 0 ? `scale(${(1 + 0.14 * zoom).toFixed(5)})` : ''
  }
}
/** Film (capture CSS px) -> screen (CSS px), including the zoom toward the open service */
export function toView(x: number, y: number): [number, number] {
  let X = film.ox + x * film.s, Y = film.oy + y * film.s
  if (zoom > 0) { const z = 1 + 0.14 * zoom; X = zx + (X - zx) * z; Y = zy + (Y - zy) * z }
  return [X, Y]
}
export const zoomK = () => ({ k: 1 + 0.14 * zoom, x: zx, y: zy })
export const zoomNow = () => zoom
export const zoomAt = () => [zx, zy] as const
export function fromView(X: number, Y: number): [number, number] {
  if (zoom > 0) { const z = 1 + 0.14 * zoom; X = zx + (X - zx) / z; Y = zy + (Y - zy) / z }
  return [(X - film.ox) / film.s, (Y - film.oy) / film.s]
}
/** The best frame for the target: a full one at most 2 frames away (ahead on a tie), otherwise the shadow track,
 *  otherwise the nearest full one; never any wait */
let pickK = -1, pickD = 0
// Small jerky moves near the stops: two neighbouring frames are 8 px apart; in slow motion (end of a trip, state queue
// catching up), the film advanced in 8 px jumps every 70 to 100 ms. In slow motion, the next frame is blended on top at
// the fraction of the position (pickB, pickA); at rest, the displayed position glides in 0.1 s to the nearest whole
// frame: a single sharp frame.
let pickB = -1, pickA = 0, shownB = -1, shownA = 0, dpos = 0, restK = -1
// Firefox: no blend (two new frames per refresh doubles the upload, and a blend over a lagging frame reads as a
// ghost); ?blend=1 forces it, ?blend=0 turns it off everywhere
const BLEND_V = Q.get('blend') === '0' || (FIREFOX && Q.get('blend') !== '1') ? 0 : 40
// thumbnails only for big jumps (scrollbar, anchors): during a normal scroll, the sharp frame on screen is held for a
// refresh rather than replaced by a blurry 12x upscale
const SHEET_GAP = 12
function choose(p: number) {
  const m = film.man!
  pickB = -1; pickA = 0
  if (film.level < 4 && Math.abs(vel) < BLEND_V) {
    const a = Math.floor(p), f = Math.round((p - a) * 32) / 32
    // two frames of the same kind (two sharp ones, or two light ones)
    if (f > 0 && f < 1 && bm.has(a) && bm.has(a + 1) && bmLite[a] === bmLite[a + 1]) { pickK = a; pickB = a + 1; pickA = f; pickD = bmLite[a]; return true }
  }
  const t = Math.min(m.n - 1, nearestIdx(p))
  let full = -1
  const L4 = film.level >= 4 && moving
  // a sharp frame at most 2 frames away, otherwise a light one at most 2 frames away
  const sharp = (k: number) => bm.has(k) && !bmLite[k]
  if (!L4) for (let d = 0; d <= 2 && full < 0; d++) {
    const a = t + d * dir, b = t - d * dir
    if (sharp(a)) full = a; else if (d && sharp(b)) full = b
  }
  if (!L4) for (let d = 0; d <= 2 && full < 0; d++) {
    const a = t + d * dir, b = t - d * dir
    if (bm.has(a)) full = a; else if (d && bm.has(b)) full = b
  }
  if (full >= 0) { pickK = full; pickD = bmLite[full]; return true }
  const sh = m.sh
  if (sh) {
    const j = Math.min(Math.floor((m.n - 1) / sh.every), Math.max(0, Math.round(t / sh.every)))
    if (sheets[Math.floor(j / (sh.cols * sh.rows))] && !(film.shown >= 0 && film.def === 0 && Math.abs(film.shown - t) <= SHEET_GAP)) {
      // The shadow track only has one frame in 4; if it would give back the frame already shown during a motion, a full
      // frame 3 frames from the target goes first (scrollbar at CPU x4: frame held for 3 refreshes)
      if (moving && j * sh.every === film.shown) for (const a of [t + 3 * dir, t - 3 * dir]) if (a !== film.shown && bm.has(a)) { pickK = a; pickD = bmLite[a]; return true }
      pickK = j * sh.every; pickD = 2; return true
    }
  }
  // never a frame from further away: in the protocol, 10 frames apart can be a closed sled and an open one; better to
  // hold the frame on screen for a refresh than to flash another moment of the film
  for (let d = 3; d < 4; d++) { const a = t + d * dir, b = t - d * dir; if (bm.has(a)) { pickK = a; pickD = bmLite[a]; return true } if (bm.has(b)) { pickK = b; pickD = bmLite[b]; return true } }
  return false
}
const NODRAW = Q.get('dessin') === '0'
function draw(): number {
  const m = film.man!
  const t0 = performance.now()
  if (NODRAW) return 0
  if (OFF && workers.length) {
    if (pickD === 2) { const sh = m.sh!, j = pickK / sh.every, per = sh.cols * sh.rows, c = j % per; workers[0].w.postMessage({ type: 'draw', k: pickK, sheet: Math.floor(j / per), sx: (c % sh.cols) * sh.tw, sy: Math.floor(c / sh.cols) * sh.th, sw: sh.tw, sh: sh.th }) }
    else workers[0].w.postMessage({ type: 'draw', k: pickK, sheet: -1, sx: 0, sy: 0, sw: 0, sh: 0 })
    return lastDrawMs
  }
  if (pickD === 2) {
    const sh = m.sh!, j = pickK / sh.every, per = sh.cols * sh.rows, s = sheets[Math.floor(j / per)] as ImageBitmap, c = j % per
    // Thumbnail enlarged about 12 times: high-quality smoothing (at "low", the enlargement aliases the edges)
    g.imageSmoothingQuality = 'high'
    g.drawImage(s, (c % sh.cols) * sh.tw, Math.floor(c / sh.cols) * sh.th, sh.tw, sh.th, 0, 0, cv.width, cv.height)
    g.imageSmoothingQuality = 'low'
  } else {
    const b = bm.get(pickK) as ImageBitmap
    if (b.width === cv.width) g.drawImage(b, 0, 0)
    else g.drawImage(b, 0, 0, cv.width, cv.height)
    const b2 = pickB >= 0 ? bm.get(pickB) as ImageBitmap | undefined : undefined
    if (b2) { g.globalAlpha = pickA; g.drawImage(b2, 0, 0, cv.width, cv.height); g.globalAlpha = 1 }
  }
  // ?cal=1 (sync measurement): the index of the drawn frame, as 12 bands in the canvas; the layer sets its own in the
  // DOM (lames.ts), and the test bench compares both on the compositor frames
  if (CAL) bands(g, cv.width, cv.height, pickK)
  return performance.now() - t0
}
function bands(c: CanvasRenderingContext2D, W: number, H: number, k: number) {
  for (let b = 0; b < 12; b++) { c.fillStyle = (k >> b) & 1 ? '#fff' : '#000'; for (const y of [0.45, 0.6]) c.fillRect(Math.round(W * (0.3 + 0.4 * b / 12)), Math.round(H * y), Math.ceil(W * 0.4 / 12), Math.round(H * 0.04)) }
}

// ---- Metadata of the frame shown ----
function metaAt(k: number, k2 = -1, a = 0) {
  const m = film.man!, NF = m.nf, NS = m.ns
  film.cur.set(film.fl.subarray(k * NF, k * NF + NF))
  if (k2 >= 0 && a > 0) { const o2 = k2 * NF; for (let i = 0; i < NF; i++) film.cur[i] += (film.fl[o2 + i] - film.cur[i]) * a }
  if (k2 >= 0 && a > 0.5) k = k2
  const o = k * NS * 2
  film.vis.set(film.by.subarray(o, o + NS))
  film.fog.set(film.by.subarray(o + NS, o + NS * 2))
}
/** World -> film projection (capture CSS px), into out: x, y, z (depth), w */
export function projInto(out: Float64Array, x: number, y: number, z: number) {
  const v = film.cur, m = film.man!
  const cx = v[0] * x + v[4] * y + v[8] * z + v[12], cy = v[1] * x + v[5] * y + v[9] * z + v[13]
  const cz = v[2] * x + v[6] * y + v[10] * z + v[14], w = v[3] * x + v[7] * y + v[11] * z + v[15]
  out[0] = (cx / w + 1) / 2 * m.filmW; out[1] = (1 - cy / w) / 2 * m.filmH; out[2] = cz / w; out[3] = w
}
export function projF(x: number, y: number, z: number) {
  projInto(P4, x, y, z); return { x: P4[0], y: P4[1], z: P4[2], w: P4[3] }
}
const P4 = new Float64Array(4), W3 = new Float64Array(3)
/** A point of a sled's facade frame (m) -> world, into out: the replayed sled, when pulled out, follows its matrix */
export function faceInto(out: Float64Array, i: number, x: number, y: number, z: number) {
  const v = film.cur
  if (i === film.man!.replay && v[26] > 0.5) {
    out[0] = v[27] * x + v[31] * y + v[35] * z + v[39]; out[1] = v[28] * x + v[32] * y + v[36] * z + v[40]; out[2] = v[29] * x + v[33] * y + v[37] * z + v[41]
    return
  }
  const s = SLOTS[i]
  out[0] = s.x + x; out[1] = s.base + y; out[2] = z + (i === world.wall.ex.rent ? v[25] : 0)
}
export function faceToWorld(i: number, x: number, y: number, z: number): [number, number, number] {
  faceInto(W3, i, x, y, z); return [W3[0], W3[1], W3[2]]
}

// ---- What the scene used to set in world ----
const toScreen = (x: number, y: number, z: number) => {
  projInto(P4, x, y, z)
  const [X, Y] = toView(P4[0], P4[1])
  return { x: X, y: Y, z: P4[3] > 0 ? P4[2] : 2 }
}
const CX = [-G.FW / 2, G.FW / 2, G.FW / 2, -G.FW / 2], CY = [G.FT, G.FT, G.FB, G.FB]
const AKEYS = ['part.0', 'part.1', 'part.2', 'part.3', 'part.4', 'part.5', 'part.6', 'sheet']
function publish() {
  const v = film.cur
  world.toScreen = toScreen
  const W = innerWidth, H = innerHeight
  const zk = zoom > 0 ? 1 + 0.14 * zoom : 1
  for (let i = 0; i < NSLOTS; i++) {
    let r = world.rects.get(i)
    if (!r) { r = { x: 0, y: 0, w: 0, h: 0, q: new Array(8).fill(0), vis: false }; world.rects.set(i, r) }
    const q = r.q!
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, front = true
    for (let k = 0; k < 4; k++) {
      faceInto(W3, i, CX[k], CY[k], 0); projInto(P4, W3[0], W3[1], W3[2])
      let X = film.ox + P4[0] * film.s, Y = film.oy + P4[1] * film.s
      if (zk !== 1) { X = zx + (X - zx) * zk; Y = zy + (Y - zy) * zk }
      q[k * 2] = X; q[k * 2 + 1] = Y
      if (P4[3] <= 0 || P4[2] >= 1) front = false
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y
    }
    r.x = x0; r.y = y0; r.w = x1 - x0; r.h = y1 - y0
    r.vis = front && film.vis[i] >= 5 && x1 > 0 && x0 < W && y1 > 0 && y0 < H
  }
  for (let j = 0; j < AKEYS.length; j++) {
    const vv = v[43 + j * 3 + 2]
    if (vv > 0.001) {
      const [X, Y] = toView(v[43 + j * 3], v[43 + j * 3 + 1])
      const a = world.anchors.get(AKEYS[j])
      if (a) { a.x = X; a.y = Y; a.vis = vv } else world.anchors.set(AKEYS[j], { x: X, y: Y, vis: vv })
    } else world.anchors.delete(AKEYS[j])
  }
  world.frontal = v[23] > 0.5
  world.wallX = PHONE ? 0 : Math.round(toView(v[24], 0)[0])
}
/** The sled under a screen point: quad of its facade, visible sleds only, outside the text-column fade */
function pick(px: number, py: number) {
  const m = film.man; if (!m) return -1
  const [fx] = fromView(px, py)
  if (!PHONE && fx / m.filmW < film.cur[19] - 0.02) return -1
  for (const [i, r] of world.rects) {
    if (!r.vis || !r.q || px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) continue
    const q = r.q
    let inside = true
    for (let k = 0; k < 4; k++) {
      const ax = q[k * 2], ay = q[k * 2 + 1], bx = q[(k * 2 + 2) % 8], by = q[(k * 2 + 3) % 8]
      if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) < 0) { inside = false; break }
    }
    if (inside) return i
  }
  return -1
}

type Hook = () => void
const hooks = new Set<Hook>()
/** After each film update (sled layer) */
export const onFilm = (f: Hook) => { hooks.add(f); return () => { hooks.delete(f) } }

/** Level 3: Retina brought down to desktop (same positions and metadata, shared sheets) */
function downTier() {
  const all = (window as W).__FILM_MAN
  if (SET !== 'retina' || !all?.desktop) return
  SET = 'desktop'; film.set = SET; BASE = `${ROOT}${SET}/`
  const d = all.desktop
  for (const k of [...bm.keys()]) drop(k)
  blobs.length = 0; state.fill(0); nLoaded = 0; allLoaded = false
  film.man = { ...film.man!, w: d.w, h: d.h, ext: d.ext }
  if (OFF && workers.length) workers[0].w.postMessage({ type: 'size', w: d.w, h: d.h })
  else { cv.width = d.w; cv.height = d.h; g.imageSmoothingQuality = 'low' }
  film.budget = 300e6; film.level = Math.max(film.level, 3); dirty = true
  schedule()
}

// ---- Motion level behind a loading gate (?gate=1) ----
// The film is drawn from a compact motion level that is complete in the browser before the first gesture: a pack
// (lite.bin: one frame in 2 at a third of the size; motion.bin: every frame at half size), owned and decoded by its
// own worker (pack.worker.ts) in the order of the path ahead. The scroll draws only from it: no frame is fetched while
// the image moves, the two neighbouring frames are blended at every speed, and the motion canvas has the pack's size.
// The sharp frame is fetched and faded in over it (#film-sharp) only once the scroll rests. Today's film stays the
// default and the fallback (pack missing or wrong, worker error, no first frames): decided before the first gesture.
// ?rb=0 (comparison): the reading blur under the landing's text columns (styles.css, a backdrop-filter re-blurred on
// every frame where the film moves under it) becomes a still shade (video.css). Measured 20/11 in headless Chromium,
// 1440x900: with the blur the page renders at 30 frames per second while the film moves, without it at 60
if (Q.get('rb') === '0') document.documentElement.classList.add('rb-off')
const GATE_DEFAULT = false
export const GATE = Q.get('gate') === '1' || (GATE_DEFAULT && Q.get('gate') !== '0' && !FIREFOX && !CONN?.saveData)
/** The progressive film, nothing blocks (section "Progressive film" below): the default (?prog=0: today's film); not
 *  with ?gate=1, nor in Firefox or on a data saver (today's film, as GATE_DEFAULT would do) */
const PROG_DEFAULT = true
export const PROG = !GATE && (Q.get('prog') === '1' || (PROG_DEFAULT && Q.get('prog') !== '0' && !FIREFOX && !CONN?.saveData))
// the first frame (the poster) shows as soon as this module runs: the page-transition veil (ui/veil.ts) waits for
// nothing on the progressive film
if (PROG) { const h = document.documentElement; if (!h.classList.contains('veil-off')) { h.classList.remove('veil-on'); h.classList.add('veil-off') } }
/** The motion pack, next to the set's frames (Retina uses the desktop one); ?pack= overrides. motion.bin (10.3 MB
 *  desktop, 10.5 MB phone, 960x600 and 390x844): the gate opens at the end of its one-in-2 layer (5.2 MB), the odd
 *  frames keep streaming in the worker. Measured 20/11 at 3.5 Mbit/s: gate 15 s, 0% of moving refreshes more than 1
 *  frame off; ?pack=lite.bin: gate 8 s, the same 0% with frames 2 apart at 640x400 */
const PACK = /^[\w.-]+$/.test(Q.get('pack') ?? '') ? Q.get('pack')! : 'motion.bin'
/** The pack starts as soon as this module runs, with meta.bin (preloaded by index.html), before the fonts and the
 *  first render; mountMotion takes the worker over and replays what it said meanwhile (about a second earlier at the
 *  gate) */
const early = (() => {
  if ((!GATE && !PROG) || REDUCED || CONN?.saveData) return null
  const man = (window as W).__FILM_MAN?.[SET]
  if (!man) return null
  const set = man.ysFrom ?? SET
  const meta = fetch(`${ROOT}${set}/meta.bin`, { priority: 'high' } as RequestInit).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
  const e = { meta, w: null as Worker | null, q: [] as [number, MessageEvent][], t0: performance.now(), failed: false }
  try { e.w = new Worker(new URL('./pack.worker.ts', import.meta.url), { type: 'module' }) } catch { return e }
  // kept with their arrival time (the rate is measured on it)
  e.w.onmessage = (m) => { e.q.push([performance.now(), m]) }
  e.w.onerror = () => { e.failed = true }
  // ?prog=1 starts with the light pack (lite.bin) at once, without waiting for meta.bin (its version): the worker skips
  // the fingerprint check (fp 0) and mountProg checks it on the pack's header (a pack made for another capture is
  // fetched again, versioned); the motion pack follows it
  if (PROG) e.w.postMessage({ type: 'pack', url: `${ROOT}${set}/lite.bin`, n: man.n, fp: 0 })
  else void meta.then((buf) => { if (buf && e.w) { const fp = fingerprint(new Uint8Array(buf)); e.w.postMessage({ type: 'pack', url: `${ROOT}${set}/${PACK}?v=${fp.toString(36)}`, n: man.n, fp }) } })
  return e
})()
const M = {
  w: 0, h: 0, count: 0, total: 0, gateAt: 0, got: 0, ks: new Int32Array(0), ends: new Int32Array(0), pj: 0,
  present: new Uint8Array(0), head: false, done: false, cached: false, fail: '',
  bm: new Map<number, ImageBitmap>(), bytes: 0, budget: LIGHT ? 80e6 : 160e6,
  gen: 0, sig: 0, wantSet: new Set<number>(), wantList: [] as number[],
  rate: 0, rT: 0, rG: 0, t0: 0, tHead: 0, metaBytes: 0,
  /** wait: behind the gate; open: motion film; stops: way in without the motion film; fallback: today's film */
  gate: 'wait' as 'wait' | 'open' | 'stops' | 'fallback',
  tPack: 0, tRing: 0, tOpen: 0, sMaxIn: 0, rT0: 0, rG0: 0,
}
let pw: Worker | null = null, sw: Worker | null = null
let mStamp = new Uint32Array(0), mSV = 1, mDirty = true, mPos = NaN, heldFrom = NaN, lastDrawnPos = NaN, mShown = false
const WG = window as unknown as { __filmGate?: string; __copilotP?: Promise<unknown>; __filmM?: unknown }
/** The loading fraction for the header bar: meta.bin and the pack up to its gate point */
export const gateFrac = () => (M.head ? Math.min(1, (M.metaBytes + Math.min(M.got, M.gateAt)) / (M.metaBytes + M.gateAt)) : 0.04)
function rateOn(got: number, now: number) {
  // the first 128 KB carry the request's round trip and the slow start
  if (got < 131072) return
  if (!M.rT) { M.rT = now; M.rG = got; return }
  const dt = (now - M.rT) / 1000
  if (dt < 0.25) return
  const inst = (got - M.rG) / dt
  M.rate = M.rate ? M.rate + (inst - M.rate) * (1 - Math.exp(-dt / 1.5)) : inst
  M.rT = now; M.rG = got
  film.rate = Math.round(M.rate * 8 / 1e4) / 100
}
function arrive() {
  while (M.pj < M.count && M.ends[M.pj] <= M.got) { M.present[M.ks[M.pj]] = 1; M.pj++ }
  film.liteN = M.pj
}
/** The two pack frames around position p: the last one at or below p, the next one (-1: none within 8 frames) */
function bracket(p: number): [number, number] {
  const n = film.man!.n, f = Math.min(n - 1, Math.max(0, Math.floor(p)))
  let a = f; while (a > 0 && !M.present[a] && f - a < 8) a--
  if (!M.present[a]) a = -1
  let b = f + 1; while (b < n - 1 && !M.present[b] && b - f < 8) b++
  if (b >= n || !M.present[b]) b = -1
  return [a, b]
}
const posAtQ = (y: number) => { const pr = liveTops.protocol; return posAt(y, pr ? Math.min(1, Math.max(0, (y - pr[0]) / Math.max(1, pr[1] - innerHeight))) : 0) }
/** What the motion worker decodes, in order: moving, every 2nd frame over the next 0.8 s of the path, then the odd
 *  ones (a slow decoder degrades to frames 2 apart, blended, never to a hold), then 12 behind; at rest, the ring
 *  around the position, then the way to the next stop and to the previous one. Bounded by the memory budget. */
function wantsM() {
  const m = film.man!, n = m.n
  if (!M.head || !pw) return
  const maxF = Math.max(8, Math.floor(M.budget / (M.w * M.h * 4)) - 2)
  mSV++
  const list: number[] = []
  const add = (k: number) => { if (k >= 0 && k < n && M.present[k] && mStamp[k] !== mSV && list.length < maxF) { mStamp[k] = mSV; list.push(k) } }
  const nf = predict(48)
  const travel = nf > 0 && Math.abs(fut[nf] - fut[0]) > 0.5
  const k0 = Math.min(n - 1, Math.max(0, Math.floor(film.pos)))
  const [a, b] = bracket(film.pos); add(a); add(b)
  if (travel) {
    const path: number[] = []
    let last = k0
    for (let i = 1; i <= nf; i++) {
      const f = Math.min(n - 1, Math.max(0, Math.floor(fut[i])))
      if (f > last) for (let k = last + 1; k <= Math.min(n - 1, f + 1); k++) path.push(k)
      else if (f < last) for (let k = last - 1; k >= f; k--) path.push(k)
      last = f
    }
    for (const k of path) if ((k & 1) === 0) add(k)
    for (const k of path) add(k)
    for (let i = 1; i <= 12; i++) add(k0 - i * dir)
  } else {
    for (let i = 1; i <= 16; i++) { add(k0 + i * dir); add(k0 + 1 - i * dir) }
    const p = film.pos
    const up = stopF.find((x) => x > p + 1), dn = [...stopF].reverse().find((x) => x < p - 1)
    for (const s of dir >= 0 ? [up, dn] : [dn, up]) {
      if (s === undefined) continue
      const st = s > p ? 1 : -1, end = st > 0 ? Math.min(n - 1, Math.ceil(s) + 1) : Math.max(0, Math.floor(s) - 1)
      for (let pass = 0; pass < 2; pass++) for (let k = k0; st > 0 ? k <= end : k >= end; k += st) if (pass || (k & 1) === 0) add(k)
    }
  }
  let h = list.length
  for (const k of list) h = (Math.imul(h, 31) + k) | 0
  if (h === M.sig) return
  M.sig = h; M.wantList = list; M.wantSet = new Set(list)
  pw.postMessage({ type: 'want', gen: ++M.gen, ks: list })
}
function dropM(k: number) { const b = M.bm.get(k); if (!b) return; M.bytes -= b.width * b.height * 4; b.close(); M.bm.delete(k) }
/** Over the budget: what is not wanted goes first, farthest first (behind counts as farther), then the end of the list */
function evictM() {
  if (M.bytes <= M.budget) return
  const p = film.pos, out: number[] = []
  const cand: number[] = []
  for (const k of M.bm.keys()) if (!M.wantSet.has(k) && k !== pickK && k !== pickB) cand.push(k)
  cand.sort((x, y) => score(y, p) - score(x, p))
  for (const k of cand) { if (M.bytes <= M.budget) break; dropM(k); out.push(k) }
  for (let i = M.wantList.length - 1; i >= 0 && M.bytes > M.budget; i--) { const k = M.wantList[i]; if (k !== pickK && k !== pickB && M.bm.has(k)) { dropM(k); out.push(k) } }
  film.bytes = M.bytes
  if (out.length) pw?.postMessage({ type: 'evict', ks: out })
}
/** The motion frame(s) for position p: the decoded frames on either side of it (at most 4 apart: the two pack frames
 *  around it, or, while the odd frames of motion.bin are not decoded yet, the even ones), blended at the fraction, at
 *  every speed; otherwise the nearest decoded frame within 3 (ahead first); otherwise nothing (the refresh holds) */
function chooseM(p: number): boolean {
  const n = film.man!.n, f = Math.min(n - 1, Math.max(0, Math.floor(p)))
  let a = -1, b = -1
  for (let k = f; k >= Math.max(0, f - 3); k--) if (M.bm.has(k)) { a = k; break }
  for (let k = f + 1; k <= Math.min(n - 1, f + 4); k++) if (M.bm.has(k)) { b = k; break }
  pickB = -1; pickA = 0
  if (a >= 0 && p - a < 1 / 128) { pickK = a; mPos = a; return true }
  if (b >= 0 && b - p < 1 / 128) { pickK = b; mPos = b; return true }
  if (a >= 0 && b >= 0 && b - a <= 4) {
    const al = Math.round(((p - a) / (b - a)) * 64) / 64
    pickK = a; if (al > 0) { pickB = b; pickA = al }
    mPos = a + al * (b - a); return true
  }
  const t = Math.round(p)
  for (let d = 0; d <= 3; d++) {
    const x = t + d * dir, y = t - d * dir
    if (M.bm.has(x)) { pickK = x; mPos = x; return true }
    if (d && M.bm.has(y)) { pickK = y; mPos = y; return true }
  }
  return false
}
function drawM(): number {
  const t0 = performance.now()
  const A = M.bm.get(pickK)!
  if (A.width === cv.width) g.drawImage(A, 0, 0); else g.drawImage(A, 0, 0, cv.width, cv.height)
  const B = pickB >= 0 ? M.bm.get(pickB) : undefined
  if (B) { g.globalAlpha = pickA; if (B.width === cv.width) g.drawImage(B, 0, 0); else g.drawImage(B, 0, 0, cv.width, cv.height); g.globalAlpha = 1 }
  if (CAL) bands(g, cv.width, cv.height, Math.round(mPos))
  return performance.now() - t0
}
// ---- The sharp layer: fetched, decoded and faded in at rest only ----
const sharpC = new Map<number, ImageBitmap>()
let sharpMax = 6, sharpK = -1, sharpOn = false, sharpWant = -1, sharpUpTick = -1, tickN = 0, sId = 0, fadeK = -1, fadeT0 = 0, fadeU = 0
const sFetch = new Set<number>(), sDec = new Set<number>(), sJobs = new Map<number, number>()
let stopKs: number[] = [], stopKsOf: number[] | null = null, stopKsLim = -1
const sInflight = () => (film.rate >= 8 ? 4 : 2)
function sharpGet(k: number, dec: boolean) {
  const m = film.man!
  if (k < 0 || k >= m.n || sharpC.has(k)) return
  const b = blobs[k]
  if (b) {
    if (dec && sw && !sDec.has(k) && sDec.size < 2) { sDec.add(k); const id = ++sId; sJobs.set(id, k); sw.postMessage({ type: 'dec', id, k, sheet: false, blob: b }) }
    return
  }
  if (sFetch.has(k) || sFetch.size >= sInflight()) return
  sFetch.add(k)
  const s0 = SET
  fetchOne(name(k, m.ext), true, (bl) => { sFetch.delete(k); if (s0 !== SET) return; if (bl && !blobs[k]) blobs[k] = bl; if (bl && k === sharpWant) sharpGet(k, true) })
}
function sharpDone(id: number, bmp: ImageBitmap | null) {
  const k = sJobs.get(id); sJobs.delete(id)
  if (k === undefined) { bmp?.close(); return }
  sDec.delete(k)
  if (!bmp) return
  sharpC.get(k)?.close(); sharpC.delete(k); sharpC.set(k, bmp)
  // at most sharpMax bitmaps, least recently used first (never the one wanted now)
  for (const old of sharpC.keys()) { if (sharpC.size <= sharpMax) break; if (old === sharpWant) continue; sharpC.get(old)!.close(); sharpC.delete(old) }
  film.sharpN = sharpC.size
}
/** Where the scroll will rest: the end of the stop trip, or the Lenis target once it holds still */
let lenT = NaN, lenTAt = 0
function landingK(now: number): number {
  const tr = step.trip
  if (tr) return Math.round(posAtQ(tr.y1))
  const l = getLenis(); if (!l) return -1
  if (l.targetScroll !== lenT) { lenT = l.targetScroll; lenTAt = now; return -1 }
  return now - lenTAt > 80 ? Math.round(posAtQ(lenT)) : -1
}
function showSharp(on: boolean, fade: boolean) {
  if (!cvS) return
  sharpOn = on
  cvS.style.transition = on && fade ? 'opacity 120ms linear' : 'none'
  cvS.style.opacity = on ? '1' : '0'
}
function sharpTick(rest: boolean, now: number, onFirstDraw: () => void) {
  // nothing sharp before the pack has reached its gate point (it gives the rate the sharp set is chosen on, and the
  // link is the pack's until then), except on the way in without the motion film; ?prog=1: nothing fetched before the
  // light pack is in, the sharp frames already there (the poster) shown at rest
  const fetchOk = PROG ? PG.sharpOk : !!M.tPack || M.gate === 'stops'
  if (!cvS || !gS || (!fetchOk && !(PROG && sharpC.size))) return
  const k = rest ? (restK >= 0 ? restK : Math.round(film.pos)) : landingK(now)
  if (k >= 0) { sharpWant = k; if (fetchOk) sharpGet(k, true) }
  if (rest && k >= 0 && (sharpK !== k || !sharpOn)) {
    if (sharpK === k) showSharp(true, !REDUCED)
    else {
      const b = sharpC.get(k)
      // one new sharp bitmap per display frame (Safari blocks on each upload)
      if (b && sharpUpTick !== tickN) {
        sharpUpTick = tickN
        // the way in without the motion film: the next stop's frame cross-fades over the one shown (250 ms)
        if (M.gate === 'stops' && sharpOn && sharpK >= 0 && !REDUCED && !CONN?.saveData) { fadeK = k; fadeT0 = now; fadeU = 0 }
        else {
          fadeK = -1
          if (b.width === cvS.width) gS.drawImage(b, 0, 0); else gS.drawImage(b, 0, 0, cvS.width, cvS.height)
          if (CAL) bands(gS, cvS.width, cvS.height, k)
        }
        sharpC.delete(k); sharpC.set(k, b)
        sharpK = k
        showSharp(true, !REDUCED && M.gate !== 'stops')
        // the way in without the motion film: the motion frame under it goes once a sharp frame covers it
        if (M.gate === 'stops' && cv.style.opacity !== '0') cv.style.opacity = '0'
        onFirstDraw()
      }
    }
  }
  // the cross-fade: the new frame drawn over the canvas with a weight that makes the mix grow linearly with time
  if (fadeK >= 0) {
    const b = sharpC.get(fadeK)
    if (!b || fadeK !== sharpK) fadeK = -1
    else {
      const u = Math.min(1, (now - fadeT0) / 250), al = u >= 1 ? 1 : (u - fadeU) / (1 - fadeU)
      if (al > 0) { gS.globalAlpha = al; if (b.width === cvS.width) gS.drawImage(b, 0, 0); else gS.drawImage(b, 0, 0, cvS.width, cvS.height); gS.globalAlpha = 1; fadeU = u }
      if (u >= 1) { if (CAL) bands(gS, cvS.width, cvS.height, fadeK); fadeK = -1 }
    }
  }
  // once the pack is in: the stops' sharp frames (desktop, the stop trips land there), then 2 frames around the rest
  // (?prog=1: once the motion pack is in)
  if ((PROG ? PG.stopsOk : M.done || M.gate === 'stops') && sFetch.size < sInflight()) {
    // with the top (Home) and the end of the page (End lands at Lenis's limit, 76 px below the last stop)
    const lim = getLenis()?.limit ?? -1
    if (stopKsOf !== stopF || lim !== stopKsLim) {
      stopKsOf = stopF; stopKsLim = lim
      const ks = stopF.map((x) => Math.round(x))
      ks.push(Math.round(posAtQ(0)))
      if (lim > 0) ks.push(Math.round(posAtQ(lim)))
      stopKs = PHONE ? [] : [...new Set(ks)]
    }
    for (const s of stopKs) { if (sFetch.size >= sInflight()) break; if (!blobs[s]) sharpGet(s, false) }
    if (rest && k >= 0) for (const d of [1, -1, 2, -2]) { if (sFetch.size >= sInflight()) break; if (!blobs[k + d]) sharpGet(k + d, false) }
  }
}
/** The sharp set, once, when the pack has given a rate: Retina only for a Retina screen on 10 Mbit/s or more */
function decideSharpSet() {
  const all = (window as W).__FILM_MAN
  if (!all || Q.get('set') || PHONE || SET === 'phone') return
  const screen = devicePixelRatio > 1.5 && innerWidth * devicePixelRatio > 2300 && matchMedia('(pointer: fine)').matches
  const want = screen && film.rate >= 10 && all.retina ? 'retina' : 'desktop'
  if (want !== SET && all[want]) {
    SET = want; film.set = SET; BASE = `${ROOT}${SET}/`
    const d = all[want]
    film.man = { ...film.man!, w: d.w, h: d.h, ext: d.ext }
    blobs.length = 0
  }
  sharpMax = SET === 'retina' ? 4 : 6
  if (cvS && (cvS.width !== film.man!.w || cvS.height !== film.man!.h)) { cvS.width = film.man!.w; cvS.height = film.man!.h; sharpK = -1; showSharp(false, false) }
}
function gotBmp(k: number, bmp: ImageBitmap) {
  if (M.bm.has(k) || !pw) { bmp.close(); return }
  M.bm.set(k, bmp); M.bytes += bmp.width * bmp.height * 4; film.bytes = M.bytes
  if (!M.wantSet.has(k) && M.bytes > M.budget) { dropM(k); film.bytes = M.bytes; pw.postMessage({ type: 'evict', ks: [k] }); return }
  evictM()
}
// ---- The gate: what it waits for, then open ----
let gateT0 = 0, gateUiAt = 0, copDone = false, gateResolve: ((ok: boolean) => void) | null = null
let restAt = 0, dK = -2, dB = -2, dA = -1, lastMetaPos = NaN, tripWas = false, tripEnd = 0
/** The scroll stops (story.ts) as the film last mapped them: they appear as the sections mount, and they move when
 *  Lenis updates its limit (250 ms after a change of page height). The mapping follows every change, and the gate
 *  opens only on stops that have held for 3 refreshes (a return visit opened before they existed: its first trip ran
 *  ahead on the linear page, then jumped back 27 to 45 frames when the mapping came) */
let stSig = 0, stN = 0, stSame = 0, gateOkAt = 0
function stopsCheck() {
  const st = (window as unknown as { __stops?: () => { y: number }[] }).__stops?.()
  let h = st ? st.length : 0
  if (st) for (const x of st) h = (Math.imul(h, 31) + x.y) | 0
  if (h === stSig) { stSame++; return }
  stSig = h; stN = st ? st.length : 0; stSame = 0
  if (stN >= 2) measure()
}
/** The first motion frames: every frame wanted at the position decoded (the ring and the way to the next stop), or
 *  the first 48 of them one second after the pack */
function ringDecoded(now: number): boolean {
  const L = M.wantList
  if (!L.length) return false
  let i = 0
  for (; i < L.length; i++) if (!M.bm.has(L[i])) break
  return i === L.length || (i >= Math.min(48, L.length) && now - M.tPack > 1000)
}
function openGate() {
  // the forced layouts of a first gesture happen here, behind the gate
  measure(); document.elementFromPoint(innerWidth / 2, innerHeight / 2)
  lockScroll(false); closeGate()
  M.gate = 'open'; WG.__filmGate = 'open'; M.tOpen = performance.now()
  gateResolve?.(true); gateResolve = null
}
/** The way in without the motion film: the sharp frame at each rest, nothing drawn in motion; the film takes over at a
 *  rest once its frames are in */
function enterStops() {
  if (M.gate !== 'wait') return
  M.gate = 'stops'; WG.__filmGate = 'stops'
  // the motion frame (or the poster) stays until the first sharp frame is drawn over it (sharpTick hides it then):
  // the film area went blank for about 380 ms at 3.5 Mbit/s
  if (sharpOn) { cv.style.opacity = '0'; showSharp(true, false) }
  lockScroll(false); closeGate()
  gateResolve?.(true); gateResolve = null
}
function gateTick(now: number, rest: boolean) {
  if (M.gate === 'open' || M.gate === 'fallback') return
  if (M.fail && M.gate === 'wait') { gateResolve?.(false); gateResolve = null; return }
  const packOk = M.head && M.got >= M.gateAt
  if (packOk && !M.tPack) { M.tPack = now; decideSharpSet() }
  const ringOk = packOk && ringDecoded(now)
  if (ringOk && !M.tRing) M.tRing = now
  if (M.gate === 'stops') {
    if (ringOk && rest && film.ready && !REDUCED && !CONN?.saveData) { M.gate = 'open'; WG.__filmGate = 'open'; mShown = false; mDirty = true }
    return
  }
  if (packOk && !ringOk && now - M.tPack > 5000) { M.fail = 'ring'; gateResolve?.(false); gateResolve = null; return }
  // shown only if the film is not ready 400 ms after the mount (a return visit never sees it)
  if (!gateShown() && ((now - gateT0 > 400 && !packOk) || (now - gateT0 > 1500 && !(ringOk && film.ready)))) showGate(enterStops)
  if (gateShown() && now - gateUiAt > 250) {
    gateUiAt = now
    const tot = M.head ? M.metaBytes + M.gateAt : 0, got = M.head ? M.metaBytes + Math.min(M.got, M.gateAt) : 0
    const eta = M.rate > 0 && now - M.t0 > 500 ? Math.max(0, tot - got) / M.rate : -1
    updateGate(got, tot, eta, now - gateT0 > 3000 || eta > 20)
  }
  const k = Math.round(film.pos)
  // the first rest sharp, if it comes soon (motion.bin's odd frames are still streaming and share the link)
  const sharpOk = ringOk && ((sharpOn && sharpK === k) || now - M.tRing > 800)
  const copOk = copDone || (M.tPack > 0 && now - M.tPack > 2000)
  // and the stops held (at most 2 s more: the page then opens on what it has, the mapping follows later changes)
  if (!(ringOk && sharpOk && copOk)) { gateOkAt = 0; return }
  if (!gateOkAt) gateOkAt = now
  if ((stN >= 2 && stSame >= 3) || now - gateOkAt > 2000) openGate()
}
function tickM(dt: number, firstDraw: () => void) {
  if (!film.man) return
  tickN++
  const now = performance.now()
  stopsCheck()
  if (SY.length < 2 && UNI > 0 && (++segTry & 31) === 1) segs()
  const p = posAt(scrollY(), world.protoQ)
  if (p - lastPos > 0.5) { dir = 1; lastPos = p } else if (lastPos - p > 0.5) { dir = -1; lastPos = p }
  const changed = p !== film.pos, dp = Math.abs(p - film.pos)
  if (dt > 0) vel = vel * 0.6 + 0.4 * (p - film.pos) / Math.max(1 / 240, dt)
  film.pos = p
  // displayed position: the target; at rest, a glide to the nearest whole frame (as today)
  if (dp > 0.02 || Math.abs(dpos - p) > 1.5) dpos = p
  else {
    if (restK < 0 || Math.abs(p - restK) > 0.6) restK = Math.round(p)
    const r = restK; dpos += (r - dpos) * (1 - Math.exp(-Math.max(dt, 1 / 240) / 0.05)); if (Math.abs(r - dpos) < 1 / 64) dpos = r
  }
  if (dp > 0.02) restK = -1
  const moved = dp > 0.02 || !!step.trip
  if (moved) restAt = now
  // a stop trip that has ended is a rest at once (its end is the stop); a free scroll counts as resting after 150 ms
  if (tripWas && !step.trip) tripEnd = now
  tripWas = !!step.trip
  const rest = !moved && (now - restAt >= 150 || (tripEnd > 0 && now - tripEnd < 400))
  const stops = M.gate === 'stops'
  // the sharp layer goes the moment the image moves, in the same refresh as the motion draw
  if (moved && sharpOn && !stops) showSharp(false, false)
  wantsM()
  const wantZ = world.svc.open ? 1 : 0
  const z0 = zoom
  zoom = REDUCED ? wantZ : Math.min(1, Math.max(0, zoom + (wantZ ? dt : -dt) / 0.9))
  world.svc.u = zoom
  if (zoom > 0 && world.svc.slot >= 0 && z0 === 0) { const r = world.rects.get(world.svc.slot); if (r) { zx = r.x + r.w / 2; zy = r.y + r.h / 2 } }
  if (!world.svc.open && zoom === 0) world.svc.slot = -1
  let geoMoved = false
  if (zoom !== z0) { applyZoom(); geoMoved = true }
  let ms = 0, pos = NaN
  if (stops) pos = sharpK >= 0 ? sharpK : NaN
  else if (chooseM(dpos)) {
    pos = mPos
    if (mDirty || pickK !== dK || pickB !== dB || pickA !== dA) {
      ms = drawM(); mDirty = false; dK = pickK; dB = pickB; dA = pickA; film.drawn++
      // the motion canvas shows from its first frame (the sharp layer may have been drawn before it)
      if (!mShown) { mShown = true; cv.style.opacity = '1'; firstDraw() }
    }
  } else pos = lastMetaPos
  // the metadata of the drawn position (every frame has its own in meta.bin, even those not in the pack)
  if (!Number.isNaN(pos) && pos !== lastMetaPos) {
    const a = Math.floor(pos), f = pos - a
    metaAt(a, f > 0 ? Math.min(film.man.n - 1, a + 1) : -1, f)
    film.shown = Math.round(pos); film.def = 0
    lastMetaPos = pos; geoMoved = true
  }
  if (geoMoved) { film.geo++; publish() }
  if (!Number.isNaN(pos) && pos !== lastDrawnPos) { lastDrawnPos = pos; heldFrom = p }
  const held = changed && !Number.isNaN(heldFrom) && Math.abs(p - heldFrom) >= 0.5 ? 1 : 0
  sharpTick(rest, now, firstDraw)
  if (sFetch.size > M.sMaxIn) M.sMaxIn = sFetch.size
  const q = log.n & (LOGN - 1)
  log.t[q] = now; log.p[q] = p; log.s[q] = film.shown; log.d[q] = 0; log.ms[q] = ms; log.mv[q] = changed || moved ? 1 : 0; log.tk[q] = tick.prev
  log.pos[q] = Number.isNaN(pos) ? -1 : pos; log.kind[q] = sharpOn ? 2 : Number.isNaN(pos) ? 0 : 1; log.held[q] = held; log.n++
  gateTick(now, rest)
  film.version++
  hooks.forEach((f) => f())
}
/** The motion path: false when the pack cannot be used (today's film then runs, before any gesture) */
async function mountMotion(man: Manifest, fp: number, metaBytes: number, onFirst: () => void): Promise<boolean> {
  const n = man.n, set0 = SET, man0 = film.man
  M.present = new Uint8Array(n); mStamp = new Uint32Array(n); M.metaBytes = metaBytes
  cvS = document.createElement('canvas'); cvS.className = 'film film-sharp'
  cv.after(cvS)
  cvS.width = man.w; cvS.height = man.h
  gS = cvS.getContext('2d', { alpha: false })
  g = cv.getContext('2d', { alpha: false, desynchronized: false })!; g.imageSmoothingQuality = 'low'
  sharpMax = SET === 'retina' ? 4 : 6
  try {
    sw = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' })
    sw.onmessage = (e: MessageEvent<{ id: number; bmp?: ImageBitmap }>) => sharpDone(e.data.id, e.data.bmp ?? null)
  } catch { sw = null }
  world.pick = pick
  place()
  addEventListener('resize', place)
  const ro = new ResizeObserver(() => measure()); ro.observe(document.body)
  const wake = () => { if (document.visibilityState === 'visible') mDirty = true }
  document.addEventListener('visibilitychange', wake); addEventListener('pageshow', wake)
  film.pos = posAt(scrollY(), world.protoQ); lastPos = film.pos; dpos = film.pos
  WG.__filmGate = 'wait'
  if (WG.__copilotP) WG.__copilotP.then(() => { copDone = true }, () => { copDone = true }); else copDone = true
  WG.__filmM = () => ({ gate: M.gate, fail: M.fail, head: M.head, got: M.got, gateAt: M.gateAt, total: M.total, arrived: M.pj, count: M.count, w: M.w, h: M.h, bm: M.bm.size, bytes: M.bytes, want: M.wantList.length, gen: M.gen, rate: film.rate, sharpN: sharpC.size, sharpK, sharpOn, sMaxIn: M.sMaxIn, t0: M.t0, tHead: M.tHead, tPack: M.tPack, tRing: M.tRing, tOpen: M.tOpen, cached: M.cached, done: M.done, set: SET, pack: PACK })
  const firstDraw = () => {
    if (film.ready) return
    film.ready = true; world.sceneReady = true
    const ps = document.getElementById('poster'); if (ps) ps.style.visibility = 'hidden'
    onFirst()
  }
  // reduced motion or a data saver: no gate and no pack, the sharp frame at each rest
  if (REDUCED || CONN?.saveData) {
    M.gate = 'stops'; WG.__filmGate = 'stops'
    onTick((_t, dt) => tickM(dt, firstDraw))
    return true
  }
  if (early?.w) pw = early.w
  else try { pw = new Worker(new URL('./pack.worker.ts', import.meta.url), { type: 'module' }) } catch { pw = null }
  let off: (() => void) | null = null
  if (pw) {
    type PM = { type: 'head'; w: number; h: number; count: number; total: number; gateAt: number; ks: Int32Array<ArrayBuffer>; ends: Int32Array<ArrayBuffer> } | { type: 'prog'; got: number } | { type: 'done'; cached: boolean } | { type: 'bmp'; k: number; bmp: ImageBitmap } | { type: 'fail'; why: string }
    const onMsg = (e: MessageEvent<PM>, at = performance.now()) => {
      const d = e.data
      if (d.type === 'head') {
        M.w = d.w; M.h = d.h; M.count = d.count; M.total = d.total; M.gateAt = d.gateAt; M.ks = d.ks; M.ends = d.ends; M.head = true; M.tHead = at
        // the motion canvas has the pack's size: each frame drawn unscaled, the framing is CSS
        cv.width = d.w; cv.height = d.h; g.imageSmoothingQuality = 'low'; mDirty = true
        arrive()
      } else if (d.type === 'prog') { M.got = d.got; if (!M.rT0 && d.got >= 131072) { M.rT0 = at; M.rG0 = d.got } rateOn(d.got, at); arrive() }
      else if (d.type === 'done') {
        M.done = true; M.cached = d.cached
        const now = at
        // a pack read from a cache gives no rate: the last one measured on this browser
        if (d.cached || now - M.tHead < 300) { try { film.rate = Number(localStorage.getItem('film-rate')) || 0 } catch { /* none */ } }
        else {
          if (!M.rate && M.rT0 && now - M.rT0 > 50) { M.rate = (M.got - M.rG0) / ((now - M.rT0) / 1000); film.rate = Math.round(M.rate * 8 / 1e4) / 100 }
          try { localStorage.setItem('film-rate', String(film.rate)) } catch { /* private window */ }
        }
      } else if (d.type === 'bmp') gotBmp(d.k, d.bmp)
      else if (d.type === 'fail') M.fail = d.why || 'pack'
    }
    pw.onmessage = onMsg
    pw.onerror = () => { M.fail = M.fail || 'worker' }
    gateT0 = performance.now()
    if (early?.w === pw) {
      // started early: what the worker has said so far, in order
      M.t0 = early.t0
      for (const [at, e] of early.q) onMsg(e as MessageEvent<PM>, at)
      early.q.length = 0
      if (early.failed) M.fail = M.fail || 'worker'
    } else {
      M.t0 = gateT0
      pw.postMessage({ type: 'pack', url: `${ROOT}${man.ysFrom ?? set0}/${PACK}${VQ}`, n, fp })
    }
    lockScroll(true)
    off = onTick((_t, dt) => tickM(dt, firstDraw))
    if (await new Promise<boolean>((r) => { gateResolve = r })) return true
  }
  // today's film, decided before the first gesture
  off?.(); ro.disconnect(); document.removeEventListener('visibilitychange', wake); removeEventListener('pageshow', wake)
  pw?.terminate(); pw = null; sw?.terminate(); sw = null
  for (const b of M.bm.values()) b.close()
  M.bm.clear(); M.bytes = 0; film.bytes = 0
  for (const b of sharpC.values()) b.close()
  sharpC.clear(); blobs.length = 0
  cvS?.remove(); cvS = null; gS = null
  lockScroll(false); closeGate()
  SET = set0; film.set = SET; BASE = `${ROOT}${SET}/`; film.man = man0
  cv.style.opacity = '0'; film.ready = false; film.shown = -1
  const ps = document.getElementById('poster'); if (ps) ps.style.visibility = ''
  M.gate = 'fallback'; WG.__filmGate = 'fallback'
  console.warn(`film: motion level unavailable (${M.fail || 'worker'}), today's film`)
  return false
}

// ---- Progressive film (?prog=1) ----
// Nothing blocks: the first frame (the poster, sharp) is on screen as soon as the page script runs, and the scroll is
// free from the start. The film's levels load and decode in the background, each pack in its own worker
// (pack.worker.ts), in this order: the light pack (lite.bin, 2.2 MB: one frame in 2 at a third of the size, ordered one
// in 8, in 4, then in 2, so its first layer covers the start of the film within a few hundred KB; used as it arrives),
// then the motion pack (motion.bin, 10.3 MB: every frame at half size), then the sharp frames (at rest and at the end
// of a stop trip once the light pack is in; the stops' and the neighbours of a rest once the motion pack is in). While
// moving, the motion canvas draws the active level only, from decoded frames: the two around the position, blended (at
// most 8 apart in the light level, 4 in the motion one), otherwise the nearest one, otherwise the image holds; never a
// fetch, never an empty canvas (the poster stays under it until its first frame). The motion level takes over at a
// rest, once its one-in-2 layer is in and its frames at the position are decoded: the light frame on screen
// cross-fades into it (250 ms). A thin line at the bottom of the film shows the full version loading; a return visit,
// whose packs come from the Cache API, never shows it.
type PackMsg = { type: 'head'; w: number; h: number; count: number; total: number; gateAt: number; ks: Int32Array<ArrayBuffer>; ends: Int32Array<ArrayBuffer>; fp?: number } | { type: 'prog'; got: number } | { type: 'done'; cached: boolean } | { type: 'bmp'; k: number; bmp: ImageBitmap } | { type: 'fail'; why: string }
type Pk = {
  w0: Worker | null; w: number; h: number; count: number; total: number; gateAt: number; got: number
  ks: Int32Array; ends: Int32Array; pj: number; present: Uint8Array; head: boolean; done: boolean; cached: boolean; fail: string
  bm: Map<number, ImageBitmap>; bytes: number; budget: number; gen: number; sig: number; wantSet: Set<number>; wantList: number[]
  stamp: Uint32Array; sv: number; keep: [number, number]; gap: number; t0: number; tHead: number; tGate: number; tDone: number
}
const mkPk = (budget: number, gap: number): Pk => ({ w0: null, w: 0, h: 0, count: 0, total: 0, gateAt: 0, got: 0, ks: new Int32Array(0), ends: new Int32Array(0), pj: 0, present: new Uint8Array(0), head: false, done: false, cached: false, fail: '', bm: new Map(), bytes: 0, budget, gen: 0, sig: 0, wantSet: new Set(), wantList: [], stamp: new Uint32Array(0), sv: 1, keep: [-1, -1], gap, t0: 0, tHead: 0, tGate: 0, tDone: 0 })
/** The light level (lite.bin) and the motion level (motion.bin); gap: how far apart two frames may be blended */
const PL = mkPk(LIGHT ? 40e6 : 80e6, 8), PV = mkPk(LIGHT ? 80e6 : 160e6, 4)
/** The level drawn while moving */
let act = PL
const PG = {
  sharpOk: false, stopsOk: false, fp: 0, base: '',
  t0: 0, tTrip: 0, tRing: 0, tSwitch: 0, xf0: 0, dirty: true,
  rate: 0, rT: 0, rG: 0, rT0: 0, rG0: 0, firstCalled: false, resolve: null as ((ok: boolean) => void) | null, onFirst: null as (() => void) | null,
  hint: null as HTMLDivElement | null, hintFill: null as HTMLElement | null, hintOn: false, hintAt: 0, hintGone: false,
  dP: null as Pk | null, dK: -2, dB: -2, dA: -1, sMaxIn: 0, black: 0, poster: null as HTMLImageElement | null,
}
type Pick = { k: number; b: number; a: number; pos: number }
const PK1: Pick = { k: -1, b: -1, a: 0, pos: 0 }, PK2: Pick = { k: -1, b: -1, a: 0, pos: 0 }
const posterOk = () => !!PG.poster && PG.poster.complete && PG.poster.naturalWidth > 0
function pkArrive(P: Pk) {
  while (P.pj < P.count && P.ends[P.pj] <= P.got) { P.present[P.ks[P.pj]] = 1; P.pj++ }
  if (!P.tGate && P.head && P.got >= P.gateAt) P.tGate = performance.now()
}
/** The download rate over both packs (they stream one after the other): it chooses the sharp set (Retina or not) and
 *  how many sharp requests run at once */
function rateP(now: number) {
  const got = PL.got + PV.got
  // the first 128 KB carry the request's round trip and the slow start
  if (got < 131072) return
  if (!PG.rT0) { PG.rT0 = now; PG.rG0 = got }
  if (!PG.rT) { PG.rT = now; PG.rG = got; return }
  const dt = (now - PG.rT) / 1000
  if (dt < 0.25) return
  const inst = (got - PG.rG) / dt
  PG.rate = PG.rate ? PG.rate + (inst - PG.rate) * (1 - Math.exp(-dt / 1.5)) : inst
  PG.rT = now; PG.rG = got
  film.rate = Math.round(PG.rate * 8 / 1e4) / 100
}
/** The light pack again, versioned (?v=), in a new worker: the one started before meta.bin was made for another
 *  capture (a stale cache) */
function relite() {
  const w = PL.w0
  if (w) { w.onmessage = null; w.onerror = null; w.terminate() }
  PL.w0 = null; PL.head = false; PL.got = 0; PL.pj = 0; PL.count = 0; PL.present.fill(0)
  try { PL.w0 = new Worker(new URL('./pack.worker.ts', import.meta.url), { type: 'module' }) } catch { pkMsg(PL, { type: 'fail', why: 'worker' }, performance.now()); return }
  PL.w0.onmessage = (e: MessageEvent<PackMsg>) => pkMsg(PL, e.data, performance.now())
  PL.w0.onerror = () => pkMsg(PL, { type: 'fail', why: 'worker' }, performance.now())
  PL.t0 = performance.now()
  PL.w0.postMessage({ type: 'pack', url: `${PG.base}lite.bin${VQ}`, n: film.man!.n, fp: PG.fp })
}
function pkMsg(P: Pk, d: PackMsg, at: number) {
  if (d.type === 'head') {
    if (P === PL && d.fp !== undefined && d.fp !== PG.fp) { relite(); return }
    P.w = d.w; P.h = d.h; P.count = d.count; P.total = d.total; P.gateAt = d.gateAt; P.ks = d.ks; P.ends = d.ends; P.head = true; P.tHead = at
    pkArrive(P)
    if (P === act && !mShown) sizeCv(P)
    if (P === PL) { PG.resolve?.(true); PG.resolve = null }
  } else if (d.type === 'prog') { P.got = d.got; rateP(at); pkArrive(P) }
  else if (d.type === 'done') {
    P.done = true; P.cached = d.cached; P.tDone = at; pkArrive(P)
    // a pack read from a cache gives no rate: the last one measured on this browser
    if (d.cached || at - P.tHead < 300) { if (!film.rate) try { film.rate = Number(localStorage.getItem('film-rate')) || 0 } catch { /* none */ } }
    else {
      if (!PG.rate && PG.rT0 && at - PG.rT0 > 50) { PG.rate = (PL.got + PV.got - PG.rG0) / ((at - PG.rT0) / 1000); film.rate = Math.round(PG.rate * 8 / 1e4) / 100 }
      try { localStorage.setItem('film-rate', String(film.rate)) } catch { /* private window */ }
    }
    if (P === PL) liteIn(); else PG.stopsOk = true
  } else if (d.type === 'bmp') pkGot(P, d.k, d.bmp)
  else if (d.type === 'fail') {
    if (P.fail) return
    P.fail = d.why || 'pack'
    // the light pack unusable before its header: today's film (mountProg); later, what has arrived stays in use
    if (P === PL) { if (!PL.head) { PG.resolve?.(false); PG.resolve = null } else liteIn() }
    else PG.stopsOk = true
  }
}
/** The light pack is in: the sharp set is chosen on its rate, sharp frames may be fetched, the motion pack starts */
function liteIn() {
  if (PG.sharpOk) return
  PG.sharpOk = true
  decideSharpSet()
  startMotion()
}
function startMotion() {
  if (PV.w0 || !film.man) return
  try { PV.w0 = new Worker(new URL('./pack.worker.ts', import.meta.url), { type: 'module' }) } catch { PG.stopsOk = true; return }
  PV.w0.onmessage = (e: MessageEvent<PackMsg>) => pkMsg(PV, e.data, performance.now())
  PV.w0.onerror = () => { if (!PV.fail) { PV.fail = 'worker'; PG.stopsOk = true } }
  PV.t0 = performance.now()
  PV.w0.postMessage({ type: 'pack', url: `${PG.base}motion.bin${VQ}`, n: film.man.n, fp: PG.fp })
}
function sizeCv(P: Pk) {
  if (!P.w || (cv.width === P.w && cv.height === P.h)) return
  cv.width = P.w; cv.height = P.h; g.imageSmoothingQuality = 'low'; PG.dirty = true
}
function pkDrop(P: Pk, k: number) {
  const b = P.bm.get(k); if (!b) return
  P.bytes -= b.width * b.height * 4; b.close(); P.bm.delete(k); film.bytes = PL.bytes + PV.bytes
}
/** Over the budget: what is not wanted goes first, farthest first (behind counts as farther), then the end of the
 *  list; never the frames on screen */
function pkEvict(P: Pk) {
  if (P.bytes <= P.budget) return
  const p = film.pos, out: number[] = [], cand: number[] = []
  const kept = (k: number) => k === P.keep[0] || k === P.keep[1]
  for (const k of P.bm.keys()) if (!P.wantSet.has(k) && !kept(k)) cand.push(k)
  cand.sort((x, y) => score(y, p) - score(x, p))
  for (const k of cand) { if (P.bytes <= P.budget) break; pkDrop(P, k); out.push(k) }
  for (let i = P.wantList.length - 1; i >= 0 && P.bytes > P.budget; i--) { const k = P.wantList[i]; if (!kept(k) && P.bm.has(k)) { pkDrop(P, k); out.push(k) } }
  if (out.length) P.w0?.postMessage({ type: 'evict', ks: out })
}
function pkGot(P: Pk, k: number, bmp: ImageBitmap) {
  if (P.bm.has(k) || !P.w0) { bmp.close(); return }
  P.bm.set(k, bmp); P.bytes += bmp.width * bmp.height * 4; film.bytes = PL.bytes + PV.bytes
  if (!P.wantSet.has(k) && P.bytes > P.budget) { pkDrop(P, k); P.w0.postMessage({ type: 'evict', ks: [k] }); return }
  pkEvict(P)
}
function pkSend(P: Pk, list: number[]) {
  let h = list.length
  for (const k of list) h = (Math.imul(h, 31) + k) | 0
  if (h === P.sig && list.length === P.wantList.length) return
  P.sig = h; P.wantList = list; P.wantSet = new Set(list)
  P.w0?.postMessage({ type: 'want', gen: ++P.gen, ks: list })
}
/** What each level decodes, in order. The active level: the frames around the position, then moving, the path over
 *  the next 0.8 s coarse to fine (passes below) and 16 (light) or 12 (motion) behind; at rest, the ring around the
 *  position, then the way to the next stop and to the previous one, coarse to fine. The motion level before it takes over: the frames at the rest position once its one-in-2 layer is in. The
 *  light level after: nothing. Bounded by each level's memory budget. */
function wantsP() {
  const m = film.man!, n = m.n
  const nf = predict(48)
  const travel = nf > 0 && Math.abs(fut[nf] - fut[0]) > 0.5
  const k0 = Math.min(n - 1, Math.max(0, Math.floor(film.pos)))
  let path: number[] | null = null
  for (const P of [PL, PV]) {
    if (!P.head || !P.w0) continue
    const prep = P === PV && act === PL && P.tGate > 0 && !travel
    if (P !== act && !prep) { if (P.wantList.length) pkSend(P, []); continue }
    const maxF = Math.max(8, Math.floor(P.budget / (P.w * P.h * 4)) - 2)
    // coarse to fine: the light level one in 8, in 4, then in 2 (a blend across the whole path first, at most 8 apart);
    // the motion level as ?gate=1 orders it, every 2nd frame then every frame (its blends are at most 4 apart: a frame
    // in 8 decoded first would leave the next refreshes on the nearest frame when the decoder falls behind)
    const passes = P === PL ? [8, 4, 2] : [2, 1]
    P.sv++
    const list: number[] = [], st = P.stamp, sv = P.sv, pr = P.present
    const add = (k: number) => { if (k >= 0 && k < n && pr[k] && st[k] !== sv && list.length < maxF) { st[k] = sv; list.push(k) } }
    // the nearest frames of the pack on either side of the position
    for (let a = k0; a >= 0 && k0 - a <= 16; a--) if (pr[a]) { add(a); break }
    for (let b = k0 + 1; b < n && b - k0 <= 16; b++) if (pr[b]) { add(b); break }
    if (prep) for (let i = 1; i <= 8; i++) { add(k0 + i); add(k0 + 1 - i) }
    else if (travel) {
      if (!path) {
        path = []
        let last = k0
        for (let i = 1; i <= nf; i++) {
          const f = Math.min(n - 1, Math.max(0, Math.floor(fut[i])))
          if (f > last) for (let k = last + 1; k <= Math.min(n - 1, f + 1); k++) path.push(k)
          else if (f < last) for (let k = last - 1; k >= f; k--) path.push(k)
          last = f
        }
      }
      for (const s of passes) for (const k of path) if (k % s === 0) add(k)
      for (let i = 1; i <= (P === PL ? 16 : 12); i++) add(k0 - i * dir)
    } else {
      const R = P === PL ? 32 : 16
      for (let i = 1; i <= R; i++) { add(k0 + i * dir); add(k0 + 1 - i * dir) }
      const p = film.pos
      const up = stopF.find((x) => x > p + 1), dn = [...stopF].reverse().find((x) => x < p - 1)
      for (const s of dir >= 0 ? [up, dn] : [dn, up]) {
        if (s === undefined) continue
        const sg = s > p ? 1 : -1, end = sg > 0 ? Math.min(n - 1, Math.ceil(s) + 1) : Math.max(0, Math.floor(s) - 1)
        for (const c of passes) for (let k = k0; sg > 0 ? k <= end : k >= end; k += sg) if (k % c === 0) add(k)
      }
    }
    pkSend(P, list)
  }
}
/** The decoded frame(s) of level P for position p: the two on either side (at most P.gap apart), blended at the
 *  fraction; otherwise the nearest one within P.gap (ahead first); otherwise none */
function pickIn(P: Pk, p: number, o: Pick): boolean {
  if (!P.bm.size) return false
  const n = film.man!.n, f = Math.min(n - 1, Math.max(0, Math.floor(p))), gap = P.gap
  let a = -1, b = -1
  for (let k = f; k >= Math.max(0, f - gap); k--) if (P.bm.has(k)) { a = k; break }
  for (let k = f + 1; k <= Math.min(n - 1, f + gap); k++) if (P.bm.has(k)) { b = k; break }
  o.b = -1; o.a = 0
  if (a >= 0 && p - a < 1 / 128) { o.k = a; o.pos = a; return true }
  if (b >= 0 && b - p < 1 / 128) { o.k = b; o.pos = b; return true }
  if (a >= 0 && b >= 0 && b - a <= gap) {
    const al = Math.round(((p - a) / (b - a)) * 64) / 64
    o.k = a; if (al > 0) { o.b = b; o.a = al }
    o.pos = a + al * (b - a); return true
  }
  const t = Math.round(p)
  for (let d = 0; d <= gap; d++) {
    const x = t + d * dir, y = t - d * dir
    if (P.bm.has(x)) { o.k = x; o.pos = x; return true }
    if (d && P.bm.has(y)) { o.k = y; o.pos = y; return true }
  }
  return false
}
function drawPick(P: Pk, o: Pick, alpha: number) {
  const A = P.bm.get(o.k); if (!A) return
  g.globalAlpha = alpha
  if (A.width === cv.width) g.drawImage(A, 0, 0); else g.drawImage(A, 0, 0, cv.width, cv.height)
  const B = o.b >= 0 ? P.bm.get(o.b) : undefined
  if (B) { g.globalAlpha = alpha * o.a; if (B.width === cv.width) g.drawImage(B, 0, 0); else g.drawImage(B, 0, 0, cv.width, cv.height) }
  g.globalAlpha = 1
  P.keep[0] = o.k; P.keep[1] = o.b
}
/** The motion level takes over at a rest, once its one-in-2 layer is in and its frames at the position are decoded;
 *  the light frame on screen then cross-fades into it, unless the sharp layer covers it */
function levelsP(now: number, rest: boolean) {
  if (act === PL && PV.tGate > 0 && rest && pickIn(PV, dpos, PK1)) {
    act = PV; PG.tSwitch = now
    PG.xf0 = mShown && !sharpOn && !REDUCED ? now : 0
    sizeCv(PV); PG.dirty = true
    PL.budget = LIGHT ? 6e6 : 12e6
  }
  if (act === PV && !PG.xf0 && PL.bytes > PL.budget) pkEvict(PL)
}
/** "Motion available": the light frames from the top to past the first stop have arrived (one in 8 at least) and the
 *  first frames wanted at the position are decoded; the landing's first-frame callback (AskHive mounts after it) waits
 *  for that, at most 2.5 s, so that nothing else takes the link from the first frames */
function firstP(now: number) {
  if (!PG.tTrip && PL.head) {
    const s = stopF.find((x) => x > 1) ?? 120
    const end = Math.min(film.man!.n - 1, Math.ceil(s) + 8)
    let ok = true
    for (let k = 0; k <= end; k += 8) if (!PL.present[k] && !PV.present[k]) { ok = false; break }
    if (ok) PG.tTrip = now
  }
  if (PG.tTrip && !PG.tRing) {
    const L = act.wantList, m = Math.min(8, L.length)
    let i = 0
    for (; i < m; i++) if (!act.bm.has(L[i])) break
    if (m && i >= m) PG.tRing = now
  }
  if (!PG.firstCalled && ((PG.tTrip && PG.tRing) || now - PG.t0 > 2500 || PL.done || !!PL.fail)) { PG.firstCalled = true; PG.onFirst?.() }
}
/** The thin line at the bottom of the film: the bytes of both packs, once a second, shown after 700 ms if they are not
 *  in yet, gone once the motion pack is in */
function hintP(now: number) {
  const el = PG.hint; if (!el || PG.hintGone) return
  const full = PV.done || !!PV.fail || (PG.sharpOk && !PV.w0)
  const fill = PG.hintFill!
  if (full) {
    PG.hintGone = true
    if (PG.hintOn) { fill.style.transform = 'scaleX(1)'; el.classList.remove('on'); PG.hintOn = false; setTimeout(() => el.remove(), 600) } else el.remove()
    PG.hint = null
    return
  }
  if (!PG.hintOn && now - PG.t0 > 700) { el.classList.add('on'); PG.hintOn = true }
  if (PG.hintOn && now - PG.hintAt > 1000) {
    PG.hintAt = now
    const lt = PL.total || 2.2e6, vt = PV.total || lt * 4.7
    fill.style.transform = `scaleX(${Math.min(1, (PL.got + PV.got) / (lt + vt)).toFixed(4)})`
  }
}
const noop = () => {}
function tickP(dt: number) {
  if (!film.man) return
  tickN++
  const now = performance.now()
  stopsCheck()
  if (SY.length < 2 && UNI > 0 && (++segTry & 31) === 1) segs()
  const p = posAt(scrollY(), world.protoQ)
  if (p - lastPos > 0.5) { dir = 1; lastPos = p } else if (lastPos - p > 0.5) { dir = -1; lastPos = p }
  const changed = p !== film.pos, dp = Math.abs(p - film.pos)
  if (dt > 0) vel = vel * 0.6 + 0.4 * (p - film.pos) / Math.max(1 / 240, dt)
  film.pos = p
  // displayed position: the target; at rest, a glide to the nearest whole frame
  if (dp > 0.02 || Math.abs(dpos - p) > 1.5) dpos = p
  else {
    if (restK < 0 || Math.abs(p - restK) > 0.6) restK = Math.round(p)
    const r = restK; dpos += (r - dpos) * (1 - Math.exp(-Math.max(dt, 1 / 240) / 0.05)); if (Math.abs(r - dpos) < 1 / 64) dpos = r
  }
  if (dp > 0.02) restK = -1
  const moved = dp > 0.02 || !!step.trip
  if (moved) restAt = now
  if (tripWas && !step.trip) tripEnd = now
  tripWas = !!step.trip
  const rest = !moved && (now - restAt >= 150 || (tripEnd > 0 && now - tripEnd < 400))
  // the sharp layer goes the moment the image moves, in the same refresh as the motion draw; so does a cross-fade
  if (moved && sharpOn) showSharp(false, false)
  if (moved) PG.xf0 = 0
  levelsP(now, rest)
  wantsP()
  const wantZ = world.svc.open ? 1 : 0
  const z0 = zoom
  zoom = REDUCED ? wantZ : Math.min(1, Math.max(0, zoom + (wantZ ? dt : -dt) / 0.9))
  world.svc.u = zoom
  if (zoom > 0 && world.svc.slot >= 0 && z0 === 0) { const r = world.rects.get(world.svc.slot); if (r) { zx = r.x + r.w / 2; zy = r.y + r.h / 2 } }
  if (!world.svc.open && zoom === 0) world.svc.slot = -1
  let geoMoved = false
  if (zoom !== z0) { applyZoom(); geoMoved = true }
  let ms = 0, pos = NaN, kind = 0
  // the active level, otherwise the other one (a jump where the active one has nothing decoded yet)
  let P: Pk | null = pickIn(act, dpos, PK1) ? act : null
  if (!P) { const o = act === PL ? PV : PL; if (pickIn(o, dpos, PK1)) P = o }
  // at the top, at rest, the poster (the sharp first frame) stays until the motion canvas has a reason to show
  const poster = !mShown && posterOk() && (!P || (rest && Math.round(dpos) === 0))
  if (P && !poster) {
    const fade = PG.xf0 > 0 && P === PV && pickIn(PL, dpos, PK2)
    const u = fade ? Math.min(1, (now - PG.xf0) / 250) : 1
    if (PG.dirty || fade || P !== PG.dP || PK1.k !== PG.dK || PK1.b !== PG.dB || PK1.a !== PG.dA) {
      const t0 = performance.now()
      if (fade) drawPick(PL, PK2, 1)
      drawPick(P, PK1, u)
      if (CAL) bands(g, cv.width, cv.height, Math.round(PK1.pos))
      ms = performance.now() - t0
      PG.dirty = false; PG.dP = P; PG.dK = PK1.k; PG.dB = PK1.b; PG.dA = PK1.a; film.drawn++
      if (!mShown) { mShown = true; cv.style.opacity = '1'; const ps = document.getElementById('poster'); if (ps) ps.style.visibility = 'hidden' }
    }
    if (!fade || u >= 1) PG.xf0 = 0
    pos = PK1.pos; kind = P === PV ? 1 : 3
  } else if (!mShown) { pos = 0; kind = 4 }
  else pos = lastMetaPos
  // the metadata of the drawn position (every frame has its own in meta.bin, even those not in the packs)
  if (!Number.isNaN(pos) && pos !== lastMetaPos) {
    const a = Math.floor(pos), f = pos - a
    metaAt(a, f > 0 ? Math.min(film.man.n - 1, a + 1) : -1, f)
    film.shown = Math.round(pos); film.def = 0
    lastMetaPos = pos; geoMoved = true
  }
  if (geoMoved) { film.geo++; publish() }
  if (!Number.isNaN(pos) && pos !== lastDrawnPos) { lastDrawnPos = pos; heldFrom = p }
  const held = changed && !Number.isNaN(heldFrom) && Math.abs(p - heldFrom) >= 0.5 ? 1 : 0
  sharpTick(rest, now, noop)
  if (sFetch.size > PG.sMaxIn) PG.sMaxIn = sFetch.size
  // nothing in the film area (no poster, no motion frame, no sharp frame): counted, never expected
  const black = !mShown && !sharpOn && !posterOk()
  if (black) PG.black++
  const q = log.n & (LOGN - 1)
  log.t[q] = now; log.p[q] = p; log.s[q] = film.shown; log.d[q] = 0; log.ms[q] = ms; log.mv[q] = changed || moved ? 1 : 0; log.tk[q] = tick.prev
  // kind: 1 motion level, 2 sharp frame at rest, 3 light level, 4 the poster, 5 nothing on screen
  log.pos[q] = Number.isNaN(pos) ? -1 : pos; log.kind[q] = black ? 5 : sharpOn ? 2 : kind; log.held[q] = held; log.n++
  firstP(now)
  hintP(now)
  film.version++
  hooks.forEach((f) => f())
}
const pkInfo = (P: Pk) => ({ head: P.head, got: P.got, total: P.total, gateAt: P.gateAt, arrived: P.pj, count: P.count, done: P.done, cached: P.cached, fail: P.fail, bm: P.bm.size, bytes: P.bytes, want: P.wantList.length, t0: P.t0, tHead: P.tHead, tGate: P.tGate, tDone: P.tDone, w: P.w, h: P.h })
/** The progressive film: false when the light pack cannot be used (today's film then runs) */
async function mountProg(man: Manifest, fp: number, onFirst: () => void): Promise<boolean> {
  const n = man.n, set0 = SET, man0 = film.man
  PG.t0 = performance.now(); PG.fp = fp; PG.base = `${ROOT}${man.ysFrom ?? SET}/`
  for (const P of [PL, PV]) { P.present = new Uint8Array(n); P.stamp = new Uint32Array(n) }
  cvS = document.createElement('canvas'); cvS.className = 'film film-sharp'
  cv.after(cvS)
  cvS.width = man.w; cvS.height = man.h
  gS = cvS.getContext('2d', { alpha: false })
  g = cv.getContext('2d', { alpha: false, desynchronized: false })!; g.imageSmoothingQuality = 'low'
  sharpMax = SET === 'retina' ? 4 : 6
  try {
    sw = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' })
    sw.onmessage = (e: MessageEvent<{ id: number; bmp?: ImageBitmap }>) => sharpDone(e.data.id, e.data.bmp ?? null)
  } catch { sw = null }
  world.pick = pick
  place()
  addEventListener('resize', place)
  const ro = new ResizeObserver(() => measure()); ro.observe(document.body)
  const wake = () => { if (document.visibilityState === 'visible') PG.dirty = true }
  document.addEventListener('visibilitychange', wake); addEventListener('pageshow', wake)
  film.pos = posAt(scrollY(), world.protoQ); lastPos = film.pos; dpos = film.pos
  // the frame on screen is the poster (frame 0): the layer is set on it, and the page is ready
  metaAt(0); film.shown = 0; film.def = 0; lastMetaPos = 0; lastDrawnPos = 0; heldFrom = film.pos; film.geo++; publish()
  film.ready = true; world.sceneReady = true; film.loaded = Math.min(n, 40)
  PG.onFirst = onFirst
  WG.__filmGate = 'open'
  ;(window as unknown as { __filmP: unknown }).__filmP = () => ({ act: act === PV ? 'motion' : 'lite', t0: PG.t0, lite: pkInfo(PL), motion: pkInfo(PV), tTrip: PG.tTrip, tRing: PG.tRing, tSwitch: PG.tSwitch, first: PG.firstCalled, sharpOk: PG.sharpOk, stopsOk: PG.stopsOk, sharpN: sharpC.size, sharpK, sharpOn, sMaxIn: PG.sMaxIn, black: PG.black, rate: film.rate, set: SET, hintOn: PG.hintOn, hintGone: PG.hintGone, shown: mShown, bytes: film.bytes })
  // the poster, decoded once more as the sharp frame 0 of the sharp layer (shown at rest at the top)
  const img = document.querySelector<HTMLImageElement>('#poster img'); PG.poster = img
  if (img) img.decode().then(() => createImageBitmap(img)).then((b) => { if (cvS && !sharpC.has(0)) { sharpC.set(0, b); film.sharpN = sharpC.size } else b.close() }).catch(noop)
  // the line at the bottom of the film (hintP)
  const stage = cv.parentElement
  if (stage) { const el = document.createElement('div'); el.className = 'film-hint'; el.appendChild(document.createElement('i')); stage.appendChild(el); PG.hint = el; PG.hintFill = el.firstElementChild as HTMLElement }
  // the light pack: started with meta.bin as soon as this module ran (early), otherwise now
  if (early?.w) PL.w0 = early.w
  else try { PL.w0 = new Worker(new URL('./pack.worker.ts', import.meta.url), { type: 'module' }) } catch { PL.w0 = null }
  let off: (() => void) | null = null
  if (PL.w0) {
    PL.w0.onmessage = (e: MessageEvent<PackMsg>) => pkMsg(PL, e.data, performance.now())
    PL.w0.onerror = () => pkMsg(PL, { type: 'fail', why: 'worker' }, performance.now())
    if (early?.w === PL.w0) {
      PL.t0 = early.t0
      // what the worker said so far, in order (a stale pack's header hands over to a new worker: the rest is its)
      for (const [at, e] of early.q) { if (PL.w0 !== early.w) break; pkMsg(PL, e.data as PackMsg, at) }
      early.q.length = 0
      if (early.failed && PL.w0 === early.w) pkMsg(PL, { type: 'fail', why: 'worker' }, performance.now())
    } else {
      PL.t0 = PG.t0
      PL.w0.postMessage({ type: 'pack', url: `${PG.base}lite.bin${VQ}`, n, fp })
    }
    off = onTick((_t, dt) => tickP(dt))
    if (PL.head || (!PL.fail && await new Promise<boolean>((r) => { PG.resolve = r }))) return true
  }
  // today's film, before anything of the light pack was drawn
  off?.(); ro.disconnect(); document.removeEventListener('visibilitychange', wake); removeEventListener('pageshow', wake); removeEventListener('resize', place)
  for (const P of [PL, PV]) { P.w0?.terminate(); P.w0 = null; for (const b of P.bm.values()) b.close(); P.bm.clear(); P.bytes = 0 }
  sw?.terminate(); sw = null
  for (const b of sharpC.values()) b.close()
  sharpC.clear(); blobs.length = 0
  cvS?.remove(); cvS = null; gS = null
  PG.hint?.remove(); PG.hint = null
  SET = set0; film.set = SET; BASE = `${ROOT}${SET}/`; film.man = man0
  cv.style.opacity = '0'; film.ready = false; film.shown = -1; film.loaded = 0; film.bytes = 0; mShown = false
  const ps = document.getElementById('poster'); if (ps) ps.style.visibility = ''
  WG.__filmGate = 'fallback'
  console.warn(`film: light pack unavailable (${PL.fail || 'worker'}), today's film`)
  return false
}

export async function mountFilm(canvas: HTMLCanvasElement, onFirst: () => void) {
  cv = canvas; cv.style.opacity = '0'
  const all = (window as W).__FILM_MAN
  let man: Manifest = all?.[SET] ?? await fetch(`${BASE}manifest.json`).then((r) => r.json() as Promise<Manifest>)
  const src = man.ysFrom ? all?.[man.ysFrom] : undefined
  if (src) man = { ...man, ys: src.ys }
  // meta.bin is preloaded by index.html (same address, same mode): it is the critical path to the first draw. Its
  // content gives the film version (?v=, immutable on the server): the same capture keeps the same addresses from one
  // deploy to the next (its ETag changed at every build, so a return visit after a deploy fetched the whole film again)
  const em = early ? await early.meta : null
  const meta: ArrayBuffer = em ?? await fetch(`${ROOT}${man.ysFrom ?? SET}/meta.bin`, { priority: 'high' } as RequestInit).then((r) => r.arrayBuffer())
  const fp = fingerprint(new Uint8Array(meta))
  VQ = `?v=${fp.toString(36)}`
  film.man = man; film.total = man.n
  film.fl = new Float32Array(meta, 0, man.n * man.nf)
  film.by = new Uint8Array(meta, man.n * man.nf * 4, man.n * man.ns * 2)
  // ?gate=1: the motion level behind a loading gate; today's film below when its pack cannot be used
  if (GATE && await mountMotion(man, fp, meta.byteLength, onFirst)) return
  // ?prog=1: the progressive film; reduced motion or a data saver: the sharp frame at each rest, as with ?gate=1
  if (PROG && (REDUCED || CONN?.saveData)) { PG.sharpOk = true; PG.stopsOk = true; if (await mountMotion(man, fp, meta.byteLength, onFirst)) return }
  else if (PROG && await mountProg(man, fp, onFirst)) return
  state = new Uint8Array(man.n); stamp = new Uint32Array(man.n); bmLite = new Uint8Array(man.n)
  // the light pass, before any sharp frame (Retina uses the desktop file, like its positions)
  if (LITE_ON) void loadLite(`${ROOT}${man.ysFrom ?? SET}/lite.bin${VQ}`, man.n, fp)
  else liteState = 3
  // The canvas has the frame size: drawing without scaling; framing and zoom are CSS
  cv.width = man.w; cv.height = man.h
  world.pick = pick
  startWorkers()
  if (!(OFF && workers.length)) { g = canvas.getContext('2d', { alpha: false, desynchronized: false })!; g.imageSmoothingQuality = 'low' }
  place()
  addEventListener('resize', place)
  // Back from a hidden or frozen tab: the target frame is redrawn right away (the off-thread canvas could keep the
  // frame from before going to the background for one refresh)
  const wake = () => { if (document.visibilityState === 'visible') { dirty = true; film.shown = -1 } }
  document.addEventListener('visibilitychange', wake); addEventListener('pageshow', wake); addEventListener('resume', wake)
  new ResizeObserver(() => measure()).observe(document.body)
  // ?dbg=1: loading and fallback-frame indicator (for checking in a regular browser)
  if (Q.get('dbg') === '1') {
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;font:12px/1.4 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.75);padding:6px 8px;border-radius:4px;pointer-events:none'
    document.body.appendChild(el)
    let from = 0
    setInterval(() => {
      let mv = 0, sh = 0
      for (let j = Math.max(from, log.n - LOGN); j < log.n; j++) { const q = j & (LOGN - 1); if (log.mv[q]) { mv++; if (log.d[q] === 2) sh++ } }
      el.textContent = `set ${SET} · loaded ${film.loaded}/${film.total} · fallback while moving ${mv ? Math.round(100 * sh / mv) : 0} % (${sh}/${mv}) · level ${film.level}`
    }, 400)
    addEventListener('keydown', (e) => { if (e.key === 'r') from = log.n })
  }
  film.pos = posAt(scrollY(), world.protoQ); lastPos = film.pos
  schedule()
  let first = true, t3 = 0
  onTick((_t, dt) => {
    if (!film.man) return
    const now = performance.now()
    if (SY.length < 2 && UNI > 0 && (++segTry & 31) === 1) segs()
    const p = posAt(scrollY(), world.protoQ)
    // Direction only flips beyond half a frame
    if (p - lastPos > 0.5) { dir = 1; lastPos = p } else if (lastPos - p > 0.5) { dir = -1; lastPos = p }
    const changed = p !== film.pos, dp = Math.abs(p - film.pos)
    // Speed in the film (frames per second), to predict native scrolling
    if (dt > 0) vel = vel * 0.6 + 0.4 * (p - film.pos) / Math.max(1 / 240, dt)
    film.pos = p
    // Displayed position: follows the film; at rest, glides to the nearest whole frame
    // a target that only creeps (the protocol state queue converging, a few thousandths of a frame per refresh) counts
    // as at rest: otherwise two frames stayed blended at a stop and the image flickered
    if (dp > 0.02 || Math.abs(dpos - p) > 1.5) dpos = p
    else {
      // the whole frame to rest on, with hysteresis: a target hovering around a half frame no longer alternates two frames
      if (restK < 0 || Math.abs(p - restK) > 0.6) restK = Math.round(p)
      const r = restK; dpos += (r - dpos) * (1 - Math.exp(-Math.max(dt, 1 / 240) / 0.05)); if (Math.abs(r - dpos) < 1 / 64) dpos = r
    }
    if (dp > 0.02) restK = -1
    schedule()
    // Fallback: the decode throughput measured during the first 3 seconds
    if (!t3 && decN >= 6) t3 = now
    if (t3 && now - t3 < 3000 && decN >= 10) {
      const avg = decSum / decN, cap = Math.max(1, workers.length || 1) * 1000 / avg
      if (cap < 45 && SET === 'retina') downTier()
      else if (cap < 25) film.level = 4
    }
    // Service opened in place: the image zooms toward its sled (0.9 s), then comes back
    const wantZ = world.svc.open ? 1 : 0
    const z0 = zoom
    zoom = REDUCED ? wantZ : Math.min(1, Math.max(0, zoom + (wantZ ? dt : -dt) / 0.9))
    world.svc.u = zoom
    if (zoom > 0 && world.svc.slot >= 0 && z0 === 0) { const r = world.rects.get(world.svc.slot); if (r) { zx = r.x + r.w / 2; zy = r.y + r.h / 2 } }
    if (!world.svc.open && zoom === 0) world.svc.slot = -1
    let geoMoved = false
    if (zoom !== z0) { applyZoom(); geoMoved = true }
    let ms = 0
    if (choose(dpos) && (dirty || pickK !== film.shown || pickD !== film.def || pickB !== shownB || pickA !== shownA)) {
      ms = draw()
      dirty = false
      if (pickK !== film.shown || pickB !== shownB || pickA !== shownA) { metaAt(pickK, pickB, pickA); geoMoved = true }
      film.shown = pickK; film.def = pickD; film.drawn++; shownB = pickB; shownA = pickA
      if (first) {
        first = false; cv.style.opacity = '1'; film.ready = true; world.sceneReady = true
        const ps = document.getElementById('poster'); if (ps) ps.style.visibility = 'hidden'
        onFirst()
      }
    }
    if (geoMoved) { film.geo++; publish() }
    const q = log.n & (LOGN - 1)
    log.t[q] = now; log.p[q] = p; log.s[q] = film.shown; log.d[q] = film.def; log.ms[q] = ms; log.mv[q] = changed || moving ? 1 : 0; log.tk[q] = tick.prev
    log.pos[q] = shownB >= 0 ? film.shown + shownA : film.shown; log.kind[q] = 0; log.held[q] = 0; log.n++
    film.version++
    hooks.forEach((f) => f())
  })
}
