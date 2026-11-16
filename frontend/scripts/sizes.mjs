// Writes src/data/sizes.json (byte size of each scene file), read by src/assets.ts so the loading bar follows the
// bytes actually received. Runs before every build (npm run build).
import { readdirSync, statSync, writeFileSync } from 'node:fs'
const out = {}
for (const d of ['public/models', 'public/tex']) for (const f of readdirSync(d)) out[f] = statSync(`${d}/${f}`).size
writeFileSync('src/data/sizes.json', JSON.stringify(out, null, 1) + '\n')
