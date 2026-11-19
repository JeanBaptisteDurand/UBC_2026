// The parts of the 3D demo ('How ArcHive works', network.html?focus=demo), in the order it plays them. A light module
// (no three.js, no replay data): the assistant reads the ids and titles from here to open the demo at a part.
//   - by the address: network.html?focus=demo&part=request
//   - on the Network page: dispatchEvent(new CustomEvent('archive:demo', { detail: { part: 'request' } }))
//     (or window.__s3d.demoPart('request') once the 3D room is ready); { action: 'play' | 'pause' | 'next' | 'prev' }
//     drives the open player, { action: 'goto', step: 1 to 7 } opens the part by its number
//   - the player tells each new part: window 'archive:demo-part' { part, beat }, and .s3d .dm[data-part]
// Each part starts at a beat of the demo (BEATS in demo-strings.ts); the texts say what happens and why it matters.
type Bi = { en: string; fr: string }

export const DEMO_PART_IDS = ['publish', 'enclave', 'verify', 'request', 'answer', 'payment', 'verdict'] as const
export type DemoPartId = (typeof DEMO_PART_IDS)[number]
export const isDemoPart = (v: unknown): v is DemoPartId => typeof v === 'string' && (DEMO_PART_IDS as readonly string[]).includes(v)

export interface DemoPart { id: DemoPartId; beat: number; title: Bi; why: Bi }
export const DEMO_PARTS: DemoPart[] = [
  { id: 'publish', beat: 0, title: { en: 'The service', fr: 'Le service' },
    why: { en: 'An author pins on Arc the exact image allowed to run the service, its price and its shares. No one can swap the code later without Arc seeing it.', fr: 'Un auteur inscrit sur Arc l’image exacte autorisée à faire tourner le service, son prix et ses parts. Personne ne peut changer le code ensuite sans qu’Arc le voie.' } },
  { id: 'enclave', beat: 5, title: { en: 'The enclave', fr: 'L’enclave' },
    why: { en: 'An Intel TDX enclave: its memory is encrypted, even the machine’s owner cannot read it. The operator puts a USDC bond at stake.', fr: 'Une enclave Intel TDX : sa mémoire est chiffrée, même le propriétaire de la machine ne la lit pas. L’opérateur met une caution en USDC en jeu.' } },
  { id: 'verify', beat: 9, title: { en: 'Arc verifies it', fr: 'Arc la vérifie' },
    why: { en: 'Arc checks Intel’s signature on chain and the image byte for byte. One byte changed and the machine is refused: no trusted middleman.', fr: 'Arc vérifie la signature d’Intel sur la chaîne et l’image octet pour octet. Un octet changé, et la machine est refusée : aucun intermédiaire de confiance.' } },
  { id: 'request', beat: 12, title: { en: 'The request', fr: 'La requête' },
    why: { en: 'The request is sealed in the browser for that enclave alone and goes straight to it. No server, no operator, no chain can read it.', fr: 'La requête est scellée dans le navigateur pour cette enclave seule et va droit à elle. Ni serveur, ni opérateur, ni chaîne ne peut la lire.' } },
  { id: 'answer', beat: 17, title: { en: 'The signed answer', fr: 'La réponse signée' },
    why: { en: 'The enclave signs its answer. The page checks the signature against the key Arc admitted: the answer came from the verified machine.', fr: 'L’enclave signe sa réponse. La page vérifie la signature avec la clé admise par Arc : la réponse vient bien de la machine vérifiée.' } },
  { id: 'payment', beat: 20, title: { en: 'The payment', fr: 'Le paiement' },
    why: { en: 'One USDC signature pays the exact price, only for an answer the enclave signed. Arc splits it on chain: operator, author, network.', fr: 'Une signature en USDC paie le prix exact, seulement pour une réponse signée par l’enclave. Arc le partage sur la chaîne : opérateur, auteur, réseau.' } },
  { id: 'verdict', beat: 22, title: { en: 'The verdict', fr: 'Le verdict' },
    why: { en: 'Sessions and bounties end with a public verdict on Arc (ERC-8004): 100 = verified and paid, 0 = proven fault, the bond seized. Reputation no one can fake.', fr: 'Les sessions et les primes se terminent par un verdict public sur Arc (ERC-8004) : 100 = vérifié et payé, 0 = faute prouvée, la caution saisie. Une réputation que personne ne peut truquer.' } },
]

/** The part a beat belongs to (the last part starting at or before it). */
export const partOfBeat = (i: number): DemoPart => { let p = DEMO_PARTS[0]; for (const q of DEMO_PARTS) if (q.beat <= i) p = q; return p }
