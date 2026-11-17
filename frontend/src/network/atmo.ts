// Background of the Network scene, continuing the landing room (scene/glsl.ts: air thickened by a
// height gradient, clouds that make the light breathe, slanted sun rays). A single full-screen plane,
// two reads of a small noise texture per layer (no computed noise): a far haze and a near haze that
// drift at different speeds and with different parallax when the camera turns, very faint amber rays
// that drift, and a blue glow that breathes around the A. Subtle: it stays below the dioramas, packets
// and text. Reduced motion: frozen (time stopped).
import * as THREE from 'three'

function noiseTex(n = 128) {
  // smoothed, repeatable value noise (4 octaves) in R; a second seed in G
  const d = new Uint8Array(n * n * 4)
  const grid = (g: number, seed: number) => { const a = new Float32Array(g * g); let s = seed; for (let i = 0; i < a.length; i++) { s = (s * 16807) % 2147483647; a[i] = s / 2147483647 } return a }
  const sm = (t: number) => t * t * (3 - 2 * t)
  const val = (a: Float32Array, g: number, x: number, y: number) => {
    const fx = (x / n) * g, fy = (y / n) * g, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0)
    const at = (i: number, j: number) => a[((j % g) * g) + (i % g)]
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
  }
  for (const [ch, seed] of [[0, 7], [1, 131]] as const) {
    const oct = [4, 8, 16, 32].map((g, k) => ({ g, a: grid(g, seed + k * 97), w: 0.5 ** k }))
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let v = 0, ws = 0; for (const o of oct) { v += val(o.a, o.g, x, y) * o.w; ws += o.w }
      d[(y * n + x) * 4 + ch] = Math.round((v / ws) * 255)
    }
  }
  for (let i = 0; i < n * n; i++) d[i * 4 + 3] = 255
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true
  return t
}

export function makeAtmo(bg: number) {
  const uniforms = {
    tN: { value: noiseTex() }, uT: { value: 0 }, uAsp: { value: 1.6 }, uPar: { value: new THREE.Vector2() },
    uA: { value: new THREE.Vector2(0.5, 0.5) }, uAK: { value: 1 },
    uBg: { value: new THREE.Color(bg) }, uDeep: { value: new THREE.Color(0x1d3159) }, uElec: { value: new THREE.Color(0x4a86ff) }, uWarm: { value: new THREE.Color(1.0, 0.655, 0.35) },
  }
  const m = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tN; uniform float uT; uniform float uAsp; uniform vec2 uPar; uniform vec2 uA; uniform float uAK;
      uniform vec3 uBg; uniform vec3 uDeep; uniform vec3 uElec; uniform vec3 uWarm; varying vec2 vUv;
      void main() {
        vec2 p = vec2(vUv.x * uAsp, vUv.y);
        // air as a height gradient: darker at the top, slightly denser towards the bottom
        vec3 col = uBg * mix(1.16, 0.8, smoothstep(0.1, 1.0, vUv.y));
        // far haze: large scale, slow, little parallax
        vec2 q1 = p * 0.42 + uPar * 0.12 + vec2(uT * 0.0045, uT * 0.0016);
        float n1 = texture2D(tN, q1).r * 0.62 + texture2D(tN, q1 * 2.3 + vec2(-uT * 0.003, 0.0)).g * 0.38;
        col += uDeep * smoothstep(0.38, 0.86, n1) * 0.5;
        // near haze: more parallax, reverse drift, barely tinted with Arc
        vec2 q2 = p * 0.85 + uPar * 0.38 + vec2(-uT * 0.009, uT * 0.003);
        float n2 = texture2D(tN, q2).g;
        col += uElec * smoothstep(0.52, 0.95, n2) * 0.045;
        // slanted amber rays, very faint, modulated by the clouds (the landing light, from afar)
        float s = dot(p + uPar * 0.2, vec2(0.48, -0.88));
        float cl = texture2D(tN, vec2(s * 0.35 + uT * 0.002, uT * 0.0012)).r;
        float ray = pow(0.5 + 0.5 * sin(s * 6.0 + uT * 0.04 + cl * 4.0), 8.0);
        col += uWarm * ray * 0.022 * smoothstep(0.95, 0.15, vUv.y) * smoothstep(0.3, 0.7, cl);
        // the glow that breathes around the A
        vec2 d = vUv - uA; d.x *= uAsp;
        col += uElec * exp(-dot(d, d) * 5.0) * uAK * (0.075 + 0.025 * sin(uT * 0.7));
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m)
  mesh.frustumCulled = false; mesh.renderOrder = -100
  return { mesh, uniforms }
}
