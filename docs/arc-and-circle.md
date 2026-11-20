# ArcHive on Arc, with Circle's tools

Back to the [README](../README.md). What ArcHive uses from Arc and Circle, why, what it leaves out, and what we would ask for.

## How ArcHive uses Arc

Everything below was read or measured on Arc testnet. Our contract addresses are in
[Contracts on Arc testnet](proofs-and-contracts.md#contracts-on-arc-testnet-chainid-5042002).

### Arc checks the machine

- **Intel DCAP, verified on-chain.** We deployed Automata's DCAP verifier (MIT, commit `59b1f34`) on Arc testnet with
  Intel's collateral on 13 Nov, and refreshed the collateral on 14 Nov: it is the first piece on Arc, before any product contract,
  and v3's `TdxAttestationModule` calls the same instance, nothing was redeployed. Every admission goes through `EnclaveRegistry`,
  then `TdxAttestationModule`, then Automata's entry point `0x4864…4dc9` (see [`dcap-integration/`](../dcap-integration/)).
- **The boot log, replayed on-chain.** Arc has no SHA-384 precompile, so `EnclaveRegistry` replays the VM's RTMR3 log
  with SHA-384 written for the EVM ([`Sha384.sol`](../contracts/src/lib/Sha384.sol)). It admits only an image fingerprint
  the product allows.
- **Arc's P-256 precompile (`0x100`).** Automata's quote verifier on Arc calls it for the quote's five ECDSA
  signatures. A full quote check is estimated at 5,208,699 gas, against 6,915,287 with a Solidity P-256 verifier:
  24.7 % less ([how it was measured](../dcap-integration/arc-testnet/README.md)).
- **EIP-2935 block history.** A quote must carry the hash of one of the last 8,191 Arc blocks (about 69 minutes at
  0.51 s per block), read from the history contract `0x0000F908…2935` ([`History.sol`](../contracts/src/lib/History.sol)).
  Bounty claims are anchored the same way, so stale quotes and claims are refused.

### USDC is the money and the gas

Gas is paid in USDC, so each check has a price in dollars. Measured on Arc testnet, at 20 to 25 gwei:

| Operation | Paid by | Gas | USDC |
|---|---|---|---|
| Admit an enclave: DCAP, boot-log replay and policy ([`0x3ab1e3da…ae72`](https://explorer.testnet.arc.io/tx/0x3ab1e3dac834f9fb4d5a97f67f7ea5f299b9e92ea3a1a76791a86886e0a1ae72), [`0x54d7cf7e…37ef`](https://explorer.testnet.arc.io/tx/0x54d7cf7e891d489093b139d99db37620f9e422c69005eff4bf1549fb9eae37ef)) | operator | 6.6 to 6.9M | 0.13 to 0.17 |
| Settle one pay-per-call answer ([`0x3c98a1fa…1ae8`](https://explorer.testnet.arc.io/tx/0x3c98a1fafa893722b9bffd84a1287ef28a446c361c822e4e2071f714bba31ae8)) | operator | about 210 k | about 0.005 |
| Open a session with an EIP-3009 deposit ([`0xdb7fc9e3…666d`](https://explorer.testnet.arc.io/tx/0xdb7fc9e3b024415599eee67746ae162f3032add224afed25ab7c09862b83666d)) | session owner | 361,373 | 0.0090 |
| Settle a session on its last receipt ([`0x97c17946…79ee`](https://explorer.testnet.arc.io/tx/0x97c17946a14c02cdbdd1d6aafd7a405500b6bd44a5f536c77af560aa0cbc79ee)) | operator | 217,512 | 0.0054 |
| Close a session: refund and ERC-8004 verdict ([`0x95c9f59e…b1c2`](https://explorer.testnet.arc.io/tx/0x95c9f59eee7597a532ce72162b83944e9364b1b600ff35ea6b9fd4eb2290b1c2)) | session owner | 358,323 | 0.0090 |

- **One signature per payment (EIP-3009).** `SessionPay` (deposits), `X402Settler` (one authorization per call) and
  `SealedBounty` (bounty pools) collect USDC only with `receiveWithAuthorization`: no approval is left behind, and the
  payer of a call pays no gas. `OperatorBond` takes a bond the same way, or by approve and `bondFrom`. Each settlement
  splits the payment in the same transaction (shares in
  [The first services on the marketplace](../README.md#services)).

### Standards we use

- [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009): one-signature USDC payments, as above.
- [EIP-712](https://eips.ethereum.org/EIPS/eip-712): typed signatures for the USDC authorizations, the enclaves'
  receipts (`CallReceipt` in `X402Settler`, `Receipt` in `SessionPay`) and the bounty claims and refutations.
- [EIP-2935](https://eips.ethereum.org/EIPS/eip-2935): recent block hashes, to refuse stale quotes and claims.
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004): the identity and validation registries on Arc, for verdicts.
- The P-256 precompile ([RIP-7212](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md),
  [EIP-7951](https://eips.ethereum.org/EIPS/eip-7951)): the ECDSA signatures inside every Intel quote.
- [x402](https://github.com/coinbase/x402), the `exact` scheme over EIP-3009, with our own settlement: `payTo` is the
  `X402Settler` contract, because USDC must move in the same call that checks the enclave's signed receipt for that
  request. The request is also sealed to the enclave's key, so a standard x402 client alone cannot pay product 3: the request has to be sealed to the enclave's key first.
  callers use our SDK.

### Circle tools: what we use and why not the others

We use four Circle and Arc tools:

- **USDC on Arc**, as money and gas, with EIP-3009 (above).
- **CCTP V2.** The [Bridge page](https://arc-hive.xyz/bridge.html) is wired to Circle's `TokenMessengerV2`
  (`0x8FE6…2DAA`), `MessageTransmitterV2` (`0xE737…E275`) and attestation API, from Ethereum Sepolia (CCTP domain 0)
  and Base Sepolia (domain 6) to Arc (domain 26). The user's wallet signs the burn on the source chain and the mint on
  Arc. The page sends only standard transfers (`maxFee` 0, finality threshold 2000), which Circle does not charge, so
  the whole amount burned is minted on Arc ([`cctp.ts`](../frontend/src/bridge/cctp.ts)). No transfer has gone through
  it yet.
- **The ERC-8004 registries on Arc.** `VerdictLog` writes each verdict to the validation registry
  (`0x8004Cb1B…4272`), under the operator's identity in the identity registry (`0x8004A818…BD9e`; agent 897812 for our
  operator): 100 for a session or a bounty that was verified and paid, 0 for a proven fault. Both are in
  [Arc's contract addresses](https://docs.arc.io/arc/references/contract-addresses).
- **Arc Foundry's `arc-anvil`.** The bounty image installs it (`v0.8.0-4`, pinned by sha256 in
  [`Dockerfile.bounty`](../enclave/Dockerfile.bounty)). It forks Arc with Arc's precompiles, native USDC included, so the
  enclave replays an exploit against the same precompiles Arc runs.

We left the others out on purpose. **Gateway, Nanopayments and Circle's x402 facilitator** settle a transfer to an
address, in batches or through Circle, while `X402Settler` pays only against the receipt of a machine Arc admitted and
splits the payment in that same transaction. **Circle Paymaster** is not deployed on Arc (its v0.7 and v0.8 addresses
hold no code on Arc testnet on 20 Nov); on Arc, gas is already USDC, and our buyers pay none. **Circle Wallets and
Agent Wallets** are not wired in: buyers sign with their own wallet, and the enclave accepts only plain accounts (EOAs)
as x402 payers, since it does not check ERC-1271 signatures yet. Gateway and its Nanopayments come next, for sub-cent
calls (see [What's next](../README.md#whats-next)).

The one place a Circle wallet is wired in is the OpenCode example: its bridge can pay each x402 call from a Circle
developer-controlled wallet, an EOA on `ARC-TESTNET` whose key Circle holds, and Circle signs the EIP-3009
authorization through its API; `X402Settler` checks it like any other
([Pay from a Circle wallet](../examples/opencode-archive/README.md#pay-from-a-circle-wallet); settled on v3 in
[`0x1318d65c…7cd0`](https://explorer.testnet.arc.io/tx/0x1318d65c5829c9689ba7fc3c717a5bdca1b564cc8590bdc183ff1ee4f0ff7cd0)).

## Feedback for Arc and Circle

- Arc Foundry's `arc-anvil` made exact exploit replays possible: plain anvil cannot reproduce Arc's native USDC.
- Arc's P-256 precompile is what makes on-chain DCAP affordable.
- Two asks: an Arc RPC that serves historical `eth_getProof`, and Intel's DCAP verifier on Arc mainnet as a shared
  public good.
