// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEnclaveRegistry} from "../interfaces/IEnclaveRegistry.sol";
import {IProductRegistry} from "../interfaces/IProductRegistry.sol";
import {PckChip} from "./PckChip.sol";

interface ITimelocked {
    function timelock() external view returns (uint64);
}

/// @title MachineRegistry — the TWO operator LEVELS of ArcHive
/// @notice - "Open" level (0): anyone runs an enclave; the Arc contract verifies its Intel attestation and the
///           operator deposits a bond (EnclaveRegistry + OperatorBond, unchanged).
///         - "Verified" level (1): on top of that, the MACHINE (its chip, identified by Intel's PCK certificate: the
///           PPID) is declared to be in a known datacenter by a VERIFIER that the product accepts. The reason: the
///           physical attacks of 2025 (TEE.fail, Battering RAM, Wiretap) extract attestation keys with physical
///           access to the server.
///         The protocol imposes no verifier and takes no toll: anyone can declare machines (their address is their
///         verifier identity); the AUTHOR of each product chooses the minimum level and the verifiers it accepts,
///         behind the ProductRegistry timelock. A verified operator sets its own price.
///         Three building blocks:
///          1. bindMachine: binds an enclave key to the chip that hosts it, from the quote that the EnclaveRegistry
///             VERIFIED at registration (keccak256(quote) = Enclave.quoteHash); the PPID is read by PckChip, and the
///             FMSPC is cross-checked with the one Automata extracted. A renewal changes the quote: the key must be
///             bound again (otherwise, open level);
///          2. attestMachine / revokeMachine: the verifiers' declarations (for example ProofOfCloudAuditor, which
///             verifies the Proof of Cloud alliance's signature on chain);
///          3. proposePolicy / applyPolicy: each product's policy; meetsPolicy reads it (PolicyEnclaves uses it for
///             the settlement contracts).
contract MachineRegistry {
    uint8 public constant LEVEL_OPEN = 0;
    uint8 public constant LEVEL_VERIFIED = 1;
    /// @notice Maximum number of verifiers a product accepts.
    uint256 public constant MAX_AUDITORS = 8;

    IEnclaveRegistry public immutable registry;
    IProductRegistry public immutable products;

    struct Binding {
        bytes16 ppid; // the machine's chip (Intel's PCK certificate)
        bytes32 quoteHash; // quote of the bound registration (the current window's, as long as it is not renewed)
        uint64 boundAt;
    }

    struct Audit {
        uint64 expiresAt; // timestamp; beyond it, the declaration is no longer valid
        bool revoked;
    }

    struct Policy {
        uint8 minLevel;
        address[] auditors;
    }

    struct Pending {
        uint8 minLevel;
        address[] auditors;
        uint64 applyAt;
        bool exists;
    }

    mapping(address signer => Binding) private _binding;
    /// @notice A verifier's declaration about a chip.
    mapping(address auditor => mapping(bytes16 ppid => Audit)) public auditOf;
    mapping(uint256 productId => Policy) private _policy;
    mapping(uint256 productId => Pending) private _pending;

    event MachineBound(address indexed signer, bytes16 indexed ppid, bytes32 quoteHash);
    event MachineAttested(address indexed auditor, bytes16 indexed ppid, uint64 expiresAt, string site, string evidence);
    event MachineRevoked(address indexed auditor, bytes16 indexed ppid, string reason);
    event PolicyProposed(uint256 indexed productId, uint8 minLevel, address[] auditors, uint64 applyAt);
    event PolicyApplied(uint256 indexed productId, uint8 minLevel, address[] auditors);

    error NotActiveEnclave();
    error NotRegisteredQuote();
    error FmspcMismatch();
    error BadAudit();
    error NotAuthor();
    error BadPolicy();
    error NoPendingPolicy();
    error TooEarly();

    constructor(address _registry, address _products) {
        registry = IEnclaveRegistry(_registry);
        products = IProductRegistry(_products);
    }

    // ---------------------------------------------------------------- 1. binding an enclave to a machine

    /// @notice Binds the enclave key `signer` to the chip that hosts it. Open to anyone (nothing to gain by doing it
    ///         for someone else): `quote` must be exactly the quote that the EnclaveRegistry verified for the current
    ///         registration.
    function bindMachine(address signer, bytes calldata quote) external returns (bytes16 ppid) {
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(signer);
        if (e.signer == address(0) || !e.active) revert NotActiveEnclave();
        bytes32 qh = keccak256(quote);
        if (qh != e.quoteHash) revert NotRegisteredQuote();
        bytes6 fmspc;
        (ppid, fmspc) = PckChip.chipOf(quote);
        // the same platform as the one Automata read in this same certificate
        if (fmspc != e.fmspc) revert FmspcMismatch();
        _binding[signer] = Binding({ppid: ppid, quoteHash: qh, boundAt: uint64(block.timestamp)});
        emit MachineBound(signer, ppid, qh);
    }

    /// @notice The chip bound to `signer`; `current` is false if the enclave is no longer active or was registered
    ///         again since (another quote, perhaps another machine): it must then be bound again.
    function machineOf(address signer) public view returns (bytes16 ppid, bool current, uint64 boundAt) {
        Binding memory b = _binding[signer];
        if (b.ppid == bytes16(0)) return (bytes16(0), false, 0);
        IEnclaveRegistry.Enclave memory e = registry.enclaveOf(signer);
        return (b.ppid, e.active && e.quoteHash == b.quoteHash, b.boundAt);
    }

    // ---------------------------------------------------------------- 2. the verifiers' declarations

    /// @notice The caller (the verifier) declares the chip `ppid` to be in a known datacenter until `expiresAt`. `site`
    ///         and `evidence` (place, proof: a URL, the hash of a report...) live only in the event.
    function attestMachine(bytes16 ppid, uint64 expiresAt, string calldata site, string calldata evidence) external {
        if (ppid == bytes16(0) || expiresAt <= block.timestamp) revert BadAudit();
        auditOf[msg.sender][ppid] = Audit({expiresAt: expiresAt, revoked: false});
        emit MachineAttested(msg.sender, ppid, expiresAt, site, evidence);
    }

    /// @notice The caller withdraws its declaration about `ppid`, at once.
    function revokeMachine(bytes16 ppid, string calldata reason) external {
        auditOf[msg.sender][ppid].revoked = true;
        emit MachineRevoked(msg.sender, ppid, reason);
    }

    /// @notice Is `signer` currently on a machine declared by `auditor` (up-to-date binding, declaration in force, not
    ///         withdrawn)?
    function isVerified(address signer, address auditor) public view returns (bool) {
        (bytes16 ppid, bool current,) = machineOf(signer);
        if (!current) return false;
        Audit memory a = auditOf[auditor][ppid];
        return !a.revoked && a.expiresAt > block.timestamp;
    }

    // ---------------------------------------------------------------- 3. the products' policies

    /// @notice The product's AUTHOR proposes its policy: minimum level and accepted verifiers (level 1: at least one).
    ///         Applied after the ProductRegistry timelock (operators and buyers see it coming).
    function proposePolicy(uint256 productId, uint8 minLevel, address[] calldata auditors) external {
        if (products.getProduct(productId).author != msg.sender) revert NotAuthor();
        if (minLevel > LEVEL_VERIFIED || auditors.length > MAX_AUDITORS) revert BadPolicy();
        if (minLevel == LEVEL_VERIFIED && auditors.length == 0) revert BadPolicy();
        for (uint256 i = 0; i < auditors.length; i++) {
            if (auditors[i] == address(0)) revert BadPolicy();
            for (uint256 k = 0; k < i; k++) {
                if (auditors[k] == auditors[i]) revert BadPolicy();
            }
        }
        uint64 applyAt = uint64(block.timestamp) + ITimelocked(address(products)).timelock();
        Pending storage p = _pending[productId];
        p.minLevel = minLevel;
        p.auditors = auditors;
        p.applyAt = applyAt;
        p.exists = true;
        emit PolicyProposed(productId, minLevel, auditors, applyAt);
    }

    /// @notice Applies the proposed policy once the timelock has passed (anyone).
    function applyPolicy(uint256 productId) external {
        Pending storage p = _pending[productId];
        if (!p.exists) revert NoPendingPolicy();
        if (block.timestamp < p.applyAt) revert TooEarly();
        Policy storage q = _policy[productId];
        q.minLevel = p.minLevel;
        delete q.auditors;
        for (uint256 i = 0; i < p.auditors.length; i++) {
            q.auditors.push(p.auditors[i]);
        }
        delete _pending[productId];
        emit PolicyApplied(productId, q.minLevel, q.auditors);
    }

    function policyOf(uint256 productId) external view returns (uint8 minLevel, address[] memory auditors) {
        Policy storage q = _policy[productId];
        return (q.minLevel, q.auditors);
    }

    function pendingPolicyOf(uint256 productId)
        external
        view
        returns (bool exists, uint8 minLevel, address[] memory auditors, uint64 applyAt)
    {
        Pending storage p = _pending[productId];
        return (p.exists, p.minLevel, p.auditors, p.applyAt);
    }

    /// @notice The first verifier accepted by the product that currently verifies `signer`, or zero.
    function verifiedBy(uint256 productId, address signer) public view returns (address) {
        address[] storage list = _policy[productId].auditors;
        if (list.length == 0) return address(0);
        (bytes16 ppid, bool current,) = machineOf(signer); // one registry read, whatever the number of verifiers
        if (!current) return address(0);
        for (uint256 i = 0; i < list.length; i++) {
            Audit memory a = auditOf[list[i]][ppid];
            if (!a.revoked && a.expiresAt > block.timestamp) return list[i];
        }
        return address(0);
    }

    /// @notice Level of `signer` with respect to the product: 1 if a verifier accepted by the product verifies it.
    function levelOf(uint256 productId, address signer) external view returns (uint8) {
        return verifiedBy(productId, signer) != address(0) ? LEVEL_VERIFIED : LEVEL_OPEN;
    }

    /// @notice Does `signer` meet the product's policy? (open level: always; verified level: an accepted verifier
    ///         currently verifies it). Whether the enclave itself is active remains the registry's job.
    function meetsPolicy(uint256 productId, address signer) public view returns (bool) {
        if (_policy[productId].minLevel == LEVEL_OPEN) return true;
        return verifiedBy(productId, signer) != address(0);
    }
}
