// The ATTESTED copilot and prepared actions, engine side (viem, SDK), ported from the console
// (web/src/copilot.ts, screens/FloatingCopilot.tsx, screens/CopilotActions.tsx):
// - the SDK client (createAttestedCopilotClient) checks the copilot key on Arc (product 4, active at the expected
//   operator), encrypts the conversation to it and only accepts a response sealed for THIS request. It goes through
//   …/enclave/copilot: nginx adds the proxy token there, without which the enclave refuses (proxy_required);
// - "prepare, then sign": the copilot prepares an action (it never spends), the page shows it with its checks, and the
//   visitor's wallet signs. A failed check blocks signing.
import type { Address, Hex } from 'viem'
import { createAttestedCopilotClient, testnet, type AttestedCopilotClient, type CopilotChatResult, type CopilotMessage } from './sdk'
import { arc, publicClient, requireSecure, waitOk } from './wallet'
import { ENCLAVE, PRODUCT, COPILOT_OPERATOR, abs } from '../../data/endpoints'
import { openSession } from './sessions'
import { registerMachineEnclave } from './operator'
import { createBountyRaw } from './bounty'
import type { PreparedAction } from './copilot-chat'

let client: AttestedCopilotClient | null = null
/** The attested copilot client, or null if it is not configured (no expected operator). */
export function attestedCopilot(): AttestedCopilotClient | null {
  if (!COPILOT_OPERATOR) return null
  requireSecure()
  client ??= createAttestedCopilotClient({
    copilotUrl: abs(ENCLAVE.copilot), productId: PRODUCT.copilot, publicClient: publicClient() as never,
    deployment: testnet, expectedOperator: COPILOT_OPERATOR as Address,
  })
  return client
}
export async function askAttested(messages: CopilotMessage[], user: string | null, lang: 'en' | 'fr'): Promise<CopilotChatResult> {
  const c = attestedCopilot()
  if (!c) throw new Error('attested copilot not configured')
  return c.chat({ messages, user, lang })
}

/** Signs an action prepared by the copilot; returns the transaction and, for a session, the aek_ key (shown once). */
export async function runPrepared(a: PreparedAction): Promise<{ tx: Hex; aek?: string; label: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = a.result ?? {}
  if (a.tool === 'session_prepare_open') {
    const p = r.openSessionParams
    const secs = Math.max(3600, Number(p.expiresAt) - Math.floor(Date.now() / 1000))
    const o = await openSession({ productId: BigInt(p.productId), deposit: BigInt(p.deposit), url: abs(ENCLAVE.inference), hours: secs / 3600, enclave: p.enclave, operator: p.operator })
    return { tx: o.tx, aek: o.aek, label: `session ${o.id}` }
  }
  if (a.tool === 'operator_prepare_bond') {
    const h = await arc().bond(BigInt(r.voieA_uneTransaction.args.amount), 'auth')
    await waitOk(h)
    return { tx: h, label: 'bond' }
  }
  if (a.tool === 'operator_prepare_register') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = await registerMachineEnclave(BigInt(r.produit.id), String((a.input as any).enclaveUrl))
    return { tx: o.tx, label: `enclave ${o.signer}` }
  }
  if (a.tool === 'bounty_prepare_create') {
    const o = await createBountyRaw(r.createBountyParams)
    return { tx: o.tx, label: `bounty ${o.bountyId}` }
  }
  throw new Error(`unknown action ${a.tool}`)
}
