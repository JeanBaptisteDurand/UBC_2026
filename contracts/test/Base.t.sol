// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {MockUSDC3009} from "./mocks/MockUSDC3009.sol";
import {MockAttestationModule} from "./mocks/MockAttestationModule.sol";
import {MockIdentityRegistry, MockValidationRegistry} from "./mocks/MockERC8004.sol";
import {MockHistory} from "./mocks/MockHistory.sol";

import {IAttestationModule} from "../src/interfaces/IAttestationModule.sol";
import {IProductRegistry} from "../src/interfaces/IProductRegistry.sol";
import {UsdcPayer} from "../src/lib/UsdcPayer.sol";

import {EnclaveRegistry} from "../src/EnclaveRegistry.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {VerdictLog} from "../src/VerdictLog.sol";
import {SessionPay} from "../src/SessionPay.sol";
import {SealedBounty} from "../src/SealedBounty.sol";
import {X402Settler} from "../src/X402Settler.sol";

/// @notice Shared test base: deploys the infrastructure, wires permissions, installs the EIP-2935 history,
///         and provides helpers (attestation measurements, EIP-712 signatures, bonding, enclave registration).
abstract contract Base is Test {
    address internal constant HISTORY_ADDR = 0x0000F90827F1C53a10cb7A02335B175320002935;
    uint64 internal constant TIMELOCK = 5 minutes;
    /// @dev Validity is counted in blocks. Windows are SHORT in tests (Arc mainnet: 170,000 blocks ≈ 24 h):
    ///      registered at block 1000 → window [1000, 5999], grace until block 9999. Long enough for the
    ///      EIP-2935 window (8,191 blocks), short enough to test "anchored inside the window, settled after the
    ///      grace period" without leaving that window.
    uint64 internal constant TEST_VALIDITY_BLOCKS = 5_000;
    uint64 internal constant TEST_GRACE_BLOCKS = 4_000;
    uint64 internal constant TEST_BLOCK_TIME_MS = 508;

    MockUSDC3009 internal usdc;
    MockAttestationModule internal module;
    MockIdentityRegistry internal identity;
    MockValidationRegistry internal validation;
    ProductRegistry internal products;
    OperatorBond internal bond;
    EnclaveRegistry internal registry;
    VerdictLog internal verdict;
    SessionPay internal sessionPay;
    SealedBounty internal sealedBounty;
    X402Settler internal x402;

    address internal treasury = makeAddr("treasury");

    // actors with keys
    uint256 internal opPk = 0xA11CE;
    uint256 internal op2Pk = 0xB0B;
    uint256 internal signerPk = 0x5151;
    uint256 internal signer2Pk = 0x5252;
    uint256 internal userPk = 0xADA;
    uint256 internal hunterPk = 0x40C;
    uint256 internal protocolPk = 0x9971;

    address internal operator;
    address internal operator2;
    address internal user;
    address internal hunter;
    address internal protocol;

    function setUp() public virtual {
        // readable key labels
        operator = vm.addr(opPk);
        operator2 = vm.addr(op2Pk);
        user = vm.addr(userPk);
        hunter = vm.addr(hunterPk);
        protocol = vm.addr(protocolPk);

        vm.roll(1000);
        vm.warp(1_000_000);

        usdc = new MockUSDC3009();
        module = new MockAttestationModule();
        identity = new MockIdentityRegistry();
        validation = new MockValidationRegistry();

        products = new ProductRegistry(TIMELOCK);
        bond = new OperatorBond(address(usdc), treasury, address(this), address(identity));
        registry = new EnclaveRegistry(
            address(module),
            address(products),
            address(bond),
            false,
            TEST_VALIDITY_BLOCKS,
            TEST_GRACE_BLOCKS,
            TEST_BLOCK_TIME_MS
        );
        verdict = new VerdictLog(address(validation), address(this));
        sealedBounty = new SealedBounty(
            address(usdc), address(products), address(registry), address(bond), address(verdict), treasury, 1000, 500
        );
        sessionPay = new SessionPay(
            address(usdc),
            address(products),
            address(registry),
            address(bond),
            address(verdict),
            treasury,
            address(sealedBounty)
        );
        x402 = new X402Settler(address(usdc), address(products), address(registry), address(bond), treasury);

        // wire permissions once (this test contract is deployer AND owner of bond and verdict)
        address[] memory settlements = new address[](3);
        settlements[0] = address(sessionPay);
        settlements[1] = address(sealedBounty);
        settlements[2] = address(x402);
        bond.initialize(address(registry), settlements);
        address[] memory callers = new address[](2);
        callers[0] = address(sessionPay);
        callers[1] = address(sealedBounty);
        verdict.initialize(callers);

        // historique EIP-2935
        MockHistory mh = new MockHistory();
        vm.etch(HISTORY_ADDR, address(mh).code);

        // liquidity
        usdc.mint(operator, 1_000_000e6);
        usdc.mint(operator2, 1_000_000e6);
        usdc.mint(user, 1_000_000e6);
        usdc.mint(hunter, 1_000_000e6);
        usdc.mint(protocol, 1_000_000e6);
    }

    // ---------- measurement / workload helpers ----------

    function _b48(bytes32 seed) internal pure returns (bytes memory) {
        return abi.encodePacked(seed, bytes16(seed));
    }

    function _measurements(uint256 productId, address op, address signer, bytes32 x25519, uint256 r, bool debug)
        internal
        view
        returns (IAttestationModule.Measurements memory m)
    {
        m.ok = true;
        m.version = 4;
        m.bodyType = 2;
        m.tcbStatus = 0;
        m.fmspc = bytes6(uint48(0x112233445566));
        m.mrtd = _b48("mrtd");
        m.rtmr0 = _b48("rtmr0");
        m.rtmr1 = _b48("rtmr1");
        m.rtmr2 = _b48("rtmr2");
        m.rtmr3 = _b48("rtmr3");
        m.mrConfigId = _b48("mrconfig");
        m.xfam = bytes8(uint64(0x00000000000e0003));
        m.tdAttributes = debug ? bytes8(uint64(1) << 56) : bytes8(0);
        bytes32 rd0 = keccak256(abi.encode("ARC-ENCLAVE-v1", block.chainid, address(registry), productId, op, signer, x25519));
        bytes32 rd1 = keccak256(abi.encodePacked(bytes32(r)));
        m.reportData = abi.encodePacked(rd0, rd1);
    }

    function _workloadId() internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                _b48("mrtd"),
                _b48("rtmr0"),
                _b48("rtmr1"),
                _b48("rtmr2"),
                _b48("rtmr3"),
                _b48("mrconfig"),
                bytes8(uint64(0x00000000000e0003)),
                bytes8(0)
            )
        );
    }

    // ---------- product / bond / enclave helpers ----------

    function _proposeAndActivate(
        address settlement,
        bool deterministic,
        bytes32 param,
        uint256 price,
        uint256 minBond,
        uint256 exposureCap
    ) internal returns (uint256 productId) {
        bytes32[] memory wl = new bytes32[](1);
        wl[0] = _workloadId();
        string[] memory adv = new string[](0);
        ProductRegistry.ProposeParams memory q = ProductRegistry.ProposeParams({
            manifestHash: keccak256("manifest"),
            manifestURI: "ipfs://manifest",
            workloadIds: wl,
            deterministic: deterministic,
            price: price,
            bpsOperator: 8000,
            bpsAuthor: 1000,
            bpsNetwork: 1000,
            minBond: minBond,
            exposureCap: exposureCap,
            settlement: settlement,
            param: param,
            advisoryIds: adv,
            unitTokens: 0,
            outWeight: 0
        });
        productId = products.propose(q);
        vm.warp(vm.getBlockTimestamp() + TIMELOCK + 1); // cheatcode: never folded by the optimizer (via_ir)
        products.activate(productId);
    }

    /// @dev Replaces `bond` with a fresh bond whose registry and only settlement contract is THIS test contract
    ///      (OperatorBond unit tests, without going through SessionPay / SealedBounty).
    function _bondWithSelfAsSettlement() internal returns (OperatorBond b) {
        b = new OperatorBond(address(usdc), treasury, address(this), address(identity));
        address[] memory settlements = new address[](1);
        settlements[0] = address(this);
        b.initialize(address(this), settlements);
        bond = b;
    }

    /// @dev The test ERC-8004 registry then costs what Circle's registry costs on Arc (verdict ≈ 233k vs
    ///      ≈ 238k measured on Arc): otherwise the 1/64 of gas left after a starved verdict would not even pay for the
    ///      rest, and the minimum-gas flaw would not show up in tests.
    function _emulateArcVerdictCost() internal {
        validation.setBurnSlots(8);
    }

    /// @dev The MINIMUM gas at which `target.call(data)`, sent by `sender`, succeeds (what eth_estimateGas looks for),
    ///      found by bisection in ]lo, hi] (lo fails, hi succeeds); state is restored after each attempt.
    function _minGasToSucceed(address sender, address target, bytes memory data, uint256 lo, uint256 hi)
        internal
        returns (uint256)
    {
        while (lo + 1 < hi) {
            uint256 mid = (lo + hi) / 2;
            uint256 snap = vm.snapshotState();
            vm.prank(sender);
            (bool ok,) = target.call{gas: mid}(data);
            vm.revertToState(snap);
            if (ok) hi = mid;
            else lo = mid;
        }
        return hi;
    }

    function _bondOperator(uint256 operatorPk, uint256 amount) internal {
        address op = vm.addr(operatorPk);
        vm.startPrank(op);
        usdc.approve(address(bond), amount);
        bond.bondFrom(amount);
        vm.stopPrank();
    }

    function _registerEnclave(uint256 productId, uint256 operatorPk, uint256 enclaveSignerPk, bytes32 salt)
        internal
        returns (address signer, bytes memory quote)
    {
        address op = vm.addr(operatorPk);
        signer = vm.addr(enclaveSignerPk);
        bytes32 x25519 = keccak256(abi.encodePacked("x25519", salt));
        uint256 r = vm.getBlockNumber() - 1; // cheatcode: never folded by the optimizer after a vm.roll
        quote = abi.encodePacked("quote", salt);
        IAttestationModule.Measurements memory m = _measurements(productId, op, signer, x25519, r, false);
        module.setMeasurements(quote, m);
        vm.prank(op);
        registry.registerEnclave(productId, quote, r, signer, x25519, "");
    }

    // ---------- signature helpers ----------

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _domainSeparator(address verifyingContract) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("ArcEnclaveNetwork")),
                keccak256(bytes("1")),
                block.chainid,
                verifyingContract
            )
        );
    }

    function _typed(address verifyingContract, bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(verifyingContract), structHash));
    }

    function _usdcAuth(uint256 fromPk, address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (UsdcPayer.Auth memory a)
    {
        address from = vm.addr(fromPk);
        uint256 validAfter = 0;
        uint256 validBefore = vm.getBlockTimestamp() + 1 hours; // cheatcode: never folded after a vm.warp
        bytes32 digest = usdc.hashReceive(from, to, value, validAfter, validBefore, nonce);
        a = UsdcPayer.Auth({
            validAfter: validAfter,
            validBefore: validBefore,
            nonce: nonce,
            signature: _sign(fromPk, digest)
        });
    }
}
