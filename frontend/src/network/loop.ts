// The choreography follows the process, step by step. A single 50 s thread (the overview plays it in a loop); each
// step of each part has its window in it (STAGES): playStep(part, i) in scene.ts plays the window of step i
// (i = the step index in the page, 0 = connection) then stops there.
//   Publish  1 the dev writes the manifest (typing); 2 fingerprint, price and shares (mouse); 3 fingerprint sent to Arc;
//            4 review (Arc examines, then accepts); 5 the image goes to the machine; 6 revenue (the author's share)
//   Rent     1 deposit (the operator signs at the dock terminal, the USDC go up to Arc); 2 start (the machine arrives,
//            the blade is placed on the belt); 3 pairing (the code on the dock screen, approved); 4 gantry (the blade
//            passes, the five lights turn on, verdict, seal, green LED; the operator points at the lights);
//            5 bay (he picks up the blade, carries it, inserts it; the bay LED turns green); 6 payment received
//   Use      1 service choice (mouse, catalog); 2 Arc hands over the key; 3 sealed request goes out; 4 signed response
//            comes back, the drone takes off; 5 payment, split by Arc
// CCTP: USDC from another chain, through Arc, to Use, just before Use starts.
// Everything derives from a state S tweened with fromTo: a seek (?t=) always renders the same frame. The figures
// reach their poses smoothly (People.settle), except after a seek (immediately).
import * as THREE from 'three'
import gsap from 'gsap'
import { DRONE, DOCK, WALL_H, ISIZE, type World, type Link, type PartK, LINK_PART, PART, BELT, GATE, BIN, BAY, bayY, T_POS, FRONT, UNIT, RACK, STATE_HEX, C, DESK, DESK_H, PUSH, NRK, TARGET_I, NSEG } from './world'
import { People, sitTyping, walking, holding, standing, type Pose } from './people'
import { makeScreen, drawCatalog, drawSession, drawDock, drawPubOverlay, drawCard, type Scr } from './screens'
import { AT } from './at'
// A USDC packet's point is only used for hover (the hologram is drawn by scene.ts, ~22 px)
const USDC_PX = 22

export const LOOP_S = 50
export const REFUS_S = 12
export const CHECK = (S: Record<string, number>, refuse: boolean) => ({ n: refuse ? (S.verdict < 0 ? 2 : Math.floor(S.bars + 1e-4)) : Math.floor(S.bars + 1e-4), bad: refuse && S.verdict < 0, ok: S.verdict > 0 })
export { AT } // the key times live in at.ts (the page reads them without three.js)
const DEF: Record<string, number> = {
  pType: 0.35, pMouse: 0, pBack: 0, pUp: 0, manLines: 0, review: 0, pScr: 0, hashK: 0, card: 0,
  bu: 0, push: 0, pusher: 0, ledO: 0, ledG: 0, ledR: 0, sealS: 0, rackG: 0,
  scanA: 0, scanY: 0, press: 0, phase: 0, cmp: 0, verdict: 0, bars: 0,
  wTerm: 0, tap: 0, wGate: 0, gest: 0, wHome: 0, reach: 0, wBay: 0, insert: 0, wBack: 0, nod: 0, dock: 0,
  catChosen: 0, cliStep: 0, uType: 0.3, uMouse: 0, uWatch: 0, busy: 0, fly: 0,
}
const BLADE_END_X = BELT.x1 - 0.05 - UNIT.d / 2
const V = (x: number, z: number) => new THREE.Vector3(x, 0, z)
const OP_HOME = V(BLADE_END_X, BELT.z + 0.72)
const TERM = V(DOCK.x + 0.45, DOCK.z)
const GSTAND = V(-1.98, 0.42)
const WORK = V(T_POS.x + 0.44, T_POS.z + FRONT + 0.46)
const path = (...w: THREE.Vector3[]) => { const p = new THREE.CurvePath<THREE.Vector3>(); for (let i = 0; i < w.length - 1; i++) p.add(new THREE.LineCurve3(w[i], w[i + 1])); return p }
// the operator's paths go around the reject bin
const P_TERM = path(OP_HOME, V(-0.3, 1.2), V(-1.6, 1.2), TERM)
const P_GATE = path(TERM, GSTAND)
const P_HOME = path(GSTAND, V(-1.6, 1.2), V(-0.3, 1.2), OP_HOME)
const P_BAY = path(OP_HOME, V(WORK.x + 0.05, OP_HOME.z), WORK)
const P_BACK = path(WORK, V(WORK.x + 0.05, OP_HOME.z), OP_HOME)
export const BAY_POS = new THREE.Vector3(T_POS.x, bayY(BAY), T_POS.z + FRONT - 0.06 - UNIT.d / 2)
// the operator's positions, for the over-the-shoulder cameras (scene.ts)
export const OPS = { TERM, GSTAND, WORK, OP_HOME }
const BAY_FRONT = BAY_POS.clone().setZ(T_POS.z + FRONT + 0.3)
// the operator's walk durations (meters / speed): they place the bay steps in the thread
const W_TERM = P_TERM.getLength() / 1.05, W_GATE = P_GATE.getLength() / 1.0, W_HOME = P_HOME.getLength() / 1.1, W_BAY = P_BAY.getLength() / 0.95, W_BACK = P_BACK.getLength() / 1.1
const T1 = 18.6 + W_HOME, T2 = T1 + 1.05 + W_BAY
// step windows, as [start, end] ranges of the thread; the index is the page step index (0 = connection)
export type Range = [number, number]
export const STAGES: Record<PartK, Range[][]> = {
  publish: [[[0, 0.05]], [[0.05, 3.2]], [[3.2, 5.0]], [[5.0, 7.6]], [[7.6, 10.4]], [[10.4, 13.0]], [[46.8, 48.9]]],
  rent: [[[0.8, 1.0]], [[1.0, 5.0]], [[5.0, 9.0]], [[9.0, 12.5]], [[12.5, 18.6]], [[18.6, T2 + 1.7]], [[T2 + 1.7, T2 + 1.9 + W_BACK], [46.8, 48.9]]],
  use: [[[27.8, 28.0]], [[28.0, 31.0]], [[31.0, 33.4]], [[33.4, 38.4]], [[38.4, 45.3]], [[45.3, 48.9]]],
}
// on focus, without a call from the page: the part plays in one go up to this step (inclusive)
export const AUTO_LAST: Record<PartK, number> = { publish: 5, rent: 5, use: 5 }
// Real state on focus: until the step is done, the animation stops here, before its result (verdict,
// 'Paid', acceptance, deposit sent...); the rest plays when the page says 'done'
export const PEND: Record<PartK, Record<number, number>> = {
  use: { 3: 34.3, 4: 38.3, 5: 46.8 }, rent: { 1: 3.1, 4: 17.6 }, publish: { 3: 5.0, 4: 9.5 },
}

type Pk = { at: number; k: Link; rev: boolean; dur: number; shape: number; n?: number; size?: number; col?: PartK | 'arc' }
const PK: Pk[] = [
  { at: 3.2, k: 'rentArc', rev: false, dur: 1.8, shape: 5 },                 // deposit: the operator's USDC go up to Arc
  { at: 5.0, k: 'publishArc', rev: false, dur: 2.4, shape: 2 },              // fingerprint authorized: Publish to Arc
  { at: 9.6, k: 'publishArc', rev: true, dur: 0.8, shape: 3, size: 16, col: 'arc' }, // review: accepted
  { at: 10.4, k: 'publishRent', rev: false, dur: 2.4, shape: 2 },            // the published image, to the machine
  { at: 10.6, k: 'rentArc', rev: false, dur: 1.6, shape: 2 },                // pairing: the operator's signature
  { at: 14.4, k: 'rentArc', rev: false, dur: 1.8, shape: 2 },                // machine quote to Arc
  { at: 17.4, k: 'rentArc', rev: true, dur: 0.7, shape: 3, size: 16, col: 'arc' }, // Arc's verdict
  { at: 26.0, k: 'cctp', rev: false, dur: 4.6, shape: 5, n: 2 },             // CCTP: USDC from another chain, through Arc, to Use
  { at: 31.0, k: 'useArc', rev: true, dur: 2.0, shape: 2, col: 'arc' },      // enclave key, from Arc to Use
  { at: 34.4, k: 'useRent', rev: false, dur: 4.0, shape: 0 },                // sealed request, directly from Use to the machine
  { at: 38.4, k: 'useRent', rev: true, dur: 3.4, shape: 1, col: 'rent' },    // signed response, from the machine to Use
  { at: 45.3, k: 'useArc', rev: false, dur: 1.8, shape: 5, n: 2 },           // x402 payment: Use to Arc
  { at: 46.9, k: 'rentArc', rev: true, dur: 1.9, shape: 5, col: 'arc' },     // Arc splits: the operator's share
  { at: 46.9, k: 'publishArc', rev: true, dur: 1.9, shape: 5, col: 'arc' },  // and the author's share
]
const RPK: Pk[] = [
  { at: 3.2, k: 'rentArc', rev: false, dur: 2.0, shape: 2 },
  { at: 6.3, k: 'rentArc', rev: true, dur: 0.9, shape: 4, size: 16, col: 'arc' },
]
const GLOW: [number, number][] = [[3.4, 0.5], [7.6, 2.4], [16.0, 1.6], [32.6, 0.3], [47.0, 0.6]]
const RGLOW: [number, number][] = [[5.2, 1.2]]

// Loop highlighting: for each process, its parts and its path come to the foreground.
export type Hl = Record<PartK | 'arc', number> & { links: Record<Link, number> }
const PHASES: { t0: number; t1: number; parts: (PartK | 'arc')[]; links: Link[] }[] = [
  { t0: 0, t1: 13.2, parts: ['publish', 'arc'], links: ['publishArc'] },
  { t0: 10.2, t1: 13.2, parts: ['rent'], links: ['publishRent'] },
  { t0: 1.0, t1: 28.4, parts: ['rent', 'arc'], links: ['rentArc'] },
  { t0: 25.8, t1: 31.0, parts: ['use', 'arc'], links: ['cctp'] },
  { t0: 28.0, t1: 45.3, parts: ['use', 'arc', 'rent'], links: ['useArc', 'useRent'] },
  { t0: 45.3, t1: 50.1, parts: ['use', 'arc', 'rent', 'publish'], links: ['useArc', 'rentArc', 'publishArc'] },
]
export function hlAt(t: number, refuse: boolean): Hl {
  const h = { use: 0, rent: 0, publish: 0, arc: 0, links: { useArc: 0, useRent: 0, publishArc: 0, rentArc: 0, publishRent: 0, cctp: 0 } } as Hl
  if (refuse) { h.rent = h.arc = 1; h.links.rentArc = 1; return h }
  for (const p of PHASES) {
    const k = Math.min(1, Math.max(0, (t - p.t0 + 0.3) / 0.6), Math.max(0, (p.t1 + 0.3 - t) / 0.6))
    if (k <= 0) continue
    for (const x of p.parts) h[x] = Math.max(h[x], k)
    for (const l of p.links) h.links[l] = Math.max(h.links[l], k)
  }
  return h
}

export function makeLoop(w: World, people: People, linkPts: Record<Link, THREE.Vector3[]>, _u: () => number) {
  void _u
  const S: Record<string, number> = { ...DEF }
  let refuse = false, snap = true
  const R = w.rent
  const scr = { cat: makeScreen(w.deskScreens.use[0], 512, 304), ses: makeScreen(w.deskScreens.use[1], 512, 304), dock: makeScreen(R.dock, 512, 320), pub: makeScreen(w.deskScreens.publish[1], 1024, 320), card: makeScreen(w.deskScreens.publish[2], 320, 200) } satisfies Record<string, Scr>
  // Real state on focus (given by the page): screens never show a result the page does not have
  let real: { part: PartK; done: number } | null = null
  const doneOf = (k: PartK) => (real && real.part === k ? real.done : 99)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1), e = new THREE.Euler()
  const off = new THREE.Color(C.off), green = new THREE.Color(C.green), orange = new THREE.Color(C.orange), red = new THREE.Color(C.red), col = new THREE.Color()
  const tw = (tl: gsap.core.Timeline, k: string, from: number, to: number, at: number, dur = 0.001, ease = 'none') => { tl.fromTo(S, { [k]: from }, { [k]: to, duration: dur, ease, immediateRender: false }, at) }
  const SM = 'sine.inOut'

  const api = { lite: false }; let pf = 0 // figurines at 30 Hz in the overview (scene.ts sets lite)
  const tl = gsap.timeline({ paused: true, repeat: -1 })
  {
    // ---- Publish ----
    tw(tl, 'pType', 0.35, 1, 0.05, 0.4, SM); tw(tl, 'manLines', 0, 4, 0.2, 2.8)
    tw(tl, 'pType', 1, 0.5, 3.2, 0.4, SM); tw(tl, 'pMouse', 0, 1, 3.4, 0.5, SM); tw(tl, 'pMouse', 1, 0, 4.6, 0.4, SM)
    tw(tl, 'pType', 0.5, 0, 5.0, 0.4, SM); tw(tl, 'pBack', 0, 1, 5.0, 0.8, SM); tw(tl, 'pUp', 0, 1, 5.3, 0.6, SM); tw(tl, 'pUp', 1, 0, 7.2, 0.6, SM)
    tw(tl, 'review', 0, 1, 7.6, 0.6, SM); tw(tl, 'review', 1, 0, 9.8, 0.5, SM)
    tw(tl, 'pBack', 1, 0, 10.0, 0.6, SM); tw(tl, 'pType', 0, 0.8, 10.4, 0.4, SM); tw(tl, 'pType', 0.8, 0.35, 12.8, 0.5, SM)
    tw(tl, 'pScr', 0, 1, 3.2); tw(tl, 'hashK', 0, 1, 3.3, 1.5); tw(tl, 'pScr', 1, 2, 5.0); tw(tl, 'card', 0, 1, 5.0, 1.3, SM)
    tw(tl, 'pScr', 2, 3, 7.6); tw(tl, 'pScr', 3, 4, 9.6); tw(tl, 'pScr', 4, 5, 10.4); tw(tl, 'pScr', 5, 6, 47.6); tw(tl, 'pScr', 6, 0, 49.7); tw(tl, 'hashK', 1, 0, 49.7); tw(tl, 'card', 1, 0, 49.7)
    tw(tl, 'pBack', 0, 1, 46.8, 0.8, SM); tw(tl, 'pUp', 0, 0.6, 47.0, 0.6, SM); tw(tl, 'pUp', 0.6, 0, 48.6, 0.6, SM); tw(tl, 'pBack', 1, 0, 49.2, 0.7, SM)
    // ---- Rent ----
    const wTerm = W_TERM
    tw(tl, 'wTerm', 0, 1, 1.0, wTerm, SM)
    tw(tl, 'tap', 0, 1, 1.0 + wTerm + 0.1, 0.45, SM); tw(tl, 'tap', 1, 0.3, 3.6, 0.4, SM); tw(tl, 'nod', 0, 1, 4.2, 0.5, SM); tw(tl, 'nod', 1, 0, 4.7, 0.3, SM)
    tw(tl, 'dock', 0, 1, 5.1); tw(tl, 'bu', 0, 0.82, 5.3, 3.4, 'power1.inOut'); tw(tl, 'phase', 0, 1, 5.4)
    tw(tl, 'dock', 1, 2, 9.2); tw(tl, 'tap', 0.3, 1, 10.0, 0.4, SM); tw(tl, 'dock', 2, 3, 10.6); tw(tl, 'tap', 1, 0, 11.6, 0.5, SM)
    const wGate = W_GATE
    tw(tl, 'wGate', 0, 1, 12.5, wGate, SM)
    tw(tl, 'bu', 0.82, 1, 13.0, 1.0, 'power1.inOut')
    tw(tl, 'scanA', 0, 1, 14.0, 0.15); tw(tl, 'scanY', 0, 1, 14.0, 1.0, SM); tw(tl, 'scanA', 1, 0, 15.05, 0.2)
    tw(tl, 'phase', 1, 2, 14.1); tw(tl, 'phase', 2, 3, 15.0); tw(tl, 'cmp', 0, 12, 15.1, 1.4)
    tw(tl, 'gest', 0, 1, 14.5, 0.6, SM); tw(tl, 'bars', 0, 5, 14.6, 3.0); tw(tl, 'gest', 1, 0, 17.9, 0.6, SM)
    tw(tl, 'verdict', 0, 1, 18.0); tw(tl, 'phase', 3, 4, 18.0)
    tw(tl, 'press', 0, 1, 18.05, 0.22, 'power2.in'); tw(tl, 'sealS', 0, 1, 18.27, 0.08); tw(tl, 'press', 1, 0, 18.4, 0.35, 'power2.out'); tw(tl, 'ledG', 0, 1, 18.05, 0.12)
    tw(tl, 'bu', 1, 2, 18.7, 1.4, 'power1.inOut')
    const wHome = W_HOME
    tw(tl, 'wHome', 0, 1, 18.6, wHome, SM)
    const t1 = 18.6 + wHome
    tw(tl, 'reach', 0, 1, t1 + 0.1, 0.5, SM); tw(tl, 'bu', 2, 3, t1 + 0.55, 0.45, SM)
    const wBay = W_BAY
    tw(tl, 'wBay', 0, 1, t1 + 1.05, wBay, SM)
    const t2 = t1 + 1.05 + wBay
    tw(tl, 'insert', 0, 1, t2 + 0.1, 0.5, SM); tw(tl, 'bu', 3, 4, t2 + 0.5, 0.9, 'power2.inOut'); tw(tl, 'rackG', 0, 1, t2 + 1.4, 0.2)
    tw(tl, 'insert', 1, 0, t2 + 1.5, 0.4, SM)
    tw(tl, 'bars', 5, 0, t2 + 1.6); tw(tl, 'phase', 4, 0, t2 + 1.6); tw(tl, 'verdict', 1, 0, t2 + 1.6); tw(tl, 'cmp', 12, 0, t2 + 1.6); tw(tl, 'ledG', 1, 0, t2 + 1.6); tw(tl, 'sealS', 1, 0, t2 + 1.6)
    tw(tl, 'wBack', 0, 1, t2 + 1.9, W_BACK, SM)
    tw(tl, 'nod', 0, 1, 47.4, 0.5, SM); tw(tl, 'nod', 1, 0, 48.0, 0.4, SM)
    tw(tl, 'dock', 3, 0, 49.6); tw(tl, 'rackG', 1, 0, 49.6)
    // ---- Use ----
    tw(tl, 'uType', 0.3, 0, 28.0, 0.4, SM); tw(tl, 'uMouse', 0, 1, 28.0, 0.6, SM); tw(tl, 'catChosen', 0, 1, 30.0); tw(tl, 'uMouse', 1, 0, 30.6, 0.4, SM)
    tw(tl, 'uType', 0, 0.5, 31.0, 0.4, SM); tw(tl, 'cliStep', 0, 1, 31.4)
    tw(tl, 'uType', 0.5, 1, 33.4, 0.3, SM); tw(tl, 'cliStep', 1, 2, 34.2); tw(tl, 'uType', 1, 0.2, 35.0, 0.5, SM)
    tw(tl, 'busy', 0, 1, 37.8); tw(tl, 'busy', 1, 0, 38.4); tw(tl, 'cliStep', 2, 3, 41.8)
    tw(tl, 'fly', 0, 1, 41.8, 0.9, 'power2.out'); tw(tl, 'uWatch', 0, 1, 41.9, 0.6, SM); tw(tl, 'uWatch', 1, 0, 44.4, 0.6, SM); tw(tl, 'fly', 1, 0, 44.2, 1.1, SM)
    tw(tl, 'uType', 0.2, 0.6, 45.3, 0.4, SM); tw(tl, 'cliStep', 3, 4, 47.0); tw(tl, 'uType', 0.6, 0.3, 48.6, 0.5, SM)
    tw(tl, 'catChosen', 1, 0, 49.7); tw(tl, 'cliStep', 4, 0, 49.7)
    tl.to({}, { duration: 0.01 }, LOOP_S - 0.01)
  }
  const rtl = gsap.timeline({ paused: true })
  {
    tw(rtl, 'wTerm', 0, 1, 0); tw(rtl, 'wGate', 0, 1, 0)
    tw(rtl, 'bu', 0.6, 1, 0, 2.6, 'power1.inOut'); tw(rtl, 'phase', 0, 1, 0.1)
    tw(rtl, 'scanA', 0, 1, 2.8, 0.15); tw(rtl, 'scanY', 0, 1, 2.8, 1.0, SM); tw(rtl, 'scanA', 1, 0, 3.85, 0.2)
    tw(rtl, 'phase', 1, 2, 2.9); tw(rtl, 'phase', 2, 3, 5.2); tw(rtl, 'cmp', 0, 8, 5.3, 1.0)
    tw(rtl, 'gest', 0, 1, 3.2, 0.6, SM); tw(rtl, 'bars', 0, 2, 3.5, 3.7); tw(rtl, 'verdict', 0, -1, 7.2); tw(rtl, 'phase', 3, 4, 7.2); tw(rtl, 'ledR', 0, 1, 7.25, 0.12); tw(rtl, 'gest', 1, 0, 7.6, 0.6, SM)
    tw(rtl, 'pusher', 0, 1, 8.0, 0.35, 'power2.in'); tw(rtl, 'push', 0, 1, 8.05, 0.9, 'power1.in'); tw(rtl, 'pusher', 1, 0, 8.6, 0.6, 'power2.out')
    rtl.to({}, { duration: 0.01 }, REFUS_S - 0.01)
  }
  // a step played alone: the thread playhead goes from t0 to t1, then stops
  let stage: gsap.core.Tween | null = null

  // ---------- packets, on the lines ----------
  // a softer curve at the ends, so packets do not cluster at the anchors
  const ease = (x: number) => THREE.MathUtils.lerp(x, x * x * (3 - 2 * x), 0.35)
  function sample(k: Link, u: number, out: THREE.Vector3) {
    const pts = linkPts[k], f = THREE.MathUtils.clamp(u, 0, 1) * NSEG, i = Math.min(NSEG - 1, Math.floor(f))
    return out.lerpVectors(pts[i], pts[i + 1], f - i)
  }
  function packets(time: number) {
    const A = w.packetAttr
    let n = 0
    for (const p of refuse ? RPK : PK) for (let c = 0; c < (p.n ?? 1); c++) {
      const lt = time - p.at - c * (p.shape === 5 ? 0.55 : 0.22)
      if (lt < 0 || lt > p.dur || n >= A.pos.count) continue
      const u = ease(lt / p.dur)
      sample(p.k, p.rev ? 1 - u : u, v)
      A.pos.setXYZ(n, v.x, v.y, v.z); A.shape.setX(n, p.shape); A.size.setX(n, p.size ?? (p.shape === 5 ? USDC_PX : 14))
      const ck = p.col ?? LINK_PART[p.k]; col.setHex(ck === 'arc' ? C.arcElec : PART[ck].hex); A.col.setXYZ(n, col.r, col.g, col.b)
      n++
    }
    for (; n < A.pos.count; n++) { A.pos.setXYZ(n, 0, -99, 0); A.size.setX(n, 0) }
    A.pos.needsUpdate = A.shape.needsUpdate = A.size.needsUpdate = A.col.needsUpdate = true
    let g = 0
    for (const [t0, d] of refuse ? RGLOW : GLOW) { const x = time - t0; if (x > -0.1 && x < d + 0.5) g = Math.max(g, Math.min(1, (x + 0.1) / 0.1, (d + 0.5 - x) / 0.5)) }
    w.arc.edgeMat.opacity = 0.55 + 0.4 * Math.max(g, S.review * (0.6 + 0.4 * Math.sin(time * 9)))
  }

  // ---------- poses ----------
  // wrists just in front of the keyboard home row (the hand paddles cover the keys); at
  // rest, hands flat on the desk edge; leaning back, hands on the thighs
  const KB = new THREE.Vector3(DESK.x, DESK_H + 0.035, DESK.z + 0.17)
  const MOUSE = new THREE.Vector3(DESK.x + 0.33, DESK_H + 0.035, DESK.z + 0.2)
  const REST_L = new THREE.Vector3(DESK.x - 0.17, DESK_H + 0.03, DESK.z + 0.31), REST_R = new THREE.Vector3(DESK.x + 0.17, DESK_H + 0.03, DESK.z + 0.31)
  const LAP_L = new THREE.Vector3(DESK.x - 0.13, 0.64, DESK.z + 0.42), LAP_R = new THREE.Vector3(DESK.x + 0.13, 0.64, DESK.z + 0.42)
  const t3 = new THREE.Vector3(), t4 = new THREE.Vector3()
  const tgt = [standing(0, 0, 0), standing(0, 0, 0), standing(0, 0, 0)]
  // seated at the desk, facing it: hands on the keyboard (typing), on the mouse, or resting; eyes on the screen
  function seated(p: Pose, t: number, type: number, mouse: number, back: number, look: THREE.Vector3, phase: number) {
    sitTyping(p, DESK.x, DESK.z + 0.62, Math.PI, t, 0)
    p.lean = 0.14 - 0.24 * back; p.pron = 1
    const tapL = Math.max(0, Math.sin(t * 15 + phase)) * 0.014 * type, tapR = Math.max(0, Math.sin(t * 17 + phase + 1.7)) * 0.014 * type
    p.ikL = t3.copy(REST_L).lerp(KB.clone().add(new THREE.Vector3(-0.11, tapL, 0)), Math.min(1, type * 2.5)).lerp(LAP_L, back).clone()
    const rKey = KB.clone().add(new THREE.Vector3(0.11, tapR, 0))
    p.ikR = t4.copy(REST_R).lerp(rKey, Math.min(1, type * 2.5)).lerp(MOUSE, mouse).lerp(LAP_R, back).clone()
    p.pron = 1 - 0.6 * back
    p.look = look
    return p
  }
  const SCR_USE = new THREE.Vector3(DESK.x, DESK_H + 0.33, DESK.z - 0.2), SCR_CAT = new THREE.Vector3(DESK.x - 0.33, DESK_H + 0.33, DESK.z - 0.2)
  const SCR_PUB = new THREE.Vector3(DESK.x, DESK_H + 0.42, DESK.z - 0.14), UP_PUB = new THREE.Vector3(DESK.x - 0.2, 2.4, DESK.z - 1.2)
  const SCREEN_DOCK = new THREE.Vector3(DOCK.x + 0.02, DOCK.y - 0.05, DOCK.z - 0.04), LAMPS = new THREE.Vector3(GATE.x, 1.92, GATE.z + 0.05)
  const opPos = new THREE.Vector3(), tmp = new THREE.Vector3(), bl = new THREE.Vector3()
  const along = (P: THREE.CurvePath<THREE.Vector3>, u: number, back = false) => { P.getPointAt(u, opPos); P.getTangentAt(u, tmp); if (back) tmp.negate(); return Math.atan2(tmp.x, tmp.z) }
  const face = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.x - from.x, to.z - from.z)
  // carrying the blade: in front of the waist, at arm's length
  // the blade is carried crosswise (its depth along the shoulders, as on the belt), 40 cm in front of the pelvis:
  // the torso does not intersect it; the hands hold it at both ends, under the base
  const carryPoint = (p: Pose, out: THREE.Vector3) => out.set(p.x + Math.sin(p.heading) * 0.4, p.pelvisY + 0.14, p.z + Math.cos(p.heading) * 0.4)
  const sideOf = (h: number, d: number) => new THREE.Vector3(Math.cos(h) * d, 0, -Math.sin(h) * d)
  const lerpAng = (a: number, b: number, k: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k }

  function operator(time: number, p: Pose) {
    const PTH: [string, THREE.CurvePath<THREE.Vector3>, number][] = [['wBack', P_BACK, 0], ['wBay', P_BAY, 1], ['wHome', P_HOME, 0], ['wGate', P_GATE, 0], ['wTerm', P_TERM, 0]]
    for (const [k, P, carry] of PTH) {
      const u = S[k]
      if (u > 0 && u < 1) { const h = along(P, u); walking(p, opPos.x, opPos.z, h, u * P.getLength(), carry); return 'walk' + k }
    }
    if (S.wBack >= 1 || (S.wHome >= 1 && S.wBay === 0)) { holding(p, OP_HOME.x, OP_HOME.z, Math.PI, 0, S.reach); p.headYaw = 0.25 * Math.sin(time * 0.4); return 'home' }
    if (S.wBay >= 1) { holding(p, WORK.x, WORK.z, face(WORK, BAY_POS), 0.6, S.insert); return 'bay' }
    if (S.wGate >= 1) { Object.assign(p, standing(GSTAND.x, GSTAND.z, face(GSTAND, V(GATE.x, GATE.z)))); return 'gate' }
    if (S.wTerm >= 1) { Object.assign(p, standing(TERM.x, TERM.z, -Math.PI / 2)); return 'term' }
    holding(p, OP_HOME.x, OP_HOME.z, Math.PI, 0, 0); p.headYaw = refuse ? 0.6 : 0.3 * Math.sin(time * 0.4); return 'home0'
  }

  // ---------- application ----------
  const beltDist = (u: number) => (u <= 1 ? (GATE.x - BELT.x0) * u : (GATE.x - BELT.x0) + (BLADE_END_X - GATE.x) * (u - 1))
  const onBelt = (u: number, out: THREE.Vector3) => out.set(BELT.x0 + beltDist(Math.min(u, 2)), BELT.y - 0.04 + UNIT.h / 2, BELT.z)
  let t = 0
  const TK = TARGET_I
  function apply(clock = 0, dt = 1 / 30) {
    const time = refuse ? rtl.time() : tl.time()
    t = time
    const k = snap ? 1 : 1 - Math.exp(-dt * 9)
    packets(time)
    // figures: 0 client (Use), 1 operator (Rent), 2 developer (Publish), in their island's frame
    const D = w.drone, f = refuse ? 0 : S.fly
    const dronePos = tmp.set(DRONE.x, DRONE.y + f * 1.3, DRONE.z).clone()
    seated(tgt[0], clock, refuse ? 0.3 : S.uType, S.uMouse, 0, SCR_USE.clone().lerp(SCR_CAT, S.uMouse).lerp(dronePos, S.uWatch), 0)
    seated(tgt[2], clock + 3.1, refuse ? 0.2 : S.pType, S.pMouse, S.pBack, SCR_PUB.clone().lerp(UP_PUB, S.pUp), 1.3)
    tgt[2].ikR = tgt[2].ikR!.clone()
    // the operator
    const op = tgt[1], where = operator(time, op)
    if (where === 'term') { op.ikR = new THREE.Vector3(TERM.x - 0.12, 1.0, TERM.z - 0.18).lerp(SCREEN_DOCK, S.tap); op.look = SCREEN_DOCK.clone(); op.headPitch = 0.1 * S.nod }
    if (where === 'gate') { op.ikR = new THREE.Vector3(GSTAND.x + 0.15, 1.0, GSTAND.z - 0.1).lerp(LAMPS.clone().add(V(0.25, 0.35).setY(-0.05)), S.gest); op.look = LAMPS.clone().setY(1.6 + 0.3 * S.gest) }
    if (where === 'home' || where === 'home0') { op.look = new THREE.Vector3(GATE.x, 1.0, BELT.z).lerp(new THREE.Vector3(BLADE_END_X, 0.9, BELT.z), Math.min(1, S.bu)); op.headPitch = 0.12 * S.nod }
    if (where === 'bay') op.look = BAY_POS.clone()
    // the blade
    let ry = Math.PI / 2
    if (S.push > 0) {
      onBelt(1, bl); bl.x = PUSH.x
      const kk0 = S.push
      if (kk0 < 0.45) bl.z += (kk0 / 0.45) * 0.55
      else { const kk = (kk0 - 0.45) / 0.55; bl.z = BELT.z + 0.55 + (BIN.z - BELT.z - 0.55) * kk; bl.y = (BELT.y - 0.04 + UNIT.h / 2) * (1 - kk) + 0.16 * kk }
      ry += 0.3 * Math.min(1, kk0 * 2)
    } else if (S.bu <= 2) onBelt(S.bu, bl)
    else if (S.bu < 3) { onBelt(2, bl); bl.lerp(carryPoint(op, v), S.bu - 2); ry = lerpAng(Math.PI / 2, op.heading - Math.PI / 2, S.bu - 2) }
    else if (S.bu === 3) { carryPoint(op, bl); ry = op.heading - Math.PI / 2 }
    else if (S.bu < 4) {
      const kk = S.bu - 3; carryPoint(op, v)
      if (kk < 0.5) bl.lerpVectors(v, BAY_FRONT, kk / 0.5); else bl.lerpVectors(BAY_FRONT, BAY_POS, (kk - 0.5) / 0.5)
      ry = lerpAng(op.heading - Math.PI / 2, 0, Math.min(1, kk * 2.5))
    } else { bl.copy(BAY_POS); ry = 0 }
    // the operator's hands on the sides of the blade: to pick it up, carry it, insert it
    const handsOn = S.bu >= 2 && S.bu < 4 && S.push === 0 ? (S.bu < 3 ? S.reach : S.bu > 3.6 ? Math.max(0, 1 - (S.bu - 3.6) / 0.4) : 1) : 0
    if (handsOn > 0) {
      // the figure's left is its local +x; the hands on either side of the blade, on the shoulder axis
      const turn = S.bu > 3 ? Math.min(1, (S.bu - 3) * 2.5) : 0, under = THREE.MathUtils.clamp((S.bu - 2) * 2, 0, 1) * (1 - turn)
      const sd = sideOf(op.heading, THREE.MathUtils.lerp(0.33, 0.24, turn))
      const yh = bl.y - (UNIT.h / 2 - 0.01) * under
      const L = bl.clone().add(sd).setY(yh), Rr = bl.clone().sub(sd).setY(yh)
      const jj = people.joints({ ...op, ikL: null, ikR: null })
      op.ikL = jj.aL.w.clone().lerp(L, handsOn); op.ikR = jj.aR.w.clone().lerp(Rr, handsOn); op.pron = 0
      if (!op.look) op.look = bl.clone()
    }
    // In the overview the figurines are a few pixels tall: their pose (inverse kinematics, skeleton)
    // is recomputed every other frame (30 Hz); on focus, every frame
    if (!api.lite || snap || (++pf & 1)) {
      people.settle(0, tgt[0], k); people.settle(1, op, where.startsWith('walk') ? Math.max(k, 0.55) : k); people.settle(2, tgt[2], k)
      people.update()
    }
    snap = false
    const inRack = S.bu >= 4
    R.blades.setMatrixAt(R.MOVING, inRack ? m4.makeScale(0, 0, 0) : m4.compose(bl, q.setFromEuler(e.set(0, ry, 0)), s1))
    R.blades.setMatrixAt(TK, inRack ? m4.compose(BAY_POS, q.identity(), s1) : m4.makeScale(0, 0, 0))
    R.blades.instanceMatrix.needsUpdate = true
    col.copy(off).lerp(orange, S.ledO).lerp(green, S.ledG).lerp(red, S.ledR)
    if (S.busy > 0.5 && Math.floor(time * 10) % 2) col.multiplyScalar(0.35)
    tmp.set(0.13, 0, UNIT.d / 2 + 0.002).applyEuler(e.set(0, ry, 0))
    R.diodes.setMatrixAt(NRK * 2, inRack ? m4.makeScale(0, 0, 0) : m4.compose(v.copy(bl).add(tmp), q.setFromEuler(e.set(0, ry, 0)), s1))
    R.diodes.setColorAt(NRK * 2, col)
    // the bay LED: green when the blade is in (racked), blinks during a request
    const rk = inRack ? new THREE.Color(STATE_HEX.off).lerp(green, S.rackG) : new THREE.Color(STATE_HEX.off)
    if (inRack && S.busy > 0.5 && Math.floor(time * 10) % 2) rk.multiplyScalar(0.35)
    R.diodes.setColorAt(TK, rk); R.diodes.setColorAt(NRK + TK, rk)
    R.diodes.instanceMatrix.needsUpdate = true; if (R.diodes.instanceColor) R.diodes.instanceColor.needsUpdate = true
    R.decal.position.copy(bl).add(v.set(0, UNIT.h / 2 + 0.004, 0)); R.decal.rotation.y = ry - Math.PI / 2
    R.decal.scale.setScalar(Math.max(1e-3, S.sealS * (inRack ? 0 : 1)))
    R.beltTex.offset.x = -beltDist(Math.min(S.bu, 2)) / 0.5
    // the lights: n lit in Arc blue; on rejection, the second one (the fingerprint) turns red
    const nb = Math.floor(S.bars + 1e-4)
    for (let i = 0; i < 5; i++) {
      const bad = refuse && i === 1 && S.verdict < 0
      R.gateBars.setColorAt(i, col.setHex(bad ? C.red : i < nb ? C.arcElec : C.off))
    }
    if (R.gateBars.instanceColor) R.gateBars.instanceColor.needsUpdate = true
    ;(R.scan.material as THREE.MeshBasicMaterial).opacity = 0.35 * S.scanA
    R.scan.position.set(GATE.x - 0.42 + 0.84 * S.scanY, BELT.y + 0.12, GATE.z); R.scan.scale.set(0.85, 0.12, 1)
    R.press.position.y = THREE.MathUtils.lerp(1.3, BELT.y - 0.04 + UNIT.h + 0.04, S.press)
    R.pusher.position.z = BELT.z - 0.42 + 0.6 * S.pusher
    R.doors.setMatrixAt(TK, m4.compose(v.set(T_POS.x - RACK.w / 2 + 0.02, 0, T_POS.z + FRONT + 0.005), q.setFromEuler(e.set(0, -1.85 * Math.min(1, S.insert * 1.6 + (S.bu > 3 && S.bu < 4 ? 1 : 0)), 0)), s1))
    R.doors.instanceMatrix.needsUpdate = true
    // screens
    const dU = doneOf('use'), dR = doneOf('rent'), dP = doneOf('publish')
    drawCatalog(scr.cat, !refuse && S.catChosen > 0.5 && dU >= 1)
    drawSession(scr.ses, refuse ? 0 : Math.min(Math.round(S.cliStep), dU >= 5 ? 4 : dU >= 4 ? 3 : dU >= 3 ? 2 : dU >= 2 ? 1 : 0), S.busy > 0)
    drawDock(scr.dock, refuse ? 1 : Math.min(Math.round(S.dock), dR >= 3 ? 3 : dR >= 2 ? 2 : 0))
    // Publish: center and right screens, the fingerprint card
    const ps = Math.min(Math.round(S.pScr), dP >= 4 ? 6 : Math.min(3, dP + 1))
    const over = w.deskScreens.publish[1], card = w.deskScreens.publish[2]
    over.visible = ps > 0; if (ps > 0) drawPubOverlay(scr.pub, ps, S.hashK)
    card.visible = S.card > 0.01 && S.card < 0.99
    if (card.visible) {
      drawCard(scr.card)
      const c0 = new THREE.Vector3(DESK.x, DESK_H + 0.46, DESK.z - 0.26), c1 = new THREE.Vector3(0, WALL_H.publish + 0.12, ISIZE.publish.z0 - 0.07)
      card.position.lerpVectors(c0, c1, S.card).add(v.set(0, Math.sin(S.card * Math.PI) * 0.35, 0)); card.rotation.set(0, Math.sin(S.card * 6) * 0.25, 0)
      card.scale.setScalar(1 - 0.5 * S.card); (card.material as THREE.MeshBasicMaterial).opacity = Math.min(1, (1 - S.card) * 4)
    }
    const code = w.deskScreens.publish[0].userData.code as THREE.Texture
    code.offset.y = -(clock * 0.03 + S.manLines * 0.05 + time * 0.01)
    // the drone takes off when the signed response arrives, hovers in the cage, then lands
    D.group.position.set(DRONE.x, DRONE.y + f * 1.3 + (f > 0.98 ? Math.sin(clock * 3.1) * 0.04 : 0), DRONE.z)
    D.group.rotation.set(f > 0.05 ? Math.sin(clock * 1.7) * 0.06 : 0, f * 0.6, f > 0.05 ? Math.cos(clock * 1.3) * 0.05 : 0)
    const sp = f > 0.02 ? clock * 40 : 0
    ;[[0.16, 0.16], [-0.16, 0.16], [0.16, -0.16], [-0.16, -0.16]].forEach(([x, z], i) => D.rotors.setMatrixAt(i, m4.compose(v.set(x, 0.1, z), q.setFromEuler(e.set(0, sp + i, 0)), s1)))
    D.rotors.instanceMatrix.needsUpdate = true
    ;(D.rotors.material as THREE.MeshBasicMaterial).opacity = f > 0.02 ? 0.3 : 0.6
  }

  return {
    S, tl, rtl, apply, time: () => t,
    set lite(v: boolean) { api.lite = v },
    get refuse() { return refuse },
    stageActive: () => !!stage?.isActive(),
    setReal(r: { part: PartK; done: number } | null) { real = r },
    restart(withRefus: boolean) { stage?.kill(); stage = null; refuse = withRefus; Object.assign(S, DEF); snap = true; if (withRefus) { tl.pause(); rtl.restart() } else { rtl.pause(); tl.restart() } },
    seek(withRefus: boolean, s: number) {
      stage?.kill(); stage = null
      refuse = withRefus; Object.assign(S, DEF); snap = true
      const T = withRefus ? rtl : tl; (withRefus ? tl : rtl).pause()
      T.pause(); T.seek(0, false); T.seek(s, false); apply()
    },
    // a step: seek to the start of its window and play it, then stop there (instant with reduced motion)
    playRange(t0: number, t1: number, instant = false) {
      stage?.kill(); stage = null; refuse = false; rtl.pause()
      Object.assign(S, DEF); tl.pause(); tl.seek(0, false); tl.seek(t0, false); snap = true
      if (instant) { tl.seek(t1, false); return null }
      stage = tl.tweenFromTo(t0, t1, { ease: 'none' })
      return stage
    },
    still() { this.seek(false, AT.end) },
  }
}
