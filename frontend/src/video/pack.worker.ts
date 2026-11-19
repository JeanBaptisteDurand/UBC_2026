// Video landing, motion level (?gate=1): this worker owns the film pack (lite.bin or motion.bin, FLT1 format, made by
// scripts/film-lite.mjs). It reads the pack from the Cache API or streams it into one buffer, checks it against the
// film (frame count, meta.bin fingerprint), tells the main thread what has arrived, and decodes the frames the main
// thread wants, in its order, at most 3 at a time. The bytes never go through the main thread: no Blob or slice there.
// Format (little-endian): "FLT1", u32 count, u16 w, u16 h, u32 n, u32 fingerprint, count x (u32 frame, u32 length),
// then the images in that order (coarse to fine: 1 frame in 8, 4, 2, then every frame for motion.bin).
type In =
  | { type: 'pack'; url: string; n: number; fp: number }
  | { type: 'want'; gen: number; ks: number[] }
  | { type: 'evict'; ks: number[] }
const ctx = self as unknown as { onmessage: ((e: MessageEvent<In>) => void) | null; postMessage: (m: unknown, t?: Transferable[]) => void }
const CACHE = 'film-pack'
let url = '', N = 0, FP = 0
let buf = new Uint8Array(1 << 16), got = 0, total = 0, count = -1, hdr = 0, gateAt = 0
/** Per film frame: entry start and end in the pack (-1: not in the pack) */
let st = new Int32Array(0), en = new Int32Array(0)
let failed = false, lastProg = 0
// ---- Decoding ----
let gen = 0, queue: number[] = [], qi = 0, wanted = new Set<number>()
const held = new Set<number>(), inflight = new Set<number>()
const MAX_IN = 3
function pump() {
  if (failed || !total) return
  while (inflight.size < MAX_IN && qi < queue.length) {
    const k = queue[qi++]
    if (held.has(k) || inflight.has(k) || k < 0 || k >= N || st[k] < 0) continue
    // not arrived yet (motion.bin's odd frames): looked at again when more bytes arrive
    if (en[k] > got) continue
    inflight.add(k)
    const t0 = performance.now()
    createImageBitmap(new Blob([buf.subarray(st[k], en[k])], { type: 'image/avif' })).then((bmp) => {
      inflight.delete(k)
      // a frame the main thread no longer wants is closed, not sent
      if (!wanted.has(k)) bmp.close()
      else { held.add(k); ctx.postMessage({ type: 'bmp', gen, k, bmp, ms: performance.now() - t0 }, [bmp]) }
      pump()
    }).catch(() => { inflight.delete(k); st[k] = -1; pump() })
  }
}
// ---- The pack ----
function fail(why: string) { if (failed) return; failed = true; ctx.postMessage({ type: 'fail', why }) }
function header() {
  const dv = new DataView(buf.buffer, buf.byteOffset)
  if (count < 0 && got >= 20) {
    if (dv.getUint32(0, true) !== 0x31544c46) return fail('magic')
    if (dv.getUint32(12, true) !== N) return fail('n')
    if (dv.getUint32(16, true) !== FP) return fail('fp')
    count = dv.getUint32(4, true); hdr = 20 + count * 8
    if (count < 1 || count > N) return fail('count')
  }
  if (count > 0 && !total && got >= hdr) {
    st = new Int32Array(N).fill(-1); en = new Int32Array(N).fill(-1)
    const ks = new Int32Array(count), ends = new Int32Array(count)
    let at = hdr
    const half = Math.ceil(N / 2)
    for (let j = 0; j < count; j++) {
      const k = dv.getUint32(20 + j * 8, true), l = dv.getUint32(24 + j * 8, true)
      if (k >= N) return fail('frame')
      st[k] = at; at += l; en[k] = at; ks[j] = k; ends[j] = at
      // the gate point: the end of the 1-in-2 layer (the first ceil(n/2) entries), or the whole file
      if (j === Math.min(count, half) - 1) gateAt = at
    }
    total = at
    if (buf.length < total) { const nb = new Uint8Array(total); nb.set(buf.subarray(0, got)); buf = nb }
    ctx.postMessage({ type: 'head', w: dv.getUint16(8, true), h: dv.getUint16(10, true), count, total, gateAt, ks, ends })
  }
}
function take(c: Uint8Array) {
  if (failed) return
  if (got + c.length > buf.length) {
    if (total) { fail('long'); return }
    const nb = new Uint8Array(Math.max(buf.length * 2, got + c.length)); nb.set(buf.subarray(0, got)); buf = nb
  }
  buf.set(c, got); got += c.length
  header()
  if (got - lastProg >= 1 << 16) { lastProg = got; ctx.postMessage({ type: 'prog', got }); if (qi > 0) { qi = 0; pump() } }
}
async function stream() {
  let tries = 0
  for (;;) {
    try {
      const from = got
      const r = await fetch(url, { priority: 'high', headers: from ? { Range: `bytes=${from}-` } : undefined } as RequestInit)
      if (!r.ok) throw new Error(String(r.status))
      // a resume answered in full: start over
      if (from && r.status !== 206) { got = 0; count = -1; total = 0; lastProg = 0 }
      const rd = r.body?.getReader()
      if (!rd) take(new Uint8Array(await r.arrayBuffer()))
      else for (;;) { const { done, value } = await rd.read(); if (done) break; if (value) take(value); if (failed) return }
      if (failed) return
      if (!total || got !== total) throw new Error('short')
      return
    } catch (e) {
      if (failed) return
      if (++tries > 2 || (!got && /^(404|403|410)$/.test(String((e as Error).message)))) { fail(String((e as Error).message)); return }
      await new Promise((r) => setTimeout(r, 300 * tries))
    }
  }
}
async function load() {
  // a return visit: the whole pack from the Cache API (keyed by the ?v= address), in one piece
  try {
    const c = await caches.open(CACHE)
    const r = await c.match(url)
    if (r) {
      const b = new Uint8Array(await r.arrayBuffer())
      buf = b; got = b.length; header()
      if (!failed && total === got) { ctx.postMessage({ type: 'prog', got }); ctx.postMessage({ type: 'done', cached: true }); pump(); return }
      buf = new Uint8Array(1 << 16); got = 0; count = -1; total = 0; failed = false
    }
  } catch { /* no Cache API (private window, insecure origin): the network */ }
  await stream()
  if (failed) return
  ctx.postMessage({ type: 'prog', got }); ctx.postMessage({ type: 'done', cached: false })
  qi = 0; pump()
  try {
    const c = await caches.open(CACHE)
    // older versions of the same pack go
    const path = url.split('?')[0]
    for (const q of await c.keys()) if (q.url.split('?')[0].endsWith(path) && q.url !== new URL(url, location.href).href) await c.delete(q)
    await c.put(url, new Response(buf.subarray(0, total)))
  } catch { /* quota, private window: the HTTP cache still has it (immutable) */ }
}
ctx.onmessage = (e) => {
  const d = e.data
  if (d.type === 'pack') { url = d.url; N = d.n; FP = d.fp; void load().catch((x) => fail(String(x))); return }
  if (d.type === 'want') { gen = d.gen; queue = d.ks; qi = 0; wanted = new Set(d.ks); pump(); return }
  if (d.type === 'evict') { for (const k of d.ks) held.delete(k); return }
}
export {}
