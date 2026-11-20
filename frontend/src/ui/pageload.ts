// Page changes (MOTION.md, M1 and M9): on every page the header and its bar stay on screen. The bar shows the page's
// loading state first, then the scroll position.
// A click on a link to another page does not leave at once (ui/veil.ts). The veil comes down over the content, under
// the header, which stays, and the header's bar becomes the loading bar and starts filling. The browser then loads the
// next page while the old one stays on screen, header and bar still running. The next page picks the bar up where it
// was (sessionStorage) and fills it as it loads. When the page says it is ready (window.__frontReady, set by every
// page once its data and its scene are there), the bar is full and becomes the scroll position.
const KEY = 'archive-nav'
type W = Window & { __frontReady?: boolean }

let leaving = false, leaveT0 = 0
const t0 = performance.now()
let carried = 0
try {
  const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { p: number; at: number } | null
  if (v && Date.now() - v.at < 8000) carried = Math.min(0.9, Math.max(0, v.p))
  sessionStorage.removeItem(KEY)
} catch { /* no storage: the bar starts at zero */ }

/** the loading progress of the page, 0 to 1 (1 = ready, the bar then shows the scroll) */
export function loadP(): number {
  const now = performance.now()
  if (leaving) return 0.55 * (1 - Math.exp(-(now - leaveT0) / 700))
  if ((window as W).__frontReady) return 1
  const base = Math.max(carried, 0.08)
  return base + (0.94 - base) * (1 - Math.exp(-(now - t0) / 2200))
}
/** the progress this page arrived with (0 when opened directly) */
export const arrivedAt = () => carried
export const isLeaving = () => leaving

let installed = false
/** the page is about to go (ui/veil.ts calls it on an internal link, before the veil comes down) */
export function startLeaving() {
  if (leaving) return
  leaving = true; leaveT0 = performance.now()
  document.documentElement.dataset.leaving = '1'
}
/** installed once per page by its header: keeps the bar's value for the next page, resets on a return from history */
export function installPageExit() {
  if (installed) return
  installed = true
  // the bar keeps its value at the moment the page goes (a slow next page picks it up from there)
  addEventListener('pagehide', () => { if (leaving) try { sessionStorage.setItem(KEY, JSON.stringify({ p: loadP(), at: Date.now() })) } catch { /* no storage */ } })
  // back from the history cache: the page is whole again
  addEventListener('pageshow', (e) => { if (e.persisted) { leaving = false; delete document.documentElement.dataset.leaving } })
}
