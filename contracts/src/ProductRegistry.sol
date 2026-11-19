// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IProductRegistry} from "./interfaces/IProductRegistry.sol";

/// @title ProductRegistry
/// @notice The product marketplace: who may run a product, at what price, with what split, which images
///         (workloadId) and which tolerated TCB advisories. Activation, price changes AND adding an image sit behind
///         a timelock (48 hours on Arc mainnet with the v2 stack, 0 on testnet for the demo, and we say so).
///         Retiring a faulty image takes effect at once.
///
///         v2 (after an adversarial review):
///         - adding an image goes through the timelock (proposeWorkload, then applyWorkload): an image no longer
///           changes the billed unit "in the same block";
///         - the billed unit (unitTokens, outWeight) is a field of the product, set in the proposal and locked in
///           each session (SessionPay);
///         - the network share is at least 5% (MIN_NETWORK_BPS), even on a third-party product.
///
///         v2.1: an update can ALSO change manifestURI (proposeUpdateWithURI), behind the same timelock; the new URI
///         is public during the wait (ManifestURIUpdateProposed, pendingManifestURI).
contract ProductRegistry is IProductRegistry {
    /// @notice v2: a product author's royalty is capped at 30% of the price.
    uint16 public constant MAX_AUTHOR_BPS = 3000;
    /// @notice v2: the network share is at least 5% of the price (no third-party product can set it to 0).
    uint16 public constant MIN_NETWORK_BPS = 500;

    uint64 public immutable timelock;

    uint256 public productCount;
    mapping(uint256 => Product) private _products;
    mapping(uint256 => string) public manifestURI;
    mapping(uint256 => mapping(bytes32 => bool)) private _workloadAllowed;
    mapping(uint256 => mapping(bytes32 => bool)) private _advisoryAllowed;
    /// @notice v2: proposed image -> time from which applyWorkload allows it (0 = nothing pending).
    mapping(uint256 => mapping(bytes32 => uint64)) public workloadApplyAt;

    struct PendingUpdate {
        bytes32 manifestHash;
        uint256 price;
        bytes32 param;
        uint64 version;
        uint64 applyAt;
        bool exists;
    }

    mapping(uint256 => PendingUpdate) public pendingUpdate;

    /// @notice v2.1: pending new manifestURI, applied by applyUpdate with the rest of the update.
    struct PendingURI {
        bool set;
        string uri;
    }

    mapping(uint256 => PendingURI) public pendingManifestURI;

    event ProductUpdateProposed(uint256 indexed productId, uint64 applyAt);
    event ProductUpdated(uint256 indexed productId, uint64 version);
    /// @notice v2.1: a manifestURI change is proposed (applicable at `applyAt`, with the update).
    event ManifestURIUpdateProposed(uint256 indexed productId, string manifestURI, uint64 applyAt);
    /// @notice v2.1: manifestURI changed (applyUpdate).
    event ManifestURIUpdated(uint256 indexed productId, string manifestURI);

    error NotAuthor();
    error BadState();
    error TooEarly();
    error BadShares();
    /// @notice v2: bpsAuthor above MAX_AUTHOR_BPS (30%).
    error AuthorShareTooHigh();
    /// @notice v2: bpsNetwork below MIN_NETWORK_BPS (5%).
    error NetworkShareTooLow();
    error NoPendingUpdate();
    /// @notice v2: no image pending for this product (call proposeWorkload first).
    error NoPendingWorkload();

    struct ProposeParams {
        bytes32 manifestHash;
        string manifestURI;
        bytes32[] workloadIds;
        bool deterministic;
        uint256 price;
        uint16 bpsOperator;
        uint16 bpsAuthor;
        uint16 bpsNetwork;
        uint256 minBond;
        uint256 exposureCap;
        address settlement;
        bytes32 param;
        string[] advisoryIds;
        /// @dev v2: input-equivalent tokens per unit (0 = 1, the v1 behavior).
        uint32 unitTokens;
        /// @dev v2: weight of an output token (0 = 1, the v1 behavior).
        uint32 outWeight;
    }

    constructor(uint64 _timelock) {
        timelock = _timelock;
    }

    function propose(ProposeParams calldata q) external returns (uint256 productId) {
        if (uint256(q.bpsOperator) + q.bpsAuthor + q.bpsNetwork != 10_000) revert BadShares();
        if (q.bpsAuthor > MAX_AUTHOR_BPS) revert AuthorShareTooHigh();
        if (q.bpsNetwork < MIN_NETWORK_BPS) revert NetworkShareTooLow();

        productId = ++productCount;
        uint64 activatesAt = uint64(block.timestamp) + timelock;

        _products[productId] = Product({
            author: msg.sender,
            manifestHash: q.manifestHash,
            deterministic: q.deterministic,
            price: q.price,
            bpsOperator: q.bpsOperator,
            bpsAuthor: q.bpsAuthor,
            bpsNetwork: q.bpsNetwork,
            minBond: q.minBond,
            exposureCap: q.exposureCap,
            settlement: q.settlement,
            param: q.param,
            version: 1,
            activatesAt: activatesAt,
            state: State.Proposed,
            unitTokens: q.unitTokens == 0 ? 1 : q.unitTokens,
            outWeight: q.outWeight == 0 ? 1 : q.outWeight
        });
        manifestURI[productId] = q.manifestURI;

        // the images of the proposal go through the same timelock as the product's activation
        for (uint256 i = 0; i < q.workloadIds.length; i++) {
            _workloadAllowed[productId][q.workloadIds[i]] = true;
            emit WorkloadAdded(productId, q.workloadIds[i]);
        }
        for (uint256 i = 0; i < q.advisoryIds.length; i++) {
            _advisoryAllowed[productId][keccak256(bytes(q.advisoryIds[i]))] = true;
        }

        emit ProductProposed(productId, msg.sender, activatesAt);
    }

    function activate(uint256 productId) external {
        Product storage p = _products[productId];
        if (p.state != State.Proposed) revert BadState();
        if (block.timestamp < p.activatesAt) revert TooEarly();
        p.state = State.Active;
        emit ProductActivated(productId);
    }

    /// @notice v2: PROPOSES an image afterwards; it is allowed only after the timelock (applyWorkload).
    ///         (v1's immediate addWorkload is removed: the image carries the billed unit and the served code.)
    function proposeWorkload(uint256 productId, bytes32 workloadId) external {
        Product storage p = _products[productId];
        if (msg.sender != p.author) revert NotAuthor();
        uint64 applyAt = uint64(block.timestamp) + timelock;
        workloadApplyAt[productId][workloadId] = applyAt;
        emit WorkloadProposed(productId, workloadId, applyAt);
    }

    /// @notice v2: allows a proposed image once the timelock has passed (anyone can call it).
    function applyWorkload(uint256 productId, bytes32 workloadId) external {
        uint64 applyAt = workloadApplyAt[productId][workloadId];
        if (applyAt == 0) revert NoPendingWorkload();
        if (block.timestamp < applyAt) revert TooEarly();
        delete workloadApplyAt[productId][workloadId];
        _workloadAllowed[productId][workloadId] = true;
        emit WorkloadAdded(productId, workloadId);
    }

    /// @notice IMMEDIATE retirement of a faulty image (no timelock); also cancels a pending proposal.
    ///         v2: the enclaves already registered with this image are then invalidated (EnclaveRegistry
    ///         .invalidateRetiredWorkload), with no grace period.
    function retireWorkload(uint256 productId, bytes32 workloadId) external {
        Product storage p = _products[productId];
        if (msg.sender != p.author) revert NotAuthor();
        _workloadAllowed[productId][workloadId] = false;
        delete workloadApplyAt[productId][workloadId];
        emit WorkloadRetired(productId, workloadId);
    }

    /// @notice Proposes an update (manifest, price, parameter), applicable after the timelock; manifestURI does not
    ///         change. Replaces any pending proposal (including a URI change proposed before).
    function proposeUpdate(uint256 productId, bytes32 manifestHash, uint256 price, bytes32 param) external {
        _proposeUpdate(productId, manifestHash, price, param);
        delete pendingManifestURI[productId];
    }

    /// @notice v2.1: like proposeUpdate, and ALSO changes manifestURI, at the same time (same timelock).
    function proposeUpdateWithURI(
        uint256 productId,
        bytes32 manifestHash,
        string calldata newManifestURI,
        uint256 price,
        bytes32 param
    ) external {
        uint64 applyAt = _proposeUpdate(productId, manifestHash, price, param);
        pendingManifestURI[productId] = PendingURI({set: true, uri: newManifestURI});
        emit ManifestURIUpdateProposed(productId, newManifestURI, applyAt);
    }

    function applyUpdate(uint256 productId) external {
        PendingUpdate memory u = pendingUpdate[productId];
        if (!u.exists) revert NoPendingUpdate();
        if (block.timestamp < u.applyAt) revert TooEarly();
        Product storage p = _products[productId];
        p.manifestHash = u.manifestHash;
        p.price = u.price;
        p.param = u.param;
        p.version = u.version;
        delete pendingUpdate[productId];
        PendingURI storage pu = pendingManifestURI[productId];
        if (pu.set) {
            string memory uri = pu.uri;
            manifestURI[productId] = uri;
            delete pendingManifestURI[productId];
            emit ManifestURIUpdated(productId, uri);
        }
        emit ProductUpdated(productId, u.version);
    }

    function _proposeUpdate(uint256 productId, bytes32 manifestHash, uint256 price, bytes32 param)
        private
        returns (uint64 applyAt)
    {
        Product storage p = _products[productId];
        if (msg.sender != p.author) revert NotAuthor();
        applyAt = uint64(block.timestamp) + timelock;
        pendingUpdate[productId] = PendingUpdate({
            manifestHash: manifestHash,
            price: price,
            param: param,
            version: p.version + 1,
            applyAt: applyAt,
            exists: true
        });
        emit ProductUpdateProposed(productId, applyAt);
    }

    function retire(uint256 productId) external {
        Product storage p = _products[productId];
        if (msg.sender != p.author) revert NotAuthor();
        p.state = State.Retired;
    }

    // ---- reads ----

    function isWorkloadAllowed(uint256 productId, bytes32 workloadId) external view override returns (bool) {
        return _workloadAllowed[productId][workloadId];
    }

    function isAdvisoryAllowed(uint256 productId, string calldata advisoryId) external view override returns (bool) {
        return _advisoryAllowed[productId][keccak256(bytes(advisoryId))];
    }

    function getProduct(uint256 productId) external view override returns (Product memory) {
        return _products[productId];
    }

    function isActive(uint256 productId) external view override returns (bool) {
        return _products[productId].state == State.Active;
    }
}
