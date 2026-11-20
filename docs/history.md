# History

ArcHive's earlier contract sets, kept for the record. The site, the API and the enclaves run the v3 stack (deployed on
19 Nov 2026); the v2.1 addresses stay readable on the chain, and the site keeps them under `?stack=v2.1`.

## Timeline

The week went into the core below, then into the marketplace, AskHive and the v3 stack, and every deployment and
admission here links to its transaction on Arc. The commit times are the push times.

**The core, 13 to 16 Nov 2026:**

- **Contracts** (`contracts/`): stack v2 deployed on Arc testnet on 13 Nov (its `EnclaveRegistry`:
  [`0x36ac21e4…d493`](https://explorer.testnet.arc.io/tx/0x36ac21e47bf96affcdfa496780f27ef8204eb770d7cab859fe367ed89873d493)),
  v2.1 (the next stack) on 14 Nov (its `EnclaveRegistry`:
  [`0x90a27bc3…c9be`](https://explorer.testnet.arc.io/tx/0x90a27bc3c78834c8a7c2400367dae863bdfea0d0974799b1262735a0ac10c9be);
  the others in [`deployments.v21.testnet.json`](history/deployments.v21.testnet.json) and
  [`deployments.dcap.testnet.json`](../deployments.dcap.testnet.json)), and the operator-level contracts
  on 15 Nov (`MachineRegistry`:
  [`0xe043c341…98e4`](https://explorer.testnet.arc.io/tx/0xe043c341b4760b7f7fcd251f1fa7a858ae40b1bd75e0dd4c7dacc91f6f9798e4)).
- **Intel DCAP on Arc** (`dcap-integration/`): Automata's verifier deployed on 13 Nov with Intel's collateral
  ([`0x83c00a69…9ec6`](https://explorer.testnet.arc.io/tx/0x83c00a69d5f7ec6cb233ba3e649893a333e4e3728dcc9705b79172af2d069ec6),
  the first of its transactions in [`deployments.dcap.testnet.json`](../deployments.dcap.testnet.json)), refreshed on 14 Nov, before the first product contract.
- **Enclave kit and products** (`enclave/`): private AI (prepaid sessions and pay per call), the sealed bounty with its
  `arc-anvil` replay, the refutation demo and the verified bounty. Enclaves were first admitted through Intel DCAP on
  13 Nov
  ([`0x976e31b8…0c88`](https://explorer.testnet.arc.io/tx/0x976e31b8bf868b5de733ee118d6c538b591418ea425b6ad4b01fd7ec70ce0c88)),
  and the first runs on v2.1 date from 14 to 16 Nov (first admission:
  [`0x199c985d…3499`](https://explorer.testnet.arc.io/tx/0x199c985dee537cfe2948f6c721ad1bdd448d538ff08bc8e93a79036a25f33499)).
- **SDK, `arcvault` CLI and operator agent** (`packages/`).
- **Read API and registrar** (`services/api`, `services/registrar`).
- **Console** (`web/`), served at the server's address.
- **First copilot** (`services/copilot`): the console's assistant, which also ran in its own enclave, admitted as
  product 4 on 14 Nov
  ([`0x98296275…186b`](https://explorer.testnet.arc.io/tx/0x98296275e1c74b78a3c9ed8b8113eb2f69580e14029fb1f2f414676b4664186b)).
- **MCP server** (`services/mcp`) over stdio, with the same 16 tools.

**The marketplace, 13 to 20 Nov 2026** (in this repository's commits and on the live site):

- **The marketplace site** (`frontend/`): the home page and its film, the services rack with a page per service, the
  Network page (use, rent and publish, with a 3D demo), the Doc with its Tokenomics chapter, My space, and the Bridge
  page for CCTP transfers to Arc.
- **AskHive** (`frontend/src/copilot/`, `services/copilot`): the copilot's site surface, with its own enclave build
  admitted as product 4 on 19 Nov
  ([`0xde9628b2…0176`](https://explorer.testnet.arc.io/tx/0xde9628b23d0483bb666a0cd13c55c4f32a1204151323a80da9451b0aeb330176)).
  It opens pages, highlights, plays the 3D demo, guides a task and prepares operations to sign, and its enclave signs
  every reply.
- **The MCP server's HTTP endpoint**, online at `/mcp` for AI agents (its stdio version existed before).
- **The 3D server room** (`web/public/datacenter`): designed during the week's first days, built on 14 and 15 Nov, online since 15 Nov.
- **Console updates**: prices with their unit, the exposure and slashing rules, and a link to the 3D room.
- **Product 7 switched on**: once its timelock delay expired, its settlement contract was authorized to slash bonds (18 Nov,
  23:59 UTC) and to write verdicts (19 Nov, 00:15 UTC).
- **The network relaunched on 19 Nov**: five enclaves admitted on Arc, products 3, 2, 1 and 7 from 00:55 UTC
  ([`0x54d7cf7e…37ef`](https://explorer.testnet.arc.io/tx/0x54d7cf7e891d489093b139d99db37620f9e422c69005eff4bf1549fb9eae37ef),
  [`0x351edb8c…0357`](https://explorer.testnet.arc.io/tx/0x351edb8ca280a7a0dca7ffbd562afeb9215522df250d28288c28fdc4802f0357),
  [`0x3ab1e3da…ae72`](https://explorer.testnet.arc.io/tx/0x3ab1e3dac834f9fb4d5a97f67f7ea5f299b9e92ea3a1a76791a86886e0a1ae72),
  [`0xf18cb68f…6a2c`](https://explorer.testnet.arc.io/tx/0xf18cb68f068e5cfaa993a67da2fd98f4c5d73123460533d0901052b06d166a2c)),
  and AskHive at 22:37 UTC
  ([`0xde9628b2…0176`](https://explorer.testnet.arc.io/tx/0xde9628b23d0483bb666a0cd13c55c4f32a1204151323a80da9451b0aeb330176)).
- **Stack v3 deployed on 19 Nov**: 14 contracts, switched on the next day (its `EnclaveRegistry`:
  [`0xdf5d2ad6…9049`](https://explorer.testnet.arc.io/tx/0xdf5d2ad6529eb2bfdbc0f4dfda4368822cbe03eb7ee7b3087f145065f5679049);
  every other one in [`deployments.v3.testnet.json`](../deployments.v3.testnet.json)).
- **Claude Code's request format on ArcHive's private inference**, tested on 19 Nov (three paid calls).

## Proofs (the previous set)

These runs were made on the v2.1 set; its bytecode is the one deployed again in v3.

**20 Nov 2026 (UTC)**

| What it proves | Time | Transaction |
|---|---|---|
| Prepaid session #3 opened (0.05 USDC), locked on the product 1 enclave | 09:00 | [`0x64495f16…b0a1`](https://explorer.testnet.arc.io/tx/0x64495f162f13f306b4d8d415b26efe6b9a4e5875a40ed606522e6b596e2fb0a1) |
| The session topped up by 0.02 USDC, with one EIP-3009 signature | 09:02 | [`0x5102ae30…b0d4`](https://explorer.testnet.arc.io/tx/0x5102ae3068bbef7486ff172c21539410e6f3ee46b1bce031026a8071a735b0d4) |
| A pay-per-call answer settled by the operator: 0.01 USDC (0.0095 operator, 0.0005 network) | 09:04 | [`0x3c15d9a3…71b7`](https://explorer.testnet.arc.io/tx/0x3c15d9a30a24dc435424d989fc3c51639ee891431ca938b0a788714c9ab271b7) |
| A second pay-per-call answer settled: 0.01 USDC | 09:04 | [`0x3c0c167c…21cc`](https://explorer.testnet.arc.io/tx/0x3c0c167cafd1fe5acaf603fba393eeef1a0a70739b60832b43dc3d06044b21cc) |
| A third pay-per-call answer settled: 0.01 USDC | 09:05 | [`0x05544243…8a8a`](https://explorer.testnet.arc.io/tx/0x05544243b954b1c4c26c69f902d20130941da9166ec4e41eeb0af8fc32578a8a) |
| The session settled by the operator on the enclave's last cumulative receipt: 0.0592 USDC (0.05624 operator, 0.00296 network) | 09:05 | [`0x1ebe664a…a62b`](https://explorer.testnet.arc.io/tx/0x1ebe664a736bf41b3ed7eb3ccc1333766713c64e8eae5c6bbc3e699f0612a62b) |
| The session closed by its owner: 0.0108 USDC refunded (0.07 deposited, 0.0592 paid) and an ERC-8004 verdict of 100 written, in the same transaction | 10:12 | [`0x319c34ea…b305`](https://explorer.testnet.arc.io/tx/0x319c34eacadce231c7a8cd4cf0060e57285b40d5567cf5c723523e058a8ab305) |

**19 Nov 2026 (UTC)**

| What it proves | Time | Transaction |
|---|---|---|
| Product 3 enclave (pay per call) admitted: Intel DCAP and boot-log replay | 00:55 | [`0x54d7cf7e…37ef`](https://explorer.testnet.arc.io/tx/0x54d7cf7e891d489093b139d99db37620f9e422c69005eff4bf1549fb9eae37ef) |
| Product 2 enclave (sealed bounty) admitted | 00:55 | [`0x351edb8c…0357`](https://explorer.testnet.arc.io/tx/0x351edb8ca280a7a0dca7ffbd562afeb9215522df250d28288c28fdc4802f0357) |
| Proof of Cloud token verified on Arc (Ed25519): the chip is declared until 26 Nov | 00:56 | [`0x38c587ae…1e83`](https://explorer.testnet.arc.io/tx/0x38c587aefb3d325383f471be5f6f359dd40123b4c57ce259b0c0bd96987b1e83) |
| Product 1 enclave (private AI) admitted | 01:01 | [`0x3ab1e3da…ae72`](https://explorer.testnet.arc.io/tx/0x3ab1e3dac834f9fb4d5a97f67f7ea5f299b9e92ea3a1a76791a86886e0a1ae72) |
| Product 7 enclave (verified bounty) admitted | 01:02 | [`0xf18cb68f…6a2c`](https://explorer.testnet.arc.io/tx/0xf18cb68f068e5cfaa993a67da2fd98f4c5d73123460533d0901052b06d166a2c) |
| A pay-per-call answer settled by the operator: 0.01 USDC (0.0095 operator, 0.0005 network) | 02:00 | [`0xeadad0b4…fbd0`](https://explorer.testnet.arc.io/tx/0xeadad0b46d51a733997777bccfedd3f05dc69a0a942620f7458c75e35c16fbd0) |
| Prepaid session #2 opened (0.05 USDC), locked on the product 1 enclave | 02:11 | [`0xdb7fc9e3…666d`](https://explorer.testnet.arc.io/tx/0xdb7fc9e3b024415599eee67746ae162f3032add224afed25ab7c09862b83666d) |
| A demo bounty posted on the verified bounty (1 USDC pool, open until 22 Nov) | 02:16 | [`0x28d12457…daea`](https://explorer.testnet.arc.io/tx/0x28d12457644404621d37c52b4c93fab0317c8b0883adb74f347bf5e65f6edaea) |
| The session settled by the operator on the enclave's last cumulative receipt: 0.034 USDC | 02:20 | [`0x97c17946…79ee`](https://explorer.testnet.arc.io/tx/0x97c17946a14c02cdbdd1d6aafd7a405500b6bd44a5f536c77af560aa0cbc79ee) |
| The session closed: 0.016 USDC refunded and ERC-8004 verdict 100, in one transaction | 03:23 | [`0x95c9f59e…b1c2`](https://explorer.testnet.arc.io/tx/0x95c9f59eee7597a532ce72162b83944e9364b1b600ff35ea6b9fd4eb2290b1c2) |
| AskHive's enclave admitted (product 4) | 22:37 | [`0xde9628b2…0176`](https://explorer.testnet.arc.io/tx/0xde9628b23d0483bb666a0cd13c55c4f32a1204151323a80da9451b0aeb330176) |

**14 to 16 Nov 2026 (UTC)**

**First runs, 14 to 16 Nov 2026 (UTC)**

| What it proves | Time | Transaction |
|---|---|---|
| Inference enclave admitted through on-chain DCAP and RTMR3 replay (6,866,126 gas) | 14 Nov 18:57 | [`0x199c985d…3499`](https://explorer.testnet.arc.io/tx/0x199c985dee537cfe2948f6c721ad1bdd448d538ff08bc8e93a79036a25f33499) |
| An exploit replayed inside TDX with Arc Foundry's `arc-anvil` (6.3 s): claim accepted, target paused | 14 Nov 19:04 | [`0xfe46faea…a5d8`](https://explorer.testnet.arc.io/tx/0xfe46faea86254ae63eedfb3c859d928b1d08a9352b851c6b88ab262bcb7ea5d8) |
| Payout, sealed report and ERC-8004 verdict in one transaction: 0.5 USDC hunter, 0.05 network, 0.025 operator | 14 Nov 19:04 | [`0xecbd089a…807e`](https://explorer.testnet.arc.io/tx/0xecbd089a092edd939ff646fae8d22c0f2616b6a92f58a49928c231c770bb807e) |
| A prepaid session settled by the operator, without the client: 0.0994 USDC | 14 Nov 19:12 | [`0x9430e16a…1bb4`](https://explorer.testnet.arc.io/tx/0x9430e16a5cff9bd099c0a7a5f2b11dc87e4c11ad6444a0cd9c87f71ee72f1bb4) |
| A pay-per-call answer from the browser, settled about 20 s later | 14 Nov 19:25 | [`0xa41f1276…15d9`](https://explorer.testnet.arc.io/tx/0xa41f1276a9f0b0af98d1991ae1ab06e5f1afb3d9bed71bca486ccea7255c15d9) |
| Session closed: 0.9006 USDC refunded and ERC-8004 verdict 100 | 14 Nov 21:04 | [`0xb8299f06…d62f`](https://explorer.testnet.arc.io/tx/0xb8299f0698992da535648b14fe1cdd59231ade96b70a515acd7314afc2c8d62f) |
| A lying enclave's inflated claim (2 USDC instead of 1) accepted | 15 Nov 00:07:24 | [`0x6aee80e9…b0ea`](https://explorer.testnet.arc.io/tx/0x6aee80e974458ba251d75d7d82f8bfe361006fc328fc1416816221a2e76eb0ea) |
| Refuted by two other operators' enclaves 16 s later: bond seized, operator banned, verdict 0 | 15 Nov 00:07:40 | [`0x0ffca543…051f`](https://explorer.testnet.arc.io/tx/0x0ffca5433186735bf5525e525995f3589d842681da8ffcaa82acb5993025051f) |
| Proof of Cloud alliance token verified on Arc (Ed25519) | 15 Nov 23:01 | [`0x3e2aa322…cd35`](https://explorer.testnet.arc.io/tx/0x3e2aa32251a7a7cfa7ee69c3fa653cac6dd4272db2ae92d1b4ed760178fdcd35) |
| An enclave bound to its chip (PPID read from Intel's certificate) | 16 Nov 17:34 | [`0xd6928088…5f4f`](https://explorer.testnet.arc.io/tx/0xd6928088d90f8bbc2585d04564c4a574312593f3f19792a1cdbf819437bb5f4f) |

## Addresses

- v2.1 (the previous live stack): every address and deployment transaction in
  [`deployments.v21.testnet.json`](history/deployments.v21.testnet.json).
- v2 (the first stack, replaced on 14 Nov): [`deployments.v2.testnet.json`](history/deployments.v2.testnet.json).
- Intel's DCAP verifier and its collateral: [`deployments.dcap.testnet.json`](../deployments.dcap.testnet.json).
- v3 (the live stack since 19 Nov): [`deployments.v3.testnet.json`](../deployments.v3.testnet.json).
