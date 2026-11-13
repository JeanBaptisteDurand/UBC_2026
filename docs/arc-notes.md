# Arc and Circle: what we can build on

Notes to check each shortlisted idea against.

## Arc

- Circle's L1, EVM compatible: Solidity, Foundry and viem work as usual.
- USDC is the gas token, so users pay fees in dollars.
- Fast deterministic finality, which suits payments.
- Testnet: chain id `5042002`, RPC `https://rpc.testnet.arc.io`, test USDC from the Circle faucet.

## Circle building blocks

- **Wallets** (developer-controlled or user-controlled) to onboard users without seed phrases.
- **CCTP** to move USDC between chains.
- **Gateway** for a unified USDC balance across chains.
- **Paymaster** to sponsor or pay gas in USDC.

## To check before we pick

- [ ] Can a contract on Arc verify what we need onchain (signatures, attestations, proofs) at a sane gas cost?
- [ ] Which RPC features do we need (archive state, `eth_getProof`, logs) and which providers serve them on Arc?
- [ ] What do the Circle workshops (Nov 16–19) cover?
- [ ] QuickNode Streams on Arc: worth adding for the $500 bounty?
