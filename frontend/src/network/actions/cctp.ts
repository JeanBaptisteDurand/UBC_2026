// CCTP: the wallet's real USDC balances on the other chains, read with the SDK's readUsdcBalances.
// OTHER_CHAINS holds each chain's public RPC, testnet USDC address and CCTP TokenMessengerV2.
// Read-only, chain by chain, and only after the wallet is connected. The bridge (the SDK's bridgeToArc) is wired but
// has never run end to end: the page does not call it.
import type { Address } from 'viem'
import { readUsdcBalances, type CctpChain } from './sdk'

const CCTP_TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as const
export const OTHER_CHAINS: CctpChain[] = [
  { key: 'eth-sepolia', name: 'Ethereum Sepolia', chainId: 11155111, rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com', usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', cctpDomain: 0, tokenMessenger: CCTP_TOKEN_MESSENGER },
  { key: 'base-sepolia', name: 'Base Sepolia', chainId: 84532, rpcUrl: 'https://base-sepolia-rpc.publicnode.com', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', cctpDomain: 6, tokenMessenger: CCTP_TOKEN_MESSENGER },
]

export type ChainRow = { key: string; name: string; domain: number; balance?: bigint; error?: string }
export async function readOtherChains(owner: Address, each: (r: ChainRow) => void) {
  await Promise.all(OTHER_CHAINS.map(async (c) => {
    try { const [r] = await readUsdcBalances([c], owner); each({ key: c.key, name: c.name, domain: c.cctpDomain, balance: r.balance }) }
    catch (e) {
      let why = 'RPC'
      for (let x: any = e, n = 0; x && n < 8; x = x.cause, n++) if (x?.name === 'HttpRequestError') { why = x.status ? `HTTP ${x.status}` : 'RPC'; break } // eslint-disable-line @typescript-eslint/no-explicit-any
      each({ key: c.key, name: c.name, domain: c.cctpDomain, error: why })
    }
  }))
}
