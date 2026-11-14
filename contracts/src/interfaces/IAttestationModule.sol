// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IAttestationModule — module d'attestation interchangeable (SPEC-TECH §C2)
/// @notice Aujourd'hui TDX/DCAP (Automata). Demain Nitro ou SEV-SNP, sans toucher aux produits.
///         Le module vérifie un quote auprès du code tiers (C1) puis découpe le corps et
///         rend des mesures normalisées. TOUTE la politique de refus vit dans l'EnclaveRegistry (C2),
///         pas ici : le module ne fait que vérifier + mesurer.
interface IAttestationModule {
    /// @dev Mesures normalisées rendues par le module.
    ///      Les champs 48 octets (mrtd, rtmr*, mrConfigId) sont en `bytes` pour le concat du workloadId.
    struct Measurements {
        bool ok; // succès de la vérification tierce (C1)
        uint16 version; // 4 ou 5
        uint16 bodyType; // TD10 (=2) ou TD15 (=3)
        uint8 tcbStatus; // 0 = OK ... 6 = REVOKED, 7 = UNRECOGNIZED (enum Automata)
        bytes6 fmspc;
        bytes reportData; // 64 octets
        bytes mrtd; // 48 octets
        bytes rtmr0; // 48 octets
        bytes rtmr1; // 48 octets
        bytes rtmr2; // 48 octets
        bytes rtmr3; // 48 octets
        bytes mrConfigId; // 48 octets
        bytes8 xfam;
        bytes8 tdAttributes;
        string[] advisories; // identifiants d'avis Intel (pour la liste blanche P2)
    }

    /// @param quote    le quote DCAP brut (sortie de GetQuote de l'enclave)
    /// @param eventLog le journal d'événements RTMR (vide si RTMR3 épinglé, cf. S1)
    /// @dev Non-`view` : le vérificateur tiers (Automata) est `payable` et lit l'état du PCCS,
    ///      donc appelé par CALL. Les chemins appelants (registerEnclave, invalidate) changent déjà l'état.
    function verify(bytes calldata quote, bytes calldata eventLog)
        external
        returns (Measurements memory m);
}
