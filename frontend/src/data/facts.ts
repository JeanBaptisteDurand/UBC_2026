// Deployment facts the front end cannot read live, copied from deployments.v3.testnet.json (v3 stack, Arc testnet, the
// live stack since the switch) and, for history, from deployments.v21.testnet.json (v2.1 stack, in service from 9 to 20
// November 2026: every past proof the site links was made on it). Those files are not read at runtime: update this on
// every redeployment (contract addresses too, used by gate.ts, chain.ts, onchain.ts, wall.ts, catalog.ts, links.tsx,
// proofs.ts and doc/arc.ts).

export const CHAIN_ID = 5042002

/** deployments.v3.testnet.json: contracts and external (the stack in service) */
export const C = {
  EnclaveRegistry: '0xc854ebA7C28f4b53f50018EAcF40D617Ba76e38E',
  ProductRegistry: '0xd2e6f3fD0561C8823774A8C7054B414777E0228d',
  OperatorBond: '0x19C3438E997c2C513aA5E7D2dDd2666532095dd4',
  SessionPay: '0x606c379cd8758E3562e7ECC9972d0feF693F0763',
  X402Settler: '0x89B0381B18536f680fD952a0E7D375d7a4EC3fe6',
  SealedBounty: '0xaA229Eda6b535DF6aEe0B4D892f39e0EC006d308',
  /** the verified-level sealed bounty (product 5 on v3) */
  SealedBountyVerified: '0x8958EA25c9cF7bbee39B32C43187d854B5d73ee6',
  /** the ERC-8004 verdict log */
  VerdictLog: '0x3BEC55d2E50118ceACcD2E0045855123964D78cF',
  /** external.Multicall3: its code is deployed on Arc testnet (checked with eth_getCode) */
  Multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
} as const

/** deployments.v21.testnet.json: the v2.1 stack, retired at the switch to v3 and kept for history (its events, its
 *  proofs and the refutation of 10 November stay readable on Arc) */
export const C21 = {
  EnclaveRegistry: '0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d',
  ProductRegistry: '0x582a3076cf6A1347907565B57Ce9f548D33805A4',
  OperatorBond: '0xe584F7590e4677372eE6259b967672c747eB6850',
  SessionPay: '0x8Bf8A8356f53006E9aB359AA6382f783923058a6',
  X402Settler: '0xccDb1a5641F2F3f2Cf2112c8E14669DBb6E11634',
  SealedBounty: '0x182871d34438aB37a7FD4d8689f3e0812E447A9b',
  /** levels.SealedBountyVerified: the verified-level sealed bounty, fixed stack (product 7 on v2.1) */
  SealedBountyVerified: '0x36A8DdF9fcb1308B9e86425beC9B098e933c7348',
  /** levels.superseded[0].SealedBountyVerified: the older one, neutralised (settlement of v2.1 product 6) */
  SealedBountyVerifiedOld: '0x242cA1c4D0A5a6fE5A806F215CA5F127422364D2',
  VerdictLog: '0x2B4AB39B461Ae2bA9ADfb6bC630D34553BAb9779',
} as const

/** Product roles the chain does not state, on v3 (deployments.v3.testnet.json):
 *  - 5: the verified-operator sealed bounty (products.5, policy level 1 with the Proof of Cloud auditor). Its settlement
 *    contract was wired by OperatorBond.initialize and VerdictLog.initialize when the stack was deployed: it can slash and
 *    write verdicts from then on, with no 8-day delay.
 *  v3 has no refutation demo and no replaced product: on v2.1, 5 was the refutation demo, 6 the neutralised first
 *  verified bounty and 7 the verified bounty (PRODUCT_ROLE_V21, history). */
export type ProductRole =
  | { role: 'refuteDemo' }
  | { role: 'superseded'; by: string }
  | { role: 'verified'; slashFrom: number }
export const PRODUCT_ROLE: Record<string, ProductRole> = {
  '5': { role: 'verified', slashFrom: 1795120630 }, // 2026-11-19T20:37:10Z, VerdictLog.initialize (OperatorBond.initialize 20:37:06)
}
/** the v2.1 roles, kept for history (deployments.v21.testnet.json: refuteDemo.product, products.6.superseded, products.7).
 *  Product 7's bond slashing was authorized on Arc at 2026-11-18T23:59:59Z (OperatorBond.applySettlement, tx
 *  0xa7ee984c…; slashFromUtc, 23:00:37, is only when the 8-day delay ended), its verdicts at 2026-11-19T00:15:33Z
 *  (VerdictLog.applyCaller). */
export const PRODUCT_ROLE_V21: Record<string, ProductRole> = {
  '5': { role: 'refuteDemo' },
  '6': { role: 'superseded', by: '7' },
  '7': { role: 'verified', slashFrom: 1795046399 }, // 2026-11-18T23:59:59Z
}
export const roleOf = (productId?: string | null) => (productId ? PRODUCT_ROLE[productId] : undefined)
export const isSuperseded = (productId?: string | null) => roleOf(productId)?.role === 'superseded'

/** refuteDemo: the false claim on bounty 2 (product 5) of the v2.1 stack, accepted then refuted on Arc. Nothing was paid
 *  out (pool 0.425 then 1 USDC, deliverBlocked); the lying operator's bond was seized and the operator banned.
 *  These events are too old for the API's window of the last 100 events, and they are on the v2.1 contracts: a bounty
 *  of the v3 stack with the same number is another bounty (the lookups below compare the contract). */
export interface Refutation {
  /** the SealedBounty contract of that bounty (v2.1) */
  contract: string
  bountyId: string; productId: string; signer: string; operator: string
  acceptTx: string; acceptBlock: number; refuteTx: string; refuteBlock: number
  /** Refused claim amount, and seized bond (USDC, 6 decimals) */
  claimed: string; seized: string
}
export const REFUTATIONS: Refutation[] = [{
  contract: C21.SealedBounty, bountyId: '2', productId: '5',
  signer: '0xEDC7Df91392c40c89955249006C1fA47BC34e497', operator: '0x8eEd1D7826A79695e7889F3ff70081d535763b44',
  acceptTx: '0x6aee80e974458ba251d75d7d82f8bfe361006fc328fc1416816221a2e76eb0ea', acceptBlock: 71620107,
  refuteTx: '0x0ffca5433186735bf5525e525995f3589d842681da8ffcaa82acb5993025051f', refuteBlock: 71620138,
  claimed: '500000', seized: '1000000',
}]
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
/** a refutation of that bounty on that SealedBounty contract (by default the live one, v3: none so far) */
export const refutationOfBounty = (bountyId: string, contract: string = C.SealedBounty) => REFUTATIONS.find((r) => r.bountyId === bountyId && same(r.contract, contract))
/** a refutation that seized that operator's bond on that SealedBounty contract (by default the live one, v3) */
export const refutationOfOperator = (operator?: string, contract: string = C.SealedBounty) => (operator ? REFUTATIONS.find((r) => same(r.operator, operator) && same(r.contract, contract)) : undefined)
