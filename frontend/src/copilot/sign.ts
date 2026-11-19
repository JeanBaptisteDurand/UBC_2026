// Signs what the copilot prepared (loaded only when signing: viem and the SDK weigh down no page).
// It goes through the site engine (network/actions/wallet.ts and its flows: bond, bounty, session, registration), the
// same as the Rent, Bounties, Sessions and Operator pages: same SDK (actions/sdk, a copy of packages/sdk), same wallet,
// same refusals. Each send is confirmed on Arc before being reported as "confirmed".
import type { Hex } from 'viem'
import { arcErrorOf, ARC_ERRORS_FR } from '../network/actions/sdk/errors'
import { engine } from '../network/actions/store'
import { rpc } from '../data/live'
import type { Prepared } from './api'
import type { Eip1193 } from './wallet'

export type Phase = 'sign' | 'sent' | 'done'
export interface Outcome { tx: Hex; ref?: string; aek?: string }

/** The transaction included in an Arc block: its receipt, re-read every 1.5 s (3 minutes at most). */
export async function confirm(hash: Hex) {
  const end = Date.now() + 180_000
  for (;;) {
    let r: { status?: string } | null = null
    try { r = await rpc<{ status?: string } | null>('eth_getTransactionReceipt', [hash]) } catch { /* RPC overloaded: read again */ }
    if (r) { if (r.status !== '0x1') throw Object.assign(new Error('reverted'), { reverted: true, tx: hash }); return }
    if (Date.now() > end) throw new Error('not confirmed after 3 minutes')
    await new Promise((res) => setTimeout(res, 1_500))
  }
}

/** Runs a prepared action with the site wallet; `on` reports progress (signing, sent, confirmed). */
export async function execute(c: Prepared, _p: Eip1193, _address: string, on: (ph: Phase, o?: Partial<Outcome>) => void): Promise<Outcome> {
  const E = await engine()
  on('sign')
  const o = await E.runPrepared({ tool: c.tool, input: c.input, result: c.result })
  const ref = /^(session|bounty) (\d+)$/.exec(o.label)?.[2]
  on('sent', { tx: o.tx, ref, aek: o.aek })
  await confirm(o.tx)
  return { tx: o.tx, ref, aek: o.aek }
}

/** A contract refusal, named (and explained in French), otherwise undefined. */
export function contractError(e: unknown, lang: string): string | undefined {
  const hit = arcErrorOf(e)
  if (!hit) return undefined
  return lang === 'fr' ? `${hit.name}, ${ARC_ERRORS_FR[hit.name] ?? hit.fr}` : hit.name
}

/** A site engine error already worded (refusal, balance, network), otherwise undefined. */
export async function siteError(e: unknown): Promise<string | undefined> {
  const E = await engine()
  const u = E.explain(e)
  return u.kind === 'other' ? undefined : u.message
}
