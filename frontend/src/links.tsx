import { CONSOLE, useLive } from './data/live'
import { DATACENTER } from './data/endpoints'
import { t, useLang } from './i18n'
import { num } from './data/fmt'
import { C, C21 } from './data/facts'
import type { Service } from './data/wall'

// The site's places, one address each: Network and its three parts (Use, Rent, Publish: their
// steps, signed in place), Services (the catalog), Doc, and My space, whose tabs hold Bounties, Sessions and Machines.
// The old addresses (use.html, rent.html, publish.html, demo.html, bounty.html, sessions.html, operator.html) only
// redirect there. The Hive, Developers and Console pages live in the console. Every page sits under the build base
// (BASE_URL: "/" or a sub-path).
const B = import.meta.env.BASE_URL
/** The Network page opened on one part: Use (a paid call), Rent (bring a machine), Publish (publish a service) */
export const networkFor = (k: 'use' | 'rent' | 'publish') => `${B}network.html?focus=${k}`
export const link = {
  home: B, network: `${B}network.html`, use: networkFor('use'), rent: networkFor('rent'), publish: networkFor('publish'), demo: `${B}network.html?focus=demo`,
  catalog: `${B}service.html`, doc: `${B}doc.html`,
  bounty: `${B}space.html?tab=bounties`, sessions: `${B}space.html?tab=sessions`, operator: `${B}space.html?tab=machines`,
  hive: `${CONSOLE}/#/ruche`, dev: `${CONSOLE}/#/developpeurs`, console: `${CONSOLE}/#/vue`, datacenter: DATACENTER,
}
/** A service page in the app: its description, with a button to use it */
export const serviceHref = (productId: string) => `${B}service.html?p=${encodeURIComponent(productId)}`
/** Using a service: Network's Use part with that service picked (its paid call; a service paid otherwise says where) */
export const useHref = (productId: string) => `${networkFor('use')}&p=${encodeURIComponent(productId)}`
/** Console screen for a service, kept for secondary links. The console Bounties page only reads SealedBounty;
 *  verified-level bounties (SealedBountyVerified) are listed under its products, as the console files them */
const VERIFIED_RAILS = [C.SealedBountyVerified, C21.SealedBountyVerified, C21.SealedBountyVerifiedOld].map((a) => a.toLowerCase())
export const consoleFor = (s?: Service, settlement?: string) => `${CONSOLE}/#/${s === 'bounty' && settlement && VERIFIED_RAILS.includes(settlement.toLowerCase()) ? 'produits' : s === 'bounty' ? 'primes' : s === 'copilot' ? 'vue' : s === 'ai' || s === 'x402' ? 'playground' : 'produits'}`
export const tx = (h?: string | null) => (h ? `https://explorer.testnet.arc.io/tx/${h}` : undefined)
export const addr = (a?: string | null) => (a ? `https://explorer.testnet.arc.io/address/${a}` : undefined)

export function BlockRead() {
  const block = useLive((s) => s.block)
  const lang = useLang()
  return <span className="nowrap">{block ? <span className="tnum">{num(block, lang)}</span> : t('band.reading')}</span>
}
