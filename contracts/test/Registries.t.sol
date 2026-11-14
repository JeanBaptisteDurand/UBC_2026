// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {VerdictLog} from "../src/VerdictLog.sol";
import {IProductRegistry} from "../src/interfaces/IProductRegistry.sol";

contract ProductRegistryTest is Base {
    function _params(uint16 bo, uint16 ba, uint16 bn) internal view returns (ProductRegistry.ProposeParams memory q) {
        bytes32[] memory wl = new bytes32[](1);
        wl[0] = _workloadId();
        string[] memory adv = new string[](0);
        q = ProductRegistry.ProposeParams({
            manifestHash: keccak256("m"),
            manifestURI: "ipfs://m",
            workloadIds: wl,
            deterministic: false,
            price: 1e6,
            bpsOperator: bo,
            bpsAuthor: ba,
            bpsNetwork: bn,
            minBond: 100e6,
            exposureCap: 100_000e6,
            settlement: address(sessionPay),
            param: bytes32("model"),
            advisoryIds: adv,
            unitTokens: 1000,
            outWeight: 4
        });
    }

    function test_proposeActivateTimelock() public {
        uint256 pid = products.propose(_params(8000, 1000, 1000));
        vm.expectRevert(ProductRegistry.TooEarly.selector);
        products.activate(pid);
        vm.warp(block.timestamp + TIMELOCK + 1);
        products.activate(pid);
        assertTrue(products.isActive(pid));
        assertTrue(products.isWorkloadAllowed(pid, _workloadId()));
    }

    function test_badShares() public {
        vm.expectRevert(ProductRegistry.BadShares.selector);
        products.propose(_params(8000, 1000, 500)); // somme = 9500
    }

    /// Correction 9 : la redevance d'auteur est bornée à 30 % (3 000 bps) ; 30 % pile passe.
    function test_authorShareCappedAt30Percent() public {
        assertEq(products.MAX_AUTHOR_BPS(), 3000);
        vm.expectRevert(ProductRegistry.AuthorShareTooHigh.selector);
        products.propose(_params(6499, 3001, 500));
        vm.expectRevert(ProductRegistry.AuthorShareTooHigh.selector);
        products.propose(_params(0, 10_000, 0));

        uint256 pid = products.propose(_params(6500, 3000, 500));
        assertEq(products.getProduct(pid).bpsAuthor, 3000);
        uint256 own = products.propose(_params(9500, 0, 500)); // produit maison (F-économie §0.2)
        assertEq(products.getProduct(own).bpsOperator, 9500);
    }

    /// FIXED v2 (revue adverse, basse (a)) : la part du réseau est d'au moins 5 %, même sur un produit tiers.
    function test_FIXED_networkShareAtLeast5Percent() public {
        assertEq(products.MIN_NETWORK_BPS(), 500);
        vm.expectRevert(ProductRegistry.NetworkShareTooLow.selector);
        products.propose(_params(7000, 3000, 0)); // un auteur tiers voudrait 0 % au réseau
        vm.expectRevert(ProductRegistry.NetworkShareTooLow.selector);
        products.propose(_params(7501, 2000, 499));
        products.propose(_params(7000, 2500, 500)); // 5 % pile : accepté
    }

    /// v2 : l'unité facturée est un champ du produit (fixé à la proposition) ; 0 = 1 (comportement v1).
    function test_unitFieldsStoredOnProduct() public {
        uint256 pid = products.propose(_params(8000, 1000, 1000));
        IProductRegistry.Product memory p = products.getProduct(pid);
        assertEq(p.unitTokens, 1000);
        assertEq(p.outWeight, 4);
        ProductRegistry.ProposeParams memory q = _params(8000, 1000, 1000);
        q.unitTokens = 0;
        q.outWeight = 0;
        IProductRegistry.Product memory v1 = products.getProduct(products.propose(q));
        assertEq(v1.unitTokens, 1);
        assertEq(v1.outWeight, 1);
    }

    function test_retireWorkloadImmediate() public {
        uint256 pid = products.propose(_params(8000, 1000, 1000));
        vm.warp(block.timestamp + TIMELOCK + 1);
        products.activate(pid);
        assertTrue(products.isWorkloadAllowed(pid, _workloadId()));
        products.retireWorkload(pid, _workloadId());
        assertFalse(products.isWorkloadAllowed(pid, _workloadId()));
    }

    /// FIXED v2 (revue adverse, moyenne) : une image ajoutée après coup passe par le timelock (proposeWorkload →
    /// applyWorkload), seul l'auteur la propose, et retireWorkload annule une proposition en attente.
    function test_FIXED_addWorkloadGoesThroughTimelock() public {
        uint256 pid = products.propose(_params(8000, 1000, 1000));
        vm.warp(block.timestamp + TIMELOCK + 1);
        products.activate(pid);
        bytes32 w2 = keccak256("image UNIT_TOKENS=1");

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ProductRegistry.NotAuthor.selector);
        products.proposeWorkload(pid, w2);

        products.proposeWorkload(pid, w2);
        assertFalse(products.isWorkloadAllowed(pid, w2), "pas d'effet immediat");
        vm.expectRevert(ProductRegistry.TooEarly.selector);
        products.applyWorkload(pid, w2);

        vm.warp(block.timestamp + TIMELOCK);
        products.applyWorkload(pid, w2); // n'importe qui, une fois le délai écoulé
        assertTrue(products.isWorkloadAllowed(pid, w2));

        bytes32 w3 = keccak256("image 3");
        products.proposeWorkload(pid, w3);
        products.retireWorkload(pid, w3); // annule la proposition
        vm.warp(block.timestamp + TIMELOCK + 1);
        vm.expectRevert(ProductRegistry.NoPendingWorkload.selector);
        products.applyWorkload(pid, w3);
    }

    function test_proposeUpdateTimelock() public {
        uint256 pid = products.propose(_params(8000, 1000, 1000));
        vm.warp(block.timestamp + TIMELOCK + 1);
        products.activate(pid);
        products.proposeUpdate(pid, keccak256("m2"), 2e6, bytes32("model2"));
        vm.expectRevert(ProductRegistry.TooEarly.selector);
        products.applyUpdate(pid);
        vm.warp(block.timestamp + TIMELOCK + 1);
        products.applyUpdate(pid);
        IProductRegistry.Product memory p = products.getProduct(pid);
        assertEq(p.price, 2e6);
        assertEq(p.param, bytes32("model2"));
        assertEq(p.version, 2);
    }

    /// v2.1 : une mise à jour peut AUSSI changer manifestURI, derrière le MÊME timelock ; l'URI proposé est public
    /// pendant l'attente ; seul l'auteur propose ; n'importe qui applique.
    function test_v21_proposeUpdateWithURI_timelocked() public {
        uint256 pid = products.propose(_params(8000, 1000, 1000));
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.activate(pid);

        vm.prank(user);
        vm.expectRevert(ProductRegistry.NotAuthor.selector);
        products.proposeUpdateWithURI(pid, keccak256("m2"), "ipfs://m2", 2e6, bytes32("model2"));

        uint64 applyAt = uint64(vm.getBlockTimestamp()) + TIMELOCK;
        vm.expectEmit(true, false, false, true, address(products));
        emit ProductRegistry.ManifestURIUpdateProposed(pid, "ipfs://m2", applyAt);
        products.proposeUpdateWithURI(pid, keccak256("m2"), "ipfs://m2", 2e6, bytes32("model2"));
        (bool set, string memory pending) = products.pendingManifestURI(pid);
        assertTrue(set);
        assertEq(pending, "ipfs://m2");

        vm.expectRevert(ProductRegistry.TooEarly.selector);
        products.applyUpdate(pid);
        assertEq(products.manifestURI(pid), "ipfs://m", "inchange avant le timelock");

        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        vm.expectEmit(true, false, false, true, address(products));
        emit ProductRegistry.ManifestURIUpdated(pid, "ipfs://m2");
        vm.prank(user); // n'importe qui applique, une fois le délai écoulé
        products.applyUpdate(pid);

        assertEq(products.manifestURI(pid), "ipfs://m2");
        IProductRegistry.Product memory p = products.getProduct(pid);
        assertEq(p.manifestHash, keccak256("m2"));
        assertEq(p.price, 2e6);
        assertEq(p.param, bytes32("model2"));
        assertEq(p.version, 2);
        (set,) = products.pendingManifestURI(pid);
        assertFalse(set, "plus rien en attente");
    }

    /// v2.1 : une nouvelle proposition SANS URI remplace la précédente en entier : l'URI proposé avant n'est pas appliqué
    /// (rien ne passe sans avoir été visible pendant tout le timelock).
    function test_v21_proposeUpdateWithoutURI_dropsPendingURI() public {
        uint256 pid = products.propose(_params(8000, 1000, 1000));
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.activate(pid);

        products.proposeUpdateWithURI(pid, keccak256("m2"), "ipfs://autre", 2e6, bytes32("model2"));
        products.proposeUpdate(pid, keccak256("m3"), 3e6, bytes32("model3"));
        (bool set,) = products.pendingManifestURI(pid);
        assertFalse(set);

        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        products.applyUpdate(pid);
        assertEq(products.manifestURI(pid), "ipfs://m", "URI inchange");
        IProductRegistry.Product memory p = products.getProduct(pid);
        assertEq(p.manifestHash, keccak256("m3"));
        assertEq(p.price, 3e6);
        assertEq(p.version, 2);
    }
}

contract OperatorBondTest is Base {
    address reporter = makeAddr("reporter");
    address victim = makeAddr("victim");

    function test_bondAndUnbondDelay() public {
        _bondOperator(opPk, 1000e6);
        assertEq(bond.bondOf(operator), 1000e6);

        vm.prank(operator);
        bond.requestUnbond(400e6);
        assertEq(bond.availableBond(operator), 600e6);

        vm.prank(operator);
        vm.expectRevert(OperatorBond.UnbondLocked.selector);
        bond.withdraw();

        vm.warp(block.timestamp + 7 days + 1);
        uint256 balBefore = usdc.balanceOf(operator);
        vm.prank(operator);
        bond.withdraw();
        assertEq(usdc.balanceOf(operator) - balBefore, 400e6);
        assertEq(bond.bondOf(operator), 600e6);
    }

    function test_exposureHalfBondCap() public {
        _bondWithSelfAsSettlement();
        _bondOperator(opPk, 1000e6); // moitié = 500e6

        bond.consumeExposure(operator, 1, 300e6, 0); // plafond produit 0 = seule la règle de la caution
        vm.expectRevert(OperatorBond.TooMuchExposure.selector);
        bond.consumeExposure(operator, 1, 201e6, 0); // 501 > 500

        // v2 : fenêtre GLISSANTE (trois seaux de 12 h) : l'exposition compte encore à + 24 h, plus à + 36 h
        vm.warp(block.timestamp + 24 hours + 1);
        vm.expectRevert(OperatorBond.TooMuchExposure.selector);
        bond.consumeExposure(operator, 1, 400e6, 0);
        vm.warp(vm.getBlockTimestamp() + 12 hours);
        bond.consumeExposure(operator, 1, 400e6, 0);
        assertEq(bond.exposureOf(operator, 1), 400e6);
    }

    /// Correction 10 : le plafond du produit s'ajoute à « ½ caution » ; il compte par (opérateur, produit) ;
    /// v2 : la règle « ½ caution » est GLOBALE (tous produits confondus) ; le plus strict des deux s'applique.
    function test_exposureProductCapOnTopOfHalfBond() public {
        _bondWithSelfAsSettlement();
        _bondOperator(opPk, 1000e6); // ½ caution = 500

        bond.consumeExposure(operator, 1, 80e6, 100e6);
        vm.expectRevert(OperatorBond.ExposureCapExceeded.selector);
        bond.consumeExposure(operator, 1, 21e6, 100e6); // 101 > plafond 100 (alors que ½ caution = 500)
        bond.consumeExposure(operator, 1, 20e6, 100e6); // 100 pile
        bond.consumeExposure(operator, 2, 100e6, 100e6); // autre produit : son propre plafond
        assertEq(bond.totalExposureOf(operator), 200e6);

        // ½ caution GLOBALE : 200 déjà pris, 301 de plus dépasserait 500
        vm.expectRevert(OperatorBond.TooMuchExposure.selector);
        bond.consumeExposure(operator, 3, 301e6, 1_000e6);
        bond.consumeExposure(operator, 3, 300e6, 1_000e6);

        // 36 h plus tard : plus rien ne compte
        vm.warp(block.timestamp + 36 hours + 1);
        bond.consumeExposure(operator, 1, 100e6, 100e6);
        assertEq(bond.exposureOf(operator, 1), 100e6);
        assertEq(bond.totalExposureOf(operator), 100e6);
    }

    /// FIXED v2 (revue adverse, moyenne) : ½ caution sur TOUTE période de 24 h, quel que soit le découpage — y compris
    /// à cheval sur une limite de seau, et en répartissant sur plusieurs produits.
    function test_FIXED_noMoreThanHalfBondOverAny24h() public {
        _bondWithSelfAsSettlement();
        _bondOperator(opPk, 1000e6);
        uint256 t0 = vm.getBlockTimestamp();
        uint256 taken;
        // 50 prises de 10 USDC, une toutes les 30 min, réparties sur 5 produits, puis tout ce qui passe encore
        for (uint256 i = 0; i < 48; i++) {
            vm.warp(t0 + i * 30 minutes);
            try bond.consumeExposure(operator, 1 + (i % 5), 30e6, 0) {
                taken += 30e6;
            } catch {}
        }
        assertLe(taken, 500e6, "jamais plus de 1/2 caution sur 24 h, tous produits confondus");
    }

    function test_consumeExposureRevertNotSettlement() public {
        _bondOperator(opPk, 1000e6);
        vm.expectRevert(OperatorBond.NotSettlement.selector);
        bond.consumeExposure(operator, 1, 1e6, 0);
    }

    function test_slashSplit() public {
        _bondWithSelfAsSettlement();
        _bondOperator(opPk, 1000e6);

        uint256 rBefore = usdc.balanceOf(reporter);
        uint256 vBefore = usdc.balanceOf(victim);
        bond.slash(operator, reporter, victim);

        assertEq(usdc.balanceOf(reporter) - rBefore, 500e6);
        assertEq(usdc.balanceOf(victim) - vBefore, 500e6);
        assertEq(bond.bondOf(operator), 0);
        assertTrue(bond.banned(operator));
    }

    function test_slashToTreasuryWhenNoVictim() public {
        _bondWithSelfAsSettlement();
        _bondOperator(opPk, 1000e6);
        uint256 tBefore = usdc.balanceOf(treasury);
        bond.slash(operator, reporter, address(0));
        assertEq(usdc.balanceOf(treasury) - tBefore, 500e6);
    }

    /// FIXED v2 (revue adverse, haute) : plus de clé qui saisit les cautions. Câblage UNE fois par le déployeur ;
    /// ensuite un nouveau contrat de règlement n'est autorisé qu'après 8 jours : l'opérateur part avant.
    function test_FIXED_newSettlementOnlyAfterDelay() public {
        _bondOperator(opPk, 1000e6);
        address[] memory none = new address[](0);
        vm.expectRevert(OperatorBond.AlreadyInitialized.selector);
        bond.initialize(address(registry), none);

        OperatorBond fresh = new OperatorBond(address(usdc), treasury, makeAddr("multisig"), address(identity));
        vm.prank(makeAddr("multisig"));
        vm.expectRevert(OperatorBond.NotDeployer.selector);
        fresh.initialize(address(registry), none);

        address thief = makeAddr("thief");
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(OperatorBond.NotOwner.selector);
        bond.proposeSettlement(thief);

        bond.proposeSettlement(thief); // ce contrat de test est le propriétaire
        assertFalse(bond.isSettlement(thief));
        vm.expectRevert(OperatorBond.TooEarly.selector);
        bond.applySettlement(thief);

        // l'opérateur voit la proposition et retire sa caution avant qu'elle prenne effet
        vm.prank(operator);
        bond.requestUnbond(1000e6);
        vm.warp(block.timestamp + bond.UNBOND_DELAY());
        vm.prank(operator);
        bond.withdraw();
        assertEq(bond.bondOf(operator), 0);

        vm.warp(vm.getBlockTimestamp() + 1 days);
        bond.applySettlement(thief);
        assertTrue(bond.isSettlement(thief));

        // frein d'urgence : retrait immédiat
        bond.removeSettlement(thief);
        assertFalse(bond.isSettlement(thief));
    }

    /// FIXED v2 (revue adverse, haute) : aucun retrait moins de 7 jours après la dernière exposition.
    function test_FIXED_withdrawLockedSevenDaysAfterExposure() public {
        _bondWithSelfAsSettlement();
        _bondOperator(opPk, 1000e6);
        vm.prank(operator);
        bond.requestUnbond(100e6);
        vm.warp(block.timestamp + 6 days);
        bond.consumeExposure(operator, 1, 10e6, 0); // exposition au 6e jour
        vm.warp(vm.getBlockTimestamp() + 1 days + 1); // la demande a plus de 7 jours, l'exposition 1 jour
        vm.prank(operator);
        vm.expectRevert(OperatorBond.UnbondLocked.selector);
        bond.withdraw();
        assertEq(bond.withdrawableAt(operator), bond.lastExposureAt(operator) + bond.UNBOND_DELAY());
        vm.warp(bond.withdrawableAt(operator));
        vm.prank(operator);
        bond.withdraw();
        assertEq(bond.bondOf(operator), 900e6);
    }

    /// FIXED v2 (revue adverse, basse (d)) : la caution minimale est réservée par clé d'enclave ; seule la caution
    /// libre se retire ou couvre une nouvelle enclave.
    function test_FIXED_minBondReservedPerEnclave() public {
        _bondOperator(opPk, 250e6);
        uint256 pid = _proposeAndActivate(address(sessionPay), false, bytes32("m"), 1e6, 100e6, 0);
        _registerEnclave(pid, opPk, 0x7001, "r1");
        _registerEnclave(pid, opPk, 0x7002, "r2");
        assertEq(bond.freeBond(operator), 50e6);
        assertEq(bond.reservedFor(vm.addr(0x7001)), 100e6);

        // une 3e enclave ne tient plus sur 50 USDC libres
        bytes32 x = keccak256(abi.encodePacked("x25519", bytes32("r3")));
        bytes memory q = abi.encodePacked("quote", bytes32("r3"));
        module.setMeasurements(q, _measurements(pid, operator, vm.addr(0x7003), x, 999, false));
        vm.prank(operator);
        vm.expectRevert(); // EnclaveRegistry.OperatorUnderbonded
        registry.registerEnclave(pid, q, 999, vm.addr(0x7003), x, "");

        vm.prank(operator);
        vm.expectRevert(OperatorBond.InsufficientBond.selector);
        bond.requestUnbond(51e6);

        // retirer une enclave libère sa réservation
        vm.prank(operator);
        registry.retire(vm.addr(0x7001));
        assertEq(bond.freeBond(operator), 150e6);
        vm.prank(operator);
        bond.requestUnbond(150e6);

        // seul le registre réserve ou libère
        vm.expectRevert(OperatorBond.NotRegistry.selector);
        bond.release(vm.addr(0x7002));
    }

    /// v2 (revue adverse, plausible) : on ne se lie qu'à un agent ERC-8004 dont on est propriétaire (ou approuvé).
    function test_setAgentIdRequiresOwnership() public {
        vm.prank(operator);
        uint256 agent = identity.register("ipfs://agent-operateur");
        vm.prank(operator);
        bond.setAgentId(agent);
        assertEq(bond.agentIdOf(operator), agent);

        vm.prank(operator2);
        vm.expectRevert(OperatorBond.NotAgentOwner.selector);
        bond.setAgentId(agent);

        vm.prank(operator); // le propriétaire approuve operator2 : il peut s'y lier, operator perd le lien
        identity.setApprovalForAll(operator2, true);
        vm.prank(operator2);
        bond.setAgentId(agent);
        assertEq(bond.agentIdOf(operator2), agent);
        assertEq(bond.agentIdOf(operator), 0);
    }
}

contract VerdictLogTest is Base {
    /// FIXED v2 (revue adverse, haute) : VerdictLog — câblage une fois par le déployeur, nouvel appelant après 8 jours,
    /// retrait immédiat ; une clé seule n'écrit plus de faux verdict.
    function test_FIXED_newCallerOnlyAfterDelay() public {
        address[] memory none = new address[](0);
        vm.expectRevert(VerdictLog.AlreadyInitialized.selector);
        verdict.initialize(none);

        address forger = makeAddr("forger");
        verdict.proposeCaller(forger);
        vm.prank(forger);
        vm.expectRevert(VerdictLog.NotCaller.selector);
        verdict.record(1, keccak256("faux"), "", bytes32(0), "", 100, "tdx-dcap/inference");

        vm.expectRevert(VerdictLog.TooEarly.selector);
        verdict.applyCaller(forger);
        vm.warp(block.timestamp + verdict.CALLER_DELAY());
        verdict.applyCaller(forger);
        assertTrue(verdict.isCaller(forger));

        verdict.removeCaller(forger);
        assertFalse(verdict.isCaller(forger));

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(VerdictLog.NotOwner.selector);
        verdict.proposeCaller(forger);
    }
}
