# Proofs and contracts on Arc testnet

Back to the [README](../README.md). Every link opens the transaction or the contract on Arc's explorer.

## Proofs on Arc testnet

**20 Nov 2026 (UTC), the live v3 stack**

| What it proves | Time | Transaction |
|---|---|---|
| The five products' workloads and policies set on-chain, and product 5's manifest updated: the v3 stack serves all five | 11:00 | [`0x97903745…58ae`](https://explorer.testnet.arc.io/tx/0x97903745a141230b581af9c0827441517476cb31656e821b6aa0357e7b4e58ae), [`0x8d4ae669…738c`](https://explorer.testnet.arc.io/tx/0x8d4ae6693fa4fc9443dacb2ff2ab78f81ae3a35e7ba75afa3b840a83ef53738c) then [`0x9d04f9ab…4a05`](https://explorer.testnet.arc.io/tx/0x9d04f9ab5d19d11d2d51043edccf4b5627752730e7bde3e8b5c3c8794a494a05) |
| The five v3 enclaves admitted by `EnclaveRegistry` (Intel DCAP, boot-log replay, policy), one per product: 2, 5, 4, 1 and 3 | 11:19–11:23 | [`0xf7d24e86…989f`](https://explorer.testnet.arc.io/tx/0xf7d24e863126f9124a0536cf936ade912d996f34cf5bde9c61bd63cd8c83989f), [`0x6d7d0817…a360`](https://explorer.testnet.arc.io/tx/0x6d7d0817a76c02db8734fba57f0a78b87d33812bc021e1790f3878c2242fa360), [`0x1de729e2…0ca5`](https://explorer.testnet.arc.io/tx/0x1de729e24812fb146ca68e57b21664dd5f6e3404312c3f6cfbfa0e8d3fb90ca5), [`0x2de231e7…6a6a`](https://explorer.testnet.arc.io/tx/0x2de231e77dcde776204eb2067a3985f532f0581d9f2abd4d0ae26cd8eab16a6a), [`0x0e9bf7e1…2111`](https://explorer.testnet.arc.io/tx/0x0e9bf7e1752ca575ef1c6296b57f433f2900a7bef554334c55c47f53eac92111) |
| Product 3 calls paid from a Circle developer-controlled wallet (EOA [`0xA7f3…39e5`](https://explorer.testnet.arc.io/address/0xA7f3c1681782334F04B7Fd6dE4Fce3c4328f39e5) on `ARC-TESTNET`; Circle signs each EIP-3009 authorization) and settled by `X402Settler` | 11:46–12:13 | [`0x1318d65c…7cd0`](https://explorer.testnet.arc.io/tx/0x1318d65c5829c9689ba7fc3c717a5bdca1b564cc8590bdc183ff1ee4f0ff7cd0), [`0x95e417e3…aa07`](https://explorer.testnet.arc.io/tx/0x95e417e384dc27ff320f54513ce8687496c65375e6afb4ba4a5d41c9f29faa07), [`0x4c80cffb…2ba0`](https://explorer.testnet.arc.io/tx/0x4c80cffb90d6010f4237c18ac86e7199084e4b5107458ffb09d2cba275912ba0), [`0xe10d32ec…8434`](https://explorer.testnet.arc.io/tx/0xe10d32ecdafd173a67b7785ef546217af416651b4bbefe0656b5084774d28434) |
| Session #1 on product 1: opened with USDC prepaid into `SessionPay`, then settled on the enclave's signed receipt | 11:49, 11:52 | open [`0xdef2312c…7d72`](https://explorer.testnet.arc.io/tx/0xdef2312cb0187f5d59dc0ec4387ddc302c6d05e7b8adeb045179e0e511817d72), settle [`0x3f63d73f…4ad8`](https://explorer.testnet.arc.io/tx/0x3f63d73f244bc8c5fd1ab1433a901c744514fd1e3264bd3f710178111ab44ad8) |
| A paid call to product 3 (x402, 0.01 USDC) settled by `X402Settler` | 11:55 | [`0x8925bc66…0236`](https://explorer.testnet.arc.io/tx/0x8925bc660e65428b1f85a71db4626d2108e44ca44858d2bd28e34d37c1c90236) |
| OpenCode on product 3 through `opencode-arc`: the session title, OpenCode's Glob tool call and the answer, each paid and settled | 12:06 | [`0x68b6fd05…b637`](https://explorer.testnet.arc.io/tx/0x68b6fd05bceb90684cd1daefc7a14959469103de990ea315fff8f8691d74b637), [`0x547006bc…e8f0`](https://explorer.testnet.arc.io/tx/0x547006bc63ee77542c7783df5c48dcf50cd0daa2ec2e3bdd2ad5368c5d76e8f0), [`0xf23fe1ac…2c72`](https://explorer.testnet.arc.io/tx/0xf23fe1acc4337d5c7ecce5d99285d2acd0f8f82f3c21252e7a0bf587788a2c72) |

**19 Nov 2026 (UTC), the v3 stack deployed and wired**

| What it proves | Time | Transaction |
|---|---|---|
| `EnclaveRegistry` deployed: admits a machine after Intel DCAP, boot-log replay and policy | 20:33 | [`0xdf5d2ad6…9049`](https://explorer.testnet.arc.io/tx/0xdf5d2ad6529eb2bfdbc0f4dfda4368822cbe03eb7ee7b3087f145065f5679049) |
| `TdxAttestationModule` deployed: calls Automata's DCAP verifier on Arc | 20:33 | [`0xb70b7086…238a`](https://explorer.testnet.arc.io/tx/0xb70b70868acc9c9ca4c64ae66279d68a936be6c950668cb603e6b286cb4f238a) |
| `OperatorBond` and `VerdictLog` wired to the settlements at initialize: the bond bounds and slashes, the log writes verdicts | 20:37 | [`0x92233e31…6b15`](https://explorer.testnet.arc.io/tx/0x92233e31fefe8f153e2dd0be939910344a8cad4ec56df056618f482984796b15), [`0x5ef23fa5…58f6`](https://explorer.testnet.arc.io/tx/0x5ef23fa5074e01b5711ae7e868957d1c89a16a41e791fe716023bbb6b16358f6) |
| Product 5, the verified bounty, published with its 1 USDC level | 20:42 | propose [`0xd5ebcd8d…acf3`](https://explorer.testnet.arc.io/tx/0xd5ebcd8d7150c6e8672ad2831e2e706e3f0fc6850828f59dc0841a2a0a6bacf3), activate [`0xb3589c76…df83`](https://explorer.testnet.arc.io/tx/0xb3589c76e92930ac1f32173b3c63aae17867a719c87d7e43df31a05fbf39df83) |
| Every one of the 14 contracts deployed and checked (code, receipt, wiring) | 20:33–20:37 | 14 transactions in [`deployments.v3.testnet.json`](../deployments.v3.testnet.json) |

The site keeps the full proof chain of a live enclave: image, Intel measurement, Arc admission, signed answer, USDC
payment and ERC-8004 verdict. Read it with `curl -s https://arc-hive.xyz/api/proof`.

## Contracts on Arc testnet (chainId 5042002)

**Live stack, v3 (14 contracts in service).** Every address and deployment transaction is in
[`deployments.v3.testnet.json`](../deployments.v3.testnet.json): the 13 core contracts, rebuilt from
[`contracts/src`](../contracts/src), plus `DemoVault`, a bounty-demo target (`migrate` deliberately has no access control),
and Intel's verifier in [`deployments.dcap.testnet.json`](../deployments.dcap.testnet.json).
Every settlement contract is authorized at initialization, and five products are published. The source is verified on
Arc's explorer: Ed25519Verifier is a full match, the 12 others partial (the published source compiles to the exact
bytecode on Arc; only the metadata hash differs, because the comments changed after deployment).

| Contract | Address | Role |
|---|---|---|
| EnclaveRegistry | [`0xc854ebA7C28f4b53f50018EAcF40D617Ba76e38E`](https://explorer.testnet.arc.io/address/0xc854ebA7C28f4b53f50018EAcF40D617Ba76e38E) | admits a machine after Intel DCAP, boot-log replay and policy |
| TdxAttestationModule | [`0x3275fA3b519FAD912eA4a5e75Bf5078Def29D491`](https://explorer.testnet.arc.io/address/0x3275fA3b519FAD912eA4a5e75Bf5078Def29D491) | calls Automata's DCAP verifier on Arc |
| ProductRegistry | [`0xd2e6f3fD0561C8823774A8C7054B414777E0228d`](https://explorer.testnet.arc.io/address/0xd2e6f3fD0561C8823774A8C7054B414777E0228d) | products, prices, shares, allowed images, timelocks |
| OperatorBond | [`0x19C3438E997c2C513aA5E7D2dDd2666532095dd4`](https://explorer.testnet.arc.io/address/0x19C3438E997c2C513aA5E7D2dDd2666532095dd4) | USDC bonds, exposure cap, slashing |
| SessionPay | [`0x606c379cd8758E3562e7ECC9972d0feF693F0763`](https://explorer.testnet.arc.io/address/0x606c379cd8758E3562e7ECC9972d0feF693F0763) | prepaid sessions (product 1) |
| X402Settler | [`0x89B0381B18536f680fD952a0E7D375d7a4EC3fe6`](https://explorer.testnet.arc.io/address/0x89B0381B18536f680fD952a0E7D375d7a4EC3fe6) | pay per call, x402 (product 3) |
| SealedBounty | [`0xaA229Eda6b535DF6aEe0B4D892f39e0EC006d308`](https://explorer.testnet.arc.io/address/0xaA229Eda6b535DF6aEe0B4D892f39e0EC006d308) | sealed bounties and refutation (product 2) |
| VerdictLog | [`0x3BEC55d2E50118ceACcD2E0045855123964D78cF`](https://explorer.testnet.arc.io/address/0x3BEC55d2E50118ceACcD2E0045855123964D78cF) | verdicts to the ERC-8004 validation registry on Arc |
| MachineRegistry | [`0xC64e9556AA896b2E8c0bE0fdf3dC7b2c0be24b86`](https://explorer.testnet.arc.io/address/0xC64e9556AA896b2E8c0bE0fdf3dC7b2c0be24b86) | chip ID (PPID) read from Intel's certificate |
| ProofOfCloudAuditor | [`0xEaf8163fa5Eb2f047d4876bb3Ef2E67250360b73`](https://explorer.testnet.arc.io/address/0xEaf8163fa5Eb2f047d4876bb3Ef2E67250360b73) | verifies the Proof of Cloud alliance's token |
| Ed25519Verifier | [`0xf2c47D6eCD25290C9daa826b3D11AC43baaEcEf6`](https://explorer.testnet.arc.io/address/0xf2c47D6eCD25290C9daa826b3D11AC43baaEcEf6) | Ed25519 (RFC 8032) for that token |
| PolicyEnclaves | [`0x12c0C33C62666AbE0ab03B286b428C554De71BF8`](https://explorer.testnet.arc.io/address/0x12c0C33C62666AbE0ab03B286b428C554De71BF8) | each product's required operator level |
| SealedBountyVerified | [`0x8958EA25c9cF7bbee39B32C43187d854B5d73ee6`](https://explorer.testnet.arc.io/address/0x8958EA25c9cF7bbee39B32C43187d854B5d73ee6) | sealed bounty, verified operators (product 5) |
| DemoVault | [`0xf5D51c805BFa4c1Fb3d5D3B248bEB1841DDc03b8`](https://explorer.testnet.arc.io/address/0xf5D51c805BFa4c1Fb3d5D3B248bEB1841DDc03b8) | bounty-demo target (products 2 and 5) |

Used, not ours: the ERC-8004 validation registry `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` and identity registry
`0x8004A818BFB912233c491871b3d84c89A494BD9e`, as listed by Arc; Automata's DCAP entry point, deployed by us from its
MIT code, `0x48640f7d94dE64b13c89686F3d1240A31Aeb4dc9`; USDC `0x3600000000000000000000000000000000000000`.
