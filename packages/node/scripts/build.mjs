// build.mjs — one executable file, dist/archive-node.mjs, copied into web/public/ (served by the site
// for "curl -fsSL …/install.sh | sh"). No runtime dependency: only Node's own modules.
import { build } from "esbuild";
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const outfile = resolve(root, "dist/archive-node.mjs");
const published = resolve(root, "../../web/public/archive-node.mjs");

await build({
  entryPoints: [resolve(root, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile,
  legalComments: "none",
  // readable on purpose: an operator must be able to read again what they run
  minify: false,
  define: { __ARCHIVE_NODE_VERSION__: JSON.stringify(pkg.version) },
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as _cr } from 'module'; const require = _cr(import.meta.url);",
  },
  logLevel: "warning",
});
chmodSync(outfile, 0o755);
mkdirSync(dirname(published), { recursive: true });
copyFileSync(outfile, published);
chmodSync(published, 0o755);
console.log(`archive-node ${pkg.version} → ${outfile}\n                 → ${published}`);
