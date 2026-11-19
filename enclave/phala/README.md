# Phala Cloud compose files (measured)

Each file here is the app-compose of one ArcHive enclave on Phala Cloud (dstack, Intel TDX). dstack measures the whole
file, comments included, into the compose hash, and the image fingerprint that a product's author allows on Arc is
derived from it. These files therefore stay exactly as deployed, with their original comments (written in French).
This page is their English summary.

What every file has in common:

- The image is pinned by digest (`image: ghcr.io/…@sha256:…`), and every setting written in clear is measured,
  including the model and its URL for the inference and copilot enclaves: an operator cannot change the code, the
  prompt or the model under the "attested" badge.
- Only secrets and the operator allowlist are encrypted environment variables, which are not measured: the model
  provider's API key, `OPERATOR_ALLOWLIST`, the copilot's proxy token and the image registry credentials.

## Live stack, v2.1 (Arc testnet)

| File | Product | What runs |
|---|---|---|
| `sealed-chat-v21.yml` | 1 and 3 | Private AI: prepaid sessions (`SessionPay`, port 8802) and x402 pay-per-call (`X402Settler`, port 8804), two services of the same image in one TDX VM (production OS image dstack-0.5.12, no SSH access). With `MODEL_ATTESTATION=aci`, the enclave verifies the model gateway (RedPill, Attested Confidential Inference: Intel quote, bound keys, measured compose, production OS image) before any call, calls the model over TLS pinned to the attested key, and requires a receipt that names a verified upstream service (`src/services/model-attestation.ts`). Model: `openai/gpt-oss-120b`. |
| `sealed-bounty-v21.yml` | 2 | Sealed Bounty, open level: an exploit replayed on a fork of Arc by arc-anvil (Arc Foundry, with Arc's precompiles), and refutation of accepted claims (`/v1/refute`). Production OS image dstack-0.5.12, logs not public. |
| `sealed-bounty-verified-v21.yml` | 7 | Sealed Bounty, verified level: the same replay, settled by the bounty wired to `PolicyEnclaves` (an enclave counts only if its machine is declared by an accepted verifier, the Proof of Cloud alliance), on the level stack redeployed after the security review (`MachineRegistry 0xd671…`, `SealedBountyVerified 0x36a8…`). State proofs are off in this deployment: the replay forks Arc through `FORK_RPC_URL`, as product 2 does. They need an RPC that serves historical `eth_getProof`, which no public Arc RPC did when measured on 12 Nov 2026; setting `STATE_PROOF_RPC_URL` turns them on. |
| `refute-demo-liar-v21.yml` | 5 | Refutation demo: the Sealed Bounty image with a deliberate fault written in clear, so it is measured (`DEMO_FAULT=inflate-loss`: the enclave signs its claims with a doubled loss). The same image refuses to start with `DEMO_FAULT` on product 2 and announces the fault on `/pubkeys` and `/health`. Operator: demo key A, never the main operator. |
| `refute-demo-honest-v21.yml` | 5 | Refutation demo: the honest Sealed Bounty image, run twice for demo operators B and C (ports 8803 and 8813). Both replay the liar's claim at the same block and sign an EIP-712 refutation with the loss they measure; `SealedBounty.refute` needs at least two such operators, none of them a signer of the claim. |
| `copilot-v21.yml` | 4 | AskHive, console surface: the attested copilot (a knowledge base and tools that read Arc and prepare actions the user signs; it holds no key) in its own TDX VM, so a flaw in the copilot cannot produce quotes for inference or for the bounty. The conversation is encrypted to the enclave (`ARC-COPILOT-CHAT-v1`) and the reply is sealed for the request. Model gateway verified as above (`MODEL_ATTESTATION=aci`). |
| `copilot-site-v22.yml` | 4 | AskHive, the site's assistant panel. This file is byte for byte the compose of AskHive's live enclave (image fingerprint `0x5771d334…ebe0`, allowed on Arc on 19 Nov 2026). The same program as the site's assistant: its prompt, interface tools rendered in the browser, prepare tools that the visitor signs with their own wallet, and `docs_search`; no tool spends funds. Questions arrive encrypted (`ARC-COPILOT-CHAT-v1`); each reply is sealed for the request and signed by the enclave key registered on Arc (`ARC-COPILOT-SITE-REPLY-v1`, `services/copilot/src/enclave-site.ts`). Daily cost bounded by `COPILOT_GLOBAL_PER_DAY`. |

The copilot enclaves refuse to start with `DEBUG`, and their compose files carry no `env_file` or `NODE_OPTIONS`.

In `copilot-site-v22.yml`, the image line pins the pushed digest (`sha256:22a18ce8…27ec`). The comment just above it was
written before the push, when that line held a placeholder, and refers to a runbook kept outside this repository; it
stays because the file is measured as deployed.

## Earlier stack, v2 (Arc testnet)

| File | Product | What runs |
|---|---|---|
| `sealed-chat-v2.yml` | 1 | Private AI on the v2 stack (model and upstream URL measured, like v2.1). |
| `sealed-bounty-v1.yml` | 2 | Sealed Bounty on the v2 stack, first image: replay by plain anvil on a fork of Arc. |
| `sealed-bounty-v2.yml` | 2 | Sealed Bounty on the v2 stack: replay by arc-anvil, with Arc's native precompiles. |

These are kept as the record of the images measured on the v2 stack (`deployments.v2.testnet.json`).
