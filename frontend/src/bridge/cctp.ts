// CCTP V2 toward Arc testnet: the verified addresses, then the three steps of a transfer (burn on the source chain,
// Circle's attestation, mint on Arc). viem only and no DOM, so the bridge page and a Node script run the same code.
//
// Every address below was VERIFIED on 19/11/2026 (about 21:15 UTC), on-chain with cast on each chain's public RPC,
// against Circle's CCTP V2 testnet table (developers.circle.com, CCTP, EVM contracts and interfaces):
//  - TokenMessengerV2 0x8FE6…2DAA and MessageTransmitterV2 0xE737…E275 have code on Ethereum Sepolia, Base Sepolia
//    and Arc testnet (also on Arbitrum Sepolia, OP Sepolia and Avalanche Fuji, not offered here: their RPCs are not in
//    the site's CSP). TokenMessengerV2.localMessageTransmitter() returns 0xE737…E275 on each chain;
//    MessageTransmitterV2.localDomain() returns 0 on Ethereum Sepolia, 6 on Base Sepolia, 26 on Arc testnet;
//    MessageTransmitterV2.version() returns 1 (CCTP V2).
//  - The implementations behind both proxies (EIP-1967 slot) hold the selectors used here: depositForBurn 0x8e0250ee,
//    receiveMessage 0x57ecfd28, usedNonces 0xfeb61724. usedNonces(nonce) read 1 on Arc for a real Sepolia message
//    already received, 0 for an unknown nonce.
//  - USDC: symbol() "USDC" and decimals() 6 at each address below (on Arc, 0x3600…0000 is the ERC-20 face of the
//    native gas token, which itself counts 18 decimals).
//  - Iris sandbox (https://iris-api-sandbox.circle.com): /v2/burn/USDC/fees/{0|6}/26 answered a fast fee
//    (threshold 1000) of 1 bp from Ethereum Sepolia and 1.3 bp from Base Sepolia, 0 for standard (2000); CORS "*";
//    /v2/messages/0?transactionHash=… returned a real Sepolia to Arc message whose layout matches decodeMessage below.
//
// Every transfer here is a STANDARD one, free, 1 USDC burned = 1 USDC minted (VERIFIED 19/11/2026, about 21:50 UTC):
//  - developers.circle.com/cctp/concepts/fees: "For USDC, CCTP charges fees on Fast Transfers only. Standard Transfers
//    are free." Iris /v2/burn/USDC/fees/0/26 and /6/26 again gave minimumFee 0 at threshold 2000.
//  - On-chain, TokenMessengerV2 on Ethereum Sepolia and Base Sepolia has no fee switch: getMinFeeAmount(uint256) and
//    minFee() revert there (the older contract, as Circle's table says for Ethereum and Base), so nothing enforces a
//    minimum fee on a burn; on Arc minFee() and getMinFeeAmount(1e6) return 0.
//  - So the burn sets maxFee 0 and minFinalityThreshold 2000 (finalized): Circle may keep nothing, and the mint on Arc
//    (handleReceiveFinalizedMessage) gives the recipient the whole amount.
//  - The price is time: Circle attests once the burn is final. developers.circle.com/cctp/concepts/finality-and-block-
//    confirmations gives about 65 blocks, 15 to 19 minutes, from Ethereum; from Base, 15 to 19 minutes after Base has
//    posted its batch to Ethereum, which it does about every 15 minutes (so up to about 35).
import { createPublicClient, http, pad, parseAbi, type Address, type Chain, type Hex, type PublicClient, type WalletClient } from 'viem'
import { sepolia, baseSepolia } from 'viem/chains'

export const TOKEN_MESSENGER_V2: Address = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
export const MESSAGE_TRANSMITTER_V2: Address = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
export const IRIS = 'https://iris-api-sandbox.circle.com'
export const ARC_DOMAIN = 26
/** standard transfer: Circle attests once the burn is final (the only kind this page sends: free); FAST only names
 *  the threshold of a fast transfer, which an older saved transfer may carry */
export const FAST = 1000, STANDARD = 2000

const arcChain: Chain = {
  id: 5042002, name: 'Arc testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://explorer.testnet.arc.io' } },
}

export interface Net {
  key: 'eth-sepolia' | 'base-sepolia' | 'arc'
  name: string
  chainId: number
  domain: number
  /** the RPC the page reads with (it must be in the site's CSP connect-src) */
  rpc: string
  /** the RPC handed to a wallet that does not know the network yet (wallet_addEthereumChain) */
  walletRpc: string
  usdc: Address
  explorer: string
  /** the gas token's symbol */
  gas: string
  chain: Chain
  /** Circle's usual wait for a standard transfer from this chain, in minutes (finality, then the attestation), and
   *  the longest usual one */
  wait?: { from: number; to: number; upTo: number }
}

export const ARC: Net = { key: 'arc', name: 'Arc testnet', chainId: 5042002, domain: ARC_DOMAIN, rpc: 'https://rpc.testnet.arc.io', walletRpc: 'https://rpc.testnet.arc.io', usdc: '0x3600000000000000000000000000000000000000', explorer: 'https://explorer.testnet.arc.io', gas: 'USDC', chain: arcChain }
export const SOURCES: Net[] = [
  { key: 'eth-sepolia', name: 'Ethereum Sepolia', chainId: 11155111, domain: 0, rpc: 'https://ethereum-sepolia-rpc.publicnode.com', walletRpc: 'https://ethereum-sepolia-rpc.publicnode.com', usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', explorer: 'https://sepolia.etherscan.io', gas: 'ETH', chain: sepolia, wait: { from: 15, to: 19, upTo: 19 } },
  { key: 'base-sepolia', name: 'Base Sepolia', chainId: 84532, domain: 6, rpc: 'https://base-sepolia-rpc.publicnode.com', walletRpc: 'https://sepolia.base.org', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', explorer: 'https://sepolia.basescan.org', gas: 'ETH', chain: baseSepolia, wait: { from: 15, to: 19, upTo: 35 } },
]
export const netByKey = (k?: string | null) => [...SOURCES, ARC].find((n) => n.key === k)
export const txLink = (n: Net, h?: string | null) => (h ? `${n.explorer}/tx/${h}` : undefined)

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
])
const TM = parseAbi(['function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)'])
const MT = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
  'function usedNonces(bytes32) view returns (uint256)',
])

// ---------- reading ----------
const rpcOver: Partial<Record<Net['key'], string>> = {}
/** another RPC URL for one network (the page reads Arc through the site's own RPC setting) */
export function setRpc(k: Net['key'], url: string) { rpcOver[k] = url; pubs.delete(k) }
const pubs = new Map<string, PublicClient>()
export function reader(n: Net): PublicClient {
  let c = pubs.get(n.key)
  if (!c) { c = createPublicClient({ chain: n.chain, transport: http(rpcOver[n.key] ?? n.rpc, { retryCount: 2, timeout: 20_000 }) }) as PublicClient; pubs.set(n.key, c) }
  return c
}
/** USDC in 6-decimal units */
export const usdcOf = (n: Net, who: Address) => reader(n).readContract({ address: n.usdc, abi: ERC20, functionName: 'balanceOf', args: [who] }) as Promise<bigint>
/** the gas token in wei (18 decimals, Arc included) */
export const gasOf = (n: Net, who: Address) => reader(n).getBalance({ address: who })

/** Circle's standard-transfer fee from this source to Arc, in basis points, read from Iris (0 on 19/11/2026; null:
 *  not read). The page reads it only to check its "free" line; the burn itself never lets Circle keep anything. */
export async function standardFeeBps(src: Net): Promise<number | null> {
  const r = await fetch(`${IRIS}/v2/burn/USDC/fees/${src.domain}/${ARC_DOMAIN}`)
  if (!r.ok) return null
  const j = (await r.json()) as { finalityThreshold: number; minimumFee: number }[]
  const f = Array.isArray(j) ? j.find((x) => x.finalityThreshold === STANDARD) : undefined
  return typeof f?.minimumFee === 'number' ? f.minimumFee : null
}

// ---------- step 1, on the source chain ----------
const acct = (w: WalletClient) => { if (!w.account) throw new Error('wallet without account'); return w.account }
/** approves TokenMessengerV2 for `amount` if the allowance is short; the hash, or null when nothing was needed */
export async function approveIfNeeded(w: WalletClient, src: Net, amount: bigint): Promise<Hex | null> {
  const a = acct(w)
  const have = (await reader(src).readContract({ address: src.usdc, abi: ERC20, functionName: 'allowance', args: [a.address, TOKEN_MESSENGER_V2] })) as bigint
  if (have >= amount) return null
  return w.writeContract({ account: a, chain: src.chain, address: src.usdc, abi: ERC20, functionName: 'approve', args: [TOKEN_MESSENGER_V2, amount] })
}
/** the depositForBurn arguments of a standard, free transfer: `amount` toward Arc for `recipient`, anyone may relay
 *  it (destinationCaller zero), Circle may keep nothing (maxFee 0), attested once final (threshold 2000) */
export function burnArgs(src: Net, amount: bigint, recipient: Address) {
  return [amount, ARC_DOMAIN, pad(recipient, { size: 32 }), src.usdc, pad('0x00', { size: 32 }), 0n, STANDARD] as const
}
/** burns `amount` on the source chain toward Arc, standard and free; the mint goes to `recipient` on Arc */
export function burn(w: WalletClient, src: Net, amount: bigint, recipient: Address): Promise<Hex> {
  return w.writeContract({ account: acct(w), chain: src.chain, address: TOKEN_MESSENGER_V2, abi: TM, functionName: 'depositForBurn', args: burnArgs(src, amount, recipient) })
}
/** waits for a transaction; throws `reverted` when the chain refused it */
export async function confirmed(n: Net, hash: Hex) {
  const r = await reader(n).waitForTransactionReceipt({ hash, timeout: 600_000, pollingInterval: 3_000 })
  if (r.status !== 'success') { const e = new Error('reverted'); e.name = 'Reverted'; throw e }
  return r
}

// ---------- step 2, Circle's attestation ----------
export interface Attested { status: 'unknown' | 'pending' | 'complete'; message?: Hex; attestation?: Hex; mintTx?: Hex; delay?: string | null }
/** Iris v2: the message of a burn and its attestation (unknown: not indexed yet, which lasts a few seconds) */
export async function attestation(src: Net, burnHash: Hex): Promise<Attested> {
  const r = await fetch(`${IRIS}/v2/messages/${src.domain}?transactionHash=${burnHash}`)
  if (r.status === 404) return { status: 'unknown' }
  if (!r.ok) throw new Error(`Iris HTTP ${r.status}`)
  const m = ((await r.json()) as { messages?: { status?: string; message?: string; attestation?: string; destinationMintTxHash?: string; delayReason?: string | null }[] }).messages?.[0]
  if (!m) return { status: 'unknown' }
  const done = m.status === 'complete' && /^0x[0-9a-f]+$/i.test(m.attestation ?? '') && /^0x[0-9a-f]+$/i.test(m.message ?? '')
  return { status: done ? 'complete' : 'pending', message: done ? (m.message as Hex) : undefined, attestation: done ? (m.attestation as Hex) : undefined, mintTx: /^0x[0-9a-f]{64}$/i.test(m.destinationMintTxHash ?? '') ? (m.destinationMintTxHash as Hex) : undefined, delay: m.delayReason ?? null }
}

/** the CCTP V2 message and its burn body (header 148 bytes: version, domains, nonce, sender, recipient, caller,
 *  finality thresholds; body: version, burnToken, mintRecipient, amount, sender, maxFee, feeExecuted, expiration) */
export function decodeMessage(m: Hex) {
  const h = m.slice(2)
  const at = (byte: number, len: number) => h.slice(byte * 2, (byte + len) * 2)
  const B = 148
  return {
    sourceDomain: parseInt(at(4, 4), 16),
    destinationDomain: parseInt(at(8, 4), 16),
    nonce: `0x${at(12, 32)}` as Hex,
    mintRecipient: `0x${at(B + 36 + 12, 20)}` as Address,
    amount: BigInt(`0x${at(B + 68, 32)}`),
    maxFee: BigInt(`0x${at(B + 132, 32)}`),
    feeExecuted: BigInt(`0x${at(B + 164, 32)}`),
  }
}

// ---------- step 3, on Arc ----------
/** true once this message was received on Arc (by the visitor or anyone else) */
export async function received(message: Hex): Promise<boolean> {
  const n = (await reader(ARC).readContract({ address: MESSAGE_TRANSMITTER_V2, abi: MT, functionName: 'usedNonces', args: [decodeMessage(message).nonce] })) as bigint
  return n !== 0n
}
/** mints on Arc: receiveMessage with the message and Circle's attestation, signed by the visitor */
export function mint(w: WalletClient, message: Hex, att: Hex): Promise<Hex> {
  return w.writeContract({ account: acct(w), chain: ARC.chain, address: MESSAGE_TRANSMITTER_V2, abi: MT, functionName: 'receiveMessage', args: [message, att] })
}
/** the same call, simulated (no signature): reverts if Arc would refuse it */
export function simulateMint(from: Address, message: Hex, att: Hex) {
  return reader(ARC).simulateContract({ account: from, address: MESSAGE_TRANSMITTER_V2, abi: MT, functionName: 'receiveMessage', args: [message, att] })
}
