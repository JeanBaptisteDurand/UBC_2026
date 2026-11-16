// Bilingual, English first.
import { useSyncExternalStore } from 'react'

export type Lang = 'en' | 'fr'
const saved = (() => { try { return localStorage.getItem('archive-lang') } catch { return null } })()
let lang: Lang = new URLSearchParams(location.search).get('lang') === 'fr' || saved === 'fr' ? 'fr' : 'en'
const subs = new Set<() => void>()
export const getLang = () => lang
export function setLang(l: Lang) {
  lang = l
  try { localStorage.setItem('archive-lang', l) } catch {}
  document.documentElement.lang = l
  setTitle()
  subs.forEach((f) => f())
}
export const useLang = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => lang)

const EN = {
  'hero.title': 'Sealed machines, open market.',
  'svc.ai': 'Private AI',
  'svc.x402': 'Private AI, pay per call',
  'svc.bounty': 'Sealed Bounty',
  'svc.copilot': 'Copilot',
  'svc.author': 'Author service',
  'led.off': 'open slot',
  'led.amber': 'waiting',
  'led.replay': 'replayed, waiting',
  'led.green': 'running',
  'plate.off': 'Open slot',
  'plate.sub.off': 'Available',
  'plate.sub.green': 'Running',
  'plate.sub.amber': 'Waiting',
  'plate.sub.red': 'Invalid',
  'plate.sub.dim': 'Inactive',
  'why.expiredShort': 'inactive',
  'why.invalidated': 'invalidated',
  'why.retired': 'retired',
  'why.slashed': 'slashed',
  'why.productRetired': 'product retired',
  'card.state': 'State',
  'card.service': 'Service',
  'card.operator': 'Operator',
  'card.signer': 'Signer',
  'card.anchored': 'Anchored at',
  'card.until': 'Window closed at block',
  'card.price': 'Price',
  'card.client': 'Latest client',
  'card.reason': 'Reason',
  'reason.policy': 'its quote no longer passes Intel’s current collateral or the product policy',
  'reason.workload': 'its image was retired from the product',
  'card.open': 'Open service',
  'card.rent': 'Rent out your machine',
  'card.empty': 'No enclave in this slot yet. Any Intel TDX machine can take it.',
  'card.esc': 'Esc to close',
  'card.free': 'free',
  'card.per.call': 'per call',
  'card.per.token': 'per token',
  'card.block': 'block {n}',
  'bay': 'BAY',
  'svc.page': 'Service',
  'svc.back': 'Back to the wall',
  'svc.soon': 'This service is registered on Arc testnet, and the data below is read live. Its page shows who runs it, what it costs and what Arc checked.',
  'svc.none': 'No product has this number. Go back to the wall and pick a sled.',
  'svc.loading': 'Reading the service',
  'svc.loadingSlot': 'Reading the slot',
  'svc.enclave': 'Registered enclave',
  'svc.use': 'Open the service page',
  'svc.slot': 'Slot',
  'svc.close': 'Back to the wall',
  'svc.panel': 'Service panel',
}
type Key = keyof typeof EN
const FR: Partial<Record<Key, string>> = {
  'hero.title': 'Machines scellées, marché ouvert.',
  'svc.ai': 'IA privée',
  'svc.x402': 'IA privée, paiement à l’appel',
  'svc.bounty': 'Prime scellée',
  'svc.copilot': 'Copilot',
  'svc.author': 'Service d’auteur',
  'led.off': 'logement libre',
  'led.amber': 'en attente',
  'led.replay': 'rejouée, en attente',
  'led.green': 'en marche',
  'plate.off': 'Logement libre',
  'plate.sub.off': 'Disponible',
  'plate.sub.green': 'En marche',
  'plate.sub.amber': 'En attente',
  'plate.sub.red': 'Invalide',
  'plate.sub.dim': 'Inactive',
  'why.expiredShort': 'inactive',
  'why.invalidated': 'invalidée',
  'why.retired': 'retirée',
  'why.slashed': 'slashed',
  'why.productRetired': 'produit retiré',
  'card.state': 'État',
  'card.service': 'Service',
  'card.operator': 'Opérateur',
  'card.signer': 'Signataire',
  'card.anchored': 'Ancrée au',
  'card.until': 'Fenêtre close au bloc',
  'card.price': 'Prix',
  'card.client': 'Dernier client',
  'card.reason': 'Raison',
  'reason.policy': 'son quote ne passe plus le collatéral actuel d’Intel ou la politique du produit',
  'reason.workload': 'son image a été retirée du produit',
  'card.open': 'Ouvrir le service',
  'card.rent': 'Louer votre machine',
  'card.empty': 'Aucune enclave dans ce logement. Toute machine Intel TDX peut le prendre.',
  'card.esc': 'Échap pour fermer',
  'card.free': 'gratuit',
  'card.per.call': 'l’appel',
  'card.per.token': 'le jeton',
  'card.block': 'bloc {n}',
  'bay': 'BAIE',
  'svc.page': 'Service',
  'svc.back': 'Retour au mur',
  'svc.soon': 'Ce service est inscrit sur Arc testnet, et ses données ci-dessous sont lues en direct. Sa page montre qui le fait tourner, ce qu’il coûte et ce qu’Arc a vérifié.',
  'svc.none': 'Aucun produit ne porte ce numéro. Revenez au mur et choisissez une lame.',
  'svc.loading': 'Lecture du service',
  'svc.loadingSlot': 'Lecture du logement',
  'svc.enclave': 'Enclave inscrite',
  'svc.use': 'Ouvrir la page du service',
  'svc.slot': 'Logement',
  'svc.close': 'Retour au mur',
  'svc.panel': 'Panneau du service',
}
export type TKey = Key
export function t(k: Key, vars?: Record<string, string | number>) {
  let s = (lang === 'fr' ? FR : EN)[k] ?? EN[k] ?? k
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(String(b))
  return s
}
document.documentElement.lang = lang
/** The tab title follows the hero title; a page that sets its own title says so with data-title */
export function setTitle() { const own = document.documentElement.dataset.title; document.title = own ? own : `ArcHive. ${t('hero.title')}` }
setTitle()
