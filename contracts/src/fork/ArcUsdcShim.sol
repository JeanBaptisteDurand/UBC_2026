// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ArcUsdcShim — l'USDC d'Arc tel qu'il se comporte, pour un fork anvil (rejeu de la Prime scellée)
/// @notice Sur Arc, l'ERC-20 USDC (0x3600…) est le reflet du solde NATIF (18 décimales) : balanceOf = solde natif / 1e12,
///         et ses transferts passent par un précompilé système (0x1800…00 transfer, 0x1800…01 isBlocklisted) qu'un
///         anvil ordinaire n'a pas : sur un fork, tout transfert d'USDC échoue. Ce code remplace celui de 0x3600 DANS LE
///         FORK SEULEMENT (anvil_setCode), jamais sur la chaîne. Il garde la sémantique d'Arc :
///         - balanceOf(x) = solde natif de x / 1e12 + delta[x] : les transferts natifs (CALL avec valeur) restent visibles,
///           les transferts ERC-20 s'ajoutent au delta ;
///         - transfer / transferFrom exigent le solde (vue ERC-20) et l'allocation, comme l'USDC réel ;
///         - les allocations existantes au bloc N sont lues dans le stockage réel par l'implémentation d'origine
///           (delegatecall, même stockage), puis surchargées localement par approve / transferFrom ;
///         - tout le reste (name, symbol, totalSupply, nonces…) est délégué à l'implémentation d'origine.
///         Le stockage propre du shim vit à des emplacements hachés : aucune collision avec celui de l'USDC.
/// @dev L'adresse de l'implémentation d'origine est posée par le rejeu à l'emplacement IMPL_SLOT.
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

    /// @dev Tout le reste part à l'implémentation d'origine (lecture du même stockage).
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

    // ---------- interne ----------

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
