// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";

import {TdxAttestationModule} from "../src/attestation/TdxAttestationModule.sol";
import {EnclaveRegistry} from "../src/EnclaveRegistry.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {VerdictLog} from "../src/VerdictLog.sol";
import {SessionPay} from "../src/SessionPay.sol";
import {SealedBounty} from "../src/SealedBounty.sol";
import {X402Settler} from "../src/X402Settler.sol";

/// @title Deploy — déploie et CÂBLE tout le réseau d'enclaves d'Arc (pile v2, cible : Arc MAINNET).
/// @notice Prend les adresses externes (déjà sur la chaîne) par variables d'environnement. Les défauts
///         sont les valeurs MAINNET (ubc/research/plan-reseau-enclaves-arc-2026-11-01/F-economie-mainnet
///         -2026-11-07.md §0 et deploy/mainnet.env.example) :
///   USDC                 l'USDC d'Arc (0x3600…0000)                                    — obligatoire
///   DCAP                 le vérificateur Automata DCAP (C1), déployé à part ; absent
///                        d'Arc mainnet au 7/11 : à déployer d'abord                    — obligatoire
///   ERC8004_VALIDATION   le registre de validation ERC-8004 de Circle (du code exigé)   — obligatoire
///   ERC8004_IDENTITY     le registre d'identité ERC-8004 de Circle (propriété des agentId) — obligatoire
///   TREASURY             le fonds du réseau (multisig 2-sur-3, jamais une seule clé ;
///                        sur Arc mainnet : du code exigé à l'adresse)                    — obligatoire
///   OWNER                la gouvernance de OperatorBond et VerdictLog (multisig 2-sur-3 ;
///                        sur Arc mainnet : du code exigé, jamais la clé de déploiement)  — obligatoire
///   TIMELOCK             délai d'activation d'un produit / d'un changement de prix, en s
///                        (défaut 172 800 = 48 h ; refusé sous 48 h sur Arc mainnet)
///   NETWORK_BOUNTY_BPS   part réseau des primes, en plus du palier (défaut 1000 = 10 %)
///   OPERATOR_BOUNTY_BPS  part des enclaves vérificatrices, en plus (défaut 500 = 5 %)
///   REQUIRE_SEPT_VE      exiger SEPT_VE_DISABLE (0/1, défaut 1 : le vrai quote de notre enclave
///                        Phala a tdAttributes = 0x10000000, DEBUG = 0)
///   VALIDITY_BLOCKS      validité d'une attestation, en blocs (défaut 170 000 ≈ 24 h)
///   GRACE_BLOCKS         délai de règlement après la fin d'une fenêtre, en blocs (défaut 170 000 ≈ 24 h)
///   BLOCK_TIME_MS        durée de bloc estimée, pour l'horodatage indicatif expiresAt (défaut 508)
///
///   Durée de bloc mesurée le 7/11/2026 (cast block, écart de timestamps) : Arc mainnet 508,1 ms/bloc sur
///   1 000 000 de blocs, 506,7–509,6 ms sur les fenêtres de 172 800 blocs des 89 derniers jours ; donc
///   24 h ≈ 170 000 blocs (23,9–24,1 h).
///
/// v2 bis (revue adverse du 7/11) : la clé de déploiement câble OperatorBond et VerdictLog UNE fois pendant ce
/// script (initialize), avant toute caution, puis n'a plus aucun pouvoir ; tout nouvel ajout passe par OWNER avec
/// 8 jours de délai. SessionPay facture les tentatives de la Prime scellée (attemptsFor = SealedBounty).
///
/// Usage : forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.arc.io --broadcast
contract Deploy is Script {
    uint256 public constant ARC_MAINNET_CHAIN_ID = 5042;

    uint64 public constant DEFAULT_TIMELOCK = 172_800; // 48 h (prix verrouillé à l'ouverture en v2)
    uint64 public constant MIN_MAINNET_TIMELOCK = 172_800;
    uint16 public constant DEFAULT_NETWORK_BOUNTY_BPS = 1000;
    uint16 public constant DEFAULT_OPERATOR_BOUNTY_BPS = 500;
    bool public constant DEFAULT_REQUIRE_SEPT_VE = true;
    uint64 public constant DEFAULT_VALIDITY_BLOCKS = 170_000; // ≈ 24 h à 508 ms/bloc
    uint64 public constant DEFAULT_GRACE_BLOCKS = 170_000; // ≈ 24 h
    uint64 public constant DEFAULT_BLOCK_TIME_MS = 508;

    struct Config {
        address usdc;
        address dcap;
        address validation;
        address identity;
        address treasury;
        address owner;
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
    }

    function run() external returns (Deployed memory d) {
        Config memory c = configFromEnv();
        check(c);

        vm.startBroadcast();
        d = deploy(c);
        vm.stopBroadcast();

        _log(c, d);
    }

    /// @notice Lit la configuration dans l'environnement ; les défauts sont les valeurs mainnet.
    function configFromEnv() public view returns (Config memory c) {
        c.usdc = vm.envAddress("USDC");
        c.dcap = vm.envAddress("DCAP");
        c.validation = vm.envAddress("ERC8004_VALIDATION");
        c.identity = vm.envAddress("ERC8004_IDENTITY");
        c.treasury = vm.envAddress("TREASURY");
        c.owner = vm.envAddress("OWNER");
        c.timelock = uint64(vm.envOr("TIMELOCK", uint256(DEFAULT_TIMELOCK)));
        c.networkBountyBps = uint16(vm.envOr("NETWORK_BOUNTY_BPS", uint256(DEFAULT_NETWORK_BOUNTY_BPS)));
        c.operatorBountyBps = uint16(vm.envOr("OPERATOR_BOUNTY_BPS", uint256(DEFAULT_OPERATOR_BOUNTY_BPS)));
        c.requireSeptVe = vm.envOr("REQUIRE_SEPT_VE", DEFAULT_REQUIRE_SEPT_VE ? uint256(1) : uint256(0)) == 1;
        c.validityBlocks = uint64(vm.envOr("VALIDITY_BLOCKS", uint256(DEFAULT_VALIDITY_BLOCKS)));
        c.graceBlocks = uint64(vm.envOr("GRACE_BLOCKS", uint256(DEFAULT_GRACE_BLOCKS)));
        c.blockTimeMs = uint64(vm.envOr("BLOCK_TIME_MS", uint256(DEFAULT_BLOCK_TIME_MS)));
    }

    /// @notice Garde-fous avant tout envoi : refuse une configuration dangereuse.
    function check(Config memory c) public view {
        require(c.dcap.code.length > 0, unicode"DCAP : aucun code à cette adresse (déployer Automata DCAP d'abord)");
        require(c.treasury != address(0), unicode"TREASURY : adresse nulle");
        require(c.owner != address(0), unicode"OWNER : adresse nulle");
        require(c.identity != address(0), unicode"ERC8004_IDENTITY : adresse nulle");
        require(c.validityBlocks > 0 && c.blockTimeMs > 0, unicode"VALIDITY_BLOCKS et BLOCK_TIME_MS doivent être > 0");
        if (block.chainid == ARC_MAINNET_CHAIN_ID) {
            require(c.timelock >= MIN_MAINNET_TIMELOCK, unicode"TIMELOCK < 48 h refusé sur Arc mainnet");
            require(c.treasury.code.length > 0, unicode"TREASURY : un multisig (du code) est exigé sur Arc mainnet");
            require(c.owner.code.length > 0, unicode"OWNER : un multisig (du code) est exigé sur Arc mainnet");
            require(c.owner != msg.sender, unicode"OWNER : jamais la clé de déploiement sur Arc mainnet");
            require(c.validation.code.length > 0, unicode"ERC8004_VALIDATION : aucun code à cette adresse");
            require(c.identity.code.length > 0, unicode"ERC8004_IDENTITY : aucun code à cette adresse");
        }
    }

    /// @notice Déploie et câble la pile (appelée entre start/stopBroadcast par run, ou directement en test).
    function deploy(Config memory c) public returns (Deployed memory d) {
        TdxAttestationModule module = new TdxAttestationModule(c.dcap);
        ProductRegistry products = new ProductRegistry(c.timelock);
        OperatorBond bond = new OperatorBond(c.usdc, c.treasury, c.owner, c.identity);
        EnclaveRegistry registry = new EnclaveRegistry(
            address(module),
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
        // SessionPay facture aussi les tentatives de la Prime scellée (sessions sur ses produits, prix > 0)
        SessionPay sessionPay = new SessionPay(
            c.usdc, address(products), address(registry), address(bond), address(verdict), c.treasury, address(sealedBounty)
        );
        X402Settler x402 = new X402Settler(c.usdc, address(products), address(registry), address(bond), c.treasury);

        // câblage des droits, UNE fois, par la clé de déploiement (aucune caution déposée à ce stade)
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
            module: address(module),
            products: address(products),
            bond: address(bond),
            registry: address(registry),
            verdict: address(verdict),
            sessionPay: address(sessionPay),
            sealedBounty: address(sealedBounty),
            x402: address(x402)
        });
    }

    function _log(Config memory c, Deployed memory d) internal pure {
        console2.log("TIMELOCK (s)        ", uint256(c.timelock));
        console2.log("VALIDITY_BLOCKS     ", uint256(c.validityBlocks));
        console2.log("GRACE_BLOCKS        ", uint256(c.graceBlocks));
        console2.log("BLOCK_TIME_MS       ", uint256(c.blockTimeMs));
        console2.log("REQUIRE_SEPT_VE     ", c.requireSeptVe);
        console2.log("OWNER (multisig)    ", c.owner);
        console2.log("TdxAttestationModule", d.module);
        console2.log("ProductRegistry     ", d.products);
        console2.log("OperatorBond        ", d.bond);
        console2.log("EnclaveRegistry     ", d.registry);
        console2.log("VerdictLog          ", d.verdict);
        console2.log("SessionPay          ", d.sessionPay);
        console2.log("SealedBounty        ", d.sealedBounty);
        console2.log("X402Settler         ", d.x402);
    }
}
