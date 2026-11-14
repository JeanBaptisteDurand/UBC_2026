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
        // reçu cumulatif n°1 : 10 unités
        SessionPay.Receipt memory r1 = _receipt(1, MODEL, keccak256("resp1"), 10);
        sessionPay.settle(r1, _sigReceipt(r1, signerPk));
        assertEq(usdc.balanceOf(operator) + bond.bondOf(operator), 1_000_000e6 + 8e6); // 80% de 10e6 (caution déduite)
        assertEq(usdc.balanceOf(treasury), 1e6);

        // reçu cumulatif n°2 : 25 unités -> delta 15
        SessionPay.Receipt memory r2 = _receipt(2, MODEL, keccak256("resp2"), 25);
        sessionPay.settle(r2, _sigReceipt(r2, signerPk));
        SessionPay.Session memory s = sessionPay.getSession(sessionId);
        assertEq(s.paid, 25e6);
        assertEq(s.paidUnits, 25);

        // fermeture après l'échéance + grâce : remboursement du reste + verdict
        vm.warp(block.timestamp + 1 days + 1 hours + 1);
        uint256 userBefore = usdc.balanceOf(user);
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        assertEq(usdc.balanceOf(user) - userBefore, 1000e6 - 25e6);
        assertEq(validation.responses(), 1); // une entrée ERC-8004 écrite
    }

    function test_settleRevertForgedReceipt() public {
        SessionPay.Receipt memory r = _receipt(1, MODEL, keccak256("resp"), 10);
        // signé par une clé qui n'est pas une enclave active
        bytes memory badSig = _sigReceipt(r, userPk);
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(r, badSig);
    }

    function test_settleRevertModelMismatch() public {
        SessionPay.Receipt memory r = _receipt(1, keccak256("WRONG"), keccak256("resp"), 10);
        bytes memory sig = _sigReceipt(r, signerPk); // signé avant d'armer expectRevert
        vm.expectRevert(SessionPay.ModelMismatch.selector);
        sessionPay.settle(r, sig);
    }

    function test_settleRevertNotIncreasing() public {
        SessionPay.Receipt memory r1 = _receipt(1, MODEL, keccak256("resp1"), 10);
        sessionPay.settle(r1, _sigReceipt(r1, signerPk));
        SessionPay.Receipt memory r2 = _receipt(2, MODEL, keccak256("resp2"), 10); // pas strictement croissant
        bytes memory sig2 = _sigReceipt(r2, signerPk);
        vm.expectRevert(SessionPay.NotIncreasing.selector);
        sessionPay.settle(r2, sig2);
    }

    function test_reportEquivocationSlashes() public {
        // deux reçus de même (sessionId, seq) à réponses différentes, signés par la même enclave
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        bytes memory sigA = _sigReceipt(a, signerPk);
        bytes memory sigB = _sigReceipt(b, signerPk);

        uint256 reporterBefore = usdc.balanceOf(address(this));
        sessionPay.reportEquivocation(a, sigA, b, sigB);

        assertTrue(bond.banned(operator));
        assertEq(bond.bondOf(operator), 0);
        assertEq(usdc.balanceOf(address(this)) - reporterBefore, 500e6); // moitié au dénonciateur
        assertEq(usdc.balanceOf(user), 1_000_000e6 - 1000e6 + 500e6); // moitié à la victime (propriétaire)
    }

    function test_rotateKey() public {
        address newKey = makeAddr("newKey");
        vm.prank(user);
        sessionPay.rotateKey(sessionId, newKey);
        assertEq(sessionPay.getSession(sessionId).sessionKey, newKey);
    }

    // =====================================================================================
    // PLAN-BUILD §9 — tests négatifs ajoutés le 7/11 (reçus, sessions, clés, plafonds, saisie).
    // Bloc courant = 1000 après setUp (enclave `signer` inscrite à ce bloc) ; ancrages en littéraux.
    // Signatures toujours calculées AVANT vm.expectRevert (le getter RECEIPT_TYPEHASH est un appel).
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

    /// @dev Session sur l'enclave de l'opérateur (`signer` pour operator, `signer2Pk` pour operator2).
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

    /// @dev v2.1 ter : la session `sid` (enclave `signer`) règle `units` unités. Une session qui n'a rien payé n'écrit plus
    ///      de verdict à la fermeture : les tests du verdict de fermeture règlent d'abord.
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

    /// §9 « reçu modifié » : un reçu authentique dont un champ est changé après signature est refusé.
    function test_settleRevertModifiedReceipt() public {
        SessionPay.Receipt memory inflated = _receiptFor(sessionId, 1, 10, 1000);
        bytes memory sig = _sigReceipt(inflated, signerPk); // signé par la vraie enclave
        inflated.cumulativeUnits = 900; // l'opérateur gonfle le cumul après coup
        vm.expectRevert(SessionPay.InactiveEnclave.selector); // la signature ne recouvre plus l'enclave
        sessionPay.settle(inflated, sig);

        SessionPay.Receipt memory swapped = _receiptFor(sessionId, 1, 10, 1000);
        bytes memory sig2 = _sigReceipt(swapped, signerPk);
        swapped.responseHash = keccak256("autre reponse"); // réponse substituée
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(swapped, sig2);
        assertEq(sessionPay.getSession(sessionId).paid, 0);
    }

    /// §9 « reçu d'une autre session » : un reçu authentique de la session B ne paie pas la session A.
    function test_settleRevertReceiptFromOtherSession() public {
        uint256 sidB = _openSession(hunterPk, operator, makeAddr("skB"), 500e6, 0, keccak256("open-B"));
        SessionPay.Receipt memory rB = _receiptFor(sidB, 1, 300, 1000);
        bytes memory sigB = _sigReceipt(rB, signerPk);

        SessionPay.Receipt memory relabeled = _receiptFor(sidB, 1, 300, 1000);
        relabeled.sessionId = sessionId; // rejoué contre la session A
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(relabeled, sigB);

        // contre-épreuve : il ne paie que SA session
        sessionPay.settle(rB, sigB);
        assertEq(sessionPay.getSession(sidB).paid, 300e6);
        assertEq(sessionPay.getSession(sessionId).paid, 0);
    }

    /// §9 « reçu d'une autre session » (autre opérateur) : l'enclave d'un opérateur ne facture pas une
    /// session servie par un autre opérateur, même pour le même produit.
    function test_settleRevertReceiptForOtherOperatorsSession() public {
        _bondOperator(op2Pk, 1000e6);
        _registerEnclave(productId, op2Pk, signer2Pk, "s2");
        uint256 sid2 = _openSession(hunterPk, operator2, makeAddr("sk-op2"), 500e6, 0, keccak256("open-op2"));
        SessionPay.Receipt memory r = _receiptFor(sid2, 1, 100, 1000);
        bytes memory sig = _sigReceipt(r, signerPk); // enclave d'`operator`, pas d'`operator2`
        vm.expectRevert(SessionPay.WrongOperator.selector);
        sessionPay.settle(r, sig);
    }

    /// §9 « enclave expirée » (v2, en blocs) : fenêtre [1000, 5999], grâce jusqu'au bloc 9999. Un reçu
    /// ancré APRÈS la fenêtre n'est jamais payé ; un reçu ancré DANS la fenêtre se règle pendant la grâce,
    /// plus après (sans réattestation).
    function test_settleRevertExpiredEnclave() public {
        SessionPay.Receipt memory inWindow = _receiptFor(sessionId, 1, 10, 5999);
        SessionPay.Receipt memory afterExpiry = _receiptFor(sessionId, 2, 20, 6000);
        bytes memory sigIn = _sigReceipt(inWindow, signerPk);
        bytes memory sigAfter = _sigReceipt(afterExpiry, signerPk);

        vm.roll(9999); // dernier bloc de la grâce
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(afterExpiry, sigAfter);

        uint256 snap = vm.snapshotState();
        sessionPay.settle(inWindow, sigIn);
        assertEq(sessionPay.getSession(sessionId).paid, 10e6);
        vm.revertToState(snap);

        vm.roll(10_000); // grâce écoulée
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(inWindow, sigIn);
    }

    /// Correction 4 (bout en bout) : un renouvellement de l'enclave ne rend pas impayable le dernier reçu
    /// d'une session ancré AVANT le renouvellement.
    function test_settleReceiptAnchoredBeforeRenewal() public {
        SessionPay.Receipt memory r = _receiptFor(sessionId, 1, 10, 1005);
        bytes memory sig = _sigReceipt(r, signerPk);
        vm.roll(1010);
        bytes memory renewQuote = abi.encodePacked("quote-renew-sp");
        bytes32 x25519 = keccak256(abi.encodePacked("x25519", bytes32("s1"))); // même dérivation que Base
        module.setMeasurements(renewQuote, _measurements(productId, operator, signer, x25519, 1009, false));
        vm.prank(operator);
        registry.registerEnclave(productId, renewQuote, 1009, signer, x25519, ""); // renouvellement à 1010
        sessionPay.settle(r, sig);
        assertEq(sessionPay.getSession(sessionId).paid, 10e6);
    }

    /// §9 « enclave invalidée » : reçu ancré au bloc d'invalidation ou après → refus ; ancré avant → payé
    /// (voulu : SPEC-TECH C2 « non invalidée avant ce bloc »).
    function test_settleRevertInvalidatedEnclave() public {
        SessionPay.Receipt memory early = _receiptFor(sessionId, 1, 10, 1005);
        SessionPay.Receipt memory late = _receiptFor(sessionId, 2, 20, 1010);
        bytes memory sigEarly = _sigReceipt(early, signerPk);
        bytes memory sigLate = _sigReceipt(late, signerPk);

        vm.roll(1010);
        bytes memory quote = abi.encodePacked("quote", bytes32("s1")); // quote d'inscription (Base)
        IAttestationModule.Measurements memory bad; // le collatéral actuel ne le valide plus
        module.setMeasurements(quote, bad);
        registry.invalidate(signer, quote); // deactivatedAtBlock = 1010

        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(late, sigLate);

        sessionPay.settle(early, sigEarly);
        assertEq(sessionPay.getSession(sessionId).paid, 10e6);
    }

    /// §9 « requête signée par une clé révoquée ». La signature des REQUÊTES par la clé de session est
    /// vérifiée DANS l'enclave (O2 lit `sessionKey` on-chain à chaque requête) : aucun chemin on-chain ne
    /// l'accepte. On verrouille ici ce dont l'enclave dépend : après rotateKey la clé en cours change, la
    /// clé révoquée ne peut ni reprendre la main ni régler quoi que ce soit.
    function test_rotateKeyRevokesOldKey() public {
        (address oldKey, uint256 oldKeyPk) = makeAddrAndKey("old-session-key");
        uint256 sid = _openSession(userPk, operator, oldKey, 100e6, 0, keccak256("open-rot"));
        address newKey = makeAddr("new-session-key");
        vm.prank(user);
        sessionPay.rotateKey(sid, newKey);
        assertEq(sessionPay.getSession(sid).sessionKey, newKey);

        // la clé révoquée (volée) ne peut pas se réinstaller : seule la propriétaire tourne la clé
        vm.prank(oldKey);
        vm.expectRevert(SessionPay.NotOwner.selector);
        sessionPay.rotateKey(sid, oldKey);

        // et elle n'a aucune autorité de règlement
        SessionPay.Receipt memory r = _receiptFor(sid, 1, 10, 1000);
        bytes memory sig = _sigReceipt(r, oldKeyPk);
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        sessionPay.settle(r, sig);
    }

    /// Révocation par closeSession : session close → plus de règlement ni de rotation.
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

    /// §9 « session vide » : un reçu au-delà du dépôt ne paie jamais plus que le dépôt, et ne touche pas
    /// aux dépôts des autres sessions (le contrat détient tous les dépôts en commun).
    function test_settleEmptySessionNeverPaysBeyondDeposit() public {
        uint256 sid = _openSession(hunterPk, operator, makeAddr("sk-small"), 10e6, 0, keccak256("open-small"));
        uint256 poolBefore = usdc.balanceOf(address(sessionPay)); // 1000e6 (session A) + 10e6

        SessionPay.Receipt memory over = _receiptFor(sid, 1, 15, 1000); // 15 USDC servis, 10 déposés
        sessionPay.settle(over, _sigReceipt(over, signerPk));
        assertEq(sessionPay.getSession(sid).paid, 10e6);

        SessionPay.Receipt memory more = _receiptFor(sid, 2, 40, 1000); // session vide : plus rien
        sessionPay.settle(more, _sigReceipt(more, signerPk));
        assertEq(sessionPay.getSession(sid).paid, 10e6);

        assertEq(usdc.balanceOf(address(sessionPay)), poolBefore - 10e6);
        assertEq(usdc.balanceOf(address(sessionPay)), sessionPay.getSession(sessionId).deposit);
        assertEq(_closeAfterExpiry(sid, hunter), 0);
    }

    /// Plafond de la clé (cap) : la session ne paie jamais au-delà de son plafond ; le reste est rendu.
    function test_settleRespectsSessionCap() public {
        uint256 sid = _openSession(hunterPk, operator, makeAddr("sk-cap"), 100e6, 30e6, keccak256("open-cap"));
        SessionPay.Receipt memory r = _receiptFor(sid, 1, 50, 1000);
        sessionPay.settle(r, _sigReceipt(r, signerPk));
        assertEq(sessionPay.getSession(sid).paid, 30e6);
        assertEq(_closeAfterExpiry(sid, hunter), 70e6);
    }

    /// §9 « montant au-dessus du plafond d'une seule enclave » (C4) : un règlement ne libère pas plus de la
    /// moitié de la caution disponible sur 24 h (caution 1 000 USDC → 500 au plus).
    function test_settleRevertAboveSingleEnclaveExposure() public {
        SessionPay.Receipt memory r = _receiptFor(sessionId, 1, 600, 1000); // 600 USDC dus
        bytes memory sig = _sigReceipt(r, signerPk);
        vm.expectRevert(OperatorBond.TooMuchExposure.selector);
        sessionPay.settle(r, sig);
    }

    /// §9 bout en bout (inférence) : 100 appels → 100 reçus cumulatifs → UN règlement → reste remboursé.
    function test_hundredCallsOneSettlement() public {
        SessionPay.Receipt memory last;
        for (uint64 i = 1; i <= 100; i++) {
            last = _receiptFor(sessionId, i, uint128(i) * 3, 1000); // 3 unités par appel
        }
        uint256 opBefore = usdc.balanceOf(operator);
        sessionPay.settle(last, _sigReceipt(last, signerPk));
        assertEq(sessionPay.getSession(sessionId).paid, 300e6);
        assertEq(sessionPay.getSession(sessionId).paidUnits, 300);
        assertEq(usdc.balanceOf(operator) - opBefore, 240e6); // 80 %
        assertEq(_closeAfterExpiry(sessionId, user), 700e6);
    }

    /// §9 « écriture ERC-8004 refusée sur un chemin de saisie (la saisie passe quand même) ».
    function test_slashGoesThroughWhenErc8004WriteFails() public {
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        bytes memory sigA = _sigReceipt(a, signerPk);
        bytes memory sigB = _sigReceipt(b, signerPk);
        validation.setShouldRevert(true); // le registre de validation ERC-8004 refuse l'écriture

        uint256 reporterBefore = usdc.balanceOf(address(this));
        sessionPay.reportEquivocation(a, sigA, b, sigB);

        assertTrue(bond.banned(operator));
        assertEq(bond.bondOf(operator), 0);
        assertEq(usdc.balanceOf(address(this)) - reporterBefore, 500e6);
        assertEq(validation.responses(), 0); // aucune entrée écrite, et la saisie a eu lieu
    }

    // =====================================================================================
    // v2 — corrections 6, 7, 8, 10 (prix verrouillé, verdict par session, drapeau honnête, plafond produit)
    // =====================================================================================

    /// @dev Change le prix du produit par le chemin normal (proposeUpdate → timelock → applyUpdate).
    function _changePrice(uint256 newPrice) internal {
        products.proposeUpdate(productId, keccak256("manifest"), newPrice, MODEL); // ce contrat est l'auteur
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.applyUpdate(productId);
        assertEq(products.getProduct(productId).price, newPrice);
    }

    /// Correction 6 : le prix est VERROUILLÉ à l'ouverture. Une hausse après l'ouverture ne requalifie pas
    /// rétroactivement la session ; seules les sessions ouvertes après la hausse paient le nouveau prix.
    function test_priceLockedAtOpen_increaseHasNoEffect() public {
        assertEq(sessionPay.getSession(sessionId).price, 1e6);
        SessionPay.Receipt memory r1 = _receiptFor(sessionId, 1, 10, 1000);
        sessionPay.settle(r1, _sigReceipt(r1, signerPk)); // 10 × 1 USDC

        _changePrice(3e6); // le prix du produit triple après l'ouverture

        SessionPay.Receipt memory r2 = _receiptFor(sessionId, 2, 25, 1000);
        sessionPay.settle(r2, _sigReceipt(r2, signerPk));
        SessionPay.Session memory s = sessionPay.getSession(sessionId);
        assertEq(s.price, 1e6, "prix verrouille");
        assertEq(s.paid, 25e6, "25 x 1 USDC, pas 25 x 3 (v1 : 75)");

        uint256 sid2 = _openSession(hunterPk, operator, makeAddr("sk-after-raise"), 100e6, 0, keccak256("open-raise"));
        assertEq(sessionPay.getSession(sid2).price, 3e6, "une session ouverte apres la hausse paie le nouveau prix");
    }

    /// Correction 6 : une baisse de prix ne fait plus revert le règlement suivant (v1 : dû = 15 × 0,5 = 7,5
    /// < 10 déjà payés → soustraction négative, revert jusqu'à ce que le cumul rattrape).
    function test_priceLockedAtOpen_decreaseDoesNotRevert() public {
        SessionPay.Receipt memory r1 = _receiptFor(sessionId, 1, 10, 1000);
        sessionPay.settle(r1, _sigReceipt(r1, signerPk)); // 10e6 payés

        _changePrice(0.5e6);

        SessionPay.Receipt memory r2 = _receiptFor(sessionId, 2, 15, 1000);
        sessionPay.settle(r2, _sigReceipt(r2, signerPk));
        assertEq(sessionPay.getSession(sessionId).paid, 15e6); // 15 × 1 USDC (prix verrouillé)
    }

    /// Correction 7 : le requestHash ERC-8004 du verdict d'une session porte son sessionId. Deux sessions du
    /// même propriétaire sur le même produit écrivent deux entrées distinctes (v1 : le même hash).
    function test_verdictRequestHashIncludesSessionId() public {
        uint256 sid2 = _openSession(userPk, operator, makeAddr("sk-2"), 100e6, 0, keccak256("open-2"));
        _settleUnits(sessionId, 10); // v2.1 ter : deux sessions qui ont payé (sinon, aucun verdict)
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
        // v2.1 : le requestHash commence par (block.chainid, address(this)) — mis à jour avec le changement voulu
        assertEq(hashes[0], keccak256(abi.encode(block.chainid, address(sessionPay), "session", sessionId, productId, user)));
        assertEq(hashes[1], keccak256(abi.encode(block.chainid, address(sessionPay), "session", sid2, productId, user)));
        assertTrue(sessionPay.getSession(sessionId).verdictWritten);
        assertTrue(sessionPay.getSession(sid2).verdictWritten);
    }

    /// Correction 8 : sur le chemin d'équivocation, verdictWritten ne passe à vrai que si l'écriture ERC-8004
    /// a réussi. La fermeture n'écrit jamais « 100 vérifié » pour un opérateur radié ; un nouveau
    /// signalement de la même preuve retente le verdict de faute (la saisie, elle, ne prend plus rien).
    function test_equivocationVerdictFlagOnlyWhenWritten() public {
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        bytes memory sigA = _sigReceipt(a, signerPk);
        bytes memory sigB = _sigReceipt(b, signerPk);
        _settleUnits(sessionId, 10); // v2.1 ter : la session a payé ; c'est bien la radiation qui écarte le 100

        validation.setShouldRevert(true); // le registre ERC-8004 refuse l'écriture
        sessionPay.reportEquivocation(a, sigA, b, sigB);
        assertTrue(bond.banned(operator));
        assertFalse(sessionPay.getSession(sessionId).verdictWritten, "ecriture echouee : drapeau non pose");

        validation.setShouldRevert(false);
        assertEq(_closeAfterExpiry(sessionId, user), 1000e6 - 10e6);
        assertEq(validation.responses(), 0, "pas de verdict 100 pour un operateur radie");
        assertFalse(sessionPay.getSession(sessionId).verdictWritten);

        uint256 reporterBefore = usdc.balanceOf(address(this));
        sessionPay.reportEquivocation(a, sigA, b, sigB); // nouveau signalement : retente le verdict de faute
        assertEq(usdc.balanceOf(address(this)), reporterBefore, "rien a saisir une deuxieme fois");
        assertEq(validation.responses(), 1);
        assertTrue(sessionPay.getSession(sessionId).verdictWritten);
    }

    /// Correction 8, contre-épreuve : écriture réussie → drapeau posé, pas de second verdict à la fermeture.
    function test_equivocationVerdictWrittenOnce() public {
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        _settleUnits(sessionId, 10); // v2.1 ter : la session a payé ; la fermeture n'ajoute pas de 100 après la faute
        sessionPay.reportEquivocation(a, _sigReceipt(a, signerPk), b, _sigReceipt(b, signerPk));
        assertTrue(sessionPay.getSession(sessionId).verdictWritten);
        assertEq(validation.responses(), 1);
        _closeAfterExpiry(sessionId, user);
        assertEq(validation.responses(), 1);
    }

    /// Correction 10 : le plafond d'exposition du produit (50 USDC par opérateur et par 24 h) s'applique en
    /// plus de « ½ caution disponible » (500 USDC ici) ; la fenêtre suivante remet le compteur à zéro.
    function test_settleRespectsProductExposureCap() public {
        productId = _proposeAndActivate(address(sessionPay), false, MODEL, 1e6, 100e6, 50e6);
        _registerEnclave(productId, opPk, 0x6161, "cap"); // enclave dédiée, bloc 1000
        uint256 sid =
            _openSessionWith(vm.addr(0x6161), hunterPk, operator, makeAddr("sk-cap-p"), 200e6, 0, keccak256("open-cap-p"));

        SessionPay.Receipt memory r1 = _receiptFor(sid, 1, 30, 1000);
        SessionPay.Receipt memory r2 = _receiptFor(sid, 2, 55, 1000);
        bytes memory sig1 = _sigReceipt(r1, 0x6161);
        bytes memory sig2 = _sigReceipt(r2, 0x6161);

        sessionPay.settle(r1, sig1); // 30 ≤ 50
        vm.expectRevert(OperatorBond.ExposureCapExceeded.selector); // 30 + 25 > 50
        sessionPay.settle(r2, sig2);

        vm.warp(vm.getBlockTimestamp() + 36 hours + 1); // v2 : 24 h GLISSANTES, l'exposition compte ≤ 36 h
        sessionPay.settle(r2, sig2);
        assertEq(sessionPay.getSession(sid).paid, 55e6);
        assertEq(bond.exposureOf(operator, productId), 25e6);
    }
    // =====================================================================================
    // v2 bis — revue adverse du 7/11 : produit et enclave de la session, échéance, modèle verrouillé
    // =====================================================================================

    /// FIXED : une session ne s'ouvre que sur un produit réglé par SessionPay (ou les tentatives de la Prime
    /// scellée), jamais au prix 0.
    function test_FIXED_openOnlyOnOwnProductsAtNonZeroPrice() public {
        uint256 x402Product = _proposeAndActivate(address(x402), false, MODEL, 1e6, 100e6, 0);
        productId = x402Product;
        vm.expectRevert(SessionPay.WrongSettlement.selector);
        this.openFor(signer, 10e6, keccak256("o-x402"));

        uint256 free = _proposeAndActivate(address(sessionPay), false, MODEL, 0, 100e6, 0);
        productId = free;
        vm.expectRevert(SessionPay.ZeroPrice.selector);
        this.openFor(signer, 10e6, keccak256("o-free"));

        // tentatives payantes de la Prime scellée : produit réglé par SealedBounty, prix 0,01 USDC par tentative
        uint256 attempts = _proposeAndActivate(address(sealedBounty), true, bytes32(0), 10_000, 100e6, 0);
        (address bountyEnclave,) = _registerEnclave(attempts, opPk, 0x7171, "att");
        productId = attempts;
        uint256 sid = this.openFor(bountyEnclave, 1e6, keccak256("o-att"));
        assertEq(sessionPay.getSession(sid).price, 10_000);
    }

    /// FIXED : l'enclave désignée doit être active pour ce produit, chez l'opérateur annoncé, cautionné et non radié.
    function test_FIXED_openRequiresActiveEnclaveOfAnnouncedOperator() public {
        vm.expectRevert(SessionPay.InactiveEnclave.selector);
        this.openFor(makeAddr("pas-une-enclave"), 10e6, keccak256("o-none"));

        UsdcPayer.Auth memory auth = _usdcAuth(userPk, address(sessionPay), 10e6, keccak256("o-wrong-op"));
        SessionPay.OpenParams memory q = SessionPay.OpenParams({
            productId: productId,
            operator: operator2, // l'enclave est celle d'`operator`
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

        // opérateur radié (équivocation prouvée) : plus de nouvelle session
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        sessionPay.reportEquivocation(a, _sigReceipt(a, signerPk), b, _sigReceipt(b, signerPk));
        vm.expectRevert(SessionPay.OperatorUnderbonded.selector);
        this.openFor(signer, 10e6, keccak256("o-banned"));
    }

    /// FIXED : échéance dans [maintenant + 10 min, maintenant + 30 jours].
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

    /// FIXED : seule l'enclave liée à la session est payée ; une 2e enclave du même opérateur ne l'est pas.
    function test_FIXED_onlyBoundEnclaveIsPaid() public {
        _registerEnclave(productId, opPk, 0x5353, "s3"); // 2e enclave d'`operator`, même produit
        SessionPay.Receipt memory r = _receiptFor(sessionId, 1, 10, 1000);
        bytes memory sig = _sigReceipt(r, 0x5353);
        vm.expectRevert(SessionPay.WrongEnclave.selector);
        sessionPay.settle(r, sig);
        sessionPay.settle(r, _sigReceipt(r, signerPk)); // l'enclave de la session : payée
        assertEq(sessionPay.getSession(sessionId).paid, 10e6);
    }

    /// FIXED : le modèle est verrouillé à l'ouverture, comme le prix et l'unité.
    function test_FIXED_modelAndUnitLockedAtOpen() public {
        SessionPay.Session memory s0 = sessionPay.getSession(sessionId);
        assertEq(s0.param, MODEL);
        assertEq(s0.enclave, signer);
        assertEq(s0.unitTokens, 1);
        assertEq(s0.outWeight, 1);

        products.proposeUpdate(productId, keccak256("manifest-v2"), 1e6, keccak256("Qwen3-8B"));
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.applyUpdate(productId);

        SessionPay.Receipt memory r = _receiptFor(sessionId, 1, 10, 1000); // ancien modèle, session d'avant
        sessionPay.settle(r, _sigReceipt(r, signerPk));
        assertEq(sessionPay.getSession(sessionId).paid, 10e6);

        uint256 sid2 = _openSession(hunterPk, operator, makeAddr("sk-new-model"), 100e6, 0, keccak256("o-new"));
        SessionPay.Receipt memory old = _receiptFor(sid2, 1, 10, 1000); // l'ancien modèle sur une session d'après
        bytes memory sigOld = _sigReceipt(old, signerPk);
        vm.expectRevert(SessionPay.ModelMismatch.selector);
        sessionPay.settle(old, sigOld);
    }

    /// v2 : la fermeture anticipée n'est permise que lorsque l'enclave liée ne peut plus rien régler.
    function test_closeEarlyOnlyWhenBoundEnclaveCanNoLongerSettle() public {
        uint256 sid = _openSessionUntil(
            signer, hunterPk, operator, makeAddr("sk-early"), 100e6, 0, keccak256("o-early"), uint64(vm.getBlockTimestamp() + 30 days)
        );
        SessionPay.Receipt memory r = _receiptFor(sid, 1, 10, 1000);
        bytes memory sig = _sigReceipt(r, signerPk);
        vm.roll(1010);
        vm.prank(operator);
        registry.retire(signer); // coupée à 1009, réglable jusqu'au bloc 1009 + grâce

        vm.prank(hunter);
        vm.expectRevert(SessionPay.NotExpired.selector);
        sessionPay.closeSession(sid);

        sessionPay.settle(r, sig); // l'opérateur règle pendant la grâce
        vm.roll(1009 + TEST_GRACE_BLOCKS + 1);
        vm.prank(hunter);
        sessionPay.closeSession(sid); // plus rien de réglable : fermeture avant l'échéance
        assertTrue(sessionPay.getSession(sid).closed);
        assertEq(sessionPay.getSession(sid).paid, 10e6);
    }

    // ---- aides appelées par `this.` (pour vm.expectRevert sur l'appel au contrat) ----

    function openFor(address enclave, uint256 deposit, bytes32 nonce) external returns (uint256) {
        return _openSessionWith(enclave, userPk, operator, sessionKey, deposit, 0, nonce);
    }

    function openUntil(uint64 expiresAt, bytes32 nonce) external returns (uint256) {
        return _openSessionUntil(signer, userPk, operator, sessionKey, 10e6, 0, nonce, expiresAt);
    }
    // =====================================================================================
    // v2 bis — le verdict ERC-8004 ne saute plus au gaz minimal (eth_estimateGas). Confirmé sur Arc testnet le 7/11 :
    // closeSession(13), limite 93 765 (estimation du portefeuille), aucun Recorded ; closeSession(3), 335 119, écrit.
    // =====================================================================================

    /// FIXED : au gaz MINIMAL qui fait réussir closeSession — ce que choisit un portefeuille —, le verdict est écrit.
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

    /// FIXED : un gaz juste au-dessus du chemin SANS verdict (ce qu'estimait le portefeuille avant le correctif) est
    /// refusé (InsufficientGasForVerdict) : la session reste ouverte ; avec un gaz ample, elle se ferme avec son verdict.
    function test_FIXED_v2_closeJustAboveNoVerdictPathReverts() public {
        _emulateArcVerdictCost();
        _settleUnits(sessionId, 10); // v2.1 ter : la session a payé (sinon, la fermeture n'a aucun verdict à écrire)
        vm.warp(uint256(sessionPay.getSession(sessionId).expiresAt) + sessionPay.SETTLE_GRACE());
        bytes memory call = abi.encodeCall(SessionPay.closeSession, (sessionId));

        // gaz consommé par le chemin SANS verdict (le registre refuse aussitôt : appelant retiré), puis annulé
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
        sessionPay.closeSession(sessionId); // gaz ample
        assertTrue(sessionPay.getSession(sessionId).closed);
        assertEq(validation.responses(), before + 1);
    }

    /// FIXED : la saisie pour équivocation au gaz minimal écrit aussi son verdict de faute.
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

    // ---- v2.1 : requestHash lié à la chaîne et au contrat ; VerdictSkipped quand l'écriture échoue ----

    /// v2.1 : le requestHash du verdict commence par (block.chainid, address(this)) : la même session (même numéro, même
    /// propriétaire, même produit) d'un autre déploiement, ou sur une autre chaîne, n'écrit plus la même entrée.
    function test_v21_verdictRequestHashBoundToChainAndContract() public {
        bytes32 expected =
            keccak256(abi.encode(block.chainid, address(sessionPay), "session", sessionId, productId, user));
        assertTrue(expected != keccak256(abi.encode("session", sessionId, productId, user)), "differe de la v2");
        _settleUnits(sessionId, 10); // v2.1 ter : la session a payé (sinon, aucun verdict)
        _warpPastClose(sessionId);
        vm.expectEmit(true, true, false, true, address(verdict));
        emit VerdictLog.Recorded(0, expected, 100, "tdx-dcap/inference");
        vm.prank(user);
        sessionPay.closeSession(sessionId);
        assertTrue(sessionPay.getSession(sessionId).verdictWritten);

        // même contrat, autre chaîne : autre requestHash
        uint256 sid2 = _openSession(userPk, operator, makeAddr("sk-chain"), 100e6, 0, keccak256("open-chain"));
        _settleUnits(sid2, 10); // réglée AVANT le changement de chaîne (le domaine EIP-712 des reçus porte la chaîne)
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

    /// v2.1 : un verdict qui échoue malgré son gaz (registre ERC-8004 en panne) laisse une trace : VerdictSkipped, avec
    /// le requestHash et la raison ; la fermeture rembourse quand même, le drapeau reste faux.
    function test_v21_closeEmitsVerdictSkippedWhenRegistryFails() public {
        _settleUnits(sessionId, 10); // v2.1 ter : la session a payé (sinon, aucun verdict n'est tenté)
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

    // ---- v2.1 ter : une session qui n'a rien payé n'a pas de verdict ----

    /// @dev = SessionPay.VerdictNotApplicable (v2.1 ter), redéclaré : ce fichier compile aussi contre la v2.1 bis.
    event VerdictNotApplicable(uint256 indexed sessionId);

    /// v2.1 ter : fermée sans aucun règlement, la session rembourse tout et n'écrit aucun verdict, sans même le tenter (pas
    /// de réserve VERDICT_GAS : le gaz minimal reste bien en dessous) ; VerdictNotApplicable(sessionId) le trace, juste
    /// avant SessionClosed. v2.1 bis : un « 100 » ERC-8004 pour une session que personne n'a payée.
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

    /// v2.1 : même chose sur le chemin d'équivocation (la saisie a lieu ; le verdict de faute sauté est tracé).
    function test_v21_equivocationEmitsVerdictSkippedWhenRegistryFails() public {
        SessionPay.Receipt memory a = _receipt(5, MODEL, keccak256("respA"), 10);
        SessionPay.Receipt memory b = _receipt(5, MODEL, keccak256("respB"), 10);
        bytes memory sigA = _sigReceipt(a, signerPk);
        bytes memory sigB = _sigReceipt(b, signerPk);
        verdict.removeCaller(address(sessionPay)); // VerdictLog refuse l'appelant (NotCaller)
        bytes32 rh = keccak256(abi.encode(block.chainid, address(sessionPay), "equivocation", sessionId, uint64(5)));
        vm.expectEmit(true, false, false, true, address(sessionPay));
        emit SessionPay.VerdictSkipped(rh, abi.encodeWithSelector(VerdictLog.NotCaller.selector));
        sessionPay.reportEquivocation(a, sigA, b, sigB);
        assertTrue(bond.banned(operator));
        assertFalse(sessionPay.getSession(sessionId).verdictWritten);
    }
}
