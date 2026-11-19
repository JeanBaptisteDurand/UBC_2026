// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Sha384 — SHA-384 (FIPS 180-4) en EVM, sans précompilé (v2.1)
/// @notice Sert à rejouer un registre de mesure TDX (RTMR = SHA384(RTMR ‖ condensat)). L'EVM d'Arc n'a pas de
///         précompilé SHA-384 (seulement SHA-256, en 0x02). Écrit pour ce dépôt d'après FIPS 180-4 (compression de
///         SHA-512, §6.4 ; valeurs initiales de SHA-384, §5.3.4 ; sortie tronquée à 384 bits, §6.5), pas repris d'une
///         bibliothèque tierce. Vérifié par test/Sha384.t.sol : vecteurs de FIPS 180-4 (« », « abc », 448 et 896 bits,
///         un million de « a »), toutes les longueurs de 0 à 300 octets contre hashlib de Python (chaque cas de
///         bourrage, 1 ou 2 blocs finaux, est couvert), test différentiel (fuzz) contre une référence naïve en Solidity
///         pur ; table K et valeurs initiales recalculées depuis les nombres premiers (racines cubiques et carrées).
///
///         Mise en œuvre : mots de 64 bits portés par des mots de 256 ; rotation par « doublement » (x | x << 64, puis
///         décalage et masque) ; K[t] + W[t] précalculés pour chaque bloc ; l'état de travail tient en DEUX mots
///         empaquetés, s1 = a‖b‖c‖d et s2 = e‖f‖g‖h (64 bits chacun, a et e en tête) : un tour décale chaque mot de
///         64 bits et insère en tête le nouveau a (resp. e), ce qui fait tourner les rôles sans recopie. Peu de
///         variables vivantes : le compilateur (via_ir) n'a pas à déplacer de variables en mémoire. (Une version à
///         8 variables et 8 tours déroulés, écrite d'abord, était juste mais coûtait ≈ 700 k gaz par bloc : via_ir la
///         déplaçait en mémoire et recalculait les expressions. Celle-ci : voir test_gas_perBlock.)
///         Zone de travail : 0x1600 octets au-delà du pointeur de mémoire libre, temporaire (jamais relue après
///         l'appel), ce qu'autorise un bloc « memory-safe ».
library Sha384 {
    /// @notice Les 80 constantes K de SHA-512 (FIPS 180-4 §4.2.3), 8 octets gros-boutistes chacune (640 octets).
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

    /// @notice SHA-384 de `data` : le condensat de 48 octets en (hi = octets 0 à 31, lo = octets 32 à 47).
    function hash(bytes memory data) internal pure returns (bytes32 hi, bytes16 lo) {
        bytes memory k = K;
        uint256 ptr;
        assembly ("memory-safe") {
            ptr := add(data, 0x20)
        }
        return hashAt(k, ptr, data.length);
    }

    /// @notice SHA-384 des `len` octets en mémoire à partir de `ptr` (mémoire ALLOUÉE, sous le pointeur de mémoire
    ///         libre). `k` = Sha384.K déjà chargé en mémoire : l'appelant le charge une fois pour une série de hachages.
    function hashAt(bytes memory k, uint256 ptr, uint256 len) internal pure returns (bytes32 hi, bytes16 lo) {
        assembly ("memory-safe") {
            // Une compression (FIPS 180-4 §6.4.2). Zone de travail à st : état H0..H7 (8 mots, 0x100) ; W[0..79] à
            // st + 0x100 ; K[t] + W[t] à st + 0xb00 ; bloc de 128 octets à bp ; table K (8 octets par constante) à kp.
            function compress(st, bp, kp) {
                // W[0..15] : le bloc, en mots gros-boutistes de 64 bits ; et K[t] + W[t]
                for { let i := 0 } lt(i, 16) { i := add(i, 1) } {
                    let x := shr(192, mload(add(bp, shl(3, i))))
                    let q := add(st, shl(5, i))
                    mstore(add(q, 0x100), x)
                    mstore(add(q, 0xb00), add(x, shr(192, mload(add(kp, shl(3, i))))))
                }
                // W[t] = σ1(W[t-2]) + W[t-7] + σ0(W[t-15]) + W[t-16] (mod 2^64)
                // σ0(x) = ROTR1 ^ ROTR8 ^ SHR7 ; σ1(x) = ROTR19 ^ ROTR61 ^ SHR6
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
                // état empaqueté : s1 = a‖b‖c‖d, s2 = e‖f‖g‖h
                let s1 := or(
                    or(shl(192, mload(st)), shl(128, mload(add(st, 0x20)))),
                    or(shl(64, mload(add(st, 0x40))), mload(add(st, 0x60)))
                )
                let s2 := or(
                    or(shl(192, mload(add(st, 0x80))), shl(128, mload(add(st, 0xa0)))),
                    or(shl(64, mload(add(st, 0xc0))), mload(add(st, 0xe0)))
                )
                // 80 tours : T1 = h + Σ1(e) + Ch(e,f,g) + K[t] + W[t] ; T2 = Σ0(a) + Maj(a,b,c) ;
                // (a,b,c,d,e,f,g,h) <- (T1 + T2, a, b, c, d + T1, e, f, g).
                // Σ0 = ROTR28 ^ ROTR34 ^ ROTR39 ; Σ1 = ROTR14 ^ ROTR18 ^ ROTR41 ;
                // Ch = g ^ (e & (f ^ g)) ; Maj = (a & b) | (c & (a | b)). shl(192, v) ne garde que les 64 bits bas de v.
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
            // H(0) de SHA-384 (FIPS 180-4 §5.3.4)
            mstore(st, 0xcbbb9d5dc1059ed8)
            mstore(add(st, 0x20), 0x629a292a367cd507)
            mstore(add(st, 0x40), 0x9159015a3070dd17)
            mstore(add(st, 0x60), 0x152fecd8f70e5939)
            mstore(add(st, 0x80), 0x67332667ffc00b31)
            mstore(add(st, 0xa0), 0x8eb44a8768581511)
            mstore(add(st, 0xc0), 0xdb0c2e0d64f98fa7)
            mstore(add(st, 0xe0), 0x47b5481dbefa4fa4)
            let kp := add(k, 0x20)

            // blocs entiers, lus en place
            for { let end := add(ptr, and(len, not(127))) } lt(ptr, end) { ptr := add(ptr, 0x80) } {
                compress(st, ptr, kp)
            }

            // dernier(s) bloc(s) : reste du message ‖ 0x80 ‖ zéros ‖ longueur en bits sur 128 bits (§5.1.2)
            let rem := and(len, 127)
            let pad := add(st, 0x1500)
            for { let i := 0 } lt(i, 0x100) { i := add(i, 0x20) } { mstore(add(pad, i), 0) }
            for { let i := 0 } lt(i, rem) { i := add(i, 0x20) } { mstore(add(pad, i), mload(add(ptr, i))) }
            mstore(add(pad, rem), 0) // efface ce que la copie par mots a pris au-delà du message
            mstore8(add(pad, rem), 0x80)
            let two := gt(rem, 111) // plus de place pour 0x80 et les 16 octets de longueur : deux blocs
            let lp := add(pad, add(0x60, shl(7, two))) // dernier mot du dernier bloc
            mstore(lp, or(mload(lp), shl(3, len)))
            compress(st, pad, kp)
            if two { compress(st, add(pad, 0x80), kp) }

            // condensat = H0 ‖ … ‖ H5 (384 bits)
            hi := or(
                or(shl(192, mload(st)), shl(128, mload(add(st, 0x20)))),
                or(shl(64, mload(add(st, 0x40))), mload(add(st, 0x60)))
            )
            lo := shl(128, or(shl(64, mload(add(st, 0x80))), mload(add(st, 0xa0))))
        }
    }

    /// @notice Extension d'un registre de mesure TDX : SHA384(mr ‖ d), 48 + 48 octets. `buf` : au moins 112 octets
    ///         alloués par l'appelant, réutilisés d'une extension à l'autre ; `k` comme pour hashAt.
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
