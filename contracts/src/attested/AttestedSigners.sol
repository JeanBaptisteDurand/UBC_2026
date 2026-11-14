// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IEnclaveRegistry} from "../interfaces/IEnclaveRegistry.sol";

/// @title AttestedSignersLib — la primitive « onlyAttested » (v2.1)
/// @notice Un message n'est accepté que s'il est signé par une enclave ATTESTÉE : une clé que l'EnclaveRegistry a
///         inscrite pour ce produit après vérification de son quote par Intel (DCAP), active AU BLOC COURANT (dans sa
///         fenêtre de validité, ni retirée, ni expirée, ni invalidée), et dont l'opérateur n'est pas radié (une faute
///         prouvée — équivocation, réclamation réfutée — fait tomber toutes ses enclaves). C'est le « signataire de
///         confiance » d'un pont ou d'un oracle, remplacé par une preuve matérielle vérifiée on-chain.
///         v2.1 bis (revue adverse du 9/11) : le produit doit être ACTIF et l'image de l'enclave ENCORE autorisée
///         (EnclaveRegistry.attestedOperator) : retirer l'image ou le produit coupe ses enclaves tout de suite, sans
///         attendre la transaction invalidateRetiredWorkload (une par clé) pendant laquelle un opérateur qui surveille la
///         file d'attente pouvait encore faire passer des messages. Exige un EnclaveRegistry v2.1 bis ou plus récent.
///
///         Ce que la primitive NE fait PAS : l'anti-rejeu et la liaison au contexte. Le condensat signé doit lier le
///         message à la chaîne, au contrat et au produit (EIP-712 avec productId), et l'appelant gère nonces ou
///         numéros de séquence (voir AttestedBatchVerifier). Ni le quorum : UNE enclave attestée suffit ; un vrai pont
///         en exigerait plusieurs, d'opérateurs distincts.
library AttestedSignersLib {
    /// @notice `signer` ne fait pas foi pour le produit au bloc courant (enclave inactive, opérateur radié, produit
    ///         retiré ou image retirée) ; address(0) : signature illisible.
    error NotAttested(address signer);

    /// @notice Le signataire de `digest` s'il fait foi pour `productId` au bloc courant (EnclaveRegistry.attestedOperator),
    ///         et l'opérateur responsable de sa fenêtre ; sinon revert NotAttested. Signatures ECDSA de 65 octets, s « bas »
    ///         (ECDSA d'OpenZeppelin : pas de malléabilité).
    function requireAttestedSig(IEnclaveRegistry registry, uint256 productId, bytes32 digest, bytes memory signature)
        internal
        view
        returns (address signer, address operator)
    {
        (address s, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError) revert NotAttested(address(0));
        operator = registry.attestedOperator(s, productId);
        if (operator == address(0)) revert NotAttested(s);
        signer = s;
    }
}

/// @title AttestedSigners — à hériter par un contrat qui reçoit des messages signés par des enclaves (v2.1)
/// @notice requireAttestedSig(productId, digest, signature) rend le signataire ou revert NotAttested ; le modificateur
///         onlyAttested fait la même vérification avant le corps de la fonction, qui lit le signataire avec
///         _attestedSigner() (stockage transitoire, EIP-1153 : rien n'est écrit en stockage permanent).
abstract contract AttestedSigners {
    /// @notice Le registre d'enclaves dont ce contrat accepte les signatures.
    IEnclaveRegistry public immutable enclaveRegistry;

    /// @dev Signataire du message en cours de traitement sous onlyAttested.
    address private transient _signer;

    constructor(IEnclaveRegistry registry_) {
        enclaveRegistry = registry_;
    }

    /// @notice N'exécute la fonction que si `signature` sur `digest` vient d'une enclave qui fait foi pour `productId`
    ///         (active au bloc courant, opérateur non radié, produit actif, image encore autorisée).
    modifier onlyAttested(uint256 productId, bytes32 digest, bytes memory signature) {
        (address s,) = AttestedSignersLib.requireAttestedSig(enclaveRegistry, productId, digest, signature);
        address outer = _signer;
        _signer = s;
        _;
        _signer = outer;
    }

    /// @notice Le signataire de `digest` s'il fait foi pour `productId` au bloc courant (voir le modificateur) ; sinon
    ///         revert AttestedSignersLib.NotAttested(signataire).
    function requireAttestedSig(uint256 productId, bytes32 digest, bytes memory signature)
        public
        view
        returns (address signer)
    {
        (signer,) = AttestedSignersLib.requireAttestedSig(enclaveRegistry, productId, digest, signature);
    }

    /// @dev Dans une fonction marquée onlyAttested : l'enclave qui a signé le message.
    function _attestedSigner() internal view returns (address) {
        return _signer;
    }
}
