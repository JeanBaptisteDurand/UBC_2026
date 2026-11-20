# Operators: two levels

ArcHive is open: anyone can run an enclave and get paid in USDC. Some products need more than a correct attestation.
They also need the machine to sit somewhere an attacker cannot touch. So there are two operator levels, and each
product chooses the one it requires.

| | Open level | Verified level |
|---|---|---|
| What is checked | An Arc contract verifies Intel's attestation of the enclave (DCAP), the image and the key binding. The operator posts a USDC bond. | All of the open level. In addition, an **auditor** that the product accepts declares the machine's chip (its **PPID**, read on-chain from Intel's certificate inside the quote) to be in a known datacenter. |
| Who decides | Nobody: open to all. | The **product author** sets the minimum level and the accepted auditors, behind the product timelock. A buyer can ask for more. |
| Reference auditor | — | **Proof of Cloud** (Phala, Secret, Nillion, iExec, Automata, Flashbots, Oasis…). Its members inspect machines in datacenters, and an Arc contract verifies the alliance's signature. |
| Price | Set by the operator. | Set by the operator: a verified operator can charge more. **The protocol takes no fee for verification.** |
| Good for | Low-cost AI inference. | Sealed Bounty, refutation quorums, anything where one stolen attestation key is costly. |

**Why a verified level.** Physical attacks published in 2025 (TEE.fail, Battering RAM, Wiretap) extract attestation
keys from a server the attacker can touch. An attestation then still proves the right code, but no longer that the
machine is untouched. Pinning the chip to an inspected datacenter closes that gap.

## What runs on Arc testnet (the levels stack)

| Contract | Address | What it does |
|---|---|---|
| `MachineRegistry` | [`0xC64e9556AA896b2E8c0bE0fdf3dC7b2c0be24b86`](https://explorer.testnet.arc.io/address/0xC64e9556AA896b2E8c0bE0fdf3dC7b2c0be24b86) | Binds an enclave key to its chip, stores the auditors' declarations, and holds each product's level policy. |
| `ProofOfCloudAuditor` | [`0xEaf8163fa5Eb2f047d4876bb3Ef2E67250360b73`](https://explorer.testnet.arc.io/address/0xEaf8163fa5Eb2f047d4876bb3Ef2E67250360b73) | A trustless auditor. It checks a Proof of Cloud token (EdDSA, co-signed by three trust servers) **on-chain**, then declares the machine for 7 days. |
| `Ed25519Verifier` | [`0xf2c47D6eCD25290C9daa826b3D11AC43baaEcEf6`](https://explorer.testnet.arc.io/address/0xf2c47D6eCD25290C9daa826b3D11AC43baaEcEf6) | Verifies Ed25519 signatures (RFC 8032) with the Smooth CryptoLib (MIT, audited by CryptoExperts and Veridise in 2024). |
| `PolicyEnclaves` | [`0x12c0C33C62666AbE0ab03B286b428C554De71BF8`](https://explorer.testnet.arc.io/address/0x12c0C33C62666AbE0ab03B286b428C554De71BF8) | The enclave registry as seen through each product's policy. A settlement contract wired to it ignores enclaves below the product's level, with no code change. |
| `SealedBountyVerified` | [`0x8958EA25c9cF7bbee39B32C43187d854B5d73ee6`](https://explorer.testnet.arc.io/address/0x8958EA25c9cF7bbee39B32C43187d854B5d73ee6) | The live Sealed Bounty's code, wired to `PolicyEnclaves`. It slashes bonds and writes ERC-8004 verdicts from the stack's initialization (19 Nov, 20:37 UTC). Any new settlement contract later waits 8 days, so every operator can leave before it gains that power. |

**Proof, on-chain:**

- **`MachineRegistry` was created** on 19 Nov 2026 at 20:37 UTC, in
  [`0x3e2b4613…ee6b`](https://explorer.testnet.arc.io/tx/0x3e2b4613984e0036b007e837291b7b676d3fe1e0cf6c954476c999699b3cee6b).
- **The five live enclaves are bound to their machine**, one per product: DCAP admitted each of them on 20 Nov,
  between 11:19 and 11:23 UTC, in
  [`0xf7d24e86…989f`](https://explorer.testnet.arc.io/tx/0xf7d24e863126f9124a0536cf936ade912d996f34cf5bde9c61bd63cd8c83989f) (product 2),
  [`0x6d7d0817…a360`](https://explorer.testnet.arc.io/tx/0x6d7d0817a76c02db8734fba57f0a78b87d33812bc021e1790f3878c2242fa360) (product 5),
  [`0x1de729e2…0ca5`](https://explorer.testnet.arc.io/tx/0x1de729e24812fb146ca68e57b21664dd5f6e3404312c3f6cfbfa0e8d3fb90ca5) (product 4, AskHive),
  [`0x2de231e7…6a6a`](https://explorer.testnet.arc.io/tx/0x2de231e77dcde776204eb2067a3985f532f0581d9f2abd4d0ae26cd8eab16a6a) (product 1) and
  [`0x0e9bf7e1…2111`](https://explorer.testnet.arc.io/tx/0x0e9bf7e1752ca575ef1c6296b57f433f2900a7bef554334c55c47f53eac92111) (product 3).
  All five run on the same Phala machine: PPID `62d54040cb9dfc08bb13006fa75ece56`, FMSPC `20a06f000000`, issued by
  "Intel SGX PCK Platform CA".
- **The Proof of Cloud alliance declared that machine.** `ProofOfCloudAuditor` verified on-chain a token co-signed by
  the trust servers of Secret, Nillion and iExec, in
  [`0xbc3c3934…6c66`](https://explorer.testnet.arc.io/tx/0xbc3c39347772a83a2259b3a4101959ce88ad1211b241fae38a965df819fa6c66)
  (20 Nov, 11:19 UTC). The machine is declared until 26 Nov.
- **The five enclaves are at the verified level.** Anyone can check with `arcvault operator level --signer <key>` or
  `GET /api/levels`.
- **Product 5, "Sealed Bounty, verified operator level"**, is the first product that *requires* the verified level:
  - its policy is level 1, with `ProofOfCloudAuditor` as the auditor, published with the product at 20:42 UTC on
    19 Nov in [`0xd5ebcd8d…acf3`](https://explorer.testnet.arc.io/tx/0xd5ebcd8d7150c6e8672ad2831e2e706e3f0fc6850828f59dc0841a2a0a6bacf3);
  - its enclave runs in its own Intel TDX VM on the declared machine (Phala `prod9`), admitted on 20 Nov at 11:20 UTC
    in [`0x6d7d0817…a360`](https://explorer.testnet.arc.io/tx/0x6d7d0817a76c02db8734fba57f0a78b87d33812bc021e1790f3878c2242fa360);
  - `PolicyEnclaves.activeOperatorAt(<its key>, 5, <block>)` returns the operator while the enclave is active and
    bound, so the enclave counts;
  - its exploit replay reads Arc through the strict relay. It can also prove every state read (`STATE_PROOF_RPC_URL`)
    once an Arc RPC serves historical `eth_getProof`;
  - Phala's own API independently reports the same machine ID: `node_info.ppid = 62d54040…` for node `prod9`.

## Join at the open level

```sh
arcvault operator init --uri https://example.org/agent.json   # ERC-8004 identity (transactions to sign)
arcvault operator bond --amount 10                            # USDC bond (at least the product's minimum)
arcvault operator register --vm <url> --product <id>          # Intel attestation verified on-chain (DCAP)
```

Then run the registrar (`services/registrar`). It renews the registration every day and settles what the enclave
served.

## Reach the verified level

```sh
arcvault operator bind-machine --signer <enclave key>     # PPID read on-chain from Intel's certificate in your registered quote
arcvault operator proof-of-cloud --signer <enclave key>   # token from the alliance, checked locally, then on-chain
arcvault operator level --signer <enclave key> --product <id>
```

- **Is your machine on the list?** The alliance only issues a token for a listed machine that has not been revoked.
  Phala Cloud machines are on the list (verified on 15 Nov). For your own hardware, see
  [proofofcloud.org](https://proofofcloud.org) and its inspection ceremonies.
- **The registrar keeps the level for you.** Every renewal changes the quote, and a stale binding drops the enclave
  back to the open level. The registrar re-binds right after each renewal. It also requests a fresh alliance token
  when the declaration has less than 3 days left (`LEVELS=0` turns this off).
- **Costs on Arc testnet**, with gas paid in USDC:
  - binding: about 1.73 M gas, roughly 0.04 USDC at 25 gwei, after each daily renewal;
  - alliance token: about 5.2 M gas, roughly 0.13 USDC, once a week per machine.

## Be an auditor

Anyone can be an auditor. Your address is your identity, and only the products that list you take your declarations
into account.

```sh
arcvault auditor attest --ppid <32 hex> --days 30 --site "OVH Roubaix" --evidence https://…
arcvault auditor revoke --ppid <32 hex> --reason "machine moved"
```

## Set a product's level (product authors)

```sh
arcvault product policy --product <id> --level 1 --auditors proof-of-cloud   # propose (author only)
arcvault product policy --product <id> --apply                              # after the product timelock
```

Settlement contracts built on `PolicyEnclaves` enforce the policy on-chain. Buyers read it with the SDK
(`describeLevel`, `readPolicy`) or `GET /api/levels`.

## How the chip is read, and why it can be trusted

1. When an enclave registers, `EnclaveRegistry` verifies its quote with Automata's on-chain DCAP verifier, including
   the PCK certificate chain up to Intel's root. The registry stores `keccak256(quote)`.
2. `MachineRegistry.bindMachine(signer, quote)` takes only that exact quote. `PckChip` then reads the first PCK
   certificate **exactly as Automata's verifier does**: same offsets, same PEM split, same solady 0.0.160 Base64.
   From Intel's SGX extension, it reads the PPID and the FMSPC. The FMSPC must equal the one Automata recorded, so
   both parses read the same certificate.
3. An auditor's declaration names a PPID, and the binding names the PPID of the enclave's current quote. A product at
   the verified level counts an enclave only while all three line up:
   - the binding is current (no re-registration since);
   - the declaration is unexpired and not revoked;
   - the auditor is one the product accepts.

The tests in `contracts/test/Levels.t.sol` and `LevelsBounty.t.sol` (19 tests) run on real data: our registration
quotes, the alliance token, and RFC 8032 vectors. They cover:

- a forged chip ID (PPID) in the PCK certificate;
- forged tokens and replays;
- revocation that takes effect at once;
- the Sealed Bounty refusing a claim or a refutation signed from an undeclared machine.
