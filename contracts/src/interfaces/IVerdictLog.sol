// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IVerdictLog — writes each verified verdict to the ERC-8004 registry
interface IVerdictLog {
    /// @param response 100 = verified and paid; 0 = slashed fault
    /// @param tag      "tdx-dcap/inference" | "tdx-dcap/sealed-bounty" | "tdx-dcap/slash"
    function record(
        uint256 agentId,
        bytes32 requestHash,
        string calldata requestURI,
        bytes32 responseHash,
        string calldata responseURI,
        uint8 response,
        string calldata tag
    ) external;
}
