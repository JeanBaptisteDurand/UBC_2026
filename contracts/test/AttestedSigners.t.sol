// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {AttestedBatchVerifier} from "../src/demo/AttestedBatchVerifier.sol";
import {AttestedSigners, AttestedSignersLib} from "../src/attested/AttestedSigners.sol";
import {IEnclaveRegistry} from "../src/interfaces/IEnclaveRegistry.sol";

/// @dev Le cas le plus simple : un contrat qui reçoit un message signé, protégé par le modificateur onlyAttested.
contract AttestedInbox is AttestedSigners {
    uint256 public immutable productId;
    mapping(bytes32 => address) public signerOf;

    constructor(IEnclaveRegistry registry_, uint256 productId_) AttestedSigners(registry_) {
        productId = productId_;
    }

    function digestOf(bytes32 message) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), productId, message));
    }

    function post(bytes32 message, bytes calldata signature)
        external
        onlyAttested(productId, digestOf(message), signature)
    {
        signerOf[message] = _attestedSigner();
    }
}

/// @notice v2.1 — la primitive onlyAttested (AttestedSigners) et sa démonstration « façon Gateway »
///         (AttestedBatchVerifier) : une clé d'enclave attestée est acceptée ; une clé hors enclave, une enclave d'un
///         autre produit, retirée, expirée, invalidée, ou d'un opérateur radié, est refusée.
contract AttestedSignersTest is Base {
    uint256 productId;
    address signer;
    AttestedBatchVerifier verifier;
    AttestedInbox inbox;

    function setUp() public override {
        super.setUp();
        _bondOperator(opPk, 1000e6);
        productId = _proposeAndActivate(address(sessionPay), false, bytes32("model"), 1e6, 100e6, 100_000e6);
        (signer,) = _registerEnclave(productId, opPk, signerPk, "att"); // fenêtre [1000, 5999]
        verifier = new AttestedBatchVerifier(registry, productId);
        inbox = new AttestedInbox(registry, productId);
    }

    // ---- aides ----

    function _items(uint256 n, bytes32 salt) internal pure returns (bytes32[] memory it) {
        it = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            it[i] = keccak256(abi.encode(salt, i));
        }
    }

    function _sigBatch(uint256 pk, uint64 seq, bytes32[] memory items, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sign(pk, verifier.batchDigest(seq, keccak256(abi.encodePacked(items)), deadline));
    }

    function _deadline() internal view returns (uint64) {
        return uint64(vm.getBlockTimestamp() + 1 hours);
    }

    // ---- accepté ----

    /// Clé attestée (enclave active du produit) : le lot est accepté, numéroté, et l'événement nomme l'enclave.
    function test_attestedKey_batchAccepted() public {
        bytes32[] memory items = _items(3, "lot-0");
        uint64 dl = _deadline();
        bytes memory sig = _sigBatch(signerPk, 0, items, dl);

        vm.expectEmit(true, true, true, true, address(verifier));
        emit AttestedBatchVerifier.BatchAccepted(0, keccak256(abi.encodePacked(items)), signer, 3);
        uint256 g = gasleft();
        verifier.submitBatch(0, dl, items, sig);
        uint256 used = g - gasleft();

        assertEq(verifier.nextSeq(), 1);
        assertEq(verifier.batchOf(0), keccak256(abi.encodePacked(items)));
        emit log_named_uint("AttestedBatchVerifier.submitBatch (3 elements), gaz", used);

        // la primitive seule rend le signataire
        bytes32 d = verifier.batchDigest(7, bytes32("x"), dl);
        g = gasleft();
        assertEq(verifier.requireAttestedSig(productId, d, _sign(signerPk, d)), signer);
        emit log_named_uint("requireAttestedSig (appel externe), gaz", g - gasleft());
    }

    /// Le modificateur seul (AttestedInbox) : le corps lit l'enclave signataire.
    function test_modifier_bodySeesSigner() public {
        bytes32 msg_ = keccak256("bonjour");
        inbox.post(msg_, _sign(signerPk, inbox.digestOf(msg_)));
        assertEq(inbox.signerOf(msg_), signer);
    }

    // ---- refusé ----

    /// Clé HORS enclave (jamais inscrite) : refusée, avec son adresse.
    function test_nonEnclaveKey_refused() public {
        bytes32[] memory items = _items(2, "lot-x");
        uint64 dl = _deadline();
        bytes memory sig = _sigBatch(userPk, 0, items, dl);
        vm.expectRevert(abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, user));
        verifier.submitBatch(0, dl, items, sig);

        bytes32 msg_ = keccak256("intrus");
        bytes memory s2 = _sign(userPk, inbox.digestOf(msg_));
        vm.expectRevert(abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, user));
        inbox.post(msg_, s2);
    }

    /// Enclave RETIRÉE par son opérateur : refusée dès le bloc du retrait.
    function test_retiredEnclave_refused() public {
        vm.prank(operator);
        registry.retire(signer);
        bytes32[] memory items = _items(1, "lot-r");
        uint64 dl = _deadline();
        bytes memory sig = _sigBatch(signerPk, 0, items, dl);
        vm.expectRevert(abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, signer));
        verifier.submitBatch(0, dl, items, sig);
    }

    /// Enclave EXPIRÉE (fenêtre de validité dépassée, même pendant la grâce de règlement) : refusée.
    function test_expiredEnclave_refused() public {
        vm.roll(6000); // fenêtre [1000, 5999] ; grâce jusqu'au bloc 9999 pour les reçus ANCRÉS avant, pas pour un message neuf
        bytes32[] memory items = _items(1, "lot-e");
        uint64 dl = _deadline();
        bytes memory sig = _sigBatch(signerPk, 0, items, dl);
        vm.expectRevert(abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, signer));
        verifier.submitBatch(0, dl, items, sig);
    }

    /// Image retirée par l'auteur → enclave invalidée sans grâce : refusée.
    function test_killedEnclave_refused() public {
        products.retireWorkload(productId, _workloadId());
        registry.invalidateRetiredWorkload(signer);
        bytes32[] memory items = _items(1, "lot-k");
        uint64 dl = _deadline();
        bytes memory sig = _sigBatch(signerPk, 0, items, dl);
        vm.expectRevert(abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, signer));
        verifier.submitBatch(0, dl, items, sig);
    }

    /// Enclave attestée, mais pour un AUTRE produit : refusée.
    function test_otherProductEnclave_refused() public {
        _bondOperator(op2Pk, 1000e6);
        uint256 other = _proposeAndActivate(address(sessionPay), false, bytes32("model-2"), 1e6, 100e6, 100_000e6);
        (address s2,) = _registerEnclave(other, op2Pk, signer2Pk, "autre");
        assertTrue(registry.isActiveAt(s2, other, vm.getBlockNumber()));
        bytes32[] memory items = _items(1, "lot-o");
        uint64 dl = _deadline();
        bytes memory sig = _sigBatch(signer2Pk, 0, items, dl);
        vm.expectRevert(abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, s2));
        verifier.submitBatch(0, dl, items, sig);
    }

    /// Opérateur RADIÉ (faute prouvée, caution saisie) : ses enclaves encore « actives » ne signent plus rien.
    function test_bannedOperator_refused() public {
        vm.prank(address(sessionPay)); // un contrat de règlement autorisé qui a prouvé une faute
        bond.slash(operator, address(this), user);
        assertTrue(bond.banned(operator));
        assertTrue(registry.isActiveAt(signer, productId, vm.getBlockNumber()), "toujours inscrite");
        bytes32[] memory items = _items(1, "lot-b");
        uint64 dl = _deadline();
        bytes memory sig = _sigBatch(signerPk, 0, items, dl);
        vm.expectRevert(abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, signer));
        verifier.submitBatch(0, dl, items, sig);
    }

    /// Lot modifié après signature : la signature ne désigne plus l'enclave.
    function test_tamperedBatch_refused() public {
        bytes32[] memory items = _items(2, "lot-t");
        uint64 dl = _deadline();
        bytes memory sig = _sigBatch(signerPk, 0, items, dl);
        items[1] = keccak256("element glisse");
        vm.expectPartialRevert(AttestedSignersLib.NotAttested.selector);
        verifier.submitBatch(0, dl, items, sig);
    }

    /// Signature illisible : NotAttested(0).
    function test_malformedSignature_refused() public {
        bytes32[] memory items = _items(1, "lot-m");
        uint64 dl = _deadline();
        vm.expectRevert(abi.encodeWithSelector(AttestedSignersLib.NotAttested.selector, address(0)));
        verifier.submitBatch(0, dl, items, new bytes(64));
    }

    /// Anti-rejeu et ordre : un lot ne passe qu'une fois, au numéro attendu ; un lot échu est refusé.
    function test_replayAndDeadline() public {
        bytes32[] memory items = _items(2, "lot-0");
        uint64 dl = _deadline();
        bytes memory sig = _sigBatch(signerPk, 0, items, dl);
        verifier.submitBatch(0, dl, items, sig);
        vm.expectRevert(abi.encodeWithSelector(AttestedBatchVerifier.BadSeq.selector, 1));
        verifier.submitBatch(0, dl, items, sig);

        bytes32[] memory items2 = _items(1, "lot-2");
        bytes memory sig2 = _sigBatch(signerPk, 2, items2, dl);
        vm.expectRevert(abi.encodeWithSelector(AttestedBatchVerifier.BadSeq.selector, 1));
        verifier.submitBatch(2, dl, items2, sig2); // trou : refusé

        uint64 past = uint64(vm.getBlockTimestamp() - 1);
        bytes memory sig3 = _sigBatch(signerPk, 1, items2, past);
        vm.expectRevert(AttestedBatchVerifier.BatchExpired.selector);
        verifier.submitBatch(1, past, items2, sig3);
    }
}
