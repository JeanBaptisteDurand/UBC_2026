// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IUSDC — ERC-20 + EIP-3009 (receiveWithAuthorization, `bytes` version)
/// @notice Arc USDC lives at 0x3600000000000000000000000000000000000000, with 6 decimals.
///         The native gas is the same USDC expressed with 18 decimals.
///         VERIFIED. Only the recipient can submit (`to == msg.sender`).
interface IUSDC is IERC20 {
    /// @dev `bytes` variant (FiatToken v2.2): accepts ERC-1271 signatures (contract accounts)
    ///      as well as 65-byte ECDSA signatures.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}
