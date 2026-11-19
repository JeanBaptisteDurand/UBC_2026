// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IUSDC} from "../interfaces/IERC3009.sol";

/// @title UsdcPayer — base commune pour encaisser de l'USDC
/// @notice Deux chemins : EIP-3009 `receiveWithAuthorization` (signature, un seul appel) ou
///         `transferFrom` classique (après `approve`). Le destinataire est toujours ce contrat,
///         donc `to == msg.sender` est respecté (condition d'Arc, VERIFIED).
abstract contract UsdcPayer {
    IUSDC public immutable usdc;

    /// @dev Les champs d'une autorisation EIP-3009 (la valeur et `from` sont passés à part).
    struct Auth {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        bytes signature;
    }

    constructor(address _usdc) {
        usdc = IUSDC(_usdc);
    }

    /// @dev Encaisse `value` depuis `from` par signature EIP-3009 (version `bytes`).
    function _pullWithAuth(address from, uint256 value, Auth calldata a) internal {
        usdc.receiveWithAuthorization(from, address(this), value, a.validAfter, a.validBefore, a.nonce, a.signature);
    }

    /// @dev Encaisse `value` depuis `from` par `transferFrom` (nécessite une allocation préalable).
    function _pullWithAllowance(address from, uint256 value) internal {
        require(usdc.transferFrom(from, address(this), value), "usdc:transferFrom");
    }

    function _payOut(address to, uint256 value) internal {
        if (value == 0) return;
        require(usdc.transfer(to, value), "usdc:transfer");
    }
}
