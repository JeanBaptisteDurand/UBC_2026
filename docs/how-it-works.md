# How ArcHive works

The details behind the [README](../README.md): how Arc admits a machine, how ArcHive uses Arc, AskHive, the agent's decision loop and safety limits, and the economics.

## How Arc verifies an enclave

**Admission** (`EnclaveRegistry`, `TdxAttestationModule`):

- **Intel's signature.** The enclave registers with a fresh TDX quote. The registry verifies it through Automata's
  DCAP verifier, which we deployed on Arc with Intel's collateral. Arc's P-256 precompile cuts the cost of that check
  by a quarter ([measured](#arc-checks-the-machine)).
- **The image fingerprint.** The registry replays the VM's RTMR3 boot log in Solidity (SHA-384 written for the EVM,
  about 55 k gas per 128-byte block) and requires it to match the quote. It then admits the enclave on
  `keccak256(MRTD ‖ RTMR0 ‖ RTMR1 ‖ RTMR2 ‖ compose-hash ‖ os-image-hash ‖ XFAM ‖ TDATTRIBUTES)`: the compose that
  runs and the production OS image, nothing instance-specific. Only fingerprints the product's author allowed pass.
- **The policy.** Debug mode off, `SEPT_VE_DISABLE`, firmware (TCB) up to date, a quote bound to a recent Arc block
  (EIP-2935, within 8,191 blocks), `REPORTDATA` binding chain, registry, product, operator and the enclave's keys,
  a quote never seen before, and enough free bond.
- **The cost.** 6.6 to 6.9M gas per registration, 0.13 to 0.17 USDC at 20 to 25 gwei, paid by the operator
  ([gas table](#usdc-is-the-money-and-the-gas)). The operator's registrar renews each admission before its window ends.

**Operator levels** (`MachineRegistry`, `ProofOfCloudAuditor`, `PolicyEnclaves`; see [docs/OPERATORS.md](../docs/OPERATORS.md)):

- *Open*: anyone with a bond and an allowed image.
- *Verified*: in addition, the Proof of Cloud alliance declares the machine's chip in an inspected datacenter. Arc
  reads the chip ID (PPID) from Intel's certificate inside the quote and verifies the alliance's Ed25519 signature.
  Product 7 requires this level.

**Bonds and slashing** (`OperatorBond`): every admitted enclave is backed by its operator's USDC bond, and a fault
proven on-chain seizes all of it. The rules and their figures are in
[Economic design and risk assumptions](#economic-design-and-risk-assumptions).

**Verdicts** (`VerdictLog`): written to the ERC-8004 validation registry on Arc, under the operator's agent identity
(agent 897812). A session or a bounty that is verified and paid scores 100; a proven fault scores 0.

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

## AskHive: the site's assistant, in its own enclave

AskHive explains ArcHive while it shows it. It opens pages, highlights what it talks about, plays the 3D demo of the
Network page and walks you through a task step by step. It prepares operations (a prepaid session, an operator bond,
a bounty, a new product) that **you sign in your own wallet**: it holds no key and has no tool that spends.

AskHive runs in its own Intel TDX enclave, registered on Arc as **product 4** (free):

- **Before sending anything**, the panel reads the enclave's keys (`/enclave/copilot-site/pubkeys`). It checks on Arc
  that this key is registered for product 4, with an image the product allows and an operator that is not banned.
- **The conversation is sealed** to that key (HPKE). The web server in between relays ciphertext only.
- **The answer comes back sealed** to the visitor's request, so only the enclave holding the key checked on Arc can
  produce it. The enclave also signs each answer (`ARC-COPILOT-SITE-REPLY-v1`; the verifier is `verifySiteReply` in
  [`enclave-site.ts`](../services/copilot/src/enclave-site.ts)).
- **If a check fails**, the panel says so and uses the copilot on the site's server. A sealed conversation is never
  resent in clear.
- **The model** (`gpt-oss-120b`) runs at RedPill, behind an attested gateway that the enclave verifies before any call
  (Intel quote, production OS, pinned TLS, signed receipts). It does not run inside ArcHive's enclave. The private AI
  enclaves (products 1 and 3) run the same check (`MODEL_ATTESTATION=aci` in their measured compose), and its status is
  public: [`/enclave/copilot-site/model-attestation`](https://arc-hive.xyz/enclave/copilot-site/model-attestation),
  [`/enclave/inference/model-attestation`](https://arc-hive.xyz/enclave/inference/model-attestation) and
  [`/enclave/x402/model-attestation`](https://arc-hive.xyz/enclave/x402/model-attestation) answer `"verified": true`.
- **What the operator cannot change.** The compose ([`enclave/phala/copilot-site-v22.yml`](../enclave/phala/copilot-site-v22.yml),
  the docker-compose that Arc's image fingerprint covers through its compose-hash, checked against the admission
  event in [`enclave/phala/README.md`](../enclave/phala/README.md)) pins the image by its digest, which covers the code
  and the prompt. It writes the model, its URL and the limits in clear. All of it is part of the image fingerprint Arc allows for product 4.

| Proof (Arc testnet, 19 Nov 2026, UTC) | Transaction |
|---|---|
| Image fingerprint `0x5771d334…ebe0` proposed, then allowed for product 4 (22:28) | [`0xc45eac78…ed28`](https://explorer.testnet.arc.io/tx/0xc45eac7898951503904d1a7b51acc415aac12ed5a40ee9eb4bcc2fe86122ed28), [`0x93f11a27…9228`](https://explorer.testnet.arc.io/tx/0x93f11a27c647d089e161acaaa60bf3ae3091e609773492b50326efbfc2a09228) |
| AskHive's enclave admitted through Intel DCAP, key `0x09061F21A5b938cD941ea9eDfa481f89DEb716Ac` (22:37, 6,849,074 gas) | [`0xde9628b2…0176`](https://explorer.testnet.arc.io/tx/0xde9628b23d0483bb666a0cd13c55c4f32a1204151323a80da9451b0aeb330176) |
| Its enclave bound to its chip, for the verified level (22:38) | [`0x469706cb…111c`](https://explorer.testnet.arc.io/tx/0x469706cb81f090b0205c52a20f7739af3d544a8f869f2d0fd09bb8816312111c) |

Code: the panel in [`frontend/src/copilot/`](../frontend/src/copilot/), the service in
[`services/copilot/`](../services/copilot/) (signed replies: [`enclave-site.ts`](../services/copilot/src/enclave-site.ts)),
and the contract between them in [`docs/COPILOT-SITE-CONTRACT.md`](../docs/COPILOT-SITE-CONTRACT.md).

## Agent decision loop and safety limits

An AI agent reads ArcHive through the API or the MCP server and calls a service through the SDK
([`packages/sdk`](../packages/sdk/)). The loop can stop at three points: before the request is encrypted, before a payment
is signed, and before the answer is used. Payments are signed by the agent's own wallet (for x402, a plain account, an
EOA, today) or by a person in theirs: one capped authorization per call, or one deposit per session (plus any top-up
its owner signs). The MCP server and AskHive only read and prepare, and a person signs what they prepare, in their
own wallet.

1. **Discover.** The agent reads the offer from [`/api/products`](https://arc-hive.xyz/api/products) and
   [`/api/enclaves`](https://arc-hive.xyz/api/enclaves), or from the MCP tools `arc_products`, `arc_pricing` and
   `arc_enclaves`: each product's price and unit, settlement contract, minimum bond and exposure cap, and the enclaves
   admitted to serve it. Today a call to product 3 costs 0.01 USDC, and product 1 costs 0.10 USDC per 1,000 tokens.
2. **Check the machine.** The SDK reads the enclave's keys from its `/pubkeys`, which may come through a relay (for
   product 3: `https://arc-hive.xyz/enclave/x402/pubkeys`). It trusts none of it until it has read `EnclaveRegistry`
   on Arc, at a single block (`verifyEnclaveKeys`). It stops if Arc holds no enclave for that key, if the enclave is
   registered for another product, if its X25519 key is not the registered one, or if it is not active. Arc admitted
   the key only after Intel's signature and an image fingerprint the product's author allowed (see
   [How Arc verifies an enclave](#how-arc-verifies-an-enclave)). Only then is the request encrypted (HPKE), to the key
   Arc holds.
3. **Pay, within a cap.**
   - *Per call (x402, product 3).* The agent's wallet signs one EIP-3009 authorization for exactly the on-chain price,
     payable only to `X402Settler` and valid for one hour at most. Its nonce commits to this sealed request and this
     enclave, so it can pay for this call only, and only once. The SDK checks the enclave's 402 (payee, asset, amount)
     against Arc, and signs nothing above the agent's `maxAmount` or above the price read when the call began.
   - *Prepaid session (product 1).* One EIP-3009 deposit into `SessionPay`, topped up only by a new signature of its
     owner. The session is locked to one enclave, one operator, one model and one price. Settlements never pay more
     than the deposit, and what is not spent is refunded at close.
4. **Verify the answer.** The receipt must be signed by the enclave key Arc holds and must carry this request: the
   product, the payer and the payment's nonce for a call, or the session and the request's sequence number for a
   session, plus the hashes of the request sent and of the text received. Otherwise the SDK throws and returns no text.
5. **Settle.** The operator's registrar submits the receipt: `X402Settler.settle` for a call, `SessionPay.settle` on the
   last cumulative receipt for a session. The contract checks that the signer was an admitted enclave at the receipt's
   anchor block, moves the USDC, charges the amount to the operator's bond exposure, and splits it in the same
   transaction: 95 % to the operator and 5 % to the network on products 1 and 3. In
   [`0xeadad0b4…fbd0`](https://explorer.testnet.arc.io/tx/0xeadad0b46d51a733997777bccfedd3f05dc69a0a942620f7458c75e35c16fbd0),
   sent by the operator, 0.01 USDC leaves the payer: 0.0095 to the operator, 0.0005 to the network treasury.
6. **On a lie.** Two different signed answers to the same request (`SessionPay.reportEquivocation`), or a bounty claim
   refuted by the enclaves of at least two other operators within 3 days (`SealedBounty.refute`), seize the operator's
   whole bond and ban it, and `VerdictLog` writes 0 to the ERC-8004 validation registry on Arc. A session that was
   served and paid closes with a verdict of 100. The refutation demo ran on Arc on 15 Nov (product 5 of the previous set), and sessions closed with 100
   on 14 and 19 Nov (see [the previous set's proofs](../docs/history.md#proofs-the-previous-set)).

Every payment in [the proofs](../docs/history.md#proofs-the-previous-set) came from our own testnet wallets.
[`packages/sdk/scripts/x402-call.ts`](../packages/sdk/scripts/x402-call.ts) is a buyer that runs this loop with the SDK.

**Safety limits**

| Limit | The rule today | Enforced in |
|---|---|---|
| Per-call cap | Nothing is signed above the agent's `maxAmount`, and a price that rises during a call needs a new consent. The authorization is for the exact price, to `X402Settler` only, valid 60 s to 1 h. The site and the console set `maxAmount` to the price they show, and their wallet guard refuses any other signature. | SDK ([`x402.ts`](../packages/sdk/src/x402.ts)); USDC's EIP-3009 fixes the amount and the payee |
| One payment, one call | The nonce commits to the sealed request, and an authorization re-signed after a price change keeps the same nonce. `X402Settler` collects only with an enclave receipt carrying that nonce, and USDC accepts a nonce once. | SDK, contract ([`X402Settler.sol`](../contracts/src/X402Settler.sol)) |
| Session budget | Settlements never pay more than the deposit, or a lower `cap`. Price and model are locked at opening, and the rest is refunded at close. | Contract ([`SessionPay.sol`](../contracts/src/SessionPay.sol): `settle`, `closeSession`) |
| Admitted enclaves only | The SDK encrypts only to a key Arc registered for this product and active now. Settlement pays only a signer that was active for the product at the receipt's anchor block (for a session, the enclave locked at opening). | SDK ([`enclave-keys.ts`](../packages/sdk/src/enclave-keys.ts)), contracts (`EnclaveRegistry.activeOperatorAt`) |
| Allowed images only | Admission requires an image fingerprint the product's author allowed. Once an image is retired, anyone can invalidate its enclaves at once, with no grace period (`invalidateRetiredWorkload`). | Contract ([`EnclaveRegistry.sol`](../contracts/src/EnclaveRegistry.sol), [`ProductRegistry.sol`](../contracts/src/ProductRegistry.sol)) |
| No signing tool | The MCP server holds no key, and none of its 16 tools sends a transaction. AskHive has no tool that spends. Both return operations that people sign in their own wallet. | MCP ([`services/mcp`](../services/mcp/)), AskHive ([`enclave-site.ts`](../services/copilot/src/enclave-site.ts)) |
| Bond exposure | What an operator's enclaves can release is capped, over any 24 hours, at half its bond (less any pending withdrawal) and at 10 USDC per product ([the rule](#economic-design-and-risk-assumptions)). | Contract ([`OperatorBond.sol`](../contracts/src/OperatorBond.sol): `consumeExposure`) |
| Slashing | A proven fault seizes the whole bond and bans the operator ([who receives it](#economic-design-and-risk-assumptions)). | Contract (`OperatorBond.slash`, called by `SessionPay` and `SealedBounty`) |

The most a dishonest enclave can take from an agent is what the agent signed: one call's price, or what it deposited in
a session. An attestation proves which code ran, not that an AI answer is right, so only provable faults are slashed
(see [Economic design and risk assumptions](#economic-design-and-risk-assumptions)).

## Economic design and risk assumptions

**Who pays whom.** The contracts enforce every split, in the transaction that moves the USDC.

- **Buyers pay per use**, from a prepaid session (`SessionPay`) or with one authorization per call (`X402Settler`).
  Each payment is split between operator, author and network: `ProductRegistry` keeps the network at 5 % or more and
  an author at 30 % or less, and the operator gets the rest. All five products are ours and set no author share, so
  each one splits **95 / 0 / 5**.
- **Protocols fund bounty pools** (`SealedBounty`, `SealedBountyVerified`). The hunter gets 100 % of the tier the
  exploit reaches. On top, and only when a claim is paid, the pool pays 10 % to the network and 5 % to the operators
  whose enclaves signed the claim. On 14 Nov, a 0.5 USDC tier paid 0.5 to the hunter, 0.05 to the network and 0.025 to
  the operator ([`0xecbd089a…807e`](https://explorer.testnet.arc.io/tx/0xecbd089a092edd939ff646fae8d22c0f2616b6a92f58a49928c231c770bb807e)).
- **Operators pay the gas** of admissions (each 6.6 to 6.9M gas, 0.13 to 0.17 USDC at 20 to 25 gwei) and of
  settlements ([gas table](#usdc-is-the-money-and-the-gas)). Admission charges no fee beyond gas. At testnet prices,
  settling one 0.01 USDC call costs about 0.005 USDC of the operator's 0.0095 USDC share, while a session settles many
  requests on one receipt.

**What the operator puts at stake** (`OperatorBond`):

- The operator owns its USDC bond. Each enclave reserves the product's minimum bond (1 USDC on the live products), and
  only the free rest can be withdrawn.
- **Exposure caps.** What the settlement contracts release on the word of an operator's enclaves is capped, over any
  24 hours, at half its bond (less any pending withdrawal) and at 10 USDC per product (each product's exposure cap on
  testnet). The half-bond cap counts all products together. Our operator's 8 USDC bond allows 4 USDC per 24 hours.
- **Slashing.** A fault proven on-chain seizes the whole bond and bans the operator: two signed answers to one request,
  or a bounty claim refuted by the enclaves of at least two other operators within 3 days. Half goes to whoever proved
  it, half to the victim, or to the network treasury when there is no victim. It ran on Arc on 15 Nov
  ([`0x0ffca543…051f`](https://explorer.testnet.arc.io/tx/0x0ffca5433186735bf5525e525995f3589d842681da8ffcaa82acb5993025051f));
  in this demo, the reporter and the victim were both our own address.
- A bond leaves 7 days after the withdrawal request and after its last exposure, so a fault can still be proven.
- The bond bounds the outflow; it does not refund it. An inflated inference receipt cannot be proven, which is why a
  buyer only ever risks what it signed.

**Risk assumptions**

- **Trust in Intel TDX**: Intel's hardware and signing keys, Automata's DCAP contracts and Intel's collateral
  (refreshed monthly; the next update is due on 9 Dec 2026). An attestation proves which code ran, not that an AI
  answer is right, so only provable faults are slashed. Bounty replays are deterministic, so other operators can check
  them.
- **Trust in Proof of Cloud**, at the verified level: the alliance declares that the chip sits in an inspected
  datacenter. Physical attacks on a machine someone can touch are bounded, not prevented: capped exposure, bond
  seizure, and the verified level for high stakes.
- **One operator today.** Our team runs every enclave, on Phala Cloud. The contracts accept any bonded operator, but
  our enclave images are not public yet: we publish them, and a second operator can then run the allowed fingerprints.
- **Admin keys.** On testnet, one key, the deployer's (kept off the server), owns `OperatorBond` and `VerdictLog` and
  is the author of all five products. It can propose a new settlement contract or verdict writer, which waits 8 days,
  and remove one at once. Product changes have no timelock on testnet (`ProductRegistry.timelock` is 0). The mainnet
  plan is a 2-of-3 multisig and 48-hour timelocks.
- **The treasury is the deployer's address on testnet**, so the network's share of every payment and the victimless
  half of a slash go back to that same key.
- **State proofs.** A bounty replay reads Arc's state through a strict relay that re-hashes every block header.
  Per-read `eth_getProof` proofs are implemented and tested; they turn on with an Arc RPC that serves historical
  proofs.
- **Scope.** Arc testnet only; 253 Foundry tests and three adversarial reviews by us (no third-party audit), and every payment so far came from our own wallets.

## Feedback for Arc and Circle

- Arc Foundry's `arc-anvil` made exact exploit replays possible: plain anvil cannot reproduce Arc's native USDC.
- Arc's P-256 precompile is what makes on-chain DCAP affordable.
- Two asks: an Arc RPC that serves historical `eth_getProof`, and Intel's DCAP verifier on Arc mainnet as a shared
  public good.
