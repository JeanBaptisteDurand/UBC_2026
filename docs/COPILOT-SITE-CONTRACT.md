# AskHive and the MCP endpoint: the HTTP contract

AskHive is the assistant of the ArcHive site. The same program (`services/copilot`, `COPILOT_SURFACE=site`) runs in
two places: on the site's server (`/copilot-site/`) and inside its own Intel TDX enclave, registered on Arc as
product 4 (`/enclave/copilot-site/`). The site's panel (`frontend/src/copilot/`) talks to the enclave when it can
verify it, and says so on screen.

This document is the contract between the panel, the copilot service and the MCP server. In production,
https://arc-hive.xyz is one server where Caddy routes by path. The same routes answer at the server's own address,
https://archive.62-171-153-35.sslip.io, where the console runs (`https://arc-hive.xyz/console/` redirects there).

## 1. Routes in production

| Path | Service |
|---|---|
| `/`, `/network.html` (`?focus=use\|rent\|publish\|arc\|cctp\|demo`), `/service.html?p=<id>`, `/doc.html?c=<chapter>`, `/space.html`, `/bridge.html` | the site (static, Vite multi-page); `/use.html`, `/rent.html` and `/publish.html` redirect to `network.html?focus=use\|rent\|publish` |
| `/console/` (hash routes `#/vue`, `#/ruche`, `#/produits`, `#/primes`, `#/playground`, `#/cles`, `#/publier-prime`, `#/operateur`, `#/publier-produit`, `#/portefeuille`, `#/developpeurs`) | the console |
| `/datacenter/` | the 3D server room |
| `/api/*` | the read API |
| `/copilot/*` | the copilot, surface "console" (the console's bubble) |
| `/copilot-site/*` | AskHive on the server, surface "site" |
| `/enclave/copilot-site/*` | AskHive in its enclave (product 4): `GET /pubkeys`, `GET /health`, `GET /model-attestation` and `POST /attest` are public; `/chat` is sealed and goes only through the site's proxy |
| `/mcp` | the MCP server over Streamable HTTP (stateless; the same tools as the stdio server) |

The console's hash routes are its actual route names, in French.

The front reads the API at `/api` (same origin) and the RPC at `https://rpc.testnet.arc.io`. Its CSP is
`script-src 'self' 'wasm-unsafe-eval'`: no inline script, no CDN, no eval.

## 2. Chat request (POST `/copilot-site/chat`, JSON)

```json
{ "messages": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…" }],
  "lang": "en" | "fr",
  "user": "0x… (connected wallet, optional)",
  "page": { "name": "home|network|service|doc|space|use|rent|publish|bounty|sessions|operator|demo|…", "productId": "3",
            "section": "…" } }
```

`page` is optional. The panel sends the open page and what its address says (`frontend/src/copilot/page.ts`), and the
server adds one line to the system message ("The user is looking at: …"). Invalid or unknown values are dropped
silently, never echoed raw into the prompt. The page name and the states come from enumerations, the product ID must
be a number, the section must be one of that page's anchors, and the search is bounded (`parsePageContext` in
`site.ts`). The messages themselves go through `parseChatRequest` in `guard.ts`.

## 3. Chat response

```json
{ "text": "…", "tools": [{ "tool": "ui_navigate", "label": "…", "input": { }, "result": { "ok": true }, "inline": false, "inferred": false }],
  "citations": ["…"], "actions": [ ] }
```

Prepare-tool results come in `actions` (cards the user signs) and in `tools`. When the model shows nothing and the
request clearly names a page, the server adds that `ui_navigate` itself (`inferred: true`).

A refusal returns `{ "error", "text", "code", "tools": [], "citations": [] }` with a 4xx status (403 origin, 429 rate,
413, 415, 400), and the panel shows `text`.

## 4. UI tools (site surface only, run in the browser)

The server validates each call and returns `result: { ok: true, …normalized input }` or `{ ok: false, error }`. It
never navigates anything itself: the panel plays every `ok: true` UI tool, in order, with a visible animation.

1. `ui_navigate { page, productId?, query?, state?, kind?, section?, consoleRoute?, reason? }` opens a page of the
   site (`home`, `network`, `service`, `doc`, `space`, `use`, `bounty`, `sessions`, `operator`, `rent`, `publish`,
   `demo`, `datacenter`, `console`). On the Doc page, `section` opens a chapter (`doc.html?c=<chapter>`). `reason`
   (≤ 140 characters) shows as a caption.
2. `ui_highlight { target, note? }` points at an anchor of the current page, or at `product:<id>` / `bounty:<id>`.
   The element pulses, and `note` (≤ 140 characters) shows next to it.
3. `ui_demo { action, part?, chapter? }` plays the 3D demo of the Network page (`play`, `pause`, `next`, `prev`,
   `goto`). `part` is `how` (the default: publish the service, bring an enclave, use it; `chapter` 1 to 3 with
   `goto`), one role's demo (`use`, `rent`, `publish`), or `refusal` (Arc refusing a machine whose image changed by
   one byte).
4. `ui_guide { page?, title, steps }` plays a guided tour of one page (§7).

## 5. Prepare tools (signed by the user's wallet, never by a server)

`session_prepare_open`, `operator_prepare_bond`, `operator_prepare_register` and `bounty_prepare_create` return cards
with checks and a Sign button. `product_scaffold`, `pricing_quote`, `snippet_generate` and `inference_test` return
information cards.

The panel signs with the SDK (`packages/sdk`) and a viem wallet client over the visitor's own wallet (EIP-1193), on
Arc testnet (chain ID 5042002). A failed check blocks the Sign button. No tool spends, and a secret filter runs on the
whole conversation (`secrets.ts`).

## 6. MCP

`/mcp` speaks Streamable HTTP (MCP 2025-03-26). It is stateless (no session ID), returns JSON, and allows any origin
without credentials. Each IP is rate-limited, and a request body is at most 64 KiB. The tool list and logic are those
of `services/mcp/src/tools.ts`: 16 tools that read the network and PREPARE operations. Nothing is signed or sent.

Add it to an agent:

```sh
claude mcp add --transport http archive https://arc-hive.xyz/mcp
```

Or, in any MCP client's configuration: `{ "mcpServers": { "archive": { "url": "https://arc-hive.xyz/mcp" } } }`.

The same server runs locally over stdio. It uses `packages/sdk` by path and imports shared code from
`services/copilot/src`, so install the SDK and the copilot first:
`cd packages/sdk && npm ci && cd ../../services/copilot && npm ci && cd ../mcp && npm ci && npm start` (`ARCHIVE_API`
sets the read API).

## 7. Guided tours (`ui_guide`)

AskHive can walk the visitor through a task on one page. The panel opens the page the guide names, then points out
each step in order, with a ring and its note (the same effect as `ui_highlight`). **Nothing on the page is clicked,
typed or signed**: the visitor does each step, and signs in their own wallet.

```
ui_guide { page?: <a page name>, recipe?: install|operator|session|bounty, title: string ≤ 60,
           steps: 1..6 × { target: an anchor valid for that page, note: string ≤ 120 } }
```

The server validates every call (page names, anchors and lengths, `services/copilot/src/site.ts`) and returns the
normalized guide. The panel plays only an `ok: true` result (`frontend/src/copilot/api.ts`). Pages carry their
anchors as `data-copilot="<name>"`.

The main steps:

- Rent and My machines: `connect`, `bond`, `install`, `pair`, `admit`, `register`;
- Sessions: `check`, `open`, `talk`, `receipt`;
- Use: `connect`, `pick`, `key`, `pay`, `answer`, `settled`;
- Publish: `connect`, `manifest`, `fingerprint`, `propose`, `activate`;
- Bounties: `hunt`, `fund`.

Buttons that sign are never targets: a guide points at the step that holds them.

## 8. Live status

Each answer's system message carries one line read at answer time (`site-live.ts`). The line is kept for 30 s and
read in 3.5 s at most; past that, a fallback line sends the model to `enclaves_list`. It gives:

- the active enclaves per product (`/api/enclaves`), and how many are at the verified level (`/api/levels`);
- the products with no active enclave;
- whether product 7's settlement is authorized;
- the open bounties of both levels (`SealedBounty` from `/api/bounties`, `SealedBountyVerified` read on Arc).

AskHive never states from memory what runs.

## 9. AskHive in its enclave (product 4)

- **Where it runs.** An Intel TDX VM at Phala Cloud (production OS image), with the compose
  `enclave/phala/copilot-site-v22.yml` and the image `enclave/Dockerfile.copilot`. Everything the compose writes in
  clear (surface, model, model URL, limits) is measured into the image fingerprint that Arc allows for product 4. An
  operator cannot change the prompt or plug in another model under the attested badge.
- **What the panel checks before sealing** (`frontend/src/copilot/enclave.ts`, through the SDK's
  `createAttestedCopilotClient` in `packages/sdk/src/copilot.ts`). It reads `/enclave/copilot-site/pubkeys`, then
  checks the key on Arc: registered for product 4, allowed image, active, operator not banned. Only then does it seal
  the conversation with HPKE (`ARC-COPILOT-CHAT-v1`). If a check fails, the panel stays on the server copilot and says
  so. A sealed conversation is never resent in clear.
- **Every answer is sealed and signed.** The reply is sealed (HPKE) to the sealed question, so only the enclave
  holding the key checked on Arc can produce it; the panel opens it with the SDK. Inside the sealed reply:
  `{ status, body, sig: { v: "ARC-COPILOT-SITE-REPLY-v1", signer, requestHash, bodyHash, digest, signature } }`, where
  - `requestHash = keccak256(enc ‖ ciphertext)` of the sealed question;
  - `bodyHash = keccak256(utf8(JSON.stringify(body)))`;
  - `digest = keccak256(abi.encode(tag, chainId, EnclaveRegistry, productId, signer, requestHash, bodyHash))`;
  - `signature` is an EIP-191 signature of the digest.

  `verifySiteReply` (`services/copilot/src/enclave-site.ts`) checks that signature against the key Arc holds
  (`EnclaveRegistry.enclaveOf`).
- **What it says about itself.** In a real TDX VM, it says it runs in product 4's enclave. Outside TDX (a simulated
  quote, in development), it says the opposite, and the enclave refuses to start if its prompt still carries the
  server's wording.
- **Where the model runs.** The model (`gpt-oss-120b`) runs at RedPill, behind an attested gateway that the enclave
  verifies before any call (`MODEL_ATTESTATION=aci`). The model does not run inside ArcHive's enclave.
