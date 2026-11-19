// Glowing signs: the landing accent-title effect (src/ui/ArcGlow.tsx)
// transposed to 3D, in each room's colour.
// - Filament: the front face of the letters uses a map computed once from the same paths as the volume
//   (font.generateShapes): the stroke edge stays in the room's dark colour, the body in its full colour,
//   the stroke core (the eroded then softened letter) almost white. Like the landing SVG filter: erosion, blur.
// - Glow: a plane behind the letters, two halos (near and wide) taken from the same map, additive.
// - Sparks: small points born on the top edge of the letters, rising while slowing down, drifting in a
//   wave, twinkling and fading out (same laws as the landing canvas: speed 0.12 to 0.35 em/s, life 1.1 to
//   2.7 s). Everything is computed in the shader (no CPU work per frame); the emission point changes on each
//   life (a table of top-edge points, read with texelFetch).
// Cost: one RGBA map per sign (~1300 x 230), two extra draw calls per sign (glow, sparks).
import * as THREE from 'three'

const PX = 128 // map pixels per metre
const PAD = 0.55 // margin around the letters (m), for the glow
export const N_SPARK = 24 // number of sparks per sign

export interface Glow { halo: THREE.Mesh; sparks: THREE.Points; tex: THREE.DataTexture; pts: THREE.DataTexture; bounds: { x0: number; y1: number; w: number; h: number }; haloMat: THREE.ShaderMaterial; sparkMat: THREE.ShaderMaterial }

function pathOf(shapes: THREE.Shape[], dx: number, toPx: (x: number, y: number) => [number, number]) {
  const p = new Path2D()
  const add = (pts: THREE.Vector2[]) => { pts.forEach((v, i) => { const [x, y] = toPx(v.x + dx, v.y); if (i) p.lineTo(x, y); else p.moveTo(x, y) }); p.closePath() }
  for (const s of shapes) { add(s.getPoints(8)); for (const h of s.holes) add(h.getPoints(8)) }
  return p
}
// Gaussian blur through the drop shadow (works everywhere, ctx.filter is not in every browser): the
// source is drawn outside the canvas and only its shadow, offset by the same amount, lands on it
function blurred(W: number, H: number, sigma: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.shadowColor = '#fff'; g.shadowBlur = sigma * 2; g.shadowOffsetX = W + 64
  g.translate(-(W + 64), 0); draw(g); g.setTransform(1, 0, 0, 1, 0, 0)
  return g.getImageData(0, 0, W, H).data
}

/** filament and glow map, emission point table and the two meshes of a sign */
export function makeGlow(shapes: THREE.Shape[], dx: number, size: number, col: THREE.Color, core: THREE.Color): Glow {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const s of shapes) for (const v of s.getPoints(4)) { x0 = Math.min(x0, v.x + dx); x1 = Math.max(x1, v.x + dx); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y) }
  const bx0 = x0 - PAD, by1 = y1 + PAD, bw = x1 - x0 + 2 * PAD, bh = y1 - y0 + 2 * PAD
  const W = Math.ceil(bw * PX), H = Math.ceil(bh * PX)
  const toPx = (x: number, y: number): [number, number] => [(x - bx0) * PX, (by1 - y) * PX]
  const path = pathOf(shapes, dx, toPx)
  // Montserrat 600 stroke thickness: 13.5% of the font size (ArcGlow, tune())
  const stroke = size * 0.135 * PX
  // mask
  const mc = document.createElement('canvas'); mc.width = W; mc.height = H
  const mg = mc.getContext('2d', { willReadFrequently: true })!
  mg.fillStyle = '#fff'; mg.fill(path, 'evenodd')
  const mask = mg.getImageData(0, 0, W, H).data
  // core: the eroded letter (edge removed by a stroke) then softened
  const ec = document.createElement('canvas'); ec.width = W; ec.height = H
  const eg = ec.getContext('2d')!
  eg.fillStyle = '#fff'; eg.fill(path, 'evenodd')
  eg.globalCompositeOperation = 'destination-out'; eg.lineWidth = 2 * 0.26 * stroke; eg.lineJoin = 'round'; eg.stroke(path)
  const coreD = blurred(W, H, 0.2 * stroke, (g) => g.drawImage(ec, 0, 0))
  const nearD = blurred(W, H, 0.55 * stroke, (g) => { g.fillStyle = '#fff'; g.fill(path, 'evenodd') })
  const farD = blurred(W, H, 1.9 * stroke, (g) => { g.fillStyle = '#fff'; g.fill(path, 'evenodd') })
  const data = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) { data[i * 4] = coreD[i * 4 + 3]; data[i * 4 + 1] = nearD[i * 4 + 3]; data[i * 4 + 2] = farD[i * 4 + 3]; data[i * 4 + 3] = mask[i * 4 + 3] }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat)
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true
  // emission points: the top edge of the strokes (the neighbour above is empty), plus a few interior points
  const out: number[] = []
  const step = 3, up = Math.max(3, Math.round(0.03 * PX))
  for (let y = up; y < H; y += step) for (let x = 0; x < W; x += step) {
    if (mask[(y * W + x) * 4 + 3] < 128) continue
    const above = mask[((y - up) * W + x) * 4 + 3]
    if (above < 128 || (x * 7 + y * 13) % 41 === 0) out.push(bx0 + x / PX, by1 - y / PX)
  }
  const NP = Math.max(1, Math.min(2048, out.length / 2)), pd = new Float32Array(NP * 4)
  const keep = out.length / 2 / NP
  for (let i = 0; i < NP; i++) { const k = Math.floor(i * keep); pd[i * 4] = out[k * 2] ?? 0; pd[i * 4 + 1] = out[k * 2 + 1] ?? 0 }
  const pts = new THREE.DataTexture(pd, NP, 1, THREE.RGBAFormat, THREE.FloatType)
  pts.minFilter = pts.magFilter = THREE.NearestFilter; pts.generateMipmaps = false; pts.needsUpdate = true

  // glow, behind the letters
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTex: { value: tex }, uCol: { value: col }, uHl: { value: 1 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = vec2(uv.x, 1.0 - uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform sampler2D uTex; uniform vec3 uCol; uniform float uHl; varying vec2 vUv;
      void main() { vec4 t = texture2D(uTex, vUv); float k = mix(0.5, 1.0, uHl);
        vec3 c = uCol * (t.g * 0.36 + t.b * 0.18) * k; gl_FragColor = vec4(c, 1.0); }`,
  })
  haloMat.toneMapped = false
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh).translate(bx0 + bw / 2, by1 - bh / 2, -0.09), haloMat)
  halo.renderOrder = 4.5; halo.frustumCulled = false

  // sparks
  const g = new THREE.BufferGeometry()
  const seed = new Float32Array(N_SPARK), life = new Float32Array(N_SPARK), v = new Float32Array(N_SPARK), vx = new Float32Array(N_SPARK), r = new Float32Array(N_SPARK)
  for (let i = 0; i < N_SPARK; i++) { seed[i] = Math.random(); life[i] = 1.1 + Math.random() * 1.6; v[i] = size * (0.12 + Math.random() * 0.23); vx[i] = size * (Math.random() - 0.5) * 0.1; r[i] = size * (0.11 + Math.random() * 0.1) }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_SPARK * 3), 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aLife', new THREE.BufferAttribute(life, 1)); g.setAttribute('aV', new THREE.BufferAttribute(v, 1)); g.setAttribute('aVx', new THREE.BufferAttribute(vx, 1)); g.setAttribute('aR', new THREE.BufferAttribute(r, 1))
  const sparkMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uPts: { value: pts }, uN: { value: NP }, uScale: { value: 900 }, uDpr: { value: 1 }, uHl: { value: 1 }, uCol: { value: col }, uCore: { value: core }, uOn: { value: 1 } },
    vertexShader: /* glsl */`attribute float aSeed; attribute float aLife; attribute float aV; attribute float aVx; attribute float aR;
      uniform float uT; uniform sampler2D uPts; uniform float uN; uniform float uScale; uniform float uDpr; uniform float uHl; uniform float uOn;
      varying float vA;
      float hh(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float t = uT + aSeed * aLife * 7.0;
        float cyc = floor(t / aLife), age = t - cyc * aLife, u = age / aLife;
        float idx = floor(hh(cyc * 12.9898 + aSeed * 78.233) * uN);
        vec2 e = texelFetch(uPts, ivec2(int(idx), 0), 0).xy;
        float rise = aV * (1.0 - exp(-0.35 * age)) / 0.35;
        vec3 p = vec3(e.x + aVx * age + 0.035 * sin(age * 3.1 + aSeed * 40.0), e.y + rise, 0.12);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float flick = 0.65 + 0.35 * sin(age * 23.0 + aSeed * 19.0);
        vA = min(1.0, u * 6.0) * (1.0 - u) * (1.0 - u) * flick * mix(0.45, 1.0, uHl) * uOn;
        gl_PointSize = max(3.5 * uDpr, 2.0 * aR * uScale * uDpr / max(0.1, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`uniform vec3 uCol; uniform vec3 uCore; varying float vA;
      void main() { float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
        // almost-white core, fringe in the room colour (as on the landing canvas: a disc, a fringe 2.6 times wider)
        float core = smoothstep(0.42, 0.12, r), fr = pow(1.0 - r, 2.0) * 0.4;
        gl_FragColor = vec4(uCore * core + uCol * fr, vA * 0.7); }`,
  })
  sparkMat.toneMapped = false
  const sparks = new THREE.Points(g, sparkMat); sparks.frustumCulled = false; sparks.renderOrder = 6
  return { halo, sparks, tex, pts, bounds: { x0: bx0, y1: by1, w: bw, h: bh }, haloMat, sparkMat }
}
