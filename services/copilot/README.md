# ArcHive copilot: AskHive and the console copilot

One agentic RAG copilot serves two surfaces:

- **AskHive** (`COPILOT_SURFACE=site`) is the panel on every page of https://arc-hive.xyz. It explains while it shows.
  It moves the page, highlights a section or plays a step-by-step guide, and it prepares operations.
- **The console copilot** (`COPILOT_SURFACE=console`, the default) is the chat bubble of the console.

The copilot runs on the site's server. AskHive also runs in its own Intel TDX enclave: **product 4 on Arc testnet**.
Arc's EnclaveRegistry holds the enclave's public keys. In enclave mode, the panel seals the conversation to the
enclave's key (HPKE, `ARC-COPILOT-CHAT-v1`), and the enclave seals and signs every reply (`ARC-COPILOT-SITE-REPLY-v1`).

The copilot holds no wallet key. It reads the network and prepares operations that the user signs with their own
wallet. It never sends a transaction.

## How it works

- Every number comes from a tool: an on-chain read through the SDK, or the ArcHive API's event index for lists.
- The interface tools (`ui_navigate`, `ui_highlight`, `ui_demo`, `ui_guide`) run in the browser. The server only
  validates them: known pages and anchors, bounded strings, at most 3 actions per answer, never a button that signs.
- Guards bound the request body and the history. Each request also goes through per-IP and daily rate limits, an
  input-token budget, an origin check and a secrets filter on the conversation.
- Answers follow the user's language, English or French.

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

Product 4's enclave compose is [`enclave/phala/copilot-site-v22.yml`](../../enclave/phala/copilot-site-v22.yml). Its
compose-hash is part of the image fingerprint that Arc checks. The HTTP contract with the site is
[`docs/COPILOT-SITE-CONTRACT.md`](../../docs/COPILOT-SITE-CONTRACT.md).

The console copilot's prompt and knowledge base are written in French. AskHive uses the same prompt with an English
paragraph for the site's interface, and puts the site's own entries, in English, ahead of the console's. Both surfaces
answer in the user's language. The shared on-chain actions name their output fields in French; the MCP server returns
them with English keys.

## Environment

The header of [`src/copilot.ts`](src/copilot.ts) documents every variable, and `.env.example` gives a starting file.
The main groups:

- the model: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `COPILOT_MODEL`;
- the limits: `COPILOT_MAX_*`, `COPILOT_RATE_*`, `COPILOT_GLOBAL_PER_DAY`;
- the network: `ALLOWED_ORIGINS`, `RPC_URL`, `ARCHIVE_API`, `DEPLOYMENTS`;
- the surface: `COPILOT_SURFACE`.

## Run and test

```sh
(cd enclave && npm ci --legacy-peer-deps)   # the enclave kit, which the copilot's enclave code imports
cd packages/sdk && npm ci && cd ../../services/copilot && npm ci
npm test               # 184 tests with a simulated model: no call to a model provider
npm run typecheck
npm start              # needs a .env with a model key (see .env.example)
npm run test:live      # optional: one real read per list tool against the live API (no transaction, no model)
```
