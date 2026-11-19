// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Sha384} from "../src/lib/Sha384.sol";

/// @notice DELIBERATELY naive reference (pure Solidity, uint64, no assembly, one variable per register), written
///         following FIPS 180-4 §6.4, as the reference for the differential test of Sha384 (assembly). Slow, which does not matter here.
library Sha384Ref {
    function rotr(uint64 x, uint64 n) internal pure returns (uint64) {
        return (x >> n) | (x << (64 - n));
    }

    function hash(bytes memory m) internal pure returns (bytes memory) {
        uint64[8] memory hv = [
            uint64(0xcbbb9d5dc1059ed8),
            0x629a292a367cd507,
            0x9159015a3070dd17,
            0x152fecd8f70e5939,
            0x67332667ffc00b31,
            0x8eb44a8768581511,
            0xdb0c2e0d64f98fa7,
            0x47b5481dbefa4fa4
        ];
        // padding (§5.1.2): message ‖ 0x80 ‖ zeros ‖ 128-bit length in bits, total a multiple of 128 bytes
        uint256 len = m.length;
        // forge-lint: disable-next-line(divide-before-multiply)
        uint256 total = ((len + 17 + 127) / 128) * 128; // rounded up to the next multiple of 128 (intended)
        bytes memory p = new bytes(total);
        for (uint256 i = 0; i < len; i++) {
            p[i] = m[i];
        }
        p[len] = 0x80;
        uint256 bits = len * 8;
        for (uint256 i = 0; i < 16; i++) {
            p[total - 1 - i] = bytes1(uint8(bits >> (8 * i)));
        }
        uint64[80] memory kk;
        bytes memory kb = Sha384.K;
        for (uint256 t = 0; t < 80; t++) {
            uint64 x;
            for (uint256 j = 0; j < 8; j++) {
                x = (x << 8) | uint64(uint8(kb[8 * t + j]));
            }
            kk[t] = x;
        }
        uint64[80] memory w;
        for (uint256 off = 0; off < total; off += 128) {
            for (uint256 t = 0; t < 16; t++) {
                uint64 x;
                for (uint256 j = 0; j < 8; j++) {
                    x = (x << 8) | uint64(uint8(p[off + 8 * t + j]));
                }
                w[t] = x;
            }
            unchecked {
                for (uint256 t = 16; t < 80; t++) {
                    uint64 x15 = w[t - 15];
                    uint64 x2 = w[t - 2];
                    uint64 s0 = rotr(x15, 1) ^ rotr(x15, 8) ^ (x15 >> 7);
                    uint64 s1 = rotr(x2, 19) ^ rotr(x2, 61) ^ (x2 >> 6);
                    w[t] = w[t - 16] + s0 + w[t - 7] + s1;
                }
                uint64 a = hv[0];
                uint64 b = hv[1];
                uint64 c = hv[2];
                uint64 d = hv[3];
                uint64 e = hv[4];
                uint64 f = hv[5];
                uint64 g = hv[6];
                uint64 h = hv[7];
                for (uint256 t = 0; t < 80; t++) {
                    uint64 t1 = h + (rotr(e, 14) ^ rotr(e, 18) ^ rotr(e, 41)) + ((e & f) ^ (~e & g)) + kk[t] + w[t];
                    uint64 t2 = (rotr(a, 28) ^ rotr(a, 34) ^ rotr(a, 39)) + ((a & b) ^ (a & c) ^ (b & c));
                    h = g;
                    g = f;
                    f = e;
                    e = d + t1;
                    d = c;
                    c = b;
                    b = a;
                    a = t1 + t2;
                }
                hv[0] += a;
                hv[1] += b;
                hv[2] += c;
                hv[3] += d;
                hv[4] += e;
                hv[5] += f;
                hv[6] += g;
                hv[7] += h;
            }
        }
        return abi.encodePacked(hv[0], hv[1], hv[2], hv[3], hv[4], hv[5]);
    }
}

/// @notice SHA-384 in EVM (src/lib/Sha384.sol): official FIPS 180-4 vectors, a sweep of ALL
///         lengths from 0 to 300 bytes against Python's hashlib, padding boundaries, a differential test against a naive
///         reference, measurement-register extension, memory safety, gas.
contract Sha384Test is Test {
    function _h(bytes memory data) internal pure returns (bytes memory) {
        (bytes32 hi, bytes16 lo) = Sha384.hash(data);
        return abi.encodePacked(hi, lo);
    }

    /// @dev deterministic stream of the Python vectors: byte i = (31·i + 17) mod 256; a message of length L = its first
    ///      L bytes (same generator as the off-chain script, see the comment of the sweep).
    function _stream(uint256 len) internal pure returns (bytes memory s) {
        s = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            s[i] = bytes1(uint8((i * 31 + 17) & 0xff));
        }
    }

    // ---- official FIPS 180-4 vectors (NIST examples, SHA-384) ----

    function test_fips_empty() public pure {
        assertEq(
            _h(""),
            hex"38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b"
        );
    }

    function test_fips_abc() public pure {
        assertEq(
            _h("abc"),
            hex"cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7"
        );
    }

    /// @dev 448 bits (56 bytes): a single final block.
    function test_fips_448bits() public pure {
        assertEq(
            _h("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            hex"3391fdddfc8dc7393707a65b1b4709397cf8b1d162af05abfe8f450de5f36bc6b0455a8520bc4e6f5fe95b1fe3c8452b"
        );
    }

    /// @dev 896 bits (112 bytes): the padding spills into a 2nd block.
    function test_fips_896bits() public pure {
        assertEq(
            _h(
                "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"
            ),
            hex"09330c33f71147e83d192fc782cd1b4753111b173b3b05d22fa08086e3b0f712fcc7c71a557e2db966c3e9fa91746039"
        );
    }

    /// @dev One million "a" (7,813 blocks): the long message of FIPS 180-4.
    function test_fips_millionA() public pure {
        bytes memory m = new bytes(1_000_000);
        assembly ("memory-safe") {
            let p := add(m, 0x20)
            let w := 0x6161616161616161616161616161616161616161616161616161616161616161
            for { let i := 0 } lt(i, 1000000) { i := add(i, 0x20) } { mstore(add(p, i), w) }
        }
        assertEq(
            _h(m),
            hex"9d0e1809716474cb086e834e310a4a1ced149e9c00f248527972cec5704c2a5b07b8b3dc38ecc4ebae97ddd87f3d8985"
        );
    }

    // ---- every length from 0 to 300 bytes, against hashlib (Python 3) ----

    /// @dev Expected values computed off chain (Python 3, hashlib):
    ///        s = bytes((31*i + 17) & 0xff for i in range(301)); acc = bytes(32)
    ///        for L in range(301): acc = sha256(acc + sha384(s[:L]).digest()).digest()
    ///      Covers every padding case: a remainder of 0 to 127 bytes, 1 or 2 final blocks, 0 to 2 full blocks.
    function test_allLengths0to300_matchHashlib() public pure {
        bytes memory s = _stream(300);
        bytes32 acc;
        for (uint256 len = 0; len <= 300; len++) {
            bytes memory m = new bytes(len);
            for (uint256 i = 0; i < len; i++) {
                m[i] = s[i];
            }
            acc = sha256(abi.encodePacked(acc, _h(m)));
        }
        assertEq(acc, 0xdf79c66c0664a1cb469d1ed0bfca051099b1ecea5d72a6d856218407548a59f1);
    }

    /// @dev Padding boundaries, one by one (hashlib): 111 = last remainder with one final block, 112 = first with two.
    function test_paddingBoundaries_matchHashlib() public pure {
        assertEq(
            _h(_stream(111)),
            hex"69d09c0b14b7c4f655d631c2f917765dd36ea6d82b77b496cbb22dc5b32f933faeec6932f2be8826aa022e07b3214441"
        );
        assertEq(
            _h(_stream(112)),
            hex"b6a99cd9c0a84eb0652f03f392411ccce253a9d91ab9e3343af7aeb877073facf761e4aa9aee6bdd3fb9e707632648c6"
        );
        assertEq(
            _h(_stream(127)),
            hex"0b93049e18e07bf2290ce70e48124a5054e3998db842def0cb63359d0c1491140415d659df246b8f0c1565470063de79"
        );
        assertEq(
            _h(_stream(128)),
            hex"7482e09923e6b232c8398385a613898cd7b7cd13b79fd3ae2653f89ce2652e2995e6f4e01c17eeb467a5b19b3c916bce"
        );
        assertEq(
            _h(_stream(129)),
            hex"8217ada015c0fae46ad5fecc50ab7a907cf871147166b8498f554ccc0510307070732a9f7ec69d1530b426452906b4c6"
        );
        assertEq(
            _h(_stream(239)),
            hex"003e5953dbae91d30995b0428ece975ff993126cb34d59f51c3ff1e8432b92f78523d622e95866150634b8923cf313a0"
        );
        assertEq(
            _h(_stream(240)),
            hex"bbc2cd7ab9807d601bf4216f79e0525a103d00d4c8eaf9fd59f6b2c6518cdfe2ce0b440daa8ed9faa47b17eed8ea2fe8"
        );
        assertEq(
            _h(_stream(255)),
            hex"fe3fc69352ff11e5d3289048ba10d22daf26ca9b22f965c368e44903d757c64a4a701284ed943f1cfb2fd982b77f08ec"
        );
        assertEq(
            _h(_stream(256)),
            hex"d1681e55200d2210ac57b86e4bc2038a6f942b23efdb2f0340e95b00beda6f420b1273c61f9e81e984fabfe125b3114f"
        );
        assertEq(
            _h(_stream(1000)),
            hex"884de6851ad42236d3e201b51fb6ae92cbe47b729c9ef2b919f829ef473b702a56d4d457d6a1ecd06714c24af51dee80"
        );
    }

    // ---- differential: the assembly against the naive reference ----

    function testFuzz_matchesNaiveReference(bytes memory data) public pure {
        assertEq(_h(data), Sha384Ref.hash(data));
    }

    function testFuzz_matchesNaiveReference_lengths(uint256 seed, uint256 len) public pure {
        len = bound(len, 0, 700);
        bytes memory m = new bytes(len);
        for (uint256 i = 0; i < len; i += 32) {
            bytes32 x = keccak256(abi.encode(seed, i));
            for (uint256 j = 0; j < 32 && i + j < len; j++) {
                m[i + j] = x[j];
            }
        }
        assertEq(_h(m), Sha384Ref.hash(m));
    }

    // ---- extension of a measurement register: SHA384(mr ‖ d) ----

    function test_extend_isHashOfConcatenation() public pure {
        bytes memory k = Sha384.K;
        bytes memory buf = new bytes(112);
        (bytes32 dHi, bytes16 dLo) = Sha384.hash("abc");
        (bytes32 hi, bytes16 lo) = Sha384.extend(k, buf, bytes32(0), bytes16(0), dHi, dLo);
        // hashlib : sha384(bytes(48) + sha384(b"abc").digest())
        assertEq(
            abi.encodePacked(hi, lo),
            hex"93732e3733514a841c982cfa75ea76ab55fe011acb9cd980ef4523913c65be1b0998e04d77f8c174f81a82151619ca40"
        );
        // and for any register: the same as hash(mr ‖ d)
        (bytes32 h2, bytes16 l2) = Sha384.extend(k, buf, hi, lo, dHi, dLo);
        assertEq(abi.encodePacked(h2, l2), _h(abi.encodePacked(hi, lo, dHi, dLo)));
    }

    function test_extend_revertsOnShortBuffer() public {
        Harness hh = new Harness();
        vm.expectRevert();
        hh.extendShort();
    }

    // ---- memory safety: the scratch area (beyond the free memory pointer) overwrites nothing allocated ----

    function test_memorySafety_allocatedMemoryUntouched() public pure {
        bytes memory before = _stream(500); // allocated BEFORE hashing
        bytes32 tag = keccak256(before);
        bytes memory data = _stream(333);
        uint256 fmpBefore;
        assembly ("memory-safe") {
            fmpBefore := mload(0x40)
        }
        bytes memory got = _h(data);
        uint256 fmpAfter;
        assembly ("memory-safe") {
            fmpAfter := mload(0x40)
        }
        bytes memory after_ = _stream(500); // allocated AFTER: expected content, despite the reused scratch area
        assertEq(keccak256(before), tag, "memoire allouee avant : intacte");
        assertEq(keccak256(data), keccak256(_stream(333)), "message intact");
        assertEq(keccak256(after_), tag, "allocation suivante correcte");
        assertEq(got, Sha384Ref.hash(_stream(333)));
        // only allocations: the K table (640 + 32 bytes) and the result of abi.encodePacked (48 + 32 → 96)
        assertLe(fmpAfter - fmpBefore, 640 + 32 + 96 + 64, "aucune fuite de memoire");
    }

    /// @dev hashAt on an unaligned pointer in the middle of a buffer (full blocks read in place).
    function test_hashAt_unalignedPointer() public pure {
        bytes memory buf = _stream(400);
        bytes memory k = Sha384.K;
        uint256 p;
        assembly ("memory-safe") {
            p := add(add(buf, 0x20), 7)
        }
        (bytes32 hi, bytes16 lo) = Sha384.hashAt(k, p, 300);
        bytes memory slice = new bytes(300);
        for (uint256 i = 0; i < 300; i++) {
            slice[i] = buf[7 + i];
        }
        assertEq(abi.encodePacked(hi, lo), Sha384Ref.hash(slice));
    }

    // ---- gas ----

    /// @dev Cost of one compression (one 128-byte block) and of one register extension (96 bytes = 1 block).
    ///      Regression guard: the first version (8 variables, 8 unrolled rounds) cost ≈ 700k gas per block
    ///      under via_ir (variables moved to memory, expressions recomputed); the packed state costs ≈ 55k.
    function test_gas_perBlock() public {
        Harness hh = new Harness();
        uint256 g1 = hh.gasOf(_stream(100)); // 1 block
        uint256 g2 = hh.gasOf(_stream(228)); // 2 blocks
        uint256 g9 = hh.gasOf(_stream(1100)); // 9 blocks
        uint256 ge = hh.gasOfExtend();
        emit log_named_uint("SHA-384, 1 bloc (100 octets), gaz", g1);
        emit log_named_uint("SHA-384, 2 blocs (228 octets), gaz", g2);
        emit log_named_uint("SHA-384, 9 blocs (1100 octets), gaz", g9);
        emit log_named_uint("SHA-384, par bloc supplementaire, gaz", (g9 - g1) / 8);
        emit log_named_uint("extension RTMR (SHA384(mr || d)), gaz", ge);
        assertLt((g9 - g1) / 8, 60_000);
    }
}

/// @dev External calls: isolated gas measurement, and expected revert.
contract Harness {
    function gasOf(bytes memory data) external view returns (uint256 used) {
        uint256 g = gasleft();
        Sha384.hash(data);
        used = g - gasleft();
    }

    function gasOfExtend() external view returns (uint256 used) {
        bytes memory k = Sha384.K;
        bytes memory buf = new bytes(112);
        uint256 g = gasleft();
        Sha384.extend(k, buf, bytes32(uint256(1)), bytes16(uint128(2)), bytes32(uint256(3)), bytes16(uint128(4)));
        used = g - gasleft();
    }

    function extendShort() external pure {
        bytes memory k = Sha384.K;
        bytes memory buf = new bytes(111);
        Sha384.extend(k, buf, bytes32(0), bytes16(0), bytes32(0), bytes16(0));
    }
}
