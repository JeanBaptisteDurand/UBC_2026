// State shared by the DOM and the scene, read every frame (no React render per frame).
import { useSyncExternalStore } from 'react'
import type { Wall } from './data/wall'

export type GatePhase = 'idle' | 'calling' | 'ok' | 'refused' | 'error'
export interface Rect { x: number; y: number; w: number; h: number }
export const world = {
  wall: { sleds: [], ex: { use: -1, rent: -1, publish: -1, invalid: -1, inactive: -1 }, replay: -1, replayTx: null, replayBlock: null, running: [], counts: { off: 0, amber: 0, green: 0, red: 0 } } as Wall,
  version: 0,
  pointer: { x: -1e4, y: -1e4, inside: false, overUi: false, touch: false, moved: false },
  /** Slot under the pointer (-1: none), locked slot (open card), lock progress (0 to 1) */
  hover: -1,
  lock: -1,
  arming: 0,
  /** Whether the facade faces the camera (pixel-exact locking allowed) */
  frontal: true,
  /** Story position: section index + progress within the section */
  story: 0,
  /** Progress of each section (0 to 1), by id; for a pinned page, progress within the pin */
  sec: {} as Record<string, number>,
  /** Played progress of the first pinned page, following sec.protocol at a bounded speed */
  protoQ: 0,
  /** Bounds set by the scene on the protocol queue: [lowest when scrolling up, highest when scrolling down] */
  protoGate: [0, 1] as [number, number],
  gate: { phase: 'idle' as GatePhase, at: 0 },
  pulses: [] as { slot: number; at: number }[],
  sceneReady: false,
  /** On-screen rect of each requested slot (CSS px), computed by the scene every frame */
  rects: new Map<number, Rect & { vis: boolean; q?: number[] }>(),
  /** On-screen anchors for leader lines */
  anchors: new Map<string, { x: number; y: number; vis: number }>(),
  /** World to screen projection (set by the scene) */
  toScreen: null as null | ((x: number, y: number, z: number) => { x: number; y: number; z: number }),
  /** Slot under a screen point (set by the scene) */
  pick: null as null | ((px: number, py: number) => number),
  loupe: true,
  /** WebGL canvas (used by the cursor loupe) */
  canvas: null as HTMLCanvasElement | null,
  /** Height of the pinned text panel (portrait: the 3D sits above it) */
  pinH: {} as Record<string, number>,
  /** Service opened in place; the scene derives the camera approach from it */
  svc: { slot: -1, open: false, u: 0 },
  /** Interactive element under the pointer; the cursor square wraps it */
  uiEl: null as HTMLElement | null,
  /** Left edge of the wall area on screen (CSS px), where the text column fade ends */
  wallX: 0,
}

const subs = new Set<() => void>()
export function setWall(w: Wall) { world.wall = w; world.version++; subs.forEach((f) => f()) }
export const useWallVersion = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => world.version)

const lSubs = new Set<() => void>()
export function setLock(i: number) { if (world.lock === i) return; world.lock = i; lSubs.forEach((f) => f()) }
export const useLock = () => useSyncExternalStore((f) => { lSubs.add(f); return () => { lSubs.delete(f) } }, () => world.lock)
const oSubs = new Set<() => void>()
export function setLoupe(v: boolean) { world.loupe = v; oSubs.forEach((f) => f()) }
export const useLoupe = () => useSyncExternalStore((f) => { oSubs.add(f); return () => { oSubs.delete(f) } }, () => world.loupe)
// Read-only handle for automated gesture checks
;(window as unknown as { __world: typeof world }).__world = world
