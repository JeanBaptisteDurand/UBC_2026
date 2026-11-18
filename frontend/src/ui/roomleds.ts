// The LEDs of the distant racks (the 1U servers behind their perforated doors), as the real-time room shader drew them
// (scene/stage.ts, roomMat): each LED changes state every 2 to 6 s with a fade, never a blink. The pre-rendered scenes
// (the landing film, the Services rack) were rendered with them off, since a frozen frame would show them as motionless
// specks; this layer draws them live over the image, on a 2D canvas, from positions exported from Blender
// (design/blender/film-blender/job/leds.py, design/blender/service-room). Shared by the landing and the Services page:
// the caller gives the projection, the visibility and the text-column veil of the current view.
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** One LED: three.js world position, its hash (timing), its brightness and colour (0 blue, 1 green) */
export type Led = [x: number, y: number, z: number, hj: number, k: number, col: 0 | 1]
export interface FogP { col: number[]; d: number; k: number; n: number }

// GLSL h21 (stage.ts), in float32 like the shader
const f = Math.fround
const fr = (x: number) => x - Math.floor(x)
function h21(x: number, y: number) {
  let px = f(fr(f(x * 0.1031))), py = f(fr(f(y * 0.1030)))
  const d = f(px * f(py + 33.33) + py * f(px + 33.33))
  px = f(px + d); py = f(py + d)
  return fr(f(f(px + py) * px))
}
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** State of an LED at time t (s): 0..1, the shader's fade between two hashed states */
export function ledOn(hj: number, t: number) {
  if (REDUCED) return ss(0.35, 0.55, h21(0, hj * 57))
  const per = 2 + 4 * hj, ph = t / per + hj * 13, n = Math.floor(ph)
  const lv = h21(n, hj * 57) + (h21(n + 1, hj * 57) - h21(n, hj * 57)) * ss(0.85, 1, ph - n)
  return ss(0.35, 0.55, lv)
}

/** GLSL_FOG hfogF: the share of air between the camera and p */
export function fogF(fp: FogP, cx: number, cy: number, cz: number, x: number, y: number, z: number) {
  const dx = x - cx, dy = y - cy, dz = z - cz
  const dist = Math.max(Math.hypot(dx, dy, dz) - fp.n, 0)
  const y0 = Math.max(cy, 0), k = fp.k
  const integ = Math.abs(dy) > 1e-3 ? (Math.exp(-k * y0) - Math.exp(-k * (y0 + dy))) / (k * dy) : Math.exp(-k * y0)
  return Math.min(1, Math.max(0, 1 - Math.exp(-fp.d * dist * integ)))
}

// Display colours: the shader's emission (blue 0.42 0.66 1.0, green 0.35 1.0 0.55) after exposure and AgX, measured
// against the film's black (they read as small saturated points, not white)
const COL = [[96, 160, 255], [92, 240, 140]]
// under the text column the film is frosted (film_post.py overlay): there the LEDs are soft glows in the column's hue
const FROST = [150, 178, 235]

export interface View {
  /** world -> screen CSS px; returns false when behind the camera */
  proj: (x: number, y: number, z: number, out: Float64Array) => boolean
  /** camera position (world) for the fog */
  cam: () => [number, number, number]
  /** the LED is visible in this view (occlusion precomputed) */
  vis: (i: number) => boolean
  /** text-column veil at a screen point: 0 clear, 1 frosted */
  veil: (x: number, y: number) => number
  /** screen CSS px per metre at the LED's distance (for the size), from the projection */
  scale: number
}

export class RoomLeds {
  cv: HTMLCanvasElement; g: CanvasRenderingContext2D; dpr = 1; w = 0; h = 0
  P = new Float64Array(4)
  constructor(public leds: Led[], public fog: FogP, parent: HTMLElement, cls = 'room-leds') {
    this.cv = document.createElement('canvas'); this.cv.className = cls; this.cv.setAttribute('aria-hidden', 'true')
    parent.prepend(this.cv)
    this.g = this.cv.getContext('2d')!
  }
  size(w: number, h: number) {
    const dpr = Math.min(2, devicePixelRatio || 1)
    if (w === this.w && h === this.h && dpr === this.dpr) return
    this.w = w; this.h = h; this.dpr = dpr
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr)
    this.cv.style.width = `${w}px`; this.cv.style.height = `${h}px`
  }
  draw(v: View, t: number, gain = 1) {
    const g = this.g, d = this.dpr, P = this.P
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, this.cv.width, this.cv.height)
    g.globalCompositeOperation = 'lighter'
    const [cx, cy, cz] = v.cam()
    for (let i = 0; i < this.leds.length; i++) {
      if (!v.vis(i)) continue
      const L = this.leds[i]
      const on = ledOn(L[3], t)
      if (on < 0.02) continue
      if (!v.proj(L[0], L[1], L[2], P)) continue
      const X = P[0], Y = P[1]
      if (X < -20 || Y < -20 || X > this.w + 20 || Y > this.h + 20) continue
      const fa = 1 - fogF(this.fog, cx, cy, cz, L[0], L[1], L[2])
      const veil = v.veil(X, Y)
      // the shader keeps an LED 4.4 mm wide but never under 1.4 pixels; its energy spreads when it is smaller than that
      const dist = Math.hypot(L[0] - cx, L[1] - cy, L[2] - cz)
      const px = (0.0044 * v.scale) / dist * d                 // its true width, in device pixels
      const a = on * L[4] * fa * gain * Math.min(1, Math.max(0.35, px / 1.4))
      const c = COL[L[5]]
      if (veil < 0.98) {
        const r = Math.max(0.8, px / 2) * 1.1, k = a * (1 - veil)
        // halo then core
        g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(k * 0.22).toFixed(3)})`
        g.beginPath(); g.arc(X * d, Y * d, r * 3.2, 0, 6.2832); g.fill()
        g.fillStyle = `rgba(${Math.min(255, c[0] + 60)},${Math.min(255, c[1] + 40)},${c[2]},${Math.min(1, k).toFixed(3)})`
        g.beginPath(); g.arc(X * d, Y * d, r, 0, 6.2832); g.fill()
      }
      if (veil > 0.02) {
        // frosted: a soft glow about 6 CSS px across
        const k = a * veil * 0.8, r = 5 * d
        const gr = g.createRadialGradient(X * d, Y * d, 0, X * d, Y * d, r)
        const m = L[5] ? [170, 205, 190] : FROST
        gr.addColorStop(0, `rgba(${m[0]},${m[1]},${m[2]},${k.toFixed(3)})`); gr.addColorStop(1, `rgba(${m[0]},${m[1]},${m[2]},0)`)
        g.fillStyle = gr; g.beginPath(); g.arc(X * d, Y * d, r, 0, 6.2832); g.fill()
      }
    }
  }
}

/** Visible intervals [a0, b0, a1, b1…] -> is frame k inside one */
export function inIv(iv: number[], k: number) {
  for (let j = 0; j < iv.length; j += 2) { if (k < iv[j]) return false; if (k <= iv[j + 1]) return true }
  return false
}
