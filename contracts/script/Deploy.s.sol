// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";

import {TdxAttestationModule} from "../src/attestation/TdxAttestationModule.sol";
import {EnclaveRegistry} from "../src/EnclaveRegistry.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";
import {OperatorBond} from "../src/OperatorBond.sol";
import {VerdictLog} from "../src/VerdictLog.sol";
import {SessionPay} from "../src/SessionPay.sol";
import {SealedBounty} from "../src/SealedBounty.sol";
import {X402Settler} from "../src/X402Settler.sol";

/// @title Deploy: deploys and wires the whole ArcHive enclave network (target: Arc mainnet).
/// @notice Reads the external addresses (already on chain) from environment variables. The defaults are the
///         mainnet values (deploy/mainnet.env.example):
///   USDC                 Arc's USDC (0x3600…0000)                                          — required
///   DCAP                 Automata's DCAP verifier, deployed separately (deploy it first on
///                        a chain that does not have it yet)                                — required
///   ERC8004_VALIDATION   Circle's ERC-8004 validation registry (code required)             — required
///   ERC8004_IDENTITY     Circle's ERC-8004 identity registry (owner of the agentIds)       — required
///   TREASURY             the network treasury (a 2-of-3 multisig, never a single key;
///                        on Arc mainnet, code is required at the address)                  — required
///   OWNER                governance of OperatorBond and VerdictLog (a 2-of-3 multisig;
///                        on Arc mainnet, code is required and it is never the deployer key) — required
///   TIMELOCK             activation delay of a new product or a price change, in seconds
///                        (default 172,800 = 48 h; anything below 48 h is refused on Arc mainnet)
///   NETWORK_BOUNTY_BPS   network share of a bounty, on top of the tier (default 1000 = 10 %)
///   OPERATOR_BOUNTY_BPS  share of the verifying enclaves, on top of the tier (default 500 = 5 %)
///   REQUIRE_SEPT_VE      require SEPT_VE_DISABLE (0/1, default 1: the real quote of our Phala
///                        enclave has tdAttributes = 0x10000000, DEBUG = 0)
///   VALIDITY_BLOCKS      validity of an attestation, in blocks (default 170,000 ≈ 24 h)
///   GRACE_BLOCKS         settlement delay after a window ends, in blocks (default 170,000 ≈ 24 h)
///   BLOCK_TIME_MS        estimated block time, for the indicative expiresAt timestamp (default 508)
///
///   Block time measured on 2026-11-07 (cast block, timestamp differences): Arc mainnet 508.1 ms per block over
///   1,000,000 blocks, 506.7–509.6 ms over each 172,800-block window of the previous 89 days; so
///   24 h ≈ 170,000 blocks (23.9–24.1 h).
///
/// Wiring (hardened after an adversarial review): the deployer key wires OperatorBond and VerdictLog ONCE during
/// this script (initialize), before any bond is posted, and holds no power afterwards; every later addition goes
/// through OWNER with an 8-day delay. SessionPay bills the Sealed Bounty attempts (attemptsFor = SealedBounty).
///
/// Usage: forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.arc.io --broadcast
contract Deploy is Script {
    uint256 public constant ARC_MAINNET_CHAIN_ID = 5042;

    uint64 public constant DEFAULT_TIMELOCK = 172_800; // 48 h (a session's price is locked when the session opens)
    uint64 public constant MIN_MAINNET_TIMELOCK = 172_800;
    uint16 public constant DEFAULT_NETWORK_BOUNTY_BPS = 1000;
    uint16 public constant DEFAULT_OPERATOR_BOUNTY_BPS = 500;
    bool public constant DEFAULT_REQUIRE_SEPT_VE = true;
    uint64 public constant DEFAULT_VALIDITY_BLOCKS = 170_000; // ≈ 24 h at 508 ms per block
    uint64 public constant DEFAULT_GRACE_BLOCKS = 170_000; // ≈ 24 h
    uint64 public constant DEFAULT_BLOCK_TIME_MS = 508;

    struct Config {
        address usdc;
        address dcap;
        address validation;
        address identity;
        address treasury;
        address owner;
        uint64 timelock;
        uint16 networkBountyBps;
        uint16 operatorBountyBps;
        bool requireSeptVe;
        uint64 validityBlocks;
        uint64 graceBlocks;
        uint64 blockTimeMs;
    }

    struct Deployed {
        address module;
        address products;
        address bond;
        address registry;
        address verdict;
        address sessionPay;
        address sealedBounty;
        address x402;
    }

    function run() external returns (Deployed memory d) {
        Config memory c = configFromEnv();
        check(c);

        vm.startBroadcast();
        d = deploy(c);
        vm.stopBroadcast();

        _log(c, d);
    }

    /// @notice Reads the configuration from the environment; the defaults are the mainnet values.
    function configFromEnv() public view returns (Config memory c) {
        c.usdc = vm.envAddress("USDC");
        c.dcap = vm.envAddress("DCAP");
        c.validation = vm.envAddress("ERC8004_VALIDATION");
        c.identity = vm.envAddress("ERC8004_IDENTITY");
        c.treasury = vm.envAddress("TREASURY");
        c.owner = vm.envAddress("OWNER");
        c.timelock = uint64(vm.envOr("TIMELOCK", uint256(DEFAULT_TIMELOCK)));
        c.networkBountyBps = uint16(vm.envOr("NETWORK_BOUNTY_BPS", uint256(DEFAULT_NETWORK_BOUNTY_BPS)));
        c.operatorBountyBps = uint16(vm.envOr("OPERATOR_BOUNTY_BPS", uint256(DEFAULT_OPERATOR_BOUNTY_BPS)));
        c.requireSeptVe = vm.envOr("REQUIRE_SEPT_VE", DEFAULT_REQUIRE_SEPT_VE ? uint256(1) : uint256(0)) == 1;
        c.validityBlocks = uint64(vm.envOr("VALIDITY_BLOCKS", uint256(DEFAULT_VALIDITY_BLOCKS)));
        c.graceBlocks = uint64(vm.envOr("GRACE_BLOCKS", uint256(DEFAULT_GRACE_BLOCKS)));
        c.blockTimeMs = uint64(vm.envOr("BLOCK_TIME_MS", uint256(DEFAULT_BLOCK_TIME_MS)));
    }

    /// @notice Guardrails checked before anything is sent: an unsafe configuration is refused.
    function check(Config memory c) public view {
        require(c.dcap.code.length > 0, "DCAP: no code at this address (deploy Automata DCAP first)");
        require(c.treasury != address(0), "TREASURY: zero address");
        require(c.owner != address(0), "OWNER: zero address");
        require(c.identity != address(0), "ERC8004_IDENTITY: zero address");
        require(c.validityBlocks > 0 && c.blockTimeMs > 0, "VALIDITY_BLOCKS and BLOCK_TIME_MS must be > 0");
        if (block.chainid == ARC_MAINNET_CHAIN_ID) {
            require(c.timelock >= MIN_MAINNET_TIMELOCK, "TIMELOCK below 48 h is refused on Arc mainnet");
            require(c.treasury.code.length > 0, "TREASURY must be a multisig (contract code) on Arc mainnet");
            require(c.owner.code.length > 0, "OWNER must be a multisig (contract code) on Arc mainnet");
            require(c.owner != msg.sender, "OWNER must never be the deployer key on Arc mainnet");
            require(c.validation.code.length > 0, "ERC8004_VALIDATION: no code at this address");
            require(c.identity.code.length > 0, "ERC8004_IDENTITY: no code at this address");
        }
    }

    /// @notice Deploys and wires the stack (called by run between start/stopBroadcast, or directly from a test).
    function deploy(Config memory c) public returns (Deployed memory d) {
        TdxAttestationModule module = new TdxAttestationModule(c.dcap);
        ProductRegistry products = new ProductRegistry(c.timelock);
        OperatorBond bond = new OperatorBond(c.usdc, c.treasury, c.owner, c.identity);
        EnclaveRegistry registry = new EnclaveRegistry(
            address(module),
            address(products),
            address(bond),
            c.requireSeptVe,
            c.validityBlocks,
            c.graceBlocks,
            c.blockTimeMs
        );
        VerdictLog verdict = new VerdictLog(c.validation, c.owner);

        SealedBounty sealedBounty = new SealedBounty(
            c.usdc,
            address(products),
            address(registry),
            address(bond),
            address(verdict),
            c.treasury,
            c.networkBountyBps,
            c.operatorBountyBps
        );
        // SessionPay also bills the Sealed Bounty attempts (sessions on its products, price > 0)
        SessionPay sessionPay = new SessionPay(
            c.usdc, address(products), address(registry), address(bond), address(verdict), c.treasury, address(sealedBounty)
        );
        X402Settler x402 = new X402Settler(c.usdc, address(products), address(registry), address(bond), c.treasury);

        // permissions wired ONCE by the deployer key (no bond has been posted at this point)
        address[] memory settlements = new address[](3);
        settlements[0] = address(sessionPay);
        settlements[1] = address(sealedBounty);
        settlements[2] = address(x402);
        bond.initialize(address(registry), settlements);
        address[] memory callers = new address[](2);
        callers[0] = address(sessionPay);
        callers[1] = address(sealedBounty);
        verdict.initialize(callers);

        d = Deployed({
            module: address(module),
            products: address(products),
            bond: address(bond),
            registry: address(registry),
            verdict: address(verdict),
            sessionPay: address(sessionPay),
            sealedBounty: address(sealedBounty),
            x402: address(x402)
        });
    }

    function _log(Config memory c, Deployed memory d) internal pure {
        console2.log("TIMELOCK (s)        ", uint256(c.timelock));
        console2.log("VALIDITY_BLOCKS     ", uint256(c.validityBlocks));
        console2.log("GRACE_BLOCKS        ", uint256(c.graceBlocks));
        console2.log("BLOCK_TIME_MS       ", uint256(c.blockTimeMs));
        console2.log("REQUIRE_SEPT_VE     ", c.requireSeptVe);
        console2.log("OWNER (multisig)    ", c.owner);
        console2.log("TdxAttestationModule", d.module);
        console2.log("ProductRegistry     ", d.products);
        console2.log("OperatorBond        ", d.bond);
        console2.log("EnclaveRegistry     ", d.registry);
        console2.log("VerdictLog          ", d.verdict);
        console2.log("SessionPay          ", d.sessionPay);
        console2.log("SealedBounty        ", d.sealedBounty);
        console2.log("X402Settler         ", d.x402);
    }
}
