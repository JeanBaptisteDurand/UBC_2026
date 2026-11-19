// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {stdJson} from "forge-std/StdJson.sol";
import {Base} from "./Base.t.sol";
import {IAttestationModule} from "../src/interfaces/IAttestationModule.sol";
import {SealedBounty} from "../src/SealedBounty.sol";
import {UsdcPayer} from "../src/lib/UsdcPayer.sol";
import {MachineRegistry} from "../src/levels/MachineRegistry.sol";
import {PolicyEnclaves} from "../src/levels/PolicyEnclaves.sol";

/// @notice The Sealed Bounty at the VERIFIED level: the SAME SealedBounty contract, deployed with PolicyEnclaves in
///         place of the registry. Three distinct operators, three REAL registration quotes (same Phala machine): an
///         enclave whose machine is not declared signs no claim or refutation that counts; once declared, it
///         counts. The new settlement contract waits for the bond delay (8 days) before it can slash.
contract LevelsBountyTest is Base {
    using stdJson for string;

    bytes32 constant PREDICATE = keccak256("predicate-v0");
    bytes6 constant FMSPC = 0x20a06f000000;
    uint256 constant OP3_PK = 0xC0C;
    uint256 constant SIGNER3_PK = 0x5353;

    MachineRegistry machines;
    PolicyEnclaves view_;
    SealedBounty verifiedBounty;
    address auditor = makeAddr("auditor");
    address operator3;

    uint256 productId;
    uint256 bountyId;
    uint64 constant BLOCK_N = 1001;
    address s1;
    address s2;
    address s3;
    bytes q1;
    bytes q2;
    bytes q3;
    bytes16 ppid;

    function setUp() public override {
        super.setUp();
        machines = new MachineRegistry(address(registry), address(products));
        view_ = new PolicyEnclaves(address(registry), address(machines));
        verifiedBounty =
            new SealedBounty(address(usdc), address(products), address(view_), address(bond), address(verdict), treasury, 1000, 500);

        // a NEW settlement contract: proposed by the owner, authorized after the delay (8 days, for the bond and the
        // verdict log); every operator has time to leave first
        bond.proposeSettlement(address(verifiedBounty));
        verdict.proposeCaller(address(verifiedBounty));
        vm.expectRevert();
        bond.applySettlement(address(verifiedBounty));
        vm.warp(vm.getBlockTimestamp() + bond.SETTLEMENT_DELAY());
        bond.applySettlement(address(verifiedBounty));
        verdict.applyCaller(address(verifiedBounty));

        operator3 = vm.addr(OP3_PK);
        usdc.mint(operator3, 1_000_000e6);
        _bondOperator(opPk, 1000e6);
        _bondOperator(op2Pk, 1000e6);
        _bondOperator(OP3_PK, 1000e6);
        productId = _proposeAndActivate(address(verifiedBounty), true, bytes32(0), 0, 100e6, 100_000e6);

        string memory j = vm.readFile("test/vectors/archive-registration-quotes.json");
        q1 = j.readBytes(".quotes[0].quote");
        q2 = j.readBytes(".quotes[1].quote");
        q3 = j.readBytes(".quotes[2].quote");
        s1 = _registerWith(opPk, signerPk, q1);
        s2 = _registerWith(op2Pk, signer2Pk, q2);
        s3 = _registerWith(OP3_PK, SIGNER3_PK, q3);
        vm.roll(1002);

        // policy: verified level, one accepted verifier
        address[] memory a = new address[](1);
        a[0] = auditor;
        machines.proposePolicy(productId, 1, a);
        vm.warp(vm.getBlockTimestamp() + TIMELOCK);
        machines.applyPolicy(productId);
        bountyId = _createBounty();
    }

    function _registerWith(uint256 operatorPk, uint256 signerPk_, bytes memory quote) internal returns (address signer) {
        address op = vm.addr(operatorPk);
        signer = vm.addr(signerPk_);
        bytes32 x25519 = keccak256(abi.encodePacked("x25519", signerPk_));
        uint256 r = 999;
        IAttestationModule.Measurements memory m = _measurements(productId, op, signer, x25519, r, false);
        m.fmspc = FMSPC;
        module.setMeasurements(quote, m);
        vm.prank(op);
        registry.registerEnclave(productId, quote, r, signer, x25519, "");
    }

    function _verify(address signer, bytes memory quote) internal {
        ppid = machines.bindMachine(signer, quote);
        vm.prank(auditor);
        machines.attestMachine(ppid, uint64(vm.getBlockTimestamp() + 30 days), "datacenter", "rapport");
    }

    function _createBounty() internal returns (uint256 id) {
        uint256[] memory minLoss = new uint256[](1);
        minLoss[0] = 1e6;
        uint256[] memory amount = new uint256[](1);
        amount[0] = 100e6;
        UsdcPayer.Auth memory auth = _usdcAuth(protocolPk, address(verifiedBounty), 100_000e6, keccak256("fund-verified"));
        SealedBounty.CreateParams memory q = SealedBounty.CreateParams({
            productId: productId,
            predicateHash: PREDICATE,
            protocolX25519: keccak256("protoX"),
            tierMinLoss: minLoss,
            tierAmount: amount,
            singleCap: 200e6,
            k: 1,
            targetToPause: address(0),
            deadline: uint64(vm.getBlockTimestamp() + 1 days),
            funding: 100_000e6,
            auth: auth
        });
        vm.prank(protocol);
        id = verifiedBounty.createBounty(q);
    }

    function _claim(bytes32 fp, bytes32 cPHash) internal view returns (SealedBounty.Claim memory) {
        return SealedBounty.Claim({
            bountyId: bountyId,
            payee: hunter,
            blockN: BLOCK_N,
            blockHashN: keccak256(abi.encodePacked(bytes32(uint256(BLOCK_N)))),
            predicateHash: PREDICATE,
            loss: 5e6,
            tier: 0,
            fingerprint: fp,
            cPHash: cPHash,
            deadline: uint64(vm.getBlockTimestamp() + 1 hours)
        });
    }

    function _sigClaim(SealedBounty.Claim memory r, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                verifiedBounty.CLAIM_TYPEHASH(),
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
        return _sign(pk, _typed(address(verifiedBounty), structHash));
    }

    function _sigRef(SealedBounty.Refutation memory f, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(verifiedBounty.REFUTATION_TYPEHASH(), f.claimDigest, f.proven, f.loss, f.tier));
        return _sign(pk, _typed(address(verifiedBounty), structHash));
    }

    function _one(bytes memory a) internal pure returns (bytes[] memory s) {
        s = new bytes[](1);
        s[0] = a;
    }

    function _two(bytes memory a, bytes memory b) internal pure returns (bytes[] memory s) {
        s = new bytes[](2);
        s[0] = a;
        s[1] = b;
    }

    function test_claim_unverifiedMachineDoesNotCount_verifiedPays() public {
        bytes memory cP = bytes("sealed");
        SealedBounty.Claim memory r = _claim(keccak256("fp1"), keccak256(cP));
        bytes[] memory sigs = _one(_sigClaim(r, signerPk));
        vm.expectRevert(SealedBounty.NoValidSigner.selector);
        verifiedBounty.claim(r, sigs, cP);

        _verify(s1, q1);
        uint256 before = usdc.balanceOf(hunter);
        verifiedBounty.claim(r, sigs, cP);
        assertEq(usdc.balanceOf(hunter) - before, 100e6, unicode"palier payé sur la signature d'une machine vérifiée");
    }

    function test_refutation_quorumCountsOnlyVerifiedMachines() public {
        _verify(s1, q1);
        bytes memory cP = bytes("c");
        SealedBounty.Claim memory r = _claim(keccak256("fp-ref"), keccak256(cP));
        verifiedBounty.claim(r, _one(_sigClaim(r, signerPk)), cP);
        bytes32 digest = verifiedBounty.claimDigest(r);
        address[] memory ops = new address[](1);
        ops[0] = operator;
        SealedBounty.Refutation memory f = SealedBounty.Refutation({claimDigest: digest, proven: false, loss: 0, tier: 0});
        bytes[] memory good = _two(_sigRef(f, signer2Pk), _sigRef(f, SIGNER3_PK));

        // two enclaves of distinct operators, but their machines are not declared: the refutation is refused
        // (one enclave signature that is not active under the policy makes everything fail)
        vm.expectRevert(SealedBounty.NoValidSigner.selector);
        verifiedBounty.refute(r, ops, f, good);
        // only one bound to a declared machine: still refused
        machines.bindMachine(s2, q2);
        vm.expectRevert(SealedBounty.NoValidSigner.selector);
        verifiedBounty.refute(r, ops, f, good);
        // both bound to a declared machine: the refutation passes, the claim's operator is slashed
        machines.bindMachine(s3, q3);
        verifiedBounty.refute(r, ops, f, good);
        assertTrue(bond.banned(operator));
    }

    function test_revokedDeclarationStopsCountingAtOnce() public {
        _verify(s1, q1);
        bytes memory cP = bytes("sealed-2");
        SealedBounty.Claim memory r = _claim(keccak256("fp2"), keccak256(cP));
        bytes[] memory sigs = _one(_sigClaim(r, signerPk)); // before expectRevert (CLAIM_TYPEHASH is a call)
        vm.prank(auditor);
        machines.revokeMachine(ppid, "machine sortie du datacenter");
        vm.expectRevert(SealedBounty.NoValidSigner.selector);
        verifiedBounty.claim(r, sigs, cP);
    }
}
