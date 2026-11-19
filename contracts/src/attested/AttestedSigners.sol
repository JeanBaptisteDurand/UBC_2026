// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IEnclaveRegistry} from "../interfaces/IEnclaveRegistry.sol";

/// @title AttestedSignersLib — the "onlyAttested" primitive (v2.1)
/// @notice A message is accepted only if it is signed by an ATTESTED enclave: a key that the EnclaveRegistry
///         registered for this product after Intel (DCAP) verified its quote, active AT THE CURRENT BLOCK (inside its
///         validity window, not retired, expired or invalidated), and whose operator is not banned (a proven fault,
///         equivocation or a refuted claim, takes down all of its enclaves). It is the "trusted signer" of a bridge
///         or an oracle, replaced by a hardware proof verified on chain.
///         v2.1b (after an adversarial review): the product must be ACTIVE and the enclave's image STILL allowed
///         (EnclaveRegistry.attestedOperator): retiring the image or the product cuts off its enclaves at once,
///         without waiting for the invalidateRetiredWorkload transaction (one per key), during which an operator
///         watching the mempool could still push messages through. Requires an EnclaveRegistry v2.1b or later.
///
///         What the primitive does NOT do: replay protection and binding to the context. The signed digest must bind
///         the message to the chain, the contract and the product (EIP-712 with productId), and the caller manages
///         nonces or sequence numbers (see AttestedBatchVerifier). Nor the quorum: ONE attested enclave is enough; a
///         real bridge would require several, from distinct operators.
library AttestedSignersLib {
    /// @notice `signer` is not trusted for the product at the current block (inactive enclave, banned operator,
    ///         retired product or retired image); address(0): unreadable signature.
    error NotAttested(address signer);

    /// @notice The signer of `digest` if it is trusted for `productId` at the current block
    ///         (EnclaveRegistry.attestedOperator), and the operator responsible for its window; otherwise reverts
    ///         NotAttested. 65-byte ECDSA signatures with a "low" s (OpenZeppelin's ECDSA: no malleability).
    function requireAttestedSig(IEnclaveRegistry registry, uint256 productId, bytes32 digest, bytes memory signature)
        internal
        view
        returns (address signer, address operator)
    {
        (address s, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError) revert NotAttested(address(0));
        operator = registry.attestedOperator(s, productId);
        if (operator == address(0)) revert NotAttested(s);
        signer = s;
    }
}

/// @title AttestedSigners — inherited by a contract that receives messages signed by enclaves (v2.1)
/// @notice requireAttestedSig(productId, digest, signature) returns the signer or reverts NotAttested; the
///         onlyAttested modifier makes the same check before the function body, which reads the signer with
///         _attestedSigner() (transient storage, EIP-1153: nothing is written to permanent storage).
abstract contract AttestedSigners {
    /// @notice The enclave registry whose signatures this contract accepts.
    IEnclaveRegistry public immutable enclaveRegistry;

    /// @dev Signer of the message being processed under onlyAttested.
    address private transient _signer;

    constructor(IEnclaveRegistry registry_) {
        enclaveRegistry = registry_;
    }

    /// @notice Runs the function only if `signature` over `digest` comes from an enclave trusted for `productId`
    ///         (active at the current block, operator not banned, product active, image still allowed).
    modifier onlyAttested(uint256 productId, bytes32 digest, bytes memory signature) {
        (address s,) = AttestedSignersLib.requireAttestedSig(enclaveRegistry, productId, digest, signature);
        address outer = _signer;
        _signer = s;
        _;
        _signer = outer;
    }

    /// @notice The signer of `digest` if it is trusted for `productId` at the current block (see the modifier);
    ///         otherwise reverts AttestedSignersLib.NotAttested(signer).
    function requireAttestedSig(uint256 productId, bytes32 digest, bytes memory signature)
        public
        view
        returns (address signer)
    {
        (signer,) = AttestedSignersLib.requireAttestedSig(enclaveRegistry, productId, digest, signature);
    }

    /// @dev Inside a function marked onlyAttested: the enclave that signed the message.
    function _attestedSigner() internal view returns (address) {
        return _signer;
    }
}
