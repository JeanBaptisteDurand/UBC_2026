// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAutomataDcap} from "../../src/interfaces/IAutomataDcap.sol";

/// @notice Remplace le vérificateur DCAP d'Automata dans les tests (la vérification de la signature d'Intel ne tourne
///         pas en local) : rend, pour un quote donné, la sortie qu'Automata produirait — en-tête (version, type de
///         corps, TCB, FMSPC) + corps du quote — fixée par le test. Le vrai TdxAttestationModule la découpe ensuite.
contract MockAutomataDcap is IAutomataDcap {
    mapping(bytes32 => bytes) private _out;

    function setOutput(bytes calldata quote, bytes calldata output) external {
        _out[keccak256(quote)] = output;
    }

    function verifyAndAttestOnChain(bytes calldata rawQuote) external payable override returns (bool, bytes memory) {
        return _verify(rawQuote);
    }

    function verifyAndAttestOnChain(bytes calldata rawQuote, uint32) external payable override returns (bool, bytes memory) {
        return _verify(rawQuote);
    }

    function _verify(bytes calldata rawQuote) private view returns (bool, bytes memory) {
        bytes memory o = _out[keccak256(rawQuote)];
        if (o.length == 0) return (false, bytes("unknown quote"));
        return (true, o);
    }
}
