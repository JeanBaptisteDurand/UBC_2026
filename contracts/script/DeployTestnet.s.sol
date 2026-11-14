// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";

import {MockAttestationModule} from "../test/mocks/MockAttestationModule.sol";
import {EnclaveRegistry} from "../src/EnclaveRegistry.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {VerdictLog} from "../src/VerdictLog.sol";
import {SessionPay} from "../src/SessionPay.sol";
import {SealedBounty} from "../src/SealedBounty.sol";
import {X402Settler} from "../src/X402Settler.sol";
import {DemoVault} from "../src/demo/DemoVault.sol";

/// @title DeployTestnet — déploie TOUT le moteur (pile v2) sur Arc testnet, câblé, prêt à tourner en vrai.
/// @notice v2 bis : par défaut, le registre se branche sur le VRAI module d'attestation déjà déployé sur Arc testnet
///         (TdxAttestationModule → Automata DCAP + collatéral Intel, deployments.dcap.testnet.json, 7/11) : seules de
///         vraies enclaves Intel TDX s'inscrivent. MOCK_ATTESTATION=1 déploie à la place le module SIMULÉ (machines
///         de démonstration sans TDX — à dire) ; interdit sur Arc mainnet dans tous les cas.
///         v2.1 ter : REQUIRE_SEPT_VE vaut 1 par défaut (v2.1 bis : 0), comme la pile v2 déployée le 7/11
///         (deployments.v2.testnet.json) : oublier la variable n'affaiblit plus la politique d'inscription.
///
/// Env obligatoires : USDC, ERC8004_VALIDATION, ERC8004_IDENTITY, TREASURY, OWNER. Facultatives (défauts testnet) :
///   ATTESTATION_MODULE   0x26C1803dE523aC896Ba7F1787f1401ec792951ca (TdxAttestationModule réel, testnet)
///   MOCK_ATTESTATION     0 (1 = module simulé, démonstration seulement)
///   TIMELOCK             0 (démo : un produit s'active tout de suite, et on le dit)
///   NETWORK_BOUNTY_BPS   1000 (10 %)        OPERATOR_BOUNTY_BPS  500 (5 %)
///   REQUIRE_SEPT_VE      1 (exiger SEPT_VE_DISABLE, bit 28 de tdAttributes : le vrai quote de notre enclave Phala a
///                        tdAttributes = 0x10000000). 0 affaiblit la politique : à ne demander qu'exprès (par ex.
///                        MOCK_ATTESTATION=1 avec des mesures simulées sans ce bit, tdAttributes = 0), et à dire
///   VALIDITY_BLOCKS      170 000 (≈ 24 h)   GRACE_BLOCKS         170 000 (≈ 24 h)
///   BLOCK_TIME_MS        509 (mesuré le 7/11/2026 : 508,95 ms/bloc sur 1 000 000 de blocs du testnet,
///                        506,7–515,8 ms sur les fenêtres de 172 800 blocs des 89 derniers jours ; donc
///                        170 000 blocs ≈ 24,0–24,4 h sur le testnet)
///
/// Usage :
///   forge script script/DeployTestnet.s.sol --rpc-url https://rpc.testnet.arc.io --broadcast --private-key $PK --legacy
contract DeployTestnet is Script {
    uint256 public constant ARC_MAINNET_CHAIN_ID = 5042;
    /// @notice TdxAttestationModule branché sur le vrai Automata DCAP d'Arc testnet (deployments.dcap.testnet.json).
    address public constant DEFAULT_ATTESTATION_MODULE = 0x26C1803dE523aC896Ba7F1787f1401ec792951ca;

    uint64 public constant DEFAULT_TIMELOCK = 0; // démo
    uint16 public constant DEFAULT_NETWORK_BOUNTY_BPS = 1000;
    uint16 public constant DEFAULT_OPERATOR_BOUNTY_BPS = 500;
    bool public constant DEFAULT_REQUIRE_SEPT_VE = true; // v2.1 ter (v2.1 bis : false) ; = la pile v2 déployée
    uint64 public constant DEFAULT_VALIDITY_BLOCKS = 170_000;
    uint64 public constant DEFAULT_GRACE_BLOCKS = 170_000;
    uint64 public constant DEFAULT_BLOCK_TIME_MS = 509;

    struct Config {
        address usdc;
        address validation;
        address identity;
        address treasury;
        address owner;
        address module; // module d'attestation déjà déployé (ignoré si mockAttestation)
        bool mockAttestation;
        uint64 timelock;
        uint16 networkBountyBps;
        uint16 operatorBountyBps;
        bool requireSeptVe;
        uint64 validityBlocks;
        uint64 graceBlocks;
        uint64 blockTimeMs;
    }

    struct Deployed {
        address module;
        address products;
        address bond;
        address registry;
        address verdict;
        address sessionPay;
        address sealedBounty;
        address x402;
        address demoVault;
    }

    function run() external returns (Deployed memory d) {
        Config memory c = configFromEnv();
        check(c);

        vm.startBroadcast();
        d = deploy(c);
        vm.stopBroadcast();

        _log(c, d);
    }

    function configFromEnv() public view returns (Config memory c) {
        c.usdc = vm.envAddress("USDC");
        c.validation = vm.envAddress("ERC8004_VALIDATION");
        c.identity = vm.envAddress("ERC8004_IDENTITY");
        c.treasury = vm.envAddress("TREASURY");
        c.owner = vm.envAddress("OWNER");
        c.module = vm.envOr("ATTESTATION_MODULE", DEFAULT_ATTESTATION_MODULE);
        c.mockAttestation = vm.envOr("MOCK_ATTESTATION", uint256(0)) == 1;
        c.timelock = uint64(vm.envOr("TIMELOCK", uint256(DEFAULT_TIMELOCK)));
        c.networkBountyBps = uint16(vm.envOr("NETWORK_BOUNTY_BPS", uint256(DEFAULT_NETWORK_BOUNTY_BPS)));
        c.operatorBountyBps = uint16(vm.envOr("OPERATOR_BOUNTY_BPS", uint256(DEFAULT_OPERATOR_BOUNTY_BPS)));
        c.requireSeptVe = vm.envOr("REQUIRE_SEPT_VE", DEFAULT_REQUIRE_SEPT_VE ? uint256(1) : uint256(0)) == 1;
        c.validityBlocks = uint64(vm.envOr("VALIDITY_BLOCKS", uint256(DEFAULT_VALIDITY_BLOCKS)));
        c.graceBlocks = uint64(vm.envOr("GRACE_BLOCKS", uint256(DEFAULT_GRACE_BLOCKS)));
        c.blockTimeMs = uint64(vm.envOr("BLOCK_TIME_MS", uint256(DEFAULT_BLOCK_TIME_MS)));
    }

    /// @notice Garde-fous : jamais le module d'attestation simulé sur Arc mainnet.
    function check(Config memory c) public view {
        require(
            block.chainid != ARC_MAINNET_CHAIN_ID,
            unicode"DeployTestnet : module d'attestation SIMULÉ, interdit sur Arc mainnet (utiliser Deploy.s.sol)"
        );
        require(c.treasury != address(0), unicode"TREASURY : adresse nulle");
        require(c.owner != address(0), unicode"OWNER : adresse nulle");
        require(c.identity != address(0), unicode"ERC8004_IDENTITY : adresse nulle");
        require(c.validityBlocks > 0 && c.blockTimeMs > 0, unicode"VALIDITY_BLOCKS et BLOCK_TIME_MS doivent être > 0");
        if (!c.mockAttestation) {
            require(c.module.code.length > 0, unicode"ATTESTATION_MODULE : aucun code à cette adresse");
        }
    }

    function deploy(Config memory c) public returns (Deployed memory d) {
        address module = c.mockAttestation ? address(new MockAttestationModule()) : c.module;
        ProductRegistry products = new ProductRegistry(c.timelock);
        OperatorBond bond = new OperatorBond(c.usdc, c.treasury, c.owner, c.identity);
        EnclaveRegistry registry = new EnclaveRegistry(
            module,
            address(products),
            address(bond),
            c.requireSeptVe,
            c.validityBlocks,
            c.graceBlocks,
            c.blockTimeMs
        );
        VerdictLog verdict = new VerdictLog(c.validation, c.owner);
        SealedBounty sealedBounty = new SealedBounty(
            c.usdc,
            address(products),
            address(registry),
            address(bond),
            address(verdict),
            c.treasury,
            c.networkBountyBps,
            c.operatorBountyBps
        );
        SessionPay sessionPay = new SessionPay(
            c.usdc, address(products), address(registry), address(bond), address(verdict), c.treasury, address(sealedBounty)
        );
        X402Settler x402 = new X402Settler(c.usdc, address(products), address(registry), address(bond), c.treasury);
        DemoVault demoVault = new DemoVault(c.usdc);

        // câblage des droits, UNE fois, par la clé de déploiement
        address[] memory settlements = new address[](3);
        settlements[0] = address(sessionPay);
        settlements[1] = address(sealedBounty);
        settlements[2] = address(x402);
        bond.initialize(address(registry), settlements);
        address[] memory callers = new address[](2);
        callers[0] = address(sessionPay);
        callers[1] = address(sealedBounty);
        verdict.initialize(callers);

        d = Deployed({
            module: module,
            products: address(products),
            bond: address(bond),
            registry: address(registry),
            verdict: address(verdict),
            sessionPay: address(sessionPay),
            sealedBounty: address(sealedBounty),
            x402: address(x402),
            demoVault: address(demoVault)
        });
    }

    function _log(Config memory c, Deployed memory d) internal pure {
        console2.log("TIMELOCK (s)         ", uint256(c.timelock));
        console2.log("VALIDITY_BLOCKS      ", uint256(c.validityBlocks));
        console2.log("GRACE_BLOCKS         ", uint256(c.graceBlocks));
        console2.log("BLOCK_TIME_MS        ", uint256(c.blockTimeMs));
        console2.log("REQUIRE_SEPT_VE      ", c.requireSeptVe);
        console2.log(c.mockAttestation ? "Module SIMULE (demo)  " : "TdxAttestationModule ", d.module);
        console2.log("OWNER                ", c.owner);
        console2.log("ProductRegistry      ", d.products);
        console2.log("OperatorBond         ", d.bond);
        console2.log("EnclaveRegistry      ", d.registry);
        console2.log("VerdictLog           ", d.verdict);
        console2.log("SessionPay           ", d.sessionPay);
        console2.log("SealedBounty         ", d.sealedBounty);
        console2.log("X402Settler          ", d.x402);
        console2.log("DemoVault            ", d.demoVault);
    }
}
