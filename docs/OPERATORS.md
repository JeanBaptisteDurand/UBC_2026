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

## What runs on Arc testnet (the levels stack)

| Contract | Address | What it does |
|---|---|---|
| `MachineRegistry` | [`0xd671013f556b1272b25e3cc17c889d402f4dc26d`](https://explorer.testnet.arc.io/address/0xd671013f556b1272b25e3cc17c889d402f4dc26d) | Binds an enclave key to its chip, stores auditors' declarations, and holds each product's level policy. |
| `ProofOfCloudAuditor` | [`0xcdc4c150344f06d506deb5500332737e8dcc8fab`](https://explorer.testnet.arc.io/address/0xcdc4c150344f06d506deb5500332737e8dcc8fab) | A trustless auditor. It checks a Proof of Cloud token (EdDSA, co-signed by three trust servers) **on-chain**, then declares the machine for 7 days. |
| `Ed25519Verifier` | [`0x031579dd04398249feb67852632da4a648d4b5cf`](https://explorer.testnet.arc.io/address/0x031579dd04398249feb67852632da4a648d4b5cf) | Verifies Ed25519 signatures (RFC 8032) with the Smooth CryptoLib, MIT, audited by CryptoExperts and Veridise in 2024. |
| `PolicyEnclaves` | [`0x665f4bb3c31d23463f45e4092487f6b498490417`](https://explorer.testnet.arc.io/address/0x665f4bb3c31d23463f45e4092487f6b498490417) | The enclave registry as seen through each product's policy. A settlement contract wired to it ignores enclaves below the product's level, with no code change. |
| `SealedBounty` (verified level) | [`0x36a8ddf9fcb1308b9e86425bec9b098e933c7348`](https://explorer.testnet.arc.io/address/0x36a8ddf9fcb1308b9e86425bec9b098e933c7348) | Same code as the live Sealed Bounty, wired to `PolicyEnclaves`. It can slash bonds and write ERC-8004 verdicts since **18 Nov 2026, 23:00 UTC**: any new settlement contract waits 8 days, so every operator can leave before it gains that power. |

**Proof, on-chain:**
- **`MachineRegistry` was created** on 10 Nov 2026 at 23:00 UTC, in [`0xe043c341…`](https://explorer.testnet.arc.io/tx/0xe043c341b4760b7f7fcd251f1fa7a858ae40b1bd75e0dd4c7dacc91f6f9798e4).
- **The five live enclaves are bound to their machine**: products 1, 2, 3 and 7, and AskHive (product 4). For example,
  product 3's enclave in [`0xf3ed752c…`](https://explorer.testnet.arc.io/tx/0xf3ed752c6df5a9cb2b5325764ce8ef72fc9526664d989d3e2e3ebf04bc866794) (19 Nov, 00:55 UTC), product 7's in
  [`0xe6ceda4c…`](https://explorer.testnet.arc.io/tx/0xe6ceda4c5ed7240064b2ae223b7c601954e80407aa2b99c37036abe3cc6c51e8) (19 Nov, 01:02 UTC) and AskHive's in
  [`0x469706cb…`](https://explorer.testnet.arc.io/tx/0x469706cb81f090b0205c52a20f7739af3d544a8f869f2d0fd09bb8816312111c) (19 Nov, 22:38 UTC). An earlier binding, of 11 Nov at
  17:34 UTC: [`0xd6928088…`](https://explorer.testnet.arc.io/tx/0xd6928088d90f8bbc2585d04564c4a574312593f3f19792a1cdbf819437bb5f4f).
  - All five run on the same Phala machine: PPID `62d54040cb9dfc08bb13006fa75ece56`, FMSPC `20a06f000000`, issued by "Intel SGX PCK Platform CA".
- **The Proof of Cloud alliance declared that machine.** A token co-signed by the trust servers of Secret, Nillion and
  iExec was verified on-chain by `ProofOfCloudAuditor` in [`0x3e2aa322…`](https://explorer.testnet.arc.io/tx/0x3e2aa32251a7a7cfa7ee69c3fa653cac6dd4272db2ae92d1b4ed760178fdcd35)
  (10 Nov, 23:01 UTC, 5,163,166 gas), and again in [`0x38c587ae…`](https://explorer.testnet.arc.io/tx/0x38c587aefb3d325383f471be5f6f359dd40123b4c57ce259b0c0bd96987b1e83)
  (19 Nov, 00:56 UTC): the machine is declared until 26 Nov.
- **The five enclaves are at the verified level.** Anyone can check with `arcvault operator level --signer <key>` or
  `GET /api/levels`.
- **Product 7, "Sealed Bounty, verified operator level"**, is the first product that *requires* the verified level:
  - policy level 1 with `ProofOfCloudAuditor` as the auditor: propose [`0xac310659…`](https://explorer.testnet.arc.io/tx/0xac31065911dd45ba8e1298448e48337b454f193b33d9e23993c70d4d587c3070),
    apply [`0x12591911…`](https://explorer.testnet.arc.io/tx/0x125919112a377807014116791c46d256e1346531b0daa87f3b0e9a96d789d079) (11 Nov, 17:33 UTC);
  - its enclave runs in its own Intel TDX VM on the declared machine (Phala `prod9`). It was admitted through DCAP in
    [`0xf18cb68f…`](https://explorer.testnet.arc.io/tx/0xf18cb68f068e5cfaa993a67da2fd98f4c5d73123460533d0901052b06d166a2c) (19 Nov, 01:02 UTC) and bound to its machine in
    [`0xe6ceda4c…`](https://explorer.testnet.arc.io/tx/0xe6ceda4c5ed7240064b2ae223b7c601954e80407aa2b99c37036abe3cc6c51e8);
  - `PolicyEnclaves.activeOperatorAt(<its key>, 7, <block>)` returns the operator while the enclave is active and bound, so it counts;
  - its exploit replay reads Arc through the strict relay; it can also prove every state read (`STATE_PROOF_RPC_URL`) once an Arc RPC serves historical `eth_getProof`.
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
  - binding: about 1.73 M gas, roughly 0.04 USDC at 25 gwei, after each daily renewal;
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

Tests in `contracts/test/Levels.t.sol` and `LevelsBounty.t.sol` (19 tests) run on real data: our registration quotes, the alliance token, and RFC 8032 vectors. They cover:
- a forged chip ID (PPID) in the PCK certificate;
- forged tokens and replays;
- revocation taking effect at once;
- a claim or refutation signed from an undeclared machine being refused by the Sealed Bounty.

