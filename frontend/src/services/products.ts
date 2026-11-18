// JB's product presentation (produits/product2.html, 18/11), per product id: the copy, the glyph and the audience.
// Text only: the state, price and enclaves shown next to it are read live (app/catalog.ts). Recorded proofs are real
// Arc testnet transactions of 9 to 11 Nov.
export interface PCopy { name: string; line: string; price: string; who: string; note: string; pts: string[]; proof: [string, string] | null; cta: [string, string] | null }
export const GLYPH: Record<string, string> = {
 "1": "<svg class=\"sv-g\" viewBox=\"0 0 120 64\" aria-hidden=\"true\" focusable=\"false\"><g class=\"g-seal g-arc\"><rect class=\"g-box\" x=\"8\" y=\"8\" width=\"48\" height=\"48\"></rect><path class=\"g-halo\" d=\"M8 14V8H14M50 8H56V14M56 50V56H50M14 56H8V50\"></path><path class=\"g-cor\" d=\"M8 14V8H14M50 8H56V14M56 50V56H50M14 56H8V50\"></path></g><g transform=\"translate(32 30)\" class=\"g-ink\"><path d=\"M-12 -9H12V6H-1L-7 11V6H-12Z\"></path><path class=\"g-thin\" d=\"M-7.5 -3.5H7.5M-7.5 1H2.5\"></path></g><path class=\"g-ink g-dash\" d=\"M56 32H80\"></path><rect class=\"g-ink\" x=\"84\" y=\"12\" width=\"14\" height=\"40\"></rect><rect class=\"g-solid\" x=\"87\" y=\"33\" width=\"8\" height=\"16\"></rect><path class=\"g-ink g-thin g-dim\" d=\"M101 16H105M101 24H105M101 32H105M101 40H105M101 48H105\"></path></svg>",
 "2": "<svg class=\"sv-g\" viewBox=\"0 0 120 64\" aria-hidden=\"true\" focusable=\"false\"><g class=\"g-seal g-arc\"><rect class=\"g-box\" x=\"8\" y=\"8\" width=\"48\" height=\"48\"></rect><path class=\"g-halo\" d=\"M8 14V8H14M50 8H56V14M56 50V56H50M14 56H8V50\"></path><path class=\"g-cor\" d=\"M8 14V8H14M50 8H56V14M56 50V56H50M14 56H8V50\"></path></g><g transform=\"translate(32 33)\" class=\"g-ink\"><ellipse cx=\"0\" cy=\"3\" rx=\"6\" ry=\"8.5\"></ellipse><circle cx=\"0\" cy=\"-8\" r=\"3\"></circle><path d=\"M-1.5 -10.5L-4.5 -14.5M1.5 -10.5L4.5 -14.5M0 -2V11.5\"></path><path d=\"M-6 -1L-10.5 -4.5M-6 3.5H-11M-5.5 8L-10 11.5M6 -1L10.5 -4.5M6 3.5H11M5.5 8L10 11.5\"></path></g><path class=\"g-ink g-thin\" d=\"M56 32H80\"></path><path transform=\"translate(68 23)\" class=\"g-arcl\" d=\"M-5 0L-1.5 3.5L5.5 -4\"></path><g transform=\"translate(94 32)\" class=\"g-ink\"><circle r=\"10\"></circle><circle class=\"g-thin g-dim\" r=\"6.2\"></circle></g></svg>",
 "3": "<svg class=\"sv-g\" viewBox=\"0 0 120 64\" aria-hidden=\"true\" focusable=\"false\"><g transform=\"translate(20 32)\" class=\"g-ink\"><rect x=\"-14\" y=\"-12\" width=\"28\" height=\"24\"></rect><path class=\"g-thin\" d=\"M-14 -6H14\"></path><path d=\"M-9 -1L-5.5 2.5L-9 6M-2 7H5\"></path></g><path class=\"g-ink g-dash\" d=\"M34 32H50M66 32H82\"></path><g transform=\"translate(58 32) scale(0.72)\" class=\"g-ink\"><circle r=\"10\"></circle><circle class=\"g-thin g-dim\" r=\"6.2\"></circle></g><g class=\"g-seal g-arc\"><rect class=\"g-box\" x=\"84\" y=\"12\" width=\"30\" height=\"40\"></rect><path class=\"g-halo\" d=\"M84 17V12H89M109 12H114V17M114 47V52H109M89 52H84V47\"></path><path class=\"g-cor\" d=\"M84 17V12H89M109 12H114V17M114 47V52H109M89 52H84V47\"></path></g><g transform=\"translate(99 31) scale(0.66)\" class=\"g-ink\"><path d=\"M-12 -9H12V6H-1L-7 11V6H-12Z\"></path><path class=\"g-thin\" d=\"M-7.5 -3.5H7.5M-7.5 1H2.5\"></path></g></svg>",
 "4": "<svg class=\"sv-g\" viewBox=\"0 0 120 64\" aria-hidden=\"true\" focusable=\"false\"><g transform=\"translate(22 32)\" class=\"g-ink\"><circle cx=\"-9\" cy=\"0\" r=\"5\"></circle><path d=\"M-4 0H15M9 0V4M13 0V3.5\"></path></g><path class=\"g-ink g-dash\" d=\"M38 32H50\"></path><g class=\"g-seal g-arc\"><rect class=\"g-box\" x=\"52\" y=\"8\" width=\"58\" height=\"48\"></rect><path class=\"g-halo\" d=\"M52 14V8H58M104 8H110V14M110 50V56H104M58 56H52V50\"></path><path class=\"g-cor\" d=\"M52 14V8H58M104 8H110V14M110 50V56H104M58 56H52V50\"></path></g><g transform=\"translate(72 23) scale(0.8)\" class=\"g-ink\"><path d=\"M-12 -9H12V6H-1L-7 11V6H-12Z\"></path><path class=\"g-thin\" d=\"M-7.5 -3.5H7.5M-7.5 1H2.5\"></path></g><g transform=\"translate(90 40) scale(0.8)\" class=\"g-arcl\"><path d=\"M-12 -9H12V6H7V11L1 6H-12Z\"></path><path class=\"g-thin\" d=\"M-7.5 -3.5H7.5M-7.5 1H2.5\"></path></g></svg>",
 "5": "<svg class=\"sv-g\" viewBox=\"0 0 120 64\" aria-hidden=\"true\" focusable=\"false\"><g class=\"g-seal g-arc\"><rect class=\"g-box\" x=\"6\" y=\"8\" width=\"28\" height=\"28\"></rect><path class=\"g-halo\" d=\"M6 13V8H11M29 8H34V13M34 31V36H29M11 36H6V31\"></path><path class=\"g-cor\" d=\"M6 13V8H11M29 8H34V13M34 31V36H29M11 36H6V31\"></path></g><path transform=\"translate(20 22) scale(0.95)\" class=\"g-arcl\" d=\"M-5 0L-1.5 3.5L5.5 -4\"></path><g class=\"g-seal g-red\"><rect class=\"g-box\" x=\"46\" y=\"8\" width=\"28\" height=\"28\"></rect><path class=\"g-halo\" d=\"M46 13V8H51M69 8H74V13M74 31V36H69M51 36H46V31\"></path><path class=\"g-cor\" d=\"M46 13V8H51M69 8H74V13M74 31V36H69M51 36H46V31\"></path></g><path class=\"g-red\" d=\"M54.5 16.5L65.5 27.5M65.5 16.5L54.5 27.5\"></path><g class=\"g-seal g-arc\"><rect class=\"g-box\" x=\"86\" y=\"8\" width=\"28\" height=\"28\"></rect><path class=\"g-halo\" d=\"M86 13V8H91M109 8H114V13M114 31V36H109M91 36H86V31\"></path><path class=\"g-cor\" d=\"M86 13V8H91M109 8H114V13M114 31V36H109M91 36H86V31\"></path></g><path transform=\"translate(100 22) scale(0.95)\" class=\"g-arcl\" d=\"M-5 0L-1.5 3.5L5.5 -4\"></path><path class=\"g-ink g-thin g-dash\" d=\"M34 22H46M74 22H86\"></path><g transform=\"translate(60 51) scale(0.64)\" class=\"g-ink\"><circle r=\"10\"></circle><circle class=\"g-thin g-dim\" r=\"6.2\"></circle></g><path class=\"g-red g-thin\" d=\"M52 59L68 43\"></path></svg>",
 "6": "<svg class=\"sv-g\" viewBox=\"0 0 120 64\" aria-hidden=\"true\" focusable=\"false\"><g transform=\"translate(34 32)\" class=\"g-off-ink\"><rect x=\"-16\" y=\"-16\" width=\"32\" height=\"32\"></rect><path class=\"g-thin\" d=\"M-8 -16V-21M0 -16V-21M8 -16V-21M-8 16V21M0 16V21M8 16V21M-16 -8H-21M-16 0H-21M-16 8H-21M16 -8H21M16 0H21M16 8H21\"></path></g><g transform=\"translate(34 33) scale(0.62)\" class=\"g-off-ink\"><ellipse cx=\"0\" cy=\"3\" rx=\"6\" ry=\"8.5\"></ellipse><circle cx=\"0\" cy=\"-8\" r=\"3\"></circle><path d=\"M-1.5 -10.5L-4.5 -14.5M1.5 -10.5L4.5 -14.5M0 -2V11.5\"></path><path d=\"M-6 -1L-10.5 -4.5M-6 3.5H-11M-5.5 8L-10 11.5M6 -1L10.5 -4.5M6 3.5H11M5.5 8L10 11.5\"></path></g><path class=\"g-off-ink\" d=\"M10 58L58 6\"></path><path class=\"g-ink g-thin g-dim g-dash\" d=\"M62 32H82\"></path><g class=\"g-seal g-arc\"><rect class=\"g-box\" x=\"84\" y=\"18\" width=\"28\" height=\"28\"></rect><path class=\"g-halo\" d=\"M84 23V18H89M107 18H112V23M112 41V46H107M89 46H84V41\"></path><path class=\"g-cor\" d=\"M84 23V18H89M107 18H112V23M112 41V46H107M89 46H84V41\"></path></g></svg>",
 "7": "<svg class=\"sv-g\" viewBox=\"0 0 120 64\" aria-hidden=\"true\" focusable=\"false\"><g class=\"g-seal g-arc\"><rect class=\"g-box\" x=\"4\" y=\"4\" width=\"56\" height=\"56\"></rect><path class=\"g-halo\" d=\"M4 11V4H11M53 4H60V11M60 53V60H53M11 60H4V53\"></path><path class=\"g-cor\" d=\"M4 11V4H11M53 4H60V11M60 53V60H53M11 60H4V53\"></path></g><g transform=\"translate(32 32)\" class=\"g-ink\"><rect x=\"-16\" y=\"-16\" width=\"32\" height=\"32\"></rect><path class=\"g-thin\" d=\"M-8 -16V-21M0 -16V-21M8 -16V-21M-8 16V21M0 16V21M8 16V21M-16 -8H-21M-16 0H-21M-16 8H-21M16 -8H21M16 0H21M16 8H21\"></path></g><g transform=\"translate(32 33) scale(0.62)\" class=\"g-ink\"><ellipse cx=\"0\" cy=\"3\" rx=\"6\" ry=\"8.5\"></ellipse><circle cx=\"0\" cy=\"-8\" r=\"3\"></circle><path d=\"M-1.5 -10.5L-4.5 -14.5M1.5 -10.5L4.5 -14.5M0 -2V11.5\"></path><path d=\"M-6 -1L-10.5 -4.5M-6 3.5H-11M-5.5 8L-10 11.5M6 -1L10.5 -4.5M6 3.5H11M5.5 8L10 11.5\"></path></g><path class=\"g-ink g-thin\" d=\"M60 32H80\"></path><path transform=\"translate(70 23)\" class=\"g-arcl\" d=\"M-5 0L-1.5 3.5L5.5 -4\"></path><g transform=\"translate(94 32)\" class=\"g-ink\"><circle r=\"10\"></circle><circle class=\"g-thin g-dim\" r=\"6.2\"></circle></g></svg>"
}
export const SLOT_GLYPH = "<svg class=\"sv-g\" viewBox=\"0 0 120 64\" aria-hidden=\"true\" focusable=\"false\"><g class=\"g-seal g-off\"><rect class=\"g-box\" x=\"36\" y=\"8\" width=\"48\" height=\"48\"></rect><path class=\"g-halo\" d=\"M36 14V8H42M78 8H84V14M84 50V56H78M42 56H36V50\"></path><path class=\"g-cor\" d=\"M36 14V8H42M78 8H84V14M84 50V56H78M42 56H36V50\"></path></g><path class=\"g-ink g-dim\" d=\"M60 23V41M51 32H69\"></path></svg>"
export type Cat = 'apps' | 'agents' | 'defi'
export const CAT: Record<string, Cat> = {"1": "apps", "2": "defi", "3": "agents", "4": "apps", "5": "defi", "6": "defi", "7": "defi"}
export const COPY: Record<'en' | 'fr', Record<string, PCopy>> = {
 "en": {
  "1": {
   "name": "Private AI session",
   "line": "Your prompt stays sealed, even from the operator. Prepaid, per token.",
   "price": "0.0001 USDC per token",
   "who": "AI apps",
   "note": "",
   "pts": [
    "Your question is sealed for one machine Arc verified.",
    "Neither its operator nor ArcHive can read it.",
    "Each answer comes back with a receipt the machine signed.",
    "You prepay in USDC and get back what you did not use.",
    "A testnet demo price, set high on purpose."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0x9430e16a5cff9bd099c0a7a5f2b11dc87e4c11ad6444a0cd9c87f71ee72f1bb4",
    "Three answers paid on Arc, 9 Nov"
   ],
   "cta": [
    "demo",
    "Watch the replayed demo"
   ]
  },
  "2": {
   "name": "Sealed Bounty",
   "line": "A bug bounty that pays only a proven exploit.",
   "price": "Paid by your pool",
   "who": "DeFi protocols",
   "note": "",
   "pts": [
    "The hunter seals the exploit for a machine Arc verified.",
    "The machine replays it on a copy of Arc.",
    "A real loss is paid within seconds, with no human triage.",
    "The report reaches you alone, in the payout transaction.",
    "Cost: the tier, plus 10% network and 5% operators."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0xecbd089a092edd939ff646fae8d22c0f2616b6a92f58a49928c231c770bb807e",
    "Paid and delivered in one transaction, 9 Nov"
   ],
   "cta": [
    "bounty",
    "Post a bounty"
   ]
  },
  "3": {
   "name": "Private AI per call",
   "line": "One signature pays one call. No account, no deposit.",
   "price": "0.01 USDC per call",
   "who": "AI agents",
   "note": "",
   "pts": [
    "Pay per request, x402 style, through the ArcHive SDK.",
    "The question is sealed for a machine Arc verified.",
    "Payment settles only against a receipt that machine signed.",
    "Each signature covers one call and cannot be reused.",
    "Settled on Arc about 20 seconds after the answer."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0xa41f1276a9f0b0af98d1991ae1ab06e5f1afb3d9bed71bca486ccea7255c15d9",
    "A paid call from the browser, 9 Nov"
   ],
   "cta": [
    "demo",
    "Watch the replayed demo"
   ]
  },
  "4": {
   "name": "Attested Copilot",
   "line": "An AI assistant you can verify, in its own sealed machine.",
   "price": "Free",
   "who": "App users",
   "note": "Paused. The site copilot, not sealed, answers meanwhile.",
   "pts": [
    "Your browser checks its key on Arc.",
    "Then it encrypts the conversation for that machine only.",
    "Our web server only relays ciphertext.",
    "New instructions mean a new fingerprint, registered on Arc.",
    "It explains and prepares, it never signs for you."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0xad8b9780689513b1f68b8aba1a99f1b3156b4038a86aff46cad5ff96e294005e",
    "Its machine admitted on Arc, 10 Nov"
   ],
   "cta": [
    "copilot",
    "Ask the site copilot"
   ]
  },
  "5": {
   "name": "Cheating costs",
   "line": "A machine built to lie was caught and lost its bond.",
   "price": "Bond of 1.00 USDC seized",
   "who": "Protocols, insurers",
   "note": "A demo, done on 10 Nov and readable on Arc.",
   "pts": [
    "We built one machine to inflate a loss, on purpose.",
    "It claimed double the real loss, and Arc accepted it.",
    "Two other operators replayed it and found the real loss.",
    "16 seconds later, its whole bond was seized, its operator banned.",
    "Nothing was paid out. The record stays on Arc."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0x0ffca5433186735bf5525e525995f3589d842681da8ffcaa82acb5993025051f",
    "The bond seized on Arc, 10 Nov"
   ],
   "cta": [
    "hive",
    "See the liar in the Hive"
   ]
  },
  "6": {
   "name": "First verified bounty",
   "line": "Our own review found a flaw. Switched off, then replaced.",
   "price": "Never paid out",
   "who": "",
   "note": "Retired on 11 Nov, replaced by #7.",
   "pts": [
    "On 11 Nov, our own security review found a flaw.",
    "A forged certificate field could fake a chip’s identity.",
    "Fixed, then attacked again in three reviews: no new flaw.",
    "It never paid anything. No machine can serve it now.",
    "Product #7 replaces it, with the fixed chip check."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0x190d464ee073cb9582c303c291c120aa53c48f9b00b127a1487c0dd08484b4cb",
    "Switched off on Arc, 11 Nov"
   ],
   "cta": [
    "p7",
    "See #7, its replacement"
   ]
  },
  "7": {
   "name": "Sealed Bounty, verified",
   "line": "The same bounty, on identified chips in inspected datacenters.",
   "price": "Paid by your pool",
   "who": "High-stakes DeFi",
   "note": "Paused. Payouts can open from 18 Nov, 23:00 UTC.",
   "pts": [
    "Arc reads the chip’s identity in Intel’s own certificate.",
    "The Proof of Cloud alliance declares the chip, signature checked on Arc.",
    "Only machines that pass both can sign a claim.",
    "An 8-day safety delay comes before any payout.",
    "Then the same flow as the Sealed Bounty: replay, payout, refutation."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0xd6928088d90f8bbc2585d04564c4a574312593f3f19792a1cdbf819437bb5f4f",
    "Chip identity read on Arc, 11 Nov"
   ],
   "cta": [
    "bounty",
    "Post a bounty"
   ]
  }
 },
 "fr": {
  "1": {
   "name": "Session d’IA privée",
   "line": "Votre requête reste scellée, même pour l’opérateur. Prépayée, au jeton.",
   "price": "0,0001 USDC le jeton",
   "who": "Apps d’IA",
   "note": "",
   "pts": [
    "Votre question est scellée pour une machine vérifiée par Arc.",
    "Ni son opérateur ni ArcHive ne peuvent la lire.",
    "Chaque réponse revient avec un reçu signé par la machine.",
    "Vous prépayez en USDC et récupérez ce que vous n’avez pas utilisé.",
    "Un prix de démo du testnet, élevé exprès."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0x9430e16a5cff9bd099c0a7a5f2b11dc87e4c11ad6444a0cd9c87f71ee72f1bb4",
    "Trois réponses payées sur Arc, 9 nov."
   ],
   "cta": [
    "demo",
    "Voir la démo rejouée"
   ]
  },
  "2": {
   "name": "Prime scellée",
   "line": "Une prime de bug qui ne paie qu’un exploit prouvé.",
   "price": "Payé par votre réserve",
   "who": "Protocoles DeFi",
   "note": "",
   "pts": [
    "Le chasseur scelle l’exploit pour une machine vérifiée par Arc.",
    "La machine le rejoue sur une copie d’Arc.",
    "Une perte réelle est payée en quelques secondes, sans tri humain.",
    "Le rapport n’arrive qu’à vous, dans la transaction du paiement.",
    "Coût : le palier, plus 10 % au réseau et 5 % aux opérateurs."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0xecbd089a092edd939ff646fae8d22c0f2616b6a92f58a49928c231c770bb807e",
    "Payée et livrée en une transaction, 9 nov."
   ],
   "cta": [
    "bounty",
    "Publier une prime"
   ]
  },
  "3": {
   "name": "IA privée à l’appel",
   "line": "Une signature paie un appel, sans compte ni dépôt.",
   "price": "0,01 USDC l’appel",
   "who": "Agents d’IA",
   "note": "",
   "pts": [
    "Paiement à la requête, façon x402, via le SDK d’ArcHive.",
    "La question est scellée pour une machine vérifiée par Arc.",
    "Paiement réglé seulement contre un reçu signé par cette machine.",
    "Chaque signature couvre un seul appel et ne peut pas resservir.",
    "Réglé sur Arc environ 20 secondes après la réponse."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0xa41f1276a9f0b0af98d1991ae1ab06e5f1afb3d9bed71bca486ccea7255c15d9",
    "Un appel payé depuis le navigateur, 9 nov."
   ],
   "cta": [
    "demo",
    "Voir la démo rejouée"
   ]
  },
  "4": {
   "name": "Copilote attesté",
   "line": "Un assistant d’IA vérifiable, dans sa propre machine scellée.",
   "price": "Gratuit",
   "who": "Utilisateurs d’apps",
   "note": "En pause. Le copilote du site, non scellé, répond en attendant.",
   "pts": [
    "Votre navigateur vérifie sa clé sur Arc.",
    "Puis il chiffre la conversation pour cette seule machine.",
    "Notre serveur web ne relaie que du chiffré.",
    "Changer ses consignes change son empreinte, inscrite sur Arc.",
    "Il explique et prépare, il ne signe jamais à votre place."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0xad8b9780689513b1f68b8aba1a99f1b3156b4038a86aff46cad5ff96e294005e",
    "Sa machine admise sur Arc, 10 nov."
   ],
   "cta": [
    "copilot",
    "Demander au copilote du site"
   ]
  },
  "5": {
   "name": "Tricher coûte",
   "line": "Une machine conçue pour mentir a été prise : caution perdue.",
   "price": "Caution de 1,00 USDC saisie",
   "who": "Protocoles, assureurs",
   "note": "Une démo, faite le 10 nov., lisible sur Arc.",
   "pts": [
    "Nous avons conçu une machine pour gonfler une perte, exprès.",
    "Elle a réclamé le double de la perte réelle. Arc a accepté.",
    "Deux autres opérateurs l’ont rejoué et ont trouvé la vraie perte.",
    "16 secondes plus tard : caution saisie, opérateur radié.",
    "Rien n’a été versé. La trace reste sur Arc."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0x0ffca5433186735bf5525e525995f3589d842681da8ffcaa82acb5993025051f",
    "La caution saisie sur Arc, 10 nov."
   ],
   "cta": [
    "hive",
    "Voir la menteuse dans la Hive"
   ]
  },
  "6": {
   "name": "Première prime vérifiée",
   "line": "Notre propre revue y a trouvé une faille : coupée, puis remplacée.",
   "price": "Aucun paiement versé",
   "who": "",
   "note": "Retirée le 11 nov., remplacée par le n° 7.",
   "pts": [
    "Le 11 nov., notre revue de sécurité y a trouvé une faille.",
    "Un champ de certificat forgé pouvait usurper l’identité d’une puce.",
    "Corrigée, puis réattaquée lors de trois revues : aucune nouvelle faille.",
    "Elle n’a jamais rien payé. Aucune machine ne peut plus la servir.",
    "Le produit n° 7 la remplace, avec la lecture de puce corrigée."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0x190d464ee073cb9582c303c291c120aa53c48f9b00b127a1487c0dd08484b4cb",
    "Coupée sur Arc, 11 nov."
   ],
   "cta": [
    "p7",
    "Voir le n°&nbsp;7, qui la remplace"
   ]
  },
  "7": {
   "name": "Prime scellée vérifiée",
   "line": "La même prime, sur des puces identifiées, en datacenter inspecté.",
   "price": "Payé par votre réserve",
   "who": "DeFi à gros enjeux",
   "note": "En pause. Paiements possibles dès le 18 nov., 23 h UTC.",
   "pts": [
    "Arc lit l’identité de la puce dans le certificat d’Intel.",
    "L’alliance Proof of Cloud déclare la puce, signature vérifiée sur Arc.",
    "Seules les machines qui passent les deux peuvent signer.",
    "Un délai de sécurité de 8 jours précède tout paiement.",
    "Ensuite, le même parcours que la Prime scellée : rejeu, paiement, réfutation."
   ],
   "proof": [
    "https://explorer.testnet.arc.io/tx/0xd6928088d90f8bbc2585d04564c4a574312593f3f19792a1cdbf819437bb5f4f",
    "Identité de la puce lue sur Arc, 11 nov."
   ],
   "cta": [
    "bounty",
    "Publier une prime"
   ]
  }
 }
}
