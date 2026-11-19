// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IAutomataDcap — the entry point of Automata's DCAP verifier (third-party code)
/// @notice MIT, deployed and configured by us (PCCS + Intel collateral).
///         Output format on success (VERIFIED in AttestationEntrypointBase):
///           abi.encodePacked(
///             uint16 quoteVersion (BE),
///             uint16 quoteBodyType (BE),
///             uint8  tcbStatus,
///             bytes6 fmspc,
///             bytes  quoteBody,                       // TD10 = 584 bytes, TD15 = 648 bytes
///             advisoryIDs.length > 0 ? abi.encode(string[] advisoryIDs) : "" )
///         On failure: `success = false` and `output` = the reason in UTF-8.
///         Automata refuses only TCB_REVOKED; it does not read tdAttributes (all of the policy is in the
///         EnclaveRegistry).
interface IAutomataDcap {
    /// @dev Picks the latest tcbEvaluationDataNumber automatically.
    function verifyAndAttestOnChain(bytes calldata rawQuote)
        external
        payable
        returns (bool success, bytes memory output);

    /// @dev Variant that sets the tcbEvaluationDataNumber (Intel's TCB evaluation number).
    function verifyAndAttestOnChain(bytes calldata rawQuote, uint32 tcbEvaluationDataNumber)
        external
        payable
        returns (bool success, bytes memory output);
}
