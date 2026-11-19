# Libraries used by the contracts

| Library | Version | License | How it is obtained | Why |
|---|---|---|---|---|
| solady (`LibString`, `Base64`) | 0.0.160, the copy inside Automata's DCAP repository | MIT | vendored here, files unchanged (sha256 checked); see [`solady-0.0.160/VENDORED.md`](solady-0.0.160/VENDORED.md) | the same version compiled into Automata's DCAP verifier on Arc, so `PckChip` reads the PCK certificate exactly as Automata does |
| Smooth CryptoLib (Ed25519, RFC 8032 / EIP-6565) | commit `d714e982` | MIT | vendored here, import closure only, files unchanged; see [`smooth-crypto-lib/VENDORED.md`](smooth-crypto-lib/VENDORED.md) | verifies the Proof of Cloud alliance's Ed25519 signature on Arc; audited by CryptoExperts and Veridise in 2024 |
| OpenZeppelin Contracts | v5.1.0 | MIT | `forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git` (git-ignored) | EIP-712 domains, ECDSA recovery and the ERC-20 interface in `src/`; a test ERC-20 |
| forge-std | v1.17.0 | MIT or Apache-2.0 | `forge install foundry-rs/forge-std@v1.17.0 --no-git` (git-ignored) | tests and deploy scripts |

The full build and test commands are in [`../README.md`](../README.md).
