// The Services room: a Cycles still of the landing's room with one of its racks alone in the aisle
// (design/blender/service-room, public/tex/svc-room.webp), the same models, fog, floor and light as the landing film.
// The rack's 32 sleds are rendered blank; their plates and LEDs are live HTML laid in the plane of each facade with
// the still's camera (public/tex/svc-room.json, CSS matrix3d as on the landing, video/lames.ts), so a new service
// shows up on its sled with no new render. The distant racks' LEDs are drawn live over the room (ui/roomleds.ts).
// The image covers the stage (object-fit: cover); the mapping below follows the same cover.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SLOTS, FACE, G } from '../data/wall'
import { RoomLeds, type Led, type FogP } from '../ui/roomleds'
import '../video/video.css'

export interface Plate {
  key: string; title: string; sub: string; unit: string
  led: 'green' | 'amber' | 'red' | 'off'
  on: boolean; dim: boolean; label: string; open: () => void
}
interface RoomFile { w: number; h: number; vp: number[]; cam: [number, number, number]; fov: number; slots: number[]; fog: FogP; leds: Led[] }

const IMG = { src: '/tex/svc-room.webp', srcM: '/tex/svc-room-m.webp' }
/** where the cover crop is anchored (object-position): the rack stays right of the reading column */
export const FX = 0.62, FY = 0.3
const PX = 0.0005                                  // 1 CSS px of a facade = 0.5 mm (as the landing)
const FW = G.FW, FH = G.FT - G.FB
const PL = { x0: FACE.PLATE[0] + 0.002, y1: FACE.PLATE[3] - 0.0015, w: FACE.PLATE[1] - FACE.PLATE[0] - 0.004, h: FACE.PLATE[3] - FACE.PLATE[2] - 0.003 }
const LD = { x: (FACE.LED[0] + FACE.LED[1]) / 2, y: (FACE.LED[2] + FACE.LED[3]) / 2, w: FACE.LED[1] - FACE.LED[0], h: FACE.LED[3] - FACE.LED[2] }
const GLOW = { w: 0.07, h: 0.13 }
const mm = (m: number) => m / PX
const RGB = { green: '70 255 128', amber: '255 122 36', red: '255 56 46', off: '170 180 196' }

// ---- titles fitted to the plate as the landing does (plates.ts atlas: 80 px rows, 70 px at most)
const CH = 80, BAND = 0.5 * PL.h, TITLE_W = Math.floor((0.92 * PL.w / BAND) * CH) - 16
const fitCache = new Map<string, { lines: string[]; px: number }>()
let meas: CanvasRenderingContext2D | null = null
function fitTitle(text: string) {
  const c = fitCache.get(text); if (c) return c
  meas ??= document.createElement('canvas').getContext('2d')!
  const font = (p: number) => `400 ${p}px "Fragment Mono", ui-monospace, monospace`
  let px = 70; meas.font = font(px)
  while (meas.measureText(text).width > TITLE_W && px > 34) { px -= 2; meas.font = font(px) }
  let res: { lines: string[]; px: number }
  if (meas.measureText(text).width <= TITLE_W) res = { lines: [text], px }
  else {
    const w = text.split(' ')
    let best: [string, string] = [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))], bk = Infinity
    for (let i = 1; i < w.length; i++) { const a = w.slice(0, i).join(' '), b = w.slice(i).join(' '); const k = Math.max(meas.measureText(a).width, meas.measureText(b).width); if (k < bk) { bk = k; best = [a, b] } }
    px = 38; meas.font = font(px)
    while (Math.max(meas.measureText(best[0]).width, meas.measureText(best[1]).width) > TITLE_W && px > 16) { px -= 1; meas.font = font(px) }
    res = { lines: best, px }
  }
  fitCache.set(text, res)
  return res
}

/** the still's camera onto the stage: clip -> screen with the cover crop */
interface Map2 { A: number; B: number; Ox: number; Oy: number; s: number }
function cover(W: number, H: number, iw: number, ih: number): Map2 {
  const s = Math.max(W / iw, H / ih), ox = (W - iw * s) * FX, oy = (H - ih * s) * FY
  return { A: iw * s / 2, B: ih * s / 2, Ox: ox + iw * s / 2, Oy: oy + ih * s / 2, s }
}
const p7 = (v: number) => Number(v.toPrecision(7))
function clip(vp: number[], x: number, y: number, z: number, w: number, out: number[]) {
  for (let r = 0; r < 4; r++) out[r] = vp[r] * x + vp[4 + r] * y + vp[8 + r] * z + vp[12 + r] * w
}
/** matrix3d of a facade's plane, origin at its top-left corner (x0, y1 in the sled frame), 1 px = 0.5 mm */
function facadeM(vp: number[], m: Map2, slot: number): string | null {
  const S = SLOTS[slot], U = [0, 0, 0, 0], V = [0, 0, 0, 0], O = [0, 0, 0, 0]
  clip(vp, PX, 0, 0, 0, U); clip(vp, 0, -PX, 0, 0, V); clip(vp, S.x - FW / 2, S.base + G.FT, 0, 1, O)
  if (O[3] <= 0.01) return null
  const row = (c: number[]) => [m.A * c[0] + m.Ox * c[3], -m.B * c[1] + m.Oy * c[3], c[3]]
  const u = row(U), v = row(V), o = row(O), q = 1 / o[2]
  return `matrix3d(${p7(u[0] * q)},${p7(u[1] * q)},0,${p7(u[2] * q)},${p7(v[0] * q)},${p7(v[1] * q)},0,${p7(v[2] * q)},0,0,1,0,${p7(o[0] * q)},${p7(o[1] * q)},0,1)`
}

function useRoom() {
  const [r, setR] = useState<RoomFile | null>(null)
  useEffect(() => {
    let on = true
    fetch('/tex/svc-room.json').then((x) => (x.ok ? x.json() : null)).then((j) => { if (on && j?.vp) setR(j) }).catch(() => {})
    return () => { on = false }
  }, [])
  return r
}

function PlateEl({ p, slot, m }: { p: Plate; slot: number; m: string }) {
  const tt = fitTitle(p.title.toUpperCase())
  const fpx = mm(BAND) * tt.px / CH
  const c = RGB[p.led]
  const lit = p.led !== 'off'
  const S = SLOTS[slot]
  return (
    <button type="button" className="vt-fac" style={{ width: `${mm(FW)}px`, height: `${mm(FH)}px`, transform: m }} data-on={p.on ? '1' : '0'} data-dim={p.dim ? '1' : '0'} aria-pressed={p.on} aria-label={p.label} onClick={p.open}>
      {lit ? <span className="lm-led" aria-hidden="true" style={{ '--c': c, left: `${mm(LD.x - GLOW.w / 2 + FW / 2)}px`, top: `${mm(G.FT - (LD.y + GLOW.h / 2))}px`, width: `${mm(GLOW.w)}px`, height: `${mm(GLOW.h)}px` } as React.CSSProperties}>
        <i className="lm-spill" /><i className="lm-core" style={{ width: `${mm(LD.w - 0.0008)}px`, height: `${mm(LD.h - 0.0008)}px` }} />
      </span> : null}
      <span className="lm-plate" data-st={p.led} aria-hidden="true" style={{ '--c': c, '--ph': `${mm(PL.h)}px`, left: `${mm(PL.x0 + FW / 2)}px`, top: `${mm(G.FT - PL.y1)}px`, width: `${mm(PL.w)}px`, height: `${mm(PL.h)}px` } as React.CSSProperties}>
        <span className="lm-t" style={{ fontSize: `${fpx.toFixed(2)}px`, lineHeight: tt.lines.length > 1 ? `${(mm(BAND) * 0.46).toFixed(1)}px` : `${mm(BAND).toFixed(1)}px` }}>{tt.lines.map((l) => <span key={l}>{l}</span>)}</span>
        <span className="lm-s">{p.sub.toUpperCase()}</span>
        <span className="lm-u">{p.unit || `U${String(S.u).padStart(2, '0')}`}</span>
      </span>
    </button>
  )
}

/** the room still, the live sleds of its rack and the distant LEDs. plates: one per sled, top to bottom, left then right */
export function RoomStage({ plates, hint }: { plates: Plate[]; hint: string }) {
  const room = useRoom()
  const box = useRef<HTMLDivElement>(null)
  const ledsBox = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<Map2 | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el || !room) return
    const up = () => setMap(cover(el.clientWidth, el.clientHeight, room.w, room.h))
    up()
    const ro = new ResizeObserver(up); ro.observe(el)
    return () => ro.disconnect()
  }, [room])
  // the distant racks' LEDs: static camera, every LED of the file is visible from it
  useEffect(() => {
    const el = ledsBox.current
    if (!el || !room || !map) return
    const rl = new RoomLeds(room.leds, room.fog, el, 'room-leds')
    const C = [0, 0, 0, 0]
    const view = {
      proj: (x: number, y: number, z: number, out: Float64Array) => {
        clip(room.vp, x, y, z, 1, C); if (C[3] <= 0) return false
        out[0] = (map.A * C[0] + map.Ox * C[3]) / C[3]; out[1] = (-map.B * C[1] + map.Oy * C[3]) / C[3]; return true
      },
      cam: () => room.cam, vis: () => true, veil: () => 0,
      scale: map.B / Math.tan((room.fov * Math.PI) / 360),
    }
    let raf = 0, last = 0, seen = true
    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting })
    io.observe(el)
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (!seen || document.visibilityState !== 'visible' || now - last < 66) return
      last = now; rl.size(el.clientWidth, el.clientHeight); rl.draw(view, now / 1000)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); io.disconnect(); rl.cv.remove() }
  }, [room, map])
  const n = room ? Math.min(room.slots.length, plates.length) : 0
  return (
    <div className="vt-room" ref={box}>
      <img className="vt-room-img" src={IMG.src} srcSet={`${IMG.srcM} 1440w, ${IMG.src} 2880w`} sizes="100vw" alt="" draggable={false} style={{ objectPosition: `${FX * 100}% ${FY * 100}%` }} />
      <div className="vt-room-leds" ref={ledsBox} aria-hidden="true" />
      {room && map ? (
        <div className="vt-facs">
          {plates.slice(0, n).map((p, k) => { const m = facadeM(room.vp, map, room.slots[k]); return m ? <PlateEl key={p.key} p={p} slot={room.slots[k]} m={m} /> : null })}
        </div>
      ) : null}
      <p className="vt-hint mono">{hint}</p>
    </div>
  )
}
/** the rack's capacity (sleds), known once the room file is read; 32 for the landing rack */
export const RACK_SLOTS = 32
