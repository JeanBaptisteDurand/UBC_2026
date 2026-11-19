// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {SealedBounty} from "../src/SealedBounty.sol";
import {VerdictLog} from "../src/VerdictLog.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {UsdcPayer} from "../src/lib/UsdcPayer.sol";
import {DemoVault} from "../src/demo/DemoVault.sol";
import {History} from "../src/lib/History.sol";
import {IAttestationModule} from "../src/interfaces/IAttestationModule.sol";

contract SealedBountyTest is Base {
    bytes32 constant PREDICATE = keccak256("predicate-v0");

    uint256 productId;
    address signer;
    address signer2;
    uint256 bountyId;
    uint64 blockN;

    function setUp() public override {
        super.setUp();
        _bondOperator(opPk, 1000e6);
        _bondOperator(op2Pk, 1000e6);
        productId = _proposeAndActivate(address(sealedBounty), true, bytes32(0), 0, 100e6, 100_000e6);
        (signer,) = _registerEnclave(productId, opPk, signerPk, "s1");
        (signer2,) = _registerEnclave(productId, op2Pk, signer2Pk, "s2");
        vm.roll(1002); // pour ancrer une réclamation sur un bloc < tête et >= bloc d'inscription
        blockN = 1001; // littéral : l'optimiseur (via_ir) replie block.number lu après vm.roll dans la même fonction

        bountyId = _createBounty(200e6, 2, address(0)); // singleCap=200e6, k=2
    }

    function _createBounty(uint256 singleCap, uint8 k, address targetToPause) internal returns (uint256 id) {
        uint256[] memory minLoss = new uint256[](1);
        minLoss[0] = 1e6;
        uint256[] memory amount = new uint256[](1);
        amount[0] = 100e6;
        UsdcPayer.Auth memory auth = _usdcAuth(protocolPk, address(sealedBounty), 100_000e6, keccak256(abi.encodePacked("fund", singleCap, k, targetToPause)));
        SealedBounty.CreateParams memory q = SealedBounty.CreateParams({
            productId: productId,
            predicateHash: PREDICATE,
            protocolX25519: keccak256("protoX"),
            tierMinLoss: minLoss,
            tierAmount: amount,
            singleCap: singleCap,
            k: k,
            targetToPause: targetToPause,
            deadline: uint64(block.timestamp + 1 days),
            funding: 100_000e6,
            auth: auth
        });
        vm.prank(protocol);
        id = sealedBounty.createBounty(q);
    }

    function _claim(bytes32 fingerprint, bytes32 blockHashN, bytes32 cPHash) internal view returns (SealedBounty.Claim memory r) {
        r = SealedBounty.Claim({
            bountyId: bountyId,
            payee: hunter,
            blockN: blockN,
            blockHashN: blockHashN,
            predicateHash: PREDICATE,
            loss: 5e6,
            tier: 0,
            fingerprint: fingerprint,
            cPHash: cPHash,
            deadline: uint64(block.timestamp + 1 hours)
        });
    }

    function _goodBlockHash() internal view returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(uint256(blockN))));
    }

    function _sigClaim(SealedBounty.Claim memory r, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                sealedBounty.CLAIM_TYPEHASH(),
                r.bountyId,
                r.payee,
                r.blockN,
                r.blockHashN,
                r.predicateHash,
                r.loss,
                r.tier,
                r.fingerprint,
                r.cPHash,
                r.deadline
            )
        );
        return _sign(pk, _typed(address(sealedBounty), structHash));
    }

    function test_claimFlow() public {
        bytes memory cP = bytes("sealed-to-protocol");
        SealedBounty.Claim memory r = _claim(keccak256("fp1"), _goodBlockHash(), keccak256(cP));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sigClaim(r, signerPk);

        uint256 hunterBefore = usdc.balanceOf(hunter);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        sealedBounty.claim(r, sigs, cP);

        assertEq(usdc.balanceOf(hunter) - hunterBefore, 100e6); // le palier
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 10e6); // 10 % réseau
        assertTrue(sealedBounty.fingerprintPaid(bountyId, keccak256("fp1")));
        assertEq(validation.responses(), 1); // verdict ERC-8004
    }

    function test_claimRevertReplayFingerprint() public {
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r = _claim(keccak256("fp1"), _goodBlockHash(), keccak256(cP));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sigClaim(r, signerPk);
        sealedBounty.claim(r, sigs, cP);

        // rejouer la même empreinte
        bytes[] memory sigs2 = new bytes[](1);
        sigs2[0] = _sigClaim(r, signerPk);
        vm.expectRevert(SealedBounty.AlreadyPaid.selector);
        sealedBounty.claim(r, sigs2, cP);
    }

    function test_claimRevertAnchorMismatch() public {
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r = _claim(keccak256("fp2"), keccak256("wrong-hash"), keccak256(cP));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sigClaim(r, signerPk);
        vm.expectRevert(SealedBounty.AnchorMismatch.selector);
        sealedBounty.claim(r, sigs, cP);
    }

    function test_claimRevertCipherMismatch() public {
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r = _claim(keccak256("fp3"), _goodBlockHash(), keccak256("other"));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sigClaim(r, signerPk);
        vm.expectRevert(SealedBounty.CipherMismatch.selector);
        sealedBounty.claim(r, sigs, cP);
    }

    function test_needMoreEnclavesAboveCap() public {
        // prime avec un plafond d'une seule enclave sous le montant -> exige k=2 opérateurs distincts
        uint256 id = _createBounty(50e6, 2, address(0)); // singleCap=50e6 < 100e6
        bountyId = id;
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r = _claim(keccak256("fpk"), _goodBlockHash(), keccak256(cP));

        bytes[] memory one = new bytes[](1);
        one[0] = _sigClaim(r, signerPk);
        vm.expectRevert(SealedBounty.NeedMoreEnclaves.selector);
        sealedBounty.claim(r, one, cP);

        // deux opérateurs distincts -> payé
        bytes[] memory two = new bytes[](2);
        two[0] = _sigClaim(r, signerPk);
        two[1] = _sigClaim(r, signer2Pk);
        uint256 hunterBefore = usdc.balanceOf(hunter);
        sealedBounty.claim(r, two, cP);
        assertEq(usdc.balanceOf(hunter) - hunterBefore, 100e6);
    }

    function test_withdrawRemainingAfterDeadline() public {
        vm.warp(block.timestamp + 1 days + 1);
        uint256 before = usdc.balanceOf(protocol);
        vm.prank(protocol);
        sealedBounty.withdrawRemaining(bountyId);
        assertEq(usdc.balanceOf(protocol) - before, 100_000e6);
    }

    function test_pauseDemoVaultTarget() public {
        DemoVault vault = new DemoVault(address(usdc));
        uint256 id = _createBounty(200e6, 2, address(vault));
        bountyId = id;
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r = _claim(keccak256("fpv"), _goodBlockHash(), keccak256(cP));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sigClaim(r, signerPk);
        sealedBounty.claim(r, sigs, cP);
        assertTrue(vault.paused());
    }

    // =====================================================================================
    // tests négatifs ajoutés le 7/11 (réclamations, bloc N, enclaves, saisie).
    // Après setUp : enclaves `signer` (operator) et `signer2` (operator2) inscrites au bloc 1000,
    // bloc courant 1002, blockN = 1001, prime `bountyId` (palier 100 USDC, singleCap 200, k = 2).
    // v2 : les tests `test_FIXED_*` rejouent les cas de la revue adverse (corrigés dans src, prouvés ici).
    // Fenêtre de validité des enclaves : [1000, 5999], grâce jusqu'au bloc 9999 (cf. Base).
    // =====================================================================================

    function _claimAt(address payee, uint64 n, bytes32 fingerprint, uint256 loss, bytes32 cPHash, uint64 deadline)
        internal
        view
        returns (SealedBounty.Claim memory r)
    {
        r = SealedBounty.Claim({
            bountyId: bountyId,
            payee: payee,
            blockN: n,
            blockHashN: keccak256(abi.encodePacked(bytes32(uint256(n)))), // = MockHistory
            predicateHash: PREDICATE,
            loss: loss,
            tier: 0,
            fingerprint: fingerprint,
            cPHash: cPHash,
            deadline: deadline
        });
    }

    function _one(bytes memory sig) internal pure returns (bytes[] memory sigs) {
        sigs = new bytes[](1);
        sigs[0] = sig;
    }

    function _createBountyUntil(uint64 deadline) internal returns (uint256 id) {
        uint256[] memory minLoss = new uint256[](1);
        minLoss[0] = 1e6;
        uint256[] memory amount = new uint256[](1);
        amount[0] = 100e6;
        UsdcPayer.Auth memory auth =
            _usdcAuth(protocolPk, address(sealedBounty), 10_000e6, keccak256(abi.encodePacked("fund-until", deadline)));
        SealedBounty.CreateParams memory q = SealedBounty.CreateParams({
            productId: productId,
            predicateHash: PREDICATE,
            protocolX25519: keccak256("protoX"),
            tierMinLoss: minLoss,
            tierAmount: amount,
            singleCap: 200e6,
            k: 2,
            targetToPause: address(0),
            deadline: deadline,
            funding: 10_000e6,
            auth: auth
        });
        vm.prank(protocol);
        id = sealedBounty.createBounty(q);
    }

    /// §9 « réclamation de prime modifiée d'un octet » : corps, signature ou chiffré — tout est refusé.
    function test_claimRevertModifiedByOneByte() public {
        bytes memory cP = bytes("sealed-to-protocol");
        uint64 dl = uint64(vm.getBlockTimestamp() + 10 minutes);
        SealedBounty.Claim memory r = _claimAt(hunter, blockN, keccak256("fp-1b"), 5e6, keccak256(cP), dl);
        bytes[] memory sigs = _one(_sigClaim(r, signerPk));

        // (1) payee remplacé : un tiers qui voit la réclamation dans la mempool tente de se la verser
        SealedBounty.Claim memory stolen =
            _claimAt(makeAddr("front-runner"), blockN, keccak256("fp-1b"), 5e6, keccak256(cP), dl);
        vm.expectRevert(SealedBounty.NoValidSigner.selector);
        sealedBounty.claim(stolen, sigs, cP);

        // (2) un octet de l'empreinte (dernier octet XOR 0x01)
        SealedBounty.Claim memory fpFlip =
            _claimAt(hunter, blockN, keccak256("fp-1b") ^ bytes32(uint256(1)), 5e6, keccak256(cP), dl);
        vm.expectRevert(SealedBounty.NoValidSigner.selector);
        sealedBounty.claim(fpFlip, sigs, cP);

        // (3) un octet de la perte (loss + 1, toujours au-dessus du palier)
        SealedBounty.Claim memory lossFlip = _claimAt(hunter, blockN, keccak256("fp-1b"), 5e6 + 1, keccak256(cP), dl);
        vm.expectRevert(SealedBounty.NoValidSigner.selector);
        sealedBounty.claim(lossFlip, sigs, cP);

        // (4) un octet de la signature (v : 27 <-> 28) → un autre signataire, pas une enclave
        bytes memory sigFlip = bytes.concat(sigs[0]);
        sigFlip[64] = sigFlip[64] ^ bytes1(0x07);
        vm.expectRevert(SealedBounty.NoValidSigner.selector);
        sealedBounty.claim(r, _one(sigFlip), cP);

        // (5) un octet du chiffré livré au protocole
        bytes memory cPFlip = bytes.concat(cP);
        cPFlip[0] = cPFlip[0] ^ bytes1(0x01);
        vm.expectRevert(SealedBounty.CipherMismatch.selector);
        sealedBounty.claim(r, sigs, cPFlip);

        // contre-épreuve : l'original intact est payé
        sealedBounty.claim(r, sigs, cP);
        assertTrue(sealedBounty.fingerprintPaid(bountyId, keccak256("fp-1b")));
    }

    /// §9 « bloc N trop ancien » : hors de la fenêtre EIP-2935 (8 192 blocs) → refus ; 8 191 → payé.
    function test_claimRevertBlockNTooOld() public {
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r = _claim(keccak256("fp-old"), _goodBlockHash(), keccak256(cP)); // N = 1001
        bytes[] memory sigs = _one(_sigClaim(r, signerPk));

        vm.roll(9193); // 9193 - 1001 = 8192
        vm.expectRevert(History.AnchorTooOld.selector);
        sealedBounty.claim(r, sigs, cP);

        vm.roll(9192); // 8191 : dernier bloc de la fenêtre
        sealedBounty.claim(r, sigs, cP);
        assertTrue(sealedBounty.fingerprintPaid(bountyId, keccak256("fp-old")));
    }

    /// §9 « enclave expirée » (v2, en blocs) : fenêtre [1000, 5999], grâce jusqu'au bloc 9999.
    /// (a) une réclamation ancrée APRÈS la fenêtre ne vaut rien, même pendant la grâce ;
    /// (b) une réclamation ancrée DANS la fenêtre se règle pendant la grâce, plus après.
    function test_claimRevertExpiredEnclave() public {
        bountyId = _createBountyUntil(uint64(vm.getBlockTimestamp() + 7 days)); // la prime, elle, reste ouverte
        bytes memory cP = bytes("c");
        uint64 dl = uint64(vm.getBlockTimestamp() + 1 hours);
        SealedBounty.Claim memory afterExpiry = _claimAt(hunter, 6500, keccak256("fp-after"), 5e6, keccak256(cP), dl);
        SealedBounty.Claim memory inWindow = _claimAt(hunter, 5999, keccak256("fp-in"), 5e6, keccak256(cP), dl);
        bytes[] memory sigsAfter = _one(_sigClaim(afterExpiry, signerPk));
        bytes[] memory sigsIn = _one(_sigClaim(inWindow, signerPk));

        vm.roll(7000); // expirée, dans la grâce
        vm.expectRevert(SealedBounty.NoValidSigner.selector);
        sealedBounty.claim(afterExpiry, sigsAfter, cP);

        uint256 snap = vm.snapshotState();
        sealedBounty.claim(inWindow, sigsIn, cP); // ancrée dans la fenêtre : payée pendant la grâce
        assertTrue(sealedBounty.fingerprintPaid(bountyId, keccak256("fp-in")));
        vm.revertToState(snap);

        vm.roll(10_000); // grâce écoulée (10 000 − 5 999 = 4 001 blocs : N toujours dans la fenêtre EIP-2935)
        vm.expectRevert(SealedBounty.NoValidSigner.selector);
        sealedBounty.claim(inWindow, sigsIn, cP);
    }

    /// §9 « enclave invalidée » : réclamation ancrée au bloc d'invalidation ou après → refus ;
    /// ancrée avant → payée (voulu).
    function test_claimRevertInvalidatedEnclave() public {
        bytes memory cP = bytes("c");
        uint64 dl = uint64(vm.getBlockTimestamp() + 10 minutes);
        SealedBounty.Claim memory early = _claimAt(hunter, 1001, keccak256("fp-early"), 5e6, keccak256(cP), dl);
        SealedBounty.Claim memory late = _claimAt(hunter, 1003, keccak256("fp-late"), 5e6, keccak256(cP), dl);
        bytes[] memory sigsEarly = _one(_sigClaim(early, signerPk));
        bytes[] memory sigsLate = _one(_sigClaim(late, signerPk));

        bytes memory quote = abi.encodePacked("quote", bytes32("s1")); // quote d'inscription (Base)
        IAttestationModule.Measurements memory bad;
        module.setMeasurements(quote, bad);
        registry.invalidate(signer, quote); // désactivée au bloc 1002
        vm.roll(1005);

        vm.expectRevert(SealedBounty.NoValidSigner.selector);
        sealedBounty.claim(late, sigsLate, cP);

        sealedBounty.claim(early, sigsEarly, cP);
        assertTrue(sealedBounty.fingerprintPaid(bountyId, keccak256("fp-early")));
    }

    /// §9 « montant au-dessus du plafond d'une seule enclave » : deux enclaves du MÊME opérateur, ou la même
    /// signature deux fois, ne font pas k = 2 opérateurs distincts.
    function test_needMoreEnclavesRevertSameOperatorTwice() public {
        bountyId = _createBounty(50e6, 2, address(0)); // singleCap 50 < palier 100
        (address signer3,) = _registerEnclave(productId, opPk, 0x5353, "s3"); // 2e enclave d'`operator`, bloc 1002
        assertEq(registry.enclaveOf(signer3).operator, operator);
        vm.roll(1004);
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r = _claimAt(
            hunter, 1003, keccak256("fp-same-op"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 1 hours)
        );
        bytes[] memory twoSameOp = new bytes[](2);
        twoSameOp[0] = _sigClaim(r, signerPk);
        twoSameOp[1] = _sigClaim(r, 0x5353);
        bytes[] memory duplicated = new bytes[](2);
        duplicated[0] = twoSameOp[0];
        duplicated[1] = twoSameOp[0];

        vm.expectRevert(SealedBounty.NeedMoreEnclaves.selector);
        sealedBounty.claim(r, twoSameOp, cP);

        vm.expectRevert(SealedBounty.NeedMoreEnclaves.selector);
        sealedBounty.claim(r, duplicated, cP);
    }

    /// Contre-épreuve de la saisie : une VRAIE équivocation (même prime, même empreinte, même bloc N, même
    /// chasseur, résultats contradictoires) saisit la caution : 50 % au dénonciateur, 50 % au protocole.
    function test_bountyEquivocationSlashes() public {
        uint64 dl = uint64(vm.getBlockTimestamp() + 10 minutes);
        SealedBounty.Claim memory a = _claimAt(hunter, blockN, keccak256("fp-eq"), 5e6, keccak256("c"), dl);
        SealedBounty.Claim memory b = _claimAt(hunter, blockN, keccak256("fp-eq"), 50e6, keccak256("c"), dl);
        bytes memory sigA = _sigClaim(a, signerPk);
        bytes memory sigB = _sigClaim(b, signerPk);
        uint256 reporterBefore = usdc.balanceOf(address(this));
        uint256 protocolBefore = usdc.balanceOf(protocol);

        sealedBounty.reportEquivocation(a, sigA, b, sigB);

        assertTrue(bond.banned(operator));
        assertEq(bond.bondOf(operator), 0);
        assertEq(usdc.balanceOf(address(this)) - reporterBefore, 500e6);
        assertEq(usdc.balanceOf(protocol) - protocolBefore, 500e6);
    }

    /// §9 « écriture ERC-8004 refusée sur un chemin de saisie (la saisie passe quand même) » : VerdictLog
    /// refuse l'appelant (NotCaller), la saisie de la prime scellée a lieu.
    function test_bountySlashGoesThroughWhenVerdictLogRefuses() public {
        uint64 dl = uint64(vm.getBlockTimestamp() + 10 minutes);
        SealedBounty.Claim memory a = _claimAt(hunter, blockN, keccak256("fp-eq2"), 5e6, keccak256("c"), dl);
        SealedBounty.Claim memory b = _claimAt(hunter, blockN, keccak256("fp-eq2"), 50e6, keccak256("c"), dl);
        bytes memory sigA = _sigClaim(a, signerPk);
        bytes memory sigB = _sigClaim(b, signerPk);
        verdict.removeCaller(address(sealedBounty)); // v2 : retrait immédiat (frein d'urgence)
        uint256 responsesBefore = validation.responses();

        sealedBounty.reportEquivocation(a, sigA, b, sigB);

        assertTrue(bond.banned(operator));
        assertEq(bond.bondOf(operator), 0);
        assertEq(validation.responses(), responsesBefore);
    }

    /// FIXED (revue adverse) : deux réclamations HONNÊTES du même exploit — l'enclave O3 choisit N = tête − 2
    /// et deadline = maintenant + TTL à CHAQUE soumission — ne sont plus une « équivocation » : refus, aucune
    /// saisie. Avant la correction, le chasseur (ou le protocole qui chasse sa propre prime) vidait la caution
    /// de n'importe quel opérateur du produit.
    function test_FIXED_honestResubmissionIsNotSlashable() public {
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory first =
            _claimAt(hunter, 1001, keccak256("fp-same"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 600));
        bytes memory sigFirst = _sigClaim(first, signerPk);

        vm.roll(1007); // le même bundle resoumis 5 blocs plus tard : N = 1005, nouvelle échéance
        vm.warp(vm.getBlockTimestamp() + 3);
        SealedBounty.Claim memory second =
            _claimAt(hunter, 1005, keccak256("fp-same"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 600));
        bytes memory sigSecond = _sigClaim(second, signerPk);

        sealedBounty.claim(first, _one(sigFirst), cP); // le chasseur est payé normalement…

        vm.prank(hunter); // …puis « dénonce » ses deux réclamations honnêtes : refusé
        vm.expectRevert(SealedBounty.NotEquivocation.selector);
        sealedBounty.reportEquivocation(first, sigFirst, second, sigSecond);
        assertFalse(bond.banned(operator), "operateur honnete non saisi");
        assertEq(bond.bondOf(operator), 1000e6, "caution intacte");
    }

    /// Correction 1, toutes les variantes : n'est une équivocation QUE « mêmes entrées (bountyId, blockN,
    /// blockHashN, payee, predicateHash, cPHash, fingerprint), sorties différentes (loss ou tier) ».
    function test_equivocationOnlyForSameInputsDifferentOutputs() public {
        uint64 dl = uint64(vm.getBlockTimestamp() + 10 minutes);
        bytes32 fp = keccak256("fp-eqv");
        bytes32 cph = keccak256("c");
        SealedBounty.Claim memory a = _claimAt(hunter, 1001, fp, 5e6, cph, dl);
        bytes memory sigA = _sigClaim(a, signerPk);

        // resoumissions honnêtes, ou entrées différentes : jamais une preuve, même si la sortie diffère
        SealedBounty.Claim[] memory honest = new SealedBounty.Claim[](6);
        honest[0] = _claimAt(hunter, 1000, fp, 5e6, cph, dl); // autre bloc N
        honest[1] = _claimAt(makeAddr("hunter2"), 1001, fp, 5e6, cph, dl); // autre chasseur
        honest[2] = _claimAt(hunter, 1001, fp, 5e6, keccak256("c2"), dl); // autre chiffré
        honest[3] = _claimAt(hunter, 1001, fp, 5e6, cph, dl + 60); // même tout, autre échéance
        honest[4] = _claimAt(hunter, 1000, fp, 50e6, cph, dl); // autre bloc N ET autre perte
        honest[5] = _claimAt(hunter, 1001, fp, 50e6, cph, dl);
        honest[5].predicateHash = keccak256("autre-predicat"); // autre prédicat ET autre perte
        bytes[] memory sigs = new bytes[](honest.length);
        for (uint256 i = 0; i < honest.length; i++) {
            sigs[i] = _sigClaim(honest[i], signerPk); // signatures calculées AVANT expectRevert
        }
        for (uint256 i = 0; i < honest.length; i++) {
            vm.expectRevert(SealedBounty.NotEquivocation.selector);
            sealedBounty.reportEquivocation(a, sigA, honest[i], sigs[i]);
        }
        assertFalse(bond.banned(operator));
        assertEq(bond.bondOf(operator), 1000e6);

        // vraie équivocation, palier seul différent : saisie
        SealedBounty.Claim memory otherTier = _claimAt(hunter, 1001, fp, 5e6, cph, dl);
        otherTier.tier = 1;
        bytes memory sigTier = _sigClaim(otherTier, signerPk);
        uint256 snap = vm.snapshotState();
        sealedBounty.reportEquivocation(a, sigA, otherTier, sigTier);
        assertTrue(bond.banned(operator));
        vm.revertToState(snap);

        // vraie équivocation, perte seule différente (échéances différentes : sans effet) : saisie, 50/50
        SealedBounty.Claim memory otherLoss = _claimAt(hunter, 1001, fp, 50e6, cph, dl + 120);
        bytes memory sigLoss = _sigClaim(otherLoss, signerPk);
        uint256 reporterBefore = usdc.balanceOf(address(this));
        uint256 protocolBefore = usdc.balanceOf(protocol);
        sealedBounty.reportEquivocation(a, sigA, otherLoss, sigLoss);
        assertTrue(bond.banned(operator));
        assertEq(bond.bondOf(operator), 0);
        assertEq(usdc.balanceOf(address(this)) - reporterBefore, 500e6);
        assertEq(usdc.balanceOf(protocol) - protocolBefore, 500e6);
    }

    /// Correction 1 : deux réclamations aux mêmes entrées et sorties différentes, mais signées par DEUX
    /// enclaves différentes, ne prouvent rien contre l'une ou l'autre.
    function test_equivocationRefusedAcrossTwoEnclaves() public {
        uint64 dl = uint64(vm.getBlockTimestamp() + 10 minutes);
        SealedBounty.Claim memory a = _claimAt(hunter, 1001, keccak256("fp-2e"), 5e6, keccak256("c"), dl);
        SealedBounty.Claim memory b = _claimAt(hunter, 1001, keccak256("fp-2e"), 50e6, keccak256("c"), dl);
        bytes memory sigA = _sigClaim(a, signerPk);
        bytes memory sigB = _sigClaim(b, signer2Pk);
        vm.expectRevert(SealedBounty.NotEquivocation.selector);
        sealedBounty.reportEquivocation(a, sigA, b, sigB);
        assertFalse(bond.banned(operator));
        assertFalse(bond.banned(operator2));
    }

    /// FIXED (revue adverse) : claim() exige l'échéance SIGNÉE de la réclamation (deadline ≥ block.timestamp).
    /// Le TTL de 10 min de l'enclave O3 a maintenant un effet.
    function test_FIXED_claimDeadlineEnforced() public {
        bytes memory cP = bytes("c");
        uint64 claimDeadline = uint64(vm.getBlockTimestamp() + 10 minutes);
        SealedBounty.Claim memory r = _claimAt(hunter, blockN, keccak256("fp-ttl"), 5e6, keccak256(cP), claimDeadline);
        bytes[] memory sigs = _one(_sigClaim(r, signerPk));

        // contre-épreuve : à la dernière seconde de l'échéance signée, la réclamation est payée
        uint256 snap = vm.snapshotState();
        vm.warp(claimDeadline);
        sealedBounty.claim(r, sigs, cP);
        assertTrue(sealedBounty.fingerprintPaid(bountyId, keccak256("fp-ttl")));
        vm.revertToState(snap);

        // une seconde après (prime ouverte, enclave active, N dans la fenêtre) : refusée
        vm.warp(uint256(claimDeadline) + 1);
        vm.expectRevert(SealedBounty.ClaimExpired.selector);
        sealedBounty.claim(r, sigs, cP);
        assertFalse(sealedBounty.fingerprintPaid(bountyId, keccak256("fp-ttl")));
    }

    /// Correction 11 : au-dessus de singleCap, k opérateurs DISTINCTS qui signent la MÊME réclamation sont
    /// payés, et chacun prend montant ÷ (nombre d'opérateurs distincts) d'exposition ; deux enclaves du
    /// même opérateur ne comptent qu'une fois (ni pour k, ni pour le partage).
    function test_kDistinctOperatorsSplitExposure() public {
        bountyId = _createBounty(50e6, 2, address(0)); // singleCap 50 < palier 100 → k = 2 opérateurs distincts
        _registerEnclave(productId, opPk, 0x5353, "s3"); // 2e enclave d'`operator`, bloc 1002
        vm.roll(1004);
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r =
            _claimAt(hunter, 1003, keccak256("fp-k2"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 1 hours));
        bytes[] memory sigs = new bytes[](3);
        sigs[0] = _sigClaim(r, signerPk); // operator
        sigs[1] = _sigClaim(r, 0x5353); // operator encore (2e enclave)
        sigs[2] = _sigClaim(r, signer2Pk); // operator2

        uint256 hunterBefore = usdc.balanceOf(hunter);
        uint256 opBefore = usdc.balanceOf(operator);
        uint256 op2Before = usdc.balanceOf(operator2);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        sealedBounty.claim(r, sigs, cP);

        assertEq(usdc.balanceOf(hunter) - hunterBefore, 100e6);
        assertEq(bond.exposureOf(operator, productId), 50e6, "100 / 2 operateurs distincts, pas / 3 signatures");
        assertEq(bond.exposureOf(operator2, productId), 50e6);
        assertEq(usdc.balanceOf(operator) - opBefore, 2.5e6); // 5 % de 100, partagés en 2
        assertEq(usdc.balanceOf(operator2) - op2Before, 2.5e6);
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 10e6); // 10 % réseau
    }

    /// Correction 11 (k = 3) : trois opérateurs distincts ; exposition = 100 ÷ 3 chacun ; le reste de la
    /// division de la part opérateurs va au réseau (rien ne reste bloqué dans le contrat).
    function test_kThreeDistinctOperators() public {
        uint256 op3Pk = 0xC0C;
        address operator3 = vm.addr(op3Pk);
        usdc.mint(operator3, 1_000_000e6);
        _bondOperator(op3Pk, 1000e6);
        _registerEnclave(productId, op3Pk, 0x5454, "s4"); // bloc 1002
        bountyId = _createBounty(50e6, 3, address(0)); // k = 3
        vm.roll(1004);
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r =
            _claimAt(hunter, 1003, keccak256("fp-k3"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 1 hours));
        bytes[] memory two = new bytes[](2);
        two[0] = _sigClaim(r, signerPk);
        two[1] = _sigClaim(r, signer2Pk);
        bytes[] memory three = new bytes[](3);
        three[0] = two[0];
        three[1] = two[1];
        three[2] = _sigClaim(r, 0x5454);

        vm.expectRevert(SealedBounty.NeedMoreEnclaves.selector); // 2 < k = 3
        sealedBounty.claim(r, two, cP);

        uint256 balanceBefore = usdc.balanceOf(address(sealedBounty));
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 op3Before = usdc.balanceOf(operator3);
        sealedBounty.claim(r, three, cP);

        assertEq(bond.exposureOf(operator, productId), 33_333_333);
        assertEq(bond.exposureOf(operator2, productId), 33_333_333);
        assertEq(bond.exposureOf(operator3, productId), 33_333_333);
        assertEq(usdc.balanceOf(operator3) - op3Before, 1_666_666); // 5e6 / 3
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, 10e6 + 2); // réseau + reste de la division
        // le pool a payé exactement palier × 1,15 et le contrat n'a rien gardé en trop
        assertEq(balanceBefore - usdc.balanceOf(address(sealedBounty)), 115e6);
        assertEq(usdc.balanceOf(address(sealedBounty)), sealedBounty.getBounty(bountyId).balance + _otherBalances());
    }

    /// @dev Somme des soldes des primes AUTRES que `bountyId` (créées par setUp / le test).
    function _otherBalances() internal view returns (uint256 sum) {
        for (uint256 id = 1; id <= sealedBounty.bountyCount(); id++) {
            if (id != bountyId) sum += sealedBounty.getBounty(id).balance;
        }
    }

    /// Correction 10 : le plafond d'exposition du produit (par opérateur, 24 h glissantes) s'applique EN PLUS de
    /// « ½ caution disponible ». Plafond 60 USDC : une seule enclave ne libère pas 100 ; deux opérateurs
    /// distincts (50 chacun) le peuvent ; v2 : le compteur glisse (une exposition compte jusqu'à 36 h).
    /// v2 : une prime paie au plus son palier le plus haut par armement → la 2e réclamation vise une AUTRE prime.
    function test_claimRespectsProductExposureCap() public {
        productId = _proposeAndActivate(address(sealedBounty), true, bytes32(0), 0, 100e6, 60e6); // plafond 60
        _registerEnclave(productId, opPk, 0x6161, "cap-1"); // bloc 1002
        _registerEnclave(productId, op2Pk, 0x6262, "cap-2");
        // une seule enclave suffit (100 ≤ singleCap 200) ; nonces de financement distincts de celui de setUp
        uint64 bountyDeadline = uint64(vm.getBlockTimestamp() + 3 days);
        uint256 bountyA = _createBountyUntil(bountyDeadline);
        uint256 bountyB = _createBountyUntil(bountyDeadline + 1);
        vm.roll(1004);
        bytes memory cP = bytes("c");
        uint64 dl = uint64(vm.getBlockTimestamp() + 2 days);
        bountyId = bountyA;
        SealedBounty.Claim memory r1 = _claimAt(hunter, 1003, keccak256("fp-cap-1"), 5e6, keccak256(cP), dl);
        bountyId = bountyB;
        SealedBounty.Claim memory r2 = _claimAt(hunter, 1003, keccak256("fp-cap-2"), 5e6, keccak256(cP), dl);
        bytes[] memory solo = _one(_sigClaim(r1, 0x6161));
        bytes[] memory duo = new bytes[](2);
        duo[0] = _sigClaim(r1, 0x6161);
        duo[1] = _sigClaim(r1, 0x6262);
        bytes[] memory duo2 = new bytes[](2);
        duo2[0] = _sigClaim(r2, 0x6161);
        duo2[1] = _sigClaim(r2, 0x6262);

        // une seule enclave : 100 > plafond 60 (alors que ½ caution = 500 le permettrait)
        vm.expectRevert(OperatorBond.ExposureCapExceeded.selector);
        sealedBounty.claim(r1, solo, cP);

        // deux opérateurs distincts : 50 chacun ≤ 60
        sealedBounty.claim(r1, duo, cP);
        assertEq(bond.exposureOf(operator, productId), 50e6);

        // même fenêtre : 50 + 50 > 60
        vm.expectRevert(OperatorBond.ExposureCapExceeded.selector);
        sealedBounty.claim(r2, duo2, cP);

        // 36 h plus tard, l'exposition précédente ne compte plus
        vm.warp(vm.getBlockTimestamp() + 36 hours + 1);
        sealedBounty.claim(r2, duo2, cP);
        assertEq(bond.exposureOf(operator, productId), 50e6);
    }

    // =====================================================================================
    // v2 bis — revue adverse du 7/11 : un exploit = un paiement, cP livré après réservation, pause bornée,
    // paramètres bornés, réfutation par contre-rejeu
    // =====================================================================================

    function _claimTier(uint64 n, bytes32 fp, uint256 loss, uint8 tier) internal view returns (SealedBounty.Claim memory r) {
        r = _claimAt(hunter, n, fp, loss, keccak256(bytes("c")), uint64(vm.getBlockTimestamp() + 1 hours));
        r.tier = tier;
    }

    /// @dev Prime à paliers (perte ≥ 1 → 10 ; ≥ 50 → 30 ; ≥ 500 → 100 USDC), une enclave suffit (singleCap 200).
    function _createTieredBounty(bytes32 nonce) internal returns (uint256 id) {
        uint256[] memory minLoss = new uint256[](3);
        minLoss[0] = 1e6;
        minLoss[1] = 50e6;
        minLoss[2] = 500e6;
        uint256[] memory amount = new uint256[](3);
        amount[0] = 10e6;
        amount[1] = 30e6;
        amount[2] = 100e6;
        UsdcPayer.Auth memory auth = _usdcAuth(protocolPk, address(sealedBounty), 1_000e6, nonce);
        SealedBounty.CreateParams memory q = SealedBounty.CreateParams({
            productId: productId,
            predicateHash: PREDICATE,
            protocolX25519: keccak256("protoX"),
            tierMinLoss: minLoss,
            tierAmount: amount,
            singleCap: 200e6,
            k: 2,
            targetToPause: address(0),
            deadline: uint64(vm.getBlockTimestamp() + 3 days),
            funding: 1_000e6,
            auth: auth
        });
        vm.prank(protocol);
        id = sealedBounty.createBounty(q);
    }

    /// FIXED (haute) : un palier ne se paie qu'une fois par armement ; un palier supérieur ne paie que la
    /// différence, et seulement ancré APRÈS le dernier paiement ; le protocole réarme après correction.
    function test_FIXED_eachTierPaidOncePerArm() public {
        bountyId = _createTieredBounty(keccak256("tiered"));
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory t1 = _claimTier(1001, keccak256("exploit-a"), 60e6, 1); // palier 30
        uint256 before = usdc.balanceOf(hunter);
        sealedBounty.claim(t1, _one(_sigClaim(t1, signerPk)), cP);
        assertEq(usdc.balanceOf(hunter) - before, 30e6);

        // le même bug sous une autre empreinte, même palier, ancré au même bloc : refusé
        vm.roll(1004);
        SealedBounty.Claim memory again = _claimTier(1003, keccak256("exploit-a-recase"), 60e6, 1);
        bytes[] memory sAgain = _one(_sigClaim(again, signerPk));
        vm.expectRevert(SealedBounty.TierAlreadyPaid.selector);
        sealedBounty.claim(again, sAgain, cP);

        // ancré avant (ou au bloc du) dernier paiement : refusé, même à un palier supérieur
        SealedBounty.Claim memory early = _claimTier(1002, keccak256("exploit-b"), 600e6, 2);
        bytes[] memory sEarly = _one(_sigClaim(early, signerPk));
        vm.expectRevert(SealedBounty.AnchorBeforeLastPayout.selector);
        sealedBounty.claim(early, sEarly, cP);

        // un palier SUPÉRIEUR, ancré après : seule la différence (100 − 30)
        SealedBounty.Claim memory top = _claimTier(1003, keccak256("exploit-b"), 600e6, 2);
        before = usdc.balanceOf(hunter);
        sealedBounty.claim(top, _one(_sigClaim(top, signerPk)), cP);
        assertEq(usdc.balanceOf(hunter) - before, 70e6);
        assertEq(sealedBounty.getBounty(bountyId).paidAmount, 100e6);

        // plus rien au-delà du palier le plus haut… jusqu'au réarmement par le protocole
        vm.roll(1010);
        SealedBounty.Claim memory more = _claimTier(1009, keccak256("exploit-c"), 600e6, 2);
        bytes[] memory sMore = _one(_sigClaim(more, signerPk));
        vm.expectRevert(SealedBounty.TierAlreadyPaid.selector);
        sealedBounty.claim(more, sMore, cP);

        vm.prank(protocol);
        sealedBounty.reopen(bountyId); // réarmée au bloc 1010
        vm.expectRevert(SealedBounty.AnchorBeforeLastPayout.selector); // 1009 ≤ 1010
        sealedBounty.claim(more, sMore, cP);
        vm.roll(1012);
        SealedBounty.Claim memory afterFix = _claimTier(1011, keccak256("exploit-c"), 600e6, 2);
        sealedBounty.claim(afterFix, _one(_sigClaim(afterFix, signerPk)), cP);
        assertEq(sealedBounty.getBounty(bountyId).paidAmount, 100e6);
    }

    /// FIXED (haute) : acceptClaim ne porte pas cP ; deliver(cP), ouvert à tous, livre et paie.
    function test_FIXED_acceptThenDeliver() public {
        bytes memory cP = bytes("exploit chiffre vers le protocole");
        SealedBounty.Claim memory r = _claimAt(hunter, blockN, keccak256("fp-2s"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 1 hours));
        uint256 poolBefore = sealedBounty.getBounty(bountyId).balance;
        sealedBounty.acceptClaim(r, _one(_sigClaim(r, signerPk)));

        SealedBounty.Payout memory p = sealedBounty.pendingOf(bountyId, keccak256("fp-2s"));
        assertEq(p.payee, hunter);
        assertEq(p.amount, 100e6);
        assertEq(poolBefore - sealedBounty.getBounty(bountyId).balance, 115e6, "palier + 10 % + 5 %, reserves");
        assertEq(usdc.balanceOf(hunter), 1_000_000e6, "rien de paye avant la livraison");

        vm.expectRevert(SealedBounty.CipherMismatch.selector);
        sealedBounty.deliver(bountyId, keccak256("fp-2s"), bytes("autre chose"));

        vm.prank(makeAddr("relayeur")); // n'importe qui livre ; le chasseur est payé
        sealedBounty.deliver(bountyId, keccak256("fp-2s"), cP);
        assertEq(usdc.balanceOf(hunter), 1_000_000e6 + 100e6);
        assertEq(validation.responses(), 1);

        vm.expectRevert(SealedBounty.NothingToDeliver.selector);
        sealedBounty.deliver(bountyId, keccak256("fp-2s"), cP);
    }

    /// v2 : un paiement réservé et jamais livré retourne au pool après DELIVERY_WINDOW.
    function test_cancelUndeliveredAfterWindow() public {
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r = _claimAt(hunter, blockN, keccak256("fp-nd"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 1 hours));
        uint256 poolBefore = sealedBounty.getBounty(bountyId).balance;
        sealedBounty.acceptClaim(r, _one(_sigClaim(r, signerPk)));
        vm.expectRevert(SealedBounty.DeliveryWindowOpen.selector);
        sealedBounty.cancelUndelivered(bountyId, keccak256("fp-nd"));
        vm.warp(vm.getBlockTimestamp() + sealedBounty.DELIVERY_WINDOW());
        sealedBounty.cancelUndelivered(bountyId, keccak256("fp-nd"));
        assertEq(sealedBounty.getBounty(bountyId).balance, poolBefore);
        vm.expectRevert(SealedBounty.NothingToDeliver.selector);
        sealedBounty.deliver(bountyId, keccak256("fp-nd"), cP);
    }

    /// FIXED (haute) : la pause n'atteint que les réclamations ancrées à partir du bloc de la pause.
    function test_FIXED_pauseDoesNotReachClaimsAnchoredBefore() public {
        bytes memory cP = bytes("c");
        uint64 dl = uint64(vm.getBlockTimestamp() + 1 hours);
        SealedBounty.Claim memory before_ = _claimAt(hunter, 1001, keccak256("fp-p1"), 5e6, keccak256(cP), dl);
        SealedBounty.Claim memory atPause = _claimAt(hunter, 1002, keccak256("fp-p2"), 5e6, keccak256(cP), dl);
        bytes[] memory sBefore = _one(_sigClaim(before_, signerPk));
        bytes[] memory sAt = _one(_sigClaim(atPause, signerPk));
        vm.prank(protocol);
        sealedBounty.setPaused(bountyId, true); // au bloc 1002
        vm.roll(1004);
        vm.expectRevert(SealedBounty.BountyPausedErr.selector);
        sealedBounty.claim(atPause, sAt, cP);
        sealedBounty.claim(before_, sBefore, cP); // preuve faite avant la pause : payée
        assertTrue(sealedBounty.fingerprintPaid(bountyId, keccak256("fp-p1")));
    }

    /// FIXED (basse) : produit réglé par ce contrat, k ≤ MAX_SIGS, paliers strictement croissants.
    function test_FIXED_createBountyParamsBounded() public {
        uint256[] memory minLoss = new uint256[](2);
        uint256[] memory amount = new uint256[](2);
        minLoss[0] = 10e6;
        minLoss[1] = 5e6; // non trié
        amount[0] = 5e6;
        amount[1] = 50e6;
        vm.expectRevert(SealedBounty.BadTiers.selector);
        this.createWith(productId, minLoss, amount, 2);
        minLoss[1] = 50e6;
        amount[1] = 1e6; // palier supérieur moins payé
        vm.expectRevert(SealedBounty.BadTiers.selector);
        this.createWith(productId, minLoss, amount, 2);
        amount[1] = 50e6;
        vm.expectRevert(SealedBounty.BadK.selector);
        this.createWith(productId, minLoss, amount, 6); // > MAX_SIGS : jamais réclamable au-dessus de singleCap
        uint256 inference = _proposeAndActivate(address(sessionPay), false, bytes32("m"), 1e6, 100e6, 0);
        vm.expectRevert(SealedBounty.WrongSettlement.selector);
        this.createWith(inference, minLoss, amount, 2);
        this.createWith(productId, minLoss, amount, 5);
    }

    function createWith(uint256 pid, uint256[] memory minLoss, uint256[] memory amount, uint8 k)
        external
        returns (uint256 id)
    {
        UsdcPayer.Auth memory auth =
            _usdcAuth(protocolPk, address(sealedBounty), 100e6, keccak256(abi.encode("cw", pid, minLoss, amount, k)));
        SealedBounty.CreateParams memory q = SealedBounty.CreateParams({
            productId: pid,
            predicateHash: PREDICATE,
            protocolX25519: keccak256("protoX"),
            tierMinLoss: minLoss,
            tierAmount: amount,
            singleCap: 50e6,
            k: k,
            targetToPause: address(0),
            deadline: uint64(vm.getBlockTimestamp() + 1 days),
            funding: 100e6,
            auth: auth
        });
        vm.prank(protocol);
        id = sealedBounty.createBounty(q);
    }

    // ---- réfutation (contre-rejeu) ----

    function _sigRefutation(SealedBounty.Refutation memory f, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(sealedBounty.REFUTATION_TYPEHASH(), f.claimDigest, f.proven, f.loss, f.tier));
        return _sign(pk, _typed(address(sealedBounty), structHash));
    }

    function _two(bytes memory a, bytes memory b) internal pure returns (bytes[] memory sigs) {
        sigs = new bytes[](2);
        sigs[0] = a;
        sigs[1] = b;
    }

    /// v2 : bornes de la réfutation — quorum d'opérateurs distincts, jamais un signataire de la réclamation, un
    /// résultat différent, dans la fenêtre ; une réclamation exacte ne se réfute pas.
    function test_refutationRules() public {
        uint256 op3Pk = 0xC0C;
        address op3 = vm.addr(op3Pk);
        usdc.mint(op3, 1_000_000e6);
        _bondOperator(op3Pk, 1000e6);
        _registerEnclave(productId, op3Pk, 0x5454, "s4"); // 3e opérateur, bloc 1002
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r = _claimAt(hunter, blockN, keccak256("fp-ref"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 1 hours));
        sealedBounty.claim(r, _one(_sigClaim(r, signerPk)), cP); // signée par `operator` seul
        bytes32 digest = sealedBounty.claimDigest(r);
        address[] memory ops = new address[](1);
        ops[0] = operator;

        SealedBounty.Refutation memory same = SealedBounty.Refutation({claimDigest: digest, proven: true, loss: 5e6, tier: 0});
        bytes[] memory sSame = _two(_sigRefutation(same, signer2Pk), _sigRefutation(same, 0x5454));
        vm.expectRevert(SealedBounty.NotARefutation.selector);
        sealedBounty.refute(r, ops, same, sSame);

        SealedBounty.Refutation memory f = SealedBounty.Refutation({claimDigest: digest, proven: false, loss: 0, tier: 0});
        bytes[] memory alone = _one(_sigRefutation(f, signer2Pk));
        vm.expectRevert(SealedBounty.NeedMoreRefuters.selector); // 1 opérateur : pas plus que la réclamation
        sealedBounty.refute(r, ops, f, alone);

        bytes[] memory withClaimer = _two(_sigRefutation(f, signer2Pk), _sigRefutation(f, signerPk));
        vm.expectRevert(SealedBounty.RefuterIsClaimOperator.selector);
        sealedBounty.refute(r, ops, f, withClaimer);

        address[] memory wrongOps = new address[](1);
        wrongOps[0] = operator2;
        bytes[] memory good = _two(_sigRefutation(f, signer2Pk), _sigRefutation(f, 0x5454));
        vm.expectRevert(SealedBounty.BadOps.selector);
        sealedBounty.refute(r, wrongOps, f, good);

        uint256 snap = vm.snapshotState();
        vm.warp(vm.getBlockTimestamp() + sealedBounty.REFUTE_WINDOW() + 1);
        vm.expectRevert(SealedBounty.RefuteWindowOver.selector);
        sealedBounty.refute(r, ops, f, good);
        vm.revertToState(snap);

        sealedBounty.refute(r, ops, f, good); // deux opérateurs distincts, étrangers à la réclamation
        assertTrue(bond.banned(operator));
        assertFalse(bond.banned(operator2));
        vm.expectRevert(SealedBounty.AlreadyRefuted.selector);
        sealedBounty.refute(r, ops, f, good);
    }
    // ---- v2 bis : le verdict ERC-8004 ne saute plus au gaz minimal (eth_estimateGas) ----

    /// FIXED : au gaz MINIMAL qui fait réussir deliver, le chasseur est payé — aucun transfert affamé changé en crédit —
    /// ET le verdict ERC-8004 est écrit.
    function test_FIXED_v2_minimalGasDeliverPaysAndWritesVerdict() public {
        _emulateArcVerdictCost();
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r =
            _claimAt(hunter, blockN, keccak256("fp-gas"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 1 hours));
        sealedBounty.acceptClaim(r, _one(_sigClaim(r, signerPk)));
        bytes memory call = abi.encodeCall(SealedBounty.deliver, (bountyId, keccak256("fp-gas"), cP));
        address relayer = makeAddr("relayeur-min-gas");
        uint256 g = _minGasToSucceed(relayer, address(sealedBounty), call, 21_000, 3_000_000);
        assertGt(g, sealedBounty.VERDICT_GAS());

        uint256 before = validation.responses();
        uint256 hunterBefore = usdc.balanceOf(hunter);
        vm.prank(relayer);
        (bool ok,) = address(sealedBounty).call{gas: g}(call);
        assertTrue(ok);
        assertEq(usdc.balanceOf(hunter) - hunterBefore, 100e6, "paye au gaz minimal");
        assertEq(sealedBounty.credit(hunter), 0, "aucun transfert affame change en credit");
        assertEq(validation.responses(), before + 1, "verdict ecrit au gaz minimal");
    }

    /// FIXED : la saisie pour équivocation au gaz minimal écrit son verdict de faute.
    function test_FIXED_v2_minimalGasEquivocationWritesVerdict() public {
        _emulateArcVerdictCost();
        uint64 dl = uint64(vm.getBlockTimestamp() + 10 minutes);
        SealedBounty.Claim memory a = _claimAt(hunter, 1001, keccak256("fp-eq-gas"), 5e6, keccak256("c"), dl);
        SealedBounty.Claim memory b = _claimAt(hunter, 1001, keccak256("fp-eq-gas"), 50e6, keccak256("c"), dl);
        bytes memory call =
            abi.encodeCall(SealedBounty.reportEquivocation, (a, _sigClaim(a, signerPk), b, _sigClaim(b, signerPk)));
        address reporter = makeAddr("reporter-min-gas");
        uint256 g = _minGasToSucceed(reporter, address(sealedBounty), call, 21_000, 3_000_000);
        uint256 before = validation.responses();
        vm.prank(reporter);
        (bool ok,) = address(sealedBounty).call{gas: g}(call);
        assertTrue(ok);
        assertTrue(bond.banned(operator));
        assertEq(validation.responses(), before + 1, "verdict de faute ecrit au gaz minimal");
    }

    /// FIXED : une réfutation au gaz minimal saisit ET écrit son verdict.
    function test_FIXED_v2_minimalGasRefuteWritesVerdict() public {
        _emulateArcVerdictCost();
        uint256 op3Pk = 0xC0C;
        usdc.mint(vm.addr(op3Pk), 1_000_000e6);
        _bondOperator(op3Pk, 1000e6);
        _registerEnclave(productId, op3Pk, 0x5454, "s4-gas"); // 3e opérateur
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r =
            _claimAt(hunter, blockN, keccak256("fp-ref-gas"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 1 hours));
        sealedBounty.claim(r, _one(_sigClaim(r, signerPk)), cP);
        SealedBounty.Refutation memory f =
            SealedBounty.Refutation({claimDigest: sealedBounty.claimDigest(r), proven: false, loss: 0, tier: 0});
        address[] memory ops = new address[](1);
        ops[0] = operator;
        bytes memory call = abi.encodeCall(
            SealedBounty.refute, (r, ops, f, _two(_sigRefutation(f, signer2Pk), _sigRefutation(f, 0x5454)))
        );
        uint256 g = _minGasToSucceed(protocol, address(sealedBounty), call, 21_000, 5_000_000);
        uint256 before = validation.responses();
        vm.prank(protocol);
        (bool ok,) = address(sealedBounty).call{gas: g}(call);
        assertTrue(ok);
        assertTrue(bond.banned(operator));
        assertEq(validation.responses(), before + 1, "verdict de refutation ecrit au gaz minimal");
    }

    // ---- v2.1 : requestHash lié à la chaîne et au contrat ; VerdictSkipped quand l'écriture échoue ----

    /// v2.1 : le verdict d'une prime payée porte keccak256(abi.encode(chainid, address(this), "bounty", id, empreinte)).
    function test_v21_bountyVerdictRequestHashBound() public {
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r =
            _claimAt(hunter, blockN, keccak256("fp-rh"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 1 hours));
        bytes32 rh = keccak256(abi.encode(block.chainid, address(sealedBounty), "bounty", bountyId, keccak256("fp-rh")));
        bytes[] memory sigs = _one(_sigClaim(r, signerPk));
        vm.expectEmit(true, true, false, true, address(verdict));
        emit VerdictLog.Recorded(0, rh, 100, "tdx-dcap/sealed-bounty");
        sealedBounty.claim(r, sigs, cP);
    }

    /// v2.1 : registre ERC-8004 en panne au paiement : le chasseur est payé, VerdictSkipped trace le verdict sauté.
    function test_v21_payEmitsVerdictSkippedWhenRegistryFails() public {
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r =
            _claimAt(hunter, blockN, keccak256("fp-skip"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 1 hours));
        bytes[] memory sigs = _one(_sigClaim(r, signerPk));
        validation.setShouldRevert(true);
        bytes32 rh = keccak256(abi.encode(block.chainid, address(sealedBounty), "bounty", bountyId, keccak256("fp-skip")));
        uint256 before = usdc.balanceOf(hunter);
        vm.expectEmit(true, false, false, true, address(sealedBounty));
        emit SealedBounty.VerdictSkipped(rh, abi.encodeWithSignature("Error(string)", "validation down"));
        sealedBounty.claim(r, sigs, cP);
        assertEq(usdc.balanceOf(hunter) - before, 100e6, "paye malgre la panne du registre");
    }

    /// v2.1 : saisie pour équivocation avec VerdictLog qui refuse l'appelant : la saisie a lieu, VerdictSkipped est émis.
    /// v2.1 bis (changement voulu, revue adverse du 9/11) : le requestHash porte aussi l'opérateur saisi.
    function test_v21_equivocationEmitsVerdictSkipped() public {
        uint64 dl = uint64(vm.getBlockTimestamp() + 10 minutes);
        SealedBounty.Claim memory a = _claimAt(hunter, blockN, keccak256("fp-eq3"), 5e6, keccak256("c"), dl);
        SealedBounty.Claim memory b = _claimAt(hunter, blockN, keccak256("fp-eq3"), 50e6, keccak256("c"), dl);
        bytes memory sigA = _sigClaim(a, signerPk);
        bytes memory sigB = _sigClaim(b, signerPk);
        verdict.removeCaller(address(sealedBounty));
        bytes32 rh = keccak256(
            abi.encode(block.chainid, address(sealedBounty), "equivocation", bountyId, keccak256("fp-eq3"), operator)
        );
        vm.expectEmit(true, false, false, true, address(sealedBounty));
        emit SealedBounty.VerdictSkipped(rh, abi.encodeWithSelector(VerdictLog.NotCaller.selector));
        sealedBounty.reportEquivocation(a, sigA, b, sigB);
        assertTrue(bond.banned(operator));
    }

    /// v2.1 : réfutation avec le registre en panne : saisie faite, VerdictSkipped émis avec le requestHash lié.
    function test_v21_refuteEmitsVerdictSkipped() public {
        uint256 op3Pk = 0xC0C;
        usdc.mint(vm.addr(op3Pk), 1_000_000e6);
        _bondOperator(op3Pk, 1000e6);
        _registerEnclave(productId, op3Pk, 0x5454, "s4-v21");
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r =
            _claimAt(hunter, blockN, keccak256("fp-ref-v21"), 5e6, keccak256(cP), uint64(vm.getBlockTimestamp() + 1 hours));
        sealedBounty.claim(r, _one(_sigClaim(r, signerPk)), cP);
        bytes32 digest = sealedBounty.claimDigest(r);
        SealedBounty.Refutation memory f =
            SealedBounty.Refutation({claimDigest: digest, proven: false, loss: 0, tier: 0});
        address[] memory ops = new address[](1);
        ops[0] = operator;
        bytes[] memory sigs = _two(_sigRefutation(f, signer2Pk), _sigRefutation(f, 0x5454));
        validation.setShouldRevert(true);
        bytes32 rh = keccak256(abi.encode(block.chainid, address(sealedBounty), "refuted", bountyId, digest));
        vm.expectEmit(true, false, false, true, address(sealedBounty));
        emit SealedBounty.VerdictSkipped(rh, abi.encodeWithSignature("Error(string)", "validation down"));
        sealedBounty.refute(r, ops, f, sigs);
        assertTrue(bond.banned(operator));
    }
}
