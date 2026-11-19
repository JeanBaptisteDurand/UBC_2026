// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IIdentityRegistry} from "../../src/interfaces/IERC8004.sol";

/// @notice FAITHFUL model of Circle's ERC-8004 validation registry (ValidationRegistryUpgradeable 2.0.0, reference
///         code of erc-8004-contracts; "exists" confirmed on the Arc testnet registry during the adversarial review):
///         - ONE requestHash space for everyone: "exists" whatever the agent or the caller;
///         - the request is reserved to the agent's owner or an approved address (ownerOf of an unknown agent reverts, as in
///           ERC-721); the response to the named validator (several responses possible); response ≤ 100.
///         MockValidationRegistry has neither: it could not see a requestHash being preempted.
///         Installed by vm.etch at the address of the test registry (the immutable `identity` is in the code).
contract StrictValidationRegistry {
    struct Status {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool hasResponse;
    }

    IIdentityRegistry public immutable identity;
    mapping(bytes32 => Status) internal _v;
    mapping(uint256 => bytes32[]) internal _agentValidations;
    mapping(address => bytes32[]) internal _validatorRequests;

    error ERC721NonexistentToken(uint256 tokenId);

    constructor(IIdentityRegistry identity_) {
        identity = identity_;
    }

    function validationRequest(address validatorAddress, uint256 agentId, string calldata, bytes32 requestHash)
        external
    {
        require(validatorAddress != address(0), "bad validator");
        require(_v[requestHash].validatorAddress == address(0), "exists");
        address owner = identity.ownerOf(agentId);
        if (owner == address(0)) revert ERC721NonexistentToken(agentId);
        require(msg.sender == owner || identity.isApprovedForAll(owner, msg.sender), "Not authorized");
        _v[requestHash] = Status(validatorAddress, agentId, 0, bytes32(0), "", block.timestamp, false);
        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);
    }

    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata,
        bytes32 responseHash,
        string calldata tag
    ) external {
        Status storage s = _v[requestHash];
        require(s.validatorAddress != address(0), "unknown");
        require(msg.sender == s.validatorAddress, "not validator");
        require(response <= 100, "resp>100");
        s.response = response;
        s.responseHash = responseHash;
        s.tag = tag;
        s.lastUpdate = block.timestamp;
        s.hasResponse = true;
    }

    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address, uint256, uint8, bytes32, string memory, uint256)
    {
        Status memory s = _v[requestHash];
        require(s.validatorAddress != address(0), "unknown");
        return (s.validatorAddress, s.agentId, s.response, s.responseHash, s.tag, s.lastUpdate);
    }

    /// @dev Test read, with no revert for a free hash.
    function statusOf(bytes32 requestHash)
        external
        view
        returns (address validator, uint256 agentId, uint8 response, bool hasResponse)
    {
        Status storage s = _v[requestHash];
        return (s.validatorAddress, s.agentId, s.response, s.hasResponse);
    }

    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }
}

/// @notice Hostile or buggy ERC-8004 registry (upgraded UUPS proxy, compromised key, bug): every call reverts with
///         data whose copy into memory costs ≈ 40 % of the gas received (w words: 3w + w²/512 ≈ c, so w ≈ √(512·c)).
///         A caller that copies the WHOLE revert (catch (bytes memory reason)) then runs out of gas, whatever gas is
///         sent (the cost follows the gas given).
contract ReturnBombRegistry {
    fallback() external {
        assembly {
            let c := div(mul(gas(), 40), 100)
            let x := mul(512, c)
            let w := x
            let y := div(add(x, 1), 2)
            for {} lt(y, w) {} {
                w := y
                y := div(add(div(x, y), y), 2)
            }
            revert(0, mul(w, 32))
        }
    }
}

/// @notice Registry that refuses everything with a LONG Error(string) message (300 characters): the reason emitted by
///         VerdictSkipped must be truncated to 132 bytes.
contract LongReasonRegistry {
    fallback() external {
        bytes memory m = new bytes(300);
        for (uint256 i = 0; i < 300; i++) {
            m[i] = bytes1(uint8(0x41 + (i % 26)));
        }
        revert(string(m));
    }
}
