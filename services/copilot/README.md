# ArcHive copilot: AskHive and the console copilot

One agentic RAG copilot with two surfaces:

- **AskHive** (`COPILOT_SURFACE=site`), the panel on every page of https://arc-hive.xyz. It explains while it shows: it
  moves the page, highlights a section or plays a step-by-step guide, and it prepares operations.
- **The console copilot** (`COPILOT_SURFACE=console`, the default), the chat bubble of the console.

It runs on the site's server and, as AskHive, in its own Intel TDX enclave: **product 4 on Arc testnet**. The enclave's
key is registered on Arc, the conversation is sealed to it (HPKE, `ARC-COPILOT-CHAT-v1`) and every reply is sealed and
signed by that key (`ARC-COPILOT-SITE-REPLY-v1`). The copilot holds no wallet key: it reads the network and prepares
operations that the user signs with their own wallet. It never sends a transaction.

## How it works

- Every number comes from a tool: on-chain reads through the SDK, or the ArcHive API's event index for lists.
- The interface tools (`ui_navigate`, `ui_highlight`, `ui_demo`, `ui_guide`) run in the browser; the server only
  validates them (known pages and anchors, bounded strings, at most 3 actions per answer, never a button that signs).
- Guards: bounded request bodies and history, per-IP and daily rate limits, input-token budget per request, origin
  check, and a secrets filter on the conversation.
- Answers follow the user's language (English or French).

## Source map

| File | Role |
|---|---|
| [`src/copilot.ts`](src/copilot.ts) | assembles the copilot from the environment: prompt, tools, model, limits |
| [`src/app.ts`](src/app.ts) | the HTTP app (Hono): chat route, tool loop, sealed protocol, guards |
| [`src/server.ts`](src/server.ts) | entry point on the site's server |
| [`src/site.ts`](src/site.ts), [`src/site-live.ts`](src/site-live.ts), [`src/site-urls.ts`](src/site-urls.ts) | AskHive: the site's knowledge base, interface tools, guides, live network status, public URLs |
| [`src/tools.ts`](src/tools.ts), [`src/arc-actions.ts`](src/arc-actions.ts) | tools and on-chain actions (reads and prepared transactions), shared with the MCP server |
| [`src/archive-api.ts`](src/archive-api.ts) | lists from the ArcHive API's event index |
| [`src/claude-code.ts`](src/claude-code.ts) | what the copilot says about using ArcHive from Claude Code |
| [`src/guard.ts`](src/guard.ts), [`src/net-guard.ts`](src/net-guard.ts), [`src/secrets.ts`](src/secrets.ts) | HTTP guards, guarded calls to user-supplied enclave URLs, secrets filter |
| [`src/i18n.ts`](src/i18n.ts), [`src/llm.ts`](src/llm.ts) | language selection; the OpenAI-compatible model call |
| [`src/enclave-server.ts`](src/enclave-server.ts), [`src/enclave-app.ts`](src/enclave-app.ts), [`src/enclave-config.ts`](src/enclave-config.ts) | the copilot inside an enclave (image built by [`enclave/Dockerfile.copilot`](../../enclave/Dockerfile.copilot)) |
| [`src/enclave-site.ts`](src/enclave-site.ts), [`src/enclave-site-measure.ts`](src/enclave-site-measure.ts) | AskHive in its enclave: signed sealed replies (`verifySiteReply`), and the VM's measurement before launch |

The enclave compose that Arc measures for product 4 is
[`enclave/phala/copilot-site-v22.yml`](../../enclave/phala/copilot-site-v22.yml); the HTTP contract with the site is
[`docs/COPILOT-SITE-CONTRACT.md`](../../docs/COPILOT-SITE-CONTRACT.md).

## Environment

The variables are documented in the header of [`src/copilot.ts`](src/copilot.ts) (an example file is `.env.example`): the
model (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `COPILOT_MODEL`), the limits (`COPILOT_MAX_*`, `COPILOT_RATE_*`,
`COPILOT_GLOBAL_PER_DAY`), `ALLOWED_ORIGINS`, `RPC_URL`, `ARCHIVE_API`, `DEPLOYMENTS` and `COPILOT_SURFACE`.

## Run and test

```sh
cd packages/sdk && npm ci && cd ../../services/copilot && npm ci
npm test               # 184 tests with a simulated model: no call to a model provider
npm run typecheck
npm start              # needs a .env with a model key (see .env.example)
npm run test:live      # optional: one real read per list tool against the live API (no transaction, no model)
```
