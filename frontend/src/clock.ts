// A single clock: the GSAP ticker drives Lenis and ScrollTrigger.
// ?t=<ms> freezes scene time, ?s=<0..1> sets the page to a fraction of its scroll.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import './ui/veil'

gsap.registerPlugin(ScrollTrigger)
gsap.ticker.lagSmoothing(0)

const q = new URLSearchParams(location.search)
export const FROZEN_T: number | null = q.has('t') ? Number(q.get('t')) || 0 : null
export const FROZEN_S: number | null = q.has('s') ? Math.min(1, Math.max(0, Number(q.get('s')) || 0)) : null
export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
export const MOBILE = matchMedia('(max-width: 760px)').matches
export const NOGL = q.get('gl') === '0'
/** Video landing: film capture (tournage.html?tournage) shoots the scene frame by frame; scene time is set by the
 *  capture (setFilmT), never by the clock */
export const TOURNAGE = q.has('tournage')
// During capture, scene time is FROZEN for every frame (?t, 0 by default); setFilmT has no effect. Everything that
// varied with time (beam noise, threads, ripple) is a still image, placed in the world like the rest.
const filmT = FROZEN_T ?? 0
export const setFilmT = (ms: number) => { void ms }

let t0 = performance.now()
/** Scene time in seconds: real, or frozen by ?t (ms). */
export const sceneTime = () => (TOURNAGE ? filmT / 1000 : FROZEN_T !== null ? FROZEN_T / 1000 : (performance.now() - t0) / 1000)
export const resetSceneClock = () => { t0 = performance.now() }

export let lenis: Lenis | null = null
// ---- One speed profile for every input ----
// Wheels, trackpads and keyboards report very differently: Windows 100 px per notch (deltaMode 0), Firefox 3 lines
// (deltaMode 1), pages (deltaMode 2), macOS small continuous deltas, high-resolution wheels fractional bursts, and
// native keyboard jumps that Lenis does not smooth. Three rules:
// 1. one scale. A notch (line or page mode, or a large isolated integer delta) is one STEP (7.5% of the viewport
//    height, 46 to 76 px), whatever the OS setting. Continuous deltas use the same gain: STEP per 100 px. An isolated
//    event moves at least half a step, so a short gesture is never zero;
// 2. one top speed. The target never runs more than LEAD screens ahead of the page; Lenis catches up at lerp 0.1
//    (frame-rate independent), so the top speed is about 2.5 screens per second for every input;
// 3. nothing is lost. What exceeds the top speed waits in a reserve (at most 0.6 screen, cleared on direction change)
//    and is released frame by frame. The pinned protocol page sets its own bound (story.ts, scrollBound).
const LEAD = 0.42, RES_MAX = 1
const stepPx = () => Math.min(76, Math.max(46, Math.round(0.075 * (innerHeight || 800))))
let lastWheel = 0, reserve = 0
/** Target bound set by the story (pinned page), in the gesture direction; null: no bound */
let bound: ((dir: number) => number | null) | null = null
export const setScrollBound = (f: typeof bound) => { bound = f }
const room = (dir: number) => {
  if (!lenis) return 0
  const H = innerHeight || 800
  let r = Math.max(0, LEAD * H - dir * (lenis.targetScroll - lenis.animatedScroll))
  const b = bound?.(dir)
  if (b !== null && b !== undefined) r = Math.min(r, Math.max(0, dir * (b - lenis.targetScroll)))
  return r
}
/** Add a gesture (px, already scaled) to the reserve and return what can move now */
const push = (d: number) => {
  const H = innerHeight || 800
  if (reserve && Math.sign(reserve) !== Math.sign(d)) reserve = 0
  reserve = Math.max(-RES_MAX * H, Math.min(RES_MAX * H, reserve + d))
  return take()
}
const take = () => {
  if (!reserve) return 0
  const dir = Math.sign(reserve), f = Math.min(Math.abs(reserve), room(dir))
  reserve -= dir * f
  if (Math.abs(reserve) < 0.5) reserve = 0
  return dir * f
}
// ---- Step scrolling: the page rests on each section and on each step of the pinned pages ----
// story.ts provides the list of stops. One gesture moves one stop:
// - a gesture is a burst of wheel events with no gap over 220 ms, in one direction. A new swipe during inertia is
//   recognised by its rising amplitude;
// - the move is a Lenis tween (0.55 s + 0.25 s per screen, at most 1.15 s), eased in and out;
// - once the stop is reached and the scene has caught up, the page stays at least DWELL. A gesture arriving during the
//   move or the dwell waits its turn (one pending at most); the falling tail of a swipe does not add a stop;
// - nothing is locked: the native scrollbar and links stay free. ?step=0 restores free scrolling.
export interface Stop { y: number; id: string; k: string; ready?: () => boolean }
let stopsFn: (() => Stop[]) | null = null
export const setStops = (f: () => Stop[]) => { stopsFn = f }
const DWELL = 0.75
const STEPQ = q.get('step') !== '0'
export const step = { trip: null as null | { y0: number; y1: number; t0: number; dur: number; ease: (x: number) => number }, idx: -1, moving: false, to: null as Stop | null, arrivedAt: 0, settledAt: 1, queue: 0, lastEv: 0, lastMag: 0, gDir: 0, gPeak: 0, gStart: 0, sustain: 0, log: [] as { k: string; y: number; arrive: number; settle: number; leave: number }[] }
;(window as unknown as { __step: typeof step }).__step = step
const stepOn = () => STEPQ && !!stopsFn && !!lenis && !REDUCED && !MOBILE && !lenis.isStopped
export const stepEase = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.pow(x, 0.78))
const busy = () => step.moving || !step.settledAt || (performance.now() - step.settledAt) / 1000 < DWELL
/** Go to the next stop in direction dir (1 or -1) from the current page position */
function stepGo(dir: number) {
  if (!lenis || !stopsFn) return
  const list = stopsFn(), y = step.moving && step.to ? step.to.y : lenis.animatedScroll
  let to: Stop | undefined
  if (dir > 0) to = list.find((x) => x.y > y + 4)
  else to = [...list].reverse().find((x) => x.y < y - 4)
  if (!to) return
  const now = performance.now()
  const last = step.log[step.log.length - 1]
  if (last && !last.leave) last.leave = now
  const H = innerHeight || 800, dist = Math.abs(to.y - lenis.animatedScroll) / H
  step.moving = true; step.to = to; step.settledAt = 0; step.arrivedAt = 0
  step.log.push({ k: to.k, y: Math.round(to.y), arrive: 0, settle: 0, leave: 0 })
  if (step.log.length > 200) step.log.shift()
  // Video landing: the trip is known from the start (the player decodes ahead the frames it is about to show).
  // Longer trips (before: 0.55 + 0.25 per screen, 1.15 s at most), also tuned to the camera motion (film frames
  // traversed, 8 px each: about 100 per second on average)
  const span = (window as unknown as { __filmSpan?: (a: number, b: number) => number }).__filmSpan?.(lenis.animatedScroll, to.y) ?? 0
  const dur = Math.min(2.8, Math.max(0.8 + 0.4 * dist, 0.6 + span / 100))
  step.trip = { y0: lenis.animatedScroll, y1: to.y, t0: now, dur, ease: stepEase }
  lenis.scrollTo(to.y, { duration: dur, easing: stepEase, force: true, onComplete: () => { step.moving = false; step.arrivedAt = performance.now(); step.trip = null } })
}
function stepAsk(dir: number) {
  if (busy()) { step.queue = dir; return }
  step.queue = 0
  stepGo(dir)
}
/** Every frame: arrival, scene caught up, dwell, then the pending gesture or the sustained push */
function stepTick() {
  if (!stepOn()) return
  const now = performance.now()
  if (step.moving) {
    // Move interrupted (scrollbar grabbed, jump): Lenis does not call back, treat the stop as reached
    if (lenis && !lenis.isScrolling && step.to && Math.abs(lenis.animatedScroll - step.to.y) > 2) { step.moving = false; step.to = null; step.settledAt = now; step.trip = null }
    return
  }
  const cur = step.to
  if (cur && step.arrivedAt && !step.settledAt && (!cur.ready || cur.ready())) {
    step.settledAt = now
    const last = step.log[step.log.length - 1]; if (last && !last.settle) { last.arrive = step.arrivedAt; last.settle = now }
  }
  if (busy()) return
  if (step.queue) { const d = step.queue; step.queue = 0; stepGo(d); return }
  // Sustained push (wheel held, continuous stream): next stop, same pace
  if (step.gDir && now - step.sustain < 140 && now - step.lastEv < 140) stepGo(step.gDir)
}
/** A wheel event in step mode: detect gestures; the page only moves through stepGo */
function stepWheel(raw: number) {
  const now = performance.now(), mag = Math.abs(raw), dir = Math.sign(raw)
  const gap = now - step.lastEv
  const surge = gap < 220 && dir === step.gDir && now - step.gStart > 350 && mag > 1.6 * step.lastMag + 6 && mag > 0.45 * step.gPeak
  const fresh = gap > 220 || dir !== step.gDir || surge
  step.lastEv = now; step.lastMag = mag
  if (fresh) { step.gDir = dir; step.gPeak = mag; step.gStart = now; step.sustain = now; stepAsk(dir); return }
  step.gPeak = Math.max(step.gPeak, mag)
  if (mag >= Math.max(3, 0.5 * step.gPeak)) step.sustain = now
}
/** Panels with their own scroll: the wheel scrolls them, not the page (AskHive's panel, dialogs, anything marked) */
const OWN_SCROLL = '.cp-panel, [role="dialog"], [data-lenis-prevent]'
const wheelNorm = (data: { deltaX: number; deltaY: number; event: WheelEvent | TouchEvent }) => {
  const e = data.event as WheelEvent
  if (!e || e.type !== 'wheel' || !lenis || e.ctrlKey) return true
  // A wheel over a panel with its own scroll (AskHive's conversation, a dialog): that panel scrolls, never the page
  // (JB, 19/11); Lenis then lets it through (its prevent option below)
  if ((e.target as Element | null)?.closest?.(OWN_SCROLL)) return true
  const H = innerHeight || 800
  const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * H : e.deltaY
  if (!raw) return true
  if (stepOn()) { if (e.cancelable) e.preventDefault(); stepWheel(raw); return false }
  const now = performance.now(), gap = now - lastWheel
  lastWheel = now
  const S = stepPx()
  // A notch: line or page mode, or a large isolated integer delta (Windows notched wheel); a large delta inside a
  // continuous burst (trackpad fling) stays continuous
  const notch = e.deltaMode !== 0 || (Math.abs(raw) >= 50 && Math.abs(e.deltaX) < 1 && (gap > 24 || Math.abs(raw - Math.round(raw)) < 0.01 && Math.round(Math.abs(raw)) % 20 === 0))
  let d = notch ? Math.sign(raw) * S : raw * (S / 100)
  if (!notch && gap > 90) d = Math.sign(d) * Math.max(Math.abs(d), S * 0.5)
  const f = push(d)
  // Never 0: a zero delta would let the browser scroll on its own (Lenis only cancels the event if it moves)
  data.deltaY = f || Math.sign(d) * 0.01; data.deltaX = 0
  return true
}
;(window as unknown as { __wheelNorm: typeof wheelNorm }).__wheelNorm = wheelNorm
// Keyboard uses the same scale and top speed: arrow = one notch, space and page keys = 85% of the viewport;
// Home and End are a programmatic scroll capped at the wheel top speed
const keyNorm = (e: KeyboardEvent) => {
  if (!lenis || lenis.isStopped || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
  const tg = e.target as HTMLElement | null
  if (tg && tg !== document.body && tg.closest?.('input, textarea, select, button, a, [contenteditable], [role="slider"], [role="dialog"], .svc-panel, .fiche, .mirror')) return
  const H = innerHeight || 800, S = stepPx()
  let d = 0
  switch (e.key) {
    case 'ArrowDown': d = S; break
    case 'ArrowUp': d = -S; break
    case 'PageDown': d = 0.85 * H; break
    case 'PageUp': d = -0.85 * H; break
    case ' ': case 'Spacebar': d = (e.shiftKey ? -1 : 1) * 0.85 * H; break
    case 'Home': case 'End': {
      e.preventDefault(); reserve = 0; step.queue = 0; step.to = null; step.moving = false
      const to = e.key === 'Home' ? 0 : lenis.limit, dist = Math.abs(to - lenis.animatedScroll) / H
      lenis.scrollTo(to, { duration: Math.max(0.6, dist / (6 * LEAD) * 1.6), easing: (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2) })
      return }
    default: return
  }
  e.preventDefault()
  // In step mode a key press is a gesture (held, it chains stops at the dwell pace)
  if (stepOn()) { step.gDir = 0; stepAsk(Math.sign(d)); return }
  const f = push(d)
  if (f) lenis.scrollTo(lenis.targetScroll + f, { programmatic: false, lerp: 0.1 })
}
/** Duration of the clock's work per frame (measurement, read by the film log) */
export const tick = { start: 0, cost: 0, prev: 0 }
export const getLenis = () => lenis
type Tick = (time: number, dt: number) => void
const ticks = new Set<Tick>()
export const onTick = (f: Tick) => { ticks.add(f); return () => { ticks.delete(f) } }

let started = false
/** smooth: Lenis smooth scrolling with the normalised wheel (landing); app pages keep native scrolling but share the clock */
export function startClock({ smooth = true }: { smooth?: boolean } = {}) {
  if (started) return
  started = true
  // ?lenis=0 removes Lenis (measurement only; on touch, removing it changed nothing about dropped frames)
  const lenisOn = q.get('lenis') !== '0'
  if (!REDUCED && smooth && lenisOn) {
    // Smooth scrolling with inertia; native inertia on touch
    lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, touchMultiplier: 1, autoRaf: false, smoothWheel: true, syncTouch: false, virtualScroll: wheelNorm, prevent: (node) => node.matches?.(OWN_SCROLL) ?? false })
    lenis.on('scroll', ScrollTrigger.update)
    // Keyboard goes through the same profile (registered after the UI handlers: Escape, wall keyboard navigation)
    addEventListener('keydown', keyNorm)
    ;(window as unknown as { __lenis: Lenis }).__lenis = lenis
  }
  let last = performance.now()
  gsap.ticker.add((time) => {
    const now = performance.now()
    tick.start = now; tick.prev = tick.cost
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    // The reserve is released frame by frame, under the top speed and the pinned page bound
    if (lenis && reserve && !lenis.isStopped) { const f = take(); if (f) lenis.scrollTo(lenis.targetScroll + f, { programmatic: false, lerp: 0.1 }) }
    stepTick()
    lenis?.raf(time * 1000)
    ticks.forEach((f) => f(time, dt))
    tick.cost = performance.now() - now
  })
  if (FROZEN_S !== null) {
    const go = () => {
      const max = document.documentElement.scrollHeight - innerHeight
      const y = Math.round(max * FROZEN_S!)
      if (lenis) lenis.scrollTo(y, { immediate: true, force: true })
      else window.scrollTo(0, y)
      ScrollTrigger.update()
    }
    setTimeout(go, 60); setTimeout(go, 700); setTimeout(go, 1600)
  }
}

// Film capture: the page itself scrolls by whole pixels, but the scene state may need a finer position (the pinned
// protocol page moves the lid and the layers several screen pixels per page pixel). The capture sets the exact
// fractional position here; the scene and the story read it instead of the rounded scroll.
let filmY: number | null = null
export const setFilmY = (y: number | null) => { filmY = TOURNAGE ? y : null }
export const scrollY = () => (filmY !== null ? filmY : lenis ? lenis.animatedScroll : window.scrollY)

/** Smooth scroll to an element */
export function scrollTo(sel: string) {
  const el = document.querySelector<HTMLElement>(sel)
  if (!el) return
  // In step mode a link to a section lands on its first stop
  const sec = el.closest<HTMLElement>('[data-sec]')?.dataset.sec
  const st = sec && stepOn() ? stopsFn!().find((x) => x.id === sec) : undefined
  if (lenis && st) {
    const last = step.log[step.log.length - 1]; if (last && !last.leave) last.leave = performance.now()
    step.queue = 0; step.moving = true; step.to = st; step.settledAt = 0; step.arrivedAt = 0
    step.log.push({ k: st.k, y: Math.round(st.y), arrive: 0, settle: 0, leave: 0 })
    const ease = (x: number) => 1 - Math.pow(1 - x, 4)
    step.trip = { y0: lenis.animatedScroll, y1: st.y, t0: performance.now(), dur: 1.6, ease }
    lenis.scrollTo(st.y, { duration: 1.6, easing: ease, force: true, onComplete: () => { step.moving = false; step.arrivedAt = performance.now(); step.trip = null } })
  } else if (lenis) lenis.scrollTo(el, { offset: -40, duration: 1.6, easing: (x: number) => 1 - Math.pow(1 - x, 4) })
  else el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' })
}
