// Landing scene: a server room around the racks.
// - the room uses baked Cycles lightmaps; what cannot be baked (tile joints, perforations, floor reflections, distant
//   LEDs) is drawn in the room shader from position alone;
// - racks and sleds: glass facades, brushed aluminium, baked AO, a title plate where the service name is printed live,
//   and a vertical LED slit with a light guide;
// - the sun: every surface reads the exact mask of the ceiling openings and the analytic rack shadows (glsl.ts); the
//   same function lights the dust and the light shafts;
// - light shafts: a real volume ray-marched at quarter resolution;
// - dust: GPU particles carried by a wind read from a noise texture, lit only in the sun;
// - the replayed sled (first pinned page): slides out, explodes into seven layers, closes, receives the Arc glass sheet
//   on its lid and slides back; (second pinned page) Arc light runs around it while Arc verifies, then its LED turns green;
// - composite: shafts, text column overlay, cursor loupe, grading.
// One clock (clock.ts). Everything is loaded, compiled, uploaded and drawn once (including what only appears on scroll)
// before __frontReady: while scrolling, only visibility and uniforms change.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { onTick, sceneTime, REDUCED, FROZEN_T, getLenis, TOURNAGE, scrollY } from '../clock'
import { wallLot, heroLot, progress as loadP, mark, WALL_GLB, WALL_TEX, HERO_TEX } from '../assets'
import { world } from '../world'
import { G, K, FACE, SLOTS, NSLOTS, plateOf, ledOf3, productLabel, oklchToLinear, type Sled } from '../data/wall'
import { getLive } from '../data/live'
import { t, getLang } from '../i18n'
import { ORDER, storyAt, secTop, secH, type SecId } from '../story'
import { keyView, lerpView, protocolView, svcView, colEdge, PULL_OUT, mobileW, pinShift, MOB_SHIFT, stageCenter, STAGE_ROT, PT, type View } from './cam'
import { GLSL_SUN, GLSL_FOG, GLSL_PAL, SUN_TO, SUN_COL, CEIL, NOISE2, NOISE3, noiseFills, shared } from './glsl'
import { getPal, onPal, type Palette, type RGB } from '../palette'
import { PlateAtlas, PLATE_VS, PLATE_FS, TROWS } from './plates'

const SNAP = REDUCED || FROZEN_T !== null || TOURNAGE
// Exposure (?e= overrides it). ?poster renders the no-WebGL poster: LEDs off and plates empty (no frozen state that
// could become false)
const POSTER = new URLSearchParams(location.search).has('poster') || TOURNAGE
const Q = new URLSearchParams(location.search)
let EXPO = Q.has('e') ? Number(Q.get('e')) : 1.15
const OVK = Q.has('ov') ? Number(Q.get('ov')) : 1
// Facade and rack edges (machined-edge roughness) and glass restraint at grazing angles (?er=, ?gz= override them)
const ER = Q.has('er') ? Number(Q.get('er')) : 0.3
const GZ = Q.has('gz') ? Number(Q.get('gz')) : 0.22
const lin = (L: number, C: number, h: number) => new THREE.Color(...oklchToLinear(L, C, h))
export const LED = { green: lin(0.80, 0.26, 148), amber: lin(0.74, 0.20, 52), red: lin(0.64, 0.25, 27) }
const INK_OFF = new THREE.Color(0.62, 0.64, 0.68)
// "OPEN SLOT" engraved ink (?ink= overrides it)
const OPEN_INK = TOURNAGE ? 0 : Q.has('ink') ? Number(Q.get('ink')) : 0.04
const ARC_BLUE = new THREE.Color('#1C2998')
// Lightmap scales. Misfire curve of the Invalid LED (intensity multiplier, time in s)
const PANNE: [number, number][] = [[0, 1], [0.04, 0.03], [0.13, 0.03], [0.15, 1.35], [0.21, 1.1], [0.23, 0.03], [0.38, 0.03], [0.4, 0.55], [0.46, 0.5], [0.48, 0.03], [0.7, 0.03], [0.72, 1.2], [0.78, 1], [0.8, 0.12], [0.88, 0.12], [1.15, 1]]
function panne(t: number) {
  if (t <= 0 || t >= PANNE[PANNE.length - 1][0]) return 1
  let k = 1; while (PANNE[k][0] < t) k++
  const [t0, a] = PANNE[k - 1], [t1, b] = PANNE[k]
  return a + (b - a) * (t - t0) / (t1 - t0)
}
let invAt = -1
const OVS: Record<string, [number, number, number]> = { hero: [0.5, 0.16, 0.7], use: [0.22, 0.07, 0], rent: [0.22, 0.07, 0], publish: [0.22, 0.07, 0], invalid: [0.22, 0.07, 0], protocol: [0.3, 0.05, 0.45], arc: [0.22, 0.07, 0], end: [0.3, 0.08, 0] }
// Phone: under the hero paragraph the glass turns into a low, formless light so the text never sits on sharp racks
const OVS_MOB: Record<string, [number, number, number]> = { ...OVS, hero: [0.16, 0.04, 0], end: [0.2, 0.05, 0] }
// Overrides (?ovg, ?ovc, ?ovs), read once
const OVQ = (['ovg', 'ovc', 'ovs'] as const).map((k) => (Q.has(k) ? Number(Q.get(k)) : undefined))
const LM = { sun: 0.1004, sky: 0.2253 }

export function mountStage(canvas: HTMLCanvasElement, onProgress: (k: number) => void, onWallReady: () => void, onAllReady: () => void): { dispose: () => void; reveal: () => void } {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: true })
  // Retina: pixel ratio capped at 2 (never below 1.5 on a Retina screen); ?dpr= overrides it
  let DPR_MAX = Q.has('dpr') ? Math.max(1, Math.min(2, Number(Q.get('dpr')) || 2)) : Math.min(devicePixelRatio || 1, 2)
  let DPR = DPR_MAX
  const MSAA = Q.has('msaa') ? Number(Q.get('msaa')) : 4
  renderer.setPixelRatio(DPR)
  renderer.setClearColor(0x020203)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  const ANISO = renderer.capabilities.getMaxAnisotropy()
  // Arc sheet transmission: the room behind it is rendered at half resolution (barely frosted glass)
  renderer.transmissionResolutionScale = 0.5
  world.canvas = canvas
  const scene = new THREE.Scene()
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 40)

  // ---- Reflection environment ----
  // A simple procedural studio modelled on the server room (rows of linear luminaires on the ceiling, lighter grey-blue
  // walls at eye level, dark floor), so metal and glass have something to reflect. A dark room rendered into a cube map
  // gives nothing to reflect and leaves the facades dead. Computed per direction on a sphere and filtered once (PMREM);
  // no program changes afterwards. ?envs=room uses the rendered room instead.
  const pm = new THREE.PMREMGenerator(renderer)
  const ENVK = Q.has('envk') ? Number(Q.get('envk')) : 1
  const envOf = () => {
    const envScene = new THREE.Scene()
    const m = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: { uK: { value: ENVK } },
      vertexShader: /* glsl */`varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uK; varying vec3 vD;
        void main(){
          vec3 d = normalize(vD);
          // Walls: dark floor, lighter grey-blue air at luminaire height, dark ceiling between them
          vec3 floorC = vec3(0.018, 0.020, 0.025), wallLo = vec3(0.050, 0.058, 0.072), wallHi = vec3(0.115, 0.130, 0.160), ceil = vec3(0.030, 0.034, 0.042);
          vec3 c = mix(floorC, wallLo, smoothstep(-0.35, 0.0, d.y));
          c = mix(c, wallHi, smoothstep(0.0, 0.35, d.y));
          c = mix(c, ceil, smoothstep(0.45, 0.8, d.y));
          // Behind the visitor (z > 0, what a facade reflects head-on): the opposite row, dark, with bright joints between its
          // racks, and the lit end of the aisle on the left. Black glass gets sharp, changing reflections without going grey
          float back = smoothstep(0.1, 0.5, d.z);
          float az = atan(d.x, d.z);
          float rackBand = smoothstep(-0.32, -0.25, d.y) * (1.0 - smoothstep(0.18, 0.24, d.y));
          float seam = 1.0 - smoothstep(0.0, 0.012, abs(fract(az * 4.2) - 0.5) - 0.47);
          c = mix(c, mix(vec3(0.012, 0.014, 0.018), vec3(0.16, 0.18, 0.22), seam), back * rackBand);
          c += vec3(0.20, 0.23, 0.28) * smoothstep(-0.2, -0.75, d.x) * (1.0 - smoothstep(0.1, 0.55, abs(d.y - 0.1))) * smoothstep(-0.2, 0.3, d.z);
          // Luminaires: 1.5 m segments every 1.8 m, rows every 1.6 m, 2.4 m above eye level
          if (d.y > 0.05) {
            vec2 h = d.xz * (2.4 / d.y);
            float fz = abs(fract(h.y / 1.6 + 0.5) - 0.5) * 1.6;
            float fx = fract((h.x + 0.75) / 1.8) * 1.8;
            float w = fwidth(h.y) * 0.5 + 0.004;
            float on = (1.0 - smoothstep(0.06 - w, 0.06 + w, fz)) * smoothstep(0.0, 0.05, fx) * (1.0 - smoothstep(1.45, 1.5, fx));
            float fall = 1.0 / (1.0 + 0.02 * dot(h, h));
            c += vec3(0.86, 0.93, 1.0) * on * 7.0 * fall;
            // Diffuser glow on the ceiling around the tube
            c += vec3(0.10, 0.12, 0.15) * exp(-fz / 0.25) * fall;
          }
          gl_FragColor = vec4(c * uK, 1.0);
        }`,
    }))
    envScene.add(m)
    const t = pm.fromScene(envScene, 0.0).texture
    m.geometry.dispose(); (m.material as THREE.Material).dispose()
    return t
  }
  const envTex = envOf()
  scene.environment = envTex
  const ENVI = Q.has('env') ? Number(Q.get('env')) : 2.2
  scene.environmentIntensity = ENVI
  // three.js ignores material.envMapIntensity when the reflection comes from scene.environment (it uses
  // scene.environmentIntensity instead). A material that needs its own gain gets the environment explicitly (same
  // texture, same program)
  const envGain = (m: THREE.MeshStandardMaterial, k: number) => { m.envMap = envTex; m.envMapIntensity = k * ENVI }

  const sun = new THREE.DirectionalLight(SUN_COL, 34.0)
  sun.position.copy(SUN_TO).multiplyScalar(10)
  scene.add(sun)
  // A service light above the pulled-out sled (off elsewhere) so the exploded layers read in the aisle shadow. It exists
  // from the start so the light count never changes (no program recompiles while scrolling)
  const fill = new THREE.PointLight(new THREE.Color(1.0, 0.82, 0.62), 0, 2.2, 2)
  scene.add(fill)
  const hemi = new THREE.HemisphereLight(new THREE.Color(0.26, 0.33, 0.52), new THREE.Color(0.30, 0.20, 0.11), 0.42)
  scene.add(hemi)
  // Bounce light on the facades: diffuse only (hemisphere light from below, no sharp highlight on the edges), with an
  // unchanged light count so nothing recompiles; ?b= overrides it
  hemi.color.setRGB(0.15, 0.16, 0.24); hemi.groundColor.setRGB(0.80, 0.50, 0.22)
  hemi.intensity = Q.has('b') ? Number(Q.get('b')) : 5

  // ---- Palette, applied live (uniforms, material and light colours only) ----
  const setC = (c: THREE.Color, v: RGB) => c.setRGB(v[0], v[1], v[2])
  const uC = (k: keyof typeof shared, v: RGB) => setC((shared[k] as { value: THREE.Color }).value, v)
  let palDirty = false
  let volBase = 1.6 // palette shaft gain, lowered with the room on the first pinned page
  function applyPal(P: Palette) {
    renderer.setClearColor(P.clear)
    setC(SUN_COL, P.sun); sun.intensity = P.sunK
    shared.uWellK.value = P.wellK
    uC('uFogCol', P.fog); uC('uFogSun', P.fogSun)
    // Air tint and density (?fc= scales the air tint, ?fd= density, ?lm= room gain)
    if (Q.has('fc')) (shared.uFogCol.value as THREE.Color).multiplyScalar(Number(Q.get('fc')))
    shared.uFogD.value = Q.has('fd') ? Number(Q.get('fd')) : P.fogD
    shared.uFogN.value = Q.has('fn') ? Number(Q.get('fn')) : P.fogN
    roomU.uLm.value.set(LM.sun * (Q.has('lm') ? Number(Q.get('lm')) : P.roomK), LM.sky * (Q.has('lm') ? Number(Q.get('lm')) : P.roomK))
    uC('uPFilet', P.filet); uC('uPMicro', P.micro); uC('uPPerf', P.perf)
    uC('uPGlass0', P.glass.base); uC('uPGlassSun', P.glass.sun); uC('uPGlassGrad', P.glass.grad); uC('uPGlassBand', P.glass.band)
    uC('uPLedOff0', P.ledOff.base); uC('uPLedOffG', P.ledOff.grad); uC('uPLedOffSun', P.ledOff.sun); uC('uPLedCore', P.ledCore)
    uC('uPPlateSun', P.plateSun); uC('uPDust', P.dust); uC('uPWear', P.wear)
    uC('uPLmSun', P.lmSun); uC('uPLmSky', P.lmSky); uC('uPSkyFill', P.skyFill); uC('uPBounce', P.bounce)
    setC(hemi.color, P.hemiSky); setC(hemi.groundColor, P.hemiGround); hemi.intensity = Q.has('b') ? Number(Q.get('b')) : P.hemiK
    setC(fill.color, P.fill)
    setC(compU.uCGold.value, P.comp.gold); setC(compU.uCNight.value, P.comp.night); setC(compU.uCBase.value, P.comp.base)
    setC(compU.uCShadow.value, P.comp.shadow); setC(compU.uCHi.value, P.comp.hi); setC(compU.uCLift.value, P.comp.lift)
    setC(compU.uCRevBg.value, P.comp.revealBg); setC(compU.uCRevEdge.value, P.comp.revealEdge); compU.uCSat.value = P.comp.sat
    volBase = P.comp.volK; if (!Q.has('vk')) compU.uVolK.value = P.comp.volK
    if (!Q.has('e')) EXPO = P.comp.expo
    for (const { k, m } of palMats) { const c = (P.mat as Record<string, string>)[k]; if (c) m.color.set(c) }
    INK_OFF.setRGB(...P.inkOff)
    lastVersion = -1 // unlit plate tints are re-read on the next frame
  }
  const offPal = onPal(() => { palDirty = true })

  // ---- Render targets: multisampled HDR scene, a quarter for the shafts, an eighth for the overlay ----
  // The multisampled scene uses R11G11B10 float (4 bytes per sample instead of 8 with RGBA16F; alpha is not needed). At
  // 2560x1440 on Retina, 4x MSAA took 34.7 ms per frame in RGBA16F against 25.1 ms in R11G11B10, with no visible banding
  // in dark gradients. ?rt=16 forces RGBA16F; without EXT_color_buffer_float, RGBA16F is used
  const RT111 = Q.get('rt') !== '16' && renderer.extensions.has('EXT_color_buffer_float')
  const rtMain = new THREE.WebGLRenderTarget(1, 1, RT111 ? { type: THREE.UnsignedInt101111Type, format: THREE.RGBFormat, samples: MSAA, depthBuffer: true } : { type: THREE.HalfFloatType, samples: MSAA, depthBuffer: true })
  const rtVol = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  const rtDown = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  // A thirty-second: the room truly blurred under the fade when a rack passes behind it (no legible plate)
  const rtDown2 = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  for (const r of [rtVol, rtDown, rtDown2]) { r.texture.minFilter = THREE.LinearFilter; r.texture.magFilter = THREE.LinearFilter }
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const fsGeo = new THREE.BufferGeometry()
  fsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  const FS_VS = /* glsl */`varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`
  const passScene = (mat: THREE.ShaderMaterial) => { const s = new THREE.Scene(); const m = new THREE.Mesh(fsGeo, mat); m.frustumCulled = false; s.add(m); return s }

  // Light shafts: a volume ray-marched along the view ray up to the first surface (floor, walls, racks: analytic)
  const volU = {
    ...shared, tNoise3: { value: NOISE3 }, uInvVP: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
    uDen: { value: 1.2 }, uVolDet: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) }, uWind: { value: new THREE.Vector3(0.05, 0.004, -0.02) },
  }
  const volMat = new THREE.ShaderMaterial({
    uniforms: volU, vertexShader: FS_VS, depthTest: false, depthWrite: false,
    fragmentShader: /* glsl */`precision highp float; precision highp sampler3D;
      ${GLSL_SUN}
      uniform sampler3D tNoise3; uniform mat4 uInvVP; uniform vec3 uCam; uniform float uDen; uniform vec2 uRes; uniform vec3 uWind; uniform float uVolDet;
      varying vec2 vUv;
      float tBox(vec3 o, vec3 d, vec3 lo, vec3 hi){
        vec3 inv = 1.0 / d; vec3 a = (lo - o) * inv, b = (hi - o) * inv;
        vec3 mn = min(a, b), mx = max(a, b);
        float t0 = max(max(mn.x, mn.y), mn.z), t1 = min(min(mx.x, mx.y), mx.z);
        return (t1 > max(t0, 0.0)) ? max(t0, 0.0) : 1e4;
      }
      void main(){
        vec4 f = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vec3 far = f.xyz / f.w;
        vec3 o = uCam, d = normalize(far - o);
        // First surface: floor, ceiling, back wall, walls, racks
        float tm = 30.0;
        if (d.y < 0.0) tm = min(tm, -o.y / d.y);
        if (d.y > 0.0) tm = min(tm, (${CEIL.toFixed(2)} - o.y) / d.y);
        if (d.z < 0.0) tm = min(tm, (-12.2 - o.z) / d.z);
        if (d.z > 0.0) tm = min(tm, (5.6 - o.z) / d.z);
        if (d.x < 0.0) tm = min(tm, (-7.6 - o.x) / d.x);
        if (d.x > 0.0) tm = min(tm, (8.1 - o.x) / d.x);
        for (int i = 0; i < 5; i++) { vec4 b = uBox[i]; tm = min(tm, tBox(o, d, vec3(b.x, 0.0, b.z), vec3(b.y, uBH, b.w + 0.016))); }
        // The rows of distant racks also stop the ray
        for (int k = 0; k < 3; k++) { float zf = -3.2 - 3.2 * float(k); tm = min(tm, tBox(o, d, vec3(-7.0, 0.0, zf - 1.1), vec3(1.4, 2.0, zf))); }
        tm = min(tm, tBox(o, d, vec3(-4.0, 0.0, 4.3), vec3(6.2, 2.0, 5.4)));
        tm = min(tm, 14.0);
        const int N = 36;
        float dt = tm / float(N);
        // Per-pixel offset (interleaved gradient noise): no marching bands, the composite blur absorbs it
        float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        float cosT = dot(d, uSunTo);
        float g = 0.45; float ph = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.25 + 0.08;
        float acc = 0.0, tr = 1.0;
        for (int i = 0; i < N; i++) {
          vec3 p = o + d * (dt * (float(i) + j));
          float s = sunOpen(p);
          // Air near the lens is not lit (no veil stuck to the camera when it grazes the beam)
          float den = uDen * exp(-p.y * 0.32) * smoothstep(0.25, 1.3, dt * (float(i) + j));
          // Nearly uniform dust, barely veined at the beam scale (60 to 80 cm cells): a shaft in hazy air is smooth, its texture
          // comes from the grains glinting in it. Noise is only sampled in the sun (most steps are in shadow); outside it,
          // absorption uses the mean noise density (0.75)
          if (s > 0.001) {
            if (uVolDet > 0.5) {
              vec3 q = p * 1.25 + uWind * uTime * 1.6;
              float n = texture(tNoise3, q).r * 0.6 + texture(tNoise3, q * 2.3 + 0.31 - uWind * uTime).r * 0.4;
              den *= 0.5 + 0.7 * smoothstep(0.3, 0.8, n);
            } else den *= 0.5 + 0.7 * smoothstep(0.3, 0.8, texture(tNoise3, p * 1.25 + uWind * uTime * 1.6).r);
            acc += tr * den * s * boxShadow(p) * clouds(p) * dt;
          } else den *= 0.75;
          tr *= exp(-den * dt * 0.08);
        }
        gl_FragColor = vec4(vec3(acc * ph), 1.0);
      }`,
  })
  const volScene = passScene(volMat)
  // The shaft blur (nine taps) runs once at quarter resolution instead of per screen pixel in the composite
  const rtVolB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  rtVolB.texture.minFilter = THREE.LinearFilter; rtVolB.texture.magFilter = THREE.LinearFilter
  const volBMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: rtVol.texture }, uTexel: { value: new THREE.Vector2() } }, vertexShader: FS_VS, depthTest: false, depthWrite: false,
    fragmentShader: /* glsl */`uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ vec3 a = vec3(0.0);
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) a += texture2D(tSrc, vUv + vec2(float(x), float(y)) * uTexel * 1.3).rgb * (x == 0 && y == 0 ? 2.0 : 1.0);
        gl_FragColor = vec4(a / 10.0, 1.0); }`,
  })
  const volBScene = passScene(volBMat)
  const downMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: rtMain.texture }, uTexel: { value: new THREE.Vector2() } }, vertexShader: FS_VS, depthTest: false, depthWrite: false,
    fragmentShader: /* glsl */`uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ vec3 c = vec3(0.0);
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) c += texture2D(tSrc, vUv + vec2(float(x), float(y)) * uTexel).rgb;
        gl_FragColor = vec4(c / 9.0, 1.0); }`,
  })
  const downScene = passScene(downMat)
  const down2Mat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: rtDown.texture }, uTexel: { value: new THREE.Vector2() } }, vertexShader: FS_VS, fragmentShader: downMat.fragmentShader, depthTest: false, depthWrite: false })
  const down2Scene = passScene(down2Mat)

  // Composite: shafts, text column overlay, loupe, AgX, grading, fine grain
  const compU = {
    tScene: { value: rtMain.texture }, tVol: { value: rtVolB.texture }, tDown: { value: rtDown.texture }, tDown2: { value: rtDown2.texture }, tNoise2: { value: NOISE2 },
    uRes: { value: new THREE.Vector2(1, 1) }, uVolTexel: { value: new THREE.Vector2(1, 1) }, uDownTexel: { value: new THREE.Vector2(1, 1) },
    uExpo: { value: 0 }, uTime: { value: 0 }, uSun: { value: SUN_COL.clone() }, uVolK: { value: Q.has('vk') ? Number(Q.get('vk')) : 1.6 },
    uOv: { value: new THREE.Vector4(0.42, 1, 0, 0) }, uMouse: { value: new THREE.Vector3(-1, -1, 0) },
    uLoupe: { value: new THREE.Vector4(0, 0, 0, 0) }, uDpr: { value: DPR }, uReveal: { value: new THREE.Vector3(0, 0.5, 0) },
    // Room gain and ceiling seen through the fade, per section (OVS): gain, ceiling, sharpness; the blur widens as
    // sharpness drops (?ovg=, ?ovc=, ?ovs= override them)
    uOvG: { value: new THREE.Vector3(0.5, 0.25, 0.7) },
    uCGold: { value: new THREE.Color() }, uCNight: { value: new THREE.Color() }, uCBase: { value: new THREE.Color() }, uCShadow: { value: new THREE.Color() }, uCHi: { value: new THREE.Color() },
    uCSat: { value: 1 }, uCLift: { value: new THREE.Color() }, uCRevBg: { value: new THREE.Color() }, uCRevEdge: { value: new THREE.Color() },
  }
  const compMat = new THREE.ShaderMaterial({
    uniforms: compU, vertexShader: FS_VS, depthTest: false, depthWrite: false,
    fragmentShader: /* glsl */`precision highp float;
      uniform sampler2D tScene, tVol, tDown, tDown2, tNoise2; uniform vec2 uRes, uVolTexel, uDownTexel; uniform float uExpo, uTime, uVolK, uDpr;
      uniform vec3 uSun; uniform vec4 uOv; uniform vec3 uOvG; uniform vec3 uMouse; uniform vec4 uLoupe; uniform vec3 uReveal; varying vec2 vUv;
      uniform vec3 uCGold, uCNight, uCBase, uCShadow, uCHi, uCLift, uCRevBg, uCRevEdge; uniform float uCSat;
      vec3 agx(vec3 c){
        const mat3 inM = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
        const mat3 outM = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
        const float mn = -12.47393, mx = 4.026069;
        c = inM * max(c, 1e-10); c = clamp(log2(c), mn, mx); c = (c - mn) / (mx - mn);
        vec3 x2 = c * c, x4 = x2 * x2;
        c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
        c = outM * c; c = pow(max(vec3(0.0), c), vec3(2.2));
        return clamp(c, 0.0, 1.0);
      }
      float h12(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      // Quarter-resolution shafts, already blurred over nine taps (volBMat): one read here
      vec3 vol(vec2 uv){ return texture2D(tVol, uv).rgb; }
      // Text column fade: a dark glass over the room. The room reads through it, softened and muted; LED and plate hues do
      // not pass through. Luminance is compressed under a ceiling that keeps the text legible. Its edge wobbles slowly and
      // blends into the room over a tenth of the screen. On phones it covers the bottom of the screen under the text.
      vec3 overlay(vec2 uv, vec3 base, vec3 rays, out float m){
        float wob = texture2D(tNoise2, vec2(uv.y * 0.55, uTime * 0.006)).r - 0.5;
        float e = uOv.x + wob * 0.012;
        if (uOv.z > 0.5) m = smoothstep(uOv.x - 0.2, uOv.x + 0.05, 1.0 - uv.y + wob * 0.02);
        else m = 1.0 - smoothstep(e - 0.085, e + 0.004, uv.x);
        m *= uOv.y;
        if (m < 0.002) return base;
        // Wide blur (eighth resolution read on a 6-texel cross): a shape of light, not an object
        vec2 o1 = uDownTexel * vec2(3.0, 1.5), o2 = uDownTexel * vec2(-1.5, 3.0);
        vec3 frost = texture2D(tDown, uv).rgb * 0.36 + (texture2D(tDown, uv + o1).rgb + texture2D(tDown, uv - o1).rgb + texture2D(tDown, uv + o2).rgb + texture2D(tDown, uv - o2).rgb) * 0.16;
        // Zero sharpness: the thirty-second alone, a formless light
        frost = mix(texture2D(tDown2, uv).rgb, frost, smoothstep(0.0, 0.4, uOvG.z));
        // Almost sharp: the air behind the glass carries a third of the shafts, so the beam reads through its grains rather
        // than as a veil
        vec3 src = mix(frost * uExpo + rays * 0.3, base - rays * 0.7, uOvG.z);
        float l = dot(src, vec3(0.2126, 0.7152, 0.0722));
        // LED and plate hues (green, saturated red) do not pass through: pulled back to the sun tint
        vec3 gold = uCGold / max(1e-3, dot(uCGold, vec3(0.2126, 0.7152, 0.0722))), night = uCNight / max(1e-3, dot(uCNight, vec3(0.2126, 0.7152, 0.0722)));
        float gr = smoothstep(0.0, 0.12, (src.g - max(src.r, src.b)) / (l + 1e-4));
        float rd = smoothstep(0.42, 0.22, src.g / (src.r + 1e-4)) * step(src.b, src.g * 1.6 + 1e-4);
        vec3 hue = mix(src / (l + 1e-5), gold, max(gr, rd));
        // Soft compression under the ceiling (the brightest light stays below legible text); deep shadows take the night blue
        float lg = l * uOvG.x, lt = uOvG.y * lg / (uOvG.y + lg);
        hue = mix(night, hue, smoothstep(0.001, 0.012, lt));
        vec3 col = uCBase + lt * hue;
        return mix(base, col, m);
      }
      void main(){
        vec2 uv = vUv;
        // Loupe: inside the small cursor square the image is magnified (the square does not grow)
        vec2 fc = gl_FragCoord.xy;
        if (uLoupe.w > 0.5) {
          vec2 d = fc - uLoupe.xy;
          if (abs(d.x) < uLoupe.z && abs(d.y) < uLoupe.z) {
            float r = length(d) / uLoupe.z;
            uv = (uLoupe.xy + d / (2.0 - 0.35 * r * r)) / uRes;
          }
        }
        vec3 c = texture2D(tScene, uv).rgb;
        // Soft knee on the shafts: a beam seen along its length saturates gently instead of forming a full veil
        vec3 rays;
        { vec3 vv = vol(uv) * uVolK; rays = uSun * vv / (1.0 + 0.9 * dot(vv, vec3(0.333))); c += rays; }
        c *= uExpo; rays *= uExpo;
        float m; c = overlay(uv, c, rays, m);
        c = agx(c);
        // Shadows and low tones shift towards night blue by multiplication (black stays black); highlights keep their tint
        { float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float wsh = smoothstep(0.0, 0.012, l0) * (1.0 - smoothstep(0.02, 0.06, l0));
          float warm = smoothstep(0.04, 0.22, (c.r - c.b) / (l0 + 0.02));
          // Shadows and highlights tinted by the palette (multiplicative: black stays black)
          c *= mix(vec3(1.0), uCShadow, wsh * (1.0 - 0.8 * warm) * 0.55 + wsh * 0.0);
          c *= mix(vec3(1.0), uCHi, smoothstep(0.05, 0.4, l0)); }
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 1.28 * uCSat);
        c += uCLift * (1.0 - smoothstep(0.0, 0.04, l));
        c = pow(max(c, 0.0), vec3(1.12));
        vec2 v = uv - 0.5; c *= 1.0 - 0.36 * dot(v, v) * 1.5;
        c = pow(c, vec3(1.0 / 2.2));
        // Fixed dither against gradient banding: it does not change every frame, so dark flat areas never crawl
        c += (h12(fc) - 0.5) * ${TOURNAGE ? '0.0' : '0.008'};
        // Intro: before it, the page background (#060708); then a horizontal slit at mid-height widens (0 to 0.45) and opens
        // vertically (0.2 to 1), soft edge, exposure rising from 0.35 to 1
        if (uReveal.x < 1.0) {
          float rr = uReveal.x;
          float ex = 1.0 - pow(1.0 - clamp(rr / 0.45, 0.0, 1.0), 3.0);
          float ey = clamp((rr - 0.2) / 0.8, 0.0, 1.0); ey = ey * ey * (3.0 - 2.0 * ey);
          float hx = ex * (max(uReveal.z, 1.0 - uReveal.z) + 0.07), hy = 0.0015 + 0.53 * ey;
          vec2 d = abs(vUv - uReveal.zy);
          float mx = 1.0 - smoothstep(hx - 0.06, hx, d.x);
          float my = 1.0 - smoothstep(hy - max(0.002, 0.08 * ey), hy, d.y);
          float rm = mx * my * step(0.0005, rr);
          // The slit itself: a thin line of light that fades as the room opens
          float edge = (1.0 - smoothstep(0.0, 0.003 + 0.01 * ey, abs(d.y - hy))) * mx * (1.0 - ey) * step(0.0005, rr);
          c = mix(uCRevBg, c * (0.35 + 0.65 * ey) , rm) + uCRevEdge * edge * 0.55;
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const compScene = passScene(compMat)

  // ---- Textures ----
  // Files come from assets.ts, already decoded off the main thread (createImageBitmap, file texels, no conversion or
  // premultiplication, flipY false)
  const texOf = (bmp: ImageBitmap, srgb = false, repeat = false) => {
    const x = new THREE.Texture(bmp as unknown as HTMLImageElement); x.needsUpdate = true
    x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; x.anisotropy = ANISO; x.flipY = false
    x.minFilter = THREE.LinearMipmapLinearFilter; x.generateMipmaps = true
    if (repeat) x.wrapS = x.wrapT = THREE.RepeatWrapping
    return x
  }
  const SRGB = new Set(['lm_sun', 'lm_sky', 'cha_col', 'pcb_col', 'perf_alb'])
  const NOREP = new Set(['lm_sun', 'lm_sky', 'ao_rack', 'ao_face', 'ao_sled'])
  const texLot = async (L: Record<string, Promise<ImageBitmap>>, names: readonly string[]) => {
    const bm = await Promise.all(names.map((n) => L[n]))
    const o: Record<string, THREE.Texture> = {}
    names.forEach((n, i) => { o[n] = texOf(bm[i], SRGB.has(n), !NOREP.has(n)) })
    return o
  }
  const texs: THREE.Texture[] = []

  // ---- Materials: one sun and fog patch shared by every physical material ----
  const wearU = { value: null as THREE.Texture | null }
  // Per-material options (defines):
  // - WEAR: close-up wear baked in Blender (wear_fx: R fingerprints, G wipes, B fine dust), in object-relative world
  //   coordinates (the pattern follows the sled, one seed per instance);
  // - EDGE_AA: specular anti-aliasing of bevels. Plate edges are under a pixel tall and reflect the ceiling slit, so
  //   their sharp highlights alias. A facet that does not face the camera (normal off +z) gets a matte coat and a
  //   machined-edge roughness;
  // - BRUSH: horizontal anisotropic brushing, tangent computed in world space (UV tangents gave NaNs);
  // - all: highlights are clamped before the MSAA resolve (a sub-pixel glint no longer stair-steps).
  const sunned = <M extends THREE.MeshStandardMaterial>(m: M, extra?: { decl?: string; vert?: string; frag?: string; uniforms?: Record<string, THREE.IUniform> }, key = '', opts: { wear?: number; edge?: boolean; brush?: boolean } = {}) => {
    m.defines = { ...(m.defines ?? {}) }
    if (opts.wear) { m.defines.WEAR = ''; }
    if (opts.edge) m.defines.EDGE_AA = ''
    if (opts.brush) m.defines.BRUSH = ''
    const wk = { value: opts.wear ?? 0 }
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, shared, extra?.uniforms ?? {}, { tWear: wearU, uWearK: wk })
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWearP; varying vec3 vLN;\n#ifdef FLATN\nvarying vec3 vOP;\n#endif\n' + (extra?.decl ?? ''))
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (extra?.vert ?? ''))
        .replace('#include <project_vertex>', `#include <project_vertex>
{ mat4 M_ = modelMatrix;
#ifdef USE_INSTANCING
M_ = modelMatrix * instanceMatrix;
#endif
vec4 wq_ = M_ * vec4(transformed, 1.0); vWP = wq_.xyz;
vWearP = wq_.xyz - M_[3].xyz + vec3(fract(M_[3].xy * vec2(3.17, 5.71)), 0.0);
vLN = mat3(M_) * objectNormal;
#ifdef FLATN
vOP = transformed;
#endif
}`)
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWearP; varying vec3 vLN;\n#ifdef FLATN\nvarying vec3 vOP;\n#endif\nuniform sampler2D tWear; uniform float uWearK; vec3 fx_ = vec3(0.0);\n#define GZ_ ' + GZ.toFixed(3) + '\n#define ER_ ' + ER.toFixed(3) + '\n' + (extra?.decl ?? '').replace(/attribute[^;]*;/g, '') + GLSL_SUN + GLSL_FOG + GLSL_PAL)
        .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef WEAR
{ vec3 an_ = abs(normalize(vLN)); vec2 wuv_ = an_.y > 0.7 ? vWearP.xz : an_.x > 0.7 ? vWearP.zy : vWearP.xy;
  fx_ = texture2D(tWear, wuv_ * 4.6).rgb * uWearK;
  diffuseColor.rgb = mix(diffuseColor.rgb, uPWear, clamp(fx_.b * 0.32 + fx_.g * 0.04, 0.0, 1.0)); }
#endif`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef EDGE_AA
// Fine relief (perforations, brushing) fades out once a pixel covers more than a millimetre: beyond that it can only
// produce moire and glints that jump between frames
{ float fp_ = length(fwidth(vWP)); normal = normalize(mix(normal, nonPerturbedNormal, smoothstep(0.0007, 0.0022, fp_))); }
#endif`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef WEAR
material.roughness = clamp(material.roughness + fx_.r * 0.12 + fx_.g * 0.06, 0.0, 1.0);
#ifdef USE_CLEARCOAT
material.clearcoatRoughness = clamp(material.clearcoatRoughness + fx_.r * 0.34 + fx_.g * 0.16 + fx_.b * 0.22, 0.0, 1.0);
#endif
#endif
#ifdef EDGE_AA
{
#ifdef FLATN
  // Glass slab: geometric normal (derivatives), not the smoothed vertex normal, taken in facade object space so a
  // pulled-out, rotated sled keeps a front face instead of being treated as an edge
  float side_ = 1.0 - smoothstep(0.82, 0.975, abs(normalize(cross(dFdx(vOP), dFdy(vOP))).z));
#else
  float side_ = 1.0 - smoothstep(0.82, 0.975, abs(normalize(vLN).z));
#endif
  material.roughness = max(material.roughness, mix(material.roughness, ER_, side_));
#ifdef USE_CLEARCOAT
  material.clearcoat *= 1.0 - 0.92 * side_;
  material.clearcoatRoughness = mix(material.clearcoatRoughness, ER_, side_);
#endif
}
#endif
#ifdef USE_ANISOTROPY
{ vec3 tx_ = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  vec3 T_ = tx_ - normal * dot(tx_, normal); float l_ = length(T_);
  T_ = l_ > 1e-3 ? T_ / l_ : normalize(cross(normal, vec3(0.0, 0.0, 1.0)) + vec3(1e-3, 0.0, 0.0));
  material.anisotropyT = T_; material.anisotropyB = normalize(cross(normal, T_));
  material.alphaT = mix(pow2(material.roughness), 1.0, pow2(material.anisotropy)); }
#endif`)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( FLATN ) && defined( RE_IndirectSpecular )
// Polished black glass stays dark at grazing angles (Fresnel towards 1 kept low); unchanged head-on
radiance *= mix(GZ_, 1.0, smoothstep(0.12, 0.55, abs(dot(normal, geometryViewDir))));
#endif`)
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= sunMask(vWP);'))
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (extra?.frag ?? ''))
        .replace('#include <fog_fragment>', `{ float mx_ = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b); if (mx_ > 3.0) gl_FragColor.rgb *= (3.0 + log2(mx_ - 2.0)) / mx_; }
gl_FragColor.rgb = hfog(gl_FragColor.rgb, vWP);`)
    }
    m.customProgramCacheKey = () => 'sun' + key + (opts.wear ? 'w' : '') + (opts.edge ? 'e' : '') + (opts.brush ? 'b' : '')
    return m
  }
  let lacRgh: THREE.Texture | null = null, alNor: THREE.Texture | null = null, alRgh: THREE.Texture | null = null
  // ambientCG CC0 textures in "tile" coordinates (1 = 5 cm); one copy per repeat (the source, and the GPU upload, stay unique)
  const T: Record<string, THREE.Texture | null> = { powN: null, powR: null, chaC: null, chaN: null, chaR: null, brsN: null, perfN: null, perfA: null }
  const rep = (t: THREE.Texture | null, r: number) => { if (!t) return null; const c = t.clone(); c.repeat.set(r, r); c.needsUpdate = false; return c }
  // Drawn emissives (lines in the folds, micro LEDs under smoked glass, side windows): unlit materials that move slowly
  // (no blinking: waves of several seconds)
  const glowVS = (pull: boolean) => /* glsl */`attribute float aPull; attribute float aDim; varying vec2 vUv; varying vec3 vWP; varying float vDim;
    void main(){ vUv = uv; vec3 p = position; ${pull ? 'p.z += aPull / max(1e-6, length(instanceMatrix[2].xyz)); vDim = aDim;' : 'vDim = 0.0;'}
      vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`
  const glowMat = (frag: string, pull: boolean) => new THREE.ShaderMaterial({ uniforms: { ...shared }, vertexShader: glowVS(pull), fragmentShader: /* glsl */`varying vec2 vUv; varying vec3 vWP; varying float vDim;
    ${GLSL_SUN}
    ${GLSL_FOG}
    ${GLSL_PAL}
    void main(){ vec3 c = vec3(0.0); ${frag} c *= max(0.0, 1.0 - vDim * 0.75); gl_FragColor = vec4(hfog(c, vWP), 1.0); }` })
  // Light line in the fold: a slow wave across the wall (14 s)
  const FILET = `float w_ = 0.5 + 0.5 * sin(uTime * 0.45 - vWP.x * 1.7 - vWP.y * 0.9);
    c = uPFilet * (0.55 + 0.45 * w_) * 1.3;`
  // Micro LEDs under smoked glass (4 mm dot matrix): slow waves of light; far away the matrix fades to its average (no moire)
  const MICRO = `vec2 g_ = vec2(vUv.x * 160.0, vUv.y * 4.0); vec2 f_ = fract(g_) - 0.5; vec2 id_ = floor(g_);
    float dot_ = smoothstep(0.36, 0.18, length(f_ * vec2(1.0, 1.0)));
    float aa_ = smoothstep(0.35, 0.9, length(fwidth(g_)));
    float n_ = texture2D(tNoise2, vec2(id_.x * 0.013 - uTime * 0.012 + vWP.x * 0.05, id_.y * 0.11 + uTime * 0.004)).r;
    float on_ = smoothstep(0.42, 0.72, n_);
    c = uPMicro * 0.004 + uPMicro * mix(dot_, 0.32, aa_) * on_ * 1.4;
    c += uPGlassSun * 0.1 * sunMask(vWP) * 0.3;`
  // Side windows: the heat of the rack seen inside, dark edge, slow breathing
  const PERF = `vec2 e_ = min(vUv, 1.0 - vUv); float rim_ = smoothstep(0.0, 0.22, min(e_.x * 1.7, e_.y));
    float n_ = texture2D(tNoise2, vWP.zy * 0.35 + vec2(0.0, -uTime * 0.01)).g;
    c = uPPerf * 0.002 + uPPerf * rim_ * (0.035 + 0.05 * smoothstep(0.35, 0.75, n_)) * (1.0 - 0.4 * smoothstep(0.4, 2.0, vWP.y));
    // Side cut-outs glow from inside in Arc blue, with a slow, faint pulse (4.2 s, phase-shifted per rack). Never green,
    // amber or red (reserved for LEDs). Reduced motion: steady glow
    { float ph_ = floor(vWP.x / 0.75 + 0.5) * 1.9;
      float pu_ = ${REDUCED ? '0.5' : '0.5 + 0.5 * sin(uTime * 1.496 + ph_)'};
      c += vec3(0.042, 0.147, 1.0) * rim_ * (0.05 + 0.07 * pu_) * (1.0 - 0.35 * smoothstep(0.4, 2.0, vWP.y)); }`
  const PS: Record<string, THREE.MeshStandardMaterial> = {}
  /** Materials the palette re-tints (by Blender material name) */
  const palMats: { k: string; m: THREE.MeshStandardMaterial }[] = []
  function makeMats(ao: THREE.Texture | null, key: string, pcb?: THREE.Texture[]) {
    // Racks and facades are seen head-on: their bevels get specular AA; the replayed sled, seen close from above, gets
    // close-up wear
    const edge = key !== 'sled', near = key === 'sled' ? 0.35 : 0.5
    const std = (c: string, metal: number, rough: number, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}, op: { wear?: number; brush?: boolean } = {}) =>
      sunned(new THREE.MeshPhysicalMaterial({ color: c, metalness: metal, roughness: rough, aoMap: ao, aoMapIntensity: 1, ...o }), undefined, key, { edge, ...op })
    const out: Record<string, THREE.MeshStandardMaterial> = {
      // Black lacquer over aluminium: the clear coat carries the sharp reflection, the lacquer below is satin and brushed
      anod: std('#1d1d1f', 0.25, 0.42, { roughnessMap: lacRgh, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.0, anisotropy: 0.35 }, { wear: near, brush: true }),
      graphite: std('#1a1b1e', 0.3, 0.62, { roughnessMap: lacRgh }, { wear: near }),
      al: std('#a6acb3', 1, 0.3, { roughnessMap: alRgh, normalMap: alNor, normalScale: new THREE.Vector2(0.25, 0.25), anisotropy: 0.6 }, { wear: near * 0.6, brush: true }),
      al_bead: std('#7b8087', 1, 0.42, { roughnessMap: alRgh, normalMap: alNor, normalScale: new THREE.Vector2(0.35, 0.35) }, { wear: near * 0.6 }),
      // Sled layers readable in close-up (Xeon with nickel lid, chips and DIMMs, gold contacts, green board); chip black at
      // 0.05 albedo so they catch the service light
      chip: std('#17181b', 0.15, 0.38, { clearcoat: 0.5, clearcoatRoughness: 0.25 }), fan: std('#141518', 0, 0.55), substrate: std('#2c3a26', 0.05, 0.45, { clearcoat: 0.6, clearcoatRoughness: 0.3 }),
      copper: std('#d29470', 1, 0.3), gold: std('#e8bb6e', 1, 0.22, { anisotropy: 0.3 }, { brush: true }), nickel: std('#cdd0d3', 1, 0.2, { anisotropy: 0.5 }, { brush: true, wear: near * 0.5 }),
      plate: std('#26292e', 0.7, 0.32, { roughnessMap: lacRgh }, { wear: near * 0.6 }), inlay: std('#b4b9c0', 1, 0.22), arc_inlay: std('#c2c8d0', 1, 0.22),
      // ambientCG sources: powder-coated steel (Metal028), anodised metal (Metal042A), metal foam (AcousticFoam001 relief),
      // matte tile for the tops
      pow: std('#121213', 0.45, 0.78, { roughnessMap: rep(T.powR, 0.25), normalMap: rep(T.powN, 0.25), normalScale: new THREE.Vector2(0.5, 0.5) }, { wear: near * 0.5 }),
      cha: std('#b9a37c', 1, 0.36, { roughnessMap: rep(T.chaR, 0.17), normalMap: rep(T.chaN, 0.17), normalScale: new THREE.Vector2(0.1, 0.1) }, { wear: near * 0.7 }),
      // Foam: fine random grain (Metal042A hammered normal tightened to 2 cm; the AcousticFoam001 relief made regular stripes)
      foam: std('#7c7f9a', 1, 0.52, { normalMap: rep(T.chaN, 2.6), normalScale: new THREE.Vector2(0.9, 0.9) }, { wear: near * 0.3 }),
      tile: std('#2c2926', 0.3, 0.64, { roughnessMap: rep(T.powR, 0.4), normalMap: rep(T.powN, 0.4), normalScale: new THREE.Vector2(0.3, 0.3) }, { wear: near * 0.4 }),
      // Perforated powder-coated steel (top, lower bezel): 3.2 mm round holes on a 5 mm pitch, 5 cm tile (perf_nor, perf_alb)
      perfs: std('#3a3f47', 0.55, 0.5, { map: rep(T.perfA, 1), normalMap: rep(T.perfN, 1), normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: rep(T.powR, 0.25) }, { wear: near * 0.4 }),
      ice: std('#222833', 0.5, 0.28), light: std('#151719', 0, 0.5), cable: std('#101112', 0, 0.55),
      pcb: std('#9a9a9a', 0.05, 1, pcb ? { map: pcb[0], normalMap: pcb[1], normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: pcb[2], clearcoat: 0.45, clearcoatRoughness: 0.32 } : {}),
    }
    // Seen from above, the brushed aluminium lid reflects the whole ceiling; at full intensity it went white, so it is
    // toned down to a grey-blue aluminium that keeps its brushing
    if (key === 'sled') { envGain(out.al, 0.25); envGain(out.al_bead, 0.3) }
    for (const [k, m] of Object.entries(out)) palMats.push({ k, m })
    if (key === 'rack') {
      out.filet = glowMat(FILET, false) as unknown as THREE.MeshStandardMaterial
      out.microled = glowMat(MICRO, false) as unknown as THREE.MeshStandardMaterial
      out.perf = glowMat(PERF, false) as unknown as THREE.MeshStandardMaterial
    }
    return out
  }

  // ---- The room ----
  // A dark modern server room: raised floor with 60 cm tiles (perforated in front of the racks), dark ceiling with the
  // light slit, three distant rows of racks behind the foreground row and one behind the visitor, cable trays, linear
  // luminaires above the aisles. Two Cycles lightmaps (the slit alone; luminaires and door glow). What cannot be baked is
  // drawn here: tile joints and tints, perforations, blurred luminaire reflections in the satin floor, LEDs behind the
  // perforated doors of distant racks, luminaire tubes. Everything is a function of position (no extra attribute, one
  // program)
  const roomU = { tSun: { value: null as THREE.Texture | null }, tSky: { value: null as THREE.Texture | null }, tConc: { value: null as THREE.Texture | null }, tConcN: { value: null as THREE.Texture | null }, uLm: { value: new THREE.Vector2(LM.sun, LM.sky) }, uRoomK: { value: 1 } }
  const roomMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, ...roomU },
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vWP; varying vec3 vN;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`uniform sampler2D tSun, tSky, tConc, tConcN; uniform vec2 uLm; uniform float uRoomK; varying vec2 vUv; varying vec3 vWP; varying vec3 vN;
      ${GLSL_SUN}
      ${GLSL_FOG}
      ${GLSL_PAL}
      vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
      float h21(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
      // Grid joint (g in grid units): 1 in the tile, 0 in the joint, anti-aliased
      float seam(vec2 g, float w){ vec2 f = abs(fract(g + 0.5) - 0.5); vec2 fw = fwidth(g) * 0.75;
        vec2 k = smoothstep(vec2(w) - fw, vec2(w) + fw, f); return k.x * k.y; }
      // Luminaires: 1.5 m segments every 1.8 m from x = -7.1, above the aisles
      const float LUM_Y = 3.55;
      float lumAt(vec2 h, float blur){
        float sx = fract((h.x + 7.1) / 1.8) * 1.8;
        float on = smoothstep(-blur, blur, sx) * (1.0 - smoothstep(1.5 - blur, 1.5 + blur, sx)) * step(-7.2, h.x) * step(h.x, 7.4);
        float z = 0.0;
        z += 1.0 - smoothstep(0.05 - blur, 0.05 + blur, abs(h.y + 2.15));
        z += 1.0 - smoothstep(0.05 - blur, 0.05 + blur, abs(h.y + 5.3));
        z += 1.0 - smoothstep(0.05 - blur, 0.05 + blur, abs(h.y + 8.5));
        z += 1.0 - smoothstep(0.05 - blur, 0.05 + blur, abs(h.y + 11.3));
        z += 1.0 - smoothstep(0.05 - blur, 0.05 + blur, abs(h.y - 1.55));
        z += 1.0 - smoothstep(0.05 - blur, 0.05 + blur, abs(h.y - 3.2));
        return on * z * 0.1 / max(0.1, blur * 2.0 + 0.1);
      }
      void main(){
        vec3 an = abs(vN);
        vec2 tc = an.y > 0.5 ? vWP.xz : an.x > 0.5 ? vWP.zy : vWP.xy;
        float d = texture2D(tConc, tc * 0.8).r;
        vec3 nd = texture2D(tConcN, tc * 0.8).xyz * 2.0 - 1.0;
        float sunL = clouds(vWP);
        vec3 s = lin(texture2D(tSun, vUv).rgb) * uLm.x * sunL * uPLmSun;
        vec3 k = lin(texture2D(tSky, vUv).rgb) * uLm.y * uPLmSky;
        float rel = 1.0 + 0.7 * dot(nd.xy, normalize(vec2(-uSunTo.x, uSunTo.y)));
        float alb = 0.8 + 0.4 * d;
        vec3 em = vec3(0.0);
        vec3 V = normalize(vWP - cameraPosition);
        if (vN.y > 0.5 && vWP.y < 0.02) {
          // Raised floor: 60 cm tiles, 3 mm joints, each tile its own tint and sheen
          vec2 g = vWP.xz / 0.6; vec2 id = floor(g);
          float sm_ = seam(g, 0.006);
          float ht = h21(id + 17.0);
          alb = (0.86 + 0.22 * ht) * (0.85 + 0.3 * d) * mix(0.3, 1.0, sm_);
          // Perforated tiles (cold aisles: in front of the foreground row and each distant row)
          float pz = step(0.0, vWP.z) * step(vWP.z, 1.2) * step(-0.6, vWP.x) * step(vWP.x, 3.0)
                   + step(-3.2, vWP.z) * step(vWP.z, -2.6) + step(-6.4, vWP.z) * step(vWP.z, -5.8) + step(-9.6, vWP.z) * step(vWP.z, -9.0);
          float perf = 0.0;
          if (pz > 0.5) {
            vec2 q = vWP.xz / 0.025; vec2 fq = fract(q) - 0.5;
            float fwq = length(fwidth(q));
            float hole = 1.0 - smoothstep(0.26 - fwq * 0.5, 0.26 + fwq * 0.5, length(fq));
            // inset: 3 cm without holes at the tile edge
            vec2 fe = abs(fract(g + 0.5) - 0.5);
            float inner = step(max(fe.x, fe.y), 0.45);
            perf = mix(hole, 0.21, smoothstep(0.35, 0.9, fwq)) * inner;
            alb *= 1.0 - 0.75 * perf;
          }
          // Blurred reflection of the luminaires in the satin floor (blur grows with distance to the luminaire)
          vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
          float t = (LUM_Y - vWP.y) / max(R.y, 0.02);
          vec2 hh = vWP.xz + R.xz * t;
          float blur = 0.03 + 0.06 * t * (0.6 + 0.8 * ht);
          float fr = 0.04 + 0.96 * pow(1.0 - max(R.y, 0.0), 5.0);
          em += vec3(0.80, 0.88, 1.0) * lumAt(hh, blur) * fr * 0.55 * sm_ * (1.0 - perf);
        } else if (vN.y < -0.5 && abs(vWP.y - LUM_Y) < 0.004) {
          // Luminaire diffuser
          float l = lumAt(vWP.xz, 0.004);
          em += vec3(0.82, 0.9, 1.0) * 1.5 * clamp(l, 0.0, 1.0);
        } else if (vN.y < -0.5 && vWP.y > 4.4) {
          // Ceiling: 60 cm acoustic tiles
          alb *= mix(0.55, 1.0, seam(vWP.xz / 0.6, 0.01)) * (0.9 + 0.2 * h21(floor(vWP.xz / 0.6)));
        } else if (an.z > 0.9 && vWP.y > 0.07 && vWP.y < 1.94 && (abs(vWP.z + 3.2) < 0.02 || abs(vWP.z + 6.4) < 0.02 || abs(vWP.z + 9.6) < 0.02 || abs(vWP.z - 4.3) < 0.02)) {
          // Perforated door of a distant rack: behind the sheet, 1U servers and their LEDs
          float x0 = vWP.z > 0.0 ? -4.0 : -7.0;
          float rx = (vWP.x - x0) / 0.6; float rid = floor(rx); float u = fract(rx);
          float uy = (vWP.y - 0.07) / 0.0445; float uid = floor(uy); float v = fract(uy);
          float hs = h21(vec2(rid * 7.0 + floor(vWP.z), uid));
          float present = step(0.45, hs);
          // Server fronts, barely visible through the sheet
          alb *= mix(0.6, 1.25, present * smoothstep(0.0, 0.06, v) * (1.0 - smoothstep(0.94, 1.0, v)));
          // Two LEDs on the left of each server, a third on some
          float fpx = length(fwidth(vWP.xy));
          float r = max(0.0022, fpx * 0.7);
          float e = 0.0;
          for (int j = 0; j < 3; j++) {
            float fj = float(j);
            vec2 c = vec2(x0 + (rid + 0.1 + 0.035 * fj + 0.5 * floor(fract(hs * 7.3) * 2.0) * step(fj, 1.5) + (fj > 1.5 ? 0.62 : 0.0)) * 0.6, 0.07 + (uid + 0.5) * 0.0445);
            float hj = h21(vec2(hs * 91.0 + fj, rid));
            // An LED changes state every 2 to 6 s, with a fade (never a blink)
            float per = 2.0 + 4.0 * hj; float ph = uTime / per + hj * 13.0;
            float st = h21(vec2(floor(ph), hj * 57.0)); float st2 = h21(vec2(floor(ph) + 1.0, hj * 57.0));
            float lv = mix(st, st2, smoothstep(0.85, 1.0, fract(ph)));
            float on = smoothstep(0.35, 0.55, lv) * present * step(fj < 1.5 ? 0.0 : 0.6, hj);
            float dd = length(vWP.xy - c);
            e += on * (0.0022 * 0.0022) / (r * r) * (1.0 - smoothstep(r * 0.6, r * 1.2, dd));
          }
          vec3 col = mix(vec3(0.42, 0.66, 1.0), vec3(0.35, 1.0, 0.55), step(0.82, hs) * 0.8);
          // During film capture scene time is frozen; these light points in the dark of the far bays read as motionless
          // particles: turned off for the capture
          em += col * e * (0.45 + 0.6 * fract(hs * 31.0)) * ${TOURNAGE ? '0.0' : '1.0'};
        } else if (an.x > 0.9 && abs(vWP.x) > 7.5 || an.z > 0.9 && (vWP.z < -12.1 || vWP.z > 5.5)) {
          // Walls: 1.2 m acoustic panels
          alb *= mix(0.6, 1.0, seam(vec2((an.x > 0.9 ? vWP.z : vWP.x) / 1.2, vWP.y / 4.6 + 0.5), 0.004));
        }
        vec3 c = (s * rel + k) * alb + em;
        // The top of the far room (cable trays, luminaires) stays in shadow: it sits behind the headline
        c *= 1.0 - 0.65 * smoothstep(2.1, 2.4, vWP.y) * smoothstep(-1.6, -3.0, vWP.z);
        // The room darkens on the first pinned page
        gl_FragColor = vec4(hfog(c * 1.15, vWP) * uRoomK, 1.0);
      }`,
  })

  // ---- Facades: five instanced parts (body, grille, plate, handle, light guide) ----
  const atlas = new PlateAtlas()
  const faceAttr = { led: new Float32Array(NSLOTS * 4), pull: new Float32Array(NSLOTS), dim: new Float32Array(NSLOTS) }
  const ledA = new THREE.InstancedBufferAttribute(faceAttr.led, 4).setUsage(THREE.DynamicDrawUsage)
  const pullA = new THREE.InstancedBufferAttribute(faceAttr.pull, 1).setUsage(THREE.DynamicDrawUsage)
  const dimA = new THREE.InstancedBufferAttribute(faceAttr.dim, 1).setUsage(THREE.DynamicDrawUsage)
  const faceMeshes: THREE.InstancedMesh[] = []
  const faceExtra = {
    decl: 'attribute vec4 aLed; attribute float aPull; attribute float aDim; varying vec4 vLed; varying float vDim; varying vec3 vLP;',
    // Facades come from a meshopt-quantised glb (dequantisation scale in the node matrix, hence in instanceMatrix): the
    // drawer offset is expressed in node units, otherwise the facade barely moves with the drawer
    vert: 'transformed.z += aPull / max(1e-6, length(instanceMatrix[2].xyz)); vLed = aLed; vDim = aDim; vLP = position;',
    // LED halo on the lacquer and the chamfer around the slit (light spills into the material)
    frag: `{ vec2 lc = vec2(${((FACE.LED[0] + FACE.LED[1]) / 2).toFixed(4)}, ${((FACE.LED[2] + FACE.LED[3]) / 2).toFixed(4)}); vec2 dd = vLP.xy - lc; dd.x *= 2.2; float r = length(max(abs(dd) - vec2(0.0, ${((FACE.LED[3] - FACE.LED[2]) / 2).toFixed(4)}), 0.0));
      // Light leaves the slit and spreads in the glass at three radii (2, 6 and 16 mm)
      totalEmissiveRadiance += vLed.rgb * vLed.a * (0.05 * exp(-r / 0.002) + 0.016 * exp(-r / 0.006) + 0.0045 * exp(-r / 0.016));
      // No light frame around the plate: only the letters glow (plates.ts)
      }
      diffuseColor.rgb *= 1.0 - vDim * 0.7;`,
  }
  const plateA = { txt: new Float32Array(NSLOTS * 4), tint: new Float32Array(NSLOTS * 4), size: new Float32Array(NSLOTS * 2) }
  const plTxtA = new THREE.InstancedBufferAttribute(plateA.txt, 4).setUsage(THREE.DynamicDrawUsage)
  const plTintA = new THREE.InstancedBufferAttribute(plateA.tint, 4).setUsage(THREE.DynamicDrawUsage)
  const plGeo = new THREE.PlaneGeometry(1, 1)
  plGeo.setAttribute('aTxt', plTxtA); plGeo.setAttribute('aTint', plTintA); plGeo.setAttribute('aPull', pullA); plGeo.setAttribute('aDim', dimA)
  plGeo.setAttribute('aSize', new THREE.InstancedBufferAttribute(plateA.size, 2))
  const plMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, tAtlas: { value: atlas.tex }, tGlow: { value: atlas.gtex }, uTrows: { value: TROWS } },
    vertexShader: PLATE_VS, fragmentShader: PLATE_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
  })
  // Title and LED sit flush with the glass (0.3 to 0.4 mm in front), pulled forward with a depth offset
  plMat.polygonOffset = true; plMat.polygonOffsetFactor = -1; plMat.polygonOffsetUnits = -4
  const plates = new THREE.InstancedMesh(plGeo, plMat, NSLOTS); plates.frustumCulled = false; plates.renderOrder = 2
  // Video landing: during film capture the plates stay empty (the HTML layer writes the names live)
  if (TOURNAGE) plates.visible = false
  // Plate background. In the title window two facade surfaces (face_body and face_plate) are nearly coplanar: at oblique
  // angles or in motion they z-fought into hatched pixel blocks. A matte opaque background, pulled forward by a depth
  // offset just behind the ink, closes the window (one instance per sled, one draw call)
  const backGeo = new THREE.PlaneGeometry(1, 1)
  backGeo.setAttribute('aPull', pullA); backGeo.setAttribute('aDim', dimA); backGeo.setAttribute('aSize', plGeo.getAttribute('aSize'))
  const backMat = new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */`attribute float aPull; attribute float aDim; attribute vec2 aSize; varying vec3 vWP; varying float vDim; varying vec2 vUv;
      void main(){ vDim = aDim; vUv = uv; vec3 p = position * vec3(aSize + 0.002, 1.0); p.z += aPull; vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`varying vec3 vWP; varying float vDim; varying vec2 vUv;
      ${GLSL_SUN}
      ${GLSL_FOG}
      ${GLSL_PAL}
      void main(){
        // Smoked glass: it reflects the top of the room and lets the plate background show through, very dark
        float sl_ = 0.5 + 0.5 * sin(uTime * 0.07 + vWP.x * 0.9 - vWP.y * 0.35);
        float band_ = smoothstep(0.55, 0.95, vUv.y + 0.35 * sl_ - 0.2) * (1.0 - smoothstep(0.95, 1.0, vUv.y));
        vec3 c = uPGlass0 + uPGlassSun * 0.05 * sunMask(vWP) + uPGlassGrad * 0.12 * (1.0 - vUv.y)
          + uPGlassBand * 0.10 * band_;
        c *= max(0.0, 1.0 - vDim * 0.7);
        gl_FragColor = vec4(hfog(c, vWP), 1.0);
      }`,
  })
  // Pulled in front of the facade by the depth offset, but without depth write: the ink (drawn after) is still tested
  // against the facade, never hidden by the background at grazing angles
  backMat.polygonOffset = true; backMat.polygonOffsetFactor = -1; backMat.polygonOffsetUnits = -2; backMat.depthWrite = false
  const backs = new THREE.InstancedMesh(backGeo, backMat, NSLOTS); backs.frustumCulled = false; backs.renderOrder = 1; backs.name = 'plate_back'
  // LED light guide: a frosted bar in the slit, warm core, full colour at the edges
  const ledGeo = new THREE.PlaneGeometry(1, 1)
  ledGeo.setAttribute('aLed', ledA); ledGeo.setAttribute('aPull', pullA); ledGeo.setAttribute('aDim', dimA)
  const ledMat = new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */`attribute vec4 aLed; attribute float aPull; attribute float aDim; varying vec4 vLed; varying vec2 vUv; varying float vDim; varying vec3 vWP;
      void main(){ vLed = aLed; vUv = uv; vDim = aDim; vec3 p = position; p.z += aPull; vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`varying vec4 vLed; varying vec2 vUv; varying float vDim; varying vec3 vWP;
      ${GLSL_SUN}
      ${GLSL_FOG}
      ${GLSL_PAL}
      void main(){
        vec2 q = vUv - 0.5;
        // A glowing slit, not a bar. Distance to its axis (a 5 x 59 mm capsule): a hot filament in the middle, dense light that
        // fades softly towards the edges and both ends
        vec2 m = q * vec2(${(FACE.LED[1] - FACE.LED[0]).toFixed(5)}, ${(FACE.LED[3] - FACE.LED[2]).toFixed(5)});
        float L = ${((FACE.LED[3] - FACE.LED[2]) / 2 - 0.004).toFixed(5)};
        float d = length(vec2(m.x, max(abs(m.y) - L, 0.0)));
        float fil = exp(-pow(d / 0.0007, 2.0)), body = exp(-d / 0.0014);
        vec3 c;
        if (vLed.a > 0.001) c = vLed.rgb * vLed.a * (0.25 + 0.9 * body + 0.9 * fil) + uPLedCore * fil * vLed.a * 0.35;
        else c = uPLedOff0 + uPLedOffG * smoothstep(0.1, 0.45, q.y) + uPLedOffSun * 0.06 * sunMask(vWP);
        c *= max(0.0, 1.0 - vDim * 0.6);
        gl_FragColor = vec4(hfog(c, vWP), 1.0);
      }`,
  })
  ledMat.polygonOffset = true; ledMat.polygonOffsetFactor = -1; ledMat.polygonOffsetUnits = -4
  const leds = new THREE.InstancedMesh(ledGeo, ledMat, NSLOTS); leds.frustumCulled = false
  // LED glow in the hazy air: a small, very faint additive veil
  const haloGeo = new THREE.PlaneGeometry(1, 1)
  haloGeo.setAttribute('aLed', ledA); haloGeo.setAttribute('aPull', pullA); haloGeo.setAttribute('aDim', dimA)
  const haloMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */`attribute vec4 aLed; attribute float aPull; attribute float aDim; varying vec4 vLed; varying vec2 vUv; varying float vDim;
      void main(){ vLed = aLed; vUv = uv; vDim = aDim; vec3 p = position; p.z += aPull; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0); }`,
    fragmentShader: /* glsl */`varying vec4 vLed; varying vec2 vUv; varying float vDim;
      // The LED air glow follows the slit (distance to its axis) and fades out before the quad edge (no clipped gaussian
      // rectangle next to each LED)
      void main(){ vec2 m = (vUv - 0.5) * vec2(0.09, 0.14);
        float d = length(vec2(m.x, max(abs(m.y) - 0.025, 0.0)));
        float f = max(0.0, exp(-d / 0.009) - exp(-0.044 / 0.009)) + 0.35 * max(0.0, exp(-d / 0.003) - exp(-0.044 / 0.003));
        float a = f * vLed.a * 0.016 * (1.0 - vDim * 0.8);
        if (a < 0.0002) discard; gl_FragColor = vec4(vLed.rgb * a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const halos = new THREE.InstancedMesh(haloGeo, haloMat, NSLOTS); halos.frustumCulled = false; halos.renderOrder = 6
  const faceBase = SLOTS.map((s) => new THREE.Matrix4().makeTranslation(s.x, s.base, 0))
  SLOTS.forEach((s, i) => {
    const l = ledOf3(s), p = plateOf(s)
    leds.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y, 0.0003), new THREE.Quaternion(), new THREE.Vector3(l.w - 0.0008, l.h - 0.0008, 1)))
    halos.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y, 0.004), new THREE.Quaternion(), new THREE.Vector3(0.09, 0.14, 1)))
    plateA.size[i * 2] = p.x1 - p.x0 - 0.004; plateA.size[i * 2 + 1] = 2 * p.th - 0.003
    plates.setMatrixAt(i, new THREE.Matrix4().makeTranslation((p.x0 + p.x1) / 2, p.y, 0.0004))
    backs.setMatrixAt(i, new THREE.Matrix4().makeTranslation((p.x0 + p.x1) / 2, p.y, -0.0016))
  })

  // ---- Arc light ring around the replayed sled during verification (second pinned page) ----
  // Blue light comes out of every gap around the facade (3 mm joint, with some spill onto neighbouring facades) and goes
  // round like a progress bar (uProg, at the pace of the hash cells); at the verdict (uOk) the whole ring turns green
  // (refused: red). The light spreads like the backlit titles (plates.ts): a soft gaussian core in the joint and three
  // exponential halos whose sum is compressed, so there is never a hard edge.
  const RM = 0.04
  const RING = { w: G.FW + 2 * RM, h: G.FT - G.FB + 2 * RM }
  const jointMat = new THREE.ShaderMaterial({
    uniforms: { uOn: { value: 0 }, uProg: { value: 0 }, uOk: { value: 0 }, uPulse: { value: 0 }, uTime: shared.uTime, uCol: { value: ARC_BLUE.clone().convertSRGBToLinear() }, uEnd: { value: new THREE.Color() } },
    vertexShader: /* glsl */`varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uOn, uProg, uOk, uTime, uPulse; uniform vec3 uCol, uEnd; varying vec2 vP;
      const vec2 HF = vec2(${(G.FW / 2).toFixed(5)}, ${((G.FT - G.FB) / 2).toFixed(5)});
      void main(){
        vec2 q = abs(vP) - HF;
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
        // Position along the loop (0 to 1), starting top left, clockwise
        vec2 c = clamp(vP, -HF, HF);
        float P = 2.0 * (HF.x + HF.y) * 2.0, sx = 2.0 * HF.x, sy = 2.0 * HF.y;
        float t;
        if (q.y >= q.x) t = vP.y > 0.0 ? (c.x + HF.x) : sx + sy + (HF.x - c.x);
        else t = vP.x > 0.0 ? sx + (HF.y - c.y) : 2.0 * sx + sy + (c.y + HF.y);
        t /= P;
        // The ring draws at the pace of the cells (nothing before the first); the lit part fades towards the head, the head is
        // slightly brighter; full loop: all lit
        float on = step(0.001, uProg);
        float lit = (uProg >= 0.999 ? 1.0 : smoothstep(uProg + 0.006, uProg - 0.04, t)) * on;
        float tip = exp(-pow((t - uProg) / 0.014, 2.0)) * on * (1.0 - step(0.999, uProg));
        lit = max(mix(lit, 1.0, uOk), tip * 0.8);
        if (lit < 0.002) discard;
        // Light profile, centred on the joint (1.5 mm off the facade)
        float sp = 1.0 + 0.5 * uPulse;
        float x = abs(d - 0.0015);
        float core = exp(-pow(x / (0.002 * sp), 2.0));
        float s = 0.55 * core + 0.45 * exp(-x / (0.0025 * sp)) + 0.2 * exp(-x / (0.007 * sp)) + 0.07 * exp(-x / (0.015 * sp));
        // On the facade (d < 0) the light only spreads a few millimetres, dimmer
        s *= d < 0.0 ? 0.6 * exp(d / 0.006) : 1.0;
        // Quad edge: the widest tail is already almost out, a soft window finishes it
        vec2 qe = abs(vP) - (HF + vec2(${RM.toFixed(3)}));
        s *= smoothstep(0.0, 0.028, -max(qe.x, qe.y));
        float I = 1.0 - exp(-1.7 * s);
        // Colour: a saturated tail (Arc sheet blue), a core that goes towards bluish white
        vec3 base = mix(uCol * 4.2 + vec3(0.05, 0.08, 0.35), uEnd * 2.2, uOk);
        vec3 hot = mix(vec3(0.78, 0.88, 1.0), mix(uEnd, vec3(1.0), 0.55), uOk) * 3.2;
        vec3 col = mix(base, hot, core * 0.25);
        float k = 0.6 * I * lit * uOn * (1.0 + 0.45 * uPulse);
        gl_FragColor = vec4(col * k, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const joint = new THREE.Mesh(new THREE.PlaneGeometry(RING.w, RING.h), jointMat); joint.visible = false; joint.renderOrder = 3; joint.name = 'arc_ring'

  // The replayed sled facade follows the sled out (it leaves its rails, rises and turns): for this slot only, the
  // instanced parts (glass, LED, title, halo) use the sled matrices
  const fOrig: THREE.Matrix4[] = [], fRel: THREE.Matrix4[] = []
  const fm4 = new THREE.Matrix4(), fInv = new THREE.Matrix4()
  let fSlot = -1
  function followFace(i: number) {
    const ms = [...faceMeshes, leds, plates, halos]
    if (fSlot >= 0 && fSlot !== i) { ms.forEach((m, k) => { m.setMatrixAt(fSlot, fOrig[k]); m.instanceMatrix.needsUpdate = true }); fSlot = -1 }
    if (i < 0) return
    if (fSlot !== i) {
      fSlot = i; fInv.copy(faceBase[i]).invert()
      ms.forEach((m, k) => { fOrig[k] ??= new THREE.Matrix4(); m.getMatrixAt(i, fOrig[k]); fRel[k] = (fRel[k] ?? new THREE.Matrix4()).multiplyMatrices(fInv, fOrig[k]) })
    }
    ms.forEach((m, k) => { m.setMatrixAt(i, fm4.multiplyMatrices(heroG.matrixWorld, fRel[k])); m.instanceMatrix.needsUpdate = true })
  }

  // ---- Replayed sled ----
  const heroG = new THREE.Group(); heroG.visible = false
  // meshopt quantises positions: every glb node carries a translation and a dequantisation scale; animate around the
  // original position (base), never overwrite it
  const parts: { o: THREE.Object3D; lo: number; hi: number; off: number; base: number; d: number; y: number; ax: number; az: number }[] = []
  let lid: THREE.Object3D | null = null, lidBase = 0
  // Top of the lid ribs; the thumb screws (0.0805) stay in front of the sheet, which starts 6 cm behind the facade
  const SHEET_REST = 0.0792
  const rails = new THREE.Group()
  // Pulled-out body of a hovered sled (its sides show when the drawer lifts)
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.4, metalness: 0.5 })
  sunned(bodyMat, undefined, 'body')
  palMats.push({ k: 'body', m: bodyMat })
  const body = new THREE.Mesh(new THREE.BoxGeometry(G.SW - 0.004, G.SH - 0.004, 1), bodyMat); body.visible = false
  // Arc glass sheet: a real 4 mm glass slab with softened edges (1.6 mm radius), rendered with transmission (three renders
  // the room behind it into a half-resolution target, only while the sheet is visible). The lid reads through it, tinted
  // and darkened by thickness (Beer-Lambert absorption towards Arc blue). An inner blue glow escapes mostly through the
  // polished edges. The official kit logo is placed last on the top face, as is.
  // Resting on the lid ribs (0.0792), the slab reaches the gap between sleds (0.0902): sliding in, it enters that gap
  // instead of passing under the facade above, and its light is what shows in that gap during the Arc check
  const SHEET = { w: 0.236, th: 0.011, z0: -(0.01 + 0.05), z1: -0.70 } // sled frame, before the group scale K
  const sheetU = { tLogo: { value: null as THREE.Texture | null }, uHeat: { value: 0 }, uLogoA: { value: 0 }, uBlue: { value: ARC_BLUE.clone().convertSRGBToLinear() } }
  const sheetMat = sunned(new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.86, 0.91, 1.0), metalness: 0, roughness: 0.03, transmission: 1, thickness: SHEET.th, ior: 1.52,
    attenuationColor: new THREE.Color('#5d78ff'), attenuationDistance: 0.02,
    transparent: true, depthWrite: false,
  }), {
    decl: 'varying vec3 vSLP; uniform sampler2D tLogo; uniform float uHeat, uLogoA; uniform vec3 uBlue;',
    vert: 'vSLP = position;',
    frag: `{ vec2 hs_ = vec2(${(SHEET.w / 2).toFixed(4)}, ${((SHEET.z0 - SHEET.z1) / 2).toFixed(4)});
      vec2 e2_ = hs_ - abs(vSLP.xz); float e_ = min(e2_.x, e2_.y);
      float side_ = 1.0 - smoothstep(0.35, 0.8, abs(normalize(vLN).y));
      float pipe_ = exp(-e_ / 0.006);
      float br_ = 0.86 + 0.14 * sin(uTime * 1.3) * (0.6 + 0.4 * sin(uTime * 0.37));
      // Glow: light scattered in the bulk is not uniform (bubbles and streaks of cast glass, drifting very slowly); it
      // gathers towards the edges, and the edges shine
      float vn_ = texture2D(tNoise2, vSLP.xz * 3.1 + vec2(uTime * 0.004, 0.0)).r * 0.6 + texture2D(tNoise2, vSLP.xz * 9.0 - vec2(0.0, uTime * 0.006)).g * 0.4;
      // The bulk barely glows (it read milky): the glass stays clear, light is guided to the edges, which keep their full glow
      float mass_ = 0.01 + 0.045 * smoothstep(0.3, 0.8, vn_);
      // Edges burn a light electric blue that goes white at the core; a bluish-white Fresnel rim catches the light
      vec3 vdir_ = normalize(cameraPosition - vWP);
      float fr_ = pow(1.0 - abs(dot(normalize(vLN), vdir_)), 3.0);
      vec3 hot_ = mix(uBlue * 2.2, vec3(0.75, 0.86, 1.0), 0.35);
      totalEmissiveRadiance += (uBlue * (mass_ * 1.0 + 2.4 * pipe_) + hot_ * (2.4 * side_ + 0.9 * pipe_ * pipe_) + vec3(0.6, 0.72, 1.0) * fr_ * (0.12 + 0.5 * pipe_)) * (0.45 + 1.15 * uHeat * br_); }`,
    uniforms: sheetU,
  }, 'sheet')
  envGain(sheetMat, Q.has('sg') ? Number(Q.get('sg')) : 0.55) // under the luminaires, streaked highlights rather than a milky veil
  {
    const prev = sheetMat.onBeforeCompile
    sheetMat.onBeforeCompile = (sh, r) => {
      prev(sh, r)
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
        // The Arc kit logo on the top face, as is, drawn last (sampled in every fragment, outside any branch: derivatives stay
        // correct and the logo frame edge shows no mipmap dotted line)
        {
          vec2 lp_ = vSLP.xz;
          // Width 0.19 by 0.236: the kit clear space (a third of the logo height) stays empty all around
          vec2 lu_ = vec2(lp_.x / 0.19 + 0.5, 0.5 - lp_.y / (0.19 * 171.0 / 500.0));
          vec4 lg_ = texture2D(tLogo, clamp(lu_, 0.0, 1.0));
          float in_ = step(0.0, lu_.x) * step(lu_.x, 1.0) * step(0.0, lu_.y) * step(lu_.y, 1.0) * step(0.5, vLN.y);
          // As is, opaque, untinted: kit white, above the bulk glow
          outgoingLight = mix(outgoingLight, lg_.rgb * 1.6, lg_.a * uLogoA * in_);
          diffuseColor.a = mix(diffuseColor.a, uLogoA, lg_.a * in_);
        }
        #include <opaque_fragment>`)
    }
  }
  const sheet = new THREE.Mesh(new RoundedBoxGeometry(SHEET.w, SHEET.th, SHEET.z0 - SHEET.z1, 4, 0.0022), sheetMat)
  sheet.visible = false; sheet.renderOrder = 9

  // ---- Dust: GPU particles carried by the wind, lit only in the sun ----
  const DN = MOBILE_LIGHT() ? 3500 : 7000
  const dGeo = new THREE.BufferGeometry()
  {
    const pos = new Float32Array(DN * 3), rnd = new Float32Array(DN * 4)
    for (let k = 0; k < DN; k++) { pos[k * 3] = Math.random(); pos[k * 3 + 1] = Math.random(); pos[k * 3 + 2] = Math.random(); for (let c = 0; c < 4; c++) rnd[k * 4 + c] = Math.random() }
    dGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); dGeo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4))
    dGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100)
  }
  const dustU = { uBoxC: { value: new THREE.Vector3() }, uBoxS: { value: new THREE.Vector3(3.2, 2.6, 3.0) }, uPx: { value: DPR }, uWind: { value: new THREE.Vector3(0.05, 0.004, -0.02) } }
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, ...dustU },
    vertexShader: /* glsl */`attribute vec4 aRnd; uniform vec3 uBoxC, uBoxS, uWind; uniform float uPx; varying float vB; varying float vA;
      ${GLSL_SUN}
      void main(){
        // Wind: slow drift plus two reads of a scrolling noise (soft gusts, eddies)
        vec3 seed = position * uBoxS;
        vec2 w = texture2D(tNoise2, seed.xz * 0.11 + vec2(uTime * 0.013, uTime * 0.006)).rg - 0.5;
        vec2 w2 = texture2D(tNoise2, seed.xy * 0.23 - vec2(uTime * 0.021, 0.0)).ba - 0.5;
        // Gusts vary over 20 to 40 s; each grain follows its own small eddy and rises gently before settling (lift); the mean
        // drift is slow, the air carries more than it pushes
        float gust = 0.55 + 0.3 * sin(uTime * 0.16 + seed.x * 0.4) + 0.15 * sin(uTime * 0.043 + 1.7);
        float ph = aRnd.y * 6.2832;
        vec3 swirl = vec3(sin(uTime * (0.21 + 0.1 * aRnd.x) + ph), 0.8 * sin(uTime * (0.13 + 0.07 * aRnd.z) + ph * 1.7), cos(uTime * (0.17 + 0.09 * aRnd.w) + ph)) * (0.025 + 0.035 * aRnd.x);
        vec3 drift = uWind * uTime * (0.35 + 0.5 * aRnd.x) + vec3(w.x * 0.42 + w2.x * 0.14, w2.y * 0.2 + 0.05 * sin(uTime * 0.11 + ph), w.y * 0.34) * (0.6 + 0.6 * gust) + swirl;
        // Gust fronts cross the room along x (about 0.4 m/s): grains they touch are pushed about ten centimetres, then fall
        // back one after another
        float fr = sin(seed.x * 0.55 + seed.z * 0.2 - uTime * 0.22);
        drift += vec3(1.0, 0.22, -0.35) * 0.13 * smoothstep(0.2, 1.0, fr) * (0.6 + 0.4 * aRnd.y);
        vec3 p = mod(seed + drift - (uBoxC - uBoxS * 0.5), uBoxS) + uBoxC - uBoxS * 0.5;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float s = sunMask(p);
        // A grain spins: it glints when one face catches the sun (slow and soft; a fast glint reads as flicker)
        float glint = 0.75 + 0.35 * sin(uTime * (0.35 + 0.5 * aRnd.w) + aRnd.x * 40.0);
        vB = s * (0.45 + 1.1 * aRnd.z) * glint;
        // Grains fade at the edge of the box (no pop when they wrap)
        vec3 bq = abs(p - uBoxC) / (uBoxS * 0.5);
        vA = 1.0 - smoothstep(0.8, 1.0, max(max(bq.x, bq.y), bq.z));
        float sz = (0.0009 + 0.0016 * aRnd.w) * projectionMatrix[1][1] * 0.5 * uPx * 900.0 / max(0.3, -mv.z);
        gl_PointSize = max(1.5 * uPx, sz);
        gl_Position = projectionMatrix * mv;
        if (vB < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`varying float vB; varying float vA; uniform vec3 uPDust;
      void main(){
        vec2 q = gl_PointCoord - 0.5; float d = dot(q, q);
        float a = smoothstep(0.25, 0.02, d);
        gl_FragColor = vec4(uPDust * vB * a * vA * 1.6, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const dust = new THREE.Points(dGeo, dustMat); dust.frustumCulled = false; dust.renderOrder = 5

  // ---- Sizes ----
  let W = 1, H = 1, projShift = -1, projFov = -1, projX = -9
  // Size comes from the canvas itself (the layout viewport), never innerWidth: under a pinch zoom (Safari) innerWidth
  // follows the visual viewport, and the scene would reframe and reallocate its targets on every event. Pixel ratio
  // follows devicePixelRatio (browser zoom), capped at 2
  function resize() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight
    W = cw > 0 ? cw : innerWidth; H = ch > 0 ? ch : innerHeight
    renderer.setSize(W, H, false)
    const pw = Math.round(W * DPR), ph = Math.round(H * DPR)
    rtMain.setSize(pw, ph)
    rtVol.setSize(Math.ceil(pw / 4), Math.ceil(ph / 4)); rtVolB.setSize(Math.ceil(pw / 4), Math.ceil(ph / 4))
    volBMat.uniforms.uTexel.value.set(1 / Math.ceil(pw / 4), 1 / Math.ceil(ph / 4))
    rtDown.setSize(Math.ceil(pw / 8), Math.ceil(ph / 8))
    rtDown2.setSize(Math.ceil(pw / 32), Math.ceil(ph / 32))
    down2Mat.uniforms.uTexel.value.set(8 * 1.6 / pw, 8 * 1.6 / ph)
    volU.uRes.value.set(Math.ceil(pw / 4), Math.ceil(ph / 4))
    compU.uRes.value.set(pw, ph)
    compU.uVolTexel.value.set(1 / Math.ceil(pw / 4), 1 / Math.ceil(ph / 4))
    compU.uDownTexel.value.set(1 / Math.ceil(pw / 8), 1 / Math.ceil(ph / 8))
    downMat.uniforms.uTexel.value.set(2.6 / pw, 2.6 / ph)
    cam.aspect = W / H; projShift = -1
    viewCache.clear()
  }
  const viewCache = new Map<string, View>()
  // One recompute once zoom or window size settles (not one per event: each recompute reallocates the multisampled
  // target); meanwhile the browser stretches the previous frame, nothing goes black
  let rzT = 0, lastKey = ''
  const onResize = () => {
    clearTimeout(rzT)
    rzT = window.setTimeout(() => {
      const dmax = Q.has('dpr') ? DPR_MAX : Math.min(devicePixelRatio || 1, 2)
      const key = `${canvas.clientWidth}x${canvas.clientHeight}@${dmax}`
      if (key === lastKey) return
      lastKey = key
      if (dmax !== DPR_MAX) { DPR_MAX = dmax; ADAPT = !Q.has('dpr') && !SNAP && DPR_MAX > 1 }
      governor.reset()
      if (DPR !== DPR_MAX) applyDpr(DPR_MAX); else resize()
    }, 140)
  }
  addEventListener('resize', onResize)
  const dprWatch = () => { const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`); mq.addEventListener('change', () => { onResize(); dprWatch() }, { once: true }) }
  dprWatch()

  // ---- Projection and picking ----
  const v3 = new THREE.Vector3()
  const toScreen = (x: number, y: number, z: number) => { v3.set(x, y, z).project(cam); return { x: (v3.x + 1) / 2 * W, y: (1 - v3.y) / 2 * H, z: v3.z } }
  world.toScreen = toScreen
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
  function pick(px: number, py: number) {
    // Racks under the text column fade cannot be picked (no slot readout popping over the text)
    if (!mobileW(W) && px < colEdge(storyAt().id, W)) return -1
    ndc.set(px / W * 2 - 1, -(py / H) * 2 + 1)
    ray.setFromCamera(ndc, cam)
    const d = ray.ray.direction, o = ray.ray.origin
    if (Math.abs(d.z) < 1e-4) return -1
    const tt = (0.0 - o.z) / d.z
    if (tt < 0) return -1
    const x = o.x + d.x * tt, y = o.y + d.y * tt
    for (let b = 0; b < G.NB; b++) {
      const dx = x - G.RX[b]
      if (Math.abs(dx) > G.IW / 2) continue
      if (Math.abs(dx) < 0.005) return -1
      const c = b * 2 + (dx > 0 ? 1 : 0)
      const r = Math.floor((y - G.Z0 - G.FB) / G.PITCH)
      if (r < 0 || r >= G.ROWS) return -1
      return c * G.ROWS + r
    }
    return -1
  }
  world.pick = pick
  // Debug: what a ray from the camera at (px, py) hits in the pulled-out sled (interpenetration checks)
  ;(window as unknown as { __rayHero: (px: number, py: number) => unknown }).__rayHero = (px, py) => {
    ndc.set(px / W * 2 - 1, -(py / H) * 2 + 1); ray.setFromCamera(ndc, cam)
    return ray.intersectObject(heroG, true).slice(0, 4).map((h) => { let o: THREE.Object3D | null = h.object; while (o && o.parent !== heroG) o = o.parent; return { top: o?.name, mesh: h.object.name, d: +h.distance.toFixed(4), y: +(h.point.y - heroG.position.y).toFixed(4), zl: +(h.point.z - heroG.position.z).toFixed(4) } })
  }

  // Debug: from 9 points of the sheet, vertical distance to the first surface above (shelf, rack) and below (lid); a
  // negative or zero gap means interpenetration. Rays start mid-thickness, the sheet itself is excluded
  ;(window as unknown as { __explode: () => unknown }).__explode = () => {
    const ex = parts.map((_, j) => (j === 0 ? 0 : exOf(j)))
    const pP = world.sec.protocol ?? 0
    const gaps: number[] = [], hits: string[] = [], pts: string[] = []
    const cur = parts.map((p) => p.o.position.y)
    parts.forEach((p) => { p.o.position.y = p.base })
    heroG.updateMatrixWorld(true)
    const sides = new Map<THREE.Material, THREE.Side>()
    const meshes = (o: THREE.Object3D) => { const m: THREE.Mesh[] = []; o.traverse((c) => { const x = c as THREE.Mesh; if (x.isMesh) m.push(x) }); return m }
    parts.forEach((p) => meshes(p.o).forEach((m) => { const mt = m.material as THREE.Material; if (!sides.has(mt)) { sides.set(mt, mt.side); mt.side = THREE.DoubleSide } }))
    const rc = new THREE.Raycaster(); const v = new THREE.Vector3(); const up = new THREE.Vector3(0, 1, 0); const nW = new THREE.Vector3()
    for (let j = 1; j < parts.length; j++) {
      const below = parts.slice(0, j).flatMap((p) => meshes(p.o))
      const above = parts.slice(j).flatMap((p) => meshes(p.o))
      const total = above.reduce((a, m) => a + m.geometry.attributes.position.count, 0)
      const step = j === 1 ? 1 : Math.max(1, Math.floor(total / 1200))
      // Longest travel of an upper layer relative to the lower ones: every gap above is open
      const reach = parts.slice(j).reduce((a, p) => a + p.d, 0)
      let min = 9, who = '', n = 0, hd = 0; const bx = [9, -9, 9, -9, 9, -9]
      for (const m of above) {
        const pos = m.geometry.attributes.position
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
          rc.set(v, up); rc.near = 0.0005 * K; rc.far = reach * K + 0.01
          // An obstacle is the underside of a surface (normal pointing down); a face whose normal points up, hit from inside, is
          // the exit of a socket where the layer rests (the Xeon in its socket): not a crossing
          const h = rc.intersectObjects(below, false).find((x) => !x.face || nW.copy(x.face.normal).transformDirection(x.object.matrixWorld).y < 0)
          if (h && h.distance / K < reach) { n++; const l = heroG.worldToLocal(v.clone()); if (j === 1) pts.push(`${l.x.toFixed(4)},${l.y.toFixed(4)},${l.z.toFixed(4)}+${(h.distance / K * 1000).toFixed(1)}`); bx[0] = Math.min(bx[0], l.x); bx[1] = Math.max(bx[1], l.x); bx[2] = Math.min(bx[2], l.y); bx[3] = Math.max(bx[3], l.y); bx[4] = Math.min(bx[4], l.z); bx[5] = Math.max(bx[5], l.z); hd = Math.max(hd, h.distance / K) }
          if (h && h.distance / K - reach < min) { min = h.distance / K - reach; who = `${m.name} -> ${h.object.name}` }
        }
      }
      gaps.push(min); hits.push(`${who} : ${n} sommets sur ${Math.ceil(total / step)}, obstacle à ${(hd * 1000).toFixed(1)} mm au plus, x ${bx[0].toFixed(3)}..${bx[1].toFixed(3)} y ${bx[2].toFixed(3)}..${bx[3].toFixed(3)} z ${bx[4].toFixed(3)}..${bx[5].toFixed(3)}`)
    }
    sides.forEach((sd, mt) => { mt.side = sd })
    parts.forEach((p, j) => { p.o.position.y = cur[j] })
    heroG.updateMatrixWorld(true)
    // No obstacle: clearance = 9; an obstacle in the travel: remaining distance (negative = crossing)
    return { pP, ex, d: parts.map((p) => p.d), gaps: gaps.map((g) => (g >= 9 ? 9 : g)), hits, pts, names: parts.map((p) => p.o.name), vis: heroG.visible }
  }

  // Debug: every vertex of the whole sled (layers, lid, sheet, rails) inside the rack depth (z < 0.03) must be inside
  // its own slot; otherwise it crosses the rack
  ;(window as unknown as { __cadre: () => unknown }).__cadre = () => {
    const b = new THREE.Box3()
    heroG.updateMatrixWorld(true)
    const skip = new Set<THREE.Object3D>([sheet]); if (lid) lid.traverse((o) => { skip.add(o) })
    heroG.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.visible && !skip.has(o)) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)) } })
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    for (let k = 0; k < 8; k++) { const q = toScreen(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y) }
    const r = (v: number) => Math.round(v * 1000) / 1000
    return { cam: cam.position.toArray().map(r), fov: r(cam.fov), view: cam.view ? { ox: r(cam.view.offsetX), oy: r(cam.view.offsetY) } : null, box: [b.min.toArray().map(r), b.max.toArray().map(r)], scr: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)], W, H }
  }
  // Debug: state of the first pinned page frame by frame, visible sled, and the Arc verification ring (lit, progress, verdict)
  ;(window as unknown as { __proto: () => unknown }).__proto = () => ({ up: st.up, pull: st.pull, lid: st.lid, ex: st.explode, sheetY: st.sheetY, vis: heroG.visible, jOn: joint.visible ? jointMat.uniforms.uOn.value : 0, jProg: joint.visible ? jointMat.uniforms.uProg.value : 0, jOk: joint.visible ? jointMat.uniforms.uOk.value : 0 })
  ;(window as unknown as { __heroClear: () => unknown }).__heroClear = () => {
    const rp = world.wall.replay; if (rp < 0 || !heroG.visible) return null
    const sl = SLOTS[rp]
    heroG.updateMatrixWorld(true)
    const v = new THREE.Vector3(); let n = 0, bad = 0, minZ = 9, worst = ''
    const objs: THREE.Mesh[] = []
    heroG.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.visible && (m.parent?.visible ?? true)) objs.push(m) })
    for (const m of objs) {
      const pos = m.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 400))
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); n++
        const inSlot = Math.abs(v.x - sl.x) <= G.CP / 2 - 0.001 && v.y >= sl.base - 0.0005 && v.y <= sl.base + G.PITCH - 0.003
        if (!inSlot) { if (v.z < minZ) { minZ = v.z; worst = m.name } if (v.z < 0.03) bad++ }
      }
    }
    return { n, bad, minZ: +minZ.toFixed(4), worst, up: +st.up.toFixed(3), pull: +st.pull.toFixed(3), lid: +st.lid.toFixed(3), sheetY: +st.sheetY.toFixed(3) }
  }
  ;(window as unknown as { __sheetGap: () => unknown }).__sheetGap = () => {
    if (!sheet.visible) return null
    sheet.updateMatrixWorld(true)
    const out: { up: number; down: number; upHit: string; downHit: string }[] = []
    const rc = new THREE.Raycaster()
    const targets = scene.children.filter((o) => o !== dust && o !== halos && o !== plates && o !== leds && o.visible)
    const was = sheet.visible; sheet.visible = false
    for (const fx of [-0.45, 0, 0.45]) for (const fz of [-0.45, 0, 0.45]) {
      const c = sheet.localToWorld(new THREE.Vector3(fx * SHEET.w, 0, fz * (SHEET.z0 - SHEET.z1)))
      rc.set(c, new THREE.Vector3(0, 1, 0)); rc.far = 0.2
      const u = rc.intersectObjects(targets, true).find((h) => h.object.visible)
      rc.set(c, new THREE.Vector3(0, -1, 0))
      const d = rc.intersectObjects(targets, true).find((h) => h.object.visible)
      out.push({ up: u ? +(u.distance - K * SHEET.th / 2).toFixed(4) : 9, down: d ? +(d.distance - K * SHEET.th / 2).toFixed(4) : 9, upHit: u?.object.name ?? '', downHit: d?.object.name ?? '' })
    }
    sheet.visible = was
    return out
  }

  // ---- Data to attributes ----
  let lastVersion = -1, lastLang = '', lastAmber = -2, lastGreen = -2, tintDirty = false
  const plateText = (s: Sled, amber: boolean, admitted = false): [string, number, number] => {
    const live = getLive()
    // Once Arc admits it at the verdict, the replayed sled turns green even if its real registration has since expired;
    // the Arc section labels it as a replay. Its plate says "Admitted (replay)" (word 5), never "Running"
    if (admitted) return [productLabel(s.product, live.products, live.bounties), 5, 1.9]
    // The replayed sled keeps its service name everywhere (wall, readout, card, fallback); its status word says it is replayed
    if (amber) return [productLabel(s.product, live.products, live.bounties), 2, 1.4]
    if (s.led === 'green') return [productLabel(s.product, live.products, live.bounties), 1, 1.9]
    if (s.led === 'red') return [productLabel(s.product, live.products, live.bounties), 3, 1.4]
    // Amber: usable but not running (inactive: window closed; or pending); replaced, removed or stopped on Arc also
    // counts as inactive
    if (s.led === 'amber') return [productLabel(s.product, live.products, live.bounties), s.why && s.why !== 'idle' ? 4 : 2, 1.1]
    return [t('plate.off'), 0, OPEN_INK]
  }
  function syncData(amberSlot: number, greenSlot = -1) {
    const L = getLang()
    if (lastVersion === world.version && lastLang === L && lastAmber === amberSlot && lastGreen === greenSlot) return
    const repaint = lastVersion !== world.version || lastLang !== L
    lastVersion = world.version; lastLang = L; lastAmber = amberSlot; lastGreen = greenSlot
    const sl = world.wall.sleds
    const texts: string[] = []
    const rp = world.wall.replay
    if (rp >= 0 && sl[rp]) texts.push(plateText(sl[rp], true)[0])
    const rows = SLOTS.map((s) => {
      const d = POSTER ? { i: s.i, led: 'off' as const } : sl[s.i] ?? { i: s.i, led: 'off' as const }
      const r = plateText(d, !POSTER && s.i === amberSlot, !POSTER && s.i === greenSlot)
      if (!texts.includes(r[0])) texts.push(r[0])
      return r
    })
    if (repaint) atlas.paint(texts, [t('plate.sub.off'), t('plate.sub.green'), t('plate.sub.amber'), t('plate.sub.red'), t('plate.sub.dim'), t('plate.sub.admitted')])
    SLOTS.forEach((s, i) => {
      const [title, sub, k] = rows[i]
      const d = sl[s.i]
      const led = POSTER ? 'off' : s.i === amberSlot ? 'amber' : s.i === greenSlot ? 'green' : d?.led ?? 'off'
      const c = led === 'off' ? INK_OFF : LED[led as 'green']
      plateA.txt[i * 4] = atlas.row(title); plateA.txt[i * 4 + 1] = sub; plateA.txt[i * 4 + 2] = s.u; plateA.txt[i * 4 + 3] = atlas.end(title)
      plateA.tint[i * 4] = c.r; plateA.tint[i * 4 + 1] = c.g; plateA.tint[i * 4 + 2] = c.b; plateA.tint[i * 4 + 3] = k
    })
    plTxtA.needsUpdate = true; plTintA.needsUpdate = true
  }

  // ---- Loading ----
  // Two stages. 1) The wall: room, racks and facades, compiled in parallel (KHR_parallel_shader_compile through
  // compileAsync), uploaded and drawn once, in frames capped at a few milliseconds; then the wall is revealed. 2) The
  // replayed sled (first pinned page, much further down): its files arrive after the wall, and its compile, uploads and
  // first draw happen in the background, one small step per frame, only while the page is still (never during a
  // scroll); __frontReady is set once everything is ready.
  let ready = false, heroReady = false, wantReveal = false
  const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder)
  const parseGlb = (b: Promise<ArrayBuffer>) => b.then((buf) => new Promise<THREE.Group>((res, rej) => gl.parse(buf, '', (g) => res(g.scene), rej)))
  const matName = (m: THREE.Material) => (m.name || '').replace(/\.\d+$/, '')
  /** Each glb mesh becomes an InstancedMesh: one instance per matrix */
  function instanceAll(root: THREE.Object3D, mats: Record<string, THREE.Material>, mtx: THREE.Matrix4[], extraAttr?: (g: THREE.BufferGeometry) => void, filter?: (name: string) => boolean) {
    const out: THREE.InstancedMesh[] = []
    root.updateMatrixWorld(true)
    root.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return
      const nm = (m.parent && m.parent !== root && !(m.parent as THREE.Scene).isScene ? m.parent.name : m.name).replace(/\.\d+$/, '')
      if (filter && !filter(nm)) return
      const g = m.geometry; extraAttr?.(g)
      const mat = mats[matName(m.material as THREE.Material)] ?? mats.anod
      const im = new THREE.InstancedMesh(g, mat, mtx.length); im.frustumCulled = false; im.name = nm
      const tmp = new THREE.Matrix4()
      mtx.forEach((x, k) => im.setMatrixAt(k, tmp.multiplyMatrices(x, m.matrixWorld)))
      out.push(im)
    })
    return out
  }
  const steps: string[] = []
  ;(window as unknown as { __steps: string[] }).__steps = steps
  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
  // Is the page still? (read by the second stage: nothing is uploaded to the GPU during a scroll)
  let lastMove = performance.now(), lastSY = -1
  const moving = () => { const y = window.scrollY; const v = Math.abs(getLenis()?.velocity ?? 0); if (y !== lastSY || v > 0.01 || st.svcU > 0 && st.svcU < 1 || (st.revealAt > 0 && st.reveal < 1)) { lastSY = y; lastMove = performance.now() } }
  const nearProto = () => world.story >= ORDER.indexOf('protocol') - 1.3
  const idleFrame = () => new Promise<void>((r) => { const f = () => { moving(); if (performance.now() - lastMove > 280 || nearProto()) r(); else requestAnimationFrame(f) }; requestAnimationFrame(f) })
  /** Run as many steps as fit in `ms` per frame (at least one), one frame between batches */
  async function budgeted(list: (() => void)[], ms: number, idle = false) {
    let i = 0
    while (i < list.length) {
      if (idle) await idleFrame(); else await nextFrame()
      const t0 = performance.now()
      do { list[i++]() } while (i < list.length && performance.now() - t0 < ms)
    }
  }
  // Draw a single object (others hidden) into a 32 px target so the driver finishes linking its program and uploading
  // its buffers outside a real frame. Visibility is restored in the same step
  let tiny: THREE.WebGLRenderTarget | null = null
  const drawAlone = (o: THREE.Object3D, sub?: THREE.Object3D) => {
    const kids = scene.children.filter((k) => !(k as THREE.Light).isLight), vis = kids.map((k) => k.visible)
    const sv = sub ? o.children.map((c) => c.visible) : []
    const ov = o.visible
    kids.forEach((k) => { k.visible = k === o }); o.visible = true
    if (sub) o.children.forEach((c) => { c.visible = c === sub })
    const t0 = performance.now()
    tiny ??= new THREE.WebGLRenderTarget(32, 32, { type: THREE.HalfFloatType })
    renderer.setRenderTarget(tiny); renderer.render(scene, cam); renderer.setRenderTarget(null)
    steps.push(`d-${(sub ?? o).name || (sub ?? o).type}:${Math.round(performance.now() - t0)}:p${renderer.info.programs?.length ?? 0}`)
    kids.forEach((k, i) => { k.visible = vis[i] }); o.visible = ov
    if (sub) o.children.forEach((c, i) => { c.visible = sv[i] })
  }
  let progK = 0
  const prog = (k: number) => { if (k - progK >= 0.01 || k === 1) { progK = k; onProgress(k) } }
  async function build() {
    const L = wallLot()
    // Loading bar: wall bytes received (up to 0.8), then preparation (compile, uploads, first draws)
    const offBar = onTick(() => { if (!ready) prog(Math.min(0.8, (0.8 * loadP.got) / loadP.total)) })
    for (const f of noiseFills) { f(); await nextFrame() }
    // Stage 1: room, racks, facades (first screen)
    const [[roomG, rackG, faceG], tx] = await Promise.all([Promise.all(WALL_GLB.map((u) => parseGlb(L.glb[u]))), texLot(L.tex, WALL_TEX)])
    mark('mur-decode')
    offBar(); prog(0.8)
    const { lm_sun: lmSun, lm_sky: lmSky, conc_col: conc, conc_nor: concN, lac_rgh: lac, ao_rack: aoRack, ao_face: aoFace, wear_fx: wear, pow_nor: powN, pow_rgh: powR, cha_col: chaC, cha_nor: chaN, cha_rgh: chaR, brs_nor: brsN, perf_nor: perfN, perf_alb: perfA } = tx
    texs.push(...Object.values(tx))
    Object.assign(T, { powN, powR, chaC, chaN, chaR, brsN, perfN, perfA })
    wearU.value = wear
    lacRgh = lac
    for (const x of [aoRack, aoFace]) x.channel = 1
    Object.assign(roomU.tSun, { value: lmSun }); roomU.tSky.value = lmSky; roomU.tConc.value = conc; roomU.tConcN.value = concN
    roomG.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = roomMat; m.frustumCulled = false } })
    scene.add(roomG)
    applyPal(getPal())
    // Racks, instanced
    const rackMats = makeMats(aoRack, 'rack')
    const rackM = G.RX.map((x) => new THREE.Matrix4().makeTranslation(x, 0, 0))
    for (const im of instanceAll(rackG, rackMats, rackM)) scene.add(im)
    // Facades, one instance per slot
    const faceMats = makeMats(aoFace, 'face')
    // Facade: a monolithic slab of dark polished glass that reflects the room sharply. No clear-coat lobe and no brushed
    // normal (too costly at the hero, where facades cover half the screen), no wear. Flat shading: the slab has few
    // vertices, and normals interpolated from the bevels tilted the large front triangles
    const faceBody = sunned(new THREE.MeshPhysicalMaterial({ color: '#020304', metalness: 0.0, roughness: 0.06, ior: 1.52, specularIntensity: 1, aoMap: aoFace, flatShading: true }), faceExtra, 'fbody', { edge: true })
    faceBody.defines = { ...faceBody.defines, FLATN: '' }
    envGain(faceBody, Q.has('fg') ? Number(Q.get('fg')) : 0.8) // black glass reflects without going grey
    const facePlate = sunned(new THREE.MeshPhysicalMaterial({ color: '#161719', metalness: 0.0, roughness: 0.82, aoMap: aoFace }), faceExtra, 'fplate', { wear: 0.6, edge: true })
    palMats.push({ k: 'fplate', m: facePlate })
    const faceCha = sunned((faceMats.cha as THREE.MeshPhysicalMaterial).clone(), faceExtra, 'fcha', { wear: 0.6, edge: true })
    const faceFoam = sunned((faceMats.foam as THREE.MeshPhysicalMaterial).clone(), faceExtra, 'ffoam', { wear: 0.3, edge: true })
    const faceFilet = glowMat(FILET, true)
    const fm: Record<string, THREE.Material> = { ...faceMats }
    const addFace = (g: THREE.BufferGeometry) => { g.setAttribute('aLed', ledA); g.setAttribute('aPull', pullA); g.setAttribute('aDim', dimA) }
    // The fold of each facade turns half a turn every other row: the chevron runs across the whole wall
    const facetBase = SLOTS.map((sl, i) => (sl.row & 1 ? faceBase[i].clone().multiply(new THREE.Matrix4().makeTranslation(FACE.FACET[0], FACE.FACET[1], 0)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI)).multiply(new THREE.Matrix4().makeTranslation(-FACE.FACET[0], -FACE.FACET[1], 0)) : faceBase[i]))
    const fms = [...instanceAll(faceG, fm, faceBase, addFace, (n) => n !== 'face_light' && n !== 'face_facet' && n !== 'face_filet'),
      ...instanceAll(faceG, fm, facetBase, addFace, (n) => n === 'face_facet' || n === 'face_filet')]
    for (const im of fms) {
      if (im.name === 'face_body') im.material = faceBody
      else if (im.name === 'face_plate') im.material = facePlate
      else if (im.name === 'face_trim' || im.name === 'face_handle') im.material = faceCha
      else if (im.name === 'face_facet') im.material = faceFoam
      else if (im.name === 'face_filet') im.material = faceFilet
      else im.material = sunned(((im.material as THREE.MeshPhysicalMaterial).clone()), faceExtra, 'f' + im.name, { edge: true })
      faceMeshes.push(im); scene.add(im)
    }
    // The glass facade keeps its own tint (not re-tinted by the palette)
    for (const im of fms) if (im.material !== faceBody && im.material !== facePlate && im.material !== faceFilet) palMats.push({ k: im.name === 'face_trim' || im.name === 'face_handle' ? 'cha' : im.name === 'face_facet' ? 'foam' : 'anod', m: im.material as THREE.MeshStandardMaterial })
    applyPal(getPal())
    // Solid slab, no title window: the plate background is not added
    void backs
    scene.add(leds, plates, halos, joint, body)
    await document.fonts.load('70px "Fragment Mono"').catch(() => null)
    syncData(-1)
    // Video landing: no dust or floating points during film capture, where scene time is frozen (FROZEN_T)
    if (!TOURNAGE) scene.add(dust)
    resize()
    mark('mur-construit')
    // The whole wall compiled at once, in parallel (the driver links programs off the main thread), hidden objects included
    const warm = [joint, body]
    warm.forEach((o) => { o.visible = true; o.traverse((c) => { c.frustumCulled = false }) })
    cam.position.copy(keyView('hero', world.wall, W, H).p); cam.lookAt(keyView('hero', world.wall, W, H).t); cam.updateMatrixWorld()
    { const t0 = performance.now()
      // Each scene compiles against the target it is really drawn to. Programs depend on the target (sRGB output on screen,
      // linear in a render target): compiled for the screen, the scene and intermediate passes recompiled on first real draw
      const at = <T,>(rt: THREE.WebGLRenderTarget | null, f: () => T) => { renderer.setRenderTarget(rt); const r = f(); renderer.setRenderTarget(null); return r }
      const ps = [at(rtMain, () => renderer.compileAsync(scene, cam)), ...[volScene, volBScene, downScene, down2Scene].map((x) => at(rtMain, () => renderer.compileAsync(x, fsCam))), at(null, () => renderer.compileAsync(compScene, fsCam))]
      warm.forEach((o) => { o.visible = false })
      await Promise.all(ps).catch(() => null)
      steps.push(`compile:${Math.round(performance.now() - t0)}`) }
    mark('mur-compile'); prog(0.88)
    // Textures uploaded, as many as fit in 10 ms per frame
    await budgeted([...texs, atlas.tex, atlas.gtex, NOISE2, NOISE3, envTex].map((x) => () => { const t0 = performance.now(); renderer.initTexture(x); steps.push(`tex:${Math.round(performance.now() - t0)}`) }), 10)
    mark('mur-envoi'); prog(0.94)
    // First draw of each piece alone in 32 px (hidden objects included), then the pass chain
    await budgeted(scene.children.filter((o) => !(o as THREE.Light).isLight).map((o) => () => drawAlone(o)), 10)
    await budgeted([downScene, down2Scene, volScene, volBScene].map((ps) => () => { renderer.setRenderTarget(tiny); renderer.render(ps, fsCam); renderer.setRenderTarget(null) }), 10)
    await nextFrame()
    { const t0 = performance.now(); renderFrame(); steps.push(`frame:${Math.round(performance.now() - t0)}`) }
    await nextFrame()
    mark('mur-pret'); prog(1)
    ready = true; world.sceneReady = true
    if (wantReveal && !st.revealAt) st.revealAt = performance.now()
    onWallReady()
    // Second stage: the replayed sled
    await buildHero().catch((e) => console.error(e))
    heroReady = true
    tiny?.dispose(); tiny = null
    mark('lame-prete')
    const fin = () => { if (st.reveal >= 1) onAllReady(); else requestAnimationFrame(fin) }
    fin()
  }

  async function buildHero() {
    const H = await heroLot()
    const [sledG, tx, logo] = await Promise.all([parseGlb(H.glb['/models/sled.glb']), texLot(H.tex, HERO_TEX), logoTex()])
    mark('lame-decode')
    const { al_nor: aln, al_rgh: alr, pcb_col: pcbCol, pcb_nor: pcbNor, pcb_rgh: pcbRgh, ao_sled: aoSled } = tx
    alNor = aln; alRgh = alr
    const htex = [...Object.values(tx), logo]
    texs.push(...htex)
    aoSled.channel = 1
    await idleFrame()
    const mats = makeMats(aoSled, 'sled', [pcbCol, pcbNor, pcbRgh])
    sledG.updateMatrixWorld(true)
    const byName: Record<string, THREE.Object3D> = {}
    sledG.children.forEach((o) => { byName[o.name.replace(/\.\d+$/, '')] = o })
    const setMats = (o: THREE.Object3D) => o.traverse((c) => { const m = c as THREE.Mesh; if (!m.isMesh) return; m.material = mats[matName(m.material as THREE.Material)] ?? mats.anod; m.frustumCulled = false })
    // Exploded layers each rise above the previous one, never crossing (measured boxes)
    let top = -1
    const box3 = new THREE.Box3()
    for (const n of ['layer1', 'layer2', 'layer3', 'layer4', 'layer5', 'layer6', 'layer7']) {
      const o = byName[n]; if (!o) continue
      setMats(o); heroG.add(o)
      // The box is measured in sled space; measured in world space it carried the group height at load time and the layer
      // labels aimed too high
      heroG.updateMatrixWorld(true)
      box3.setFromObject(o)
      const gy = heroG.matrixWorld.elements[13]
      const lo = box3.min.y - gy, hi = box3.max.y - gy
      // Each layer clears the previous one by at least 30 mm, so all seven layers read separately
      const prevOff = parts.length ? parts[parts.length - 1].off : 0
      const off = top < 0 ? 0 : Math.max(0, top + 0.022 - lo, prevOff + 0.03)
      // Label anchor: on the layer itself, at the last fifth of its width on the right and mid-depth (box in sled space)
      const lb = box3.clone().applyMatrix4(heroG.matrixWorld.clone().invert())
      // (the tray: towards the front, on its fans, which the host board does not cover)
      const ax = lb.max.x - (parts.length === 0 ? 0.2 : 0.08) * (lb.max.x - lb.min.x), az = parts.length === 0 ? lb.max.z - 0.14 * (lb.max.z - lb.min.z) : (lb.min.z + lb.max.z) / 2
      // Each layer opens its own gap (d) and carries the ones above it
      const prev = parts.length ? parts[parts.length - 1].off : 0
      parts.push({ o, lo, hi, off, base: o.position.y, d: Math.max(0, off - prev), y: 0, ax, az })
      top = hi + off
    }
    // The four corners of the host board clipped the tray legs while rising: the board alone (without its components) is
    // inset by 1.25 mm on each edge, invisible to the eye
    byName.layer2?.traverse((c) => { if (c.name === 'layer2_1' && (c as THREE.Mesh).isMesh) c.scale.x *= 0.99 })
    if (byName.lid) { lid = byName.lid; lidBase = lid.position.y; setMats(lid); heroG.add(lid) }
    // Telescopic rails: the fixed part comes out of the rack and carries the sled (it never floats)
    const railMat = mats.al_bead
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.0026 * K, 0.011 * K, 1), railMat); r.position.set(s * 0.1382 * K, 0.034 * K, 0); r.name = 'rail'
      rails.add(r)
    }
    sheetU.tLogo.value = logo
    ;(window as unknown as { __hero: THREE.Group }).__hero = heroG
    heroG.add(sheet)
    // The sled (seven layers, lid, sheet) at rack scale
    heroG.scale.setScalar(K)
    heroG.visible = false; rails.visible = false
    scene.add(heroG, rails)
    heroG.traverse((c) => { c.frustumCulled = false }); rails.traverse((c) => { c.frustumCulled = false })
    // Parallel compile, started on a still frame; visibility is restored in the same step
    await idleFrame()
    { const t0 = performance.now()
      const sv = sheet.visible, so = sheetMat.opacity
      heroG.visible = rails.visible = sheet.visible = true; sheetMat.opacity = 0.01
      // Compiled for the scene target (rtMain), as when drawn
      renderer.setRenderTarget(rtMain)
      const ps = [renderer.compileAsync(heroG, cam, scene), renderer.compileAsync(rails, cam, scene)]
      renderer.setRenderTarget(null)
      heroG.visible = rails.visible = false; sheet.visible = sv; sheetMat.opacity = so
      steps.push(`c-lame-appel:${Math.round(performance.now() - t0)}`)
      await Promise.all(ps).catch(() => null)
      steps.push(`c-lame:${Math.round(performance.now() - t0)}:p${renderer.info.programs?.length ?? 0}`) }
    mark('lame-compile')
    await budgeted(htex.map((x) => () => { const t0 = performance.now(); renderer.initTexture(x); steps.push(`tex-l:${Math.round(performance.now() - t0)}`) }), 6, true)
    mark('lame-envoi')
    // First draw of each sled piece (transmissive sheet included), one per still frame
    await budgeted([...heroG.children.map((c) => () => {
      const so = sheetMat.opacity; sheetMat.opacity = 0.01
      drawAlone(heroG, c)
      sheetMat.opacity = so
    }), () => drawAlone(rails),
    // Then one full-size draw into the scene target (overwritten next frame): the sheet transmission pass sizes its target
    // on the current one; drawn only at 32 px it would reallocate (and rebuild mipmaps) on the first real frame of the
    // pinned page, mid-scroll
    () => {
      const hv = heroG.visible, rv = rails.visible, sv = sheet.visible, so = sheetMat.opacity
      heroG.visible = rails.visible = sheet.visible = true; sheetMat.opacity = 0.01
      const t0 = performance.now()
      renderer.setRenderTarget(rtMain); renderer.render(scene, cam); renderer.setRenderTarget(null)
      steps.push(`lame-pleine:${Math.round(performance.now() - t0)}`)
      heroG.visible = hv; rails.visible = rv; sheet.visible = sv; sheetMat.opacity = so
    }], 6, true)
  }
  /** The Arc logo from the official kit, as is, as a texture */
  async function logoTex() {
    // Solid white kit logo (Arc_Logo_White.svg, unmodified); the gradient "on dark" version looked washed out on the blue glass
    const img = new Image(); img.decoding = 'async'; img.src = '/arc-logo-white.svg'
    await img.decode().catch(() => null)
    const cv = document.createElement('canvas'); cv.width = 1460; cv.height = 500
    const g = cv.getContext('2d')!
    try { g.drawImage(img, 0, 0, cv.width, cv.height) } catch { /* no logo: the sheet stays bare */ }
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = ANISO; tx.generateMipmaps = true; tx.minFilter = THREE.LinearMipmapLinearFilter
    return tx
  }

  // ---- Animated state (no allocation in the loop) ----
  const st = { svcU: 0, svcSlot: -1, svcW: 0, svcV: null as View | null, gest: 0, txtR: 0, shift: 0, cam: null as View | null, hoverPull: 0, hoverSlot: -1, pull: 0, pullV: 0, up: 0, upV: 0, explode: 0, lid: 0, sheetY: 1, sheetO: 0, introAt: 0, scan: 0, ov: 0.42, ovK: 1, ovB: 0, ovM: 0.55, dustX: 1, revealAt: 0, reveal: 0, lockAt: -1 }
  const sm = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }
  const easeIO = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)
  /** Explode progress for layer j: they leave one after another (the lowest stays put) */
  const exOf = (j: number) => easeIO(Math.min(1, Math.max(0, (st.explode * (parts.length + 0.5) - (j - 1)) / 2.5)))
  const tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3()
  let catchR: DOMRect | null = null, catchAt = -1
  const invVP = new THREE.Matrix4()

  build().catch((e) => { console.error(e); onProgress(1); ready = true; onWallReady(); st.reveal = 1; onAllReady() })

  let shY = NaN
  function cached(id: SecId) {
    let v = viewCache.get(id)
    if (!v) { v = keyView(id, world.wall, W, H); viewCache.set(id, v) }
    return v
  }
  let lastWallV = -1

  // GPU time per pass (?gpu, debug only). Uses GPU timer queries (EXT_disjoint_timer_query_webgl2) when available,
  // otherwise gl.finish() after each pass (synchronous: frame rate drops while measuring, durations stay comparable)
  const GPUQ = Q.has('gpu')
  const glc = renderer.getContext() as WebGL2RenderingContext
  const tq = GPUQ ? (glc.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) : null
  const gpu = { mode: tq ? 'timer' : 'finish', on: false, n: 0, sum: {} as Record<string, number>, cnt: {} as Record<string, number>, pend: [] as { q: WebGLQuery; k: string }[] }
  if (GPUQ) (window as unknown as { __gpu: typeof gpu }).__gpu = gpu
  let gpuT = 0, gpuQ: WebGLQuery | null = null
  // ANGLE on Metal: gl.finish() does not wait for the GPU; reading a pixel from a small target does
  const probeRT = GPUQ ? new THREE.WebGLRenderTarget(1, 1) : null, probePx = new Uint8Array(4)
  const gpuSync = () => { const cur = renderer.getRenderTarget(); renderer.readRenderTargetPixels(probeRT!, 0, 0, 1, 1, probePx); renderer.setRenderTarget(cur) }
  const gpuBeg = (k: string) => {
    if (!gpu.on) return
    if (tq) { gpuQ = glc.createQuery()!; glc.beginQuery(tq.TIME_ELAPSED_EXT, gpuQ); gpu.pend.push({ q: gpuQ, k }) }
    else { gpuSync(); gpuT = performance.now() }
    void k
  }
  const gpuEnd = (k: string) => {
    if (!gpu.on) return
    if (tq) glc.endQuery(tq.TIME_ELAPSED_EXT)
    else { gpuSync(); gpu.sum[k] = (gpu.sum[k] ?? 0) + performance.now() - gpuT; gpu.cnt[k] = (gpu.cnt[k] ?? 0) + 1 }
  }
  const gpuCollect = () => {
    if (!tq || !gpu.pend.length) return
    if (glc.getParameter(tq.GPU_DISJOINT_EXT)) { gpu.pend.forEach((p) => glc.deleteQuery(p.q)); gpu.pend = []; return }
    while (gpu.pend.length && glc.getQueryParameter(gpu.pend[0].q, glc.QUERY_RESULT_AVAILABLE)) {
      const p = gpu.pend.shift()!
      gpu.sum[p.k] = (gpu.sum[p.k] ?? 0) + glc.getQueryParameter(p.q, glc.QUERY_RESULT) / 1e6; gpu.cnt[p.k] = (gpu.cnt[p.k] ?? 0) + 1
      glc.deleteQuery(p.q)
    }
  }
  // Pass ablation for profiling (?abl=vol,down: debug only, the image is wrong)
  const ABL = (Q.get('abl') ?? '').split(',')
  function renderFrame() {
    if (GPUQ) { gpuCollect(); if (gpu.on) gpu.n++ }
    gpuBeg('scene'); renderer.setRenderTarget(rtMain); renderer.render(scene, cam); gpuEnd('scene')
    if (!ABL.includes('down')) { gpuBeg('down'); renderer.setRenderTarget(rtDown); renderer.render(downScene, fsCam)
    renderer.setRenderTarget(rtDown2); renderer.render(down2Scene, fsCam); gpuEnd('down') }
    invVP.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse)
    volU.uInvVP.value.copy(invVP); volU.uCam.value.copy(cam.position)
    if (!ABL.includes('vol')) { gpuBeg('vol'); renderer.setRenderTarget(rtVol); renderer.render(volScene, fsCam); renderer.setRenderTarget(rtVolB); renderer.render(volBScene, fsCam); gpuEnd('vol') }
    gpuBeg('comp'); renderer.setRenderTarget(null); renderer.render(compScene, fsCam); gpuEnd('comp')
  }

  // Adaptive pixel ratio, a safety net for very large screens. It only ever goes down, and only if the GPU falls behind
  // for a sustained time (median above 24 ms for two seconds in a row, at most three steps down to 1, ignoring the 2 s
  // after a resize); it never goes back up on its own, so there is no oscillation (each switch changes the sharpness of
  // every title and reallocates the multisampled target). It restarts from full density on the next resize or zoom.
  // Disabled by ?dpr= and ?t=; window.__adapt(false) disables it for GPU profiling.
  let ADAPT = !Q.has('dpr') && !SNAP && DPR_MAX > 1
  const win: number[] = []
  const governor = { bad: 0, quietUntil: 0, steps: 0, reset() { this.bad = 0; this.steps = 0; this.quietUntil = performance.now() + 2000; win.length = 0 } }
  const applyDpr = (d: number) => { DPR = d; renderer.setPixelRatio(d); compU.uDpr.value = d; dustU.uPx.value = d; resize(); (window as unknown as { __dpr: number }).__dpr = d }
  ;(window as unknown as { __dpr: number }).__dpr = DPR
  ;(window as unknown as { __adapt: (on: boolean) => void }).__adapt = (on) => { ADAPT = on && !Q.has('dpr') && !SNAP && DPR_MAX > 1; win.length = 0; if (!on && DPR !== DPR_MAX) applyDpr(DPR_MAX) }
  function adapt(dt: number) {
    if (!ADAPT || dt <= 0 || dt > 0.1 || document.hidden || performance.now() < governor.quietUntil || governor.steps >= 3) return
    win.push(dt)
    if (win.length < 60) return
    win.sort((a, b) => a - b)
    const med = win[30] * 1000
    win.length = 0
    governor.bad = med > 24 ? governor.bad + 1 : 0
    if (governor.bad >= 2 && DPR > 1.001) {
      governor.bad = 0; governor.steps++; governor.quietUntil = performance.now() + 2000
      applyDpr(Math.max(1, Math.round(DPR * 0.8 * 100) / 100))
    }
  }

  const off = onTick((_time, dt0) => {
    if (palDirty) { palDirty = false; applyPal(getPal()) }
    if (!ready) return
    adapt(dt0)
    const dt = Math.min(dt0, 1 / 20)
    const now = sceneTime()
    shared.uTime.value = now
    compU.uTime.value = now
    if (world.version !== lastWallV) { lastWallV = world.version; viewCache.clear() }
    if (!st.introAt) st.introAt = now
    compU.uExpo.value = EXPO
    // Wall intro in one move: the finished loading bar turns into a slit of light that opens onto the room (1.1 s): it
    // widens first, then opens vertically; exposure rises with it
    if (st.revealAt > 0 && st.reveal < 1) st.reveal = SNAP ? 1 : Math.min(1, (performance.now() - st.revealAt) / 1100)
    compU.uReveal.value.x = st.reveal
    compU.uReveal.value.z = W < 760 ? 0.5 : (colEdge('hero', W) / W + 1) / 2
    // The sun breathes slowly (high haze) and its colour follows: whiter when clear, warmer when hazy; shafts and dust take
    // the same colour
    { const k = SNAP ? 0 : 0.6 * Math.sin(now * 0.105) + 0.4 * Math.sin(now * 0.31 + 1.3)
      shared.uSunK.value = 1 + 0.06 * k
      sun.color.setRGB(SUN_COL.r, SUN_COL.g + 0.025 * k, SUN_COL.b + 0.03 * k)
      compU.uSun.value.copy(sun.color)
      // The air breathes: shaft density rises and falls slowly (offset from the sun), and reflections slide over the surfaces
      // (the environment turns a few degrees, about a minute and a half per round trip)
      const br = SNAP ? 0 : 0.6 * Math.sin(now * 0.16 + 0.8) + 0.4 * Math.sin(now * 0.257 + 2.1)
      volU.uDen.value = 1.2 * (1 + 0.18 * br)
      scene.environmentRotation.y = SNAP ? 0 : 0.16 * Math.sin(now * 0.07) + 0.05 * Math.sin(now * 0.19 + 1.0) }
    const wall = world.wall
    const { id, f } = storyAt()
    volU.uVolDet.value = 1
    // The first pinned page plays from its state queue (story.ts, protoQ), never faster than its minimum durations
    const pP = world.protoQ, pA = world.sec.arc ?? 0
    const inProto = id === 'protocol', inArc = id === 'arc'
    const rep = wall.replay

    const gateOk = world.gate.phase === 'ok'
    const ordIdx = (k: SecId) => ORDER.indexOf(k)
    const T = world.story
    const amberOn = rep >= 0 && T >= ordIdx('publish') - 0.45 && (T < ordIdx('arc') || (inArc && (pA < 0.7 || !gateOk)))
    // After the Arc verdict (admitted) the replayed sled stays green to the end even if its real registration has
    // expired; refused (one byte changed), it stays red
    const admitOn = rep >= 0 && !amberOn && gateOk && ((inArc && pA >= 0.7) || T > ordIdx('arc')) && wall.sleds[rep]?.led !== 'green'
    syncData(amberOn ? rep : -1, admitOn ? rep : -1)
    { const v = amberOn ? '1' : '0'; if (document.documentElement.dataset.amber !== v) document.documentElement.dataset.amber = v }

    // ---- Camera: each section keeps its framing while its title is read, then the camera glides to the next one over
    // the second half of the section ----
    const k0 = ORDER.indexOf(id)
    let target: View
    if (inProto) {
      target = protocolView(pP, wall, W, H)
      // Video landing: blend out of the protocol page. Once the pinned page ended, the camera stayed still until the Arc
      // section and then jumped (29°, 1.9 m); it now glides toward the Arc framing over that range
      const pa = secTop('protocol'), pEnd = pa + Math.max(1, secH('protocol') - H), aIn = secTop('arc') - H * 0.5
      const y0 = scrollY()
      if (aIn > pEnd + 1 && y0 > pEnd) target = lerpView(target, cached('arc'), easeIO(sm((y0 - pEnd) / (aIn - pEnd))))
    }
    // Video landing: arc -> end spread over f 0.75-1 (instead of 0.9-1)
    else if (inArc) target = f < 0.75 ? cached('arc') : lerpView(cached('arc'), cached('end'), easeIO(sm((f - 0.75) / 0.25)))
    else {
      // At the hero and the end the camera drifts while the text is read
      const a = id === 'hero' ? keyView('hero', wall, W, H, Math.min(1, f / 0.5)) : id === 'end' ? keyView('end', wall, W, H, f) : cached(id)
      const next = ORDER[k0 + 1]
      const b = next ? (next === 'protocol' ? protocolView(0, wall, W, H) : cached(next)) : a
      // Video landing: hero -> use spread over f 0.3-1 (instead of 0.5-1); the other transitions are unchanged
      const f0 = id === 'hero' ? 0.3 : 0.5
      target = lerpView(a, b, easeIO(sm((f - f0) / (1 - f0))))
    }
    // Service opened in place: the camera approaches its sled (0.9 s), then returns to the scroll framing
    { const want = world.svc.open ? 1 : 0
      st.svcU = SNAP ? want : Math.min(1, Math.max(0, st.svcU + (want ? dt : -dt) / 0.9))
      world.svc.u = st.svcU
      if (world.svc.slot >= 0 && st.svcU > 0) {
        if (st.svcSlot !== world.svc.slot || st.svcW !== W) { st.svcV = svcView(world.svc.slot, W, H); st.svcSlot = world.svc.slot; st.svcW = W }
        target = lerpView(target, st.svcV!, easeIO(st.svcU))
      } else if (!world.svc.open && st.svcU === 0) world.svc.slot = -1 }
    // Capture only (tournage.html): __faceOv = { slot, d, m } frames one sled face from the front, d metres away, its
    // height times m filling the image; the service catalog uses that render as the face of its sleds
    { const fo = (window as unknown as { __faceOv?: { slot: number; d: number; m: number; dx?: number } }).__faceOv
      if (TOURNAGE && fo) { const sl = SLOTS[fo.slot], cy = sl.base + (G.FT + G.FB) / 2, hh = ((G.FT - G.FB) / 2) * fo.m
        target = { p: new THREE.Vector3(sl.x + (fo.dx ?? 0), cy, fo.d), t: new THREE.Vector3(sl.x, cy, 0), fov: (2 * Math.atan(hh / fo.d) * 180) / Math.PI, shift: 0 } } }
    if (!st.cam) st.cam = { p: target.p.clone(), t: target.t.clone(), fov: target.fov, shift: target.shift }
    // The camera follows the scroll already smoothed by Lenis; its own smoothing is short (0.06 s) so the scene never lags
    // behind the text
    const kc = SNAP ? 1 : 1 - Math.exp(-dt / 0.06)
    st.cam.p.lerp(target.p, kc); st.cam.t.lerp(target.t, kc); st.cam.fov += (target.fov - st.cam.fov) * kc; st.cam.shift += (target.shift - st.cam.shift) * kc
    cam.position.copy(st.cam.p); cam.lookAt(st.cam.t)
    // Phone: on pinned pages the image moves above the panel; elsewhere the rack sits in the top band (0.22 H)
    const shiftT = mobileW(W) ? (inProto || (inArc && f < 0.9) ? pinShift(H, world.pinH[id] ?? 0) : MOB_SHIFT) : 0
    if (TOURNAGE) {
      // Video landing: on phones the image offset (top band, pinned-page panels) changed abruptly at the edges of the
      // pinned pages (up to 257 px); the real-time scene smooths it over time, the film smooths it over scroll (frames
      // are captured in order, top to bottom)
      const y = scrollY()
      if (Number.isNaN(shY) || Math.abs(y - shY) > 400) st.shift = shiftT
      else st.shift += (shiftT - st.shift) * (1 - Math.exp(-Math.abs(y - shY) / 140))
      shY = y
    } else st.shift = SNAP ? shiftT : st.shift + (shiftT - st.shift) * kc
    if (Math.abs(st.shift - shiftT) < 1e-4) st.shift = shiftT
    const sx = Math.round(st.cam.shift * 2000) / 2000
    if (st.shift !== projShift || Math.abs(cam.fov - st.cam.fov) > 1e-4 || sx !== projX || projFov !== cam.fov) {
      cam.fov = st.cam.fov; projShift = st.shift; projX = sx; projFov = cam.fov
      if (st.shift > 0 || sx !== 0) cam.setViewOffset(W, H, sx * W, st.shift * H, W, H); else cam.clearViewOffset()
      cam.updateProjectionMatrix()
    }
    cam.updateMatrixWorld()
    const dir = tmpV.subVectors(st.cam.t, st.cam.p).normalize()
    // The lock frame follows the on-screen quad of the slot (Frame.tsx); the camera only needs to face the facades
    world.frontal = dir.z < -0.45 && Math.abs(dir.y) < 0.5

    // The room darkens as the camera glides to the first pinned page and stays dark there; it comes back for the Arc check
    { const RK = Q.has('rk') ? Number(Q.get('rk')) : 0.9
      const want = inProto ? RK : id === 'invalid' ? 1 - (1 - RK) * easeIO(sm((f - 0.5) / 0.5)) : inArc ? RK + (1 - RK) * sm(pA / 0.25) : 1
      const rk = roomU.uRoomK
      rk.value = SNAP ? want : rk.value + (want - rk.value) * (1 - Math.exp(-dt / 0.15))
      if (Math.abs(rk.value - want) < 1e-4) rk.value = want
      // Shafts dim with it
      if (!Q.has('vk')) compU.uVolK.value = volBase * (0.35 + 0.65 * rk.value) }

    // ---- First pinned page: pull out, rise in front of the rack, explode, close, Arc sheet, back down, slide in ----
    // Timeline from cam.ts (PT)
    let pullT = 0
    if (inProto) pullT = PULL_OUT * sm((pP - PT.out0) / (PT.out1 - PT.out0)) * (1 - sm((pP - PT.in0) / (PT.in1 - PT.in0)))
    // The sled never slides in while raised (it comes back down onto its rails first)
    if (st.up > 0.002) pullT = PULL_OUT
    if (SNAP) st.pull = pullT
    // Outside the pinned page (jump or fast scroll to the Arc check) a drawer still out slides in quickly (up to 5 m/s,
    // stiff damped spring, about 0.3 s, no bounce) instead of at staging speed, so it never covers the next slot
    else { const fast = !inProto && pullT < st.pull, kS = fast ? 900 : 150, kD = fast ? 60 : 25, vM = fast ? 5 : 0.7
      const acc = kS * (pullT - st.pull) - kD * st.pullV; st.pullV = Math.max(-vM, Math.min(vM, st.pullV + acc * dt)); st.pull += st.pullV * dt
      if (fast && st.pull < 0) { st.pull = 0; st.pullV = 0 } }
    // Rise: the sled leaves its rails, rises, moves forward and turns towards the camera; it only rises once fully out,
    // and only comes back down onto its rails before sliding in
    const upT = inProto ? sm((pP - PT.up0) / (PT.up1 - PT.up0)) * (1 - sm((pP - PT.dn0) / (PT.dn1 - PT.dn0))) : 0
    { const railGate = Math.min(1, Math.max(0, (st.pull - 0.9 * PULL_OUT) / (0.1 * PULL_OUT)))
      let want = Math.min(upT, railGate)
      // It stays aside while the lid is up, layers are spread or the sheet is landing; never higher than its rails allow
      // (on a fast scroll up it is still in the rack)
      if (st.lid > 0.005 || st.explode > 0.005 || (st.sheetY > 0.005 && st.sheetY < 0.995)) want = Math.max(want, railGate)
      // Past the sheet moment, the sled waits for the sheet to land before coming down (fast scroll included)
      if (inProto && pP > PT.sh0 && st.sheetY > 0.005) want = Math.max(want, railGate)
      if (SNAP) st.up = want; else { const f_ = !inProto && want < st.up, kS = f_ ? 400 : 120, kD = f_ ? 40 : 22, vM = f_ ? 4 : 1.6; const acc = kS * (want - st.up) - kD * st.upV; st.upV = Math.max(-vM, Math.min(vM, st.upV + acc * dt)); st.up += st.upV * dt; st.up = Math.min(1.02, Math.max(0, st.up)) } }
    // The lid only lifts once the sled is aside (rise finished) and only closes once the layers are closed
    let lidT = inProto ? sm((pP - PT.lid0) / (PT.lid1 - PT.lid0)) * (1 - sm((pP - PT.lidC0) / (PT.lidC1 - PT.lidC0))) : 0
    lidT = Math.min(lidT, sm((st.up - 0.95) / 0.05))
    if (st.explode > 0.005) lidT = Math.max(lidT, 1)
    // Layers spread one by one (each scroll step lifts one), stay open and labelled, then close (top first) before the lid,
    // and the lid before the sheet
    const explodeT0 = inProto ? sm((pP - PT.ex0) / (PT.ex1 - PT.ex0)) * (1 - sm((pP - PT.exC0) / (PT.exC1 - PT.exC0))) : 0
    const kk = SNAP ? 1 : 1 - Math.exp(-dt / 0.1)
    st.lid += (lidT - st.lid) * kk
    // Layers only spread with the lid up
    const explodeT = Math.min(explodeT0, sm((st.lid - 0.85) / 0.15))
    st.explode += (explodeT - st.explode) * kk
    // The Arc sheet comes down from above once the lid is closed (from 1.3 m up, out of frame), lands on the lid, then
    // slides in with the drawer. Outside the pinned page it stays landed while visible
    const sheetShown = st.sheetO > 0.01 && st.pull > 0.002
    // Outside the pinned page, a sheet left halfway (fast scroll leaving the protocol mid-descent) lands on the raised sled
    // instead of freezing: frozen, it held the sled up, which held the drawer out (deadlock)
    let sheetT = inProto ? 1 - sm((pP - PT.sh0) / (PT.sh1 - PT.sh0)) : sheetShown ? (st.up >= 0.95 && st.lid <= 0.05 && T > ordIdx('protocol') ? 0 : st.sheetY) : 1
    // The sheet only moves (down or up) on the raised sled; otherwise it stays where it is (above, or landed and slid in)
    if (inProto && st.up < 0.95) sheetT = st.sheetY < 0.5 ? 0 : 1
    st.sheetY = !inProto && !sheetShown ? 1 : st.sheetY + (sheetT - st.sheetY) * kk
    const sheetOn = inProto ? pP > PT.lidC0 : (T >= ordIdx('protocol') + 0.99 && T < ordIdx('arc') + 0.95)
    st.sheetO += ((sheetOn ? 1 : 0) - st.sheetO) * (SNAP ? 1 : 1 - Math.exp(-dt / 0.2))
    // The state queue (story.ts) does not advance a step until the previous one has played (drawer and rise springs take
    // their real time): scrolling down, the sled is out before rising, aside before the lid, lid up before the layers,
    // layers open before closing, closed before the lid, lid closed before the sheet, sheet landed before sliding in;
    // scrolling up, the reverse
    { const q = world.protoQ, e = 0.005
      let hi = 1, lo = 0
      const fw: [number, boolean][] = [[PT.up0 + 0.02, st.pull >= 0.9 * PULL_OUT], [PT.lid0, st.up >= 0.95], [PT.ex0 + 0.01, st.lid >= 0.85], [PT.exC0 - 0.02, st.explode >= 0.95], [PT.lidC0, st.explode <= 0.05], [PT.sh0, st.lid <= 0.05], [PT.dn0, st.sheetY <= 0.02], [PT.in0, st.up <= 0.05]]
      for (const [T, ok] of fw) if (!ok && T >= q - e) hi = Math.min(hi, T)
      const bw: [number, boolean][] = [[PT.in0, st.pull >= 0.9 * PULL_OUT], [PT.dn0, st.up >= 0.95], [PT.lidC1, st.sheetY >= 0.98], [PT.exC1, st.lid >= 0.85], [PT.ex1, st.explode >= 0.95], [PT.ex0, st.explode <= 0.05], [PT.up1, st.lid <= 0.05], [PT.out1, st.up <= 0.05]]
      for (const [T, ok] of bw) if (!ok && T <= q + e) lo = Math.max(lo, T)
      world.protoGate[0] = lo; world.protoGate[1] = hi }

    // ---- Hover: the drawer lifts (comes out 30 mm) ----
    const hov = world.svc.slot >= 0 && st.svcU > 0 ? world.svc.slot : world.lock >= 0 ? world.lock : world.hover
    if (hov !== st.hoverSlot && st.hoverPull < 0.002) st.hoverSlot = hov
    const hT = hov >= 0 && hov === st.hoverSlot && !((inProto || inArc) && hov === rep) ? 0.03 : 0
    st.hoverPull = SNAP ? hT : st.hoverPull + (hT - st.hoverPull) * (1 - Math.exp(-dt / (hT > st.hoverPull ? 0.09 : 0.07)))

    // ---- Per-slot attributes ----
    const focus = hov >= 0 ? hov : inProto || inArc ? rep : id === 'use' ? wall.ex.use : id === 'rent' ? wall.ex.rent : id === 'publish' ? wall.ex.publish : id === 'invalid' ? wall.ex.invalid : -1
    const dimOn = st.svcU > 0 ? 0.3 * easeIO(st.svcU) : id !== 'hero' && id !== 'end' && focus >= 0 ? 0.22 : hov >= 0 ? 0.12 : 0
    // Each state section has its gesture, driven by its progress (scrolling plays it, and plays it backwards): Use, the
    // green LED takes a payment; Rent, the open slot lights up; Publish, amber pulses once; Invalid, the red LED misfires
    const gp = world.sec[id] ?? 0
    const bump = (a: number, b: number) => { const u = (gp - a) / (b - a); return u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0 }
    // Gestures finish before the section stop (story.ts, STATE_STOP 0.32): at the stop, the state is set
    const gUse = id === 'use' ? bump(0.12, 0.3) : 0
    const gRent = id === 'rent' ? sm((gp - 0.08) / 0.22) : 0
    const gPub = id === 'publish' ? bump(0.12, 0.3) : 0
    // Invalid: a real failure flicker, played in time once the sled is framed (0.25 of the section) and replayed on every
    // new entry: the LED drops, sputters, drops again, comes back, always red
    if (id === 'invalid' && gp >= 0.25 && gp < 0.9) { if (invAt < 0) invAt = now } else if (id !== 'invalid' || gp < 0.12) invAt = -1
    const ratee = id === 'invalid' && invAt >= 0 && !REDUCED ? panne(now - invAt) : 1
    // Refused by Arc (one byte changed): the replayed sled LED turns red at the end of the check
    const refused = inArc && pA >= 0.7 && world.gate.phase === 'refused'
    // The headline rect is kept in page coordinates (re-read every 0.5 s near the hero) and projected to the screen every
    // frame, so the dimmed area under "OPEN MARKET." never lags behind the text while scrolling
    const sy0 = window.scrollY
    if (sy0 < innerHeight * 1.5 && (catchAt < 0 || now - catchAt > 0.5 || now < catchAt)) {
      catchAt = now
      const r = document.querySelector('.catch .c2')?.getBoundingClientRect()
      catchR = r ? new DOMRect(r.left, r.top + sy0, r.width, r.height) : null
    }
    for (let i = 0; i < NSLOTS; i++) {
      const s = wall.sleds[i]
      let r = 0, g = 0, b = 0, w = 0
      const amber = amberOn && i === rep
      if (!POSTER && (amber || (s && s.led !== 'off'))) {
        const c = amber ? LED.amber : LED[s!.led as 'green']
        r = c.r; g = c.g; b = c.b
        // Amber breathes, red and green are steady
        w = amber ? (REDUCED ? 5 : 3.4 + 1.7 * (0.5 + 0.5 * Math.cos(now / 2.4 * Math.PI * 2)))
          : s!.led === 'red' ? 4.0 : s!.led === 'amber' ? 3.0
          : 5.2
        if (amber && i === wall.ex.publish) w *= 1 + 1.4 * gPub
        if (i === wall.ex.use && s?.led === 'green') w *= 1 + 1.2 * gUse
        // The LED is red from the start, like its plate and text; the Invalid gesture is the misfire alone
        if (i === wall.ex.invalid && s?.led === 'red') w *= ratee
      }
      if (admitOn && i === rep && !POSTER) { r = LED.green.r; g = LED.green.g; b = LED.green.b; w = 5.2 }
      if (refused && i === rep) { r = LED.red.r; g = LED.red.g; b = LED.red.b; w = 4.0 }
      // The open slot in Rent lights up: a low white glow in its slit
      if (gRent > 0 && i === wall.ex.rent && (!s || s.led === 'off')) { r = INK_OFF.r; g = INK_OFF.g; b = INK_OFF.b; w = 1.1 * gRent }
      // Rent: the open drawer moves out 22 mm as it lights up (Use: the LED takes the payment, no pull-out)
      const pull = (i === st.hoverSlot ? st.hoverPull : 0) + (i === wall.ex.rent && (!s || s.led === 'off') ? 0.022 * gRent : 0)
      // The pulled-out replayed sled facade follows the sled through its matrix (followFace), not aPull
      const pl = i === rep ? (st.pull > 0.002 || st.up > 0.001 ? 0 : pull) : pull
      faceAttr.led[i * 4] = r; faceAttr.led[i * 4 + 1] = g; faceAttr.led[i * 4 + 2] = b; faceAttr.led[i * 4 + 3] = w
      faceAttr.pull[i] = pl
      faceAttr.dim[i] = i === focus || (id === 'invalid' && i === wall.ex.inactive) ? 0 : dimOn
      // The open slot framed by "Rent out" is readable; the others stay engraved, discreet
      if (!amber && (!s || s.led === 'off')) {
        // "OPEN SLOT" is a light, legible engraving, well below the backlit names. Under the headline it dims by half at most,
        // faded in space (60 px around the area): never off, never a jump between frames as the plate passes under the text
        let k0 = OPEN_INK
        if (catchR && catchR.bottom - sy0 > -60 && catchR.top - sy0 < innerHeight + 60) { const sl = SLOTS[i]; tmpS.set(sl.x, sl.y, 0.01).project(cam)
          const sx = (tmpS.x + 1) * 0.5 * innerWidth, sy = (1 - tmpS.y) * 0.5 * innerHeight + sy0
          const dx = Math.max(catchR.left - 70 - sx, 0, sx - catchR.right - 70), dy = Math.max(catchR.top - 30 - sy, 0, sy - catchR.bottom - 30)
          const m = (1 - sm(dx / 60)) * (1 - sm(dy / 40))
          k0 = Math.round(OPEN_INK * (1 - 0.5 * m) * 1000) / 1000 }
        const k = i === focus && hov < 0 && id === 'rent' ? Math.round((k0 + 0.17 * gRent) * 1000) / 1000 : k0
        if (plateA.tint[i * 4 + 3] !== k) { plateA.tint[i * 4 + 3] = k; tintDirty = true }
      }
    }
    if (tintDirty) { plTintA.needsUpdate = true; tintDirty = false }
    world.pulses = world.pulses.filter((p) => now - p.at < 0.3)
    // A pulse (live payment) rises and falls smoothly rather than a single-frame flash
    for (const p of world.pulses) { const q = now - p.at; if (q >= 0 && q < 0.3) { const k = Math.sin(Math.PI * q / 0.3); faceAttr.led[p.slot * 4 + 3] = Math.max(faceAttr.led[p.slot * 4 + 3] * (1 + 0.9 * k), 8 * k) } }
    ledA.needsUpdate = true; pullA.needsUpdate = true; dimA.needsUpdate = true

    // ---- Pulled-out replayed sled ----
    const s = rep >= 0 ? SLOTS[rep] : null
    heroG.visible = heroReady && !!s && (st.pull > 0.002 || st.sheetO > 0.01)
    // Telescopic rails retract into the rack when the sled leaves them (no bar in mid-air)
    const railK = 1 - sm(st.up / 0.35)
    rails.visible = heroReady && !!s && st.pull > 0.03 && railK > 0.01
    if (s) {
      // On its rails (centre from st.pull), then in the air in front of the rack (stageCenter): it first rises straight up
      // (leaving the rails), then moves forward and turns towards the camera
      const u = Math.min(1, Math.max(0, st.up))
      const uy = sm(u / 0.55), uz = easeIO(sm((u - 0.3) / 0.7))
      stageCenter(rep, tmpS)
      const cx = s.x + (tmpS.x - s.x) * uz
      const cy = s.base + G.SH / 2 + (tmpS.y - s.base - G.SH / 2) * uy
      const cz0 = st.pull - G.Y0 - G.SD / 2, cz = cz0 + (tmpS.z - cz0) * uz
      const rot = STAGE_ROT * uz
      heroG.rotation.set(0, rot, 0)
      // Local sled centre (0, SH/2, -(Y0 + SD/2)) rotated, subtracted from the target centre
      const lz = -(G.Y0 + G.SD / 2) * K, ly = (G.SH / 2) * K
      heroG.position.set(cx - Math.sin(rot) * lz, cy - ly, cz - Math.cos(rot) * lz)
      heroG.updateMatrixWorld()
      { let y = 0; parts.forEach((p, j) => { y += p.d * exOf(j); p.y = y; p.o.position.y = p.base + y }) }
      // The lid rises straight and leaves the frame at the top (never in front of the sled)
      const lidUp = st.lid * 1.4
      // (film-qualite: hidden only once fully up, out of frame; at 0.6 it could still show at the top edge and vanish in
      // place between two film frames)
      if (lid) { lid.position.y = lidBase + lidUp; lid.visible = st.lid < 0.98 }
      // The sheet sits exactly on the lid (top of the ribs, 0.0791); it comes down from 1.3 m and never goes under the lid:
      // while the lid is up, it waits above it
      const shUp = Math.max(st.sheetY * 1.3, st.lid > 0.001 ? lidUp + 0.03 : 0)
      sheet.position.set(0, SHEET_REST + SHEET.th / 2 + shUp, (SHEET.z0 + SHEET.z1) / 2)
      // The sheet is only drawn while the drawer is out: slid in, the facade hides it (and the transmission pass does not run
      // for nothing during the Arc section)
      sheet.visible = st.sheetO > 0.01 && st.pull > 0.002
      sheetMat.opacity = st.sheetO; sheetU.uLogoA.value = st.sheetO
      sheetU.uHeat.value = inProto ? 0.55 + 0.45 * sm((pP - 0.66) / 0.06) : inArc ? 0.9 : 0.7
      // Service light above, in front and to the left of the sled: it grazes the exploded layers
      tmpV.set(-0.32, 0.62, 0.05 + G.Y0 + G.SD / 2).applyMatrix4(heroG.matrixWorld)
      fill.position.copy(tmpV)
      fill.intensity = inProto ? 5.5 * sm((pP - 0.15) / 0.1) * (1 - sm((pP - 0.86) / 0.1)) : 0
      if (rails.visible) {
        const len = Math.max(0.01, (st.pull - (0.15 + 0.014) * K) * railK)
        rails.position.set(s.x, s.base, 0.014 * K + len / 2); rails.scale.set(1, 1, len)
      }
    }
    // The replayed sled facade (instanced parts: glass, LED, title, halo) follows the sled out, position and rotation; slid
    // in, it gets its original matrix back
    followFace(s && heroG.visible && (st.pull > 0.002 || st.up > 0.001) ? rep : -1)
    // While Arc verifies, blue light surrounds the sled and goes round like a progress bar, at the pace of the hash cells;
    // on the last step everything turns green (refused: red)
    const jOn = inArc && s ? sm((pA - 0.06) / 0.08) * (1 - sm((pA - 0.9) / 0.08)) : 0
    joint.visible = jOn > 0.002
    if (s && joint.visible) {
      joint.position.set(s.x, s.base + (G.FT + G.FB) / 2, 0.0009)
      const ju = jointMat.uniforms
      ju.uOn.value = jOn
      ju.uProg.value = Math.min(1, Math.max(0, (pA - 0.25) / 0.37))
      // Lock pulse, once, when the frame closes (0.7 s, quick rise, soft fall)
      if (ju.uProg.value >= 1 && st.lockAt < 0) st.lockAt = now
      if (ju.uProg.value < 0.999) st.lockAt = -1
      { const u = st.lockAt < 0 ? 0 : (now - st.lockAt) / 0.7; ju.uPulse.value = u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * Math.min(1, u * 2.2)) * (1 - u) * 1.4 }
      const verdict = pA >= 0.7 && (world.gate.phase === 'ok' || world.gate.phase === 'refused')
      ju.uOk.value += ((verdict ? 1 : 0) - ju.uOk.value) * kk
      ju.uEnd.value.copy(world.gate.phase === 'refused' ? LED.red : LED.green)
    }

    // Body of the hovered drawer (or the Rent open drawer moving out when nothing is hovered)
    { const hv = st.hoverSlot >= 0 && st.hoverPull > 0.002 && st.hoverSlot !== rep
      const rs = wall.ex.rent, rp = rs >= 0 ? faceAttr.pull[rs] : 0
      const bs = hv ? st.hoverSlot : rp > 0.002 ? rs : -1
      body.visible = bs >= 0
      if (body.visible) { const b2 = SLOTS[bs]; body.position.set(b2.x, b2.base + G.SH / 2, faceAttr.pull[bs] - 0.5 - 0.008); body.scale.set(1, 1, 1) } }

    // ---- On-screen rects (lock, cursor, leader lines) ----
    world.rects.clear()
    const rectOf = (i: number) => {
      const sl = SLOTS[i]; const z = (i === st.hoverSlot ? st.hoverPull : 0) + (i === rep ? st.pull : 0)
      // The four facade corners on screen (top left, top right, bottom right, bottom left); the bounding box for whatever only
      // needs a rect
      const a = toScreen(sl.x - G.FW / 2, sl.base + G.FT, z), b = toScreen(sl.x + G.FW / 2, sl.base + G.FT, z)
      const c = toScreen(sl.x + G.FW / 2, sl.base + G.FB, z), e = toScreen(sl.x - G.FW / 2, sl.base + G.FB, z)
      const x0 = Math.min(a.x, e.x), x1 = Math.max(b.x, c.x), y0 = Math.min(a.y, b.y), y1 = Math.max(c.y, e.y)
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, q: [a.x, a.y, b.x, b.y, c.x, c.y, e.x, e.y], vis: a.z < 1 && b.z < 1 && x1 > 0 && x0 < W && y1 > 0 && y0 < H }
    }
    for (const i of [world.hover, world.lock, focus, wall.ex.use, wall.ex.rent, wall.ex.publish, wall.ex.invalid, wall.ex.inactive, rep]) if (i >= 0 && !world.rects.has(i)) world.rects.set(i, rectOf(i))
    const A = world.anchors; A.clear()
    if (s && heroG.visible) {
      // Seven labels: the tray (j = 0) is named when the stack leaves it, each layer when its gap opens (points in sled space).
      // The label sits just right of its layer: the anchor is the right end of the layer on screen
      parts.forEach((p, j) => {
        // The leader line starts on the layer itself (top of the layer, right side)
        const e = exOf(Math.max(1, j)), y = p.hi + p.y
        tmpV.set(p.ax, y, p.az).applyMatrix4(heroG.matrixWorld); const q = toScreen(tmpV.x, tmpV.y, tmpV.z)
        A.set(`part.${j}`, { x: q.x, y: q.y, vis: e })
      })
      tmpV.set(-SHEET.w / 2, sheet.position.y, (SHEET.z0 + SHEET.z1) / 2).applyMatrix4(heroG.matrixWorld)
      const q = toScreen(tmpV.x, tmpV.y, tmpV.z)
      A.set('sheet', { x: q.x, y: q.y, vis: st.sheetO * (st.sheetY < 0.25 ? 1 : 0) })
    }

    // ---- Dust: the grain box follows the view ----
    dustU.uBoxC.value.copy(st.cam.t).lerp(st.cam.p, 0.35)
    // At the hero the grain box slides towards the left room so dust lights up in the beam behind the text column
    { const hw = id === 'hero' ? 1 - sm((f - 0.5) / 0.5) : 0
      st.dustX += (hw - st.dustX) * (SNAP ? 1 : 1 - Math.exp(-dt / 0.6))
      dustU.uBoxC.value.x -= 1.5 * st.dustX }
    // ---- Text column overlay: its width follows the section column (wider at hero and end) ----
    const mob = W < 760
    const ovT = mob ? 0.45 : colEdge(id, W) / W
    st.ov += (ovT - st.ov) * (SNAP ? 1 : 1 - Math.exp(-dt / 0.5))
    world.wallX = mob ? 0 : Math.round(st.ov * W)
    // Phone: the overlay keeps the bottom of the screen under the hero and section text; on pinned pages the text panel has
    // its own background and the 3D moves above it
    const obT = 0
    st.ovB += (obT - st.ovB) * (SNAP ? 1 : 1 - Math.exp(-dt / 0.5))
    // Phone, hero: the overlay rises so the whole headline sits on the dark background, never on the wall
    const mT = id === 'hero' ? 0.30 : 0.55
    st.ovM += (mT - st.ovM) * (SNAP ? 1 : 1 - Math.exp(-dt / 0.5))
    // Room through the fade, per section: sharp and lighter where only the room is behind (hero, end); blurred and darker
    // where a rack passes under the column (state sections, Arc: no legible plate); in between on the first pinned page
    { const OT = mob ? OVS_MOB : OVS
      const A0 = OT[id] ?? OT.use, B0 = OT[ORDER[k0 + 1] ?? id] ?? A0
      // Settings follow the camera glide to the next section (no sharp rack under the fade on the way)
      const u = inProto || inArc ? 0 : easeIO(sm((f - 0.5) / 0.5))
      const T = [A0[0] + (B0[0] - A0[0]) * u, A0[1] + (B0[1] - A0[1]) * u, A0[2] + (B0[2] - A0[2]) * u]
      const kq = SNAP ? 1 : 1 - Math.exp(-dt / 0.5)
      const g = compU.uOvG.value
      g.x += ((OVQ[0] ?? T[0]) - g.x) * kq
      g.y += ((OVQ[1] ?? T[1]) - g.y) * kq
      g.z += ((OVQ[2] ?? T[2]) - g.z) * kq }
    compU.uOv.value.set(mob ? st.ovM : st.ov, (mob && (inProto || inArc) ? 0 : 1) * (1 - easeIO(st.svcU)) * OVK, mob ? 1 : 0, st.ovB > 0.004 ? st.ovB : 0)
    const P = world.pointer
    const mk = P.inside && !P.touch ? 1 : 0
    compU.uMouse.value.x = P.x / W; compU.uMouse.value.y = 1 - P.y / H
    compU.uMouse.value.z += (mk - compU.uMouse.value.z) * (SNAP ? 1 : 1 - Math.exp(-dt / 0.4))
    // Loupe: within the 22 px cursor square, no bigger
    compU.uLoupe.value.set(P.x * DPR, (H - P.y) * DPR, 10 * DPR, world.loupe && P.inside && !P.touch && document.documentElement.dataset.cur === '1' && world.lock < 0 && world.arming <= 0 ? 1 : 0)

    renderFrame()
    if (TOURNAGE) filmMeta(rep)
  })

  // ---- Video landing: metadata of one captured film frame (read by the capture script) ----
  // Per frame: the view-projection matrix, the lens position, the facade matrix of the replayed sled when it is pulled
  // out (facade frame -> world), the pull of Rent's free drawer, the column overlay, the explode anchors, and per sled
  // the visibility (rays toward the plate and the LED, against the pulled sled, its rails and the sheet) and the air
  // transmission (height fog, same formula as GLSL_FOG)
  const fmRay = new THREE.Raycaster(), fmBox = new THREE.Box3(), fmV = new THREE.Vector3(), fmD = new THREE.Vector3(), fmVP = new THREE.Matrix4()
  function fogT(x: number, y: number, z: number) {
    const cp = cam.position, dx = x - cp.x, dy = y - cp.y, dz = z - cp.z
    const dist = Math.max(Math.hypot(dx, dy, dz) - shared.uFogN.value, 0), k = shared.uFogK.value, y0 = Math.max(cp.y, 0)
    const integ = Math.abs(dy) > 1e-3 ? (Math.exp(-k * y0) - Math.exp(-k * (y0 + dy))) / (k * dy) : Math.exp(-k * y0)
    return 1 - Math.min(1, Math.max(0, 1 - Math.exp(-shared.uFogD.value * dist * integ)))
  }
  function filmMeta(rep: number) {
    fmVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    const out = fSlot >= 0 ? heroG.matrixWorld.toArray() : null
    const occ = heroG.visible ? [heroG, rails, sheet].filter((o) => o.visible) : []
    const vis: number[] = [], fog: number[] = []
    const W_ = world.wall
    for (let i = 0; i < NSLOTS; i++) {
      const s = SLOTS[i], p = plateOf(s), l = ledOf3(s)
      const M = i === fSlot ? heroG.matrixWorld : null
      const pz = faceAttr.pull[i]
      const pts: [number, number][] = [[(p.x0 + p.x1) / 2, p.y], [p.x0 + 0.01, p.y + p.th * 0.6], [p.x1 - 0.01, p.y + p.th * 0.6], [p.x0 + 0.01, p.y - p.th * 0.6], [p.x1 - 0.01, p.y - p.th * 0.6], [l.x, l.y]]
      let seen = 0
      for (const [x, y] of pts) {
        fmV.set(x - s.x, y - s.base, pz + 0.001)
        if (M) fmV.applyMatrix4(M); else fmV.add(tmpV.set(s.x, s.base, 0))
        if (!occ.length || i === fSlot) { seen++; continue }
        fmD.subVectors(fmV, cam.position); const d = fmD.length(); fmD.normalize()
        fmRay.set(cam.position, fmD); fmRay.far = d - 0.002
        if (!fmRay.intersectObjects(occ, true).some((h) => h.object.visible)) seen++
      }
      vis.push(seen)
      fmV.set((p.x0 + p.x1) / 2 - s.x, p.y - s.base, pz); if (M) fmV.applyMatrix4(M); else fmV.add(tmpV.set(s.x, s.base, 0))
      fog.push(Math.round(fogT(fmV.x, fmV.y, fmV.z) * 255))
    }
    // Moving objects of the pinned protocol page (seven layers, lid, Arc sheet): the eight corners of each box on screen
    // (CSS px), with the object's visibility. The sampling plan (plan.mjs) bounds their motion between two frames; the
    // player does not read them
    const movers: number[] = []
    if (heroG.visible) heroG.updateMatrixWorld(true)
    for (const o of [...parts.map((p) => p.o), lid, sheet]) {
      const on = !!o && heroG.visible && o.visible
      if (on) fmBox.setFromObject(o!)
      for (let c = 0; c < 8; c++) {
        if (!on || fmBox.isEmpty()) { movers.push(0, 0, 0); continue }
        fmV.set(c & 1 ? fmBox.max.x : fmBox.min.x, c & 2 ? fmBox.max.y : fmBox.min.y, c & 4 ? fmBox.max.z : fmBox.min.z).project(cam)
        movers.push((fmV.x + 1) / 2 * W, (1 - fmV.y) / 2 * H, fmV.z < 1 ? 1 : 0)
      }
    }
    const anchors: number[] = []
    for (const k of ['part.0', 'part.1', 'part.2', 'part.3', 'part.4', 'part.5', 'part.6', 'sheet']) { const a = world.anchors.get(k); anchors.push(a ? a.x : 0, a ? a.y : 0, a ? a.vis : 0) }
    ;(window as unknown as { __filmMeta: unknown }).__filmMeta = {
      vp: fmVP.toArray(), cam: cam.position.toArray(), rep: out, rentPull: W_.ex.rent >= 0 ? faceAttr.pull[W_.ex.rent] : 0,
      ov: compU.uOv.value.toArray(), anchors, movers, frontal: world.frontal ? 1 : 0, wallX: world.wallX, vis, fog,
      W, H, story: world.story, protoQ: world.protoQ, ex: W_.ex, replay: W_.replay,
    }
  }

  // Profiling: long animation frames and GPU counters, exposed under ?perf
  const perf = { loaf: [] as { d: number; t: number; s: string }[], programs: 0, textures: 0, geometries: 0, cam: [0, 0, 0] }
  ;(window as unknown as { __perf: typeof perf }).__perf = perf
  // Plate state for automated checks: title, ink, dimming, per slot
  ;(window as unknown as { __plates: object }).__plates = { txt: plateA.txt, tint: plateA.tint, dim: faceAttr.dim, pull: faceAttr.pull, offRow: () => atlas.row(t('plate.off')), rows: () => atlas.rows.size, xy: SLOTS.map((q) => [q.x, q.y]) }
  let po: PerformanceObserver | null = null
  try {
    po = new PerformanceObserver((l) => {
      for (const e of l.getEntries() as (PerformanceEntry & { scripts?: { sourceURL: string; invoker: string; sourceFunctionName: string; duration: number }[] })[]) perf.loaf.push({ d: Math.round(e.duration), t: Math.round(e.startTime), s: (e.scripts ?? []).map((x) => `${x.invoker} ${x.sourceFunctionName} ${x.sourceURL.split('/').pop()} ${Math.round(x.duration)}`).join(' | ').slice(0, 300) })
    })
    po.observe({ type: 'long-animation-frame', buffered: true })
  } catch { /* browser without LoAF */ }
  const offInfo = onTick(() => { perf.programs = renderer.info.programs?.length ?? 0; perf.textures = renderer.info.memory.textures; perf.geometries = renderer.info.memory.geometries; perf.cam[0] = cam.position.x; perf.cam[1] = cam.position.y; perf.cam[2] = cam.position.z })

  // The intro only starts once the wall is ready (a wall never pops in, already open, after a wait)
  const reveal = () => { wantReveal = true; if (ready && !st.revealAt) st.revealAt = performance.now(); if (SNAP) st.reveal = 1 }
  const dispose = () => { off(); offPal(); offInfo(); po?.disconnect(); removeEventListener('resize', onResize); clearTimeout(rzT); renderer.dispose(); pm.dispose(); rtMain.dispose(); rtVol.dispose(); rtVolB.dispose(); rtDown.dispose(); rtDown2.dispose() }
  return { dispose, reveal }
}

function MOBILE_LIGHT() { return innerWidth < 760 }
