// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IVerdictLog — écrit chaque verdict vérifié dans le registre ERC-8004
interface IVerdictLog {
    /// @param response 100 = vérifié et payé ; 0 = faute saisie
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
