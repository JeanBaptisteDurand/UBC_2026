// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IAttestationModule — a replaceable attestation module
/// @notice Today TDX/DCAP (Automata). Tomorrow Nitro or SEV-SNP, without touching the products.
///         The module verifies a quote with the third-party verifier, then parses the body and returns normalized
///         measurements. ALL of the refusal policy lives in the EnclaveRegistry, not here: the module only verifies
///         and measures.
interface IAttestationModule {
    /// @dev Normalized measurements returned by the module.
    ///      The 48-byte fields (mrtd, rtmr*, mrConfigId) are `bytes`, for the workloadId concatenation.
    struct Measurements {
        bool ok; // success of the third-party verification
        uint16 version; // 4 or 5
        uint16 bodyType; // TD10 (=2) or TD15 (=3)
        uint8 tcbStatus; // 0 = OK ... 6 = REVOKED, 7 = UNRECOGNIZED (Automata's enum)
        bytes6 fmspc;
        bytes reportData; // 64 bytes
        bytes mrtd; // 48 bytes
        bytes rtmr0; // 48 bytes
        bytes rtmr1; // 48 bytes
        bytes rtmr2; // 48 bytes
        bytes rtmr3; // 48 bytes
        bytes mrConfigId; // 48 bytes
        bytes8 xfam;
        bytes8 tdAttributes;
        string[] advisories; // Intel advisory IDs (for the product's allowlist)
    }

    /// @param quote    the raw DCAP quote (output of the enclave's GetQuote)
    /// @param eventLog the RTMR event log (empty if RTMR3 is pinned)
    /// @dev Not `view`: the third-party verifier (Automata) is `payable` and reads the PCCS state, so it is called with
    ///      CALL. The calling paths (registerEnclave, invalidate) already change state.
    function verify(bytes calldata quote, bytes calldata eventLog)
        external
        returns (Measurements memory m);
}
