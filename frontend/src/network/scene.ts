// API for the page (NetworkPage.tsx and src/network/actions/):
//   playStep(part, i, state?) plays step i of the part, then stops at its end (i = the step index in the page,
//                           0 = connection). Use: 1 service choice, 2 Arc key, 3 sealed request, 4 signed
//                           response and drone, 5 payment. Rent: 1 deposit, 2 start (blade on the belt),
//                           3 pairing (dock screen), 4 gantry, 5 rack, 6 payment received. Publish: 1 manifest,
//                           2 fingerprint, price and shares, 3 the fingerprint rises to Arc, 4 review, 5 the image
//                           to the machine, 6 revenue. A new call on the same step does not replay it; state 'done'
//                           on the last step of the page (Rent 4, Publish 4): the scene chains the final steps on its
//                           own (5 then 6). Without a call, the focus plays the part in one go (up to step 5);
//   focusCamera(part, el?)  the camera moves behind the actor's shoulder (the user, the operator facing the gantry and
//                           the racks, the dev); the other islands leave the frame; el (a pick id, e.g. 'rent.portique')
//                           frames that element from the same shoulder;
//   overview()              back to the overview (automatic oscillation);
//   all three also on window.__s3d.playStep(part, i), window.__s3d.focusCamera(part, el) and window.__s3d.overview().
// Low perspective, bounded mouse manipulation (rotation, zoom; back to the oscillation without the hand),
// particles in three layers, large titles, Use-specific CCTP link, lamps on the gantry, USDC tokens on
// money packets, rigged figures.
// 3D diagram "Use, Rent, Publish": tall, large signs, direct exchanges between actors
// (Use and the machine, Publish and the machine) besides those going through Arc, isometric angle with a slow
// camera oscillation (±25°, 75 s), Arc-coloured particles in the same render, column laid over the scene.
// Layout:
// - the three islands fixed around Arc, all facing the overview camera; on focus, the camera settles on the island
//   without turning (signs stay readable), the Arc hologram shrinks and the other islands fade out;
// - titles are signs, placed above the back wall of their island, with a fixed anchor;
// - a single link per title to Arc; the sealed request runs along Arc without entering it;
// - at rest, no label; on hover, a single one, at a hand-written position; on focus, all text goes to the
//   left column; verification reads on the five gantry posts and in the "n/5" step.
// Parameters: ?focus=use|rent|publish, ?refus=1, ?t=ms or ?s=0..1 (frozen), ?motion=0, ?gl=0.
import * as THREE from 'three'
import gsap from 'gsap'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { build, picks, type World, type PartK, type Link, type State, LINKS, NSEG, LINK_PART, PART, ARC_Y, ARC_H, GATE, BELT, BIN, RK, C, RACKS, RACK, WALL_H, LAMP, USDC_D, NUSDC, TITLE_SIZE, makeTitle } from './world'
import { People } from './people'
import { Rig, type Pose, D0, FOV, H0 } from './rig'
import { makeLoop, hlAt, CHECK, LOOP_S, REFUS_S, STAGES, AUTO_LAST, PEND, OPS, BAY_POS, type Range } from './loop'
import { parts, checks, fiche, pkName, ui, ISLAND_OF, type View, type Part, type Fiche, type Place } from './data'
import { buildChains, ringCenter, CHAIN_DEFS, CHAIN_SIZE } from './chains'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { makeHoverModal, type Box } from './modals'
import { setDemo } from './actions/store'
import { onLang, lg } from './lang'
import { dress } from './dressing'
import { siteReady, CLIENT } from './screens'
import { makeAtmo } from './atmo'
import { makeDemo } from './demo'
import { arcPanel } from './arcfocus'
import { ARC_TITLE, ARC_INTRO, BEATS, clientAt, tr, type Actor, type DStep, type Shot, type Beat } from './demo-strings'

const Q = new URLSearchParams(location.search)
const reduced = Q.get('motion') === '0' || matchMedia('(prefers-reduced-motion: reduce)').matches
const freeze = Q.has('t') || Q.has('s')
const SPIN_K = Number(Q.get('spin') ?? 1) // speeds up the oscillation (demo film only)
const mobileMQ = matchMedia('(max-width: 760px)')
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T
const stage = $('#stage'), canvas = $<HTMLCanvasElement>('#gl'), selEl = $('#sel'), pkLabel = $('#pk-label')
const DEG = Math.PI / 180
const EXPRESSIVE = 'power2.inOut'
declare global { interface Window { __frontReady?: boolean; __s3d?: unknown } }

// ---------- Rendering ----------
let renderer: THREE.WebGLRenderer | null = null
try {
  if (Q.get('gl') === '0') throw new Error('gl=0')
  // the context is requested first without three: if the browser refuses it (WebGL missing or blocked after context
  // losses), fall back to the still image with no console error
  const ctx = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance', alpha: false })
  if (!ctx) throw new Error('webgl2 indisponible')
  renderer = new THREE.WebGLRenderer({ canvas, context: ctx, antialias: true, powerPreference: 'high-performance' })
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.22
} catch { renderer = null }
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x10141a)
const atmo = makeAtmo(0x10141a); scene.add(atmo.mesh) // animated background, continuing the landing
const atmoV = new THREE.Vector3(), atmoO = { x: 0, y: 0 }
const STATES: State[] = ['off', 'green', 'orange', 'green', 'green', 'green', 'orange', 'green', 'red']
const W: World = build(STATES)
scene.add(W.root)
const people = new People(3)
people.parents = [W.islands.use.group, W.islands.rent.group, W.islands.publish.group]
W.root.add(people.mesh, people.blobs)
scene.add(new THREE.HemisphereLight(0xb4c6dd, 0x1a1f26, 1.7))
const key = new THREE.DirectionalLight(0xdfe8f5, 1.5); key.position.set(-6, 10, 7); scene.add(key)
const rim = new THREE.DirectionalLight(0x7f9cc4, 0.55); rim.position.set(6, 6, -8); scene.add(rim)
// the dev's desk lamp (Publish), the only warm light: it lights the figure and the reflections live; placed
// on the island bulb every frame; always in the scene (the light count never changes: nothing recompiles)
const lampLight = new THREE.PointLight(0xffb36b, 0, 3.4, 2); scene.add(lampLight)
if (renderer) { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45; pm.dispose() }
const rig = new Rig()
// ---------- Arc-coloured particles, in three depth layers: a thin, dense far background, a middle
// layer around the islands, a few close, blurred grains in front; size by distance (perspective); a single
// Points in the same render as the scene (1 draw call), still in reduced motion ----------
const dust = (() => {
  const L3 = [{ n: 1700, r0: 16, r1: 40, y0: -10, y1: 22, s0: 1.4, s1: 2.6 }, { n: 1300, r0: 3, r1: 16, y0: -4, y1: 10, s0: 2.2, s1: 4.2 }, { n: 160, r0: 9, r1: 20, y0: 0, y1: 9, s0: 5, s1: 10 }]
  const N = L3.reduce((a, l) => a + l.n, 0), pos = new Float32Array(N * 3), seed = new Float32Array(N), sz = new Float32Array(N), lay = new Float32Array(N)
  let i = 0
  L3.forEach((l, k) => { for (let j = 0; j < l.n; j++, i++) {
    const r = l.r0 + Math.random() * (l.r1 - l.r0), a = Math.random() * Math.PI * 2
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = l.y0 + Math.random() * (l.y1 - l.y0); pos[i * 3 + 2] = Math.sin(a) * r
    seed[i] = Math.random() * 100; sz[i] = (Math.random() < 0.07 ? 1.7 : 1) * (l.s0 + Math.random() * (l.s1 - l.s0)); lay[i] = k
  } })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1)); g.setAttribute('aLay', new THREE.BufferAttribute(lay, 1))
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uDpr: { value: 1 }, uRef: { value: 34 }, uCut: { value: -2 }, uElec: { value: new THREE.Color(C.arcElec) }, uHalo: { value: new THREE.Color(0x3a6bff) } },
    vertexShader: /* glsl */`attribute float aSeed; attribute float aSize; attribute float aLay; uniform float uT; uniform float uDpr; uniform float uRef; varying float vB; varying float vBig; varying float vSoft; varying float vX;
      void main() {
        vec3 p = position;
        float sp = aLay == 2.0 ? 1.6 : 1.0;
        p.x += sin(uT * 0.05 * sp + aSeed) * 0.9; p.y += sin(uT * 0.07 + aSeed * 1.7) * 0.6 + mod(uT * 0.04 + aSeed, 4.0) * 0.25; p.z += cos(uT * 0.045 * sp + aSeed * 0.6) * 0.9;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = max(1.0, -mv.z);
        vBig = step(4.4, aSize) * step(aLay, 1.5);
        vSoft = aLay == 2.0 ? 1.0 : 0.0;
        vB = (0.35 + 0.65 * (0.5 + 0.5 * sin(uT * 0.6 + aSeed * 3.0))) * (aLay == 0.0 ? 0.8 : aLay == 2.0 ? 0.4 : 1.25);
        gl_PointSize = clamp(aSize * uDpr * uRef / d, 1.0, 64.0 * uDpr); gl_Position = projectionMatrix * mv; vX = gl_Position.x / gl_Position.w;
      }`,
    fragmentShader: /* glsl */`uniform vec3 uElec; uniform vec3 uHalo; uniform float uCut; varying float vB; varying float vBig; varying float vSoft; varying float vX;
      void main() { float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; float a = pow(1.0 - r, mix(1.6, 0.9, vSoft)) * mix(0.42, 0.95, vBig) * vB * mix(0.12, 1.0, smoothstep(uCut - 0.04, uCut + 0.2, vX)); gl_FragColor = vec4(mix(uHalo, uElec, max(vBig, vSoft * 0.5)) * a, a); }`,
  })
  m.toneMapped = false
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = -2; scene.add(p)
  return m
})()

// ---------- The galaxy. Three logarithmic spiral arms in the orbit plane, fine dust
// in Arc blue and a few grains in the room colours; the disc turns with the rooms (same orbit
// clock); a single Points, computed in the shader (rotation, twinkle) ----------
const galaxy = (() => {
  const N = 6000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N), seed = new Float32Array(N)
  const c = new THREE.Color(), elec = new THREE.Color(C.arcElec), halo = new THREE.Color(0x3a6bff), core = new THREE.Color(0xdfe8ff)
  const rooms = [PART.use.hex, PART.rent.hex, PART.publish.hex].map((h) => new THREE.Color(h))
  const g = () => { let u = 0; for (let i = 0; i < 4; i++) u += Math.random(); return (u - 2) / 1.15 } // nearly Gaussian
  for (let i = 0; i < N; i++) {
    const arm = i % 3, r = 3 + 37 * Math.pow(Math.random(), 1.35)
    const th = (arm * 2 * Math.PI) / 3 + 1.7 * Math.log(r / 3) + g() * (0.22 + 6 / (r + 6)) * 0.6
    const y = 0.4 + g() * (0.25 + 0.9 * Math.exp(-r / 9))
    pos[i * 3] = r * Math.sin(th); pos[i * 3 + 1] = y; pos[i * 3 + 2] = r * Math.cos(th)
    const q = Math.random()
    if (q < 0.1) c.copy(rooms[i % 3]); else c.copy(halo).lerp(elec, Math.random()).lerp(core, Math.max(0, 1 - r / 9) * 0.8)
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    sz[i] = (Math.random() < 0.05 ? 2.2 : 1) * (0.9 + Math.random() * 1.6); seed[i] = Math.random() * 100
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1)); geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uRot: { value: 0 }, uDpr: { value: 1 }, uRef: { value: 110 }, uK: { value: 1 }, uCut: { value: -2 } },
    vertexShader: /* glsl */`attribute vec3 aCol; attribute float aSize; attribute float aSeed; uniform float uT; uniform float uRot; uniform float uDpr; uniform float uRef; varying vec3 vC; varying float vA; varying float vX;
      void main() {
        float c = cos(uRot), s = sin(uRot); vec3 p = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); float d = max(1.0, -mv.z);
        vC = aCol; vA = 0.55 + 0.45 * sin(uT * 0.8 + aSeed * 3.0);
        gl_PointSize = clamp(aSize * uDpr * uRef / d, 1.0, 9.0 * uDpr); gl_Position = projectionMatrix * mv; vX = gl_Position.x / gl_Position.w; }`,
    fragmentShader: /* glsl */`uniform float uK; uniform float uCut; varying vec3 vC; varying float vA; varying float vX;
      void main() { float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; float a = pow(1.0 - r, 1.6) * 0.75 * vA * uK * mix(0.1, 1.0, smoothstep(uCut - 0.04, uCut + 0.2, vX)); gl_FragColor = vec4(vC * a, a); }`,
  })
  m.toneMapped = false
  const pts = new THREE.Points(geo, m); pts.frustumCulled = false; pts.renderOrder = -1; scene.add(pts)
  return m
})()
// a halo under each room, in its colour (an additive disc below the floor), detaching it from the void
const HALO_MAT: THREE.ShaderMaterial[] = []
function roomHalo(k: PartK) {
  const i = W.islands[k], w = Math.max(i.size.x1 - i.size.x0, i.size.z1 - i.size.z0) * 1.9
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Color(PART[k].hex) }, uK: { value: 1 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform vec3 uCol; uniform float uK; varying vec2 vUv; void main() { float r = length(vUv - 0.5) * 2.0; float a = exp(-r * r * 4.0) * 0.3 * uK; gl_FragColor = vec4(uCol * a, a); }`,
  })
  m.toneMapped = false; HALO_MAT.push(m)
  const h = new THREE.Mesh(new THREE.PlaneGeometry(w, w), m); h.rotation.x = -Math.PI / 2; h.position.set((i.size.x0 + i.size.x1) / 2, -0.06, (i.size.z0 + i.size.z1) / 2); h.renderOrder = -1; h.name = 'halo'
  i.group.add(h)
}

// ---------- Layout: three fixed islands at 120° around Arc, all facing the overview camera ----------
const AZ0 = -38 // a true isometric angle, turned further
const ISO = 30 // islands are shown three-quarter (40° to the camera): two faces visible, depth
// on focus, the other islands leave the frame (they move aside and down), then disappear
const outK: Record<PartK, number> = { use: 0, rent: 0, publish: 0 }
const IY = (AZ0 + ISO) * Math.PI / 180
const ORDER: PartK[] = ['use', 'rent', 'publish']
const BASE: Record<PartK, number> = { rent: 0, use: -120, publish: 120 }
let clock = 0
// ---------- Orbits. Each room orbits Arc on its own orbit: its radius (and a little
// eccentricity), its height and tilt (the orbit plane leans towards its node), its speed (a common mean
// pace, one turn in 5 min 20, plus a lead-lag specific to each room, on its own period). The mean pace
// is common on purpose: with different mean speeds, two rooms would end up crossing each other; here
// they stay more than 100° apart and never go backwards. Floors stay level (people walk on them),
// each room keeps its face towards the overview camera (readable signs). The orbit advances in the overview
// only, like the camera oscillation: it slows to a stop on hover, by hand, during a camera
// gesture, and freezes on focus (the targeted room does not move while it is read); ?t= freezes it at its time; in
// reduced motion, rooms stay at their start position. ----------
// A galaxy. Rooms much further from the A (13 to 20 m), on orbits at very different heights and
// tilts (relief and depth), a little faster (one turn in 3 min 20). Not everything fits
// in one frame: the rotation shows everything over time.
const ORB: Record<PartK, { r: number; e: number; h: number; inc: number; node: number; a: number; T: number }> = {
  use: { r: 13, e: 0.6, h: 1.1, inc: 1.9, node: 40, a: 8, T: 70 },
  publish: { r: 16.5, e: 0.8, h: -1.6, inc: 2.4, node: 170, a: 7, T: 91 },
  rent: { r: 20, e: 0.5, h: 0.2, inc: 1.4, node: 290, a: 6, T: 117 },
}
// orbits are ellipses lying along the overview camera axis: narrower across the screen
// (KX), longer in depth (KZ); the scene fits larger in the frame, passing in front of and behind Arc
// reads better
// on phones (narrow, tall frame), the ellipses tighten further across (KX 0.62): the scene fits
// larger there; rooms stay more than 7 m apart
// circles (a galaxy seen in perspective) instead of tightened ellipses
let KX = 1
const KZ = 1
const OMEGA = 360 / 200 // °/s, the mean pace
let orbT = 0, orbV = 0
function orbitAt(k: PartK, t: number) {
  const o = ORB[k], w = (2 * Math.PI * t) / o.T
  const a = (AZ0 + BASE[k] + OMEGA * t + o.a * Math.sin(w)) * DEG
  return { a, r: o.r + o.e * Math.sin(w + 1.3), y: o.h + o.inc * Math.sin(a - o.node * DEG) }
}
const AZC = AZ0 * DEG, CA = Math.cos(AZC), SA = Math.sin(AZC)
// a position on the orbit: angle a (around Arc, 0 = towards the overview camera at AZ0), radius r, height y
function orbXYZ(a: number, r: number, y: number, out: THREE.Vector3) {
  const u = a - AZC, lat = r * KX * Math.sin(u), dep = r * KZ * Math.cos(u)
  return out.set(lat * CA + dep * SA, y, -lat * SA + dep * CA)
}
const orbPos = (k: PartK, t: number, out = new THREE.Vector3()) => { const P = orbitAt(k, t); return orbXYZ(P.a, P.r, P.y, out) }
const op_ = new THREE.Vector3()
// Intro. Links draw from Arc to each role, then the rooms settle one by one,
// then the CCTP system (1.15 s in total); intro.* is 1 outside the intro (frozen, reduced motion, direct focus)
const intro = { links: 1, r: [1, 1, 1], cc: 1 }
let SIGN_K = 1
function playIntro() {
  if (reduced || freeze || view !== 'ensemble') return
  intro.links = 0; intro.r = [0, 0, 0]; intro.cc = 0
  const tl = gsap.timeline()
  tl.to(intro, { links: 1, duration: 0.55, ease: 'power2.out' }, 0)
  ORDER.forEach((_, i) => tl.to(intro.r, { [i]: 1, duration: 0.42, ease: 'back.out(1.5)' }, 0.3 + i * 0.16))
  tl.to(intro, { cc: 1, duration: 0.4, ease: 'back.out(1.4)' }, 0.75)
  hotTween(tl)
}
function layout() {
  ORDER.forEach((k, i) => {
    const g = W.islands[k].group
    const o = outK[k]
    orbPos(k, orbT, op_)
    if (demoK.k > 0) { // in the demo, each room glides to its fixed place, in the front half, closer to Arc
      const P = orbitAt(k, orbT), u = (AZ0 + DEMO_U[k]) * DEG, r = ORB[k].r * 0.58, dp = orbXYZ(u, r, P.y * 0.5, new THREE.Vector3())
      op_.lerp(dp, demoK.k)
    }
    const ir = intro.r[i]
    g.position.set(op_.x * (1 + 0.9 * o), op_.y + (reduced ? 0 : 0.05 * Math.sin(clock * 0.55 + i * 2.1)) - (view === 'demo' ? 45 * o : 6 * o * o) - 1.2 * (1 - ir), op_.z * (1 + 0.9 * o))
    g.scale.setScalar(Math.max(0.001, (0.6 + 0.4 * ir) * (view === 'demo' ? 1 - o : 1))); g.visible = ir > 0.01 && (view === 'ensemble' || view === 'demo' || view === k || outK[k] < 0.999) // in the demo, never hidden (making a group visible costs a long frame at the start of a shot): it only leaves the frame
    g.rotation.set(0, IY, 0)
    g.updateMatrixWorld(true)
  })
  const pg = W.islands.publish.group
  lampLight.position.copy(pg.localToWorld(LAMP.clone())); lampLight.intensity = pg.visible ? 1.5 * (1 - outK.publish) : 0
}

// ---------- Signs: the back wall of each island (opposite the camera), the title placed on it ----------
const wallMat = new THREE.MeshStandardMaterial({ color: C.graphite, roughness: 0.68, metalness: 0.3 })
for (const k of ORDER) {
  const s = W.islands[k].size, w = s.x1 - s.x0 - (k === 'rent' ? 0.12 : 0.3)
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H[k], 0.12), wallMat.clone())
  m.position.set((s.x0 + s.x1) / 2 + (k === 'rent' ? 0.06 : 0), WALL_H[k] / 2, s.z0 + 0.08); m.name = 'wall'
  W.islands[k].group.add(m); (W.islands[k].group.userData.mats as THREE.Material[]).push(m.material as THREE.Material)
  ;(m.material as THREE.MeshStandardMaterial).userData.base = new THREE.Color(C.graphite)
}
const wv = (k: PartK, v: THREE.Vector3) => W.islands[k].group.localToWorld(v.clone())
for (const k of ORDER) roomHalo(k)

// signs high above the rooms (1.6 m above the wall)
const SIGN_GAP = 1.6
const titleLocal = (k: PartK) => new THREE.Vector3((W.islands[k].size.x0 + W.islands[k].size.x1) / 2, WALL_H[k] + SIGN_GAP, W.islands[k].size.z0 + 0.08)
// the sign half-follows the camera (45% of the gap towards it), without leaving its wall
// signs stay parallel to the back wall they stand on (the room yaw IY, 30° off the overview camera):
// they turn with their room, not with the camera
const titleYaw = () => IY
function titles() {
  // placed on their wall, they follow the camera rotation a little (55%) to stay readable
  const sc = rig.h / (2 * Math.tan((rig.cam.fov / 2) * DEG))
  for (const k of ORDER) {
    const t = W.titles[k]; t.mesh.position.copy(wv(k, titleLocal(k))); t.mesh.rotation.set(0, titleYaw(), 0)
    t.mesh.rotation.order = 'YXZ'; t.mesh.rotation.x = -mapTilt.x * DEG // on the map, signs tilt towards the plunging camera
    t.mesh.scale.setScalar(SIGN_K * intro.r[ORDER.indexOf(k)] * (1 - 0.42 * demoK.k) * (view === 'demo' ? 1 - outK[k] : 1)) // the sign follows its room out of the frame; larger signs on phones; intro
    // the hologram scan lines and sweep run on the scene clock (like the A: frozen by ?t=)
    t.mat.uniforms.uT.value = clock; t.glow.sparkMat.uniforms.uT.value = clock; t.glow.sparkMat.uniforms.uScale.value = sc
    t.glow.sparkMat.uniforms.uOn.value = reduced ? 0 : 1
  }
}
// the box of the letters alone (without the glow or the sparks, children of the mesh)
const titleBox = (k: PartK) => { const m = W.titles[k].mesh; m.updateMatrixWorld(true); if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); return m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld) }

// ---------- Links: one per title to Arc; the sealed request follows them along Arc without entering ----------
const linkPts = Object.fromEntries(LINKS.map((k) => [k, Array.from({ length: NSEG + 1 }, () => new THREE.Vector3())])) as Record<Link, THREE.Vector3[]>
function resample(poly: THREE.Vector3[], out: THREE.Vector3[]) {
  const L: number[] = [0]
  for (let i = 1; i < poly.length; i++) L.push(L[i - 1] + poly[i].distanceTo(poly[i - 1]))
  const T = L[L.length - 1] || 1
  let j = 1
  for (let i = 0; i <= NSEG; i++) {
    const d = (i / NSEG) * T
    while (j < poly.length - 1 && L[j] < d) j++
    const a = L[j - 1], b = L[j], f = b > a ? (d - a) / (b - a) : 0
    out[i].lerpVectors(poly[j - 1], poly[j], THREE.MathUtils.clamp(f, 0, 1))
  }
}
const bez = (a: THREE.Vector3, b: THREE.Vector3, lift: number, n = 24) => new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).setY(Math.max(a.y, b.y) + lift), b).getPoints(n)
const RIM = 1.45
const arcPoint = (from: THREE.Vector3) => { const d = new THREE.Vector3(from.x, 0, from.z).normalize(); return new THREE.Vector3(d.x * RIM, ARC_Y + 0.3, d.z * RIM) }
const ang = (p: THREE.Vector3) => Math.atan2(p.x, p.z)
const circle = (r: number, y: number, a0: number, a1: number, n = 30) => {
  let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (d * i) / n; return new THREE.Vector3(r * Math.sin(a), y, r * Math.cos(a)) })
}
const titleFoot = (k: PartK) => wv(k, titleLocal(k).add(new THREE.Vector3(0, 0.2, 0)))
let linksOn = true
// The CCTP system, away from Arc. The holographic USDC token at the centre, the seven chain logos
// (chains.ts) in a ring around it, the ring turns and tilts; the "CCTP" title above, treated like the
// room signs; a single anchor point, above the title. The token-to-logos gap equals the
// sign-to-room gap (SIGN_GAP plus half a room width). The system also orbits, far away, on its own orbit.
// the system stays far behind Arc (it never passes in front of the camera), it drifts slowly by ±14°
// the chain ring is almost horizontal, like a mobile around the token
const CC = { r: 32, h: 3, a0: AZ0 + 180 + 24, drift: 14, ring: 3.6, coin: 2.4, tilt: 0.1 }
const CHAINS = (() => {
  const g = new THREE.Group()
  const c = buildChains(CC.ring)
  const coin = new THREE.InstancedMesh(W.usdc.mesh.geometry, W.usdc.mat.clone(), 1); coin.frustumCulled = false; coin.renderOrder = 9
  const t = makeTitle('CCTP') // the same Arc hologram as the A and the room signs
  g.add(c.mesh, coin, t.mesh); W.root.add(g)
  // the title above the top of the ring, at the same gap as a sign above its room
  const titleY = CC.ring * Math.sin(CC.tilt) + CHAIN_SIZE / 2 + SIGN_GAP * 0.7
  // it is far: its title is larger to read like the room signs
  const TS = 1.7
  t.mesh.position.set(0, titleY, 0); t.mesh.scale.setScalar(TS)
  const anchor = new THREE.Vector3(0, titleY + TS * TITLE_SIZE * 0.72 + 0.5, 0)
  return { group: g, mat: c.mat, logos: c.logos, anchor, coin, title: t }
})()
const ccM = new THREE.Matrix4(), ccQ = new THREE.Quaternion(), ccS = new THREE.Vector3(), ccP = new THREE.Vector3()
let ccT = 0 // system orbit time (advances with the rooms' orbit)
const ccOut = { o: 0 }
// during the demo, the rooms and the CCTP system move closer to Arc (radii x0.58 and x0.6): tight
// shots, rooms much larger on screen
const demoK = { k: 0 }
const DEMO_U: Record<PartK, number> = { use: -75, publish: -12, rent: 68 } // degrees from the overview camera axis
const ccAz = () => (CC.a0 + CC.drift * Math.sin((2 * Math.PI * ccT) / 240)) * DEG
// the system position is computed without waiting for a frame (direct focus via ?focus=cctp)
const ccPos = () => { const a = ccAz(), r = CC.r * (1 - 0.4 * demoK.k); return new THREE.Vector3(r * Math.sin(a), CC.h, r * Math.cos(a)) }
function cctpFrame() {
  const g = CHAINS.group, a = ccAz()
  // on a room focus, the system leaves the frame like the other islands (moves aside, down, then disappears)
  const o = ccOut.o
  const cr = CC.r * (1 + 0.6 * o) * (1 - 0.4 * demoK.k)
  g.position.set(cr * Math.sin(a), CC.h - (view === 'demo' ? 45 * o : 10 * o * o), cr * Math.cos(a)) // in the demo, out of shot: well below the frame
  g.visible = (o < 0.98 || view === 'demo') && intro.cc > 0.01; g.scale.setScalar(Math.max(0.001, (0.6 + 0.4 * intro.cc) * (view === 'demo' ? 1 - o : 1)))
  g.rotation.y = 0 // the system does not turn towards the user; only the title and the token face it
  const camYaw = (rig.pose.az + rig.user.az + rig.drag.az) * DEG
  CHAINS.title.mesh.rotation.y = camYaw
  g.updateMatrixWorld(true)
  CHAINS.mat.uniforms.uOrb.value = reduced ? 0.4 : clock * 0.18; CHAINS.mat.uniforms.uTilt.value = CC.tilt
  ccS.setScalar(CC.coin / USDC_D); ccQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), camYaw + (reduced ? 0 : Math.sin(clock * 0.5) * 0.35))
  CHAINS.coin.setMatrixAt(0, ccM.compose(ccP.set(0, 0, 0), ccQ, ccS)); CHAINS.coin.instanceMatrix.needsUpdate = true
  ;(CHAINS.coin.material as THREE.ShaderMaterial).uniforms.uT.value = clock
  const tm = CHAINS.title
  tm.mat.uniforms.uT.value = clock; tm.glow.sparkMat.uniforms.uT.value = clock; tm.glow.sparkMat.uniforms.uOn.value = reduced ? 0 : 1
  tm.glow.sparkMat.uniforms.uScale.value = rig.h / (2 * Math.tan((rig.cam.fov / 2) * DEG))
}
const chainsAnchor = () => CHAINS.group.localToWorld(CHAINS.anchor.clone())
const chainCenter = (i: number) => CHAINS.group.localToWorld(ringCenter(CHAINS.logos[i].center, CHAINS.mat.uniforms.uOrb.value, CC.tilt))
const CCTP_P: Record<'en' | 'fr', { title: string; actor: string }> = {
  en: { title: 'Pay from other chains', actor: 'With CCTP, ArcHive is open to other chains as well as Arc, for every payment. USDC held on Ethereum, Base, Arbitrum, OP Mainnet, Solana, Avalanche or Polygon PoS is burned on its chain and minted on Arc, then pays.' },
  fr: { title: 'Payer depuis d’autres chaînes', actor: 'Grâce à CCTP, ArcHive est accessible depuis les autres chaînes, en plus d’Arc, pour tous les paiements. Les USDC sur Ethereum, Base, Arbitrum, OP Mainnet, Solana, Avalanche ou Polygon PoS sont brûlés sur leur chaîne et émis sur Arc, puis paient.' },
}
const CCTP_F: Record<'en' | 'fr', Fiche> = {
  en: { n: 'Your USDC from other chains', d: 'This link is on the user’s side: USDC held on Ethereum, Base, Arbitrum, OP Mainnet, Solana, Avalanche or Polygon PoS comes to Arc by CCTP (Circle’s cross-chain transfer), then pays for the service. The column marks the bridge itself “soon”.' },
  fr: { n: 'Vos USDC depuis d’autres chaînes', d: 'Ce lien est du côté de l’utilisateur : ses USDC sur Ethereum, Base, Arbitrum, OP Mainnet, Solana, Avalanche ou Polygon PoS arrivent sur Arc par CCTP (le transfert entre chaînes de Circle), puis paient le service. La colonne marque le pont lui-même « bientôt ».' },
}
// a logo card: its name, its CCTP domain, and what the transfer does
const chainFiche = (id: string): Fiche | undefined => {
  const d = CHAIN_DEFS.find((c) => 'cctp.' + c.id === id); if (!d) return undefined
  return lg() === 'fr'
    ? { n: d.name, kv: [['Domaine CCTP', String(d.domain)], ['Vers Arc', 'domaine 26'], ['Transfert', 'USDC brûlés ici, émis sur Arc']] }
    : { n: d.name, kv: [['CCTP domain', String(d.domain)], ['To Arc', 'domain 26'], ['Transfer', 'USDC burned here, minted on Arc']] }
}
const ficheOf = (id: string) => (id === 'link.cctp' ? CCTP_F[lg()] : id.startsWith('cctp.') ? chainFiche(id) : fiche(id))
// rooms move; the label position is chosen on hover (the orbit then stops): on the object's side,
// in the half of the screen it does not cover, then the other half as a fallback
const placeOf = (id: string): [Place, Place] | undefined => {
  if (!picks.has(id)) return undefined
  rig.project(vp.copy(anchorOf(id)), o2)
  const cx = (colFrac() * rig.w + rig.w) / 2, hz = o2.x < cx ? 'l' : 'r', top = o2.y < rig.h / 2
  return [`${top ? 'b' : 't'}${hz}` as Place, `${top ? 't' : 'b'}${hz}` as Place]
}
// A single anchor point per room, under its sign, and one for Arc, above its A; all
// lines go from point to point. Lines are thick (Line2, a single pass) and much brighter when active.
// At the foot of the sign, just above the wall and behind the letter plane (signs pass in front)
// the anchor above the name (lines no longer enter the room)
const anchorOf_ = (k: PartK) => wv(k, titleLocal(k).add(new THREE.Vector3(0, TITLE_SIZE * 0.72 + 0.45, -0.12)))
const arcAnchor = () => new THREE.Vector3(0, ARC_Y + (ARC_H / 2 + 0.3) * arcK.s, 0)
const ANCH = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 5)
ANCH.frustumCulled = false; W.root.add(ANCH)
const ANCH_COL = [new THREE.Color(PART.use.hex), new THREE.Color(PART.rent.hex), new THREE.Color(PART.publish.hex), new THREE.Color(C.arcElec), new THREE.Color(PART.use.hex)]
W.links.visible = false; W.root.remove(W.links)
const fat = (() => {
  const n = LINKS.length * NSEG
  const g = new LineSegmentsGeometry(); g.setPositions(new Float32Array(n * 6)); g.setColors(new Float32Array(n * 6))
  const m = new LineMaterial({ vertexColors: true, linewidth: 2.4, transparent: true, depthWrite: false, worldUnits: false })
  m.toneMapped = false
  const l = new LineSegments2(g, m); l.frustumCulled = false; l.renderOrder = 4; W.root.add(l)
  const pos = (g.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data, col = (g.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute).data
  return { l, m, pos, col }
})()
function computeLinks() {
  const aU = anchorOf_('use'), aP = anchorOf_('publish'), aR = anchorOf_('rent'), aA = arcAnchor()
  resample(bez(aU, aA, 0.5, 30), linkPts.useArc); resample(bez(aP, aA, 0.5, 30), linkPts.publishArc); resample(bez(aR, aA, 0.5, 30), linkPts.rentArc)
  // direct exchanges (the sealed request does not go through the chain): higher, anchor to anchor
  resample(bez(aU, aR, 2.2, 40), linkPts.useRent)
  resample(bez(aP, aR, 2.2, 40), linkPts.publishRent)
  // CCTP: from other chains to the Arc anchor, then from Arc to the Use anchor. Its second leg retraces
  // useArc exactly (same curve, reversed): a second, higher curve between Use and the A read as an accidental
  // double line. The packets still travel the whole path; the shared leg is drawn only when CCTP is the
  // brighter of the two (otherwise useArc alone shows it), see ccJoin below
  const c0 = ccOut.o > 0.3 ? aA.clone().add(new THREE.Vector3(0, 0.01, 0)) : chainsAnchor() // system out: the link no longer starts in the void
  const leg1 = bez(c0, aA, 0.6, 30), leg2 = bez(aU, aA, 0.5, 30).reverse()
  let l1 = 0, l2 = 0
  for (let i = 1; i < leg1.length; i++) l1 += leg1[i].distanceTo(leg1[i - 1])
  for (let i = 1; i < leg2.length; i++) l2 += leg2[i].distanceTo(leg2[i - 1])
  const ccJoin = Math.round((NSEG * l1) / Math.max(1e-6, l1 + l2))
  resample([...leg1, ...leg2.slice(1)], linkPts.cctp)
  ;[aU, aR, aP, aA, c0].forEach((p, i) => ANCH.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)))
  ANCH.instanceMatrix.needsUpdate = true
  const a = fat.pos.array as Float32Array, ca = fat.col.array as Float32Array
  const h = hl(), cc = new THREE.Color(), wh = new THREE.Color(0xffffff)
  LINKS.forEach((k, li) => {
    const pts = linkPts[k], hidden = !linksOn || (k === 'cctp' && ccOut.o > 0.3) || (view === 'demo' && !shotLinks.has(k)), on = h.links[k]
    // intro: links to Arc draw from Arc (their end), the others from their start
    const toArc = k === 'useArc' || k === 'publishArc' || k === 'rentArc', nShow = intro.links >= 1 ? NSEG : Math.floor(NSEG * intro.links)
    cc.setHex(PART[LINK_PART[k]].hex).multiplyScalar(0.12 + 0.88 * on).lerp(wh, 0.28 * on * on)
    const shared = k === 'cctp' && on <= h.links.useArc && !(view === 'demo' && !shotLinks.has('useArc')) // the leg shared with useArc: useArc draws it
    for (let i = 0; i < NSEG; i++) {
      const off = (toArc ? i < NSEG - nShow : i >= nShow) || (shared && i >= ccJoin)
      const o = (li * NSEG + i) * 6, p0 = hidden || off ? pts[toArc ? NSEG : 0] : pts[i], p1 = hidden || off ? pts[toArc ? NSEG : 0] : pts[i + 1]
      a[o] = p0.x; a[o + 1] = p0.y; a[o + 2] = p0.z; a[o + 3] = p1.x; a[o + 4] = p1.y; a[o + 5] = p1.z
      ca[o] = ca[o + 3] = cc.r; ca[o + 1] = ca[o + 4] = cc.g; ca[o + 2] = ca[o + 5] = cc.b
    }
  })
  fat.pos.needsUpdate = true; fat.col.needsUpdate = true
  const hk = [h.use, h.rent, h.publish, h.arc, h.links.cctp]
  for (let i = 0; i < 5; i++) ANCH.setColorAt(i, cc.copy(ANCH_COL[i]).multiplyScalar(0.35 + 0.65 * hk[i]).lerp(wh, 0.35 * hk[i]))
  if (ANCH.instanceColor) ANCH.instanceColor.needsUpdate = true
  for (const k of ORDER) {
    const f = 0.32 + 0.68 * h[k]
    for (const m of W.islands[k].group.userData.mats as THREE.MeshStandardMaterial[]) { const b = m.userData.base as THREE.Color | undefined; if (b) m.color.copy(b).multiplyScalar(f); else m.color.setScalar(f) }
    W.titles[k].mat.uniforms.uHl.value = h[k]; W.titles[k].glow.haloMat.uniforms.uHl.value = h[k]; W.titles[k].glow.sparkMat.uniforms.uHl.value = h[k]; W.titles[k].edgeMat.opacity = 0.55 * (0.45 + 0.55 * h[k])
    W.titles[k].mesh.visible = view === 'ensemble' || (view === 'demo' && shotKind === 'map') // in the demo, on the map shot only
  }
  W.arc.mat.uniforms.uHl.value = h.arc; W.arc.glowMat.uniforms.uHl.value = h.arc
  // logos light up with the CCTP link; the hovered one stands out
  const cl = h.links.cctp
  CHAINS.mat.uniforms.uHl.value = 0.7 + 0.3 * cl
  const ch = view === 'cctp' || view === 'ensemble' ? 1 : Math.max(0.55, cl)
  CHAINS.title.mat.uniforms.uHl.value = ch; CHAINS.title.glow.haloMat.uniforms.uHl.value = ch; CHAINS.title.glow.sparkMat.uniforms.uHl.value = ch; CHAINS.title.edgeMat.opacity = 0.55 * (0.45 + 0.55 * ch)
  CHAINS.title.mesh.visible = view === 'ensemble' || view === 'cctp' || view === 'demo'
  const sel = (hoverStep ?? hoverScene ?? '').startsWith('cctp.') ? CHAIN_DEFS.findIndex((c) => 'cctp.' + c.id === (hoverStep ?? hoverScene)) : -1
  CHAINS.mat.uniforms.uSel.value = sel; CHAINS.mat.uniforms.uT.value = clock; CHAINS.mat.uniforms.uSpin.value = reduced ? 0 : 1
}
// highlighting: the loop in the overview; on focus, the chosen part only
const LINK_ENDS: Record<Link, [Actor, Actor]> = { useArc: ['use', 'arc'], useRent: ['use', 'rent'], publishArc: ['publish', 'arc'], rentArc: ['rent', 'arc'], publishRent: ['publish', 'rent'], cctp: ['cctp', 'arc'] }
function hl() {
  const h = hlAt(loop.time(), loop.refuse)
  if (view === 'demo') {
    // the demo lights up the actors of the step and the links joining them
    const bt = BEATS[Math.max(0, demoBeat)], act = new Set<Actor>(bt.cam.k === 'room' || bt.cam.k === 'close' ? [bt.cam.a] : bt.cam.k === 'arc' ? ['arc'] : bt.chase ? LINK_ENDS[bt.chase.link as Link] : ['use', 'rent', 'publish', 'arc'])
    for (const k of ORDER) h[k] = act.has(k) ? 1 : 0.3
    h.arc = act.has('arc') ? 1 : 0.45
    for (const l of LINKS) { const [a, b] = LINK_ENDS[l]; h.links[l] = act.has(a) && act.has(b) ? 1 : 0.12 }
  } else if (view === 'arc') { for (const k of ORDER) h[k] = 0.45; h.arc = 1; for (const l of LINKS) h.links[l] = 0.5 }
  else if (view !== 'ensemble') { for (const k of ORDER) h[k] = k === view ? 1 : 0.12; h.arc = 0.4; for (const l of LINKS) h.links[l] = LINK_PART[l] === view || (view === 'cctp' && l === 'cctp') ? Math.max(0.6, h.links[l]) : 0.1 }
  return h
}
const loop = makeLoop(W, people, linkPts, () => 0)

// ---------- Arc: the hologram turns slowly; on focus, it shrinks and fades behind the chosen part ----------
// The A stays front-facing (it follows the camera azimuth), with a slow, barely visible breathing;
// it reacts to a real event of the feed: when the gantry admits a machine, a light pulse
// (rise 0.25 s, return 1.1 s) and a slight swell
const arcK = { s: 1 }, arcFx = { p: 0 }
let wasOk = false
function arcFrame() {
  const camAz = (rig.pose.az + rig.user.az + rig.drag.az) * DEG
  const ok = CHECK(loop.S, loop.refuse).ok
  if (ok && !wasOk && !reduced && dressed) { gsap.killTweensOf(arcFx); hotTween(gsap.timeline().to(arcFx, { p: 1, duration: 0.25, ease: 'power2.out' }).to(arcFx, { p: 0, duration: 1.1, ease: 'power2.inOut' })) }
  wasOk = ok
  W.arc.holo.rotation.y = camAz + (reduced ? 0 : 0.05 * Math.sin(clock * 0.4))
  const br = (reduced ? 1 : 1 + 0.012 * Math.sin(clock * 0.9)) * (1 + 0.05 * arcFx.p)
  W.arc.holo.scale.setScalar(arcK.s * br); W.arc.glow.scale.setScalar(arcK.s * (1 + 0.25 * arcFx.p))
  if (arcFx.p > 0) { const u = W.arc.mat.uniforms.uHl; u.value = Math.max(u.value, arcFx.p); W.arc.glowMat.uniforms.uHl.value = Math.max(W.arc.glowMat.uniforms.uHl.value, arcFx.p) }
  W.arc.mat.uniforms.uT.value = clock
  dust.uniforms.uT.value = reduced ? 0 : clock
  galaxy.uniforms.uT.value = reduced ? 0 : clock; galaxy.uniforms.uRot.value = (OMEGA * orbT) * DEG
  galaxy.uniforms.uK.value = view === 'ensemble' ? 1 : 0.35
  W.arc.glow.quaternion.copy(rig.cam.quaternion)
}

// ---------- USDC packets as holograms (the recreated symbol, world.ts), facing the camera, ~22 px on screen ----------
let UPX = 22
const um = new THREE.Matrix4(), uq = new THREE.Quaternion(), uq2 = new THREE.Quaternion(), us = new THREE.Vector3(), uy = new THREE.Vector3(0, 1, 0), up_ = new THREE.Vector3()
function usdcFrame() {
  const A = W.packetAttr, M = W.usdc.mesh, tanH = Math.tan((rig.cam.fov / 2) * DEG)
  let n = 0
  for (let i = 0; i < A.pos.count && n < NUSDC; i++) {
    if (A.size.getX(i) <= 0 || Math.round(A.shape.getX(i)) !== 5) continue
    up_.set(A.pos.getX(i), A.pos.getY(i), A.pos.getZ(i))
    const d = up_.distanceTo(rig.cam.position)
    // never near the camera, nor behind the column on focus; at most 20% of the screen height
    if (d < 2.5) continue
    if (view !== 'ensemble') { rig.project(vp.copy(up_), o2); if (o2.x < colFrac() * rig.w + 24) continue }
    const sc = (Math.min(UPX, 0.2 * rig.h) * 2 * d * tanH / rig.h) / USDC_D
    uq.copy(rig.cam.quaternion).multiply(uq2.setFromAxisAngle(uy, reduced ? 0 : Math.sin(clock * 1.4 + i) * 0.45))
    M.setMatrixAt(n++, um.compose(up_, uq, us.setScalar(sc)))
  }
  M.count = n; M.instanceMatrix.needsUpdate = true; W.usdc.mat.uniforms.uT.value = clock
}

// ---------- Hoverable elements ----------
const lbox = (k: PartK, min: [number, number, number], max: [number, number, number]) => {
  const b = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max))
  return () => b.clone().applyMatrix4(W.islands[k].group.matrixWorld)
}
const reg = (id: string, dyn: () => THREE.Box3, segs?: () => THREE.Vector3[]) => picks.set(id, { id, box: new THREE.Box3(), dyn, segs })
const AH = ARC_H / 2 + 0.1
reg('arc', () => new THREE.Box3(new THREE.Vector3(-AH * arcK.s, ARC_Y - AH * arcK.s, -AH * arcK.s), new THREE.Vector3(AH * arcK.s, ARC_Y + AH * arcK.s, AH * arcK.s)))
reg('use.guichet', lbox('use', [-0.8, 0, -0.7], [0.8, 1.35, 0.95]))
reg('use.drone', () => new THREE.Box3().setFromObject(W.drone.group).expandByScalar(0.08))
CHAINS.logos.forEach((L, i) => reg('cctp.' + L.def.id, () => { const c = chainCenter(i); return new THREE.Box3().setFromCenterAndSize(c, new THREE.Vector3(CHAIN_SIZE, CHAIN_SIZE, CHAIN_SIZE)) }))
reg('title.cctp', () => { const m = CHAINS.title.mesh; m.updateMatrixWorld(true); if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); return m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld) })
reg('cctp.usdc', () => new THREE.Box3().setFromCenterAndSize(CHAINS.group.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(CC.coin, CC.coin, CC.coin)))
reg('publish.poste', lbox('publish', [-0.8, 0, -0.7], [0.8, 1.35, 0.95]))
reg('rent.portique', lbox('rent', [GATE.x - 0.2, 0, GATE.z - 0.45], [GATE.x + 0.2, 2.0, GATE.z + 0.45]))
reg('rent.baies', lbox('rent', [RACKS[0].x - 0.32, 0, RK.z - 0.5], [RACKS[RACKS.length - 1].x + 0.55, RACK.h + 0.2, RACKS[RACKS.length - 1].z + 0.35]))
reg('rent.quai', lbox('rent', [BELT.x0 + 0.3, 0, BELT.z - 0.35], [GATE.x - 0.25, 1.0, BELT.z + 0.35]))
reg('rent.refus', lbox('rent', [BIN.x - 0.4, 0, BIN.z - 0.35], [BIN.x + 0.4, 0.6, BIN.z + 0.35]))
reg('rent.operateur', () => { const p = people.poses[1]; return new THREE.Box3(new THREE.Vector3(p.x - 0.3, 0, p.z - 0.3), new THREE.Vector3(p.x + 0.3, 1.8, p.z + 0.3)).applyMatrix4(W.islands.rent.group.matrixWorld) })
for (const k of ORDER) reg('title.' + k, () => titleBox(k))
for (const k of LINKS) reg('link.' + k, () => new THREE.Box3().setFromPoints(linkPts[k]), () => linkPts[k])
const boxOf = (id: string) => picks.get(id)!.dyn!()
const anchorOf = (id: string) => {
  const p = picks.get(id)!
  if (p.segs) return p.segs()[Math.round(NSEG * 0.45)].clone()
  const b = p.dyn!(); return new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2)
}

// ---------- Clock and rendering ----------
const stats = { renders: [] as { t: number; h: number }[], ticks: [] as number[], calls: 0, triangles: 0, maxCalls: 0, keep: false, programs: 0 }
let dirty = true, hot = 0, lastRender = 0, lastT = performance.now(), spinT = 0
const spinOn = () => !reduced && !freeze && view === 'ensemble' && !hoverScene && !hover.api.id() && !(camTween?.isActive()) && dragIdle()
let dressed = false // nothing is rendered before the dressing (models, baked maps) and its compilation
// Desk shoulder shots fill the frame with the room: a shade under the text column (a quad written straight
// in clip space, drawn last, one draw call, only the column side) keeps the column readable, like a film's
// side vignette. It follows the camera distance, so it fades in and out with the camera move itself.
const scrim = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false,
  uniforms: { uL: { value: 0.4 }, uK: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`uniform float uL; uniform float uK; varying vec2 vUv;
    void main() { float a = uK * 0.88 * (1.0 - smoothstep(uL * 0.7, uL + 0.06, vUv.x)); gl_FragColor = vec4(0.02, 0.025, 0.04, a); }`,
}))
scrim.frustumCulled = false; scrim.renderOrder = 1000; scrim.visible = false; scene.add(scrim)
function scrimFrame() {
  const cf = colFrac(), on = (view === 'use' || view === 'publish') && cf > 0 && !mobileMQ.matches
  const k = on ? THREE.MathUtils.smoothstep(4.5 - rig.distance(), 0, 2.2) : 0
  const U = (scrim.material as THREE.ShaderMaterial).uniforms; U.uK.value = k; U.uL.value = cf
  scrim.visible = k > 0.002
}
function render(now: number) {
  if (!renderer || !dressed) return
  // the demo sets the scene and camera before everything else; its own packets replace the loop's
  const dm = view === 'demo' && demo.open
  if (!dm) CLIENT.on = false
  W.packets.visible = !dm; W.usdc.mesh.visible = !dm; if (!dm) pkSprite.visible = false
  if (dm) demo.frame()
  layout(); rig.apply(); titles(); cctpFrame(); computeLinks(); arcFrame(); scrimFrame()
  loop.lite = view === 'ensemble'
  loop.apply(clock, Math.min(0.1, Math.max(0.001, (now - lastRender) / 1000)))
  usdcFrame()
  for (const ms of colHidden) if (view !== 'ensemble' && !dm) ms.visible = false // the demo shows all screens
  { const U = atmo.uniforms; U.uT.value = dust.uniforms.uT.value; U.uAsp.value = rig.w / Math.max(1, rig.h)
    U.uPar.value.set((rig.pose.az + rig.user.az + rig.drag.az) / 90, (rig.pose.el + rig.user.el) / 60)
    bv.set(0, ARC_Y, 0).applyMatrix4(rig.cam.matrixWorldInverse)
    if (bv.z < -rig.cam.near) { rig.project(atmoV.set(0, ARC_Y, 0), atmoO); U.uA.value.set(atmoO.x / Math.max(1, rig.w), 1 - atmoO.y / Math.max(1, rig.h)); U.uAK.value = 1 } else U.uAK.value = 0 }
  renderer.render(scene, rig.cam)
  for (const ms of colHidden) if (ms !== W.deskScreens.publish[1]) ms.visible = true
  stats.calls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles
  stats.maxCalls = Math.max(stats.maxCalls, stats.calls); stats.programs = renderer.info.programs?.length ?? 0
  if (stats.keep) stats.renders.push({ t: now, h: hot > 0 ? 1 : 0 })
  lastRender = now; dirty = false
  overlay()
}
gsap.ticker.add(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now
  if (!freeze) clock += dt
  // the slow camera oscillation around Arc (±25°, 75 s): in the overview only, paused on hover,
  // stopped in reduced motion or frozen by ?t=
  if (spinOn()) { spinT += dt * SPIN_K; rig.user.az = SPIN * Math.sin((spinT / 75) * Math.PI * 2) }
  // in the overview, the galaxy and dust dim under the column (the text reads on a calm ground)
  { const cr = view === 'ensemble' ? colR : 0, tgt = cr > 0 ? (cr / rig.w) * 2 - 1 : -2, u = dust.uniforms.uCut
    const nv = freeze || reduced || !cutSet ? tgt : u.value + (tgt - u.value) * Math.min(1, dt * 3)
    if (cr > 0) cutSet = true
    if (Math.abs(nv - u.value) > 1e-4) { u.value = nv; galaxy.uniforms.uCut.value = nv; dirty = true } }
  // the room orbit advances with the oscillation, and slows to a stop (smoothly) when it stops
  orbV += ((spinOn() ? 1 : 0) - orbV) * Math.min(1, dt * 1.5)
  if (!freeze && !reduced && orbV > 1e-4) { orbT += dt * orbV * SPIN_K; ccT += dt * orbV * SPIN_K; dirty = true }
  const loopOn = !loop.tl.paused() || !loop.rtl.paused() || spinOn() || loop.stageActive() || (view !== 'ensemble' && !freeze && !reduced)
  if (stats.keep) stats.ticks.push(now)
  if (hot > 0 || dirty || hover.api.busy || (loopOn && now - lastRender >= 15)) render(now)
  if (!renderer) { panelTick(); if (view === 'demo' && demo.open) demo.frame() } // without WebGL, the demo keeps its text and timeline
})
const hotTween = (t: gsap.core.Animation) => { hot++; let done = false; const end = () => { if (!done) { done = true; hot--; dirty = true } }; t.eventCallback('onComplete', end); t.eventCallback('onInterrupt', end); return t }
function resize() {
  // the scene section takes exactly the visible height below the header (the footer does not overflow)
  { const net = document.querySelector<HTMLElement>('#net'); if (net) { const top = net.getBoundingClientRect().top + scrollY; document.documentElement.style.setProperty('--net-h', `${Math.max(480, Math.round(innerHeight - top))}px`) } }
  const r = stage.getBoundingClientRect()
  rig.size(r.width, r.height)
  renderer?.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer?.setSize(r.width, r.height, false)
  ;(W.packets.material as THREE.ShaderMaterial).uniforms.uDpr.value = Math.min(devicePixelRatio, 2)
  dust.uniforms.uDpr.value = Math.min(devicePixelRatio, 2)
  galaxy.uniforms.uDpr.value = Math.min(devicePixelRatio, 2)
  for (const k of ORDER) W.titles[k].glow.sparkMat.uniforms.uDpr.value = Math.min(devicePixelRatio, 2)
  CHAINS.title.glow.sparkMat.uniforms.uDpr.value = Math.min(devicePixelRatio, 2)
  fat.m.resolution.set(r.width, r.height)
  SIGN_K = mobileMQ.matches ? 1.7 : 1
  colR = colRight()
  if (view !== 'demo') setPose(poseFor(view, stepEl), 0) // in the demo, the director sets the camera
  dirty = true
}

// ---------- Views: the camera does not turn; on focus, it settles on the island ----------
let view: View = 'ensemble', stepEl: string | null = null
const EL = 25 // a little higher, the galaxy reads as a disc
const EL_MOB = 36 // on phones, the frame is tall: the camera rises, the orbits spread vertically
// a room's pose on its orbit (at orbit time, without leaving the frame); on focus the orbit is frozen
const IQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, IY, 0)), ONE = new THREE.Vector3(1, 1, 1)
const islandMAt = (k: PartK, p: THREE.Vector3) => new THREE.Matrix4().compose(p, IQ, ONE)
// the room position as layout() sets it (orbit, or fixed demo place), without frame exit or intro
const roomPos = (k: PartK) => {
  const p = orbPos(k, orbT)
  if (demoK.k > 0) { const P = orbitAt(k, orbT), u = (AZ0 + DEMO_U[k]) * DEG, dp = orbXYZ(u, ORB[k].r * 0.58, P.y * 0.5, new THREE.Vector3()); p.lerp(dp, demoK.k) }
  return p
}
const islandM = (k: PartK) => islandMAt(k, roomPos(k))
// the room box (floor, walls, sign included) in its frame
const localBox = (k: PartK) => {
  const i = W.islands[k], b = new THREE.Box3(new THREE.Vector3(i.size.x0, 0, i.size.z0), new THREE.Vector3(i.size.x1, WALL_H[k] + 1.3, i.size.z1))
  const g = W.titles[k].mesh.geometry; if (!g.boundingBox) g.computeBoundingBox()
  // the sign is parallel to the back wall: its box is aligned with the room frame
  return b.union(g.boundingBox!.clone().translate(titleLocal(k)))
}
// Orbit envelope, for the overview frame: each room at 24 places on its orbit, at the farthest and at the
// two extreme heights; plus Arc and the chain row
// (the corners of the oriented boxes, not their aligned boxes: the frame is no wider than the scene)
const envCache: Record<string, THREE.Vector3[][]> = {}
// a slightly tight overview, with the signs at the edge not cut;
// ?poster=1 (the still image without WebGL): the full overview shot
const FIT_K = Q.has('poster') ? 0.95 : 0.56
const corners = (b: THREE.Box3, m?: THREE.Matrix4) => Array.from({ length: 8 }, (_, i) => { const v = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z); return m ? v.applyMatrix4(m) : v })
// fk: the share of each orbit radius the envelope holds (1 = every place a room can reach)
function envelope(fk = FIT_K) {
  const ck = `${fk}x${KX}`
  if (envCache[ck]) return envCache[ck]
  const out: THREE.Vector3[][] = [], v = new THREE.Vector3()
  for (const k of ORDER) {
    const o = ORB[k], lb = localBox(k)
    for (let i = 0; i < 24; i++) {
      // the frame holds the orbits up to fk of their radius; beyond that, the rotation brings rooms in and
      // out of frame (not everything has to fit in one image)
      const a = (i / 24) * Math.PI * 2, r = (o.r + o.e) * fk
      for (const y of [o.h - o.inc, o.h + o.inc]) out.push(corners(lb, islandMAt(k, orbXYZ(a, r, y, v).clone())))
    }
  }
  out.push(corners(new THREE.Box3(new THREE.Vector3(-ARC_H / 2, ARC_Y - ARC_H / 2, -ARC_H / 2), new THREE.Vector3(ARC_H / 2, ARC_Y + ARC_H / 2 + 0.4, ARC_H / 2))))
  return (envCache[ck] = out)
}
// the column only shifts the scene if it lies over it (not when it goes below, on phone or tablet)
const SPIN = 20
const bv = new THREE.Vector3()
function behind(b: THREE.Box3) {
  for (let i = 0; i < 8; i++) { bv.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(rig.cam.matrixWorldInverse); if (bv.z > -rig.cam.near) return true }
  return false
}
// Arc at the exact centre of the free area (right of the column, above the key); the zoom fits
// the whole orbit envelope, over the whole camera oscillation, on either side of that centre
function fitCentered(p: Pose): Pose {
  const keepP = { ...rig.pose }, keepU = { ...rig.user }, keepD = { ...rig.drag }
  rig.drag.az = rig.drag.el = 0; rig.drag.zoom = 1
  const keyEl = document.querySelector<HTMLElement>('#key'), keyH = keyEl && getComputedStyle(keyEl).position === 'absolute' ? keyEl.offsetHeight : 0
  const mob = mobileMQ.matches, M = mob ? 12 : 24
  const cr = colRight(), left = cr > 0 ? cr + COL_GAP : M, right = rig.w - M, top = M, bottom = rig.h - keyH - M
  let cx = (left + right) / 2
  const cy = (top + bottom) / 2
  const place = () => { p.shift = (cx - rig.w / 2) / rig.w; p.lift = (rig.h / 2 - cy) / rig.h }
  place()
  const boxes = envelope()
  // fewer samples (keeps the return to the overview cheap)
  for (let it = 0; it < 6; it++) {
    let hw = 0, hh = 0
    for (const d of [-SPIN, 0, SPIN]) {
      Object.assign(rig.pose, p); rig.user.az = d; rig.user.el = 0; rig.user.zoom = 1; rig.apply()
      for (const pts of boxes) for (const q of pts) {
        bv.copy(q).applyMatrix4(rig.cam.matrixWorldInverse); if (bv.z > -rig.cam.near) { hw = Infinity; continue }
        rig.project(vp.copy(q), o2)
        hw = Math.max(hw, Math.abs(o2.x - cx)); hh = Math.max(hh, Math.abs(o2.y - cy))
      }
    }
    const k = Math.min((right - left) / 2 / hw, (bottom - top) / 2 / hh)
    p.zoom *= THREE.MathUtils.clamp(Number.isFinite(k) && k > 0 ? Math.pow(k, 0.85) : 0.6, 0.6, 1.6)
  }
  // Beside the column: the camera comes closer (OV.zk, the layout itself never changes), then the A moves right
  // (at most OV.dx of the free area) for the near orbits to clear the column; with the rotation, the far places of
  // the orbits leave the frame and come back, as before
  if (cr > 0) {
    p.zoom *= OV.zk
    const near = envelope(FIT_K)
    let hl = 0
    for (const d of [-SPIN / 2, 0, SPIN / 2]) {
      Object.assign(rig.pose, p); rig.user.az = d; rig.user.el = 0; rig.user.zoom = 1; rig.apply()
      for (const pts of near) for (const q of pts) {
        bv.copy(q).applyMatrix4(rig.cam.matrixWorldInverse); if (bv.z > -rig.cam.near) continue
        rig.project(vp.copy(q), o2); hl = Math.max(hl, cx - o2.x)
      }
    }
    cx = Math.min(Math.max(cx, left + hl), cx + (right - left) * OV.dx); place()
    // the closer camera would crop the front room at the bottom: the frame centres, vertically, every place the
    // rooms can reach (with the column, the scene has room above it)
    // and on wide screens, where the height binds, the camera comes only as close as that whole height allows
    // (the CCTP sign included), never less close than the plain fit
    const cc = corners(new THREE.Box3().setFromObject(CHAINS.group)), zmin = p.zoom / OV.zk
    for (let it = 0; it < 3; it++) {
      Object.assign(rig.pose, p); rig.user.az = 0; rig.user.el = 0; rig.user.zoom = 1; rig.apply()
      let y0 = Infinity, y1 = -Infinity
      for (const pts of [...envelope(1), cc]) for (const q of pts) { bv.copy(q).applyMatrix4(rig.cam.matrixWorldInverse); if (bv.z > -rig.cam.near) continue; rig.project(vp.copy(q), o2); y0 = Math.min(y0, o2.y); y1 = Math.max(y1, o2.y) }
      if (!Number.isFinite(y0)) break
      p.lift += THREE.MathUtils.clamp(((y0 + y1) / 2 - cy) / rig.h, -0.1, 0.12)
      const k = (bottom - top) / (y1 - y0)
      if (k >= 1) break
      p.zoom = Math.max(zmin, p.zoom * k)
    }
  }
  Object.assign(rig.pose, keepP); Object.assign(rig.user, keepU); Object.assign(rig.drag, keepD); rig.apply()
  return p
}
// The overview beside the column: camera only, the rooms, the A and the CCTP system keep their places and distances.
// zk: how much closer the camera comes than the plain fit of the free area (1.12 = 12 % larger on screen); dx: how far
// right (share of the free area) the A may move for the near orbits to clear the column
const OV = { zk: 1.12, dx: 0.07 }
const COL_GAP = 40 // px between the column's right edge and anything in the scene
let colR = 0, cutSet = false // the column edge (measured on resize); the dimming has been placed once
// the column's right edge in stage pixels (0 when the column is not laid over the scene: phone, tablet)
function colRight() {
  const c = document.querySelector<HTMLElement>('#col')
  if (mobileMQ.matches || !c || getComputedStyle(c).position !== 'absolute') return 0
  return Math.min(0.5 * rig.w, c.getBoundingClientRect().right - stage.getBoundingClientRect().left)
}
function colFrac() { const c = document.querySelector<HTMLElement>('#col'); return mobileMQ.matches || !c || getComputedStyle(c).position !== 'absolute' ? 0 : Math.min(0.45, c.getBoundingClientRect().width / Math.max(1, rig.w)) }
function poseFor(v: View, el: string | null): Pose {
  const mob = mobileMQ.matches, cf = colFrac(), sh = cf / 2, fr = 1 - cf
  if (v === 'ensemble') {
    // the overview frame is computed once per screen and column size (it covers all orbit places)
    const key = `${rig.w}x${rig.h}x${cf.toFixed(2)}x${Math.round(colRight())}x${mob}`
    if (ensCache?.key === key) return { ...ensCache.pose }
    const pose = fitCentered({ tx: 0, ty: ARC_Y, tz: 0, az: AZ0, el: mob ? EL_MOB : EL, zoom: 0.3, shift: sh, lift: 0, fov: FOV })
    ensCache = { key, pose: { ...pose } }
    return pose
  }
  if (v === 'cctp') return cctpPose(mob, cf, fr)
  if (v === 'arc') return arcPose(mob, cf)
  if (v === 'demo') return { ...rig.pose }
  return focusPose(v as PartK, el, mob, cf, sh, fr)
}
// Arc focus: the camera on the A (front-on, slightly from above), the A in the free area
function arcPose(mob: boolean, cf: number): Pose {
  return { tx: 0, ty: ARC_Y, tz: 0, az: AZ0, el: 14, zoom: D0 / (mob ? 15 : 12.5), shift: mob ? 0 : cf > 0 ? Math.max(cf / 2, 0.225) : 0, lift: mob ? 0.04 : 0, fov: FOCUS.fov }
}
// the demo camera frames the actors of the step; the map takes the left (desktop) or the bottom
// (phone), the frame shifts accordingly; same path as all gestures (setPose)
const actorPt = (a: Actor): THREE.Vector3 => {
  if (a === 'arc') return new THREE.Vector3(0, ARC_Y, 0)
  if (a === 'cctp') return CHAINS.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.2, 0))
  const i = W.islands[a]; return wv(a, new THREE.Vector3((i.size.x0 + i.size.x1) / 2, WALL_H[a] * 0.6, (i.size.z0 + i.size.z1) / 2))
}
// an actor's arrival place in the demo (rooms at their demo place, without frame exit or shrinking):
// a shot is framed there, never on rooms that are leaving the frame
const actorHome = (a: Actor): THREE.Vector3 => {
  if (a === 'arc') return new THREE.Vector3(0, ARC_Y, 0)
  if (a === 'cctp') { const keep = demoK.k; demoK.k = 1; const p = ccPos(); demoK.k = keep; return p.add(new THREE.Vector3(0, 1.2, 0)) }
  const i = W.islands[a], keep = demoK.k; demoK.k = 1
  const p = new THREE.Vector3((i.size.x0 + i.size.x1) / 2, WALL_H[a] * 0.6, (i.size.z0 + i.size.z1) / 2).applyMatrix4(islandM(a))
  demoK.k = keep; return p
}
// the two demo shots
let shotKind: 'map' | 'dio' = 'map'
const shotLinks = new Set<Link>()
const mapTilt = { x: 0 }
const MAP_EL = 48 // 45-50°, the A stays readable
function demoShot(st: DStep, sh: Shot, side: 'left' | 'bottom', instant = false): number {
  shotKind = sh.k
  shotLinks.clear(); if (sh.k === 'map') for (const l of sh.links) shotLinks.add(l as Link)
  const dur = instant || reduced ? 0 : CAM_DUR
  gsap.killTweensOf(mapTilt); if (dur) hotTween(gsap.to(mapTilt, { x: sh.k === 'map' ? MAP_EL - 10 : 0, duration: dur, ease: 'power2.inOut' })); else mapTilt.x = sh.k === 'map' ? MAP_EL - 10 : 0
  let pose: Pose
  // poses are computed on the final demo layout (rooms are still gliding to their place)
  const keepK = demoK.k; demoK.k = 1; layout()
  const cardW = side === 'left' ? Math.min(380, rig.w * 0.34) + 48 : 0
  if (sh.k === 'map') {
    // plunging view: the ends of the active links and Arc, framed in the free area right of the card
    const b = new THREE.Box3()
    const acts = new Set<Actor>(); for (const l of sh.links) for (const e of LINK_ENDS[l as Link]) acts.add(e) // only the actors of the step
    for (const a2 of acts) { const p = actorHome(a2), r = a2 === 'arc' ? 2.9 : a2 === 'cctp' ? 3.6 : 3.4; b.expandByPoint(p.clone().addScalar(r)); b.expandByPoint(p.clone().addScalar(-r)) }
    const f = rig.fit(b, AZ0, MAP_EL, side === 'left' ? (rig.w - cardW) / rig.w * 0.76 : 0.9, side === 'left' ? 0.72 : 0.44)
    pose = { tx: f.ctr.x, ty: f.ctr.y, tz: f.ctr.z, az: AZ0, el: MAP_EL, zoom: f.zoom, shift: side === 'left' ? cardW / rig.w / 2 : 0, lift: side === 'left' ? -0.02 : 0.22, fov: FOV }
  } else if (sh.a === 'cctp' || sh.a === 'arc') {
    pose = sh.a === 'cctp' ? cctpPose(side === 'bottom', cardW / Math.max(1, rig.w), 1 - cardW / Math.max(1, rig.w)) : arcPose(side === 'bottom', cardW / Math.max(1, rig.w))
  } else {
    // diorama: the shoulder pose, in the room at its demo place
    pose = roomPose(sh.a, side === 'left' ? cardW / rig.w / 2 + 0.04 : 0, side === 'bottom', 1 - cardW / Math.max(1, rig.w))
    if (side === 'bottom') pose.lift = 0.2
  }
  demoK.k = keepK // the next frame puts the rooms back at their current place (layout in render)
  // what is not in the shot leaves the frame (other rooms in diorama, CCTP if not in the step)
  const inShot = new Set<Actor>(sh.k === 'dio' ? [sh.a] : sh.links.flatMap((l) => LINK_ENDS[l as Link]))
  // on the map too, rooms outside the step leave the frame
  for (const k of ORDER) { const to = inShot.has(k) ? 0 : 1; if (dur) hotTween(gsap.to(outK, { [k]: to, duration: dur, ease: 'power2.inOut' })); else outK[k] = to }
  { const to = inShot.has('cctp') ? 0 : 1; if (dur) hotTween(gsap.to(ccOut, { o: to, duration: dur, ease: 'power2.inOut' })); else ccOut.o = to }
  setPose(pose, dur)
  // the actor works: the range of the overview feed that carries that work (or that transfer), in real time
  let play = 0
  if (renderer && !freeze && sh.r) {
    loop.setReal(null)
    if (sh.r === 'refus') { gsap.delayedCall(dur * 0.6, () => { if (view === 'demo') loop.restart(true) }); play = REFUS_S }
    else { const [r0, r1] = sh.r; gsap.delayedCall(dur * 0.6, () => { if (view === 'demo' && demo.step() === st) loop.playRange(r0, r1, reduced) }); play = r1 - r0 }
  }
  dirty = true
  return reduced ? 0.5 : dur * 0.6 + Math.max(play, sh.k === 'map' ? 3.2 : 2.5) + 0.6
}
function demoResize() { const r = stage.getBoundingClientRect(); if (Math.abs(r.width - rig.w) > 1 || Math.abs(r.height - rig.h) > 1) resize() }
// CCTP focus: the camera on the system (token, logo ring, title), subject in the right 55%
function cctpPose(mob: boolean, cf: number, fr: number): Pose {
  const c = ccPos()
  const R = CC.ring + CHAIN_SIZE, b = new THREE.Box3(c.clone().add(new THREE.Vector3(-R, -R * 0.6, -R)), c.clone().add(new THREE.Vector3(R, CHAINS.anchor.y + 0.4, R)))
  let az = Math.atan2(c.x, c.z) / DEG + 180 + 18 // from the Arc side, slightly at an angle
  while (az - AZ0 > 180) az -= 360; while (az - AZ0 < -180) az += 360
  // closer, lower, like the rooms (the system fills the free area)
  const f = rig.fit(b, az, FOCUS.el, mob ? 0.95 : fr * 0.92, 0.9)
  return { tx: f.ctr.x, ty: f.ctr.y, tz: f.ctr.z, az, el: FOCUS.el, zoom: f.zoom, shift: mob ? 0 : cf > 0 ? Math.max(cf / 2, 0.225) : 0, lift: 0, fov: FOV }
}
let ensCache: { key: string; pose: Pose } | null = null
// Behind the actor's shoulder, as close as possible; a chosen element is framed from the same shoulder.
// On focus, nothing carrying text (screens, dock panel) goes under the column: the optical shift pushes
// the image to the right as much as needed (an image translation, the perspective does not change)
const colHidden = new Set<THREE.Mesh>()
const textMeshes = (k: PartK): THREE.Mesh[] => k === 'use' ? W.deskScreens.use : k === 'publish' ? W.deskScreens.publish.slice(0, 2) : [W.rent.dock]
function clearColumn(k: PartK, p: Pose): Pose {
  const cf = colFrac(); if (!cf || mobileMQ.matches) return p
  const keepP = { ...rig.pose }, keepU = { ...rig.user }, keepD = { ...rig.drag }
  Object.assign(rig.pose, p); rig.user.az = rig.user.el = 0; rig.user.zoom = 1; rig.drag.az = rig.drag.el = 0; rig.drag.zoom = 1; rig.apply()
  const m = islandM(k), lim = cf * rig.w + 20; let minX = Infinity
  colHidden.clear()
  for (const ms of textMeshes(k)) {
    ms.updateMatrix(); if (!ms.geometry.boundingBox) ms.geometry.computeBoundingBox()
    const b = ms.geometry.boundingBox!.clone().applyMatrix4(m.clone().multiply(ms.matrix))
    if (behind(b)) continue
    const r = rig.rect(b)
    if (r.x + r.w < 0 || r.x > rig.w || r.y > rig.h || r.y + r.h < 0) continue
    // mostly under the column: hidden in this view; mostly visible: the image shifts to clear it
    if (r.x + r.w * 0.5 < lim) { colHidden.add(ms); continue }
    minX = Math.min(minX, r.x)
  }
  Object.assign(rig.pose, keepP); Object.assign(rig.user, keepU); Object.assign(rig.drag, keepD); rig.apply()
  if (minX < lim) p.shift = Math.min(0.42, p.shift + (lim - minX) / rig.w)
  return p
}
// The two desk rooms (Use: the user's desk; Publish: the author's desk): on desktop the focus is a film shot
// from behind the seated figure's LEFT shoulder, at seated eye height, looking past the shoulder at the
// desk screens: the head and shoulder fill the right of the frame, the screens sit in the visible gap between
// the text column (#col) and, on Use, the catalog panel docked on the right (.net-cat, reserved whether it is
// open or not, so the shot does not jump when it opens). Local metres, island frame (the figure sits at
// x 0, z 0.42, facing -z: its left is -x). Phones keep the room pose.
const DESK_SHOT: Record<'use' | 'publish', Cam & { at: number }> = {
  // the two monitors (x ±0.33, z -0.38); the target between them, on the screens' centre line
  use: { cam: [-0.68, 1.42, 1.25], tgt: [0.06, 1.06, -0.4], fov: 54, at: 0.42 },
  // the three code screens in an arc, the lamp on the left
  publish: { cam: [-0.6, 1.42, 1.22], tgt: [0.06, 1.12, -0.34], fov: 56, at: 0.44 },
}
// Use, the answer step (the drone takes off): the camera stays at the user's seat and turns towards the
// flight cage, over the user's right shoulder (the figure on the left of the gap, the drone at its centre)
const DRONE_SHOT: Cam & { at: number } = { cam: [0.05, 1.6, 1.3], tgt: [2.45, 1.0, -0.8], fov: 52, at: 0.55 }
const isDesk = (k: PartK): k is 'use' | 'publish' => k === 'use' || k === 'publish'
function catW() { return Math.min(440, Math.max(340, 0.27 * innerWidth)) + 16 }
function deskPose(k: 'use' | 'publish', S: Cam & { at: number } = DESK_SHOT[k]): Pose {
  const m = islandM(k)
  const C = new THREE.Vector3(...S.cam).applyMatrix4(m), T = new THREE.Vector3(...S.tgt).applyMatrix4(m)
  const d = C.clone().sub(T), dist = d.length()
  let az = Math.atan2(d.x, d.z) / DEG
  while (az - AZ0 > 180) az -= 360; while (az - AZ0 < -180) az += 360
  // the free gap: right of the column, left of the catalog (Use); the target at `at` of its width
  const left = colFrac() * rig.w + 20, right = rig.w - (k === 'use' ? catW() : 0) - 24
  const x = left + Math.max(120, right - left) * S.at
  return { tx: T.x, ty: T.y, tz: T.z, az, el: Math.asin(d.y / dist) / DEG, zoom: D0 / dist, shift: (x - rig.w / 2) / rig.w, lift: 0.03, fov: S.fov }
}
function focusPose(k: PartK, el: string | null, mob: boolean, cf: number, sh: number, fr: number): Pose {
  void cf
  // desk rooms on desktop: the shoulder shot, kept for the steps on the desk; an element elsewhere in the
  // room (Use: the drone in its cage) gets its own close-up, from the room pose
  const far = el && picks.has(el) && !el.startsWith('link.') && el !== 'arc' && ISLAND_OF(el) === k && !el.endsWith('.guichet') && !el.endsWith('.poste')
  if (isDesk(k) && !mob && !far) { colHidden.clear(); return deskPose(k) }
  if (k === 'use' && !mob && el === 'use.drone') { colHidden.clear(); return deskPose(k, DRONE_SHOT) }
  // the subject in the right 55% of the frame
  const sp = clearColumn(k, roomPose(k, mob ? 0 : cf > 0 ? Math.max(sh, 0.225) : 0, mob, fr))
  if (el && picks.has(el) && !el.startsWith('link.') && el !== 'arc' && ISLAND_OF(el) === k) {
    const f = rig.fit(boxOf(el), sp.az, sp.el, mob ? 0.8 : fr * 0.62, 0.62)
    const zoomF = f.zoom * Math.tan((sp.fov / 2) * DEG) / Math.tan((FOV / 2) * DEG)
    const zoom = THREE.MathUtils.clamp(zoomF, sp.zoom * 0.85, D0 / 1.3)
    return { ...sp, tx: f.ctr.x, ty: f.ctr.y, tz: f.ctr.z, zoom }
  }
  return sp
}
// the camera and its target, written in each island's frame (metres): behind the right shoulder of the user
// (screens on the left, flight lab on the right), of the dev (three screens, lamp, bookcase), and of
// the operator at the dock, facing the gantry and the racks
const SHOULDER: Record<PartK, { cam: [number, number, number]; tgt: [number, number, number]; fov: number }> = {
  // above the shoulder, on the two screens (the site pages read there: use.html on the left, the landing on the right)
  use: { cam: [1.0, 2.15, 1.75], tgt: [-0.12, 1.0, -0.42], fov: 46 },
  publish: { cam: [0.42, 1.58, 1.5], tgt: [-0.28, 1.0, -0.62], fov: 50 },
  rent: { cam: [0.9, 1.85, 2.05], tgt: [-0.35, 1.02, -1.0], fov: 54 },
}
// At Rent, the camera follows the operator from step to step, over the right shoulder (computed from position and
// heading at the end of the step), aiming at what the operator does; then it looks for a clear angle (rays against
// the decor: from the target to the camera, and from the camera to the operator's chest), otherwise it moves closer
type Cam = { cam: [number, number, number]; tgt: [number, number, number]; fov: number }
function overShoulder(pos: THREE.Vector3, h: number, look: [number, number, number], dist = 1.5, fov = 52, y = 1.74): Cam {
  const back = new THREE.Vector3(-Math.sin(h), 0, -Math.cos(h)), right = new THREE.Vector3(-Math.cos(h), 0, Math.sin(h))
  const c = pos.clone().addScaledVector(back, dist).addScaledVector(right, 0.42)
  return { cam: [c.x, y, c.z], tgt: look, fov }
}
const faceTo = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(b.x - a.x, b.z - a.z)
const STAGE_CAM: Partial<Record<PartK, Record<number, Cam>>> = {
  // three shots only: the dock (arrival, deposit, start, pairing), the gantry, the
  // racks (storage and payment); the camera only moves when changing shot (same object = no movement)
  rent: (() => {
    const dock = overShoulder(OPS.TERM, -Math.PI / 2, [-2.6, 1.05, 0.15], 2.4, 52, 1.95)
    const gate = overShoulder(OPS.GSTAND, faceTo(OPS.GSTAND, new THREE.Vector3(-1.55, 0, -0.35)), [-1.5, 1.2, -0.4], 1.9, 52, 1.85)
    const bay = overShoulder(OPS.WORK, faceTo(OPS.WORK, BAY_POS), [BAY_POS.x, 1.05, BAY_POS.z + 0.2], 1.5)
    // the first pose shows the room, the gantry and the racks (the subtitle announces them)
    const wide: Cam = { cam: [2.6, 3.3, 3.6], tgt: [0.1, 0.9, -0.7], fov: 54 }
    return { 0: wide, 1: dock, 2: dock, 3: dock, 4: gate, 5: bay, 6: bay }
  })(),
}
const camRay = new THREE.Raycaster()
// the island decor meshes, in its view pose (without the frame-exit offset)
function blockers(k: PartK) {
  const g = W.islands[k].group, keep = { p: g.position.clone(), r: g.rotation.clone() }
  g.matrix.copy(islandM(k)); g.matrix.decompose(g.position, g.quaternion, g.scale); g.updateMatrixWorld(true)
  const list = g.children.filter((c) => (c as THREE.Mesh).isMesh && (c.name === 'static' || c.name === 'racks'))
  return { list, restore: () => { g.position.copy(keep.p); g.rotation.copy(keep.r); g.updateMatrixWorld(true) } }
}
function clearCam(k: PartK, S: Cam, eye?: THREE.Vector3): Cam {
  const m = islandM(k), T = new THREE.Vector3(...S.tgt).applyMatrix4(m), C0 = new THREE.Vector3(...S.cam).applyMatrix4(m)
  const { list, restore } = blockers(k)
  const hitsBetween = (a: THREE.Vector3, b: THREE.Vector3) => { const d = b.clone().sub(a), L = d.length(); camRay.set(a, d.normalize()); camRay.far = L - 0.05; camRay.near = 0.05; return camRay.intersectObjects(list, false)[0] }
  const E = eye ? eye.clone().applyMatrix4(m) : null
  let best: THREE.Vector3 | null = null
  for (const da of [0, 10, -10, 20, -20, 32, -32]) for (const dy of [0, 0.35]) {
    const C = C0.clone().sub(T).applyAxisAngle(new THREE.Vector3(0, 1, 0), da * DEG).add(T); C.y += dy
    if (!hitsBetween(T, C) && !(E && hitsBetween(C, E))) { best = C; break }
    if (best) break
  }
  if (!best) { const h = hitsBetween(T, C0); best = h ? T.clone().add(C0.clone().sub(T).normalize().multiplyScalar(Math.max(0.8, h.distance - 0.25))) : C0 }
  restore()
  const inv = m.clone().invert(); best.applyMatrix4(inv)
  return { cam: [best.x, best.y, best.z], tgt: S.tgt, fov: S.fov }
}
const EYE: Partial<Record<PartK, Record<number, THREE.Vector3>>> = {
  rent: { 0: OPS.OP_HOME.clone().setY(1.3), 1: OPS.TERM.clone().setY(1.3), 2: OPS.TERM.clone().setY(1.3), 3: OPS.TERM.clone().setY(1.3), 4: OPS.GSTAND.clone().setY(1.3), 5: OPS.WORK.clone().setY(1.3), 6: OPS.OP_HOME.clone().setY(1.3) },
}
let stageView: { part: PartK; i: number } | null = null
// The clear angle is computed in the room frame: it does not depend on its place on the orbit; it is cached
// and precomputed at idle after loading (raycasting is costly at the start of a Rent step)
// each shot backs off along its line of sight until a figure (1.8 m) near the
// target fits in a third of the frame height (3.2 m margin for the third); the clear angle is then searched
const pullMemo = new Map<Cam, Cam>()
function pullBack(c: Cam): Cam {
  let p = pullMemo.get(c); if (p) return p
  if (c === SHOULDER.use) { pullMemo.set(c, c); return c } // Use stays close to the screens, which must be readable
  const T = new THREE.Vector3(...c.tgt), C = new THREE.Vector3(...c.cam), d = C.clone().sub(T), need = 3.2 / Math.tan((c.fov / 2) * DEG)
  if (d.length() < need) C.copy(T).addScaledVector(d.normalize(), need)
  p = { cam: [C.x, C.y, C.z], tgt: c.tgt, fov: c.fov }; pullMemo.set(c, p); return p
}
const clearMemo = new Map<string, Cam>()
function clearCached(k: PartK, si: number, raw: Cam) {
  const key = `${k}:${si}`; let c = clearMemo.get(key)
  if (!c) { c = clearCam(k, raw, EYE[k]?.[si]); clearMemo.set(key, c) }
  return c
}
export function precomputeClear() {
  const todo: [PartK, number][] = []
  for (const k of ORDER) for (const si of Object.keys(STAGE_CAM[k] ?? {})) todo.push([k, Number(si)])
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 120))
  const next = () => { const t = todo.shift(); if (!t) return; const raw = pullBack(STAGE_CAM[t[0]]![t[1]]); clearCached(t[0], t[1], raw); ric(next) }
  ric(next)
}
// The arrival pose of a focus shows the whole diorama; same camera-to-room distance,
// same pitch and field of view for all three; only the azimuth adapts (Use: right three-quarter, the drone and its
// cage visible; Rent: front-on, on the racks; Publish: left three-quarter). The distance is the one that fits the
// largest room (Rent) whole in the free area. On Rent steps, the camera tightens a little towards the action.
// Over-the-shoulder camera style, the diorama in the right part: 7.5 m, pitch 18°, field 42°,
// for all three; the target on each room's subject, slightly above the floor (local): Use between the desk and the
// drone cage, Rent on the racks, Publish on the desk; the view shift puts the subject at the centre of the free area
const FOCUS = { el: 18, fov: 42, dist: 7.5, az: { use: 24, rent: 2, publish: -16 } as Record<PartK, number>,
  aim: { use: [0.9, 0.85, -0.3], rent: [1.6, 0.95, -0.7], publish: [-0.1, 0.85, -0.4] } as Record<PartK, [number, number, number]> }
let focusDist: { key: string; d: number } | null = null
const roomAz = (k: PartK) => { let az = IY / DEG + FOCUS.az[k]; while (az - AZ0 > 180) az -= 360; while (az - AZ0 < -180) az += 360; return az }
const roomBox = (k: PartK) => { const i = W.islands[k]; return new THREE.Box3(new THREE.Vector3(i.size.x0, 0, i.size.z0), new THREE.Vector3(i.size.x1, WALL_H[k] + 0.2, i.size.z1)).applyMatrix4(islandM(k)) }
function sameDist(mob: boolean, fr: number) {
  const key = `${rig.w}x${rig.h}x${fr.toFixed(2)}x${mob}`
  if (focusDist?.key === key) return focusDist.d
  let d = 0
  for (const k of ORDER) {
    const f = rig.fit(roomBox(k), roomAz(k), FOCUS.el, mob ? 0.92 : fr * 0.88, mob ? 0.8 : 0.8)
    const zoomF = f.zoom * Math.tan((FOCUS.fov / 2) * DEG) / Math.tan((FOV / 2) * DEG)
    d = Math.max(d, D0 / zoomF)
  }
  focusDist = { key, d }; return d
}
function roomPose(k: PartK, shift: number, mob: boolean, fr: number): Pose {
  const i = W.islands[k], m = islandM(k)
  void i; void sameDist
  const T = new THREE.Vector3(...FOCUS.aim[k]).applyMatrix4(m)
  let dist = FOCUS.dist
  const si = stageView?.part === k ? stageView.i : 0, sc = STAGE_CAM[k]?.[si]
  if (si > 0 && sc) { T.lerp(new THREE.Vector3(...sc.tgt).applyMatrix4(m), 0.5); dist *= 0.8 }
  return { tx: T.x, ty: T.y, tz: T.z, az: roomAz(k), el: FOCUS.el, zoom: D0 / dist, shift, lift: 0, fov: FOCUS.fov }
}
export function shoulderPose(k: PartK, shift: number): Pose {
  const si = stageView?.part === k ? stageView.i : 0
  const raw = pullBack(STAGE_CAM[k]?.[si] ?? SHOULDER[k])
  const S = STAGE_CAM[k] ? clearCached(k, si, raw) : raw, m = islandM(k)
  const C = new THREE.Vector3(...S.cam).applyMatrix4(m), T = new THREE.Vector3(...S.tgt).applyMatrix4(m)
  const d = C.clone().sub(T), dist = d.length()
  let az = Math.atan2(d.x, d.z) / DEG
  while (az - AZ0 > 180) az -= 360; while (az - AZ0 < -180) az += 360
  return { tx: T.x, ty: T.y, tz: T.z, az, el: Math.asin(d.y / dist) / DEG, zoom: D0 / dist, shift, lift: 0, fov: S.fov }
}
let camTween: gsap.core.Animation | null = null
function setPose(p: Pose, dur = 1.2, ease = EXPRESSIVE) {
  camTween?.kill()
  dragTween?.kill(); clearTimeout(idleT)
  if (!dur || reduced) { Object.assign(rig.pose, p); rig.user.az = rig.user.el = 0; rig.user.zoom = 1; rig.drag.az = rig.drag.el = 0; rig.drag.zoom = 1; dirty = true; return }
  void dur; void ease
  // A single path for all camera gestures (to each room, to CCTP, and
  // back): the position follows a single smooth curve (Bezier whose control point is pushed outwards of the
  // galaxy and raised a little: the path never goes through the centre), the target slides in a straight line, one ease
  // (power2.inOut) and a fixed duration (1.6 s)
  rig.apply()
  const C0 = rig.cam.position.clone(), T0 = new THREE.Vector3(rig.pose.tx, rig.pose.ty, rig.pose.tz)
  const s0 = { shift: rig.pose.shift, lift: rig.pose.lift, fov: rig.pose.fov }
  const d1 = D0 / p.zoom, a1 = p.az * DEG, e1 = p.el * DEG
  const T1 = new THREE.Vector3(p.tx, p.ty, p.tz), C1 = T1.clone().add(new THREE.Vector3(d1 * Math.cos(e1) * Math.sin(a1), d1 * Math.sin(e1), d1 * Math.cos(e1) * Math.cos(a1)))
  const M = C0.clone().add(C1).multiplyScalar(0.5), rh = Math.max(Math.hypot(C0.x, C0.z), Math.hypot(C1.x, C1.z)), mh = Math.hypot(M.x, M.z)
  if (mh > 1e-3 && mh < rh) { M.x *= rh / mh; M.z *= rh / mh }
  M.y += 0.12 * C0.distanceTo(C1)
  rig.user.az = rig.user.el = 0; rig.user.zoom = 1; rig.drag.az = rig.drag.el = 0; rig.drag.zoom = 1
  const st = { u: 0 }, C = new THREE.Vector3(), T = new THREE.Vector3(), q0 = new THREE.Vector3(), q1 = new THREE.Vector3()
  const put = () => {
    const u = st.u
    q0.copy(C0).lerp(M, u); q1.copy(M).lerp(C1, u); C.copy(q0).lerp(q1, u); T.copy(T0).lerp(T1, u)
    const d = C.clone().sub(T), L = Math.max(1e-3, d.length())
    let az = Math.atan2(d.x, d.z) / DEG; while (az - p.az > 180) az -= 360; while (az - p.az < -180) az += 360
    Object.assign(rig.pose, { tx: T.x, ty: T.y, tz: T.z, az, el: Math.asin(THREE.MathUtils.clamp(d.y / L, -1, 1)) / DEG, zoom: D0 / L,
      shift: s0.shift + (p.shift - s0.shift) * u, lift: s0.lift + (p.lift - s0.lift) * u, fov: s0.fov + (p.fov - s0.fov) * u })
  }
  put()
  camTween = hotTween(gsap.to(st, { u: 1, duration: CAM_DUR, ease: 'power2.inOut', onUpdate: put, onComplete: () => { Object.assign(rig.pose, p) } }))
}
const CAM_DUR = 1.6
const colEl = $('#col')
// the demo, wired to the scene
// ---------- Demo director. Everything is computed from the timeline time t (demo.ts): the room
// feed (a loop.ts range played at the pace of time), the followed packet on a centripetal CatmullRom rail (constant
// speed via getPointAt, looking slightly ahead), and the target camera pose, which the actual pose
// catches up with through dt-dependent damping (damp): no cuts, a single continuous glide ----------
const pkTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(220,240,255,0.95)'); gr.addColorStop(0.45, 'rgba(120,200,255,0.35)'); gr.addColorStop(1, 'rgba(60,120,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t })()
const pkSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: pkTex, color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
pkSprite.renderOrder = 20; pkSprite.visible = false; scene.add(pkSprite)
const PK_COL: Record<string, number> = { tx: 0xc48dff, usdc: 0x7fb2ff, quote: 0xffe2b8, sealed: 0x5ff0ff, sig: 0xeafdff }
let railI = -1, rail: THREE.CatmullRomCurve3 | null = null, lastLt = -1, lastNow = 0, demoBeat = -1
const tgtPose: Pose = { tx: 0, ty: 0, tz: 0, az: AZ0, el: 25, zoom: 1, shift: 0, lift: 0, fov: FOV }
const easeIO = (x: number) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
function railFor(i: number) {
  const b = BEATS[i]; if (!b.chase) return null
  const src = linkPts[b.chase.link as Link], pts: THREE.Vector3[] = []
  for (let k = 0; k <= 5; k++) pts.push(src[Math.round((k / 5) * NSEG)].clone())
  if (b.chase.rev) pts.reverse()
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal')
}
// the target pose for a shot (at shot time u)
const sv1 = new THREE.Vector3(), sv2 = new THREE.Vector3(), sbox = new THREE.Box3()
function camTarget(b: Beat, u: number, i: number): Pose {
  const P = camTarget0(b, u, i); P.shift += demo.side(); return P
}
function camTarget0(b: Beat, u: number, i: number): Pose {
  const mob = mobileMQ.matches, c = b.cam
  // the client screen, front-on and slightly angled, large enough to read the page (52% of the height)
  if (c.k === 'screen') {
    const ms = W.deskScreens.use[1]; ms.updateWorldMatrix(true, false)
    const ctr = ms.getWorldPosition(sv1), n = sv2.set(0, 0, 1).transformDirection(ms.matrixWorld)
    const bx = sbox.setFromObject(ms), h = bx.max.y - bx.min.y, w = Math.hypot(bx.max.x - bx.min.x, bx.max.z - bx.min.z)
    const asp = rig.w / Math.max(1, rig.h), free = 1 - 2 * demo.side()
    const zoom = Math.min((2 * H0 * 0.52) / h, (2 * H0 * asp * 0.86 * free) / w)
    return { tx: ctr.x, ty: ctr.y, tz: ctr.z, az: Math.atan2(n.x, n.z) / DEG + 12, el: Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)) / DEG + 10, zoom, shift: 0, lift: 0, fov: FOV }
  }
  if (c.k === 'wide') { const p = poseFor('ensemble', null); return { ...p, shift: 0, lift: mob ? 0.12 : 0.04 } }
  if (c.k === 'arc') return { ...arcPose(mob, 0), zoom: D0 / (mob ? 30 : 24), fov: FOV, el: 20, shift: 0, lift: mob ? 0.12 : 0.04 } // the whole A, with some air
  if (c.k === 'room') { const p = roomPose(c.a, 0, mob, 1); return { ...p, shift: 0, lift: mob ? 0.14 : 0.06 } }
  if (c.k === 'close') { const keep = stageView; stageView = c.si !== undefined ? { part: c.a, i: c.si } : null; const p = shoulderPose(c.a, 0); stageView = keep; return { ...p, lift: mob ? 0.14 : 0.06 } }
  // chase: behind the packet, at a fixed distance, fixed azimuth (the flow axis stays the same), slightly ahead
  if (i !== railI) { rail = railFor(i); railI = i }
  const uu = easeIO(u), p = rail!.getPointAt(uu), ah = rail!.getPointAt(Math.min(1, uu + 0.06))
  const t = p.clone().addScaledVector(ah.sub(p), 0.3)
  // the response (rack to client) passes near the A: more air to keep it whole; the request, as close as possible
  const ur = b.chase?.link === 'useRent', back = ur && b.chase?.rev
  return { tx: t.x, ty: t.y, tz: t.z, az: AZ0 + 8, el: 30, zoom: D0 / (mob ? (ur ? 22 : 19) : back ? 16 : ur ? 8.5 : 12), shift: 0, lift: mob ? 0.12 : 0.04, fov: FOV }
}
const dampK = (l: number, dt: number) => 1 - Math.exp(-l * dt)
const rcvV = new THREE.Vector3()
function demoAt(t: number, b: Beat, u: number, i: number): { x: number; y: number } | null {
  if (!renderer) return null
  const now = performance.now(), dt = Math.min(0.1, Math.max(0.001, (now - lastNow) / 1000)); lastNow = now
  if (i !== demoBeat) { demoBeat = i; shotLinks.clear(); if (b.chase) shotLinks.add(b.chase.link as Link); shotKind = b.cam.k === 'wide' ? 'map' : 'dio' }
  // the room feed, at the pace of demo time
  if (b.loop) {
    const lt = b.loop[0] + (b.loop[1] - b.loop[0]) * u
    if (Math.abs(lt - lastLt) > 1e-4) { if (lt < lastLt - 0.05 || lt - lastLt > 2.5) loop.seek(false, lt); else { loop.tl.pause(); loop.tl.seek(lt, false) } lastLt = lt }
  }
  // the client screen follows the action (Use page: service, typing, sealed send, signed response)
  { const c = clientAt(i, u); CLIENT.on = true; CLIENT.phase = c.phase; CLIENT.k = c.k }
  // the followed packet (or, during "received", resting on the rack, frozen for a moment then a burst)
  const rcv = b.recv ? BEATS[i - 1] : null
  if (b.chase || rcv) {
    const ri = b.chase ? i : i - 1; if (ri !== railI) { rail = railFor(ri); railI = ri }
    const p = b.chase ? rail!.getPointAt(easeIO(u)) : rail!.getPointAt(1)
    // "received": the packet leaves the end of the rail and drops into the target rack (the close-up point)
    if (b.recv) { const d = camTarget(b, 0.5, i); p.lerp(rcvV.set(d.tx, d.ty, d.tz), easeIO(Math.min(1, u / 0.28))) }
    pkSprite.position.copy(p); pkSprite.visible = true
    ;(pkSprite.material as THREE.SpriteMaterial).color.setHex(PK_COL[(b.chase ?? rcv!.chase!).kind] ?? 0xffffff)
    const flash = b.recv ? Math.max(0, 1 - Math.abs(u - 0.32) / 0.12) : 0
    pkSprite.scale.setScalar((b.recv ? 0.9 * (1 - Math.max(0, u - 0.42) / 0.58) : 0.9) * (1 + 1.4 * flash))
    HALO_MAT[1].uniforms.uK.value = 1 + 5 * flash
  } else { pkSprite.visible = false; HALO_MAT[1].uniforms.uK.value = 1 }
  // the camera: target pose, caught up smoothly (reduced motion: set at once, fade on the page side)
  Object.assign(tgtPose, camTarget(b, reduced ? 0.5 : u, i))
  if (b.recv && !reduced) tgtPose.zoom *= 1 + 0.06 * Math.sin(Math.min(1, u / 0.5) * Math.PI / 2)
  let az = tgtPose.az; while (az - rig.pose.az > 180) az -= 360; while (az - rig.pose.az < -180) az += 360
  const P = rig.pose
  if (reduced) Object.assign(P, tgtPose, { az })
  else {
    const kT = dampK(b.cam.k === 'chase' || b.recv ? 5 : 2.6, dt), kZ = dampK(2.2, dt), kA = dampK(1.6, dt)
    P.tx += (tgtPose.tx - P.tx) * kT; P.ty += (tgtPose.ty - P.ty) * kT; P.tz += (tgtPose.tz - P.tz) * kT
    P.az += (az - P.az) * kA; P.el += (tgtPose.el - P.el) * kA
    P.zoom = Math.exp(Math.log(P.zoom) + (Math.log(tgtPose.zoom) - Math.log(P.zoom)) * kZ)
    P.shift += (tgtPose.shift - P.shift) * kZ; P.lift += (tgtPose.lift - P.lift) * kZ; P.fov += (tgtPose.fov - P.fov) * kZ
  }
  rig.user.az = rig.user.el = 0; rig.user.zoom = 1
  dirty = true
  rig.apply()
  const q = pkSprite.visible ? pkSprite.position : b.cam.k === 'room' || b.cam.k === 'close' ? actorPt(b.cam.a) : b.cam.k === 'arc' ? actorPt('arc') : null
  if (!q) return null
  bv.copy(q).applyMatrix4(rig.cam.matrixWorldInverse); if (bv.z > -rig.cam.near) return null
  rig.project(vp.copy(q), o2); return { x: o2.x, y: o2.y }
}
const demo = makeDemo({
  stage, reduced: () => reduced, gl: !!renderer,
  at: demoAt,
  quit: () => { go('ensemble'); document.querySelector<HTMLElement>('[data-view="demo"], #choices .net-part')?.focus() },
  mobile: () => mobileMQ.matches,
  dirty: () => { dirty = true },
})
;(stage.querySelector('.dm') as HTMLElement | null)?.setAttribute('data-gl', renderer ? '1' : '0')
// in the overview, the loop is an illustrative replay: a discreet badge says so
let autoT = 0, stepCalled = false
function go(v: View, opts: { el?: string | null; instant?: boolean } = {}) {
  const prev = view
  if (show && v !== show.part) stopShow()
  view = v; stepEl = opts.el ?? null
  hover.close(); setHover(null, 'scene')
  if (v === 'ensemble') spinT = 0
  clearTimeout(autoT); stepCalled = false
  if (prev !== v) { stageView = null; lastStep = ''; extraFor = '' }
  if (!freeze && !opts.instant && prev !== v) {
    if (v === 'ensemble') { loop.setReal(null); if (!reduced) loop.restart(false) }
    else if (v !== 'cctp' && v !== 'arc' && v !== 'demo') autoT = window.setTimeout(() => { if (view === v && !stepCalled) { loop.setReal(null); runRanges(v, [[STAGES[v][1][0][0], STAGES[v][AUTO_LAST[v]][0][1]]]) } }, 1300)
  }
  setPose(poseFor(v, stepEl), opts.instant ? 0 : 1.2)
  { const to = 0; if (opts.instant || reduced) demoK.k = to; else if (demoK.k !== to) hotTween(gsap.to(demoK, { k: to, duration: CAM_DUR, ease: 'power2.inOut' })) }
  if (v === 'demo' && prev !== 'demo') { stage.dataset.view = v; colEl?.setAttribute('data-col', v); demoResize(); camTween?.kill(); for (const k of ORDER) outK[k] = 0; ccOut.o = 0; mapTilt.x = 0; loop.tl.pause(); loop.rtl.pause(); lastLt = -1; demoBeat = -1; lastNow = performance.now(); demo.start() } else if (v !== 'demo' && prev === 'demo') demo.stop()
  // on Arc focus, the rooms and the CCTP system leave (nothing in the A volume)
  const wide = v === 'ensemble' || v === 'demo'
  const s = 1 // the A keeps its size everywhere; occlusion is handled by the camera
  if (opts.instant || reduced) arcK.s = s; else hotTween(gsap.to(arcK, { s, duration: CAM_DUR, ease: 'power2.inOut' }))
  // on focus, the other islands leave the frame: they move aside and down, then disappear at the end of the gesture
  for (const k of ORDER) if (k === v || wide) W.islands[k].group.visible = true
  // in the demo, each shot sets what leaves the frame itself (demoShot): do not override it here
  if (v !== 'demo') for (const k of ORDER) { const to = wide || k === v ? 0 : 1; if (opts.instant || reduced) outK[k] = to; else hotTween(gsap.to(outK, { [k]: to, duration: CAM_DUR, ease: 'power2.inOut' })) }
  if (v !== 'demo') { const to = wide || v === 'cctp' ? 0 : 1; if (opts.instant || reduced) ccOut.o = to; else hotTween(gsap.to(ccOut, { o: to, duration: CAM_DUR, ease: 'power2.inOut' })) }
  gsap.delayedCall(opts.instant || reduced ? 0 : CAM_DUR, () => { if (view === v) for (const k of ORDER) W.islands[k].group.visible = wide || k === v; dirty = true })
  if (prev !== v || opts.instant) renderPanel(!opts.instant)
  syncSteps()
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tab')) b.setAttribute('aria-pressed', String(b.dataset.view === v))
  colEl?.setAttribute('data-col', v)
  stage.dataset.view = v
  ANCH.visible = v === 'ensemble'
  if (v === 'ensemble') colHidden.clear()
  const url = new URL(location.href)
  if (v === 'ensemble') url.searchParams.delete('focus'); else url.searchParams.set('focus', v)
  history.replaceState(null, '', url)
  keyFor(v)
  if (prev === 'demo' && v !== 'demo') demoResize()
}

// ---------- Left column: the three choices, or the step panel ----------
const panel = $('#panel'), stepsEl = $('#steps'), choices = $('#choices')
function staticTexts() {
  for (const e of document.querySelectorAll<HTMLElement>('[data-s3d-ui]')) e.textContent = ui(e.dataset.s3dUi!)
}
function renderPanel(anim = true) {
  panel.hidden = view === 'ensemble'; if (choices) choices.hidden = view !== 'ensemble'
  arcPanel(panel, view === 'arc')
  if (view === 'ensemble' || view === 'demo') return
  if (view === 'arc') {
    // Arc focus, contract by contract (arcfocus.ts)
    $('#p-kick').textContent = ''; $('#p-title').textContent = tr(ARC_TITLE); $('#p-actor').textContent = ''
    void ARC_INTRO
    stepsEl.innerHTML = ''; $('#refus').hidden = true
    const br = document.querySelector<HTMLElement>('#browse'); if (br) br.hidden = true
    return
  }
  if (view === 'cctp') {
    // CCTP focus, its text, without steps
    const T = CCTP_P[lg()]
    $('#p-kick').textContent = ''; $('#p-title').textContent = T.title; $('#p-actor').textContent = T.actor
    stepsEl.innerHTML = ''; $('#refus').hidden = true
    const br = document.querySelector<HTMLElement>('#browse'); if (br) br.hidden = true
    if (anim && !reduced) gsap.fromTo([$('#p-title'), $('#p-actor')], { clipPath: 'inset(0 0 100% 0)', y: 4 }, { clipPath: 'inset(0 0 0% 0)', y: 0, duration: 0.24, ease: 'power3.out', stagger: 0.045, clearProps: 'clipPath,transform' })
    return
  }
  const P = parts()[view]
  $('#p-kick').textContent = P.kicker; $('#p-title').textContent = P.title; $('#p-actor').textContent = P.actor
  ;($('#p-kick') as HTMLElement).style.color = PART[view].css
  stepsEl.innerHTML = ''
  P.steps.forEach((s, i) => {
    const li = document.createElement('li'), b = document.createElement('button')
    b.type = 'button'; b.className = 'step'; b.dataset.el = s.el; b.dataset.i = String(i); b.setAttribute('aria-pressed', 'false')
    b.innerHTML = `<span class="step-n">${String(i + 1).padStart(2, '0')}</span><span class="step-t"><span class="step-tt"></span>${s.check ? ' <span class="step-c tnum">0/5</span>' : ''}</span><span class="step-d"></span>`
    b.querySelector('.step-tt')!.textContent = s.t; b.querySelector('.step-d')!.textContent = s.d
    li.appendChild(b)
    if (s.check) {
      const ol = document.createElement('ol'); ol.className = 'checks'
      for (const c of checks()) { const r = document.createElement('li'); r.dataset.on = '0'; r.innerHTML = '<span class="ck" aria-hidden="true"></span><span class="ck-k"></span><span class="ck-v"></span>'; r.querySelector('.ck-k')!.textContent = c.k; ol.appendChild(r) }
      li.appendChild(ol)
    }
    stepsEl.appendChild(li)
  })
  $('#refus').hidden = view !== 'rent'
  const br = document.querySelector<HTMLElement>('#browse'); if (br) br.hidden = view !== 'use' // the service catalogue, from the Use focus
  ckKey = ''
  if (anim && !reduced) gsap.fromTo([$('#p-kick'), $('#p-title'), $('#p-actor'), ...Array.from(stepsEl.children) as HTMLElement[]], { clipPath: 'inset(0 0 100% 0)', y: 4 }, { clipPath: 'inset(0 0 0% 0)', y: 0, duration: 0.24, ease: 'power3.out', stagger: 0.045, clearProps: 'clipPath,transform' })
}
// the "Arc verifies" step: its five checks tick with the gantry posts, "n/5" in its title
let ckKey = ''
function panelTick() {
  if (view !== 'rent') return
  const c = CHECK(loop.S, loop.refuse), k = `${c.n}${c.bad}${c.ok}`
  if (k === ckKey) return; ckKey = k
  const cs = checks()
  stepsEl.querySelectorAll<HTMLElement>('.step-c').forEach((e) => { e.textContent = `${c.n}/5` })
  stepsEl.querySelectorAll<HTMLElement>('.checks li').forEach((r, i) => {
    const bad = c.bad && i === 1, last = c.bad && i === 4
    const on = bad || last || i < c.n
    r.dataset.on = on ? '1' : '0'; r.dataset.bad = bad || last ? '1' : '0'
    ;(r.querySelector('.ck-v') as HTMLElement).textContent = on ? (bad || last ? cs[i].bad ?? '' : cs[i].ok) : ''
  })
}
let activeStep: number | null = null
function syncSteps() { if (!stepEl) activeStep = null; for (const b of stepsEl.querySelectorAll<HTMLButtonElement>('.step')) b.setAttribute('aria-pressed', String(stepEl !== null && Number(b.dataset.i) === activeStep)) }
stepsEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.step'); if (!b || view === 'ensemble') return
  const i = Number(b.dataset.i)
  if (activeStep === i) { activeStep = null; go(view); return }
  activeStep = i; go(view, { el: b.dataset.el! })
  if (!freeze) { playStep(view as Part, Math.min(i + 1, STAGES[view as Part].length - 1)); dirty = true }
})
const stepHover = (e: Event) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.step'); setHover(b ? b.dataset.el! : null, 'step') }
stepsEl.addEventListener('pointerover', stepHover); stepsEl.addEventListener('focusin', stepHover)
stepsEl.addEventListener('pointerleave', () => setHover(null, 'step')); stepsEl.addEventListener('focusout', () => setHover(null, 'step'))
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-view]')) b.addEventListener('click', () => { const v = b.dataset.view; if (v !== 'ensemble' && v !== 'use' && v !== 'rent' && v !== 'publish' && v !== 'cctp' && v !== 'arc' && v !== 'demo') return; activeStep = null; go(v) })

// ---------- Z3 key: the four packets; on focus, only those of the part ----------
function keyFor(v: View) {
  // the key follows the actual scene; on focus, what the part shows
  const keep: Record<View, string[]> = { arc: ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6'], demo: [], cctp: ['k4', 'k5', 'k6'], ensemble: ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6'], use: ['k0', 'k1', 'k2', 'k4', 'k5', 'k6'], rent: ['k2', 'k3', 'k4', 'k6'], publish: ['k2', 'k3', 'k4', 'k6'] }
  for (const li of document.querySelectorAll<HTMLElement>('#key [data-k]')) li.hidden = !keep[v].includes(li.dataset.k!)
}

// ---------- Hover: selection frame; in the overview a label at its place; on focus, the step lights up ----------
const hover = makeHoverModal($('#modals'), document.querySelector('#mlinks') as SVGSVGElement, reduced)
let hoverScene: string | null = null, hoverStep: string | null = null, closeT = 0
function setHover(id: string | null, from: 'scene' | 'step') {
  if (from === 'scene') hoverScene = id; else hoverStep = id
  canvas.classList.toggle('is-pick', !!hoverScene)
  const cur = hoverStep ?? hoverScene
  clearTimeout(closeT)
  if (view === 'ensemble' && from === 'scene') {
    if (cur) hover.set(cur, ficheOf(cur), placeOf(cur))
    // the label stays while the pointer is over it (WCAG 1.4.13)
    else closeT = window.setTimeout(() => { if (!hover.api.over() && !hoverScene) hover.close(); dirty = true }, 160)
  }
  // on focus: hovering the element lights up the step that names it
  for (const b of stepsEl.querySelectorAll<HTMLElement>('.step')) b.dataset.hl = from === 'scene' && id && (b.dataset.el === id || (id === 'title.' + view && b.dataset.i === '0')) ? '1' : '0'
  dirty = true
}
hover.api.onLeave = () => { if (!hoverScene) { hover.close(); dirty = true } }
const o2 = { x: 0, y: 0 }, vp = new THREE.Vector3()
function overlay() {
  const id = hoverStep ?? hoverScene
  if (id && picks.has(id) && !id.startsWith('link.')) {
    const r = rig.rect(boxOf(id))
    selEl.style.transform = `translate(${(r.x - 8).toFixed(1)}px, ${(r.y - 8).toFixed(1)}px)`; selEl.style.width = `${r.w + 16}px`; selEl.style.height = `${r.h + 16}px`
    selEl.dataset.on = '1'
  } else selEl.dataset.on = '0'
  // connector obstacles: projected titles and links
  // connector obstacles are only projected when a label is open (otherwise every
  // frame would run hundreds of projections and allocations for nothing)
  const block: Box[] = [], segs: [number, number][][] = []
  const hid = hover.api.id()
  if (hid || hover.api.busy) {
    for (const k of ORDER) if (W.titles[k].mesh.visible) { const r = rig.rect(titleBox(k)); block.push([r.x - 4, r.y - 4, r.x + r.w + 4, r.y + r.h + 4]) }
    for (const k of LINKS) { if (hid === 'link.' + k) continue; segs.push(linkPts[k].filter((_, i) => i % 4 === 0).map((p) => { rig.project(vp.copy(p), o2); return [o2.x, o2.y] as [number, number] })) }
  }
  const P = hid && picks.has(hid) ? (rig.project(vp.copy(anchorOf(hid)), o2), { x: o2.x, y: o2.y }) : null
  const kH = hid ? keyBandH() : 0
  hover.update(P, rig.w, rig.h - kH, block, segs, hid ? colFrac() * rig.w : 0)
  packetLabel()
  panelTick()
}

// ---------- Packets: their name as a direct label on hover ----------
let pkHover = -1, mouse = { x: -1e4, y: -1e4 }
function packetAt(x: number, y: number) {
  const A = W.packetAttr; let best = -1, bd = 14 * 14
  for (let i = 0; i < A.pos.count; i++) {
    if (A.size.getX(i) <= 0) continue
    rig.project(vp.set(A.pos.getX(i), A.pos.getY(i), A.pos.getZ(i)), o2)
    const d = (o2.x - x) ** 2 + (o2.y - y) ** 2
    if (d < bd) { bd = d; best = i }
  }
  return best
}
const keyBandH = () => { const kEl = document.querySelector<HTMLElement>('#key'); return kEl && getComputedStyle(kEl).position === 'absolute' ? kEl.offsetHeight : 0 }
function packetLabel() {
  if ((view !== 'ensemble' && mobileMQ.matches) || mouse.x < -1e3) { pkLabel.hidden = true; return } // nothing to look for without a pointer
  pkHover = packetAt(mouse.x, mouse.y)
  if (pkHover < 0) { pkLabel.hidden = true; return }
  const A = W.packetAttr
  rig.project(vp.set(A.pos.getX(pkHover), A.pos.getY(pkHover), A.pos.getZ(pkHover)), o2)
  pkLabel.textContent = pkName(Math.round(A.shape.getX(pkHover)))
  pkLabel.style.transform = `translate(${(o2.x + 12).toFixed(1)}px, ${(o2.y - 10).toFixed(1)}px)`
  pkLabel.hidden = false
}

// ---------- Pointer ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3(), pt = new THREE.Vector3()
const BROAD = new Set(['rent.baies', 'rent.quai', 'use.guichet', 'publish.poste'])
function pickAt(cx: number, cy: number): string | null {
  const r = canvas.getBoundingClientRect()
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1)
  rig.apply(); ray.setFromCamera(ndc, rig.cam)
  let best: string | null = null, bd = Infinity
  const tol = 0.14 * rig.distance() / D0
  for (const p of picks.values()) {
    if (view !== 'ensemble' && (p.id.startsWith('link.') || p.id === 'arc' || (ISLAND_OF(p.id) && ISLAND_OF(p.id) !== view))) continue
    let d = Infinity
    if (p.segs) { const s = p.segs(); for (let i = 0; i < s.length - 1; i += 2) if (ray.ray.distanceSqToSegment(s[i], s[Math.min(i + 2, s.length - 1)], pt) < tol * tol) d = Math.min(d, pt.distanceTo(ray.ray.origin) + 30) }
    else if (ray.ray.intersectBox(p.dyn!(), hit)) d = hit.distanceTo(ray.ray.origin) + (BROAD.has(p.id) ? 50 : 0)
    if (d < bd) { bd = d; best = p.id }
  }
  return best
}
let down: { x: number; y: number; moved: boolean; lx: number; ly: number; id: number } | null = null
// ---------- The visitor's hand. Dragging turns the scene, the wheel zooms in; bounded (never below or
// behind: ±50° around the view azimuth, ±35° on focus; elevation 5 to 50°); without the hand for 3.5 s,
// a smooth return, then the automatic oscillation resumes ----------
let dragging = false, idleT = 0, dragTween: gsap.core.Animation | null = null
function dragIdle() { return !dragging && Math.abs(rig.drag.az) < 1e-3 && Math.abs(rig.drag.el) < 1e-3 && Math.abs(rig.drag.zoom - 1) < 1e-3 }
function scheduleReturn() {
  clearTimeout(idleT)
  if (reduced) return
  idleT = window.setTimeout(() => { dragTween?.kill(); dragTween = hotTween(gsap.to(rig.drag, { az: 0, el: 0, zoom: 1, duration: 1.6, ease: 'power2.inOut' })) }, 3500)
}
function clampDrag() {
  const A = view === 'ensemble' ? 50 : 35
  rig.drag.az = THREE.MathUtils.clamp(rig.drag.az, -A, A)
  rig.drag.el = THREE.MathUtils.clamp(rig.drag.el, 5 - rig.pose.el, 50 - rig.pose.el)
}
canvas.addEventListener('wheel', (e) => {
  if (freeze) return
  const lo = 0.72, hi = view === 'ensemble' ? 2.6 : 1.7
  const z = THREE.MathUtils.clamp(rig.drag.zoom * Math.exp(-e.deltaY * 0.0012), lo, hi)
  if (Math.abs(z - rig.drag.zoom) < 1e-4) return // at the limit: the page scrolls
  e.preventDefault(); dragTween?.kill(); rig.drag.zoom = z; dirty = true; scheduleReturn()
}, { passive: false })
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, moved: false, lx: e.clientX, ly: e.clientY, id: e.pointerId } })
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true
  if (down && down.moved && !freeze) {
    if (!dragging) { dragging = true; canvas.classList.add('is-drag'); dragTween?.kill(); clearTimeout(idleT); try { canvas.setPointerCapture(down.id) } catch { /* already released */ } }
    rig.drag.az -= (e.clientX - down.lx) * 0.22; rig.drag.el += (e.clientY - down.ly) * 0.16; clampDrag()
    down.lx = e.clientX; down.ly = e.clientY; dirty = true
    return
  }
  const pk = packetAt(mouse.x, mouse.y)
  const id = pk >= 0 ? null : pickAt(e.clientX, e.clientY)
  if (id !== hoverScene) setHover(id, 'scene')
  dirty = true
})
canvas.addEventListener('pointerleave', () => { mouse = { x: -1e4, y: -1e4 }; setHover(null, 'scene') })
canvas.addEventListener('pointerup', (e) => {
  const d = down; down = null
  if (dragging) { dragging = false; canvas.classList.remove('is-drag'); scheduleReturn(); dirty = true; return }
  if (!d || d.moved) return
  const id = pickAt(e.clientX, e.clientY)
  if (view === 'demo') return // during the demo, a click does not change view (it pauses, demo.ts)
  const part = id ? (id === 'arc' ? 'arc' : id.startsWith('cctp') || id === 'title.cctp' ? 'cctp' : ISLAND_OF(id)) : null
  if (part && view !== part) { activeStep = null; go(part) }
})
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (hover.api.id()) { hover.close(); dirty = true } else if (view !== 'ensemble') go('ensemble')
})

// ---------- Rejection ----------
const refusBtn = $<HTMLButtonElement>('#refus')
function playRefus() {
  refusBtn.disabled = true
  loop.rtl.eventCallback('onComplete', () => { refusBtn.disabled = false; if (reduced) loop.still(); else if (!freeze) loop.restart(false) })
  if (reduced) { loop.seek(true, REFUS_S - 0.1); refusBtn.disabled = false; dirty = true; return }
  loop.restart(true)
}
refusBtn.addEventListener('click', playRefus)
onLang(() => { staticTexts(); hover.close(); if (view !== 'ensemble') renderPanel(false); demo.lang(); dirty = true })

// ---------- Startup ----------
mobileMQ.addEventListener('change', resize); addEventListener('resize', resize)
addEventListener('net:scr', () => { dirty = true }) // the site pages arrive, the screens redraw
// in the overview, the replay alternates an admitted cycle and a rejected cycle (the red shows), each round
let cycles = 0
loop.tl.eventCallback('onRepeat', () => {
  if (view !== 'ensemble' || freeze || reduced || !refusBtn) return
  if (++cycles % 2 === 1) { loop.rtl.eventCallback('onComplete', () => { refusBtn.disabled = false; if (view === 'ensemble' && !freeze && !reduced) loop.restart(false) }); loop.restart(true) }
})
// the column can change width without the window changing (fonts, hydration); the
// overview frame is then recomputed, otherwise logos pass under it during the sway
{ let lastW = -1; const c = document.querySelector<HTMLElement>('#col'); if (c && 'ResizeObserver' in window) new ResizeObserver(() => { const wd = Math.round(c.getBoundingClientRect().width); if (wd !== lastW) { const first = lastW < 0; lastW = wd; if (!first && dressed) resize() } }).observe(c) }
async function start() {
  staticTexts()
  if (renderer) await dress(W, people, renderer).catch(() => null)
  await Promise.race([siteReady(), new Promise((r) => setTimeout(r, 1500))]) // the site pages before the first frame
  dressed = true
  const f = Q.get('focus')
  const v: View = f === 'use' || f === 'rent' || f === 'publish' || f === 'cctp' || f === 'arc' || f === 'demo' ? f : 'ensemble'
  const refus = Q.get('refus') === '1'
  if (freeze) { const len = refus ? REFUS_S : LOOP_S; clock = Q.has('t') ? Number(Q.get('t')) / 1000 : Number(Q.get('s')) * len; if (!reduced && v === 'ensemble') { orbT = clock; ccT = clock } }
  layout(); rig.apply(); titles(); cctpFrame(); computeLinks()
  resize(); go(v, { instant: true })
  await document.fonts.load('400 20px "Fragment Mono"').catch(() => null)
  await document.fonts.load('600 20px Montserrat').catch(() => null)
  if (reduced) loop.still()
  else if (freeze) { const len = refus ? REFUS_S : LOOP_S; const t = Q.has('t') ? Number(Q.get('t')) / 1000 : Number(Q.get('s')) * len; loop.seek(refus, t % len) }
  else if (refus) playRefus()
  else loop.restart(false)
  if (!renderer) { $('#nogl').hidden = false; canvas.hidden = true }
  else {
    rig.apply(); loop.apply()
    // everything compiles at load time, hidden islands included (direct focus via ?focus=)
    const vis = ORDER.map((k) => W.islands[k].group.visible); for (const k of ORDER) W.islands[k].group.visible = true
    W.usdc.mesh.count = 1 // the USDC hologram compiles with the rest
    await renderer.compileAsync(scene, rig.cam)
    W.usdc.mesh.count = 0
    void vis; for (const k of ORDER) W.islands[k].group.visible = view === 'ensemble' || k === view
    renderer.render(scene, rig.cam)
  }
  await document.fonts.ready
  dirty = true
  if (renderer) playIntro()
  stage.dataset.ready = '1'
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__frontReady = true }))
}
document.addEventListener('visibilitychange', () => { if (reduced || freeze || !loop.rtl.paused()) return; if (document.hidden) loop.tl.pause(); else loop.tl.play() })

/** The camera moves behind the shoulder of the part's actor; el: an island element to frame from that shoulder. */
export function focusCamera(part: Part, el?: string | null) { activeStep = null; go(part, { el: el ?? null }) }
/** The animation follows the process. Plays step i of the part (i = the step index in the page, 0 = connection;
 *  table and windows: STAGES in loop.ts), then stops at its end; places the camera behind the shoulder if needed. */
// the page calls playStep on every step or state change: the same step is not replayed; when the last
// step of the page is done (Rent: admission; Publish: review), the scene chains the final steps on its own
const LAST_PAGE: Record<Part, number> = { use: 5, rent: 4, publish: 4 }
const EXTRA: Record<Part, number[]> = { use: [], rent: [5, 6], publish: [5, 6] }
let lastStep = '', extraFor = ''
function stageCam(part: Part, k: number) {
  const prevCam = stageView && STAGE_CAM[stageView.part]?.[stageView.i]
  stageView = { part, i: k }
  if (prevCam !== STAGE_CAM[part]?.[k]) { stepEl = null; setPose(poseFor(part, null), freeze ? 0 : CAM_DUR) }
}
// plays a sequence of feed ranges, one after the other (the camera follows the step of the first)
function runRanges(part: Part, list: Range[], camStage?: number) {
  if (camStage !== undefined) stageCam(part, camStage)
  const r = list[0]; if (!r) return
  const tw = loop.playRange(r[0], r[1], reduced || freeze); dirty = true
  if (tw) tw.eventCallback('onComplete', () => { if (view === part) runRanges(part, list.slice(1)) })
  else runRanges(part, list.slice(1))
}
const rangesOf = (part: Part, k: number) => STAGES[part][k].map((r) => [...r] as Range)
// the page gives the actual state of the active step (todo, doing, done, fail…); on focus, the scene never shows a
// result the page does not have: until the step is done, its animation stops before the result (PEND)
export function playStep(part: Part, i: number, st?: string) {
  if (show?.on && show.part === part) return // the part's demo is playing: the page state waits for its end
  if (view !== part) go(part)
  clearTimeout(autoT); stepCalled = true
  const S = STAGES[part], k = THREE.MathUtils.clamp(Math.round(i), 0, S.length - 1)
  const done = st === 'done', realMode = st !== undefined, pend = PEND[part][k]
  loop.setReal(realMode ? { part, done: done ? k : k - 1 } : null)
  const phase = pend !== undefined && realMode && !done ? 'p' : 'd'
  const key = `${part}:${k}:${phase}`
  const chain = done && k === LAST_PAGE[part] && EXTRA[part].length > 0 && extraFor !== `${part}:${k}`
  if (key === lastStep) {
    if (chain) { extraFor = `${part}:${k}`; runRanges(part, EXTRA[part].flatMap((e) => rangesOf(part, e)), EXTRA[part][0]) }
    return
  }
  const prev = lastStep; lastStep = key
  if (chain) extraFor = `${part}:${k}`
  let list: Range[]
  if (phase === 'p') list = [[S[k][0][0], pend!]]
  else if (pend !== undefined && prev === `${part}:${k}:p`) list = [[pend, S[k][0][1]], ...S[k].slice(1)]
  else list = rangesOf(part, k)
  if (chain) list = [...list, ...EXTRA[part].flatMap((e) => rangesOf(part, e))]
  runRanges(part, list, k)
}
// ---------- The part's demo (the "Play the demo" button at the top of a focus) ----------
// A show, not the visitor's flow: no wallet, no form, no transaction. The scene plays the whole flow of the part,
// stage after stage (STAGES, as the page steps would), the camera follows each stage, and the matching step of the
// left list is marked (data-demo). Use: choice, key, sealed request and payment, answer, settlement. Rent: bond,
// boot and attestation, pairing, admission on Arc, racking. Publish: manifest, fingerprint, proposal, review
// (activation), the image sent to the machine. Reduced motion: each stage is set at once, then held 2.6 s.
// Events: 'net:show' on window, detail { part, st: 'idle' | 'on' | 'done', k }.
const SHOW_LAST: Record<Part, number> = { use: 5, rent: 5, publish: 5 }
let show: { part: Part; k: number; on: boolean } | null = null
let showCall: gsap.core.Tween | null = null, showTw: gsap.core.Animation | null = null
const showEmit = (st: 'idle' | 'on' | 'done') => dispatchEvent(new CustomEvent('net:show', { detail: { part: show?.part ?? null, st, k: show?.k ?? -1 } }))
function showMark(k: number) {
  const li = Array.from(document.querySelectorAll<HTMLElement>('.net-acts .na')), j = k < 0 ? -1 : Math.min(k, li.length - 1)
  li.forEach((e, i) => { e.dataset.demo = i === j ? '1' : '0' })
  if (j >= 0) li[j]?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
}
function showChain(list: Range[], done: () => void) {
  const r = list[0]
  if (!r) { showCall = gsap.delayedCall(0.5, done); return }
  const tw = loop.playRange(r[0], r[1], false); dirty = true
  if (tw) { showTw = tw; tw.eventCallback('onComplete', () => showChain(list.slice(1), done)) } else showChain(list.slice(1), done)
}
function showStage(part: Part, k: number) {
  if (!show?.on || show.part !== part || view !== part) return
  if (k > SHOW_LAST[part]) { show.on = false; setDemo({ part, k, end: true }); showEmit('done'); return }
  show.k = k; showMark(k); setDemo({ part, k, end: false }); showEmit('on')
  stageCam(part, k); loop.setReal(null)
  const list = rangesOf(part, k), next = () => showStage(part, k + 1)
  if (reduced || freeze) { for (const r of list) loop.playRange(r[0], r[1], true); dirty = true; showCall = gsap.delayedCall(2.6, next); return }
  showChain(list, next)
}
/** Plays the whole flow of the part in the scene (a replay, nothing signed or sent). */
export function playShow(part: Part) {
  if (view !== part) go(part)
  stopShow(false)
  clearTimeout(autoT); stepCalled = true; lastStep = ''; extraFor = ''; activeStep = null
  show = { part, k: 0, on: true }
  showStage(part, 1)
}
/** Stops the part's demo where it is; the step marks are cleared. */
export function stopShow(emit = true) {
  if (!show) return
  showCall?.kill(); showCall = null; showTw?.kill(); showTw = null
  show.on = false; showMark(-1); setDemo(null) // the steps get the visitor's own values back
  if (emit) showEmit('idle')
  show = null; lastStep = ''
}
// the visitor's own step click ends the show
document.addEventListener('click', (e) => { if (show && (e.target as HTMLElement).closest?.('.net-acts .na-h, #steps .step')) stopShow() }, true)

/** Back to the overview. */
export function overview() { activeStep = null; go('ensemble') }

window.__s3d = {
  focusCamera, overview, playStep, people, playShow, stopShow,
  showState: () => (show ? { part: show.part, on: show.on, k: show.k } : null),
  usdcPx: (px: number) => { UPX = px; render(performance.now()) },
  // probes: a free camera (target, azimuth, elevation in degrees, distance, field of view), the position of a figure
  // (0 Use, 1 Rent, 2 Publish; at chest height) and of the first USDC token in flight
  camAt: (t: [number, number, number], az: number, el: number, dist: number, fov = 40) => { camTween?.kill(); Object.assign(rig.pose, { tx: t[0], ty: t[1], tz: t[2], az, el, zoom: D0 / dist, shift: 0, lift: 0, fov }); rig.user.az = rig.user.el = 0; rig.user.zoom = 1; rig.drag.az = rig.drag.el = 0; rig.drag.zoom = 1; render(performance.now()) },
  figure: (n: number) => { const p = people.poses[n], g = people.parents[n]!; const v = new THREE.Vector3(p.x, p.pelvisY + 0.25, p.z); g.updateMatrixWorld(true); return g.localToWorld(v).toArray() },
  coin: () => { const A = W.packetAttr; for (let i = 0; i < A.pos.count; i++) if (A.size.getX(i) > 0 && Math.round(A.shape.getX(i)) === 5) return [A.pos.getX(i), A.pos.getY(i), A.pos.getZ(i)]; return null },
  stats, rig, picks, boxOf, modal: hover.api, world: W,
  info: () => renderer?.info,
  go: (v: View, el?: string) => go(v, { el: el ?? null }),
  loopAt: (s: number) => { loop.seek(false, s % LOOP_S); render(performance.now()) },
  refusAt: (s: number) => { loop.seek(true, s % REFUS_S); render(performance.now()) },
  refus: playRefus,
  demoSeek: (t: number) => demo.seek(t), demoT: () => demo.t,
  orbit: (t?: number) => { if (t !== undefined) { orbT = t; ccT = t; render(performance.now()) } return orbT },
  renderNow: () => render(performance.now()),
  // the probe for the overview frame: over n orbit times and the whole sway, the leftmost screen x reached by a
  // room (oriented box, sign included), a link point or the CCTP system, against the column's right edge
  sweep: (n = 160, span = 1400) => {
    const keep = { t: orbT, c: ccT, az: rig.user.az }, res = { col: colRight(), minX: Infinity, what: '', t: 0, d: 0, maxR: -Infinity, w: rig.w }
    const see = (q: THREE.Vector3, what: string, t: number, d: number) => {
      bv.copy(q).applyMatrix4(rig.cam.matrixWorldInverse); if (bv.z > -rig.cam.near) return
      rig.project(vp.copy(q), o2); if (o2.y < 0 || o2.y > rig.h) return
      if (o2.x < res.minX) Object.assign(res, { minX: o2.x, what, t, d }); res.maxR = Math.max(res.maxR, o2.x)
    }
    for (let i = 0; i < n; i++) {
      const t = (i / n) * span; orbT = ccT = t; layout(); titles(); cctpFrame()
      for (const d of [-SPIN, -SPIN / 2, 0, SPIN / 2, SPIN]) {
        rig.user.az = d; rig.apply(); computeLinks()
        for (const k of ORDER) { for (const q of corners(localBox(k), W.islands[k].group.matrixWorld)) see(q, k, t, d) }
        for (const k of LINKS) for (const q of linkPts[k]) see(q, 'link.' + k, t, d)
        for (const q of corners(new THREE.Box3().setFromObject(CHAINS.group))) see(q, 'cctp', t, d)
      }
    }
    orbT = keep.t; ccT = keep.c; rig.user.az = keep.az; rig.apply(); layout(); titles(); cctpFrame(); computeLinks(); render(performance.now())
    return res
  },
  play: () => loop.restart(false),
  // the probe: sign rectangles on screen, for a given azimuth offset
  titleRects: (dAz: number) => { const keep = rig.user.az; rig.user.az = dAz; rig.apply(); const r = ORDER.map((k) => ({ k, ...rig.rect(titleBox(k)) })); rig.user.az = keep; rig.apply(); const st = stage.getBoundingClientRect(); return { w: rig.w, h: rig.h, left: colFrac() * rig.w, stage: { x: st.left, y: st.top }, r } },
  // on focus, playStep drives the animation; seekPlay only applies to the overview
  seekPlay: (t: number) => { if (view !== 'ensemble') return; loop.restart(false); loop.tl.seek(t, false) },
  cam: (p: number) => { camTween?.pause(); camTween?.progress(p); render(performance.now()) },
  hover: (id: string | null) => { setHover(id, 'scene'); for (let i = 0; i < 3; i++) render(performance.now() + 1000) },
  hoverPacket: () => { const A = W.packetAttr; for (let i = 0; i < A.pos.count; i++) if (A.size.getX(i) > 0) { rig.project(vp.set(A.pos.getX(i), A.pos.getY(i), A.pos.getZ(i)), o2); mouse = { x: o2.x, y: o2.y }; render(performance.now()); return true } return false },
  screenOf: (id: string) => { rig.apply(); const r = rig.rect(boxOf(id)); return { x: r.x + r.w / 2, y: r.y + r.h / 2 } },
  state: () => ({ view, stepEl, hot, calls: stats.calls, maxCalls: stats.maxCalls, triangles: stats.triangles, programs: stats.programs, geo: hover.api.geo }),
}
void linksOn
start()
