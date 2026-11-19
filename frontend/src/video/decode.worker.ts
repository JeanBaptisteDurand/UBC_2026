// Video landing: decoding off the main thread. Receives a Blob (film frame or shadow-track sheet) and returns the
// decoded ImageBitmap by transfer (no copy), with the decode duration.
// "Off-thread" mode (OffscreenCanvas, the default where it exists): one worker holds the canvas, keeps the decoded
// frames and draws them itself; the upload of the image to the GPU happens here, never on the main thread. The other
// worker decodes and hands its frames over through a port. The main thread only keeps the list.
type Msg =
  | { type: 'dec'; id: number; k: number; sheet: boolean; blob: Blob; rw?: number; rh?: number }
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'port'; port: MessagePort }
  | { type: 'keep'; id: number; k: number; sheet: boolean; bmp: ImageBitmap; ms: number }
  | { type: 'drop'; k: number }
  | { type: 'draw'; k: number; sheet: number; sx: number; sy: number; sw: number; sh: number }
  | { type: 'size'; w: number; h: number }
const ctx = self as unknown as { onmessage: ((e: MessageEvent<Msg>) => void) | null; postMessage: (m: unknown, t?: Transferable[]) => void }
let cv: OffscreenCanvas | null = null, g: OffscreenCanvasRenderingContext2D | null = null, out: MessagePort | null = null
const frames = new Map<number, ImageBitmap>(), sheets = new Map<number, ImageBitmap>()
function keep(id: number, k: number, sheet: boolean, bmp: ImageBitmap, ms: number) {
  const m = sheet ? sheets : frames
  m.get(k)?.close(); m.set(k, bmp)
  ctx.postMessage({ id, ms, w: bmp.width, h: bmp.height })
}
function handle(d: Msg) {
  if (d.type === 'init') { cv = d.canvas; g = cv.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D; g.imageSmoothingQuality = 'low'; return }
  if (d.type === 'port') { if (cv) d.port.onmessage = (e) => handle(e.data); else out = d.port; return }
  if (d.type === 'size') { if (cv) { cv.width = d.w; cv.height = d.h; g!.imageSmoothingQuality = 'low' } for (const b of frames.values()) b.close(); frames.clear(); return }
  if (d.type === 'keep') { keep(d.id, d.k, d.sheet, d.bmp, d.ms); return }
  if (d.type === 'drop') { frames.get(d.k)?.close(); frames.delete(d.k); return }
  if (d.type === 'draw') {
    if (!g || !cv) return
    const t0 = performance.now()
    if (d.sheet >= 0) { const s = sheets.get(d.sheet); if (s) g.drawImage(s, d.sx, d.sy, d.sw, d.sh, 0, 0, cv.width, cv.height) }
    else { const b = frames.get(d.k); if (b) { if (b.width === cv.width) g.drawImage(b, 0, 0); else g.drawImage(b, 0, 0, cv.width, cv.height) } }
    ctx.postMessage({ drawn: d.k, ms: performance.now() - t0 })
    return
  }
  if (d.type === 'dec') {
    const t0 = performance.now()
    createImageBitmap(d.blob, d.rw ? { resizeWidth: d.rw, resizeHeight: d.rh, resizeQuality: 'low' } : {}).then((bmp) => {
      const ms = performance.now() - t0
      if (cv) keep(d.id, d.k, d.sheet, bmp, ms)                                   // the drawing worker keeps the frame
      else if (out) { out.postMessage({ type: 'keep', id: d.id, k: d.k, sheet: d.sheet, bmp, ms }, [bmp]); ctx.postMessage({ id: d.id, sent: true }) }
      else ctx.postMessage({ id: d.id, bmp, ms }, [bmp])                          // classic mode: to the main thread
    }).catch((err) => ctx.postMessage({ id: d.id, err: String(err) }))
  }
}
ctx.onmessage = (e) => handle(e.data)
export {}
