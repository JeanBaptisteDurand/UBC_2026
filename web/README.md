# ArcHive console

The console is where people use ArcHive on Arc testnet (chainId 5042002): browse the products and the enclaves
that serve them, open an encrypted session with a private AI, pay per call with x402, post and hunt sealed bounties,
run an operator machine, publish a product, and ask AskHive for help on any page.

Live: https://archive.62-171-153-35.sslip.io/console/ (the 3D server room is at `/datacenter/` on the same host).

React 18, Vite 5, TypeScript, Tailwind, wagmi and RainbowKit, viem, and the ArcHive SDK (`../packages/sdk`, linked
from source by `vite.config.ts` and `tsconfig.json`).

## Screens

| Menu | Screen | What it does |
| --- | --- | --- |
| Explore | Overview (`screens/Overview.tsx`) | The proof chain of a live enclave, link by link, and the latest activity on Arc |
| Explore | Hive (`screens/Hive.tsx`) | The registered enclaves with their operator, product, level and price |
| Explore | 3D server room (`/datacenter/`) | The same enclaves as racks in a server room, live |
| Explore | Products (`screens/Products.tsx`) | The seven products, their settlement rail and their price |
| Explore | Bounties (`screens/Bounties.tsx`, `screens/Bounty.tsx`) | Sealed bounties at the open and verified levels: a hunter proves an exploit in an enclave on a copy of Arc, the accepted claim reserves the payout, delivering the report pays it |
| Use | Private AI (`screens/Playground.tsx`, `Chat.tsx`, `X402Chat.tsx`) | An encrypted chat with the inference enclave, prepaid by session or paid per call with x402 |
| Use | Keys & sessions (`screens/Keys.tsx`) | Your sessions (each locked to one enclave), access keys (`aek_`) backed by a prepaid session, operator keys (`arcop_`), and the local OpenAI-compatible proxy |
| Use | Post a bounty (`screens/PostBounty.tsx`) | Fund a sealed bounty in USDC |
| Provide | Operator (`screens/Operator.tsx`) | From bare machine to paid enclave: install the agent, pair it with your wallet, follow its checks and its bond |
| Provide | Publish a product (`screens/Publish.tsx`) | Register a product and its manifest on Arc |
| Account | Wallet (`screens/Wallet.tsx`) | Your USDC on Arc, your operator bond, and the way to bring USDC over from other chains with CCTP |
| Build | Developers (`screens/Developers.tsx`) | The MCP server, the SDK, the CLI, the API endpoints, the enclave routes and the contract addresses |
| Every page | AskHive (`screens/FloatingCopilot.tsx`, `CopilotActions.tsx`) | Explains the page and prepares actions that you sign with your own wallet (Cmd+K / Ctrl+K) |

## How it reads and checks the chain

- **State comes from the ArcHive API** (`api.ts`, `/api`): the API reads Arc once on the server and caches it, so the
  browser does not send bursts of RPC reads. Transactions go from your wallet straight to Arc.
- **Enclave keys are checked before anything is encrypted** (`arc.ts`, `useVerifiedEnclave`): the console reads the
  enclave's `/pubkeys` and compares the X25519 key with the one registered in `EnclaveRegistry`, and requires the
  enclave to be active at the head block. A key that does not match is refused.
- **A product's image is shown as proven only when its manifest matches the chain**: `manifestVerified` means that the
  keccak256 of the author's manifest equals the `manifestHash` stored on Arc.
- **AskHive never holds a key**: it prepares an action, the console shows it, and your wallet signs it.

## Run it

```sh
npm ci
npm run dev        # the dev server
npm run typecheck  # tsc --noEmit
npm run build      # typecheck, then the production build in dist/
```

Copy `.env.example` to `.env` to set `VITE_WC_PROJECT_ID` (a WalletConnect project id; injected wallets work without
it). The service URLs are set at build time and default to the local services (`config.ts`: the API on
http://localhost:8809). The production build uses the live paths, as `deploy/build.sh` does:

```sh
VITE_API_URL=https://archive.62-171-153-35.sslip.io/api \
VITE_COPILOT_URL=https://archive.62-171-153-35.sslip.io/copilot \
VITE_ENCLAVE_URL=https://archive.62-171-153-35.sslip.io/enclave/inference \
VITE_O3_URL=https://archive.62-171-153-35.sslip.io/enclave/bounty \
VITE_X402_URL=https://archive.62-171-153-35.sslip.io/enclave/x402 \
VITE_COPILOT_SITE_ENCLAVE_URL=https://archive.62-171-153-35.sslip.io/enclave/copilot-site \
npx vite build --base /console/
```

## Languages

English and French, without a library (`src/i18n`): `en.ts` is the reference dictionary and `fr.ts` must have exactly
the same keys, which the type checker enforces. Refusals are explained in the current language: contract errors by
their name (`i18n/contract-errors.en.ts`), API refusals by their stable code (`i18n/api-errors.ts`) and the SDK's
messages by rule (`i18n/sdk-messages.en.ts`), all through `errors.ts`.

## public/

- `datacenter/`: the 3D server room. `room.js` is a prebuilt bundle of the scene and three.js r160; the models and their
  licences are listed in `datacenter/CREDITS.txt`.
- `manifests/`: the products' manifests, one set per deployment (v1, v2, v2.1 live, v3 deployed). On the live v2.1
  stack, the keccak256 of each `*-v21.json` file equals the `manifestHash` its product stores on Arc (products 1 to 5
  and 7): that match is what lets the console show a product's image as proven. Older sets are kept unchanged so that
  earlier registrations stay checkable.
- `install.sh` and `archive-node.mjs`: the operator agent, built from `packages/node` and served by the site
  (`curl -fsSL https://archive.62-171-153-35.sslip.io/install.sh | sh`). `install.sh` prints the agent's SHA-256 and
  refuses a mismatch when `ARCHIVE_NODE_SHA256` is set.
