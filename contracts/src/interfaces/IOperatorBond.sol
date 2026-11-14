// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IOperatorBond (SPEC-TECH §C4) — la caution qui BORNE le débit d'une enclave forgée
/// @notice Ce que la caution fait, et ce qu'elle ne fait pas (revue adverse du 7/11) :
///         - elle borne ce qu'une enclave peut faire payer sur sa seule foi : ½ caution disponible sur 24 h
///           GLISSANTES, tous produits confondus, et le plafond `exposureCap` de chaque produit ;
///         - elle est saisie en entier sur une faute PROUVÉE on-chain : équivocation (SessionPay, SealedBounty) ou
///           réclamation de prime réfutée par un contre-rejeu d'autres enclaves (SealedBounty.refute) ;
///         - elle ne rembourse rien d'autre : un reçu d'inférence gonflé par une enclave forgée n'est pas
///           prouvable, la caution n'en limite que le débit.
interface IOperatorBond {
    event Bonded(address indexed operator, uint256 amount);
    event UnbondRequested(address indexed operator, uint256 amount, uint64 withdrawableAt);
    event Withdrawn(address indexed operator, uint256 amount);
    event ExposureConsumed(address indexed operator, uint256 indexed productId, uint256 amount);
    event Slashed(address indexed operator, address indexed reporter, address victim, uint256 amount);
    /// @notice v2 : caution minimale d'un produit réservée pour une clé d'enclave inscrite, puis libérée.
    event BondReserved(address indexed operator, address indexed signer, uint256 amount);
    event BondReleased(address indexed operator, address indexed signer, uint256 amount);

    function bondOf(address operator) external view returns (uint256);

    /// @notice Caution disponible = caution − montant en demande de retrait. Sert à la règle « ½ caution ».
    function availableBond(address operator) external view returns (uint256);

    /// @notice v2 : caution LIBRE = disponible − réservée pour les enclaves inscrites. C'est tout ce qu'une
    ///         nouvelle inscription d'enclave ou une demande de retrait peut prendre.
    function freeBond(address operator) external view returns (uint256);

    /// @notice v2 : caution réservée pour la clé d'enclave `signer` (0 si aucune).
    function reservedFor(address signer) external view returns (uint256);

    /// @notice Exposition déjà libérée pour ce produit sur les dernières 24 h (glissantes, à 12 h près).
    function exposureOf(address operator, uint256 productId) external view returns (uint256);

    /// @notice v2 : exposition totale de l'opérateur, tous produits confondus, sur les dernières 24 h.
    function totalExposureOf(address operator) external view returns (uint256);

    /// @dev Appelé par les seuls contrats de règlement autorisés (C5, C6).
    ///      Refuse au-delà de la moitié de la caution disponible sur 24 h glissantes, TOUS PRODUITS CONFONDUS, ET
    ///      au-delà de `cap`, le plafond d'exposition du produit (`Product.exposureCap`) pour ce couple
    ///      (opérateur, produit) sur la même fenêtre. `cap` = 0 : pas de plafond en plus de la règle de la caution.
    function consumeExposure(address operator, uint256 productId, uint256 amount, uint256 cap) external;

    /// @dev Appelé par un contrat de règlement qui a prouvé une faute. Saisit toute la caution, bannit
    ///      l'opérateur, répartit 50 % au dénonciateur / 50 % à la victime (ou au fonds du réseau).
    function slash(address operator, address reporter, address victim) external;

    /// @dev v2 : appelé par l'EnclaveRegistry à l'inscription d'une clé (réserve `amount` de la caution libre
    ///      de `operator` ; sans effet si la clé a déjà sa réservation).
    function reserve(address operator, address signer, uint256 amount) external;

    /// @dev v2 : appelé par l'EnclaveRegistry au retrait ou à l'invalidation d'une clé.
    function release(address signer) external;

    function agentIdOf(address operator) external view returns (uint256);

    /// @notice Vrai si l'opérateur a été saisi pour une faute prouvée (radié).
    function banned(address operator) external view returns (bool);
}
