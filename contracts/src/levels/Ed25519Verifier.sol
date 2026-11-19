// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SCL_EIP6565} from "@solidity/lib/libSCL_EIP6565.sol";
import {SCL_sha512} from "@solidity/hash/SCL_sha512.sol";
import {ecGenMulmuladdB4W} from "@solidity/elliptic/SCL_mulmuladdX_fullgenW.sol";
import {p, a, gx, gy, n} from "@solidity/fields/SCL_wei25519.sol";

/// @title Ed25519Verifier — Ed25519 signature verification (RFC 8032) on Arc, with Smooth CryptoLib
/// @notice A STANDALONE contract (compiled without via_ir, like the library: see foundry.toml) that other contracts
///         call through the IEd25519Verifier interface. `verify` is SCL_EIP6565.Verify_LE (commit d714e98 of
///         get-smooth/crypto-lib, MIT, audited by CryptoExperts and Veridise in 2024), copied line by line with the
///         library's INTERNAL functions (no linking): HashInternal = SHA512_modq(R ‖ A ‖ M),
///         edCompress = y + (x & 1) << 255.
///         Tested on the RFC 8032 vectors and on a real token from the Proof of Cloud alliance.
contract Ed25519Verifier {
    /// @notice The Edwards key (x, y), in Weierstrass form (the one `verify` expects).
    function weierstrass(uint256 x, uint256 y) external view returns (uint256 wx, uint256 wy) {
        return SCL_EIP6565.Edwards2WeierStrass(x, y);
    }

    /// @notice True if (r, s) is an Ed25519 signature of `m` by the key `extKpub`: [wx, wy, 0, 0, key], the key as raw
    ///         bytes (RFC 8032) read as an integer; r and s too (the 32 + 32 bytes of the signature).
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
