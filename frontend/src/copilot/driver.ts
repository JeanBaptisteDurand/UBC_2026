// The copilot drives the site in front of the user: ui_navigate, ui_highlight and ui_demo, played in order. A small
// copilot cursor glides to the target, the search is typed letter by letter into #cat-q, filters toggle, the page
// scrolls to the section, a glowing ring and a bubble point at the element, the demo advances. Towards another page:
// the remaining gestures are saved (state.ts, saveQueue), the page changes, and the panel resumes them on arrival.
// Reduced motion (prefers-reduced-motion): everything is set at once, nothing glides.
// Pages listen to two events: archive:catalog { q, state, kind } (UsePage) and archive:demo { action, step }
// (DemoPage); without them, the driver goes through the controls themselves.
import { scrollTo as sectionScroll, getLenis } from '../clock'
import { t, getLang, type TKey } from '../i18n'
import { SLOTS, G } from '../data/wall'
import { getLive } from '../data/live'
import { ct } from './strings'
import { pageOf, urlOf, netDemoOpen, type PageName } from './page'
import { serviceHref } from '../links'
import type { UiStep, NavArgs, HlArgs, DemoArgs } from './api'

export interface DriveHooks {
  /** A line describing what was just done, below the response. */
  log: (line: string) => void
  /** The page is about to change: keep the rest (the first gesture replays on arrival). */
  leave: (target: PageName, rest: UiStep[]) => void
  /** On phones, the panel collapses while the copilot shows the site. */
  drive: (on: boolean) => void
  /** On a small screen, the panel steps aside for a scene that plays on its own (the Network page's 3D demo). */
  hide?: () => void
}

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const HD = () => (document.querySelector('.hd')?.getBoundingClientRect().bottom ?? 86)
type Box = { x: number; y: number; w: number; h: number }
const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }
/** A full-width element (section, row) is pointed at through its content box: without its padding. */
function contentBox(el: Element): Box {
  const b = boxOf(el)
  if (b.w < innerWidth * 0.8) return b
  const cs = getComputedStyle(el), px = (v: string) => parseFloat(v) || 0
  const l = px(cs.paddingLeft), r = px(cs.paddingRight), t = px(cs.paddingTop), d = px(cs.paddingBottom)
  return { x: b.x + l, y: b.y + t, w: Math.max(8, b.w - l - r), h: Math.max(8, b.h - t - d) }
}

async function waitFor<T>(f: () => T | null | undefined | false, ms: number): Promise<T | null> {
  const end = performance.now() + ms
  for (;;) {
    const v = f()
    if (v) return v
    if (performance.now() > end) return null
    await sleep(80)
  }
}
/** The page is ready (window.__frontReady, first read and fonts). */
export const waitReady = (ms: number) => waitFor(() => (window as unknown as { __frontReady?: boolean }).__frontReady === true, ms)

// ---------------------------------------------------------------- the layer: cursor, ring, bubble

let layer: HTMLDivElement | null = null
function getLayer() {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div')
    layer.className = 'cp-layer'
    layer.setAttribute('aria-hidden', 'true')
    layer.dataset.frontFree = ''
    document.body.appendChild(layer)
  }
  return layer
}

const ghost = { el: null as HTMLDivElement | null, cap: null as HTMLSpanElement | null, x: 0, y: 0, on: false, hide: 0 }
function ensureGhost() {
  if (ghost.el && ghost.el.isConnected) return ghost.el
  const g = document.createElement('div')
  g.className = 'cp-ghost'
  g.innerHTML = '<svg viewBox="0 0 20 24" width="20" height="24" aria-hidden="true"><path d="M2 2 L2 19 L6.6 14.8 L9.6 21.6 L12.6 20.3 L9.7 13.6 L16 13.4 Z" /></svg><span class="cp-ghost-l mono"></span><span class="cp-ghost-cap"></span>'
  g.querySelector('.cp-ghost-l')!.textContent = ct('copilot')
  ghost.cap = g.querySelector('.cp-ghost-cap')
  getLayer().appendChild(g)
  ghost.el = g
  // start: the copilot panel (or its button), where the user is looking
  const from = document.querySelector('.cp-panel, .cp-launch')?.getBoundingClientRect()
  ghost.x = from ? from.left + 24 : innerWidth - 120
  ghost.y = from ? from.top + 72 : innerHeight - 120
  g.style.transform = `translate3d(${ghost.x}px, ${ghost.y}px, 0)`
  return g
}
function showGhost() {
  const g = ensureGhost()
  clearTimeout(ghost.hide)
  if (!ghost.on) { ghost.on = true; g.dataset.on = '1' }
}
function hideGhost(after = 900) {
  clearTimeout(ghost.hide)
  ghost.hide = window.setTimeout(() => { ghost.on = false; if (ghost.el) ghost.el.dataset.on = '0'; caption('') }, after)
}
function caption(text: string) {
  if (!ghost.cap) return
  ghost.cap.textContent = text
  ghost.cap.dataset.on = text ? '1' : '0'
}

async function glide(x: number, y: number) {
  const g = ensureGhost()
  showGhost()
  x = Math.max(4, Math.min(innerWidth - 24, x)); y = Math.max(4, Math.min(innerHeight - 28, y))
  const to = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
  if (!reduced()) {
    const dist = Math.hypot(x - ghost.x, y - ghost.y)
    const a = g.animate([{ transform: g.style.transform }, { transform: to }], { duration: Math.max(380, Math.min(950, 300 + dist * 0.5)), easing: 'cubic-bezier(.22, 1, .36, 1)' })
    await a.finished.catch(() => {})
  }
  g.style.transform = to
  ghost.x = x; ghost.y = y
}
/** The cursor lands on an element (near its left edge, or at its center if small). */
const glideTo = (b: Box) => glide(b.w > 160 ? b.x + Math.min(48, b.w * 0.15) : b.x + b.w / 2, b.y + Math.min(b.h / 2, 28))
async function press() {
  const g = ghost.el
  if (!g || reduced()) return
  g.dataset.press = '1'
  await sleep(220)
  g.dataset.press = '0'
}

/** The glowing ring (2.6 s) around an element that may move (scroll, 3D scene), and its bubble. */
function ring(rect: () => Box | null, note?: string, ms = 2600): Promise<void> {
  const L = getLayer()
  const r = document.createElement('div')
  r.className = 'cp-ring'
  if (reduced()) r.dataset.still = '1'
  L.appendChild(r)
  let n: HTMLDivElement | null = null
  if (note) {
    n = document.createElement('div')
    n.className = 'cp-note'
    const who = document.createElement('span'); who.className = 'cp-note-w mono'; who.textContent = ct('note.from')
    const p = document.createElement('p'); p.textContent = note
    n.append(who, p)
    L.appendChild(n)
  }
  const t0 = performance.now()
  return new Promise((res) => {
    let done = false
    const tick = () => {
      if (done) return
      const b = rect()
      if (b) {
        const P = 6, top = Math.max(HD() + 2, b.y - P), bottom = Math.min(innerHeight - 2, b.y + b.h + P)
        const left = Math.max(2, b.x - P), right = Math.min(innerWidth - 2, b.x + b.w + P)
        const box = { x: left, y: top, w: Math.max(12, right - left), h: Math.max(12, bottom - top) }
        r.style.transform = `translate3d(${box.x.toFixed(1)}px, ${box.y.toFixed(1)}px, 0)`
        r.style.width = `${box.w.toFixed(1)}px`; r.style.height = `${box.h.toFixed(1)}px`
        if (n) placeNote(n, box)
      }
      if (performance.now() - t0 < ms) requestAnimationFrame(tick)
      else {
        done = true
        r.dataset.out = '1'; if (n) n.dataset.out = '1'
        setTimeout(() => { r.remove(); n?.remove() }, reduced() ? 0 : 320)
        res()
      }
    }
    tick()
  })
}
/** The bubble right of the ring, otherwise left; in the top right corner of a large area; otherwise below or above.
 *  Never under the open panel on desktop. */
function placeNote(n: HTMLDivElement, b: Box) {
  const W = n.offsetWidth || 280, H = n.offsetHeight || 64, M = 16, top = HD() + 8
  const panel = document.querySelector('.cp-panel:not([data-sheet="1"])')?.getBoundingClientRect()
  const right = panel && panel.width ? panel.left - M : innerWidth - M
  let x: number, y: number
  if (b.x + b.w + M + W <= right) { x = b.x + b.w + M; y = b.y }
  else if (b.x - M - W >= M) { x = b.x - M - W; y = b.y }
  else if (b.w > innerWidth * 0.5 && b.h > 3 * H) { x = Math.min(b.x + b.w, right + M) - M - W; y = b.y + M }
  else if (b.y + b.h + M + H <= innerHeight - M) { x = b.x; y = b.y + b.h + M }
  else { x = b.x; y = b.y - M - H }
  x = Math.max(M, Math.min(right - W, x)); y = Math.max(top, Math.min(innerHeight - M - H, y))
  n.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
}

// ---------------------------------------------------------------- scrolling

/** Stable rectangle (three frames in a row): the page has finished scrolling. */
async function settle(el: Element, ms = 2000) {
  const end = performance.now() + ms
  let last = NaN, same = 0
  while (performance.now() < end) {
    await nextFrame()
    const y = el.getBoundingClientRect().top
    same = Math.abs(y - last) < 0.5 ? same + 1 : 0
    last = y
    if (same >= 3) return
  }
}
const inView = (b: Box) => b.y >= HD() + 4 && b.y + Math.min(b.h, innerHeight * 0.5) <= innerHeight - 24
/** Brings an element on screen: smooth scroll (Lenis on the landing), or instant with reduced motion. */
async function reveal(el: Element, center = false) {
  const b = boxOf(el)
  if (inView(b)) return
  const lenis = getLenis()
  const off = HD() + (center ? Math.max(24, (innerHeight - HD() - b.h) / 2) : 32)
  if (lenis) lenis.scrollTo(el as HTMLElement, { offset: -off, duration: reduced() ? 0 : 1.2, immediate: reduced() })
  else window.scrollTo({ top: Math.max(0, b.y + scrollY - off), behavior: reduced() ? 'auto' : 'smooth' })
  await settle(el)
}
/** A site section: on the landing, through the landing's own scroll (its stops, Lenis); elsewhere, smoothly. */
async function toSection(el: HTMLElement) {
  if (pageOf() === 'home' && el.id && el.closest('[data-sec]')) { sectionScroll(`#${el.id}`); await sleep(120); await settle(el, 2400) }
  else await reveal(el)
}

// ---------------------------------------------------------------- targets

function anchorEl(id: string): HTMLElement | null {
  return document.getElementById(id) ?? document.querySelector<HTMLElement>(`[data-copilot="${id}"]`)
    ?? document.getElementById(`${id}-h`)?.closest<HTMLElement>('section') ?? document.querySelector<HTMLElement>(`[data-sec="${id}"]`)
}
/** A section's name for the log: its title (the text read by screen readers), otherwise its anchor. */
function labelOf(el: HTMLElement, id: string): string {
  const h = el.matches('h1, h2, h3') ? el : el.querySelector<HTMLElement>('h1, h2, h3') ?? document.getElementById(`${id}-h`)
  const t = (h?.getAttribute('aria-label') ?? h?.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/[.:]$/, '')
  if (!t || t.length > 60) return id
  return getLang() === 'fr' ? `« ${t} »` : `“${t}”`
}
/** A very large element (pinned section, whole page) is pointed at through its readable part: text column, title. */
function visiblePart(el: HTMLElement): HTMLElement {
  if (el.getBoundingClientRect().height <= innerHeight * 0.8) return el
  for (const c of el.querySelectorAll<HTMLElement>('.txt, .app-top-in, .cat-tools, .work-h, .demo-grid, .svc-full-in, h1, h2, h3')) {
    const r = c.getBoundingClientRect()
    if (r.width > 40 && r.height > 16) return c
  }
  return el
}
interface Spot { el?: HTMLElement; rect: () => Box | null; label: string; before?: () => Promise<void> }

type Sled = { i: number; led: string; product?: { id: string } }
type World = { wall?: { sleds?: Sled[] }; toScreen?: ((x: number, y: number, z: number) => { x: number; y: number; z: number }) | null; wallX?: number }
const world = () => (window as unknown as { __world?: World }).__world
/** The landing wall area (the 3D rack, right of the text column). */
function wallSpot(label: string): Spot {
  return {
    label,
    before: async () => { const top = document.getElementById('top'); if (top) await toSection(top) },
    rect: () => { const x = Math.max(world()?.wallX ?? 0, innerWidth * 0.42), y = HD() + 16; return { x, y, w: innerWidth - 24 - x, h: innerHeight - 24 - y } },
  }
}
/** A product's drawer on the wall: its front projected by the scene camera, every frame. */
function sledSpot(id: string): Spot {
  const label = ct('target.product', { id })
  const W = world()
  const rank: Record<string, number> = { green: 0, amber: 1, red: 2, off: 3 }
  const s = (W?.wall?.sleds ?? []).filter((x) => x.product?.id === id).sort((a, b) => (rank[a.led] ?? 4) - (rank[b.led] ?? 4))[0]
  if (!s || !W?.toScreen || !SLOTS[s.i]) return wallSpot(label)
  const rect = (): Box | null => {
    const to = world()?.toScreen, sl = SLOTS[s.i]
    if (!to || !sl) return null
    const a = to(sl.x - G.FW / 2, sl.base + G.FT, 0), c = to(sl.x + G.FW / 2, sl.base + G.FB, 0)
    if (a.z >= 1 || c.z >= 1) return null
    const x = Math.min(a.x, c.x), y = Math.min(a.y, c.y)
    return { x, y, w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) }
  }
  return { label, rect, before: async () => { const top = document.getElementById('top'); if (top) await toSection(top) } }
}

function resolve(target: string): Spot | null {
  const page = pageOf()
  // a bounty by its number: its product's row (or drawer), from the bounties read live
  const mb = /^bounty:(\d{1,10})$/.exec(target)
  if (mb) {
    const b = getLive().bounties?.find((x) => x.id === mb[1])
    const s = b ? resolve(`product:${b.productId}`) : null
    return s && b ? { ...s, label: ct('target.bounty', { id: mb[1]!, p: b.productId }) } : null
  }
  const m = /^product:(\d{1,10})$/.exec(target)
  if (m) {
    const id = m[1]!
    const label = ct('target.product', { id })
    const row = document.querySelector<HTMLElement>(`[data-pid="${id}"]`)?.closest<HTMLElement>('li')
      ?? document.querySelector<HTMLElement>(`a[href="${serviceHref(id)}"]`)?.closest<HTMLElement>('tr')
    if (row) return { el: row, rect: () => contentBox(row), label }
    if (page === 'service' && new URLSearchParams(location.search).get('p') === id) {
      const h = document.querySelector<HTMLElement>('[data-svc-h]')
      if (h) return { el: h, rect: () => boxOf(h), label }
    }
    if (page === 'home') return sledSpot(id)
    return null
  }
  if (target === 'wall' && page === 'home') return wallSpot(t('sec.hero' as TKey))
  const el = anchorEl(target)
  if (!el) return null
  const part = visiblePart(el)
  return { el: part, rect: () => contentBox(part), label: labelOf(el, target) }
}

// ---------------------------------------------------------------- the catalog (Use page)

const fire = (name: string, detail: unknown) => dispatchEvent(new CustomEvent(name, { detail }))
/** Fallback without UsePage's listener: the value set like a keystroke (React reads the input event). */
function setNative(el: HTMLInputElement | HTMLSelectElement, v: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
async function setQuery(el: HTMLInputElement, v: string) {
  fire('archive:catalog', { q: v })
  await nextFrame()
  if (el.value !== v) setNative(el, v)
}
async function typeQuery(q: string, hooks: DriveHooks) {
  const el = await waitFor(() => document.getElementById('cat-q') as HTMLInputElement | null, 4000)
  if (!el || el.value === q) return
  await glideTo(boxOf(el))
  el.classList.add('cp-typing')
  let cur = el.value
  if (reduced()) await setQuery(el, q)
  else {
    // whatever does not start the new search is erased, then the search is typed letter by letter
    while (cur && !q.startsWith(cur)) { cur = cur.slice(0, -1); await setQuery(el, cur); await sleep(24) }
    for (let k = cur.length; k < q.length; k++) { cur = q.slice(0, k + 1); await setQuery(el, cur); await sleep(48 + Math.random() * 46) }
  }
  await sleep(260)
  el.classList.remove('cp-typing')
  hooks.log(q ? ct('step.search', { q }) : ct('step.clear'))
}
const STATE_KEY: Record<string, TKey> = { all: 'app.f.all' as TKey, green: 'app.f.running' as TKey, amber: 'app.f.idle' as TKey, red: 'app.f.retired' as TKey }
async function setState(state: string, hooks: DriveHooks) {
  const idx = ['all', 'green', 'amber', 'red'].indexOf(state)
  const chip = document.querySelectorAll<HTMLButtonElement>('.chips-st .chip')[idx]
  if (chip) { await glideTo(boxOf(chip)); await press() }
  fire('archive:catalog', { state })
  await nextFrame(); await nextFrame()
  if (chip && chip.getAttribute('aria-pressed') !== 'true') chip.click()
  hooks.log(ct('step.state', { f: t(STATE_KEY[state] ?? ('app.f.all' as TKey)) }))
}
async function setKind(kind: string, hooks: DriveHooks) {
  const sel = document.getElementById('cat-k') as HTMLSelectElement | null
  if (sel) { await glideTo(boxOf(sel)); await press() }
  fire('archive:catalog', { kind })
  await nextFrame(); await nextFrame()
  if (sel && sel.value !== kind && [...sel.options].some((o) => o.value === kind)) setNative(sel, kind)
  hooks.log(ct('step.kind', { k: kind === 'all' ? t('app.f.all' as TKey) : t(`svc.${kind}` as TKey) }))
}

async function applyUse(a: NavArgs, hooks: DriveHooks) {
  if (!(await waitFor(() => document.getElementById('cat-q'), 6000))) return
  // a service panel open over the catalog closes first (its Back button)
  const back = document.querySelector<HTMLButtonElement>('.sheet.on .svc-x')
  if (back) { await glideTo(boxOf(back)); await press(); back.click(); await sleep(reduced() ? 60 : 520) }
  const tools = document.querySelector('.cat-tools')
  if (tools && (a.query !== undefined || a.state || a.kind)) await reveal(tools)
  if (a.query !== undefined) await typeQuery(a.query, hooks)
  if (a.state) await setState(a.state, hooks)
  if (a.kind) await setKind(a.kind, hooks)
  if (a.productId) {
    const row = await waitFor(() => document.querySelector<HTMLElement>(`[data-pid="${a.productId}"]`)?.closest<HTMLElement>('li'), 6000)
    if (row) {
      await reveal(row, true)
      await glideTo(boxOf(row))
      hooks.log(ct('step.row', { id: a.productId }))
      await ring(() => contentBox(row), a.reason, 2200)
    } else hooks.log(ct('step.missing', { t: ct('target.product', { id: a.productId }) }))
  } else if (a.section) await scrollToSection(a.section, hooks)
}

async function scrollToSection(id: string, hooks: DriveHooks) {
  const el = anchorEl(id)
  if (!el) { hooks.log(ct('step.missing', { t: id })); return }
  await toSection(el)
  await glideTo(boxOf(visiblePart(el)))
  hooks.log(ct('step.section', { s: labelOf(el, id) }))
}

// ---------------------------------------------------------------- the three tools

/** Returns true if the page changes (the rest resumes on the new page). */
async function navigate(a: NavArgs, rest: UiStep[], hooks: DriveHooks): Promise<boolean> {
  const here = pageOf()
  if (a.reason) caption(a.reason)
  if (a.page === 'datacenter' || a.page === 'console') {
    // another application: the conversation stays in the tab, the remaining gestures stop there
    hooks.log(ct('step.open', { page: ct(`page.${a.page}` as 'page.home') }))
    const link = a.page === 'console' ? document.querySelector<HTMLElement>('.hd-console') : null
    if (link && boxOf(link).w) { await glideTo(boxOf(link)); await press() }
    await sleep(reduced() ? 0 : 350)
    location.assign(urlOf(a.page, a))
    return true
  }
  const target = a.page === 'service' && !a.productId ? 'use' : a.page
  // the demo is the Network page's 3D demo (network.html?focus=demo): on that page, it starts in place
  if (target === 'demo' && here === 'network') { await netDemo({ action: 'play' }, hooks); return false }
  const q = new URLSearchParams(location.search)
  const same = here === target && (target !== 'service' || q.get('p') === a.productId) && (target !== 'doc' || !a.section || q.get('c') === a.section)
  if (!same) {
    hooks.log(ct('step.open', { page: ct(`page.${target}` as 'page.home') }))
    // the menu link, if on screen, is "clicked" by the copilot cursor
    const href = urlOf(target, a)
    const link = [...document.querySelectorAll<HTMLAnchorElement>('.hd-nav a, .hd-drawer a')].find((x) => x.getAttribute('href') === href && x.getBoundingClientRect().width > 0)
    if (link) { await glideTo(boxOf(link)); await press() }
    else await sleep(reduced() ? 0 : 300)
    // the demo opens on the Network page (?focus=demo starts it there): the rest resumes on that page
    hooks.leave(target === 'demo' ? 'network' : target, rest)
    location.assign(href)
    return true
  }
  if (here === 'use') await applyUse(a, hooks)
  else if (a.section) await scrollToSection(a.section, hooks)
  else if (here === 'home' && a.productId) await highlight({ target: `product:${a.productId}`, note: a.reason }, hooks)
  return false
}

async function highlight(a: HlArgs, hooks: DriveHooks) {
  const s = resolve(a.target)
  if (!s) { hooks.log(ct('step.missing', { t: a.target })); return }
  if (s.before) await s.before()
  if (s.el) await reveal(s.el, true)
  const b = s.rect()
  if (b) await glideTo(b)
  hooks.log(ct('step.hl', { t: s.label }))
  // the ring lasts 2.6 s; the next gesture starts a little before it fades
  const done = ring(s.rect, a.note)
  await Promise.race([done, sleep(2100)])
}

async function demo(a: DemoArgs, hooks: DriveHooks) {
  const nav = await waitFor(() => document.querySelector<HTMLElement>('.demo-nav'), 4000)
  const btns = nav ? [...nav.querySelectorAll<HTMLButtonElement>(':scope > .btn')] : []
  const target = a.action === 'next' || a.action === 'play' ? btns[btns.length - 1] : a.action === 'prev' ? btns[0]
    : a.action === 'goto' ? nav?.querySelector<HTMLElement>(`.dot[data-n="${a.step}"]`) : nav
  if (target) { await reveal(target); await glideTo(boxOf(target)); await press() }
  fire('archive:demo', a)
  hooks.log(a.action === 'goto' ? ct('step.demo.goto', { n: a.step ?? 1 }) : ct(`step.demo.${a.action}` as 'step.demo.play'))
  await sleep(reduced() ? 50 : 500)
}

/** The Network page's 3D demo (network/demo.ts): opened with its own button (the Demo view), then driven with its
 *  own controls (play/pause, previous, next, the three chapters), clicked by the copilot cursor. Nothing else. */
async function netDemo(a: DemoArgs, hooks: DriveHooks) {
  const root = () => document.querySelector<HTMLElement>('.s3d .dm')
  const click = async (el: HTMLElement) => { const b = boxOf(el); if (b.w && b.h) { await glideTo(b); await press() } el.click() }
  let started = false
  if (!netDemoOpen()) {
    const open = await waitFor(() => document.querySelector<HTMLElement>('button[data-view="demo"]'), 6000)
    if (!open) { hooks.log(ct('step.missing', { t: ct('page.demo') })); return }
    await click(open)
    if (!(await waitFor(() => (netDemoOpen() ? true : null), 4000))) { hooks.log(ct('step.missing', { t: ct('page.demo') })); return }
    started = true
    await sleep(reduced() ? 50 : 400)
  }
  const r = root()!
  const btn = (k: string) => r.querySelector<HTMLElement>(`[data-a="${k}"]`)
  const playing = () => r.querySelector<HTMLElement>('.dm-play')?.dataset.on === '1'
  const el = a.action === 'play' ? (playing() ? null : btn('play'))
    : a.action === 'pause' ? (playing() ? btn('play') : null)
    : a.action === 'goto' ? r.querySelector<HTMLElement>(`.dm-seg[data-c="${Math.min(2, Math.max(0, Math.floor(((a.step ?? 1) - 1) / 3)))}"]`)
    : btn(a.action)
  if (el) await click(el)
  hooks.log(a.action === 'goto' ? ct('step.demo.goto', { n: a.step ?? 1 }) : ct(`step.demo.${a.action}` as 'step.demo.play'))
  // the demo takes the whole scene (its story on the left, its controls along the bottom): the panel steps aside once
  // the demo starts, the AskHive button brings it back with this log
  if (started || a.action === 'play') hooks.hide?.()
  await sleep(reduced() ? 50 : 500)
}

// ---------------------------------------------------------------- the queue

let chain: Promise<void> = Promise.resolve()
let running = 0
/** Plays a response's gestures (after those still playing). */
export function drive(steps: UiStep[], hooks: DriveHooks): Promise<void> {
  if (!steps.length) return chain
  chain = chain.then(() => run(steps, hooks)).catch(() => {})
  return chain
}
async function run(steps: UiStep[], hooks: DriveHooks) {
  running++
  const phone = matchMedia('(max-width: 640px)').matches
  if (phone) { hooks.drive(true); await sleep(reduced() ? 0 : 280) }
  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!
      caption('')
      if (s.tool === 'ui_navigate') { if (await navigate(s.args, steps.slice(i), hooks)) return }
      else if (s.tool === 'ui_highlight') await highlight(s.args, hooks)
      else if (s.tool === 'ui_demo') {
        // the demo is the Network page's 3D demo (the old /demo.html keeps its own player): go there first
        const here = pageOf()
        if (here === 'network') await netDemo(s.args, hooks)
        else if (here === 'demo') await demo(s.args, hooks)
        else if (await navigate({ page: 'demo' }, steps.slice(i), hooks)) return
      }
    }
  } finally {
    running--
    if (!running) { hideGhost(); if (phone) hooks.drive(false) }
  }
}
