# ArcHive

[![CI](https://github.com/JeanBaptisteDurand/UBC_2026/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/JeanBaptisteDurand/UBC_2026/actions/workflows/ci.yml)

Main track: Agentic Payments and AI · Chain award: Best use of Arc

**Sealed machines, open market.** ArcHive is a marketplace where AI agents and apps pay per use in USDC for compute on
Intel TDX machines that **Arc** verifies on-chain. Operators earn by renting out their machines, and authors by
publishing services.

**Who pays, who earns** (testnet prices, live at [`/api/products`](https://arc-hive.xyz/api/products)):

- An app that must keep its prompts private pays **0.10 USDC per 1,000 tokens** from a prepaid session (product 1).
- An AI agent pays **0.01 USDC per call**, with one signature and no gas (product 3, x402).
- A protocol funds a bug bounty that pays out only for an exploit a sealed machine replayed (products 2 and 7).
- The operator whose enclave served the request earns **95 %** of each paid call or session, and the network keeps 5 %.

**The problem.** An app or an AI agent that sends a private request to someone else's machine, or pays out on a
security report, has to take the provider's word: that the advertised code is what runs, that the data stays private,
that the result is honest. ArcHive replaces that word with checks Arc runs itself. A contract on Arc admits a machine
only once Intel's signature on it and the fingerprint of the exact image it runs check out. USDC moves only against a
receipt an admitted enclave signed, and a proven lie costs the operator's USDC bond. Others rate the payee after the
fact; ArcHive checks the machine before any USDC moves.

Built on Arc testnet for UBC 2026 by Jean-Baptiste Durand and Florent Belotti.

<p>
  <img src="docs/img/arc-hive-home.png" alt="ArcHive's home page: sealed machines, open market" width="49%">
  <img src="docs/img/arc-hive-services.png" alt="ArcHive's Services page: a rack whose sleds are the products, each with its live state" width="49%">
</p>

The home page and the Services page of https://arc-hive.xyz on 20 Nov 2026. On the Services page, each named sled of the
rack is a product with its live state; the others are open slots.

## Live

| What | Link |
|---|---|
| The marketplace | https://arc-hive.xyz |
| How it works in 3D (roles, contracts, a guided demo) | https://arc-hive.xyz/network.html |
| The services, prices and shares | https://arc-hive.xyz/service.html |
| The Doc: how Arc checks every machine, every proof linked | https://arc-hive.xyz/doc.html |
| Bring USDC to Arc with Circle's CCTP (from Ethereum Sepolia or Base Sepolia) | https://arc-hive.xyz/bridge.html |
| Console (sessions, bounties, operators, developers) | https://archive.62-171-153-35.sslip.io/console/ |
| 3D server room (live, or a replay of recorded events) | https://arc-hive.xyz/datacenter/ |
| Read API (JSON, no key) | https://arc-hive.xyz/api/stats |
| MCP server for AI agents (16 tools, no key) | https://arc-hive.xyz/mcp |
| Arc testnet explorer | https://explorer.testnet.arc.io |

The same site also answers at the server's own address, https://archive.62-171-153-35.sslip.io. The console and the
operators' wallet sign-in run there, and https://arc-hive.xyz/console/ redirects to it.

## Check it in two minutes, no wallet needed

1. **See what runs now**, with the key of each enclave Arc admitted:
   `curl -s https://arc-hive.xyz/api/enclaves`
2. **Replay Arc's admission check.** On the home page, in the *Arc check* section ("Arc admits the enclave or refuses
   it"), press **Change one byte**. Arc recomputes the image fingerprint in a read-only call and refuses the machine.
3. **Ask AskHive** (bottom right of the site): *"Does this chat run in an enclave?"* The panel shows its connection to
   the enclave whose key Arc holds for product 4, and the answer comes back sealed by that enclave.
4. **Open any transaction below** on the explorer: `https://explorer.testnet.arc.io/tx/<hash>`.
5. **Check without a browser**, with Foundry's `cast`:
   `cast receipt 0xde9628b23d0483bb666a0cd13c55c4f32a1204151323a80da9451b0aeb330176 --rpc-url https://rpc.testnet.arc.io`
   shows AskHive's enclave admission: status 1 (success), 6,849,074 gas, sent to the `EnclaveRegistry`.

## The first services on the marketplace

Anyone can publish a service; these seven are ours.

| # | Product | Who pays | Who is paid | Contract | [Status](https://arc-hive.xyz/api/products) |
|---|---|---|---|---|---|
| 1 | Private AI, prepaid session | a user or an app deposits USDC, billed per token (0.10 USDC per 1,000 tokens on testnet) | operator 95 %, network 5 %; the rest is refunded | `SessionPay` | running |
| 2 | Sealed Bounty, open level | a protocol funds a USDC pool | the hunter gets 100 % of the tier; +10 % network and +5 % verifying operators, on top, only when paid | `SealedBounty` | running |
| 3 | Private AI, pay per call (x402) | an agent signs one EIP-3009 authorization per call (0.01 USDC per call) and pays no gas (the operator pays the settlement gas, about 0.005 USDC at 25 gwei) | operator 95 %, network 5 % | `X402Settler` | running |
| 4 | AskHive, the attested copilot | free | — | — | running |
| 5 | Caught lying (refutation demo) | — | the liar's whole bond: 50 % reporter, 50 % victim (or the network treasury if there is no victim) | `SealedBounty`, `OperatorBond` | demonstrated on Arc on 10 Nov |
| 6 | Verified bounty, first version | — | — | — | superseded by product 7 (settlement contracts are immutable by design); no enclave serves it |
| 7 | Sealed Bounty, verified level | a protocol funds a USDC pool | as product 2; only enclaves on chips declared by the Proof of Cloud alliance count | `SealedBountyVerified` | running |

*Running* means that an enclave admitted on Arc serves the product now. Prices, shares, bonds and delays are on-chain
parameters in `ProductRegistry` (who gets what: [Economic design](#economic-design-and-risk-assumptions)). Testnet
prices are set so that every flow shows on the explorer; they are not market prices. Live values:
[`/api/products`](https://arc-hive.xyz/api/products) for the parameters, [`/api/enclaves`](https://arc-hive.xyz/api/enclaves)
for the enclaves that serve each product.

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
- **The cost.** About 6.85 to 6.87 M gas per registration, 0.14 to 0.17 USDC, paid by the operator
  ([gas table](#usdc-is-the-money-and-the-gas)). The operator's registrar renews each admission before its window ends.

**Operator levels** (`MachineRegistry`, `ProofOfCloudAuditor`, `PolicyEnclaves`; see [docs/OPERATORS.md](docs/OPERATORS.md)):

- *Open*: anyone with a bond and an allowed image.
- *Verified*: in addition, the Proof of Cloud alliance declares the machine's chip in an inspected datacenter. Arc
  reads the chip ID (PPID) from Intel's certificate inside the quote and verifies the alliance's Ed25519 signature.
  Product 7 requires this level.

**Bonds and slashing** (`OperatorBond`): every admitted enclave is backed by its operator's USDC bond, and a fault
proven on-chain seizes all of it. The rules and their figures are in
[Economic design and risk assumptions](#economic-design-and-risk-assumptions).

**Verdicts** (`VerdictLog`): written to the ERC-8004 validation registry on Arc, under the operator's agent identity
(agent 897812). A session or a bounty that is verified and paid scores 100; a proven fault scores 0.

## Architecture

```
 Buyer (person, app, AI agent)          Operator's Intel TDX machine            Author
   1. reads the enclave's key on Arc      runs the product's allowed image        publishes a product:
   2. seals the request (HPKE) ------->   in a sealed enclave                     price, shares, allowed images
   <------ answer + signed receipt -----  3. answers, or replays the exploit
                                             on a fork of Arc, and signs
 ================================= Arc (contracts, USDC) =================================
  EnclaveRegistry -> TdxAttestationModule -> Automata DCAP       admit: Intel signature, boot-log replay,
  MachineRegistry + ProofOfCloudAuditor + PolicyEnclaves         allowed image, fresh quote, bond; chip level
  SessionPay | X402Settler | SealedBounty | SealedBountyVerified   pay only on an admitted enclave's signature
  ProductRegistry (prices, shares)   OperatorBond (bonds, slashing)   VerdictLog -> ERC-8004 validation registry
```

1. **Arc admits the machine** (above). The operator's registrar keeps the admission fresh.
2. **The buyer seals the request** with the enclave's key, read on Arc. Our servers only relay ciphertext.
3. **The enclave signs its work**: a receipt for an answer, or a claim for a replayed exploit, with a key born inside it.
4. **Arc pays on the signature.** The settlement contract checks that an admitted enclave signed, reads the price and
   the shares, and splits the USDC in the same transaction.
5. **Arc records the verdict** in the ERC-8004 validation registry.
6. **A proven lie costs the bond.**

Off-chain pieces:

- The read API (`services/api`) keeps its own index of contract events.
- One registrar per enclave (`services/registrar`) renews admissions and settles served sessions and paid calls.
- The copilot (`services/copilot`) runs on the server and, as AskHive, in its own enclave.
- The MCP server (`services/mcp`) gives any agent read tools, and prepare tools for bonds, registrations, bounties and
  products.
- The bounty enclave reaches Arc only through a strict relay. The relay re-hashes every block header, and the enclave
  signs nothing that depends on an RPC error.

## How ArcHive uses Arc

Everything below was read or measured on Arc testnet. Our contract addresses are in
[Contracts on Arc testnet](#contracts-on-arc-testnet-chainid-5042002).

### Arc checks the machine

- **Intel DCAP, verified on-chain.** We deployed Automata's DCAP verifier (MIT, commit `59b1f34`) on Arc testnet with
  Intel's collateral on 7 Nov, and refreshed the collateral on 9 Nov. Every admission goes through `EnclaveRegistry`,
  then `TdxAttestationModule`, then Automata's entry point `0x4864…4dc9` (see [`dcap-integration/`](dcap-integration/)).
- **The boot log, replayed on-chain.** Arc has no SHA-384 precompile, so `EnclaveRegistry` replays the VM's RTMR3 log
  with SHA-384 written for the EVM ([`Sha384.sol`](contracts/src/lib/Sha384.sol)). It admits only an image fingerprint
  the product allows.
- **Arc's P-256 precompile (`0x100`).** Automata's quote verifier on Arc calls it for the quote's five ECDSA
  signatures. A full quote check is estimated at 5,208,699 gas, against 6,915,287 with a Solidity P-256 verifier:
  24.7 % less ([how it was measured](dcap-integration/arc-testnet/README.md)).
- **EIP-2935 block history.** A quote must carry the hash of one of the last 8,191 Arc blocks (about 69 minutes at
  0.51 s per block), read from the history contract `0x0000F908…2935` ([`History.sol`](contracts/src/lib/History.sol)).
  Bounty claims are anchored the same way, so stale quotes and claims are refused.

### USDC is the money and the gas

Gas is paid in USDC, so each check has a price in dollars. Measured on Arc testnet, at 20 to 25 gwei:

| Operation | Paid by | Gas | USDC |
|---|---|---|---|
| Admit an enclave: DCAP, boot-log replay and policy ([`0x3ab1e3da…ae72`](https://explorer.testnet.arc.io/tx/0x3ab1e3dac834f9fb4d5a97f67f7ea5f299b9e92ea3a1a76791a86886e0a1ae72), [`0x54d7cf7e…37ef`](https://explorer.testnet.arc.io/tx/0x54d7cf7e891d489093b139d99db37620f9e422c69005eff4bf1549fb9eae37ef)) | operator | 6.85 to 6.87 M | 0.14 to 0.17 |
| Settle one pay-per-call answer ([`0x3c98a1fa…1ae8`](https://explorer.testnet.arc.io/tx/0x3c98a1fafa893722b9bffd84a1287ef28a446c361c822e4e2071f714bba31ae8)) | operator | about 210 k | about 0.005 |
| Open a session with an EIP-3009 deposit ([`0xdb7fc9e3…666d`](https://explorer.testnet.arc.io/tx/0xdb7fc9e3b024415599eee67746ae162f3032add224afed25ab7c09862b83666d)) | session owner | 361,373 | 0.0090 |
| Settle a session on its last receipt ([`0x97c17946…79ee`](https://explorer.testnet.arc.io/tx/0x97c17946a14c02cdbdd1d6aafd7a405500b6bd44a5f536c77af560aa0cbc79ee)) | operator | 217,512 | 0.0054 |
| Close a session: refund and ERC-8004 verdict ([`0x95c9f59e…b1c2`](https://explorer.testnet.arc.io/tx/0x95c9f59eee7597a532ce72162b83944e9364b1b600ff35ea6b9fd4eb2290b1c2)) | session owner | 358,323 | 0.0090 |

- **One signature per payment (EIP-3009).** `SessionPay` (deposits), `X402Settler` (one authorization per call) and
  `SealedBounty` (bounty pools) collect USDC only with `receiveWithAuthorization`: no approval is left behind, and the
  payer of a call pays no gas. `OperatorBond` takes a bond the same way, or by approve and `bondFrom`. Each settlement
  splits the payment in the same transaction (shares in
  [The first services on the marketplace](#the-first-services-on-the-marketplace)).

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
  request. The request is also sealed to the enclave's key, so a standard x402 client cannot pay product 3 yet:
  callers use our SDK.

### Circle tools: what we use and why not the others

We use four Circle and Arc tools:

- **USDC on Arc**, as money and gas, with EIP-3009 (above).
- **CCTP V2.** The [Bridge page](https://arc-hive.xyz/bridge.html) is wired to Circle's `TokenMessengerV2`
  (`0x8FE6…2DAA`), `MessageTransmitterV2` (`0xE737…E275`) and attestation API, from Ethereum Sepolia (CCTP domain 0)
  and Base Sepolia (domain 6) to Arc (domain 26). The user's wallet signs the burn on the source chain and the mint on
  Arc. The page sends only standard transfers (`maxFee` 0, finality threshold 2000), which Circle does not charge, so
  the whole amount burned is minted on Arc ([`cctp.ts`](frontend/src/bridge/cctp.ts)). No transfer has gone through
  it yet.
- **The ERC-8004 registries on Arc.** `VerdictLog` writes each verdict to the validation registry
  (`0x8004Cb1B…4272`), under the operator's identity in the identity registry (`0x8004A818…BD9e`; agent 897812 for our
  operator): 100 for a session or a bounty that was verified and paid, 0 for a proven fault. Both are in
  [Arc's contract addresses](https://docs.arc.io/arc/references/contract-addresses).
- **Arc Foundry's `arc-anvil`.** The bounty image installs it (`v0.8.0-4`, pinned by sha256 in
  [`Dockerfile.bounty`](enclave/Dockerfile.bounty)). It forks Arc with Arc's precompiles, native USDC included, so the
  enclave replays an exploit against the same precompiles Arc runs.

We left the others out on purpose. **Gateway, Nanopayments and Circle's x402 facilitator** settle a transfer to an
address, in batches or through Circle, while `X402Settler` pays only against the receipt of a machine Arc admitted and
splits the payment in that same transaction. **Circle Paymaster** is not deployed on Arc (its v0.7 and v0.8 addresses
hold no code on Arc testnet on 20 Nov); on Arc, gas is already USDC, and our buyers pay none. **Circle Wallets and
Agent Wallets** are not wired in: buyers sign with their own wallet, and the enclave accepts only plain accounts (EOAs)
as x402 payers, since it does not check ERC-1271 signatures yet. Gateway and its Nanopayments come next, for sub-cent
calls (see [What's next](#whats-next)).

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
  [`enclave-site.ts`](services/copilot/src/enclave-site.ts)).
- **If a check fails**, the panel says so and uses the copilot on the site's server. A sealed conversation is never
  resent in clear.
- **The model** (`gpt-oss-120b`) runs at RedPill, behind an attested gateway that the enclave verifies before any call
  (Intel quote, production OS, pinned TLS, signed receipts). It does not run inside ArcHive's enclave.
- **What the operator cannot change.** The compose ([`enclave/phala/copilot-site-v22.yml`](enclave/phala/copilot-site-v22.yml),
  the file measured on Arc, byte for byte) pins the image by its digest, which covers the code and the prompt. It
  writes the model, its URL and the limits in clear. All of it is part of the image fingerprint Arc allows for product 4.

| Proof (Arc testnet, 19 Nov 2026, UTC) | Transaction |
|---|---|
| Image fingerprint `0x5771d334…ebe0` proposed, then allowed for product 4 (22:28) | [`0xc45eac78…ed28`](https://explorer.testnet.arc.io/tx/0xc45eac7898951503904d1a7b51acc415aac12ed5a40ee9eb4bcc2fe86122ed28), [`0x93f11a27…9228`](https://explorer.testnet.arc.io/tx/0x93f11a27c647d089e161acaaa60bf3ae3091e609773492b50326efbfc2a09228) |
| AskHive's enclave admitted through Intel DCAP, key `0x09061F21A5b938cD941ea9eDfa481f89DEb716Ac` (22:37, 6,849,074 gas) | [`0xde9628b2…0176`](https://explorer.testnet.arc.io/tx/0xde9628b23d0483bb666a0cd13c55c4f32a1204151323a80da9451b0aeb330176) |
| Its enclave bound to its chip, for the verified level (22:38) | [`0x469706cb…111c`](https://explorer.testnet.arc.io/tx/0x469706cb81f090b0205c52a20f7739af3d544a8f869f2d0fd09bb8816312111c) |

Code: the panel in [`frontend/src/copilot/`](frontend/src/copilot/), the service in
[`services/copilot/`](services/copilot/) (signed replies: [`enclave-site.ts`](services/copilot/src/enclave-site.ts)),
and the contract between them in [`docs/COPILOT-SITE-CONTRACT.md`](docs/COPILOT-SITE-CONTRACT.md).

## Use ArcHive from your own tools

### The MCP server, in Claude Code, Cursor or any MCP client

```sh
claude mcp add --transport http archive https://arc-hive.xyz/mcp
```

Any other MCP client: `{ "mcpServers": { "archive": { "url": "https://arc-hive.xyz/mcp" } } }`.
The server holds no key and has no tool that sends a transaction. It reads the network and **prepares** operations
that the user signs in their own wallet. Its 16 tools:

| Reads | Prepares (you sign) |
|---|---|
| `arc_products`, `arc_enclaves`, `arc_bounties`, `arc_sessions`, `arc_activity`, `arc_pricing` | `arc_bounty_prepare_create`: a sealed bounty, with a loss-rule assistant |
| `arc_enclave_status`, `arc_session_status`, `arc_verify_receipt` (checks a receipt like `SessionPay.settle`) | `arc_operator_prepare_bond`, `arc_operator_prepare_register`: bond, then register an enclave |
| `arc_machines_list`, `arc_machine_diagnostics` (an operator's machines) | `arc_operator_plan`, `arc_product_scaffold`: become an operator, publish a service |

The same server runs locally over stdio from this repository:
`cd packages/sdk && npm ci && cd ../../services/mcp && npm ci && npm start` (`ARCHIVE_API` sets the read API).

### The SDK and the `arcvault` CLI

- [`packages/sdk`](packages/sdk/), in TypeScript, checks an enclave's keys on Arc before encrypting anything. It opens
  prepaid sessions, pays per call (x402, with `maxAmount`), verifies every signed receipt, builds bounties and reads
  the operator levels.
- [`packages/cli`](packages/cli/) is `arcvault`, with 33 commands: read the network, check a receipt, sessions,
  bounties and refutation, operators, products, auditors, and a local OpenAI-compatible proxy paid from a prepaid
  session.

```sh
cd packages/sdk && npm ci
cd ../cli && npm ci && npm run arcvault -- products
```

Both run from this repository with `npm ci` in each folder.

### Claude Code on ArcHive's private inference

ArcHive's private inference can serve Claude Code's chat, text only. An Anthropic-compatible gateway (LiteLLM) and an
x402 client pay the product 3 enclave 0.01 USDC per call, and each answer comes back only once its signed receipt checks
against the enclave's key on Arc. We tested this path on 19 Nov 2026 by replaying requests in Claude Code's format: the
`claude` CLI itself was not run, Claude Code's tools (files, commands) do not go through, and the model is
`gpt-oss-120b`, not Claude. The operator settled the three calls on Arc between 20:22 and 20:23 UTC:
[`0x3c98a1fa…1ae8`](https://explorer.testnet.arc.io/tx/0x3c98a1fafa893722b9bffd84a1287ef28a446c361c822e4e2071f714bba31ae8),
[`0xec0bd6b0…68e3`](https://explorer.testnet.arc.io/tx/0xec0bd6b04fdaa3cc4966a604e8967f0e73b5ca91423d9921edb3d05c574168e3),
[`0xe7a0e00f…f52b`](https://explorer.testnet.arc.io/tx/0xe7a0e00fe514f10d602b1495d2d84a5e9f5b4c67e1fb5ba33cf7e190d8a1f52b).

## Agent decision loop and safety limits

An AI agent reads ArcHive through the API or the MCP server and calls a service through the SDK
([`packages/sdk`](packages/sdk/)). The loop can stop at three points: before the request is encrypted, before a payment
is signed, and before the answer is used. Payments are signed by the agent's own wallet (for x402, a plain account, an
EOA, today) or by a person in theirs: one capped authorization per call, or one deposit per session. The MCP server and
AskHive only read and prepare, and a person signs what they prepare, in their own wallet.

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
   - *Prepaid session (product 1).* One EIP-3009 deposit into `SessionPay`. The session is locked to one enclave, one
     operator, one model and one price. Settlements never pay more than the deposit, and what is not spent is refunded
     at close.
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
   whole bond and ban it, and `VerdictLog` writes 0 to the ERC-8004 registry. A session that was served and paid closes
   with a verdict of 100. The refutation demo ran on Arc on 10 Nov, and sessions closed with 100 on 9 and 19 Nov
   (see [Proofs on Arc testnet](#proofs-on-arc-testnet)).

Every payment in [our proofs](#proofs-on-arc-testnet) came from our own testnet wallets.
[`packages/sdk/scripts/x402-call.ts`](packages/sdk/scripts/x402-call.ts) is a buyer that runs this loop with the SDK.

**Safety limits**

| Limit | The rule today | Enforced in |
|---|---|---|
| Per-call cap | Nothing is signed above the agent's `maxAmount`, and a price that rises during a call needs a new consent. The authorization is for the exact price, to `X402Settler` only, valid 60 s to 1 h. The site and the console set `maxAmount` to the price they show, and their wallet guard refuses any other signature. | SDK ([`x402.ts`](packages/sdk/src/x402.ts)); USDC's EIP-3009 fixes the amount and the payee |
| One payment, one call | The nonce commits to the sealed request, and an authorization re-signed after a price change keeps the same nonce. `X402Settler` collects only with an enclave receipt carrying that nonce, and USDC accepts a nonce once. | SDK, contract ([`X402Settler.sol`](contracts/src/X402Settler.sol)) |
| Session budget | Settlements never pay more than the deposit, or a lower `cap`. Price and model are locked at opening, and the rest is refunded at close. | Contract ([`SessionPay.sol`](contracts/src/SessionPay.sol): `settle`, `closeSession`) |
| Admitted enclaves only | The SDK encrypts only to a key Arc registered for this product and active now. Settlement pays only a signer that was active for the product at the receipt's anchor block (for a session, the enclave locked at opening). | SDK ([`enclave-keys.ts`](packages/sdk/src/enclave-keys.ts)), contracts (`EnclaveRegistry.activeOperatorAt`) |
| Allowed images only | Admission requires an image fingerprint the product's author allowed. Once an image is retired, anyone can invalidate its enclaves at once, with no grace period (`invalidateRetiredWorkload`). | Contract ([`EnclaveRegistry.sol`](contracts/src/EnclaveRegistry.sol), [`ProductRegistry.sol`](contracts/src/ProductRegistry.sol)) |
| No signing tool | The MCP server holds no key, and none of its 16 tools sends a transaction. AskHive has no tool that spends. Both return operations that people sign in their own wallet. | MCP ([`services/mcp`](services/mcp/)), AskHive ([`enclave-site.ts`](services/copilot/src/enclave-site.ts)) |
| Bond exposure | An operator's enclaves can release at most half of its bond in any 24 hours, all products together, and at most 10 USDC per product on testnet ([the rule](#economic-design-and-risk-assumptions)). | Contract ([`OperatorBond.sol`](contracts/src/OperatorBond.sol): `consumeExposure`) |
| Slashing | A proven fault seizes the whole bond and bans the operator ([who receives it](#economic-design-and-risk-assumptions)). | Contract (`OperatorBond.slash`, called by `SessionPay` and `SealedBounty`) |

The most a dishonest enclave can take from an agent is what the agent signed: one call's price, or what it deposited in
a session. An attestation proves which code ran, not that an AI answer is right, so only provable faults are slashed
(see [Economic design and risk assumptions](#economic-design-and-risk-assumptions)).

## Economic design and risk assumptions

**Who pays whom.** The contracts enforce every split, in the transaction that moves the USDC.

- **Buyers pay per use**, from a prepaid session (`SessionPay`) or with one authorization per call (`X402Settler`).
  Each payment is split between operator, author and network: `ProductRegistry` keeps the network at 5 % or more and
  an author at 30 % or less, and the operator gets the rest. All seven products are ours and set no author share, so
  each one splits **95 / 0 / 5**.
- **Protocols fund bounty pools** (`SealedBounty`, `SealedBountyVerified`). The hunter gets 100 % of the tier the
  exploit reaches. On top, and only when a claim is paid, the pool pays 10 % to the network and 5 % to the operators
  whose enclaves signed the claim. On 9 Nov, a 0.5 USDC tier paid 0.5 to the hunter, 0.05 to the network and 0.025 to
  the operator ([`0xecbd089a…807e`](https://explorer.testnet.arc.io/tx/0xecbd089a092edd939ff646fae8d22c0f2616b6a92f58a49928c231c770bb807e)).
- **Operators pay the gas** of admissions (0.14 to 0.17 USDC each) and of settlements
  ([gas table](#usdc-is-the-money-and-the-gas)). Admission charges no fee beyond gas. At testnet prices, settling one
  0.01 USDC call costs about 0.005 USDC of the operator's 0.0095 USDC share, while a session settles many requests on
  one receipt.

**What the operator puts at stake** (`OperatorBond`):

- The operator owns its USDC bond. Each enclave reserves the product's minimum bond (1 USDC on the live products), and
  only the free rest can be withdrawn.
- **Exposure caps.** On the word of an operator's enclaves, the settlement contracts release at most half of its bond
  (less any pending withdrawal) in any 24 hours, all products together, and at most each product's exposure cap
  (10 USDC on testnet). Our operator's 8 USDC bond allows 4 USDC per 24 hours.
- **Slashing.** A fault proven on-chain seizes the whole bond and bans the operator: two signed answers to one request,
  or a bounty claim refuted by the enclaves of at least two other operators within 3 days. Half goes to whoever proved
  it, half to the victim, or to the network treasury when there is no victim. It ran on Arc on 10 Nov
  ([`0x0ffca543…051f`](https://explorer.testnet.arc.io/tx/0x0ffca5433186735bf5525e525995f3589d842681da8ffcaa82acb5993025051f)).
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
  our enclave images are not public yet, so a second operator cannot run the allowed fingerprints until we publish
  them.
- **Admin keys.** On testnet, one key, the deployer's (kept off the server), owns `OperatorBond` and `VerdictLog` and
  is the author of all seven products. It can propose a new settlement contract or verdict writer, which waits 8 days,
  and remove one at once. Product changes have no timelock on testnet (`ProductRegistry.timelock` is 0). The mainnet
  plan is a 2-of-3 multisig and 48-hour timelocks.
- **The treasury is the deployer's address on testnet**, so the network's share of every payment and the victimless
  half of a slash go back to that same key.
- **No state proofs yet.** A bounty replay reads Arc's state through a strict relay that re-hashes every block header.
  Per-read state proofs (`eth_getProof`) are implemented and tested, and turn on once an Arc RPC serves historical
  proofs.
- **Scope.** Arc testnet only, with no third-party audit, and every payment so far came from our own wallets.

## Proofs on Arc testnet

**19 Nov 2026 (UTC)**

| What it proves | Time | Transaction |
|---|---|---|
| Product 3 enclave (pay per call) admitted: Intel DCAP and boot-log replay | 00:55 | [`0x54d7cf7e…37ef`](https://explorer.testnet.arc.io/tx/0x54d7cf7e891d489093b139d99db37620f9e422c69005eff4bf1549fb9eae37ef) |
| Product 2 enclave (sealed bounty) admitted | 00:55 | [`0x351edb8c…0357`](https://explorer.testnet.arc.io/tx/0x351edb8ca280a7a0dca7ffbd562afeb9215522df250d28288c28fdc4802f0357) |
| Proof of Cloud token verified on Arc (Ed25519): the chip is declared until 26 Nov | 00:56 | [`0x38c587ae…1e83`](https://explorer.testnet.arc.io/tx/0x38c587aefb3d325383f471be5f6f359dd40123b4c57ce259b0c0bd96987b1e83) |
| Product 1 enclave (private AI) admitted | 01:01 | [`0x3ab1e3da…ae72`](https://explorer.testnet.arc.io/tx/0x3ab1e3dac834f9fb4d5a97f67f7ea5f299b9e92ea3a1a76791a86886e0a1ae72) |
| Product 7 enclave (verified bounty) admitted | 01:02 | [`0xf18cb68f…6a2c`](https://explorer.testnet.arc.io/tx/0xf18cb68f068e5cfaa993a67da2fd98f4c5d73123460533d0901052b06d166a2c) |
| A pay-per-call answer settled by the operator: 0.01 USDC (0.0095 operator, 0.0005 network) | 02:00 | [`0xeadad0b4…fbd0`](https://explorer.testnet.arc.io/tx/0xeadad0b46d51a733997777bccfedd3f05dc69a0a942620f7458c75e35c16fbd0) |
| Prepaid session #2 opened (0.05 USDC), locked on the product 1 enclave | 02:11 | [`0xdb7fc9e3…666d`](https://explorer.testnet.arc.io/tx/0xdb7fc9e3b024415599eee67746ae162f3032add224afed25ab7c09862b83666d) |
| A demo bounty posted on product 7 (1 USDC pool, open until 22 Nov) | 02:16 | [`0x28d12457…daea`](https://explorer.testnet.arc.io/tx/0x28d12457644404621d37c52b4c93fab0317c8b0883adb74f347bf5e65f6edaea) |
| The session settled by the operator on the enclave's last cumulative receipt: 0.034 USDC | 02:20 | [`0x97c17946…79ee`](https://explorer.testnet.arc.io/tx/0x97c17946a14c02cdbdd1d6aafd7a405500b6bd44a5f536c77af560aa0cbc79ee) |
| The session closed: 0.016 USDC refunded and ERC-8004 verdict 100, in one transaction | 03:23 | [`0x95c9f59e…b1c2`](https://explorer.testnet.arc.io/tx/0x95c9f59eee7597a532ce72162b83944e9364b1b600ff35ea6b9fd4eb2290b1c2) |
| AskHive's enclave admitted (product 4) | 22:37 | [`0xde9628b2…0176`](https://explorer.testnet.arc.io/tx/0xde9628b23d0483bb666a0cd13c55c4f32a1204151323a80da9451b0aeb330176) |

**First runs, 9 to 11 Nov 2026 (UTC)**

| What it proves | Time | Transaction |
|---|---|---|
| Inference enclave admitted through on-chain DCAP and RTMR3 replay (6,866,126 gas) | 9 Nov 18:57 | [`0x199c985d…3499`](https://explorer.testnet.arc.io/tx/0x199c985dee537cfe2948f6c721ad1bdd448d538ff08bc8e93a79036a25f33499) |
| An exploit replayed inside TDX with Arc Foundry's `arc-anvil` (6.3 s): claim accepted, target paused | 9 Nov 19:04 | [`0xfe46faea…a5d8`](https://explorer.testnet.arc.io/tx/0xfe46faea86254ae63eedfb3c859d928b1d08a9352b851c6b88ab262bcb7ea5d8) |
| Payout, sealed report and ERC-8004 verdict in one transaction: 0.5 USDC hunter, 0.05 network, 0.025 operator | 9 Nov 19:04 | [`0xecbd089a…807e`](https://explorer.testnet.arc.io/tx/0xecbd089a092edd939ff646fae8d22c0f2616b6a92f58a49928c231c770bb807e) |
| A prepaid session settled by the operator, without the client: 0.0994 USDC | 9 Nov 19:12 | [`0x9430e16a…1bb4`](https://explorer.testnet.arc.io/tx/0x9430e16a5cff9bd099c0a7a5f2b11dc87e4c11ad6444a0cd9c87f71ee72f1bb4) |
| A pay-per-call answer from the browser, settled about 20 s later | 9 Nov 19:25 | [`0xa41f1276…15d9`](https://explorer.testnet.arc.io/tx/0xa41f1276a9f0b0af98d1991ae1ab06e5f1afb3d9bed71bca486ccea7255c15d9) |
| Session closed: 0.9006 USDC refunded and ERC-8004 verdict 100 | 9 Nov 21:04 | [`0xb8299f06…d62f`](https://explorer.testnet.arc.io/tx/0xb8299f0698992da535648b14fe1cdd59231ade96b70a515acd7314afc2c8d62f) |
| A lying enclave's inflated claim (2 USDC instead of 1) accepted | 10 Nov 00:07:24 | [`0x6aee80e9…b0ea`](https://explorer.testnet.arc.io/tx/0x6aee80e974458ba251d75d7d82f8bfe361006fc328fc1416816221a2e76eb0ea) |
| Refuted by two other operators' enclaves 16 s later: bond seized, operator banned, verdict 0 | 10 Nov 00:07:40 | [`0x0ffca543…051f`](https://explorer.testnet.arc.io/tx/0x0ffca5433186735bf5525e525995f3589d842681da8ffcaa82acb5993025051f) |
| Proof of Cloud alliance token verified on Arc (Ed25519) | 10 Nov 23:01 | [`0x3e2aa322…cd35`](https://explorer.testnet.arc.io/tx/0x3e2aa32251a7a7cfa7ee69c3fa653cac6dd4272db2ae92d1b4ed760178fdcd35) |
| An enclave bound to its chip (PPID read from Intel's certificate) | 11 Nov 17:34 | [`0xd6928088…5f4f`](https://explorer.testnet.arc.io/tx/0xd6928088d90f8bbc2585d04564c4a574312593f3f19792a1cdbf819437bb5f4f) |

The site keeps the full proof chain of a live enclave: image, Intel measurement, Arc admission, signed answer, USDC
payment and ERC-8004 verdict. Read it with `curl -s https://arc-hive.xyz/api/proof`.

## Contracts on Arc testnet (chainId 5042002)

**Live stack, v2.1 (13 contracts in service).** Every address and deployment transaction is in
[`deployments.v21.testnet.json`](deployments.v21.testnet.json), and Intel's verifier is in
[`deployments.dcap.testnet.json`](deployments.dcap.testnet.json).

| Contract | Address | Role |
|---|---|---|
| EnclaveRegistry | [`0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d`](https://explorer.testnet.arc.io/address/0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d) | admits a machine after Intel DCAP, boot-log replay and policy |
| TdxAttestationModule | [`0x26C1803dE523aC896Ba7F1787f1401ec792951ca`](https://explorer.testnet.arc.io/address/0x26C1803dE523aC896Ba7F1787f1401ec792951ca) | calls Automata's DCAP verifier on Arc |
| ProductRegistry | [`0x582a3076cf6A1347907565B57Ce9f548D33805A4`](https://explorer.testnet.arc.io/address/0x582a3076cf6A1347907565B57Ce9f548D33805A4) | products, prices, shares, allowed images, timelocks |
| OperatorBond | [`0xe584F7590e4677372eE6259b967672c747eB6850`](https://explorer.testnet.arc.io/address/0xe584F7590e4677372eE6259b967672c747eB6850) | USDC bonds, exposure cap, slashing |
| SessionPay | [`0x8Bf8A8356f53006E9aB359AA6382f783923058a6`](https://explorer.testnet.arc.io/address/0x8Bf8A8356f53006E9aB359AA6382f783923058a6) | prepaid sessions (product 1) |
| X402Settler | [`0xccDb1a5641F2F3f2Cf2112c8E14669DBb6E11634`](https://explorer.testnet.arc.io/address/0xccDb1a5641F2F3f2Cf2112c8E14669DBb6E11634) | pay per call, x402 (product 3) |
| SealedBounty | [`0x182871d34438aB37a7FD4d8689f3e0812E447A9b`](https://explorer.testnet.arc.io/address/0x182871d34438aB37a7FD4d8689f3e0812E447A9b) | sealed bounties and refutation (products 2 and 5) |
| VerdictLog | [`0x2B4AB39B461Ae2bA9ADfb6bC630D34553BAb9779`](https://explorer.testnet.arc.io/address/0x2B4AB39B461Ae2bA9ADfb6bC630D34553BAb9779) | verdicts to the ERC-8004 registry on Arc |
| MachineRegistry | [`0xD671013f556b1272b25E3cC17C889d402f4Dc26D`](https://explorer.testnet.arc.io/address/0xD671013f556b1272b25E3cC17C889d402f4Dc26D) | chip ID (PPID) read from Intel's certificate |
| ProofOfCloudAuditor | [`0xcdC4C150344F06d506dEB5500332737E8DCC8FaB`](https://explorer.testnet.arc.io/address/0xcdC4C150344F06d506dEB5500332737E8DCC8FaB) | verifies the Proof of Cloud alliance's token |
| Ed25519Verifier | [`0x031579DD04398249feB67852632da4A648D4b5cf`](https://explorer.testnet.arc.io/address/0x031579DD04398249feB67852632da4A648D4b5cf) | Ed25519 (RFC 8032) for that token |
| PolicyEnclaves | [`0x665f4Bb3C31d23463f45e4092487F6b498490417`](https://explorer.testnet.arc.io/address/0x665f4Bb3C31d23463f45e4092487F6b498490417) | each product's required operator level |
| SealedBountyVerified | [`0x36A8DdF9fcb1308B9e86425beC9B098e933c7348`](https://explorer.testnet.arc.io/address/0x36A8DdF9fcb1308B9e86425beC9B098e933c7348) | sealed bounty, verified operators (product 7) |

Used, not ours: the ERC-8004 validation registry `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` and identity registry
`0x8004A818BFB912233c491871b3d84c89A494BD9e`, as listed by Arc; Automata's DCAP entry point, deployed by us from its
MIT code, `0x48640f7d94dE64b13c89686F3d1240A31Aeb4dc9`; USDC `0x3600000000000000000000000000000000000000`.

**Next stack, v3.** Fourteen contracts were deployed on 19 Nov 2026, between 20:33 and 20:37 UTC: the 13 above, rebuilt
from `contracts/src`, plus `DemoVault`, a target for the bounty demos (`migrate` deliberately has no access control).
Every settlement contract is authorized at initialization, and five products are published. The stack is not switched
on yet: the site, the API and the enclaves stay on v2.1. Addresses, transactions and the bytecode check against this
source are in [`deployments.v3.testnet.json`](deployments.v3.testnet.json), and on the explorer, starting with the v3
[`EnclaveRegistry`](https://explorer.testnet.arc.io/address/0xc854ebA7C28f4b53f50018EAcF40D617Ba76e38E).

## Timeline

Most of ArcHive's back end existed before the hackathon week. The week went into the marketplace site, AskHive and the
live network.

**Before 13 Nov 2026** (the dates come from the deployment records and Arc's explorer):

- **Contracts** (`contracts/`): stack v2 deployed on Arc testnet on 7 Nov, v2.1 (the live stack) on 9 Nov, and the
  operator-level contracts on 10 Nov.
- **Intel DCAP on Arc** (`dcap-integration/`): Automata's verifier deployed on 7 Nov with Intel's collateral,
  refreshed on 9 Nov.
- **Enclave kit and products** (`enclave/`): private AI (prepaid sessions and pay per call), the sealed bounty with its
  `arc-anvil` replay, the refutation demo and the verified bounty. Enclaves were first admitted through Intel DCAP on
  7 Nov, and the first runs on v2.1 date from 9 to 11 Nov.
- **SDK, `arcvault` CLI and operator agent** (`packages/`).
- **Read API and registrar** (`services/api`, `services/registrar`).
- **Console** (`web/`), served at the server's address.
- **First copilot** (`services/copilot`): the console's assistant, which also ran in its own enclave as product 4.
- **MCP server** (`services/mcp`) over stdio, with the same 16 tools.

**From 13 to 20 Nov 2026** (in this repository's commits and on the live site):

- **The marketplace site** (`frontend/`): the home page and its film, the services rack with a page per service, the
  Network page (use, rent and publish, with a 3D demo), the Doc with its Tokenomics chapter, My space, and the Bridge
  page for CCTP transfers to Arc.
- **AskHive** (`frontend/src/copilot/`, `services/copilot`): the copilot's site surface, which opens pages, highlights,
  plays the 3D demo, guides a task and prepares operations to sign. Its own enclave build signs every reply, and Arc
  admitted it as product 4 on 19 Nov.
- **The MCP server over HTTP**, online at `/mcp` for AI agents.
- **The 3D server room** (`web/public/datacenter`): sketched on 12 Nov, built on 13 and 14 Nov, online since 15 Nov.
- **Console updates**: prices with their unit, the exposure and slashing rules, and a link to the 3D room.
- **Product 7 switched on**: past its 8-day delay, its settlement contract was authorized to slash bonds (18 Nov,
  23:59 UTC) and to write verdicts (19 Nov, 00:15 UTC).
- **The network relaunched on 19 Nov**: five enclaves admitted on Arc (products 1, 2, 3 and 7 from 00:55 UTC, AskHive
  at 22:37 UTC).
- **Stack v3 deployed on 19 Nov**: 14 contracts, not switched on yet.
- **Claude Code's request format on ArcHive's private inference**, tested on 19 Nov (three paid calls).

The commit dates in this repository are not the dates the code was written. The code from before 13 Nov came in
through bulk commits, most of them dated 16 Nov, and Arc's explorer dates each deployment.

## Run it

Nothing to install to try it: the site, the API and the MCP server above are live on Arc testnet.

```sh
# Each line runs from the repository root.

# Contracts (Foundry): 30 Solidity files, 253 tests
(cd contracts && forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git && forge build && forge test)

# SDK and CLI (Node.js 22); the services and the CLI use packages/sdk by path, so install it first
(cd packages/sdk && npm ci && npm test)
(cd packages/cli && npm ci && npm run arcvault -- --help)

# Enclave kit and products
(cd enclave && npm ci --legacy-peer-deps && npm test)

# Services: the read API, the copilot (copy .env.example to .env to run it), the MCP server (stdio; start:http for HTTP)
(cd services/api && npm ci && npm start)
(cd services/copilot && npm ci && npm test)
(cd services/mcp && npm ci && npm test && npm start)

# The site (reads the live API) on http://localhost:5261, and the console
(cd frontend && npm ci && npm run dev)
(cd web && npm ci && npm run dev)

# The operator agent's tests, then an operator machine (an Intel TDX VM)
(cd packages/node && npm ci && npm test)
curl -fsSL https://arc-hive.xyz/install.sh | sh
archive-node doctor && archive-node pair && archive-node up --product 1 --tunnel
```

Server deployment: [`deploy/README.md`](deploy/README.md). Intel's verifier on Arc: [`dcap-integration/`](dcap-integration/).

## Repository map

```
contracts/          Solidity (Foundry): registry, boot-log replay, products, bonds, payments, bounties, verdicts, operator levels
dcap-integration/   Automata's DCAP verifier on Arc: deployment, Intel collateral, on-chain verification
enclave/            enclave kit and products (private AI, x402, sealed bounty), Dockerfiles, Phala compose files
packages/sdk/       TypeScript SDK: sessions, x402, AskHive client, key checks, receipts, boot-log encoder, bounties, levels
packages/cli/       arcvault CLI: sessions, bounties, operators, products, auditors, local OpenAI-compatible proxy
packages/node/      archive-node, the operator agent for an Intel TDX machine
services/api/       read API with its own index of contract events
services/registrar/ operator service: renews admissions, settles sessions and paid calls
services/copilot/   AskHive and the console copilot: read the chain, drive the site, prepare transactions to sign
services/mcp/       MCP server for AI agents (Streamable HTTP and stdio)
frontend/           the marketplace site (Vite, React, three.js)
web/                the console (React, English and French) and the 3D server room (web/public/datacenter)
deploy/             server deployment (built on the server from this source)
docs/               operator levels, the AskHive and MCP contract, screenshots of the site
deployments.*.json  every deployed address and transaction: v2, v2.1 (live), v3, Intel's DCAP verifier
```

Package guides: [`contracts`](contracts/README.md), [`dcap-integration`](dcap-integration/README.md),
[`enclave`](enclave/README.md) (and its [compose files](enclave/phala/README.md)), [`packages/sdk`](packages/sdk/README.md),
[`packages/cli`](packages/cli/README.md), [`packages/node`](packages/node/README.md),
[`services/api`](services/api/README.md), [`services/registrar`](services/registrar/README.md), [`web`](web/README.md),
[`deploy`](deploy/README.md).

## What's next

- **The v3 switch.** Move the site, the API and the enclaves to the v3 stack, already deployed, after the hackathon.
- **A budget on the buyer's side.** Accept smart-account payers in the enclave (ERC-1271), so an agent's spending
  rules can live in an EIP-7702 smart account or in ERC-7715 / ERC-7710 delegated permissions, on top of today's
  per-call cap.
- **Circle Agent Wallets** for buying agents, with daily limits.
- **Circle Nanopayments** for sub-cent calls, with each batch still tied to the enclaves' signed receipts.
- **Product 3 in Circle's Agent Marketplace**, once it speaks x402 v2.
- **ERC-8183 job escrow**, for longer agent jobs that an admitted enclave completes and signs.
- **A second operator.** Publish the enclave images, so any operator can run the allowed fingerprints, and bring in a
  second, independent operator.
- **Mainnet.** Intel's verifier first, then the contracts behind a 2-of-3 multisig and 48-hour timelocks.
- **The developer kit.** Streaming in the `arcvault` proxy, so Claude Code can use a prepaid session behind the
  gateway, and the SDK and the CLI on npm.

## Feedback for Arc and Circle

- Arc Foundry's `arc-anvil` made exact exploit replays possible: plain anvil cannot reproduce Arc's native USDC.
- Arc's P-256 precompile is what makes on-chain DCAP affordable.
- Two asks: an Arc RPC that serves historical `eth_getProof`, and Intel's DCAP verifier on Arc mainnet as a shared
  public good.

## License

MIT, see [LICENSE](LICENSE). Vendored third-party code keeps its own license and records its exact upstream commit:
[solady](contracts/lib/solady-0.0.160/VENDORED.md) and [Smooth CryptoLib](contracts/lib/smooth-crypto-lib/VENDORED.md).

## Team

- Jean-Baptiste Durand ([@JeanBaptisteDurand](https://github.com/JeanBaptisteDurand))
- Florent Belotti ([@FlorentBelotti](https://github.com/FlorentBelotti))
