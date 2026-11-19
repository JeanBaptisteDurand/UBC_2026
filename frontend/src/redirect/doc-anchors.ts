// The old technology page's anchors (products/TechnologyPage.tsx, technology.html#<anchor>) and the Doc chapter that now
// holds each one (doc.html?c=<chapter>). A chapter id is its own anchor; a section inside a chapter (#dcap, #sessions,
// #hpke...) leads to its chapter. No other import: the technology.html redirect loads it before anything else.
import { isDocChapter, type DocChapter } from '../doc/chapters'

const SUB: Record<string, DocChapter> = {
  dcap: 'admission', rtmr3: 'admission', check: 'admission', policy: 'admission',
  chip: 'identity', 'proof-of-cloud': 'identity', levels: 'identity',
  refutation: 'stakes',
  sessions: 'settlement', x402: 'settlement', verdicts: 'settlement', 'only-attested': 'settlement',
  hpke: 'privacy', 'model-attestation': 'privacy',
  reviews: 'contracts',
}

/** the Doc chapter of an old technology anchor, or null when it names none */
export function docChapterOf(anchor: string): DocChapter | null {
  if (isDocChapter(anchor)) return anchor
  // own keys only: "constructor" or "toString" name no chapter
  if (Object.hasOwn(SUB, anchor)) return SUB[anchor]
  return /^c-[\w-]+$/.test(anchor) ? 'contracts' : null
}

/** the query that opens that chapter on doc.html ("?c=identity"), or "" */
export const docQuery = (anchor: string) => {
  const c = docChapterOf(anchor)
  return c ? `?c=${c}` : ''
}
