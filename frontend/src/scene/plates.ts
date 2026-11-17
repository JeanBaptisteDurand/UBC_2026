// Title plate atlas: the service name printed into the matte plate of the facade, in Fragment Mono capitals, tinted
// by the glow of its LED. One row per distinct text (service names, "Open slot", the replayed sled wallet), six
// status words, and a digit strip that composes the unit label (U01 to U52) in the shader, so the atlas does not grow
// with the number of sleds.
import * as THREE from 'three'
import { GLSL_SUN, GLSL_FOG, GLSL_PAL } from './glsl'
import { FACE } from '../data/wall'

export const AW = 1024, CH = 80, TROWS = 18, SROWS = 6
export const AH = 2048
// Light atlas: each text row is redrawn at 0.4 scale in the middle of a 64 px row (80 px full-scale margin around
// the letters), then blurred at three radii (R, G, B: 4, 10 and 22 px full scale). Light leaving a letter keeps the
// letter shape with a soft non-linear falloff (sum of gaussians), and never touches the edge of its row.
export const GAW = 512, GCH = 64, GAH = 1536, GS = 0.4, GX0 = 32
// Usable width is derived from the real plate: ink is clipped at 4.5% and 96.5% of the width (shader margin) and the
// title uses 50% of the height
const PLATE_WM = FACE.PLATE[1] - FACE.PLATE[0] - 0.004, PLATE_HM = FACE.PLATE[3] - FACE.PLATE[2] - 0.003
export const TITLE_W = Math.floor((0.92 * PLATE_WM / (0.5 * PLATE_HM)) * CH) - 6 - 10
const DIGIT_Y = (TROWS + SROWS) * CH, GW = 48
/** A status word sits in the lower band of the plate, 2.3 times shorter than the title band, so at equal atlas width
 *  it covers 2.3 times less plate. It may use up to 700 atlas px (ending at 75% of the plate, before the U label that
 *  starts at 82%), so "ADMITTED (REPLAY)" stays legible and longer French words do not shrink */
const SUB_W = 700
/** Minimum single-line title size (atlas px, 80 px row); below it, the title wraps onto two lines at 38 px */
const MIN_PX = 34
/** Most balanced two-line break, at a word; a break after a comma is preferred */
function split2(text: string, width: (s: string) => number): [string, string] {
  const words = text.split(' ')
  if (words.length < 2) { const h = Math.ceil(text.length / 2); return [text.slice(0, h), text.slice(h)] }
  let best: [string, string] = [text, ''], bk = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ')
    const k = Math.max(width(a), width(b)) * (/,$/.test(a) ? 0.85 : 1)
    if (k < bk) { bk = k; best = [a, b] }
  }
  return best
}
// The sixth word is "Admitted (replay)" (the sled replayed after Arc's verdict)
export const SUBS = ['off', 'green', 'amber', 'red', 'dim', 'admitted'] as const

export class PlateAtlas {
  cv = document.createElement('canvas')
  g: CanvasRenderingContext2D
  tex: THREE.CanvasTexture
  rows = new Map<string, number>()
  /** End of the title in its row, in band heights (the smoked glass glow stops at the text) */
  ends = new Map<string, number>()
  subWords: string[] = []
  gcv = document.createElement('canvas')
  gg: CanvasRenderingContext2D
  gtex: THREE.CanvasTexture
  private row0 = 0
  constructor() {
    this.gcv.width = GAW; this.gcv.height = GAH
    this.gg = this.gcv.getContext('2d')!
    this.gtex = new THREE.CanvasTexture(this.gcv)
    this.gtex.colorSpace = THREE.NoColorSpace
    this.gtex.generateMipmaps = true
    this.gtex.minFilter = THREE.LinearMipmapLinearFilter
    this.cv.width = AW; this.cv.height = AH
    this.g = this.cv.getContext('2d')!
    this.tex = new THREE.CanvasTexture(this.cv)
    this.tex.colorSpace = THREE.NoColorSpace
    this.tex.anisotropy = 8
    this.tex.generateMipmaps = true
    this.tex.minFilter = THREE.LinearMipmapLinearFilter
  }
  private font(px: number) { return `400 ${px}px "Fragment Mono", ui-monospace, monospace` }
  private line(y: number, text: string, maxW = TITLE_W) {
    const g = this.g
    this.row0 = y
    let w = 0
    g.fillStyle = '#000'; g.fillRect(0, y, AW, CH)
    // The plate is 7 band heights wide: the title is condensed to fit
    let px = 70
    g.font = this.font(px)
    while (g.measureText(text).width > maxW && px > MIN_PX) { px -= 2; g.font = this.font(px) }
    g.textBaseline = 'middle'
    // Never paint an ellipsis on a plate. Too long at the minimum legible size: wrap onto two lines (at a word, after
    // a comma if possible), at the largest size that fits
    if (g.measureText(text).width > maxW) {
      const [l1, l2] = split2(text, (s) => g.measureText(s).width)
      px = 38; g.font = this.font(px)
      while (Math.max(g.measureText(l1).width, g.measureText(l2).width) > maxW && px > 16) { px -= 1; g.font = this.font(px) }
      this.ink(l1, 6, y + CH * 0.27 + 2, px); this.ink(l2, 6, y + CH * 0.73 + 2, px)
      w = Math.max(g.measureText(l1).width, g.measureText(l2).width)
      return (6 + w) / CH
    }
    this.ink(text, 6, y + CH / 2 + 3, px)
    w = g.measureText(text).width
    return (6 + w) / CH
  }
  // A backlit letter. Sharp atlas: red is the letter; green is the letter barely blurred (the middle of the stroke,
  // where the light is warmest). Light atlas: the same letter at three blur radii (drop shadow of a path drawn outside
  // the canvas, which every browser supports)
  private ink(text: string, x: number, y: number, px: number) {
    const g = this.g
    g.save()
    g.globalCompositeOperation = 'lighter'
    g.shadowColor = '#0f0'; g.shadowBlur = Math.max(2, px * 0.06); g.shadowOffsetX = 4096; g.shadowOffsetY = 0
    g.fillStyle = '#0f0'; g.fillText(text, x - 4096, y)
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0
    g.fillStyle = '#f00'; g.fillText(text, x, y)
    g.restore()
    const k = this.row0 / CH, gg = this.gg
    const gx = GX0 + x * GS, gy = k * GCH + GCH / 2 + (y - this.row0 - CH / 2) * GS
    gg.save()
    gg.globalCompositeOperation = 'lighter'
    gg.font = this.font(px * GS); gg.textBaseline = 'middle'
    for (const [c, b] of [['#f00', 3], ['#0f0', 8], ['#00f', 18]] as const) {
      gg.shadowColor = c; gg.shadowBlur = b; gg.shadowOffsetX = 4096; gg.fillStyle = c; gg.fillText(text, gx - 4096, gy)
    }
    gg.restore()
  }
  /** Redraw everything: titles and status words (on data or language change, rare) */
  paint(titles: string[], subs: string[]) {
    const g = this.g
    g.fillStyle = '#000'; g.fillRect(0, 0, AW, AH)
    this.gg.fillStyle = '#000'; this.gg.fillRect(0, 0, GAW, GAH)
    this.rows.clear(); this.ends.clear()
    titles.slice(0, TROWS).forEach((s, k) => { this.rows.set(s, k); this.ends.set(s, this.line(k * CH, s.toUpperCase().replace(/\b0X(?=[0-9A-F])/g, '0x'))) })
    this.subWords = subs
    subs.slice(0, SROWS).forEach((s, k) => this.line((TROWS + k) * CH, s.toUpperCase(), SUB_W))
    // Digit strip: U, 0 to 9, one 48 px cell per glyph
    g.font = this.font(70); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f00'
    'U0123456789'.split('').forEach((c, k) => g.fillText(c, k * GW + GW / 2, DIGIT_Y + CH / 2 + 3))
    g.textAlign = 'left'
    this.tex.needsUpdate = true
    this.gtex.needsUpdate = true
  }
  row(s: string) { return this.rows.get(s) ?? -1 }
  end(s: string) { return this.ends.get(s) ?? 0 }
}

// Plate shader: one instance per sled, title row, status word, unit, tint and intensity.
// The quad extends MRG beyond the plate on each side so the light spills onto the facade and fades out before the edge
// (vUv goes outside 0..1 in the margin)
const MRG = [0.03, 0.024]
export const PLATE_VS = /* glsl */ `
attribute vec4 aTxt; // title row, status row (-1 none), unit, title end (band heights)
attribute vec4 aTint; // colour, intensity
attribute float aPull;
attribute float aDim;
attribute vec2 aSize; // plate width and height (m)
varying vec2 vUv; varying vec4 vTxt; varying vec4 vTint; varying float vDim; varying vec2 vSize; varying vec3 vWP; varying vec3 vVL;
void main(){
  vTxt = aTxt; vTint = aTint; vDim = aDim; vSize = aSize;
  vec3 p = position * vec3(aSize + 2.0 * vec2(${MRG[0]}, ${MRG[1]}), 1.0);
  vUv = p.xy / aSize + 0.5;
  p.z += aPull;
  mat4 M = modelMatrix * instanceMatrix;
  vec4 w = M * vec4(p, 1.0);
  vWP = w.xyz;
  // View direction in plate space (the light is behind the glass, so it shifts slightly with the view)
  vVL = normalize(transpose(mat3(M)) * (w.xyz - cameraPosition));
  gl_Position = projectionMatrix * viewMatrix * w;
}`
export const PLATE_FS = /* glsl */ `
uniform sampler2D tAtlas, tGlow; uniform float uTrows;
varying vec2 vUv; varying vec4 vTxt; varying vec4 vTint; varying float vDim; varying vec2 vSize; varying vec3 vWP; varying vec3 vVL;
${GLSL_FOG}
${GLSL_SUN}
${GLSL_PAL}
const float AW = ${AW}.0, AH = ${AH}.0, CH = ${CH}.0, GW = 48.0;
const float GAW = ${GAW}.0, GAH = ${GAH}.0, GCH = ${GCH}.0, GS = ${GS}, GX0 = ${GX0}.0;
// No shimmer: the sharp atlas is sampled with derivatives computed once, outside any branch, on continuous
// coordinates (textureGrad), clamped so neighbouring rows never bleed in
vec2 gX_, gY_;
vec2 cell(float row, vec2 q){
  float tu = q.x * CH / AW;
  float ty = 1.0 - (row * CH + (1.0 - clamp(q.y, 0.03, 0.97)) * CH) / AH;
  vec2 a = textureGrad(tAtlas, vec2(clamp(tu, 0.0, 1.0), ty), gX_, gY_).rg;
  return (tu < 0.0 || tu > 1.0 || q.y < 0.0 || q.y > 1.0) ? vec2(0.0) : a;
}
float glyph(float k, vec2 q){
  float tu = (k * GW + clamp(q.x, 0.0, 1.0) * GW) / AW;
  float ty = 1.0 - ((uTrows + 6.0) * CH + (1.0 - clamp(q.y, 0.03, 0.97)) * CH) / AH;
  float a = textureGrad(tAtlas, vec2(tu, ty), gX_, gY_).r;
  return (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) ? 0.0 : a;
}
void grads(vec2 sx, vec2 sy){
  float L = max(length(sx * vec2(AW, AH)), length(sy * vec2(AW, AH)));
  float k = 1.2 * min(1.0, 12.0 / max(L * 1.2, 1e-6));
  gX_ = sx * k; gY_ = sy * k;
}
// Light of a row: three radii, and a soft window that only bites where the light is already almost gone
vec3 glowAt(float row, vec2 q){
  float X = q.x * CH, Y = (1.0 - q.y) * CH;
  vec2 g = vec2((GX0 + X * GS) / GAW, 1.0 - (row * GCH + GCH * 0.5 + (Y - CH * 0.5) * GS) / GAH);
  float w = (1.0 - smoothstep(0.6, 0.98, abs(q.y - 0.5))) * smoothstep(-0.95, -0.6, q.x) * step(0.0, g.x) * step(g.x, 1.0);
  return texture2D(tGlow, g).rgb * w;
}
void main(){
  float W = vSize.x, H = vSize.y;
  float a = 0.0, b = 0.0, ga = 0.0, gb = 0.0;
  vec2 tb = vec2(0.40, 0.90);
  float bh = (tb.y - tb.x) * H;
  vec2 q = vec2((vUv.x - 0.045) * W / bh, (vUv.y - tb.x) / (tb.y - tb.x));
  vec2 sb = vec2(0.08, 0.30);
  float sh = (sb.y - sb.x) * H;
  vec2 qs = vec2((vUv.x - 0.045) * W / sh, (vUv.y - sb.x) / (sb.y - sb.x));
  float adv = 0.6 * sh * 0.92;
  float x0 = W * 0.955 - 3.0 * adv;
  float gx = (vUv.x * W - x0) / adv;
  vec2 tqx = dFdx(q) * vec2(CH / AW, CH / AH), tqy = dFdy(q) * vec2(CH / AW, CH / AH);
  vec2 sqx = dFdx(qs) * vec2(CH / AW, CH / AH), sqy = dFdy(qs) * vec2(CH / AW, CH / AH);
  vec2 gqx = vec2(dFdx(gx) * 0.9 * GW / AW, dFdx(qs.y) * CH / AH), gqy = vec2(dFdy(gx) * 0.9 * GW / AW, dFdy(qs.y) * CH / AH);
  float off = 1.0 - step(0.1, vTint.a);
  float inside = step(0.0, vUv.x) * step(vUv.x, 1.0) * step(0.0, vUv.y) * step(vUv.y, 1.0);
  // The source sits 2.5 mm behind the glass surface: seen at an angle, its light shifts slightly against the letters
  vec2 par = vVL.xy / max(-vVL.z, 0.25) * 0.0025;
  vec3 gl = vec3(0.0), gls = vec3(0.0);
  grads(tqx, tqy);
  float e = 0.0;
  if (vTxt.x >= 0.0) {
    vec2 ca = cell(vTxt.x, q); a = ca.x * inside; ga = ca.y * inside;
    if (off > 0.5) {
      // "OPEN SLOT" is engraved in the glass: the top of each stroke catches the ceiling light, the rest is barely tinted
      // (two sharp atlas reads, empty slots only)
      e = max(0.0, a - cell(vTxt.x, q + vec2(0.0, 0.05)).x * inside);
    } else gl = glowAt(vTxt.x, q + par / bh);
  }
  if (vTxt.y >= 0.0) {
    grads(sqx, sqy);
    vec2 cb = cell(uTrows + vTxt.y, qs); b = cb.x * inside; gb = cb.y * inside;
    if (off < 0.5) gls = glowAt(uTrows + vTxt.y, qs + par / sh);
    float u = vTxt.z;
    grads(gqx, gqy);
    if (gx >= 0.0 && gx < 3.0) {
      float k = floor(gx);
      float idx = k < 0.5 ? 0.0 : k < 1.5 ? 1.0 + floor(u / 10.0) : 1.0 + mod(u, 10.0);
      b = max(b, glyph(idx, vec2(fract(gx) * 0.9 + 0.05, qs.y)) * inside);
    }
  }
  float ink = max(a, b * 0.62);
  ink *= step(0.035, vUv.x) * step(vUv.x, 0.965);
  // Light: three radii, from the tightest (scattering in the glass) to the widest (spill on the facade); their sum is
  // compressed (1 - exp): a dense core, a long soft tail, never an edge
  float hs = dot(gl, vec3(0.62, 0.42, 0.30)) + dot(gls, vec3(0.62, 0.42, 0.30)) * 0.45;
  float halo = 1.0 - exp(-1.7 * hs);
  if (ink < 0.004 && halo * vTint.a < 0.004) discard;
  vec3 tint = vTint.rgb * vTint.a;
  // Stroke: the LED colour, with a core that goes towards white in the middle of the stroke (green atlas)
  float core = smoothstep(0.45, 0.95, a > b * 0.62 ? ga : gb);
  vec3 hot = mix(vTint.rgb, vec3(1.0), 0.6) * vTint.a;
  vec3 c = (tint * (a > b * 0.62 ? 1.0 : 0.6) * 0.82 + hot * core * 0.5 * (1.0 - off)) * (1.0 - off);
  // Empty slot: low ink and a bright top edge (engraving)
  c += off * vTint.rgb * vTint.a * (0.55 + 2.6 * e / max(ink, 1e-3));
  c += uPPlateSun * 0.35 * sunMask(vWP) * (1.0 - 0.985 * off);
  float fade = max(0.0, 1.0 - vDim * 0.7) * (1.0 - hfogF(vWP));
  // Light takes the LED colour, slightly more saturated in the tail
  vec3 glow = tint * (halo * 0.55 + 0.25 * dot(gl, vec3(1.0, 0.0, 0.0))) * (1.0 - off);
  gl_FragColor = vec4((c * ink + glow) * fade, ink);
}`
