// Doc page strings (EN, FR). The chapters themselves come from content.ts (the technology page); here only what the
// doc page adds around them, and the sentences whose numbers are read live.
import { useLang } from '../i18n'

const EN = {
  'doc.title': 'ArcHive. Doc',
  'doc.sec': 'Doc',
  'doc.skip': 'Skip to the chapters',
  'doc.h.a': 'Arc is ', 'doc.h.b': 'the notary', 'doc.h.c': '.',
  'doc.index': 'Chapters',
  'doc.open': 'Open',
  'doc.back': 'Back to the start',
  'doc.close': 'Close',
  'doc.prev': 'Previous chapter',
  'doc.next': 'Next chapter',
  'doc.of': '{a} of {b}',
  'doc.start': 'Start reading',
  // live sentences (contract counts are deployment facts; enclaves and verdicts are read live)
  'doc.verdict': '13 of our contracts in service on Arc testnet, 51 deployed in all with Intel’s verifier. {e} enclaves admitted so far, {v} verdicts written.',
  'doc.verdict.r': '13 of our contracts in service on Arc testnet, 51 deployed in all with Intel’s verifier.',
  'doc.readAt': 'Arc testnet, read at block {b}',
  'doc.reading': 'Reading Arc testnet',
  'doc.st.off': 'No enclave running right now (0 of {n}). Everything on Arc stays readable, and every proof on this page is a real past transaction.',
  'doc.st.on': '{a} of {n} enclaves running now. Every proof on this page is a real past transaction.',
  // chapter 10, "On Arc now", read from /api/stats
  'doc.n.products': 'products published',
  'doc.n.enclaves': 'enclaves admitted, {a} running',
  'doc.n.settled': 'settled for compute',
  'doc.n.x402': 'paid x402 calls',
  'doc.n.sessions': 'prepaid sessions',
  'doc.n.session1': 'prepaid session',
  'doc.n.verdicts': 'ERC-8004 verdicts',
  'doc.n.bounty': 'paid on a proven exploit',
  'doc.n.seized': 'seized from a lying operator, 10 Nov',
  'doc.n.down': 'The live counters cannot be read right now.',
  // chapter 09, the code of each contract read on Arc
  'doc.code.b': 'Read every address on Arc now',
  'doc.code.doing': 'Reading {a} of {b}',
  'doc.code.done': '{a} of {b} addresses carry code on Arc, read at block {k}.',
  'doc.code.err': 'Arc could not be read. Try again.',
  'doc.code.bytes': '{n} bytes',
  'doc.code.none': 'no code',
  // chapter 04, the two status lines, read live (/api/levels for the chip, Arc for product 7)
  'doc.poc.on': 'Our machine’s chip ({chip}…) is declared on Arc by the Proof of Cloud alliance: renewed on {a}, valid until {b}. A running machine renews it every week.',
  'doc.poc.off': 'Our machine’s chip ({chip}…) was declared on Arc by the Proof of Cloud alliance until {b}: a running machine renews it every week, and none has since.',
  'doc.p7.on': 'Product 7 has been authorized to pay on Arc since 18 November at 23:00 UTC, after the 8-day safety delay.',
  'doc.p7.wait': 'Product 7 can pay once its settlement contract is authorized on Arc, after the 8-day safety delay.',
  'doc.p7.open': 'A {a} demo bounty is open until {t}.',
  'doc.p7.none': 'No bounty is open on it right now.',
}
type K = keyof typeof EN
const FR: Record<K, string> = {
  'doc.title': 'ArcHive. Doc',
  'doc.sec': 'Doc',
  'doc.skip': 'Aller aux chapitres',
  'doc.h.a': 'Arc est ', 'doc.h.b': 'le notaire', 'doc.h.c': '.',
  'doc.index': 'Chapitres',
  'doc.open': 'Ouvrir',
  'doc.back': 'Retour au début',
  'doc.close': 'Fermer',
  'doc.prev': 'Chapitre précédent',
  'doc.next': 'Chapitre suivant',
  'doc.of': '{a} sur {b}',
  'doc.start': 'Commencer la lecture',
  'doc.verdict': '13 de nos contrats en service sur Arc testnet, 51 déployés en tout avec le vérificateur d’Intel. {e} enclaves admises à ce jour, {v} verdicts écrits.',
  'doc.verdict.r': '13 de nos contrats en service sur Arc testnet, 51 déployés en tout avec le vérificateur d’Intel.',
  'doc.readAt': 'Arc testnet, lu au bloc {b}',
  'doc.reading': 'Lecture d’Arc testnet',
  'doc.st.off': 'Aucune enclave en marche pour le moment (0 sur {n}). Tout ce qui est sur Arc reste lisible, et chaque preuve de cette page est une vraie transaction passée.',
  'doc.st.on': '{a} enclaves sur {n} en marche en ce moment. Chaque preuve de cette page est une vraie transaction passée.',
  'doc.n.products': 'produits publiés',
  'doc.n.enclaves': 'enclaves admises, {a} en marche',
  'doc.n.settled': 'réglés pour du calcul',
  'doc.n.x402': 'appels x402 payés',
  'doc.n.sessions': 'sessions prépayées',
  'doc.n.session1': 'session prépayée',
  'doc.n.verdicts': 'verdicts ERC-8004',
  'doc.n.bounty': 'payés sur un exploit prouvé',
  'doc.n.seized': 'saisis à un opérateur menteur, 10 nov.',
  'doc.n.down': 'Les compteurs en direct ne peuvent pas être lus pour le moment.',
  'doc.code.b': 'Lire chaque adresse sur Arc maintenant',
  'doc.code.doing': 'Lecture {a} sur {b}',
  'doc.code.done': '{a} adresses sur {b} portent du code sur Arc, lu au bloc {k}.',
  'doc.code.err': 'Arc n’a pas pu être lu. Réessayez.',
  'doc.code.bytes': '{n} octets',
  'doc.code.none': 'aucun code',
  'doc.poc.on': 'La puce de notre machine ({chip}…) est déclarée sur Arc par l’alliance Proof of Cloud : renouvelée le {a}, valable jusqu’au {b}. Une machine en marche la renouvelle chaque semaine.',
  'doc.poc.off': 'La puce de notre machine ({chip}…) a été déclarée sur Arc par l’alliance Proof of Cloud jusqu’au {b} : une machine en marche la renouvelle chaque semaine, et aucune ne l’a fait depuis.',
  'doc.p7.on': 'Le produit 7 est autorisé à payer sur Arc depuis le 18 novembre à 23:00 UTC, après le délai de sécurité de 8 jours.',
  'doc.p7.wait': 'Le produit 7 pourra payer une fois son contrat de règlement autorisé sur Arc, après le délai de sécurité de 8 jours.',
  'doc.p7.open': 'Une prime de démo de {a} est ouverte jusqu’au {t}.',
  'doc.p7.none': 'Aucune prime n’y est ouverte en ce moment.',
}

export function useDt() {
  const lang = useLang()
  const S = lang === 'fr' ? FR : EN
  return { lang, d: (k: K, v?: Record<string, string | number>) => S[k].replace(/\{(\w+)\}/g, (_, x) => String(v?.[x] ?? '')) }
}
