# OpenCode on ArcHive's private AI

`opencode-archive` runs [OpenCode](https://opencode.ai), the open-source coding agent, with ArcHive's pay-per-call AI
(product 3, Arc testnet) as its model. It is not an MCP server: it is the agent's AI itself. OpenCode talks to a local
bridge, [`archive-bridge.ts`](archive-bridge.ts) (an OpenAI-compatible API on 127.0.0.1), and the bridge calls the
enclave with the SDK's x402 client ([`packages/sdk`](../../packages/sdk/)).

## Security model

- **Sealed to an enclave Arc verified:** before each request, the bridge checks the enclave's key on Arc, then seals the request to it (HPKE).
- **Paid per call by x402:** one EIP-3009 authorization of exactly 0.01 USDC per request; the answer is used only if the enclave's EIP-712 receipt verifies, and the operator settles it on Arc (`X402Settler`, event `CallSettled`).
- **Your own test key stays local:** only the bridge process reads the key file (`ARCHIVE_PAYER_KEY_FILE`), OpenCode does not get its path, and the logs hold settlement status only (no prompt, no answer, no key).
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
./opencode-archive run "Say in one sentence what ArcHive is, then list two files you can see here"
./opencode-archive          # the full-screen interface
./opencode-archive log      # in a second terminal: each paid call, its receipt, its settlement tx on Arc
./opencode-archive stop     # stop the bridge (resets its cap of 30 paid calls per run)
```

Your usual OpenCode setup is untouched: this command reads [`opencode.json`](opencode.json) only and keeps its own data
in `~/.local/state/opencode-archive`. `npm run mock` starts the bridge without enclave or payment, to try a client for free.

Limits: at most 1,024 output tokens per call and 32 KB per request; streaming arrives in one chunk; the enclave serves
at most 3 unsettled calls per payer, so the bridge waits for the settlements; the bridge sees your requests in clear
before sealing them (it runs on your machine).

## Proof

On 20 Nov 2026, in a test folder, the `run` above made 3 paid calls (the session title, OpenCode's Glob, the answer)
and listed `calc.py` and `README.md`. The operator settled all three on Arc; the Glob call, at 10:33 UTC:
[`0xb381773a…fa31`](https://explorer.testnet.arc.io/tx/0xb381773a089fb338a11081a9098174fdc4d0db14374d8a7f3ee1652f2727fa31).
