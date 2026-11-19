// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Imitates the EIP-2935 history contract: returns keccak256(blockNumber) as the "block hash".
///         In tests it is installed (vm.etch) at the canonical address and REPORTDATA[32:64] is anchored
///         on that same value, to exercise the block-hash check without a real chain.
contract MockHistory {
    fallback() external {
        bytes32 bn;
        assembly {
            bn := calldataload(0)
        }
        bytes32 h = keccak256(abi.encodePacked(bn));
        assembly {
            mstore(0, h)
            return(0, 32)
        }
    }
}
