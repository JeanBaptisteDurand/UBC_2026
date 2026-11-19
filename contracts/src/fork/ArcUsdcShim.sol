// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ArcUsdcShim — Arc's USDC as it behaves, for an anvil fork (the Sealed Bounty replay)
/// @notice On Arc, the USDC ERC-20 (0x3600…) mirrors the NATIVE balance (18 decimals): balanceOf = native
///         balance / 1e12, and its transfers go through a system precompile (0x1800…00 transfer, 0x1800…01
///         isBlocklisted) that a plain anvil does not have: on a fork, every USDC transfer fails. This code replaces
///         the code at 0x3600 IN THE FORK ONLY (anvil_setCode), never on the chain. It keeps Arc's semantics:
///         - balanceOf(x) = native balance of x / 1e12 + delta[x]: native transfers (CALL with value) stay
///           visible, ERC-20 transfers add to the delta;
///         - transfer / transferFrom require the balance (ERC-20 view) and the allowance, like the real USDC;
///         - the allowances existing at block N are read from the real storage by the original implementation
///           (delegatecall, same storage), then overridden locally by approve / transferFrom;
///         - everything else (name, symbol, totalSupply, nonces...) is delegated to the original implementation.
///         The shim's own storage lives at hashed slots: no collision with the USDC's.
/// @dev The address of the original implementation is set by the replay at the IMPL_SLOT slot.
contract ArcUsdcShim {
    bytes32 internal constant IMPL_SLOT = keccak256("archive.fork.usdc.impl");
    bytes32 internal constant DELTA_TAG = keccak256("archive.fork.usdc.delta");
    bytes32 internal constant ALLOW_SET_TAG = keccak256("archive.fork.usdc.allowance.set");
    bytes32 internal constant ALLOW_TAG = keccak256("archive.fork.usdc.allowance");

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function balanceOf(address a) public view returns (uint256) {
        int256 b = int256(a.balance / 1e12) + _delta(a);
        return b > 0 ? uint256(b) : 0;
    }

    function allowance(address owner, address spender) public returns (uint256) {
        if (_load(_key2(ALLOW_SET_TAG, owner, spender)) != 0) return _load(_key2(ALLOW_TAG, owner, spender));
        (bool ok, bytes memory out) = _impl().delegatecall(abi.encodeWithSignature("allowance(address,address)", owner, spender));
        return ok && out.length >= 32 ? abi.decode(out, (uint256)) : 0;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        _setAllowance(msg.sender, spender, value);
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance(from, msg.sender);
        require(a >= value, "ERC20: transfer amount exceeds allowance");
        if (a != type(uint256).max) _setAllowance(from, msg.sender, a - value);
        _move(from, to, value);
        return true;
    }

    /// @dev Everything else goes to the original implementation (a read of the same storage).
    fallback() external payable {
        address impl = _impl();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}

    // ---------- internal ----------

    function _move(address from, address to, uint256 value) internal {
        require(to != address(0), "ERC20: transfer to the zero address");
        require(balanceOf(from) >= value, "ERC20: transfer amount exceeds balance");
        _store(_key1(DELTA_TAG, from), uint256(_delta(from) - int256(value)));
        _store(_key1(DELTA_TAG, to), uint256(_delta(to) + int256(value)));
        emit Transfer(from, to, value);
    }

    function _setAllowance(address owner, address spender, uint256 value) internal {
        _store(_key2(ALLOW_SET_TAG, owner, spender), 1);
        _store(_key2(ALLOW_TAG, owner, spender), value);
    }

    function _delta(address a) internal view returns (int256) {
        return int256(_load(_key1(DELTA_TAG, a)));
    }

    function _impl() internal view returns (address) {
        return address(uint160(_load(IMPL_SLOT)));
    }

    function _key1(bytes32 tag, address a) internal pure returns (bytes32) {
        return keccak256(abi.encode(tag, a));
    }

    function _key2(bytes32 tag, address a, address b) internal pure returns (bytes32) {
        return keccak256(abi.encode(tag, a, b));
    }

    function _load(bytes32 slot) internal view returns (uint256 v) {
        assembly { v := sload(slot) }
    }

    function _store(bytes32 slot, uint256 v) internal {
        assembly { sstore(slot, v) }
    }
}
