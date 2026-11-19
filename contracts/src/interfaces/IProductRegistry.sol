// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IProductRegistry — the product marketplace
interface IProductRegistry {
    enum State {
        None,
        Proposed,
        Active,
        Retired
    }

    /// @dev The first 14 fields keep the order, type and meaning of v1 (a v1 reader still decodes them);
    ///      v2 ADDS `unitTokens` and `outWeight` at the end.
    struct Product {
        address author;
        bytes32 manifestHash;
        bool deterministic; // yes for the Sealed Bounty, no for inference
        uint256 price; // USDC (6 decimals) per unit
        uint16 bpsOperator;
        uint16 bpsAuthor;
        uint16 bpsNetwork; // sum = 10,000
        uint256 minBond;
        uint256 exposureCap; // v2: exposure cap per operator over a rolling 24 h (on top of half the bond); 0 = none
        address settlement; // authorized settlement contract
        bytes32 param; // e.g. the model hash (modelHash) for inference
        uint64 version;
        uint64 activatesAt;
        State state;
        /// @notice v2: the billed UNIT lives in the product (no longer only in the image): input-equivalent tokens
        ///         per unit. Set in the proposal, never changed; locked in each session.
        uint32 unitTokens;
        /// @notice v2: weight of an output token, in input tokens. Set in the proposal, never changed.
        uint32 outWeight;
    }

    event ProductProposed(uint256 indexed productId, address indexed author, uint64 activatesAt);
    event ProductActivated(uint256 indexed productId);
    event WorkloadAdded(uint256 indexed productId, bytes32 workloadId);
    event WorkloadRetired(uint256 indexed productId, bytes32 workloadId);
    /// @notice v2: an image is proposed; it will be allowed only after the timelock (`applyAt`).
    event WorkloadProposed(uint256 indexed productId, bytes32 workloadId, uint64 applyAt);

    function isWorkloadAllowed(uint256 productId, bytes32 workloadId) external view returns (bool);

    function isAdvisoryAllowed(uint256 productId, string calldata advisoryId) external view returns (bool);

    function getProduct(uint256 productId) external view returns (Product memory);

    function isActive(uint256 productId) external view returns (bool);
}
