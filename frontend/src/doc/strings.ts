// Doc page strings, in English (the site is English only). The chapters themselves come from content.ts (the
// technology chapters); here only what the doc page adds around them, and the sentences whose numbers are read live.
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
  'doc.verdict': '13 of our contracts in service on Arc testnet, 51 deployed with Intel’s verifier through the live stack, plus the 14 of the next stack (v3). {e} enclaves admitted so far, {v} verdicts written.',
  'doc.verdict.r': '13 of our contracts in service on Arc testnet, 51 deployed with Intel’s verifier through the live stack, plus the 14 of the next stack (v3).',
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
  'doc.n.seized': 'seized from a lying operator, 15 Nov',
  'doc.n.down': 'The live counters cannot be read right now.',
  // chapter 09, the code of each contract read on Arc
  'doc.code.b': 'Read every address on Arc now',
  'doc.code.doing': 'Reading {a} of {b}',
  'doc.code.done': '{a} of {b} addresses carry code on Arc, read at block {k}.',
  'doc.code.err': 'Arc could not be read. Try again.',
  'doc.code.bytes': '{n} bytes',
  'doc.code.none': 'no code',
  // chapter 04, the two status lines, read live (/api/levels for the chip, Arc for the verified level's product: 5 on
  // v3; the keys keep their v2.1 name, p7)
  'doc.poc.on': 'Our machine’s chip ({chip}…) is declared on Arc by the Proof of Cloud alliance: renewed on {a}, valid until {b}. A running machine renews it every week.',
  'doc.poc.off': 'Our machine’s chip ({chip}…) was declared on Arc by the Proof of Cloud alliance until {b}: a running machine renews it every week, and none has since.',
  'doc.p7.on': 'Product 5 has been authorized to pay on Arc since 19 November at 20:37 UTC, when its stack was initialized: core and levels were wired together, with no 8-day wait.',
  'doc.p7.wait': 'Product 5 can pay once its settlement contract is authorized on Arc.',
  'doc.p7.open': 'A {a} demo bounty is open until {t}.',
  'doc.p7.none': 'No bounty is open on it right now.',
}
type K = keyof typeof EN

export function useDt() {
  const lang = useLang()
  const S: Record<K, string> = EN
  return { lang, d: (k: K, v?: Record<string, string | number>) => S[k].replace(/\{(\w+)\}/g, (_, x) => String(v?.[x] ?? '')) }
}
