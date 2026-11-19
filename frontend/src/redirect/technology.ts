// technology.html → doc.html: a #chapter opens that chapter (?c=<chapter>), and an anchor inside a chapter of the old
// page (#dcap, #sessions, #hpke...) opens the chapter that holds it (doc-anchors.ts). An external module, so the site's
// script-src 'self' policy allows it (an inline script is refused there).
import { docQuery } from './doc-anchors'

// a malformed hash (#%E0%A4%A) cannot be decoded: it is then read as it is, and leads to the Doc's first page
const raw = location.hash.slice(1)
let anchor = raw
try { anchor = decodeURIComponent(raw) } catch { /* kept raw */ }
location.replace('doc.html' + docQuery(anchor))
