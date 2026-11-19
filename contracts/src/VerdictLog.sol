// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerdictLog} from "./interfaces/IVerdictLog.sol";
import {IValidationRegistry} from "./interfaces/IERC8004.sol";

/// @title VerdictLog — v2
/// @notice Writes each verified verdict to Circle's ERC-8004 validation registry.
///         The same contract requests and responds: it is the validator, and it writes 100 (verified and paid) only
///         after the calling settlement contract has checked the attestation and the signature (the "TEE oracle"
///         case foreseen by the ERC). 0 = slashed fault.
///
///         v2 (after an adversarial review): `owner` is a parameter (a multisig on mainnet, never the deployment
///         key); the DEPLOYER wires the callers ONCE during the deployment (initialize), then has no power left; any
///         new caller, proposed by the owner, waits CALLER_DELAY (8 days): a single key can no longer write a false
///         "100" or "0" to ERC-8004. Removal stays immediate.
///
///         Prerequisite outside this contract (script/CLI): the operator registers its identity in the identity
///         registry (it owns it), then calls `setApprovalForAll(VerdictLog, true)` so that VerdictLog can make the
///         validation request on its behalf. The approval is enough (verified against the reference code of
///         ValidationRegistryUpgradeable 2.0.0, which accepts the owner, isApprovedForAll or getApproved, and on a
///         fork of Arc testnet, where VerdictLog v2 wrote for the operator's agent 897812).
///
///         v2.1b (after a second adversarial review): Circle's registry has only ONE requestHash space for everyone
///         ("exists" whatever the agent), and our requestHashes can be computed in advance (a session is known from
///         its opening, a bounty from its acceptance...). A third party, with a freely created agent, could therefore
///         take the one of a future verdict, and the verdict was skipped forever. Now, if the request under
///         `requestHash` fails, VerdictLog makes it again under a hash SALTED with the previous block's hash
///         (saltedHash), unknown before this block, so it cannot be taken in advance. RequestHashSalted(requestHash,
///         salted) says so; Recorded carries the hash ACTUALLY written (indexers read Recorded, they do not recompute
///         the hash). A verdict is written only ONCE per requestHash (recordedAs; otherwise AlreadyRecorded, like the
///         registry's "exists"), salted or not.
///         Limits (out of this contract's reach): an attacker that goes BEFORE us in the SAME block can still compute
///         and take the salted hash; and ERC-8004 lets an agent's owner refuse any request for its agent (approval
///         withdrawn, agent transferred, setAgentId(0)), so a FAULT verdict (0) is never guaranteed in ERC-8004. The
///         fault itself is established by our contracts (OperatorBond.banned, EquivocationSlashed, ClaimRefuted) and
///         the skipped verdict stays on record (VerdictSkipped).
contract VerdictLog is IVerdictLog {
    uint64 public constant CALLER_DELAY = 8 days;

    IValidationRegistry public immutable validation;
    address public immutable owner;
    address public immutable deployer;
    bool public initialized;

    mapping(address => bool) public isCaller; // SessionPay, SealedBounty (and slashing paths)
    mapping(address => uint64) public callerApplyAt;
    /// @notice v2.1b: for each requestHash received from a caller, the requestHash ACTUALLY written to ERC-8004 (the
    ///         same one, or the salted hash if it was taken); zero while nothing is written. A verdict is written once.
    mapping(bytes32 requestHash => bytes32 written) public recordedAs;

    /// @notice `requestHash` = the hash ACTUALLY written to the validation registry (v2.1b: salted if it had to be).
    event Recorded(uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string tag);
    event CallerProposed(address indexed caller, uint64 applyAt);
    event CallerAuthorized(address indexed caller);
    event CallerRemoved(address indexed caller);
    /// @notice v2.1b: `requestHash` was taken (or refused) in the registry; the verdict is written under `saltedHash`.
    event RequestHashSalted(bytes32 indexed requestHash, bytes32 indexed saltedHash);

    error NotOwner();
    error NotDeployer();
    error NotCaller();
    error BadParams();
    error AlreadyInitialized();
    error NoPendingCaller();
    error TooEarly();
    /// @notice v2.1b: a verdict is already written for this requestHash (see recordedAs).
    error AlreadyRecorded();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _validation, address _owner) {
        if (_validation == address(0) || _owner == address(0)) revert BadParams();
        validation = IValidationRegistry(_validation);
        owner = _owner;
        deployer = msg.sender;
    }

    /// @notice Initial wiring, ONCE, by the deployer during the deployment: the settlement contracts.
    function initialize(address[] calldata callers) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        for (uint256 i = 0; i < callers.length; i++) {
            if (callers[i] == address(0)) revert BadParams();
            isCaller[callers[i]] = true;
            emit CallerAuthorized(callers[i]);
        }
    }

    /// @notice Proposes a new caller; authorized only after CALLER_DELAY.
    function proposeCaller(address caller) external onlyOwner {
        if (caller == address(0)) revert BadParams();
        uint64 applyAt = uint64(block.timestamp) + CALLER_DELAY;
        callerApplyAt[caller] = applyAt;
        emit CallerProposed(caller, applyAt);
    }

    /// @notice Authorizes a proposed caller once the delay has passed (anyone can call it).
    function applyCaller(address caller) external {
        uint64 applyAt = callerApplyAt[caller];
        if (applyAt == 0) revert NoPendingCaller();
        if (block.timestamp < applyAt) revert TooEarly();
        delete callerApplyAt[caller];
        isCaller[caller] = true;
        emit CallerAuthorized(caller);
    }

    /// @notice IMMEDIATE removal of a caller (emergency brake).
    function removeCaller(address caller) external onlyOwner {
        isCaller[caller] = false;
        delete callerApplyAt[caller];
        emit CallerRemoved(caller);
    }

    /// @inheritdoc IVerdictLog
    function record(
        uint256 agentId,
        bytes32 requestHash,
        string calldata requestURI,
        bytes32 responseHash,
        string calldata responseURI,
        uint8 response,
        string calldata tag
    ) external override {
        if (!isCaller[msg.sender]) revert NotCaller();
        if (requestHash == bytes32(0)) revert BadParams();
        if (recordedAs[requestHash] != bytes32(0)) revert AlreadyRecorded();
        // VerdictLog is the named validator: it requests, then responds, in the same transaction.
        bytes32 h = requestHash;
        try validation.validationRequest(address(this), agentId, requestURI, h) {}
        catch {
            // v2.1b: hash taken (in advance, in the registry's shared space) or request refused: a new request under
            // the salted hash, unknown before this block. If it fails too (an agent that no longer approves VerdictLog,
            // a registry failure), its revert goes up to the caller (VerdictSkipped). Nothing is copied here.
            h = saltedHash(requestHash);
            validation.validationRequest(address(this), agentId, requestURI, h);
            emit RequestHashSalted(requestHash, h);
        }
        validation.validationResponse(h, response, responseURI, responseHash, tag);
        recordedAs[requestHash] = h;
        emit Recorded(agentId, h, response, tag);
    }

    /// @notice v2.1b: the hash under which `record` writes, IN THIS BLOCK, a verdict whose `requestHash` is taken:
    ///         keccak256(abi.encode(requestHash, blockhash(block.number - 1))).
    function saltedHash(bytes32 requestHash) public view returns (bytes32) {
        return keccak256(abi.encode(requestHash, blockhash(block.number - 1)));
    }
}
