// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IUSDC} from "../interfaces/IERC3009.sol";

/// @title UsdcPayer — shared base for collecting USDC
/// @notice Two paths: EIP-3009 `receiveWithAuthorization` (a signature, a single call) or a classic
///         `transferFrom` (after `approve`). The recipient is always this contract, so `to == msg.sender`
///         holds (an Arc requirement, VERIFIED).
abstract contract UsdcPayer {
    IUSDC public immutable usdc;

    /// @dev The fields of an EIP-3009 authorization (the value and `from` are passed separately).
    struct Auth {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        bytes signature;
    }

    constructor(address _usdc) {
        usdc = IUSDC(_usdc);
    }

    /// @dev Collects `value` from `from` with an EIP-3009 signature (`bytes` version).
    function _pullWithAuth(address from, uint256 value, Auth calldata a) internal {
        usdc.receiveWithAuthorization(from, address(this), value, a.validAfter, a.validBefore, a.nonce, a.signature);
    }

    /// @dev Collects `value` from `from` with `transferFrom` (requires a prior allowance).
    function _pullWithAllowance(address from, uint256 value) internal {
        require(usdc.transferFrom(from, address(this), value), "usdc:transferFrom");
    }

    function _payOut(address to, uint256 value) internal {
        if (value == 0) return;
        require(usdc.transfer(to, value), "usdc:transfer");
    }
}
