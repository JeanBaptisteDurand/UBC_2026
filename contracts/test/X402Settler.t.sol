// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {X402Settler} from "../src/X402Settler.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {UsdcPayer} from "../src/lib/UsdcPayer.sol";

contract X402SettlerTest is Base {
    uint256 productId;
    address signer;

    function setUp() public override {
        super.setUp();
        _bondOperator(opPk, 1000e6);
        productId = _proposeAndActivate(address(x402), false, bytes32("model"), 1e6, 100e6, 100_000e6);
        (signer,) = _registerEnclave(productId, opPk, signerPk, "s1");
    }

    function _callReceipt(bytes32 nonce, uint128 units) internal view returns (X402Settler.CallReceipt memory cr) {
        cr = X402Settler.CallReceipt({
            productId: productId,
            payer: user,
            requestHash: keccak256("req"),
            responseHash: keccak256("resp"),
            units: units,
            anchorBlock: uint64(block.number),
            nonce: nonce
        });
    }

    function _sigCallReceipt(X402Settler.CallReceipt memory cr, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                x402.CALL_RECEIPT_TYPEHASH(),
                cr.productId,
                cr.payer,
                cr.requestHash,
                cr.responseHash,
                cr.units,
                cr.anchorBlock,
                cr.nonce
            )
        );
        return _sign(pk, _typed(address(x402), structHash));
    }

    /// @dev EIP-3009 authorization signed by the payer, for the exact amount and the receipt's nonce.
    function _payerAuth(uint256 value, bytes32 nonce) internal view returns (UsdcPayer.Auth memory a) {
        uint256 validAfter = 0;
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 digest = usdc.hashReceive(user, address(x402), value, validAfter, validBefore, nonce);
        a = UsdcPayer.Auth({validAfter: validAfter, validBefore: validBefore, nonce: nonce, signature: _sign(userPk, digest)});
    }

    function test_perCallSettle() public {
        bytes32 nonce = keccak256("call-1");
        X402Settler.CallReceipt memory cr = _callReceipt(nonce, 10); // 10 units * 1e6 = 10e6
        bytes memory sig = _sigCallReceipt(cr, signerPk);
        UsdcPayer.Auth memory auth = _payerAuth(10e6, nonce);

        uint256 userBefore = usdc.balanceOf(user);
        uint256 opBefore = usdc.balanceOf(operator);
        uint256 treBefore = usdc.balanceOf(treasury);

        x402.settle(cr, sig, auth);

        assertEq(userBefore - usdc.balanceOf(user), 10e6);
        assertEq(usdc.balanceOf(operator) - opBefore, 8e6); // 80 %
        assertEq(usdc.balanceOf(treasury) - treBefore, 1e6); // 10 %
    }

    function test_revertForgedEnclaveSig() public {
        bytes32 nonce = keccak256("call-2");
        X402Settler.CallReceipt memory cr = _callReceipt(nonce, 10);
        bytes memory sig = _sigCallReceipt(cr, userPk); // not an active enclave
        UsdcPayer.Auth memory auth = _payerAuth(10e6, nonce);
        vm.expectRevert(X402Settler.InactiveEnclave.selector);
        x402.settle(cr, sig, auth);
    }

    function test_revertReplayNonce() public {
        bytes32 nonce = keccak256("call-3");
        X402Settler.CallReceipt memory cr = _callReceipt(nonce, 10);
        bytes memory sig = _sigCallReceipt(cr, signerPk);
        UsdcPayer.Auth memory auth = _payerAuth(10e6, nonce);
        x402.settle(cr, sig, auth);

        // replay the same EIP-3009 nonce: the authorization is already used
        bytes memory sig2 = _sigCallReceipt(cr, signerPk);
        vm.expectRevert(); // MockUSDC3009.AuthUsed
        x402.settle(cr, sig2, auth);
    }

    /// "expired enclave" (in blocks): window [1000, 5999], grace until block 9999.
    /// A call receipt anchored AFTER the window is never paid; anchored INSIDE the window, it settles during
    /// the grace period, not after.
    function test_revertExpiredEnclave() public {
        bytes32 nonceAfter = keccak256("call-after-expiry");
        bytes32 nonceIn = keccak256("call-in-window");
        X402Settler.CallReceipt memory afterExpiry = _callReceipt(nonceAfter, 10);
        afterExpiry.anchorBlock = 6000;
        X402Settler.CallReceipt memory inWindow = _callReceipt(nonceIn, 10);
        inWindow.anchorBlock = 5999;
        bytes memory sigAfter = _sigCallReceipt(afterExpiry, signerPk);
        bytes memory sigIn = _sigCallReceipt(inWindow, signerPk);
        UsdcPayer.Auth memory authAfter = _payerAuth(10e6, nonceAfter);
        UsdcPayer.Auth memory authIn = _payerAuth(10e6, nonceIn);

        vm.roll(9999); // last block of the grace period
        vm.expectRevert(X402Settler.InactiveEnclave.selector);
        x402.settle(afterExpiry, sigAfter, authAfter);

        uint256 snap = vm.snapshotState();
        uint256 opBefore = usdc.balanceOf(operator);
        x402.settle(inWindow, sigIn, authIn);
        assertEq(usdc.balanceOf(operator) - opBefore, 8e6);
        vm.revertToState(snap);

        vm.roll(10_000); // grace period over
        vm.expectRevert(X402Settler.InactiveEnclave.selector);
        x402.settle(inWindow, sigIn, authIn);
    }

    /// The product's exposure cap (15 USDC per operator per 24 h) applies on
    /// top of "½ of the available bond"; the refused call collects nothing (EIP-3009 authorization intact).
    function test_settleRespectsProductExposureCap() public {
        productId = _proposeAndActivate(address(x402), false, bytes32("model"), 1e6, 100e6, 15e6);
        _registerEnclave(productId, opPk, 0x6161, "cap"); // dedicated enclave, block 1000
        X402Settler.CallReceipt memory c1 = _callReceipt(keccak256("cap-1"), 10);
        X402Settler.CallReceipt memory c2 = _callReceipt(keccak256("cap-2"), 10);
        bytes memory sig1 = _sigCallReceipt(c1, 0x6161);
        bytes memory sig2 = _sigCallReceipt(c2, 0x6161);
        UsdcPayer.Auth memory auth1 = _payerAuth(10e6, keccak256("cap-1"));
        UsdcPayer.Auth memory auth2 = _payerAuth(10e6, keccak256("cap-2"));

        x402.settle(c1, sig1, auth1); // 10 ≤ 15
        uint256 userBefore = usdc.balanceOf(user);
        vm.expectRevert(OperatorBond.ExposureCapExceeded.selector); // 10 + 10 > 15
        x402.settle(c2, sig2, auth2);
        assertEq(usdc.balanceOf(user), userBefore);
        assertFalse(usdc.authorizationState(user, keccak256("cap-2")));
        assertEq(bond.exposureOf(operator, productId), 10e6);
    }

    function test_revertWrongAmountSigned() public {
        bytes32 nonce = keccak256("call-4");
        X402Settler.CallReceipt memory cr = _callReceipt(nonce, 10); // due = 10e6
        bytes memory sig = _sigCallReceipt(cr, signerPk);
        // the payer signs for ANOTHER amount: the signature does not cover the amount collected
        UsdcPayer.Auth memory auth = _payerAuth(9e6, nonce);
        vm.expectRevert(); // MockUSDC3009.BadSignature
        x402.settle(cr, sig, auth);
    }
    /// FIXED v2 (adversarial review): X402Settler settles only the products whose settlement contract it is.
    function test_FIXED_revertWrongSettlement() public {
        uint256 sessionProduct = _proposeAndActivate(address(sessionPay), false, bytes32("model"), 1e6, 100e6, 0);
        X402Settler.CallReceipt memory cr = _callReceipt(keccak256("ws"), 10);
        cr.productId = sessionProduct;
        bytes memory sig = _sigCallReceipt(cr, signerPk);
        UsdcPayer.Auth memory auth = _payerAuth(10e6, keccak256("ws"));
        vm.expectRevert(X402Settler.WrongSettlement.selector);
        x402.settle(cr, sig, auth);
    }
}
