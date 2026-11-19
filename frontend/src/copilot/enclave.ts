// AskHive in its enclave (JB's attested site copilot, 19/11, kept by the owner): the conversation goes to the copilot
// that runs in an Intel TDX enclave registered on Arc (product 4, …/enclave/copilot-site behind the API's nginx).
// - Before anything is sent, the SDK client checks the enclave key on Arc (signer registered for this product, X25519
//   key of /pubkeys = the registered one, enclave active, product active, image still allowed). A key that does not
//   match: nothing is sent.
// - The conversation is sealed to that key (HPKE, ARC-COPILOT-CHAT-v1) and only a reply sealed for this request is
//   accepted: the web server that relays it cannot read or change it.
// - Sealing needs a secure page (HTTPS, WebCrypto) on the enclave's origin (its CORS lets only that origin post). On
//   any other page (the station's preview over HTTP), the key is still checked and shown, but the conversation goes
//   to the ArcHive server copilot and the badge says so: no "sealed" claim that is not true.
import { useSyncExternalStore } from 'react'
import type { Address } from 'viem'
import { createAttestedCopilotClient, testnet, EnclaveKeyMismatchError, type AttestedCopilotClient, type VerifiedCopilot, type CopilotMessage } from '../network/actions/sdk'
import { publicClient } from '../network/actions/wallet'
import { ENCLAVE, PRODUCT, COPILOT_OPERATOR, abs, secure } from '../data/endpoints'

export type EncStatus = 'idle' | 'checking' | 'on' | 'clear' | 'off'
export interface EncState {
  /** on: key verified and the conversation sealed to it; clear: key verified but this page cannot seal (HTTP or another
   *  origin); off: the key could not be verified (unreachable or mismatch) */
  status: EncStatus
  keys?: VerifiedCopilot
  /** why the key was not verified (mismatch reason or unreachable) */
  why?: string
}

let st: EncState = { status: 'idle' }
const subs = new Set<() => void>()
const set = (v: EncState) => { st = v; subs.forEach((f) => f()) }
export const getEnc = () => st
export function useEnc(): EncState { return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => st) }

/** the enclave copilot's URL (absolute, the SDK reads `${url}/pubkeys`) */
export const encUrl = () => abs(ENCLAVE.copilotSite)
/** the conversation can be sealed here: a secure page on the enclave's origin */
export const canSeal = () => secure() && new URL(encUrl()).origin === location.origin

let client: AttestedCopilotClient | null = null
function attested(): AttestedCopilotClient {
  client ??= createAttestedCopilotClient({
    copilotUrl: encUrl(), productId: PRODUCT.copilot, publicClient: publicClient() as never, deployment: testnet,
    ...(COPILOT_OPERATOR ? { expectedOperator: COPILOT_OPERATOR as Address } : {}),
  })
  return client
}

let inflight: Promise<void> | null = null
/** reads the copilot's enclave key on Arc (again with force) and sets the badge */
export function checkEnclave(force = false): Promise<void> {
  if (inflight && !force) return inflight
  if (!force && (st.status === 'on' || st.status === 'clear')) return Promise.resolve()
  set({ status: 'checking', keys: st.keys })
  inflight = attested().verifiedKeys(force)
    .then((keys) => set({ status: canSeal() ? 'on' : 'clear', keys }))
    .catch((e) => set({ status: 'off', why: e instanceof EnclaveKeyMismatchError ? 'mismatch' : 'unreachable' }))
    .finally(() => { inflight = null })
  return inflight
}

export type SealedAnswer = { ok: true; reply: Record<string, unknown> } | { ok: false; text: string }
/** one exchange with the enclave, sealed; null when this page cannot seal (the caller then uses the server copilot) */
export async function askSealed(messages: CopilotMessage[], user: string | null, lang: 'en' | 'fr'): Promise<SealedAnswer | null> {
  if (!canSeal()) return null
  try {
    const r = await attested().chat({ messages, user, lang })
    if (r.authenticated) set({ status: 'on', keys: r.enclave })
    return r.ok ? { ok: true, reply: r.reply as unknown as Record<string, unknown> } : { ok: false, text: r.reply.text }
  } catch (e) {
    // a key that does not match Arc: nothing was sent, and nothing is sent elsewhere either
    if (e instanceof EnclaveKeyMismatchError) { set({ status: 'off', why: 'mismatch' }); return { ok: false, text: e.message } }
    throw e
  }
}
