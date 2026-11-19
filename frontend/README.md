# ArcHive frontend

The marketplace site served at https://arc-hive.xyz, built with Vite, React 19 and three.js. It reads its data live
from Arc testnet and from the ArcHive API (`/api`). No key or secret goes through the front end: every action that
moves USDC is signed by the visitor's own wallet.

## Run

```
npm ci
npm run dev        # http://localhost:5261 (the dev server proxies the API, the enclaves and the Arc RPC: vite.config.ts)
npm run typecheck  # tsc --noEmit
npm run build      # static site in dist/
```

Build profiles (`VITE_PROFILE`, documented in `src/data/endpoints.ts`):

- `relay` (default, dev and previews): the API and the RPC go through the dev-server proxy first, then the direct URLs;
- `jb` (`npm run build:jb`, `.env.jb`): the live build, served at the root of the ArcHive API origin, so every URL is
  relative to it (`/api`, `/copilot-site`, `/enclave/…`);
- `ext` (`npm run build:ext`, `.env.ext`): served on another HTTPS origin, calling the public API with absolute URLs.

The two env files hold public build settings only.

## Pages

| Page | What it shows |
|---|---|
| `index.html` | The landing film, with the live state of the network read on Arc |
| `network.html` | Use, Rent and Publish in one 3D room |
| `service.html` | The services by family, and any one service read on Arc |
| `doc.html` | How it works, chapter by chapter, with the contracts read on Arc |
| `space.html` | My space: bounties, prepaid sessions, machines and published services of the connected wallet |
| `bridge.html` | USDC from another testnet to Arc testnet with CCTP V2 |

`bounty`, `demo`, `operator`, `products`, `publish`, `rent`, `sessions`, `technology` and `use` keep older addresses
working: each leads to the matching page or tab. `tournage.html` is the development page the landing film is captured
from, frame by frame; it is not part of the build.

AskHive, the site's assistant, is on every app page (`src/copilot`): it talks to the copilot enclave registered on Arc
and checks that enclave's key on Arc before anything is sent.

## Layout

- `src/network/actions/sdk`: the site's copy of the TypeScript SDK (`packages/sdk`), used for every on-chain read and
  action;
- `src/data`: endpoints (`endpoints.ts`) and the live reading of Arc and the API (`live.ts`);
- `src/scene`, `src/video`: the 3D server room and the landing film;
- `src/app`, `src/space`, `src/services`, `src/doc`, `src/bridge`: the app pages.

## Scripts

`scripts/sizes.mjs` writes the byte size of each scene file (`src/data/sizes.json`) for the loading bar and runs before
every build. `scripts/film-lite.mjs` packs the light pass of the landing film and needs `sharp`
(`npm i --no-save sharp`).

See `MOTION.md` for the motion rules and `CREDITS.md` for fonts, textures, models and brand marks.
