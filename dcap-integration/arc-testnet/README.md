# Real Intel TDX verification on Arc testnet (Automata DCAP, PCCS on-chain)

**Result (7 Nov 2026, chain 5042002):** the real TDX v4 quote of ArcHive's Phala (dstack) enclave is verified **on Arc**,
by Automata's DCAP stack (MIT, contracts unchanged), with Intel's collateral loaded on-chain and the quote checked in a
real Arc testnet transaction.

| | |
|---|---|
| Verification transaction | [`0x142ed00e…80ce97`](https://explorer.testnet.arc.io/tx/0x142ed00ed8d2ec103f8c6af5d893d250d57f10d818b29b3df8b653e06080ce97) (block 71,124,228, status 1) |
| Call | `AutomataDcapAttestationFee.verifyAndAttestOnChain(quote)` → `success = true` (`AttestationSubmitted` event identical to the `eth_call`) |
| Gas | **5,125,014** at 21 gwei = **0.1076 USDC** |
| TCB status | **UpToDate** (0), no Intel advisory; TCB evaluation number **20** (Automata's "standard") |
| FMSPC / PCK CA | `20A06F000000` / Intel SGX PCK **Platform** CA |
| MRTD | `0x7fe60787222bd394cb516abca2435f22f035ab2cc9c0a4b4b3b148e46297f3d931a237b72f359052c6e657d8c1409173` |
| reportData[0:32] | `0x49ec2b0717ab96c4b687e80f0fd846f1b8e3dc40595e73295ae6a18e09925f9b` |
| TD attributes | DEBUG = 0, SEPT_VE_DISABLE = 1 |
| Our module | `TdxAttestationModule` (source unchanged) → `verify(quote, 0x)` as an `eth_call`: `ok = true`, v4, TD1.0, measurements identical to the DCAP output |
| Altered quotes | reportData, MRTD or signature changed by one bit → **refused** (revert) |

Everything is recorded in [`deployments.dcap.testnet.json`](../../deployments.dcap.testnet.json) (addresses, hashes of
every transaction, gas, costs, decoded output) and in `results/`.

## What is deployed (CREATE2, owner `0x5724…f6Ab`)

| Contract | Address |
|---|---|
| AutomataDcapAttestationFee (**the entry point to call**) | `0x48640f7d94de64b13c89686f3d1240a31aeb4dc9` |
| V4QuoteVerifier (P-256 = precompile `0x100`) | `0x78c233567fdcec96ee2df249b398c544a7e86105` |
| PCCSRouter | `0x5b1d89848d1e422ec5ea27362b5f5033006480e2` |
| AutomataDaoStorage | `0x30a08e378812fecf2bce05fbea8f44a205a8d29c` |
| AutomataPcsDao / AutomataPckDao | `0x1560a33d…1905` / `0x0d2e6a31…5fc5` |
| AutomataEnclaveIdentityDaoVersioned (evaluation 20) | `0xf84eff4790c24544410c8e97c8dc445fefcc0fcf` |
| AutomataFmspcTcbDaoVersioned (evaluation 20) | `0x83413486f2711b39dafc1c31e621866e4ab05567` |
| AutomataTcbEvalDao / PccsDependencyConfig | `0x62663ea2…663a` / `0xe021a747…01a2` |
| Helpers (EnclaveIdentity, FmspcTcb, PCK, X509CRL, TcbEval) | see the JSON |
| **TdxAttestationModule** (ArcHive, `dcap` = the entry point above) | `0x26c1803de523ac896ba7f1787f1401ec792951ca` |

The same assembly as Automata's test harness (`forge-test/utils/PCCSSetupBase.sol`): DAOs versioned by TCB evaluation
number, the router, an entry point without fees (fee bps = 0), the V4 verifier only (dstack quotes are v4). Every
contract is under 24,576 bytes (the largest: V4QuoteVerifier, 22,710 bytes).

**Total cost: 1.316 USDC** (37 deployment transactions and the collateral = 1.196; verification 0.108; module 0.012).

## Gas: Arc's P-256 precompile against P-256 in Solidity

Measured on Arc (`eth_estimateGas`, same state; the Solidity variant overrides, for the estimate only, the verifier's
P-256 address with Daimo's `0xc2b7…`, already deployed on Arc): precompile **5,208,699** against Daimo **6,915,287**,
that is **−1.71 M gas (−25 %)** for the 5 ECDSA signatures of a quote.

## Run it again

```bash
cd dcap-integration/arc-testnet
./run.sh fetch     # the enclave's quote (ENCLAVE_URL) and Intel PCS v4 collateral -> collateral/
./run.sh deploy    # installs the script in vendor/, dry-runs the plan on an Arc fork, sends it tx by tx, records it
./run.sh verify    # eth_call, then a real verifyAndAttestOnChain(quote) transaction
./run.sh module    # compiles contracts/src/attestation/TdxAttestationModule.sol (unchanged), deploys it, eth_call
./run.sh measure   # precompile vs Solidity gas, and altered quotes (free)
```

- Requirements: Foundry (forge, cast), python3, and Automata's repository cloned into
  `vendor/automata-dcap-attestation` (at the repository root) at the deployed commit, with its submodules (from the
  root: `git clone https://github.com/automata-network/automata-dcap-attestation vendor/automata-dcap-attestation`, then
  `git checkout 59b1f34fff72a76638ca5e303747f3584e3fe435` and `git submodule update --init --recursive` in it; see
  `../README.md`). The key is read from the file named by `KEY_FILE`, never printed.
- Why a plan, then one transaction at a time: `forge script --broadcast` fixes every nonce in advance. Here the plan
  (`forge script` without `--broadcast`) is sent by `send_plan.py` (nonce re-read before each transaction, receipt
  checked), so the deployment stays correct even if the same account sends other transactions in the meantime.
  Deployments use CREATE2: running `deploy` again reuses what already exists.
- Forge's local EVM has no `0x100` precompile: for the local run of the plan only, Daimo's code is copied there
  (`vm.etch`), so the whole path (upserts and quote) is checked before anything is sent.

## Reload the collateral when Intel updates it

The router refuses expired collateral: the TCB info, the QE identity, the PCK CRL and the evaluation numbers loaded
expire on **7 Dec 2026** (`nextUpdate`, +30 days). Before that date (then every month):

```bash
./run.sh refresh   # downloads again, dry-runs, sends only what is newer, updates the JSON
```

The DAOs refuse a duplicate or older collateral: those upserts are skipped in the plan.

**A new evaluation number.** `verifyAndAttestOnChain(quote)` uses Automata's "standard" number: the most recent one whose
TCB recovery event is at least 12 months old (20 today). Number 21 (event of 10 Feb 2026) becomes standard around
**10 Feb 2027**: before then, run `./run.sh add-eval 21` (2 versioned DAOs and their collateral, wired to the router).
For policy P2 (the TCB must be UpToDate, or SWHardeningNeeded with only advisories the product allows; the policies are
checked in `contracts/src/EnclaveRegistry.sol`): the Phala machine is UpToDate at 20, but **OutOfDate at 21** (TDX module `TDX_01` isvsvn 11 < 13) and
**at 22** ("early", 11 Aug 2026: microcode, INTEL-SA-01404/01439/01442) until Phala updates the host.
`verifyAndAttestOnChain(quote, n)` can also be called with any loaded number.

Another FMSPC (the app moves to another Phala host): `ENCLAVE_URL=… ./run.sh refresh` loads the new FMSPC's TCB info
(and the CRL of the right PCK CA) into the same DAOs.

## Arc mainnet (chainId 5042)

`NETWORK=mainnet KEY_FILE=<mainnet key> ./run.sh deploy`, then `verify` and `module` (RPC `https://rpc.mainnet.arc.io`,
writes `deployments.dcap.mainnet.json`). Checked on mainnet on 7 Nov: P-256 precompile `0x100` present, CREATE2 factory
and Daimo present, 30 M gas per block. What changes:
- **never the testnet key**; the owner (`OWNER`) should then move to a multisig (`transferOwnership` of the Ownable
  contracts: storage, config, DAOs, router, entry point);
- addresses: the same `SALT_TAG` and the same owner give the same addresses as on testnet; otherwise, new ones;
- expected cost at the 7 Nov price (25 gwei): about 57 M gas, about 1.4 USDC for the stack and collateral, about
  0.13 USDC per verification;
- the same monthly reload and evaluation-number schedule applies.

## Good to know

- With the precompile, an invalid signature makes the call **revert** (the precompile returns nothing and Automata's
  `abi.decode` fails) instead of returning `success = false`. The refusal still fails closed:
  `EnclaveRegistry.registerEnclave` then reverts instead of receiving `m.ok = false`.
- `EnclaveRegistry` holds its module as `immutable`: changing the module means redeploying the registry with
  `TdxAttestationModule` `0x26c1…51ca` (or `contracts/script/Deploy.s.sol` with
  `DCAP=0x48640f7d94de64b13c89686f3d1240a31aeb4dc9`).
- The quote verified here is anchored (reportData[32:64]) to block 71,069,461: too old for the EIP-2935 window
  (8,191 blocks) of policy P7 (REPORTDATA[32:64] anchors a recent Arc block); `registerEnclave` asks the enclave for a
  fresh quote.

## Files

`ArcTestnetDcap.s.sol` (forge plan: `deploy()`, `refresh()`, `addTcbEval()`), `send_plan.py` (sending),
`fetch_collateral.py` (Intel PCS v4), `dcap_tool.py` (decoding, measurement, JSON), `run.sh` (everything),
`collateral/` (the exact collateral loaded, and `manifest.json`), `results/` (plans, receipts, decoded outputs).
