# @arcvault/sdk

The TypeScript client for ArcHive, the open network of verified enclaves on Arc. The site, the API, the MCP server, the registrar and the `arcvault` CLI are all built on it.

What it covers:

- **Registry reads**: products, enclaves, operators, bonds and the verified level (machine binding, Proof of Cloud).
- **Attestation**: TDX quote parsing and checks, the dstack RTMR3 event log, enclave keys bound in REPORTDATA.
- **Sessions**: open, top up, rotate and close a SessionPay session; verify the enclave-signed receipts.
- **Private inference**: HPKE-sealed requests to an enclave and an OpenAI-compatible client.
- **x402 pay per call**: EIP-3009 `ReceiveWithAuthorization` payments and the settlement queue the registrar uses.
- **Sealed Bounty**: create, fund, submit, refute and read bounties.
- **CCTP** and native USDC helpers.

The SDK targets Arc testnet (chainId 5042002). `testnet` in `src/network.ts` is the live v2.1 stack (`deployments.v21.testnet.json`). `deploymentFromJson()` loads any `deployments.*.json` file at the repository root.

Messages, logs and errors are in English. A few values stay French on purpose, because the console shows them as they are in French. They are the `fr` field of receipt and call checks, `ARC_ERRORS_FR` and `explainArcError`, `ENCLAVE_KEY_MISMATCH_FR` with the details of a refused enclave key, and the French entries of the copilot client's refusal table.

## Run it

```sh
npm ci
npm test          # vitest, 81 tests
npm run build     # tsc
```

The package is private and is used from source (`file:` links), not from npm. The npm scope `@arcvault` is shared by every package in this repository.

## Operator scripts

`scripts/` holds operator scripts for Arc testnet (end-to-end runs, measurements, settlement, x402 calls, bounty demos). Run one with `npx tsx scripts/<name>.ts`. The scripts that send transactions read a funded testnet key from `.secrets/deployer.json` at the repository root. Git ignores `.secrets/`, so the key is never committed.
