# Vérification Intel TDX RÉELLE sur Arc testnet (Automata DCAP + PCCS on-chain)

**Résultat (7/11/2026, chaîne 5042002) :** le vrai quote TDX v4 de notre enclave Phala (dstack) est
vérifié **sur la chaîne Arc**, par la pile DCAP d'Automata (MIT, contrats inchangés), avec le collatéral
Intel chargé on-chain. Aucun mock.

| | |
|---|---|
| Transaction de vérification | [`0x142ed00e…80ce97`](https://explorer.testnet.arc.io/tx/0x142ed00ed8d2ec103f8c6af5d893d250d57f10d818b29b3df8b653e06080ce97) (bloc 71 124 228, statut 1) |
| Appel | `AutomataDcapAttestationFee.verifyAndAttestOnChain(quote)` → `success = true` (événement `AttestationSubmitted` identique à l'`eth_call`) |
| Gaz | **5 125 014** à 21 gwei = **0,1076 USDC** |
| Statut TCB | **UpToDate** (0), aucun avis Intel — numéro d'évaluation TCB **20** (« standard » d'Automata) |
| FMSPC / CA PCK | `20A06F000000` / Intel SGX PCK **Platform** CA |
| MRTD | `0x7fe60787222bd394cb516abca2435f22f035ab2cc9c0a4b4b3b148e46297f3d931a237b72f359052c6e657d8c1409173` |
| reportData[0:32] | `0x49ec2b0717ab96c4b687e80f0fd846f1b8e3dc40595e73295ae6a18e09925f9b` |
| Attributs TD | DEBUG = 0, SEPT_VE_DISABLE = 1 |
| Notre module | `TdxAttestationModule` (source inchangée) → `verify(quote, 0x)` en `eth_call` : `ok = true`, v4, TD1.0, mesures identiques à la sortie DCAP |
| Quotes altérés | reportData, MRTD ou signature modifiés d'un bit → **refusés** (revert) |

Tout est consigné dans [`deployments.dcap.testnet.json`](../../deployments.dcap.testnet.json) (adresses,
hachages de toutes les transactions, gaz, coûts, sortie décodée) et dans `results/`.

## Ce qui est déployé (CREATE2, propriétaire `0x5724…f6Ab`)

| Contrat | Adresse |
|---|---|
| AutomataDcapAttestationFee (**l'entrée à appeler**) | `0x48640f7d94de64b13c89686f3d1240a31aeb4dc9` |
| V4QuoteVerifier (P-256 = précompile `0x100`) | `0x78c233567fdcec96ee2df249b398c544a7e86105` |
| PCCSRouter | `0x5b1d89848d1e422ec5ea27362b5f5033006480e2` |
| AutomataDaoStorage | `0x30a08e378812fecf2bce05fbea8f44a205a8d29c` |
| AutomataPcsDao / AutomataPckDao | `0x1560a33d…1905` / `0x0d2e6a31…5fc5` |
| AutomataEnclaveIdentityDaoVersioned (éval. 20) | `0xf84eff4790c24544410c8e97c8dc445fefcc0fcf` |
| AutomataFmspcTcbDaoVersioned (éval. 20) | `0x83413486f2711b39dafc1c31e621866e4ab05567` |
| AutomataTcbEvalDao / PccsDependencyConfig | `0x62663ea2…663a` / `0xe021a747…01a2` |
| Assistants (EnclaveIdentity, FmspcTcb, PCK, X509CRL, TcbEval) | voir le JSON |
| **TdxAttestationModule** (ArcHive, `dcap` = l'entrée ci-dessus) | `0x26c1803de523ac896ba7f1787f1401ec792951ca` |

Même assemblage que le harnais de test d'Automata (`forge-test/utils/PCCSSetupBase.sol`) : DAO versionnées
par numéro d'évaluation TCB, routeur, entrée sans frais (fee bps = 0), vérificateur V4 seul (les quotes
dstack sont en v4). Toutes les tailles < 24 576 o (le plus gros : V4QuoteVerifier, 22 710 o).

**Coût total : 1,316 USDC** (37 tx de déploiement + collatéral = 1,196 ; vérification 0,108 ; module 0,012).

## Gaz : précompile P-256 d'Arc contre P-256 en Solidity

Mesuré sur Arc (`eth_estimateGas`, même état ; variante Solidity obtenue en surchargeant, le temps de
l'estimation, l'adresse P-256 du vérificateur par celle de Daimo `0xc2b7…`, déjà déployé sur Arc) :
précompile **5 208 699** contre Daimo **6 915 287**, soit **−1,71 M gaz (−25 %)** pour 5 signatures ECDSA
par quote. (Le chiffre « ≈ 23 M en Solidity » du README racine est donc faux : c'est ≈ 6,9 M.)

## Relancer

```bash
cd dcap-integration/arc-testnet
./run.sh fetch     # quote de l'enclave (ENCLAVE_URL) + collatéral Intel PCS v4 -> collateral/
./run.sh deploy    # installe le script dans vendor/, plan à sec sur un fork d'Arc, envoi tx par tx, record
./run.sh verify    # eth_call + VRAIE transaction verifyAndAttestOnChain(quote)
./run.sh module    # compile contracts/src/attestation/TdxAttestationModule.sol (inchangé), déploie, eth_call
./run.sh measure   # gaz précompile vs Solidity + quotes altérés (gratuit)
```

- Prérequis : Foundry (forge, cast), python3, et le dépôt d'Automata cloné dans `vendor/automata-dcap-attestation`
  avec ses sous-modules (`git clone --recursive https://github.com/automata-network/automata-dcap-attestation`). La clé est lue dans `.secrets/deployer.json` (`KEY_FILE`), jamais affichée.
- Pourquoi un plan puis un envoi tx par tx : la clé de déploiement est partagée avec d'autres outils ;
  `forge script --broadcast` fixe les nonces d'avance. Ici le plan (`forge script` sans `--broadcast`) est
  envoyé par `send_plan.py` (nonce relu à chaque tx, reçu vérifié). Les déploiements sont en CREATE2 :
  relancer `deploy` réutilise ce qui existe déjà.
- L'EVM locale de forge n'a pas le précompile `0x100` : pour la seule exécution locale du plan, le code de
  Daimo y est copié (`vm.etch`), ce qui permet de vérifier tout le parcours (upserts + quote) avant tout envoi.

## Recharger le collatéral quand Intel le met à jour

Le routeur refuse un collatéral expiré : la TCB info, l'identité du QE, la CRL PCK et les numéros
d'évaluation chargés expirent le **7/12/2026** (`nextUpdate`, +30 jours). Avant cette date (puis chaque mois) :

```bash
./run.sh refresh   # re-télécharge, rejoue à sec, n'envoie que ce qui est plus récent, met à jour le JSON
```

Les DAO refusent un doublon ou un collatéral plus ancien : ces upserts sont sautés au plan.

**Changement de numéro d'évaluation.** `verifyAndAttestOnChain(quote)` utilise le numéro « standard »
d'Automata : le plus récent dont l'événement de récupération TCB a ≥ 12 mois (aujourd'hui 20). Le 21
(événement du 10/02/2026) deviendra standard le **≈ 10/02/2027** : avant, lancer `./run.sh add-eval 21`
(2 DAO versionnées + leur collatéral, branchées au routeur). À noter pour la politique P2 : notre machine
Phala est UpToDate en 20, mais **OutOfDate en 21** (module TDX `TDX_01` isvsvn 11 < 13) et **en 22**
(« early », 11/08/2026 : microcode, INTEL-SA-01404/01439/01442) tant que Phala ne met pas l'hôte à jour.
On peut aussi appeler `verifyAndAttestOnChain(quote, n)` avec un numéro chargé.

Autre FMSPC (l'app migre sur un autre hôte Phala) : `ENCLAVE_URL=… ./run.sh refresh` charge la TCB info
du nouveau FMSPC (et la CRL du bon CA PCK) dans les mêmes DAO.

## Arc mainnet (chainId 5042)

`NETWORK=mainnet KEY_FILE=<clé mainnet> ./run.sh deploy` puis `verify`, `module` (RPC
`https://rpc.mainnet.arc.io`, écrit `deployments.dcap.mainnet.json`). Vérifié le 7/11 sur mainnet : précompile
P-256 `0x100` OK, fabrique CREATE2 et Daimo présents, plafond 30 M gaz par bloc. Ce qui change :
- **jamais la clé testnet** ; le propriétaire (`OWNER`) devrait ensuite passer à un multisig
  (`transferOwnership` des contrats Ownable : stockage, config, DAO, routeur, entrée) ;
- adresses : même `SALT_TAG` + même propriétaire ⇒ mêmes adresses qu'en testnet ; sinon, nouvelles ;
- coût attendu au prix du 7/11 (25 gwei) : ≈ 57 M gaz ≈ 1,4 USDC pour la pile + collatéral, ≈ 0,13 USDC
  par vérification ;
- le même calendrier de recharge (mensuel) et de numéro d'évaluation s'applique.

## À savoir

- Avec le précompile, une signature invalide fait **revert** l'appel (le précompile renvoie vide et le
  `abi.decode` d'Automata échoue) au lieu de rendre `success = false`. Le refus reste « fermé » ;
  `EnclaveRegistry.registerEnclave` revert alors au lieu de recevoir `m.ok = false`.
- `EnclaveRegistry` prend son module en `immutable` : changer de module veut dire redéployer le
  registre avec `TdxAttestationModule` `0x26c1…51ca` (ou `contracts/script/Deploy.s.sol` avec
  `DCAP=0x48640f7d94de64b13c89686f3d1240a31aeb4dc9`).
- Le quote vérifié ici est ancré (reportData[32:64]) au bloc 71 069 461 : trop vieux pour la fenêtre
  EIP-2935 (8 191 blocs) de la règle P7 ; `registerEnclave` demande un quote frais de l'enclave.

## Fichiers

`ArcTestnetDcap.s.sol` (plan forge : `deploy()`, `refresh()`, `addTcbEval()`), `send_plan.py` (envoi),
`fetch_collateral.py` (Intel PCS v4), `dcap_tool.py` (décodage, mesure, JSON), `run.sh` (tout),
`collateral/` (collatéral exact chargé + `manifest.json`), `results/` (plans, reçus, sorties décodées).
