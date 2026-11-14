// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Imite le contrat d'historique EIP-2935 : rend keccak256(numéroDeBloc) comme « hash du bloc ».
///         Dans les tests, on l'installe (vm.etch) à l'adresse canonique et on ancre REPORTDATA[32:64]
///         sur cette même valeur, pour exercer la vérification P7 sans vrai mainnet.
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
