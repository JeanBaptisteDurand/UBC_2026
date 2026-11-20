# Phala Cloud compose files (measured)

Each file here is the docker-compose of one ArcHive enclave on Phala Cloud (dstack, Intel TDX). dstack does not hash
this file on its own: it hashes the VM's whole `app-compose.json`, and each file here is one field of that JSON. One
changed byte in a file, a comment or a space included, gives another compose-hash and so another image fingerprint.
These files therefore stay exactly as deployed, with their original comments. Most of those comments are in French;
the two refutation-demo files are in English. This page describes every file in English.

## What is measured, exactly

1. **The compose-hash.** A Phala VM boots from an `app-compose.json`. Its `docker_compose_file` field holds one of the
   files in this folder as a string, every byte of it. Its other fields are the pre-launch script
   (`pre_launch_script`, which among other things logs in to the image registry), the names of the encrypted
   variables (`allowed_envs`) and dstack's options (`name`, `kms_enabled`, `gateway_enabled`, `public_logs`,
   `no_instance_id`, `runner` and a few more). The compose-hash is the SHA-256 of that JSON, written compact, with
   sorted keys and UTF-8 text left unescaped.
2. **The event in RTMR3.** Before the application starts, dstack extends the TDX register RTMR3 with a runtime event
   named `compose-hash` whose payload is those 32 bytes. In the event format of our enclaves' logs, the event's digest
   is SHA-384(`01 00 00 08` ‖ `:compose-hash:` ‖ payload), and RTMR3 becomes SHA-384(RTMR3 ‖ digest). The other
   runtime events include `os-image-hash` and `system-ready`; some are specific to the VM instance.
3. **The check on Arc.** When an admission carries the RTMR3 event log, as ours do, `EnclaveRegistry.registerEnclave`
   replays the whole log in the EVM (`../../contracts/src/lib/DstackEventLog.sol`) and reverts unless the result
   equals the RTMR3 of the Intel-signed quote. It reads `compose-hash` and `os-image-hash` only among the events
   before the first `system-ready`, and only if each appears exactly once.
4. **The image fingerprint.** The value that a product's author allows is keccak256(MRTD ‖ RTMR0 ‖ RTMR1 ‖ RTMR2 ‖
   compose-hash ‖ os-image-hash ‖ XFAM ‖ TDATTRIBUTES) (`EnclaveRegistry.imageIdOf`). RTMR3 itself is left out,
   because it also holds events specific to the instance. MRTD and RTMR0 to RTMR2 depend on the firmware, the OS
   image and the VM size, not on the compose. The registry emits the fingerprint, the compose-hash and the
   os-image-hash in an `EnclaveImage` event.

What follows for a reader who wants to recompute it:

- **The YAML alone does not give the compose-hash.** The other fields of `app-compose.json` count too, and this
  repository does not hold them: the app-compose.json files saved from our Phala VMs are kept outside it.
- **With an app-compose.json**, set `docker_compose_file` to the file from this folder, unchanged, and take the
  SHA-256 of the canonical JSON. `../../services/copilot/src/enclave-site-measure.ts` does it (`appComposeFor`,
  `composeHashOf`) with no network and no key, and prints the fingerprint it predicts for a VM of the same size, OS
  image and firmware as the console copilot's.
- **Against Arc**, the `EnclaveImage` event of an enclave's admission transaction carries the compose-hash, the
  os-image-hash and the fingerprint.
- **The program enters the measurement only through the image digest** written in the file (`image: …@sha256:…`).
  The compose-hash proves which image ran, not what is inside it. Checking what is inside means pulling that image by
  its digest, or rebuilding it from these sources (`../README.md`, "Build the images"; this repository does not
  rebuild the deployed digests byte for byte today).

**Checked on 20 Nov 2026.** The six `*-v21.yml` files, `sealed-chat-v2.yml` and `sealed-bounty-v2.yml` are byte for
byte the `docker_compose_file` of the app-compose.json saved from their Phala VMs on 14 Nov 2026
(`sealed-bounty-v1.yml` has no saved VM to compare with). `copilot-site-v22.yml`, set into the app-compose.json of the
console copilot's v2.1 VM, gives the compose-hash `0xc5efc024…8a37`. That is the compose-hash in the `EnclaveImage`
event of AskHive's admission transaction
[`0xde9628b2…0176`](https://explorer.testnet.arc.io/tx/0xde9628b23d0483bb666a0cd13c55c4f32a1204151323a80da9451b0aeb330176)
(status 1), next to the image fingerprint `0x5771d334…ebe0`. So the site enclave booted from exactly that JSON.

What every file has in common:

- The image is pinned by digest (`image: ghcr.io/…@sha256:…`).
- Every setting written in clear is measured, including the model and its URL for the inference and copilot enclaves.
  An operator cannot change the code, the prompt or the model under the "attested" badge.
- Only secrets and the operator allowlist are encrypted environment variables. Their values are not measured; their
  names are, in `allowed_envs`. They are the model provider's API key, `OPERATOR_ALLOWLIST`, the copilot's proxy
  token and the image registry credentials.

## Live stack, v2.1 (Arc testnet)

| File | Product | What runs |
|---|---|---|
| `sealed-chat-v21.yml` | 1 and 3 | Private AI: prepaid sessions and x402 pay per call |
| `sealed-bounty-v21.yml` | 2 | Sealed Bounty, open level |
| `sealed-bounty-verified-v21.yml` | 7 | Sealed Bounty, verified level |
| `refute-demo-liar-v21.yml` | 5 | Refutation demo: the enclave with a declared fault |
| `refute-demo-honest-v21.yml` | 5 | Refutation demo: the two honest enclaves |
| `copilot-v21.yml` | 4 | AskHive, console surface |
| `copilot-site-v22.yml` | 4 | AskHive, the site's assistant panel |

**`sealed-chat-v21.yml` (products 1 and 3).** Two services of the same image run in one TDX VM: prepaid sessions
(`SessionPay`, port 8802) and x402 pay per call (`X402Settler`, port 8804). The VM runs the production OS image
dstack-0.5.12, with no SSH access. With `MODEL_ATTESTATION=aci`, the enclave verifies the model gateway before any
call. The gateway is RedPill's Attested Confidential Inference: an Intel quote, bound keys, a measured compose and a
production OS image. The enclave then calls the model over TLS pinned to the attested key. It requires a receipt that
names a verified upstream service (`src/services/model-attestation.ts`). Model: `openai/gpt-oss-120b`.

**`sealed-bounty-v21.yml` (product 2).** The Sealed Bounty at the open level. The enclave replays an exploit on a fork
of Arc with arc-anvil (Arc Foundry, with Arc's precompiles) and refutes accepted claims (`/v1/refute`). Production OS
image dstack-0.5.12; the logs are not public.

**`sealed-bounty-verified-v21.yml` (product 7).** The same replay, at the verified level. The bounty is wired to
`PolicyEnclaves`: an enclave counts only if an accepted verifier, the Proof of Cloud alliance, declares its machine.
It runs on the level stack redeployed after the security review (`MachineRegistry 0xd671…`,
`SealedBountyVerified 0x36a8…`). State proofs are off in this deployment: the replay forks Arc through
`FORK_RPC_URL`, as product 2 does. State proofs need an RPC that serves historical `eth_getProof`. No public Arc RPC
did when we measured it on 12 Nov 2026. Setting `STATE_PROOF_RPC_URL` turns them on.

**`refute-demo-liar-v21.yml` (product 5).** The Sealed Bounty image with a deliberate fault written in clear, so the
fault is measured: `DEMO_FAULT=inflate-loss` makes the enclave sign its claims with a doubled loss. The same image
refuses to start with `DEMO_FAULT` on product 2, and it announces the fault on `/pubkeys` and `/health`. Its operator
is demo key A, never the main operator.

**`refute-demo-honest-v21.yml` (product 5).** The honest Sealed Bounty image, run twice for demo operators B and C
(ports 8803 and 8813). Both replay the liar's claim at the same block and sign an EIP-712 refutation with the loss they
measure. `SealedBounty.refute` needs at least two such operators, none of them a signer of the claim.

**`copilot-v21.yml` (product 4).** AskHive on the console surface: the attested copilot in its own TDX VM. It has a
knowledge base and tools that read Arc and prepare actions the user signs; it holds no key. Its own VM means that a
flaw in the copilot cannot produce quotes for inference or for the bounty. The conversation is encrypted to the
enclave (`ARC-COPILOT-CHAT-v1`), and the reply is sealed for the request. The model gateway is verified as above
(`MODEL_ATTESTATION=aci`).

**`copilot-site-v22.yml` (product 4).** AskHive on the site's assistant panel. This file is the docker-compose of
AskHive's live enclave (image fingerprint `0x5771d334…ebe0`, allowed on Arc on 19 Nov 2026; the check is above). It
runs the same program as the site's assistant: its prompt, interface tools rendered in the browser, prepare tools that
the visitor signs with their own wallet, and `docs_search`. No tool spends funds. Questions arrive encrypted
(`ARC-COPILOT-CHAT-v1`). Each reply is sealed for the request and signed by the enclave key registered on Arc
(`ARC-COPILOT-SITE-REPLY-v1`, `services/copilot/src/enclave-site.ts`). `COPILOT_GLOBAL_PER_DAY` bounds the daily cost.

The copilot enclaves refuse to start with `DEBUG`, and their compose files carry no `env_file` or `NODE_OPTIONS`.

## The header of `copilot-site-v22.yml`, in English

The French comment at the top of `copilot-site-v22.yml` stays as measured. Here it is in English:

> 18 Nov: the attested copilot, SITE surface (v2.1 stack, Arc testnet, product 4). It is the copilot of the assistant
> panel on Florent's site: the SAME program as `/copilot-site/` on the server (prompt, interface tools rendered in the
> browser, prepare tools that the visitor signs with THEIR OWN wallet, `docs_search`; no tool that spends funds), in
> ITS OWN Intel TDX VM (PRODUCTION OS image dstack-0.5.12, tdx.small, node prod9). The question arrives encrypted to
> the enclave (`ARC-COPILOT-CHAT-v1`). Each reply goes back sealed for the request AND signed by the enclave key
> registered on Arc (`ARC-COPILOT-SITE-REPLY-v1`, `services/copilot/src/enclave-site.ts`). `MODEL_ATTESTATION=aci`:
> the enclave VERIFIES the model gateway (RedPill) before any call (Intel quote, production OS image, pinned TLS,
> receipts required; `GET /model-attestation`); otherwise the enclave refuses to start.
>
> EVERYTHING below is measured (compose hash → the image fingerprint that the author of product 4 allows), including
> the surface, the model and its URL: an operator can neither change the prompt nor plug in another model under the
> "attested" badge.
>
> The input limits are those of the site's copilot on the server (`deploy/docker-compose.vps.yml`, service
> `copilot-site`): it reads the data, THEN drives the pages, so a second round of tool calls must stay allowed. The
> cost is bounded by `COPILOT_GLOBAL_PER_DAY`.
>
> ENCRYPTED variables (not measured, never written here): `OPENAI_API_KEY` (the model provider's key),
> `OPERATOR_ALLOWLIST` (the operators' public addresses), `COPILOT_PROXY_TOKEN` (at least 32 bytes, hexadecimal: only
> the site's proxy can ask questions; `/attest`, `/pubkeys`, `/health` and `/model-attestation` stay public), and the
> image registry credentials (`DSTACK_DOCKER_REGISTRY`, `DSTACK_DOCKER_USERNAME`, `DSTACK_DOCKER_PASSWORD`: the launch
> script).
>
> Never `DEBUG`, `env_file` or `NODE_OPTIONS` here (the enclave refuses to start with `DEBUG`).
>
> THE IMAGE: to be replaced with the digest of the push (`docs/RUNBOOK-COPILOT-ENCLAVE.md`, step 2). As long as the
> line holds `REPLACE_WITH_PUSHED_DIGEST`, this file cannot be deployed (no registry serves that digest) and is not
> measured.

The last paragraph was written before the push, when the image line held a placeholder. The image line now pins the
pushed digest (`sha256:22a18ce8…27ec`). The runbook it names is kept outside this repository.

## Earlier stack, v2 (Arc testnet)

| File | Product | What runs |
|---|---|---|
| `sealed-chat-v2.yml` | 1 | Private AI on the v2 stack (model and upstream URL measured, like v2.1) |
| `sealed-bounty-v1.yml` | 2 | Sealed Bounty on the v2 stack, first image: replay by plain anvil on a fork of Arc |
| `sealed-bounty-v2.yml` | 2 | Sealed Bounty on the v2 stack: replay by arc-anvil, with Arc's native precompiles |

These files are the record of the images measured on the v2 stack (`deployments.v2.testnet.json`).
