# Contract (16/11, as built): the site copilot ("site" surface) and the MCP endpoint — ArcHive v3 (16/11/2026)

Shared by the front work (Florent's front + copilot panel) and the backend work (copilot service + MCP).
Production origin: https://archive.62-171-153-35.sslip.io (one origin; Caddy routes by path).

## 1. Routes in production (v3)
| Path | Service |
|---|---|
| `/` , `/use.html`, `/service.html?p=<id>`, `/rent.html`, `/publish.html`, `/demo.html` | Florent's front (static, Vite multi-page) |
| `/console/` (hash routes `#/vue`, `#/ruche`, `#/produits`, `#/primes`, `#/playground`, `#/cles`, `#/publier-prime`, `#/operateur`, `#/publier-produit`, `#/portefeuille`, `#/developpeurs`) | JB's console (unchanged features, now under /console/) |
| `/datacenter/` | the 3D server room |
| `/api/*` | read API (unchanged) |
| `/copilot/*` | copilot, surface "console" (default; used by the console's bubble; unchanged behaviour) |
| `/copilot-site/*` | copilot, surface "site" (NEW; used by the panel in Florent's front) — same code, env `COPILOT_SURFACE=site` |
| `/mcp` | MCP server over Streamable HTTP (NEW; stateless; same tools as the stdio MCP server) |

The front reads the API at `/api` (same origin) and the RPC at `https://rpc.testnet.arc.io` (direct). CSP: `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self' https://rpc.testnet.arc.io …` (no inline scripts, no CDN, no eval).

## 2. Chat request (POST `/copilot-site/chat`, JSON)
```json
{ "messages": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…" }],
  "lang": "en" | "fr",
  "user": "0x… (connected wallet, optional)",
  "page": { "name": "home|use|service|rent|publish|demo", "productId": "3", "query": "…", "state": "all|green|amber|red", "kind": "all|ai|x402|bounty|copilot|author", "section": "wall" } }
```
`messages`, `lang`, `user`: existing fields (see services/copilot/src/guard.ts parseChatRequest). `page` is NEW and optional: the server adds one line to the system message ("The user is looking at: …"). Invalid or unknown values are dropped silently, never echoed raw into the prompt (bounded strings, enums, digits).

## 3. Chat response (unchanged shape)
```json
{ "text": "…", "tools": [{ "tool": "ui_navigate", "input": { … }, "result": { "ok": true, … } }, …], "citations": [ … ] }
```
On refusal: `{ "error", "text", "code", "tools": [], "citations": [] }` with a 4xx status (403 origin, 429 rate, 413, 415, 400). The panel shows `text`.

## 4. UI tools (site surface only; executed IN THE BROWSER)
The server validates the input and returns `result: { ok: true, …normalized input }` or `{ ok: false, error }`. It never navigates anything itself. The panel executes every `ok: true` ui tool from `tools`, in order, with visible animation, and reports nothing back (the next user message carries the new `page`).

1. `ui_navigate { page, productId?, query?, state?, kind?, section?, consoleRoute?, reason? }`
   - `page`: `home | use | service | rent | publish | demo | datacenter | console`
   - `productId`: digits only (service page, or to focus a catalog row); `query` ≤ 60 chars; `state`: `all|green|amber|red`; `kind`: `all|ai|x402|bounty|copilot|author`; `section`: an anchor id of the target page (list below); `consoleRoute`: one console route id (list in §1); `reason` ≤ 140 chars (shown to the user as a small caption).
   - URLs: home → `/` (+ `#section`); use → `/use.html?q=&state=&kind=`; service → `/service.html?p=<id>`; rent → `/rent.html`; publish → `/publish.html`; demo → `/demo.html`; datacenter → `/datacenter/`; console → `/console/#/<consoleRoute or vue>`.
   - If the user is already on the target page: apply in place, no reload (type the query character by character into `#cat-q`, switch the state and kind filters, smooth-scroll to the section).
2. `ui_highlight { target, note? }` — `target`: an anchor id on the current page, or `product:<id>` (a catalog row or a wall drawer). The element pulses (glow ring, 2–3 s) and `note` (≤ 140 chars) shows in a small bubble next to it.
3. `ui_demo { action, step? }` — `action`: `play | pause | next | prev | goto`; `step`: 1–9 (with goto). Only meaningful on `/demo.html` (navigate there first if needed).

Anchor ids in Florent's front (15/11): home `top`, `wall`, `arc`, `invalid`, `publish`, `protocol`, `end`; use `catalog`, `cat-q`, `cat-k`; service `svc`; rent `rent`; publish `publish`, `path`; demo `demo`. The front may add `data-copilot="<key>"` hooks; the backend lists the keys above in the tool descriptions.

## 5. Prepare tools (unchanged; signed by the USER's wallet, never by a server)
`session_prepare_open`, `operator_prepare_bond`, `operator_prepare_register`, `bounty_prepare_create` (cards with checks and a Sign button), `product_scaffold`, `pricing_quote`, `snippet_generate`, `inference_test` (information cards). Rendering and execution follow `web/src/screens/CopilotActions.tsx` (console), using the SDK `@arcvault/sdk` (packages/sdk/src) with a viem wallet client over `window.ethereum` (EIP-1193), chain Arc testnet (id 5042002, RPC https://rpc.testnet.arc.io, explorer https://explorer.testnet.arc.io, native currency USDC with 18 decimals). A failed check blocks the Sign button. Note: the enclave VMs are deleted since 14/11 (0 active enclave), so `session_prepare_open` and `operator_prepare_register` will report no active enclave; bond deposit and bounty creation still work on chain.

## 6. MCP
`/mcp`: Streamable HTTP (MCP spec 2025-03-26 or later), stateless (no session id), JSON responses, CORS open (no credentials), per-IP rate limit, request body ≤ 64 KiB, same tool list and logic as `services/mcp/src/tools.ts` (reads + PREPARE only, never signs). The panel shows: "Use these tools from your own agent (Claude, Cursor…): MCP server `https://archive.62-171-153-35.sslip.io/mcp`" with a copyable JSON config snippet.

> **As built (16/11):** the site copilot answers `{ text, tools: [{ tool, label, input, result, inline?, inferred? }], citations, actions }`; prepare-tool results come in `actions` (as in the console) and in `tools`; `ui_highlight` also accepts `bounty:<id>`; when the model shows nothing and the request clearly names a page, the server adds that `ui_navigate` itself (`inferred: true`).
