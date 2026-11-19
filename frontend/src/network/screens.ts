// The room screens: drawn in Fragment Mono and Montserrat, redrawn only when their state changes.
// Values come from hive-data.json; nothing is invented.
import * as THREE from 'three'
import { tx, lg } from './lang'

export const FP = { auth: ['48', '19', 'a7', '0c', '5e', '22', '91', 'd4', '3b', '6f', '08', 'e1'], bad: 7, badByte: 'c3' }
// Fingerprint of product 3's image (WorkloadAdded): 0x4819… in hive-data.json (machine.vms); the remaining bytes
// are illustrative and marked as such on the card.

const INK = '#e9edf1', INK2 = '#c5ccd4', INK3 = '#96a0ab', RULE = 'rgba(233,237,241,0.14)', BG = '#0d1014'
const ELEC = '#4a86ff', CORE = '#eaf4ff', GREEN = '#2be263', ORANGE = '#ff8c1e', RED = '#ff3e3b', OFF = '#59616c'
const MONO = '"Fragment Mono", ui-monospace, monospace', SANS = 'Montserrat, ui-sans-serif, sans-serif'

export interface Scr { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D; w: number; h: number; key: string }
// The two kiosk screens (512 x 304) show images of the site: their canvas is drawn at double
// resolution (same drawing frame), readable in the Use focus
const HI = (w: number, h: number) => (w === 512 && h === 304 ? 2 : 1)
export function makeScreen(mesh: THREE.Mesh, w: number, h: number): Scr {
  const k = HI(w, h)
  const c = document.createElement('canvas'); c.width = w * k; c.height = h * k
  const g = c.getContext('2d')!; g.scale(k, k)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter
  ;(mesh.material as THREE.MeshBasicMaterial).map = tex
  ;(mesh.material as THREE.MeshBasicMaterial).needsUpdate = true
  return { tex, g, w, h, key: '' }
}
function frame(s: Scr) { const g = s.g; g.fillStyle = BG; g.fillRect(0, 0, s.w, s.h); return g }
function diode(g: CanvasRenderingContext2D, x: number, y: number, col: string, w = 18, h = 6) { g.fillStyle = col; g.fillRect(x, y, w, h) }
function text(g: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, col: string, font = MONO, weight = 400) {
  g.font = `${weight} ${size}px ${font}`; g.fillStyle = col; g.fillText(t, x, y)
}
function rule(g: CanvasRenderingContext2D, x: number, y: number, w: number) { g.fillStyle = RULE; g.fillRect(x, y, w, 2) }
// Site selection frame: two corners, top left and bottom right
function corners(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  g.fillStyle = col; const k = 14, t = 2
  g.fillRect(x, y, k, t); g.fillRect(x, y, t, k); g.fillRect(x + w - k, y + h - t, k, t); g.fillRect(x + w - t, y + h - k, t, k)
}

// Real images of the site, JPEG 1024 x 608: on the left the 'Use a service' page (use.html, the catalog), on the
// right the ArcHive landing.
const SITE: Record<'use' | 'landing', { img: HTMLImageElement; ok: boolean }> = {
  use: { img: new Image(), ok: false }, landing: { img: new Image(), ok: false },
}
// The scene waits for both images before its first frame (siteReady), and redraws when they arrive
// ('net:scr' event)
const loaded = Object.values(SITE).map((v) => new Promise<void>((res) => { v.img.onload = () => { v.ok = true; dispatchEvent(new Event('net:scr')); res() }; v.img.onerror = () => res() }))
for (const [k, v] of Object.entries(SITE)) { v.img.decoding = 'async'; v.img.src = `./net/scr_${k}.jpg` }
export const siteReady = () => Promise.all(loaded).then(() => Promise.all(Object.values(SITE).map((v) => v.img.decode?.().catch(() => null)))).then(() => undefined)
// while an image is missing: a dark, empty screen
function blank(s: Scr) { const key = 'blank'; if (s.key === key) return; s.key = key; frame(s); s.tex.needsUpdate = true }
function site(s: Scr, k: 'use' | 'landing', tag: string) {
  const key = `site-${k}-${tag}`; if (s.key === key) return true; s.key = key
  s.g.drawImage(SITE[k].img, 0, 0, s.w, s.h)
  s.tex.needsUpdate = true
  return true
}
// ---- Kiosk, left screen: the catalog, the chosen service framed ----
export function drawCatalog(s: Scr, chosen: boolean) {
  if (SITE.use.ok) { site(s, 'use', ''); return }
  blank(s); return
  const key = `cat${chosen}${lg()}`; if (s.key === key) return; s.key = key
  const g = frame(s)
  text(g, tx('Services', 'Services'), 28, 50, 30, INK, SANS, 600)
  text(g, tx('paid per use in USDC', 'payés à l’usage en USDC'), 28, 82, 17, INK3)
  const rows: [string, string, string][] = [[tx('Private AI inference', 'Inférence IA privée'), tx('0.0001 / unit', '0.0001 / unité'), GREEN], [tx('Pay-per-call inference (x402)', 'Inférence à l’appel (x402)'), tx('0.01 / call', '0.01 / appel'), GREEN], [tx('Attested copilot', 'Copilote attesté'), '0', GREEN], [tx('Sealed bounty', 'Prime scellée'), '0', GREEN]]
  rows.forEach(([n, p, c], i) => {
    const y = 120 + i * 44
    rule(g, 28, y, s.w - 56)
    diode(g, 28, y + 20, c)
    text(g, n, 60, y + 30, 19, i === 1 && chosen ? INK : INK2, SANS, i === 1 && chosen ? 600 : 400)
    text(g, p, s.w - 28 - g.measureText(p).width * 0 - 150, y + 30, 15, INK3)
    if (i === 1 && chosen) corners(g, 18, y + 4, s.w - 36, 40, '#8fc6ff')
  })
  s.tex.needsUpdate = true
}
// ---- During the demo, the client's right screen shows the site's Use page, following the action:
// the chosen service, the request typed out, the sealed send, then the signed response on return. App texts
// (actions/strings.ts: u.defaultMsg, u.send, u.calling, u.s5, u.signedBy); testnet signer (step 7).
export const CLIENT = { on: false, phase: 0, k: 0 }
function wrap(g: CanvasRenderingContext2D, t: string, maxW: number): string[] {
  const out: string[] = []; let line = ''
  for (const w of t.split(' ')) { const tryL = line ? line + ' ' + w : w; if (g.measureText(tryL).width > maxW && line) { out.push(line); line = w } else line = tryL }
  if (line) out.push(line); return out
}
function drawClient(s: Scr) {
  const ph = CLIENT.phase, msg = tx('In one sentence, what does an Intel TDX enclave protect?', 'En une phrase, que protège une enclave Intel TDX ?')
  const n = ph === 1 ? Math.round(msg.length * CLIENT.k) : ph > 1 ? msg.length : 0
  const ak = ph === 3 ? Math.min(1, CLIENT.k) : 0
  const key = `cli${ph}-${n}-${Math.round(ak * 4)}-${lg()}`; if (s.key === key) return; s.key = key
  const g = frame(s), W = s.w, X = 24
  // site header
  text(g, 'ArcHive', X, 30, 17, INK, SANS, 600); text(g, tx('Use a service', 'Utiliser un service'), W - X - 150, 30, 13, INK3)
  rule(g, X, 42, W - 2 * X)
  // the chosen service, its price read on Arc, the verified key
  diode(g, X, 60, GREEN, 10, 10)
  text(g, tx('Pay-per-call inference (x402)', 'Inférence à l’appel (x402)'), X + 20, 70, 19, INK, SANS, 600)
  text(g, tx('0.01 USDC per call, key checked on Arc', '0,01 USDC l’appel, clé vérifiée sur Arc'), X + 20, 92, 13, INK2)
  // the request
  text(g, tx('Message', 'Message'), X, 120, 12, INK3)
  g.strokeStyle = ph === 1 ? '#8fc6ff' : RULE; g.lineWidth = 1.5; g.strokeRect(X, 128, W - 2 * X, 62)
  g.font = `400 17px ${SANS}`; const lines = wrap(g, msg.slice(0, n), W - 2 * X - 24)
  lines.slice(0, 2).forEach((l, i) => text(g, l, X + 12, 152 + i * 24, 17, INK, SANS))
  if (ph === 1) { const last = lines[lines.length - 1] ?? ''; g.font = `400 17px ${SANS}`; g.fillStyle = INK; g.fillRect(X + 12 + g.measureText(last).width + 2, 138 + Math.max(0, lines.length - 1) * 24, 2, 19) }
  // the action
  const by = 204
  if (ph <= 1) { g.fillStyle = 'rgba(74,134,255,0.9)'; g.fillRect(X, by, 230, 34); text(g, tx('Pay 0.01 USDC and send', 'Payer 0,01 USDC et envoyer'), X + 14, by + 22, 14, CORE, SANS, 600) }
  else if (ph === 2) {
    g.fillStyle = ELEC; g.fillRect(X, by + 8, 12, 12)
    text(g, tx('Sent, sealed (HPKE, X25519)', 'Envoyée, scellée (HPKE, X25519)'), X + 22, by + 19, 15, INK, SANS, 600)
    text(g, tx('Sealed request on its way to the enclave', 'Requête scellée en route vers l’enclave'), X + 22, by + 40, 13, INK3)
  } else {
    g.globalAlpha = Math.min(1, ak * 2)
    text(g, tx('The signed answer', 'La réponse signée'), X, by + 6, 13, INK3)
    const ans = tx('Code and data in use: memory stays encrypted, even from the host.', 'Le code et les données en cours d’usage : la mémoire reste chiffrée, même pour l’hôte.')
    g.font = `400 16px ${SANS}`; wrap(g, ans, W - 2 * X).slice(0, 2).forEach((l, i) => text(g, l, X, by + 30 + i * 21, 16, INK, SANS))
    g.globalAlpha = Math.max(0, Math.min(1, ak * 2 - 1))
    g.fillStyle = GREEN; g.fillRect(X, by + 66, 10, 10)
    text(g, tx('Signed by the enclave, signature checked', 'Signée par l’enclave, signature vérifiée'), X + 18, by + 76, 13, INK2)
    g.globalAlpha = 1
  }
  s.tex.needsUpdate = true
}
// ---- Kiosk, right screen: the session with the enclave ----
export function drawSession(s: Scr, step: number, busy: boolean) {
  if (CLIENT.on) { drawClient(s); return }
  if (SITE.landing.ok) { site(s, 'landing', ''); return }
  blank(s); return
  const key = `ses${step}${busy}${lg()}`; if (s.key === key) return; s.key = key
  const g = frame(s)
  text(g, tx('Session', 'Session'), 28, 50, 30, INK, SANS, 600)
  text(g, tx('Pay-per-call inference (x402)', 'Inférence à l’appel (x402)'), 28, 82, 17, INK3)
  const L: [string, string, number, string][] = [
    [tx('Enclave key', 'Clé de l’enclave'), '0x5E53…5b8A', 1, ELEC],
    [tx('Sealed request', 'Requête scellée'), tx('x25519, for it alone', 'x25519, pour elle seule'), 2, INK2],
    [tx('Signed answer', 'Réponse signée'), tx('signature checked', 'signature vérifiée'), 3, ELEC],
    [tx('Paid', 'Payé'), '0.01 USDC', 4, INK2],
  ]
  L.forEach(([a, b, at, col], i) => {
    const y = 120 + i * 44
    rule(g, 28, y, s.w - 56)
    const on = step >= at
    text(g, a, 28, y + 30, 18, on ? INK : OFF, SANS, on ? 500 : 400)
    text(g, on ? b : '·', 260, y + 30, 15, on ? col : OFF)
    if (on && (at === 1 || at === 3)) { g.fillStyle = ELEC; g.fillRect(s.w - 44, y + 18, 14, 14) }
  })
  if (busy) text(g, tx('waiting for the answer', 'en attente de la réponse'), 28, s.h - 18, 14, INK3)
  s.tex.needsUpdate = true
}
// ---- Developer desk, laptop: the manifest ----
export function drawManifest(s: Scr, lines: number) {
  const key = `man${lines}${lg()}`; if (s.key === key) return; s.key = key
  const g = frame(s)
  text(g, 'manifest.json', 18, 30, 16, INK3)
  const L = ['"image": "sha256:4819…"', tx('"price": "0.01 USDC / call"', '"price": "0.01 USDC / appel"'), '"rail": "X402Settler"', tx('"split": operator, author, network', '"parts": opérateur, auteur, réseau')]
  L.slice(0, lines).forEach((t, i) => text(g, t, 18, 66 + i * 30, 15, INK2))
  if (lines < 4) { g.fillStyle = INK; g.fillRect(18 + 9 * (lines === 0 ? 0 : 6), 52 + lines * 30, 9, 18) }
  s.tex.needsUpdate = true
}
// ---- Developer desk, monitor: the fingerprint pinned on Arc, then activation ----
export function drawPublish(s: Scr, step: number) {
  const key = `pub${step}${lg()}`; if (s.key === key) return; s.key = key
  const g = frame(s)
  text(g, tx('Publish', 'Publier'), 28, 50, 30, INK, SANS, 600)
  text(g, tx('ProductRegistry, product 3', 'ProductRegistry, produit 3'), 28, 82, 17, INK3)
  rule(g, 28, 104, s.w - 56)
  text(g, tx('Image fingerprint', 'Empreinte de l’image'), 28, 140, 18, step >= 1 ? INK : OFF, SANS, 500)
  FP.auth.forEach((b, i) => text(g, b, 28 + i * 37, 178, 19, step >= 2 ? ELEC : step >= 1 ? INK2 : OFF))
  rule(g, 28, 198, s.w - 56)
  text(g, step >= 2 ? tx('WorkloadAdded, fixed on Arc', 'WorkloadAdded, fixée sur Arc') : step >= 1 ? tx('sending to Arc', 'envoi à Arc') : tx('writing the manifest', 'manifeste en cours'), 28, 234, 17, step >= 2 ? ELEC : INK3)
  diode(g, 28, 258, step >= 2 ? GREEN : OFF); text(g, step >= 2 ? tx('active', 'actif') : tx('draft', 'brouillon'), 56, 266, 15, step >= 2 ? INK2 : OFF)
  s.tex.needsUpdate = true
}
// ---- Wall screens on the dock, near the gantry: the verification steps, as they happen (in English, like
// a room console; they could show live data). One canvas, three stacked screens (1 at the top).
export function drawWall(s: Scr, st: { phase: number; cmp: number; verdict: number; refus: boolean }) {
  const n = Math.floor(st.cmp + 1e-4)
  const key = `w${st.phase}${n}${st.verdict}${st.refus}`; if (s.key === key) return; s.key = key
  const g = s.g, H = s.h / 3, W = s.w
  g.fillStyle = BG; g.fillRect(0, 0, W, s.h)
  const slot = (i: number, f: (y: number) => void) => { g.save(); g.beginPath(); g.rect(0, i * H, W, H); g.clip(); f(i * H); g.restore() }
  const head = (y: number, t: string, on: boolean, col = INK) => { g.fillStyle = on ? col : OFF; g.fillRect(24, y + 36, 14, 14); text(g, t, 48, y + 52, t.length > 22 ? 23 : 28, on ? col : OFF, MONO) }
  // 1: the incoming machine
  slot(0, (y) => {
    head(y, 'NEW ENCLAVE', st.phase >= 1)
    text(g, st.phase >= 1 ? 'Intel TDX machine at the gate' : 'waiting', 48, y + 110, 21, st.phase >= 1 ? INK2 : OFF, MONO)
    rule(g, 28, y + H - 4, W - 56)
  })
  // 2: reading the quote, then comparing the fingerprint, byte by byte
  slot(1, (y) => {
    const t = st.phase === 2 ? 'READING THE INTEL QUOTE' : st.phase >= 3 ? 'COMPARING THE FINGERPRINT' : 'CHECK'
    head(y, t, st.phase >= 2)
    for (let i = 0; i < 12; i++) {
      const done = i < n, bad = st.refus && i === FP.bad && done
      g.fillStyle = bad ? RED : done ? ELEC : 'rgba(233,237,241,0.12)'
      g.fillRect(48 + i * 36, y + 84, 28, 20)
    }
    text(g, st.phase === 2 ? 'signed by Intel, TCB up to date' : st.phase >= 3 ? 'measured vs authorized on Arc' : '', 48, y + 150, 20, INK3, MONO)
  })
  // 3: the verdict, returned by Arc
  slot(2, (y) => {
    if (st.verdict > 0) { head(y, 'VERIFIED ON ARC', true, ELEC); text(g, 'sealed, ready for its rack', 48, y + 110, 21, INK2, MONO) }
    else if (st.verdict < 0) { head(y, 'REFUSED', true, RED); text(g, 'fingerprint does not match', 48, y + 110, 21, RED, MONO) }
    else { head(y, 'VERDICT', false); text(g, '—', 48, y + 110, 21, OFF, MONO) }
  })
  s.tex.needsUpdate = true
}
export const COLORS = { GREEN, ORANGE, RED, OFF }
// The dock screen (Rent): the agent installed, the pairing code, then the paired machine
export function drawDock(s: Scr, st: number) {
  const key = `dock${st}${lg()}`; if (s.key === key) return; s.key = key
  const g = frame(s)
  g.strokeStyle = RULE; g.lineWidth = 2; g.strokeRect(6, 6, s.w - 12, s.h - 12)
  text(g, 'archive-node', 24, 46, 22, INK2, MONO)
  text(g, st === 0 ? tx('waiting', 'en attente') : st === 1 ? tx('agent running, TDX ok', 'agent lancé, TDX ok') : st === 2 ? tx('pairing code', 'code d’appairage') : tx('paired', 'appairée'), 24, 84, 18, INK3, MONO)
  if (st >= 2) text(g, 'HIVE-7K2P-QX9M', 24, 150, 34, st === 3 ? GREEN : CORE, MONO, 600)
  if (st === 3) { diode(g, 24, 184, GREEN, 40, 8); text(g, tx('approved, one signature', 'approuvé, une signature'), 76, 192, 16, INK3, MONO) }
  if (st === 2) text(g, tx('example code, waiting for approval', 'code d’exemple, en attente d’approbation'), 24, 192, 15, INK3, MONO)
  if (st === 1) { diode(g, 24, 120, ELEC, 40, 8) }
  s.tex.needsUpdate = true
}
// Publish, the dev's center and right screens (one canvas, two halves). Center: 1 the manifest's keccak256 hash
// is written; 2 the proposal goes to Arc; 3 review; 4 accepted; 5 the image goes to the enclaves.
// Right (from 1): price and shares (example); 6: the author's share received.
export function drawPubOverlay(s: Scr, st: number, hashK: number) {
  const nch = Math.round(hashK * 24)
  const key = `po${st}${nch}${lg()}`; if (s.key === key) return; s.key = key
  const g = s.g, W = s.w / 2
  g.fillStyle = BG; g.fillRect(0, 0, s.w, s.h)
  const hash = '0x' + FP.auth.join('') + '…'
  text(g, st >= 2 ? 'ProductRegistry' : 'manifest.json', 24, 42, 24, INK, SANS, 600)
  if (st === 1) {
    text(g, 'keccak256(manifest)', 24, 88, 18, INK3)
    text(g, hash.slice(0, 2 + nch), 24, 132, 24, CORE, MONO, 600)
    if (nch < 24) { g.fillStyle = INK; g.fillRect(24 + 15.2 * (2 + nch), 112, 12, 26) }
  } else if (st >= 2) {
    text(g, tx('fingerprint', 'empreinte'), 24, 88, 18, INK3); text(g, hash, 24, 124, 22, st >= 4 ? GREEN : CORE, MONO, 600)
    rule(g, 24, 150, W - 48)
    const L = st === 2 ? tx('proposed, sent to Arc', 'proposé, envoyé à Arc') : st === 3 ? tx('waiting for its protection delay', 'en attente de son délai de protection') : st === 4 ? tx('accepted, WorkloadAdded', 'accepté, WorkloadAdded') : tx('image sent to the enclaves', 'image envoyée aux enclaves')
    text(g, L, 24, 188, 19, st >= 4 ? GREEN : ELEC, MONO)
    if (st === 3) for (let i = 0; i < 3; i++) diode(g, 24 + i * 26, 214, OFF, 18, 6)
    if (st >= 4) diode(g, 24, 214, GREEN, 40, 6)
  }
  // the right half: the price
  const x = W + 24
  text(g, tx('Price', 'Prix'), x, 42, 24, INK, SANS, 600)
  if (st >= 1) {
    text(g, tx('0.01 USDC per call', '0.01 USDC par appel'), x, 88, 20, CORE, MONO, 600)
    rule(g, x, 108, W - 48)
    const P: [string, string][] = [[tx('operator', 'opérateur'), '70 %'], [tx('author', 'auteur'), '25 %'], [tx('network', 'réseau'), '5 %']]
    P.forEach(([a, b], i) => { text(g, a, x, 144 + i * 32, 17, INK2); text(g, b, x + 220, 144 + i * 32, 17, INK2, MONO) })
    text(g, tx('example', 'exemple'), x, 250, 14, INK3, MONO)
  }
  if (st >= 6) { diode(g, x, 270, GREEN, 18, 6); text(g, tx('+0.0025 USDC, author share', '+0.0025 USDC, part de l’auteur'), x + 26, 278, 16, GREEN, MONO) }
  s.tex.needsUpdate = true
}
export function drawCard(s: Scr) {
  const key = `card${lg()}`; if (s.key === key) return; s.key = key
  const g = s.g; g.clearRect(0, 0, s.w, s.h)
  g.fillStyle = 'rgba(20,14,34,0.92)'; g.fillRect(4, 4, s.w - 8, s.h - 8); g.strokeStyle = '#c48dff'; g.lineWidth = 4; g.strokeRect(4, 4, s.w - 8, s.h - 8)
  text(g, tx('FINGERPRINT', 'EMPREINTE'), 22, 48, 26, '#c48dff', MONO, 600)
  text(g, FP.auth.slice(0, 6).join(' '), 22, 100, 30, CORE, MONO, 600)
  text(g, FP.auth.slice(6).join(' ') + ' …', 22, 140, 30, CORE, MONO, 600)
  s.tex.needsUpdate = true
}
