// Arc reads for the Rent and Publish pages, as free eth_calls: each operator's bond (OperatorBond) and the products'
// protection delay (ProductRegistry.timelock). viem is loaded with these pages.
import { encodeFunctionData, decodeFunctionResult, parseAbi, type Hex } from 'viem'
import { rpc } from '../data/live'
import { C } from '../data/facts'

const PRODUCT_REGISTRY = C.ProductRegistry
export const OPERATOR_BOND = C.OperatorBond // deployments.v3.testnet.json (data/facts.ts)
const BOND_ABI = parseAbi([
  'function bondOf(address operator) view returns (uint256)',
  'function freeBond(address operator) view returns (uint256)',
  'function reservedTotal(address operator) view returns (uint256)',
  'function agentIdOf(address operator) view returns (uint256)',
])
const PR_ABI = parseAbi(['function timelock() view returns (uint64)'])
type BondFn = 'bondOf' | 'freeBond' | 'reservedTotal' | 'agentIdOf'
const read = async (fn: BondFn, op: string) => {
  const out = await rpc<Hex>('eth_call', [{ to: OPERATOR_BOND, data: encodeFunctionData({ abi: BOND_ABI, functionName: fn, args: [op as Hex] }) }, 'latest'])
  return decodeFunctionResult({ abi: BOND_ABI, functionName: fn, data: out }) as bigint
}
export interface Bond { op: string; bond: bigint; free: bigint; reserved: bigint; agent: bigint }
/** bond of the given operators, read on Arc; null for an operator Arc did not return */
export async function readBonds(ops: string[]): Promise<(Bond | null)[]> {
  return Promise.all(ops.map(async (op) => {
    try {
      const [bond, free, reserved, agent] = await Promise.all([read('bondOf', op), read('freeBond', op), read('reservedTotal', op), read('agentIdOf', op)])
      return { op, bond, free, reserved, agent }
    } catch { return null }
  }))
}
export async function readTimelock(): Promise<number | null> {
  try {
    const out = await rpc<Hex>('eth_call', [{ to: PRODUCT_REGISTRY, data: encodeFunctionData({ abi: PR_ABI, functionName: 'timelock' }) }, 'latest'])
    return Number(decodeFunctionResult({ abi: PR_ABI, functionName: 'timelock', data: out }))
  } catch { return null }
}
