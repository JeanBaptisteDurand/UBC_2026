// Scene and UI palette. Status LED colours (green, amber, red, off) are fixed; Arc light stays blue.
// Scene colours are linear RGB (what the shaders read), UI colours are sRGB (CSS).
// Changing the palette only touches uniforms, material colours and light colours, so no program recompiles.

export type RGB = [number, number, number]
export interface Palette {
  id: 1
  name: { en: string; fr: string }
  line: { en: string; fr: string }
  swatch: [string, string, string]
  clear: string
  sun: RGB; sunK: number
  /** Share of the sun that falls through the left skylight */
  wellK: number
  /** Lightmaps are baked untinted: sun and sky tint are applied here */
  lmSun: RGB; lmSky: RGB
  skyFill: RGB; bounce: RGB
  fog: RGB; fogSun: RGB
  /** Air density, room lightmap gain, distance where the fog starts (m) */
  fogD: number; roomK: number; fogN: number
  hemiSky: RGB; hemiGround: RGB; hemiK: number
  mat: { anod: string; graphite: string; pow: string; cha: string; foam: string; tile: string; plate: string; fbody: string; fplate: string; body: string; al: string; al_bead: string }
  filet: RGB; micro: RGB; perf: RGB
  glass: { base: RGB; sun: RGB; grad: RGB; band: RGB }
  ledOff: { base: RGB; grad: RGB; sun: RGB }; ledCore: RGB
  inkOff: RGB; plateSun: RGB
  dust: RGB; fill: RGB; wear: RGB
  comp: { gold: RGB; night: RGB; base: RGB; shadow: RGB; hi: RGB; sat: number; lift: RGB; revealBg: RGB; revealEdge: RGB; volK: number; expo: number }
}

export const PALS: Palette[] = [
  {
    // Graphite and ice: a graphite room, cold light through the gaps, aluminium, glacier blue accent.
    id: 1,
    name: { en: 'Graphite and ice', fr: 'Graphite et glace' },
    line: { en: 'Graphite room, ice light through the gaps, glacier blue accent.', fr: 'Salle graphite, lumière de glace dans les interstices, accent bleu glacier.' },
    swatch: ['#1b1f25', '#cfe4ff', '#8fc6ff'],
    clear: '#0b0d10',
    sun: [0.80, 0.90, 1.0], sunK: 30, wellK: 0.0,
    lmSun: [0.22, 0.25, 0.30], lmSky: [0.95, 1.05, 1.25],
    skyFill: [0.020, 0.026, 0.040], bounce: [0.16, 0.19, 0.24],
    // Aerial perspective: starts behind the foreground rack (3 m) and is tinted by height (glsl.ts, fogCol)
    fog: [0.085, 0.10, 0.125], fogSun: [0.05, 0.06, 0.075], fogD: 0.07, roomK: 1.3, fogN: 3.0,
    hemiSky: [0.17, 0.20, 0.26], hemiGround: [0.30, 0.34, 0.40], hemiK: 4.2,
    mat: { anod: '#23272d', graphite: '#1d2025', pow: '#16191d', cha: '#1c2026', foam: '#14171b', tile: '#262a30', plate: '#262a30', fbody: '#1a1d22', fplate: '#16181c', body: '#0d0f12', al: '#a6acb3', al_bead: '#7b8087' },
    filet: [0.62, 0.80, 1.0], micro: [0.55, 0.78, 1.0], perf: [0.45, 0.66, 1.0],
    glass: { base: [0.008, 0.0095, 0.0115], sun: [0.40, 0.46, 0.55], grad: [0.035, 0.042, 0.052], band: [0.07, 0.09, 0.12] },
    ledOff: { base: [0.004, 0.0047, 0.006], grad: [0.034, 0.038, 0.046], sun: [0.24, 0.28, 0.34] }, ledCore: [0.88, 0.94, 1.0],
    inkOff: [0.62, 0.66, 0.72], plateSun: [0.40, 0.46, 0.55],
    dust: [0.82, 0.90, 1.0], fill: [0.85, 0.92, 1.0], wear: [0.34, 0.36, 0.39],
    comp: { gold: [0.80, 0.90, 1.0], night: [0.40, 0.48, 0.66], base: [0.0042, 0.0048, 0.0060], shadow: [0.90, 0.96, 1.14], hi: [0.98, 1.0, 1.04], sat: 1.08, lift: [0.0006, 0.0008, 0.0014], revealBg: [0.040, 0.046, 0.055], revealEdge: [0.75, 0.88, 1.0], volK: 1.35, expo: 1.18 },
  },
]

const P1 = PALS[0]
export const getPal = () => P1
export const onPal = (f: () => void) => { void f; return () => {} }
