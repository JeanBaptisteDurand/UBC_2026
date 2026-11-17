// Page transitions, one rule for every page of the site. A veil in the page colour covers each page from its first
// paint (styles.css, body::after) and lifts only once the page is really ready, so the in-between states never show
// (Network arriving on a focus, the landing before its first film frame). Leaving through an internal link, the veil
// comes back first, then the browser navigates: the pages chain through the colour of the room, never through a blink.
//   - landing (html.film-page): lifts on the first film frame (world.sceneReady);
//   - Network (#net): lifts when the scene says it is ready (window.__frontReady, set once the focus is in place);
//   - other pages: lifts right after the first render.
// A failsafe lifts it after 5 s whatever happens; ?tournage (film capture) has no veil.
const root = document.documentElement
const W = window as unknown as { __frontReady?: boolean; __world?: { sceneReady?: boolean } }
const OUT_MS = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220

let lifted = false
function lift() {
  if (lifted) return
  lifted = true
  requestAnimationFrame(() => { root.classList.remove('veil-on'); root.classList.add('veil-off') })
}

if (new URLSearchParams(location.search).has('tournage')) { root.classList.add('veil-none') }
else {
  root.classList.add('veil-js')
  const ready = () => {
    if (root.classList.contains('film-page')) return !!W.__world?.sceneReady
    if (document.getElementById('net')) return !!W.__frontReady
    return !!document.querySelector('#root > *')
  }
  const poll = () => { if (ready()) lift(); else if (!lifted) setTimeout(poll, 40) }
  requestAnimationFrame(() => requestAnimationFrame(poll))
  setTimeout(lift, 5000)
  // back/forward cache: the page comes back as it was left, veil down
  addEventListener('pageshow', (e) => { if (e.persisted) { root.classList.remove('veil-on'); lifted = false; lift() } })

  // leaving: an internal link to another page (not a hash, not a new tab, not handled by the page itself)
  addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
    const u = new URL(a.href, location.href)
    if (u.origin !== location.origin) return
    if (u.pathname === location.pathname && u.search === location.search) return // same page (hash or nothing)
    e.preventDefault()
    root.classList.remove('veil-off'); root.classList.add('veil-on')
    setTimeout(() => location.assign(u.href), OUT_MS)
  })
}

/** For code that navigates by itself (location.assign): the same exit */
export function leaveTo(href: string) {
  if (root.classList.contains('veil-none')) { location.assign(href); return }
  root.classList.remove('veil-off'); root.classList.add('veil-on')
  setTimeout(() => location.assign(href), OUT_MS)
}
