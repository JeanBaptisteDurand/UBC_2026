# arcvault CLI

The command-line client for ArcHive, the open network of verified enclaves on Arc (Arc testnet, chainId 5042002). It is built on `packages/sdk`.

```sh
npm ci
npm run arcvault -- --help
npm run arcvault -- products
```

- **Reads need no key**: `products`, `enclaves`, `bounties`, `verify`, and the `list` and `status` commands of each group.
- **Writes are signed** with the `PRIVATE_KEY` environment variable, which is never printed. Every signing command supports `--dry-run`, which simulates the transaction without sending it. The CLI refuses a key passed on the command line, so the key never lands in shell history or the process list.

Command groups:

| Group | Commands |
| --- | --- |
| `session` | `open`, `list`, `status`, `topup`, `close`, `rotate` |
| `bounty` | `list`, `status`, `create`, `submit`, `reports`, `refute` |
| `operator` | `init`, `bond`, `register`, `renew`, `retire`, `settle`, `status`, `level`, `bind-machine`, `proof-of-cloud` |
| `product` | `list`, `propose`, `activate`, `policy` |
| `auditor` | `attest`, `revoke` |
| top level | `products`, `enclaves`, `bounties`, `verify`, `proxy` |

Sealed Bounty secrets stay on the user's disk. `bounty create` generates a fresh X25519 key per bounty and writes it with file mode 0600. The CLI has no test runner of its own: `packages/sdk/test/bounty-rules.test.ts` tests these rules and the argument parser (run `npm test` in `packages/sdk`).

The binary is named `arcvault`, like the npm scope `@arcvault` that every package in this repository shares.
