// The Arc hologram recipe, shared by the A (world.ts buildArc) and every sign (room titles, CCTP):
// a translucent additive volume in Arc blue (uHalo/uElec body), a brighter grazing edge (fresnel) and a
// travelling sweep carrying the white core (uCore), scan lines fixed in world height (6 per metre, drifting up),
// thin volume edges in light Arc blue on top, a soft glow behind. One function, one GLSL text: the A and the
// signs cannot drift apart. Animation is driven by uT (the scene clock: frozen by ?t=, still in reduced motion
// like the A).
import * as THREE from 'three'

// the A's colours (C.arcElec, the 0x3a6bff glow, C.arcCore, C.arcLight), repeated here to avoid an import cycle with world.ts
export const HOLO_ELEC = 0x4a86ff, HOLO_HALO = 0x3a6bff, HOLO_CORE = 0xeaf4ff, HOLO_LINE = 0x9cc0ff

/** The hologram body. `sweep` is a GLSL expression in -1..1 along the object height (vW: world position, vL: local
 *  position): where the sweep band runs. `fill` scales the resting body (1 = the A). */
export function holoMaterial(sweep: string, fill = 1, elec = HOLO_ELEC, core = HOLO_CORE) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uHl: { value: 1 }, uElec: { value: new THREE.Color(elec) }, uHalo: { value: new THREE.Color(HOLO_HALO) }, uCore: { value: new THREE.Color(core) } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vW; varying vec3 vV; varying vec3 vL;
      void main() { vL = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`uniform float uT; uniform float uHl; uniform vec3 uElec; uniform vec3 uHalo; uniform vec3 uCore; varying vec3 vN; varying vec3 vW; varying vec3 vV; varying vec3 vL;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);              // brighter edge
        float scan = 0.55 + 0.45 * smoothstep(0.35, 0.0, abs(fract(vW.y * 6.0 - uT * 0.35) - 0.5)); // scan lines
        float sweep = smoothstep(0.12, 0.0, abs(fract(uT * 0.12) * 4.0 - 1.0 - (${sweep})));
        vec3 c = mix(uHalo, uElec, 0.6) * (0.35 + 0.65 * scan) + uCore * (f * 0.55 + sweep * 0.35);
        float a = (${(0.3 * fill).toFixed(3)} + 0.55 * f + 0.25 * sweep) * mix(0.45, 1.0, uHl);
        gl_FragColor = vec4(c * a, a);
      }`,
  })
  mat.toneMapped = false
  return mat
}
/** The thin volume edges drawn over the body (the A: 30° crease angle, opacity 0.55). */
export function holoEdges(geo: THREE.BufferGeometry, opacity = 0.55) {
  const mat = new THREE.LineBasicMaterial({ color: HOLO_LINE, transparent: true, opacity, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })
  return { lines: new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), mat), mat }
}
