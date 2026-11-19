// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DemoVault — DEMONSTRATION TARGET, DELIBERATELY VULNERABLE
/// @notice A sandbox for the Sealed Bounty demo: a small USDC vault with ONE simple, deliberate flaw (a withdrawal
///         without access control). This contract holds no real value and stands for no real protocol; it exists
///         only so that the enclave can prove an exploit against a disposable target, on a fork, without ever
///         touching a protocol in production.
/// @dev DO NOT reuse: the flaw below is intentional and documented.
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

    /// @notice Lets the network (through SealedBounty) freeze the vault after a proof of exploit.
    function pause() external {
        paused = true;
        emit Paused();
    }

    /// @notice DELIBERATE DEMONSTRATION FLAW: no access control.
    ///         Anyone can "migrate" (drain) the balance to an address of their choice.
    ///         It is the bug that the demo exploit triggers; it is here on purpose.
    function migrate(address to) external {
        uint256 bal = token.balanceOf(address(this));
        require(token.transfer(to, bal), "transfer");
        emit Migrated(msg.sender, to, bal);
    }
}
