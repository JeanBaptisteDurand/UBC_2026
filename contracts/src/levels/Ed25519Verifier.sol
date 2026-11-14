// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SCL_EIP6565} from "@solidity/lib/libSCL_EIP6565.sol";
import {SCL_sha512} from "@solidity/hash/SCL_sha512.sol";
import {ecGenMulmuladdB4W} from "@solidity/elliptic/SCL_mulmuladdX_fullgenW.sol";
import {p, a, gx, gy, n} from "@solidity/fields/SCL_wei25519.sol";

/// @title Ed25519Verifier — vérification de signatures Ed25519 (RFC 8032) sur Arc, par la Smooth CryptoLib (10/11/2026)
/// @notice Contrat AUTONOME (compilé sans via_ir, comme la bibliothèque : voir foundry.toml) que les autres contrats appellent
///         par l'interface IEd25519Verifier. `verify` est SCL_EIP6565.Verify_LE (commit d714e98 de get-smooth/crypto-lib,
///         MIT, auditée par CryptoExperts et Veridise en 2024) recopiée ligne à ligne avec les fonctions INTERNES de la
///         bibliothèque (aucune édition de liens) : HashInternal = SHA512_modq(R ‖ A ‖ M), edCompress = y + (x & 1) << 255.
///         Testée sur les vecteurs de la RFC 8032 et sur un vrai jeton de l'alliance Proof of Cloud.
contract Ed25519Verifier {
    /// @notice La clé (x, y) d'Edwards, en forme de Weierstrass (celle qu'attend `verify`).
    function weierstrass(uint256 x, uint256 y) external view returns (uint256 wx, uint256 wy) {
        return SCL_EIP6565.Edwards2WeierStrass(x, y);
    }

    /// @notice Vrai si (r, s) est une signature Ed25519 de `m` par la clé `extKpub` : [wx, wy, 0, 0, clé], la clé en
    ///         octets bruts (RFC 8032) lus comme un entier ; r et s aussi (les 32 + 32 octets de la signature).
    function verify(string calldata m, uint256 r, uint256 s, uint256[5] calldata extKpub) external view returns (bool) {
        uint256[2] memory S;
        uint256 kpubC = extKpub[4];
        s = SCL_sha512.Swap256(s);
        if (s == 0 || s >= n) return false;
        uint256 k = SCL_EIP6565.SHA512_modq(abi.encodePacked(r, kpubC, m));
        uint256[6] memory q = [extKpub[0], extKpub[1], p, a, gx, gy];
        (S[0], S[1]) = ecGenMulmuladdB4W(q, s, n - k);
        (S[0], S[1]) = SCL_EIP6565.WeierStrass2Edwards(S[0], S[1]);
        uint256 recomputed = S[1] + ((S[0] & 1) << 255);
        recomputed = SCL_sha512.Swap256(recomputed);
        return recomputed == r;
    }
}
