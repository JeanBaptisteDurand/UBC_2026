// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title ArcTestnetDcap — déploie la pile DCAP d'Automata (PCCS on-chain + entrée + vérificateur V4)
///        sur Arc et y charge le collatéral Intel d'UN quote TDX réel.
/// @notice Contrats d'Automata utilisés tels quels (MIT, arbre vendored). Même assemblage que leur
///         harnais de test (forge-test/utils/PCCSSetupBase.sol) : DAO « versionnées » par numéro
///         d'évaluation TCB, PccsDependencyConfig, PCCSRouter, AutomataDcapAttestationFee, V4QuoteVerifier.
///         Le vérificateur P-256 est choisi par l'outil d'Automata (P256Configuration.simulateVerify :
///         appel réel au précompile 0x100 via RPC_URL, repli Daimo sinon).
/// @dev Installé par dcap-integration/arc-testnet/run.sh dans evm/forge-script/arc/.
///      Ce script sert de PLAN : on l'exécute SANS --broadcast (fork local d'Arc) ; la liste de
///      transactions qu'il produit (broadcast/.../dry-run/<sig>-latest.json) est envoyée ensuite par
///      send_plan.py, une transaction à la fois, nonce relu à chaque envoi (la clé est partagée).
///      - Déploiements en CREATE2 (fabrique 0x4e59…) : adresses indépendantes du nonce ; un contrat
///        déjà présent à l'adresse prévue est réutilisé (relance sans doublon).
///      - L'EVM locale de forge (paris) n'a pas le précompile P-256 : pour la SEULE exécution locale,
///        le code Solidity de Daimo (déjà déployé sur Arc) est copié à 0x100. Sur Arc, le vrai
///        précompile répond.
///      - Chaque upsert est d'abord joué à sec (snapshot + prank) : seuls ceux qui passent entrent au plan.

import {console2} from "forge-std/console2.sol";
import {stdJson} from "forge-std/StdJson.sol";
import "solady/utils/JSONParserLib.sol";
import "solady/utils/LibString.sol";

import {CA} from "@automata-network/on-chain-pccs/Common.sol";
import {
    EnclaveIdentityJsonObj,
    EnclaveIdentityHelper,
    IdentityObj
} from "@automata-network/on-chain-pccs/helpers/EnclaveIdentityHelper.sol";
import {TcbInfoJsonObj, FmspcTcbHelper} from "@automata-network/on-chain-pccs/helpers/FmspcTcbHelper.sol";
import {PCKHelper} from "@automata-network/on-chain-pccs/helpers/PCKHelper.sol";
import {X509CRLHelper} from "@automata-network/on-chain-pccs/helpers/X509CRLHelper.sol";
import {TcbEvalJsonObj, TcbEvalHelper} from "@automata-network/on-chain-pccs/helpers/TcbEvalHelper.sol";
import {AutomataFmspcTcbDaoVersioned} from
    "@automata-network/on-chain-pccs/automata_pccs/versioned/AutomataFmspcTcbDaoVersioned.sol";
import {AutomataEnclaveIdentityDaoVersioned} from
    "@automata-network/on-chain-pccs/automata_pccs/versioned/AutomataEnclaveIdentityDaoVersioned.sol";
import {AutomataTcbEvalDao} from "@automata-network/on-chain-pccs/automata_pccs/AutomataTcbEvalDao.sol";
import {AutomataPcsDao} from "@automata-network/on-chain-pccs/automata_pccs/AutomataPcsDao.sol";
import {AutomataPckDao} from "@automata-network/on-chain-pccs/automata_pccs/AutomataPckDao.sol";
import {AutomataDaoStorage} from "@automata-network/on-chain-pccs/automata_pccs/shared/AutomataDaoStorage.sol";
import {PccsDependencyConfig} from "@automata-network/on-chain-pccs/automata_pccs/shared/PccsDependencyConfig.sol";
import {PcsDao} from "@automata-network/on-chain-pccs/bases/PcsDao.sol";
import {TcbEvalDao} from "@automata-network/on-chain-pccs/bases/TcbEvalDao.sol";
import {EnclaveIdentityDao} from "@automata-network/on-chain-pccs/bases/EnclaveIdentityDao.sol";
import {FmspcTcbDao} from "@automata-network/on-chain-pccs/bases/FmspcTcbDao.sol";

import {PCCSRouter} from "../../contracts/PCCSRouter.sol";
import {AutomataDcapAttestationFee} from "../../contracts/AutomataDcapAttestationFee.sol";
import {V4QuoteVerifier} from "../../contracts/verifiers/V4QuoteVerifier.sol";

import {P256Configuration} from "../utils/P256Configuration.sol";

contract ArcTestnetDcap is P256Configuration {
    using JSONParserLib for JSONParserLib.Item;
    using LibString for string;

    uint256 constant PCS_API_VERSION = 4; // identité QE TDX = PCS v4
    uint256 constant ATTESTER_ROLE = 1; // _ROLE_0 des DAO Automata (OwnableRoles)

    address owner;
    string collateralDir;
    string saltTag;
    address p256;

    struct Stack {
        address enclaveIdHelper;
        address tcbHelper;
        address x509;
        address x509Crl;
        address tcbEvalHelper;
        address store;
        address pcsDao;
        address dep;
        address pckDao;
        address enclaveIdDao;
        address fmspcTcbDao;
        address tcbEvalDao;
        address router;
        address attestation;
        address v4;
    }

    // ------------------------------------------------------------------ entrées

    function run() public override {
        deploy();
    }

    /// @notice Déploie (ou complète) toute la pile, charge le collatéral, vérifie le quote en local.
    function deploy() public {
        _env();
        uint32 tcbEval = uint32(vm.envUint("TCB_EVAL"));
        Stack memory s;

        s.enclaveIdHelper = _create2("EnclaveIdentityHelper", type(EnclaveIdentityHelper).creationCode);
        s.tcbHelper = _create2("FmspcTcbHelper", type(FmspcTcbHelper).creationCode);
        s.x509 = _create2("PCKHelper", type(PCKHelper).creationCode);
        s.x509Crl = _create2("X509CRLHelper", type(X509CRLHelper).creationCode);
        s.tcbEvalHelper = _create2("TcbEvalHelper", type(TcbEvalHelper).creationCode);

        s.store = _create2("AutomataDaoStorage", abi.encodePacked(type(AutomataDaoStorage).creationCode, abi.encode(owner)));
        s.pcsDao = _create2(
            "AutomataPcsDao",
            abi.encodePacked(type(AutomataPcsDao).creationCode, abi.encode(s.store, p256, s.x509, s.x509Crl))
        );
        s.dep = _create2(
            "PccsDependencyConfig", abi.encodePacked(type(PccsDependencyConfig).creationCode, abi.encode(owner))
        );
        if (PccsDependencyConfig(s.dep).pcsDao() == address(0)) {
            vm.broadcast(owner);
            PccsDependencyConfig(s.dep).initialize(s.pcsDao, s.x509Crl);
        }
        s.pckDao = _create2(
            "AutomataPckDao",
            abi.encodePacked(type(AutomataPckDao).creationCode, abi.encode(s.store, p256, s.pcsDao, s.x509, s.x509Crl))
        );
        (s.enclaveIdDao, s.fmspcTcbDao) = _versionedDaos(s.store, s.dep, s.pcsDao, s.enclaveIdHelper, s.tcbHelper, s.x509, s.x509Crl, tcbEval);
        s.tcbEvalDao = _create2(
            "AutomataTcbEvalDao",
            abi.encodePacked(
                type(AutomataTcbEvalDao).creationCode, abi.encode(s.store, p256, s.dep, s.tcbEvalHelper, s.x509, owner)
            )
        );

        vm.startBroadcast(owner);
        // pas de lecteur public pour les écrivains autorisés : ré-accorder est idempotent et coûte ~30 k gas
        AutomataDaoStorage(s.store).grantDao(s.pcsDao);
        AutomataDaoStorage(s.store).grantDao(s.pckDao);
        AutomataDaoStorage(s.store).grantDao(s.tcbEvalDao);
        vm.stopBroadcast();
        _grantAttester(s.tcbEvalDao);

        s.router = _create2(
            "PCCSRouter",
            abi.encodePacked(
                type(PCCSRouter).creationCode,
                abi.encode(owner, s.tcbEvalDao, s.pcsDao, s.pckDao, s.x509, s.x509Crl, s.tcbHelper)
            )
        );
        if (!AutomataDaoStorage(s.store).isAuthorizedCaller(s.router)) {
            vm.broadcast(owner);
            AutomataDaoStorage(s.store).setCallerAuthorization(s.router, true);
        }
        _wireEval(s.router, tcbEval, s.enclaveIdDao, s.fmspcTcbDao);

        s.attestation = _create2(
            "AutomataDcapAttestationFee", abi.encodePacked(type(AutomataDcapAttestationFee).creationCode, abi.encode(owner))
        );
        s.v4 = _create2(
            "V4QuoteVerifier", abi.encodePacked(type(V4QuoteVerifier).creationCode, abi.encode(p256, s.router))
        );
        if (address(AutomataDcapAttestationFee(s.attestation).quoteVerifiers(4)) != s.v4) {
            vm.startBroadcast(owner);
            AutomataDcapAttestationFee(s.attestation).setQuoteVerifier(s.v4);
            PCCSRouter(s.router).setAuthorized(s.v4, true);
            vm.stopBroadcast();
        }

        _logStack(s);
        _upsertAll(s.pcsDao, s.tcbEvalDao, s.enclaveIdDao, s.fmspcTcbDao, s.enclaveIdHelper);
        _localCheck(s.attestation);
    }

    /// @notice Recharge le collatéral (nouvelle TCB info, identité QE, CRL…) dans une pile existante.
    ///         Les upserts inchangés ou plus anciens sont sautés (joués à sec d'abord).
    function refresh() public {
        _env();
        _upsertAll(
            vm.envAddress("PCS_DAO"),
            vm.envAddress("TCB_EVAL_DAO"),
            vm.envAddress("ENCLAVE_ID_DAO"),
            vm.envAddress("FMSPC_TCB_DAO"),
            vm.envAddress("ENCLAVE_ID_HELPER")
        );
        _localCheck(vm.envAddress("DCAP_ATTESTATION"));
    }

    /// @notice Ajoute un numéro d'évaluation TCB (ex. quand le « standard » d'Automata passe de 20 à 21) :
    ///         deux DAO versionnées neuves branchées au routeur, puis le collatéral de ce numéro.
    function addTcbEval() public {
        _env();
        uint32 tcbEval = uint32(vm.envUint("TCB_EVAL"));
        address pcsDao = vm.envAddress("PCS_DAO");
        address enclaveIdHelper = vm.envAddress("ENCLAVE_ID_HELPER");
        (address enclaveIdDao, address fmspcTcbDao) = _versionedDaos(
            vm.envAddress("PCCS_STORAGE"),
            vm.envAddress("PCCS_DEPENDENCY_CONFIG"),
            pcsDao,
            enclaveIdHelper,
            vm.envAddress("FMSPC_TCB_HELPER"),
            vm.envAddress("PCK_HELPER"),
            vm.envAddress("X509_CRL_HELPER"),
            tcbEval
        );
        _wireEval(vm.envAddress("PCCS_ROUTER"), tcbEval, enclaveIdDao, fmspcTcbDao);
        console2.log("TCB eval", tcbEval);
        console2.log("  EnclaveIdentityDaoVersioned", enclaveIdDao);
        console2.log("  FmspcTcbDaoVersioned       ", fmspcTcbDao);
        _upsertAll(pcsDao, vm.envAddress("TCB_EVAL_DAO"), enclaveIdDao, fmspcTcbDao, enclaveIdHelper);
    }

    // ------------------------------------------------------------------ déploiement

    function _versionedDaos(
        address store,
        address dep,
        address pcsDao,
        address enclaveIdHelper,
        address tcbHelper,
        address x509,
        address x509Crl,
        uint32 tcbEval
    ) internal returns (address enclaveIdDao, address fmspcTcbDao) {
        string memory n = vm.toString(uint256(tcbEval));
        enclaveIdDao = _create2(
            string.concat("AutomataEnclaveIdentityDaoVersioned_tcbeval_", n),
            abi.encodePacked(
                type(AutomataEnclaveIdentityDaoVersioned).creationCode,
                abi.encode(store, p256, dep, enclaveIdHelper, x509, owner, tcbEval)
            )
        );
        fmspcTcbDao = _create2(
            string.concat("AutomataFmspcTcbDaoVersioned_tcbeval_", n),
            abi.encodePacked(
                type(AutomataFmspcTcbDaoVersioned).creationCode,
                abi.encode(store, p256, pcsDao, tcbHelper, x509, x509Crl, owner, tcbEval)
            )
        );
        vm.startBroadcast(owner);
        AutomataDaoStorage(store).grantDao(enclaveIdDao);
        AutomataDaoStorage(store).grantDao(fmspcTcbDao);
        vm.stopBroadcast();
        _grantAttester(enclaveIdDao);
        _grantAttester(fmspcTcbDao);
    }

    function _wireEval(address router, uint32 tcbEval, address enclaveIdDao, address fmspcTcbDao) internal {
        if (PCCSRouter(router).qeIdDaoVersionedAddr(tcbEval) != enclaveIdDao) {
            vm.broadcast(owner);
            PCCSRouter(router).setQeIdDaoVersionedAddr(tcbEval, enclaveIdDao);
        }
        if (PCCSRouter(router).fmspcTcbDaoVersionedAddr(tcbEval) != fmspcTcbDao) {
            vm.broadcast(owner);
            PCCSRouter(router).setFmspcTcbDaoVersionedAddr(tcbEval, fmspcTcbDao);
        }
    }

    function _grantAttester(address dao) internal {
        if (!AutomataTcbEvalDao(dao).hasAllRoles(owner, ATTESTER_ROLE)) {
            vm.broadcast(owner);
            AutomataTcbEvalDao(dao).grantRoles(owner, ATTESTER_ROLE);
        }
    }

    /// @dev CREATE2 via la fabrique déterministe (comme les scripts d'Automata) ; réutilise l'existant.
    function _create2(string memory name, bytes memory initCode) internal returns (address addr) {
        bytes32 salt = keccak256(abi.encodePacked(saltTag, ":", name));
        addr = vm.computeCreate2Address(salt, keccak256(initCode), CREATE2_FACTORY);
        if (addr.code.length > 0) {
            console2.log(string.concat("[deja] ", name), addr);
            return addr;
        }
        vm.broadcast(owner);
        (bool ok,) = CREATE2_FACTORY.call(abi.encodePacked(salt, initCode));
        require(ok && addr.code.length > 0, string.concat("CREATE2 echoue : ", name));
    }

    function _logStack(Stack memory s) internal pure {
        console2.log("EnclaveIdentityHelper           ", s.enclaveIdHelper);
        console2.log("FmspcTcbHelper                  ", s.tcbHelper);
        console2.log("PCKHelper                       ", s.x509);
        console2.log("X509CRLHelper                   ", s.x509Crl);
        console2.log("TcbEvalHelper                   ", s.tcbEvalHelper);
        console2.log("AutomataDaoStorage              ", s.store);
        console2.log("AutomataPcsDao                  ", s.pcsDao);
        console2.log("PccsDependencyConfig            ", s.dep);
        console2.log("AutomataPckDao                  ", s.pckDao);
        console2.log("AutomataEnclaveIdentityDaoVers. ", s.enclaveIdDao);
        console2.log("AutomataFmspcTcbDaoVersioned    ", s.fmspcTcbDao);
        console2.log("AutomataTcbEvalDao              ", s.tcbEvalDao);
        console2.log("PCCSRouter                      ", s.router);
        console2.log("AutomataDcapAttestationFee      ", s.attestation);
        console2.log("V4QuoteVerifier                 ", s.v4);
    }

    // ------------------------------------------------------------------ collatéral

    function _env() internal {
        owner = vm.envAddress("OWNER");
        collateralDir = vm.envOr("COLLATERAL_DIR", string("forge-test/assets/arc-testnet"));
        saltTag = vm.envOr("SALT_TAG", string("archive-dcap-arc-v1"));
        p256 = vm.envOr("P256_VERIFIER", address(0));
        if (p256 == address(0)) {
            // outil d'Automata : teste 0x100 (RIP-7212 / EIP-7951) puis Daimo, sur la vraie chaîne (RPC_URL)
            p256 = simulateVerify();
        }
        console2.log("P256 verifier retenu", p256);
        if (p256 == RIP7212_P256_PRECOMPILE && p256.code.length == 0) {
            require(DAIMO_P256.code.length > 0, "Daimo absent : impossible de simuler 0x100 en local");
            vm.etch(p256, DAIMO_P256.code);
            console2.log("[local] 0x100 simule par le code Daimo (execution locale seulement)");
        }
    }

    function _upsertAll(
        address pcsDao,
        address tcbEvalDao,
        address enclaveIdDao,
        address fmspcTcbDao,
        address enclaveIdHelper
    ) internal {
        string memory dir = string.concat(vm.projectRoot(), "/", collateralDir, "/");
        uint256 pckCaCode = vm.parseJsonUint(vm.readFile(string.concat(dir, "manifest.json")), ".pckCaCode");
        require(pckCaCode == uint256(CA.PLATFORM) || pckCaCode == uint256(CA.PROCESSOR), "pckCaCode");
        CA pckCa = CA(uint8(pckCaCode));

        _try(
            pcsDao,
            abi.encodeCall(PcsDao.upsertPcsCertificates, (CA.ROOT, vm.readFileBinary(string.concat(dir, "root_ca.der")))),
            "Intel SGX Root CA"
        );
        _try(
            pcsDao,
            abi.encodeCall(PcsDao.upsertRootCACrl, (vm.readFileBinary(string.concat(dir, "root_ca_crl.der")))),
            "CRL de la racine"
        );
        _try(
            pcsDao,
            abi.encodeCall(PcsDao.upsertPcsCertificates, (pckCa, vm.readFileBinary(string.concat(dir, "pck_ca.der")))),
            "Intel SGX PCK CA (platform/processor)"
        );
        _try(
            pcsDao,
            abi.encodeCall(
                PcsDao.upsertPcsCertificates, (CA.SIGNING, vm.readFileBinary(string.concat(dir, "tcb_signing.der")))
            ),
            "Intel SGX TCB Signing"
        );
        _try(
            pcsDao,
            abi.encodeCall(PcsDao.upsertPckCrl, (pckCa, vm.readFileBinary(string.concat(dir, "pck_crl.der")))),
            "CRL PCK"
        );
        _try(
            tcbEvalDao,
            abi.encodeCall(TcbEvalDao.upsertTcbEvaluationData, (_readTcbEvalJson(string.concat(dir, "tdx_tcb_eval.json")))),
            "numeros d'evaluation TCB TDX"
        );
        EnclaveIdentityJsonObj memory idJson = _readIdentityJson(string.concat(dir, "tdx_qe_identity.json"));
        (IdentityObj memory identity,) = EnclaveIdentityHelper(enclaveIdHelper).parseIdentityString(idJson.identityStr);
        _try(
            enclaveIdDao,
            abi.encodeCall(EnclaveIdentityDao.upsertEnclaveIdentity, (uint256(identity.id), PCS_API_VERSION, idJson)),
            "identite du QE TDX"
        );
        _try(
            fmspcTcbDao,
            abi.encodeCall(FmspcTcbDao.upsertFmspcTcb, (_readTcbInfoJson(string.concat(dir, "tdx_tcb_info.json")))),
            "TCB info TDX du FMSPC"
        );
    }

    /// @dev Joue l'appel à sec (état restauré), puis le met au plan seulement s'il passe.
    function _try(address target, bytes memory data, string memory label) internal returns (bool) {
        uint256 snap = vm.snapshotState();
        vm.prank(owner);
        uint256 g = gasleft();
        (bool ok, bytes memory ret) = target.call(data);
        uint256 used = g - gasleft();
        vm.revertToState(snap);
        if (!ok) {
            console2.log(string.concat("[saute] ", label, " : revert (deja charge, plus ancien ou invalide)"));
            console2.logBytes(ret);
            return false;
        }
        vm.broadcast(owner);
        (ok,) = target.call(data);
        require(ok, string.concat("echec apres essai a sec : ", label));
        console2.log(string.concat("[ok]    ", label, " - gas local ~"), used);
        return true;
    }

    /// @dev Vérification locale (hors plan) du quote, avec le P-256 Solidity de Daimo à la place du précompile.
    function _localCheck(address attestation) internal {
        string memory path = string.concat(vm.projectRoot(), "/", collateralDir, "/quote.hex");
        bytes memory quote = vm.parseBytes(vm.readFile(path));
        uint256 g = gasleft();
        (bool ok, bytes memory out) = AutomataDcapAttestationFee(attestation).verifyAndAttestOnChain(quote);
        uint256 used = g - gasleft();
        console2.log("[local] verifyAndAttestOnChain ok =", ok);
        console2.log("[local] gas (P-256 en Solidity, Daimo) =", used);
        if (ok) {
            console2.log("[local] tcbStatus =", uint8(out[4]));
            console2.log("[local] sortie (octets) =", out.length);
        } else {
            console2.log(string(out));
        }
    }

    // Lecteurs JSON : même logique que forge-test/utils/PCCSSetupBase.sol d'Automata (octets exacts signés par Intel).

    function _readTcbInfoJson(string memory path) private view returns (TcbInfoJsonObj memory obj) {
        string memory data = vm.readFile(path);
        JSONParserLib.Item memory root = JSONParserLib.parse(data);
        JSONParserLib.Item[] memory items = root.children();
        for (uint256 i = 0; i < root.size(); i++) {
            if (JSONParserLib.decodeString(items[i].key()).eq("tcbInfo")) {
                obj.tcbInfoStr = items[i].value();
            }
        }
        obj.signature = stdJson.readBytes(data, ".signature");
    }

    function _readIdentityJson(string memory path) private view returns (EnclaveIdentityJsonObj memory obj) {
        string memory data = vm.readFile(path);
        JSONParserLib.Item memory root = JSONParserLib.parse(data);
        JSONParserLib.Item[] memory items = root.children();
        for (uint256 i = 0; i < root.size(); i++) {
            if (JSONParserLib.decodeString(items[i].key()).eq("enclaveIdentity")) {
                obj.identityStr = items[i].value();
            }
        }
        obj.signature = stdJson.readBytes(data, ".signature");
    }

    function _readTcbEvalJson(string memory path) private view returns (TcbEvalJsonObj memory obj) {
        string memory data = vm.readFile(path);
        JSONParserLib.Item memory root = JSONParserLib.parse(data);
        JSONParserLib.Item[] memory items = root.children();
        for (uint256 i = 0; i < root.size(); i++) {
            if (JSONParserLib.decodeString(items[i].key()).eq("tcbEvaluationDataNumbers")) {
                obj.tcbEvaluationDataNumbers = items[i].value();
            }
        }
        obj.signature = stdJson.readBytes(data, ".signature");
    }
}
