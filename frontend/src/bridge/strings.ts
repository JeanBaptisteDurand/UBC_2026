// The bridge page's words, English first (the site's rule, i18n.ts: no middle dot, semicolon, em dash or arrow in
// visible text). Kept apart from i18n.ts, like the space and doc pages keep theirs. English only, like the whole site.

/** the page's address under the build base */
export const BRIDGE_HREF = `${import.meta.env.BASE_URL}bridge.html`

const EN = {
  'nav': 'Bridge', 'nav.t': 'Bring your USDC to Arc with CCTP', 'nav.off': 'Connect a wallet first',
  'doc': 'ArcHive. Bridge', 'sec': 'Bridge, CCTP', 'skip': 'Skip to the transfer',
  'title': 'Bring your USDC to Arc.',
  'lede': 'Send USDC from another testnet to Arc testnet with Circle’s CCTP. Your wallet burns it on the source chain, Circle attests the burn, and the same USDC is minted to your address on Arc. Nobody holds it on the way.',
  'testnet': 'Testnets only. This USDC has no value.',
  'w.need': 'Connect a wallet to see your USDC on the other testnets.', 'w.connect': 'Connect wallet',
  'w.ok': 'Connected as {addr}. The USDC arrives at this same address on Arc.',
  'from.h': 'From', 'from.lede': 'Your USDC on the testnets CCTP links to Arc, read live.',
  'bal.reading': 'reading', 'bal.fail': 'not read', 'bal.gas': 'gas {v}',
  'amount': 'Amount, in USDC', 'max': 'Max',
  'free': 'No Circle fee: 1 USDC sent = 1 USDC received. You pay only the gas.',
  'free.d': 'A standard CCTP transfer: Circle keeps nothing and attests once the burn is final on {net}, {wait}.',
  'wait.eth-sepolia': 'about 15 to 19 minutes', 'wait.base-sepolia': 'about 15 to 19 minutes, sometimes up to 35 (Base first posts its batch to Ethereum)',
  'range': '{from} to {to} min', 'range.up': '{from} to {to} min, up to {upTo}', 'elapsed': '{m} min {s} s', 'elapsed.m': '{m} min',
  'fee.old': 'A fast transfer started earlier: Circle keeps at most {fee}.',
  'get': 'You receive {v} on Arc.',
  'go': 'Send to Arc', 'new': 'New transfer', 'retry': 'Try again',
  'steps': 'The transfer, step by step',
  's1.t': 'Burn on {net}', 's1.d': 'Your wallet switches to {net}, approves the USDC, then burns it toward Arc (CCTP V2, depositForBurn). Up to two signatures, gas in {gas}.',
  's2.t': 'Circle attests', 's2.d': 'Circle waits until the burn is final on {net}, then signs a proof of it: {wait}. You can close the page: the transfer resumes here.',
  's3.t': 'Mint on Arc', 's3.d': 'Your wallet switches to Arc testnet and hands Arc the proof (receiveMessage). This signature pays a little gas in USDC on Arc.',
  'st.todo': 'to do', 'st.doing': 'in progress', 'st.done': 'done', 'st.fail': 'stopped',
  'n.switch': 'Switching your wallet to {net}.', 'n.approve': 'Approve {v} in your wallet.', 'n.approving': 'Approval sent, waiting for {net}.',
  'n.burn': 'Confirm the burn in your wallet.', 'n.burning': 'Burn sent, waiting for {net}.', 'n.burned': '{v} burned on {net}.',
  'n.wait': 'Waiting for Circle’s attestation: {t} so far, usually {range}.', 'n.unseen': 'Waiting for Circle’s attestation: {t} so far. Circle has not indexed the burn yet.',
  'n.late': 'Still waiting for Circle’s attestation: {t} so far, longer than usual. Your USDC is burned and safe, the page keeps asking.', 'n.attested': 'Attested by Circle.',
  'n.mint': 'Confirm the mint in your wallet.', 'n.minting': 'Mint sent, waiting for Arc.', 'n.done': '{v} minted on Arc to your address.',
  'n.already': 'Already received on Arc: someone relayed it for you. The USDC is at your address.',
  'n.resume': 'A transfer started on {date} is not finished. It resumes here.',
  'tx': 'tx', 'tx.on': 'On {net}', 'arc.now': 'Your USDC on Arc now: {v}', 'arc.h': 'Your USDC on Arc',
  'src.none': 'No USDC on {net} yet. Take some from Circle’s faucet, it gives testnet USDC.',
  'mint.go': 'Receive on Arc', 'arc.gas': 'Gas on Arc: {v}',
  'gas.arc': 'You have no USDC on Arc to pay the gas of this last step. Take a little from Circle’s faucet (choose Arc Testnet), then come back: the transfer waits for you.',
  'gas.src': 'You have no {gas} on {net} to pay the gas. Take some from a faucet first.',
  'faucet': 'Circle faucet', 'faucet.eth': 'Sepolia ETH faucet', 'faucet.base': 'Base Sepolia ETH faucet',
  'e.refused': 'You declined in your wallet. Nothing was sent.',
  'e.refusedBurn': 'The approval went through, then you declined the burn in your wallet. No USDC left your wallet: send again whenever you want.',
  'e.refused3': 'You declined in your wallet. Your USDC is burned and attested, it waits for you: receive it whenever you want.',
  'e.chain': 'Your wallet is on another network. Switch it to {net}, then try again.',
  'e.switch': 'Your wallet did not switch to {net}. Switch it by hand, then try again.',
  'e.gas': 'Not enough {gas} on {net} to pay the gas.',
  'e.funds': 'You have {have} on {net}, less than {need}.',
  'e.amount': 'Enter an amount above 0, up to your balance.',
  'e.notfree': 'Circle now asks a fee for a standard transfer from {net}. This page only sends free transfers, so it stops here.',
  'e.revert': '{net} refused the transaction.',
  'e.net': '{net} did not answer ({why}). Try again.',
  'e.iris': 'Circle’s attestation service did not answer ({why}). The page keeps asking.',
  'e.other': 'It failed: {why}.',
  'how': 'How it works', 'how.d': 'CCTP is Circle’s own bridge for USDC. It never wraps or pools your USDC: it burns it on one chain and mints it on another, once Circle has signed the burn. This page sends standard transfers only: free, the whole amount arrives, the price is the wait for finality. Arc is CCTP domain 26.',
}
type Key = keyof typeof EN
export type BKey = Key
/** a string, with its {placeholders} filled */
export function bt(k: Key, v: Record<string, string | number> = {}): string {
  const s: string = EN[k]
  return s.replace(/\{(\w+)\}/g, (_m, n: string) => String(v[n] ?? `{${n}}`))
}
