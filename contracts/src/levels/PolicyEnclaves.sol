// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEnclaveRegistry} from "../interfaces/IEnclaveRegistry.sol";
import {IOperatorBond} from "../interfaces/IOperatorBond.sol";
import {MachineRegistry} from "./MachineRegistry.sol";

/// @title PolicyEnclaves — l'EnclaveRegistry VU À TRAVERS la politique de niveau de chaque produit (10/11/2026)
/// @notice Les contrats de règlement (SealedBounty, SessionPay, X402Settler, AttestedSigners) ne lisent le registre que par
///         activeOperatorAt / isActiveAt / attestedOperator / enclaveOf. Déployés avec CET adaptateur à la place du registre,
///         ils appliquent SANS changer une ligne de leur code la politique du produit : pour un produit au niveau
///         « vérifié », une enclave dont la machine n'est pas déclarée par un vérificateur accepté n'est pas active (ses
///         signatures ne comptent pas, ses reçus ne se règlent pas). Pour un produit au niveau « ouvert », rien ne change.
///         Lecture seule : l'inscription et le retrait se font toujours sur le registre lui-même.
/// @dev    La politique est lue MAINTENANT (au règlement), pas au bloc d'ancrage : une déclaration retirée ou expirée, ou une
///         enclave réinscrite sans relier sa machine, cesse de compter tout de suite (plus strict, jamais plus large).
contract PolicyEnclaves is IEnclaveRegistry {
    IEnclaveRegistry public immutable base;
    MachineRegistry public immutable machines;

    error UseBaseRegistry();

    constructor(address _base, address _machines) {
        base = IEnclaveRegistry(_base);
        machines = MachineRegistry(_machines);
    }

    function activeOperatorAt(address signer, uint256 productId, uint256 blockNumber)
        public
        view
        override
        returns (address op)
    {
        op = base.activeOperatorAt(signer, productId, blockNumber);
        if (op != address(0) && !machines.meetsPolicy(productId, signer)) return address(0);
    }

    function isActiveAt(address signer, uint256 productId, uint256 blockNumber) external view override returns (bool) {
        return activeOperatorAt(signer, productId, blockNumber) != address(0);
    }

    function attestedOperator(address signer, uint256 productId) external view override returns (address op) {
        op = base.attestedOperator(signer, productId);
        if (op != address(0) && !machines.meetsPolicy(productId, signer)) return address(0);
    }

    function enclaveOf(address signer) external view override returns (Enclave memory) {
        return base.enclaveOf(signer);
    }

    function windowsOf(address signer) external view override returns (Window memory current, Window memory previous) {
        return base.windowsOf(signer);
    }

    function settleableUntilBlock(address signer) external view override returns (uint256) {
        return base.settleableUntilBlock(signer);
    }

    function bond() external view override returns (IOperatorBond) {
        return base.bond();
    }

    // ---- écritures : sur le registre lui-même, jamais par l'adaptateur

    function registerEnclave(uint256, bytes calldata, uint256, address, bytes32, bytes calldata) external pure override {
        revert UseBaseRegistry();
    }

    function invalidate(address, bytes calldata) external pure override {
        revert UseBaseRegistry();
    }

    function invalidateRetiredWorkload(address) external pure override {
        revert UseBaseRegistry();
    }

    function retire(address) external pure override {
        revert UseBaseRegistry();
    }
}
