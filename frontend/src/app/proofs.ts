// What a service page re-reads on Arc on demand (viem is lazy-loaded with it):
// 1. the author's manifest. The server does not serve manifests with CORS: the app bundles a copy
//    (public/manifests/) and shows it only if keccak256(copy) equals the manifestHash read live on Arc
//    (/api/products). Otherwise: "changed since the copy", with a link to the online manifest. Nothing invented.
// 2. each allowed image digest (the workloadId of the product's enclaves): ProductRegistry.isWorkloadAllowed, a free
//    eth_call on Arc testnet.
import { encodeFunctionData, decodeAbiParameters, keccak256, parseAbi, type Hex } from 'viem'
import { rpc } from '../data/live'
import { C } from '../data/facts'

const PRODUCT_REGISTRY = C.ProductRegistry

/** date of the v2.1 copies (the v3 copy is of 19 November, the v3 stack's publication) */
export const SNAPSHOT_DATE = '2026-11-14'
// the exact bytes served upstream, under a neutral extension (.snapshot): third-party data, not site text. The v2.1
// copies stay for history; the v3 one is the verified bounty's (product 5 on v3), whose keccak256 equals the
// manifestHash of products.5 in deployments.v3.testnet.json (0x54214c4b…010b)
const COPIES: Record<string, string> = {
  'sealed-bounty-refute-demo-v21.json': '/manifests/sealed-bounty-refute-demo-v21.snapshot',
  'sealed-bounty-verified-v21.json': '/manifests/sealed-bounty-verified-v21.snapshot',
  'sealed-bounty-verified-v3.json': '/manifests/sealed-bounty-verified-v3.snapshot',
}
export interface Manifest { state: 'none' | 'ok' | 'changed' | 'unread'; uri?: string; product?: string; summary?: string; image?: string; version?: string }

const cache = new Map<string, Promise<Manifest>>()
export function readManifest(uri: string, hash: string): Promise<Manifest> {
  if (!uri) return Promise.resolve({ state: 'none' })
  const key = `${uri}|${hash}`
  let p = cache.get(key)
  if (!p) {
    p = (async (): Promise<Manifest> => {
      const copy = COPIES[uri.split('/').pop() ?? '']
      if (!copy) return { state: 'unread', uri }
      try {
        const r = await fetch(copy)
        // a missing copy (404) or an HTML fallback page is not a "changed" manifest: unread
        if (!r.ok || /text\/html/.test(r.headers.get('content-type') ?? '')) return { state: 'unread', uri }
        const bytes = new Uint8Array(await r.arrayBuffer())
        if (keccak256(bytes).toLowerCase() !== hash.toLowerCase()) return { state: 'changed', uri }
        const m = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
        return { state: 'ok', uri, product: str(m.product), summary: str(m.summary), image: str(m.image), version: str(m.version) }
      } catch { return { state: 'unread', uri } }
    })()
    cache.set(key, p)
  }
  return p
}
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

const PR_ABI = parseAbi(['function isWorkloadAllowed(uint256 productId, bytes32 workloadId) view returns (bool)'])
const allowedCache = new Map<string, Promise<boolean | null>>()
/** does the author still allow this digest? true, false, or null if Arc did not answer */
export function isAllowed(productId: string, workloadId: string): Promise<boolean | null> {
  const key = `${productId}:${workloadId}`
  let p = allowedCache.get(key)
  if (!p) {
    p = rpc<Hex>('eth_call', [{ to: PRODUCT_REGISTRY, data: encodeFunctionData({ abi: PR_ABI, functionName: 'isWorkloadAllowed', args: [BigInt(productId), workloadId as Hex] }) }, 'latest'])
      .then((out) => decodeAbiParameters([{ type: 'bool' }], out)[0] as boolean)
      .catch(() => { allowedCache.delete(key); return null })
    allowedCache.set(key, p)
  }
  return p
}
