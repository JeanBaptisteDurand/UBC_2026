# Credits

## Fonts

- **Montserrat**, SIL Open Font License 1.1 (`public/fonts/montserrat-OFL.txt`).
- **Fragment Mono**, SIL Open Font License 1.1 (`public/fonts/fragment-mono-OFL.txt`).
- `src/network/montserrat-600-caps.typeface.json`: Montserrat capitals converted to a three.js typeface, SIL Open Font
  License 1.1.

## Textures

- [ambientCG](https://ambientcg.com), CC0 1.0: Metal011, Metal028, Metal042A, Fingerprints002, SurfaceImperfections003,
  Fabric030 (`public/net/fab_*.webp`).
- [Poly Haven](https://polyhaven.com), CC0: concrete_wall_008.

Lightmaps, ambient occlusion and the other maps (including `public/net/lm_*.webp` and `rm_*.webp`) were baked for the
project in Blender.

## 3D models

The server room, racks, sleds and facades, the Network scene (`public/net/net3d.glb`) and its figure
(`public/net/people.glb`) were modelled for the project in Blender.

## Sound

The Network demo sound is synthesised at runtime with the Web Audio API; no audio file is shipped.

## Images

`public/og.jpg`, `public/og-network.jpg`, `public/net/poster.jpg` and `public/net/scr_*.jpg` are renders and
screenshots of the project itself.

## Brand marks

- **Arc logo** (`public/arc-logo.svg`, `public/arc-logo-white.svg`): from the official Arc brand kit, used unmodified.
- **USDC symbol** on the Network page: drawn from the paths of Circle's official USDC token logo. USDC is a trademark
  of Circle.
- **Chain logos** on the Network page (Ethereum, Base, Arbitrum, OP Mainnet, Solana, Avalanche, Polygon): official
  marks from each project's brand kit or public repository (sources listed in `src/network/chains.ts`). They remain the
  property of their respective holders.

## Manifests

`public/manifests/*.snapshot` are copies of ArcHive product manifests, shown only when their keccak256 matches the
hash registered on Arc.
