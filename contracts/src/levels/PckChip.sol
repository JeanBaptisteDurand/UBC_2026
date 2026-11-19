// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibString} from "solady/utils/LibString.sol";
import {Base64} from "solady/utils/Base64.sol";

/// @title PckChip — the CHIP behind a DCAP TDX quote: PPID and FMSPC read from Intel's PCK certificate
/// @notice Reads the LEAF PCK certificate of a quote EXACTLY as Automata's verifier deployed on Arc does
///         (V4QuoteVerifier / V5QuoteVerifier._parseAuthData, then X509ChainBase._splitCertificateChain: the first
///         "-----BEGIN CERTIFICATE-----", the first "-----END CERTIFICATE-----", line breaks removed, solady 0.0.160's
///         Base64, the version compiled into that verifier), then reads Intel's SGX extension in it:
///           - PPID  (OID 1.2.840.113741.1.13.1.1): identifier of the platform (the machine), 16 bytes;
///           - FMSPC (OID 1.2.840.113741.1.13.1.4): platform family, 6 bytes.
///         The certificate is the one Intel signed for THIS machine; Automata verified its chain up to Intel's root
///         when the quote was verified.
/// @dev    NO signature is verified here: the quote must be an ALREADY verified quote, for example the one the
///         EnclaveRegistry verified at registration (keccak256(quote) = Enclave.quoteHash). The caller cross-checks
///         the FMSPC read here with the one Automata extracted (Enclave.fmspc): both reads then concern the same
///         certificate.
///         VERIFIED on the registration quotes of our 4 enclaves (TDX v4, certification 6 then 5, issuer
///         "Intel SGX PCK Platform CA"): a single PPID OID in the certificate, the same PPID for all 4 (same machine).
library PckChip {
    /// @notice Quote too short, or inconsistent sizes.
    error QuoteFormat();
    /// @notice Not a TDX v4/v5 quote with certification type 6 (QE report) then 5 (PEM chain).
    error QuoteUnsupported();
    /// @notice PEM chain not found, or unexpected SGX extension in the certificate.
    error PckFormat();

    uint256 private constant HEADER = 48;
    uint256 private constant TD10 = 584;
    uint256 private constant TD15 = 648;
    uint256 private constant TDX = 0x81;

    /// @dev DER TLV: 06 0A + the 10 bytes of the OID.
    bytes12 private constant OID_PPID = 0x060a2a864886f84d010d0101;
    bytes12 private constant OID_FMSPC = 0x060a2a864886f84d010d0104;

    /// @notice PPID and FMSPC of the machine that produced `quote` (read from its leaf PCK certificate).
    function chipOf(bytes calldata quote) internal pure returns (bytes16 ppid, bytes6 fmspc) {
        bytes memory der = leafPck(quote);
        // SEQUENCE { OID ppid, OCTET STRING (16 bytes) }: 30 1E | 06 0A … | 04 10 | ppid
        uint256 i = _findOnce(der, OID_PPID);
        if (
            i < 2 || uint8(der[i - 2]) != 0x30 || uint8(der[i - 1]) != 0x1e || der.length < i + 30
                || uint8(der[i + 12]) != 0x04 || uint8(der[i + 13]) != 0x10
        ) revert PckFormat();
        // SEQUENCE { OID fmspc, OCTET STRING (6 bytes) }: 30 14 | 06 0A … | 04 06 | fmspc
        uint256 j = _findOnce(der, OID_FMSPC);
        if (
            j < 2 || uint8(der[j - 2]) != 0x30 || uint8(der[j - 1]) != 0x14 || der.length < j + 20
                || uint8(der[j + 12]) != 0x04 || uint8(der[j + 13]) != 0x06
        ) revert PckFormat();
        assembly ("memory-safe") {
            // a bytesN fits in the N LEADING bytes of the word; the tail must be zero (masked)
            ppid := and(mload(add(add(der, 32), add(i, 14))), not(sub(shl(128, 1), 1)))
            fmspc := and(mload(add(add(der, 32), add(j, 14))), not(sub(shl(208, 1), 1)))
        }
        if (ppid == bytes16(0)) revert PckFormat();
    }

    /// @notice The leaf PCK certificate (DER) of the quote, split and decoded as Automata does.
    function leafPck(bytes calldata quote) internal pure returns (bytes memory der) {
        uint256 version = _le(quote, 0, 2);
        if (_le(quote, 4, 4) != TDX) revert QuoteUnsupported();
        uint256 offset;
        if (version == 4) {
            offset = HEADER + TD10;
        } else if (version == 5) {
            uint256 bodyType = _le(quote, HEADER, 2);
            uint256 bodySize = _le(quote, HEADER + 2, 4);
            if (!((bodyType == 2 && bodySize == TD10) || (bodyType == 3 && bodySize == TD15))) revert QuoteUnsupported();
            offset = HEADER + 6 + bodySize;
        } else {
            revert QuoteUnsupported();
        }
        uint256 authSize = _le(quote, offset, 4);
        offset += 4;
        if (quote.length < offset + authSize) revert QuoteFormat();
        bytes calldata a = quote[offset:offset + authSize];

        // authentication data: signature (64), attestation key (64), certification type (2) = 6, size (4),
        // QE report (384), report signature (64), size of the QE auth data (2) + data, then the
        // PCK certification: type (2) = 5, size (4), PEM chain
        if (_le(a, 128, 2) != 6) revert QuoteUnsupported();
        uint256 qeCertSize = _le(a, 130, 4);
        uint256 o = 584 + _le(a, 582, 2);
        if (_le(a, o, 2) != 5) revert QuoteUnsupported();
        uint256 certSize = _le(a, o + 2, 4);
        o += 6;
        if (a.length < o + certSize) revert QuoteFormat();
        if (o + certSize - 134 != qeCertSize) revert QuoteFormat(); // the same consistency check as Automata

        string memory pem = string(a[o:o + certSize]);
        uint256 b = LibString.indexOf(pem, "-----BEGIN CERTIFICATE-----");
        uint256 e = LibString.indexOf(pem, "-----END CERTIFICATE-----");
        if (b == LibString.NOT_FOUND || e == LibString.NOT_FOUND || e < b + 27) revert PckFormat();
        string[] memory lines = LibString.split(LibString.slice(pem, b + 27, e), string(hex"0a"));
        string memory body;
        for (uint256 k = 0; k < lines.length; k++) {
            body = LibString.concat(body, lines[k]);
        }
        // HARDENING: the Base64 body is covered by NO signature, and solady's Base64.decode does not reject
        // characters outside the alphabet (it then reads memory), so two contracts can decode the SAME PEM
        // differently. A canonical standard Base64 is required: the decoding becomes unique, equal to the one
        // Automata did. Then exactly ONE certificate is required, with no extra byte. Without these two checks, an
        // operator could make the contract read another PPID than the certificate's (the chip of a known datacenter).
        if (!_isCanonicalBase64(bytes(body))) revert PckFormat();
        der = Base64.decode(body);
        _requireSingleDerSequence(der);
    }

    /// @dev CANONICAL standard Base64: alphabet [A-Za-z0-9+/], length a multiple of 4, '=' only at the end (at most
    ///      2), nothing after the padding. Under this condition, solady's Base64.decode gives a unique decoding (no
    ///      read of undetermined memory), hence identical to that of any correct decoder.
    function _isCanonicalBase64(bytes memory s) private pure returns (bool) {
        uint256 n = s.length;
        if (n == 0 || n % 4 != 0) return false;
        uint256 pad;
        for (uint256 k = 0; k < n; k++) {
            uint8 c = uint8(s[k]);
            if (
                (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2b
                    || c == 0x2f
            ) {
                if (pad != 0) return false; // data after a '='
            } else if (c == 0x3d) {
                pad++;
                if (pad > 2 || k < n - 2) return false; // '=' only in the last two bytes
            } else {
                return false; // outside the alphabet: exactly what solady does not reject
            }
        }
        return true;
    }

    /// @dev The decoded DER must be EXACTLY one SEQUENCE (one certificate), with no extra byte: length in minimal form,
    ///      header + content = total size. Forbids appending a second "PPID OID" after the real one.
    function _requireSingleDerSequence(bytes memory der) private pure {
        uint256 n = der.length;
        if (n < 2 || uint8(der[0]) != 0x30) revert PckFormat();
        uint8 l0 = uint8(der[1]);
        uint256 hdr;
        uint256 len;
        if (l0 < 0x80) {
            hdr = 2;
            len = l0;
        } else {
            uint256 nb = l0 - 0x80;
            if (nb == 0 || nb > 4 || n < 2 + nb) revert PckFormat();
            if (uint8(der[2]) == 0) revert PckFormat(); // minimal DER form (no leading zero)
            for (uint256 k = 0; k < nb; k++) {
                len = (len << 8) | uint8(der[2 + k]);
            }
            if (len < 0x80) revert PckFormat(); // should have fit in the short form
            hdr = 2 + nb;
        }
        if (hdr + len != n) revert PckFormat();
    }

    /// @dev Little-endian integer of `n` bytes at `o`.
    function _le(bytes calldata b, uint256 o, uint256 n) private pure returns (uint256 v) {
        if (b.length < o + n) revert QuoteFormat();
        for (uint256 k = 0; k < n; k++) {
            v |= uint256(uint8(b[o + k])) << (8 * k);
        }
    }

    /// @dev Position of the ONLY occurrence of `pat` (12 bytes) in `der`; none or several: PckFormat.
    function _findOnce(bytes memory der, bytes12 pat) private pure returns (uint256 at) {
        uint256 n = der.length;
        if (n < 12) revert PckFormat();
        uint256 found;
        bytes32 want = bytes32(pat);
        bytes32 mask = bytes32(type(uint256).max << 160); // the 12 leading bytes
        for (uint256 k = 0; k + 12 <= n; k++) {
            bytes32 w;
            assembly ("memory-safe") {
                w := mload(add(add(der, 32), k))
            }
            if (w & mask == want) {
                at = k;
                found++;
            }
        }
        if (found != 1) revert PckFormat();
    }
}
