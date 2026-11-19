// Lightweight markdown for copilot responses, rendered as React elements (never injected HTML): paragraphs, lists,
// headings, code blocks, bold, italic, inline code, links (http, https or site path), addresses to the Arc explorer.
// Long hexadecimal values are shortened (the only place where an ellipsis appears).
import { useState, type ReactNode } from 'react'
import { addrUrl } from './wallet'
import { ct } from './strings'

type Block = { t: 'p'; text: string } | { t: 'h'; text: string } | { t: 'ul' | 'ol'; items: string[] } | { t: 'code'; text: string }

function blocks(src: string): Block[] {
  const out: Block[] = []
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  const flush = () => { if (para.length) { out.push({ t: 'p', text: para.join('\n') }); para = [] } }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (/^\s*```/.test(l)) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) code.push(lines[i]!)
      out.push({ t: 'code', text: code.join('\n') })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      // a table: kept as a monospace block (readable, no grid to rebuild)
      flush()
      const rows: string[] = []
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i]!)) rows.push(lines[i]!.trim())
      i--
      out.push({ t: 'code', text: rows.join('\n') })
      continue
    }
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(l)
    if (h) { flush(); out.push({ t: 'h', text: h[1]! }); continue }
    const li = /^\s*(?:[-*+•]|(\d{1,3})[.)])\s+(.*)$/.exec(l)
    if (li) {
      flush()
      const kind = li[1] ? 'ol' : 'ul'
      const last = out[out.length - 1]
      if (last && last.t === kind) last.items.push(li[2]!)
      else out.push({ t: kind, items: [li[2]!] })
      continue
    }
    if (!l.trim()) { flush(); continue }
    // the continuation of a list item (indented line) stays in that item
    const last = out[out.length - 1]
    if (!para.length && last && (last.t === 'ul' || last.t === 'ol') && /^\s{2,}\S/.test(l)) { last.items[last.items.length - 1] += ` ${l.trim()}`; continue }
    para.push(l)
  }
  flush()
  return out
}

const RE = /(`[^`\n]+`)|\[([^\]\n]{1,200})\]\(((?:https?:\/\/|\/)[^\s)]*)\)|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|\*(\S(?:[^*\n]*?\S)?)\*|(https?:\/\/[^\s<>()]*[^\s<>().,:!?'"])|(0x[0-9a-fA-F]{64})(?![0-9a-fA-F])|(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])/g
export const short = (h: string, n = 4) => (h.length > 2 + 2 * n + 1 ? `${h.slice(0, 2 + n)}…${h.slice(-n)}` : h)

function Link({ href, children }: { href: string; children: ReactNode }) {
  const ext = /^https?:\/\//.test(href)
  return <a className="cp-a" href={href} {...(ext ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>{children}</a>
}

export function inline(s: string, depth = 0): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0, k = 0
  RE.lastIndex = 0
  for (let m = RE.exec(s); m; m = RE.exec(s)) {
    if (m.index > at) out.push(s.slice(at, m.index))
    const key = `${depth}-${k++}`
    if (m[1]) out.push(<code key={key} className="cp-ic">{m[1].slice(1, -1)}</code>)
    else if (m[2] && m[3]) out.push(<Link key={key} href={m[3]}>{depth < 2 ? inline(m[2], depth + 1) : m[2]}</Link>)
    else if (m[4] || m[5]) out.push(<strong key={key}>{depth < 2 ? inline((m[4] ?? m[5])!, depth + 1) : m[4] ?? m[5]}</strong>)
    else if (m[6]) out.push(<em key={key}>{depth < 2 ? inline(m[6], depth + 1) : m[6]}</em>)
    else if (m[7]) out.push(<Link key={key} href={m[7]}>{m[7].replace(/^https?:\/\//, '')}</Link>)
    else if (m[8]) out.push(<span key={key} className="cp-hex mono" title={m[8]}>{short(m[8], 6)}</span>)
    else if (m[9]) out.push(<a key={key} className="cp-a cp-hex mono" href={addrUrl(m[9])} target="_blank" rel="noreferrer noopener" title={m[9]}>{short(m[9], 4)}</a>)
    at = m.index + m[0].length
    RE.lastIndex = at
    // RE is shared: a recursion reset it, resume at our position
  }
  if (at < s.length) out.push(s.slice(at))
  return out
}

/** A code block with its Copy button. */
export function Code({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  const copy = () => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600) }).catch(() => {}) }
  return (
    <div className="cp-code">
      <pre className="mono" tabIndex={0} aria-label={label ?? ct('code')}><code>{text}</code></pre>
      <button type="button" className="cp-copy" onClick={copy} aria-label={`${ct('copy')}${label ? `: ${label}` : ''}`}>{done ? ct('copied') : ct('copy')}</button>
    </div>
  )
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="cp-md">
      {blocks(text).map((b, i) => {
        if (b.t === 'code') return <Code key={i} text={b.text} />
        if (b.t === 'h') return <p key={i} className="cp-md-h">{inline(b.text)}</p>
        if ('items' in b) { const L = b.t === 'ol' ? 'ol' : 'ul'; return <L key={i}>{b.items.map((x, j) => <li key={j}>{inline(x)}</li>)}</L> }
        return <p key={i}>{b.text.split('\n').map((l: string, j: number, a: string[]) => <span key={j}>{inline(l)}{j < a.length - 1 ? <br /> : null}</span>)}</p>
      })}
    </div>
  )
}
