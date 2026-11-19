// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEnclaveRegistry} from "../interfaces/IEnclaveRegistry.sol";
import {IOperatorBond} from "../interfaces/IOperatorBond.sol";
import {MachineRegistry} from "./MachineRegistry.sol";

/// @title PolicyEnclaves — the EnclaveRegistry SEEN THROUGH each product's level policy
/// @notice The settlement contracts (SealedBounty, SessionPay, X402Settler, AttestedSigners) read the registry only
///         through activeOperatorAt / isActiveAt / attestedOperator / enclaveOf. Deployed with THIS adapter in place of
///         the registry, they apply the product's policy WITHOUT changing a line of their code: for a product at the
///         "verified" level, an enclave whose machine is not declared by an accepted verifier is not active (its
///         signatures do not count, its receipts do not settle). For a product at the "open" level, nothing changes.
///         Read-only: registration and retirement are still done on the registry itself.
/// @dev    The policy is read NOW (at settlement), not at the anchor block: a declaration withdrawn or expired, or an
///         enclave registered again without binding its machine, stops counting at once (stricter, never looser).
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

    // ---- writes: on the registry itself, never through the adapter

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
