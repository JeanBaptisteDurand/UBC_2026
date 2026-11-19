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

/** owner: whose conversation the tab holds (an address, null: written without a wallet, undefined: not recorded) */
function load(): Pick<CopilotState, 'open' | 'msgs'> & { owner: string | null | undefined } {
  try {
    const j = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    if (j && j.v === 1 && Array.isArray(j.msgs)) return { open: !!j.open, msgs: j.msgs as Msg[], owner: typeof j.owner === 'string' ? j.owner : j.owner === null || !j.msgs.length ? null : undefined }
  } catch { /* storage missing or unreadable: a fresh conversation */ }
  return { open: false, msgs: [], owner: null }
}
/** The messages as stored: the last ones, without the one-time access keys of prepared cards */
const slim = (msgs: Msg[]) => msgs.slice(-MAX_KEPT).map((m) => (m.cardState ? { ...m, cardState: Object.fromEntries(Object.entries(m.cardState).map(([k, v]) => [k, { ...v, aek: undefined }])) } : m))
function save(s: CopilotState) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, open: s.open, msgs: slim(s.msgs), ...(convOwner !== undefined ? { owner: convOwner } : {}) }))
  } catch { /* private browsing, quota: the conversation stays in memory */ }
  keepForWallet(s)
}

// The wallet the conversation belongs to. Without a wallet, the conversation stays in the tab.
// With a wallet connected, it is also kept in this browser for that address (localStorage, 30 days) and comes back
// when the same wallet connects again, in any tab; another wallet never sees it; disconnecting takes it off the screen;
// "Start over" deletes it for that wallet too. It never leaves the browser.
const WKEY = (a: string) => `archive-copilot-w:${a}`
const W_TTL = 30 * 24 * 3600 * 1000
let owner: string | null = null
/** setOwner was called once on this page (the wallet is known) */
let known = false
/** whose conversation is on screen, kept next to it in the tab (sessionStorage): after a reload, another wallet never
 *  inherits it */
let convOwner: string | null | undefined = null
function keepForWallet(s: CopilotState) {
  if (!owner || convOwner !== owner) return
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
// The rule: the conversation on screen stays only if it belongs to the wallet now connected (or to no wallet when
// none is). Another wallet's conversation, or one whose owner was not recorded, leaves the screen (it stays kept for
// its own wallet). A conversation written without a wallet becomes the connecting wallet's only if that wallet has
// none kept; otherwise the wallet's kept conversation comes back and the walletless one is dropped.
export function setOwner(address: string | null) {
  const a = address ? address.toLowerCase() : null
  if (known && a === owner) return
  known = true
  owner = null
  if (!a) {
    if (convOwner !== null && state.msgs.length) setState({ msgs: [], view: 'chat' })
    convOwner = null
    save(state)
    return
  }
  const kept = keptFor(a)
  const adopt = state.msgs.length > 0 && (convOwner === a || (convOwner === null && !kept.length))
  owner = a
  convOwner = a
  if (adopt) save(state)
  else setState({ msgs: kept, view: 'chat' })
}

const boot = load()
convOwner = boot.owner
let state: CopilotState = { open: boot.open, msgs: boot.msgs, view: 'chat', busy: false, driving: false, showing: false }
const subs = new Set<() => void>()
export const getState = () => state
export function setState(p: Partial<CopilotState> | ((s: CopilotState) => Partial<CopilotState>)) {
  state = { ...state, ...(typeof p === 'function' ? p(state) : p) }
  // an empty conversation belongs to whoever writes next: the wallet connected, or none
  if (!state.msgs.length) convOwner = owner
  save(state)
  subs.forEach((f) => f())
}
export function useCopilot<T>(sel: (s: CopilotState) => T): T {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => sel(state))
}
/** A page restored from the browser cache (Back) re-reads the tab's conversation. */
export function reloadState() { const b = load(); convOwner = b.owner; state = { ...state, open: b.open, msgs: b.msgs }; subs.forEach((f) => f()) }

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
