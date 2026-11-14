// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {SessionPay} from "../src/SessionPay.sol";
import {SealedBounty} from "../src/SealedBounty.sol";
import {X402Settler} from "../src/X402Settler.sol";
import {UsdcPayer} from "../src/lib/UsdcPayer.sol";

/// @notice Tout le système dans UN scénario : trois produits, trois rails de paiement, un opérateur.
///         Inscription d'enclave -> session prépayée (règlements + fermeture + verdict ERC-8004) ;
///         prime scellée (preuve -> paiement) ; x402 (paiement à l'appel). Prouve que tout est câblé.
contract IntegrationTest is Base {
    uint256 constant sAPk = 0x5151; // enclave du produit inférence
    uint256 constant sBPk = 0x5252; // enclave du produit prime
    uint256 constant sCPk = 0x5353; // enclave du produit x402

    bytes32 constant MODEL = keccak256("Qwen2.5-1.5B");
    bytes32 constant PREDICATE = keccak256("predicate-v0");

    uint256 inferencePid;
    uint256 bountyPid;
    uint256 x402Pid;
    address sA;
    address sB;
    address sC;

    function setUp() public override {
        super.setUp();
        _bondOperator(opPk, 5000e6);

        inferencePid = _proposeAndActivate(address(sessionPay), false, MODEL, 1e6, 100e6, 1_000_000e6);
        bountyPid = _proposeAndActivate(address(sealedBounty), true, bytes32(0), 0, 100e6, 1_000_000e6);
        x402Pid = _proposeAndActivate(address(x402), false, bytes32("x402"), 1e6, 100e6, 1_000_000e6);

        (sA,) = _registerEnclave(inferencePid, opPk, sAPk, "A");
        (sB,) = _registerEnclave(bountyPid, opPk, sBPk, "B");
        (sC,) = _registerEnclave(x402Pid, opPk, sCPk, "C");

        vm.roll(1002); // pour l'ancrage de bloc des réclamations de prime
    }

    function test_fullLifecycle() public {
        _inferenceRail();
        _bountyRail();
        _x402Rail();
    }

    // ---------- rail 1 : session prépayée ----------

    function _inferenceRail() internal {
        UsdcPayer.Auth memory auth = _usdcAuth(userPk, address(sessionPay), 100e6, keccak256("open-int"));
        SessionPay.OpenParams memory q = SessionPay.OpenParams({
            productId: inferencePid,
            operator: operator,
            sessionKey: makeAddr("sk"),
            expiresAt: uint64(block.timestamp + 1 days),
            deposit: 100e6,
            cap: 0,
            auth: auth,
            enclave: sA
        });
        vm.prank(user);
        uint256 sid = sessionPay.openSession(q);

        // 10 appels, 10 reçus cumulatifs, réglés au fil de l'eau
        for (uint64 i = 1; i <= 10; i++) {
            SessionPay.Receipt memory r = SessionPay.Receipt({
                productId: inferencePid,
                sessionId: sid,
                seq: i,
                modelHash: MODEL,
                paramsHash: keccak256("p"),
                requestHash: keccak256(abi.encodePacked("req", i)),
                responseHash: keccak256(abi.encodePacked("resp", i)),
                tokensIn: 5,
                tokensOut: 5,
                cumulativeUnits: i, // 1 unité cumulée par appel
                anchorBlock: uint64(block.number)
            });
            sessionPay.settle(r, _signReceipt(r, sAPk));
        }
        assertEq(sessionPay.getSession(sid).paid, 10e6);

        vm.warp(block.timestamp + 1 days + 1 hours + 1);
        uint256 userBefore = usdc.balanceOf(user);
        vm.prank(user);
        sessionPay.closeSession(sid);
        assertEq(usdc.balanceOf(user) - userBefore, 90e6); // 100 - 10
        assertGt(validation.responses(), 0); // verdict écrit
    }

    // ---------- rail 2 : prime scellée ----------

    function _bountyRail() internal {
        uint256[] memory minLoss = new uint256[](1);
        minLoss[0] = 1e6;
        uint256[] memory amount = new uint256[](1);
        amount[0] = 100e6;
        UsdcPayer.Auth memory auth = _usdcAuth(protocolPk, address(sealedBounty), 10_000e6, keccak256("fund-int"));
        SealedBounty.CreateParams memory q = SealedBounty.CreateParams({
            productId: bountyPid,
            predicateHash: PREDICATE,
            protocolX25519: keccak256("protoX"),
            tierMinLoss: minLoss,
            tierAmount: amount,
            singleCap: 200e6,
            k: 2,
            targetToPause: address(0),
            deadline: uint64(vm.getBlockTimestamp() + 1 days), // après le vm.warp du rail 1 (via_ir replie block.timestamp)
            funding: 10_000e6,
            auth: auth
        });
        vm.prank(protocol);
        uint256 bid = sealedBounty.createBounty(q);

        bytes memory cP = bytes("sealed");
        SealedBounty.Claim memory c = SealedBounty.Claim({
            bountyId: bid,
            payee: hunter,
            blockN: uint64(block.number - 1),
            blockHashN: keccak256(abi.encodePacked(bytes32(uint256(block.number - 1)))),
            predicateHash: PREDICATE,
            loss: 5e6,
            tier: 0,
            fingerprint: keccak256("fp-int"),
            cPHash: keccak256(cP),
            deadline: uint64(vm.getBlockTimestamp() + 1 hours)
        });
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signClaim(c, sBPk);

        uint256 hunterBefore = usdc.balanceOf(hunter);
        sealedBounty.claim(c, sigs, cP);
        assertEq(usdc.balanceOf(hunter) - hunterBefore, 100e6);
        assertTrue(sealedBounty.fingerprintPaid(bid, keccak256("fp-int")));
    }

    // ---------- rail 3 : x402 à l'appel ----------

    function _x402Rail() internal {
        bytes32 nonce = keccak256("x402-call-int");
        X402Settler.CallReceipt memory cr = X402Settler.CallReceipt({
            productId: x402Pid,
            payer: user,
            requestHash: keccak256("req"),
            responseHash: keccak256("resp"),
            units: 10,
            anchorBlock: uint64(block.number),
            nonce: nonce
        });
        bytes memory sig = _signCallReceipt(cr, sCPk);

        uint256 validBefore = vm.getBlockTimestamp() + 1 hours;
        bytes32 digest = usdc.hashReceive(user, address(x402), 10e6, 0, validBefore, nonce);
        UsdcPayer.Auth memory auth =
            UsdcPayer.Auth({validAfter: 0, validBefore: validBefore, nonce: nonce, signature: _sign(userPk, digest)});

        uint256 opBefore = usdc.balanceOf(operator);
        x402.settle(cr, sig, auth);
        assertEq(usdc.balanceOf(operator) - opBefore, 8e6); // 80 % de 10e6
    }

    // ---------- signatures ----------

    function _signReceipt(SessionPay.Receipt memory r, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                sessionPay.RECEIPT_TYPEHASH(),
                r.productId, r.sessionId, r.seq, r.modelHash, r.paramsHash, r.requestHash, r.responseHash,
                r.tokensIn, r.tokensOut, r.cumulativeUnits, r.anchorBlock
            )
        );
        return _sign(pk, _typed(address(sessionPay), structHash));
    }

    function _signClaim(SealedBounty.Claim memory c, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                sealedBounty.CLAIM_TYPEHASH(),
                c.bountyId, c.payee, c.blockN, c.blockHashN, c.predicateHash, c.loss, c.tier, c.fingerprint, c.cPHash, c.deadline
            )
        );
        return _sign(pk, _typed(address(sealedBounty), structHash));
    }

    function _signCallReceipt(X402Settler.CallReceipt memory cr, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                x402.CALL_RECEIPT_TYPEHASH(),
                cr.productId, cr.payer, cr.requestHash, cr.responseHash, cr.units, cr.anchorBlock, cr.nonce
            )
        );
        return _sign(pk, _typed(address(x402), structHash));
    }
}
