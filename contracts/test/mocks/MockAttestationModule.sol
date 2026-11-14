// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAttestationModule} from "../../src/interfaces/IAttestationModule.sol";

/// @notice Module d'attestation paramétrable pour les tests unitaires : on lui dit, par quote,
///         quelles mesures renvoyer. Le vrai module (TdxAttestationModule) et un vrai quote Phala
///         sont du ressort de l'intégration (spike S1/S2), hors tests unitaires.
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
