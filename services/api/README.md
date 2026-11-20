# ArcHive API

The read API of ArcHive, served under `https://arc-hive.xyz/api/` (for example
[`/api/stats`](https://arc-hive.xyz/api/stats) and [`/api/health`](https://arc-hive.xyz/api/health)). It serves the state of the network over HTTP to the site, the console, the MCP server and any other client. It never holds a user's key or funds.

- Events come from the API's own index (`src/indexer.ts`). The indexer reads Arc's RPC from the deployment block and saves the index to `DATA_DIR`. State reads are batched with Multicall3: one RPC call covers dozens of reads.
- The proof chain (`/proof`) names the image each enclave actually ran and the outcome of the session's ERC-8004 verdict. Images are pinned by digest, and the measurement is the `imageId` registered on Arc.

| Area | Endpoints |
| --- | --- |
| Network | `GET /health`, `/products`, `/products/:id`, `/levels`, `/enclaves`, `/bounties`, `/sessions/:owner`, `/pricing` |
| Console | `GET /index`, `/stats`, `/activity`, `/proof`; `POST /verify-receipt` |
| Operators | `GET /auth/nonce`; `POST /pair/start`, `GET /pair/:code`, `POST /pair/approve`, `/pair/poll`, `/pair/reject`; `/operator/keys` (create, list, revoke); `POST /machines/heartbeat`, `GET /machines`, `/machines/:id` and their signed variants |

Every error carries a stable `code` and its values in `params`, next to an English sentence in `error`. The site and the operator agent display errors from the code, in their own language.

Operators sign their actions with EIP-4361 messages. This API issues each nonce, and a nonce serves once. The message must name this site, this chain (Arc testnet) and the action's exact statement. Pairing by code (`HIVE-XXXX-XXXX`) gives a machine an operator key (`arcop_…`) that cannot spend funds.

`src/testSigner.ts` is an opt-in testnet demo wallet for end-to-end runs without a browser extension. It is off unless `TEST_SIGNER_PK` and `TEST_SIGNER_TOKEN` are set, and it only signs an allowlist of calls to the ArcHive contracts where the funds stay with that wallet or return to it.

## Run it

```sh
npm ci
npm start                          # tsx src/server.ts, port 8809
npm test                           # Node's test runner (tsx --test), no network: a stub RPC and local requests
```

Environment: `PORT` (8809), `DATA_DIR` (`./data`), `RPC_URL`, `INDEX_FROM_BLOCK`, `WEB_URL` (the public site, whose origin sign-in messages must name), `SIGN_ORIGINS` (extra origins, for development), `INFERENCE_IMAGE`, and the optional `TEST_SIGNER_*` variables.
