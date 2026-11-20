# ArcHive frontend

This is the ArcHive marketplace site, served at https://arc-hive.xyz. It is built with Vite, React 19 and three.js. It
reads its data live from Arc testnet and from the ArcHive API (`/api`). No key or secret goes through the front end:
every action that moves USDC is signed by the visitor's own wallet.

## Run

```
npm ci
npm run dev        # http://localhost:5261 (the dev server proxies the API, the enclaves and the Arc RPC: vite.config.ts)
npm run typecheck  # tsc --noEmit
npm run build      # static site in dist/
```

Three build profiles set where the page finds the API (`VITE_PROFILE`, documented in `src/data/endpoints.ts`):

- `relay`, the default for dev and previews: the API and the RPC go through the dev-server proxy first, then the
  direct URLs.
- `jb` (`npm run build:jb`, `.env.jb`): the live build. It is served at the root of the ArcHive API origin, so every
  URL is relative to it (`/api`, `/copilot-site`, `/enclave/…`).
- `ext` (`npm run build:ext`, `.env.ext`): served on another HTTPS origin. It calls the public API with absolute URLs.

The two env files hold public build settings only.

## Pages

| Page | What it shows |
|---|---|
| `index.html` | The landing film, with the live state of the network read on Arc |
| `network.html` | Use, Rent and Publish in one 3D room |
| `service.html` | The services by family, and any one service read on Arc |
| `doc.html` | How it works, chapter by chapter, with the contracts read on Arc |
| `space.html` | My space: the bounties, prepaid sessions, machines and published services of the connected wallet |
| `bridge.html` | USDC from another testnet to Arc testnet, with CCTP V2 |

`bounty`, `demo`, `operator`, `products`, `publish`, `rent`, `sessions`, `technology` and `use` keep older addresses
working: each one leads to the matching page or tab. `tournage.html` is the development page that the landing film is
captured from, frame by frame. It is not part of the build.

## AskHive

AskHive, the site's assistant, is on every app page (`src/copilot`). It talks to the copilot enclave registered on Arc
as product 4. Before anything is sent, it checks that enclave's key on Arc, then seals the conversation to it. When the
enclave cannot be used, the ArcHive server answers a new conversation instead, and the panel says so. A conversation
already sealed to the enclave never goes to the server.

## Layout

- `src/network/actions/sdk`: the site's copy of the TypeScript SDK (`packages/sdk`), used for every on-chain read and
  action.
- `src/data`: the endpoints (`endpoints.ts`) and the live reading of Arc and the API (`live.ts`).
- `src/scene`, `src/video`: the 3D server room and the landing film.
- `src/app`, `src/space`, `src/services`, `src/doc`, `src/bridge`: the app pages.

## Generated content

Two files hold the long copy of two pages, in English and French:

- `src/services/vit-content.ts`, the Services page;
- `src/doc/content.ts`, the Doc page.

A one-off converter generated both on 18 Nov 2026, from the HTML of the product page and of the technology page. The
converter is not part of this repository. Since then the TypeScript files are the source, and we edit them in place.

Each file is one JSON object on one line, after `export const VIT =` or `export const DOC =`. Bodies are static HTML.
To change a sentence, edit both `en` and `fr`, keep the JSON valid, then run `npm run typecheck`. A short script that
parses the line, changes the strings and writes it back with `JSON.stringify` is the safest way. Some parts are filled
live, so keep their hooks:

- `[data-live-v]` marks a number that the Services page fills from the API;
- `{ live }` marks a block that `DocPage` draws live;
- `Vitrine.tsx` rewrites the list of running products after "the verified enclaves of products" (EN) and "les
  enclaves vérifiées des produits" (FR), so keep that wording.

## The SDK copy

`src/network/actions/sdk` is a copy of `packages/sdk/src`. The site keeps its own copy because it builds from this
folder alone, with its own lockfile and its own dependency versions (viem 2.57.8 here, 2.21.54 in `packages/sdk`).
`proof-of-cloud.ts` needs Node (`node:https`), so `tsconfig.json` leaves it out of the browser build.

Both copies run the same code. Each side keeps its own comments and message wording. Nothing copies the files
automatically: when `packages/sdk/src` changes, copy the change here by hand, then check both copies:

```
node scripts/sdk-diff.mjs   # lists any file whose code differs from packages/sdk/src
npm run typecheck
```

`sdk-diff.mjs` ignores comments and the text of any string with a space in it, which is where messages differ.
Everything else counts: code, addresses, hex values and numbers.

## Scripts

- `scripts/sizes.mjs` writes the byte size of each scene file (`src/data/sizes.json`) for the loading bar. It runs
  before every build.
- `scripts/film-lite.mjs` packs the light pass of the landing film. It needs `sharp` (`npm i --no-save sharp`).
- `scripts/sdk-diff.mjs` checks the SDK copy against `packages/sdk/src` (see above).

See `MOTION.md` for the motion rules and `CREDITS.md` for the fonts, textures, models and brand marks.
