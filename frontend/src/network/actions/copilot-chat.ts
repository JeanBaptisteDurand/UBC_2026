// The SERVER copilot (POST /copilot/chat), in plain text, without viem: the bubble loads it alone. Same limits as the
// console (20 messages, 60 KiB), same body ({ messages, user, lang }). Failures are reported as they are: offline,
// origin refused (CORS, the copilot's ALLOWED_ORIGINS), timeout, or the copilot's refusal with its text.
import { COPILOT, diagnose, isNetErr } from '../../data/endpoints'

export interface PreparedAction { tool: string; input: unknown; result: unknown }
export interface CopilotAnswer { text: string; tools?: string[]; citations?: string[]; navigate?: string; actions?: PreparedAction[]; code?: string }
export type ServerResult = { ok: true; a: CopilotAnswer } | { ok: false; why: 'offline' | 'cors' | 'slow' | 'refused'; status?: number; text?: string; code?: string }

const MAX_MESSAGES = 20
const MAX_BODY_BYTES = 60 * 1024

export function chatBody(messages: { role: 'user' | 'assistant'; content: string }[], user: string | null, lang: 'en' | 'fr'): string {
  let m = messages.slice(-MAX_MESSAGES)
  const enc = new TextEncoder()
  let body = JSON.stringify({ messages: m, user, lang })
  while (m.length > 1 && enc.encode(body).length > MAX_BODY_BYTES) { m = m.slice(1); body = JSON.stringify({ messages: m, user, lang }) }
  return body
}

export async function askServer(messages: { role: 'user' | 'assistant'; content: string }[], user: string | null, lang: 'en' | 'fr'): Promise<ServerResult> {
  const url = `${COPILOT.replace(/\/+$/, '')}/chat`
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chatBody(messages, user, lang), signal: AbortSignal.timeout(180_000) })
  } catch (e) {
    const n = (e as Error)?.name
    if (n === 'TimeoutError' || n === 'AbortError') return { ok: false, why: 'slow' }
    if (!isNetErr(e)) return { ok: false, why: 'offline' }
    return { ok: false, why: await diagnose(`${COPILOT.replace(/\/+$/, '')}/health`) }
  }
  const j = (await res.json().catch(() => null)) as CopilotAnswer | null
  if (res.status === 502 || res.status === 503 || res.status === 504) return { ok: false, why: 'offline', status: res.status }
  if (!res.ok || !j) return { ok: false, why: 'refused', status: res.status, text: typeof j?.text === 'string' ? j.text : undefined, code: j?.code }
  return { ok: true, a: j }
}

/** The model's raw citation marks (【…】), removed on display only (the console's stripCitations). */
const CITATIONS = /[ \t]*(?:【[^】]*】[ \t]*)+/g
export function stripCitations(text: string): string {
  if (!text.includes('【')) return text
  return text.replace(CITATIONS, (m: string, at: number, all: string) => {
    const prev = at > 0 ? all[at - 1] : '\n'
    const next = all[at + m.length] ?? '\n'
    if (/[\r\n([{]/.test(prev) || /[\r\n.,)\]}…]/.test(next)) return ''
    if (/[:;!?»]/.test(next)) return /[ \t]$/.test(m) ? ' ' : ''
    return ' '
  })
}
