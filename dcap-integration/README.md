# Preuve : notre module TDX vérifie un VRAI quote via le VRAI DCAP d'Automata

**Résultat (local, bytecode EVM identique à Arc) :** notre `TdxAttestationModule` a piloté le
vérificateur DCAP v1.1 d'Automata (MIT) sur un **vrai quote TDX V4** et l'a correctement découpé :

```
testArcModuleParsesRealTdxQuoteViaAutomata() : PASS
  m.ok = true            (DCAP a validé le quote sur la chaîne)
  version = 4, bodyType = 2 (TD1.0)
  mrtd  = 0x935be7742dd89c6a4df6dba8353d89041ae0f052beef993b1e7f4524d3bc57650df20e5582158352e1240b3f1fed55d8
  tcbStatus = 4  (TCB_OUT_OF_DATE — vieux quote d'exemple ; notre politique P2 le refuse → « échoue fermé », correct)
  workloadId = 0xb122fbe23f02677eaf51f49e2b0fa7886a50c40d0ab1c82ef1bd7094eef2e135
```

Ce qui est prouvé : le **format de sortie d'Automata** que notre module parse (version/bodyType/tcb/
fmspc/corps TD10 aux décalages 120/128/136/184/328…/520) est **exact sur de vraies données**, et
notre module appelle bien `verifyAndAttestOnChain`. Arc a le précompile P-256 (0x100) et EIP-2935
(vérifiés indépendamment), donc le même bytecode tourne sur Arc, moins cher : 5,21 M gas avec le précompile contre
6,92 M en P-256 Solidity (Daimo), −25 %, mesuré sur Arc testnet le 7/11.

Ce qui était à faire, et qui est **fait le 7/11** (dossier `arc-testnet/`) :
- un **vrai quote d'une VM Phala TDX** dont le REPORTDATA porte NOTRE liaison (P6/P7) : c'est le quote de notre
  enclave d'inférence chez Phala (FMSPC `20A06F000000`, DEBUG = 0) ;
- le **déploiement de toute la pile PCCS d'Automata sur Arc testnet**, collatéral d'Intel compris, et la
  vérification de ce quote **dans une transaction** : `0x142ed00e…0ce97` (5 125 014 gas, 0,1076 USDC, TCB à jour).
  Adresses : `deployments.dcap.testnet.json` ; mode d'emploi et entretien du collatéral : `arc-testnet/README.md`.

Reste : brancher ce module dans un `EnclaveRegistry` (pile v2) et y inscrire l'enclave avec un quote frais (P7 :
le quote doit pointer un bloc de moins de 8 191 blocs).

## Reproduire

```bash
git clone --depth 1 https://github.com/automata-network/automata-dcap-attestation
cd automata-dcap-attestation && git submodule update --init --recursive --depth 1
cd evm/lib/automata-on-chain-pccs && git submodule update --init --recursive --depth 1 && cd -
# copier notre module (pragma abaissé à ^0.8.0) dans contracts/arcvault/ :
#   src/attestation/TdxAttestationModule.sol  -> evm/contracts/arcvault/attestation/
#   src/interfaces/IAttestationModule.sol     -> evm/contracts/arcvault/interfaces/
#   src/interfaces/IAutomataDcap.sol          -> evm/contracts/arcvault/interfaces/
cp <ce dossier>/ArcModuleTdxTest.t.sol evm/forge-test/
cp <ce dossier>/arc_tdx_v4.hex          evm/forge-test/assets/quotes/
cd evm && forge test --match-test testArcModuleParsesRealTdxQuoteViaAutomata -vv
```
