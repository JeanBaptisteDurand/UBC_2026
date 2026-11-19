# ArcHive MCP server

The MCP server lets any AI agent (Claude Code, Claude Desktop, Cursor or any MCP client) use ArcHive on Arc testnet. It
**reads** the network (products, enclaves, bounties, sessions, activity, on-chain state) and **prepares** operations
that the user signs in their own wallet. It holds no key and has no tool that sends a transaction.

Live at **https://arc-hive.xyz/mcp** (also served at `https://archive.62-171-153-35.sslip.io/mcp`):

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
so AskHive and the MCP server give the same answers.

## The 16 tools

| Reads (11) | Prepares, for the user to sign (5) |
|---|---|
| `arc_products`, `arc_enclaves`, `arc_bounties`, `arc_sessions`, `arc_activity` (lists from the ArcHive API's event index) | `arc_bounty_prepare_create`: a sealed bounty, with a loss-rule helper |
| `arc_pricing`, `arc_verify_receipt` (checks a receipt the way `SessionPay.settle` does) | `arc_operator_prepare_bond`, `arc_operator_prepare_register`: bond, then register an enclave |
| `arc_enclave_status`, `arc_session_status` (on-chain state) | `arc_operator_plan`, `arc_product_scaffold`: become an operator, publish a service |
| `arc_machines_list`, `arc_machine_diagnostics` (an operator's machines) | |

Every output goes through the secrets filter before it reaches the agent. When the API does not answer, a list tool
says "list temporarily unavailable": it never falls back to the explorer and never presents a partial list as complete.

## Guards (HTTP)

- Per-IP rate limit (60 per minute, 3,000 per day by default; 429 with `Retry-After`). The IP is the last hop of
  `X-Forwarded-For`, set by Caddy, only when the peer is a local or private proxy.
- At most 16 requests at a time (503), JSON only (415), body up to 64 KiB (413), invalid JSON rejected (400).
- A timeout on every tool call (45 s by default); the server stays up.
- Enclave URLs (`/attest`, `/pubkeys`) get the copilot's network guards: https, port 443, fixed path, public address
  resolved once, no redirect followed, error body never returned. The public HTTP server never reads a private network.
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

```sh
cd packages/sdk && npm ci && cd ../../services/mcp && npm ci
npm start              # stdio server
npm run start:http     # Streamable HTTP server on :8812
npm test               # 15 tests: a fake local ArcHive API and a fake Arc client, no outgoing network call
npm run typecheck
npm run test:live      # optional: one real read per list tool against the live API (reads only, no transaction)
```

On the server, `deploy/build.sh` bundles `src/http.ts` into `mcp-http.mjs`, which runs in its own hardened container
(`deploy/docker-compose.vps.yml`) behind Caddy's `/mcp` route. The HTTP contract is in
[`docs/COPILOT-SITE-CONTRACT.md`](../../docs/COPILOT-SITE-CONTRACT.md) §6.
