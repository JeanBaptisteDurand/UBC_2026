# Smooth CryptoLib (SCL), partial copy

Source: https://github.com/get-smooth/crypto-lib, commit `d714e9824e2e2e44be3c8fd498e0de651ddc9425` (MIT license,
`LICENSE`). Only the import closure of `src/lib/libSCL_EIP6565.sol` is copied (Ed25519 verification, RFC 8032 /
EIP-6565, SHA-512 included), files unchanged. It verifies the Proof of Cloud alliance's Ed25519 signature on Arc
(`ProofOfCloudAuditor`). Audits of the library (in the original repository, `doc/Audits/`): CryptoExperts (11 Jul 2024)
and Veridise (18 Jul 2024, 6 Sep 2024).

Files copied:

- `external/sha512/LibBytes.sol`
- `external/sha512/Sha2Ext.sol`
- `src/elliptic/SCL_ecOncurve.sol`
- `src/elliptic/SCL_mulmuladdX_fullgenW.sol`
- `src/fields/SCL_secp256r1.sol`
- `src/fields/SCL_wei25519.sol`
- `src/hash/SCL_sha512.sol`
- `src/include/SCL_errcodes.sol`
- `src/include/SCL_field.h.sol`
- `src/include/SCL_mask.h.sol`
- `src/lib/libSCL_EIP6565.sol`
- `src/modular/SCL_modular.sol`
- `src/modular/SCL_sqrtMod_5mod8.sol`
