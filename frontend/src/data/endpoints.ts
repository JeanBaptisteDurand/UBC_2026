// Site endpoints, in one place. Every URL comes from here: the ArcHive API, its console, its copilot, the enclaves
// behind its nginx, the Arc RPC. Each value can be set at build time by a VITE_* variable; otherwise the profile picks
// sensible defaults.
//
// Three profiles (VITE_PROFILE):
//  - "relay" (default, dev and previews): the API and the RPC go through the app server proxy first (/jb-api,
//    /arc-rpc, vite.config.ts), then the direct URLs if the host has no proxy;
//  - "jb": the site is served on the ArcHive API origin, at the root (VITE_BASE, .env.jb). Everything is relative to
//    that origin: /api, /copilot-site, /enclave/… (its nginx sets the attested copilot's proxy token), its Caddyfile CSP
//    applies; pairing and EIP-4361 signatures are valid for its domain;
//  - "ext": the site is served elsewhere over HTTPS, with absolute direct URLs. The API origin must then allow the site
//    origin (SIGN_ORIGINS of the API, ALLOWED_ORIGINS of the copilot and of the copilot enclave).
// No keys here: nothing secret goes through the front end.

const env = import.meta.env as Record<string, string | undefined>
const clean = (s: string) => s.trim().replace(/\/+$/, '')
const pick = (k: string) => { const v = env[k]; return v && v.trim() ? clean(v) : undefined }

export type Profile = 'relay' | 'jb' | 'ext'
export const PROFILE: Profile = env.VITE_PROFILE === 'jb' || env.VITE_PROFILE === 'ext' ? env.VITE_PROFILE : 'relay'

/** Public ArcHive API origin (its Caddy) */
export const JB_ORIGIN = pick('VITE_JB_ORIGIN') ?? 'https://archive.62-171-153-35.sslip.io'
/** Root of the API URLs as seen by the page: '' (same origin) for the jb profile, the origin otherwise */
const ROOT = PROFILE === 'jb' ? '' : JB_ORIGIN

/** Read and pairing API (direct URL; the relay profile tries /jb-api first, data/live.ts) */
export const API_DIRECT = pick('VITE_API_URL') ?? `${ROOT}/api`
/** The console (its screens under #/…), under /console/ on the API origin */
export const CONSOLE = pick('VITE_CONSOLE_URL') ?? `${ROOT}/console`
/** Server copilot (POST /chat), unencrypted: the console one ("console" surface) */
export const COPILOT = pick('VITE_COPILOT_URL') ?? `${ROOT}/copilot`
/** The site copilot (same program, "site" surface): it drives the pages and prepares what the visitor signs; the
 *  copilot panel calls it */
export const COPILOT_SITE = pick('VITE_COPILOT_SITE_URL') ?? `${ROOT}/copilot-site`
/** MCP server (Streamable HTTP): a full URL, to paste into an agent configuration */
export const MCP = pick('VITE_MCP_URL') ?? `${JB_ORIGIN}/mcp`
/** Public Arc testnet RPC (allowed in the API origin's CSP connect-src) */
export const RPC_DIRECT = pick('VITE_ARC_RPC') ?? 'https://rpc.testnet.arc.io'
export const EXPLORER = 'https://explorer.testnet.arc.io'

/** Enclaves, behind the API's nginx (same-origin proxy to Phala). Relay profile: through the app server's /jb-enclave
 *  proxy first (dev, preview), like the API; data/live.ts switches to the direct URL when the host has no proxy
 *  (setRelay). URLs are therefore read at call time. */
let relay = PROFILE === 'relay'
export const setRelay = (v: boolean) => { relay = v }
const encBase = () => pick('VITE_ENCLAVE_BASE') ?? (relay ? '/jb-enclave' : `${ROOT}/enclave`)
export const ENCLAVE = {
  /** Pay-per-call inference, x402 (product 3) */
  get x402() { return pick('VITE_ENCLAVE_X402') ?? `${encBase()}/x402` },
  /** Prepaid session inference, SessionPay (product 1) */
  get inference() { return pick('VITE_ENCLAVE_INFERENCE') ?? `${encBase()}/inference` },
  /** Sealed bounty (product 2) */
  get bounty() { return pick('VITE_ENCLAVE_BOUNTY') ?? `${encBase()}/bounty` },
  /** Verified-level sealed bounty (product 7, SealedBountyVerified) */
  get bountyVerified() { return pick('VITE_ENCLAVE_BOUNTY_VERIFIED') ?? `${encBase()}/bounty-verified` },
  /** Attested copilot (product 4): the proxy token is set by the API's nginx, so calls must go through it */
  get copilot() { return pick('VITE_ENCLAVE_COPILOT') ?? `${encBase()}/copilot` },
  /** AskHive, the site copilot in its enclave (product 4, "site" surface): sealed conversation, key checked on Arc.
   *  Always the API origin's path (its nginx sets the proxy token), never the dev relay */
  get copilotSite() { return pick('VITE_ENCLAVE_COPILOT_SITE') ?? `${ROOT}/enclave/copilot-site` },
}
export type EnclaveKey = keyof typeof ENCLAVE

/** Reference products of the v2.1 stack (read on Arc, SDK testnet.products, levels) */
export const PRODUCT = {
  inference: BigInt(pick('VITE_PRODUCT_INFERENCE') ?? '1'),
  bounty: BigInt(pick('VITE_PRODUCT_BOUNTY') ?? '2'),
  x402: BigInt(pick('VITE_PRODUCT_X402') ?? '3'),
  copilot: BigInt(pick('VITE_COPILOT_PRODUCT_ID') ?? '4'),
  bountyVerified: BigInt(pick('VITE_PRODUCT_BOUNTY_VERIFIED') ?? '7'),
} as const

/** The attested copilot requires the expected operator: without it, the bubble talks to the server copilot. */
export const COPILOT_OPERATOR = pick('VITE_COPILOT_OPERATOR') ?? ''

/** 3D server room, at the root of the API origin (/datacenter/), next to the console */
export const DATACENTER = pick('VITE_DATACENTER_URL') ?? `${ROOT}/datacenter/`

/** An absolute URL for the SDK (which reads `${url}/pubkeys`): relative jb-profile URLs take the page origin */
export function abs(u: string): string {
  if (/^https?:\/\//.test(u)) return u
  return new URL(u, location.origin).href.replace(/\/+$/, '')
}

/** The SDK's HPKE encryption (WebCrypto) only exists in a secure context: HTTPS or localhost */
export const secure = () => typeof window !== 'undefined' && window.isSecureContext === true && !!globalThis.crypto?.subtle

/**
 * What can be said about an endpoint that does not answer, without guessing: a CORS read failed; a "no-cors" request
 * (opaque response) tells whether the server answers anyway. If it does, the site origin is refused (missing CORS
 * headers); otherwise the service is offline or unreachable.
 */
export async function diagnose(url: string): Promise<'cors' | 'offline'> {
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(6000) })
    return 'cors'
  } catch { return 'offline' }
}

/** A fetch error with no response (offline, DNS, CORS, CSP) */
export const isNetErr = (e: unknown) => {
  const m = String((e as Error)?.message ?? '')
  return (e as Error)?.name === 'TypeError' && /fetch|network|load failed/i.test(m)
}
