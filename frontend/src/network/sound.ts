// The demo sound, synthesized with WebAudio (no files, no voice). Subtle, synced to the action: typing, packet
// departure, a trail during the chase, 'received', signature, drone takeoff, payment. Started by the 'See the demo'
// click (user gesture), suspended on pause, stopped on exit; the muted choice is remembered (localStorage, in
// try/catch).
import type { Sfx } from './demo-strings'

const KEY = 'archive.demo.mute'
const LEVEL = 0.42
export type SoundFx = Sfx | 'key'

export function makeSound() {
  let ctx: AudioContext | null = null, master: GainNode | null = null, noise: AudioBuffer | null = null
  let trailG: GainNode | null = null, trailF: BiquadFilterNode | null = null
  let muted = false
  try { muted = localStorage.getItem(KEY) === '1' } catch { /* storage unavailable: sound on */ }
  // the context is created on a gesture only: a demo opened by the address (?focus=demo) has had none, and a context
  // created then is refused by the browser (with a console warning); the first tap or key afterwards starts it. On a
  // touch screen a finger going down does not count as a gesture yet (HTML user activation): it counts when it lifts
  // (pointerup, touchend, click); a mouse button or a key counts at once
  let wanted = false, waiting = false
  const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const
  const activated = () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true
  const stopWaiting = () => { waiting = false; for (const k of GESTURES) removeEventListener(k, onGesture, true) }
  const onGesture = () => {
    if (!activated()) return // not an activating event (Escape, a modifier): wait for the next one
    const c = wanted ? ensure() : null
    if (!c || c.state === 'running') { stopWaiting(); return }
    // a browser that wants a stricter gesture (iOS: touchend or click) leaves it suspended: the next one tries again
    void c.resume().then(() => { if (c.state === 'running') stopWaiting() }).catch(() => null)
  }

  function ensure(): AudioContext | null {
    if (ctx) return ctx
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    try { ctx = new AC() } catch { return null }
    master = ctx.createGain(); master.gain.value = muted ? 0 : LEVEL
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4
    master.connect(comp).connect(ctx.destination)
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    // the trail: a filtered noise loop, silent outside chases
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true
    trailF = ctx.createBiquadFilter(); trailF.type = 'bandpass'; trailF.frequency.value = 700; trailF.Q.value = 5
    trailG = ctx.createGain(); trailG.gain.value = 0
    src.connect(trailF).connect(trailG).connect(master); src.start()
    return ctx
  }
  const env = (g: GainNode, t: number, peak: number, a: number, d: number) => {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
  }
  function tone(type: OscillatorType, f0: number, f1: number, at: number, peak: number, a: number, d: number) {
    const c = ctx!, o = c.createOscillator(), g = c.createGain(); o.type = type
    o.frequency.setValueAtTime(f0, at); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + a + d)
    env(g, at, peak, a, d); o.connect(g).connect(master!); o.start(at); o.stop(at + a + d + 0.05)
  }
  function hiss(ft: BiquadFilterType, f0: number, f1: number, q: number, at: number, peak: number, a: number, d: number) {
    const c = ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain()
    s.buffer = noise; f.type = ft; f.Q.value = q; f.frequency.setValueAtTime(f0, at); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, at + a + d)
    env(g, at, peak, a, d); s.connect(f).connect(g).connect(master!); s.start(at, Math.random() * 0.5); s.stop(at + a + d + 0.05)
  }
  function fx(k: SoundFx) {
    if (!ctx || ctx.state !== 'running' || muted) return
    const t = ctx.currentTime + 0.01
    if (k === 'key') { hiss('highpass', 2600 + Math.random() * 900, 2600, 0.7, t, 0.12 + Math.random() * 0.06, 0.002, 0.035); tone('sine', 180, 120, t, 0.03, 0.002, 0.03) }
    else if (k === 'depart') { hiss('bandpass', 380, 2200, 3, t, 0.16, 0.06, 0.4); tone('sine', 220, 330, t, 0.05, 0.02, 0.25) }
    else if (k === 'recv') { tone('sine', 98, 70, t, 0.18, 0.005, 0.22); tone('sine', 660, 660, t + 0.04, 0.09, 0.01, 0.9); tone('sine', 990, 990, t + 0.1, 0.06, 0.01, 0.8) }
    else if (k === 'sign') { tone('triangle', 784, 784, t, 0.08, 0.008, 0.35); tone('triangle', 1175, 1175, t + 0.09, 0.07, 0.008, 0.45) }
    else if (k === 'drone') {
      const c = ctx, lp = c.createBiquadFilter(), g = c.createGain(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(g).connect(master!)
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.5); g.gain.setValueAtTime(0.05, t + 1.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4)
      for (const df of [0, 3.5]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70 + df, t); o.frequency.exponentialRampToValueAtTime(165 + df, t + 1.2); o.connect(lp); o.start(t); o.stop(t + 2.5) }
      hiss('lowpass', 500, 1400, 0.8, t, 0.05, 0.4, 1.8)
    }
    else if (k === 'pay') { tone('sine', 1568, 1568, t, 0.07, 0.004, 0.3); tone('sine', 2093, 2093, t + 0.07, 0.06, 0.004, 0.4) }
    else if (k === 'tick') { tone('sine', 1250, 1250, t, 0.05, 0.003, 0.08) }
  }
  return {
    get muted() { return muted },
    /** on click (gesture): creates or resumes the context; without any gesture yet, waits for the first one */
    start() {
      wanted = true
      if (!ctx && !activated()) { if (!waiting) { waiting = true; for (const k of GESTURES) addEventListener(k, onGesture, true) } return }
      const c = ensure(); if (c && c.state !== 'running') void c.resume().catch(() => null)
    },
    resume() { wanted = true; if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => null) },
    pause() { wanted = false; if (trailG && ctx) trailG.gain.setTargetAtTime(0, ctx.currentTime, 0.03); if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => null) },
    fx,
    /** the trail, from 0 to 1 */
    trail(level: number, pitch = 0) {
      if (!ctx || !trailG || !trailF) return
      trailG.gain.setTargetAtTime(muted ? 0 : 0.07 * level, ctx.currentTime, 0.06)
      trailF.frequency.setTargetAtTime(600 + 900 * pitch, ctx.currentTime, 0.1)
    },
    setMuted(m: boolean) {
      muted = m
      try { localStorage.setItem(KEY, m ? '1' : '0') } catch { /* ignore */ }
      if (ctx && master) master.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.05)
    },
  }
}
