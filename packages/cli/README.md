# arcvault CLI

The command-line client for ArcHive, the open network of verified enclaves on Arc (Arc testnet, chainId 5042002). It is built on `packages/sdk`.

```sh
npm ci
npm run arcvault -- --help
npm run arcvault -- products
```

- **Reads need no key**: `products`, `enclaves`, `bounties`, `verify`, and the `list` and `status` commands of each group.
- **Writes are signed** with the `PRIVATE_KEY` environment variable, which is never printed. Every signing command supports `--dry-run`, which simulates the transaction without sending it. A key passed on the command line is refused, so it never lands in shell history or the process list.

Command groups:

| Group | Commands |
| --- | --- |
| `session` | `open`, `list`, `status`, `topup`, `close`, `rotate` |
| `bounty` | `list`, `status`, `create`, `submit`, `reports`, `refute` |
| `operator` | `init`, `bond`, `register`, `renew`, `retire`, `settle`, `status`, `level`, `bind-machine`, `proof-of-cloud` |
| `product` | `list`, `propose`, `activate`, `policy` |
| `auditor` | `attest`, `revoke` |
| top level | `products`, `enclaves`, `bounties`, `verify`, `proxy` |

Sealed Bounty secrets stay on the user's disk: `bounty create` generates a fresh X25519 key per bounty and writes it with file mode 0600. These rules, and the argument parser, are tested in `packages/sdk/test/bounty-rules.test.ts` (run `npm test` in `packages/sdk`).

The package and its binary are named `arcvault`, the npm scope shared by every package in this repository.
