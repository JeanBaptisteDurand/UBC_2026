// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title History — lecture du hash d'un bloc via le contrat d'historique EIP-2935
/// @notice Contrat d'historique à 0x0000F90827F1C53a10cb7A02335B175320002935 sur Arc (VERIFIED).
///         Fenêtre de 8 191 blocs (≈ 69 min). Au-delà, le contrat ne rend plus le hash.
///         Format d'appel selon EIP-2935 : numéro de bloc sur 32 octets en entrée, hash sur 32 en sortie.
///         Encodage abi.encode(uint256) éprouvé sur Arc : chaque inscription d'enclave lit ici le hash de son bloc d'ancrage.
library History {
    address internal constant HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935;
    uint256 internal constant WINDOW = 8191;

    error AnchorTooOld();
    error HistoryCallFailed();

    /// @notice Hash du bloc `blockNumber`. Revert si hors fenêtre ou si l'appel échoue.
    function blockHashAt(uint256 blockNumber) internal view returns (bytes32 h) {
        // la fenêtre exige block.number - blockNumber dans [1, WINDOW]
        if (blockNumber >= block.number || block.number - blockNumber > WINDOW) {
            revert AnchorTooOld();
        }
        (bool ok, bytes memory out) = HISTORY.staticcall(abi.encode(blockNumber));
        if (!ok || out.length != 32) revert HistoryCallFailed();
        h = abi.decode(out, (bytes32));
    }

    /// @notice Variante sans revert : rend (false, 0) si hors fenêtre ou si l'appel échoue.
    function tryBlockHashAt(uint256 blockNumber) internal view returns (bool ok, bytes32 h) {
        if (blockNumber >= block.number || block.number - blockNumber > WINDOW) {
            return (false, bytes32(0));
        }
        bytes memory out;
        (ok, out) = HISTORY.staticcall(abi.encode(blockNumber));
        if (!ok || out.length != 32) return (false, bytes32(0));
        h = abi.decode(out, (bytes32));
    }
}
