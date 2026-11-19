// Light pass of the landing film: one frame in 2 of a set, reduced to a third and at a low quality, in a single file
// (lite.bin, about 2 MB on desktop and 2.7 MB on phones) next to the set's frames. film.ts streams it first, so that a
// first visit has a coherent frame for the whole film within seconds, then fetches the sharp frames around the visitor
// (the sharp frame replaces the light one as soon as it is decoded). The file is ordered coarse to fine (1 frame in 8,
// then in 4, then in 2): what has arrived always covers the whole film. Retina uses the desktop file (same frames, same
// positions). Every frame instead of one in 2 doubled the file and took that much bandwidth from the sharp frames.
// Usage: node scripts/film-lite.mjs <film dir> [set ...] (needs sharp; the deploy runs it in a node:22-slim container)
// Nothing is rewritten when lite.bin already matches the set's meta.bin (the build can call it every time).
// Overrides (environment): DIV (reduction), Q (AVIF quality), NAME (output file, lite.bin by default), STEPS (fetch
// order, 8,4,2 by default; 8,4,2,1 packs every frame, coarse to fine: the motion level, motion.bin). Without them the
// output is byte-identical to before. With STEPS ending in 1, the file is checked once written (count = frames of the
// set, fingerprint = meta.bin's): the script exits 1 if it does not match.
// Format (little-endian): "FLT1", u32 count, u16 w, u16 h, u32 n (frames of the set), u32 meta.bin fingerprint,
// count x (u32 frame, u32 length), then the images in that order.
import sharp from 'sharp'
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [dir, ...args] = process.argv.slice(2)
if (!dir) { console.error('usage: film-lite.mjs <film dir> [set ...]'); process.exit(1) }
const sets = args.length ? args : ['desktop', 'phone']
/** Reduction and quality per set: the light frame is shown scaled up, while the sharp one is on its way */
const CFG = { desktop: { div: 3, q: 34 }, phone: { div: 3, q: 36 } }
const FORCE = process.env.FORCE === '1', OUT = process.env.OUT
const ENV_DIV = process.env.DIV ? Number(process.env.DIV) : 0, ENV_Q = process.env.Q ? Number(process.env.Q) : 0
const NAME = process.env.NAME || 'lite.bin'
const STEPS = (process.env.STEPS || '8,4,2').split(',').map(Number)
if (!STEPS.length || STEPS.some((x) => !(x >= 1))) { console.error('STEPS: a list of steps, like 8,4,2 or 8,4,2,1'); process.exit(1) }
sharp.concurrency(1)

/** Fingerprint of meta.bin (film.ts computes the same): a pack made for another capture is never shown */
export function fingerprint(buf) {
  let h = 0x811c9dc5
  for (let i = 0; i < buf.length; i += 61) { h ^= buf[i]; h = Math.imul(h, 0x01000193) >>> 0 }
  return (h ^ buf.length) >>> 0
}
function order(n) {
  const out = [], seen = new Uint8Array(n)
  for (const s of STEPS) for (let k = 0; k < n; k += s) if (!seen[k]) { seen[k] = 1; out.push(k) }
  return out
}

for (const set of sets) {
  const sd = join(dir, set), c0 = CFG[set] ?? CFG.desktop, cfg = { div: ENV_DIV || c0.div, q: ENV_Q || c0.q }
  const man = JSON.parse(readFileSync(join(sd, 'manifest.json'), 'utf8'))
  const fp = fingerprint(readFileSync(join(sd, 'meta.bin')))
  const outF = join(OUT ? join(OUT, set) : sd, NAME)
  if (!FORCE && existsSync(outF)) {
    const h = readFileSync(outF).subarray(0, 20)
    if (h.toString('latin1', 0, 4) === 'FLT1' && h.readUInt32LE(12) === man.n && h.readUInt32LE(16) === fp) { console.log(`${set}: ${NAME} up to date`); continue }
  }
  const w = Math.round(man.w / cfg.div / 2) * 2, h = Math.round(man.h / cfg.div / 2) * 2
  const ord = order(man.n), imgs = new Array(ord.length)
  const t0 = Date.now()
  let next = 0
  const work = async () => {
    for (;;) {
      const i = next++
      if (i >= ord.length) return
      const src = join(sd, `f${String(ord[i]).padStart(4, '0')}.${man.ext}`)
      imgs[i] = await sharp(src).resize(w, h, { kernel: 'lanczos3' }).avif({ quality: cfg.q, effort: 1, chromaSubsampling: '4:2:0' }).toBuffer()
    }
  }
  await Promise.all(Array.from({ length: 8 }, work))
  const head = Buffer.alloc(20 + ord.length * 8)
  head.write('FLT1', 0, 'latin1'); head.writeUInt32LE(ord.length, 4); head.writeUInt16LE(w, 8); head.writeUInt16LE(h, 10)
  head.writeUInt32LE(man.n, 12); head.writeUInt32LE(fp, 16)
  ord.forEach((k, i) => { head.writeUInt32LE(k, 20 + i * 8); head.writeUInt32LE(imgs[i].length, 24 + i * 8) })
  const all = Buffer.concat([head, ...imgs])
  mkdirSync(join(outF, '..'), { recursive: true })
  writeFileSync(outF + '.tmp', all); renameSync(outF + '.tmp', outF)
  if (STEPS[STEPS.length - 1] === 1) {
    // every frame: the file must hold the whole set, for this capture
    const b = readFileSync(outF), cnt = b.readUInt32LE(4)
    let sum = 20 + cnt * 8
    for (let i = 0; i < cnt; i++) sum += b.readUInt32LE(24 + i * 8)
    const bad = b.toString('latin1', 0, 4) !== 'FLT1' ? 'magic' : cnt !== man.n ? `count ${cnt} != n ${man.n}` : b.readUInt32LE(12) !== man.n ? 'n' : b.readUInt32LE(16) !== fp ? 'fingerprint' : sum !== b.length ? `length ${b.length} != ${sum}` : ''
    if (bad) { console.error(`${set}: ${NAME} check failed (${bad})`); process.exit(1) }
    console.log(`${set}: ${NAME} checked (${cnt} frames = n, fingerprint ${fp.toString(36)})`)
  }
  console.log(`${set}: ${NAME} ${ord.length} frames ${w}x${h} q${cfg.q}, ${(all.length / 1e6).toFixed(2)} MB (${(all.length / ord.length / 1e3).toFixed(1)} KB a frame), ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}
