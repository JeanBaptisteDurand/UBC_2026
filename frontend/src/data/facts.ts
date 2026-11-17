// Deployment facts the front end cannot read live, copied from deployments.v21.testnet.json (v2.1 stack, Arc testnet).
// That file is not read at runtime: update this on every redeployment (contract addresses too, used by gate.ts,
// chain.ts, onchain.ts, wall.ts and catalog.ts).

export const CHAIN_ID = 5042002

/** deployments.v21.testnet.json: contracts, levels and external */
export const C = {
  EnclaveRegistry: '0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d',
  ProductRegistry: '0x582a3076cf6A1347907565B57Ce9f548D33805A4',
  OperatorBond: '0xe584F7590e4677372eE6259b967672c747eB6850',
  SessionPay: '0x8Bf8A8356f53006E9aB359AA6382f783923058a6',
  X402Settler: '0xccDb1a5641F2F3f2Cf2112c8E14669DBb6E11634',
  SealedBounty: '0x182871d34438aB37a7FD4d8689f3e0812E447A9b',
  /** levels.SealedBountyVerified: the verified-level sealed bounty, fixed stack (product 7) */
  SealedBountyVerified: '0x36A8DdF9fcb1308B9e86425beC9B098e933c7348',
  /** levels.superseded[0].SealedBountyVerified: the older one, neutralised (settlement of product 6) */
  SealedBountyVerifiedOld: '0x242cA1c4D0A5a6fE5A806F215CA5F127422364D2',
  /** external.Multicall3: its code is deployed on Arc testnet (checked with eth_getCode) */
  Multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
} as const

/** Product roles the chain does not state:
 *  - 5: the refutation demo (refuteDemo.product: an image that lies on purpose);
 *  - 6: superseded by 7 (products.6.superseded: neutralised, its settlement contract is immutable);
 *  - 7: the verified-operator sealed bounty (products.7, slashing possible from slashFromUtc). */
export type ProductRole =
  | { role: 'refuteDemo' }
  | { role: 'superseded'; by: string }
  | { role: 'verified'; slashFrom: number }
export const PRODUCT_ROLE: Record<string, ProductRole> = {
  '5': { role: 'refuteDemo' },
  '6': { role: 'superseded', by: '7' },
  '7': { role: 'verified', slashFrom: 1795042837 }, // 2026-11-18T23:00:37Z
}
export const roleOf = (productId?: string | null) => (productId ? PRODUCT_ROLE[productId] : undefined)
export const isSuperseded = (productId?: string | null) => roleOf(productId)?.role === 'superseded'

/** refuteDemo: the false claim on bounty 2 (product 5), accepted then refuted on Arc. Nothing was paid out (pool 0.425
 *  then 1 USDC, deliverBlocked); the lying operator's bond was seized and the operator banned.
 *  These events are too old for the API's window of the last 100 events. */
export interface Refutation {
  bountyId: string; productId: string; signer: string; operator: string
  acceptTx: string; acceptBlock: number; refuteTx: string; refuteBlock: number
  /** Refused claim amount, and seized bond (USDC, 6 decimals) */
  claimed: string; seized: string
}
export const REFUTATIONS: Refutation[] = [{
  bountyId: '2', productId: '5',
  signer: '0xEDC7Df91392c40c89955249006C1fA47BC34e497', operator: '0x8eEd1D7826A79695e7889F3ff70081d535763b44',
  acceptTx: '0x6aee80e974458ba251d75d7d82f8bfe361006fc328fc1416816221a2e76eb0ea', acceptBlock: 71620107,
  refuteTx: '0x0ffca5433186735bf5525e525995f3589d842681da8ffcaa82acb5993025051f', refuteBlock: 71620138,
  claimed: '500000', seized: '1000000',
}]
export const refutationOfBounty = (bountyId: string) => REFUTATIONS.find((r) => r.bountyId === bountyId)
export const refutationOfOperator = (operator?: string) => (operator ? REFUTATIONS.find((r) => r.operator.toLowerCase() === operator.toLowerCase()) : undefined)
