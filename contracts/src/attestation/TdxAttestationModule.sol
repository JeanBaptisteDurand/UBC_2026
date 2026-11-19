// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAttestationModule} from "../interfaces/IAttestationModule.sol";
import {IAutomataDcap} from "../interfaces/IAutomataDcap.sol";

/// @title TdxAttestationModule
/// @notice Calls Automata's DCAP verifier, then parses the body of the TDX quote.
///         Output format, VERIFIED in Automata's QuoteVerifierBase.serializeOutput:
///           [0:2]  quoteVersion (BE)
///           [2:4]  quoteBodyType (BE): 1 = SGX, 2 = TD1.0, 3 = TD1.5
///           [4]    tcbStatus
///           [5:11] fmspc (6 bytes)
///           [11:11+bodyLen] quote body (TD10 = 584, TD15 = 648)
///           [11+bodyLen:]   abi.encode(string[] advisoryIDs) if present
///         Offsets in the TD10/TD15 body (identical over the first 584 bytes), Intel V4 TDX:
///           tdAttributes 120, xfam 128, mrTd 136, mrConfigId 184,
///           rtmr0 328, rtmr1 376, rtmr2 424, rtmr3 472, reportData 520.
contract TdxAttestationModule is IAttestationModule {
    IAutomataDcap public immutable dcap;

    uint256 private constant HDR = 11; // version(2)+bodyType(2)+tcb(1)+fmspc(6)
    uint256 private constant TD10_LEN = 584;
    uint256 private constant TD15_LEN = 648;

    // offsets in the body
    uint256 private constant O_TDATTR = 120;
    uint256 private constant O_XFAM = 128;
    uint256 private constant O_MRTD = 136;
    uint256 private constant O_MRCONFIGID = 184;
    uint256 private constant O_RTMR0 = 328;
    uint256 private constant O_RTMR1 = 376;
    uint256 private constant O_RTMR2 = 424;
    uint256 private constant O_RTMR3 = 472;
    uint256 private constant O_REPORTDATA = 520;

    constructor(address _dcap) {
        dcap = IAutomataDcap(_dcap);
    }

    /// @inheritdoc IAttestationModule
    function verify(bytes calldata quote, bytes calldata /* eventLog */ )
        external
        override
        returns (Measurements memory m)
    {
        // No value is sent: our Automata deployment is configured without fees (fee bps = 0).
        (bool ok, bytes memory out) = dcap.verifyAndAttestOnChain(quote);
        m.ok = ok;
        if (!ok) {
            // `out` is then the failure reason in UTF-8; the registry's policy refuses it on m.ok == false.
            return m;
        }
        require(out.length >= HDR, "DCAP:short");

        m.version = uint16(bytes2(_word(out, 0)));
        m.bodyType = uint16(bytes2(_word(out, 2)));
        m.tcbStatus = uint8(out[4]);
        m.fmspc = bytes6(_word(out, 5));

        uint256 bodyLen;
        if (m.bodyType == 2) bodyLen = TD10_LEN;
        else if (m.bodyType == 3) bodyLen = TD15_LEN;
        else {
            // SGX or unknown type: no TD body to read; the registry's policy refuses it with NotTdx.
            return m;
        }
        require(out.length >= HDR + bodyLen, "DCAP:body");

        // the body starts at HDR in `out`
        uint256 b = HDR;
        m.tdAttributes = bytes8(_word(out, b + O_TDATTR));
        m.xfam = bytes8(_word(out, b + O_XFAM));
        m.mrtd = _slice(out, b + O_MRTD, 48);
        m.mrConfigId = _slice(out, b + O_MRCONFIGID, 48);
        m.rtmr0 = _slice(out, b + O_RTMR0, 48);
        m.rtmr1 = _slice(out, b + O_RTMR1, 48);
        m.rtmr2 = _slice(out, b + O_RTMR2, 48);
        m.rtmr3 = _slice(out, b + O_RTMR3, 48);
        m.reportData = _slice(out, b + O_REPORTDATA, 64);

        // optional advisoryIDs, abi.encode(string[]) appended after the body
        uint256 advStart = HDR + bodyLen;
        if (out.length > advStart) {
            bytes memory advBytes = _slice(out, advStart, out.length - advStart);
            m.advisories = abi.decode(advBytes, (string[]));
        }
    }

    // ---- memory reads ----

    /// @dev Loads 32 bytes of `data` from `offset` (like data[offset:offset+32], big-endian).
    function _word(bytes memory data, uint256 offset) private pure returns (bytes32 w) {
        assembly {
            w := mload(add(add(data, 0x20), offset))
        }
    }

    /// @dev Copies `len` bytes of `data` from `start`. `len` is a multiple of 32 here (48 -> 64, 64).
    function _slice(bytes memory data, uint256 start, uint256 len) private pure returns (bytes memory r) {
        r = new bytes(len);
        assembly {
            let src := add(add(data, 0x20), start)
            let dst := add(r, 0x20)
            for { let i := 0 } lt(i, len) { i := add(i, 0x20) } { mstore(add(dst, i), mload(add(src, i))) }
        }
    }
}
