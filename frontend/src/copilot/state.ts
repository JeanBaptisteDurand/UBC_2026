// Copilot state, outside React (the site driver and the wallet write it too): the conversation, whether the panel is
// open, the view (conversation or MCP). It follows the user from page to page in the tab's sessionStorage; a session
// access key (aek_…) is never written there: it only exists in memory, shown once.
import { useSyncExternalStore } from 'react'
import type { Prepared, UiStep } from './api'
import type { PageName } from './page'

export interface CardState {
  phase: 'switch' | 'sign' | 'sent' | 'done' | 'reverted' | 'rejected' | 'error'
  tx?: string
  note?: string
  /** Id returned by the transaction (bounty, session). */
  ref?: string
  /** The access key of an open session: in memory only. */
  aek?: string
}
export interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Written by the site (error, refusal), never sent back to the copilot. */
  local?: boolean
  /** Sent to (or answered by) the enclave, sealed to its key: never resent to the server in clear. */
  sealed?: boolean
  citations?: string[]
  tools?: string[]
  cards?: Prepared[]
  /** What the copilot did on the site for this response. */
  steps?: string[]
  cardState?: Record<string, CardState>
}
/** busy: a question is waiting for the server; showing: a response's gestures are still playing on the site (even after
 *  a page change). While either lasts, a new question waits: it never crosses gestures. */
export interface CopilotState { open: boolean; view: 'chat' | 'mcp'; msgs: Msg[]; busy: boolean; driving: boolean; showing: boolean }

const KEY = 'archive-copilot'
const QKEY = 'archive-copilot-queue'
const MAX_KEPT = 30

function load(): Pick<CopilotState, 'open' | 'msgs'> {
  try {
    const j = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    if (j && j.v === 1 && Array.isArray(j.msgs)) return { open: !!j.open, msgs: j.msgs as Msg[] }
  } catch { /* storage missing or unreadable: a fresh conversation */ }
  return { open: false, msgs: [] }
}
function save(s: CopilotState) {
  try {
    const msgs = s.msgs.slice(-MAX_KEPT).map((m) => (m.cardState ? { ...m, cardState: Object.fromEntries(Object.entries(m.cardState).map(([k, v]) => [k, { ...v, aek: undefined }])) } : m))
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, open: s.open, msgs }))
  } catch { /* private browsing, quota: the conversation stays in memory */ }
}

let state: CopilotState = { ...load(), view: 'chat', busy: false, driving: false, showing: false }
const subs = new Set<() => void>()
export const getState = () => state
export function setState(p: Partial<CopilotState> | ((s: CopilotState) => Partial<CopilotState>)) {
  state = { ...state, ...(typeof p === 'function' ? p(state) : p) }
  save(state)
  subs.forEach((f) => f())
}
export function useCopilot<T>(sel: (s: CopilotState) => T): T {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => sel(state))
}
/** A page restored from the browser cache (Back) re-reads the tab's conversation. */
export function reloadState() { state = { ...state, ...load() }; subs.forEach((f) => f()) }

let n = 0
export const newId = () => `${Date.now().toString(36)}-${(++n).toString(36)}`
export function patchMsg(id: string, f: (m: Msg) => Partial<Msg>) {
  setState((s) => ({ msgs: s.msgs.map((m) => (m.id === id ? { ...m, ...f(m) } : m)) }))
}
export function logStep(id: string, line: string) { patchMsg(id, (m) => ({ steps: [...(m.steps ?? []), line] })) }
export function setCard(id: string, tool: string, cs: CardState) { patchMsg(id, (m) => ({ cardState: { ...(m.cardState ?? {}), [tool]: cs } })) }

/** The remaining gestures to resume on the next page (navigation from one page to another). */
export interface Queue { at: number; target: PageName; msgId: string; steps: UiStep[] }
export function saveQueue(q: Queue) { try { sessionStorage.setItem(QKEY, JSON.stringify(q)) } catch { /* nothing to resume */ } }
export function takeQueue(): Queue | null {
  try {
    const raw = sessionStorage.getItem(QKEY)
    sessionStorage.removeItem(QKEY) // read only once: a reload replays nothing
    const q = raw ? (JSON.parse(raw) as Queue) : null
    return q && Array.isArray(q.steps) && Date.now() - q.at < 120_000 ? q : null
  } catch { return null }
}
