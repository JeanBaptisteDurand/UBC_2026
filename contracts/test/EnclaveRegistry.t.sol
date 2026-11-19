// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {EnclaveRegistry} from "../src/EnclaveRegistry.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {IEnclaveRegistry} from "../src/interfaces/IEnclaveRegistry.sol";
import {IAttestationModule} from "../src/interfaces/IAttestationModule.sol";
import {History} from "../src/lib/History.sol";

contract EnclaveRegistryTest is Base {
    uint256 productId;

    function setUp() public override {
        super.setUp();
        _bondOperator(opPk, 1000e6);
        productId = _proposeAndActivate(address(sessionPay), false, bytes32("model"), 1e6, 100e6, 100_000e6);
    }

    function test_register_positive() public {
        (address signer,) = _registerEnclave(productId, opPk, signerPk, "s1");
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(signer);
        assertEq(e.operator, operator);
        assertEq(e.productId, productId);
        assertTrue(e.active);
        assertTrue(registry.isActiveAt(signer, productId, block.number));
        assertFalse(registry.isActiveAt(signer, productId + 1, block.number));
    }

    function test_register_revertDebug() public {
        bytes32 x = keccak256("x");
        uint256 r = block.number - 1;
        bytes memory quote = abi.encodePacked("q-debug");
        IAttestationModule.Measurements memory m = _measurements(productId, operator, vm.addr(signerPk), x, r, true);
        module.setMeasurements(quote, m);
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.DebugEnclave.selector);
        registry.registerEnclave(productId, quote, r, vm.addr(signerPk), x, "");
    }

    function test_register_revertUnknownWorkload() public {
        bytes32 x = keccak256("x");
        uint256 r = block.number - 1;
        bytes memory quote = abi.encodePacked("q-wl");
        IAttestationModule.Measurements memory m = _measurements(productId, operator, vm.addr(signerPk), x, r, false);
        m.mrtd = _b48("EVIL"); // changes the workloadId
        module.setMeasurements(quote, m);
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.WorkloadNotAllowed.selector);
        registry.registerEnclave(productId, quote, r, vm.addr(signerPk), x, "");
    }

    function test_register_revertReportDataMismatch() public {
        bytes32 x = keccak256("x");
        uint256 r = block.number - 1;
        bytes memory quote = abi.encodePacked("q-rd");
        // measurements bound to operator2, but operator is the caller
        IAttestationModule.Measurements memory m = _measurements(productId, operator2, vm.addr(signerPk), x, r, false);
        module.setMeasurements(quote, m);
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.ReportDataMismatch.selector);
        registry.registerEnclave(productId, quote, r, vm.addr(signerPk), x, "");
    }

    function test_register_revertAnchorHashMismatch() public {
        bytes32 x = keccak256("x");
        uint256 r = block.number - 1;
        bytes memory quote = abi.encodePacked("q-anchor");
        IAttestationModule.Measurements memory m = _measurements(productId, operator, vm.addr(signerPk), x, r, false);
        module.setMeasurements(quote, m);
        vm.prank(operator);
        // anchored on ANOTHER block than the measurements' block -> different hash
        vm.expectRevert(EnclaveRegistry.AnchorHashMismatch.selector);
        registry.registerEnclave(productId, quote, r - 1, vm.addr(signerPk), x, "");
    }

    function test_register_revertAnchorTooOld() public {
        vm.roll(20000);
        bytes32 x = keccak256("x");
        uint256 r = 1000; // 20000 - 1000 = 19000 > 8191
        bytes memory quote = abi.encodePacked("q-old");
        IAttestationModule.Measurements memory m = _measurements(productId, operator, vm.addr(signerPk), x, r, false);
        module.setMeasurements(quote, m);
        vm.prank(operator);
        vm.expectRevert(History.AnchorTooOld.selector);
        registry.registerEnclave(productId, quote, r, vm.addr(signerPk), x, "");
    }

    function test_register_revertQuoteReused() public {
        (, bytes memory quote) = _registerEnclave(productId, opPk, signerPk, "s1");
        // reuse the same quote
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.QuoteReused.selector);
        registry.registerEnclave(productId, quote, block.number - 1, vm.addr(signer2Pk), keccak256("x2"), "");
    }

    function test_register_revertUnderbonded() public {
        // operator2 has posted no bond
        bytes32 x = keccak256("x2");
        uint256 r = block.number - 1;
        bytes memory quote = abi.encodePacked("q-nobond");
        IAttestationModule.Measurements memory m = _measurements(productId, operator2, vm.addr(signer2Pk), x, r, false);
        module.setMeasurements(quote, m);
        vm.prank(operator2);
        vm.expectRevert(EnclaveRegistry.OperatorUnderbonded.selector);
        registry.registerEnclave(productId, quote, r, vm.addr(signer2Pk), x, "");
    }

    function test_invalidate_whenCollateralFails() public {
        (address signer, bytes memory quote) = _registerEnclave(productId, opPk, signerPk, "s1");
        assertTrue(registry.isActiveAt(signer, productId, block.number));

        // the current collateral no longer validates this quote
        IAttestationModule.Measurements memory bad; // ok == false
        module.setMeasurements(quote, bad);

        registry.invalidate(signer, quote); // open to anyone
        assertFalse(registry.enclaveOf(signer).active);
        assertFalse(registry.isActiveAt(signer, productId, block.number));
    }

    function test_invalidate_revertStillValid() public {
        (address signer, bytes memory quote) = _registerEnclave(productId, opPk, signerPk, "s1");
        vm.expectRevert(EnclaveRegistry.StillValid.selector);
        registry.invalidate(signer, quote);
    }

    function test_retire() public {
        // registered at block 1000 (see setUp). Explicit block numbers: the optimizer folds block.number.
        (address signer,) = _registerEnclave(productId, opPk, signerPk, "s1");
        vm.roll(1010);
        vm.prank(operator);
        registry.retire(signer); // deactivatedAtBlock = 1010
        // active for receipts from before the retirement, inactive from the retirement on
        assertTrue(registry.isActiveAt(signer, productId, 1005));
        assertFalse(registry.isActiveAt(signer, productId, 1010));
    }

    // =====================================================================================
    // Negative tests: registration, REPORTDATA binding, replay, expiry.
    // Current block = 1000 after setUp; block numbers are literals (the optimizer folds block.number).
    // The `test_FIXED_*` tests replay the cases of the adversarial review, fixed in src (the
    // test proves the correct behaviour). Validity in blocks: window [1000, 5999], grace until block 9999.
    // =====================================================================================

    /// @dev Valid measurements whose REPORTDATA[0:32] binds a CHOSEN chainId and registry.
    function _measurementsBoundTo(
        uint256 chainId_,
        address registry_,
        uint256 pid,
        address op,
        address signer,
        bytes32 x25519,
        uint256 r
    ) internal view returns (IAttestationModule.Measurements memory m) {
        m = _measurements(pid, op, signer, x25519, r, false);
        bytes32 rd0 = keccak256(abi.encode("ARC-ENCLAVE-v1", chainId_, registry_, pid, op, signer, x25519));
        m.reportData = abi.encodePacked(rd0, keccak256(abi.encodePacked(bytes32(r))));
    }

    function _x25519Of(bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("x25519", salt)); // same derivation as _registerEnclave
    }

    /// Threat "another chainId in REPORTDATA": a quote bound to another chain (here Arc mainnet) is rejected.
    function test_register_revertWrongChainIdInReportData() public {
        address s = vm.addr(signerPk);
        bytes32 x = keccak256("x");
        uint256 otherChain = block.chainid == 5042 ? 5042002 : 5042;
        bytes memory quote = abi.encodePacked("q-chain");
        module.setMeasurements(
            quote, _measurementsBoundTo(otherChain, address(registry), productId, operator, s, x, 999)
        );
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.ReportDataMismatch.selector);
        registry.registerEnclave(productId, quote, 999, s, x, "");
    }

    /// Threat "another registry in REPORTDATA": a quote bound to another deployment is only valid there.
    function test_register_revertWrongRegistryInReportData() public {
        // another deployment: its own bond, wired to its own registry
        OperatorBond otherBond = new OperatorBond(address(usdc), treasury, address(this), address(identity));
        EnclaveRegistry other = new EnclaveRegistry(
            address(module),
            address(products),
            address(otherBond),
            false,
            TEST_VALIDITY_BLOCKS,
            TEST_GRACE_BLOCKS,
            TEST_BLOCK_TIME_MS
        );
        otherBond.initialize(address(other), new address[](0));
        vm.startPrank(operator);
        usdc.approve(address(otherBond), 1000e6);
        otherBond.bondFrom(1000e6);
        vm.stopPrank();
        address s = vm.addr(signerPk);
        bytes32 x = keccak256("x");
        bytes memory quote = abi.encodePacked("q-registry");
        module.setMeasurements(
            quote, _measurementsBoundTo(block.chainid, address(other), productId, operator, s, x, 999)
        );

        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.ReportDataMismatch.selector);
        registry.registerEnclave(productId, quote, 999, s, x, "");

        // counter-check: the same quote passes on the registry it is bound to
        vm.prank(operator);
        other.registerEnclave(productId, quote, 999, s, x, "");
        assertEq(other.enclaveOf(s).operator, operator);
        assertEq(registry.enclaveOf(s).operator, address(0));
    }

    /// The operator cannot substitute ITS signing key or ITS X25519 key for the enclave's keys.
    function test_register_revertSignerOrX25519Substitution() public {
        address enclaveKey = vm.addr(signerPk);
        address operatorKey = vm.addr(0xBADC0DE);
        bytes32 x = keccak256("x");
        bytes memory quote = abi.encodePacked("q-subst");
        module.setMeasurements(quote, _measurements(productId, operator, enclaveKey, x, 999, false));

        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.ReportDataMismatch.selector);
        registry.registerEnclave(productId, quote, 999, operatorKey, x, "");

        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.ReportDataMismatch.selector);
        registry.registerEnclave(productId, quote, 999, enclaveKey, keccak256("x-operateur"), "");
    }

    /// A quote bound to product A cannot register the enclave on product B (same allowed image).
    function test_register_revertProductSubstitution() public {
        uint256 otherPid = _proposeAndActivate(address(sessionPay), false, bytes32("model2"), 1e6, 100e6, 100_000e6);
        address s = vm.addr(signerPk);
        bytes32 x = keccak256("x");
        bytes memory quote = abi.encodePacked("q-product");
        module.setMeasurements(quote, _measurements(productId, operator, s, x, 999, false));
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.ReportDataMismatch.selector);
        registry.registerEnclave(otherPid, quote, 999, s, x, "");
    }

    /// Threat "replayed quote": an invalidated enclave does not come back by replaying its old quote,
    /// even if the collateral becomes valid again.
    function test_register_revertQuoteReplayAfterInvalidation() public {
        (address s, bytes memory quote) = _registerEnclave(productId, opPk, signerPk, "s1"); // R = 999
        IAttestationModule.Measurements memory good = _measurements(productId, operator, s, _x25519Of("s1"), 999, false);
        IAttestationModule.Measurements memory bad; // ok == false
        module.setMeasurements(quote, bad);
        registry.invalidate(s, quote);
        assertFalse(registry.enclaveOf(s).active);

        module.setMeasurements(quote, good);
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.QuoteReused.selector);
        registry.registerEnclave(productId, quote, 999, s, _x25519Of("s1"), "");
        assertFalse(registry.isActiveAt(s, productId, 1000));
    }

    /// Threat "stale quote" (bounds): R = current block is rejected (EIP-2935 only serves past blocks).
    function test_register_revertAnchorNotYetInHistory() public {
        address s = vm.addr(signerPk);
        bytes32 x = keccak256("x");
        bytes memory quote = abi.encodePacked("q-now");
        module.setMeasurements(quote, _measurements(productId, operator, s, x, 1000, false));
        vm.prank(operator);
        vm.expectRevert(History.AnchorTooOld.selector);
        registry.registerEnclave(productId, quote, 1000, s, x, ""); // 1000 = current block
    }

    /// Threat "stale quote" (bounds): a gap of 8,192 blocks is rejected, 8,191 is accepted.
    function test_register_anchorWindowBoundary() public {
        address s = vm.addr(signerPk);
        bytes32 x = keccak256("x");

        vm.roll(9192); // 9192 - 1000 = 8192 > 8191
        bytes memory q1 = abi.encodePacked("q-8192");
        module.setMeasurements(q1, _measurements(productId, operator, s, x, 1000, false));
        vm.prank(operator);
        vm.expectRevert(History.AnchorTooOld.selector);
        registry.registerEnclave(productId, q1, 1000, s, x, "");

        vm.roll(9191); // 9191 - 1000 = 8191: last block of the window
        bytes memory q2 = abi.encodePacked("q-8191");
        module.setMeasurements(q2, _measurements(productId, operator, s, x, 1000, false));
        vm.prank(operator);
        registry.registerEnclave(productId, q2, 1000, s, x, "");
        assertTrue(registry.enclaveOf(s).active);
    }

    /// @dev Re-registers `signerPk_` for (`pid`, `opPk_`), with a fresh quote anchored at block `r` (literal).
    function _reRegister(uint256 pid, uint256 opPk_, uint256 signerPk_, bytes32 salt, bytes memory quote, uint256 r)
        internal
    {
        address op = vm.addr(opPk_);
        address s = vm.addr(signerPk_);
        module.setMeasurements(quote, _measurements(pid, op, s, _x25519Of(salt), r, false));
        vm.prank(op);
        registry.registerEnclave(pid, quote, r, s, _x25519Of(salt), "");
    }

    /// Threat "expired enclave" (in blocks): registered at block 1000 → window [1000, 5999]; the grace period
    /// (until block 9999) only settles receipts anchored INSIDE the window; beyond it, nothing.
    function test_isActiveAt_windowAndGrace() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // block 1000
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(s);
        assertEq(e.fromBlock, 1000);
        assertEq(e.untilBlock, 5999); // 1000 + 5,000 − 1: exactly VALIDITY_BLOCKS blocks
        assertEq(registry.VALIDITY_BLOCKS(), TEST_VALIDITY_BLOCKS);
        assertEq(registry.GRACE_BLOCKS(), TEST_GRACE_BLOCKS);

        vm.roll(9999); // last block of the grace period
        assertTrue(registry.isActiveAt(s, productId, 1000));
        assertTrue(registry.isActiveAt(s, productId, 5999));
        assertFalse(registry.isActiveAt(s, productId, 999)); // before registration
        assertFalse(registry.isActiveAt(s, productId, 6000)); // after the window
        assertEq(registry.activeOperatorAt(s, productId, 5999), operator);

        vm.roll(10_000); // grace period over
        assertFalse(registry.isActiveAt(s, productId, 1000));
        assertFalse(registry.isActiveAt(s, productId, 5999));
        assertEq(registry.activeOperatorAt(s, productId, 5999), address(0));
    }

    /// FIXED (adversarial review; specification: "true if the enclave was active at that block"; "enclave expired at
    /// the anchor block: rejected"). An EXPIRED enclave that has not re-attested is no longer "active" for blocks
    /// produced AFTER its expiry, even during the grace period: real validity = VALIDITY_BLOCKS, not twice that.
    function test_FIXED_expiredEnclaveNotActiveForBlocksAfterExpiry() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // window [1000, 5999]
        vm.warp(vm.getBlockTimestamp() + 25 hours);
        vm.roll(7000); // expired 1,000 blocks ago, inside the grace period (until block 9999)
        assertTrue(registry.isActiveAt(s, productId, 1000), "grace : un bloc de la fenetre reste reglable (voulu)");
        assertFalse(registry.isActiveAt(s, productId, 6000), "bloc posterieur a l'expiration : jamais actif");
        assertFalse(registry.isActiveAt(s, productId, 7000), "bloc posterieur a l'expiration : jamais actif");
    }

    /// FIXED (adversarial review): re-attestation by the same operator (`operator renew`, every ≈ 24 h) EXTENDS
    /// the current window instead of replacing it: receipts and claims anchored before the renewal
    /// stay payable.
    function test_FIXED_renewalKeepsReceiptsAnchoredBeforeRenewal() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // block 1000, R = 999
        vm.roll(1010);
        vm.warp(vm.getBlockTimestamp() + 23 hours); // renewal before expiry
        _reRegister(productId, opPk, signerPk, "s1", abi.encodePacked("quote-renew"), 1009);

        assertTrue(registry.isActiveAt(s, productId, 1010), "apres renouvellement : active");
        assertTrue(registry.isActiveAt(s, productId, 1005), "les blocs anterieurs au renouvellement restent actifs");
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(s);
        assertEq(e.fromBlock, 1000); // the window is extended, not replaced
        assertEq(e.untilBlock, 1010 + TEST_VALIDITY_BLOCKS - 1);
        (, IEnclaveRegistry.Window memory prev) = registry.windowsOf(s);
        assertEq(prev.operator, address(0)); // nothing archived: no window lost
    }

    /// Renewal exactly at the block after the window ends (5999 → 6000): still no gap, extended.
    function test_renewalAtFirstBlockAfterWindowStillExtends() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // [1000, 5999]
        vm.roll(6000);
        _reRegister(productId, opPk, signerPk, "s1", abi.encodePacked("quote-6000"), 5999);
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(s);
        assertEq(e.fromBlock, 1000);
        assertEq(e.untilBlock, 6000 + TEST_VALIDITY_BLOCKS - 1);
        assertTrue(registry.isActiveAt(s, productId, 3000));
        assertTrue(registry.isActiveAt(s, productId, 6000));
    }

    /// History: re-registration AFTER a gap. The past window is kept for its grace period
    /// (its receipts stay payable); the blocks of the gap are never valid; once the grace period is over, nothing.
    function test_reRegistrationAfterGapKeepsPreviousWindowForGrace() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // [1000, 5999]
        vm.roll(7000); // expired; grace period of the 1st window until block 9999
        _reRegister(productId, opPk, signerPk, "s1", abi.encodePacked("quote-gap"), 6999); // [7000, 11999]

        (IEnclaveRegistry.Window memory cur, IEnclaveRegistry.Window memory prev) = registry.windowsOf(s);
        assertEq(cur.fromBlock, 7000);
        assertEq(cur.untilBlock, 11_999);
        assertEq(prev.fromBlock, 1000);
        assertEq(prev.untilBlock, 5999);
        assertEq(prev.operator, operator);

        assertTrue(registry.isActiveAt(s, productId, 3000)); // previous window, in its grace period
        assertFalse(registry.isActiveAt(s, productId, 6500)); // the gap
        assertTrue(registry.isActiveAt(s, productId, 7000));

        vm.roll(10_000); // grace period of the 1st window over
        assertFalse(registry.isActiveAt(s, productId, 3000));
        assertTrue(registry.isActiveAt(s, productId, 7000));
    }

    /// FIXED v2 (adversarial review, medium): a key is bound FOR LIFE to its first (operator, product). Re-registering it
    /// on ANOTHER product (same operator) is refused: a proof of equivocation stays admissible against it.
    function test_FIXED_keyCannotMoveToAnotherProduct() public {
        uint256 pid2 = _proposeAndActivate(address(sessionPay), false, bytes32("model2"), 1e6, 100e6, 100_000e6);
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // produit A : [1000, 5999]
        assertEq(registry.boundOperator(s), operator);
        assertEq(registry.boundProduct(s), productId);
        vm.roll(2000);
        bytes memory q = abi.encodePacked("quote-pid2");
        module.setMeasurements(q, _measurements(pid2, operator, s, _x25519Of("s1"), 1999, false));
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.SignerBoundElsewhere.selector);
        registry.registerEnclave(pid2, q, 1999, s, _x25519Of("s1"), "");
        assertTrue(registry.isActiveAt(s, productId, 1500)); // still on product A
        assertFalse(registry.isActiveAt(s, pid2, 2000));
    }

    /// FIXED (adversarial review, operator-kit scenario): another bonded operator, holding a
    /// real quote that binds ITS address to someone else's enclave keys, cannot take it over while it
    /// is valid or in its grace period (dedicated error).
    function test_FIXED_otherOperatorCannotHijackLiveEnclave() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // inscrite par `operator`
        _bondOperator(op2Pk, 1000e6);
        bytes memory hijackQuote = abi.encodePacked("quote-hijack"); // real quote obtained from /attest with operator2
        module.setMeasurements(hijackQuote, _measurements(productId, operator2, s, _x25519Of("s1"), 999, false));

        vm.prank(operator2);
        vm.expectRevert(
            abi.encodeWithSelector(EnclaveRegistry.EnclaveHeldByOtherOperator.selector, operator, uint256(10_000))
        );
        registry.registerEnclave(productId, hijackQuote, 999, s, _x25519Of("s1"), "");
        assertEq(registry.enclaveOf(s).operator, operator, "l'enclave reste a son operateur");
        assertTrue(registry.isActiveAt(s, productId, 1000));
    }

    /// Bounds: refused during validity AND the grace period (EnclaveHeldByOtherOperator); and AFTER the
    /// grace period too (SignerBoundElsewhere): a sybil never takes over someone else's key.
    function test_takeoverRefusedDuringAndAfterGrace() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // [1000, 5999], held until 9999
        _bondOperator(op2Pk, 1000e6);

        vm.roll(9999); // last block of the grace period: still held
        bytes memory q1 = abi.encodePacked("quote-op2-9999");
        module.setMeasurements(q1, _measurements(productId, operator2, s, _x25519Of("s1"), 9998, false));
        vm.prank(operator2);
        vm.expectRevert(
            abi.encodeWithSelector(EnclaveRegistry.EnclaveHeldByOtherOperator.selector, operator, uint256(10_000))
        );
        registry.registerEnclave(productId, q1, 9998, s, _x25519Of("s1"), "");

        vm.roll(10_000); // grace period over: the key stays bound to `operator`
        bytes memory q2 = abi.encodePacked("quote-op2-10000");
        module.setMeasurements(q2, _measurements(productId, operator2, s, _x25519Of("s1"), 9999, false));
        vm.prank(operator2);
        vm.expectRevert(EnclaveRegistry.SignerBoundElsewhere.selector);
        registry.registerEnclave(productId, q2, 9999, s, _x25519Of("s1"), "");
        assertEq(registry.enclaveOf(s).operator, operator);
        assertEq(registry.activeOperatorAt(s, productId, 10_000), address(0));
    }

    /// After a RETIREMENT, the key stays held during the grace period counted from the retirement; then
    /// it stays bound to its operator (no takeover).
    function test_takeoverAfterRetireRefused() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1");
        vm.roll(1010);
        vm.prank(operator);
        registry.retire(s); // window cut at 1009, held until 1009 + 4,000 = 5009
        assertEq(registry.enclaveOf(s).untilBlock, 1009);
        _bondOperator(op2Pk, 1000e6);

        vm.roll(5009);
        bytes memory q1 = abi.encodePacked("quote-op2-5009");
        module.setMeasurements(q1, _measurements(productId, operator2, s, _x25519Of("s1"), 5008, false));
        vm.prank(operator2);
        vm.expectRevert(
            abi.encodeWithSelector(EnclaveRegistry.EnclaveHeldByOtherOperator.selector, operator, uint256(5010))
        );
        registry.registerEnclave(productId, q1, 5008, s, _x25519Of("s1"), "");

        vm.roll(5010);
        bytes memory q2 = abi.encodePacked("quote-op2-5010");
        module.setMeasurements(q2, _measurements(productId, operator2, s, _x25519Of("s1"), 5009, false));
        vm.prank(operator2);
        vm.expectRevert(EnclaveRegistry.SignerBoundElsewhere.selector);
        registry.registerEnclave(productId, q2, 5009, s, _x25519Of("s1"), "");
        assertEq(registry.enclaveOf(s).operator, operator);
    }

    /// FIXED v2 (adversarial review, high): retiring a faulty image invalidates its enclaves WITHOUT grace, with or without
    /// a quote; the key can no longer re-register; its reserved bond is released.
    function test_FIXED_retiredWorkloadKillsEnclaveWithoutGrace() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1");
        vm.expectRevert(EnclaveRegistry.StillValid.selector);
        registry.invalidateRetiredWorkload(s); // image still allowed
        assertEq(bond.reservedFor(s), 100e6);

        vm.roll(1500);
        products.retireWorkload(productId, _workloadId()); // the author (this contract) retires the image
        registry.invalidateRetiredWorkload(s); // open to anyone, without a quote
        assertTrue(registry.killed(s));
        assertFalse(registry.isActiveAt(s, productId, 1200), "plus rien ne se regle, meme ancre avant");
        assertEq(registry.settleableUntilBlock(s), 0);
        assertEq(bond.reservedFor(s), 0);

        // the image is allowed again (timelock): the killed key does not come back
        products.proposeWorkload(productId, _workloadId());
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.applyWorkload(productId, _workloadId());
        bytes memory q2 = abi.encodePacked("quote-revive");
        module.setMeasurements(q2, _measurements(productId, operator, s, _x25519Of("s1"), 1499, false));
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.EnclaveKilled.selector);
        registry.registerEnclave(productId, q2, 1499, s, _x25519Of("s1"), "");
    }

    /// invalidate(signer, quote) follows the same rule when the image is retired (no grace).
    function test_invalidateWithQuoteKillsRetiredWorkload() public {
        (address s, bytes memory quote) = _registerEnclave(productId, opPk, signerPk, "s1");
        products.retireWorkload(productId, _workloadId());
        registry.invalidate(s, quote);
        assertTrue(registry.killed(s));
        assertEq(registry.activeOperatorAt(s, productId, 1000), address(0));
    }

    /// Last payable block of a key = end of window + grace (used to close a session earlier).
    function test_settleableUntilBlock() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // [1000, 5999]
        assertEq(registry.settleableUntilBlock(s), 5999 + TEST_GRACE_BLOCKS);
        vm.roll(1010);
        vm.prank(operator);
        registry.retire(s); // cut at 1009
        assertEq(registry.settleableUntilBlock(s), 1009 + TEST_GRACE_BLOCKS);
        assertEq(registry.settleableUntilBlock(makeAddr("inconnue")), 0);
    }

    /// `expiresAt` is an INDICATIVE timestamp (display, renewal planning): registration
    /// + VALIDITY_BLOCKS × BLOCK_TIME_MS; the rule is in blocks.
    function test_expiresAtIsIndicativeFromBlocks() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1");
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(s);
        assertEq(e.expiresAt, e.registeredAt + uint64(uint256(TEST_VALIDITY_BLOCKS) * TEST_BLOCK_TIME_MS / 1000));
        assertTrue(e.active);
    }

    /// Arc values (measured on 2026-11-07: ≈ 508 ms per block on mainnet and testnet): 170,000 blocks ≈ 24 h.
    function test_arcValuesSpan24Hours() public {
        EnclaveRegistry arc = new EnclaveRegistry(
            address(module), address(products), address(bond), true, 170_000, 170_000, 508
        );
        assertEq(arc.VALIDITY_BLOCKS(), 170_000);
        assertEq(arc.GRACE_BLOCKS(), 170_000);
        assertTrue(arc.requireSeptVeDisable());
        // 170 000 × 0,508 s = 86 360 s ≈ 23 h 59 min
        assertEq(uint256(arc.VALIDITY_BLOCKS()) * arc.BLOCK_TIME_MS() / 1000, 86_360);
    }

    /// Invalid parameters are refused at deployment (zero validity, zero block time); zero grace is allowed.
    function test_constructorRejectsZeroParams() public {
        vm.expectRevert(EnclaveRegistry.BadParams.selector);
        new EnclaveRegistry(address(module), address(products), address(bond), false, 0, 1, 508);
        vm.expectRevert(EnclaveRegistry.BadParams.selector);
        new EnclaveRegistry(address(module), address(products), address(bond), false, 1, 1, 0);
        EnclaveRegistry strict = new EnclaveRegistry(address(module), address(products), address(bond), false, 1, 0, 1);
        assertEq(strict.GRACE_BLOCKS(), 0);
    }
}
