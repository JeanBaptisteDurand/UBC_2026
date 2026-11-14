// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IUSDC — ERC-20 + EIP-3009 (receiveWithAuthorization, version `bytes`)
/// @notice Arc USDC vit à 0x3600000000000000000000000000000000000000, 6 décimales.
///         Le gas natif est le même USDC exprimé en 18 décimales.
///         VERIFIED (SPEC-TECH §0). Seul le destinataire peut soumettre (`to == msg.sender`).
interface IUSDC is IERC20 {
    /// @dev Variante `bytes` (FiatToken v2.2) : accepte les signatures ERC-1271 (comptes contrats)
    ///      aussi bien que les signatures ECDSA 65 octets.
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
