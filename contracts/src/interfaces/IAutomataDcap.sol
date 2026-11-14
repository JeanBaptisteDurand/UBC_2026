// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IAutomataDcap — l'entrée du vérificateur DCAP d'Automata (code tiers, C1)
/// @notice MIT, déployé et configuré par nous (PCCS + collatéral Intel).
///         Format de sortie en cas de succès (VERIFIED dans AttestationEntrypointBase) :
///           abi.encodePacked(
///             uint16 quoteVersion (BE),
///             uint16 quoteBodyType (BE),
///             uint8  tcbStatus,
///             bytes6 fmspc,
///             bytes  quoteBody,                       // TD10 = 584 o, TD15 = 648 o
///             advisoryIDs.length > 0 ? abi.encode(string[] advisoryIDs) : "" )
///         En cas d'échec : `success = false` et `output` = la raison en UTF-8.
///         Automata ne refuse que TCB_REVOKED ; il ne lit pas tdAttributes (toute la politique est en C2).
interface IAutomataDcap {
    /// @dev Choisit automatiquement le dernier tcbEvaluationDataNumber.
    function verifyAndAttestOnChain(bytes calldata rawQuote)
        external
        payable
        returns (bool success, bytes memory output);

    /// @dev Variante qui fixe le tcbEvaluationDataNumber (numéro d'évaluation TCB d'Intel).
    function verifyAndAttestOnChain(bytes calldata rawQuote, uint32 tcbEvaluationDataNumber)
        external
        payable
        returns (bool success, bytes memory output);
}
