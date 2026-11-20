// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IOperatorBond — the bond that BOUNDS the outflow of a forged enclave
/// @notice What the bond does, and what it does not do (after an adversarial review):
///         - it bounds what an enclave can make others pay on its word alone: half of the available bond (the bond less any pending withdrawal) over a ROLLING
///           24 hours, all products together, and the `exposureCap` of each product;
///         - it is slashed in full for a fault PROVEN on chain: equivocation (SessionPay, SealedBounty) or a bounty
///           claim refuted by a counter-replay from other enclaves (SealedBounty.refute);
///         - it refunds nothing else: an inference receipt inflated by a forged enclave cannot be proven; the bond
///           only limits its outflow.
interface IOperatorBond {
    event Bonded(address indexed operator, uint256 amount);
    event UnbondRequested(address indexed operator, uint256 amount, uint64 withdrawableAt);
    event Withdrawn(address indexed operator, uint256 amount);
    event ExposureConsumed(address indexed operator, uint256 indexed productId, uint256 amount);
    event Slashed(address indexed operator, address indexed reporter, address victim, uint256 amount);
    /// @notice v2: a product's minimum bond reserved for a registered enclave key, then released.
    event BondReserved(address indexed operator, address indexed signer, uint256 amount);
    event BondReleased(address indexed operator, address indexed signer, uint256 amount);

    function bondOf(address operator) external view returns (uint256);

    /// @notice Available bond = bond - amount requested for withdrawal. Used by the "half the bond" rule.
    function availableBond(address operator) external view returns (uint256);

    /// @notice v2: FREE bond = available - reserved for the registered enclaves. It is all that a new enclave
    ///         registration or a withdrawal request can take.
    function freeBond(address operator) external view returns (uint256);

    /// @notice v2: bond reserved for the enclave key `signer` (0 if none).
    function reservedFor(address signer) external view returns (uint256);

    /// @notice Exposure already released for this product over the last 24 hours (rolling, to within 12 hours).
    function exposureOf(address operator, uint256 productId) external view returns (uint256);

    /// @notice v2: total exposure of the operator, all products together, over the last 24 hours.
    function totalExposureOf(address operator) external view returns (uint256);

    /// @dev Called only by the authorized settlement contracts (SessionPay, SealedBounty).
    ///      Reverts above half of the available bond (bond - pendingUnbond) over a rolling 24 hours, ALL PRODUCTS TOGETHER, AND above `cap`, the
    ///      product's exposure cap (`Product.exposureCap`) for this (operator, product) pair over the same window.
    ///      `cap` = 0: no cap on top of the bond rule.
    function consumeExposure(address operator, uint256 productId, uint256 amount, uint256 cap) external;

    /// @dev Called by a settlement contract that proved a fault. Slashes the whole bond, bans the operator, and splits
    ///      it 50% to the reporter / 50% to the victim (or to the network fund).
    function slash(address operator, address reporter, address victim) external;

    /// @dev v2: called by the EnclaveRegistry when a key is registered (reserves `amount` out of `operator`'s free
    ///      bond; no effect if the key already has its reservation).
    function reserve(address operator, address signer, uint256 amount) external;

    /// @dev v2: called by the EnclaveRegistry when a key is retired or invalidated.
    function release(address signer) external;

    function agentIdOf(address operator) external view returns (uint256);

    /// @notice True if the operator was slashed for a proven fault (banned).
    function banned(address operator) external view returns (bool);
}
