# Operators: two levels

ArcHive is open: anyone can run an enclave and get paid in USDC. Some products need more than a correct attestation. They also need the machine to sit somewhere an attacker cannot touch. So there are two operator levels, and each product chooses the one it requires.

| | Open level | Verified level |
|---|---|---|
| What is checked | An Arc contract verifies Intel's attestation of the enclave (DCAP), the image and the key binding. The operator posts a USDC bond. | All of the open level. In addition, the machine's chip (its **PPID**, read on-chain from Intel's certificate inside the quote) is declared to be in a known datacenter by an **auditor** that the product accepts. |
| Who decides | Nobody: open to all. | The **product author** sets the minimum level and the accepted auditors, behind the product timelock. A buyer can ask for more. |
| Reference auditor | — | **Proof of Cloud** (Phala, Secret, Nillion, iExec, Automata, Flashbots, Oasis…). Its members inspect machines in datacenters. An Arc contract verifies the alliance's signature. |
| Price | Set by the operator. | Set by the operator: a verified operator can charge more. **The protocol takes no fee for verification.** |
| Good for | Low-cost AI inference. | Sealed Bounty, refutation quorums, anything where one stolen attestation key is costly. |

**Why a verified level.** Physical attacks published in 2025 (TEE.fail, Battering RAM, Wiretap) extract attestation keys from a server the attacker can touch. An attestation then proves the right code, but no longer that the machine is untouched. Pinning the chip to an inspected datacenter closes that gap.

## What runs on Arc testnet (deployed 11 Nov 2026 (corrected stack after the security review))

| Contract | Address | What it does |
|---|---|---|
| `MachineRegistry` | [`0xd671013f556b1272b25e3cc17c889d402f4dc26d`](https://explorer.testnet.arc.io/address/0xd671013f556b1272b25e3cc17c889d402f4dc26d) | Binds an enclave key to its chip, stores auditors' declarations, and holds each product's level policy. |
| `ProofOfCloudAuditor` | [`0xcdc4c150344f06d506deb5500332737e8dcc8fab`](https://explorer.testnet.arc.io/address/0xcdc4c150344f06d506deb5500332737e8dcc8fab) | A trustless auditor. It checks a Proof of Cloud token (EdDSA, co-signed by three trust servers) **on-chain**, then declares the machine for 7 days. |
| `Ed25519Verifier` | [`0x031579dd04398249feb67852632da4a648d4b5cf`](https://explorer.testnet.arc.io/address/0x031579dd04398249feb67852632da4a648d4b5cf) | Verifies Ed25519 signatures (RFC 8032) with the Smooth CryptoLib, MIT, audited by CryptoExperts and Veridise in 2024. |
| `PolicyEnclaves` | [`0x665f4bb3c31d23463f45e4092487f6b498490417`](https://explorer.testnet.arc.io/address/0x665f4bb3c31d23463f45e4092487f6b498490417) | The enclave registry as seen through each product's policy. A settlement contract wired to it ignores enclaves below the product's level, with no code change. |
| `SealedBounty` (verified level) | [`0x36a8ddf9fcb1308b9e86425bec9b098e933c7348`](https://explorer.testnet.arc.io/address/0x36a8ddf9fcb1308b9e86425bec9b098e933c7348) | Same code as the live Sealed Bounty, wired to `PolicyEnclaves`. It can slash bonds and write ERC-8004 verdicts from **18 Nov 2026, 23:00 UTC**: any new settlement contract waits 8 days, so every operator can leave before it gains that power. |

**Proof, on-chain:**
- **Our four enclaves are bound to their machine.** Txs [`0x3abafc08…`](https://explorer.testnet.arc.io/tx/0x3abafc085e5e20cd40b167b3e9dbd384188c2acb10cb7b145f382d0ebc5bbe03), [`0x67c5569b…`](https://explorer.testnet.arc.io/tx/0x67c5569b226dbf9ff370951264df16a939c5399d9466608dcc1fb4922d23eef5), [`0xa48d37f0…`](https://explorer.testnet.arc.io/tx/0xa48d37f04a9cee3a753b3eccc2d692b3f91f8e6ec334a4fc3ab69c5f07da7a5c) and [`0x1e1bfff4…`](https://explorer.testnet.arc.io/tx/0x1e1bfff436ef7ba62154cdbb027910baf8203fe4fe6190473160e098cf245c86).
  - All four run on the same Phala machine: PPID `62d54040cb9dfc08bb13006fa75ece56`, FMSPC `20a06f000000`, issued by "Intel SGX PCK Platform CA".
- **The Proof of Cloud alliance declared that machine.** A token was co-signed by the trust servers of Secret, Nillion and iExec, and verified on-chain in tx [`0x5ca34002…`](https://explorer.testnet.arc.io/tx/0x5ca34002fca5de1614cfa7a52aef3eb638f7bc3b358a13a5dd86d860e7c5c7a3) for 5.16 M gas.
- **The four enclaves are now at the verified level.** Anyone can check with `arcvault operator level --signer <key>`, `GET /api/levels`, or the badges on the Hive page.
- **Product 7, "Sealed Bounty, verified operator level"**, is the first product that *requires* the verified level:
  - policy level 1 with `ProofOfCloudAuditor` as the auditor: propose [`0xe5102a3a…`](https://explorer.testnet.arc.io/tx/0xe5102a3a9841af9454d4ae4d1e590f1bdb1435b25b9c53868793b9b1b72e60fd), apply [`0xbc18aeae…`](https://explorer.testnet.arc.io/tx/0xbc18aeae4f6d948bf970d42d2b2de98f635f3a13ccff33a8ccbf3d3f5a532e6b);
  - its enclave runs in its own Intel TDX VM on the declared machine (Phala `prod9`). It was registered through DCAP in [`0x524eef52…`](https://explorer.testnet.arc.io/tx/0x524eef52938b73eefaa69074a835f1c8494a09326fb8896b66f6226c03237a54) and bound to its machine in [`0xe0cabf4f…`](https://explorer.testnet.arc.io/tx/0xe0cabf4f1d9551d3dac4dfa0f2baef38035f9e47d0743a1943ffcb82d6e0d55b);
  - `PolicyEnclaves.activeOperatorAt(<its key>, 6, head)` returns the operator, so it counts;
  - its exploit replay proves every state read (`STATE_PROOF_RPC_URL`, see the README).
  - Phala's own API independently reports the same machine id: `node_info.ppid = 62d54040…` for node `prod9`.

## Join at the open level

```sh
arcvault operator init --uri https://example.org/agent.json   # ERC-8004 identity (transactions to sign)
arcvault operator bond --amount 10                            # USDC bond (at least the product's minimum)
arcvault operator register --vm <url> --product <id>          # Intel attestation verified on-chain (DCAP)
```

Then run the registrar (`services/registrar`). It renews the registration every day and settles what the enclave served.

## Reach the verified level

```sh
arcvault operator bind-machine --signer <enclave key>     # PPID read on-chain from Intel's certificate in your registered quote
arcvault operator proof-of-cloud --signer <enclave key>   # token from the alliance, checked locally, then on-chain
arcvault operator level --signer <enclave key> --product <id>
```

- **Is your machine on the list?** The alliance only issues a token for a machine on its list that has not been revoked. Phala Cloud machines are on it (verified 10 Nov). For your own hardware, see [proofofcloud.org](https://proofofcloud.org) and its inspection ceremonies.
- **The registrar keeps the level for you.** Every renewal changes the quote, and a stale binding drops the enclave back to the open level. The registrar re-binds right after each renewal. It also requests a fresh alliance token when the declaration has less than 3 days left (`LEVELS=0` turns this off).
- **Costs on Arc testnet**, gas paid in USDC:
  - binding: about 1.17 M gas, roughly 0.03 USDC, after each daily renewal;
  - alliance token: about 5.2 M gas, roughly 0.13 USDC, once a week per machine.

## Be an auditor

Anyone can be an auditor. Your address is your identity, and only products that list you take your declarations into account.

```sh
arcvault auditor attest --ppid <32 hex> --days 30 --site "OVH Roubaix" --evidence https://…
arcvault auditor revoke --ppid <32 hex> --reason "machine moved"
```

## Set a product's level (product authors)

```sh
arcvault product policy --product <id> --level 1 --auditors proof-of-cloud   # propose (author only)
arcvault product policy --product <id> --apply                              # after the product timelock
```

Settlement contracts built on `PolicyEnclaves` enforce the policy on-chain. Buyers read it with the SDK (`describeLevel`, `readPolicy`) or `GET /api/levels`.

## How the chip is read, and why it can be trusted

1. When an enclave registers, `EnclaveRegistry` verifies its quote with Automata's on-chain DCAP verifier. This includes the PCK certificate chain up to Intel's root. The registry stores `keccak256(quote)`.
2. `MachineRegistry.bindMachine(signer, quote)` takes only that exact quote. `PckChip` then reads the first PCK certificate **exactly as Automata's verifier does**: same offsets, same PEM split, same solady 0.0.160 Base64. From Intel's SGX extension it reads the PPID and the FMSPC. The FMSPC must equal the one Automata recorded, so both parses read the same certificate.
3. An auditor's declaration names a PPID, and the binding names the PPID of the enclave's current quote. A product at the verified level counts an enclave only while all three line up:
   - the binding is current (no re-registration since);
   - the declaration is unexpired and not revoked;
   - the auditor is one the product accepts.

Tests in `contracts/test/Levels.t.sol` and `LevelsBounty.t.sol` (18 tests) run on real data: our registration quotes, the alliance token, and RFC 8032 vectors. They cover:
- forged tokens and replays;
- revocation taking effect at once;
- a claim or refutation signed from an undeclared machine being refused by the Sealed Bounty.

