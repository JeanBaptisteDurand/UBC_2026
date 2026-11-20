# Enclave kit and products

This folder holds the code that runs inside ArcHive's Intel TDX enclaves on Phala Cloud (dstack). It has three parts:
the enclave kit that every product shares, the product servers, and the recipes of their images. The measured compose
files in `phala/` pin those images by digest.

## The enclave kit (`src/kit`, `src/server`)

- **Keys created in memory.** At start-up the enclave creates a secp256k1 signing key (its `signer` address) and an
  X25519 encryption key (HPKE). Neither key is ever written to disk.
- **`POST /attest`** (operator): `{ operator, anchorR }` → `{ quote, eventLog, signer, x25519, … }`. The REPORTDATA of
  the dstack TDX quote carries two bindings. Bytes 0 to 31 bind the chain, the registry, the product, the operator and
  the enclave keys. Bytes 32 to 63 hold the hash of a recent Arc block. `EnclaveRegistry` checks both on Arc (policies
  P6 and P7, see `../dcap-integration/README.md`).
- **Bound to one operator.** `/attest` fails closed. An address outside `OPERATOR_ALLOWLIST` gets 403, and an unset or
  empty allowlist authorizes nobody (development mode is the explicit `OPERATOR_ALLOWLIST=*`). If the enclave's key is
  already registered on Arc for another operator, the answer is 409. If Arc cannot be read through the kit's RPC
  quorum, the answer is 503.
- **`GET /pubkeys`** and **`GET /health`** are public. Signing, sealing, opening and the RPC relay stay inside the
  services and are never exposed over HTTP.

## Products and entry points

| Product (see the root README) | Entry point | Port | Image | Compose |
|---|---|---|---|---|
| 1, Private AI, prepaid session (`SessionPay`) | `products/sealed-chat/server.ts` → `dist/sealed-chat.mjs` | 8802 | `Dockerfile` | `phala/sealed-chat-v21.yml` |
| 3, Private AI, pay per call (x402, `X402Settler`) | `products/sealed-x402/server.ts` → `dist/sealed-x402.mjs` | 8804 | `Dockerfile` | `phala/sealed-chat-v21.yml` (second service) |
| 2 and 7, Sealed Bounty, open and verified levels; 5, the refutation demo | `products/sealed-bounty/server.ts` → `dist/sealed-bounty.mjs` | 8803 | `Dockerfile.bounty` | `phala/sealed-bounty-v21.yml`, `phala/sealed-bounty-verified-v21.yml`, `phala/refute-demo-*.yml` |
| 4, AskHive, the attested copilot (console and site surfaces) | `../services/copilot/src/enclave-server.ts` → `copilot-enclave.mjs` | 8808 | `Dockerfile.copilot` | `phala/copilot-v21.yml`, `phala/copilot-site-v22.yml` |

The Sealed Bounty replays an exploit with arc-anvil, the anvil of Circle's Arc Foundry. It forks Arc at block N with
Arc's precompiles (native USDC, blocklist, EIP-7708 logs). The copilot holds no key: it prepares actions that the user
signs with their own wallet.

## Measured compose files

`phala/` holds the docker-compose of each enclave. dstack does not hash these files on their own. It hashes the VM's
whole `app-compose.json`, whose `docker_compose_file` field holds the file, every byte of it, comments included. The
other fields (the pre-launch script, the names of the encrypted variables, dstack's options) are not in this
repository. That SHA-256, the compose-hash, goes into the TDX register RTMR3 as the `compose-hash` event. Arc replays
the RTMR3 event log against the Intel-signed quote and puts the compose-hash into the image fingerprint that a product
allows. One changed byte in a file therefore gives another fingerprint, so the files stay exactly as deployed.
`phala/README.md` gives the exact chain, how to recompute it, and the check of 20 Nov 2026 against Arc. It also
describes each file in English.

`docker-compose.bounty.yml` is a template of the Sealed Bounty machine's docker-compose (a real replay by anvil on a
fork of Arc at block N). It leaves the image digest as a parameter; the deployed files in `phala/` pin it in clear.

## Build the images

Each Dockerfile pins its base image by digest and installs dependencies with `npm ci` from the lockfile. The headers
of `Dockerfile` and `Dockerfile.copilot` give the steps for a reproducible build: fixed timestamps and no provenance
manifest.

The image digests pinned in the measured compose files were built on the server from earlier states of these
sources. This repository does not rebuild them byte for byte today. What runs in each enclave is the image that its
measured compose file pins by digest.

```bash
# from enclave/: sealed-chat and sealed-x402 (one image, two entry points)
docker buildx build --platform linux/amd64 --no-cache --provenance=false --sbom=false --build-arg SOURCE_DATE_EPOCH=0 \
  --output type=oci,dest=archive-sealed-chat.oci.tar,rewrite-timestamp=true .

# from enclave/: the Sealed Bounty (arc-anvil pinned by version and sha256)
docker build --platform linux/amd64 -f Dockerfile.bounty -t archive-sealed-bounty .

# from the repository root: the copilot (code from packages/sdk, services/copilot and enclave/)
SOURCE_DATE_EPOCH=1794960000 docker buildx build --platform linux/amd64 -f enclave/Dockerfile.copilot \
  --provenance=false --sbom=false --build-arg SOURCE_DATE_EPOCH \
  --output type=docker,name=archive-copilot-enclave:v22-site,rewrite-timestamp=true .
```

## Tests

```bash
# from the repository root
(cd contracts && forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git && forge build)
(cd packages/sdk && npm ci)                             # the tests import the SDK's sources
(cd enclave && npm ci --legacy-peer-deps && npm test)   # vitest run
```

The on-chain demo test reads the compiled contracts from `contracts/out`, so the contracts are built first.

On 20 Nov 2026 the suite has 25 test files and 271 tests. Ten of them run the same replay cases with the arc-anvil
engine; they run only when `ARC_ANVIL_BIN` points to an arc-anvil binary. Plain anvil (`ANVIL_BIN`, or
`~/.foundry/bin/anvil`) runs the other 261. On the shared build server (Node 22, anvil 1.5.1), 260 of them passed and
the 261st, the heaviest replay (proof e7, 6,000 cold storage slots through the relay), only ran out of the server's
patience ("replay transaction never mined"): it passes alone with the time it asks for, and CI leaves it out by name.
The integration suites start real anvil forks and HTTP servers, so `vitest.config.ts` retries a failed test twice; a
real bug fails all three runs.

## Scripts

`scripts/` holds the scripts used on Arc testnet:

- operator and stack set-up: `operator-setup.ts`, `v21-setup.ts`, `levels-setup.ts`, `levels-machines.ts`;
- the registration of a real TDX enclave, verified on-chain by DCAP: `register-dcap.ts`;
- the Sealed Bounty end to end: `e2e-bounty-v2.ts`;
- the refutation demo: `refute-demo.ts`;
- on-chain manifest updates, replay and state-proof checks, and the retirement of earlier stacks.

## What's next

- **Reproducible image builds from a tagged context.** Each image will be built from a tagged commit of this
  repository, so that anyone can rebuild the digest that a measured compose file pins.
- **Proof e7 on a shared server.** The heaviest replay test (6,000 cold slots) needs more time than a busy build server gives it; it passes alone and is named in the CI workflow.
