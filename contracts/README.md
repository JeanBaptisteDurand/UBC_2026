# ArcHive contracts

The Solidity side of ArcHive, deployed on Arc testnet (chainId 5042002). These contracts admit a sealed machine
(an Intel TDX enclave) only after Intel's signature and the machine's image are checked on chain, hold each
operator's USDC bond, pay operators in USDC against receipts signed by their enclaves, pay sealed bounties on a
replayed proof, slash a bond for a proven lie, and write every verdict to Circle's ERC-8004 validation registry.

30 Solidity files in `src/`, 253 tests in 21 suites (16 test files), all passing.

## Build and test

```sh
cd contracts
forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
forge build
forge test
```

`forge-std` and OpenZeppelin are installed by `forge install` (they are git-ignored). The two other libraries are
vendored in `lib/` (index: [`lib/VENDORED.md`](lib/VENDORED.md)), each with a `VENDORED.md` that gives its upstream
commit, license and file list:
`lib/solady-0.0.160` (the exact solady version compiled into Automata's DCAP verifier on Arc, so `PckChip` parses
Intel's PCK certificate the same way) and `lib/smooth-crypto-lib` (audited Ed25519 verification, used by
`Ed25519Verifier`).

The build is pinned in `foundry.toml`: solc 0.8.28, EVM `prague`, `via_ir`, 200 optimizer runs, and a separate
profile without `via_ir` for Smooth CryptoLib, as in its own repository.

## The sources are the deployed sources

The runtime code of all 14 contracts of the v3 deployment on Arc testnet matches a build of this folder with this
`foundry.toml` (immutables and metadata masked; the record is `verification.bytecode` in
[`../deployments.v3.testnet.json`](../deployments.v3.testnet.json)).

On 20 Nov 2026 the comments and NatSpec in `src/` were translated from French to English. Nothing else changed:
`forge build` gives every contract the same creation and runtime bytecode as before, apart from the metadata hash
that solc appends (it covers every byte of a source, comments included), and `forge test` still passes all 253
tests. The sources exactly as deployed, with their original French comments, are those of commit
[`d63e9c29`](https://github.com/JeanBaptisteDurand/UBC_2026/tree/d63e9c294beeb48bcddc4f593dee5ae242ea98c2/contracts/src).

## Contracts

### Core (`src/`)

| Contract | What it does |
|---|---|
| `EnclaveRegistry` | Admits an enclave only if its TDX quote passes Intel's signature check (through the attestation module) and the product's policy: an allowed image fingerprint (RTMR3 boot-log replay), debug off, `SEPT_VE_DISABLE`, firmware (TCB) up to date, a quote bound to a recent Arc block (EIP-2935), `REPORTDATA` binding the chain, registry, product, operator and enclave keys, a quote never seen before, and enough free bond. An admission is valid for a number of blocks, then the enclave attests again. |
| `attestation/TdxAttestationModule` | Calls Automata's DCAP verifier on Arc and parses the body of the TDX quote. The registry talks to it through `IAttestationModule`, so another TEE type can be added without touching the products. |
| `ProductRegistry` | The product marketplace: who may run a product, at what price, with what revenue split and which allowed images. New products and price changes wait for a timelock; an author's royalty is capped at 30 % of the price. |
| `OperatorBond` | Each operator's USDC bond. Every enclave reserves the product's minimum bond. On the word of an operator's enclaves, settlement contracts never release more than half of its available bond (the bond minus any pending withdrawal) in any 24 hours, all products together, nor more than the product's exposure cap (10 USDC per product on testnet). A fault proven on chain seizes the whole bond: half to the reporter, half to the victim (or to the network treasury). A bond leaves 7 days after the request and after its last exposure; a new settlement contract can be added only after 8 days. |
| `SessionPay` | Prepaid USDC sessions, served against a session key and paid on the last cumulative receipt signed by the enclave: one transaction per settlement, never one per message. Price, model and billed unit are locked when a session opens, and each session is bound to one enclave. It also bills the paid attempts of the Sealed Bounty. |
| `X402Settler` | Pay per call, the "x402 exact" scheme for agents: the client's EIP-3009 authorization and the enclave's signed call receipt settle in one transaction, which collects the exact amount and splits it between operator, author and network. The EIP-3009 nonce binds the payment to the receipt. |
| `SealedBounty` | A bounty paid on proof: an EIP-712 claim signed by one or k active enclaves of the product that replayed the exploit on a fork of Arc. No exploit runs on chain. The encrypted exploit is delivered and paid in a separate step, a false claim can be refuted during a window by a counter-replay signed by more distinct operators, which seizes the claimers' bonds, and an exploit is never paid twice (a higher tier pays only the difference). |
| `VerdictLog` | Writes each verified verdict to Circle's ERC-8004 validation registry under the operator's agent identity: 100 when a session or a bounty is verified and paid, 0 for a proven fault. Request hashes are bound to the chain and to the calling contract. |

### Operator levels (`src/levels/`)

| Contract | What it does |
|---|---|
| `PckChip` | Reads the leaf PCK certificate inside a DCAP TDX quote exactly as Automata's verifier on Arc does, and extracts the chip's PPID and FMSPC. Hardened against forged PPIDs: the certificate's Base64 body, which no signature covers, must be canonical, so it decodes one way only. |
| `MachineRegistry` | The two operator levels: *open* (attestation and bond) and *verified* (the machine's chip is declared by an accepted verifier). Binds each enclave to its machine and holds each product's level policy. |
| `ProofOfCloudAuditor` | A trustless verifier: checks on chain the EdDSA token co-signed by the Proof of Cloud alliance's trust servers for a given quote, then declares the chip in `MachineRegistry` in its own name. A product that accepts this verifier trusts the alliance, not ArcHive and not whoever submits the token. |
| `Ed25519Verifier` | A standalone Ed25519 (RFC 8032) verifier built on Smooth CryptoLib, compiled without `via_ir`; `ProofOfCloudAuditor` calls it. |
| `PolicyEnclaves` | The `EnclaveRegistry` seen through each product's level policy. The settlement contract of product 7 (`SealedBountyVerified`, the same `SealedBounty` code) reads enclaves through it. |

### Building blocks

| Contract | What it does |
|---|---|
| `attested/AttestedSigners` | The `onlyAttested` primitive: a message is accepted only if it is signed by an enclave key that the registry holds as active for the product at the current block, from an operator in good standing. |
| `lib/DstackEventLog` | Replays the RTMR3 event log of a dstack (Phala) VM on chain and derives the image fingerprint, which is stable across reboots. |
| `lib/Sha384` | SHA-384 (FIPS 180-4) in EVM code, written for this repository, since Arc's EVM has SHA-256 but no SHA-384 precompile; used to replay TDX measurement registers. |
| `lib/History` | Reads a block hash through the EIP-2935 history contract on Arc. |
| `lib/RevertReason` | Copies at most a bounded number of bytes of a callee's revert data, so a hostile callee cannot burn the caller's gas with a "return bomb". |
| `lib/UsdcPayer` | Shared base for collecting USDC, with EIP-3009 `receiveWithAuthorization` (one signature, one call) or `transferFrom` after `approve`. |
| `interfaces/*` | Interfaces of the attestation module, Automata's DCAP entry point, USDC with EIP-3009, the ERC-8004 registries, and the ArcHive registries. |

### Demo and fork helpers

| Contract | What it does |
|---|---|
| `demo/DemoVault` | A deliberately vulnerable USDC vault (`migrate` has no access control), the target of the Sealed Bounty demos. The network can freeze it after an exploit proof. |
| `demo/AttestedBatchVerifier` | A Gateway-style demonstration of `onlyAttested`: a batch of transfer intents executes only when an attested enclave of the product signed it. |
| `fork/ArcUsdcShim` | Reproduces the behaviour of Arc's USDC (an ERC-20 view of the native balance, with transfers through system precompiles) on an ordinary anvil fork. It is installed in the fork only (`anvil_setCode`), never on chain. |

## Deployments

- **Live stack, v3 (14 contracts in service)**: [`../deployments.v3.testnet.json`](../deployments.v3.testnet.json),
  with every transaction and the bytecode check against this source.
  The core is deployed with `script/DeployTestnet.s.sol`; the operator levels and `SealedBountyVerified` with
  [`../enclave/scripts/levels-setup.ts`](../enclave/scripts/levels-setup.ts), which deploys the artifacts built here.
- **The previous set, v2.1**: [`history/deployments.v21.testnet.json`](history/deployments.v21.testnet.json).
- **Intel's verifier** (Automata DCAP, deployed by us from its MIT code with Intel's collateral):
  [`../deployments.dcap.testnet.json`](../deployments.dcap.testnet.json).
- `script/Deploy.s.sol` deploys and wires the core for Arc mainnet. Its guardrails refuse a timelock below 48 h, a
  treasury or owner that is not a contract (multisig), and an owner equal to the deployer key. `script/DeployTestnet.s.sol`
  is refused on Arc mainnet. The deployer key wires `OperatorBond` and `VerdictLog` once, then holds no power.

## What the tests prove

| Suite | What it covers |
|---|---|
| `EnclaveRegistry.t.sol` | Admission and its rejections: REPORTDATA binding (chain, registry, product, operator, keys), quote replay, the EIP-2935 window (8,191 blocks accepted, 8,192 rejected, the current block rejected), expiry and grace windows. |
| `SessionPay.t.sol`, `X402Settler.t.sol` | Both payment rails: receipts, locked prices, exposure caps, EIP-3009 nonces, revenue splits, slashing. |
| `SealedBounty.t.sol`, `LevelsBounty.t.sol` | Claims, block anchoring, delivery, refutation and slashing; the same contract at the verified level. |
| `Registries.t.sol` | `ProductRegistry`, `OperatorBond` and `VerdictLog`: timelocks, royalty cap, bond rules, settlement delays. |
| `AdversarialV2.t.sol`, `AdversarialV21.t.sol` | Regression suites of two adversarial reviews: each `test_FIXED_*` (v2) and `test_F1_*` to `test_F6_*` (v2.1) test replays the exact attack scenario of a finding and proves it now fails, while `test_limit_*` documents what stays out of reach, including a "return bomb" pause target and minimum-gas starvation at the value `eth_estimateGas` picks (found by bisection in `Base.t.sol`). |
| `DstackImage.t.sol` | The image fingerprint on a real Phala dstack quote and its RTMR3 event log, plus the replay rules. |
| `Levels.t.sol` | Both operator levels on real data, including the forged-PPID hardening of `PckChip` (every forged quote is rejected). |
| `Sha384.t.sol` | A differential test of the assembly SHA-384 against a FIPS 180-4 reference implementation. |
| `AttestedSigners.t.sol`, `RevertReason.t.sol`, `Integration.t.sol`, `DeployScripts.t.sol` | `onlyAttested`, bounded revert data, an end-to-end flow, and the mainnet and testnet defaults and guardrails of both deploy scripts. |

`test/Base.t.sol` is the shared fixture. Its test ERC-8004 registry is tuned to cost what Circle's registry costs on
Arc (about 233 k against 238 k gas per verdict), so gas-starvation flaws show up in tests. The mocks in `test/mocks/`
stand in for Automata's DCAP verifier, the EIP-2935 history contract, Circle's ERC-8004 registries and USDC with
EIP-3009.

### Test vectors (`test/vectors/`, read-only)

| File | Content |
|---|---|
| `phala-dstack-attest.json`, `phala-dstack-eventlog.json` | A real TDX quote and RTMR3 event log of our inference enclave on Phala (dstack). |
| `archive-registration-quotes.json` | The quotes from the `registerEnclave` transactions of the v2.1 stack (enclaves 1 to 4). |
| `proof-of-cloud-token.json` | The Proof of Cloud alliance's signed attestation for that machine, as returned by its trust servers: a public JWT signed with EdDSA, which `ProofOfCloudAuditor` verifies on chain. It is a signed public statement about a machine (chip ID, quote hash, timestamp), not a secret key or an access credential. |
| `pck-forged-quotes.json` | Regression vectors for the forged-PPID hardening of `PckChip`. |
| `ed25519-vectors.json` | Ed25519 vectors from `@noble/curves`, including RFC 8032 test 1. |

## Security properties and limits

- **What an attestation proves**: which code runs in the enclave, not that an answer is right. Only faults that can
  be proven on chain are slashed (two signed answers to one request, or a bounty claim refuted by other operators'
  replays).
- **Exposure is capped**: on the word of an operator's enclaves, settlement contracts never release more than half of
  its available bond (`availableBond`: the bond minus any pending withdrawal) over any 24 hours, all products
  together, nor more than the product's exposure cap (10 USDC per product on testnet). The rule counts the available
  bond, not the free bond (`freeBond`: the available bond minus what registered enclaves reserve).
- **Timelocks**: the product timelock is 0 on testnet, so a product activates at once; `Deploy.s.sol` refuses less
  than 48 h on Arc mainnet. A new settlement contract or verdict caller takes effect only 8 days after the owner
  proposes it, longer than the 7-day unbonding delay, so every operator can leave first.
- **Proof of Cloud revocation**: a chip declaration is valid for 7 days (`VALIDITY`) from the token's timestamp, and
  a submitted token must be less than a day old. A revocation by the alliance therefore reaches the chain only when
  the last declaration expires, at most 7 days later; until then, immediate removal is up to the product's author
  (through the product's level policy) or to other verifiers.
- **Scope**: Arc testnet; no third-party audit of these contracts (Smooth CryptoLib is audited, see its
  `VENDORED.md`).
