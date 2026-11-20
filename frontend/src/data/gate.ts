// The Arc check, replayed for real.
// 1. The registration transaction of the proof-chain enclave (/api/proof, registerTx) is read back from Arc:
//    it carries the Intel-signed TDX quote and the enclave's RTMR3 boot event log.
// 2. EnclaveRegistry.replayEventLog(log) replays the log in Solidity (pure read, eth_call, no fee):
//    it returns RTMR3 (48 bytes, SHA-384) and the compose hash.
// 3. EnclaveRegistry.imageIdOf(quote measurements, compose, os) returns the image fingerprint (32 bytes), and
//    ProductRegistry.isWorkloadAllowed(product, fingerprint) tells whether the author allowed it.
// One byte changed in the log: the replayed RTMR3 no longer matches the one Intel signed, the image fingerprint changes
// almost entirely (hash avalanche effect), and Arc does not allow it. Nothing is simulated: three eth_calls.
import { decodeAbiParameters, decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, parseAbi, type Hex } from 'viem'
import { rpc } from './live'
import { C } from './facts'

export const REGISTRY = C.EnclaveRegistry          // deployments.v3.testnet.json (data/facts.ts)
export const PRODUCT_REGISTRY = C.ProductRegistry

const REG_ABI = parseAbi([
  'function registerEnclave(uint256 productId, bytes quote, uint256 anchorR, address signer, bytes32 x25519, bytes eventLog)',
  'function replayEventLog(bytes eventLog) pure returns (bytes rtmr3, bool imageKnown, bytes32 composeHash, bytes32 osImageHash)',
  'function imageIdOf(bytes mrtd, bytes rtmr0, bytes rtmr1, bytes rtmr2, bytes32 composeHash, bytes32 osImageHash, bytes8 xfam, bytes8 tdAttributes) pure returns (bytes32)',
])
const PR_ABI = parseAbi(['function isWorkloadAllowed(uint256 productId, bytes32 workloadId) view returns (bool)'])
// The allowed fingerprint, read on Arc. EnclaveRegistry keeps, for each enclave, the workloadId under which Arc
// admitted it (contracts/src/EnclaveRegistry.sol, _admittedWorkload: the image fingerprint the author allowed in
// ProductRegistry); isWorkloadAllowed confirms the author still allows it
const ENC_ABI = parseAbi([
  'struct Enclave { address signer; bytes32 x25519; uint256 productId; address operator; bytes32 workloadId; bytes6 fmspc; uint8 tcbStatus; bytes32 quoteHash; uint64 anchorBlock; uint64 registeredAt; uint64 expiresAt; bool active; uint64 fromBlock; uint64 untilBlock; }',
  'function enclaveOf(address signer) view returns (Enclave)',
])
const EVENTS = [
  { type: 'bytes32' },
  { type: 'tuple[]', components: [{ name: 'version', type: 'uint8' }, { name: 'name', type: 'bytes' }, { name: 'payload', type: 'bytes' }] },
] as const

const hexToBytes = (h: string) => { const s = h.replace(/^0x/, ''); const b = new Uint8Array(s.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16); return b }
const toHex = (b: Uint8Array) => ('0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')) as Hex

/** Measurements of a TDX v4 quote (48-byte header, then the TD report body). */
function measures(q: Uint8Array) {
  let o = 48 + 16 + 48 + 48 + 8               // teeTcbSvn, mrSeam, mrSignerSeam, seamAttributes
  const take = (n: number) => { const v = toHex(q.slice(o, o + n)); o += n; return v }
  const tdAttributes = take(8), xfam = take(8), mrtd = take(48)
  take(48); take(48); take(48)                 // mrConfigId, mrOwner, mrOwnerConfig
  const rtmr0 = take(48), rtmr1 = take(48), rtmr2 = take(48), rtmr3 = take(48)
  return { tdAttributes, xfam, mrtd, rtmr0, rtmr1, rtmr2, rtmr3 }
}

export interface GateInput {
  tx: Hex; productId: bigint; signedRtmr3: Hex; eventLog: Hex
  m: ReturnType<typeof measures>
  /** Index (in the decoded log) of the compose-hash event, and its payload */
  composeIdx: number; composePayload: Hex
  gasCostUsdc: number | null; block: number | null
  /** Fingerprint allowed by the author, read on Arc (the enclave's workloadId, still allowed), or null */
  allowedId: Hex | null
}
export interface Replay {
  rtmr3: Hex; imageKnown: boolean; composeHash: Hex; imageId: Hex; allowed: boolean; ms: number; at: number | null
}

// Evaluated at a given block when known: the page shows that block ("simulated at block N, no transaction")
const call = (to: string, data: Hex, at?: number) => rpc<Hex>('eth_call', [{ to, data }, at ? '0x' + at.toString(16) : 'latest'])

export async function loadGate(registerTx: string): Promise<GateInput> {
  const tx = await rpc<{ input: Hex; blockNumber: string }>('eth_getTransactionByHash', [registerTx])
  const { args } = decodeFunctionData({ abi: REG_ABI, data: tx.input })
  const [productId, quote, , signer, , eventLog] = args as readonly [bigint, Hex, bigint, Hex, Hex, Hex]
  const m = measures(hexToBytes(quote))
  const [, events] = decodeAbiParameters(EVENTS, eventLog)
  const composeIdx = events.findIndex((e) => new TextDecoder().decode(hexToBytes(e.name)) === 'compose-hash')
  let gasCostUsdc: number | null = null
  try {
    const rc = await rpc<{ gasUsed: string; effectiveGasPrice: string }>('eth_getTransactionReceipt', [registerTx])
    gasCostUsdc = Number(BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice)) / 1e18   // Arc gas is paid in USDC (18 decimals)
  } catch { /* unknown cost, shown as such */ }
  let allowedId: Hex | null = null
  try {
    const out = await call(REGISTRY, encodeFunctionData({ abi: ENC_ABI, functionName: 'enclaveOf', args: [signer] }))
    const e = decodeFunctionResult({ abi: ENC_ABI, functionName: 'enclaveOf', data: out }) as { workloadId: Hex; productId: bigint }
    const ok = await call(PRODUCT_REGISTRY, encodeFunctionData({ abi: PR_ABI, functionName: 'isWorkloadAllowed', args: [e.productId, e.workloadId] }))
    if (e.productId === productId && decodeAbiParameters([{ type: 'bool' }], ok)[0]) allowedId = e.workloadId
  } catch { /* not read: a single line, nothing made up */ }
  return {
    allowedId,
    tx: registerTx as Hex, productId, signedRtmr3: m.rtmr3, eventLog, m, composeIdx,
    composePayload: events[composeIdx]?.payload as Hex, gasCostUsdc, block: tx.blockNumber ? parseInt(tx.blockNumber, 16) : null,
  }
}

/** The log with one byte changed in the compose-hash payload (byte `at`, one bit flipped), or unchanged. */
export function journal(g: GateInput, flip: number | null): Hex {
  if (flip === null || g.composeIdx < 0) return g.eventLog
  const [fmt, events] = decodeAbiParameters(EVENTS, g.eventLog)
  const list = events.map((e) => ({ version: e.version, name: e.name, payload: e.payload }))
  const p = hexToBytes(list[g.composeIdx].payload); p[flip] ^= 0x01
  list[g.composeIdx] = { ...list[g.composeIdx], payload: toHex(p) }
  return encodeAbiParameters(EVENTS, [fmt, list])
}

export async function replay(g: GateInput, flip: number | null, at?: number): Promise<Replay> {
  const t0 = performance.now()
  const out = await call(REGISTRY, encodeFunctionData({ abi: REG_ABI, functionName: 'replayEventLog', args: [journal(g, flip)] }), at)
  const [rtmr3, imageKnown, composeHash, osImageHash] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bool' }, { type: 'bytes32' }, { type: 'bytes32' }], out) as [Hex, boolean, Hex, Hex]
  const idOut = await call(REGISTRY, encodeFunctionData({
    abi: REG_ABI, functionName: 'imageIdOf',
    args: [g.m.mrtd, g.m.rtmr0, g.m.rtmr1, g.m.rtmr2, composeHash, osImageHash, g.m.xfam as Hex, g.m.tdAttributes as Hex],
  }), at)
  const imageId = decodeAbiParameters([{ type: 'bytes32' }], idOut)[0] as Hex
  const okOut = await call(PRODUCT_REGISTRY, encodeFunctionData({ abi: PR_ABI, functionName: 'isWorkloadAllowed', args: [g.productId, imageId] }), at)
  const allowed = decodeAbiParameters([{ type: 'bool' }], okOut)[0] as boolean
  return { rtmr3, imageKnown, composeHash, imageId, allowed: allowed && rtmr3.toLowerCase() === g.signedRtmr3.toLowerCase(), ms: Math.round(performance.now() - t0), at: at ?? null }
}

export const bytesOf = (h?: string | null) => (h ? Array.from(hexToBytes(h)) : [])
export const diffCount = (a: string, b: string) => { const x = bytesOf(a), y = bytesOf(b); let n = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) n++; return n }
