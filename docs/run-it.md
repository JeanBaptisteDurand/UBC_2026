# Run it, and the repository map

Back to the [README](../README.md).

## Run it

Nothing to install to try it: the site, the API and the MCP server above are live on Arc testnet.

To clone it without the landing film's frames (`frontend/public/film`, 7,482 images, about 633 MB), which leaves
about 37 MB:

```sh
git clone --filter=blob:none --no-checkout https://github.com/JeanBaptisteDurand/UBC_2026.git && cd UBC_2026
git sparse-checkout set --no-cone '/*' '!/frontend/public/film/' && git checkout main
```

```sh
# Each line runs from the repository root.

# Contracts (Foundry): 30 Solidity files, 253 tests
(cd contracts && forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git && forge build && forge test)

# SDK and CLI (Node.js 22); the services and the CLI use packages/sdk by path, so install it first
(cd packages/sdk && npm ci && npm test)
(cd packages/cli && npm ci && npm run arcvault -- --help)

# Enclave kit and products
(cd enclave && npm ci --legacy-peer-deps && npm test)

# Services: the read API, the copilot (copy .env.example to .env to run it), the MCP server (stdio; start:http for HTTP)
(cd services/api && npm ci && npm start)
(cd services/copilot && npm ci && npm test)
(cd services/mcp && npm ci && npm test && npm start)

# The site (reads the live API) on http://localhost:5261, and the console
(cd frontend && npm ci && npm run dev)
(cd web && npm ci && npm run dev)

# The operator agent's tests, then an operator machine (an Intel TDX VM)
(cd packages/node && npm ci && npm test)
curl -fsSL https://arc-hive.xyz/install.sh | sh
archive-node doctor && archive-node pair && archive-node up --product 1 --tunnel
```

On every push, [CI](../.github/workflows/ci.yml) builds and tests the contracts, the SDK, the enclave kit, the read API,
the copilot, the MCP server, the operator agent and the registrar, and type-checks the CLI, the site and the console.

Server deployment: [`deploy/README.md`](../deploy/README.md). Intel's verifier on Arc: [`dcap-integration/`](../dcap-integration/).

## Repository map

```
contracts/          Solidity (Foundry): registry, boot-log replay, products, bonds, payments, bounties, verdicts, operator levels
dcap-integration/   Automata's DCAP verifier on Arc: deployment, Intel collateral, on-chain verification
enclave/            enclave kit and products (private AI, x402, sealed bounty), Dockerfiles, Phala compose files
packages/sdk/       TypeScript SDK: sessions, x402, AskHive client, key checks, receipts, boot-log encoder, bounties, levels
packages/cli/       arcvault CLI: sessions, bounties, operators, products, auditors, local OpenAI-compatible proxy
packages/node/      archive-node, the operator agent for an Intel TDX machine
services/api/       read API with its own index of contract events
services/registrar/ operator service: renews admissions, settles sessions and paid calls
services/copilot/   AskHive and the console copilot: read the chain, drive the site, prepare transactions to sign
services/mcp/       MCP server for AI agents (Streamable HTTP and stdio)
frontend/           the marketplace site (Vite, React, three.js)
web/                the console (React, in English) and the 3D server room (web/public/datacenter)
deploy/             server deployment (built on the server from this source)
docs/               operator levels, the AskHive and MCP contract, the earlier sets (history.md), screenshots of the site
deployments.*.json  every deployed address and transaction: v3 (live) and Intel's DCAP verifier; the earlier sets in docs/history/
```

Package guides: [`contracts`](../contracts/README.md), [`dcap-integration`](../dcap-integration/README.md),
[`enclave`](../enclave/README.md) (and its [compose files](../enclave/phala/README.md)), [`packages/sdk`](../packages/sdk/README.md),
[`packages/cli`](../packages/cli/README.md), [`packages/node`](../packages/node/README.md),
[`services/api`](../services/api/README.md), [`services/registrar`](../services/registrar/README.md), [`web`](../web/README.md),
[`deploy`](../deploy/README.md).
