# ArcHive — run anything in an Intel TDX enclave that an Arc contract verifies, paid in USDC

ArcHive is an open network: anyone can run a service inside an **Intel TDX enclave**; an **Arc smart contract verifies the enclave's attestation** (Intel's signature on the TDX quote, through DCAP) before it accepts a single result; every use is **paid in USDC** against a receipt signed by the enclave; verdicts go to Circle's **ERC-8004 validation registry**. Four products run today:

- **Private AI inference** — your prompt is encrypted to the enclave (the operator and our server never see it); the enclave forwards it over HTTPS to the model provider (RedPill, `gpt-oss-120b`), signs each answer with a receipt and bills it; you pay per use from a prepaid session, and the operator settles it without you.
- **Pay-per-call inference (x402)** — the same model behind HTTP 402: no session, no deposit; one EIP-3009 signature pays exactly one call (0.01 USDC), the operator settles it on-chain.
- **Sealed Bounty** — a protocol funds a bounty with a machine-checkable loss rule; a hunter's exploit is **replayed inside the enclave on a fork of Arc** (Circle's own `arc-anvil`, Arc precompiles included); if the loss is real, the hunter is paid in the same flow, the target is paused, and the encrypted report goes to the protocol only. Nothing is executed on the real chain.
- **Attested copilot** — the site's assistant runs in its own enclave; the browser checks its key on Arc, then encrypts the conversation to it: the web server in between sees ciphertext only.

> **Status — 12 Nov 2026, Arc testnet, stack v2.1 (the operator-levels stack was redeployed 11 Nov after a security review; verified bounty is now product 7).** Everything below runs live and is verifiable on-chain. Not on mainnet yet.

## Live

| | |
|---|---|
| Console | https://archive.62-171-153-35.sslip.io — the overview shows the **proof chain** of the live enclave (image → Intel measurement → Arc verification → signed answer → USDC payment → ERC-8004 verdict); every step links to its transaction |
| Read API | https://archive.62-171-153-35.sslip.io/api — `/proof`, `/stats`, `/activity`, `/enclaves`, `/products`, `/bounties`, `/index` (own event index of the v2.1 contracts) |
| Enclaves | three Intel TDX VMs on Phala Cloud, **production OS image `dstack-0.5.12`** (no SSH, no debug access): inference + x402 (`/enclave/inference/`, `/enclave/x402/`), Sealed Bounty (`/enclave/bounty/`), copilot (`/enclave/copilot/`). **Clients verify each enclave's key against the chain before encrypting.** |
| Contracts | [`deployments.v21.testnet.json`](deployments.v21.testnet.json) (registry `0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d`) · DCAP stack: [`deployments.dcap.testnet.json`](deployments.dcap.testnet.json) · explorer https://explorer.testnet.arc.io |

## Verify it yourself (Arc testnet transactions)

| Step | What it proves | Transaction |
|---|---|---|
| Automata DCAP + Intel collateral deployed on Arc | Arc can check Intel's signature on-chain | `deployments.dcap.testnet.json` |
| Contracts v2.1 deployed (10 tx, 15.26 M gas, 0.381 USDC) | registry wired to the real DCAP module, `requireSeptVeDisable = true` | `deployments.v21.testnet.json` (`deployTxs`) |
| Inference enclave registered **through on-chain DCAP**, admitted on its **image fingerprint** | the registry ran Intel's verification, then **replayed the VM's RTMR3 event log in Solidity (SHA-384)** and matched the quote | `0x199c985dee537cfe2948f6c721ad1bdd448d538ff08bc8e93a79036a25f33499` (6,866,126 gas, 0.17 USDC) |
| x402, bounty and copilot enclaves registered the same way | one image fingerprint per VM, stable across restarts | `0x5490b4245e2b67347afe55bb85b40053b2d1f082c73415d3d8d1bce46a27ea42`, `0x769f9670d231c4037eeea5dd7ba05bdee0f1c95d6acf43a832b6a73c58a712ab`, `0x98296275e1c74b78a3c9ed8b8113eb2f69580e14029fb1f2f414676b4664186b` |
| Three pay-per-call answers settled by the operator | `X402Settler.settle` on the enclave's call receipt and the payer's EIP-3009 authorization | `0x4cb8fefc580d7becbb0c240fa8c628ef5716c0c5605a86d2169329592cf547c6`, `0xce017a4d3ac3dc0f67f8a308da2d939c3bca272aafd62b00b167c6c702bc66ee`, `0x5e3108836aff3c0b69ebe426d45a8a10008a37db805efd26ae20482f8b3e1d14` |
| The same, **from a browser**: the console's Private AI page, pay-per-call mode, the site's test wallet signs one authorization, the answer comes with a verified receipt, then "Settled on Arc by operator" | `X402Settler.settle` by the operator's registrar, ~20 s after the answer | `0xa41f1276a9f0b0af98d1991ae1ab06e5f1afb3d9bed71bca486ccea7255c15d9` |
| A prepaid session settled **by the operator, without the client** | the operator's registrar fetched the enclave's latest receipt (994 units) and settled 0.0994 USDC | `0x9430e16a5cff9bd099c0a7a5f2b11dc87e4c11ad6444a0cd9c87f71ee72f1bb4` |
| Session closed: unused deposit refunded and **ERC-8004 verdict 100/100** written for the operator's agent (897812), in one transaction | the proof chain's last step, now on v2.1 | `0xb8299f0698992da535648b14fe1cdd59231ade96b70a515acd7314afc2c8d62f` |
| Sealed Bounty paid on an exploit **replayed with arc-anvil inside TDX** | replay on a fork of Arc in 6.3 s, claim signed by the enclave and checked by the contract, hunter paid, target paused, report decrypted by the protocol only | claim `0xfe46faea86254ae63eedfb3c859d928b1d08a9352b851c6b88ab262bcb7ea5d8`, payout + verdict `0xecbd089a092edd939ff646fae8d22c0f2616b6a92f58a49928c231c770bb807e` |
| **A lying enclave is caught and slashed** (separate, labelled demo: product 5, all keys are the team's) | an enclave running a measured, deliberately faulty image signs a claim with a doubled loss; the contract accepts it; two other operators' enclaves replay the exploit at the same block, sign the real loss; `refute` seizes the liar's bond, bans it, returns the payment to the pool and writes ERC-8004 verdict 0 | lying claim accepted `0x6aee80e974458ba251d75d7d82f8bfe361006fc328fc1416816221a2e76eb0ea`, refute `0x0ffca5433186735bf5525e525995f3589d842681da8ffcaa82acb5993025051f` |
| Attested copilot answers | `packages/sdk/scripts/copilot-chat.ts` verifies the copilot's key on Arc (product 4, image fingerprint, operator), sends an HPKE-encrypted question, opens the sealed answer | run it: `DEPLOYMENTS=deployments.v21.testnet.json COPILOT_URL=https://archive.62-171-153-35.sslip.io/enclave/copilot PRODUCT_ID=4 npx tsx scripts/copilot-chat.ts` |
| The RTMR3 replay, by yourself | `EnclaveRegistry.replayEventLog(bytes)` is a pure view: feed it the encoded event log of any of our enclaves (`/attest`) and compare with the quote's RTMR3 | `packages/sdk/src/dstack-eventlog.ts` encodes it |

## What is new, what is assembled

**Built here (did not exist before):**

| Piece | In plain words | Why it is new |
|---|---|---|
| **A contract that verifies an enclave** | A notary on Arc that checks Intel's signature on the enclave before accepting a single result | Checked on 1 Nov 2026: no contract on Arc did this |
| **A stable image fingerprint** (v2.1) | A restarted VM used to get a new fingerprint and was no longer recognised; the contract now replays the VM's boot log (RTMR3) and keeps only what identifies the image | SHA-384 written in Solidity; formula verified on real Arc blocks and real TDX VMs |
| **Pay-per-call (x402)** | One 0.01 USDC signature per question, no account, no deposit | The receipt is signed by the enclave; the operator settles it on-chain automatically |
| **A copilot inside an enclave** | The site's assistant runs in its own verified VM; the conversation is encrypted to it | The web server in between sees ciphertext only |
| **A strict RPC relay** | A checker between the Sealed Bounty replay and the chain: every response is verified, and in doubt nothing is signed | A forged block is detected (headers re-hashed and chained to an on-chain anchor) |
| **Refutation, shown for real** | A deliberately lying enclave inflates a loss; two other enclaves replay the exploit, prove the lie, and the contract seizes the liar's bond | `0x6aee80e974458ba251d75d7d82f8bfe361006fc328fc1416816221a2e76eb0ea`, then `0x0ffca5433186735bf5525e525995f3589d842681da8ffcaa82acb5993025051f` |
| **Two operator levels** (10 Nov) | Anyone can run an enclave (open level). Products that need physical security require machines verified in a known datacenter (verified level), by an auditor the product picks | The machine's chip (PPID) is read **on-chain** from Intel's certificate in the registered quote; the **Proof of Cloud** alliance's co-signed token is verified **on-chain** (Ed25519); a policy adapter makes the Sealed Bounty enforce it with no code change — see [docs/OPERATORS.md](docs/OPERATORS.md) |
| **Verified model provider** (11 Nov) | Before any call, the inference enclave verifies the model provider's own enclave (Intel quote, production OS), pins TLS to its attested key and requires a signed receipt per answer | "The provider reads your prompt" became "only attested enclaves see it": the AI gateway's attestation is now checked by our enclave, not assumed |

**Assembled (existing pieces):**
- **Intel TDX**: the hardware enclave.
- **Phala Cloud** (dstack): the rented enclave VMs, on the **production** OS image (the debug image allows SSH access).
- **Automata DCAP**: the verifier of Intel's certificates, deployed by us on Arc (7 Nov).
- **Proof of Cloud**: the alliance (Phala, Secret, Nillion, iExec, Automata, Flashbots, Oasis…) that inspects machines in datacenters and signs which chips are verified; our machine is on its list (10 Nov).
- **Smooth CryptoLib**: Ed25519 in Solidity (MIT, audited 2024), to verify the alliance's signature on Arc.
- **RedPill** (Phala): the AI model (`gpt-oss-120b`), reached through its attested gateway, which our enclave verifies with Phala's `@phala/aci-verifier` (Apache-2.0) before any call.
- **Arc / Circle**: USDC as money and gas, Circle's `arc-anvil` to replay exploits, Circle's ERC-8004 registry for verdicts.

## Two operator levels

| | Open level | Verified level |
|---|---|---|
| Checked on Arc | Intel attestation (DCAP), image, key binding, USDC bond | All of that, plus the **machine's chip** (PPID from Intel's certificate) declared in a known datacenter by an auditor the product accepts |
| Reference auditor | — | **Proof of Cloud** alliance, its co-signed token verified on-chain by `ProofOfCloudAuditor` |
| Who decides | — | The product author (policy, timelocked); buyers can ask for more |
| Price | Operator's | Operator's (a verified operator can charge more); **no protocol fee for verification** |

Live on Arc testnet (10 Nov): `MachineRegistry` `0xd671013f556b1272b25e3cc17c889d402f4dc26d`, `ProofOfCloudAuditor` `0xcdc4c150344f06d506deb5500332737e8dcc8fab`, `PolicyEnclaves` `0x665f4bb3c31d23463f45e4092487f6b498490417`, verified-level `SealedBounty` `0x36a8ddf9fcb1308b9e86425bec9b098e933c7348`.
- Our four enclaves are bound to their machine (PPID `62d54040…`).
- The alliance's token for that machine was verified on-chain in tx `0x5ca34002fca5de1614cfa7a52aef3eb638f7bc3b358a13a5dd86d860e7c5c7a3`.
- So all four enclaves are at the **verified** level (`arcvault operator level`, `GET /api/levels`, badges on the Hive page).
- The verified Sealed Bounty can slash from 18 Nov 21:13 UTC: a new settlement contract waits 8 days, so operators can leave first.
- **Product 7 ("Sealed Bounty, verified operator level") requires the verified level.** Its policy is level 1 with the alliance as auditor. Its enclave (own TDX VM on the declared machine, signer `0x1306d239…`, registered through DCAP) is bound and counts on-chain (`meetsPolicy(7) = true`). Its replay *can* prove every state read (`eth_getProof`).

The kit for both levels is in [docs/OPERATORS.md](docs/OPERATORS.md):
- **operators:** CLI `arcvault operator …`;
- **auditors:** `arcvault auditor attest|revoke`;
- **product authors:** `arcvault product policy`;
- **buyers:** SDK `describeLevel`;
- **day to day:** the registrar keeps the level (re-binds after each renewal, refreshes the alliance token).

## How it works

- **Enclave kit** (`enclave/src/kit`): keys born in enclave memory; the TDX quote's `REPORTDATA` binds chain, registry, product, operator, signer, X25519 key and a recent block (EIP-2935); `/attest`, `/pubkeys`; EIP-712 receipts; HPKE for client encryption.
- **On-chain verification** (`contracts/src`): `EnclaveRegistry` calls `TdxAttestationModule` → Automata DCAP on Arc; it refuses DEBUG TDs, requires `SEPT_VE_DISABLE`, an up-to-date TCB, an allowed image and a fresh quote.
- **Image fingerprint (v2.1)**: on Phala/dstack, RTMR3 records an instance id, so a fingerprint over RTMR3 changes at every restart. The registry **replays the dstack RTMR3 event log on-chain** (`DstackEventLog`, SHA-384 written for the EVM, ≈ 55 k gas per block), requires it to reproduce the quote's RTMR3, reads `compose-hash` and `os-image-hash` only before `system-ready`, and admits the enclave on `keccak256(MRTD ‖ RTMR0 ‖ RTMR1 ‖ RTMR2 ‖ compose-hash ‖ os-image-hash ‖ XFAM ‖ TDATTRIBUTES)` — the docker-compose that runs and the OS image, nothing instance-specific. The OS image is the **production** one (`0x8db40cb2…`): a debug image (SSH) has another fingerprint and is not allowed.
- **Products** (`ProductRegistry`): an author publishes a manifest (hash on-chain, file public: [`web/public/manifests/`](web/public/manifests/)), the allowed image fingerprints (two-step, timelocked), a price and a revenue split; the manifest URL can be changed under the same timelock.
- **Payments**: `SessionPay` (prepaid sessions, cumulative receipts, one settle pays everything so far), `X402Settler` (one call, one EIP-3009 authorization whose nonce commits to the exact request), `SealedBounty` (`acceptClaim` then `deliver`; a claim can be **refuted** within 3 days by the replays of at least two other operators — `/v1/refute`, `arcvault bounty refute`). Deposits use EIP-3009 — one signature, no `approve`.
- **Skin in the game**: `OperatorBond` — every enclave reserves a USDC bond; exposure is capped per 24 h; a machine-provable fault (two different signed answers to one request, or a refuted claim) slashes the bond.
- **Verdicts**: `VerdictLog` writes to Circle's ERC-8004 validation registry under the operator's agent identity (agent 897812). v2.1: request hashes are bound to chain and contract and salted (a third party cannot squat them), a refused write leaves `VerdictSkipped`, an unused session writes nothing (`VerdictNotApplicable`), a fault verdict is written even after the session closed. `AttestedSigners` lets any Arc contract accept a message only if an attested enclave of a given product signed it (`onlyAttested`).
- **Operators**: `archive-node` installs on a bare TDX VM and pairs with a wallet by code (no transaction); the operator's **registrar** renews registrations through DCAP and settles served sessions and x402 calls by itself.
- **Fail closed**: the bounty replay never signs a result that depends on an RPC error, a timeout or an environment fault (`503`, nothing signed); it reaches Arc's RPC only through a strict relay that re-hashes every block header and checks every response; predicates are bounded; the x402 gateway bounds unpaid exposure per payer and per window.

## Why Arc

- **P-256 precompile** (0x100): DCAP verification costs 5.21 M gas instead of 6.92 M with a Solidity P-256 verifier (−25%, measured on Arc).
- **Gas in USDC**: every cost is a dollar amount — a full Intel verification with the RTMR3 replay is ≈ 0.17 USDC, an x402 settlement ≈ 0.005 USDC.
- **Sub-second finality**: payment and proof in the same block.
- **EIP-2935** block history: stale quotes and stale replays are refused.
- **Arc Foundry** (`circlefin/arc-foundry`): the bounty replay forks Arc with Arc's own precompiles (native USDC, blocklist, EIP-7708 logs) — no emulation.
- **ERC-8004** validation registry already deployed by Circle on Arc.

## Security

- **Reviews**: the v2.1 contracts went through two independent adversarial reviews, fixes, and a third check (253 Foundry tests; a squattable ERC-8004 request hash, a revert-bomb that could block refunds, an `onlyAttested` gap and a verdict collision were found and fixed). The off-chain services went through repeated adversarial passes with replayed proofs: x402 (double payment through a fake 402, unpaid-call exposure, unauthenticated settlement reports), the copilot (secret filter, cost bounds, provider error leaks, proxy-only access) and the bounty replay (fail-open RPC reads, unbounded predicates).
- **Runtime**: clients **refuse to encrypt** to an enclave key that does not match the registry; each answer is bound to its signed receipt; enclaves run on the production OS image (no SSH); the operator key is separate from the contract owner key (the owner key is not on the server); the attested copilot accepts questions only through the site's proxy (a token held in an encrypted enclave variable) and never sees a private key in clear (alert mode on the whole conversation); CSP, TLS verification of every enclave upstream, minimal container mounts, HTTPS only.
- **Reproducible images**: base images pinned by digest, dependencies from lockfiles; two clean builds give identical bundles (checked on linux/amd64 for the inference and copilot images).

## Economics

Every flow is paid in USDC on Arc, and every cost is known in dollars before anyone signs.

| | Rule (on-chain) | Live testnet value |
|---|---|---|
| Who pays | the user, per unit (session) or per call (x402); the bounty pool for the Sealed Bounty | — |
| Revenue split per product | operator / author / network, set by the author; network share ≥ 5 %, author share ≤ 30 % | 95 % / 0 % / 5 % |
| Bounty fees | taken on each payout, on top of the hunter's tier | network 10 %, operator 5 % |
| Operator bond | every registered enclave reserves the product's minimum bond; total exposure capped per 24 h (and per product) | 1 USDC per enclave, 8 USDC posted |
| Fault | two signed answers to one request, or a refuted claim: the operator's whole bond is seized, half to the reporter, half to the victim (or the network) | — |
| Gas | paid in USDC by whoever sends the transaction: the user opens and closes, the operator registers and settles | registration ≈ 0.17 USDC/day per enclave, settlement ≈ 0.006 USDC |

What this means for an operator: an x402 settlement costs ≈ 0.005–0.006 USDC, so a call must be priced at ≥ 0.01 USDC to be worth settling one by one; a prepaid session amortises one settlement over many answers (the registrar settles once at least 0.02 USDC is due). The testnet prices (0.0001 USDC per token, 0.01 USDC per call) are set high to make every flow visible on the explorer; they are not market prices. Research notes on mainnet economics: `../ubc/research/plan-reseau-enclaves-arc-2026-11-01/F-economie-mainnet-2026-11-07.md` (French).

## Measurements (Arc testnet receipts)

| Operation | Gas | Cost at 25 gwei |
|---|---:|---:|
| Enclave registration (DCAP + on-chain RTMR3 replay) | 6,849,014 – 6,866,126 | ≈ 0.17 USDC |
| DCAP verification of a real TDX v4 quote alone | 5,125,014 | 0.128 USDC |
| x402: settle one call | 204,772 – 256,787 | ≈ 0.005–0.006 USDC |
| Settle a session receipt | 234,612 | ≈ 0.006 USDC |
| Bounty: `acceptClaim` | 463,579 | ≈ 0.012 USDC |
| Bounty: `deliver` (payout + verdict) | 412,240 | ≈ 0.010 USDC |
| Contracts v2.1 deployment (10 tx) | 15,257,922 | 0.381 USDC |

Latency, through the HTTPS proxy, `gpt-oss-120b` called from the TDX enclave, encryption and receipt checks included: x402 calls 2.7–4.1 s each (9 Nov); prepaid session median 2.9 s over 8 requests (8 Nov, v2). Bounty replay of a one-transaction exploit on a fork of Arc inside TDX: 6.3 s.

## Repository

```
contracts/        Solidity (Foundry): registry, RTMR3 replay, products, bonds, payments, bounty, verdicts; 253 tests
enclave/          enclave kit + products (sealed-chat, sealed-x402, sealed-bounty), Dockerfiles, Phala compose files, scripts
packages/sdk      TypeScript SDK (inference, x402 and copilot clients, key verification, receipts, RTMR3 log encoder, bounty)
packages/cli      CLI (sessions, bounties incl. refutation, operator, products, proxy)
packages/node     archive-node: operator agent for a bare TDX machine
services/api      read API with its own event index (Arc RPC, persisted)
services/copilot  copilot (tools that read the chain and prepare actions to sign); runs on the server and in an enclave
services/mcp      MCP server for agents
services/registrar operator service: renew registrations, settle sessions and x402 calls
web/              console (React), English and French
dcap-integration/ Automata DCAP on Arc: deployment plan, collateral, on-chain verification
deploy/           server deployment (built on the server from source), see deploy/README.md
```

