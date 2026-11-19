// The open page, as the copilot receives it (page field): its name, and what the URL says (?p, ?q, ?state, ?kind,
// the anchor). All values are bounded here: a name from the list, digits, 60 characters.
import { link, serviceHref } from '../links'
import { CONSOLE, DATACENTER } from '../data/endpoints'

export type PageName = 'home' | 'use' | 'service' | 'rent' | 'publish' | 'demo'
export type Target = PageName | 'datacenter' | 'console'
export const TARGETS: readonly Target[] = ['home', 'use', 'service', 'rent', 'publish', 'demo', 'datacenter', 'console']
export const STATES = ['all', 'green', 'amber', 'red'] as const
export const KINDS = ['all', 'ai', 'x402', 'bounty', 'copilot', 'author'] as const
export const CONSOLE_ROUTES = ['vue', 'ruche', 'produits', 'primes', 'playground', 'cles', 'publier-prime', 'operateur', 'publier-produit', 'portefeuille', 'developpeurs'] as const
export type StateF = (typeof STATES)[number]
export type KindF = (typeof KINDS)[number]

export const isId = (x: unknown): x is string => typeof x === 'string' && /^\d{1,10}$/.test(x)
export const isAnchor = (x: unknown): x is string => typeof x === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(x)
export const oneOf = <T extends string>(list: readonly T[], x: unknown): T | undefined => (typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : undefined)

/** The front page served at this URL (/, /use.html, /service.html…), or null outside the front (and for pages the
 *  server copilot does not know: Network, Bounties, Sessions, Operator). Resolved under the build base. */
export function pageOf(pathname = location.pathname): PageName | null {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  const rel = base && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname
  const p = rel.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '')
  if (p === '') return 'home'
  const m = /^\/(use|service|rent|publish|demo)$/.exec(p)
  return m ? (m[1] as PageName) : null
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
export function pageContext(): PageCtx | undefined {
  const name = pageOf()
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

/** The URL of a site page; catalog search and filters are typed on arrival. */
export function urlOf(page: Target, a: { productId?: string; consoleRoute?: string } = {}): string {
  // site URLs (link, build base), the console and the 3D room (data/endpoints.ts)
  switch (page) {
    case 'home': return link.home
    case 'use': return link.use
    case 'service': return a.productId ? serviceHref(a.productId) : link.use
    case 'datacenter': return DATACENTER
    case 'console': return `${CONSOLE}/#/${oneOf(CONSOLE_ROUTES, a.consoleRoute) ?? 'vue'}`
    default: return link[page]
  }
}
