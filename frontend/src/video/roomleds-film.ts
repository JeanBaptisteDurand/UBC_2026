// Landing film: the distant racks' LEDs (ui/roomleds.ts) over the film, projected with the matrix of the frame shown,
// hidden where Blender found them occluded at that frame (public/film/leds.json, desktop plan; the phone film has its
// own camera path and keeps them off), frosted under the text column like the film itself. Redrawn when the film moves
// and about 15 times a second for the fades.
import { film, onFilm, projInto, toView, fromView, PHONE, zoomK } from './film'
import { RoomLeds, inIv, type Led, type FogP } from '../ui/roomleds'

interface LedsFile { v: number; n: number; fog: FogP; leds: Led[]; vis: number[][] }
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

export async function mountRoomLeds(layer: HTMLElement) {
  if (PHONE || new URLSearchParams(location.search).get('leds') === '0') return
  let data: LedsFile
  try { data = await fetch(`${import.meta.env.BASE_URL}film/leds.json`).then((r) => r.json()) } catch { return }
  const rl = new RoomLeds(data.leds, data.fog, layer)
  const P4 = new Float64Array(4)
  const view = {
    proj: (x: number, y: number, z: number, out: Float64Array) => {
      projInto(P4, x, y, z)
      if (P4[3] <= 0) return false
      const [X, Y] = toView(P4[0], P4[1]); out[0] = X; out[1] = Y; return true
    },
    cam: () => [film.cur[16], film.cur[17], film.cur[18]] as [number, number, number],
    vis: (i: number) => inIv(data.vis[i], film.shown),
    veil: (X: number, Y: number) => {
      const m = film.man!, ov = film.cur
      const [x, y] = fromView(X, Y)
      const v = ov[21] > 0.5 ? ss(ov[19] - 0.2, ov[19] + 0.05, y / m.filmH) : 1 - ss(ov[19] - 0.085, ov[19] + 0.004, x / m.filmW)
      return v * ov[20]
    },
    scale: 0,
  }
  let last = 0, dirty = true
  const draw = () => {
    if (!film.man || film.shown < 0) return
    rl.size(layer.clientWidth, layer.clientHeight)
    // CSS px per metre at 1 m: the capture's vertical field (32.1 deg) over its height, times the framing and zoom
    view.scale = (film.man.filmH / 2) * 3.4734 * film.s * zoomK().k
    rl.draw(view, performance.now() / 1000)
    dirty = false
  }
  onFilm(() => { dirty = true })
  const loop = (now: number) => {
    requestAnimationFrame(loop)
    if (document.visibilityState !== 'visible') return
    if (dirty || now - last > 66) { last = now; draw() }
  }
  requestAnimationFrame(loop)
}
