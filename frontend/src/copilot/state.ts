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
  /** Who answered (assistant): the enclave, sealed, or the ArcHive server, not sealed. */
  route?: 'enclave' | 'server'
  /** The enclave was tried and could not be used: the server answered (one line says so). */
  down?: boolean
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
/** The messages as stored: the last ones, without the one-time access keys of prepared cards */
const slim = (msgs: Msg[]) => msgs.slice(-MAX_KEPT).map((m) => (m.cardState ? { ...m, cardState: Object.fromEntries(Object.entries(m.cardState).map(([k, v]) => [k, { ...v, aek: undefined }])) } : m))
function save(s: CopilotState) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, open: s.open, msgs: slim(s.msgs) }))
  } catch { /* private browsing, quota: the conversation stays in memory */ }
  keepForWallet(s)
}

// The wallet the conversation belongs to (JB, 19/11). Without a wallet, the conversation stays in the tab, as before.
// With a wallet connected, it is also kept in this browser for that address (localStorage, 30 days) and comes back
// when the same wallet connects again, in any tab; another wallet never sees it; disconnecting takes it off the screen;
// "Start over" deletes it for that wallet too. It never leaves the browser.
const WKEY = (a: string) => `archive-copilot-w:${a}`
const W_TTL = 30 * 24 * 3600 * 1000
let owner: string | null = null
function keepForWallet(s: CopilotState) {
  if (!owner) return
  try {
    if (!s.msgs.length) localStorage.removeItem(WKEY(owner))
    else localStorage.setItem(WKEY(owner), JSON.stringify({ v: 1, at: Date.now(), msgs: slim(s.msgs) }))
  } catch { /* storage refused: the conversation stays in the tab */ }
}
function keptFor(a: string): Msg[] {
  try {
    const j = JSON.parse(localStorage.getItem(WKEY(a)) ?? 'null')
    if (j && j.v === 1 && Array.isArray(j.msgs) && Date.now() - Number(j.at ?? 0) < W_TTL) return j.msgs as Msg[]
  } catch { /* nothing kept */ }
  return []
}
/** Called with the connected address, or null once no wallet is connected (never while it is connecting). */
export function setOwner(address: string | null) {
  const a = address ? address.toLowerCase() : null
  if (a === owner) return
  const was = owner
  owner = null
  // the previous wallet's conversation leaves the screen (it stays kept for that wallet in this browser)
  if (was) setState({ msgs: [], view: 'chat' })
  if (!a) return
  owner = a
  // a conversation under way stays, now kept for this wallet; an empty one gets this wallet's last conversation back
  const kept = keptFor(a)
  if (!state.msgs.length && kept.length) setState({ msgs: kept, view: 'chat' })
  else keepForWallet(state)
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
