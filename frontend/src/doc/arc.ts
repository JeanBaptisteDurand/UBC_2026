// The verified level's product on Arc (product 5 on v3, 7 on v2.1), read live with free eth_calls (no wallet), for the
// Doc's live lines: is its settlement contract authorized by OperatorBond (it can then pay and seize bonds) and by
// VerdictLog (it can write ERC-8004 verdicts), and which of its bounties are open. The verified level's bounties
// (SealedBountyVerified) are not in /api/bounties, so they are read here. Selectors: isSettlement(address) 0xee7f41c2,
// settlementApplyAt(address) 0xca398188, isCaller(address) 0x7ac07dcc, bountyCount() 0x3e362c96, getBounty(uint256)
// 0xee8c4bbf.
import { useEffect, useState } from 'react'
import { rpc } from '../data/live'
import { C } from '../data/facts'

/** OperatorBond and VerdictLog (the ERC-8004 verdict log) of the v3 stack (deployments.v3.testnet.json, data/facts.ts) */
const ADDR = { OperatorBond: C.OperatorBond, VerdictLog: C.VerdictLog }

const word = (a: string) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
async function call(to: string, selector: string, arg: string): Promise<bigint> {
  const out = await rpc<string>('eth_call', [{ to, data: selector + word(arg) }, 'latest'])
  if (typeof out !== 'string' || out.length < 66) throw new Error('empty')
  return BigInt(out.slice(0, 66))
}

/** a bounty read on Arc: its id, its pool (USDC base units) and its deadline (unix seconds) */
export interface OpenBounty { id: string; balance: string; deadline: number }
/** The open bounties of a sealed-bounty contract, read on Arc (bountyCount() 0x3e362c96, then getBounty(id) 0xee8c4bbf
 *  for the last ten: a static tuple, word 7 the deadline, 8 the pool, 9 paused). The verified level's bounties
 *  (SealedBountyVerified, product 5 on v3) are not in /api/bounties, so they are read here. Open: not paused, before its
 *  deadline, with a pool. undefined while reading, null when Arc did not answer. */
export function useOpenBounties(contract: string, on = true): OpenBounty[] | null | undefined {
  const [v, setV] = useState<OpenBounty[] | null | undefined>(undefined)
  useEffect(() => {
    if (!on) return
    let alive = true
    const words = (hex: string) => (hex.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt(`0x${w}`))
    rpc<string>('eth_call', [{ to: contract, data: '0x3e362c96' }, 'latest'])
      .then(async (n) => {
        const count = Number(BigInt(n))
        const ids = Array.from({ length: Math.min(count, 10) }, (_, i) => count - i)
        const all = await Promise.all(ids.map((id) => rpc<string>('eth_call', [{ to: contract, data: `0xee8c4bbf${word(`0x${id.toString(16)}`)}` }, 'latest'])))
        const now = Date.now() / 1000
        const open = all.map((hex, i) => ({ id: String(ids[i]), w: words(hex) }))
          .filter((x) => x.w.length >= 13 && x.w[9] === 0n && Number(x.w[7]) > now && x.w[8] > 0n)
          .map((x) => ({ id: x.id, balance: x.w[8].toString(), deadline: Number(x.w[7]) }))
        if (alive) setV(open)
      })
      .catch(() => { if (alive) setV(null) })
    return () => { alive = false }
  }, [contract, on])
  return v
}

export interface SettlementAuth { settlement: boolean; caller: boolean; applyAt: number }
/** undefined while reading, null when Arc did not answer */
export function useSettlementAuth(settlement: string, on = true): SettlementAuth | null | undefined {
  const [v, setV] = useState<SettlementAuth | null | undefined>(undefined)
  useEffect(() => {
    if (!on) return
    let alive = true
    Promise.all([
      call(ADDR.OperatorBond, '0xee7f41c2', settlement),
      call(ADDR.VerdictLog, '0x7ac07dcc', settlement),
      call(ADDR.OperatorBond, '0xca398188', settlement),
    ])
      .then(([s, c, at]) => { if (alive) setV({ settlement: s !== 0n, caller: c !== 0n, applyAt: Number(at) }) })
      .catch(() => { if (alive) setV(null) })
    return () => { alive = false }
  }, [settlement, on])
  return v
}
