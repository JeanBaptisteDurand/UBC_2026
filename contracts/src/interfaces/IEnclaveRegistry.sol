// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IOperatorBond} from "./IOperatorBond.sol";

/// @title IEnclaveRegistry — v2 : validité en blocs, historique borné des fenêtres
/// @notice v2 (revue adverse du 7/11) : une clé d'enclave est liée À VIE à son premier couple (opérateur,
///         produit) ; une image retirée (ProductRegistry.retireWorkload) invalide ses enclaves SANS grâce.
///         v2.1 : empreinte d'IMAGE (dstack) — avec un journal RTMR3 au format DstackEventLog.FORMAT_V1, une enclave est
///         admise sur l'empreinte de son image (sans les événements propres à l'instance), qui survit aux redémarrages.
interface IEnclaveRegistry {
    /// @dev v2 : les 12 premiers champs gardent l'ordre, le type et le sens de la v1 (un lecteur v1 les
    ///      décode encore) ; `fromBlock` et `untilBlock` sont AJOUTÉS à la fin.
    struct Enclave {
        address signer; // clé secp256k1 de l'enclave
        bytes32 x25519; // clé publique de chiffrement
        uint256 productId;
        address operator;
        bytes32 workloadId;
        bytes6 fmspc;
        uint8 tcbStatus;
        bytes32 quoteHash;
        uint64 anchorBlock;
        uint64 registeredAt; // horodatage de la dernière (ré)inscription
        uint64 expiresAt; // horodatage INDICATIF de fin de validité (la règle est en blocs : untilBlock)
        bool active; // faux après un retrait ou une invalidation
        uint64 fromBlock; // v2 : premier bloc de la fenêtre de validité en cours
        uint64 untilBlock; // v2 : dernier bloc (inclus) de la fenêtre ; abaissé au retrait ou à l'invalidation
    }

    /// @notice Une fenêtre de validité (v2). Un reçu ancré dans [fromBlock, untilBlock] se règle jusqu'au
    ///         bloc untilBlock + GRACE_BLOCKS ; aucun bloc postérieur à untilBlock n'est jamais valide.
    struct Window {
        uint256 productId;
        address operator;
        uint64 fromBlock;
        uint64 untilBlock; // inclus
    }

    event EnclaveRegistered(
        address indexed signer,
        uint256 indexed productId,
        address indexed operator,
        bytes32 workloadId,
        uint64 expiresAt
    );
    /// @notice v2.1 : l'image lue dans le journal RTMR3 rejoué (émis à chaque inscription avec un journal FORMAT_V1
    ///         qui décrit l'image ; `imageId` est l'empreinte d'image, retenue si le produit l'autorise).
    event EnclaveImage(
        address indexed signer,
        uint256 indexed productId,
        bytes32 indexed imageId,
        bytes32 composeHash,
        bytes32 osImageHash
    );
    event EnclaveInvalidated(address indexed signer, string reason);
    event EnclaveRetired(address indexed signer);

    /// @param eventLog v2.1 : journal RTMR3 encodé abi.encode(DstackEventLog.FORMAT_V1, (uint8 version, bytes name,
    ///                 bytes payload)[]) pour une admission sur l'empreinte d'IMAGE ; vide (ou d'un autre format, ignoré
    ///                 comme en v2) pour l'empreinte complète.
    function registerEnclave(
        uint256 productId,
        bytes calldata quote,
        uint256 anchorR,
        address signer,
        bytes32 x25519,
        bytes calldata eventLog
    ) external;

    function invalidate(address signer, bytes calldata quote) external;

    /// @notice v2 : invalide, sans quote et sans délai de grâce, une enclave dont l'image (workloadId) a été
    ///         retirée du produit. Ouvert à tous. Ses reçus et réclamations ne se règlent plus, même ancrés avant.
    function invalidateRetiredWorkload(address signer) external;

    function retire(address signer) external;

    /// @notice Vrai si un reçu de l'enclave `signer` pour `productId`, ancré au bloc `blockNumber`, est
    ///         réglable MAINTENANT : `blockNumber` est dans une fenêtre de validité de l'enclave pour ce
    ///         produit (après l'inscription, avant le retrait ou l'invalidation, avant l'expiration), et la
    ///         grâce de cette fenêtre n'est pas écoulée.
    function isActiveAt(address signer, uint256 productId, uint256 blockNumber) external view returns (bool);

    /// @notice Comme isActiveAt, mais rend l'opérateur responsable de la fenêtre (address(0) si inactive).
    ///         C'est ce que lisent les contrats de règlement : un seul appel, et l'opérateur de l'époque.
    function activeOperatorAt(address signer, uint256 productId, uint256 blockNumber)
        external
        view
        returns (address);

    function enclaveOf(address signer) external view returns (Enclave memory);

    /// @notice La fenêtre en cours et la précédente (gardée pour sa grâce). Champs à zéro si absentes.
    function windowsOf(address signer) external view returns (Window memory current, Window memory previous);

    /// @notice v2 : dernier bloc auquel un reçu de cette clé peut encore se régler (fin de fenêtre + grâce) ;
    ///         0 si la clé est inconnue ou invalidée sans grâce. Au-delà, plus aucun reçu de cette enclave ne paie
    ///         (SessionPay s'en sert pour laisser fermer plus tôt une session dont l'enclave a disparu).
    function settleableUntilBlock(address signer) external view returns (uint256);

    /// @notice v2.1 : la caution des opérateurs (déjà publique en v2). v2.1 bis : AttestedSigners passe désormais par
    ///         attestedOperator, qui lit aussi la radiation de l'opérateur.
    function bond() external view returns (IOperatorBond);

    /// @notice v2.1 bis : l'opérateur de `signer` si cette clé FAIT FOI MAINTENANT pour `productId` (primitive onlyAttested,
    ///         AttestedSigners) : enclave active au bloc courant (activeOperatorAt), opérateur non radié, produit ACTIF et
    ///         image (Enclave.workloadId) ENCORE autorisée par le produit. Le retrait d'une image (retireWorkload) ou du
    ///         produit (retire) agit donc tout de suite, sans attendre invalidateRetiredWorkload. Sinon address(0).
    ///         (Les reçus et réclamations ANCRÉS, eux, restent régis par activeOperatorAt, comme en v2.)
    function attestedOperator(address signer, uint256 productId) external view returns (address);
}
