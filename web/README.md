# ArcHive console

The console is where people use ArcHive on Arc testnet (chainId 5042002). Browse the products and the enclaves that
serve them. Chat with a private AI over an encrypted session, or pay per call with x402. Post a sealed bounty or hunt
one, run an operator machine, publish a product. On every page, AskHive explains what you see.

Live: https://arc-hive.xyz/console/. The 3D server room is at https://arc-hive.xyz/datacenter/.

The console is built with React 18, Vite 5, TypeScript and Tailwind. Wallets connect through wagmi and RainbowKit, and
viem talks to Arc. The ArcHive SDK (`../packages/sdk`) is compiled from source, through `vite.config.ts` and
`tsconfig.json`.

## Screens

| Menu | Screen | Route | What it does |
| --- | --- | --- | --- |
| Explore | Overview (`screens/Overview.tsx`) | `#/vue` | The proof chain of a live enclave, link by link, and the latest activity on Arc |
| Explore | Hive (`screens/Hive.tsx`) | `#/ruche` | The registered enclaves, with their operator, product, level and price |
| Explore | 3D server room (`datacenter-src/`) | `/datacenter/` | The same enclaves as racks in a server room, live |
| Explore | Products (`screens/Products.tsx`) | `#/produits` | The seven products, their settlement rail and their price |
| Explore | Bounties (`screens/Bounties.tsx`, `screens/Bounty.tsx`) | `#/primes` | Sealed bounties at the open and verified levels. A hunter proves an exploit in an enclave, on a copy of Arc. The accepted claim reserves the payout, and the delivered report pays it |
| Use | Private AI (`screens/Playground.tsx`, `Chat.tsx`, `X402Chat.tsx`) | `#/playground` | An encrypted chat with the inference enclave, prepaid by session or paid per call with x402 |
| Use | Keys & sessions (`screens/Keys.tsx`) | `#/cles` | Your sessions (each locked to one enclave), access keys (`aek_`) backed by a prepaid session, operator keys (`arcop_`) and the local OpenAI-compatible proxy |
| Use | Post a bounty (`screens/PostBounty.tsx`) | `#/publier-prime` | Fund a sealed bounty in USDC |
| Provide | Operator (`screens/Operator.tsx`) | `#/operateur` | From bare machine to paid enclave: install the agent, pair it with your wallet, follow its checks and its bond |
| Provide | Publish a product (`screens/Publish.tsx`) | `#/publier-produit` | Register a product and its manifest on Arc |
| Account | Wallet (`screens/Wallet.tsx`) | `#/portefeuille` | Your USDC on Arc, your operator bond, and the way to bring USDC over from other chains with CCTP |
| Build | Developers (`screens/Developers.tsx`) | `#/developpeurs` | The MCP server, the SDK, the CLI, the API endpoints, the enclave routes and the contract addresses |
| Every page | AskHive (`screens/FloatingCopilot.tsx`, `CopilotActions.tsx`) | on every route | Explains the page and prepares actions that you sign with your own wallet (Cmd+K / Ctrl+K) |

The routes keep their original names, mostly French: shared links and AskHive use them, and the labels follow the
language.

## How it reads and checks the chain

- **State comes from the ArcHive API** (`api.ts`, `/api`). The API reads Arc on the server and caches it, so the
  browser does not send bursts of RPC reads. Transactions go from your wallet straight to Arc.
- **Enclave keys are checked before anything is encrypted** (`arc.ts`, `useVerifiedEnclave`). The console reads the
  enclave's `/pubkeys` and compares its X25519 key with the one registered in `EnclaveRegistry`. The enclave must also
  be active at the head block. A key that does not match is refused.
- **A product's image is shown as proven only when its manifest matches the chain.** `manifestVerified` means that the
  keccak256 of the author's manifest equals the `manifestHash` stored on Arc.
- **AskHive never holds a key.** It prepares an action, the console shows it, and your wallet signs it.

## Run it

The console compiles the SDK from source, so the SDK's dependencies come first:

```sh
(cd ../packages/sdk && npm ci)
npm ci
npm run dev        # the dev server
npm run typecheck  # tsc --noEmit
npm run build      # typecheck, then the production build in dist/
```

Copy `.env.example` to `.env` to set `VITE_WC_PROJECT_ID`, a WalletConnect project id. Injected wallets work without
it. The service URLs are fixed at build time and default to the local services (`config.ts`: the API on
http://localhost:8809). The production build uses the live paths, as `deploy/build.sh` does:

```sh
VITE_API_URL=https://arc-hive.xyz/api \
VITE_COPILOT_URL=https://arc-hive.xyz/copilot \
VITE_ENCLAVE_URL=https://arc-hive.xyz/enclave/inference \
VITE_O3_URL=https://arc-hive.xyz/enclave/bounty \
VITE_X402_URL=https://arc-hive.xyz/enclave/x402 \
VITE_COPILOT_SITE_ENCLAVE_URL=https://arc-hive.xyz/enclave/copilot-site \
npx vite build --base /console/
```

## Languages

The console speaks English and French, without a library (`src/i18n`). `en.ts` is the reference dictionary, and
`fr.ts` must have exactly the same keys: the type checker enforces it. Refusals are explained in the current language,
all through `errors.ts`:

- contract errors, by their name (`i18n/contract-errors.en.ts`);
- API refusals, by their stable code (`i18n/api-errors.ts`);
- the French messages of the SDK and the enclaves, by rule (`i18n/sdk-messages.en.ts`). In French they show as they
  came.

## public/

- `datacenter/`: the 3D server room, built from `datacenter-src/` (see below). `datacenter/CREDITS.txt` lists its
  models and their licences.
- `manifests/`: the products' manifests, one set per deployment: v3 (live) and the earlier sets (v2.1, v2, v1). On
  v2.1, the keccak256 of each `*-v21.json` file equals the `manifestHash` its product stores on Arc
  (products 1 to 5 and 7). That match lets the console show a product's image as proven. Older sets stay unchanged, so
  earlier registrations remain checkable.
- `archive-node.mjs`: the operator agent, built from `packages/node` (`npm run build` there copies it here).
- `install.sh`: installs that agent (`curl -fsSL https://arc-hive.xyz/install.sh | sh`). It prints
  the agent's SHA-256, and refuses a mismatch when `ARCHIVE_NODE_SHA256` is set.

## The 3D server room

`public/datacenter/room.js` is built from `datacenter-src/`. The build is reproducible: run again, it gives the same
files, byte for byte (checked in a clean Linux container and on macOS).

```sh
sh datacenter-src/build.sh public/datacenter   # needs python3, Node.js and npm
```

The build has three steps:

1. `make_room.py` turns the engine page (`base.template.html`) into the server room. It swaps in the blocks of `room/`
   (the room and its zones, the characters, their choreography, the live feed, the archive) and applies the room's
   patches. Each patch checks that its text is still there.
2. `copy_room.py` writes the room's words, in English and French, over the engine's (`base-copy.json`). The words and
   the recorded network (`hive-data.json`, the state of 17 Nov) go into the page as two JSON blocks.
3. `make_site.py` reshapes the page for the site's strict CSP (`script-src 'self'`). esbuild then bundles its script
   with three.js r160 into one local file, `room.js`.

three@0.160.0 and esbuild@0.24.2 are installed once, at exact versions, in `~/.cache/archive-room-site`
(`ARCHIVE_ROOM_CACHE` moves it). The model packs stay in `public/datacenter/m/`, and the build copies them as they are.
In the browser, the room reads the ArcHive API on load and every 20 s. When the API cannot be reached, it shows the
recorded state. `deploy/build.sh` copies the folder to the site's `/datacenter/` and points its console button at
`/console/`.
