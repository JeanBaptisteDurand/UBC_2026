// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibString} from "solady/utils/LibString.sol";
import {Base64} from "solady/utils/Base64.sol";
import {MachineRegistry} from "./MachineRegistry.sol";

/// @notice The standalone Ed25519Verifier (Smooth CryptoLib): this contract calls it and does not import the library.
interface IEd25519Verifier {
    function weierstrass(uint256 x, uint256 y) external view returns (uint256 wx, uint256 wy);
    function verify(string calldata m, uint256 r, uint256 s, uint256[5] calldata extKpub) external view returns (bool);
}

/// @title ProofOfCloudAuditor — a trustless VERIFIER: the Proof of Cloud alliance, verified on chain
/// @notice The Proof of Cloud alliance (Phala, Secret, Nillion, iExec, Automata, Flashbots, Oasis...) physically
///         inspects machines in datacenters and keeps the list of verified chips. Its trust servers (Secret, Nillion,
///         iExec: github.com/proofofcloud/trust-server) issue a token (an EdDSA JWT co-signed by all three, with a
///         published shared key) ONLY for a quote whose machine is on their list and not revoked; the token carries
///         the PPID (`machine_id`), the sha256 of the quote and the timestamp. This contract verifies the alliance's
///         EdDSA signature ON CHAIN (Smooth CryptoLib, audited), then declares the chip to the MachineRegistry, in its
///         own name: a product that accepts THIS verifier trusts the alliance, not us and not whoever submits the
///         token.
///         VERIFIED: the machine of our enclaves (PPID 62d54040…) is on the list; a co-signed token was obtained, with
///         a valid signature for the key 5ea69fed… published in proofofcloud/trust-server (public_info/public_key.txt).
/// @dev    A declaration is valid for VALIDITY from the token's timestamp; the token submitted must be recent (MAX_AGE)
///         and more recent than the last one. Known limit: a revocation by the alliance does not reach the chain
///         before the last declaration expires (at most VALIDITY); immediate withdrawal is left to the product's
///         author (its policy) or to the other verifiers.
contract ProofOfCloudAuditor {
    MachineRegistry public immutable machines;
    IEd25519Verifier public immutable ed25519;
    /// @notice Ed25519 public key of the alliance (32 bytes, RFC 8032 encoding).
    bytes32 public immutable allianceKey;
    uint256 private immutable _kx; // the same key, in the Weierstrass form expected by SCL_EIP6565
    uint256 private immutable _ky;

    uint64 public constant MAX_AGE = 1 days;
    uint64 public constant MAX_SKEW = 5 minutes;
    uint64 public constant VALIDITY = 7 days;

    /// @dev Ed25519 base field: p = 2^255 - 19, d = -121665/121666.
    uint256 private constant P = 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed;
    uint256 private constant D = 0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3;

    /// @notice Timestamp of the last token accepted for each chip.
    mapping(bytes16 ppid => uint64) public lastTimestamp;

    event ProofOfCloudToken(bytes16 indexed ppid, uint64 timestamp, uint64 expiresAt, bytes32 quoteSha256, string label);

    error BadKey();
    error BadToken();
    error BadSignature();
    error StaleToken();

    /// @param _x, _y affine (Edwards) coordinates of the key, computed off chain; checked here: on the curve, and their
    ///        RFC 8032 encoding gives back exactly `_key`.
    constructor(address _machines, address _ed25519, bytes32 _key, uint256 _x, uint256 _y) {
        if (_x >= P || _y >= P) revert BadKey();
        // -x² + y² = 1 + d·x²·y²  (mod p)
        uint256 x2 = mulmod(_x, _x, P);
        uint256 y2 = mulmod(_y, _y, P);
        if (addmod(P - x2, y2, P) != addmod(1, mulmod(D, mulmod(x2, y2, P), P), P)) revert BadKey();
        // encoding: y on 255 bits, most significant bit = parity of x, little-endian
        if (bytes32(_reverse(_y | ((_x & 1) << 255))) != _key) revert BadKey();
        machines = MachineRegistry(_machines);
        ed25519 = IEd25519Verifier(_ed25519);
        allianceKey = _key;
        (_kx, _ky) = IEd25519Verifier(_ed25519).weierstrass(_x, _y);
    }

    /// @notice Submits a token of the alliance (its three parts: header and payload in base64url, a 64-byte signature).
    ///         Open to anyone. Declares the token's chip to the MachineRegistry until timestamp + VALIDITY.
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

        // the payload is the one the alliance signed: it can be read
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

    // ---------------------------------------------------------------- reading the payload (JSON the alliance signed)

    /// @dev Position of the value of `key`: the key must appear exactly once.
    function _at(string memory json, string memory key) private pure returns (uint256) {
        uint256 i = LibString.indexOf(json, key);
        if (i == LibString.NOT_FOUND || LibString.lastIndexOf(json, key) != i) revert BadToken();
        return i + bytes(key).length;
    }

    /// @dev `n` lowercase hexadecimal digits followed by a double quote.
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

    /// @dev A decimal integer (1 to 12 digits).
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

    /// @dev A string without escapes, of at most `max` bytes.
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

    /// @dev Reverses the order of the 32 bytes.
    function _reverse(uint256 v) private pure returns (uint256 r) {
        for (uint256 i = 0; i < 32; i++) {
            r = (r << 8) | (v & 0xff);
            v >>= 8;
        }
    }
}
