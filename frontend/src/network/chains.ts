// The other chains: logos of the chains from which CCTP brings USDC to Arc (domain 26),
// as holograms, in the USDC token material (world.ts, buildUsdc) tinted with each brand color.
// List: Circle docs, 'Supported blockchains and domains'.
// Official paths, as is:
//   Ethereum   ethereum/ethereum-org-website  public/images/assets/svgs/eth-diamond-black.svg (facets and opacities)
//   Base       base/brand-kit                 logo/symbol/Base_Symbol_Blue.svg (the round notched symbol used for
//              integrations; kit at commit a6d98af, before 'the Square', which read as an empty square)
//   Arbitrum   OffchainLabs/arbitrum-docs     public/img/logo.svg
//   OP Mainnet optimism.io/brand (brand kit, Sanity CDN): the OP circle
//   Solana     solana-foundation/solana-com   apps/web/public/img/logomark-white.svg
//   Avalanche  ava-labs/builders-hub          public/common-images/Avalanche_Logomark_Red.svg
//   Polygon    0xPolygon/polygon-token-assets assets/brandAssets/polygon_icon_white_on_transparent.svg
// Each path becomes an extruded layer; layers stack in SVG order and their brightness follows the value
// of their fill (a dark fill stays dark in the hologram). A single mesh for the seven logos (one
// draw call); each logo spins slowly on its axis in the shader.
import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

type Layer = { d: string; k: number }
export interface ChainDef { id: string; name: string; domain: number; col: [number, number?]; vb: [number, number, number, number]; layers: Layer[] }

export const CHAIN_DEFS: ChainDef[] = [
  { id: 'ethereum', name: 'Ethereum', domain: 0, col: [0xb4bdff], vb: [420, 80, 1080, 1760], layers: [
    { d: 'm959.8 730.9-539.8 245.4 539.8 319.1 539.9-319.1z', k: 0.75 },
    { d: 'm420.2 976.3 539.8 319.1v-564.5-650.3z', k: 0.62 },
    { d: 'm960 80.6v650.3 564.5l539.8-319.1z', k: 1 },
    { d: 'm420 1078.7 539.8 760.7v-441.8z', k: 0.62 },
    { d: 'm959.8 1397.6v441.8l540.2-760.7z', k: 1 },
  ] },
  { id: 'base', name: 'Base', domain: 6, col: [0x4f7dff], vb: [0, 0, 110.034, 110.034], layers: [
    { d: 'M54.921 110.034C85.359 110.034 110.034 85.402 110.034 55.017C110.034 24.6319 85.359 0 54.921 0C26.0432 0 2.35281 22.1714 0 50.3923H72.8467V59.6416H3.9565e-07C2.35281 87.8625 26.0432 110.034 54.921 110.034Z', k: 1 },
  ] },
  { id: 'arbitrum', name: 'Arbitrum', domain: 3, col: [0x28a0f0], vb: [0, 0, 1080, 1218.5], layers: [
    { d: 'M41,370.4v477.7c0,30.5,16.3,58.7,42.7,73.9l413.7,238.9c26.4,15.2,58.9,15.2,85.3,0L996.4,922 c26.4-15.2,42.7-43.4,42.7-73.9V370.4c0-30.5-16.3-58.7-42.7-73.9L582.7,57.6c-26.4-15.2-58.9-15.2-85.3,0L83.6,296.5 C57.2,311.7,41,339.9,41,370.4z', k: 0.22 },
    { d: 'M630.3,701.9l-59,161.8c-1.6,4.5-1.6,9.4,0,13.9L672.8,1156l117.4-67.8L649.3,701.9 C646.1,693,633.5,693,630.3,701.9z', k: 0.75 },
    { d: 'M748.6,429.8c-3.2-8.9-15.8-8.9-19,0l-59,161.8c-1.6,4.5-1.6,9.4,0,13.9l166.3,455.8l117.4-67.8 L748.6,429.8z', k: 0.75 },
    { d: 'M540,75.5c2.9,0,5.8,0.8,8.4,2.2l447.7,258.5c5.2,3,8.4,8.6,8.4,14.5v516.9c0,6-3.2,11.5-8.4,14.5 l-447.7,258.5c-2.5,1.5-5.5,2.2-8.4,2.2c-2.9,0-5.8-0.8-8.4-2.2L83.9,882.3c-5.2-3-8.4-8.6-8.4-14.5V350.8c0-6,3.2-11.5,8.4-14.5 L531.6,77.8C534.2,76.3,537.1,75.5,540,75.5 M540,0c-15.9,0-31.9,4.1-46.2,12.4L46.2,270.8c-28.6,16.5-46.2,47-46.2,80v516.9 c0,33,17.6,63.5,46.2,80l447.7,258.5c14.3,8.2,30.2,12.4,46.2,12.4c15.9,0,31.9-4.1,46.2-12.4l447.7-258.5 c28.6-16.5,46.2-47,46.2-80V350.8c0-33-17.6-63.5-46.2-80L586.2,12.4C571.9,4.1,555.9,0,540,0L540,0z', k: 0.85 },
    { d: 'M243.9,1061.9L285.1,949.1L368,1018L290.5,1088.8Z', k: 0.22 },
    { d: 'M502.3,313.8H388.8c-8.5,0-16.1,5.3-19,13.3l-243.3,667l117.4,67.8l267.9-734.5 C514.3,320.8,509.4,313.8,502.3,313.8z', k: 1 },
    { d: 'M700.9,313.8H587.4c-8.5,0-16.1,5.3-19,13.3l-277.8,761.6l117.4,67.8l302.4-829.1 C712.8,320.8,707.9,313.8,700.9,313.8z', k: 1 },
  ] },
  { id: 'op', name: 'OP Mainnet', domain: 2, col: [0xff2a3d], vb: [841, 529, 817, 817], layers: [
    { d: 'M1658,937.5A408.5,408.5,0,1,1,841,937.5A408.5,408.5,0,1,1,1658,937.5Z', k: 0.62 },
    { d: 'M1441.19 816.786h-146.16l-34.39 243.924h69.97l8.31-59.08h79.58c71.88 0 107.7-28.819 115.82-90.515 8.37-63.6-21.73-94.329-93.14-94.329h.01Zm22.21 90.045c-2.87 26.205-17.91 37.636-48 37.636h-68.43l9.92-70.509h71.64c27.23 0 37.5 9.292 34.87 32.873Zm-340.8-95.759c-95.29 0-145.204 40.02-156.91 125.775-11.941 87.663 29.137 129.583 126.81 129.583 97.68 0 144.97-40.02 156.67-125.772 11.95-87.661-28.89-129.586-126.57-129.586Zm55.4 125.775c-6.45 48.359-30.8 70.033-81.67 70.033-47.76 0-65.68-19.055-59.47-66.222 6.45-48.594 31.29-70.035 81.68-70.035 50.38 0 65.67 19.297 59.46 66.224Z', k: 1 },
  ] },
  { id: 'solana', name: 'Solana', domain: 5, col: [0x9945ff, 0x14f195], vb: [0, 0, 313, 281], layers: [
    { d: 'M311.318 221.057L259.66 276.558C258.537 277.764 257.178 278.725 255.669 279.382C254.159 280.039 252.53 280.378 250.884 280.377H5.99719C4.8287 280.377 3.68568 280.035 2.70855 279.393C1.73143 278.751 0.962771 277.837 0.49702 276.764C0.0312691 275.69 -0.111286 274.504 0.0868712 273.35C0.285028 272.196 0.815265 271.126 1.61243 270.27L53.3099 214.769C54.4299 213.566 55.7843 212.607 57.2893 211.95C58.7943 211.293 60.4178 210.953 62.0595 210.95H306.933C308.101 210.95 309.244 211.292 310.221 211.934C311.199 212.576 311.967 213.49 312.433 214.564C312.899 215.637 313.041 216.824 312.843 217.977C312.645 219.131 312.115 220.201 311.318 221.057ZM259.66 109.294C258.537 108.088 257.178 107.127 255.669 106.47C254.159 105.813 252.53 105.474 250.884 105.475H5.99719C4.8287 105.475 3.68568 105.817 2.70855 106.459C1.73143 107.101 0.962771 108.015 0.49702 109.088C0.0312691 110.162 -0.111286 111.348 0.0868712 112.502C0.285028 113.656 0.815265 114.726 1.61243 115.582L53.3099 171.083C54.4299 172.286 55.7843 173.245 57.2893 173.902C58.7943 174.559 60.4178 174.899 62.0595 174.902H306.933C308.101 174.902 309.244 174.56 310.221 173.918C311.199 173.276 311.967 172.362 312.433 171.288C312.899 170.215 313.041 169.028 312.843 167.875C312.645 166.721 312.115 165.651 311.318 164.795L259.66 109.294ZM5.99719 69.4267H250.884C252.53 69.4275 254.159 69.089 255.669 68.432C257.178 67.7751 258.537 66.8139 259.66 65.6082L311.318 10.1069C312.115 9.25107 312.645 8.18056 312.843 7.02695C313.041 5.87334 312.899 4.68686 312.433 3.6133C311.967 2.53974 311.199 1.62586 310.221 0.983941C309.244 0.342026 308.101 3.95314e-05 306.933 0L62.0595 0C60.4178 0.00279866 58.7943 0.34314 57.2893 0.999953C55.7843 1.65677 54.4299 2.61607 53.3099 3.81847L1.62576 59.3197C0.829361 60.1748 0.299359 61.244 0.100752 62.3964C-0.0978539 63.5488 0.0435698 64.7342 0.507679 65.8073C0.971789 66.8803 1.73841 67.7943 2.71352 68.4372C3.68863 69.0802 4.82984 69.424 5.99719 69.4267Z', k: 0.9 },
  ] },
  { id: 'avalanche', name: 'Avalanche', domain: 1, col: [0xff3d4d], vb: [0, 0, 257, 227], layers: [
    { d: 'M160.944 226.789H246.964C254.554 226.789 259.304 218.569 255.504 211.999L212.494 137.509C208.694 130.939 199.214 130.939 195.414 137.509L152.404 211.999C148.604 218.569 153.354 226.789 160.944 226.789Z', k: 0.85 },
    { d: 'M171.704 66.8581L136.354 5.61809C132.784 -0.571914 123.844 -0.571914 120.274 5.61809L1.38358 211.538C-2.52642 218.318 2.36358 226.778 10.1836 226.778H80.9736C88.5236 226.778 95.4936 222.748 99.2636 216.218L171.704 90.7481C175.974 83.3581 175.974 74.2481 171.704 66.8581Z', k: 0.85 },
  ] },
  { id: 'polygon', name: 'Polygon PoS', domain: 7, col: [0x8c4dff], vb: [14.8, 43, 470.4, 414.4], layers: [
    { d: 'm364.03,335.08l111.55-64.4c5.9-3.41,9.57-9.76,9.57-16.58V125.28c0-6.81-3.67-13.17-9.57-16.58l-111.55-64.4c-5.9-3.41-13.24-3.4-19.14,0l-111.55,64.4c-5.9,3.41-9.57,9.76-9.57,16.58v230.19l-78.22,45.15-78.22-45.15v-90.33l78.22-45.15,51.6,29.78v-60.59l-42.03-24.26c-2.9-1.67-6.21-2.55-9.57-2.55s-6.67.88-9.57,2.55L24.42,229.33c-5.9,3.41-9.57,9.76-9.57,16.58v128.81c0,6.81,3.67,13.17,9.57,16.58l111.55,64.41c5.9,3.4,13.23,3.4,19.14,0l111.55-64.4c5.9-3.41,9.57-9.77,9.57-16.58v-230.19l1.41-.81,76.81-44.34,78.22,45.16v90.32l-78.22,45.16-51.52-29.74v60.59l41.95,24.23c5.9,3.4,13.24,3.4,19.14,0Z', k: 0.9 },
  ] },
]

export const CHAIN_SIZE = 1.8 // side of the square each logo fits in (m)
export interface ChainLogo { def: ChainDef; center: THREE.Vector3; half: THREE.Vector3 }

/** The seven logos on a ring around the central USDC token (system frame, origin = the token);
 *  the ring spins (uOrb) and tilts (uTilt) in the shader, each logo faces the camera (the group does) */
export const ringCenter = (aC: THREE.Vector3, orb: number, tilt: number, out = new THREE.Vector3()) => {
  const c = Math.cos(orb), s = Math.sin(orb)
  out.set(c * aC.x + s * aC.z, 0, -s * aC.x + c * aC.z)
  const y = out.z * Math.sin(tilt), z = out.z * Math.cos(tilt); out.y = y; out.z = z
  return out
}
export function buildChains(ringR: number) {
  const geos: THREE.BufferGeometry[] = [], logos: ChainLogo[] = []
  const n = CHAIN_DEFS.length, col = new THREE.Color(), c2 = new THREE.Color()
  CHAIN_DEFS.forEach((def, li) => {
    const [vx, vy, vw, vh] = def.vb, s = CHAIN_SIZE / Math.max(vw, vh)
    // position on the arc (the arc center is the line center; the arc curves backward)
    const a = (li / n) * Math.PI * 2
    const cx = ringR * Math.sin(a), cz = ringR * Math.cos(a)
    const center = new THREE.Vector3(cx, 0, cz)
    const depth = 0.06, dz = 0.022
    def.layers.forEach((L, i) => {
      const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${L.d}"/></svg>`)
      const shapes = data.paths.flatMap((p) => p.toShapes())
      const g = new THREE.ExtrudeGeometry(shapes, { depth: depth / s, bevelEnabled: true, bevelThickness: 0.008 / s, bevelSize: 0.006 / s, bevelSegments: 1, curveSegments: 10 })
      g.deleteAttribute('uv')
      // the SVG y axis points down; centered on its box; each layer slightly in front of the previous one
      g.translate(-(vx + vw / 2), -(vy + vh / 2), 0); g.scale(s, -s, s); g.translate(0, 0, -depth / 2 + i * dz)
      g.computeVertexNormals()
      const p = g.getAttribute('position'), N = p.count
      const aCol = new Float32Array(N * 3), aK = new Float32Array(N).fill(L.k), aC = new Float32Array(N * 3), aI = new Float32Array(N).fill(li)
      for (let v = 0; v < N; v++) {
        // Solana: the brand gradient, from purple bottom left to green top right
        if (def.col[1] !== undefined) { const u = THREE.MathUtils.clamp(0.5 + (p.getX(v) + p.getY(v)) / (2 * CHAIN_SIZE), 0, 1); col.setHex(def.col[0]).lerp(c2.setHex(def.col[1]), u) } else col.setHex(def.col[0])
        aCol[v * 3] = col.r; aCol[v * 3 + 1] = col.g; aCol[v * 3 + 2] = col.b
        aC[v * 3] = cx; aC[v * 3 + 1] = 0; aC[v * 3 + 2] = cz
      }
      g.translate(cx, 0, cz)
      g.setAttribute('aCol', new THREE.BufferAttribute(aCol, 3)); g.setAttribute('aK', new THREE.BufferAttribute(aK, 1)); g.setAttribute('aC', new THREE.BufferAttribute(aC, 3)); g.setAttribute('aI', new THREE.BufferAttribute(aI, 1))
      geos.push(g)
    })
    logos.push({ def, center, half: new THREE.Vector3(CHAIN_SIZE * 0.55, CHAIN_SIZE * 0.55, 0.3) })
  })
  const geo = mergeGeometries(geos)!
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uHl: { value: 0.5 }, uSel: { value: -1 }, uSpin: { value: 1 }, uOrb: { value: 0 }, uTilt: { value: 0.3 } },
    vertexShader: /* glsl */`attribute vec3 aCol; attribute float aK; attribute vec3 aC; attribute float aI; uniform float uT; uniform float uSpin; uniform float uOrb; uniform float uTilt;
      varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vCol; varying float vK; varying float vI;
      void main() {
        // each logo pivots slowly on its vertical axis and floats a little, each at its own pace
        // like a mobile, each logo spins on itself endlessly, each at its own pace
        float an = uSpin * (uT * (0.5 + 0.06 * aI) + aI * 0.9), c = cos(an), s = sin(an);
        vec3 p = position - aC; p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
        // the logo center turns on the ring, the ring tilts (same computation as ringCenter on the CPU side)
        float oc = cos(uOrb), os = sin(uOrb); vec3 C = vec3(oc * aC.x + os * aC.z, 0.0, -os * aC.x + oc * aC.z);
        C = vec3(C.x, C.z * sin(uTilt), C.z * cos(uTilt));
        p += C; p.y += uSpin * sin(uT * 0.6 + aI * 2.3) * 0.06;
        vec3 n = vec3(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);
        vec4 w = modelMatrix * vec4(p, 1.0); vN = normalize(mat3(modelMatrix) * n); vV = normalize(cameraPosition - w.xyz);
        vY = (position.y + 0.75) / 1.5; vCol = aCol; vK = aK; vI = aI;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`uniform float uT; uniform float uHl; uniform float uSel; varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vCol; varying float vK; varying float vI;
      void main() {
        // the USDC token material: translucent, brighter rim, scan lines; brand tint
        float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);
        float scan = 0.6 + 0.4 * smoothstep(0.35, 0.0, abs(fract(vY * 7.0 - uT * 0.5 - vI * 0.37) - 0.5));
        vec3 halo = vCol * 0.55, core = mix(vCol, vec3(1.0), 0.8);
        vec3 c = mix(halo, vCol, 0.55) * scan + core * (0.25 + f * 0.6);
        float sel = 1.0 - step(0.5, abs(vI - uSel));
        float a = (0.55 + 0.4 * f) * vK * mix(0.55, 1.0, max(uHl, sel));
        gl_FragColor = vec4(c * a * (1.0 + 0.35 * sel), a);
      }`,
  })
  mat.toneMapped = false
  const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 6; mesh.frustumCulled = false
  return { mesh, mat, logos }
}
