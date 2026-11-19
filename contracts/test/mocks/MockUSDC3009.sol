// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Test USDC: 6 decimals + EIP-3009 `receiveWithAuthorization` (`bytes` version).
contract MockUSDC3009 is ERC20, EIP712 {
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    mapping(address => mapping(bytes32 => bool)) private _authState;

    error AuthUsed();
    error AuthNotYetValid();
    error AuthExpired();
    error WrongCaller();
    error BadSignature();

    constructor() ERC20("USD Coin (mock)", "USDC") EIP712("USD Coin", "2") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authState[authorizer][nonce];
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (to != msg.sender) revert WrongCaller(); // Arc's condition
        if (block.timestamp <= validAfter) revert AuthNotYetValid();
        if (block.timestamp >= validBefore) revert AuthExpired();
        if (_authState[from][nonce]) revert AuthUsed();

        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (!SignatureChecker.isValidSignatureNow(from, digest, signature)) revert BadSignature();

        _authState[from][nonce] = true;
        _transfer(from, to, value);
    }

    /// @dev Exposed so that tests can build the digest to sign.
    function hashReceive(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce))
        );
    }
}
