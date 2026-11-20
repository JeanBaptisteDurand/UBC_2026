# On-chain TDX attestation: ArcHive's module verified through Automata's DCAP verifier

ArcHive's `TdxAttestationModule` (`contracts/src/attestation/TdxAttestationModule.sol`) checks an Intel TDX quote on
Arc. It calls Automata's DCAP verifier (MIT) on-chain, then parses the measurements that `EnclaveRegistry` enforces.
This folder holds two proofs that it works: one on Arc testnet with a quote from ArcHive's Phala enclave, and one in
Automata's own test harness.

## The verifier deployed on Arc: Automata's commit `59b1f34`

The verifier on Arc testnet is built from
[`automata-network/automata-dcap-attestation`](https://github.com/automata-network/automata-dcap-attestation) at commit
[`59b1f34fff72a76638ca5e303747f3584e3fe435`](https://github.com/automata-network/automata-dcap-attestation/commit/59b1f34fff72a76638ca5e303747f3584e3fe435).
That commit is on Automata's `main` branch (12 Oct 2026), six commits after the `v1.2.0` tag. Its submodule
`evm/lib/automata-on-chain-pccs` is at commit `c65b4b19bdb667c74e0405aee1225fc2c6471247`. The contracts are
unchanged, compiled with Automata's own `foundry.toml` (solc 0.8.27, via-IR, optimizer 200 runs, EVM paris).

The short hash `59b1f34` comes from forge. When `run.sh` ran `forge script` inside the clone of Automata's repository
(`vendor/automata-dcap-attestation`), forge recorded that clone's git commit in the `commit` field of
`arc-testnet/results/plan-deploy.json`. `deployments.dcap.testnet.json` records the same commit
(`source.automataDcapAttestation`). It is a commit of Automata's repository, not of this one.

Checked on 20 Nov 2026: a fresh build of that commit, with its submodules, gives byte for byte the init code of the
15 CREATE2 deployments in `plan-deploy.json`. It also gives the runtime code at the 15 addresses on Arc testnet,
immutable values aside.

```bash
git clone https://github.com/automata-network/automata-dcap-attestation
cd automata-dcap-attestation
git checkout 59b1f34fff72a76638ca5e303747f3584e3fe435
git submodule update --init --recursive
cd evm && forge build
```

## On Arc testnet (7 Nov 2026, folder `arc-testnet/`)

- **A real quote from a Phala TDX VM.** It is the quote of ArcHive's inference enclave at Phala (FMSPC
  `20A06F000000`, DEBUG = 0). Its REPORTDATA carries ArcHive's binding. Policy P6 binds the chain, the registry, the
  product, the operator and the enclave keys. Policy P7 adds the hash of a recent Arc block, checked through EIP-2935.
- **Automata's whole PCCS stack on Arc testnet**, Intel's collateral included, and that quote verified in one
  transaction:
  [`0x142ed00e…80ce97`](https://explorer.testnet.arc.io/tx/0x142ed00ed8d2ec103f8c6af5d893d250d57f10d818b29b3df8b653e06080ce97)
  (5,125,014 gas, 0.1076 USDC, TCB up to date). The addresses are in `deployments.dcap.testnet.json` at the repository
  root. `arc-testnet/README.md` explains how to run it and keep the collateral fresh.
- **Arc's P-256 precompile (`0x100`)** cuts the cost of the quote's five ECDSA signatures. The whole verification
  takes 5.21 M gas with the precompile, against 6.92 M with a Solidity P-256 verifier (Daimo): −25 %, measured on Arc
  testnet on 7 Nov 2026. Arc also serves EIP-2935, which policy P7 relies on.

In production, the live v2.1 stack's `EnclaveRegistry` calls this module (`0x26c1…51ca`, the one deployed in
`arc-testnet/`) on every enclave registration. Each registration brings a fresh quote: under policy P7, the anchored
block is less than 8,191 blocks old. One example is tx
[`0x199c985d…5f33499`](https://explorer.testnet.arc.io/tx/0x199c985dee537cfe2948f6c721ad1bdd448d538ff08bc8e93a79036a25f33499)
(9 Nov 2026, 6,866,126 gas, RTMR3 replay included). The v3 stack, deployed on Arc testnet, has its own
`TdxAttestationModule` (`0x3275…D491`, `deployments.v3.testnet.json`).

`EnclaveRegistry` checks the policies (`contracts/src/EnclaveRegistry.sol`, checks P1 to P9). This folder names three
of them:

- **P2:** the TCB status is UpToDate, or SWHardeningNeeded with only advisories that the product allows.
- **P6:** REPORTDATA[0:32] binds the chain, the registry, the product, the operator and the enclave keys.
- **P7:** REPORTDATA[32:64] is the hash of an anchor block inside the EIP-2935 window.

## In Automata's test harness (the same commit as on Arc)

`ArcModuleTdxTest.t.sol` runs the module against Automata's DCAP verifier on a real TDX V4 quote (`arc_tdx_v4.hex`)
and checks that the module parses it correctly. At commit `59b1f34`, the harness builds Automata's verifier to the same
bytecode as on Arc. The test passed there on 20 Nov 2026:

```
testArcModuleParsesRealTdxQuoteViaAutomata() : PASS
  m.ok = true            (DCAP validated the quote on-chain)
  version = 4, bodyType = 2 (TD1.0)
  mrtd  = 0x935be7742dd89c6a4df6dba8353d89041ae0f052beef993b1e7f4524d3bc57650df20e5582158352e1240b3f1fed55d8
  tcbStatus = 4  (TCB_OUT_OF_DATE: an old sample quote; policy P2 refuses it, so registration fails closed)
  workloadId = 0xb122fbe23f02677eaf51f49e2b0fa7886a50c40d0ab1c82ef1bd7094eef2e135
```

What this proves: the module parses the exact output format of Automata's verifier on real data (version, bodyType,
TCB, FMSPC, the TD10 body at offsets 120/128/136/184/328…/520), and the module does call `verifyAndAttestOnChain`.

## Reproduce

```bash
ARCHIVE=/path/to/UBC_2026   # a clone of this repository
git clone https://github.com/automata-network/automata-dcap-attestation
cd automata-dcap-attestation
git checkout 59b1f34fff72a76638ca5e303747f3584e3fe435   # the commit deployed on Arc testnet
git submodule update --init --recursive
# copy the ArcHive module (pragma lowered to ^0.8.0) into evm/contracts/archive/:
#   $ARCHIVE/contracts/src/attestation/TdxAttestationModule.sol  -> evm/contracts/archive/attestation/
#   $ARCHIVE/contracts/src/interfaces/IAttestationModule.sol     -> evm/contracts/archive/interfaces/
#   $ARCHIVE/contracts/src/interfaces/IAutomataDcap.sol          -> evm/contracts/archive/interfaces/
cp $ARCHIVE/dcap-integration/ArcModuleTdxTest.t.sol evm/forge-test/
cp $ARCHIVE/dcap-integration/arc_tdx_v4.hex          evm/forge-test/assets/quotes/
cd evm && forge test --match-test testArcModuleParsesRealTdxQuoteViaAutomata -vv
```
