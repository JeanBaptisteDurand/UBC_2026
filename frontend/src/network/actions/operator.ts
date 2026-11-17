// The operator side, ported from the console (web/src/screens/Operator.tsx, Keys.tsx, operatorActions.ts, api.ts):
// - paired machines (public view, then the full view behind the 10-minute signed read: real names, diagnostics,
//   logs), and their removal (signed EIP-4361 message, no transaction);
// - arcop_ operator keys (create, list, revoke): they report and diagnose, they can neither spend nor withdraw the
//   bond;
// - enclave registration through real DCAP: the SDK reads the machine's attestation (/attest, often behind a
//   trycloudflare tunnel), checks the quote off chain, then registerEnclave (the chain verifies Intel's signature,
//   about 5.7 M gas); and its removal (retire).
import type { Address, Hex } from 'viem'
import { arc, waitOk, UserFacing } from './wallet'
import { apiGet, apiPost, type Machine, type OperatorKey } from './jbapi'
import { signAction, type Signed } from './siwe'
import { isNetErr } from '../../data/endpoints'
import { x } from './strings-x'

const sig = (s: Signed): Signed => ({ address: s.address, message: s.message, signature: s.signature })

export const fetchMachines = (operator: string) => apiGet<Machine[]>(`/machines?operator=${operator}`)
export const fetchMachinesSigned = (s: Signed) => apiPost<Machine[]>('/machines/list', sig(s))
export const fetchMachineDetail = (id: string, s: Signed) => apiPost<Machine>(`/machines/${encodeURIComponent(id)}/detail`, sig(s))
export async function removeMachine(id: string) {
  const s = await signAction({ kind: 'removeMachine', machineId: id })
  return apiPost<{ ok: boolean }>(`/machines/${encodeURIComponent(id)}/remove`, sig(s))
}

export const fetchOperatorKeys = (address: string) => apiGet<OperatorKey[]>(`/operator/keys?address=${address}`)
export const fetchOperatorKeysSigned = (s: Signed) => apiPost<OperatorKey[]>('/operator/keys/list', sig(s))
export async function createOperatorKey(label: string) {
  const s = await signAction({ kind: 'createKey' })
  return apiPost<{ key: string; keyId: string; masked: string }>('/operator/keys', { label, ...sig(s) })
}
export async function revokeOperatorKey(keyId: string) {
  const s = await signAction({ kind: 'revokeKey', keyId })
  return apiPost<{ ok: boolean }>(`/operator/keys/${encodeURIComponent(keyId)}/revoke`, sig(s))
}

export type AdmittedBy = 'image' | 'workload'
/** The console's registerMachineEnclave: the machine's /attest, quote checked, registerEnclave, wait for the block. */
export async function registerMachineEnclave(productId: bigint, enclaveUrl: string, onStep?: (k: 'read' | 'sent', tx?: Hex) => void): Promise<{ tx: Hex; signer: Address; workloadId: Hex; admittedBy: AdmittedBy }> {
  const a = arc()
  const url = enclaveUrl.trim().replace(/\/+$/, '')
  if (!/^https:\/\/\S+$/.test(url)) throw new UserFacing(x('o.reg.badUrl'), 'other')
  onStep?.('read')
  let r: { tx: Hex; signer: Address; x25519: Hex; workloadId: Hex; admittedBy: AdmittedBy }
  try { r = await a.registerEnclave(productId, url) } catch (e) {
    const offline = isNetErr(e) || (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError'
    if (offline) throw new UserFacing(x('o.reg.offline', { url }), 'offline')
    throw e
  }
  onStep?.('sent', r.tx)
  await waitOk(r.tx)
  return { tx: r.tx, signer: r.signer, workloadId: r.workloadId, admittedBy: r.admittedBy }
}

/** Retires an enclave registered by this address (EnclaveRegistry.retire): its bond reserve is released. */
export async function retireEnclave(signer: Address): Promise<Hex> {
  const h = await arc().retireEnclave(signer)
  await waitOk(h)
  return h
}
