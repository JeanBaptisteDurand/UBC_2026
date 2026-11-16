// Scene assets start loading on the first line of script, before React, fonts, API data or three.js. Two batches:
//   1. the wall (room, racks, facades and their textures): what the first screen shows;
//   2. the replayed sled and its textures: only once batch 1 has arrived, at low priority, so it never competes
//      with the wall for bandwidth.
// Images are decoded off the main thread (createImageBitmap) as soon as they arrive, with file texels as-is
// (no colour conversion, no premultiplication).
import SIZES from './data/sizes.json'

export const WALL_GLB = ['/models/room.glb', '/models/rack.glb', '/models/face.glb'] as const
export const WALL_TEX = ['lm_sun', 'lm_sky', 'conc_col', 'conc_nor', 'lac_rgh', 'ao_rack', 'ao_face', 'wear_fx', 'pow_nor', 'pow_rgh', 'cha_col', 'cha_nor', 'cha_rgh', 'brs_nor', 'perf_nor', 'perf_alb'] as const
export const HERO_GLB = ['/models/sled.glb'] as const
export const HERO_TEX = ['al_nor', 'al_rgh', 'pcb_col', 'pcb_nor', 'pcb_rgh', 'ao_sled'] as const
const texUrl = (n: string) => `/tex/${n}.webp`

/** Bytes received for batch 1 (loading bar), out of a total known ahead of time */
export const progress = { got: 0, total: 1, t0: performance.now(), marks: [] as [string, number][] }
const mark = (k: string) => progress.marks.push([k, Math.round(performance.now())])
;(window as unknown as { __load: typeof progress }).__load = progress

async function fetchBuf(u: string, prio: 'high' | 'low', count: boolean): Promise<ArrayBuffer> {
  const r = await fetch(u, { priority: prio } as RequestInit)
  if (!r.ok) throw new Error(`${u} ${r.status}`)
  if (!count || !r.body) return r.arrayBuffer()
  // Streamed read so the loading bar follows the bytes received
  const rd = r.body.getReader(); const parts: Uint8Array[] = []; let n = 0
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; progress.got += value.length }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length }
  return out.buffer
}
const decode = (b: ArrayBuffer, name: string) => createImageBitmap(new Blob([b], { type: 'image/webp' }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  .then((x) => { mark(`dec:${name}`); return x })

type Lot = { glb: Record<string, Promise<ArrayBuffer>>; tex: Record<string, Promise<ImageBitmap>> }
function lot(glbs: readonly string[], texs: readonly string[], prio: 'high' | 'low', count: boolean): Lot {
  const glb: Lot['glb'] = {}, tex: Lot['tex'] = {}
  for (const u of glbs) glb[u] = fetchBuf(u, prio, count).then((b) => { mark(`get:${u.split('/').pop()}`); return b })
  for (const n of texs) tex[n] = fetchBuf(texUrl(n), prio, count).then((b) => { mark(`get:${n}`); return decode(b, n) })
  return { glb, tex }
}
// Batch 1 sizes in bytes, written at build time by scripts/sizes.mjs
progress.total = [...WALL_GLB.map((u) => u.split('/').pop()!), ...WALL_TEX.map((n) => `${n}.webp`)].reduce((a, k) => a + ((SIZES as Record<string, number>)[k] ?? 0), 0) || 1

let wall: Lot | null = null, hero: Lot | null = null
const NOGL = new URLSearchParams(location.search).get('gl') === '0'
/** Start batch 1 now, batch 2 once batch 1 has arrived */
export function startAssets() {
  if (wall || NOGL) return
  mark('start')
  wall = lot(WALL_GLB, WALL_TEX, 'high', true)
  Promise.allSettled([...Object.values(wall.glb), ...Object.values(wall.tex)]).then(() => { mark('mur-recu'); hero = lot(HERO_GLB, HERO_TEX, 'low', false) })
}
export const wallLot = () => { startAssets(); return wall! }
export const heroLot = () => new Promise<Lot>((res) => { const w = () => (hero ? res(hero) : setTimeout(w, 30)); w() })
export { mark }
