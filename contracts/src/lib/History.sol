// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title History — reads a block hash through the EIP-2935 history contract
/// @notice History contract at 0x0000F90827F1C53a10cb7A02335B175320002935 on Arc (VERIFIED).
///         A window of 8,191 blocks (≈ 69 min). Beyond it, the contract no longer returns the hash.
///         Call format per EIP-2935: the block number on 32 bytes as input, the hash on 32 bytes as output.
///         Encoding abi.encode(uint256), proven on Arc: every enclave registration reads its anchor block hash here.
library History {
    address internal constant HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935;
    uint256 internal constant WINDOW = 8191;

    error AnchorTooOld();
    error HistoryCallFailed();

    /// @notice Hash of block `blockNumber`. Reverts if outside the window or if the call fails.
    function blockHashAt(uint256 blockNumber) internal view returns (bytes32 h) {
        // the window requires block.number - blockNumber in [1, WINDOW]
        if (blockNumber >= block.number || block.number - blockNumber > WINDOW) {
            revert AnchorTooOld();
        }
        (bool ok, bytes memory out) = HISTORY.staticcall(abi.encode(blockNumber));
        if (!ok || out.length != 32) revert HistoryCallFailed();
        h = abi.decode(out, (bytes32));
    }

    /// @notice Variant without revert: returns (false, 0) if outside the window or if the call fails.
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
