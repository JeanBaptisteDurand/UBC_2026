// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {AttestedSigners} from "../attested/AttestedSigners.sol";
import {IEnclaveRegistry} from "../interfaces/IEnclaveRegistry.sol";

/// @title AttestedBatchVerifier — démonstration « façon Gateway » de onlyAttested (v2.1)
/// @notice Chez Circle Gateway, un lot d'intentions de transfert n'est exécuté que s'il porte la signature de
///         l'attesteur de Circle (une clé connue d'avance). Ici, l'attesteur est N'IMPORTE QUELLE enclave attestée du
///         produit `productId` : sa clé a été inscrite par l'EnclaveRegistry après vérification du quote Intel, et elle
///         doit être active au bloc courant. Un lot = une liste d'empreintes (par exemple d'intentions de transfert),
///         numérotée sans trou (anti-rejeu, ordre total), avec une échéance. Le contrat ne fait que vérifier et
///         enregistrer l'empreinte du lot : aucune valeur ne bouge (démonstration, non déployée).
contract AttestedBatchVerifier is EIP712, AttestedSigners {
    bytes32 public constant BATCH_TYPEHASH =
        keccak256("Batch(uint256 productId,uint64 seq,bytes32 itemsHash,uint64 deadline)");

    /// @notice Le produit dont les enclaves peuvent signer les lots.
    uint256 public immutable productId;
    /// @notice Numéro du prochain lot accepté (0, 1, 2… sans trou).
    uint64 public nextSeq;
    /// @notice Empreinte des éléments du lot `seq` : keccak256(abi.encodePacked(items)).
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

    /// @notice Le condensat EIP-712 que l'enclave signe pour le lot (chaîne, contrat, produit, numéro, éléments, échéance).
    function batchDigest(uint64 seq, bytes32 itemsHash, uint64 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(BATCH_TYPEHASH, productId, seq, itemsHash, deadline)));
    }

    /// @notice Accepte le lot `seq` s'il est signé par une enclave attestée du produit (sinon NotAttested), non échu,
    ///         et s'il est le suivant attendu. Ouvert à tous : l'autorité est la signature de l'enclave.
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
