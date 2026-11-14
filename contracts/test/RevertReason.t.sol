// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RevertReason} from "../src/lib/RevertReason.sol";

/// @dev Revert avec `n` octets 0x00, 0x01, … (motif modulo 256).
contract PatternReverter {
    function boom(uint256 n) external pure {
        assembly {
            let p := mload(0x40)
            for { let i := 0 } lt(i, n) { i := add(i, 1) } { mstore8(add(p, i), and(i, 0xff)) }
            revert(p, n)
        }
    }
}

/// @dev Attrape le revert comme SessionPay / SealedBounty (catch {} puis RevertReason.bounded()).
contract BoundedCatcher {
    function run(PatternReverter t, uint256 n)
        external
        view
        returns (bytes memory r, uint256 freeBefore, uint256 freeAfter, uint256 gasUsed)
    {
        try t.boom(n) {}
        catch {
            assembly {
                freeBefore := mload(0x40)
            }
            uint256 g = gasleft();
            r = RevertReason.bounded();
            gasUsed = g - gasleft();
            assembly {
                freeAfter := mload(0x40)
            }
        }
    }
}

/// @notice v2.1 bis — RevertReason.bounded() : le préfixe de 132 octets au plus du revert, à coût constant (la parade à la
///         « return bomb » de la revue adverse du 9/11).
contract RevertReasonTest is Test {
    PatternReverter reverter;
    BoundedCatcher catcher;

    function setUp() public {
        reverter = new PatternReverter();
        catcher = new BoundedCatcher();
    }

    function _check(uint256 n) internal view returns (uint256 gasUsed) {
        (bytes memory r, uint256 freeBefore, uint256 freeAfter, uint256 g) = catcher.run(reverter, n);
        uint256 expected = n < 132 ? n : 132;
        assertEq(r.length, expected, "longueur bornee");
        for (uint256 i = 0; i < r.length; i++) {
            assertEq(uint8(r[i]), uint8(i & 0xff), "prefixe exact");
        }
        // allocation propre : le tableau rendu est sous le nouveau pointeur de mémoire libre
        assertEq(freeAfter, freeBefore + 0x20 + ((expected + 31) / 32) * 32, "pointeur de memoire libre avance");
        return g;
    }

    function test_shortRevertCopiedWhole() public view {
        _check(0);
        _check(4);
        _check(36);
        _check(100);
        _check(132);
    }

    function test_longRevertTruncatedTo132() public view {
        _check(133);
        _check(388);
        _check(10_000);
    }

    /// Coût constant : recopier le préfixe d'un revert de 200 000 octets coûte autant que celui d'un revert de 133 octets.
    function test_constantCostWhateverTheRevertSize() public view {
        uint256 small = _check(133);
        uint256 huge = _check(200_000);
        assertEq(huge, small, "cout independant de la taille du revert");
        assertLt(huge, 1_000);
    }

    function testFuzz_prefix(uint16 n) public view {
        _check(uint256(n) % 2_049);
    }
}
