// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {UsdcPayer} from "./lib/UsdcPayer.sol";
import {IProductRegistry} from "./interfaces/IProductRegistry.sol";
import {IEnclaveRegistry} from "./interfaces/IEnclaveRegistry.sol";
import {IOperatorBond} from "./interfaces/IOperatorBond.sol";

/// @title X402Settler — pay per call, "x402 exact" scheme, bound to an enclave proof
/// @notice The second payment rail, next to prepaid sessions (SessionPay). Designed for agents: one request = one
///         transaction. The client presents an EIP-3009 authorization (the x402 protocol's `X-PAYMENT` header)
///         AND the enclave presents a signed call receipt. The contract collects exactly the amount due, splits it
///         (operator / author / network), and takes the exposure on the operator. The EIP-3009 `nonce` binds the
///         payment to the receipt (replay protection).
///
///         An adaptation of the x402 "exact" scheme: `payTo` is THIS contract (it collects through
///         `receiveWithAuthorization`, `to == msg.sender`), which allows the split and the enclave proof in the same
///         transaction. That is the rail's strength: payment + proof + split, atomic.
contract X402Settler is EIP712, UsdcPayer {
    using ECDSA for bytes32;

    bytes32 public constant CALL_RECEIPT_TYPEHASH = keccak256(
        "CallReceipt(uint256 productId,address payer,bytes32 requestHash,bytes32 responseHash,uint128 units,uint64 anchorBlock,bytes32 nonce)"
    );

    IProductRegistry public immutable products;
    IEnclaveRegistry public immutable enclaves;
    IOperatorBond public immutable bond;
    address public immutable treasury;

    struct CallReceipt {
        uint256 productId;
        address payer;
        bytes32 requestHash;
        bytes32 responseHash;
        uint128 units;
        uint64 anchorBlock;
        bytes32 nonce; // = the nonce of the EIP-3009 authorization (binds payment and receipt)
    }

    event CallSettled(
        uint256 indexed productId, address indexed payer, address indexed operator, uint256 amount, bytes32 nonce
    );

    error BadProduct();
    error InactiveEnclave();
    error ZeroAmount();
    /// @notice v2: the product is not settled by THIS contract (Product.settlement).
    error WrongSettlement();

    constructor(
        address _usdc,
        address _products,
        address _enclaves,
        address _bond,
        address _treasury
    ) EIP712("ArcEnclaveNetwork", "1") UsdcPayer(_usdc) {
        products = IProductRegistry(_products);
        enclaves = IEnclaveRegistry(_enclaves);
        bond = IOperatorBond(_bond);
        treasury = _treasury;
    }

    /// @notice Settles a call: checks the enclave receipt, collects through EIP-3009, splits, takes the exposure.
    /// @param cr         the call receipt signed by the enclave
    /// @param enclaveSig the enclave's secp256k1 signature over `cr`
    /// @param auth       the payer's EIP-3009 authorization (validAfter/validBefore/signature); the nonce = cr.nonce
    function settle(CallReceipt calldata cr, bytes calldata enclaveSig, Auth calldata auth) external {
        if (!products.isActive(cr.productId)) revert BadProduct();
        IProductRegistry.Product memory p = products.getProduct(cr.productId);
        // v2: only a product whose settlement is THIS contract is paid per call (after an adversarial review)
        if (p.settlement != address(this)) revert WrongSettlement();

        uint256 amount = uint256(cr.units) * p.price;
        if (amount == 0) revert ZeroAmount();

        // enclave proof: active at the anchor block, for this product (validity window, grace included)
        address signer = _recover(cr, enclaveSig);
        address operator = enclaves.activeOperatorAt(signer, cr.productId, cr.anchorBlock);
        if (operator == address(0)) revert InactiveEnclave();

        // x402 collection: the EIP-3009 nonce IS cr.nonce (one payment = one receipt, not replayable)
        usdc.receiveWithAuthorization(
            cr.payer, address(this), amount, auth.validAfter, auth.validBefore, cr.nonce, auth.signature
        );

        // exposure taken on the word of one enclave (bounded by OperatorBond: half the bond, the product's cap)
        bond.consumeExposure(operator, cr.productId, amount, p.exposureCap);

        // split
        uint256 toOperator = amount * p.bpsOperator / 10_000;
        uint256 toAuthor = amount * p.bpsAuthor / 10_000;
        uint256 toNetwork = amount - toOperator - toAuthor;
        _payOut(operator, toOperator);
        _payOut(p.author, toAuthor);
        _payOut(treasury, toNetwork);

        emit CallSettled(cr.productId, cr.payer, operator, amount, cr.nonce);
    }

    function _recover(CallReceipt calldata cr, bytes calldata signature) private view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(
                CALL_RECEIPT_TYPEHASH,
                cr.productId,
                cr.payer,
                cr.requestHash,
                cr.responseHash,
                cr.units,
                cr.anchorBlock,
                cr.nonce
            )
        );
        return _hashTypedDataV4(structHash).recover(signature);
    }
}
