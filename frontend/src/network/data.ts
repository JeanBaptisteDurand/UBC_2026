// Scene and panel texts, in English and French (English by default, like the site). Values come from
// hive-data.json; no fact added.
// Callouts: a title, then either a sentence of at most forty words, or at most three key-value rows. Each element
// has a hand-written position in the overview scene.
import { AT } from './at' // not './loop': the page reads these texts before three.js is loaded
import { lg, type Lg } from './lang'

export type Part = 'use' | 'rent' | 'publish'
export type View = 'ensemble' | Part | 'cctp' | 'arc' | 'demo'
export interface Step { t: string; d: string; el: string; at: number; check?: boolean }
export interface PartText { kicker: string; title: string; actor: string; steps: Step[] }
export interface Fiche { n: string; d?: string; kv?: [string, string][] }
export type Place = 'tl' | 'tr' | 'bl' | 'br'

type Bi<T> = Record<Lg, T>
const PARTS_I: Bi<Record<Part, PartText>> = {
  en: {
    use: { kicker: 'Use a service', title: 'Use a service', actor: 'The user’s desk, and behind it the drone the service drives.', steps: [
      { t: 'Pick a service', d: 'From the catalog, with its price per use.', el: 'use.guichet', at: 16.6 },
      { t: 'Arc gives the enclave key', d: 'A read of EnclaveRegistry: no transaction is sent.', el: 'link.useArc', at: AT.key },
      { t: 'Seal the request for that enclave only', d: 'Encrypted to its key (x25519). It goes straight to the machine, not through the chain: neither Arc, nor the operator, nor ArcHive can read it.', el: 'link.useRent', at: AT.request },
      { t: 'The enclave answers, signed', d: 'Straight back to the user, with its key checked by Arc. The drone takes off: the service acted.', el: 'use.drone', at: AT.answer },
      { t: 'Pay per use in USDC', d: 'x402, settled on Arc, split by the product’s shares.', el: 'link.useArc', at: AT.pay },
    ] },
    rent: { kicker: 'Rent a machine', title: 'Rent out your machine', actor: 'The server room: the dock, the gate and the racks, with the operator.', steps: [
      { t: 'Real hardware', d: 'A 4th or 5th gen Xeon with Intel TDX, bare metal or a TDX cloud. A machine without TDX is refused.', el: 'rent.quai', at: AT.arrive },
      { t: 'Lock a USDC bond', d: 'OperatorBond: what the operator loses if it cheats.', el: 'rent.operateur', at: AT.arrive },
      { t: 'Measured boot', d: 'The chip measures the loaded image (MRTD, RTMR) and Intel signs a quote (DCAP).', el: 'rent.portique', at: AT.quote },
      { t: 'Arc checks, in the contract', d: 'Five checks, lit one by one on the gate.', el: 'rent.portique', at: AT.quote + 0.3, check: true },
      { t: 'The stamp, then the rack', d: 'The Arc logo is applied to the admitted machine; the operator racks it.', el: 'rent.baies', at: AT.seal },
      { t: 'Paid on every use', d: 'The payment is split from Arc. A machine caught lying loses its bond.', el: 'link.rentArc', at: AT.pay },
    ] },
    publish: { kicker: 'Publish a service', title: 'Publish your service', actor: 'The developer’s desk: three screens of code.', steps: [
      { t: 'Write the manifest', d: 'The image, the price, the shares.', el: 'publish.poste', at: AT.manifest },
      { t: 'Set the image fingerprint on Arc', d: 'ProductRegistry, WorkloadAdded: only enclaves running exactly this image can serve it.', el: 'link.publishArc', at: AT.publish },
      { t: 'Activation after the delay', d: 'Open to any author, with no review: the product turns Active once its protection delay has passed.', el: 'arc', at: AT.publish },
      { t: 'The machine runs the image', d: 'The published image goes to the operators’ machines; only that exact image can serve.', el: 'link.publishRent', at: 4.0 },
      { t: 'Revenue on every call', d: 'The author’s share comes back from Arc.', el: 'link.publishArc', at: AT.pay },
    ] },
  },
  fr: {
    use: { kicker: 'Use a service', title: 'Utiliser un service', actor: 'Le poste de l’utilisateur, et derrière lui le drone que le service fait voler.', steps: [
      { t: 'Choisir un service', d: 'Dans le catalogue, avec son prix à l’usage.', el: 'use.guichet', at: 16.6 },
      { t: 'Arc donne la clé de l’enclave', d: 'Lecture d’EnclaveRegistry, aucune transaction.', el: 'link.useArc', at: AT.key },
      { t: 'Sceller la requête pour cette enclave seule', d: 'Chiffrée avec sa clé (x25519). Elle va droit à la machine, sans passer par la chaîne : ni Arc, ni l’opérateur, ni ArcHive ne la lisent.', el: 'link.useRent', at: AT.request },
      { t: 'L’enclave répond en signant', d: 'Droit vers l’utilisateur, avec sa clé vérifiée par Arc. Le drone décolle : le service a agi.', el: 'use.drone', at: AT.answer },
      { t: 'Payer à l’usage en USDC', d: 'x402, réglé sur Arc, partagé selon les parts du produit.', el: 'link.useArc', at: AT.pay },
    ] },
    rent: { kicker: 'Rent a machine', title: 'Louer sa machine', actor: 'La salle des serveurs : le quai, le portique et les baies, avec l’opérateur.', steps: [
      { t: 'Du vrai matériel', d: 'Un Xeon de 4e ou 5e génération avec Intel TDX, sur bare metal ou chez un cloud TDX. Une machine sans TDX est refusée.', el: 'rent.quai', at: AT.arrive },
      { t: 'Poser une caution en USDC', d: 'OperatorBond : ce que l’opérateur risque s’il triche.', el: 'rent.operateur', at: AT.arrive },
      { t: 'Démarrage mesuré', d: 'La puce mesure l’image chargée (MRTD, RTMR) et Intel signe un quote (DCAP).', el: 'rent.portique', at: AT.quote },
      { t: 'Arc vérifie, dans le contrat', d: 'Cinq contrôles, allumés un à un sur le portique.', el: 'rent.portique', at: AT.quote + 0.3, check: true },
      { t: 'Le tampon, puis la baie', d: 'Le logo d’Arc est apposé sur la machine admise ; l’opérateur la met en baie.', el: 'rent.baies', at: AT.seal },
      { t: 'Payé à chaque usage', d: 'Le paiement se partage depuis Arc. Une machine prise à mentir perd sa caution.', el: 'link.rentArc', at: AT.pay },
    ] },
    publish: { kicker: 'Publish a service', title: 'Publier son service', actor: 'Le bureau du développeur : trois écrans de code.', steps: [
      { t: 'Écrire le manifeste', d: 'L’image, le prix, les parts.', el: 'publish.poste', at: AT.manifest },
      { t: 'Fixer l’empreinte de l’image sur Arc', d: 'ProductRegistry, WorkloadAdded : seules les enclaves qui font tourner exactement cette image pourront le servir.', el: 'link.publishArc', at: AT.publish },
      { t: 'Activation après le délai', d: 'Ouvert à tout auteur, sans relecture : le produit devient Actif une fois son délai de protection écoulé.', el: 'arc', at: AT.publish },
      { t: 'La machine fait tourner l’image', d: 'L’image publiée part vers les machines des opérateurs ; seule cette image exacte peut servir.', el: 'link.publishRent', at: 4.0 },
      { t: 'Revenus à chaque appel', d: 'La part de l’auteur revient d’Arc.', el: 'link.publishArc', at: AT.pay },
    ] },
  },
}
export const parts = () => PARTS_I[lg()]

// The five checks of the 'Arc verifies' step, ticked one by one
const CHECKS_I: Bi<{ k: string; ok: string; bad?: string }[]> = {
  en: [{ k: 'Quote', ok: 'signed by Intel' }, { k: 'Authorized fingerprint', ok: 'matches', bad: 'differs' }, { k: 'Enclave key', ok: 'bound (REPORTDATA)' }, { k: 'Anchor', ok: 'recent block, never replayed' }, { k: 'Verdict on Arc', ok: 'sealed', bad: 'refused' }],
  fr: [{ k: 'Quote', ok: 'signé par Intel' }, { k: 'Empreinte autorisée', ok: 'concorde', bad: 'diffère' }, { k: 'Clé de l’enclave', ok: 'liée (REPORTDATA)' }, { k: 'Ancrage', ok: 'bloc récent, jamais rejoué' }, { k: 'Verdict sur Arc', ok: 'scellée', bad: 'refusée' }],
}
export const checks = () => CHECKS_I[lg()]

// Hover callouts (overview only)
const FICHES_I: Bi<Record<string, Fiche>> = {
  en: {
    arc: { n: 'Arc', d: 'Arc keeps the enclave keys, checks each machine, records the authorized fingerprint and settles the payments. The sealed request does not go through it: it goes straight to the machine.' },
    'title.use': { n: 'Use a service', kv: [['Key', 'read on Arc'], ['Request', 'sealed for the enclave alone'], ['Payment', 'x402, 0.01 USDC']] },
    'use.guichet': { n: 'The user’s desk', d: 'A person or an app picks a service, seals a request for one enclave and pays per use.' },
    'use.drone': { n: 'The user’s drone', d: 'What the service does for the user. When the signed answer arrives, the drone takes off: the sealed call produced a real effect, and only this user saw the request.' },
    'title.publish': { n: 'Publish a service', kv: [['Manifest', 'image, price, shares'], ['Fingerprint', 'set on Arc'], ['Revenue', 'author’s share, per call']] },
    'publish.poste': { n: 'The developer’s desk', d: 'Three screens of code: the author writes the service, sets its image on Arc, then earns on every call.' },
    'title.rent': { n: 'Rent a machine', kv: [['Machine', 'Xeon with Intel TDX'], ['Bond', '8 USDC locked (OperatorBond)'], ['Revenue', 'operator’s share, per use']] },
    'rent.portique': { n: 'The gate', d: 'Its five lights are the five checks Arc runs on the machine’s quote. All lit, then green: admitted. Red: refused, the machine goes to the bin.' },
    'rent.baies': { n: 'The racks', kv: [['Green', 'running'], ['Orange', 'usable, not running'], ['Red', 'invalidated']] },
    'rent.quai': { n: 'The dock', d: 'Operators’ machines come in through the door and all pass under the gate.' },
    'rent.refus': { n: 'The reject bin', d: 'A machine whose fingerprint differs, whose quote is false or old, or without TDX, enters no rack.' },
    'rent.operateur': { n: 'The operator', kv: [['Brings', 'an Intel TDX machine'], ['Locks', '8 USDC bond'], ['Earns', 'a share of each use']] },
    'link.useArc': { n: 'Use and Arc', d: 'The enclave key comes down from Arc; the payment goes up, and Arc splits it between the operator and the author.' },
    'link.useRent': { n: 'Use and the machine', d: 'The sealed request goes straight to the enclave and the signed answer comes back. Nothing of it touches the chain.' },
    'link.publishRent': { n: 'Publish and the machine', d: 'The published image, the only one the machine may run to serve this product.' },
    'link.publishArc': { n: 'Publish and Arc', d: 'The authorized image fingerprint goes up to Arc; the author’s share comes back.' },
    'link.rentArc': { n: 'Rent and Arc', d: 'The machine’s quote goes up; the verdict comes back down; then the operator’s share.' },
  },
  fr: {
    arc: { n: 'Arc', d: 'Arc garde les clés des enclaves, vérifie chaque machine, inscrit l’empreinte autorisée et règle les paiements. La requête scellée n’y passe pas : elle va droit à la machine.' },
    'title.use': { n: 'Utiliser un service', kv: [['Clé', 'lue sur Arc'], ['Requête', 'scellée pour l’enclave seule'], ['Paiement', 'x402, 0.01 USDC']] },
    'use.guichet': { n: 'Le poste de l’utilisateur', d: 'Une personne ou une app choisit un service, scelle une requête pour une enclave et paie à l’usage.' },
    'use.drone': { n: 'Le drone de l’utilisateur', d: 'Ce que le service fait pour l’utilisateur. Quand la réponse signée arrive, le drone décolle : l’appel scellé a produit un effet concret, et seul cet utilisateur a vu la requête.' },
    'title.publish': { n: 'Publier un service', kv: [['Manifeste', 'image, prix, parts'], ['Empreinte', 'fixée sur Arc'], ['Revenus', 'part de l’auteur, à chaque appel']] },
    'publish.poste': { n: 'Le bureau du développeur', d: 'Trois écrans de code : l’auteur écrit le service, fixe son image sur Arc, puis gagne à chaque appel.' },
     'title.rent': { n: 'Louer une machine', kv: [['Machine', 'Xeon avec Intel TDX'], ['Caution', '8 USDC bloqués (OperatorBond)'], ['Revenus', 'part de l’opérateur, à chaque usage']] },
    'rent.portique': { n: 'Le portique', d: 'Ses cinq lumières sont les cinq contrôles qu’Arc fait sur le quote de la machine. Toutes allumées, puis vert : admise. Rouge : refusée, la machine part au bac.' },
    'rent.baies': { n: 'Les baies', kv: [['Vert', 'en marche'], ['Orange', 'utilisable, pas en marche'], ['Rouge', 'invalidée']] },
    'rent.quai': { n: 'Le quai', d: 'Les machines des opérateurs arrivent par la porte et passent toutes sous le portique.' },
    'rent.refus': { n: 'Le bac des refus', d: 'Une machine dont l’empreinte diffère, dont le quote est faux ou ancien, ou sans TDX, n’entre dans aucune baie.' },
    'rent.operateur': { n: 'L’opérateur', kv: [['Apporte', 'une machine Intel TDX'], ['Bloque', '8 USDC de caution'], ['Gagne', 'une part de chaque usage']] },
    'link.useArc': { n: 'Use et Arc', d: 'La clé de l’enclave descend d’Arc ; le paiement y monte, et Arc le partage entre l’opérateur et l’auteur.' },
    'link.useRent': { n: 'Use et la machine', d: 'La requête scellée va droit à l’enclave, la réponse signée en revient. Rien de cet échange ne touche la chaîne.' },
    'link.publishRent': { n: 'Publish et la machine', d: 'L’image publiée, la seule que la machine peut faire tourner pour servir ce produit.' },
    'link.publishArc': { n: 'Publish et Arc', d: 'L’empreinte autorisée de l’image monte à Arc ; la part de l’auteur en revient.' },
    'link.rentArc': { n: 'Rent et Arc', d: 'Le quote de la machine monte ; le verdict redescend ; puis la part de l’opérateur.' },
  },
}
export const fiche = (id: string): Fiche | undefined => FICHES_I[lg()][id]
// the callout position, hand-written for the overview camera (corner, then fallback)
export const PLACE: Record<string, [Place, Place]> = {
  arc: ['tr', 'tl'],
  'title.use': ['bl', 'tl'], 'use.guichet': ['bl', 'tl'], 'use.drone': ['bl', 'tl'], 'link.useArc': ['bl', 'tl'],
  'title.publish': ['br', 'tr'], 'publish.poste': ['br', 'tr'], 'link.publishArc': ['br', 'tr'], 'link.publishRent': ['br', 'tr'], 'link.useRent': ['bl', 'tl'],
  'title.rent': ['bl', 'br'], 'rent.portique': ['bl', 'br'], 'rent.baies': ['br', 'bl'], 'rent.quai': ['bl', 'br'], 'rent.refus': ['bl', 'br'], 'rent.operateur': ['br', 'bl'], 'link.rentArc': ['br', 'bl'],
}

// Packet names (direct label on hover) and the key
const PK_I: Bi<string[]> = {
  en: ['Sealed request', 'Signed answer', 'Fingerprint, quote, key', 'Verdict: admitted', 'Verdict: refused', 'USDC'],
  fr: ['Requête scellée', 'Réponse signée', 'Empreinte, quote, clé', 'Verdict : admise', 'Verdict : refusée', 'USDC'],
}
export const pkName = (shape: number) => PK_I[lg()][shape] ?? ''
const UI_I: Bi<Record<string, string>> = {
  en: { refus: 'Show a refusal', back: 'Overview', k0: 'Sealed request', k1: 'Signed answer', k2: 'Fingerprint, quote, key, verdict', k3: 'USDC', nogl: 'The 3D room needs WebGL. The process stays readable in the column.', choose: 'Choose your part', 'c.use': 'Call a service sealed in an enclave, pay per use in USDC.', 'c.rent': 'Bring an Intel TDX machine, pass the check, get paid per use.', 'c.publish': 'Fix the image Arc will accept, set the price, earn on every call.', 'l.use': 'Use a service', 'l.rent': 'Rent out your machine', 'l.publish': 'Publish your service' },
  fr: { refus: 'Voir un refus', back: 'Vue d’ensemble', k0: 'Requête scellée', k1: 'Réponse signée', k2: 'Empreinte, quote, clé, verdict', k3: 'USDC', nogl: 'La salle en 3D demande WebGL. Le processus reste lisible dans la colonne.', choose: 'Choisir sa partie', 'c.use': 'Appeler un service scellé dans une enclave, payer à l’usage en USDC.', 'c.rent': 'Apporter une machine Intel TDX, passer la vérification, être payé à l’usage.', 'c.publish': 'Fixer l’image qu’Arc acceptera, le prix, et gagner à chaque appel.', 'l.use': 'Utiliser un service', 'l.rent': 'Louer sa machine', 'l.publish': 'Publier son service' },
}
export const ui = (k: string) => UI_I[lg()][k] ?? k
export const ISLAND_OF = (id: string): Part | null => (id.startsWith('title.') ? (id.slice(6) as Part) : id.startsWith('use.') ? 'use' : id.startsWith('rent.') ? 'rent' : id.startsWith('publish.') ? 'publish' : null)
