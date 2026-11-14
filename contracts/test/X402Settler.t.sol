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

    /// @dev Autorisation EIP-3009 signée par le payeur, pour le montant exact et le nonce du reçu.
    function _payerAuth(uint256 value, bytes32 nonce) internal view returns (UsdcPayer.Auth memory a) {
        uint256 validAfter = 0;
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 digest = usdc.hashReceive(user, address(x402), value, validAfter, validBefore, nonce);
        a = UsdcPayer.Auth({validAfter: validAfter, validBefore: validBefore, nonce: nonce, signature: _sign(userPk, digest)});
    }

    function test_perCallSettle() public {
        bytes32 nonce = keccak256("call-1");
        X402Settler.CallReceipt memory cr = _callReceipt(nonce, 10); // 10 unités * 1e6 = 10e6
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
        bytes memory sig = _sigCallReceipt(cr, userPk); // pas une enclave active
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

        // rejouer le même nonce EIP-3009 : l'autorisation est déjà consommée
        bytes memory sig2 = _sigCallReceipt(cr, signerPk);
        vm.expectRevert(); // MockUSDC3009.AuthUsed
        x402.settle(cr, sig2, auth);
    }

    /// PLAN-BUILD §9 « enclave expirée » (v2, en blocs) : fenêtre [1000, 5999], grâce jusqu'au bloc 9999.
    /// Un reçu d'appel ancré APRÈS la fenêtre n'est jamais payé ; ancré DANS la fenêtre, il se règle pendant
    /// la grâce, plus après.
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

        vm.roll(9999); // dernier bloc de la grâce
        vm.expectRevert(X402Settler.InactiveEnclave.selector);
        x402.settle(afterExpiry, sigAfter, authAfter);

        uint256 snap = vm.snapshotState();
        uint256 opBefore = usdc.balanceOf(operator);
        x402.settle(inWindow, sigIn, authIn);
        assertEq(usdc.balanceOf(operator) - opBefore, 8e6);
        vm.revertToState(snap);

        vm.roll(10_000); // grâce écoulée
        vm.expectRevert(X402Settler.InactiveEnclave.selector);
        x402.settle(inWindow, sigIn, authIn);
    }

    /// Correction 10 : le plafond d'exposition du produit (15 USDC par opérateur et par 24 h) s'applique en
    /// plus de « ½ caution disponible » ; l'appel refusé n'encaisse rien (autorisation EIP-3009 intacte).
    function test_settleRespectsProductExposureCap() public {
        productId = _proposeAndActivate(address(x402), false, bytes32("model"), 1e6, 100e6, 15e6);
        _registerEnclave(productId, opPk, 0x6161, "cap"); // enclave dédiée, bloc 1000
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
        X402Settler.CallReceipt memory cr = _callReceipt(nonce, 10); // dû = 10e6
        bytes memory sig = _sigCallReceipt(cr, signerPk);
        // le payeur signe pour un AUTRE montant : la signature ne couvre pas le montant encaissé
        UsdcPayer.Auth memory auth = _payerAuth(9e6, nonce);
        vm.expectRevert(); // MockUSDC3009.BadSignature
        x402.settle(cr, sig, auth);
    }
    /// FIXED v2 (revue adverse, critique) : X402Settler ne règle que les produits dont il est le contrat de règlement.
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
