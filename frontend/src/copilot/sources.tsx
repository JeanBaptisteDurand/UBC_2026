// The sources under an answer, as the visitor reads them: the server cites its corpus by id (site-v5#tokenomics,
// site-v4#contrats, OperatorBond.sol#caution); each becomes a title in the site language, linked to its place on the
// site (a Doc chapter, a page). An id with no place on the site is left out: no internal id or tool name on screen.
import { Fragment } from 'react'
import { getLang, useLang } from '../i18n'
import { link } from '../links'
import { ct } from './strings'

type Two = readonly [en: string, fr: string]
interface Place { t: Two; href?: string; doc?: boolean }

// the Doc chapters (doc/content.ts toc), by their id and the anchors the corpus uses in French
const CH: Record<string, Two> = {
  'trust': ['No third party', 'Aucun tiers'], 'architecture': ['One paid use', 'Un usage payé'], 'admission': ['Admission', 'L’admission'],
  'identity': ['Which machine', 'Quelle machine'], 'notary-robot': ['The notary robot', 'Le notaire-robot'], 'stakes': ['Lying costs the bond', 'Mentir coûte la caution'],
  'settlement': ['Payment and record', 'Paiement et trace'], 'tokenomics': ['Tokenomics', 'Tokenomics'], 'privacy': ['Privacy', 'Confidentialité'],
  'contracts': ['The contracts', 'Les contrats'], 'numbers': ['The numbers', 'Les chiffres'], 'build': ['Build on it', 'Construire dessus'],
}
const CH_ALIAS: Record<string, string> = {
  'tiers': 'trust', 'confiance': 'trust', 'identite': 'identity', 'notaire-robot': 'notary-robot', 'notaire': 'notary-robot',
  'caution': 'stakes', 'cautions': 'stakes', 'bond': 'stakes', 'reglement': 'settlement', 'paiement': 'settlement',
  'confidentialite': 'privacy', 'contrats': 'contracts', 'chiffres': 'numbers', 'construire': 'build', 'sdk': 'build',
}
const SERVICES: Place = { t: ['Services', 'Services'], href: link.catalog }
const NETWORK: Place = { t: ['Network', 'Réseau'], href: link.network }
const PAGES: Record<string, Place> = {
  'home': { t: ['Home', 'Accueil'], href: link.home }, 'accueil': { t: ['Home', 'Accueil'], href: link.home },
  'network': NETWORK, 'reseau': NETWORK, 'etat': NETWORK,
  'use': { t: ['Use', 'Utiliser'], href: link.use }, 'rent': { t: ['Rent', 'Louer'], href: link.rent },
  'publish': { t: ['Publish', 'Publier'], href: link.publish }, 'publier': { t: ['Publish', 'Publier'], href: link.publish },
  'demo': { t: ['3D demo', 'Démo 3D'], href: link.demo },
  'service': SERVICES, 'services': SERVICES, 'catalog': SERVICES, 'catalogue': SERVICES, 'marche': SERVICES, 'market': SERVICES,
  'products': SERVICES, 'produits': SERVICES, 'ia-privee': SERVICES, 'private-ai': SERVICES,
  'doc': { t: ['Doc', 'Doc'], href: link.doc }, 'technology': { t: ['Doc', 'Doc'], href: link.doc }, 'technologie': { t: ['Doc', 'Doc'], href: link.doc },
  'space': { t: ['My space', 'Mon espace'], href: `${link.home}space.html` }, 'espace': { t: ['My space', 'Mon espace'], href: `${link.home}space.html` },
  'bounty': { t: ['Bounties', 'Primes'], href: link.bounty }, 'bounties': { t: ['Bounties', 'Primes'], href: link.bounty }, 'primes': { t: ['Bounties', 'Primes'], href: link.bounty },
  'sessions': { t: ['Sessions', 'Sessions'], href: link.sessions },
  'operator': { t: ['Operator', 'Opérateur'], href: link.operator }, 'operateur': { t: ['Operator', 'Opérateur'], href: link.operator },
  'bridge': { t: ['Bridge', 'Bridge'], href: `${link.home}bridge.html` }, 'cctp': { t: ['Bridge', 'Bridge'], href: `${link.home}bridge.html` },
  'datacenter': { t: ['3D room', 'Salle 3D'], href: link.datacenter }, 'datacenter-console': { t: ['3D room', 'Salle 3D'], href: link.datacenter },
  'console': { t: ['Console', 'Console'], href: link.console }, 'hive': { t: ['Hive', 'Hive'], href: link.hive }, 'ruche': { t: ['Hive', 'Hive'], href: link.hive },
  'dev': { t: ['Developers', 'Développeurs'], href: link.dev }, 'developers': { t: ['Developers', 'Développeurs'], href: link.dev }, 'mcp': { t: ['Developers', 'Développeurs'], href: link.dev },
  'askhive': { t: ['AskHive', 'AskHive'] }, 'copilot': { t: ['AskHive', 'AskHive'] },
}

function place(id: string): Place | undefined {
  const m = /^([^#\s]+)#([a-z0-9-]{1,60})$/i.exec(id.trim())
  if (!m) return undefined
  const doc = m[1]!.toLowerCase(), a = m[2]!.toLowerCase()
  // a contract's source: the Doc chapter that lists the contracts
  if (/\.sol$/.test(doc)) return { t: CH.contracts!, href: `${link.doc}?c=contracts`, doc: true }
  // the site's own pages (site-v3, site-v4, site-v5...); a repository file (README) has no place on the site
  if (!/^site/.test(doc)) return undefined
  const ch = CH[a] ? a : CH_ALIAS[a]
  if (ch) return { t: CH[ch]!, href: `${link.doc}?c=${ch}`, doc: true }
  return PAGES[a]
}

export interface Source { label: string; href?: string }
/** The answer's citations as titles in the site language, in their order, each once; unknown ids left out */
export function readSources(ids: readonly string[]): Source[] {
  const fr = getLang() === 'fr'
  const out: Source[] = []
  for (const id of ids) {
    const p = place(id)
    if (!p) continue
    const t = p.t[fr ? 1 : 0]
    const label = p.doc ? `Doc${fr ? ' : ' : ': '}${t}` : t
    if (!out.some((s) => s.label === label)) out.push({ label, ...(p.href ? { href: p.href } : {}) })
  }
  // a Doc chapter cited makes the plain "Doc" redundant
  const chapter = out.some((s) => s.href?.startsWith(`${link.doc}?c=`))
  return out.filter((s) => !(chapter && s.href === link.doc)).slice(0, 6)
}

/** "Sources: Doc: Tokenomics, Home", under an answer (commas: the site shows no middle dot); nothing when no citation has a place on the site */
export function Sources({ ids }: { ids: readonly string[] }) {
  useLang()
  const list = readSources(ids)
  if (!list.length) return null
  const [pre = '', post = ''] = ct('sources', { list: '\u0001' }).split('\u0001')
  return (
    <p className="cp-src">
      {pre}
      {list.map((s, i) => (
        <Fragment key={s.label}>
          {i ? ', ' : null}
          {s.href ? <a className="cp-a" href={s.href}>{s.label}</a> : <span>{s.label}</span>}
        </Fragment>
      ))}
      {post}
    </p>
  )
}
