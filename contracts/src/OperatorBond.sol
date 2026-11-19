// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IOperatorBond} from "./interfaces/IOperatorBond.sol";
import {IIdentityRegistry} from "./interfaces/IERC8004.sol";
import {UsdcPayer} from "./lib/UsdcPayer.sol";

/// @title OperatorBond — v2
/// @notice An operator's USDC bond. What it guarantees, exactly:
///         - it BOUNDS THE OUTFLOW: on the word of an operator's enclaves, the authorized settlement contracts
///           (SessionPay, SealedBounty) never release more than half of its free bond over ANY 24-hour period, all
///           products together, nor more than the `exposureCap` of each product (three 12-hour buckets: an exposure
///           counts for between 24 and 36 hours);
///         - it is SLASHED in full for a fault PROVEN on chain: equivocation (SessionPay, SealedBounty) or a bounty
///           claim refuted by a counter-replay from the enclaves of other operators (SealedBounty.refute);
///         - it stays locked for UNBOND_DELAY after the last exposure (the time to prove a fault).
///         What it does NOT do: an inference receipt inflated by a forged enclave cannot be proven; the bond limits
///         the outflow, it does not refund it.
///
///         v2 (after an adversarial review):
///         - no more all-powerful key. The DEPLOYER wires the enclave registry and the settlement contracts once,
///           during the deployment (initialize), before any bond exists and so with nothing to take, then has no
///           power left. The owner (a 2-of-3 multisig, passed to the constructor) can add a settlement contract only
///           after SETTLEMENT_DELAY = UNBOND_DELAY + 1 day (every operator has time to leave); it can REMOVE one at
///           once (emergency brake);
///         - exposure over a ROLLING 24 hours and a GLOBAL "half the bond" rule per operator (v1: a fixed window per
///           product, so the whole bond could go in one second, and N products = N × half the bond);
///         - a product's minimum bond is RESERVED per registered enclave key (a 100 USDC bond no longer covers ten
///           enclaves); only the free bond can be withdrawn;
///         - `setAgentId` requires being the owner (or an approved address) of the ERC-8004 agent.
contract OperatorBond is IOperatorBond, UsdcPayer {
    uint64 public constant UNBOND_DELAY = 7 days;
    /// @notice Window of the "half the bond" rule and of the product cap: a rolling 24 hours.
    uint64 public constant WINDOW = 24 hours;
    /// @notice Size of a bucket. Three buckets: any exposure counts for between 24 and 36 hours; over ANY 24-hour
    ///         period, never more than half the bond (nor more than the product cap).
    uint64 public constant BUCKET = 12 hours;
    /// @notice Delay before a NEW settlement contract is authorized (after the initial wiring).
    uint64 public constant SETTLEMENT_DELAY = UNBOND_DELAY + 1 days;

    address public immutable owner; // multisig: adds a settlement contract after a delay, removes one at once
    address public immutable deployer; // wires once during the deployment, then nothing
    address public immutable treasury; // network funds (the share of a slash with no victim)
    IIdentityRegistry public immutable identity; // ERC-8004 identity registry (ownership of agentIds)

    /// @notice EnclaveRegistry allowed to reserve / release the bond of enclave keys (set at initialization).
    address public registry;
    bool public initialized;

    /// @dev Three 12-hour buckets in ONE slot: `epoch` = index of the current bucket (timestamp / BUCKET).
    struct Ring {
        uint64 epoch;
        uint64 a0; // current bucket
        uint64 a1; // previous bucket
        uint64 a2; // the one before
    }

    mapping(address => uint256) private _bond;
    mapping(address => uint256) private _pendingUnbond;
    mapping(address => uint64) public unbondableAt;
    /// @notice Last exposure taken on the word of the operator's enclaves (no withdrawal before + UNBOND_DELAY).
    mapping(address => uint64) public lastExposureAt;
    mapping(address => Ring) private _opExposure; // global, per operator ("half the bond" rule)
    mapping(address => mapping(uint256 => Ring)) private _exposure; // per (operator, product) (product cap)
    mapping(address => uint256) private _agentId;
    /// @notice The operator that bound itself to this ERC-8004 agent (0 if none).
    mapping(uint256 => address) public operatorOfAgent;
    mapping(address => bool) public banned;
    mapping(address => bool) public isSettlement;
    /// @notice Proposed settlement contract -> time from which applySettlement authorizes it.
    mapping(address => uint64) public settlementApplyAt;

    mapping(address => uint256) public override reservedFor; // enclave key -> reserved bond
    mapping(address => address) public reservedBy; // enclave key -> operator
    mapping(address => uint256) public reservedTotal; // operator -> total reserved

    event SettlementProposed(address indexed settlement, uint64 applyAt);
    event SettlementAuthorized(address indexed settlement);
    event SettlementRemoved(address indexed settlement);
    event AgentIdSet(address indexed operator, uint256 agentId);

    error NotOwner();
    error NotDeployer();
    error NotSettlement();
    error NotRegistry();
    error Banned();
    error TooMuchExposure();
    /// @notice v2: the product's exposure cap (per operator, rolling 24 hours) would be exceeded.
    error ExposureCapExceeded();
    error UnbondLocked();
    error NothingToWithdraw();
    error InsufficientBond();
    error BadParams();
    error AlreadyInitialized();
    error NoPendingSettlement();
    error TooEarly();
    /// @notice v2: the caller is neither the owner nor approved for this agent in the ERC-8004 identity registry.
    error NotAgentOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySettlement() {
        if (!isSettlement[msg.sender]) revert NotSettlement();
        _;
    }

    modifier onlyRegistry() {
        if (msg.sender != registry || registry == address(0)) revert NotRegistry();
        _;
    }

    /// @param _owner    governance (a 2-of-3 multisig on Arc mainnet; never the deployment key)
    /// @param _identity ERC-8004 identity registry (ownership of agentIds)
    constructor(address _usdc, address _treasury, address _owner, address _identity) UsdcPayer(_usdc) {
        if (_treasury == address(0) || _owner == address(0) || _identity == address(0)) revert BadParams();
        owner = _owner;
        deployer = msg.sender;
        treasury = _treasury;
        identity = IIdentityRegistry(_identity);
    }

    // ---- wiring (once, at deployment), then delayed authorizations ----

    /// @notice Initial wiring, ONCE, by the deployer and during the deployment (no bond is deposited yet, so there is
    ///         nothing to take): the enclave registry and the settlement contracts.
    function initialize(address _registry, address[] calldata settlements) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (initialized) revert AlreadyInitialized();
        if (_registry == address(0)) revert BadParams();
        initialized = true;
        registry = _registry;
        for (uint256 i = 0; i < settlements.length; i++) {
            if (settlements[i] == address(0)) revert BadParams();
            isSettlement[settlements[i]] = true;
            emit SettlementAuthorized(settlements[i]);
        }
    }

    /// @notice Proposes a new settlement contract; it can slash or consume a bond only after SETTLEMENT_DELAY
    ///         (8 days), longer than UNBOND_DELAY: every operator can leave before.
    function proposeSettlement(address settlement) external onlyOwner {
        if (settlement == address(0)) revert BadParams();
        uint64 applyAt = uint64(block.timestamp) + SETTLEMENT_DELAY;
        settlementApplyAt[settlement] = applyAt;
        emit SettlementProposed(settlement, applyAt);
    }

    /// @notice Authorizes a proposed settlement contract once the delay has passed (anyone can call it).
    function applySettlement(address settlement) external {
        uint64 applyAt = settlementApplyAt[settlement];
        if (applyAt == 0) revert NoPendingSettlement();
        if (block.timestamp < applyAt) revert TooEarly();
        delete settlementApplyAt[settlement];
        isSettlement[settlement] = true;
        emit SettlementAuthorized(settlement);
    }

    /// @notice IMMEDIATE removal of a settlement contract (emergency brake: it only removes a power).
    function removeSettlement(address settlement) external onlyOwner {
        isSettlement[settlement] = false;
        delete settlementApplyAt[settlement];
        emit SettlementRemoved(settlement);
    }

    // ---- bond ----

    function bond(uint256 amount, Auth calldata auth) external {
        if (banned[msg.sender]) revert Banned();
        _pullWithAuth(msg.sender, amount, auth);
        _bond[msg.sender] += amount;
        emit Bonded(msg.sender, amount);
    }

    function bondFrom(uint256 amount) external {
        if (banned[msg.sender]) revert Banned();
        _pullWithAllowance(msg.sender, amount);
        _bond[msg.sender] += amount;
        emit Bonded(msg.sender, amount);
    }

    /// @notice Withdrawal request: only the FREE bond (neither requested already, nor reserved for an enclave).
    function requestUnbond(uint256 amount) external {
        if (amount > freeBond(msg.sender)) revert InsufficientBond();
        _pendingUnbond[msg.sender] += amount;
        unbondableAt[msg.sender] = uint64(block.timestamp) + UNBOND_DELAY;
        emit UnbondRequested(msg.sender, amount, unbondableAt[msg.sender]);
    }

    /// @notice Withdrawal UNBOND_DELAY after the request AND UNBOND_DELAY after the last exposure: a fault proven
    ///         within this delay (equivocation, refuted claim) always finds the bond.
    function withdraw() external {
        uint256 amount = _pendingUnbond[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        if (block.timestamp < withdrawableAt(msg.sender)) revert UnbondLocked();
        _pendingUnbond[msg.sender] = 0;
        _bond[msg.sender] -= amount;
        _payOut(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Binds the operator to ITS ERC-8004 agent: it must own it, or be approved by the owner, in the identity
    ///         registry. 0 = no agent.
    function setAgentId(uint256 agentId) external {
        if (agentId != 0) {
            address agentOwner = identity.ownerOf(agentId);
            if (agentOwner != msg.sender && !identity.isApprovedForAll(agentOwner, msg.sender)) revert NotAgentOwner();
            address previous = operatorOfAgent[agentId];
            if (previous != address(0) && previous != msg.sender) _agentId[previous] = 0; // the agent changes hands
            operatorOfAgent[agentId] = msg.sender;
        }
        uint256 old = _agentId[msg.sender];
        if (old != 0 && old != agentId && operatorOfAgent[old] == msg.sender) operatorOfAgent[old] = address(0);
        _agentId[msg.sender] = agentId;
        emit AgentIdSet(msg.sender, agentId);
    }

    // ---- reservation of the minimum bond per enclave key (called by the EnclaveRegistry) ----

    /// @inheritdoc IOperatorBond
    function reserve(address operator, address signer, uint256 amount) external override onlyRegistry {
        if (banned[operator]) revert Banned();
        if (reservedFor[signer] != 0 || amount == 0) return; // already reserved (renewal) or nothing to reserve
        if (freeBond(operator) < amount) revert InsufficientBond();
        reservedFor[signer] = amount;
        reservedBy[signer] = operator;
        reservedTotal[operator] += amount;
        emit BondReserved(operator, signer, amount);
    }

    /// @inheritdoc IOperatorBond
    function release(address signer) external override onlyRegistry {
        uint256 amount = reservedFor[signer];
        if (amount == 0) return;
        address operator = reservedBy[signer];
        uint256 total = reservedTotal[operator];
        reservedTotal[operator] = total > amount ? total - amount : 0;
        delete reservedFor[signer];
        delete reservedBy[signer];
        emit BondReleased(operator, signer, amount);
    }

    // ---- exposure (called by the settlement contracts) ----

    /// @inheritdoc IOperatorBond
    function consumeExposure(address operator, uint256 productId, uint256 amount, uint256 cap)
        external
        override
        onlySettlement
    {
        if (banned[operator]) revert Banned();
        if (amount > type(uint64).max) revert TooMuchExposure();
        uint64 e = uint64(block.timestamp / BUCKET);

        // never more than half of the free bond over a rolling 24 hours, all products together
        Ring memory g = _roll(_opExposure[operator], e);
        if (_sum(g) + amount > availableBond(operator) / 2) revert TooMuchExposure();

        // nor more than the product cap for this (operator, product) pair, over the same rolling window
        Ring memory p = _roll(_exposure[operator][productId], e);
        if (cap != 0 && _sum(p) + amount > cap) revert ExposureCapExceeded();

        g.a0 += uint64(amount);
        p.a0 += uint64(amount);
        _opExposure[operator] = g;
        _exposure[operator][productId] = p;
        lastExposureAt[operator] = uint64(block.timestamp);
        emit ExposureConsumed(operator, productId, amount);
    }

    // ---- slash (called by a settlement contract that proved a fault) ----

    /// @notice Slashes ALL of `operator`'s bond, bans it, and splits it:
    ///         50% to the reporter, 50% to the victim if identifiable, otherwise to the network fund.
    function slash(address operator, address reporter, address victim) external onlySettlement {
        uint256 seized = _bond[operator];
        _bond[operator] = 0;
        _pendingUnbond[operator] = 0;
        banned[operator] = true;

        uint256 toReporter = seized / 2;
        uint256 rest = seized - toReporter;
        _payOut(reporter, toReporter);
        _payOut(victim != address(0) ? victim : treasury, rest);

        emit Slashed(operator, reporter, victim, seized);
    }

    // ---- reads ----

    function bondOf(address operator) external view override returns (uint256) {
        return _bond[operator];
    }

    function availableBond(address operator) public view override returns (uint256) {
        return _bond[operator] - _pendingUnbond[operator];
    }

    function freeBond(address operator) public view override returns (uint256) {
        uint256 avail = availableBond(operator);
        uint256 reserved = reservedTotal[operator];
        return avail > reserved ? avail - reserved : 0;
    }

    function exposureOf(address operator, uint256 productId) external view override returns (uint256) {
        return _sum(_roll(_exposure[operator][productId], uint64(block.timestamp / BUCKET)));
    }

    function totalExposureOf(address operator) external view override returns (uint256) {
        return _sum(_roll(_opExposure[operator], uint64(block.timestamp / BUCKET)));
    }

    /// @notice Time from which the pending withdrawal request can be withdrawn.
    function withdrawableAt(address operator) public view returns (uint64) {
        uint64 a = unbondableAt[operator];
        uint64 last = lastExposureAt[operator];
        uint64 b = last == 0 ? 0 : last + UNBOND_DELAY;
        return a > b ? a : b;
    }

    function agentIdOf(address operator) external view override returns (uint256) {
        return _agentId[operator];
    }

    // ---- internal ----

    /// @dev Advances the buckets up to bucket `e` (an exposure older than 36 hours drops out).
    function _roll(Ring memory r, uint64 e) private pure returns (Ring memory) {
        if (e == r.epoch) return r;
        if (e == r.epoch + 1) return Ring({epoch: e, a0: 0, a1: r.a0, a2: r.a1});
        if (e == r.epoch + 2) return Ring({epoch: e, a0: 0, a1: 0, a2: r.a0});
        return Ring({epoch: e, a0: 0, a1: 0, a2: 0});
    }

    function _sum(Ring memory r) private pure returns (uint256) {
        return uint256(r.a0) + r.a1 + r.a2;
    }
}
