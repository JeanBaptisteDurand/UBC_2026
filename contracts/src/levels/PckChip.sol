// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibString} from "solady/utils/LibString.sol";
import {Base64} from "solady/utils/Base64.sol";

/// @title PckChip — la PUCE derrière un quote DCAP TDX : PPID et FMSPC lus dans le certificat PCK d'Intel (10/11/2026)
/// @notice Lit le certificat PCK FEUILLE d'un quote EXACTEMENT comme le vérificateur d'Automata déployé sur Arc
///         (V4QuoteVerifier / V5QuoteVerifier._parseAuthData, puis X509ChainBase._splitCertificateChain : premier
///         « -----BEGIN CERTIFICATE----- », premier « -----END CERTIFICATE----- », sauts de ligne retirés, Base64 de solady
///         0.0.160, la version compilée dans ce vérificateur), puis y lit l'extension SGX d'Intel :
///           - PPID  (OID 1.2.840.113741.1.13.1.1) : identifiant de la plate-forme (de la machine), 16 octets ;
///           - FMSPC (OID 1.2.840.113741.1.13.1.4) : famille de plate-forme, 6 octets.
///         Le certificat est celui qu'Intel a signé pour CETTE machine ; Automata a vérifié sa chaîne jusqu'à la racine
///         d'Intel quand le quote a été vérifié.
/// @dev    AUCUNE signature n'est vérifiée ici : le quote doit être un quote DÉJÀ vérifié, par exemple celui qu'a vérifié
///         l'EnclaveRegistry à l'inscription (keccak256(quote) = Enclave.quoteHash). L'appelant recoupe le FMSPC lu ici avec
///         celui qu'a extrait Automata (Enclave.fmspc) : les deux lectures portent alors sur le même certificat.
///         VÉRIFIÉ le 10/11 sur les quotes d'inscription de nos 4 enclaves (TDX v4, certification 6 → 5, émetteur
///         « Intel SGX PCK Platform CA ») : un seul OID PPID dans le certificat, le même PPID pour les 4 (même machine).
library PckChip {
    /// @notice Quote trop court, ou tailles incohérentes.
    error QuoteFormat();
    /// @notice Pas un quote TDX v4/v5 avec certification de type 6 (rapport du QE) puis 5 (chaîne PEM).
    error QuoteUnsupported();
    /// @notice Chaîne PEM introuvable, ou extension SGX inattendue dans le certificat.
    error PckFormat();

    uint256 private constant HEADER = 48;
    uint256 private constant TD10 = 584;
    uint256 private constant TD15 = 648;
    uint256 private constant TDX = 0x81;

    /// @dev TLV DER : 06 0A + les 10 octets de l'OID.
    bytes12 private constant OID_PPID = 0x060a2a864886f84d010d0101;
    bytes12 private constant OID_FMSPC = 0x060a2a864886f84d010d0104;

    /// @notice PPID et FMSPC de la machine qui a produit `quote` (lus dans son certificat PCK feuille).
    function chipOf(bytes calldata quote) internal pure returns (bytes16 ppid, bytes6 fmspc) {
        bytes memory der = leafPck(quote);
        // SEQUENCE { OID ppid, OCTET STRING (16 octets) } : 30 1E | 06 0A … | 04 10 | ppid
        uint256 i = _findOnce(der, OID_PPID);
        if (
            i < 2 || uint8(der[i - 2]) != 0x30 || uint8(der[i - 1]) != 0x1e || der.length < i + 30
                || uint8(der[i + 12]) != 0x04 || uint8(der[i + 13]) != 0x10
        ) revert PckFormat();
        // SEQUENCE { OID fmspc, OCTET STRING (6 octets) } : 30 14 | 06 0A … | 04 06 | fmspc
        uint256 j = _findOnce(der, OID_FMSPC);
        if (
            j < 2 || uint8(der[j - 2]) != 0x30 || uint8(der[j - 1]) != 0x14 || der.length < j + 20
                || uint8(der[j + 12]) != 0x04 || uint8(der[j + 13]) != 0x06
        ) revert PckFormat();
        assembly ("memory-safe") {
            // un bytesN tient dans les N octets de TÊTE du mot ; la queue doit être nulle (masquée)
            ppid := and(mload(add(add(der, 32), add(i, 14))), not(sub(shl(128, 1), 1)))
            fmspc := and(mload(add(add(der, 32), add(j, 14))), not(sub(shl(208, 1), 1)))
        }
        if (ppid == bytes16(0)) revert PckFormat();
    }

    /// @notice Le certificat PCK feuille (DER) du quote, découpé et décodé comme le fait Automata.
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

        // données d'authentification : signature (64), clé d'attestation (64), type de certification (2) = 6, taille (4),
        // rapport du QE (384), signature du rapport (64), taille des données d'auth. du QE (2) + données, puis la
        // certification du PCK : type (2) = 5, taille (4), chaîne PEM
        if (_le(a, 128, 2) != 6) revert QuoteUnsupported();
        uint256 qeCertSize = _le(a, 130, 4);
        uint256 o = 584 + _le(a, 582, 2);
        if (_le(a, o, 2) != 5) revert QuoteUnsupported();
        uint256 certSize = _le(a, o + 2, 4);
        o += 6;
        if (a.length < o + certSize) revert QuoteFormat();
        if (o + certSize - 134 != qeCertSize) revert QuoteFormat(); // même contrôle de cohérence qu'Automata

        string memory pem = string(a[o:o + certSize]);
        uint256 b = LibString.indexOf(pem, "-----BEGIN CERTIFICATE-----");
        uint256 e = LibString.indexOf(pem, "-----END CERTIFICATE-----");
        if (b == LibString.NOT_FOUND || e == LibString.NOT_FOUND || e < b + 27) revert PckFormat();
        string[] memory lines = LibString.split(LibString.slice(pem, b + 27, e), string(hex"0a"));
        string memory body;
        for (uint256 k = 0; k < lines.length; k++) {
            body = LibString.concat(body, lines[k]);
        }
        // DURCISSEMENT (11/11) : le corps Base64 n'est couvert par AUCUNE signature, et Base64.decode de solady ne
        // rejette pas les caractères hors alphabet (il lit alors la mémoire), donc deux contrats peuvent décoder le
        // MÊME PEM différemment. On exige un Base64 standard canonique : le décodage devient unique, égal à celui
        // qu'a fait Automata. Puis on exige UN SEUL certificat, sans octet ajouté. Sans ces deux contrôles, un
        // opérateur pourrait faire lire au contrat un autre PPID que celui du certificat (la puce d'un datacenter connu).
        if (!_isCanonicalBase64(bytes(body))) revert PckFormat();
        der = Base64.decode(body);
        _requireSingleDerSequence(der);
    }

    /// @dev Base64 standard CANONIQUE : alphabet [A-Za-z0-9+/], longueur multiple de 4, '=' seulement en fin (au
    ///      plus 2), rien après le padding. Sous cette condition, Base64.decode de solady rend le décodage unique
    ///      (aucune lecture de mémoire indéterminée), donc identique à celui de n'importe quel décodeur correct.
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
                if (pad != 0) return false; // donnée après un '='
            } else if (c == 0x3d) {
                pad++;
                if (pad > 2 || k < n - 2) return false; // '=' seulement dans les deux derniers octets
            } else {
                return false; // hors alphabet : c'est exactement ce que solady ne rejette pas
            }
        }
        return true;
    }

    /// @dev Le DER décodé doit être EXACTEMENT une SEQUENCE (un certificat), sans octet en trop : longueur en forme
    ///      minimale, en-tête + contenu = taille totale. Interdit de coller un second « OID PPID » après le vrai.
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
            if (uint8(der[2]) == 0) revert PckFormat(); // forme minimale DER (pas de zéro de tête)
            for (uint256 k = 0; k < nb; k++) {
                len = (len << 8) | uint8(der[2 + k]);
            }
            if (len < 0x80) revert PckFormat(); // aurait dû tenir en forme courte
            hdr = 2 + nb;
        }
        if (hdr + len != n) revert PckFormat();
    }

    /// @dev Entier petit-boutiste de `n` octets à `o`.
    function _le(bytes calldata b, uint256 o, uint256 n) private pure returns (uint256 v) {
        if (b.length < o + n) revert QuoteFormat();
        for (uint256 k = 0; k < n; k++) {
            v |= uint256(uint8(b[o + k])) << (8 * k);
        }
    }

    /// @dev Position de la SEULE occurrence de `pat` (12 octets) dans `der` ; zéro ou plusieurs : PckFormat.
    function _findOnce(bytes memory der, bytes12 pat) private pure returns (uint256 at) {
        uint256 n = der.length;
        if (n < 12) revert PckFormat();
        uint256 found;
        bytes32 want = bytes32(pat);
        bytes32 mask = bytes32(type(uint256).max << 160); // les 12 octets de tête
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
