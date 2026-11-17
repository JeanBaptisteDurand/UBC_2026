// Actual state of enclaves and operators, read on Arc in a single eth_call (Multicall3.aggregate3), with no fee:
// for each signer, EnclaveRegistry.killed (invalidated with no grace: its image was retired by the author) and
// EnclaveRegistry.enclaveOf().active (false after a retirement by the operator or an invalidation); for each
// operator, OperatorBond.banned (true only after its whole bond was seized, OperatorBond.slash).
// The API's window of the last 100 events is not enough: a slash a few days old falls out of it.
// Lazy-loaded (viem) by live.ts; a failed read keeps the previous one.
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from 'viem'
import { rpc } from './live'
import { C } from './facts'

const MC_ABI = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
])
const REG_ABI = parseAbi([
  'function killed(address signer) view returns (bool)',
  'struct Enclave { address signer; bytes32 x25519; uint256 productId; address operator; bytes32 workloadId; bytes6 fmspc; uint8 tcbStatus; bytes32 quoteHash; uint64 anchorBlock; uint64 registeredAt; uint64 expiresAt; bool active; uint64 fromBlock; uint64 untilBlock; }',
  'function enclaveOf(address signer) view returns (Enclave)',
])
const BOND_ABI = parseAbi(['function banned(address operator) view returns (bool)'])

/** Lowercase keys; a missing value was not read (never "false" by default) */
export interface ChainState {
  at: number
  killed: Record<string, boolean>
  /** enclaveOf(signer).active: false after a retirement or an invalidation (a merely expired window stays true) */
  active: Record<string, boolean>
  banned: Record<string, boolean>
}

export async function readChainState(signers: string[], operators: string[]): Promise<ChainState> {
  const S = [...new Set(signers.map((s) => s.toLowerCase()))], O = [...new Set(operators.map((o) => o.toLowerCase()))]
  const calls = [
    ...S.flatMap((s) => [
      { target: C.EnclaveRegistry, allowFailure: true, callData: encodeFunctionData({ abi: REG_ABI, functionName: 'killed', args: [s as Hex] }) },
      { target: C.EnclaveRegistry, allowFailure: true, callData: encodeFunctionData({ abi: REG_ABI, functionName: 'enclaveOf', args: [s as Hex] }) },
    ]),
    ...O.map((o) => ({ target: C.OperatorBond, allowFailure: true, callData: encodeFunctionData({ abi: BOND_ABI, functionName: 'banned', args: [o as Hex] }) })),
  ] as const
  const out = await rpc<Hex>('eth_call', [{ to: C.Multicall3, data: encodeFunctionData({ abi: MC_ABI, functionName: 'aggregate3', args: [calls] }) }, 'latest'])
  const res = decodeFunctionResult({ abi: MC_ABI, functionName: 'aggregate3', data: out })
  const st: ChainState = { at: Date.now(), killed: {}, active: {}, banned: {} }
  S.forEach((s, i) => {
    const k = res[i * 2], e = res[i * 2 + 1]
    if (k?.success) st.killed[s] = decodeFunctionResult({ abi: REG_ABI, functionName: 'killed', data: k.returnData }) as boolean
    if (e?.success) st.active[s] = (decodeFunctionResult({ abi: REG_ABI, functionName: 'enclaveOf', data: e.returnData }) as { active: boolean }).active
  })
  O.forEach((o, j) => {
    const b = res[S.length * 2 + j]
    if (b?.success) st.banned[o] = decodeFunctionResult({ abi: BOND_ABI, functionName: 'banned', data: b.returnData }) as boolean
  })
  return st
}
