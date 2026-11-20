# Use ArcHive from your own tools

Back to the [README](../README.md).

## Use ArcHive from your own tools

### The MCP server, in Claude Code, Cursor or any MCP client

```sh
claude mcp add --transport http archive https://arc-hive.xyz/mcp
```

Any other MCP client: `{ "mcpServers": { "archive": { "url": "https://arc-hive.xyz/mcp" } } }`.
It is listed in the official MCP Registry as `xyz.arc-hive/archive`, and [`arc-hive.xyz/llms.txt`](https://arc-hive.xyz/llms.txt)
sums up the API, the prices and how payments are guarded for any AI agent.
The server holds no key and has no tool that sends a transaction. It reads the network and **prepares** operations
that the user signs in their own wallet. Its 16 tools:

| Reads | Prepares (you sign) |
|---|---|
| `arc_products`, `arc_enclaves`, `arc_bounties`, `arc_sessions`, `arc_activity`, `arc_pricing` | `arc_bounty_prepare_create`: a sealed bounty, with a loss-rule assistant |
| `arc_enclave_status`, `arc_session_status`, `arc_verify_receipt` (checks a receipt like `SessionPay.settle`) | `arc_operator_prepare_bond`, `arc_operator_prepare_register`: bond, then register an enclave |
| `arc_machines_list`, `arc_machine_diagnostics` (an operator's machines) | `arc_operator_plan`, `arc_product_scaffold`: become an operator, publish a service |

The same server runs locally over stdio from this repository:
`cd packages/sdk && npm ci && cd ../../services/copilot && npm ci && cd ../mcp && npm ci && npm start --silent` (the MCP
server imports the copilot's shared code, so the copilot is installed too; `ARCHIVE_API` sets the read API).

### The SDK and the `arcvault` CLI

- [`packages/sdk`](../packages/sdk/), in TypeScript, checks an enclave's keys on Arc before encrypting anything. It opens
  prepaid sessions, pays per call (x402, with `maxAmount`), verifies every signed receipt, builds bounties and reads
  the operator levels.
- [`packages/cli`](../packages/cli/) is `arcvault`, with 33 commands: read the network, check a receipt, sessions,
  bounties and refutation, operators, products, auditors, and a local OpenAI-compatible proxy paid from a prepaid
  session.

```sh
cd packages/sdk && npm ci
cd ../cli && npm ci && npm run arcvault -- products
```

Both run from this repository with `npm ci` in each folder.

### Claude Code on ArcHive's private inference

On 19 Nov 2026 we sent requests in Claude Code's format through a LiteLLM gateway and our test bridge, an x402 client
that pays the product 3 enclave 0.01 USDC per call and returns an answer only once its signed receipt checks against
the enclave's key on Arc. The `claude` CLI itself was not run, Claude Code's tools (files, commands) do not go through,
only text does, and the model is `gpt-oss-120b`, not Claude. The operator settled the three calls on Arc on 19 Nov,
between 20:22 and 20:23 UTC:
[`0x3c98a1fa…1ae8`](https://explorer.testnet.arc.io/tx/0x3c98a1fafa893722b9bffd84a1287ef28a446c361c822e4e2071f714bba31ae8),
[`0xec0bd6b0…68e3`](https://explorer.testnet.arc.io/tx/0xec0bd6b04fdaa3cc4966a604e8967f0e73b5ca91423d9921edb3d05c574168e3),
[`0xe7a0e00f…f52b`](https://explorer.testnet.arc.io/tx/0xe7a0e00fe514f10d602b1495d2d84a5e9f5b4c67e1fb5ba33cf7e190d8a1f52b).

### Run your coding agent on ArcHive (OpenCode)

[`examples/opencode-archive`](../examples/opencode-archive/) makes product 3 the AI of OpenCode, the open-source coding
agent: not an MCP server, the agent's own model. A local bridge seals each request to the enclave whose key Arc checked
and pays 0.01 USDC per call by x402; OpenCode's tools run on your machine and their output goes back sealed. The model
is `gpt-oss-120b`, which the enclave calls. On 20 Nov 2026 OpenCode listed a folder this way, and the operator settled
the paid Glob call on Arc: [`0xb381773a…fa31`](https://explorer.testnet.arc.io/tx/0xb381773a089fb338a11081a9098174fdc4d0db14374d8a7f3ee1652f2727fa31).

```sh
cd packages/sdk && npm ci && cd ../../examples/opencode-archive && npm ci
ARCHIVE_PAYER_KEY_FILE=<test wallet JSON> ./opencode-archive
```

`opencode-arc` is the same command under a shorter name, on the live v3 stack by default; `./opencode-arc start` runs
the bridge alone for any OpenAI-compatible tool (base URL `http://127.0.0.1:8789/v1`, model `gpt-oss-120b`:
[Aider, Continue, Cline, Goose and others](../examples/opencode-archive/README.md#any-openai-compatible-harness)), and
`ARCHIVE_PAYER=circle` pays from a Circle developer-controlled wallet, so no private key sits on your machine
([Pay from a Circle wallet](../examples/opencode-archive/README.md#pay-from-a-circle-wallet)). On v3, OpenCode's Glob
ran through `opencode-arc` in a paid call settled in [`0x547006bc…e8f0`](https://explorer.testnet.arc.io/tx/0x547006bc63ee77542c7783df5c48dcf50cd0daa2ec2e3bdd2ad5368c5d76e8f0), and a call paid from
the Circle wallet in [`0x1318d65c…7cd0`](https://explorer.testnet.arc.io/tx/0x1318d65c5829c9689ba7fc3c717a5bdca1b564cc8590bdc183ff1ee4f0ff7cd0).
