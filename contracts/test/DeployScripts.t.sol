// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {Deploy} from "../script/Deploy.s.sol";
import {DeployTestnet} from "../script/DeployTestnet.s.sol";
import {MockUSDC3009} from "./mocks/MockUSDC3009.sol";
import {MockIdentityRegistry, MockValidationRegistry} from "./mocks/MockERC8004.sol";

import {EnclaveRegistry} from "../src/EnclaveRegistry.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {VerdictLog} from "../src/VerdictLog.sol";
import {SealedBounty} from "../src/SealedBounty.sol";
import {SessionPay} from "../src/SessionPay.sol";

/// @notice Correction 12 : les scripts de déploiement v2. Défauts mainnet = F-économie §0.1 (TIMELOCK 48 h,
///         plus jamais 300 s ; SEPT_VE exigé ; validité et grâce ≈ 24 h en blocs), câblage complet, et
///         garde-fous (timelock court refusé sur mainnet, DCAP absent refusé, module simulé interdit sur mainnet).
contract DeployScriptsTest is Test {
    uint256 constant ARC_MAINNET = 5042;
    uint256 constant ARC_TESTNET = 5042002;

    MockUSDC3009 usdc;
    MockValidationRegistry validation;
    MockIdentityRegistry identity;
    address treasury = makeAddr("treasury");
    address owner = makeAddr("multisig");
    address dcap = makeAddr("dcap");
    address realModule = makeAddr("tdx-module");

    function setUp() public {
        usdc = new MockUSDC3009();
        validation = new MockValidationRegistry();
        identity = new MockIdentityRegistry();
        vm.etch(dcap, hex"00"); // un vérificateur DCAP « présent » : du code à l'adresse
        vm.etch(treasury, hex"00"); // multisigs : du code à l'adresse
        vm.etch(owner, hex"00");
        vm.etch(realModule, hex"00");
    }

    function _mainnetDefaults(Deploy s) internal view returns (Deploy.Config memory c) {
        c = Deploy.Config({
            usdc: address(usdc),
            dcap: dcap,
            validation: address(validation),
            identity: address(identity),
            treasury: treasury,
            owner: owner,
            timelock: s.DEFAULT_TIMELOCK(),
            networkBountyBps: s.DEFAULT_NETWORK_BOUNTY_BPS(),
            operatorBountyBps: s.DEFAULT_OPERATOR_BOUNTY_BPS(),
            requireSeptVe: s.DEFAULT_REQUIRE_SEPT_VE(),
            validityBlocks: s.DEFAULT_VALIDITY_BLOCKS(),
            graceBlocks: s.DEFAULT_GRACE_BLOCKS(),
            blockTimeMs: s.DEFAULT_BLOCK_TIME_MS()
        });
    }

    function _testnetDefaults(DeployTestnet s) internal view returns (DeployTestnet.Config memory c) {
        c = DeployTestnet.Config({
            usdc: address(usdc),
            validation: address(validation),
            identity: address(identity),
            treasury: treasury,
            owner: owner,
            module: realModule,
            mockAttestation: false,
            timelock: s.DEFAULT_TIMELOCK(),
            networkBountyBps: s.DEFAULT_NETWORK_BOUNTY_BPS(),
            operatorBountyBps: s.DEFAULT_OPERATOR_BOUNTY_BPS(),
            requireSeptVe: s.DEFAULT_REQUIRE_SEPT_VE(),
            validityBlocks: s.DEFAULT_VALIDITY_BLOCKS(),
            graceBlocks: s.DEFAULT_GRACE_BLOCKS(),
            blockTimeMs: s.DEFAULT_BLOCK_TIME_MS()
        });
    }

    /// Les défauts du script mainnet sont les valeurs de F-économie §0.1 et de deploy/mainnet.env.example.
    function test_mainnetDefaults() public {
        Deploy s = new Deploy();
        assertEq(s.DEFAULT_TIMELOCK(), 172_800, "48 h, plus jamais 300 s");
        assertEq(s.DEFAULT_NETWORK_BOUNTY_BPS(), 1000);
        assertEq(s.DEFAULT_OPERATOR_BOUNTY_BPS(), 500);
        assertTrue(s.DEFAULT_REQUIRE_SEPT_VE());
        assertEq(s.DEFAULT_VALIDITY_BLOCKS(), 170_000);
        assertEq(s.DEFAULT_GRACE_BLOCKS(), 170_000);
        assertEq(s.DEFAULT_BLOCK_TIME_MS(), 508);
    }

    /// Déploiement mainnet avec les défauts : paramètres v2 transmis, droits câblés.
    function test_mainnetDeployWiresV2() public {
        vm.chainId(ARC_MAINNET);
        Deploy s = new Deploy();
        Deploy.Config memory c = _mainnetDefaults(s);
        s.check(c);
        Deploy.Deployed memory d = s.deploy(c);

        assertEq(ProductRegistry(d.products).timelock(), 172_800);
        EnclaveRegistry r = EnclaveRegistry(d.registry);
        assertEq(r.VALIDITY_BLOCKS(), 170_000);
        assertEq(r.GRACE_BLOCKS(), 170_000);
        assertEq(r.BLOCK_TIME_MS(), 508);
        assertTrue(r.requireSeptVeDisable());
        assertEq(address(r.module()), d.module);
        assertEq(address(r.products()), d.products);
        assertEq(address(r.bond()), d.bond);

        OperatorBond b = OperatorBond(d.bond);
        assertTrue(b.isSettlement(d.sessionPay));
        assertTrue(b.isSettlement(d.sealedBounty));
        assertTrue(b.isSettlement(d.x402));
        assertEq(b.treasury(), treasury);
        // v2 bis : gouvernance = le multisig ; câblage fait une fois, verrouillé ; SessionPay facture les tentatives
        assertEq(b.owner(), owner);
        assertTrue(b.initialized());
        assertEq(b.registry(), d.registry);
        assertEq(address(b.identity()), address(identity));
        assertEq(VerdictLog(d.verdict).owner(), owner);
        assertTrue(VerdictLog(d.verdict).initialized());
        assertEq(SessionPay(d.sessionPay).attemptsFor(), d.sealedBounty);
        assertTrue(VerdictLog(d.verdict).isCaller(d.sessionPay));
        assertTrue(VerdictLog(d.verdict).isCaller(d.sealedBounty));
        assertEq(SealedBounty(d.sealedBounty).networkBountyBps(), 1000);
        assertEq(SealedBounty(d.sealedBounty).operatorBountyBps(), 500);
    }

    /// Garde-fous du script mainnet : l'ancien défaut de 300 s est refusé sur Arc mainnet, un DCAP absent aussi.
    function test_mainnetGuards() public {
        vm.chainId(ARC_MAINNET);
        Deploy s = new Deploy();
        Deploy.Config memory shortLock = _mainnetDefaults(s);
        shortLock.timelock = 300;
        Deploy.Config memory noDcap = _mainnetDefaults(s);
        noDcap.dcap = makeAddr("dcap-absent");

        vm.expectRevert(bytes(unicode"TIMELOCK < 48 h refusé sur Arc mainnet"));
        s.check(shortLock);

        vm.expectRevert(bytes(unicode"DCAP : aucun code à cette adresse (déployer Automata DCAP d'abord)"));
        s.check(noDcap);

        // v2 bis : sur Arc mainnet, TREASURY et OWNER sont des multisigs (du code), ERC-8004 est présent
        Deploy.Config memory eoaTreasury = _mainnetDefaults(s);
        eoaTreasury.treasury = makeAddr("une-seule-cle");
        vm.expectRevert(bytes(unicode"TREASURY : un multisig (du code) est exigé sur Arc mainnet"));
        s.check(eoaTreasury);
        Deploy.Config memory eoaOwner = _mainnetDefaults(s);
        eoaOwner.owner = makeAddr("cle-de-deploiement");
        vm.expectRevert(bytes(unicode"OWNER : un multisig (du code) est exigé sur Arc mainnet"));
        s.check(eoaOwner);
        Deploy.Config memory noValidation = _mainnetDefaults(s);
        noValidation.validation = makeAddr("validation-absente");
        vm.expectRevert(bytes(unicode"ERC8004_VALIDATION : aucun code à cette adresse"));
        s.check(noValidation);

        // hors mainnet, un timelock court reste possible (répétition du déploiement sur testnet)
        vm.chainId(ARC_TESTNET);
        s.check(shortLock);
    }

    /// v2.1 ter : les défauts du script testnet. REQUIRE_SEPT_VE vaut 1, comme la pile v2 déployée le 7/11
    /// (deployments.v2.testnet.json : « REQUIRE_SEPT_VE = 1 ») ; v2.1 bis : 0, et un oubli de la variable redéployait
    /// un registre qui accepte des enclaves sans SEPT_VE_DISABLE.
    function test_testnetDefaults() public {
        DeployTestnet s = new DeployTestnet();
        assertTrue(s.DEFAULT_REQUIRE_SEPT_VE(), "SEPT_VE_DISABLE exige par defaut");
        assertEq(s.DEFAULT_ATTESTATION_MODULE(), 0x26C1803dE523aC896Ba7F1787f1401ec792951ca);
        assertEq(s.DEFAULT_TIMELOCK(), 0);
        assertEq(s.DEFAULT_NETWORK_BOUNTY_BPS(), 1000);
        assertEq(s.DEFAULT_OPERATOR_BOUNTY_BPS(), 500);
        assertEq(s.DEFAULT_VALIDITY_BLOCKS(), 170_000);
        assertEq(s.DEFAULT_GRACE_BLOCKS(), 170_000);
        assertEq(s.DEFAULT_BLOCK_TIME_MS(), 509);
    }

    /// Le script testnet (module d'attestation SIMULÉ) est interdit sur Arc mainnet ; sur testnet il déploie
    /// la pile v2 avec ses défauts de démonstration.
    function test_testnetScript() public {
        DeployTestnet s = new DeployTestnet();
        DeployTestnet.Config memory c = _testnetDefaults(s);

        vm.chainId(ARC_MAINNET);
        vm.expectRevert(
            bytes(unicode"DeployTestnet : module d'attestation SIMULÉ, interdit sur Arc mainnet (utiliser Deploy.s.sol)")
        );
        s.check(c);

        vm.chainId(ARC_TESTNET);
        s.check(c);
        DeployTestnet.Deployed memory d = s.deploy(c);
        assertEq(ProductRegistry(d.products).timelock(), 0);
        EnclaveRegistry r = EnclaveRegistry(d.registry);
        // v2 bis : par défaut, le VRAI module d'attestation (DCAP) déjà déployé sur Arc testnet
        assertEq(s.DEFAULT_ATTESTATION_MODULE(), 0x26C1803dE523aC896Ba7F1787f1401ec792951ca);
        assertEq(address(r.module()), realModule);
        assertEq(d.module, realModule);
        assertEq(r.VALIDITY_BLOCKS(), 170_000);
        assertEq(r.GRACE_BLOCKS(), 170_000);
        assertEq(r.BLOCK_TIME_MS(), 509);
        assertTrue(r.requireSeptVeDisable(), "v2.1 ter : SEPT_VE_DISABLE exige par defaut");
        assertTrue(OperatorBond(d.bond).isSettlement(d.x402));
        assertTrue(d.demoVault.code.length > 0);

        // module absent : refusé ; module SIMULÉ seulement sur demande explicite (démonstration)
        DeployTestnet.Config memory noModule = _testnetDefaults(s);
        noModule.module = makeAddr("module-absent");
        vm.expectRevert(bytes(unicode"ATTESTATION_MODULE : aucun code à cette adresse"));
        s.check(noModule);
        DeployTestnet.Config memory demo = _testnetDefaults(s);
        demo.mockAttestation = true;
        demo.module = address(0);
        s.check(demo);
        DeployTestnet.Deployed memory dd = s.deploy(demo);
        assertTrue(dd.module != realModule && dd.module.code.length > 0, "module simule deploye");
    }
}
