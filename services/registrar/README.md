# Registrar

The operator's service that keeps one enclave registered on Arc testnet and gets the operator paid.

- **Registration**: the registry counts an enclave's validity window in blocks (`VALIDITY_BLOCKS` ≈ 24 h). The registrar renews the registration before the window ends: it fetches a fresh quote from the enclave, checks it off-chain, then calls `registerEnclave`, where the contract verifies Intel's signature through DCAP. Renewed with no gap, the window is extended and receipts already issued stay settleable.
- **Restarts**: an enclave's keys live in memory, so a restart gives it a new key. The registrar retires the previous key, which releases its bond reserve.
- **Verified level**: it binds the enclave to its machine (`MachineRegistry.bindMachine`, PPID read from Intel's certificate) and renews the Proof of Cloud attestation before it expires (`ProofOfCloudAuditor`).
- **Settlement**: it reads the product's settlement contract on-chain. For `SessionPay`, it settles each session's latest enclave-signed receipt. For `X402Settler`, it settles each paid call within seconds, through one queue, with no double settlement.

The registrar never allows an image: that is the product author's decision.

## Run it

```sh
npm ci
npm start          # tsx --env-file=.env src/server.ts
```

`.env` is git-ignored. Required: `ENCLAVE_URL` and `ARC_PK` (the operator key). Optional: `DEPLOYMENTS` (path to a `deployments.*.json` file; the default is the SDK's v2.1 stack), `PRODUCT_ID`, `RPC_URL`, `CHECK_MINUTES` (10), `INTERVAL_HOURS` (12), `RENEW_BEFORE_HOURS`, `RETIRE_PREVIOUS`, `LEVELS`, `LEVELS_POC_RENEW_DAYS` (3), `LEVELS_PROOF_OF_CLOUD`, `SETTLE`, `SETTLE_MIN_MICRO_USDC` (20000), `SETTLE_BEFORE_END_S` (1800), `SESSION_SCAN_FROM_BLOCK`, `SESSION_SCAN_PAUSE_MS` (300), `X402_CHECK_SECONDS` (10), `X402_UNCOVERED_CHECKS` (25). `ONCE=1` runs a single pass, for a trial or a scheduled job.

The package has no unit tests of its own; the SDK pieces it relies on, such as receipt checks and the x402 settlement queue, are tested in `packages/sdk/test`.
