// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAttestationModule} from "../../src/interfaces/IAttestationModule.sol";

/// @notice Configurable attestation module for unit tests: told, per quote,
///         which measurements to return. The real module (TdxAttestationModule) and a real Phala quote
///         are covered by DstackImage.t.sol, Levels.t.sol and the on-chain registrations, not by these unit tests.
contract MockAttestationModule is IAttestationModule {
    mapping(bytes32 => Measurements) private _byQuote;
    mapping(bytes32 => bool) private _set;

    function setMeasurements(bytes calldata quote, Measurements calldata m) external {
        _byQuote[keccak256(quote)] = m;
        _set[keccak256(quote)] = true;
    }

    function verify(bytes calldata quote, bytes calldata) external view override returns (Measurements memory) {
        bytes32 k = keccak256(quote);
        if (!_set[k]) {
            Measurements memory empty; // ok == false
            return empty;
        }
        return _byQuote[k];
    }
}
