# AskHive (the site copilot) and the MCP endpoint: the HTTP contract

AskHive is the assistant of the ArcHive site. The same program (`services/copilot`, `COPILOT_SURFACE=site`) runs in
two places: on the site's server (`/copilot-site/`) and inside its own Intel TDX enclave, registered on Arc as
product 4 (`/enclave/copilot-site/`). The panel of the site (`frontend/src/copilot/`) talks to the enclave when it can
verify it, and says so on screen. This document is the contract between the panel, the copilot service and the MCP
server. Production: https://arc-hive.xyz, one server where Caddy routes by path. The same routes answer at the
server's own address, https://archive.62-171-153-35.sslip.io, where the console runs (`https://arc-hive.xyz/console/`
redirects there).

## 1. Routes in production

| Path | Service |
|---|---|
| `/`, `/network.html` (`?focus=use\|rent\|publish\|arc\|cctp\|demo`), `/service.html?p=<id>`, `/doc.html?c=<chapter>`, `/space.html`, `/bridge.html` | the site (static, Vite multi-page); `/use.html`, `/rent.html` and `/publish.html` redirect to `network.html?focus=use\|rent\|publish` |
| `/console/` (hash routes `#/vue`, `#/ruche`, `#/produits`, `#/primes`, `#/playground`, `#/cles`, `#/publier-prime`, `#/operateur`, `#/publier-produit`, `#/portefeuille`, `#/developpeurs`) | the console |
| `/datacenter/` | the 3D server room |
| `/api/*` | the read API |
| `/copilot/*` | the copilot, surface "console" (the console's bubble) |
| `/copilot-site/*` | AskHive on the server, surface "site" |
| `/enclave/copilot-site/*` | AskHive in its enclave (product 4): `GET /pubkeys`, `GET /health`, `GET /model-attestation` and `POST /attest` public; `/chat` sealed, only through the site's proxy |
| `/mcp` | the MCP server over Streamable HTTP (stateless; same tools as the stdio server) |

The front reads the API at `/api` (same origin) and the RPC at `https://rpc.testnet.arc.io`. CSP:
`script-src 'self' 'wasm-unsafe-eval'` (no inline script, no CDN, no eval).

## 2. Chat request (POST `/copilot-site/chat`, JSON)

```json
{ "messages": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…" }],
  "lang": "en" | "fr",
  "user": "0x… (connected wallet, optional)",
  "page": { "name": "home|network|service|doc|space|use|rent|publish|bounty|sessions|operator|demo|…", "productId": "3",
            "section": "…" } }
```

`page` is optional (the panel sends the open page and what its address says: `frontend/src/copilot/page.ts`): the
server adds one line to the system message ("The user is looking at: …"). Invalid or unknown values are dropped, never
echoed raw into the prompt (bounded strings, enums, digits; `guard.ts parseChatRequest`).

## 3. Chat response

```json
{ "text": "…", "tools": [{ "tool": "ui_navigate", "label": "…", "input": { }, "result": { "ok": true }, "inline": false, "inferred": false }],
  "citations": ["…"], "actions": [ ] }
```

Prepare-tool results come in `actions` (cards the user signs) and in `tools`. When the model shows nothing and the
request clearly names a page, the server adds that `ui_navigate` itself (`inferred: true`). On refusal:
`{ "error", "text", "code", "tools": [], "citations": [] }` with a 4xx status (403 origin, 429 rate, 413, 415, 400);
the panel shows `text`.

## 4. UI tools (site surface only; executed in the browser)

The server validates each call and returns `result: { ok: true, …normalized input }` or `{ ok: false, error }`. It
never navigates anything itself: the panel plays every `ok: true` UI tool, in order, with visible animation.

1. `ui_navigate { page, productId?, query?, state?, kind?, section?, consoleRoute?, reason? }`: opens a page of the site
   (`home`, `network`, `service`, `doc`, `space`, `use`, `bounty`, `sessions`, `operator`, `rent`, `publish`, `demo`,
   `datacenter`, `console`); on the Doc page, `section` opens a chapter (`doc.html?c=<chapter>`); `reason` (≤ 140
   characters) is shown as a caption.
2. `ui_highlight { target, note? }`: an anchor of the current page, or `product:<id>` / `bounty:<id>`; the element
   pulses and `note` (≤ 140 characters) shows next to it.
3. `ui_demo { action, part?, chapter? }`: plays the 3D demo of the Network page (`play`, `pause`, `next`, `prev`,
   `goto`); `part` is `how` (default: publish the service, bring an enclave, use it; `chapter` 1 to 3 with `goto`),
   one role's demo (`use`, `rent`, `publish`) or `refusal` (Arc refusing a machine whose image changed by one byte).
4. `ui_guide { page?, title, steps }`: a guided tour of one page (§7).

## 5. Prepare tools (signed by the user's wallet, never by a server)

`session_prepare_open`, `operator_prepare_bond`, `operator_prepare_register`, `bounty_prepare_create` (cards with
checks and a Sign button), `product_scaffold`, `pricing_quote`, `snippet_generate`, `inference_test` (information
cards). The panel signs with the SDK (`packages/sdk`) and a viem wallet client over the visitor's own wallet
(EIP-1193), chain Arc testnet (id 5042002). A failed check blocks the Sign button. No tool spends, and a secret filter
runs on the whole conversation (`secrets.ts`).

## 6. MCP

`/mcp`: Streamable HTTP (MCP 2025-03-26), stateless (no session id), JSON responses, CORS open (no credentials),
per-IP rate limit, request body ≤ 64 KiB, same tool list and logic as `services/mcp/src/tools.ts`: 16 tools that read
the network and PREPARE operations; nothing is signed or sent. Add it to an agent:

```sh
claude mcp add --transport http archive https://arc-hive.xyz/mcp
```

or, in any MCP client's configuration: `{ "mcpServers": { "archive": { "url": "https://arc-hive.xyz/mcp" } } }`.
The same server runs locally over stdio: `cd services/mcp && npm ci && npm start` (`ARCHIVE_API` sets the read API).

## 7. Guided tours (`ui_guide`)

AskHive can walk the visitor through a task on one page: the panel opens the page the guide names, then points out
each step in order, with a ring and its note (the same effect as `ui_highlight`). **Nothing of the page is clicked,
typed or signed**: the visitor does each step, and signs in their own wallet.

```
ui_guide { page?: <a page name>, recipe?: install|operator|session|bounty, title: string ≤ 60,
           steps: 1..6 × { target: an anchor valid for that page, note: string ≤ 120 } }
```

The server validates every call (page names, anchors and lengths, `services/copilot/src/site.ts`) and returns the
normalized guide; the panel plays only an `ok: true` result (`frontend/src/copilot/api.ts`). Anchors are carried by
`data-copilot="<name>"` on the page. Main steps: Rent and My machines (`connect`, `bond`, `install`, `pair`, `admit`,
`register`), Sessions (`check`, `open`, `talk`, `receipt`), Use (`connect`, `pick`, `key`, `pay`, `answer`,
`settled`), Publish (`connect`, `manifest`, `fingerprint`, `propose`, `activate`), Bounties (`hunt`, `fund`). Buttons
that sign are never targets: a guide points at the step that holds them.

## 8. Live status

Each answer's system message carries one line read at answer time (`site-live.ts`, kept 30 s, read in 3.5 s at most,
else a fallback line that sends the model to `enclaves_list`): active enclaves per product (`/api/enclaves`), how many
at the verified level (`/api/levels`), products with no active enclave, whether product 7's settlement is authorized,
and the open bounties of both levels (SealedBounty from `/api/bounties`, SealedBountyVerified read on Arc). AskHive
never states from memory what runs.

## 9. AskHive in its enclave (product 4)

- **Where it runs.** An Intel TDX VM at Phala Cloud (production OS image), compose `enclave/phala/copilot-site-v22.yml`,
  image `enclave/Dockerfile.copilot`. Everything the compose writes in clear (surface, model, model URL, limits) is
  measured into the image fingerprint that Arc allows for product 4: an operator cannot change the prompt or plug in
  another model under the attested badge.
- **What the panel checks before sealing** (`frontend/src/copilot/enclave.ts`, through the SDK's
  `createAttestedCopilotClient`, `packages/sdk/src/copilot.ts`): it reads `/enclave/copilot-site/pubkeys`,
  then checks the key on Arc (registered for product 4, allowed image, active, operator not banned), then seals the
  conversation with HPKE (`ARC-COPILOT-CHAT-v1`). If a check fails, the panel stays on the server copilot and says
  so; a sealed conversation is never resent in clear.
- **Every answer is sealed and signed.** The reply is sealed (HPKE) to the sealed question, so only the enclave
  holding the key checked on Arc can produce it; the panel opens it with the SDK. Inside the sealed reply:
  `{ status, body, sig: { v: "ARC-COPILOT-SITE-REPLY-v1", signer, requestHash, bodyHash, digest, signature } }`, with
  `requestHash = keccak256(enc ‖ ciphertext)` of the sealed question, `bodyHash = keccak256(utf8(JSON.stringify(body)))`,
  `digest = keccak256(abi.encode(tag, chainId, EnclaveRegistry, productId, signer, requestHash, bodyHash))` and an
  EIP-191 signature of the digest. `verifySiteReply` (`services/copilot/src/enclave-site.ts`) checks that signature
  against the key Arc holds (`EnclaveRegistry.enclaveOf`).
- **What it says about itself.** In a real TDX VM it says it runs in product 4's enclave; outside TDX (simulated
  quote, development) it says the opposite, and the enclave refuses to start if its prompt still carries the server's
  wording. The model (`gpt-oss-120b`) runs at RedPill behind an attested gateway that the enclave verifies before any
  call (`MODEL_ATTESTATION=aci`): the model does not run inside ArcHive's enclave.
