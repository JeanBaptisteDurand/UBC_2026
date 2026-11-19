// The Doc page's chapter ids (doc.html?c=<id>), the same in English and French (doc/content.ts). A small module of its
// own, so the copilot (copilot/page.ts, driver.ts) and the old technology.html address (redirect/technology.ts) can
// open a chapter without loading the whole Doc content.
export const DOC_CHAPTERS = ['trust', 'architecture', 'admission', 'identity', 'notary-robot', 'stakes', 'settlement', 'privacy', 'contracts', 'numbers', 'build'] as const
export type DocChapter = (typeof DOC_CHAPTERS)[number]
export const isDocChapter = (x: unknown): x is DocChapter => typeof x === 'string' && (DOC_CHAPTERS as readonly string[]).includes(x)
