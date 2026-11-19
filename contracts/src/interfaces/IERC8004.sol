// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ERC-8004 v2.0.0 — registres de Circle sur Arc
/// @notice Adresses VERIFIED :
///  mainnet  Identité 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
///           Réputation 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
///           Validation 0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58
///  testnet  Identité 0x8004A818BFB912233c491871b3d84c89A494BD9e
///           Réputation 0x8004B663056A597Dffe9eCcC1965A193B7388713
///           Validation 0x8004Cb1BF31DAf7788923b405b754f57acEB4272

/// @dev Registre d'identité (jeton d'agent, façon ERC-721).
interface IIdentityRegistry {
    /// selector 0xf2c298be
    function register(string calldata agentURI) external returns (uint256 agentId);
    function ownerOf(uint256 agentId) external view returns (address);
    function setApprovalForAll(address operator, bool approved) external;
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

/// @dev Registre de validation : le demandeur nomme un validateur, seul ce validateur répond.
interface IValidationRegistry {
    /// selector 0xaaf400c4
    function validationRequest(
        address validator,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external;

    /// selector 0x3d659a96
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external;
}
