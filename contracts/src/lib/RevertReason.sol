// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title RevertReason — les données de revert du dernier appel, BORNÉES (v2.1 bis)
/// @notice `catch (bytes memory reason)` recopie TOUT le revert de l'appelé. Un appelé hostile ou bogué (ici le registre
///         ERC-8004, proxy mis à jour ou clé compromise, derrière VerdictLog) peut renvoyer un revert dont la copie
///         (mémoire, coût quadratique) dépasse le gaz qui reste à l'appelant, QUEL QUE SOIT le gaz envoyé : toute la
///         transaction échoue (« return bomb », revue adverse du 9/11 : fermeture de session, saisie et paiement de prime
///         bloqués, alors que `catch {}` de la v2 y survivait). `catch { ... RevertReason.bounded() ... }` ne recopie que
///         les MAX_LENGTH premiers octets : le sélecteur d'une erreur et jusqu'à 4 arguments, ou un Error(string) de
///         64 octets au plus (au-delà, le message est tronqué).
library RevertReason {
    /// @notice Octets recopiés au plus : sélecteur + 4 mots.
    uint256 internal constant MAX_LENGTH = 132;

    /// @notice Les données de revert du DERNIER appel externe, tronquées à MAX_LENGTH octets. À appeler en tête d'un bloc
    ///         `catch { }`, avant tout autre appel externe (qui remplacerait les données de retour).
    function bounded() internal pure returns (bytes memory r) {
        assembly ("memory-safe") {
            let n := returndatasize()
            if gt(n, 132) { n := 132 } // MAX_LENGTH
            r := mload(0x40)
            mstore(r, n)
            returndatacopy(add(r, 0x20), 0, n)
            mstore(0x40, add(add(r, 0x20), and(add(n, 31), not(31))))
        }
    }
}
