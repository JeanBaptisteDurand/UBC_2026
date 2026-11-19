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

    /// The author's royalty is capped at 30 % (3,000 bps); exactly 30 % passes.
    function test_authorShareCappedAt30Percent() public {
        assertEq(products.MAX_AUTHOR_BPS(), 3000);
        vm.expectRevert(ProductRegistry.AuthorShareTooHigh.selector);
        products.propose(_params(6499, 3001, 500));
        vm.expectRevert(ProductRegistry.AuthorShareTooHigh.selector);
        products.propose(_params(0, 10_000, 0));

        uint256 pid = products.propose(_params(6500, 3000, 500));
        assertEq(products.getProduct(pid).bpsAuthor, 3000);
        uint256 own = products.propose(_params(9500, 0, 500)); // first-party product (mainnet economics)
        assertEq(products.getProduct(own).bpsOperator, 9500);
    }

    /// FIXED v2 (adversarial review, low): the network share is at least 5 %, even on a third-party product.
    function test_FIXED_networkShareAtLeast5Percent() public {
        assertEq(products.MIN_NETWORK_BPS(), 500);
        vm.expectRevert(ProductRegistry.NetworkShareTooLow.selector);
        products.propose(_params(7000, 3000, 0)); // a third-party author would like 0 % for the network
        vm.expectRevert(ProductRegistry.NetworkShareTooLow.selector);
        products.propose(_params(7501, 2000, 499));
        products.propose(_params(7000, 2500, 500)); // exactly 5 %: accepted
    }

    /// The billed unit is a field of the product (set at proposal); 0 = 1 (the original behaviour).
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

    /// FIXED v2 (adversarial review, medium): an image added later goes through the timelock (proposeWorkload →
    /// applyWorkload), only the author proposes it, and retireWorkload cancels a pending proposal.
    function test_FIXED_addWorkloadGoesThroughTimelock() public {
        uint256 pid = products.propose(_params(8000, 1000, 1000));
        vm.warp(block.timestamp + TIMELOCK + 1);
        products.activate(pid);
        bytes32 w2 = keccak256("image UNIT_TOKENS=1");

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ProductRegistry.NotAuthor.selector);
        products.proposeWorkload(pid, w2);

        products.proposeWorkload(pid, w2);
        assertFalse(products.isWorkloadAllowed(pid, w2), "no immediate effect");
        vm.expectRevert(ProductRegistry.TooEarly.selector);
        products.applyWorkload(pid, w2);

        vm.warp(block.timestamp + TIMELOCK);
        products.applyWorkload(pid, w2); // anyone, once the delay has passed
        assertTrue(products.isWorkloadAllowed(pid, w2));

        bytes32 w3 = keccak256("image 3");
        products.proposeWorkload(pid, w3);
        products.retireWorkload(pid, w3); // cancels the proposal
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

    /// v2.1: an update can ALSO change manifestURI, behind the SAME timelock; the proposed URI is public
    /// during the wait; only the author proposes; anyone applies.
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
        assertEq(products.manifestURI(pid), "ipfs://m", "unchanged before the timelock");

        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1);
        vm.expectEmit(true, false, false, true, address(products));
        emit ProductRegistry.ManifestURIUpdated(pid, "ipfs://m2");
        vm.prank(user); // anyone applies, once the delay has passed
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

    /// v2.1: a new proposal WITHOUT a URI replaces the previous one entirely: the URI proposed before is not applied
    /// (nothing passes without having been visible for the whole timelock).
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
        assertEq(products.manifestURI(pid), "ipfs://m", "URI unchanged");
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
        _bondOperator(opPk, 1000e6); // half = 500e6

        bond.consumeExposure(operator, 1, 300e6, 0); // product cap 0 = only the bond rule
        vm.expectRevert(OperatorBond.TooMuchExposure.selector);
        bond.consumeExposure(operator, 1, 201e6, 0); // 501 > 500

        // ROLLING window (three 12 h buckets): the exposure still counts at + 24 h, no longer at + 36 h
        vm.warp(block.timestamp + 24 hours + 1);
        vm.expectRevert(OperatorBond.TooMuchExposure.selector);
        bond.consumeExposure(operator, 1, 400e6, 0);
        vm.warp(vm.getBlockTimestamp() + 12 hours);
        bond.consumeExposure(operator, 1, 400e6, 0);
        assertEq(bond.exposureOf(operator, 1), 400e6);
    }

    /// The product cap adds to "½ bond"; it counts per (operator, product);
    /// the "½ bond" rule is GLOBAL (all products together); the stricter of the two applies.
    function test_exposureProductCapOnTopOfHalfBond() public {
        _bondWithSelfAsSettlement();
        _bondOperator(opPk, 1000e6); // ½ bond = 500

        bond.consumeExposure(operator, 1, 80e6, 100e6);
        vm.expectRevert(OperatorBond.ExposureCapExceeded.selector);
        bond.consumeExposure(operator, 1, 21e6, 100e6); // 101 > cap 100 (while ½ bond = 500)
        bond.consumeExposure(operator, 1, 20e6, 100e6); // 100 pile
        bond.consumeExposure(operator, 2, 100e6, 100e6); // another product: its own cap
        assertEq(bond.totalExposureOf(operator), 200e6);

        // GLOBAL ½ bond: 200 already taken, 301 more would exceed 500
        vm.expectRevert(OperatorBond.TooMuchExposure.selector);
        bond.consumeExposure(operator, 3, 301e6, 1_000e6);
        bond.consumeExposure(operator, 3, 300e6, 1_000e6);

        // 36 h later: nothing counts any more
        vm.warp(block.timestamp + 36 hours + 1);
        bond.consumeExposure(operator, 1, 100e6, 100e6);
        assertEq(bond.exposureOf(operator, 1), 100e6);
        assertEq(bond.totalExposureOf(operator), 100e6);
    }

    /// FIXED v2 (adversarial review, medium): ½ bond over ANY 24 h period, however it is split, including
    /// across a bucket boundary, and when spread over several products.
    function test_FIXED_noMoreThanHalfBondOverAny24h() public {
        _bondWithSelfAsSettlement();
        _bondOperator(opPk, 1000e6);
        uint256 t0 = vm.getBlockTimestamp();
        uint256 taken;
        // 50 draws of 10 USDC, one every 30 min, spread over 5 products, then everything that still passes
        for (uint256 i = 0; i < 48; i++) {
            vm.warp(t0 + i * 30 minutes);
            try bond.consumeExposure(operator, 1 + (i % 5), 30e6, 0) {
                taken += 30e6;
            } catch {}
        }
        assertLe(taken, 500e6, "never more than 1/2 bond over 24 h, all products together");
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

    /// FIXED v2 (adversarial review, high): no key can seize bonds any more. Wiring happens ONCE by the deployer;
    /// after that, a new settlement contract is allowed only after 8 days: the operator leaves first.
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

        bond.proposeSettlement(thief); // this test contract is the owner
        assertFalse(bond.isSettlement(thief));
        vm.expectRevert(OperatorBond.TooEarly.selector);
        bond.applySettlement(thief);

        // the operator sees the proposal and withdraws its bond before it takes effect
        vm.prank(operator);
        bond.requestUnbond(1000e6);
        vm.warp(block.timestamp + bond.UNBOND_DELAY());
        vm.prank(operator);
        bond.withdraw();
        assertEq(bond.bondOf(operator), 0);

        vm.warp(vm.getBlockTimestamp() + 1 days);
        bond.applySettlement(thief);
        assertTrue(bond.isSettlement(thief));

        // emergency brake: immediate removal
        bond.removeSettlement(thief);
        assertFalse(bond.isSettlement(thief));
    }

    /// FIXED v2 (adversarial review, high): no withdrawal less than 7 days after the last exposure.
    function test_FIXED_withdrawLockedSevenDaysAfterExposure() public {
        _bondWithSelfAsSettlement();
        _bondOperator(opPk, 1000e6);
        vm.prank(operator);
        bond.requestUnbond(100e6);
        vm.warp(block.timestamp + 6 days);
        bond.consumeExposure(operator, 1, 10e6, 0); // exposure on day 6
        vm.warp(vm.getBlockTimestamp() + 1 days + 1); // the request is more than 7 days old, the exposure 1 day
        vm.prank(operator);
        vm.expectRevert(OperatorBond.UnbondLocked.selector);
        bond.withdraw();
        assertEq(bond.withdrawableAt(operator), bond.lastExposureAt(operator) + bond.UNBOND_DELAY());
        vm.warp(bond.withdrawableAt(operator));
        vm.prank(operator);
        bond.withdraw();
        assertEq(bond.bondOf(operator), 900e6);
    }

    /// FIXED v2 (adversarial review, low): the minimum bond is reserved per enclave key; only the free bond
    /// can be withdrawn or cover a new enclave.
    function test_FIXED_minBondReservedPerEnclave() public {
        _bondOperator(opPk, 250e6);
        uint256 pid = _proposeAndActivate(address(sessionPay), false, bytes32("m"), 1e6, 100e6, 0);
        _registerEnclave(pid, opPk, 0x7001, "r1");
        _registerEnclave(pid, opPk, 0x7002, "r2");
        assertEq(bond.freeBond(operator), 50e6);
        assertEq(bond.reservedFor(vm.addr(0x7001)), 100e6);

        // a 3rd enclave no longer fits in 50 free USDC
        bytes32 x = keccak256(abi.encodePacked("x25519", bytes32("r3")));
        bytes memory q = abi.encodePacked("quote", bytes32("r3"));
        module.setMeasurements(q, _measurements(pid, operator, vm.addr(0x7003), x, 999, false));
        vm.prank(operator);
        vm.expectRevert(); // EnclaveRegistry.OperatorUnderbonded
        registry.registerEnclave(pid, q, 999, vm.addr(0x7003), x, "");

        vm.prank(operator);
        vm.expectRevert(OperatorBond.InsufficientBond.selector);
        bond.requestUnbond(51e6);

        // retiring an enclave releases its reservation
        vm.prank(operator);
        registry.retire(vm.addr(0x7001));
        assertEq(bond.freeBond(operator), 150e6);
        vm.prank(operator);
        bond.requestUnbond(150e6);

        // only the registry reserves or releases
        vm.expectRevert(OperatorBond.NotRegistry.selector);
        bond.release(vm.addr(0x7002));
    }

    /// Adversarial review (plausible): one can only link to an ERC-8004 agent one owns (or is approved for).
    function test_setAgentIdRequiresOwnership() public {
        vm.prank(operator);
        uint256 agent = identity.register("ipfs://operator-agent");
        vm.prank(operator);
        bond.setAgentId(agent);
        assertEq(bond.agentIdOf(operator), agent);

        vm.prank(operator2);
        vm.expectRevert(OperatorBond.NotAgentOwner.selector);
        bond.setAgentId(agent);

        vm.prank(operator); // the owner approves operator2: it can link to it, operator loses the link
        identity.setApprovalForAll(operator2, true);
        vm.prank(operator2);
        bond.setAgentId(agent);
        assertEq(bond.agentIdOf(operator2), agent);
        assertEq(bond.agentIdOf(operator), 0);
    }
}

contract VerdictLogTest is Base {
    /// FIXED v2 (adversarial review, high): VerdictLog: wiring once by the deployer, a new caller after 8 days,
    /// immediate removal; a key alone can no longer write a false verdict.
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
