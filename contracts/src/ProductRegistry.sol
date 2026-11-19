// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IProductRegistry} from "./interfaces/IProductRegistry.sol";

/// @title ProductRegistry
/// @notice La place de marché des produits : qui peut tourner, à quel prix, avec quel partage,
///         quelles images (workloadId) et quels avis TCB tolérés. Activation, changements de prix ET ajout
///         d'image derrière un timelock (48 h sur Arc mainnet avec la pile v2, 0 sur testnet pour la démo, et on
///         le dit). Le retrait d'une image fautive, lui, est immédiat.
///
///         v2 (revue adverse du 7/11) :
///         - l'ajout d'une image passe par le timelock (proposeWorkload → applyWorkload) : une image ne change
///           plus l'unité facturée « dans le même bloc » ;
///         - l'unité facturée (unitTokens, outWeight) est un champ du produit, fixé à la proposition et
///           verrouillé dans chaque session (SessionPay) ;
///         - la part du réseau est d'au moins 5 % (MIN_NETWORK_BPS), même sur un produit tiers.
///
///         v2.1 : une mise à jour peut AUSSI changer manifestURI (proposeUpdateWithURI), derrière le même timelock ; le
///         nouvel URI est public pendant l'attente (ManifestURIUpdateProposed, pendingManifestURI).
contract ProductRegistry is IProductRegistry {
    /// @notice v2 : la redevance de l'auteur d'un produit est bornée à 30 % du prix.
    uint16 public constant MAX_AUTHOR_BPS = 3000;
    /// @notice v2 : la part du réseau est d'au moins 5 % du prix (aucun produit tiers ne la met à 0).
    uint16 public constant MIN_NETWORK_BPS = 500;

    uint64 public immutable timelock;

    uint256 public productCount;
    mapping(uint256 => Product) private _products;
    mapping(uint256 => string) public manifestURI;
    mapping(uint256 => mapping(bytes32 => bool)) private _workloadAllowed;
    mapping(uint256 => mapping(bytes32 => bool)) private _advisoryAllowed;
    /// @notice v2 : image proposée → instant à partir duquel applyWorkload l'autorise (0 = rien en attente).
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

    /// @notice v2.1 : nouveau manifestURI en attente, appliqué par applyUpdate avec le reste de la mise à jour.
    struct PendingURI {
        bool set;
        string uri;
    }

    mapping(uint256 => PendingURI) public pendingManifestURI;

    event ProductUpdateProposed(uint256 indexed productId, uint64 applyAt);
    event ProductUpdated(uint256 indexed productId, uint64 version);
    /// @notice v2.1 : un changement de manifestURI est proposé (applicable à `applyAt`, avec la mise à jour).
    event ManifestURIUpdateProposed(uint256 indexed productId, string manifestURI, uint64 applyAt);
    /// @notice v2.1 : manifestURI a changé (applyUpdate).
    event ManifestURIUpdated(uint256 indexed productId, string manifestURI);

    error NotAuthor();
    error BadState();
    error TooEarly();
    error BadShares();
    /// @notice v2 : bpsAuthor au-dessus de MAX_AUTHOR_BPS (30 %).
    error AuthorShareTooHigh();
    /// @notice v2 : bpsNetwork sous MIN_NETWORK_BPS (5 %).
    error NetworkShareTooLow();
    error NoPendingUpdate();
    /// @notice v2 : aucune image en attente pour ce produit (proposeWorkload d'abord).
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
        /// @dev v2 : jetons-équivalent-entrée par unité (0 = 1, comportement v1).
        uint32 unitTokens;
        /// @dev v2 : poids d'un jeton de sortie (0 = 1, comportement v1).
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

        // les images de la proposition passent par le même timelock que l'activation du produit
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

    /// @notice v2 : PROPOSE une image après coup ; elle n'est autorisée qu'après le timelock (applyWorkload).
    ///         (v1 : addWorkload, effet immédiat, supprimé : l'image porte l'unité facturée et le code servi.)
    function proposeWorkload(uint256 productId, bytes32 workloadId) external {
        Product storage p = _products[productId];
        if (msg.sender != p.author) revert NotAuthor();
        uint64 applyAt = uint64(block.timestamp) + timelock;
        workloadApplyAt[productId][workloadId] = applyAt;
        emit WorkloadProposed(productId, workloadId, applyAt);
    }

    /// @notice v2 : autorise une image proposée, une fois le timelock écoulé (n'importe qui peut l'appeler).
    function applyWorkload(uint256 productId, bytes32 workloadId) external {
        uint64 applyAt = workloadApplyAt[productId][workloadId];
        if (applyAt == 0) revert NoPendingWorkload();
        if (block.timestamp < applyAt) revert TooEarly();
        delete workloadApplyAt[productId][workloadId];
        _workloadAllowed[productId][workloadId] = true;
        emit WorkloadAdded(productId, workloadId);
    }

    /// @notice Retrait IMMÉDIAT d'une image fautive (pas de timelock) ; annule aussi une proposition en attente.
    ///         v2 : les enclaves déjà inscrites avec cette image s'invalident ensuite (EnclaveRegistry
    ///         .invalidateRetiredWorkload), sans délai de grâce.
    function retireWorkload(uint256 productId, bytes32 workloadId) external {
        Product storage p = _products[productId];
        if (msg.sender != p.author) revert NotAuthor();
        _workloadAllowed[productId][workloadId] = false;
        delete workloadApplyAt[productId][workloadId];
        emit WorkloadRetired(productId, workloadId);
    }

    /// @notice Propose une mise à jour (manifeste, prix, paramètre), applicable après le timelock ; manifestURI ne change
    ///         pas. Remplace toute proposition en attente (y compris un changement d'URI proposé avant).
    function proposeUpdate(uint256 productId, bytes32 manifestHash, uint256 price, bytes32 param) external {
        _proposeUpdate(productId, manifestHash, price, param);
        delete pendingManifestURI[productId];
    }

    /// @notice v2.1 : comme proposeUpdate, et change AUSSI manifestURI, au même instant (même timelock).
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

    // ---- lectures ----

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
