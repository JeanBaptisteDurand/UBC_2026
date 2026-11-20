# Registrar

The registrar is the operator's service. It keeps one enclave registered on Arc testnet and gets the operator paid.

- **Registration**: the registry counts an enclave's validity window in blocks (`VALIDITY_BLOCKS` ≈ 24 h). The registrar renews the registration before the window ends. It fetches a fresh quote from the enclave and checks it off-chain. Then it calls `registerEnclave`, where the contract verifies Intel's signature through DCAP. A renewal with no gap extends the window, so receipts already issued stay settleable.
- **Restarts**: an enclave keeps its keys in memory, so a restart gives it a new key. The registrar retires the previous key, which releases its bond reserve.
- **Verified level**: the registrar binds the enclave to its machine (`MachineRegistry.bindMachine`, with the PPID read from Intel's certificate). It renews the Proof of Cloud attestation before it expires (`ProofOfCloudAuditor`).
- **Settlement**: the registrar reads the product's settlement contract on-chain. For `SessionPay`, it settles the latest enclave-signed receipt of each session. For `X402Settler`, it settles each paid call within seconds, through one queue, with no double settlement.

The registrar never allows an image. That decision belongs to the product's author.

## Run it

```sh
npm ci
npm start          # tsx --env-file=.env src/server.ts
```

The settings live in `.env`, which git ignores.

| Variable | Default | Role |
| --- | --- | --- |
| `ENCLAVE_URL` | required | The enclave's URL. |
| `ARC_PK` | required | The operator's key, which signs every transaction. |
| `DEPLOYMENTS` | the SDK's v2.1 stack | Path to a `deployments.*.json` file. |
| `PRODUCT_ID` | the stack's inference product | The product the enclave serves. |
| `RPC_URL` | the chain's public RPC | The Arc RPC endpoint. |
| `CHECK_MINUTES` | 10 | Time between two registration checks. |
| `RENEW_BEFORE_HOURS` | 24 − `INTERVAL_HOURS`, at least 1 | Renew when the window ends sooner than this. |
| `INTERVAL_HOURS` | 12 | Sets the default of `RENEW_BEFORE_HOURS`. |
| `RETIRE_PREVIOUS` | on | `0` keeps the previous key after a restart. |
| `LEVELS` | on, when the stack has a levels section | `0` turns off the verified level upkeep. |
| `LEVELS_POC_RENEW_DAYS` | 3 | Renew the Proof of Cloud attestation this many days before it expires. |
| `LEVELS_PROOF_OF_CLOUD` | on | `0` skips the Proof of Cloud renewal. |
| `SETTLE` | on | `0` turns off settlement, for sessions and pay per call. |
| `SETTLE_MIN_MICRO_USDC` | 20000 (0.02 USDC) | Settle a session once it owes this much. |
| `SETTLE_BEFORE_END_S` | 1800 | Settle a session this many seconds before its end. |
| `SESSION_SCAN_FROM_BLOCK` | the start of the enclave's window | First block of the session scan. |
| `SESSION_SCAN_PAUSE_MS` | 300 | Pause between two pages of the session scan. |
| `X402_CHECK_SECONDS` | 10 (at least 5) | Time between two pay-per-call passes. |
| `X402_UNCOVERED_CHECKS` | 25 | Calls the payer's balance does not cover, re-checked per pass. |
| `ONCE` | off | `1` runs a single pass, for a trial or a scheduled job. |

## Tests

The registrar has no unit tests of its own yet. The SDK pieces it calls are tested in `packages/sdk/test`:

- `createX402SettlementQueue`: each call is settled once, even when passes overlap, and each report to the enclave is signed (`x402.test.ts`).
- `verifyReceiptOnChain`: a receipt is checked the way `SessionPay.settle` checks it (`v2.test.ts`).
- `explainArcError` and `arcErrorOf`: every contract error gets a name and an explanation (`v2.test.ts`).
- `deploymentFromJson`: a deployments file becomes a stack, and a missing address throws (`x402.test.ts`).

## What's next

Unit tests against a stub RPC: the renewal window, a single settlement per receipt, and the retirement of the previous key.
