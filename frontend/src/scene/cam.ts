// Camera framing, section by section, in metres and vertical field of view in degrees.
// - the hero rack is at x = 0, its neighbours at 0.75, 1.5 and 2.25 m, facades on the z = 0 plane;
// - interpolation: the position moves on a sphere centred on C0 = (0, 1, -0.5) (never a straight line through the
//   racks), target and field of view move linearly, with the same cubic in-out ease;
// - a horizontal view shift (fraction of the width; the subject moves right when negative);
// - the camera never goes behind the racks.
import * as THREE from 'three'
import { G, K, SLOTS, type Wall } from '../data/wall'
import type { SecId } from '../story'

export interface View { p: THREE.Vector3; t: THREE.Vector3; fov: number; shift: number }
export const mobileW = (W: number) => W < 760
/** Portrait, pinned pages: the image moves above the text panel */
export const pinShift = (H: number, panel: number) => Math.min(0.3, Math.max(0, (0.5 * H - (84 + H - panel) / 2) / H))
/** Phone: rack and sled in the top band of the screen (setViewOffset of 0.22 H) */
export const MOB_SHIFT = 0.22

/** Vertical field of view (degrees), fixed whatever the aspect; +12 on phones */
export function fovFor(W: number, H: number, hfov = 34) {
  const a = W / H
  if (a >= 1) return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov / 2)) / Math.min(a, 1.9)))
  return 46
}
/** Front view: the point (x, y, z) placed at (ndcX, ndcY) at distance d (service opened in place, Arc page) */
export function frontal(x: number, y: number, z: number, d: number, ndcX: number, ndcY: number, W: number, H: number, hfov = 34): View {
  const fov = fovFor(W, H, hfov)
  const tv = Math.tan(THREE.MathUtils.degToRad(fov / 2)), th = tv * (W / H)
  const p = new THREE.Vector3(x - ndcX * d * th, y - ndcY * d * tv, z + d)
  return { p, t: p.clone().add(new THREE.Vector3(0, 0, -d)), fov, shift: 0 }
}
const slot = (i: number) => (i >= 0 ? SLOTS[i] : SLOTS[8])

/** Right edge (px) of the text column fade, per section; stage.ts sets the overlay to the same value */
export function colEdge(id: SecId, W: number) {
  if (mobileW(W)) return 0
  const tab = W < 1100
  if (id === 'hero' || id === 'end') return 72 + Math.min(500, W * 0.36) + 12
  // The first pinned page has a narrower column (460 px) so the exploded view and its labels fit on the right
  const col = tab ? Math.min(520, W * 0.46) : id === 'protocol' ? Math.min(460, W * 0.32) : Math.min(540, W * 0.38)
  return 72 + col + 56
}

// ---- Poses ----
type V3 = [number, number, number]
interface Pose { p: V3; t: V3; fov: number; shift: number }
const P86 = {
  // Racks very slightly left of centre (view offset + 0.015 of the width)
  hero0: { p: [0.66, 1.1, 2.95], t: [0.0, 1.0, 0], fov: 33, shift: 0.015 },
  hero1: { p: [0.74, 1.12, 2.88], t: [0.0, 1.0, 0], fov: 33, shift: 0.015 },
  // State sections: the camera moves down the hero rack, slightly from the right; camera - target offset (1.03, 0.30, 1.5)
  // applied to the sled of each state section
  slots: { d: [1.03, 0.30, 1.5] as V3, fov: 32, shift: -0.185 },
  // Sled pull-out, target relative to the hero slot HS (x, facade bottom)
  out0: { p: [1.35, 1.42, 2.05], t: [0.05, 0.04, 0.5], fov: 32, shift: -0.18 }, // t relative to HS (x, y), z absolute
  out1: { p: [1.38, 1.46, 2.1], t: [0.05, 0.05, 0.55], fov: 32, shift: -0.18 },
  // Exploded view and Arc layer: relative to the centre of the staged sled STAGE (0.02, 0.98, 1.05)
  st: [
    { p: [0.78, 1.62, 2.25], t: [0.02, 0.98 + 0.08, 1.05], fov: 30, shift: 0.05 },
    { p: [0.8, 1.72, 2.3], t: [0.02, 0.98 + 0.14, 1.05], fov: 30, shift: 0.05 },
    { p: [0.78, 1.76, 2.28], t: [0.02, 0.98 + 0.14, 1.05], fov: 30, shift: 0.05 },
    // The sheet lands on the closed sled: same camera position, aim lowered by 10 and 7 cm so sled and sheet both fit
    { p: [0.72, 1.86, 2.18], t: [0.02, 0.98 + 0.06, 1.05], fov: 30, shift: 0.06 },
    { p: [0.66, 1.9, 2.1], t: [0.02, 0.98 + 0.05, 1.05], fov: 30, shift: 0.06 },
  ] as Pose[],
  // Back in the rack, target relative to HS (x, y), z absolute
  back: { p: [1.25, 1.5, 2.35], t: [0.0, 0.05, 0.2], fov: 32, shift: 0.1 },
  room0: { p: [0.55, 3.75, 1.45], t: [0.45, 0.62, -0.42], fov: 32, shift: -0.16 },
  room1: { p: [0.6, 3.9, 1.4], t: [0.45, 0.58, -0.42], fov: 32, shift: -0.16 },
} as const
export const STAGE86 = new THREE.Vector3(0.02, 0.98, 1.05)
/** HS: slotPos(16) = (column x, Z0 + row x pitch + 0.003) */
const hsOf = (i: number) => { const s = slot(i); return new THREE.Vector3(s.x, s.base + 0.003, 0) }
const mk = (p: readonly number[], t: readonly number[], fov: number, shift: number): View => ({ p: new THREE.Vector3(p[0], p[1], p[2]), t: new THREE.Vector3(t[0], t[1], t[2]), fov, shift })

/** Phone: same pose, field of view +12 (7 less on the exploded stack) */
function mob(v: View, W: number, tight = 0): View { if (mobileW(W)) { v.fov += 12 - 7 * tight; v.shift = 0 } return v }

export function keyView(id: SecId, wall: Wall, W: number, H: number, f = 0): View {
  void H
  switch (id) {
    case 'hero': {
      // The camera drifts while the headline is read
      const a = P86.hero0, b = P86.hero1
      return mob(sphLerp(mk(a.p, a.t, a.fov, a.shift), mk(b.p, b.t, b.fov, b.shift), ease(Math.min(1, f))), W)
    }
    case 'use': case 'rent': case 'publish': case 'invalid': {
      const i = id === 'use' ? wall.ex.use : id === 'rent' ? wall.ex.rent : id === 'publish' ? wall.ex.publish : wall.ex.invalid
      const s = slot(i)
      let y = s.y
      if (id === 'invalid' && wall.ex.inactive >= 0 && Math.abs(slot(wall.ex.inactive).y - s.y) < 0.45) y = (s.y + slot(wall.ex.inactive).y) / 2
      // Target is the middle of the rack (x + 0.02), at the height of the section sled
      const t = new THREE.Vector3(G.RX[s.bay] + 0.02, y, 0)
      const d = P86.slots.d
      return mob({ p: t.clone().add(new THREE.Vector3(d[0], d[1], d[2])), t, fov: P86.slots.fov, shift: P86.slots.shift }, W)
    }
    case 'protocol': return protocolView(0, wall, W, H)
    case 'arc': return arcView(0, wall, W, H)
    case 'end': default: {
      // The last shot returns to the hero framing, so the visitor can pick a slot again
      void f
      const b = P86.hero1
      return mob(mk(b.p, b.t, b.fov, b.shift), W)
    }
  }
}

const sm = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }
// Drawer travel: it slides out on telescopic rails until every rising layer (and the lid) is clear of the rack:
// their back edge (0.765 m) passes 5 cm in front of the facade, nothing goes through the shelf above
export const PULL_OUT = 0.95 * K
/** Centre of the pulled-out sled (world) */
export function sledCenter(i: number, pull: number, out = new THREE.Vector3()) {
  const s = slot(i)
  return out.set(s.x, s.base + G.SH / 2, pull - G.Y0 - G.SD / 2)
}
const _c = new THREE.Vector3()
// First pinned page: the sled slides out on its rails, leaves them and rises in front of the rack, turned 0.38 rad
// towards the camera; the exploded view, the closing and the Arc sheet happen there; then it comes back down onto its
// rails and slides in. Poses are relative to the sled: at its slot while pulling out, at the centre of the raised sled
// on stage. The stage sits 0.159 m right of the replayed slot, at z = 1.05, 0.10 m above the stored sled centre.
// The timeline of each step is PT below.
export const STAGE_ROT = 0.38
export const STAGE_DX = 0.159, STAGE_Z = 1.05, STAGE_UP = 0.10
/** Centre of the raised sled (world) */
export function stageCenter(i: number, out = new THREE.Vector3()) {
  const s = slot(i)
  return out.set(s.x + STAGE_DX, s.base + G.SH / 2 + STAGE_UP, STAGE_Z)
}
/** Timeline of the first pinned page (read by stage.ts and the Story section) */
// The sled is moved aside (raised, turned, framed) before the lid lifts and the layers spread; it stays there until
// the sheet has landed, then goes back in. The lid waits for the rise to finish, the explode waits for the lid; on the
// way back the sled only comes down once everything is closed (stage.ts)
export const PT = { out0: 0.0, out1: 0.13, up0: 0.13, up1: 0.23, lid0: 0.25, lid1: 0.29, ex0: 0.29, ex1: 0.41, exC0: 0.5, exC1: 0.525, lidC0: 0.525, lidC1: 0.565, sh0: 0.575, sh1: 0.68, dn0: 0.76, dn1: 0.84, in0: 0.85, in1: 0.95 }
// Stage framing (desktop): field of view, sled centre on screen without shift (fraction of the width, measured),
// sled position in the free area (fraction of the area, from the column)
const STAGE_FOV = 36, SHEET_FOV = 37, STAGE_C0 = 0.525, SHEET_C0 = 0.469, STAGE_SPAN = 0.315
const PROTO_K = [0.0, 0.13, 0.24, 0.36, 0.5, 0.62, 0.76, 0.96]
const _sc = new THREE.Vector3()
export function protocolView(p: number, wall: Wall, W: number, H: number): View {
  void H
  const hs = hsOf(wall.replay)
  stageCenter(wall.replay, _sc)
  const rel = (q: Pose): View => mk(
    [_sc.x + q.p[0] - STAGE86.x, _sc.y + q.p[1] - STAGE86.y, _sc.z + q.p[2] - STAGE86.z],
    [_sc.x + q.t[0] - STAGE86.x, _sc.y + q.t[1] - STAGE86.y, _sc.z + q.t[2] - STAGE86.z], q.fov, q.shift)
  const hsV = (q: Pose): View => mk([hs.x + q.p[0] + 0.139, q.p[1] - 1.015 + hs.y, q.p[2]], [hs.x + q.t[0], hs.y + q.t[1], q.t[2]], q.fov, q.shift)
  // On stage the camera keeps its position and aim; the lens opens a little and the view shift puts the sled in the
  // middle of the free area right of the text column, leaving the right band for the labels
  const stg = P86.st.map(rel)
  if (!mobileW(W)) {
    const edge = colEdge('protocol', W) / W
    // The first three poses (exploded, labels on the right) and the last two (Arc sheet on the closed sled: tighter, so the
    // logo stays legible)
    stg.forEach((v, j) => {
      const fov = j < 3 ? STAGE_FOV : SHEET_FOV, span = j < 3 ? STAGE_SPAN : 0.44
      const c0 = 0.5 + ((j < 3 ? STAGE_C0 : SHEET_C0) - 0.5) * Math.tan(THREE.MathUtils.degToRad(42 / 2)) / Math.tan(THREE.MathUtils.degToRad(fov / 2))
      v.fov = fov; v.shift = c0 - (edge + span * (1 - edge))
    })
  }
  // Leaving Invalid, the camera faces the sled that is about to come out, slightly above and from the right; during the
  // pull-out it follows it and settles just above it, then joins the stage. Always in front of the facades
  const so = slot(wall.replay)
  const outShift = mobileW(W) ? 0 : 0.5 - (colEdge('protocol', W) / W + 0.42 * (1 - colEdge('protocol', W) / W))
  const tIn = new THREE.Vector3(so.x, so.y, 0.02)
  const cOut = sledCenter(wall.replay, PULL_OUT, new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, 0.12))
  const out0: View = { p: tIn.clone().add(new THREE.Vector3(0.28, 0.34, 1.25)), t: tIn, fov: 32, shift: outShift }
  const out1: View = { p: cOut.clone().add(new THREE.Vector3(0.42, 0.55, 1.12)), t: cOut, fov: 32, shift: outShift }
  void hsV
  const keys: View[] = [out0, out1, ...stg, hsV(P86.back as unknown as Pose)]
  let i = 0
  while (i < PROTO_K.length - 2 && p > PROTO_K[i + 1]) i++
  const k = ease(Math.min(1, Math.max(0, (p - PROTO_K[i]) / (PROTO_K[i + 1] - PROTO_K[i]))))
  const tight = sm((p - 0.2) / 0.06) * (1 - sm((p - 0.8) / 0.08))
  return mob(sphLerp(keys[i], keys[i + 1], k), W, tight)
}
// Second pinned page: front view, close to the replayed sled, its LED and the gap above where the Arc light glows;
// the sled right of the text column
export function arcView(_p: number, wall: Wall, W: number, H: number): View {
  const s = slot(wall.replay), m = mobileW(W)
  if (m) return frontal(s.x, s.y, 0, 0.9, 0, 0, W, H)
  const th = Math.tan(THREE.MathUtils.degToRad(fovFor(W, H) / 2)) * (W / H)
  const edge = (2 * (colEdge('arc', W) + 12)) / W - 1
  const bl = G.RX[s.bay] - G.BW / 2
  let dd = W < 1100 ? 1.8 : 1.4
  while (dd < 4 && edge + G.BW / (dd * th) > 0.985) dd += 0.05
  return frontal(s.x, s.y + 0.02, 0, dd, edge + (s.x - bl) / (dd * th), 0, W, H)
}
/** Service opened in place: the camera approaches the open sled, centred in the area the panel leaves on the right */
export function svcView(i: number, W: number, H: number): View {
  const s = slot(i)
  if (mobileW(W)) return frontal(s.x, s.y, 0, 0.8, 0, 0.55, W, H)
  const pw = Math.min(520, W * 0.42)
  return frontal(s.x, s.y + 0.01, 0, 0.95 * K, (2 * (W - pw) * 0.5) / W - 1, 0.04, W, H)
}
export function lerpView(a: View, b: View, k: number): View {
  return sphLerp(a, b, k)
}

// ---- Interpolation: position on a sphere around C0, target and field of view linear ----
const C0 = new THREE.Vector3(0, 1, -0.5)
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const _d = new THREE.Vector3()
function sph(p: THREE.Vector3) { _d.copy(p).sub(C0); const r = _d.length(); return { r, az: Math.atan2(_d.x, _d.z), el: Math.asin(Math.min(1, Math.max(-1, _d.y / r))) } }
export function sphLerp(a: View, b: View, k: number): View {
  if (k <= 0) return { p: a.p.clone(), t: a.t.clone(), fov: a.fov, shift: a.shift }
  if (k >= 1) return { p: b.p.clone(), t: b.t.clone(), fov: b.fov, shift: b.shift }
  const pa = sph(a.p), pb = sph(b.p)
  let daz = pb.az - pa.az
  if (daz > Math.PI) daz -= 2 * Math.PI
  if (daz < -Math.PI) daz += 2 * Math.PI
  const r = pa.r + (pb.r - pa.r) * k, az = pa.az + daz * k, el = pa.el + (pb.el - pa.el) * k
  const p = new THREE.Vector3(C0.x + r * Math.cos(el) * Math.sin(az), C0.y + r * Math.sin(el), C0.z + r * Math.cos(el) * Math.cos(az))
  return { p, t: a.t.clone().lerp(b.t, k), fov: a.fov + (b.fov - a.fov) * k, shift: a.shift + (b.shift - a.shift) * k }
}
