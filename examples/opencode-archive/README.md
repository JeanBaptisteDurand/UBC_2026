# OpenCode on ArcHive's private AI

`opencode-arc` runs [OpenCode](https://opencode.ai), the open-source coding agent, with ArcHive's pay-per-call AI
(product 3 of the v3 stack, Arc testnet) as its model. It is not an MCP server: it is the agent's AI itself. OpenCode
talks to a local bridge, [`archive-bridge.ts`](archive-bridge.ts) (an OpenAI-compatible API on 127.0.0.1), and the
bridge calls the enclave with the SDK's x402 client ([`packages/sdk`](../../packages/sdk/)). `opencode-arc` is a
symlink to [`opencode-archive`](opencode-archive): the same command under a shorter name.

## Security model

- **Sealed to an enclave Arc verified:** before each request, the bridge checks the enclave's key on Arc (in the EnclaveRegistry of the stack that `ARCHIVE_DEPLOYMENTS` names, [`deployments.v3.testnet.json`](../../deployments.v3.testnet.json) by default), then seals the request to it (HPKE).
- **Paid per call by x402:** one EIP-3009 authorization of exactly 0.01 USDC per request; the answer is used only if the enclave's EIP-712 receipt verifies, and the operator settles it on Arc (`X402Settler`, event `CallSettled`).
- **Your own test key stays local:** only the bridge process reads the key file (`ARCHIVE_PAYER_KEY_FILE`), OpenCode does not get its path, and the logs hold settlement status only (no prompt, no answer, no key).
- **Or no private key on your machine at all:** with `ARCHIVE_PAYER=circle`, a Circle developer-controlled wallet pays and Circle signs each authorization ([below](#pay-from-a-circle-wallet)).
- **The model is `gpt-oss-120b`:** the enclave calls it through RedPill's API ([`config.ts`](../../enclave/products/sealed-x402/config.ts)); the model itself does not run inside the enclave.

OpenCode's tools (glob, grep, read; bash and edit ask first) run on your machine, and their output goes back sealed in
the next paid call. The enclave's API is text only, so the bridge describes the tools in the system message and turns
the model's `<tool_call>{...}</tool_call>` reply into an OpenAI tool call.

## Run it

From the repository root, with Node.js 22+, [OpenCode](https://opencode.ai) and a test wallet holding test USDC on Arc
testnet (`{"privateKey": "0x..."}` in a JSON file; never a wallet with real funds):

```sh
cd packages/sdk && npm ci
cd ../../examples/opencode-archive && npm ci
export ARCHIVE_PAYER_KEY_FILE=/path/to/test-wallet.json
./opencode-arc run "Say in one sentence what ArcHive is, then list two files you can see here"
./opencode-arc              # the full-screen interface
./opencode-arc log          # in a second terminal: each paid call, its receipt, its settlement tx on Arc
./opencode-arc start        # the bridge only, for any other OpenAI-compatible tool (below)
./opencode-arc stop         # stop the bridge (resets its cap of 30 paid calls per run)
```

Your usual OpenCode setup is untouched: this command reads [`opencode.json`](opencode.json) only and keeps its own data
in `~/.local/state/opencode-archive`. It also gives OpenCode its own config folder there (`XDG_CONFIG_HOME`), so your
`~/.config/opencode` (other providers, your default agent) is not read, and `opencode.json` makes the `build` agent on
`archive/gpt-oss-120b` the default (`default_agent`): OpenCode cannot start on another agent or model.
`npm run mock` starts the bridge without enclave or payment, to try a client for free.

Limits: at most 1,024 output tokens per call and 32 KB per request; streaming arrives in one chunk; the enclave serves
at most 3 unsettled calls per payer, so the bridge waits for the settlements; the bridge sees your requests in clear
before sealing them (it runs on your machine).

### Add the ArcHive MCP server

The agent can also read the live network (the machines Arc verified, the products and their prices) through ArcHive's
MCP server. Add it to [`opencode.json`](opencode.json), the file `opencode-arc` reads, with OpenCode's
[`mcp` remote entry](https://opencode.ai/v1/docs/mcp-servers/), and keep only a few of its 16 tools for the `build`
agent: the bridge writes the tools into the system message of every request, which must stay under 32 KB.

```jsonc
"mcp": {
  "archive": { "type": "remote", "url": "https://arc-hive.xyz/mcp", "enabled": true, "timeout": 30000 }
},
"agent": {
  "build": {
    "tools": {
      // ...the entries already there, plus the ArcHive tools this agent does not need:
      "archive_arc_bounties": false, "archive_arc_sessions": false, "archive_arc_activity": false,
      "archive_arc_verify_receipt": false, "archive_arc_enclave_status": false, "archive_arc_session_status": false,
      "archive_arc_bounty_prepare_create": false, "archive_arc_operator_prepare_register": false,
      "archive_arc_product_scaffold": false, "archive_arc_machines_list": false, "archive_arc_machine_diagnostics": false
    }
  }
}
```

Five tools stay: `archive_arc_enclaves`, `archive_arc_products`, `archive_arc_pricing`, `archive_arc_operator_plan`
and `archive_arc_operator_prepare_bond`. The MCP server needs no key: it reads Arc and prepares transactions, and never
signs. OpenCode names each tool after the server (`archive_` + the tool's name).

## Pay from a Circle wallet

Instead of a local test key, the bridge can pay from a
[Circle developer-controlled wallet](https://developers.circle.com/wallets/dev-controlled): an EOA on `ARC-TESTNET`
whose key Circle holds. [`circle-signer.ts`](circle-signer.ts) is a viem account whose `signTypedData` has Circle sign
each EIP-3009 authorization (`POST /v1/w3s/developer/sign/typedData`, with a new entity secret ciphertext each time) and
checks that the signature recovers to the wallet's address before the bridge sends it. The rest of the x402 flow does
not change.

```sh
export ARCHIVE_PAYER=circle
export ARCHIVE_CIRCLE_ENV=~/.config/archive-circle/circle.env           # CIRCLE_API_KEY=TEST_API_KEY:...
export ARCHIVE_CIRCLE_ENTITY_FILE=~/.config/archive-circle/entity.env   # CIRCLE_ENTITY_SECRET=<64 hex>, registered with Circle
export ARCHIVE_CIRCLE_WALLET_FILE=~/.config/archive-circle/wallet.json  # {"walletId": "...", "address": "0x..."}
./opencode-arc run "Say in one sentence what ArcHive is"
```

To set it up once, with a Circle test API key: register an entity secret, create a wallet set, then one wallet with
`"blockchains": ["ARC-TESTNET"]` and `"accountType": "EOA"`, and send it some test USDC. The wallet must be an EOA,
because the enclave and USDC check the EIP-3009 signature with `ecrecover` (a smart-contract account would need
ERC-1271).

- **Circle holds the key in its MPC:** the wallet's private key is never on this machine, and Circle signs each authorization.
- **The agent never sees a secret:** OpenCode gets none. Only the bridge process reads the API key and the entity secret, and it signs only a USDC `ReceiveWithAuthorization` to the stack's `X402Settler` of at most 0.01 USDC; any other message, transaction or typed data is refused.
- **The payment is still an EIP-3009 authorization that ArcHive's contract checks** on Arc (`X402Settler`, event `CallSettled`), exactly as with a local key.

## Any OpenAI-compatible harness

OpenCode is one client among others. The bridge is a plain OpenAI chat-completions API, so any tool that takes a custom
base URL can run on the same sealed, paid calls. Start the bridge alone, then point the tool at it:

```sh
export ARCHIVE_PAYER_KEY_FILE=/path/to/test-wallet.json
./opencode-arc start        # the bridge only, in the background
./opencode-arc log          # in a second terminal: each paid call and its settlement tx on Arc
```

- Base URL `http://127.0.0.1:8789/v1`, model `gpt-oss-120b`, any API key: the bridge listens on 127.0.0.1 only and has
  no key of its own, the test wallet pays on Arc.
- Each request the tool sends is one paid call of 0.01 USDC. The bridge stops at 30 paid calls per run
  (`ARCHIVE_MAX_CALLS`; `./opencode-arc stop` resets it), and agents that send many requests use that up fast.
- Tool calls are emulated in text (`ARCHIVE_TOOLS=emulate`, the default; `off` drops the tools for plain chat): the
  model writes one `<tool_call>` line and the bridge returns it as an OpenAI tool call. Only OpenCode's tools were
  tested this way on the live enclave.

Any OpenAI client (plain HTTP requests to the bridge were tested on v3, see Proof), here in Python:

```python
from openai import OpenAI
ai = OpenAI(base_url="http://127.0.0.1:8789/v1", api_key="local")
r = ai.chat.completions.create(model="gpt-oss-120b", messages=[{"role": "user", "content": "What is a TEE?"}])
print(r.choices[0].message.content)
```

[Aider](https://aider.chat/docs/llms/openai-compat.html), which edits through text and needs no tool calls:

```sh
export OPENAI_API_BASE=http://127.0.0.1:8789/v1 OPENAI_API_KEY=local
aider --model openai/gpt-oss-120b
```

[Continue](https://docs.continue.dev/customize/model-providers/top-level/openai), in `~/.continue/config.yaml`:

```yaml
name: ArcHive
version: 0.0.1
schema: v1
models:
  - name: ArcHive gpt-oss-120b
    provider: openai
    model: gpt-oss-120b
    apiBase: http://127.0.0.1:8789/v1
    apiKey: local
```

[Cline](https://docs.cline.bot/provider-config/openai-compatible) or
[Roo Code](https://roocodeinc.github.io/Roo-Code/providers/openai-compatible), in the settings panel: API Provider
"OpenAI Compatible", Base URL `http://127.0.0.1:8789/v1`, API Key `local`, Model `gpt-oss-120b`. Roo Code works only
through tool calls, which the bridge emulates (not tested).

[Goose](https://goose-docs.ai/docs/getting-started/providers), which also relies on tool calls (not tested); the host
and the path are set apart:

```sh
export GOOSE_PROVIDER=openai GOOSE_MODEL=gpt-oss-120b OPENAI_API_KEY=local
export OPENAI_HOST=http://127.0.0.1:8789 OPENAI_BASE_PATH=v1/chat/completions
goose session
```

Claude Code, through a [LiteLLM](https://docs.litellm.ai/) gateway that turns its Anthropic requests into chat
completions: text only, as tested on 19 Nov 2026 (see
[Claude Code on ArcHive's private inference](../../docs/use-from-your-tools.md#claude-code-on-archives-private-inference)).
Start the bridge with `ARCHIVE_TOOLS=off`, then:

```yaml
# litellm.yaml
model_list:
  - model_name: archive-gpt-oss-120b
    litellm_params:
      model: openai/gpt-oss-120b
      api_base: http://127.0.0.1:8789/v1
      api_key: local
litellm_settings:
  drop_params: true
  use_chat_completions_url_for_anthropic_messages: true   # else LiteLLM calls /v1/responses, which the bridge lacks
```

```sh
litellm --config litellm.yaml --host 127.0.0.1 --port 4000
ANTHROPIC_BASE_URL=http://127.0.0.1:4000 ANTHROPIC_AUTH_TOKEN=local \
  ANTHROPIC_DEFAULT_HAIKU_MODEL=archive-gpt-oss-120b claude --model archive-gpt-oss-120b
```

The model is `gpt-oss-120b` whatever the tool calls it. Codex CLI is not covered: its
[configuration](https://learn.chatgpt.com/docs/config-file/config-reference) now accepts only `wire_api = "responses"`
(the Responses API), and the bridge serves chat completions only.

## Proof

All on the live v3 stack, 20 Nov 2026 (UTC), settled by the operator on `X402Settler`
[`0x89B0…3fe6`](https://explorer.testnet.arc.io/address/0x89B0381B18536f680fD952a0E7D375d7a4EC3fe6) (event `CallSettled`):

- **OpenCode, through `opencode-arc`, 12:06:** in a test folder, the `run` above made 3 paid calls: the session title
  [`0x68b6fd05…b637`](https://explorer.testnet.arc.io/tx/0x68b6fd05bceb90684cd1daefc7a14959469103de990ea315fff8f8691d74b637),
  OpenCode's Glob tool call
  [`0x547006bc…e8f0`](https://explorer.testnet.arc.io/tx/0x547006bc63ee77542c7783df5c48dcf50cd0daa2ec2e3bdd2ad5368c5d76e8f0)
  and the answer
  [`0xf23fe1ac…2c72`](https://explorer.testnet.arc.io/tx/0xf23fe1acc4337d5c7ecce5d99285d2acd0f8f82f3c21252e7a0bf587788a2c72).
- **Paid from the Circle wallet** `0xA7f3c1681782334F04B7Fd6dE4Fce3c4328f39e5` (`CallSettled`, payer = that wallet,
  0.01 USDC each): a plain HTTP request to the bridge at 11:46
  [`0x1318d65c…7cd0`](https://explorer.testnet.arc.io/tx/0x1318d65c5829c9689ba7fc3c717a5bdca1b564cc8590bdc183ff1ee4f0ff7cd0),
  two more calls at 11:50 and 11:51
  [`0x95e417e3…aa07`](https://explorer.testnet.arc.io/tx/0x95e417e384dc27ff320f54513ce8687496c65375e6afb4ba4a5d41c9f29faa07),
  [`0x4c80cffb…2ba0`](https://explorer.testnet.arc.io/tx/0x4c80cffb90d6010f4237c18ac86e7199084e4b5107458ffb09d2cba275912ba0),
  and a plain HTTP request to this folder's bridge at 12:13
  [`0xe10d32ec…8434`](https://explorer.testnet.arc.io/tx/0xe10d32ecdafd173a67b7785ef546217af416651b4bbefe0656b5084774d28434).
