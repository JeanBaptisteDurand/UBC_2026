// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IIdentityRegistry, IValidationRegistry} from "../../src/interfaces/IERC8004.sol";

contract MockIdentityRegistry is IIdentityRegistry {
    uint256 public count;
    mapping(uint256 => address) public owners;
    mapping(address => mapping(address => bool)) public approvals;

    function register(string calldata) external override returns (uint256 agentId) {
        agentId = ++count;
        owners[agentId] = msg.sender;
    }

    function ownerOf(uint256 agentId) external view override returns (address) {
        return owners[agentId];
    }

    function setApprovalForAll(address operator, bool approved) external override {
        approvals[msg.sender][operator] = approved;
    }

    function isApprovedForAll(address owner, address operator) external view override returns (bool) {
        return approvals[owner][operator];
    }
}

contract MockValidationRegistry is IValidationRegistry {
    bool public shouldRevert;
    uint256 public requests;
    uint256 public responses;
    /// @notice Gas tests: FRESH storage slots written per response, so that a verdict costs what
    ///         it costs on Arc with Circle's real registry. Without them: VerdictLog.record ≈ 56k; with 8: ≈ 233k
    ///         (measured on Arc testnet: ≈ 238k between closeSession(3) and closeSession(13)).
    uint256 public burnSlots;
    mapping(bytes32 => mapping(uint256 => uint256)) private _burn;

    event Req(address validator, uint256 agentId, bytes32 requestHash);
    event Resp(bytes32 requestHash, uint8 response, string tag);

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function setBurnSlots(uint256 n) external {
        burnSlots = n;
    }

    function validationRequest(address validator, uint256 agentId, string calldata, bytes32 requestHash)
        external
        override
    {
        if (shouldRevert) revert("validation down");
        requests++;
        emit Req(validator, agentId, requestHash);
    }

    function validationResponse(bytes32 requestHash, uint8 response, string calldata, bytes32, string calldata tag)
        external
        override
    {
        if (shouldRevert) revert("validation down");
        for (uint256 i = 0; i < burnSlots; i++) {
            _burn[requestHash][i] = 1;
        }
        responses++;
        emit Resp(requestHash, response, tag);
    }
}
