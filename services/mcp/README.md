# ArcHive MCP server

The MCP server lets any AI agent use ArcHive on Arc testnet: Claude Code, Claude Desktop, Cursor or any MCP client.
It **reads** the network: products, enclaves, bounties, sessions, activity and on-chain state. It **prepares**
operations that the user signs in their own wallet. It holds no key, and no tool sends a transaction.

The server is live at **https://arc-hive.xyz/mcp** (also served at `https://archive.62-171-153-35.sslip.io/mcp`):

```sh
claude mcp add --transport http archive https://arc-hive.xyz/mcp
```

Any other MCP client: `{ "mcpServers": { "archive": { "url": "https://arc-hive.xyz/mcp" } } }`.

## Two transports, one server

| Transport | Entry point | Use |
|---|---|---|
| Streamable HTTP, stateless | [`src/http.ts`](src/http.ts) (app in [`src/http-app.ts`](src/http-app.ts)) | remote agents; the live `/mcp` endpoint |
| stdio | [`src/server.ts`](src/server.ts) | a local agent that starts the server itself |

Both build the same server ([`src/mcp-server.ts`](src/mcp-server.ts)) with the same tools ([`src/tools.ts`](src/tools.ts)).
The on-chain logic is shared with the copilot ([`services/copilot/src/arc-actions.ts`](../copilot/src/arc-actions.ts)),
so AskHive and the MCP server give the same answers. The shared code names its output fields in French; the MCP
server returns them with English keys (`englishKeys`) and translates every value it returns through
[`src/english.ts`](src/english.ts): errors, notes, advice, steps, warnings, checks and receipt checks; the values read
from the chain are left as they are.

## The 16 tools

| Reads (11) | Prepares, for the user to sign (5) |
|---|---|
| `arc_products`, `arc_enclaves`, `arc_bounties`, `arc_sessions`, `arc_activity` (lists from the ArcHive API's event index) | `arc_bounty_prepare_create`: a sealed bounty, with a loss-rule helper |
| `arc_pricing`, `arc_verify_receipt` (checks a receipt the way `SessionPay.settle` does) | `arc_operator_prepare_bond`, `arc_operator_prepare_register`: bond, then register an enclave |
| `arc_enclave_status`, `arc_session_status` (on-chain state) | `arc_operator_plan`, `arc_product_scaffold`: become an operator, publish a service |
| `arc_machines_list`, `arc_machine_diagnostics` (an operator's machines) | |

Every output goes through the secrets filter before it reaches the agent. When the API does not answer, a list tool
says "list temporarily unavailable". It never falls back to the explorer, and it never presents a partial list as
complete.

## Guards (HTTP)

- A per-IP rate limit: 60 requests per minute and 3,000 per day by default (429 with `Retry-After`). Behind a local
  or private proxy, the IP is the last hop of `X-Forwarded-For`, which Caddy sets.
- At most 16 requests at a time (503). JSON only (415), a body up to 64 KiB (413), invalid JSON rejected (400).
- A timeout on every tool call, 45 s by default. The server stays up.
- Enclave URLs (`/attest`, `/pubkeys`) get the copilot's network guards: https, port 443, a fixed path, a public
  address resolved once, no redirect followed, an error body never returned. The public HTTP server never reads a
  private network.
- Open CORS (`*`, no credentials): the server reads only public data and prepares only actions the user signs.

## Environment

| Variable | Meaning |
|---|---|
| `ARCHIVE_API` | the ArcHive API that serves the lists (default: the public API) |
| `DEPLOYMENTS` | path to a `deployments.*.json` (default: the SDK's built-in v2.1 testnet stack, levels included) |
| `RPC_URL` | Arc testnet RPC (default: the public RPC) |
| `ENCLAVE_URL`, `ENCLAVE_PATH_PREFIXES` | an enclave to read `/attest` from, and the allowed path prefixes |
| `MCP_ALLOW_PRIVATE_URLS=1` | stdio only, for local development: allows a VM on the local network |
| `MCP_PORT` (8812), `MCP_HOST` (0.0.0.0) | HTTP listener |
| `MCP_RATE_PER_MINUTE` (60), `MCP_RATE_PER_DAY` (3,000), `MCP_GLOBAL_PER_DAY` (0 = no cap), `MCP_MAX_INFLIGHT` (16), `MCP_TOOL_TIMEOUT_MS` (45,000) | HTTP guards |

## Run and test

From the repository root. The server links the SDK (`file:../../packages/sdk`) and imports shared code from
`services/copilot/src` (the on-chain logic, the API client, the network guards), so the three folders install their
own dependencies, in this order, as the CI does:

```sh
cd packages/sdk && npm ci && cd ../../services/copilot && npm ci && cd ../mcp && npm ci
npm start              # stdio server (for an MCP client, `npm start --silent` keeps npm's banner off stdout)
npm run start:http     # Streamable HTTP server on :8812
npm test               # 15 tests: a fake local ArcHive API and a fake Arc client, no outgoing network call
npm run typecheck
npm run test:live      # optional: one real read per list tool against the live API (reads only, no transaction)
```

On the server, `deploy/build.sh` bundles `src/http.ts` into `mcp-http.mjs`. That bundle runs in its own hardened
container (`deploy/docker-compose.vps.yml`) behind Caddy's `/mcp` route. The HTTP contract is in
[`docs/COPILOT-SITE-CONTRACT.md`](../../docs/COPILOT-SITE-CONTRACT.md) §6.
