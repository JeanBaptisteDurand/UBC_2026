// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DemoVault (SPEC-TECH §C8) — CIBLE DE DÉMONSTRATION, VOLONTAIREMENT FAILLIBLE
/// @notice Bac à sable pour la démo de la Prime scellée : un petit coffre d'USDC avec UNE faille
///         simple et volontaire (un retrait sans contrôle d'accès). Ce contrat n'a aucune valeur
///         réelle et ne représente aucun vrai protocole ; il existe uniquement pour que l'enclave
///         (O3) puisse prouver un exploit contre une cible jetable, sur un fork, sans jamais toucher
///         un protocole en production.
/// @dev NE PAS réutiliser : la faille ci-dessous est intentionnelle et documentée.
contract DemoVault {
    IERC20 public immutable token;
    address public owner;
    bool public paused;

    event Deposited(address indexed from, uint256 amount);
    event Migrated(address indexed caller, address indexed to, uint256 amount);
    event Paused();

    constructor(address _token) {
        token = IERC20(_token);
        owner = msg.sender;
    }

    function deposit(uint256 amount) external {
        require(!paused, "paused");
        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom");
        emit Deposited(msg.sender, amount);
    }

    /// @notice Permet au réseau (via SealedBounty) de geler le coffre après une preuve d'exploit.
    function pause() external {
        paused = true;
        emit Paused();
    }

    /// @notice FAILLE VOLONTAIRE DE DÉMONSTRATION : aucun contrôle d'accès.
    ///         N'importe qui peut « migrer » (vider) le solde vers une adresse de son choix.
    ///         C'est le bug que l'exploit de démo déclenche ; il est ici exprès.
    function migrate(address to) external {
        uint256 bal = token.balanceOf(address(this));
        require(token.transfer(to, bal), "transfer");
        emit Migrated(msg.sender, to, bal);
    }
}
