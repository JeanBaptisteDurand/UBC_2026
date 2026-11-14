// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAttestationModule} from "../interfaces/IAttestationModule.sol";
import {IAutomataDcap} from "../interfaces/IAutomataDcap.sol";

/// @title TdxAttestationModule (SPEC-TECH §C2)
/// @notice Appelle le vérificateur DCAP d'Automata (C1) puis découpe le corps du quote TDX.
///         Format de sortie VERIFIED dans QuoteVerifierBase.serializeOutput d'Automata :
///           [0:2]  quoteVersion (BE)
///           [2:4]  quoteBodyType (BE) : 1 = SGX, 2 = TD1.0, 3 = TD1.5
///           [4]    tcbStatus
///           [5:11] fmspc (6 octets)
///           [11:11+bodyLen] corps du quote (TD10 = 584, TD15 = 648)
///           [11+bodyLen:]   abi.encode(string[] advisoryIDs) si présent
///         Décalages du corps TD10/TD15 (identiques sur les 584 premiers octets), Intel V4 TDX :
///           tdAttributes 120, xfam 128, mrTd 136, mrConfigId 184,
///           rtmr0 328, rtmr1 376, rtmr2 424, rtmr3 472, reportData 520.
contract TdxAttestationModule is IAttestationModule {
    IAutomataDcap public immutable dcap;

    uint256 private constant HDR = 11; // version(2)+bodyType(2)+tcb(1)+fmspc(6)
    uint256 private constant TD10_LEN = 584;
    uint256 private constant TD15_LEN = 648;

    // décalages dans le corps
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
        // On ne transmet pas de valeur : notre déploiement Automata est configuré sans frais (fee bps = 0).
        (bool ok, bytes memory out) = dcap.verifyAndAttestOnChain(quote);
        m.ok = ok;
        if (!ok) {
            // `out` est alors la raison d'échec en UTF-8 ; la politique (C2) refusera sur m.ok == false.
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
            // SGX ou type inconnu : pas de corps TD à lire ; la politique (P1) refusera NotTdx.
            return m;
        }
        require(out.length >= HDR + bodyLen, "DCAP:body");

        // le corps commence à HDR dans `out`
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

        // advisoryIDs éventuels, abi.encode(string[]) collé après le corps
        uint256 advStart = HDR + bodyLen;
        if (out.length > advStart) {
            bytes memory advBytes = _slice(out, advStart, out.length - advStart);
            m.advisories = abi.decode(advBytes, (string[]));
        }
    }

    // ---- lecture mémoire ----

    /// @dev Charge 32 octets de `data` à partir de `offset` (comme data[offset:offset+32], big-endian).
    function _word(bytes memory data, uint256 offset) private pure returns (bytes32 w) {
        assembly {
            w := mload(add(add(data, 0x20), offset))
        }
    }

    /// @dev Copie `len` octets de `data` à partir de `start`. `len` est un multiple de 32 ici (48→64, 64).
    function _slice(bytes memory data, uint256 start, uint256 len) private pure returns (bytes memory r) {
        r = new bytes(len);
        assembly {
            let src := add(add(data, 0x20), start)
            let dst := add(r, 0x20)
            for { let i := 0 } lt(i, len) { i := add(i, 0x20) } { mstore(add(dst, i), mload(add(src, i))) }
        }
    }
}
