# Proof: our TDX module verifies a REAL quote through Automata's REAL DCAP verifier

**Result (local, same EVM bytecode as on Arc):** our `TdxAttestationModule` drove Automata's DCAP verifier v1.1 (MIT) on
a **real TDX V4 quote** and parsed it correctly:

```
testArcModuleParsesRealTdxQuoteViaAutomata() : PASS
  m.ok = true            (DCAP validated the quote on-chain)
  version = 4, bodyType = 2 (TD1.0)
  mrtd  = 0x935be7742dd89c6a4df6dba8353d89041ae0f052beef993b1e7f4524d3bc57650df20e5582158352e1240b3f1fed55d8
  tcbStatus = 4  (TCB_OUT_OF_DATE: an old sample quote; our policy P2 refuses it, so it fails closed, as it should)
  workloadId = 0xb122fbe23f02677eaf51f49e2b0fa7886a50c40d0ab1c82ef1bd7094eef2e135
```

What this proves: the **output format of Automata's verifier** that our module parses (version, bodyType, TCB, FMSPC,
TD10 body at offsets 120/128/136/184/328…/520) is **exact on real data**, and our module does call
`verifyAndAttestOnChain`. Arc has the P-256 precompile (0x100) and EIP-2935 (checked separately), so the same bytecode
runs on Arc, for less gas: 5.21 M gas with the precompile against 6.92 M with a Solidity P-256 verifier (Daimo), −25 %,
measured on Arc testnet on 7 Nov.

**Done on 7 Nov** (folder `arc-testnet/`):
- a **real quote from a Phala TDX VM** whose REPORTDATA carries OUR binding (P6/P7): the quote of our inference enclave
  at Phala (FMSPC `20A06F000000`, DEBUG = 0);
- the **deployment of Automata's whole PCCS stack on Arc testnet**, Intel's collateral included, and the verification of
  that quote **in one transaction**: `0x142ed00e…0ce97` (5,125,014 gas, 0.1076 USDC, TCB up to date). Addresses:
  `deployments.dcap.testnet.json`; how to run it and keep the collateral fresh: `arc-testnet/README.md`.

Then (stacks v2, v2.1 and v3): this module is the one `EnclaveRegistry` uses, and every enclave registration goes through
it with a fresh quote (P7: the quote points to a block less than 8,191 blocks old), for example tx
`0x199c985dee537cfe2948f6c721ad1bdd448d538ff08bc8e93a79036a25f33499` (9 Nov, 6,866,126 gas, RTMR3 replay included).

## Reproduce

```bash
git clone --depth 1 https://github.com/automata-network/automata-dcap-attestation
cd automata-dcap-attestation && git submodule update --init --recursive --depth 1
cd evm/lib/automata-on-chain-pccs && git submodule update --init --recursive --depth 1 && cd -
# copy our module (pragma lowered to ^0.8.0) into contracts/arcvault/:
#   src/attestation/TdxAttestationModule.sol  -> evm/contracts/arcvault/attestation/
#   src/interfaces/IAttestationModule.sol     -> evm/contracts/arcvault/interfaces/
#   src/interfaces/IAutomataDcap.sol          -> evm/contracts/arcvault/interfaces/
cp <this folder>/ArcModuleTdxTest.t.sol evm/forge-test/
cp <this folder>/arc_tdx_v4.hex          evm/forge-test/assets/quotes/
cd evm && forge test --match-test testArcModuleParsesRealTdxQuoteViaAutomata -vv
```
