# Deploying ArcHive

One server runs https://arc-hive.xyz.

The whole site runs from one folder, `/opt/archive`. The server builds it from the source in `/opt/archive/src`: this
repository, without secrets. The enclaves do not run here, because this server has no Intel TDX. They run in Intel
TDX VMs at Phala Cloud (see [Enclaves](#enclaves-intel-tdx-at-phala-cloud)).

## What is served

| Path | What | Source |
|---|---|---|
| `/`, `/network.html`, `/service.html?p=<n>`, `/doc.html`, `/space.html`, `/bridge.html` (`/use.html`, `/rent.html` and `/publish.html` redirect to the Network page) | The marketplace site, with the AskHive panel | `frontend/` |
| `/console/` (hash routes `#/vue`, `#/ruche`, `#/produits`, `#/primes`, `#/playground`, `#/operateur`, `#/developpeurs`…) | The console: wallet, sessions, keys, bounties, operators, publishing, CCTP, developer docs | `web/` |
| `/datacenter/` | The 3D server room (live data and a replay of recorded events) | `web/public/datacenter/` |
| `/api/*` | The read API and its own index of contract events | `services/api` |
| `/copilot/*` | The console's copilot | `services/copilot` |
| `/copilot-site/*` | AskHive on the server (same program, `COPILOT_SURFACE=site`): it drives the site's pages and prepares operations the user signs | `services/copilot` |
| `/mcp` | The MCP server over Streamable HTTP (stateless; reads and prepared actions only) | `services/mcp` (`src/http.ts`) |
| `/install.sh`, `/archive-node.mjs`, `/manifests/` | The operator agent and the products' manifests | `web/public/`, `packages/node` |
| `/enclave/<name>/` | Same-origin proxy to the enclaves (TLS verified, exact host name) | `deploy/nginx.conf` |
| `/arc-rpc` | Optional: a read-only gateway to an Arc node of our own, for state proofs; it answers 502 when no node runs | `deploy/arc-node/` |

## On the server

| What | Where |
|---|---|
| Source, without secrets | `/opt/archive/src` |
| What runs | `/opt/archive`: `api.mjs`, `copilot.mjs`, `registrar.mjs`, `mcp-http.mjs`, `web/`, `docker-compose.yml`, `nginx.conf`, `Caddyfile` |
| Data (event index, paired machines) | `/opt/archive/data` |
| Secrets, never in the code | `/opt/archive/*.env` (mode 600): `registrar-v2.env` (operator key only), `test-signer.env`, `copilot.env`, `nginx.env` |

The contract owner's key never lives on the server. The registrars hold the operator's key only.

## Scripts

```sh
./deploy/push.sh                         # from a dev machine: send the source (filter: rsync-filter.txt), then deploy there
/opt/archive/src/deploy/deploy.sh        # on the server: build.sh, configuration, restart, checks
/opt/archive/src/deploy/build.sh web     # on the server: the site only (front, console, 3D room); services untouched
/opt/archive/src/deploy/front-update.sh  # on the server: merge frontend/ from a GitHub branch (BRANCH, default main), then build the site
```

- **`build.sh`** runs in a Node 22 container. It installs the dependencies, then builds the `api`, `copilot`,
  `registrar` and `mcp-http` bundles (esbuild) and the `archive-node` agent. It builds the console (Vite,
  `--base /console/`) and the front (Vite, profile `frontend/.env.jb`: every URL on this origin), then assembles
  `/opt/archive/web`. It refuses to overwrite a `web/` changed by hand; `FORCE_WEB=1` does it on purpose.
- **`deploy.sh`** runs `build.sh` and installs `docker-compose.yml`, `nginx.conf` and the `Caddyfile`. It restarts the
  services, recreates Caddy only when its file changed, then checks the site. It checks the enclaves separately: one
  enclave being down is not a site failure.
- Every container runs without new privileges and drops the Linux capabilities it does not use. Every image is pinned
  by digest.

## Enclaves (Intel TDX at Phala Cloud)

- Each enclave image runs in its own VM on Phala's `prod9` node (production OS image `dstack-0.5.12`, size
  `tdx.small`).
- The compose files live in `enclave/phala/*.yml`. What they write in clear goes into the image fingerprint that Arc
  checks, so they stay byte for byte as deployed.
- After creating or replacing a VM, set its host in `deploy/nginx.conf` (the `/enclave/…` blocks) and in
  `deploy/docker-compose.vps.yml` (the registrar's `ENCLAVE_URL`), then run `deploy.sh`. The registrar registers the
  enclave on Arc through DCAP and renews it before its window ends.
- Without enclaves, the pages, both server copilots, the MCP server, the operator bond and every on-chain read still
  work. Private AI, pay per call, AskHive's enclave mode and new bounties need a live enclave.

## Never copied to the server

`.secrets/`, `.git/`, every `.env` (except `web/.env.local`, the public WalletConnect id), `node_modules/`, `dist/`
and build outputs. See `rsync-filter.txt`.
