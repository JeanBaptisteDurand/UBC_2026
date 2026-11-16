// Shader chunks shared by the whole room:
// - sun mask: the ceiling openings projected along the sun direction, exact and without a shadow map, with a penumbra
//   that widens with distance;
// - rack shadows (analytic boxes): the sun blade passes through the gaps between racks;
// - clouds: a scrolling noise texture on the ceiling modulates the sun;
// - height fog (denser near the floor).
import * as THREE from 'three'
import { G } from '../data/wall'

export const SUN_TO = new THREE.Vector3(-0.42, 0.78, 0.46).normalize()
export const SUN_COL = new THREE.Color(1.0, 0.655, 0.35)
export const CEIL = 4.6

/** Tileable noise: 2D (clouds, wind, text overlay) and 3D (air density), built once at load time */
function hash(i: number) { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296 }
function noise2(N: number, octs: number[]) {
  const out = new Uint8Array(N * N * 4)
  const t = new THREE.DataTexture(out, N, N, THREE.RGBAFormat)
  const fill = () => {
  const lat = (p: number, s: number) => (k: number) => hash(k * 7919 + s * 104729 + p)
  const layer = (x: number, y: number, P: number, s: number) => {
    const g = lat(P, s)
    const fx = (x / N) * P, fy = (y / N) * P
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy
    const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty)
    const at = (a: number, b: number) => g(((a % P) + P) % P + (((b % P) + P) % P) * P)
    return (at(ix, iy) * (1 - u) + at(ix + 1, iy) * u) * (1 - v) + (at(ix, iy + 1) * (1 - u) + at(ix + 1, iy + 1) * u) * v
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    for (let c = 0; c < 4; c++) {
      let a = 0, w = 0, amp = 1
      for (const P of octs) { a += layer(x, y, P * (c === 1 ? 2 : 1), c * 31 + P) * amp; w += amp; amp *= 0.5 }
      out[(y * N + x) * 4 + c] = Math.round((a / w) * 255)
    }
  }
  t.needsUpdate = true
  }
  ;(t as unknown as { fill: () => void }).fill = fill
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  return t
}
function noise3(N: number) {
  const out = new Uint8Array(N * N * N)
  const t = new THREE.Data3DTexture(out, N, N, N)
  const P = [4, 8, 16]
  const v = (P_: number, x: number, y: number, z: number) => {
    const fx = (x / N) * P_, fy = (y / N) * P_, fz = (z / N) * P_
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz)
    const tx = fx - ix, ty = fy - iy, tz = fz - iz
    const s = (q: number) => q * q * (3 - 2 * q)
    const u = s(tx), w = s(ty), r = s(tz)
    const g = (a: number, b: number, c: number) => hash((a % P_) + (b % P_) * P_ + (c % P_) * P_ * P_ + P_ * 1013)
    const l = (c: number) => (g(ix, iy, c) * (1 - u) + g(ix + 1, iy, c) * u) * (1 - w) + (g(ix, iy + 1, c) * (1 - u) + g(ix + 1, iy + 1, c) * u) * w
    return l(iz) * (1 - r) + l(iz + 1) * r
  }
  const fill = () => {
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const a = v(P[0], x, y, z) * 0.55 + v(P[1], x, y, z) * 0.3 + v(P[2], x, y, z) * 0.15
      out[x + y * N + z * N * N] = Math.round(a * 255)
    }
    t.needsUpdate = true
  }
  ;(t as unknown as { fill: () => void }).fill = fill
  t.format = THREE.RedFormat; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.unpackAlignment = 1
  return t
}
export const NOISE2 = noise2(256, [4, 8, 16, 32])
export const NOISE3 = noise3(48)
/** Noise is computed during loading, one per frame (never in the middle of another long task) */
export const noiseFills = [() => (NOISE2 as unknown as { fill: () => void }).fill(), () => (NOISE3 as unknown as { fill: () => void }).fill()]

// Racks as boxes (x0, x1, z0, z1): the facade (z = 0) stays outside its own box
const BOXES = G.RX.map((x) => new THREE.Vector4(x - G.BW / 2, x + G.BW / 2, -(G.BD - G.SETBACK), -0.002))
// Four racks; the fifth shader box is parked outside the room
while (BOXES.length < 5) BOXES.push(new THREE.Vector4(90, 90.01, 90, 90.01))

export const GLSL_SUN = /* glsl */ `
#ifndef SUN_DECL
#define SUN_DECL
uniform vec3 uSunTo; uniform float uTime; uniform float uSunK; uniform vec4 uBox[5]; uniform float uBH; uniform sampler2D tNoise2; uniform float uWellK;
float edge(float x, float a, float b, float w){ return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
vec3 toCeil(vec3 p, out float t){ t = (${CEIL.toFixed(2)} - p.y) / uSunTo.y; return p + uSunTo * t; }
// Oblique slit above the aisle, 26 cm wide
float slitMask(vec3 p){
  float t; vec3 q = toCeil(p, t);
  vec2 a = vec2(-1.827, 1.563), d = vec2(4.055, 0.707);
  float L = length(d); vec2 n = d / L;
  vec2 r = q.xz - a;
  float u = dot(r, n), v = n.x * r.y - n.y * r.x;
  float w = 0.0105 * t + 0.006;
  return edge(u, -0.15, L + 0.15, w) * edge(v, -0.13, 0.13, w);
}
// Skylight over the left room, crossed by its beam
float wellMask(vec3 p){
  float t; vec3 q = toCeil(p, t);
  float w = 0.0105 * t + 0.006;
  float m = edge(q.x, -7.1, -4.1, w) * edge(q.z, 0.3, 3.7, w);
  float tb = (4.32 - p.y) / uSunTo.y;
  float xb = p.x + uSunTo.x * tb;
  return m * (1.0 - edge(xb, -5.75, -5.45, 0.0105 * tb + 0.005));
}
// Racks: a box hit on the way to the sun puts the point in shadow
float boxShadow(vec3 p){
  vec3 inv = 1.0 / uSunTo;
  float s = 1.0;
  for (int i = 0; i < 5; i++) {
    vec4 b = uBox[i];
    vec3 t0 = (vec3(b.x, 0.0, b.z) - p) * inv, t1 = (vec3(b.y, uBH, b.w) - p) * inv;
    vec3 mn = min(t0, t1), mx = max(t0, t1);
    float a = max(max(mn.x, mn.y), mn.z), c = min(min(mx.x, mx.y), mx.z);
    // Penumbra over 4 cm of travel (no stair-stepped edges in the quarter-resolution rays)
    s *= 1.0 - smoothstep(0.0, 0.04, c - max(a, 0.004));
  }
  return s;
}
float clouds(vec3 p){
  float t; vec3 q = toCeil(p, t);
  // Two cloud layers at different speeds, shadow up to 48% with a sharp but soft edge
  vec2 uv = q.xz * 0.045 + vec2(uTime * 0.0095, uTime * 0.0036);
  float n = texture2D(tNoise2, uv).r * 0.65 + texture2D(tNoise2, uv * 2.3 + vec2(0.37, 0.11) + vec2(uTime * 0.004, 0.0)).g * 0.35;
  return mix(0.52, 1.0, smoothstep(0.34, 0.6, n)) * uSunK;
}
float sunOpen(vec3 p){ return slitMask(p) + wellMask(p) * uWellK; }
float sunMask(vec3 p){ float o = sunOpen(p); return o > 0.0 ? o * boxShadow(p) * clouds(p) : 0.0; }
#endif
`
export const GLSL_FOG = /* glsl */ `
#ifndef FOG_DECL
#define FOG_DECL
uniform vec3 uFogCol; uniform vec3 uFogSun; uniform float uFogD; uniform float uFogK; uniform float uFogN;
float hfogF(vec3 p){
  // Aerial perspective, not a veil: it starts uFogN metres from the camera (the foreground rack stays crisp and black)
  // and thickens with distance and towards the floor
  vec3 d = p - cameraPosition; float dist = max(length(d) - uFogN, 0.0);
  float dy = d.y; float k = uFogK;
  float y0 = max(cameraPosition.y, 0.0);
  float integ = abs(dy) > 1e-3 ? (exp(-k * y0) - exp(-k * (y0 + dy))) / (k * dy) : exp(-k * y0);
  return clamp(1.0 - exp(-uFogD * dist * integ), 0.0, 1.0);
}
// Air tint follows height: dark at floor level, light grey-blue at luminaire height, darker under the ceiling,
// so the background reads as a gradient, never a flat fill
vec3 fogCol(vec3 p){ return uFogCol * (0.45 + 0.75 * smoothstep(-0.2, 2.2, p.y) - 0.35 * smoothstep(2.8, 4.4, p.y)); }
vec3 hfog(vec3 col, vec3 p){ return mix(col, fogCol(p), hfogF(p)); }
#endif
`
/** Uniforms shared by every material (one object: changing it changes the whole room) */
export const shared = {
  uSunTo: { value: SUN_TO.clone() },
  uSunK: { value: 1 },
  uBox: { value: BOXES },
  uBH: { value: G.BH },
  tNoise2: { value: NOISE2 },
  uFogCol: { value: new THREE.Color(0.013, 0.0115, 0.0105) },
  uFogSun: { value: new THREE.Color(0.10, 0.06, 0.03) },
  uFogD: { value: 0.035 },
  uFogK: { value: 0.5 },
  uFogN: { value: 0 },
  uTime: { value: 0 },
  uWellK: { value: 1 },
  uPFilet: { value: new THREE.Color() }, uPMicro: { value: new THREE.Color() }, uPPerf: { value: new THREE.Color() },
  uPGlass0: { value: new THREE.Color() }, uPGlassSun: { value: new THREE.Color() }, uPGlassGrad: { value: new THREE.Color() }, uPGlassBand: { value: new THREE.Color() },
  uPLedOff0: { value: new THREE.Color() }, uPLedOffG: { value: new THREE.Color() }, uPLedOffSun: { value: new THREE.Color() }, uPLedCore: { value: new THREE.Color() },
  uPPlateSun: { value: new THREE.Color() }, uPDust: { value: new THREE.Color() }, uPWear: { value: new THREE.Color() },
  uPLmSun: { value: new THREE.Color() }, uPLmSky: { value: new THREE.Color() }, uPSkyFill: { value: new THREE.Color() }, uPBounce: { value: new THREE.Color() },
}
/** Palette colour declarations (once per program) */
export const GLSL_PAL = /* glsl */ `
#ifndef PAL_DECL
#define PAL_DECL
uniform vec3 uPFilet, uPMicro, uPPerf, uPGlass0, uPGlassSun, uPGlassGrad, uPGlassBand, uPLedOff0, uPLedOffG, uPLedOffSun, uPLedCore, uPPlateSun, uPDust, uPWear, uPLmSun, uPLmSky, uPSkyFill, uPBounce;
#endif
`
