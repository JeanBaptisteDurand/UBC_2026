// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Sha384 — SHA-384 (FIPS 180-4) in the EVM, without a precompile (v2.1)
/// @notice Used to replay a TDX measurement register (RTMR = SHA384(RTMR ‖ digest)). Arc's EVM has no SHA-384
///         precompile (only SHA-256, at 0x02). Written for this repository from FIPS 180-4 (SHA-512 compression,
///         §6.4; SHA-384 initial values, §5.3.4; output truncated to 384 bits, §6.5), not taken from a third-party
///         library. Checked by test/Sha384.t.sol: FIPS 180-4 vectors ("", "abc", 448 and 896 bits, one million "a"),
///         every length from 0 to 300 bytes against Python's hashlib (each padding case, 1 or 2 final blocks, is
///         covered), a differential (fuzz) test against a naive reference in pure Solidity; table K and initial
///         values recomputed from the prime numbers (cube and square roots).
///
///         Implementation: 64-bit words carried by 256-bit words; rotation by "doubling" (x | x << 64, then shift
///         and mask); K[t] + W[t] precomputed for each block; the working state fits in TWO packed words,
///         s1 = a‖b‖c‖d and s2 = e‖f‖g‖h (64 bits each, a and e first): a round shifts each word by 64 bits and
///         inserts the new a (resp. e) at the front, which rotates the roles without copying. Few live variables:
///         the compiler (via_ir) does not have to move variables to memory. (A version with 8 variables and
///         8 unrolled rounds, written first, was correct but cost ≈ 700k gas per block: via_ir moved it to memory
///         and recomputed the expressions. This one: see test_gas_perBlock.)
///         Working area: 0x1600 bytes beyond the free memory pointer, temporary (never read again after the call),
///         which a "memory-safe" block allows.
library Sha384 {
    /// @notice The 80 SHA-512 constants K (FIPS 180-4 §4.2.3), 8 big-endian bytes each (640 bytes).
    bytes internal constant K =
        hex"428a2f98d728ae227137449123ef65cdb5c0fbcfec4d3b2fe9b5dba58189dbbc"
        hex"3956c25bf348b53859f111f1b605d019923f82a4af194f9bab1c5ed5da6d8118"
        hex"d807aa98a303024212835b0145706fbe243185be4ee4b28c550c7dc3d5ffb4e2"
        hex"72be5d74f27b896f80deb1fe3b1696b19bdc06a725c71235c19bf174cf692694"
        hex"e49b69c19ef14ad2efbe4786384f25e30fc19dc68b8cd5b5240ca1cc77ac9c65"
        hex"2de92c6f592b02754a7484aa6ea6e4835cb0a9dcbd41fbd476f988da831153b5"
        hex"983e5152ee66dfaba831c66d2db43210b00327c898fb213fbf597fc7beef0ee4"
        hex"c6e00bf33da88fc2d5a79147930aa72506ca6351e003826f142929670a0e6e70"
        hex"27b70a8546d22ffc2e1b21385c26c9264d2c6dfc5ac42aed53380d139d95b3df"
        hex"650a73548baf63de766a0abb3c77b2a881c2c92e47edaee692722c851482353b"
        hex"a2bfe8a14cf10364a81a664bbc423001c24b8b70d0f89791c76c51a30654be30"
        hex"d192e819d6ef5218d69906245565a910f40e35855771202a106aa07032bbd1b8"
        hex"19a4c116b8d2d0c81e376c085141ab532748774cdf8eeb9934b0bcb5e19b48a8"
        hex"391c0cb3c5c95a634ed8aa4ae3418acb5b9cca4f7763e373682e6ff3d6b2b8a3"
        hex"748f82ee5defb2fc78a5636f43172f6084c87814a1f0ab728cc702081a6439ec"
        hex"90befffa23631e28a4506cebde82bde9bef9a3f7b2c67915c67178f2e372532b"
        hex"ca273eceea26619cd186b8c721c0c207eada7dd6cde0eb1ef57d4f7fee6ed178"
        hex"06f067aa72176fba0a637dc5a2c898a6113f9804bef90dae1b710b35131c471b"
        hex"28db77f523047d8432caab7b40c724933c9ebe0a15c9bebc431d67c49c100d4c"
        hex"4cc5d4becb3e42b6597f299cfc657e2a5fcb6fab3ad6faec6c44198c4a475817";

    /// @notice SHA-384 of `data`: the 48-byte digest as (hi = bytes 0 to 31, lo = bytes 32 to 47).
    function hash(bytes memory data) internal pure returns (bytes32 hi, bytes16 lo) {
        bytes memory k = K;
        uint256 ptr;
        assembly ("memory-safe") {
            ptr := add(data, 0x20)
        }
        return hashAt(k, ptr, data.length);
    }

    /// @notice SHA-384 of the `len` bytes in memory from `ptr` (ALLOCATED memory, below the free memory pointer).
    ///         `k` = Sha384.K already loaded in memory: the caller loads it once for a series of hashes.
    function hashAt(bytes memory k, uint256 ptr, uint256 len) internal pure returns (bytes32 hi, bytes16 lo) {
        assembly ("memory-safe") {
            // One compression (FIPS 180-4 §6.4.2). Working area at st: state H0..H7 (8 words, 0x100); W[0..79] at
            // st + 0x100; K[t] + W[t] at st + 0xb00; 128-byte block at bp; table K (8 bytes per constant) at kp.
            function compress(st, bp, kp) {
                // W[0..15]: the block, as big-endian 64-bit words; and K[t] + W[t]
                for { let i := 0 } lt(i, 16) { i := add(i, 1) } {
                    let x := shr(192, mload(add(bp, shl(3, i))))
                    let q := add(st, shl(5, i))
                    mstore(add(q, 0x100), x)
                    mstore(add(q, 0xb00), add(x, shr(192, mload(add(kp, shl(3, i))))))
                }
                // W[t] = σ1(W[t-2]) + W[t-7] + σ0(W[t-15]) + W[t-16] (mod 2^64)
                // σ0(x) = ROTR1 ^ ROTR8 ^ SHR7; σ1(x) = ROTR19 ^ ROTR61 ^ SHR6
                for { let i := 16 } lt(i, 80) { i := add(i, 1) } {
                    let p := add(add(st, 0x100), shl(5, i))
                    let x := mload(sub(p, 0x40))
                    let y := or(x, shl(64, x))
                    let s := xor(and(xor(shr(19, y), shr(61, y)), 0xffffffffffffffff), shr(6, x))
                    x := mload(sub(p, 0x1e0))
                    y := or(x, shl(64, x))
                    s := add(s, xor(and(xor(shr(1, y), shr(8, y)), 0xffffffffffffffff), shr(7, x)))
                    s := and(add(s, add(mload(sub(p, 0xe0)), mload(sub(p, 0x200)))), 0xffffffffffffffff)
                    mstore(p, s)
                    mstore(add(p, 0xa00), add(s, shr(192, mload(add(kp, shl(3, i))))))
                }
                // packed state: s1 = a‖b‖c‖d, s2 = e‖f‖g‖h
                let s1 := or(
                    or(shl(192, mload(st)), shl(128, mload(add(st, 0x20)))),
                    or(shl(64, mload(add(st, 0x40))), mload(add(st, 0x60)))
                )
                let s2 := or(
                    or(shl(192, mload(add(st, 0x80))), shl(128, mload(add(st, 0xa0)))),
                    or(shl(64, mload(add(st, 0xc0))), mload(add(st, 0xe0)))
                )
                // 80 rounds: T1 = h + Σ1(e) + Ch(e,f,g) + K[t] + W[t]; T2 = Σ0(a) + Maj(a,b,c);
                // (a,b,c,d,e,f,g,h) <- (T1 + T2, a, b, c, d + T1, e, f, g).
                // Σ0 = ROTR28 ^ ROTR34 ^ ROTR39; Σ1 = ROTR14 ^ ROTR18 ^ ROTR41;
                // Ch = g ^ (e & (f ^ g)); Maj = (a & b) | (c & (a | b)). shl(192, v) keeps only the low 64 bits of v.
                for { let p := add(st, 0xb00) } lt(p, add(st, 0x1500)) { p := add(p, 0x20) } {
                    let e := shr(192, s2)
                    let g := and(shr(64, s2), 0xffffffffffffffff)
                    let x := or(e, shl(64, e))
                    let t := add(
                        add(and(s2, 0xffffffffffffffff), mload(p)),
                        add(
                            and(xor(xor(shr(14, x), shr(18, x)), shr(41, x)), 0xffffffffffffffff),
                            xor(g, and(e, xor(and(shr(128, s2), 0xffffffffffffffff), g)))
                        )
                    )
                    s2 := or(shl(192, add(and(s1, 0xffffffffffffffff), t)), shr(64, s2))
                    let a := shr(192, s1)
                    let b := and(shr(128, s1), 0xffffffffffffffff)
                    x := or(a, shl(64, a))
                    t := add(
                        t,
                        add(
                            and(xor(xor(shr(28, x), shr(34, x)), shr(39, x)), 0xffffffffffffffff),
                            or(and(a, b), and(and(shr(64, s1), 0xffffffffffffffff), or(a, b)))
                        )
                    )
                    s1 := or(shl(192, t), shr(64, s1))
                }
                // H(i) = H(i-1) + (a..h) (mod 2^64)
                mstore(st, and(add(mload(st), shr(192, s1)), 0xffffffffffffffff))
                mstore(add(st, 0x20), and(add(mload(add(st, 0x20)), shr(128, s1)), 0xffffffffffffffff))
                mstore(add(st, 0x40), and(add(mload(add(st, 0x40)), shr(64, s1)), 0xffffffffffffffff))
                mstore(add(st, 0x60), and(add(mload(add(st, 0x60)), s1), 0xffffffffffffffff))
                mstore(add(st, 0x80), and(add(mload(add(st, 0x80)), shr(192, s2)), 0xffffffffffffffff))
                mstore(add(st, 0xa0), and(add(mload(add(st, 0xa0)), shr(128, s2)), 0xffffffffffffffff))
                mstore(add(st, 0xc0), and(add(mload(add(st, 0xc0)), shr(64, s2)), 0xffffffffffffffff))
                mstore(add(st, 0xe0), and(add(mload(add(st, 0xe0)), s2), 0xffffffffffffffff))
            }

            let st := mload(0x40)
            // SHA-384's H(0) (FIPS 180-4 §5.3.4)
            mstore(st, 0xcbbb9d5dc1059ed8)
            mstore(add(st, 0x20), 0x629a292a367cd507)
            mstore(add(st, 0x40), 0x9159015a3070dd17)
            mstore(add(st, 0x60), 0x152fecd8f70e5939)
            mstore(add(st, 0x80), 0x67332667ffc00b31)
            mstore(add(st, 0xa0), 0x8eb44a8768581511)
            mstore(add(st, 0xc0), 0xdb0c2e0d64f98fa7)
            mstore(add(st, 0xe0), 0x47b5481dbefa4fa4)
            let kp := add(k, 0x20)

            // whole blocks, read in place
            for { let end := add(ptr, and(len, not(127))) } lt(ptr, end) { ptr := add(ptr, 0x80) } {
                compress(st, ptr, kp)
            }

            // last block(s): rest of the message ‖ 0x80 ‖ zeros ‖ length in bits on 128 bits (§5.1.2)
            let rem := and(len, 127)
            let pad := add(st, 0x1500)
            for { let i := 0 } lt(i, 0x100) { i := add(i, 0x20) } { mstore(add(pad, i), 0) }
            for { let i := 0 } lt(i, rem) { i := add(i, 0x20) } { mstore(add(pad, i), mload(add(ptr, i))) }
            mstore(add(pad, rem), 0) // clears what the word-wise copy took beyond the message
            mstore8(add(pad, rem), 0x80)
            let two := gt(rem, 111) // no room left for 0x80 and the 16 length bytes: two blocks
            let lp := add(pad, add(0x60, shl(7, two))) // last word of the last block
            mstore(lp, or(mload(lp), shl(3, len)))
            compress(st, pad, kp)
            if two { compress(st, add(pad, 0x80), kp) }

            // digest = H0 ‖ … ‖ H5 (384 bits)
            hi := or(
                or(shl(192, mload(st)), shl(128, mload(add(st, 0x20)))),
                or(shl(64, mload(add(st, 0x40))), mload(add(st, 0x60)))
            )
            lo := shl(128, or(shl(64, mload(add(st, 0x80))), mload(add(st, 0xa0))))
        }
    }

    /// @notice Extension of a TDX measurement register: SHA384(mr ‖ d), 48 + 48 bytes. `buf`: at least 112 bytes
    ///         allocated by the caller, reused from one extension to the next; `k` as for hashAt.
    function extend(bytes memory k, bytes memory buf, bytes32 mrHi, bytes16 mrLo, bytes32 dHi, bytes16 dLo)
        internal
        pure
        returns (bytes32, bytes16)
    {
        require(buf.length >= 112);
        uint256 ptr;
        assembly ("memory-safe") {
            ptr := add(buf, 0x20)
            mstore(ptr, mrHi)
            mstore(add(ptr, 0x20), mrLo)
            mstore(add(ptr, 0x30), dHi)
            mstore(add(ptr, 0x50), dLo)
        }
        return hashAt(k, ptr, 96);
    }
}
