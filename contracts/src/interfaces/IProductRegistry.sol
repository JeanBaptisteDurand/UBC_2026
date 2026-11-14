// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IProductRegistry (SPEC-TECH §C3) — la place de marché des produits
interface IProductRegistry {
    enum State {
        None,
        Proposed,
        Active,
        Retired
    }

    /// @dev Les 14 premiers champs gardent l'ordre, le type et le sens de la v1 (un lecteur v1 les décode encore) ;
    ///      v2 AJOUTE `unitTokens` et `outWeight` à la fin.
    struct Product {
        address author;
        bytes32 manifestHash;
        bool deterministic; // oui pour la Prime scellée, non pour l'inférence
        uint256 price; // USDC (6 décimales) par unité
        uint16 bpsOperator;
        uint16 bpsAuthor;
        uint16 bpsNetwork; // somme = 10 000
        uint256 minBond;
        uint256 exposureCap; // v2 : plafond d'exposition par opérateur sur 24 h glissantes (en plus de ½ caution) ; 0 = aucun
        address settlement; // contrat de règlement autorisé (C5/C6)
        bytes32 param; // ex. hash du modèle (modelHash) pour l'inférence
        uint64 version;
        uint64 activatesAt;
        State state;
        /// @notice v2 : l'UNITÉ facturée vit dans le produit (plus seulement dans l'image) : jetons-équivalent-
        ///         entrée par unité. Fixée à la proposition, jamais modifiée ; verrouillée dans chaque session.
        uint32 unitTokens;
        /// @notice v2 : poids d'un jeton de sortie, en jetons d'entrée. Fixé à la proposition, jamais modifié.
        uint32 outWeight;
    }

    event ProductProposed(uint256 indexed productId, address indexed author, uint64 activatesAt);
    event ProductActivated(uint256 indexed productId);
    event WorkloadAdded(uint256 indexed productId, bytes32 workloadId);
    event WorkloadRetired(uint256 indexed productId, bytes32 workloadId);
    /// @notice v2 : une image est proposée ; elle ne sera autorisée qu'après le timelock (`applyAt`).
    event WorkloadProposed(uint256 indexed productId, bytes32 workloadId, uint64 applyAt);

    function isWorkloadAllowed(uint256 productId, bytes32 workloadId) external view returns (bool);

    function isAdvisoryAllowed(uint256 productId, string calldata advisoryId) external view returns (bool);

    function getProduct(uint256 productId) external view returns (Product memory);

    function isActive(uint256 productId) external view returns (bool);
}
