// Arc at the centre, three floating islands at 120° (Use, Rent, Publish), each a diorama on a
// base. The official Arc logo (kit, unchanged) on a flat face turned towards the camera, with rings turning around it.
// Real metres. Budget: each island = a single vertex-coloured mesh; racks, units, blades
// and LEDs instanced; no dynamic shadows (contact shadows painted on top of the bases).
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import fontJson from './montserrat-600-caps.typeface.json'
import { makeGlow, type Glow } from './glow'
import { holoMaterial, holoEdges, HOLO_HALO, HOLO_ELEC } from './holo'

export const C = {
  canvas: 0x0b0d10, graphite: 0x353c45, graphite2: 0x272d34, steel: 0x7d8691, steelLight: 0xaab2bb, rubber: 0x121417, void: 0x050607,
  ink: 0xe9edf1, ink2: 0xc5ccd4, ink3: 0x96a0ab,
  arcNavy: 0x1b3158, arcElec: 0x4a86ff, arcCore: 0xeaf4ff, arcLight: 0x9cc0ff,
  green: 0x2be263, orange: 0xff8c1e, red: 0xff3e3b, off: 0x2a3038,
}
// One colour per part, as bright as the landing accent (almost-white core, saturated halo), distinct from Arc blue
// (#4a86ff, hue 220°) and from the LED green (#2be263, 140°), orange (#ff8c1e, 30°) and red (#ff3e3b, 0°):
//   Use     ice cyan     #5ff0ff  (hue 186°: the coldest, set apart from Arc blue by lightness and saturation)
//   Publish lilac        #c48dff  (hue 270°: opposite the green, no state colour comes close)
//   Rent    warm white   #ffe2b8  (hue 36°, very low saturation: reads as light, never as the state orange)
export const PART = {
  use: { hex: 0x5ff0ff, css: '#5ff0ff', core: '#eafdff', label: 'Use a service' },
  publish: { hex: 0xc48dff, css: '#c48dff', core: '#f6eeff', label: 'Publish a service' },
  rent: { hex: 0xffe2b8, css: '#ffe2b8', core: '#fffaf2', label: 'Rent a machine' },
} as const
export type PartK = keyof typeof PART
export type State = 'green' | 'orange' | 'red' | 'off'
export const STATE_HEX: Record<State, number> = { green: C.green, orange: C.orange, red: C.red, off: C.off }

// ---------- Rent island (local frame, +z outwards) ----------
export const RACK = { w: 0.6, d: 1.0, h: 2.0 }
export const UNIT = { w: 0.48, h: 0.12, d: 0.72, pitch: 0.135, y0: 0.16, n: 13 }
export const BAY = 7
export const bayY = (j: number) => UNIT.y0 + j * UNIT.pitch + UNIT.h / 2
// two rows in an L (RACKS): the back row, facing +z (5 racks), and
// the right row, facing -x (4 racks); rack 0 (back row) receives the blade
export const RACKS: { x: number; z: number; ry: number }[] = [
  ...Array.from({ length: 5 }, (_, i) => ({ x: 0.5 + i * 0.64, z: -1.5, ry: 0 })),
  ...Array.from({ length: 4 }, (_, j) => ({ x: 3.69, z: -0.95 + j * 0.64, ry: -Math.PI / 2 })),
]
export const NRK = RACKS.length
export const RK = { z: -1.5, x: (i: number) => 0.5 + i * 0.64 }
export const FRONT = RACK.d / 2
export const TARGET_I = 0
export const T_POS = new THREE.Vector3(RK.x(TARGET_I), 0, RK.z)
export const BELT = { z: -0.35, x0: -2.85, x1: 0.2, y: 0.78, w: 0.56 } // the belt starts at the door and stays inside the island
export const GATE = { x: -1.55, z: BELT.z }
export const WALL_X = -2.8
export const DOOR = { z0: -0.95, z1: 0.25, h: 2.2 }
export const PUSH = { x: -0.75 }
export const BIN = new THREE.Vector3(PUSH.x, 0, 0.55)
export const RENT_SIZE = { x0: -2.95, x1: 4.35, z0: -2.3, z1: 2.1 }
export const DOCK = { x: -2.775, y: 1.38, z: 0.64, w: 0.46, h: 0.29 } // the dock screen, on the wall return next to the door
export const GATE_LAMPS = [-0.32, -0.16, 0, 0.16, 0.32] // the five lamps on top of the gantry (z, around GATE.z)
// Use and Publish islands
export const DESK_H = 0.74
export const DESK = new THREE.Vector3(0, 0, -0.2)
export const DESK_SIZE = { x0: -1.6, x1: 1.6, z0: -1.3, z1: 1.3 }
// Use gains a flight lab (cage, charging pad, workbench); Publish is a dev's evening desk
export const ISIZE = { use: { x0: -1.9, x1: 3.4, z0: -1.9, z1: 1.5 }, publish: { x0: -2.0, x1: 2.0, z0: -1.7, z1: 1.5 }, rent: RENT_SIZE }
export const WALL_H = { use: 1.8, publish: 2.0, rent: 2.6 }
export const DRONE = new THREE.Vector3(2.62, 0.06, -0.8) // on the charging pad, at the centre of the cage
export const LABSCR = { x: 3.07, y: 0.74 + 0.33, z: 0.92, ry: -Math.PI / 2, w: 0.5, h: 0.3 }
export const LAMP = new THREE.Vector3(-0.42, 1.44, -0.04) // the desk lamp bulb (Publish), under the shade, above the screens
// the user's drone: a plain silhouette (body, four arms, cyan LED), its four propellers separate
export function buildDrone() {
  const bin: Bin = []
  box(bin, C.graphite, 0.22, 0.06, 0.22, 0, 0.03, 0)
  box(bin, C.steelLight, 0.12, 0.03, 0.12, 0, 0.09, 0)
  for (const a of [Math.PI / 4, 3 * Math.PI / 4]) put(bin, C.graphite, new THREE.BoxGeometry(0.46, 0.02, 0.03), 0, 0.05, 0, a)
  for (const [x, z] of [[0.16, 0.16], [-0.16, 0.16], [0.16, -0.16], [-0.16, -0.16]]) put(bin, C.steel, new THREE.CylinderGeometry(0.018, 0.018, 0.05, 8), x, 0.07, z)
  put(bin, 0x5ff0ff, new THREE.BoxGeometry(0.05, 0.02, 0.012), 0, 0.04, 0.115)
  const body = new THREE.Mesh(mergeGeometries(bin), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }))
  const rotors = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.085, 0.085, 0.004, 20), new THREE.MeshBasicMaterial({ color: 0x9aa4ae, transparent: true, opacity: 0.55, depthWrite: false }), 4)
  rotors.frustumCulled = false
  const g = new THREE.Group(); g.add(body, rotors); g.scale.setScalar(1.7)
  return { group: g, rotors }
}
// a stylised code texture (lines of varying length, indented), in lilac and light grey, looping vertically
function codeTexture() {
  const W = 768, H = 512
  const t = canvasTex(W, H, (g) => {
    g.fillStyle = '#0d1014'; g.fillRect(0, 0, W, H)
    let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
    for (let col = 0; col < 3; col++) {
      let ind = 0
      for (let y = 10; y < H - 6; y += 16) {
        if (rnd() < 0.12) { ind = Math.max(0, ind - 1); continue }
        if (rnd() < 0.25) ind = Math.min(4, ind + 1)
        let x = col * 256 + 14 + ind * 14
        const n = 1 + Math.floor(rnd() * 4)
        for (let k = 0; k < n && x < col * 256 + 240; k++) {
          const w = 12 + rnd() * 50
          g.fillStyle = rnd() < 0.35 ? '#c48dff' : rnd() < 0.5 ? '#8d97a3' : '#d7dde3'
          g.globalAlpha = 0.85; g.fillRect(x, y, Math.min(w, col * 256 + 242 - x), 6); x += w + 8
        }
      }
    }
    g.globalAlpha = 1
  })
  t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 0.6)
  return t
}

// the lab workbench screen: drone telemetry (altitude, battery, curve), in the Use cyan
function telemetryTexture() {
  return canvasTex(512, 304, (g, w, h) => {
    g.fillStyle = '#0d1014'; g.fillRect(0, 0, w, h)
    g.fillStyle = '#5ff0ff'; g.font = '600 20px Montserrat, sans-serif'; g.fillText('FLIGHT LAB', 22, 38)
    g.fillStyle = '#8d97a3'; g.font = '16px monospace'; g.fillText('ALT 1.30 m   BAT 87 %   LINK OK', 22, 70)
    g.strokeStyle = 'rgba(141,151,163,0.25)'; g.lineWidth = 1
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(22, 100 + i * 34); g.lineTo(w - 22, 100 + i * 34); g.stroke() }
    g.strokeStyle = '#5ff0ff'; g.lineWidth = 3; g.beginPath()
    for (let x = 0; x <= w - 44; x += 4) { const t = x / (w - 44), y = 260 - 140 * Math.min(1, Math.max(0, (t - 0.25) * 4)) + 6 * Math.sin(t * 40); if (x) g.lineTo(22 + x, y); else g.moveTo(22, y) }
    g.stroke()
  })
}

// The USDC symbol recreated as a hologram, in the style of the Arc logo. The paths are those of the official
// token (USDC Token.svg, viewBox 96): the circle ring, the two arcs and the $; extruded, translucent, glowing
// edge, scan lines.
const USDC_PATHS = [
  'M56.4609 13.7778V19.8291C68.5341 23.4716 77.3759 34.6928 77.3759 47.9997C77.3759 61.3066 68.5341 72.5278 56.4609 76.1703V82.2216C71.8534 78.4616 83.2509 64.5672 83.2509 47.9997C83.2509 31.4322 71.8534 17.5378 56.4609 13.7778Z',
  'M18.625 47.9997C18.625 34.6928 27.4669 23.4716 39.54 19.8291V13.7778C24.1475 17.5378 12.75 31.4322 12.75 47.9997C12.75 64.5672 24.1475 78.4616 39.54 82.2216V76.1703C27.4669 72.5572 18.625 61.3066 18.625 47.9997Z',
  'M60.6319 54.5506C60.6319 42.5362 41.8025 47.4713 41.8025 40.8325C41.8025 38.4531 43.7119 36.9256 47.3544 36.9256C51.7019 36.9256 53.2 39.0406 53.67 41.89H59.6625C59.1279 36.5426 56.0588 33.1662 50.9382 32.1604V27.4375H45.0632V31.9918C39.4534 32.7062 35.9275 35.973 35.9275 40.8325C35.9275 52.9056 54.7863 48.3819 54.7863 54.9031C54.7863 57.3706 52.4069 59.0156 48.3825 59.0156C43.1244 59.0156 41.3913 56.695 40.745 53.4931H34.8994C35.2781 59.3502 38.8897 63.0159 45.0632 63.9307V68.5625H50.9382V63.9923C56.9633 63.2139 60.6319 59.7089 60.6319 54.5506Z',
]
export const USDC_D = 0.34 // reference diameter (m); the on-screen scale is set by scene.ts
export const NUSDC = 8
function buildUsdc() {
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${USDC_PATHS.map((d) => `<path d="${d}"/>`).join('')}</svg>`)
  const shapes = data.paths.flatMap((p) => p.toShapes())
  const ring = new THREE.Shape(); ring.absarc(48, 48, 47, 0, Math.PI * 2, false)
  const hole = new THREE.Path(); hole.absarc(48, 48, 43.5, 0, Math.PI * 2, true); ring.holes.push(hole)
  const geo = new THREE.ExtrudeGeometry([...shapes, ring], { depth: 7, bevelEnabled: true, bevelThickness: 1, bevelSize: 0.6, bevelSegments: 2, curveSegments: 20 })
  geo.translate(-48, -48, -3.5); geo.scale(USDC_D / 96, -USDC_D / 96, USDC_D / 96); geo.computeVertexNormals()
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uElec: { value: new THREE.Color(0x3d8bff) }, uHalo: { value: new THREE.Color(0x2775ca) }, uCore: { value: new THREE.Color(0xeaf4ff) } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying float vY;
      void main() { mat4 m = modelMatrix * instanceMatrix; vec4 w = m * vec4(position, 1.0); vN = normalize(mat3(m) * normal); vV = normalize(cameraPosition - w.xyz); vY = position.y / ${USDC_D.toFixed(3)};
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`uniform float uT; uniform vec3 uElec; uniform vec3 uHalo; uniform vec3 uCore; varying vec3 vN; varying vec3 vV; varying float vY;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);
        float scan = 0.6 + 0.4 * smoothstep(0.35, 0.0, abs(fract(vY * 7.0 - uT * 0.5) - 0.5));
        vec3 c = mix(uHalo, uElec, 0.55) * scan + uCore * (0.25 + f * 0.6);
        float a = 0.55 + 0.4 * f;
        gl_FragColor = vec4(c * a, a);
      }`,
  })
  mat.toneMapped = false
  const mesh = new THREE.InstancedMesh(geo, mat, NUSDC); mesh.frustumCulled = false; mesh.renderOrder = 9; mesh.count = 0
  return { mesh, mat }
}

export interface Pick { id: string; box: THREE.Box3; dyn?: () => THREE.Box3; segs?: () => THREE.Vector3[] }
export const picks = new Map<string, Pick>()

// ---------- Helpers: placed geometry, vertex colours, per-island merge ----------
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1)
type Bin = THREE.BufferGeometry[]
function put(bin: Bin, hex: number, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
  const gg = g.index ? g.toNonIndexed() : g
  for (const n of Object.keys(gg.attributes)) if (n !== 'position' && n !== 'normal') gg.deleteAttribute(n)
  gg.applyMatrix4(m4.compose(v3.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s3))
  const c = new THREE.Color(hex), n = gg.getAttribute('position').count, a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b }
  gg.setAttribute('color', new THREE.BufferAttribute(a, 3))
  bin.push(gg)
}
const box = (bin: Bin, hex: number, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => put(bin, hex, new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry)
const cyl = (bin: Bin, hex: number, r: number, h: number, x: number, y: number, z: number, seg = 16) => put(bin, hex, new THREE.CylinderGeometry(r, r, h, seg), x, y + h / 2, z)
const islandMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0.3 })

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d')!, w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  return t
}
// top of the base: 60 cm tiles and painted contact shadows (no live shadows)
function topTexture(sz: { x0: number; x1: number; z0: number; z1: number }, shadows: { x: number; z: number; w: number; d: number; k?: number }[], extra?: (g: CanvasRenderingContext2D, X: (x: number) => number, Z: (z: number) => number) => void) {
  const P = 110, W = Math.round((sz.x1 - sz.x0) * P), H = Math.round((sz.z1 - sz.z0) * P)
  const X = (x: number) => (x - sz.x0) * P, Z = (z: number) => (z - sz.z0) * P
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#2a3038'; g.fillRect(0, 0, W, H)
    g.strokeStyle = 'rgba(200,214,230,0.08)'; g.lineWidth = 1.5
    for (let x = Math.ceil(sz.x0 / 0.6) * 0.6; x < sz.x1; x += 0.6) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), H); g.stroke() }
    for (let z = Math.ceil(sz.z0 / 0.6) * 0.6; z < sz.z1; z += 0.6) { g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(W, Z(z)); g.stroke() }
    extra?.(g, X, Z)
    for (const pass of [{ blur: 24, a: 0.5, grow: 0.2 }, { blur: 6, a: 0.45, grow: 0.03 }]) {
      g.save(); g.filter = `blur(${pass.blur}px)`
      for (const s of shadows) { g.fillStyle = `rgba(0,0,0,${pass.a * (s.k ?? 1)})`; g.fillRect(X(s.x - s.w / 2 - pass.grow), Z(s.z - s.d / 2 - pass.grow), (s.w + 2 * pass.grow) * P, (s.d + 2 * pass.grow) * P) }
      g.restore()
    }
    // a light strip on the edge of the deck
    g.strokeStyle = 'rgba(233,237,241,0.22)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, W - 3, H - 3)
  })
}
// the base: a thick floating deck, its top painted, a steel edge
function plinth(bin: Bin, group: THREE.Group, sz: { x0: number; x1: number; z0: number; z1: number }, shadows: { x: number; z: number; w: number; d: number; k?: number }[], extra?: Parameters<typeof topTexture>[2]) {
  const w = sz.x1 - sz.x0, d = sz.z1 - sz.z0, cx = (sz.x0 + sz.x1) / 2, cz = (sz.z0 + sz.z1) / 2
  box(bin, C.graphite2, w, 0.34, d, cx, -0.355, cz)
  box(bin, C.steel, w + 0.02, 0.025, d + 0.02, cx, -0.02, cz)
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: topTexture(sz, shadows, extra), roughness: 0.62, metalness: 0.15 }))
  top.position.set(cx, 0.008, cz); top.name = 'top'; group.add(top)
  ;(group.userData.mats ??= []).push(top.material)
}
// a workstation: desk, chair, keyboard; screens placed separately
function desk(bin: Bin, o: THREE.Vector3, counter: boolean) {
  const W = 1.5, D = 0.75
  box(bin, C.graphite, W, 0.04, D, o.x, DESK_H - 0.04, o.z)
  for (const sx of [-1, 1]) box(bin, C.graphite, 0.04, DESK_H - 0.04, D - 0.06, o.x + sx * (W / 2 - 0.03), 0, o.z)
  if (counter) { box(bin, C.graphite2, W, 1.05, 0.04, o.x, 0, o.z - D / 2 - 0.02); box(bin, C.steel, W + 0.04, 0.03, 0.08, o.x, 1.05, o.z - D / 2 - 0.02) }
  else box(bin, C.graphite2, W - 0.1, 0.4, 0.02, o.x, 0.3, o.z - D / 2 + 0.05)
  const cx = o.x, cz = o.z + 0.62
  box(bin, C.graphite2, 0.48, 0.07, 0.46, cx, 0.42, cz); box(bin, C.graphite2, 0.46, 0.5, 0.06, cx, 0.52, cz + 0.24)
  cyl(bin, C.steel, 0.025, 0.36, cx, 0.06, cz, 8); box(bin, C.steel, 0.5, 0.03, 0.05, cx, 0.03, cz); box(bin, C.steel, 0.05, 0.03, 0.5, cx, 0.03, cz)
  box(bin, C.graphite2, 0.44, 0.015, 0.14, o.x, DESK_H, o.z + 0.12)
}
const scrMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
function monitor(bin: Bin, group: THREE.Group, x: number, z: number, ry: number) {
  box(bin, C.graphite, 0.2, 0.012, 0.16, x, DESK_H, z); box(bin, C.graphite, 0.04, 0.2, 0.03, x, DESK_H, z - 0.02)
  box(bin, C.graphite, 0.58, 0.36, 0.03, x, DESK_H + 0.17, z - 0.02, ry)
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.32), scrMat())
  m.position.set(x + Math.sin(ry) * 0.017, DESK_H + 0.35, z - 0.02 + Math.cos(ry) * 0.017); m.rotation.y = ry
  group.add(m); return m
}
// each island has its own material: the loop can dim it when it is not involved
function finish(bin: Bin, group: THREE.Group) {
  const mat = islandMat.clone()
  const mesh = new THREE.Mesh(mergeGeometries(bin), mat); mesh.name = 'static'
  group.add(mesh); (group.userData.mats ??= []).push(mat)
}

// ---------- Arc: a holographic 3D rendering of the logo, at the centre ----
// The paths are those of the official SVG (Arc_Icon_White.svg), extruded as is,
// without reinterpreting the shape. Translucent Arc blue, scan lines, brighter edge, slow rotation.
const ARC_ICON = 'M0 171C1.39327 129.136 8.52567 90.067 20.4481 59.6871C35.5477 21.1972 57.4057 0 81.9919 0C106.578 0 128.433 21.1972 143.536 59.6871C151.391 79.7058 157.17 103.491 160.594 129.366C160.9 131.677 161.161 134.026 161.428 136.369C161.515 136.514 161.568 136.649 161.55 136.758C161.55 136.758 163.562 149.265 163.99 171H163.763C160.778 168.562 125.578 141.038 67.2282 149.007C68.1086 139.181 69.3194 129.62 70.8835 120.456C70.9634 119.987 71.0558 119.535 71.1373 119.07C94.0233 118.383 114.055 121.028 129.416 124.494C129.359 124.131 129.311 123.758 129.253 123.397C126.095 103.83 121.437 85.9161 115.43 70.6073C105.61 45.576 92.7953 30.0239 81.9919 30.0239C71.189 30.0239 58.3744 45.576 48.554 70.6073C46.1769 76.6621 44.0128 83.1192 42.0721 89.9301C39.3438 99.4735 37.0517 109.704 35.2212 120.455C32.5117 136.331 30.8189 153.358 30.1954 171H0Z'
// The A is larger than the rooms (5.5 m tall; the tallest room is 2.6 m with its wall),
// at the exact centre of the composition (the rooms orbit around it, the overview camera aims at its centre)
export const ARC_K = 0.032 // metres per SVG unit
export const ARC_H = 171 * ARC_K
export const ARC_Y = 3.1
export interface ArcNode { group: THREE.Group; holo: THREE.Group; mat: THREE.ShaderMaterial; edgeMat: THREE.LineBasicMaterial; glowMat: THREE.ShaderMaterial; glow: THREE.Mesh }
function buildArc(): ArcNode {
  const group = new THREE.Group()
  const holo = new THREE.Group(); holo.position.y = ARC_Y; group.add(holo)
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164 171"><path d="${ARC_ICON}"/></svg>`)
  const shapes = data.paths.flatMap((p) => p.toShapes())
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: 26, bevelEnabled: true, bevelThickness: 2, bevelSize: 1.2, bevelSegments: 2, curveSegments: 24 })
  geo.translate(-82, -85.5, -13); geo.scale(ARC_K, -ARC_K, ARC_K) // the SVG has its y axis pointing down
  geo.computeVertexNormals()
  // the shared hologram recipe (holo.ts): the sweep runs over the A's height
  const mat = holoMaterial(`(vW.y - ${ARC_Y.toFixed(2)}) / ${(ARC_H / 2).toFixed(2)}`)
  holo.add(new THREE.Mesh(geo, mat))
  // volume edges, thin, in light Arc blue
  const { lines, mat: edgeMat } = holoEdges(geo)
  holo.add(lines)
  // a soft glow behind, always facing the camera (halo #3a6bff)
  const glowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uHl: { value: 1 }, uHalo: { value: new THREE.Color(0x3a6bff) } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uHl; uniform vec3 uHalo; varying vec2 vUv;
      void main() { float r = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - r), 2.2) * 0.32 * mix(0.5, 1.0, uHl); gl_FragColor = vec4(uHalo * a, a); }`,
  })
  glowMat.toneMapped = false
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(ARC_H * 2.4, ARC_H * 2.4), glowMat); glow.position.y = ARC_Y; glow.renderOrder = -1; group.add(glow)
  return { group, holo, mat, edgeMat, glowMat, glow }
}

// ---------- 3D titles above the islands: extruded Montserrat 600, uppercase, Arc hologram ----------
// converted typeface (correct counters), large titles
export const TITLE_SIZE = 0.98
export interface Title { k: PartK; mesh: THREE.Mesh; mat: THREE.ShaderMaterial; w: number; glow: Glow; edgeMat: THREE.LineBasicMaterial }
// a sign is also built for the CCTP system (scene.ts), hence the exported factory
let FONT: ReturnType<FontLoader['parse']> | null = null
// every sign is the A's hologram (holo.ts, same shader, same edges, same glow colour): translucent Arc-blue
// volume, bright grazing edges, scan lines, the white sweep running up the letters, thin light-blue volume edges,
// and a soft glow behind shaped on the letters (glow.ts halo; the landing sparks are not used: the A has none)
export function makeTitle(label: string, hex: number = HOLO_ELEC, coreCss = '#eaf4ff'): Omit<Title, 'k'> {
  const font = FONT ??= new FontLoader().parse(fontJson as unknown as Parameters<FontLoader['parse']>[0])
  const g = new TextGeometry(label, { font, size: TITLE_SIZE, depth: 0.16, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.012, bevelSegments: 2 })
  g.computeBoundingBox(); const bb = g.boundingBox!
  const dx = -(bb.max.x + bb.min.x) / 2
  g.translate(dx, 0, -0.06)
  const glow = makeGlow(font.generateShapes(label, TITLE_SIZE), dx, TITLE_SIZE, new THREE.Color(HOLO_HALO), new THREE.Color(coreCss))
  // the sweep runs over the letter height (object space: it follows the sign, whatever its scale or place)
  const mat = holoMaterial(`vL.y / ${(TITLE_SIZE / 2).toFixed(3)} - 1.0`, TITLE_FILL, hex, new THREE.Color(coreCss).getHex())
  const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 5
  const { lines, mat: edgeMat } = holoEdges(g, TITLE_EDGE); lines.renderOrder = 5
  mesh.add(glow.halo, lines)
  return { mesh, mat, w: bb.max.x - bb.min.x, glow, edgeMat }
}
// the letters are thin next to the A: a slightly fuller resting body and edges keep them readable from the overview
const TITLE_FILL = 1.4, TITLE_EDGE = 0.6
function buildTitles(): Record<PartK, Title> {
  const out = {} as Record<PartK, Title>
  // every room sign in the Arc hologram blue (the logo's uElec body, uCore filament), no room colour
  for (const k of ['use', 'rent', 'publish'] as PartK[]) out[k] = { k, ...makeTitle(PART[k].label.toUpperCase(), C.arcElec, `#${C.arcCore.toString(16).padStart(6, '0')}`) }
  return out
}

// ---------- The islands ----------
export interface Island { k: PartK; group: THREE.Group; anchor: THREE.Vector3; size: { x0: number; x1: number; z0: number; z1: number }; beam: THREE.Vector3 }
export interface RentParts {
  belt: THREE.Mesh; beltTex: THREE.Texture; units: THREE.InstancedMesh; blades: THREE.InstancedMesh; diodes: THREE.InstancedMesh; doors: THREE.InstancedMesh
  press: THREE.Mesh; pusher: THREE.Mesh; scan: THREE.Mesh; decal: THREE.Mesh; gateBars: THREE.InstancedMesh; MOVING: number; states: State[]; dock: THREE.Mesh
}
function unitFace() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#373d46'; g.fillRect(0, 0, w, h)
    g.fillStyle = '#414852'; g.fillRect(0, 0, w, 4); g.fillStyle = '#23272d'; g.fillRect(0, h - 4, w, 4)
    for (let i = 0; i < 8; i++) { g.fillStyle = '#16191d'; g.fillRect(12 + i * 19, 12, 15, 40); g.fillStyle = '#3e454e'; g.fillRect(14 + i * 19, 15, 11, 3) }
    g.fillStyle = '#1a1d22'; for (let y = 14; y < 52; y += 6) for (let x = 172; x < 232; x += 6) g.fillRect(x, y, 3, 3)
  })
}
function bladeFace() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#5d6670'; g.fillRect(0, 0, w, h)
    g.fillStyle = '#6c7580'; g.fillRect(0, 0, w, 5); g.fillStyle = '#434a53'; g.fillRect(0, h - 5, w, 5)
    g.fillStyle = '#30353c'; for (let y = 16; y < 50; y += 6) for (let x = 14; x < 120; x += 6) g.fillRect(x, y, 3, 3)
    g.fillStyle = '#0e1013'; g.fillRect(186, 26, 44, 12)
  })
}
function buildRent(states: State[]): { island: Island; parts: RentParts } {
  const group = new THREE.Group(), bin: Bin = []
  const shadows: { x: number; z: number; w: number; d: number; k?: number }[] = []
  // dock wall, with the door the blades come through; the verification screens are mounted on it
  const WT = 0.14, wx = WALL_X - WT / 2, sz = RENT_SIZE
  box(bin, C.graphite, WT, 2.6, DOOR.z0 - sz.z0, wx, 0, (sz.z0 + DOOR.z0) / 2)
  box(bin, C.graphite, WT, 2.6, sz.z1 - DOOR.z1, wx, 0, (DOOR.z1 + sz.z1) / 2)
  box(bin, C.graphite, WT, 2.6 - DOOR.h, DOOR.z1 - DOOR.z0, wx, DOOR.h, (DOOR.z0 + DOOR.z1) / 2)
  box(bin, C.void, 0.02, DOOR.h, DOOR.z1 - DOOR.z0, WALL_X - WT - 0.01, 0, (DOOR.z0 + DOOR.z1) / 2)
  box(bin, C.steel, WT + 0.02, 0.03, sz.z1 - sz.z0, wx, 2.6, (sz.z0 + sz.z1) / 2)
  for (const z of [DOOR.z0 - 0.04, DOOR.z1 + 0.04]) box(bin, C.steel, WT + 0.04, DOOR.h, 0.08, wx, 0, z)
  // belt: thin, it comes out of the dock door and stops inside the island
  const BL = BELT.x1 - BELT.x0, bx = (BELT.x0 + BELT.x1) / 2
  for (const sz2 of [-1, 1]) box(bin, C.steel, BL, 0.05, 0.025, bx, BELT.y - 0.06, BELT.z + sz2 * (BELT.w / 2 + 0.012))
  for (let x = BELT.x0 + 0.5; x < BELT.x1; x += 0.9) for (const sz2 of [-1, 1]) box(bin, C.steel, 0.03, BELT.y - 0.06, 0.03, x, 0, BELT.z + sz2 * (BELT.w / 2 - 0.02))
  box(bin, C.graphite2, BL, 0.04, BELT.w, bx, BELT.y - 0.08, BELT.z)
  box(bin, C.steel, 0.03, 0.08, BELT.w + 0.05, BELT.x1 + 0.015, BELT.y - 0.04, BELT.z)
  shadows.push({ x: bx, z: BELT.z, w: BL, d: BELT.w + 0.1, k: 0.6 })
  const beltTex = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#16181b'; g.fillRect(0, 0, w, h); g.fillStyle = '#22262b'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 6, h) })
  beltTex.wrapS = beltTex.wrapT = THREE.RepeatWrapping; beltTex.repeat.set(BL / 0.5, 1)
  const belt = new THREE.Mesh(new THREE.PlaneGeometry(BL, BELT.w - 0.02).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.85 }))
  belt.position.set(bx, BELT.y - 0.042, BELT.z); belt.name = 'belt'; group.add(belt)
  // gantry: a thin steel frame, a crossbar, the press
  for (const s2 of [-1, 1]) box(bin, C.steel, 0.07, 1.9, 0.07, GATE.x, 0, GATE.z + s2 * 0.4)
  box(bin, C.steel, 0.1, 0.09, 0.9, GATE.x, 1.9, GATE.z)
  box(bin, C.graphite, 0.12, 0.04, 0.72, GATE.x, 1.3, GATE.z)
  cyl(bin, C.steel, 0.018, 0.56, GATE.x, 1.34, GATE.z, 10)
  shadows.push({ x: GATE.x, z: GATE.z, w: 0.2, d: 0.9, k: 0.6 })
  const press = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 20), new THREE.MeshStandardMaterial({ color: C.steelLight, roughness: 0.35, metalness: 0.55 }))
  press.position.set(GATE.x, 1.26, GATE.z); group.add(press)
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshBasicMaterial({ color: PART.rent.hex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending }))
  scan.rotation.set(-Math.PI / 2, 0, Math.PI / 2); group.add(scan)
  // five lamps on top of the crossbar, one per check; they light up one by one in Arc blue
  // (their housings are in the baked decor); name kept for the loop
  const gateBars = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 5)
  for (let i = 0; i < 5; i++) { gateBars.setMatrixAt(i, m4.makeTranslation(GATE.x, 1.966, GATE.z + GATE_LAMPS[i])); gateBars.setColorAt(i, new THREE.Color(C.off)) }
  gateBars.instanceMatrix.needsUpdate = true; gateBars.frustumCulled = false; group.add(gateBars)
  // the dock screen, on the wall next to the door (the agent, the pairing code); facing inwards
  const dock = new THREE.Mesh(new THREE.PlaneGeometry(DOCK.w, DOCK.h), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }))
  dock.position.set(DOCK.x, DOCK.y, DOCK.z); dock.rotation.y = Math.PI / 2; group.add(dock)
  // reject pusher and bin
  box(bin, C.steel, 0.06, BELT.y + 0.06, 0.06, PUSH.x, 0, BELT.z - 0.5)
  const pusher = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.03), press.material)
  pusher.position.set(PUSH.x, BELT.y + 0.04, BELT.z - 0.34); group.add(pusher)
  box(bin, C.graphite, 0.8, 0.06, 0.7, BIN.x, 0, BIN.z)
  for (const [w, d, x, z] of [[0.8, 0.04, 0, -0.33], [0.8, 0.04, 0, 0.33], [0.04, 0.7, -0.38, 0], [0.04, 0.7, 0.38, 0]] as const) box(bin, C.graphite, w, 0.5, d, BIN.x + x, 0.06, BIN.z + z)
  shadows.push({ x: BIN.x, z: BIN.z, w: 0.8, d: 0.7 })
  // racks
  const NR = NRK
  const rackG = (() => {
    const parts: THREE.BufferGeometry[] = []
    const P = (g: THREE.BufferGeometry, x: number, y: number, z: number) => { g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g) }
    const t = 0.04, W = RACK.w, D = RACK.d, H = RACK.h
    P(new THREE.BoxGeometry(t, H, D), -W / 2 + t / 2, H / 2, 0); P(new THREE.BoxGeometry(t, H, D), W / 2 - t / 2, H / 2, 0)
    P(new THREE.BoxGeometry(W, t, D), 0, H - t / 2, 0); P(new THREE.BoxGeometry(W, 0.1, D), 0, 0.05, 0)
    P(new THREE.BoxGeometry(W - 2 * t, H - 0.14, 0.02), 0, H / 2 + 0.02, -D / 2 + 0.03)
    return mergeGeometries(parts)
  })()
  const racks = new THREE.InstancedMesh(rackG, new THREE.MeshStandardMaterial({ color: C.graphite, roughness: 0.72, metalness: 0.25 }), NR)
  const doorG = new THREE.PlaneGeometry(RACK.w - 0.04, RACK.h - 0.06).translate((RACK.w - 0.04) / 2, RACK.h / 2, 0)
  const doors = new THREE.InstancedMesh(doorG, new THREE.MeshStandardMaterial({ color: 0x0c1015, roughness: 0.06, metalness: 0.5, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }), NR)
  doors.renderOrder = 2
  const unitG = new THREE.BoxGeometry(UNIT.w, UNIT.h, UNIT.d)
  { const uv = unitG.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) if (i < 16 || i >= 20) uv.setXY(i, 0.5, 0.97) }
  const units = new THREE.InstancedMesh(unitG, new THREE.MeshStandardMaterial({ map: unitFace(), roughness: 0.6, metalness: 0.35 }), NR * (UNIT.n - 1))
  const MOVING = NR
  const blades = new THREE.InstancedMesh(unitG.clone(), new THREE.MeshStandardMaterial({ map: bladeFace(), roughness: 0.45, metalness: 0.55 }), NR + 1)
  const diodes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), NR * 2 + 1)
  let u = 0
  const col = new THREE.Color(), RM_ = new THREE.Matrix4(), L_ = new THREE.Matrix4()
  // each rack: its frame (position, row rotation); units, blades, doors and LEDs are placed in it
  const at = (r: typeof RACKS[number], x: number, y: number, z: number, sx = 1) => m4.copy(RM_.compose(v3.set(r.x, 0, r.z), q.setFromEuler(e.set(0, r.ry, 0)), s3)).multiply(L_.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, 1, 1)))
  for (let i = 0; i < NR; i++) {
    const r = RACKS[i], st = states[i] ?? 'green'
    racks.setMatrixAt(i, at(r, 0, 0, 0))
    doors.setMatrixAt(i, at(r, -RACK.w / 2 + 0.02, 0, FRONT + 0.005))
    for (let j = 0; j < UNIT.n; j++) if (j !== BAY) units.setMatrixAt(u++, at(r, 0, bayY(j), FRONT - 0.06 - UNIT.d / 2))
    blades.setMatrixAt(i, st === 'off' ? m4.makeScale(0, 0, 0) : at(r, 0, bayY(BAY), FRONT - 0.06 - UNIT.d / 2))
    diodes.setMatrixAt(i, at(r, 0.13, bayY(BAY), FRONT - 0.06 + 0.002))
    diodes.setMatrixAt(NR + i, at(r, 0, RACK.h + 0.005, FRONT - 0.08, 3))
    diodes.setColorAt(i, col.setHex(STATE_HEX[st])); diodes.setColorAt(NR + i, col.setHex(STATE_HEX[st]))
    if (i < 5) shadows.push({ x: r.x, z: r.z, w: RACK.w, d: RACK.d, k: 1.1 })
  }
  diodes.setMatrixAt(NR * 2, m4.makeScale(0, 0, 0)); diodes.setColorAt(NR * 2, col.setHex(C.off))
  blades.setMatrixAt(MOVING, m4.makeScale(0, 0, 0))
  racks.name = 'racks'
  for (const im of [racks, doors, units, blades, diodes]) { im.instanceMatrix.needsUpdate = true; im.frustumCulled = false }
  group.add(racks, units, blades, diodes, doors)
  // cable tray above the row
  box(bin, C.steel, RK.x(4) - RK.x(0) + 0.8, 0.05, 0.3, (RK.x(0) + RK.x(4)) / 2, RACK.h + 0.16, RK.z - 0.2)
  // the stamp: the official Arc logo, unchanged, as a flat decal on a dark label (contrast and clear
  // space), placed on top of the blade by the press
  const decalTex = new THREE.Texture(); decalTex.colorSpace = THREE.SRGBColorSpace; decalTex.anisotropy = 8
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, toneMapped: false }))
  decal.scale.setScalar(1e-3); group.add(decal)
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256
    const g = c.getContext('2d')!; g.fillStyle = '#0b0d10'; g.fillRect(0, 0, 512, 256)
    const w = 340, h = w * 171 / 500; g.drawImage(img, (512 - w) / 2, (256 - h) / 2, w, h)
    decalTex.image = c; decalTex.needsUpdate = true
  }
  img.src = './arc-logo-white.svg'
  plinth(bin, group, sz, shadows, (g, X, Z) => {
    g.strokeStyle = 'rgba(197,204,212,0.3)'; g.lineWidth = 3; g.setLineDash([14, 10])
    g.strokeRect(X(BELT.x0 + 0.2), Z(BELT.z - 0.6), (BELT.x1 - BELT.x0) * 110, 1.2 * 110); g.setLineDash([])
  })
  finish(bin, group)
  const island: Island = { k: 'rent', group, anchor: new THREE.Vector3(GATE.x, 2.5, GATE.z), size: sz, beam: new THREE.Vector3(2.55, 0, 1.55) }
  return { island, parts: { belt, beltTex, units, blades, diodes, doors, press, pusher, scan, decal, gateBars, MOVING, states, dock } }
}
function buildDesk(k: 'use' | 'publish'): { island: Island; screens: THREE.Mesh[] } {
  const group = new THREE.Group(), bin: Bin = []
  desk(bin, DESK, k === 'use')
  const screens: THREE.Mesh[] = []
  if (k === 'use') {
    for (const sx of [-1, 1]) screens.push(monitor(bin, group, DESK.x + sx * 0.33, DESK.z - 0.18, -sx * 0.18))
    // the drone charging pad, at the centre of the lab cage; the workbench telemetry screen
    cyl(bin, C.graphite, 0.36, 0.05, DRONE.x, 0, DRONE.z, 32)
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(LABSCR.w, LABSCR.h), new THREE.MeshBasicMaterial({ map: telemetryTexture(), toneMapped: false }))
    lab.position.set(LABSCR.x - 0.017, LABSCR.y, LABSCR.z); lab.rotation.y = LABSCR.ry; group.add(lab); screens.push(lab)
  } else {
    // the coder, three screens in an arc in front of him; a single code texture, scrolled by UV (one draw call)
    const arcs = [[-0.62, 0.42], [0, 0], [0.62, -0.42]] as const
    const geos: THREE.BufferGeometry[] = []
    arcs.forEach(([dx, ry], i) => {
      const x = DESK.x + dx * 0.95, z = DESK.z - 0.12 + Math.abs(dx) * 0.22
      box(bin, C.graphite, 0.2, 0.012, 0.16, x, DESK_H, z); box(bin, C.graphite, 0.04, 0.26, 0.03, x, DESK_H, z - 0.02)
      box(bin, C.graphite, 0.62, 0.4, 0.03, x, DESK_H + 0.22, z - 0.02, ry)
      const g = new THREE.PlaneGeometry(0.58, 0.36)
      const uv = g.getAttribute('uv') as THREE.BufferAttribute
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 3)
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x + Math.sin(ry) * 0.017, DESK_H + 0.42, z - 0.02 + Math.cos(ry) * 0.017), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1)))
      geos.push(g)
    })
    const code = codeTexture()
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ map: code, toneMapped: false }))
    m.userData.code = code; group.add(m); screens.push(m)
    // Publish moments, on the centre and right screens (a single pass, two halves of one canvas),
    // placed just in front of the code; and the fingerprint card that rises to the anchor (hidden outside its moment)
    const og: THREE.BufferGeometry[] = []
    arcs.forEach(([dx, ry], i) => {
      if (i === 0) return
      const x = DESK.x + dx * 0.95, z = DESK.z - 0.12 + Math.abs(dx) * 0.22
      const g = new THREE.PlaneGeometry(0.58, 0.36), uv = g.getAttribute('uv') as THREE.BufferAttribute
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i - 1 + uv.getX(k)) / 2)
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x + Math.sin(ry) * 0.02, DESK_H + 0.42, z - 0.02 + Math.cos(ry) * 0.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1)))
      og.push(g)
    })
    const over = new THREE.Mesh(mergeGeometries(og), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })); over.visible = false
    group.add(over); screens.push(over)
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }))
    card.visible = false; card.renderOrder = 6; group.add(card); screens.push(card)
    box(bin, C.graphite, 0.9, 1.1, 0.4, -1.0, 0, -0.85) // a low shelf
  }
  const shadows = [{ x: DESK.x, z: DESK.z, w: 1.5, d: 0.75, k: 0.8 }, { x: DESK.x, z: DESK.z + 0.62, w: 0.5, d: 0.5, k: 0.6 }, k === 'use' ? { x: DRONE.x, z: DRONE.z, w: 0.5, d: 0.5 } : { x: -1.0, z: -0.85, w: 0.9, d: 0.4 }]
  plinth(bin, group, ISIZE[k], shadows)
  finish(bin, group)
  return { island: { k, group, anchor: new THREE.Vector3(DESK.x, 1.4, DESK.z - 0.3), size: ISIZE[k], beam: new THREE.Vector3(k === 'use' ? -1.35 : 1.35, 0, -1.05) }, screens }
}

// ---------- Links: one line per exchange, in the part colour; recomputed when the islands move ----------
// 'cctp', the Use-specific link: from other chains, through Arc, to Use (its USDC brought back by CCTP)
export const LINKS = ['useArc', 'useRent', 'publishArc', 'rentArc', 'publishRent', 'cctp'] as const
export type Link = typeof LINKS[number]
export const LINK_PART: Record<Link, PartK> = { useArc: 'use', useRent: 'use', publishArc: 'publish', rentArc: 'rent', publishRent: 'publish', cctp: 'use' }
export const NSEG = 80

export interface World {
  root: THREE.Group; arc: ArcNode; islands: Record<PartK, Island>; rent: RentParts; deskScreens: Record<'use' | 'publish', THREE.Mesh[]>; drone: ReturnType<typeof buildDrone>
  links: THREE.LineSegments; linkPos: THREE.BufferAttribute; packets: THREE.Points; packetAttr: { pos: THREE.BufferAttribute; shape: THREE.BufferAttribute; size: THREE.BufferAttribute; col: THREE.BufferAttribute }
  titles: Record<PartK, Title>; usdc: ReturnType<typeof buildUsdc>
}
export function build(states: State[]): World {
  const root = new THREE.Group()
  const arc = buildArc(); root.add(arc.group)
  const r = buildRent(states), u = buildDesk('use'), p = buildDesk('publish')
  const drone = buildDrone(); u.island.group.add(drone.group); drone.group.position.copy(DRONE)
  root.add(r.island.group, u.island.group, p.island.group)
  const titles = buildTitles(); for (const t of Object.values(titles)) root.add(t.mesh)
  // links (positions recomputed on every frame where the islands move)
  const n = LINKS.length * NSEG * 2
  const linkPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3); linkPos.setUsage(THREE.DynamicDrawUsage)
  const lcol = new Float32Array(n * 3)
  LINKS.forEach((k, li) => { const c = new THREE.Color(PART[LINK_PART[k]].hex); for (let i = 0; i < NSEG * 2; i++) { const o = (li * NSEG * 2 + i) * 3; lcol[o] = c.r; lcol[o + 1] = c.g; lcol[o + 2] = c.b } })
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', linkPos); lg.setAttribute('color', new THREE.BufferAttribute(lcol, 3))
  const links = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }))
  links.frustumCulled = false; links.renderOrder = 4; root.add(links)
  // packets (shape = the exchange, colour = the part)
  const NP = 24
  const pPos = new THREE.BufferAttribute(new Float32Array(NP * 3), 3), pShape = new THREE.BufferAttribute(new Float32Array(NP), 1), pSize = new THREE.BufferAttribute(new Float32Array(NP), 1), pCol = new THREE.BufferAttribute(new Float32Array(NP * 3), 3)
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', pPos); pg.setAttribute('aShape', pShape); pg.setAttribute('aSize', pSize); pg.setAttribute('aCol', pCol)
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uDpr: { value: 1 }, uRed: { value: new THREE.Color(C.red) }, uBg: { value: new THREE.Color(0x0e1116) } },
    vertexShader: /* glsl */`attribute float aShape; attribute float aSize; attribute vec3 aCol; uniform float uDpr; varying float vS; varying vec3 vCol;
      void main() { vS = aShape; vCol = aCol; gl_PointSize = aSize * uDpr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform vec3 uRed; uniform vec3 uBg; varying float vS; varying vec3 vCol;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0; int s = int(vS + 0.5);
        float sq = max(abs(p.x), abs(p.y)), di = abs(p.x) + abs(p.y), r = length(p);
        vec3 core = mix(vCol, vec3(1.0), 0.7);
        vec4 c = vec4(0.0);
        if (s == 0) { if (sq < 0.92) c = vec4(sq > 0.62 ? vCol : uBg, 1.0); }            // sealed request: closed square
        else if (s == 1) { if (r < 0.95) c = vec4(r < 0.4 ? vCol : core, 1.0); }         // signed response: solid disc, seal
        else if (s == 2) { if (di < 0.95) c = vec4(di > 0.62 ? vCol : uBg, 1.0); }       // fingerprint, quote, key: outlined diamond
        else if (s == 3) { if (di < 0.95) c = vec4(di > 0.66 ? core : vCol, 1.0); }      // accepted verdict: solid diamond
        else if (s == 4) { if (di < 0.95) c = vec4(uRed, 1.0); }                          // rejected verdict: red diamond
        else if (s == 5) { discard; }                                                    // USDC: the hologram (usdc), the point stays for hover
        if (c.a < 0.5) discard;
        gl_FragColor = c;
      }`,
  })
  pMat.toneMapped = false
  const packets = new THREE.Points(pg, pMat); packets.frustumCulled = false; packets.renderOrder = 8; root.add(packets)
  const usdc = buildUsdc(); root.add(usdc.mesh)
  return {
    root, arc, islands: { rent: r.island, use: u.island, publish: p.island }, rent: r.parts, deskScreens: { use: u.screens, publish: p.screens }, drone,
    links, linkPos, packets, packetAttr: { pos: pPos, shape: pShape, size: pSize, col: pCol }, titles, usdc,
  }
}
