// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibString} from "solady/utils/LibString.sol";
import {Base64} from "solady/utils/Base64.sol";
import {MachineRegistry} from "./MachineRegistry.sol";

/// @notice Ed25519Verifier (contrat autonome, Smooth CryptoLib) : ce contrat-ci n'importe pas la bibliothèque, il l'appelle.
interface IEd25519Verifier {
    function weierstrass(uint256 x, uint256 y) external view returns (uint256 wx, uint256 wy);
    function verify(string calldata m, uint256 r, uint256 s, uint256[5] calldata extKpub) external view returns (bool);
}

/// @title ProofOfCloudAuditor — un VÉRIFICATEUR sans confiance : l'alliance Proof of Cloud, vérifiée sur la chaîne (10/11/2026)
/// @notice L'alliance Proof of Cloud (Phala, Secret, Nillion, iExec, Automata, Flashbots, Oasis…) inspecte physiquement des
///         machines en datacenter et tient la liste des puces vérifiées. Ses serveurs de confiance (Secret, Nillion,
///         iExec : github.com/proofofcloud/trust-server) ne délivrent un jeton (JWT EdDSA cosigné à trois, clé commune
///         publiée) QUE pour un quote dont la machine est sur leur liste et non révoquée ; le jeton porte le PPID
///         (`machine_id`), le sha256 du quote et l'horodatage. Ce contrat vérifie la signature EdDSA de l'alliance SUR LA
///         CHAÎNE (Smooth CryptoLib, auditée), puis déclare la puce au MachineRegistry, en son propre nom : un produit qui
///         accepte CE vérificateur fait confiance à l'alliance, pas à nous ni à celui qui soumet le jeton.
///         VÉRIFIÉ le 10/11/2026 : la machine de nos enclaves (PPID 62d54040…) est sur la liste ; jeton cosigné obtenu,
///         signature valide pour la clé 5ea69fed… publiée dans proofofcloud/trust-server (public_info/public_key.txt).
/// @dev    Une déclaration vaut VALIDITY à partir de l'horodatage du jeton ; il faut soumettre un jeton récent (MAX_AGE)
///         et plus récent que le dernier. Limite (à dire) : une révocation par l'alliance n'arrive pas sur la chaîne avant
///         l'expiration de la dernière déclaration (au plus VALIDITY) ; le retrait immédiat reste à l'auteur du produit
///         (sa politique) ou aux autres vérificateurs.
contract ProofOfCloudAuditor {
    MachineRegistry public immutable machines;
    IEd25519Verifier public immutable ed25519;
    /// @notice Clé publique Ed25519 de l'alliance (32 octets, encodage RFC 8032).
    bytes32 public immutable allianceKey;
    uint256 private immutable _kx; // la même clé, forme de Weierstrass attendue par SCL_EIP6565
    uint256 private immutable _ky;

    uint64 public constant MAX_AGE = 1 days;
    uint64 public constant MAX_SKEW = 5 minutes;
    uint64 public constant VALIDITY = 7 days;

    /// @dev Corps de base Ed25519 : p = 2^255 - 19, d = -121665/121666.
    uint256 private constant P = 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed;
    uint256 private constant D = 0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3;

    /// @notice Horodatage du dernier jeton accepté pour chaque puce.
    mapping(bytes16 ppid => uint64) public lastTimestamp;

    event ProofOfCloudToken(bytes16 indexed ppid, uint64 timestamp, uint64 expiresAt, bytes32 quoteSha256, string label);

    error BadKey();
    error BadToken();
    error BadSignature();
    error StaleToken();

    /// @param _x, _y coordonnées affines (Edwards) de la clé, calculées hors chaîne ; vérifiées ici : sur la courbe, et
    ///        leur encodage RFC 8032 redonne exactement `_key`.
    constructor(address _machines, address _ed25519, bytes32 _key, uint256 _x, uint256 _y) {
        if (_x >= P || _y >= P) revert BadKey();
        // -x² + y² = 1 + d·x²·y²  (mod p)
        uint256 x2 = mulmod(_x, _x, P);
        uint256 y2 = mulmod(_y, _y, P);
        if (addmod(P - x2, y2, P) != addmod(1, mulmod(D, mulmod(x2, y2, P), P), P)) revert BadKey();
        // encodage : y sur 255 bits, bit de poids fort = parité de x, en petit-boutiste
        if (bytes32(_reverse(_y | ((_x & 1) << 255))) != _key) revert BadKey();
        machines = MachineRegistry(_machines);
        ed25519 = IEd25519Verifier(_ed25519);
        allianceKey = _key;
        (_kx, _ky) = IEd25519Verifier(_ed25519).weierstrass(_x, _y);
    }

    /// @notice Soumet un jeton de l'alliance (ses trois parties : en-tête et contenu en base64url, signature de 64 octets).
    ///         Ouvert à tous. Déclare la puce du jeton au MachineRegistry jusqu'à horodatage + VALIDITY.
    function submit(string calldata header, string calldata payload, bytes calldata signature)
        external
        returns (bytes16 ppid, uint64 expiresAt)
    {
        if (signature.length != 64 || bytes(header).length == 0 || bytes(payload).length == 0) revert BadToken();
        uint256[5] memory ext = [_kx, _ky, 0, 0, uint256(allianceKey)];
        if (
            !ed25519.verify(
                string.concat(header, ".", payload), uint256(bytes32(signature[0:32])), uint256(bytes32(signature[32:64])), ext
            )
        ) revert BadSignature();

        // le contenu est celui que l'alliance a signé : on peut le lire
        string memory json = string(Base64.decode(payload));
        ppid = bytes16(uint128(_hexField(json, '"machine_id":"', 32)));
        uint64 ts = uint64(_uintField(json, '"timestamp":'));
        if (ts > block.timestamp + MAX_SKEW || block.timestamp > ts + MAX_AGE) revert StaleToken();
        if (ts <= lastTimestamp[ppid]) revert StaleToken();
        lastTimestamp[ppid] = ts;
        expiresAt = ts + VALIDITY;
        string memory label = _stringField(json, '"label":"', 64);
        bytes32 quoteSha = bytes32(_hexField(json, '"quote_hash":"', 64));
        machines.attestMachine(
            ppid,
            expiresAt,
            string.concat("proof-of-cloud:", label),
            string.concat("proofofcloud.org trust-server JWT, sha256(quote)=", LibString.toHexStringNoPrefix(uint256(quoteSha), 32))
        );
        emit ProofOfCloudToken(ppid, ts, expiresAt, quoteSha, label);
    }

    // ---------------------------------------------------------------- lecture du contenu (JSON signé par l'alliance)

    /// @dev Position de la valeur de `key` : la clé doit apparaître exactement une fois.
    function _at(string memory json, string memory key) private pure returns (uint256) {
        uint256 i = LibString.indexOf(json, key);
        if (i == LibString.NOT_FOUND || LibString.lastIndexOf(json, key) != i) revert BadToken();
        return i + bytes(key).length;
    }

    /// @dev `n` chiffres hexadécimaux en minuscules suivis d'un guillemet.
    function _hexField(string memory json, string memory key, uint256 n) private pure returns (uint256 v) {
        bytes memory b = bytes(json);
        uint256 i = _at(json, key);
        if (b.length < i + n + 1 || b[i + n] != '"') revert BadToken();
        for (uint256 k = 0; k < n; k++) {
            uint8 c = uint8(b[i + k]);
            uint256 d;
            if (c >= 0x30 && c <= 0x39) d = c - 0x30;
            else if (c >= 0x61 && c <= 0x66) d = c - 0x57;
            else revert BadToken();
            v = (v << 4) | d;
        }
    }

    /// @dev Un entier décimal (1 à 12 chiffres).
    function _uintField(string memory json, string memory key) private pure returns (uint256 v) {
        bytes memory b = bytes(json);
        uint256 i = _at(json, key);
        uint256 k;
        for (; i + k < b.length && k <= 12; k++) {
            uint8 c = uint8(b[i + k]);
            if (c < 0x30 || c > 0x39) break;
            v = v * 10 + (c - 0x30);
        }
        if (k == 0 || k > 12) revert BadToken();
    }

    /// @dev Une chaîne sans échappement, d'au plus `max` octets.
    function _stringField(string memory json, string memory key, uint256 max) private pure returns (string memory) {
        bytes memory b = bytes(json);
        uint256 i = _at(json, key);
        uint256 k;
        while (i + k < b.length && b[i + k] != '"' && b[i + k] != "\\") {
            if (++k > max) revert BadToken();
        }
        if (i + k >= b.length || b[i + k] != '"') revert BadToken();
        return LibString.slice(json, i, i + k);
    }

    /// @dev Inverse l'ordre des 32 octets.
    function _reverse(uint256 v) private pure returns (uint256 r) {
        for (uint256 i = 0; i < 32; i++) {
            r = (r << 8) | (v & 0xff);
            v >>= 8;
        }
    }
}
