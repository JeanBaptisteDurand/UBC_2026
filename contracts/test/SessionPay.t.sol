// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {Base} from "./Base.t.sol";
import {SessionPay} from "../src/SessionPay.sol";
import {VerdictLog} from "../src/VerdictLog.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {UsdcPayer} from "../src/lib/UsdcPayer.sol";
import {IAttestationModule} from "../src/interfaces/IAttestationModule.sol";

contract SessionPayTest is Base {
    bytes32 constant MODEL = keccak256("Qwen2.5-1.5B-Instruct-Q4_K_M");

    uint256 productId;
    address signer;
    uint256 sessionId;
    address sessionKey = makeAddr("sessionKey");

    function setUp() public override {
        super.setUp();
        _bondOperator(opPk, 1000e6);
        productId = _proposeAndActivate(address(sessionPay), false, MODEL, 1e6, 100e6, 100_000e6);
        (signer,) = _registerEnclave(productId, opPk, signerPk, "s1");

        UsdcPayer.Auth memory auth = _usdcAuth(userPk, address(sessionPay), 1000e6, keccak256("open"));
        SessionPay.OpenParams memory q = SessionPay.OpenParams({
            productId: productId,
            operator: operator,
            sessionKey: sessionKey,
            expiresAt: uint64(block.timestamp + 1 days),
            deposit: 1000e6,
            cap: 0,
            auth: auth,
            enclave: signer
        });
        vm.prank(user);
        sessionId = sessionPay.openSession(q);
    }

    function _receipt(uint64 seq, bytes32 modelHash, bytes32 responseHash, uint128 cumUnits)
        internal
        view
        returns (SessionPay.Receipt memory r)
    {
        r = SessionPay.Receipt({
            productId: productId,
            sessionId: sessionId,
            seq: seq,
            modelHash: modelHash,
            paramsHash: keccak256("params"),
            requestHash: keccak256(abi.encodePacked("req", seq)),
            responseHash: responseHash,
            tokensIn: 10,
            tokensOut: 20,
            cumulativeUnits: cumUnits,
            anchorBlock: uint64(block.number)
        });
    }

    function _sigReceipt(SessionPay.Receipt memory r, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                sessionPay.RECEIPT_TYPEHASH(),
                r.productId,
                r.sessionId,
                r.seq,
                r.modelHash,
                r.paramsHash,
                r.requestHash,
                r.responseHash,
                r.tokensIn,
                r.tokensOut,
                r.cumulativeUnits,
                r.anchorBlock
            )
        );
        return _sign(pk, _typed(address(sessionPay), structHash));
    }

    function test_settleFlowAndClose() public {
        // cumulative receipt no. 1: 10 units
        SessionPay.Receipt memory r1 = _receipt(1, MODEL, keccak256("resp1"), 10);
        sessionPay.settle(r1, _sigReceipt(r1, signerPk));
        assertEq(usdc.balanceOf(operator) + bond.bondOf(operator), 1_000_000e6 + 8e6); // 80% of 10e6 (bond deducted)
        assertEq(usdc.balanceOf(treasury), 1e6);

        // cumulative receipt no. 2: 25 units -> delta 15
        SessionPay.Receipt memory r2 = _receipt(2, MODEL, keccak256("resp2"), 25);
        sessionPay.settle(r2, _sigReceipt(r2, signerPk));
        SessionPay.Session memory s = sessionPay.getSession(sessionId);
        assertEq(s.paid, 25e6);
        assertEq(s.paidUnits, 25);

        // close after the deadline + grace: the rest is refunded + verdict
        vm.warp(block.timestamp + 1 days + 1 hours + 1);
        uint256 userBefore = usdc.balanceOf(user);
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        assertEq(usdc.balanceOf(user) - userBefore, 1000e6 - 25e6);
        assertEq(validation.responses(), 1); // one ERC-8004 entry written
    }

    function test_settleRevertForgedReceipt() public {
        SessionPay.Receipt memory r = _receipt(1, MODEL, keccak256("resp"), 10);
        // signed by a key that is not an active enclave
        bytes memory badSig = _sigReceipt(r, userPk);
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(r, badSig);
    }

    function test_settleRevertModelMismatch() public {
        SessionPay.Receipt memory r = _receipt(1, keccak256("WRONG"), keccak256("resp"), 10);
        bytes memory sig = _sigReceipt(r, signerPk); // signed before arming expectRevert
        vm.expectRevert(SessionPay.ModelMismatch.selector);
        sessionPay.settle(r, sig);
    }

    function test_settleRevertNotIncreasing() public {
        SessionPay.Receipt memory r1 = _receipt(1, MODEL, keccak256("resp1"), 10);
        sessionPay.settle(r1, _sigReceipt(r1, signerPk));
        SessionPay.Receipt memory r2 = _receipt(2, MODEL, keccak256("resp2"), 10); // not strictly increasing
        bytes memory sig2 = _sigReceipt(r2, signerPk);
        vm.expectRevert(SessionPay.NotIncreasing.selector);
        sessionPay.settle(r2, sig2);
    }

    function test_reportEquivocationSlashes() public {
        // two receipts with the same (sessionId, seq) and different answers, signed by the same enclave
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        bytes memory sigA = _sigReceipt(a, signerPk);
        bytes memory sigB = _sigReceipt(b, signerPk);

        uint256 reporterBefore = usdc.balanceOf(address(this));
        sessionPay.reportEquivocation(a, sigA, b, sigB);

        assertTrue(bond.banned(operator));
        assertEq(bond.bondOf(operator), 0);
        assertEq(usdc.balanceOf(address(this)) - reporterBefore, 500e6); // half to the reporter
        assertEq(usdc.balanceOf(user), 1_000_000e6 - 1000e6 + 500e6); // half to the victim (the owner)
    }

    function test_rotateKey() public {
        address newKey = makeAddr("newKey");
        vm.prank(user);
        sessionPay.rotateKey(sessionId, newKey);
        assertEq(sessionPay.getSession(sessionId).sessionKey, newKey);
    }

    // =====================================================================================
    // Negative tests: receipts, sessions, keys, caps, slashing.
    // Current block = 1000 after setUp (enclave `signer` registered at this block); anchors are literals.
    // Signatures are always computed BEFORE vm.expectRevert (the RECEIPT_TYPEHASH getter is a call).
    // =====================================================================================

    function _receiptFor(uint256 sid, uint64 seq, uint128 cumUnits, uint64 anchor)
        internal
        view
        returns (SessionPay.Receipt memory r)
    {
        r = SessionPay.Receipt({
            productId: productId,
            sessionId: sid,
            seq: seq,
            modelHash: MODEL,
            paramsHash: keccak256("params"),
            requestHash: keccak256(abi.encodePacked("req", sid, seq)),
            responseHash: keccak256(abi.encodePacked("resp", sid, seq)),
            tokensIn: 10,
            tokensOut: 20,
            cumulativeUnits: cumUnits,
            anchorBlock: anchor
        });
    }

    /// @dev Session on the operator's enclave (`signer` for operator, `signer2Pk` for operator2).
    function _openSession(uint256 ownerPk, address op, address key, uint256 deposit, uint256 cap, bytes32 nonce)
        internal
        returns (uint256 sid)
    {
        address enclave = op == operator ? signer : vm.addr(signer2Pk);
        sid = _openSessionWith(enclave, ownerPk, op, key, deposit, cap, nonce);
    }

    function _openSessionWith(
        address enclave,
        uint256 ownerPk,
        address op,
        address key,
        uint256 deposit,
        uint256 cap,
        bytes32 nonce
    ) internal returns (uint256 sid) {
        sid = _openSessionUntil(enclave, ownerPk, op, key, deposit, cap, nonce, uint64(vm.getBlockTimestamp() + 1 days));
    }

    function _openSessionUntil(
        address enclave,
        uint256 ownerPk,
        address op,
        address key,
        uint256 deposit,
        uint256 cap,
        bytes32 nonce,
        uint64 expiresAt
    ) internal returns (uint256 sid) {
        UsdcPayer.Auth memory auth = _usdcAuth(ownerPk, address(sessionPay), deposit, nonce);
        SessionPay.OpenParams memory q = SessionPay.OpenParams({
            productId: productId,
            operator: op,
            sessionKey: key,
            expiresAt: expiresAt,
            deposit: deposit,
            cap: cap,
            auth: auth,
            enclave: enclave
        });
        vm.prank(vm.addr(ownerPk));
        sid = sessionPay.openSession(q);
    }

    /// @dev The session `sid` (enclave `signer`) settles `units` units. A session that paid nothing no longer writes
    ///      a verdict when it closes: the closing-verdict tests settle first.
    function _settleUnits(uint256 sid, uint128 units) internal {
        SessionPay.Receipt memory r = _receiptFor(sid, 1, units, 1000);
        sessionPay.settle(r, _sigReceipt(r, signerPk));
    }

    function _closeAfterExpiry(uint256 sid, address owner) internal returns (uint256 refund) {
        vm.warp(uint256(sessionPay.getSession(sid).expiresAt) + sessionPay.SETTLE_GRACE());
        uint256 before = usdc.balanceOf(owner);
        vm.prank(owner);
        sessionPay.closeSession(sid);
        refund = usdc.balanceOf(owner) - before;
    }

    /// Threat "altered receipt": a genuine receipt with a field changed after signing is rejected.
    function test_settleRevertModifiedReceipt() public {
        SessionPay.Receipt memory inflated = _receiptFor(sessionId, 1, 10, 1000);
        bytes memory sig = _sigReceipt(inflated, signerPk); // signed by the real enclave
        inflated.cumulativeUnits = 900; // the operator inflates the total afterwards
        vm.expectRevert(SessionPay.InactiveEnclave.selector); // the signature no longer recovers the enclave
        sessionPay.settle(inflated, sig);

        SessionPay.Receipt memory swapped = _receiptFor(sessionId, 1, 10, 1000);
        bytes memory sig2 = _sigReceipt(swapped, signerPk);
        swapped.responseHash = keccak256("autre reponse"); // substituted answer
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(swapped, sig2);
        assertEq(sessionPay.getSession(sessionId).paid, 0);
    }

    /// Threat "receipt from another session": a genuine receipt of session B does not pay session A.
    function test_settleRevertReceiptFromOtherSession() public {
        uint256 sidB = _openSession(hunterPk, operator, makeAddr("skB"), 500e6, 0, keccak256("open-B"));
        SessionPay.Receipt memory rB = _receiptFor(sidB, 1, 300, 1000);
        bytes memory sigB = _sigReceipt(rB, signerPk);

        SessionPay.Receipt memory relabeled = _receiptFor(sidB, 1, 300, 1000);
        relabeled.sessionId = sessionId; // replayed against session A
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(relabeled, sigB);

        // counter-check: it pays only ITS session
        sessionPay.settle(rB, sigB);
        assertEq(sessionPay.getSession(sidB).paid, 300e6);
        assertEq(sessionPay.getSession(sessionId).paid, 0);
    }

    /// Threat "receipt from another session" (another operator): one operator's enclave cannot bill a
    /// session served by another operator, even for the same product.
    function test_settleRevertReceiptForOtherOperatorsSession() public {
        _bondOperator(op2Pk, 1000e6);
        _registerEnclave(productId, op2Pk, signer2Pk, "s2");
        uint256 sid2 = _openSession(hunterPk, operator2, makeAddr("sk-op2"), 500e6, 0, keccak256("open-op2"));
        SessionPay.Receipt memory r = _receiptFor(sid2, 1, 100, 1000);
        bytes memory sig = _sigReceipt(r, signerPk); // enclave of `operator`, not of `operator2`
        vm.expectRevert(SessionPay.WrongOperator.selector);
        sessionPay.settle(r, sig);
    }

    /// Threat "expired enclave" (in blocks): window [1000, 5999], grace until block 9999. A receipt
    /// anchored AFTER the window is never paid; a receipt anchored INSIDE the window settles during the grace period,
    /// not after (without re-attestation).
    function test_settleRevertExpiredEnclave() public {
        SessionPay.Receipt memory inWindow = _receiptFor(sessionId, 1, 10, 5999);
        SessionPay.Receipt memory afterExpiry = _receiptFor(sessionId, 2, 20, 6000);
        bytes memory sigIn = _sigReceipt(inWindow, signerPk);
        bytes memory sigAfter = _sigReceipt(afterExpiry, signerPk);

        vm.roll(9999); // last block of the grace period
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(afterExpiry, sigAfter);

        uint256 snap = vm.snapshotState();
        sessionPay.settle(inWindow, sigIn);
        assertEq(sessionPay.getSession(sessionId).paid, 10e6);
        vm.revertToState(snap);

        vm.roll(10_000); // grace period over
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(inWindow, sigIn);
    }

    /// End to end: a renewal of the enclave does not make the last receipt of a session anchored
    /// BEFORE the renewal unpayable.
    function test_settleReceiptAnchoredBeforeRenewal() public {
        SessionPay.Receipt memory r = _receiptFor(sessionId, 1, 10, 1005);
        bytes memory sig = _sigReceipt(r, signerPk);
        vm.roll(1010);
        bytes memory renewQuote = abi.encodePacked("quote-renew-sp");
        bytes32 x25519 = keccak256(abi.encodePacked("x25519", bytes32("s1"))); // same derivation as Base
        module.setMeasurements(renewQuote, _measurements(productId, operator, signer, x25519, 1009, false));
        vm.prank(operator);
        registry.registerEnclave(productId, renewQuote, 1009, signer, x25519, ""); // renewal at 1010
        sessionPay.settle(r, sig);
        assertEq(sessionPay.getSession(sessionId).paid, 10e6);
    }

    /// Threat "invalidated enclave": a receipt anchored at the invalidation block or after → rejected; anchored before → paid
    /// (intended: "not invalidated before this block").
    function test_settleRevertInvalidatedEnclave() public {
        SessionPay.Receipt memory early = _receiptFor(sessionId, 1, 10, 1005);
        SessionPay.Receipt memory late = _receiptFor(sessionId, 2, 20, 1010);
        bytes memory sigEarly = _sigReceipt(early, signerPk);
        bytes memory sigLate = _sigReceipt(late, signerPk);

        vm.roll(1010);
        bytes memory quote = abi.encodePacked("quote", bytes32("s1")); // registration quote (Base)
        IAttestationModule.Measurements memory bad; // the current collateral no longer validates it
        module.setMeasurements(quote, bad);
        registry.invalidate(signer, quote); // deactivatedAtBlock = 1010

        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(late, sigLate);

        sessionPay.settle(early, sigEarly);
        assertEq(sessionPay.getSession(sessionId).paid, 10e6);
    }

    /// Threat "request signed by a revoked key". The signature of REQUESTS by the session key is
    /// checked INSIDE the enclave (the inference enclave reads `sessionKey` on chain for every request): no on-chain path
    /// accepts it. This test locks what the enclave depends on: after rotateKey the current key changes, and the
    /// revoked key can neither take control back nor settle anything.
    function test_rotateKeyRevokesOldKey() public {
        (address oldKey, uint256 oldKeyPk) = makeAddrAndKey("old-session-key");
        uint256 sid = _openSession(userPk, operator, oldKey, 100e6, 0, keccak256("open-rot"));
        address newKey = makeAddr("new-session-key");
        vm.prank(user);
        sessionPay.rotateKey(sid, newKey);
        assertEq(sessionPay.getSession(sid).sessionKey, newKey);

        // the revoked (stolen) key cannot reinstall itself: only the owner rotates the key
        vm.prank(oldKey);
        vm.expectRevert(SessionPay.NotOwner.selector);
        sessionPay.rotateKey(sid, oldKey);

        // and it has no settlement authority
        SessionPay.Receipt memory r = _receiptFor(sid, 1, 10, 1000);
        bytes memory sig = _sigReceipt(r, oldKeyPk);
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(r, sig);
    }

    /// Revocation by closeSession: closed session → no more settlement or rotation.
    function test_closedSessionRefusesSettleAndRotate() public {
        SessionPay.Receipt memory r = _receiptFor(sessionId, 1, 10, 1000);
        bytes memory sig = _sigReceipt(r, signerPk);
        assertEq(_closeAfterExpiry(sessionId, user), 1000e6);

        vm.expectRevert(SessionPay.Closed.selector);
        sessionPay.settle(r, sig);

        vm.prank(user);
        vm.expectRevert(SessionPay.Closed.selector);
        sessionPay.rotateKey(sessionId, makeAddr("late-key"));
    }

    /// Threat "empty session": a receipt beyond the deposit never pays more than the deposit, and does not touch
    /// the deposits of other sessions (the contract holds all deposits together).
    function test_settleEmptySessionNeverPaysBeyondDeposit() public {
        uint256 sid = _openSession(hunterPk, operator, makeAddr("sk-small"), 10e6, 0, keccak256("open-small"));
        uint256 poolBefore = usdc.balanceOf(address(sessionPay)); // 1000e6 (session A) + 10e6

        SessionPay.Receipt memory over = _receiptFor(sid, 1, 15, 1000); // 15 USDC served, 10 deposited
        sessionPay.settle(over, _sigReceipt(over, signerPk));
        assertEq(sessionPay.getSession(sid).paid, 10e6);

        SessionPay.Receipt memory more = _receiptFor(sid, 2, 40, 1000); // empty session: nothing more
        sessionPay.settle(more, _sigReceipt(more, signerPk));
        assertEq(sessionPay.getSession(sid).paid, 10e6);

        assertEq(usdc.balanceOf(address(sessionPay)), poolBefore - 10e6);
        assertEq(usdc.balanceOf(address(sessionPay)), sessionPay.getSession(sessionId).deposit);
        assertEq(_closeAfterExpiry(sid, hunter), 0);
    }

    /// Key cap: the session never pays beyond its cap; the rest is refunded.
    function test_settleRespectsSessionCap() public {
        uint256 sid = _openSession(hunterPk, operator, makeAddr("sk-cap"), 100e6, 30e6, keccak256("open-cap"));
        SessionPay.Receipt memory r = _receiptFor(sid, 1, 50, 1000);
        sessionPay.settle(r, _sigReceipt(r, signerPk));
        assertEq(sessionPay.getSession(sid).paid, 30e6);
        assertEq(_closeAfterExpiry(sid, hunter), 70e6);
    }

    /// Threat "amount above the single-enclave cap": a settlement never releases more than
    /// half of the available bond over 24 h (bond 1,000 USDC → at most 500).
    function test_settleRevertAboveSingleEnclaveExposure() public {
        SessionPay.Receipt memory r = _receiptFor(sessionId, 1, 600, 1000); // 600 USDC dus
        bytes memory sig = _sigReceipt(r, signerPk);
        vm.expectRevert(OperatorBond.TooMuchExposure.selector);
        sessionPay.settle(r, sig);
    }

    /// Threat, end to end (inference): 100 calls → 100 cumulative receipts → ONE settlement → rest refunded.
    function test_hundredCallsOneSettlement() public {
        SessionPay.Receipt memory last;
        for (uint64 i = 1; i <= 100; i++) {
            last = _receiptFor(sessionId, i, uint128(i) * 3, 1000); // 3 units per call
        }
        uint256 opBefore = usdc.balanceOf(operator);
        sessionPay.settle(last, _sigReceipt(last, signerPk));
        assertEq(sessionPay.getSession(sessionId).paid, 300e6);
        assertEq(sessionPay.getSession(sessionId).paidUnits, 300);
        assertEq(usdc.balanceOf(operator) - opBefore, 240e6); // 80 %
        assertEq(_closeAfterExpiry(sessionId, user), 700e6);
    }

    /// Threat "ERC-8004 write refused on a slashing path (the slashing still happens)".
    function test_slashGoesThroughWhenErc8004WriteFails() public {
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        bytes memory sigA = _sigReceipt(a, signerPk);
        bytes memory sigB = _sigReceipt(b, signerPk);
        validation.setShouldRevert(true); // the ERC-8004 validation registry refuses the write

        uint256 reporterBefore = usdc.balanceOf(address(this));
        sessionPay.reportEquivocation(a, sigA, b, sigB);

        assertTrue(bond.banned(operator));
        assertEq(bond.bondOf(operator), 0);
        assertEq(usdc.balanceOf(address(this)) - reporterBefore, 500e6);
        assertEq(validation.responses(), 0); // no entry written, and the slashing took place
    }

    // =====================================================================================
    // v2 fixes: locked price, verdict per session, honest flag, product cap
    // =====================================================================================

    /// @dev Changes the product's price through the normal path (proposeUpdate → timelock → applyUpdate).
    function _changePrice(uint256 newPrice) internal {
        products.proposeUpdate(productId, keccak256("manifest"), newPrice, MODEL); // this contract is the author
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.applyUpdate(productId);
        assertEq(products.getProduct(productId).price, newPrice);
    }

    /// The price is LOCKED when the session opens. A rise after the opening does not requalify
    /// the session retroactively; only sessions opened after the rise pay the new price.
    function test_priceLockedAtOpen_increaseHasNoEffect() public {
        assertEq(sessionPay.getSession(sessionId).price, 1e6);
        SessionPay.Receipt memory r1 = _receiptFor(sessionId, 1, 10, 1000);
        sessionPay.settle(r1, _sigReceipt(r1, signerPk)); // 10 × 1 USDC

        _changePrice(3e6); // the product's price triples after the opening

        SessionPay.Receipt memory r2 = _receiptFor(sessionId, 2, 25, 1000);
        sessionPay.settle(r2, _sigReceipt(r2, signerPk));
        SessionPay.Session memory s = sessionPay.getSession(sessionId);
        assertEq(s.price, 1e6, "prix verrouille");
        assertEq(s.paid, 25e6, "25 x 1 USDC, pas 25 x 3 (v1 : 75)");

        uint256 sid2 = _openSession(hunterPk, operator, makeAddr("sk-after-raise"), 100e6, 0, keccak256("open-raise"));
        assertEq(sessionPay.getSession(sid2).price, 3e6, "une session ouverte apres la hausse paie le nouveau prix");
    }

    /// A price cut no longer reverts the next settlement (before the fix: due = 15 × 0.5 = 7.5
    /// < 10 already paid → negative subtraction, revert until the total caught up).
    function test_priceLockedAtOpen_decreaseDoesNotRevert() public {
        SessionPay.Receipt memory r1 = _receiptFor(sessionId, 1, 10, 1000);
        sessionPay.settle(r1, _sigReceipt(r1, signerPk)); // 10e6 paid

        _changePrice(0.5e6);

        SessionPay.Receipt memory r2 = _receiptFor(sessionId, 2, 15, 1000);
        sessionPay.settle(r2, _sigReceipt(r2, signerPk));
        assertEq(sessionPay.getSession(sessionId).paid, 15e6); // 15 × 1 USDC (locked price)
    }

    /// The ERC-8004 requestHash of a session's verdict carries its sessionId. Two sessions of the
    /// same owner on the same product write two distinct entries (before the fix: the same hash).
    function test_verdictRequestHashIncludesSessionId() public {
        uint256 sid2 = _openSession(userPk, operator, makeAddr("sk-2"), 100e6, 0, keccak256("open-2"));
        _settleUnits(sessionId, 10); // two sessions that paid (otherwise, no verdict)
        _settleUnits(sid2, 10);
        vm.recordLogs();
        _closeAfterExpiry(sessionId, user);
        _closeAfterExpiry(sid2, user);

        bytes32 recorded = keccak256("Recorded(uint256,bytes32,uint8,string)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32[] memory hashes = new bytes32[](2);
        uint256 n;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(verdict) && logs[i].topics[0] == recorded) hashes[n++] = logs[i].topics[2];
        }
        assertEq(n, 2, "deux verdicts");
        assertTrue(hashes[0] != hashes[1], "deux sessions, deux requestHash");
        // v2.1: the requestHash starts with (block.chainid, address(this)), updated with the intended change
        assertEq(hashes[0], keccak256(abi.encode(block.chainid, address(sessionPay), "session", sessionId, productId, user)));
        assertEq(hashes[1], keccak256(abi.encode(block.chainid, address(sessionPay), "session", sid2, productId, user)));
        assertTrue(sessionPay.getSession(sessionId).verdictWritten);
        assertTrue(sessionPay.getSession(sid2).verdictWritten);
    }

    /// On the equivocation path, verdictWritten becomes true only if the ERC-8004 write
    /// succeeded. Closing never writes "100 verified" for a banned operator; a new
    /// report of the same proof retries the fault verdict (the slashing itself takes nothing more).
    function test_equivocationVerdictFlagOnlyWhenWritten() public {
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        bytes memory sigA = _sigReceipt(a, signerPk);
        bytes memory sigB = _sigReceipt(b, signerPk);
        _settleUnits(sessionId, 10); // the session paid; it is indeed the ban that rules out the 100

        validation.setShouldRevert(true); // the ERC-8004 registry refuses the write
        sessionPay.reportEquivocation(a, sigA, b, sigB);
        assertTrue(bond.banned(operator));
        assertFalse(sessionPay.getSession(sessionId).verdictWritten, "ecriture echouee : drapeau non pose");

        validation.setShouldRevert(false);
        assertEq(_closeAfterExpiry(sessionId, user), 1000e6 - 10e6);
        assertEq(validation.responses(), 0, "pas de verdict 100 pour un operateur radie");
        assertFalse(sessionPay.getSession(sessionId).verdictWritten);

        uint256 reporterBefore = usdc.balanceOf(address(this));
        sessionPay.reportEquivocation(a, sigA, b, sigB); // new report: retries the fault verdict
        assertEq(usdc.balanceOf(address(this)), reporterBefore, "rien a saisir une deuxieme fois");
        assertEq(validation.responses(), 1);
        assertTrue(sessionPay.getSession(sessionId).verdictWritten);
    }

    /// Counter-check: successful write → flag set, no second verdict at closing.
    function test_equivocationVerdictWrittenOnce() public {
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        _settleUnits(sessionId, 10); // the session paid; closing does not add a 100 after the fault
        sessionPay.reportEquivocation(a, _sigReceipt(a, signerPk), b, _sigReceipt(b, signerPk));
        assertTrue(sessionPay.getSession(sessionId).verdictWritten);
        assertEq(validation.responses(), 1);
        _closeAfterExpiry(sessionId, user);
        assertEq(validation.responses(), 1);
    }

    /// The product's exposure cap (50 USDC per operator per 24 h) applies on
    /// top of "½ of the available bond" (500 USDC here); the next window resets the counter.
    function test_settleRespectsProductExposureCap() public {
        productId = _proposeAndActivate(address(sessionPay), false, MODEL, 1e6, 100e6, 50e6);
        _registerEnclave(productId, opPk, 0x6161, "cap"); // dedicated enclave, block 1000
        uint256 sid =
            _openSessionWith(vm.addr(0x6161), hunterPk, operator, makeAddr("sk-cap-p"), 200e6, 0, keccak256("open-cap-p"));

        SessionPay.Receipt memory r1 = _receiptFor(sid, 1, 30, 1000);
        SessionPay.Receipt memory r2 = _receiptFor(sid, 2, 55, 1000);
        bytes memory sig1 = _sigReceipt(r1, 0x6161);
        bytes memory sig2 = _sigReceipt(r2, 0x6161);

        sessionPay.settle(r1, sig1); // 30 ≤ 50
        vm.expectRevert(OperatorBond.ExposureCapExceeded.selector); // 30 + 25 > 50
        sessionPay.settle(r2, sig2);

        vm.warp(vm.getBlockTimestamp() + 36 hours + 1); // ROLLING 24 h: an exposure counts for ≤ 36 h
        sessionPay.settle(r2, sig2);
        assertEq(sessionPay.getSession(sid).paid, 55e6);
        assertEq(bond.exposureOf(operator, productId), 25e6);
    }
    // =====================================================================================
    // Adversarial review of v2: the session's product and enclave, deadline, locked model
    // =====================================================================================

    /// FIXED: a session opens only on a product settled by SessionPay (or the attempts of the Sealed
    /// Bounty), never at price 0.
    function test_FIXED_openOnlyOnOwnProductsAtNonZeroPrice() public {
        uint256 x402Product = _proposeAndActivate(address(x402), false, MODEL, 1e6, 100e6, 0);
        productId = x402Product;
        vm.expectRevert(SessionPay.WrongSettlement.selector);
        this.openFor(signer, 10e6, keccak256("o-x402"));

        uint256 free = _proposeAndActivate(address(sessionPay), false, MODEL, 0, 100e6, 0);
        productId = free;
        vm.expectRevert(SessionPay.ZeroPrice.selector);
        this.openFor(signer, 10e6, keccak256("o-free"));

        // paid attempts of the Sealed Bounty: product settled by SealedBounty, price 0.01 USDC per attempt
        uint256 attempts = _proposeAndActivate(address(sealedBounty), true, bytes32(0), 10_000, 100e6, 0);
        (address bountyEnclave,) = _registerEnclave(attempts, opPk, 0x7171, "att");
        productId = attempts;
        uint256 sid = this.openFor(bountyEnclave, 1e6, keccak256("o-att"));
        assertEq(sessionPay.getSession(sid).price, 10_000);
    }

    /// FIXED: the named enclave must be active for this product, at the announced operator, bonded and not banned.
    function test_FIXED_openRequiresActiveEnclaveOfAnnouncedOperator() public {
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        this.openFor(makeAddr("pas-une-enclave"), 10e6, keccak256("o-none"));

        UsdcPayer.Auth memory auth = _usdcAuth(userPk, address(sessionPay), 10e6, keccak256("o-wrong-op"));
        SessionPay.OpenParams memory q = SessionPay.OpenParams({
            productId: productId,
            operator: operator2, // the enclave belongs to `operator`
            sessionKey: sessionKey,
            expiresAt: uint64(vm.getBlockTimestamp() + 1 days),
            deposit: 10e6,
            cap: 0,
            auth: auth,
            enclave: signer
        });
        vm.prank(user);
        vm.expectRevert(SessionPay.WrongOperator.selector);
        sessionPay.openSession(q);

        // banned operator (proven equivocation): no new session
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        sessionPay.reportEquivocation(a, _sigReceipt(a, signerPk), b, _sigReceipt(b, signerPk));
        vm.expectRevert(SessionPay.OperatorUnderbonded.selector);
        this.openFor(signer, 10e6, keccak256("o-banned"));
    }

    /// FIXED: deadline within [now + 10 min, now + 30 days].
    function test_FIXED_expiryBounded() public {
        uint64 nowTs = uint64(vm.getBlockTimestamp());
        vm.expectRevert(SessionPay.BadExpiry.selector);
        this.openUntil(nowTs - 2 hours, keccak256("e-past"));
        vm.expectRevert(SessionPay.BadExpiry.selector);
        this.openUntil(nowTs + 9 minutes, keccak256("e-short"));
        vm.expectRevert(SessionPay.BadExpiry.selector);
        this.openUntil(nowTs + 30 days + 1, keccak256("e-long"));
        this.openUntil(nowTs + 10 minutes, keccak256("e-min"));
        this.openUntil(nowTs + 30 days, keccak256("e-max"));
    }

    /// FIXED: only the enclave bound to the session is paid; a 2nd enclave of the same operator is not.
    function test_FIXED_onlyBoundEnclaveIsPaid() public {
        _registerEnclave(productId, opPk, 0x5353, "s3"); // 2nd enclave of `operator`, same product
        SessionPay.Receipt memory r = _receiptFor(sessionId, 1, 10, 1000);
        bytes memory sig = _sigReceipt(r, 0x5353);
        vm.expectRevert(SessionPay.WrongEnclave.selector);
        sessionPay.settle(r, sig);
        sessionPay.settle(r, _sigReceipt(r, signerPk)); // the session's enclave: paid
        assertEq(sessionPay.getSession(sessionId).paid, 10e6);
    }

    /// FIXED: the model is locked when the session opens, like the price and the unit.
    function test_FIXED_modelAndUnitLockedAtOpen() public {
        SessionPay.Session memory s0 = sessionPay.getSession(sessionId);
        assertEq(s0.param, MODEL);
        assertEq(s0.enclave, signer);
        assertEq(s0.unitTokens, 1);
        assertEq(s0.outWeight, 1);

        products.proposeUpdate(productId, keccak256("manifest-v2"), 1e6, keccak256("Qwen3-8B"));
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.applyUpdate(productId);

        SessionPay.Receipt memory r = _receiptFor(sessionId, 1, 10, 1000); // old model, session from before
        sessionPay.settle(r, _sigReceipt(r, signerPk));
        assertEq(sessionPay.getSession(sessionId).paid, 10e6);

        uint256 sid2 = _openSession(hunterPk, operator, makeAddr("sk-new-model"), 100e6, 0, keccak256("o-new"));
        SessionPay.Receipt memory old = _receiptFor(sid2, 1, 10, 1000); // the old model on a session from after
        bytes memory sigOld = _sigReceipt(old, signerPk);
        vm.expectRevert(SessionPay.ModelMismatch.selector);
        sessionPay.settle(old, sigOld);
    }

    /// Early closing is allowed only when the bound enclave can no longer settle anything.
    function test_closeEarlyOnlyWhenBoundEnclaveCanNoLongerSettle() public {
        uint256 sid = _openSessionUntil(
            signer, hunterPk, operator, makeAddr("sk-early"), 100e6, 0, keccak256("o-early"), uint64(vm.getBlockTimestamp() + 30 days)
        );
        SessionPay.Receipt memory r = _receiptFor(sid, 1, 10, 1000);
        bytes memory sig = _sigReceipt(r, signerPk);
        vm.roll(1010);
        vm.prank(operator);
        registry.retire(signer); // cut at 1009, payable until block 1009 + grace

        vm.prank(hunter);
        vm.expectRevert(SessionPay.NotExpired.selector);
        sessionPay.closeSession(sid);

        sessionPay.settle(r, sig); // the operator settles during the grace period
        vm.roll(1009 + TEST_GRACE_BLOCKS + 1);
        vm.prank(hunter);
        sessionPay.closeSession(sid); // nothing payable any more: closing before the deadline
        assertTrue(sessionPay.getSession(sid).closed);
        assertEq(sessionPay.getSession(sid).paid, 10e6);
    }

    // ---- helpers called through `this.` (for vm.expectRevert on the call to the contract) ----

    function openFor(address enclave, uint256 deposit, bytes32 nonce) external returns (uint256) {
        return _openSessionWith(enclave, userPk, operator, sessionKey, deposit, 0, nonce);
    }

    function openUntil(uint64 expiresAt, bytes32 nonce) external returns (uint256) {
        return _openSessionUntil(signer, userPk, operator, sessionKey, 10e6, 0, nonce, expiresAt);
    }
    // =====================================================================================
    // The ERC-8004 verdict is no longer skipped at the minimum gas (eth_estimateGas). Confirmed on Arc testnet:
    // closeSession(13), limit 93,765 (the wallet's estimate), no Recorded; closeSession(3), 335,119, written.
    // =====================================================================================

    /// FIXED: at the MINIMUM gas that makes closeSession succeed (what a wallet picks), the verdict is written.
    function test_FIXED_v2_minimalGasCloseWritesVerdict() public {
        _emulateArcVerdictCost();
        SessionPay.Receipt memory r = _receipt(1, MODEL, keccak256("resp"), 10);
        sessionPay.settle(r, _sigReceipt(r, signerPk));
        vm.warp(uint256(sessionPay.getSession(sessionId).expiresAt) + sessionPay.SETTLE_GRACE());
        bytes memory call = abi.encodeCall(SessionPay.closeSession, (sessionId));
        uint256 g = _minGasToSucceed(user, address(sessionPay), call, 21_000, 3_000_000);
        assertGt(g, sessionPay.VERDICT_GAS(), "le gaz minimal comprend celui du verdict");

        uint256 before = validation.responses();
        vm.prank(user);
        (bool ok,) = address(sessionPay).call{gas: g}(call);
        assertTrue(ok);
        assertTrue(sessionPay.getSession(sessionId).closed);
        assertTrue(sessionPay.getSession(sessionId).verdictWritten);
        assertEq(validation.responses(), before + 1, "verdict ecrit au gaz minimal");
    }

    /// FIXED: gas just above the path WITHOUT a verdict (what the wallet estimated before the fix) is
    /// refused (InsufficientGasForVerdict): the session stays open; with ample gas, it closes with its verdict.
    function test_FIXED_v2_closeJustAboveNoVerdictPathReverts() public {
        _emulateArcVerdictCost();
        _settleUnits(sessionId, 10); // the session paid (otherwise closing has no verdict to write)
        vm.warp(uint256(sessionPay.getSession(sessionId).expiresAt) + sessionPay.SETTLE_GRACE());
        bytes memory call = abi.encodeCall(SessionPay.closeSession, (sessionId));

        // gas used by the path WITHOUT a verdict (the registry refuses at once: caller removed), then reverted
        uint256 snap = vm.snapshotState();
        verdict.removeCaller(address(sessionPay));
        vm.prank(user);
        uint256 g0 = gasleft();
        (bool ok0,) = address(sessionPay).call(call);
        uint256 noVerdictPath = g0 - gasleft();
        assertTrue(ok0);
        vm.revertToState(snap);
        assertLt(noVerdictPath + 10_000, sessionPay.VERDICT_GAS(), "le chemin sans verdict coute bien moins");

        vm.prank(user);
        (bool ok, bytes memory ret) = address(sessionPay).call{gas: noVerdictPath + 10_000}(call);
        assertFalse(ok, "plus de fermeture sans verdict au gaz du chemin sans verdict");
        assertEq(bytes4(ret), SessionPay.InsufficientGasForVerdict.selector);
        assertFalse(sessionPay.getSession(sessionId).closed);

        uint256 before = validation.responses();
        vm.prank(user);
        sessionPay.closeSession(sessionId); // ample gas
        assertTrue(sessionPay.getSession(sessionId).closed);
        assertEq(validation.responses(), before + 1);
    }

    /// FIXED: slashing for equivocation at the minimum gas also writes its fault verdict.
    function test_FIXED_v2_minimalGasEquivocationWritesVerdict() public {
        _emulateArcVerdictCost();
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        bytes memory call =
            abi.encodeCall(SessionPay.reportEquivocation, (a, _sigReceipt(a, signerPk), b, _sigReceipt(b, signerPk)));
        address reporter = makeAddr("reporter-min-gas");
        uint256 g = _minGasToSucceed(reporter, address(sessionPay), call, 21_000, 3_000_000);
        uint256 before = validation.responses();
        vm.prank(reporter);
        (bool ok,) = address(sessionPay).call{gas: g}(call);
        assertTrue(ok);
        assertTrue(bond.banned(operator));
        assertEq(validation.responses(), before + 1, "verdict de faute ecrit au gaz minimal");
    }

    // ---- requestHash bound to the chain and the contract; VerdictSkipped when the write fails ----

    /// The verdict's requestHash starts with (block.chainid, address(this)): the same session (same number, same
    /// owner, same product) on another deployment, or on another chain, no longer writes the same entry.
    function test_v21_verdictRequestHashBoundToChainAndContract() public {
        bytes32 expected =
            keccak256(abi.encode(block.chainid, address(sessionPay), "session", sessionId, productId, user));
        assertTrue(expected != keccak256(abi.encode("session", sessionId, productId, user)), "differe de la v2");
        _settleUnits(sessionId, 10); // the session paid (otherwise, no verdict)
        _warpPastClose(sessionId);
        vm.expectEmit(true, true, false, true, address(verdict));
        emit VerdictLog.Recorded(0, expected, 100, "tdx-dcap/inference");
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        assertTrue(sessionPay.getSession(sessionId).verdictWritten);

        // same contract, another chain: another requestHash
        uint256 sid2 = _openSession(userPk, operator, makeAddr("sk-chain"), 100e6, 0, keccak256("open-chain"));
        _settleUnits(sid2, 10); // settled BEFORE the chain change (the EIP-712 domain of receipts carries the chain)
        vm.chainId(4242);
        bytes32 onOtherChain = keccak256(abi.encode(uint256(4242), address(sessionPay), "session", sid2, productId, user));
        _warpPastClose(sid2);
        vm.expectEmit(true, true, false, true, address(verdict));
        emit VerdictLog.Recorded(0, onOtherChain, 100, "tdx-dcap/inference");
        vm.prank(user);
        sessionPay.closeSession(sid2);
    }

    function _warpPastClose(uint256 sid) internal {
        vm.warp(uint256(sessionPay.getSession(sid).expiresAt) + sessionPay.SETTLE_GRACE());
    }

    /// A verdict that fails despite its gas (ERC-8004 registry down) leaves a trace: VerdictSkipped, with
    /// the requestHash and the reason; closing still refunds, and the flag stays false.
    function test_v21_closeEmitsVerdictSkippedWhenRegistryFails() public {
        _settleUnits(sessionId, 10); // the session paid (otherwise no verdict is attempted)
        validation.setShouldRevert(true);
        bytes32 rh = keccak256(abi.encode(block.chainid, address(sessionPay), "session", sessionId, productId, user));
        _warpPastClose(sessionId);
        uint256 before = usdc.balanceOf(user);
        vm.expectEmit(true, false, false, true, address(sessionPay));
        emit SessionPay.VerdictSkipped(rh, abi.encodeWithSignature("Error(string)", "validation down"));
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        assertEq(usdc.balanceOf(user) - before, 1000e6 - 10e6, "rembourse");
        assertFalse(sessionPay.getSession(sessionId).verdictWritten);
    }

    // ---- a session that paid nothing has no verdict ----

    /// @dev = SessionPay.VerdictNotApplicable, redeclared so this file also compiles against the previous v2.1 sources.
    event VerdictNotApplicable(uint256 indexed sessionId);

    /// Closed without any settlement, the session refunds everything and writes no verdict, without even attempting it (no
    /// VERDICT_GAS reserve: the minimum gas stays well below it); VerdictNotApplicable(sessionId) records it, just
    /// before SessionClosed. Before the fix: an ERC-8004 "100" for a session nobody paid for.
    function test_v21ter_unpaidCloseRefundsAndWritesNoVerdict() public {
        _warpPastClose(sessionId);
        bytes memory call = abi.encodeCall(SessionPay.closeSession, (sessionId));
        uint256 g = _minGasToSucceed(user, address(sessionPay), call, 21_000, 3_000_000);
        assertLt(g, sessionPay.VERDICT_GAS(), "aucun verdict a ecrire : aucune reserve de gaz");

        uint256 before = usdc.balanceOf(user);
        vm.expectEmit(true, false, false, true, address(sessionPay));
        emit VerdictNotApplicable(sessionId);
        vm.expectEmit(true, false, false, true, address(sessionPay));
        emit SessionPay.SessionClosed(sessionId, 1000e6);
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        assertEq(usdc.balanceOf(user) - before, 1000e6, "remboursement integral");
        assertEq(validation.requests(), 0, "aucune demande ERC-8004");
        assertEq(validation.responses(), 0, "aucun verdict");
        assertFalse(sessionPay.getSession(sessionId).verdictWritten);
    }

    /// Same on the equivocation path (the slashing happens; the skipped fault verdict is recorded).
    function test_v21_equivocationEmitsVerdictSkippedWhenRegistryFails() public {
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        bytes memory sigA = _sigReceipt(a, signerPk);
        bytes memory sigB = _sigReceipt(b, signerPk);
        verdict.removeCaller(address(sessionPay)); // VerdictLog refuses the caller (NotCaller)
        bytes32 rh = keccak256(abi.encode(block.chainid, address(sessionPay), "equivocation", sessionId, uint64(5)));
        vm.expectEmit(true, false, false, true, address(sessionPay));
        emit SessionPay.VerdictSkipped(rh, abi.encodeWithSelector(VerdictLog.NotCaller.selector));
        sessionPay.reportEquivocation(a, sigA, b, sigB);
        assertTrue(bond.banned(operator));
        assertFalse(sessionPay.getSession(sessionId).verdictWritten);
    }
}
