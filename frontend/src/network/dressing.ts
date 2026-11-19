// Scene dressing: the islands modelled and baked in Blender replace the simple volumes of world.ts,
// at the same dimensions; the rigged figures.
//   - each island: a decor mesh (vertex colours) and, for workstations, the seats (fabric); two maps per
//     island on the second UV set: diffuse lighting baked in colour (lm_<island>.webp: sky, key light, bounces,
//     screens, and at the dev's at night, the window and the desk lamp, the only warm source) and material
//     (rm_<island>.webp: R lacquer clearcoat, G roughness, B metal); tileable detail normal (fine concrete from
//     Poly Haven, fabric from ambientCG);
//   - lacquer: a clearcoat with a sharp reflection on a satin base, like the landing racks;
//   - the lab drone (propeller guards); the lamp bulb; the rigged faceted figures, holographic like the A;
//   - no dynamic shadows: the decor diffuse comes from the baked map, live lights only give reflections.
// If loading fails, the scene keeps its previous volumes (nothing breaks).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { World, PartK } from './world'
import type { People } from './people'

// baked diffuse gain: the map stores the square root of the Blender irradiance normalised by LREF; this factor
// brings the baked irradiance to the brightness of the live render (same exposure)
const LM_GAIN = Number(new URLSearchParams(location.search).get('lmg') ?? 2.2)

function lmPatch(mat: THREE.MeshStandardMaterial, gain: number) {
  const u = { value: gain }
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLm = u
    sh.fragmentShader = 'uniform float uLm;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
      {
        vec3 lmn = texture2D(aoMap, vAoMapUv).rgb;
        float lml = dot(lmn, vec3(0.333));
        reflectedLight.directDiffuse = vec3(0.0);
        reflectedLight.indirectDiffuse = material.diffuseColor * lmn * lmn * uLm;
        reflectedLight.directSpecular *= smoothstep(0.08, 0.6, lml);
        reflectedLight.indirectSpecular *= mix(0.15, 1.0, smoothstep(0.04, 0.5, lml));
      }`)
  }
  mat.customProgramCacheKey = () => 'n3d-lm-rgb'
  return u
}

// figure material: the Arc A hologram (world.ts, buildArc), same shader and same blue, applied to the
// faceted figure (people.glb): the A material is cloned, its time shared (the sweeps advance together),
// and only what an animated figure requires changes: skinning in the vertex shader, a per-facet normal
// (derivatives: each plane lights up at its own angle, the facets read), a soft per-facet light to keep
// volumes readable, and a single visible face (depth pre-pass, FIG_PRE): no ghosting where all limbs add
// up. ?fig=noir keeps the black lacquer for comparison.
export const FIG_STYLE: 'holo' | 'noir' = new URLSearchParams(location.search).get('fig') === 'noir' ? 'noir' : 'holo'
export function FIG_MAT(arc: THREE.ShaderMaterial): THREE.Material {
  if (FIG_STYLE === 'noir') return new THREE.MeshPhysicalMaterial({ color: 0x0b0c0f, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, flatShading: true, envMapIntensity: 1.6 })
  const m = arc.clone()
  m.uniforms.uT = arc.uniforms.uT
  m.uniforms.uHl = { value: 1 }
  m.side = THREE.FrontSide
  m.vertexShader = /* glsl */`#include <common>
    #include <skinning_pars_vertex>
    varying vec3 vN; varying vec3 vW; varying vec3 vV;
    void main() {
      #include <skinbase_vertex>
      #include <begin_vertex>
      #include <beginnormal_vertex>
      #include <skinnormal_vertex>
      #include <skinning_vertex>
      vec4 w = modelMatrix * vec4(transformed, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * objectNormal); vV = normalize(cameraPosition - w.xyz);
      gl_Position = projectionMatrix * viewMatrix * w; }`
  const fs = arc.fragmentShader
    .replace('void main() {', 'void main() {\n        vec3 fN = normalize(cross(dFdx(vW), dFdy(vW)));')
    .replace('abs(dot(normalize(vN), vV))', 'abs(dot(fN, vV))')
    .replace('gl_FragColor = vec4(c * a, a);', `float lf = abs(dot(fN, normalize(vec3(-0.45, 0.8, 0.4))));
        c += uCore * 0.22 * lf * lf; a = min(1.0, a * 1.25 + 0.12 * lf);
        gl_FragColor = vec4(c * a, a);`)
  if (!fs.includes('fN = normalize') || !fs.includes('lf * lf')) console.warn('FIG_MAT : le nuanceur du A a changé, facettes non appliquées')
  m.fragmentShader = fs
  m.customProgramCacheKey = () => 'fig-holo'
  return m
}
// depth pass of the holographic figures (nothing on screen; a slight offset so the hologram passes)
export const FIG_PRE = () => FIG_STYLE === 'holo'
  ? new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
  : undefined

export async function dress(W: World, people: People, renderer: THREE.WebGLRenderer | null) {
  const tl = new THREE.TextureLoader()
  const tex = (url: string, srgb = false, ch = 0, rep = false) => tl.loadAsync(url).then((t) => {
    t.flipY = false; t.channel = ch; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() ?? 1)
    return t
  })
  const gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const K: PartK[] = ['use', 'publish', 'rent']
  const [gltf, pgl, meta, nor, fabN, fabR, ...maps] = await Promise.all([
    gl.loadAsync('./net/net3d.glb'), gl.loadAsync('./net/people.glb'), fetch('./net/net3d.json').then((r) => r.json() as Promise<{ lref: Record<PartK, number> }>),
    tex('./tex/conc_nor.webp', false, 0, true), tex('./net/fab_nor.webp', false, 0, true), tex('./net/fab_rgh.webp', false, 0, true),
    ...K.flatMap((k) => [tex(`./net/lm_${k}.webp`, false, 1), tex(`./net/rm_${k}.webp`, false, 1)]),
  ])
  gltf.scene.updateMatrixWorld(true)
  // quantised geometry (meshopt) carries its dequantisation on the node: convert it back to floats, in the
  // island frame, once and for all
  const byName = (n: string) => {
    let m: THREE.Mesh | null = null
    gltf.scene.traverse((o) => { if (o.name === n && (o as THREE.Mesh).isMesh) m = o as THREE.Mesh })
    if (!m) return null
    const src = m as THREE.Mesh, g = new THREE.BufferGeometry()
    for (const [k, a] of Object.entries(src.geometry.attributes) as [string, THREE.BufferAttribute][]) {
      const it = a.itemSize, arr = new Float32Array(a.count * it)
      for (let i = 0; i < a.count; i++) for (let c = 0; c < it; c++) arr[i * it + c] = a.getComponent(i, c)
      g.setAttribute(k, new THREE.BufferAttribute(arr, it))
    }
    g.setIndex(src.geometry.index); g.applyMatrix4(src.matrixWorld); g.computeBoundingSphere()
    return { geometry: g }
  }

  K.forEach((k, i) => {
    const lm = maps[i * 2], rm = maps[i * 2 + 1]
    const g = W.islands[k].group
    const mats = g.userData.mats as THREE.Material[]
    // previous volumes: merged decor, painted top of the base, sign wall, racks
    for (const n of ['static', 'top', 'wall', 'racks']) {
      for (const o of g.children.filter((c) => c.name === n)) {
        g.remove(o)
        const m = (o as THREE.Mesh).material as THREE.Material
        const j = mats.indexOf(m); if (j >= 0) mats.splice(j, 1)
      }
    }
    const gain = meta.lref[k] * LM_GAIN
    const stat = byName(`${k}_static`)
    if (stat) {
      const m = new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: 1, metalness: 1, roughnessMap: rm, metalnessMap: rm,
        clearcoat: 1, clearcoatMap: rm, clearcoatRoughness: 0.07,
        normalMap: nor, normalScale: new THREE.Vector2(0.14, 0.14), aoMap: lm, aoMapIntensity: 0,
      })
      lmPatch(m, gain)
      const mesh = new THREE.Mesh(stat.geometry, m); mesh.name = 'static'; mesh.matrixAutoUpdate = false
      g.add(mesh); mats.push(m)
    }
    const chair = byName(`${k}_chair`)
    if (chair) {
      const m = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 1, metalness: 0, roughnessMap: fabR, normalMap: fabN, normalScale: new THREE.Vector2(0.6, 0.6),
        aoMap: lm, aoMapIntensity: 0,
      })
      lmPatch(m, gain)
      const mesh = new THREE.Mesh(chair.geometry, m); mesh.name = 'chair'; mesh.matrixAutoUpdate = false
      g.add(mesh); mats.push(m)
    }
  })
  // the dev's lamp bulb: a warm, solid disc (the pool of light is in the baked map)
  const glow = byName('publish_glow')
  if (glow) { const m = new THREE.Mesh(glow.geometry, new THREE.MeshBasicMaterial({ color: 0xffd9a8, toneMapped: false })); m.name = 'glow'; W.islands.publish.group.add(m) }

  // lab drone: the modelled body replaces the box silhouette (same dimensions, before the 1.7 scale)
  const dr = byName('drone')
  if (dr) {
    const body = W.drone.group.children.find((c) => !(c as THREE.InstancedMesh).isInstancedMesh) as THREE.Mesh | undefined
    if (body) {
      body.geometry.dispose(); body.geometry = dr.geometry
      body.material = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 })
    }
  }
  // rigged figures (material: FIG_STYLE)
  try { people.setSkinned(pgl.scene, FIG_MAT(W.arc.mat), FIG_PRE()) } catch { /* fallback: capsules */ }
}
