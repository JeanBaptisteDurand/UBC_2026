# archive-node

The ArcHive operator agent. It runs an ArcHive enclave on a machine and links that machine to the operator's account on the site. The operator's private key never leaves their wallet: the machine receives an operator key (`arcop_…`) that cannot spend funds.

| Command | What it does |
| --- | --- |
| `doctor` | Checks that the machine is ready: OS, Node, Docker, TDX guest, TSM report, dstack socket, clock, RPC, API, port, enclave health, attestation. Each line says what to do if it is not green. |
| `pair` | Pairs the machine with a wallet by code: the machine shows `HIVE-XXXX-XXXX`, the operator approves it on the site by signing with their wallet. |
| `up` | Starts the enclave in Docker and reports its state to the site every 30 s (heartbeats). |
| `status` | Sums up the local state and what the site knows about the machine. |
| `logs` | Shows the enclave logs (`-f` to follow them). |
| `service install` / `service uninstall` | Starts the agent at boot (systemd, or launchd on macOS). |

Serving the network needs an Intel TDX VM (dstack): `archive-node up --product 1 --tunnel`. `archive-node up --demo` is a local trial without TDX: nothing is registered on Arc.

## Run it from source

```sh
npm ci
npm run dev -- --help     # tsx src/index.ts
npm run typecheck         # tsc
npm test                  # Node's test runner (tsx --test test/*.test.ts), against a local test double of the API
npm run build             # one bundled file: dist/archive-node.mjs
```

Requires Node 20 or later and Docker. Files: `~/.archive/node.json` (operator key, file mode 0600) and `~/.archive/state.json` (last state).
