# 3D server room: sources

These files build `web/public/datacenter/`, the 3D server room that the site serves at `/datacenter/`. Each rack is
a real ArcHive enclave on Arc testnet. The room replays the network's history on Arc and plays new events live.

```sh
sh web/datacenter-src/build.sh web/public/datacenter   # needs python3, Node.js and npm
```

Run again, the build gives the same files, byte for byte. [`web/README.md`](../README.md#the-3d-server-room) explains
its three steps.

| File | What it holds |
| --- | --- |
| `base.template.html` | The engine page: markup, styles and the script (scene, director, replay, panels, tour) |
| `base-copy.json` | The engine's words, in English and French |
| `room/` | The room's blocks: `world.js` (the room and its zones), `actors.js` (the characters), `choreo.js` (their choreography), `live.js` (the live feed), `archive.js` (Find and each rack's history), `xray.js` (an open cabinet), `hud.js` (keeps the top banner clear of the tools), `extra.js` (the camera's view of each zone) |
| `make_room.py` | Turns the engine page into the server room: the blocks swapped in, then the room's patches |
| `copy_room.py` | The room's words, written over the engine's |
| `hive-data.json` | The recorded network: Arc testnet events, enclaves, products and bounties, as of 12 Nov |
| `make_site.py` | Reshapes the page for the site's strict CSP, copies the model packs and writes the credits |
| `build.sh` | Runs the three steps, checks the result and replaces the output folder |
