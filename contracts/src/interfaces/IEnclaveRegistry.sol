// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IOperatorBond} from "./IOperatorBond.sol";

/// @title IEnclaveRegistry — v2: validity in blocks, bounded history of windows
/// @notice v2 (after an adversarial review): an enclave key is bound FOR LIFE to its first (operator, product)
///         pair; a retired image (ProductRegistry.retireWorkload) invalidates its enclaves WITHOUT grace.
///         v2.1: IMAGE fingerprint (dstack). With an RTMR3 event log in the DstackEventLog.FORMAT_V1 format, an
///         enclave is admitted on the fingerprint of its image (without the instance-specific events), which survives
///         reboots.
interface IEnclaveRegistry {
    /// @dev v2: the first 12 fields keep the order, type and meaning of v1 (a v1 reader still decodes them);
    ///      `fromBlock` and `untilBlock` are ADDED at the end.
    struct Enclave {
        address signer; // the enclave's secp256k1 key
        bytes32 x25519; // public encryption key
        uint256 productId;
        address operator;
        bytes32 workloadId;
        bytes6 fmspc;
        uint8 tcbStatus;
        bytes32 quoteHash;
        uint64 anchorBlock;
        uint64 registeredAt; // timestamp of the last (re-)registration
        uint64 expiresAt; // INDICATIVE end-of-validity timestamp (the rule is in blocks: untilBlock)
        bool active; // false after a retirement or an invalidation
        uint64 fromBlock; // v2: first block of the current validity window
        uint64 untilBlock; // v2: last block (inclusive) of the window; lowered on retirement or invalidation
    }

    /// @notice A validity window (v2). A receipt anchored in [fromBlock, untilBlock] settles until block
    ///         untilBlock + GRACE_BLOCKS; no block after untilBlock is ever valid.
    struct Window {
        uint256 productId;
        address operator;
        uint64 fromBlock;
        uint64 untilBlock; // inclusive
    }

    event EnclaveRegistered(
        address indexed signer,
        uint256 indexed productId,
        address indexed operator,
        bytes32 workloadId,
        uint64 expiresAt
    );
    /// @notice v2.1: the image read from the replayed RTMR3 event log (emitted at each registration with a FORMAT_V1
    ///         event log that describes the image; `imageId` is the image fingerprint, kept if the product allows it).
    event EnclaveImage(
        address indexed signer,
        uint256 indexed productId,
        bytes32 indexed imageId,
        bytes32 composeHash,
        bytes32 osImageHash
    );
    event EnclaveInvalidated(address indexed signer, string reason);
    event EnclaveRetired(address indexed signer);

    /// @param eventLog v2.1: RTMR3 event log encoded as abi.encode(DstackEventLog.FORMAT_V1, (uint8 version,
    ///                 bytes name, bytes payload)[]) for an admission on the IMAGE fingerprint; empty (or in another
    ///                 format, ignored as in v2) for the full fingerprint.
    function registerEnclave(
        uint256 productId,
        bytes calldata quote,
        uint256 anchorR,
        address signer,
        bytes32 x25519,
        bytes calldata eventLog
    ) external;

    function invalidate(address signer, bytes calldata quote) external;

    /// @notice v2: invalidates, with no quote and no grace period, an enclave whose image (workloadId) was retired from
    ///         the product. Open to anyone. Its receipts and claims no longer settle, even those anchored before.
    function invalidateRetiredWorkload(address signer) external;

    function retire(address signer) external;

    /// @notice True if a receipt of enclave `signer` for `productId`, anchored at block `blockNumber`, is settleable
    ///         NOW: `blockNumber` is inside a validity window of the enclave for this product (after the registration,
    ///         before the retirement or the invalidation, before the expiry), and the grace period of that window is
    ///         not over.
    function isActiveAt(address signer, uint256 productId, uint256 blockNumber) external view returns (bool);

    /// @notice Like isActiveAt, but returns the operator responsible for the window (address(0) if inactive).
    ///         This is what the settlement contracts read: a single call, and the operator of that time.
    function activeOperatorAt(address signer, uint256 productId, uint256 blockNumber)
        external
        view
        returns (address);

    function enclaveOf(address signer) external view returns (Enclave memory);

    /// @notice The current window and the previous one (kept for its grace period). Zero fields if absent.
    function windowsOf(address signer) external view returns (Window memory current, Window memory previous);

    /// @notice v2: last block at which a receipt of this key can still settle (end of the window + grace);
    ///         0 if the key is unknown or invalidated without grace. Beyond it, no receipt of this enclave pays any
    ///         more (SessionPay uses it to allow an earlier close of a session whose enclave is gone).
    function settleableUntilBlock(address signer) external view returns (uint256);

    /// @notice v2.1: the operators' bond (already public in v2). v2.1b: AttestedSigners now goes through
    ///         attestedOperator, which also reads whether the operator is banned.
    function bond() external view returns (IOperatorBond);

    /// @notice v2.1b: the operator of `signer` if this key is TRUSTED NOW for `productId` (the onlyAttested primitive,
    ///         AttestedSigners): enclave active at the current block (activeOperatorAt), operator not banned, product
    ///         ACTIVE and image (Enclave.workloadId) STILL allowed by the product. Retiring an image (retireWorkload)
    ///         or the product (retire) therefore takes effect at once, without waiting for invalidateRetiredWorkload.
    ///         Otherwise address(0). (ANCHORED receipts and claims are still governed by activeOperatorAt, as in v2.)
    function attestedOperator(address signer, uint256 productId) external view returns (address);
}
