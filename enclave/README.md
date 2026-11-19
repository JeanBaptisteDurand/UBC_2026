# Enclave kit and products

The code that runs inside ArcHive's Intel TDX enclaves on Phala Cloud (dstack): the enclave kit shared by every
product, the product servers, and the image recipes whose digests the measured compose files in `phala/` pin.

## The enclave kit (`src/kit`, `src/server`)

- **Keys created in memory.** At start-up the enclave creates a secp256k1 signing key (its `signer` address) and an
  X25519 encryption key (HPKE). They are never written to disk.
- **`POST /attest`** (operator): `{ operator, anchorR }` → `{ quote, eventLog, signer, x25519, … }`. The dstack TDX quote's
  REPORTDATA binds the chain, the registry, the product, the operator and the enclave keys (bytes 0 to 31) and the hash
  of a recent Arc block (bytes 32 to 63), which `EnclaveRegistry` checks on Arc (policies P6 and P7, see
  `../dcap-integration/README.md`).
- **Bound to one operator.** `/attest` fails closed: an address outside `OPERATOR_ALLOWLIST` gets 403, and an unset or
  empty allowlist authorizes nobody (development mode is the explicit `OPERATOR_ALLOWLIST=*`). If the enclave's key is
  already registered on Arc for another operator, the answer is 409 (503 if Arc cannot be read through the kit's RPC
  quorum).
- **`GET /pubkeys`** and **`GET /health`** are public. Signing, sealing, opening and the RPC relay stay internal to the
  services and are never exposed over HTTP.

## Products and entry points

| Product (see the root README) | Entry point | Port | Image | Compose |
|---|---|---|---|---|
| 1, Private AI, prepaid session (`SessionPay`) | `products/sealed-chat/server.ts` → `dist/sealed-chat.mjs` | 8802 | `Dockerfile` | `phala/sealed-chat-v21.yml` |
| 3, Private AI, pay per call (x402, `X402Settler`) | `products/sealed-x402/server.ts` → `dist/sealed-x402.mjs` | 8804 | `Dockerfile` | `phala/sealed-chat-v21.yml` (second service) |
| 2 and 7, Sealed Bounty, open and verified levels; 5, the refutation demo | `products/sealed-bounty/server.ts` → `dist/sealed-bounty.mjs` | 8803 | `Dockerfile.bounty` | `phala/sealed-bounty-v21.yml`, `phala/sealed-bounty-verified-v21.yml`, `phala/refute-demo-*.yml` |
| 4, AskHive, the attested copilot (console and site surfaces) | `../services/copilot/src/enclave-server.ts` → `copilot-enclave.mjs` | 8808 | `Dockerfile.copilot` | `phala/copilot-v21.yml`, `phala/copilot-site-v22.yml` |

The Sealed Bounty replays an exploit with arc-anvil (Circle's Arc Foundry), which forks Arc at block N with Arc's
precompiles (native USDC, blocklist, EIP-7708 logs). The copilot holds no key: it prepares actions that the user signs
with their own wallet.

## Build the images

Each Dockerfile pins its base image by digest and installs dependencies with `npm ci` from the lockfile. The headers
of `Dockerfile` and `Dockerfile.copilot` give the reproducible-build steps (fixed timestamps, no provenance manifest).

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
cd contracts && forge build && cd ..   # the on-chain demo test reads the compiled contracts from contracts/out
cd enclave && npm ci && npm test   # vitest run
```

On 20 Nov 2026: 25 test files, 261 tests passed and 10 skipped. The skipped ones run the same replay cases with the
arc-anvil engine and are skipped when `ARC_ANVIL_BIN` does not point to an arc-anvil binary; plain anvil
(`ANVIL_BIN`, or `~/.foundry/bin/anvil`) runs the rest. The integration suites start real anvil forks and HTTP servers,
so `vitest.config.ts` retries a failed test twice; a real bug fails all three runs.

## Scripts

`scripts/` holds the scripts used on Arc testnet: operator and stack set-up (`operator-setup.ts`, `v21-setup.ts`,
`levels-setup.ts`, `levels-machines.ts`), the registration of a real TDX enclave verified by DCAP on-chain
(`register-dcap.ts`), the Sealed Bounty end to end (`e2e-bounty-v2.ts`), the refutation demo (`refute-demo.ts`),
on-chain manifest updates, replay and state-proof checks, and the retirement of earlier stacks.

## Measured compose files

`phala/` holds the app-compose files of the enclaves. dstack measures each file byte for byte, comments included, so
they stay exactly as deployed; `phala/README.md` summarizes each one in English.

`docker-compose.bounty.yml` is a template of the Sealed Bounty machine's app-compose (real replay by anvil on a fork of
Arc at block N), with the image digest left as a parameter; the deployed compose files in `phala/` pin the image by
digest in clear.
