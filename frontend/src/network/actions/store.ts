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

// the engine, loaded once on the first click (lazy import: viem, the SDK and encryption only weigh there)
type Engine = typeof import('./wallet')
let engineP: Promise<Engine> | null = null
export function engine(): Promise<Engine> {
  if (!engineP) engineP = import('./wallet')
  return engineP
}

// page state around the actions: the catalog open in place of the scene (Use), the chosen service
export interface UiState { catOpen: boolean; pid: string }
let ui: UiState = { catOpen: false, pid: '' }
const uiSubs = new Set<() => void>()
export const getUi = () => ui
export function setUi(p: Partial<UiState>) { ui = { ...ui, ...p }; uiSubs.forEach((f) => f()) }
export const useUi = () => useSyncExternalStore((f) => { uiSubs.add(f); return () => { uiSubs.delete(f) } }, () => ui)
