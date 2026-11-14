// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IIdentityRegistry} from "../../src/interfaces/IERC8004.sol";

/// @notice Modèle FIDÈLE du registre de validation ERC-8004 de Circle (ValidationRegistryUpgradeable 2.0.0, code de
///         référence d'erc-8004-contracts ; « exists » confirmé sur le registre d'Arc testnet par la revue du 9/11) :
///         - un SEUL espace de requestHash pour tout le monde : « exists » quel que soit l'agent ou l'appelant ;
///         - la demande est réservée au propriétaire de l'agent ou à un approuvé (ownerOf d'un agent inconnu revert, comme
///           ERC-721) ; la réponse au validateur nommé (plusieurs réponses possibles) ; réponse ≤ 100.
///         MockValidationRegistry n'a ni l'un ni l'autre : il ne pouvait pas voir la préemption d'un requestHash.
///         Installé par vm.etch à l'adresse du registre de test (l'immuable `identity` est dans le code).
contract StrictValidationRegistry {
    struct Status {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool hasResponse;
    }

    IIdentityRegistry public immutable identity;
    mapping(bytes32 => Status) internal _v;
    mapping(uint256 => bytes32[]) internal _agentValidations;
    mapping(address => bytes32[]) internal _validatorRequests;

    error ERC721NonexistentToken(uint256 tokenId);

    constructor(IIdentityRegistry identity_) {
        identity = identity_;
    }

    function validationRequest(address validatorAddress, uint256 agentId, string calldata, bytes32 requestHash)
        external
    {
        require(validatorAddress != address(0), "bad validator");
        require(_v[requestHash].validatorAddress == address(0), "exists");
        address owner = identity.ownerOf(agentId);
        if (owner == address(0)) revert ERC721NonexistentToken(agentId);
        require(msg.sender == owner || identity.isApprovedForAll(owner, msg.sender), "Not authorized");
        _v[requestHash] = Status(validatorAddress, agentId, 0, bytes32(0), "", block.timestamp, false);
        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);
    }

    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata,
        bytes32 responseHash,
        string calldata tag
    ) external {
        Status storage s = _v[requestHash];
        require(s.validatorAddress != address(0), "unknown");
        require(msg.sender == s.validatorAddress, "not validator");
        require(response <= 100, "resp>100");
        s.response = response;
        s.responseHash = responseHash;
        s.tag = tag;
        s.lastUpdate = block.timestamp;
        s.hasResponse = true;
    }

    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address, uint256, uint8, bytes32, string memory, uint256)
    {
        Status memory s = _v[requestHash];
        require(s.validatorAddress != address(0), "unknown");
        return (s.validatorAddress, s.agentId, s.response, s.responseHash, s.tag, s.lastUpdate);
    }

    /// @dev Lecture de test, sans revert pour un hash libre.
    function statusOf(bytes32 requestHash)
        external
        view
        returns (address validator, uint256 agentId, uint8 response, bool hasResponse)
    {
        Status storage s = _v[requestHash];
        return (s.validatorAddress, s.agentId, s.response, s.hasResponse);
    }

    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }
}

/// @notice Registre ERC-8004 hostile ou bogué (proxy UUPS mis à jour, clé compromise, bogue) : chaque appel revert avec des
///         données dont la copie en mémoire coûte ≈ 40 % du gaz reçu (w mots : 3w + w²/512 ≈ c, donc w ≈ √(512·c)).
///         Un appelant qui recopie TOUT le revert (catch (bytes memory reason)) manque alors de gaz, quel que soit le gaz
///         envoyé (le coût suit le gaz donné).
contract ReturnBombRegistry {
    fallback() external {
        assembly {
            let c := div(mul(gas(), 40), 100)
            let x := mul(512, c)
            let w := x
            let y := div(add(x, 1), 2)
            for {} lt(y, w) {} {
                w := y
                y := div(add(div(x, y), y), 2)
            }
            revert(0, mul(w, 32))
        }
    }
}

/// @notice Registre qui refuse tout avec un message Error(string) LONG (300 caractères) : la raison émise par
///         VerdictSkipped doit être tronquée à 132 octets.
contract LongReasonRegistry {
    fallback() external {
        bytes memory m = new bytes(300);
        for (uint256 i = 0; i < 300; i++) {
            m[i] = bytes1(uint8(0x41 + (i % 26)));
        }
        revert(string(m));
    }
}
