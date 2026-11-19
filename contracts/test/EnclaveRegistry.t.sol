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
        m.mrtd = _b48("EVIL"); // change le workloadId
        module.setMeasurements(quote, m);
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.WorkloadNotAllowed.selector);
        registry.registerEnclave(productId, quote, r, vm.addr(signerPk), x, "");
    }

    function test_register_revertReportDataMismatch() public {
        bytes32 x = keccak256("x");
        uint256 r = block.number - 1;
        bytes memory quote = abi.encodePacked("q-rd");
        // mesures liées à operator2, mais c'est operator qui appelle
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
        // on ancre sur un AUTRE bloc que celui des mesures -> hash différent
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
        // réutiliser le même quote
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.QuoteReused.selector);
        registry.registerEnclave(productId, quote, block.number - 1, vm.addr(signer2Pk), keccak256("x2"), "");
    }

    function test_register_revertUnderbonded() public {
        // operator2 n'a pas déposé de caution
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

        // le collatéral actuel ne valide plus ce quote
        IAttestationModule.Measurements memory bad; // ok == false
        module.setMeasurements(quote, bad);

        registry.invalidate(signer, quote); // ouvert à tous
        assertFalse(registry.enclaveOf(signer).active);
        assertFalse(registry.isActiveAt(signer, productId, block.number));
    }

    function test_invalidate_revertStillValid() public {
        (address signer, bytes memory quote) = _registerEnclave(productId, opPk, signerPk, "s1");
        vm.expectRevert(EnclaveRegistry.StillValid.selector);
        registry.invalidate(signer, quote);
    }

    function test_retire() public {
        // inscription au bloc 1000 (cf. setUp). Numéros explicites : l'optimiseur replie block.number.
        (address signer,) = _registerEnclave(productId, opPk, signerPk, "s1");
        vm.roll(1010);
        vm.prank(operator);
        registry.retire(signer); // deactivatedAtBlock = 1010
        // actif pour les reçus d'avant le retrait, inactif à partir du retrait
        assertTrue(registry.isActiveAt(signer, productId, 1005));
        assertFalse(registry.isActiveAt(signer, productId, 1010));
    }

    // =====================================================================================
    // tests négatifs ajoutés le 7/11 (inscription, REPORTDATA, rejeu, expiration).
    // Bloc courant = 1000 après setUp ; numéros de bloc en littéraux (l'optimiseur replie block.number).
    // v2 : les tests `test_FIXED_*` rejouent les cas de la revue adverse, corrigés dans src (le
    // test prouve le bon comportement). Validité en blocs : fenêtre [1000, 5999], grâce jusqu'au bloc 9999.
    // =====================================================================================

    /// @dev Mesures valides dont REPORTDATA[0:32] lie un chainId et un registre CHOISIS (P6).
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
        return keccak256(abi.encodePacked("x25519", salt)); // même dérivation que _registerEnclave
    }

    /// §9 « autre chainId dans REPORTDATA » : un quote lié à une autre chaîne (ici Arc mainnet) est refusé.
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

    /// §9 « autre registre dans REPORTDATA » : le quote lié à un autre déploiement ne vaut que là-bas.
    function test_register_revertWrongRegistryInReportData() public {
        // un autre déploiement : sa propre caution, câblée sur son propre registre
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

        // contre-épreuve : le même quote passe sur le registre auquel il est lié
        vm.prank(operator);
        other.registerEnclave(productId, quote, 999, s, x, "");
        assertEq(other.enclaveOf(s).operator, operator);
        assertEq(registry.enclaveOf(s).operator, address(0));
    }

    /// P6 : l'opérateur ne peut pas substituer SA clé de signature ni SA clé X25519 à celles de l'enclave.
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

    /// P6 : un quote lié au produit A ne sert pas à inscrire l'enclave sur le produit B (même image autorisée).
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

    /// §9 « quote rejoué » : une enclave invalidée ne ressuscite pas en rejouant son ancien quote (P9),
    /// même si le collatéral redevient bon.
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

    /// §9 « quote périmé » (bornes) : R = bloc courant refusé (EIP-2935 ne sert que les blocs passés).
    function test_register_revertAnchorNotYetInHistory() public {
        address s = vm.addr(signerPk);
        bytes32 x = keccak256("x");
        bytes memory quote = abi.encodePacked("q-now");
        module.setMeasurements(quote, _measurements(productId, operator, s, x, 1000, false));
        vm.prank(operator);
        vm.expectRevert(History.AnchorTooOld.selector);
        registry.registerEnclave(productId, quote, 1000, s, x, ""); // 1000 = bloc courant
    }

    /// §9 « quote périmé » (bornes) : 8 192 blocs d'écart refusés, 8 191 acceptés.
    function test_register_anchorWindowBoundary() public {
        address s = vm.addr(signerPk);
        bytes32 x = keccak256("x");

        vm.roll(9192); // 9192 - 1000 = 8192 > 8191
        bytes memory q1 = abi.encodePacked("q-8192");
        module.setMeasurements(q1, _measurements(productId, operator, s, x, 1000, false));
        vm.prank(operator);
        vm.expectRevert(History.AnchorTooOld.selector);
        registry.registerEnclave(productId, q1, 1000, s, x, "");

        vm.roll(9191); // 9191 - 1000 = 8191 : dernier bloc de la fenêtre
        bytes memory q2 = abi.encodePacked("q-8191");
        module.setMeasurements(q2, _measurements(productId, operator, s, x, 1000, false));
        vm.prank(operator);
        registry.registerEnclave(productId, q2, 1000, s, x, "");
        assertTrue(registry.enclaveOf(s).active);
    }

    /// @dev Réinscrit `signerPk_` pour (`pid`, `opPk_`), quote neuf ancré au bloc `r` (littéral).
    function _reRegister(uint256 pid, uint256 opPk_, uint256 signerPk_, bytes32 salt, bytes memory quote, uint256 r)
        internal
    {
        address op = vm.addr(opPk_);
        address s = vm.addr(signerPk_);
        module.setMeasurements(quote, _measurements(pid, op, s, _x25519Of(salt), r, false));
        vm.prank(op);
        registry.registerEnclave(pid, quote, r, s, _x25519Of(salt), "");
    }

    /// §9 « enclave expirée » (v2, en blocs) : inscrite au bloc 1000 → fenêtre [1000, 5999] ; la grâce
    /// (jusqu'au bloc 9999) ne sert qu'à régler des reçus ancrés DANS la fenêtre ; au-delà, plus rien.
    function test_isActiveAt_windowAndGrace() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // bloc 1000
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(s);
        assertEq(e.fromBlock, 1000);
        assertEq(e.untilBlock, 5999); // 1000 + 5 000 − 1 : exactement VALIDITY_BLOCKS blocs
        assertEq(registry.VALIDITY_BLOCKS(), TEST_VALIDITY_BLOCKS);
        assertEq(registry.GRACE_BLOCKS(), TEST_GRACE_BLOCKS);

        vm.roll(9999); // dernier bloc de la grâce
        assertTrue(registry.isActiveAt(s, productId, 1000));
        assertTrue(registry.isActiveAt(s, productId, 5999));
        assertFalse(registry.isActiveAt(s, productId, 999)); // avant l'inscription
        assertFalse(registry.isActiveAt(s, productId, 6000)); // après la fenêtre
        assertEq(registry.activeOperatorAt(s, productId, 5999), operator);

        vm.roll(10_000); // grâce écoulée
        assertFalse(registry.isActiveAt(s, productId, 1000));
        assertFalse(registry.isActiveAt(s, productId, 5999));
        assertEq(registry.activeOperatorAt(s, productId, 5999), address(0));
    }

    /// FIXED (revue adverse ; spécification C2 « vrai si l'enclave était active à ce bloc » ; C5 « enclave expirée au
    /// bloc d'ancrage : refusé »). Une enclave EXPIRÉE et non réattestée n'est plus « active » pour des blocs
    /// produits APRÈS son expiration, même pendant la grâce : validité réelle = VALIDITY_BLOCKS, pas le double.
    function test_FIXED_expiredEnclaveNotActiveForBlocksAfterExpiry() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // fenêtre [1000, 5999]
        vm.warp(vm.getBlockTimestamp() + 25 hours);
        vm.roll(7000); // expirée depuis 1 000 blocs, dans la grâce (jusqu'au bloc 9999)
        assertTrue(registry.isActiveAt(s, productId, 1000), "grace : un bloc de la fenetre reste reglable (voulu)");
        assertFalse(registry.isActiveAt(s, productId, 6000), "bloc posterieur a l'expiration : jamais actif");
        assertFalse(registry.isActiveAt(s, productId, 7000), "bloc posterieur a l'expiration : jamais actif");
    }

    /// FIXED (revue adverse) : la réattestation par le même opérateur (`operator renew`, toutes les ≈ 24 h) PROLONGE
    /// la fenêtre en cours au lieu de la remplacer : les reçus et réclamations ancrés avant le renouvellement
    /// restent réglables.
    function test_FIXED_renewalKeepsReceiptsAnchoredBeforeRenewal() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // bloc 1000, R = 999
        vm.roll(1010);
        vm.warp(vm.getBlockTimestamp() + 23 hours); // renouvellement avant l'expiration
        _reRegister(productId, opPk, signerPk, "s1", abi.encodePacked("quote-renew"), 1009);

        assertTrue(registry.isActiveAt(s, productId, 1010), "apres renouvellement : active");
        assertTrue(registry.isActiveAt(s, productId, 1005), "les blocs anterieurs au renouvellement restent actifs");
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(s);
        assertEq(e.fromBlock, 1000); // la fenêtre est prolongée, pas remplacée
        assertEq(e.untilBlock, 1010 + TEST_VALIDITY_BLOCKS - 1);
        (, IEnclaveRegistry.Window memory prev) = registry.windowsOf(s);
        assertEq(prev.operator, address(0)); // rien d'archivé : aucune fenêtre perdue
    }

    /// Renouvellement juste au bloc qui suit la fin de la fenêtre (5999 → 6000) : toujours sans trou, prolongé.
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

    /// Historique (correction 4) : réinscription APRÈS un trou. La fenêtre passée est gardée pour sa grâce
    /// (ses reçus restent réglables) ; les blocs du trou ne sont jamais valides ; la grâce écoulée, plus rien.
    function test_reRegistrationAfterGapKeepsPreviousWindowForGrace() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // [1000, 5999]
        vm.roll(7000); // expirée ; grâce de la 1re fenêtre jusqu'au bloc 9999
        _reRegister(productId, opPk, signerPk, "s1", abi.encodePacked("quote-gap"), 6999); // [7000, 11999]

        (IEnclaveRegistry.Window memory cur, IEnclaveRegistry.Window memory prev) = registry.windowsOf(s);
        assertEq(cur.fromBlock, 7000);
        assertEq(cur.untilBlock, 11_999);
        assertEq(prev.fromBlock, 1000);
        assertEq(prev.untilBlock, 5999);
        assertEq(prev.operator, operator);

        assertTrue(registry.isActiveAt(s, productId, 3000)); // fenêtre précédente, en grâce
        assertFalse(registry.isActiveAt(s, productId, 6500)); // le trou
        assertTrue(registry.isActiveAt(s, productId, 7000));

        vm.roll(10_000); // grâce de la 1re fenêtre écoulée
        assertFalse(registry.isActiveAt(s, productId, 3000));
        assertTrue(registry.isActiveAt(s, productId, 7000));
    }

    /// FIXED v2 (revue adverse, moyenne) : une clé est liée À VIE à son premier (opérateur, produit). La réinscrire
    /// sur un AUTRE produit (même opérateur) est refusé : une preuve d'équivocation reste recevable contre elle.
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
        assertTrue(registry.isActiveAt(s, productId, 1500)); // toujours au produit A
        assertFalse(registry.isActiveAt(s, pid2, 2000));
    }

    /// FIXED (revue adverse, scénario du kit O1) : un autre opérateur cautionné, muni d'un
    /// vrai quote liant SON adresse aux clés de l'enclave d'autrui, ne peut pas se l'approprier tant qu'elle
    /// est valide ou en grâce (erreur dédiée).
    function test_FIXED_otherOperatorCannotHijackLiveEnclave() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // inscrite par `operator`
        _bondOperator(op2Pk, 1000e6);
        bytes memory hijackQuote = abi.encodePacked("quote-hijack"); // vrai quote obtenu sur /attest avec operator2
        module.setMeasurements(hijackQuote, _measurements(productId, operator2, s, _x25519Of("s1"), 999, false));

        vm.prank(operator2);
        vm.expectRevert(
            abi.encodeWithSelector(EnclaveRegistry.EnclaveHeldByOtherOperator.selector, operator, uint256(10_000))
        );
        registry.registerEnclave(productId, hijackQuote, 999, s, _x25519Of("s1"), "");
        assertEq(registry.enclaveOf(s).operator, operator, "l'enclave reste a son operateur");
        assertTrue(registry.isActiveAt(s, productId, 1000));
    }

    /// Correction 2, bornes : refus pendant la validité ET la grâce (EnclaveHeldByOtherOperator) ; v2 : et APRÈS la
    /// grâce aussi (SignerBoundElsewhere) — une sybille ne reprend jamais la clé d'autrui.
    function test_takeoverRefusedDuringAndAfterGrace() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // [1000, 5999], tenue jusqu'à 9999
        _bondOperator(op2Pk, 1000e6);

        vm.roll(9999); // dernier bloc de la grâce : encore tenue
        bytes memory q1 = abi.encodePacked("quote-op2-9999");
        module.setMeasurements(q1, _measurements(productId, operator2, s, _x25519Of("s1"), 9998, false));
        vm.prank(operator2);
        vm.expectRevert(
            abi.encodeWithSelector(EnclaveRegistry.EnclaveHeldByOtherOperator.selector, operator, uint256(10_000))
        );
        registry.registerEnclave(productId, q1, 9998, s, _x25519Of("s1"), "");

        vm.roll(10_000); // grâce écoulée : la clé reste liée à `operator`
        bytes memory q2 = abi.encodePacked("quote-op2-10000");
        module.setMeasurements(q2, _measurements(productId, operator2, s, _x25519Of("s1"), 9999, false));
        vm.prank(operator2);
        vm.expectRevert(EnclaveRegistry.SignerBoundElsewhere.selector);
        registry.registerEnclave(productId, q2, 9999, s, _x25519Of("s1"), "");
        assertEq(registry.enclaveOf(s).operator, operator);
        assertEq(registry.activeOperatorAt(s, productId, 10_000), address(0));
    }

    /// Correction 2 : après un RETRAIT, la clé reste tenue pendant la grâce comptée depuis le retrait ; v2 : puis
    /// elle reste liée à son opérateur (aucune reprise).
    function test_takeoverAfterRetireRefused() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1");
        vm.roll(1010);
        vm.prank(operator);
        registry.retire(s); // fenêtre coupée à 1009, tenue jusqu'à 1009 + 4 000 = 5009
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

    /// FIXED v2 (revue adverse, haute) : retirer une image fautive invalide ses enclaves SANS grâce, avec ou sans
    /// quote ; la clé ne se réinscrit plus ; sa caution réservée est libérée.
    function test_FIXED_retiredWorkloadKillsEnclaveWithoutGrace() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1");
        vm.expectRevert(EnclaveRegistry.StillValid.selector);
        registry.invalidateRetiredWorkload(s); // image encore autorisée
        assertEq(bond.reservedFor(s), 100e6);

        vm.roll(1500);
        products.retireWorkload(productId, _workloadId()); // l'auteur (ce contrat) retire l'image
        registry.invalidateRetiredWorkload(s); // ouvert à tous, sans quote
        assertTrue(registry.killed(s));
        assertFalse(registry.isActiveAt(s, productId, 1200), "plus rien ne se regle, meme ancre avant");
        assertEq(registry.settleableUntilBlock(s), 0);
        assertEq(bond.reservedFor(s), 0);

        // l'image est réautorisée (timelock) : la clé tuée ne revient pas
        products.proposeWorkload(productId, _workloadId());
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.applyWorkload(productId, _workloadId());
        bytes memory q2 = abi.encodePacked("quote-revive");
        module.setMeasurements(q2, _measurements(productId, operator, s, _x25519Of("s1"), 1499, false));
        vm.prank(operator);
        vm.expectRevert(EnclaveRegistry.EnclaveKilled.selector);
        registry.registerEnclave(productId, q2, 1499, s, _x25519Of("s1"), "");
    }

    /// v2 : invalidate(signer, quote) suit la même règle quand l'image est retirée (sans grâce).
    function test_invalidateWithQuoteKillsRetiredWorkload() public {
        (address s, bytes memory quote) = _registerEnclave(productId, opPk, signerPk, "s1");
        products.retireWorkload(productId, _workloadId());
        registry.invalidate(s, quote);
        assertTrue(registry.killed(s));
        assertEq(registry.activeOperatorAt(s, productId, 1000), address(0));
    }

    /// v2 : dernier bloc réglable d'une clé = fin de fenêtre + grâce (sert à fermer plus tôt une session).
    function test_settleableUntilBlock() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1"); // [1000, 5999]
        assertEq(registry.settleableUntilBlock(s), 5999 + TEST_GRACE_BLOCKS);
        vm.roll(1010);
        vm.prank(operator);
        registry.retire(s); // coupée à 1009
        assertEq(registry.settleableUntilBlock(s), 1009 + TEST_GRACE_BLOCKS);
        assertEq(registry.settleableUntilBlock(makeAddr("inconnue")), 0);
    }

    /// `expiresAt` est un horodatage INDICATIF (affichage, planification du renouvellement) : inscription
    /// + VALIDITY_BLOCKS × BLOCK_TIME_MS ; la règle est en blocs.
    function test_expiresAtIsIndicativeFromBlocks() public {
        (address s,) = _registerEnclave(productId, opPk, signerPk, "s1");
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(s);
        assertEq(e.expiresAt, e.registeredAt + uint64(uint256(TEST_VALIDITY_BLOCKS) * TEST_BLOCK_TIME_MS / 1000));
        assertTrue(e.active);
    }

    /// Valeurs d'Arc (mesurées le 7/11/2026 : ≈ 508 ms/bloc sur mainnet et testnet) : 170 000 blocs ≈ 24 h.
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

    /// Paramètres invalides refusés au déploiement (validité nulle, durée de bloc nulle) ; grâce nulle permise.
    function test_constructorRejectsZeroParams() public {
        vm.expectRevert(EnclaveRegistry.BadParams.selector);
        new EnclaveRegistry(address(module), address(products), address(bond), false, 0, 1, 508);
        vm.expectRevert(EnclaveRegistry.BadParams.selector);
        new EnclaveRegistry(address(module), address(products), address(bond), false, 1, 1, 0);
        EnclaveRegistry strict = new EnclaveRegistry(address(module), address(products), address(bond), false, 1, 0, 1);
        assertEq(strict.GRACE_BLOCKS(), 0);
    }
}
