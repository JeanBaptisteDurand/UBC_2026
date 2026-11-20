# How ArcHive works

The details behind the [README](../README.md): how Arc admits a machine, how ArcHive uses Arc, AskHive, the agent's decision loop and safety limits, and the economics.

Two parts of this page have their own pages: [how an AI agent pays](agent-payments.md) and [ArcHive on Arc, with Circle's tools](arc-and-circle.md).

## How Arc verifies an enclave

**Admission** (`EnclaveRegistry`, `TdxAttestationModule`):

- **Intel's signature.** The enclave registers with a fresh TDX quote. The registry verifies it through Automata's
  DCAP verifier, which we deployed on Arc with Intel's collateral. Arc's P-256 precompile cuts the cost of that check
  by a quarter ([measured](arc-and-circle.md#arc-checks-the-machine)).
- **The image fingerprint.** The registry replays the VM's RTMR3 boot log in Solidity (SHA-384 written for the EVM,
  about 55 k gas per 128-byte block) and requires it to match the quote. It then admits the enclave on
  `keccak256(MRTD ‖ RTMR0 ‖ RTMR1 ‖ RTMR2 ‖ compose-hash ‖ os-image-hash ‖ XFAM ‖ TDATTRIBUTES)`: the compose that
  runs and the production OS image, nothing instance-specific. Only fingerprints the product's author allowed pass.
- **The policy.** Debug mode off, `SEPT_VE_DISABLE`, firmware (TCB) up to date, a quote bound to a recent Arc block
  (EIP-2935, within 8,191 blocks), `REPORTDATA` binding chain, registry, product, operator and the enclave's keys,
  a quote never seen before, and enough free bond.
- **The cost.** 6.6 to 6.9M gas per registration, 0.13 to 0.17 USDC at 20 to 25 gwei, paid by the operator
  ([gas table](arc-and-circle.md#usdc-is-the-money-and-the-gas)). The operator's registrar renews each admission before its window ends.

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
  settlements ([gas table](arc-and-circle.md#usdc-is-the-money-and-the-gas)). Admission charges no fee beyond gas. At testnet prices,
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

