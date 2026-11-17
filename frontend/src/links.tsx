import { CONSOLE, useLive } from './data/live'
import { DATACENTER } from './data/endpoints'
import { t, useLang } from './i18n'
import { num } from './data/fmt'
import { C } from './data/facts'
import type { Service } from './data/wall'

// App pages: Use, Rent, Publish, the demo, plus Bounties, Sessions and Operator, which sign in place. The Hive,
// Developers and Console pages live in the console. Every page sits under the build base (BASE_URL: "/" or a sub-path).
const B = import.meta.env.BASE_URL
export const link = {
  home: B, use: `${B}use.html`, demo: `${B}demo.html`, rent: `${B}rent.html`, publish: `${B}publish.html`, network: `${B}network.html`,
  bounty: `${B}bounty.html`, sessions: `${B}sessions.html`, operator: `${B}operator.html`, services: `${B}services.html`,
  hive: `${CONSOLE}/#/ruche`, dev: `${CONSOLE}/#/developpeurs`, console: `${CONSOLE}/#/vue`, datacenter: DATACENTER,
}
/** The page that gathers Use, Rent and Publish, opened on one part */
export const networkFor = (k: 'use' | 'rent' | 'publish') => `${B}network.html?focus=${k}`
/** A service page in the app */
export const serviceHref = (productId: string) => `${B}service.html?p=${encodeURIComponent(productId)}`
/** Where a service is used on this site: a bounty on the bounties page, session inference on the sessions page,
 *  pay-per-call in the Use action panel, the copilot in its bubble. */
export const actFor = (s?: Service, productId?: string) =>
  s === 'bounty' ? link.bounty
    : s === 'ai' ? `${link.sessions}${productId ? `?p=${encodeURIComponent(productId)}` : ''}`
      : s === 'copilot' ? '#copilot'
        : `${link.use}${productId ? `?act=${encodeURIComponent(productId)}` : ''}#act`
/** Console screen for a service, kept for secondary links. The console Bounties page only reads SealedBounty;
 *  verified-level bounties (SealedBountyVerified) are listed under its products, as the console files them */
const VERIFIED_RAILS = [C.SealedBountyVerified, C.SealedBountyVerifiedOld].map((a) => a.toLowerCase())
export const consoleFor = (s?: Service, settlement?: string) => `${CONSOLE}/#/${s === 'bounty' && settlement && VERIFIED_RAILS.includes(settlement.toLowerCase()) ? 'produits' : s === 'bounty' ? 'primes' : s === 'copilot' ? 'vue' : s === 'ai' || s === 'x402' ? 'playground' : 'produits'}`
export const tx = (h?: string | null) => (h ? `https://explorer.testnet.arc.io/tx/${h}` : undefined)
export const addr = (a?: string | null) => (a ? `https://explorer.testnet.arc.io/address/${a}` : undefined)

export function BlockRead() {
  const block = useLive((s) => s.block)
  const lang = useLang()
  return <span className="nowrap">{block ? <span className="tnum">{num(block, lang)}</span> : t('band.reading')}</span>
}
