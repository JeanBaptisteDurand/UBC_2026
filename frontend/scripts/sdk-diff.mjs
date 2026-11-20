// Checks that the site's copy of the SDK (src/network/actions/sdk) runs the same code as packages/sdk/src.
// Comments are ignored, and so is the text of any string with a space in it (messages, which each side words in its
// own way). Everything else counts: code, addresses, hex values, numbers. Prints the files that differ and exits 1.
// Usage, from frontend/: node scripts/sdk-diff.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const SITE = join(here, '../src/network/actions/sdk')
const PKG = join(here, '../../packages/sdk/src')

const spaced = (s) => /\s/.test(s)
function code(path) {
  const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const f = ts.factory
  const blank = (ctx) => (root) => {
    const visit = (n) => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && spaced(n.text)) return f.createStringLiteral('…')
      if (ts.isTemplateExpression(n) && [n.head, ...n.templateSpans.map((s) => s.literal)].some((p) => spaced(p.text))) {
        const spans = n.templateSpans.map((s, i) => f.createTemplateSpan(ts.visitNode(s.expression, visit),
          i === n.templateSpans.length - 1 ? f.createTemplateTail('') : f.createTemplateMiddle('')))
        return f.createTemplateExpression(f.createTemplateHead(''), spans)
      }
      return ts.visitEachChild(n, visit, ctx)
    }
    return ts.visitNode(root, visit)
  }
  return ts.createPrinter({ removeComments: true }).printFile(ts.transform(sf, [blank]).transformed[0])
}

if (!existsSync(PKG)) { console.error(`packages/sdk/src not found at ${PKG}`); process.exit(2) }
const files = new Set([...readdirSync(SITE), ...readdirSync(PKG)].filter((n) => n.endsWith('.ts')))
let bad = 0
for (const name of [...files].sort()) {
  const a = join(SITE, name), b = join(PKG, name)
  if (!existsSync(a) || !existsSync(b)) { bad++; console.log(`${name}: only in ${existsSync(a) ? 'the site copy' : 'packages/sdk'}`); continue }
  if (code(a) !== code(b)) { bad++; console.log(`${name}: the code differs`) }
}
console.log(bad ? `${bad} file(s) out of step with packages/sdk` : `${files.size} files: same code as packages/sdk`)
process.exit(bad ? 1 : 0)
