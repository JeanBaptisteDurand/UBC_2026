// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {AttestedSigners} from "../attested/AttestedSigners.sol";
import {IEnclaveRegistry} from "../interfaces/IEnclaveRegistry.sol";

/// @title AttestedBatchVerifier — a "Gateway-style" demonstration of onlyAttested (v2.1)
/// @notice At Circle Gateway, a batch of transfer intents is executed only if it carries the signature of Circle's
///         attester (a key known in advance). Here, the attester is ANY attested enclave of the product `productId`:
///         its key was registered by the EnclaveRegistry after the Intel quote was verified, and it must be active at
///         the current block. A batch = a list of fingerprints (of transfer intents, for example), numbered with no
///         gap (replay protection, total order), with a deadline. The contract only verifies and records the batch's
///         fingerprint: no value moves (a demonstration, not deployed).
contract AttestedBatchVerifier is EIP712, AttestedSigners {
    bytes32 public constant BATCH_TYPEHASH =
        keccak256("Batch(uint256 productId,uint64 seq,bytes32 itemsHash,uint64 deadline)");

    /// @notice The product whose enclaves can sign the batches.
    uint256 public immutable productId;
    /// @notice Number of the next accepted batch (0, 1, 2... with no gap).
    uint64 public nextSeq;
    /// @notice Fingerprint of the items of batch `seq`: keccak256(abi.encodePacked(items)).
    mapping(uint64 seq => bytes32 itemsHash) public batchOf;

    event BatchAccepted(uint64 indexed seq, bytes32 indexed itemsHash, address indexed signer, uint256 items);

    error EmptyBatch();
    error BatchExpired();
    error BadSeq(uint64 expected);

    constructor(IEnclaveRegistry registry_, uint256 productId_)
        EIP712("ArcHiveAttestedBatch", "1")
        AttestedSigners(registry_)
    {
        productId = productId_;
    }

    /// @notice The EIP-712 digest the enclave signs for the batch (chain, contract, product, number, items, deadline).
    function batchDigest(uint64 seq, bytes32 itemsHash, uint64 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(BATCH_TYPEHASH, productId, seq, itemsHash, deadline)));
    }

    /// @notice Accepts batch `seq` if it is signed by an attested enclave of the product (otherwise NotAttested), not
    ///         expired, and the next one expected. Open to anyone: the authority is the enclave's signature.
    function submitBatch(uint64 seq, uint64 deadline, bytes32[] calldata items, bytes calldata signature)
        external
        onlyAttested(productId, batchDigest(seq, keccak256(abi.encodePacked(items)), deadline), signature)
    {
        if (items.length == 0) revert EmptyBatch();
        if (block.timestamp > deadline) revert BatchExpired();
        if (seq != nextSeq) revert BadSeq(nextSeq);
        nextSeq = seq + 1;
        bytes32 itemsHash = keccak256(abi.encodePacked(items));
        batchOf[seq] = itemsHash;
        emit BatchAccepted(seq, itemsHash, _attestedSigner(), items.length);
    }
}
