// Video landing, ?gate=1: the loading screen in front of the film while its motion level loads (film.ts, motion path).
// The scroll is locked while it shows (Lenis stopped, html overflow hidden, scroll keys and touch moves ignored on the
// page; the header and AskHive stay usable above it). It shows real bytes (meta.bin and the pack up to its gate point),
// an ETA from the measured rate, and after 3 s (or at once on a very slow link) a way in without the motion film.
import { getLenis } from '../clock'
import { getLang } from '../i18n'

const TXT = {
  en: { load: 'Loading the film', about: (s: number) => `about ${s} s`, enter: 'Enter now', mb: 'MB' },
  fr: { load: 'Chargement du film', about: (s: number) => `environ ${s} s`, enter: 'Entrer maintenant', mb: 'Mo' },
}
let el: HTMLDivElement | null = null, bar: HTMLDivElement | null = null, prog: HTMLDivElement | null = null
let num: HTMLSpanElement | null = null, eta: HTMLSpanElement | null = null, btn: HTMLButtonElement | null = null
let locked = false
const SCROLL_KEYS = new Set([' ', 'Spacebar', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'])
const keyBlock = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  // a focused control keeps its keys (the header links, AskHive, the gate button)
  if (t && t !== document.body && t.closest('input, textarea, select, button, a, [contenteditable], .cp-panel, .hd')) return
  if (SCROLL_KEYS.has(e.key)) { e.preventDefault(); e.stopImmediatePropagation() }
}
const moveBlock = (e: Event) => {
  const t = e.target as HTMLElement | null
  if (t && t.closest && t.closest('.cp-panel, [data-lenis-prevent], .hd')) return
  if (e.cancelable) e.preventDefault()
}
/** Scroll lock while the gate shows */
export function lockScroll(on: boolean) {
  if (on === locked) return
  locked = on
  const l = getLenis()
  document.documentElement.classList.toggle('film-lock', on)
  if (on) {
    l?.stop()
    addEventListener('keydown', keyBlock, true)
    addEventListener('touchmove', moveBlock, { passive: false, capture: true })
    addEventListener('wheel', moveBlock, { passive: false, capture: true })
  } else {
    removeEventListener('keydown', keyBlock, true)
    removeEventListener('touchmove', moveBlock, { capture: true } as EventListenerOptions)
    removeEventListener('wheel', moveBlock, { capture: true } as EventListenerOptions)
    l?.start()
  }
}
export const isLocked = () => locked
const fmt = (b: number) => { const s = (b / 1e6).toFixed(1); return getLang() === 'fr' ? s.replace('.', ',') : s }
/** Show the gate (once) */
export function showGate(onEnter: () => void) {
  if (el) return
  const T = TXT[getLang()] ?? TXT.en
  el = document.createElement('div')
  el.id = 'film-gate'
  el.innerHTML = '<div class="fg-in"><p class="fg-t"></p><div class="fg-live" aria-live="polite"><div class="fg-bar" role="progressbar" aria-valuemin="0"><div class="fg-fill"></div></div><p class="fg-n mono"><span class="fg-b"></span><span class="fg-eta"></span></p></div><button type="button" class="btn btn-line btn-s fg-go" hidden><span></span></button></div>'
  el.querySelector('.fg-t')!.textContent = T.load
  prog = el.querySelector('.fg-bar'); bar = el.querySelector('.fg-fill'); num = el.querySelector('.fg-b'); eta = el.querySelector('.fg-eta')
  btn = el.querySelector('.fg-go'); btn!.querySelector('span')!.textContent = T.enter
  btn!.addEventListener('click', () => onEnter())
  prog!.setAttribute('aria-label', T.load)
  document.body.appendChild(el)
}
export const gateShown = () => !!el
/** Bytes so far and in all, the ETA in seconds (-1: not known yet), and whether the way in is offered */
export function updateGate(got: number, total: number, etaS: number, enter: boolean) {
  if (!el) return
  const T = TXT[getLang()] ?? TXT.en
  const f = total > 0 ? Math.min(1, got / total) : 0
  bar!.style.transform = `scaleX(${f.toFixed(4)})`
  prog!.setAttribute('aria-valuemax', String(Math.round(total)))
  prog!.setAttribute('aria-valuenow', String(Math.round(got)))
  num!.textContent = total > 0 ? `${fmt(got)} / ${fmt(total)} ${T.mb}` : ''
  eta!.textContent = etaS >= 0 && total > 0 ? T.about(Math.max(1, Math.ceil(etaS))) : ''
  if (enter && btn!.hidden) btn!.hidden = false
}
/** The gate fades out (200 ms) and goes */
export function closeGate() {
  const g = el
  el = null
  if (!g) return
  g.classList.add('fg-out')
  setTimeout(() => g.remove(), 260)
}
