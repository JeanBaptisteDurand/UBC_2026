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

/// @notice The deployment scripts. Mainnet defaults (TIMELOCK 48 h, never 300 s again; SEPT_VE required; validity
///         and grace ≈ 24 h in blocks), complete wiring, and guardrails (a short timelock is refused on mainnet,
///         a missing DCAP verifier is refused, the testnet script with its simulated module is refused on mainnet).
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
        vm.etch(dcap, hex"00"); // a DCAP verifier that is "present": code at the address
        vm.etch(treasury, hex"00"); // multisigs: code at the address
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

    /// The mainnet script defaults are the values documented in deploy/mainnet.env.example.
    function test_mainnetDefaults() public {
        Deploy s = new Deploy();
        assertEq(s.DEFAULT_TIMELOCK(), 172_800, "48 h, never 300 s again");
        assertEq(s.DEFAULT_NETWORK_BOUNTY_BPS(), 1000);
        assertEq(s.DEFAULT_OPERATOR_BOUNTY_BPS(), 500);
        assertTrue(s.DEFAULT_REQUIRE_SEPT_VE());
        assertEq(s.DEFAULT_VALIDITY_BLOCKS(), 170_000);
        assertEq(s.DEFAULT_GRACE_BLOCKS(), 170_000);
        assertEq(s.DEFAULT_BLOCK_TIME_MS(), 508);
    }

    /// Mainnet deployment with the defaults: parameters passed through, permissions wired.
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
        // governance is the multisig; wiring is done once, then locked; SessionPay bills the bounty attempts
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

    /// Mainnet script guardrails: the old 300 s default is refused on Arc mainnet, and so is a missing DCAP verifier.
    function test_mainnetGuards() public {
        vm.chainId(ARC_MAINNET);
        Deploy s = new Deploy();
        Deploy.Config memory shortLock = _mainnetDefaults(s);
        shortLock.timelock = 300;
        Deploy.Config memory noDcap = _mainnetDefaults(s);
        noDcap.dcap = makeAddr("dcap-absent");

        vm.expectRevert(bytes("TIMELOCK below 48 h is refused on Arc mainnet"));
        s.check(shortLock);

        vm.expectRevert(bytes("DCAP: no code at this address (deploy Automata DCAP first)"));
        s.check(noDcap);

        // on Arc mainnet, TREASURY and OWNER are multisigs (contract code) and ERC-8004 is present
        Deploy.Config memory eoaTreasury = _mainnetDefaults(s);
        eoaTreasury.treasury = makeAddr("single-key");
        vm.expectRevert(bytes("TREASURY must be a multisig (contract code) on Arc mainnet"));
        s.check(eoaTreasury);
        Deploy.Config memory eoaOwner = _mainnetDefaults(s);
        eoaOwner.owner = makeAddr("deployer-key");
        vm.expectRevert(bytes("OWNER must be a multisig (contract code) on Arc mainnet"));
        s.check(eoaOwner);
        Deploy.Config memory noValidation = _mainnetDefaults(s);
        noValidation.validation = makeAddr("validation-absent");
        vm.expectRevert(bytes("ERC8004_VALIDATION: no code at this address"));
        s.check(noValidation);

        // outside mainnet, a short timelock stays possible (rehearsing the deployment on testnet)
        vm.chainId(ARC_TESTNET);
        s.check(shortLock);
    }

    /// Testnet script defaults. REQUIRE_SEPT_VE is 1, as in the stacks deployed on Arc testnet
    /// (deployments.v2.testnet.json and deployments.v21.testnet.json: "REQUIRE_SEPT_VE = 1"); with a default of 0,
    /// forgetting the variable would redeploy a registry that accepts enclaves without SEPT_VE_DISABLE.
    function test_testnetDefaults() public {
        DeployTestnet s = new DeployTestnet();
        assertTrue(s.DEFAULT_REQUIRE_SEPT_VE(), "SEPT_VE_DISABLE required by default");
        assertEq(s.DEFAULT_ATTESTATION_MODULE(), 0x26C1803dE523aC896Ba7F1787f1401ec792951ca);
        assertEq(s.DEFAULT_TIMELOCK(), 0);
        assertEq(s.DEFAULT_NETWORK_BOUNTY_BPS(), 1000);
        assertEq(s.DEFAULT_OPERATOR_BOUNTY_BPS(), 500);
        assertEq(s.DEFAULT_VALIDITY_BLOCKS(), 170_000);
        assertEq(s.DEFAULT_GRACE_BLOCKS(), 170_000);
        assertEq(s.DEFAULT_BLOCK_TIME_MS(), 509);
    }

    /// The testnet script (which can deploy the simulated attestation module) is refused on Arc mainnet; on testnet it
    /// deploys the stack with its testnet defaults.
    function test_testnetScript() public {
        DeployTestnet s = new DeployTestnet();
        DeployTestnet.Config memory c = _testnetDefaults(s);

        vm.chainId(ARC_MAINNET);
        vm.expectRevert(
            bytes("DeployTestnet is refused on Arc mainnet: it can deploy a simulated attestation module (use Deploy.s.sol)")
        );
        s.check(c);

        vm.chainId(ARC_TESTNET);
        s.check(c);
        DeployTestnet.Deployed memory d = s.deploy(c);
        assertEq(ProductRegistry(d.products).timelock(), 0);
        EnclaveRegistry r = EnclaveRegistry(d.registry);
        // by default, the REAL attestation module (DCAP) already deployed on Arc testnet
        assertEq(s.DEFAULT_ATTESTATION_MODULE(), 0x26C1803dE523aC896Ba7F1787f1401ec792951ca);
        assertEq(address(r.module()), realModule);
        assertEq(d.module, realModule);
        assertEq(r.VALIDITY_BLOCKS(), 170_000);
        assertEq(r.GRACE_BLOCKS(), 170_000);
        assertEq(r.BLOCK_TIME_MS(), 509);
        assertTrue(r.requireSeptVeDisable(), "SEPT_VE_DISABLE required by default");
        assertTrue(OperatorBond(d.bond).isSettlement(d.x402));
        assertTrue(d.demoVault.code.length > 0);

        // a missing module is refused; the simulated module only on explicit request (demo)
        DeployTestnet.Config memory noModule = _testnetDefaults(s);
        noModule.module = makeAddr("module-absent");
        vm.expectRevert(bytes("ATTESTATION_MODULE: no code at this address"));
        s.check(noModule);
        DeployTestnet.Config memory demo = _testnetDefaults(s);
        demo.mockAttestation = true;
        demo.module = address(0);
        s.check(demo);
        DeployTestnet.Deployed memory dd = s.deploy(demo);
        assertTrue(dd.module != realModule && dd.module.code.length > 0, "simulated module deployed");
    }
}
