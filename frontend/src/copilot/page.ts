// The open page, as the copilot receives it (page field): its name, and what the URL says (?p, ?q, ?state, ?kind,
// the anchor). All values are bounded here: a name from the list, digits, 60 characters.
import { link, serviceHref, useHref } from '../links'
import { CONSOLE, DATACENTER } from '../data/endpoints'

export type PageName = 'home' | 'use' | 'service' | 'rent' | 'publish' | 'demo' | 'network' | 'doc' | 'space' | 'bounty' | 'sessions' | 'operator' | 'bridge'
export type Target = PageName | 'datacenter' | 'console'
// the pages the server copilot may open (its SITE_PAGES): every page of this site, the 3D room and the console
export const TARGETS: readonly Target[] = ['home', 'network', 'service', 'doc', 'space', 'use', 'bounty', 'sessions', 'operator', 'rent', 'publish', 'demo', 'bridge', 'datacenter', 'console']
export const STATES = ['all', 'green', 'amber', 'red'] as const
export const KINDS = ['all', 'ai', 'x402', 'bounty', 'copilot', 'author'] as const
export const CONSOLE_ROUTES = ['vue', 'ruche', 'produits', 'primes', 'playground', 'cles', 'publier-prime', 'operateur', 'publier-produit', 'portefeuille', 'developpeurs'] as const
export type StateF = (typeof STATES)[number]
export type KindF = (typeof KINDS)[number]

export const isId = (x: unknown): x is string => typeof x === 'string' && /^\d{1,10}$/.test(x)
export const isAnchor = (x: unknown): x is string => typeof x === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(x)
export const oneOf = <T extends string>(list: readonly T[], x: unknown): T | undefined => (typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : undefined)

/** The Network page's three parts: Use, Rent and Publish are no pages of their own (use.html, rent.html and
 *  publish.html only redirect), they are network.html?focus=use|rent|publish, whose panel holds their steps. */
export const NET_PARTS = ['use', 'rent', 'publish'] as const
export type NetPart = (typeof NET_PARTS)[number]
export const isNetPart = (x: unknown): x is NetPart => typeof x === 'string' && (NET_PARTS as readonly string[]).includes(x)

/** The file served at this URL (/, /service.html, /network.html…), under the build base, or null outside the front. */
function fileOf(pathname: string): PageName | null {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  const rel = base && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname
  const p = rel.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '')
  if (p === '') return 'home'
  const m = /^\/(use|service|rent|publish|demo|network|doc|space|bounty|sessions|operator|bridge)$/.exec(p)
  return m ? (m[1] as PageName) : null
}
/** The Network page is open (network.html), whatever part it shows */
export const onNetworkPage = (pathname = location.pathname) => fileOf(pathname) === 'network'
/** The page open, as the copilot names it: the file served, except on the Network page opened on a part
 *  (network.html?focus=rent), which is that part's page (rent): its steps carry the anchors of the copilot's tours
 *  (data-copilot). The Network page also carries the site's demo (its 3D demo, network.html?focus=demo): the copilot
 *  plays it there. */
export function pageOf(pathname = location.pathname, search = location.search): PageName | null {
  const f = fileOf(pathname)
  if (f !== 'network') return f
  const part = new URLSearchParams(search).get('focus')
  return isNetPart(part) ? part : 'network'
}

/** The landing section at the middle of the screen (its anchor: top, use, rent, publish, invalid, protocol, arc, end). */
function homeSection(): string | undefined {
  const mid = innerHeight / 2
  for (const el of document.querySelectorAll<HTMLElement>('[data-sec][id]')) {
    const r = el.getBoundingClientRect()
    if (r.top <= mid && r.bottom > mid) return isAnchor(el.id) ? el.id : undefined
  }
  return undefined
}

export interface PageCtx { name: PageName; productId?: string; query?: string; state?: StateF; kind?: KindF; section?: string }
/** The Network page's 3D demo is open (its player, network/demo.ts, is shown) */
export const netDemoOpen = () => { const r = document.querySelector<HTMLElement>('.s3d .dm'); return !!r && !r.hidden }
export function pageContext(): PageCtx | undefined {
  const page = pageOf()
  // on the Network page, its open 3D demo is the demo the server knows
  const name = page === 'network' && netDemoOpen() ? 'demo' : page
  if (!name) return undefined
  const q = new URLSearchParams(location.search)
  const out: PageCtx = { name }
  const p = q.get('p')
  if (isId(p)) out.productId = p
  if (name === 'use') {
    const query = (q.get('q') ?? '').trim().slice(0, 60)
    if (query) out.query = query
    const st = oneOf(STATES, q.get('state')), k = oneOf(KINDS, q.get('kind'))
    if (st) out.state = st
    if (k) out.kind = k
  }
  const hash = decodeURIComponent(location.hash.replace(/^#/, ''))
  const section = isAnchor(hash) ? hash : name === 'home' ? homeSection() : undefined
  if (section) out.section = section
  return out
}

/** The URL of a site page (Use, Rent and Publish: the Network page's parts). */
export function urlOf(page: Target, a: { productId?: string; consoleRoute?: string; section?: string } = {}): string {
  // site URLs (link, build base), the console and the 3D room (data/endpoints.ts)
  switch (page) {
    case 'home': return link.home
    // Use, Rent and Publish: the Network page opened on that part (Use with the service it calls, ?p=)
    case 'use': return a.productId ? useHref(a.productId) : link.use
    // Services is the catalog: a product's sheet (?p=), or the shop window itself
    case 'service': return a.productId ? serviceHref(a.productId) : link.catalog
    // the Doc page opens one chapter at a time (doc.html?c=<chapter>)
    case 'doc': return isAnchor(a.section) ? `${link.doc}?c=${a.section}` : link.doc
    case 'space': return `${link.home}space.html`
    // the Bridge page (CCTP: USDC from Ethereum Sepolia or Base Sepolia to Arc)
    case 'bridge': return `${link.home}bridge.html`
    // the Network page on one of its own views: what runs on Arc, CCTP
    case 'network': return a.section === 'arc' || a.section === 'cctp' ? `${link.network}?focus=${a.section}` : link.network
    // rent, publish (the Network page's parts), demo (the Network page's 3D demo), bounty, sessions, operator (the tabs
    // of My space): links.tsx
    case 'datacenter': return DATACENTER
    case 'console': return `${CONSOLE}/#/${oneOf(CONSOLE_ROUTES, a.consoleRoute) ?? 'vue'}`
    default: return link[page]
  }
}
