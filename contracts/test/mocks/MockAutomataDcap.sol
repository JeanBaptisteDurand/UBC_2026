// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAutomataDcap} from "../../src/interfaces/IAutomataDcap.sol";

/// @notice Stands in for Automata's DCAP verifier in tests (Intel's signature check does not run
///         locally): returns, for a given quote, the output Automata would produce (header: version, body
///         type, TCB, FMSPC; then the quote body), set by the test. The real TdxAttestationModule then parses it.
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
