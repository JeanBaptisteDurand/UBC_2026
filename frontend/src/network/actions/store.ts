// The visitor's wallet state, lightweight (no viem here): the column reads it from the first render, the engine
// (wallet.ts, loaded on the "Connect wallet" click) writes it. One store for the column and the three flows.
import { useSyncExternalStore } from 'react'

export interface WalletInfo { id: string; name: string; icon?: string }
export type Phase = 'idle' | 'loading' | 'pick' | 'connecting' | 'connected' | 'none'
export interface WalletState {
  phase: Phase
  wallets: WalletInfo[]
  address?: `0x${string}`
  chainId?: number
  /** USDC balance (ERC-20, 6 decimals) on Arc; null: the read failed. */
  balance?: bigint | null
  switching?: boolean
  /** The last message to show below the wallet (refusal, error), already in the current language. */
  note?: { tone: 'bad' | 'muted'; text: string }
}

export const ARC_ID = 5042002
let st: WalletState = { phase: 'idle', wallets: [] }
const subs = new Set<() => void>()
export const getWallet = () => st
export function setWallet(p: Partial<WalletState>) { st = { ...st, ...p }; subs.forEach((f) => f()) }
export const useWallet = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => st)
export const onArc = (s: WalletState) => s.phase === 'connected' && s.chainId === ARC_ID
/** A touch screen (phone, tablet): no browser extension can be installed there, a wallet app opens the page instead. */
export const onPhone = () => { try { return matchMedia('(pointer: coarse)').matches } catch { return false } }

// the engine, loaded once on the first click (lazy import: viem, the SDK and encryption only weigh there)
type Engine = typeof import('./wallet')
let engineP: Promise<Engine> | null = null
export function engine(): Promise<Engine> {
  // a load that failed (the network dropped) is tried again on the next click instead of failing for good
  if (!engineP) engineP = import('./wallet').catch((e) => { engineP = null; throw e })
  return engineP
}

// page state around the actions: the catalog open in place of the scene (Use), the chosen service
export interface UiState { catOpen: boolean; pid: string }
// Arriving on the Use part (?focus=use): the catalog of sleds opens at once (browse, search, pick in one click); a
// service given in the address (?p=<id>, a sled clicked on the landing) is already picked and described
const Q0 = new URLSearchParams(location.search)
const P0 = /^\d+$/.test(Q0.get('p') ?? '') ? Q0.get('p')! : ''
let ui: UiState = { catOpen: false, pid: P0 } // the catalog lives on the Services page now
const uiSubs = new Set<() => void>()
export const getUi = () => ui
export function setUi(p: Partial<UiState>) { ui = { ...ui, ...p }; uiSubs.forEach((f) => f()) }
export const useUi = () => useSyncExternalStore((f) => { uiSubs.add(f); return () => { uiSubs.delete(f) } }, () => ui)

// The part's demo (the "Play the demo" button of a focus, scene.ts playShow): the scene writes the stage it plays (k,
// the same index as the page steps) and end once the flow is over; the steps then show simulated values (showfill.ts)
// instead of the visitor's, without touching the visitor's own state: clearing it (null) restores everything as it was.
export interface DemoState { part: 'use' | 'rent' | 'publish'; k: number; end: boolean }
let demo: DemoState | null = null
const demoSubs = new Set<() => void>()
export const getDemo = () => demo
export function setDemo(d: DemoState | null) { demo = d; demoSubs.forEach((f) => f()) }
export const useDemo = () => useSyncExternalStore((f) => { demoSubs.add(f); return () => { demoSubs.delete(f) } }, () => demo)
