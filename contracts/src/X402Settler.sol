// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {UsdcPayer} from "./lib/UsdcPayer.sol";
import {IProductRegistry} from "./interfaces/IProductRegistry.sol";
import {IEnclaveRegistry} from "./interfaces/IEnclaveRegistry.sol";
import {IOperatorBond} from "./interfaces/IOperatorBond.sol";

/// @title X402Settler — paiement à l'appel « x402 exact », lié à une preuve d'enclave
/// @notice Deuxième rail de paiement, à côté des sessions prépayées (SessionPay). Pensé pour les agents :
///         une requête = une transaction. Le client présente une autorisation EIP-3009 (en-tête
///         `X-PAYMENT` du protocole x402) ET l'enclave présente un reçu d'appel signé. Le contrat
///         encaisse exactement le montant dû, le répartit (opérateur / auteur / réseau), et prend
///         l'exposition sur l'opérateur. Le `nonce` EIP-3009 lie le paiement au reçu (anti-rejeu).
///
///         Adaptation du schéma x402 « exact » : le `payTo` est CE contrat (il encaisse par
///         `receiveWithAuthorization`, `to == msg.sender`), ce qui permet le split et la preuve
///         d'enclave dans la même transaction. C'est l'atout du rail : paiement + preuve + partage, atomiques.
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
        bytes32 nonce; // = le nonce de l'autorisation EIP-3009 (lie paiement et reçu)
    }

    event CallSettled(
        uint256 indexed productId, address indexed payer, address indexed operator, uint256 amount, bytes32 nonce
    );

    error BadProduct();
    error InactiveEnclave();
    error ZeroAmount();
    /// @notice v2 : le produit n'est pas réglé par CE contrat (Product.settlement).
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

    /// @notice Règle un appel : vérifie le reçu d'enclave, encaisse par EIP-3009, répartit, prend l'exposition.
    /// @param cr         le reçu d'appel signé par l'enclave
    /// @param enclaveSig signature secp256k1 de l'enclave sur `cr`
    /// @param auth       l'autorisation EIP-3009 du payeur (validAfter/validBefore/signature) ; le nonce = cr.nonce
    function settle(CallReceipt calldata cr, bytes calldata enclaveSig, Auth calldata auth) external {
        if (!products.isActive(cr.productId)) revert BadProduct();
        IProductRegistry.Product memory p = products.getProduct(cr.productId);
        // v2 : seul un produit dont le règlement est CE contrat se paie à l'appel (revue adverse du 7/11)
        if (p.settlement != address(this)) revert WrongSettlement();

        uint256 amount = uint256(cr.units) * p.price;
        if (amount == 0) revert ZeroAmount();

        // preuve d'enclave : active au bloc d'ancrage, pour ce produit (fenêtre de validité, grâce comprise)
        address signer = _recover(cr, enclaveSig);
        address operator = enclaves.activeOperatorAt(signer, cr.productId, cr.anchorBlock);
        if (operator == address(0)) revert InactiveEnclave();

        // encaissement x402 : le nonce EIP-3009 EST cr.nonce (un paiement = un reçu, non rejouable)
        usdc.receiveWithAuthorization(
            cr.payer, address(this), amount, auth.validAfter, auth.validBefore, cr.nonce, auth.signature
        );

        // exposition prise sur la foi d'une seule enclave (bornée par C4 : ½ caution, plafond du produit)
        bond.consumeExposure(operator, cr.productId, amount, p.exposureCap);

        // répartition
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
