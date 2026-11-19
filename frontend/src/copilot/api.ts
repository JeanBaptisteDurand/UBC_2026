// The conversation with the site copilot: POST {VITE_COPILOT_URL ?? '/copilot-site'}/chat.
// - request: the last 20 messages sent to the copilot (never the messages written by the site), 60 KiB at most (the
//   server refuses above 64 KiB), the language, the connected wallet and the open page;
// - response: text, sources and tools. A tool arrives as { tool, input, result } in `tools` (contract shape) or in
//   `actions` (the console's prepare tools); `tools` may also be just a list of names.
//   Interface tools (ui_*) are kept in order, with the server's normalized result, revalidated here; prepared actions
//   become cards, one per type (the last one prepared, like the console).
import { pageContext, isId, isAnchor, oneOf, TARGETS, STATES, KINDS, CONSOLE_ROUTES, type Target, type StateF, type KindF } from './page'
import { getLang } from '../i18n'
import { ct } from './strings'
import { COPILOT_SITE, MCP } from '../data/endpoints'
import { askSealed, checkEnclave } from './enclave'

// URLs come from data/endpoints.ts (jb profile: /copilot-site on the API origin)
export const COPILOT_URL = COPILOT_SITE
export const MCP_URL = MCP
const MAX_MESSAGES = 20
const MAX_BODY_BYTES = 60 * 1024

export interface NavArgs { page: Target; productId?: string; query?: string; state?: StateF; kind?: KindF; section?: string; consoleRoute?: string; reason?: string }
export interface HlArgs { target: string; note?: string }
export interface DemoArgs { action: 'play' | 'pause' | 'next' | 'prev' | 'goto'; step?: number }
export type UiStep = { tool: 'ui_navigate'; args: NavArgs } | { tool: 'ui_highlight'; args: HlArgs } | { tool: 'ui_demo'; args: DemoArgs }
/** An action prepared by the copilot (prepare tool or info card), as returned by the server. */
export interface Prepared { tool: string; input: unknown; result: Record<string, unknown> }

export const SIGN_TOOLS = new Set(['session_prepare_open', 'operator_prepare_bond', 'operator_prepare_register', 'bounty_prepare_create'])
export const INFO_TOOLS = new Set(['product_scaffold', 'pricing_quote', 'snippet_generate', 'inference_test'])
const UI_TOOLS = new Set(['ui_navigate', 'ui_highlight', 'ui_demo'])

const str = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined)

/** A revalidated interface tool (same limits as the server), or null. */
export function uiStepOf(tool: string, raw: Record<string, unknown>): UiStep | null {
  if (tool === 'ui_navigate') {
    const page = oneOf(TARGETS, raw.page)
    if (!page) return null
    const a: NavArgs = { page }
    if (isId(raw.productId)) a.productId = raw.productId
    if (typeof raw.query === 'string') a.query = raw.query.trim().slice(0, 60)
    const st = oneOf(STATES, raw.state), k = oneOf(KINDS, raw.kind)
    if (st) a.state = st
    if (k) a.kind = k
    if (isAnchor(raw.section)) a.section = raw.section
    const cr = oneOf(CONSOLE_ROUTES, raw.consoleRoute)
    if (cr) a.consoleRoute = cr
    const reason = str(raw.reason, 140)
    if (reason) a.reason = reason
    return { tool, args: a }
  }
  if (tool === 'ui_highlight') {
    const target = typeof raw.target === 'string' && /^((product|bounty):\d{1,10}|[a-z][a-z0-9-]{0,39})$/.test(raw.target) ? raw.target : undefined
    if (!target) return null
    const note = str(raw.note, 140)
    return { tool, args: note ? { target, note } : { target } }
  }
  if (tool === 'ui_demo') {
    const action = oneOf(['play', 'pause', 'next', 'prev', 'goto'] as const, raw.action)
    if (!action) return null
    const step = Number(raw.step)
    if (action === 'goto' && !(Number.isInteger(step) && step >= 1 && step <= 9)) return null
    return { tool, args: action === 'goto' ? { action, step } : { action } }
  }
  return null
}

export interface Parsed { text: string; citations: string[]; toolNames: string[]; ui: UiStep[]; cards: Prepared[] }

const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

export function parseReply(j: Record<string, unknown>): Parsed {
  const text = typeof j.text === 'string' ? j.text : ''
  const citations = Array.isArray(j.citations) ? [...new Set(j.citations.map((c) => String(c).trim()).filter(Boolean))].slice(0, 12) : []
  const names: string[] = []
  const entries: { tool: string; input: unknown; result: unknown }[] = []
  const seen = new Set<string>()
  const add = (list: unknown, fromActions: boolean) => {
    if (!Array.isArray(list)) return
    for (const x of list) {
      if (typeof x === 'string') { names.push(x); continue }
      if (!obj(x) || typeof x.tool !== 'string') continue
      const key = JSON.stringify([x.tool, x.input ?? null, x.result ?? null])
      // the same action may come from both lists: keep it once
      if (fromActions && seen.has(key)) continue
      seen.add(key)
      entries.push({ tool: x.tool, input: x.input, result: x.result })
      names.push(x.tool)
    }
  }
  add(j.tools, false)
  add(j.actions, true)
  const ui: UiStep[] = []
  const cards = new Map<string, Prepared>()
  for (const e of entries) {
    if (e.tool === 'ui_guide') {
      // a guided tour (ui_guide): played here as the page it names, then each step pointed out with its note (a ring
      // and a bubble, ui_highlight), in order. Nothing of the page is clicked, typed or signed
      if (!obj(e.result) || e.result.ok !== true) continue
      const g = { ...(obj(e.input) ? e.input : {}), ...e.result }
      const alias: Record<string, string> = { products: 'service', technology: 'doc' }
      const page = typeof g.page === 'string' ? (alias[g.page] ?? g.page) : undefined
      const nav = page ? uiStepOf('ui_navigate', { page }) : null
      if (nav) ui.push(nav)
      for (const st of (Array.isArray(g.steps) ? g.steps : []).slice(0, 6)) {
        if (!obj(st)) continue
        const step = uiStepOf('ui_highlight', { target: st.target, note: st.note })
        if (step) ui.push(step)
      }
      continue
    }
    if (UI_TOOLS.has(e.tool)) {
      // the server validates and returns { ok: true, …normalized input }; an ok: false is never played
      if (!obj(e.result) || e.result.ok !== true) continue
      const step = uiStepOf(e.tool, { ...(obj(e.input) ? e.input : {}), ...e.result })
      if (step) ui.push(step)
    } else if ((SIGN_TOOLS.has(e.tool) || INFO_TOOLS.has(e.tool)) && obj(e.result)) {
      cards.delete(e.tool)
      cards.set(e.tool, { tool: e.tool, input: e.input ?? null, result: e.result })
    }
  }
  const toolNames = [...new Set(names.map((n) => n.replace(/_/g, '.')))].filter((n) => !/^ui\./.test(n))
  return { text, citations, toolNames, ui, cards: [...cards.values()] }
}

/** A run of the model's citation marks (【4:0†source】…), with surrounding spaces: removed on display
 *  (console, copilot.ts: stripCitations). The text kept and sent back to the copilot stays as it came. */
const CITATIONS = /[ \t]*(?:【[^】]*】[ \t]*)+/g
export function stripCitations(text: string): string {
  if (!text.includes('【')) return text
  return text.replace(CITATIONS, (m: string, at: number, all: string) => {
    const prev = at > 0 ? all[at - 1]! : '\n'
    const next = all[at + m.length] ?? '\n'
    if (/[\r\n([{]/.test(prev) || /[\r\n.,)\]}…]/.test(next)) return ''
    if (/[:;!?»]/.test(next)) return /[ \t]$/.test(m) ? ' ' : ''
    return ' '
  })
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export function chatBody(history: ChatTurn[], user: string | null): string {
  let messages = history.slice(-MAX_MESSAGES)
  const page = pageContext()
  const make = () => JSON.stringify({ messages, lang: getLang(), ...(user ? { user } : {}), ...(page ? { page } : {}) })
  let body = make()
  const enc = new TextEncoder()
  while (messages.length > 1 && enc.encode(body).length > MAX_BODY_BYTES) { messages = messages.slice(1); body = make() }
  return body
}

/** sealed: the answer came from the enclave, sealed to its key (the turn may never go anywhere else in clear) */
export type Answer = { ok: true; parsed: Parsed; sealed?: boolean } | { ok: false; text: string }

const isNetwork = (e: unknown) => /^(Failed to fetch|Load failed|NetworkError|fetch failed|Network request failed)/i.test(String((e as Error)?.message ?? ''))
const isTimeout = (e: unknown) => (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError'

export async function ask(history: ChatTurn[], user: string | null, sealedBefore = false): Promise<Answer> {
  // AskHive in its enclave first (copilot/enclave.ts): sealed, its key checked on Arc. Where this page cannot seal
  // (HTTP, another origin), or if the enclave does not answer, the ArcHive server copilot answers and the badge says so.
  // A conversation already sealed to the enclave is never sent to the server in clear: the visitor is told instead
  try {
    const s = await askSealed(history.slice(-MAX_MESSAGES), user, getLang() === 'fr' ? 'fr' : 'en')
    if (s) return s.ok ? { ok: true, parsed: parseReply(s.reply), sealed: true } : { ok: false, text: s.text }
  } catch {
    void checkEnclave(true) // the enclave is unreachable: the badge says so
    if (sealedBefore) return { ok: false, text: ct('enc.held') }
  }
  let res: Response
  try {
    res = await fetch(`${COPILOT_URL}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chatBody(history, user), signal: AbortSignal.timeout(180_000) })
  } catch (e) {
    if (isTimeout(e)) return { ok: false, text: ct('err.slow') }
    return { ok: false, text: isNetwork(e) ? ct('err.unreachable', { url: COPILOT_URL }) : String((e as Error)?.message ?? e) }
  }
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !j) {
    // a refusal (403 origin, 429 rate, 413, 415, 400): the server says why in `text`, shown as is
    const said = typeof j?.text === 'string' && j.text.trim() ? j.text : typeof j?.error === 'string' && j.error.trim() ? j.error : ''
    return { ok: false, text: said || (res.ok ? ct('err.unreadable', { status: res.status }) : ct('err.refused', { status: res.status })) }
  }
  return { ok: true, parsed: parseReply(j) }
}
