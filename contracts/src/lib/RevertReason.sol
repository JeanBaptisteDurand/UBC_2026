// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title RevertReason — the revert data of the last call, BOUNDED (v2.1b)
/// @notice `catch (bytes memory reason)` copies ALL of the callee's revert data. A hostile or buggy callee (here the
///         ERC-8004 registry behind VerdictLog, through an upgraded proxy or a compromised key) can return revert
///         data whose copy (memory, quadratic cost) exceeds the gas left to the caller, WHATEVER the gas sent: the
///         whole transaction fails (a "return bomb", found in an adversarial review: closing a session, slashing and
///         paying a bounty were blocked, while the v2 `catch {}` survived it).
///         `catch { ... RevertReason.bounded() ... }` copies only the first MAX_LENGTH bytes: an error's selector and
///         up to 4 arguments, or an Error(string) of at most 64 bytes (beyond that, the message is truncated).
library RevertReason {
    /// @notice Maximum number of bytes copied: selector + 4 words.
    uint256 internal constant MAX_LENGTH = 132;

    /// @notice The revert data of the LAST external call, truncated to MAX_LENGTH bytes. Call it at the start of a
    ///         `catch { }` block, before any other external call (which would replace the return data).
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
