/** enclave-site-measure.ts — the fingerprint of the site copilot's VM BEFORE it is launched: what product 4's author must
 *  allow on Arc (ProductRegistry.proposeWorkload → applyWorkload), computed from the files.
 *
 *  How dstack and Arc measure a VM (checked against the copilot's v2.1 enclave VM):
 *   - compose-hash = sha256 of Phala's app-compose.json (the docker-compose in the docker_compose_file field, plus the
 *     launch script, the names of the encrypted variables, kms, gateway…), written as COMPACT JSON, SORTED keys, UTF-8
 *     without escaping (json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)): 0x254c2e42… for v2.1,
 *     equal to the compose_hash Phala displayed; the compose-hash goes into RTMR3 (the "compose-hash" event);
 *   - IMAGE fingerprint (what the product allows, EnclaveRegistry.imageIdOf) = keccak256(MRTD ‖ RTMR0 ‖ RTMR1 ‖ RTMR2 ‖
 *     compose-hash ‖ os-image-hash ‖ XFAM ‖ TDATTRIBUTES), without RTMR3 or any instance id: stable from one restart to
 *     the next. MRTD and RTMR0-2 depend on the firmware, the OS image and the VM size, not on the compose.
 *  The v2.1 VM's measurements (tdx.small, node prod9, production dstack-0.5.12) are read back from its registration
 *  transaction (the public calldata of registerEnclave); the replay gives back its registered fingerprint 0x919e9c97….
 *  A VM of the SAME size, on the same OS image and firmware, keeps these measurements: its fingerprint is PREDICTED from
 *  the new compose-hash. The value that counts is still the one in the new VM's real quote (scripts/register-dcap.ts
 *  recomputes it and compares it with the registry before allowing anything).
 *
 *  Usage (no network, no key):
 *    npx tsx src/enclave-site-measure.ts <saved v2.1 app-compose> <docker-compose.yml> [--out <app-compose.json>]
 *  → the compose-hash, the predicted image fingerprint, and (with --out) the exact app-compose.json to deploy
 *    (phala deploy --app-compose <file>: the same launch script, hence the same compose-hash). */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { type Hex } from "viem";
import { dstackImageId } from "@arcvault/sdk";

/** The measurements of the v21 copilot VM, read back from its registration transaction (VERIFIED, Arc testnet). */
export const V21_COPILOT_VM = {
  source: "registerEnclave 0xad8b9780689513b1f68b8aba1a99f1b3156b4038a86aff46cad5ff96e294005e (bloc 71774983, produit 4, VM archive-v21-copilot : tdx.small, prod9, dstack-0.5.12)",
  mrtd: "0x7fe60787222bd394cb516abca2435f22f035ab2cc9c0a4b4b3b148e46297f3d931a237b72f359052c6e657d8c1409173",
  rtmr0: "0x68102e7b524af310f7b7d426ce75481e36c40f5d513a9009c046e9d37e31551f0134d954b496a3357fd61d03f07ffe96",
  rtmr1: "0x4ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec",
  rtmr2: "0x764489f277a8540189761e72b4238ba36d4d647e11bd958d8ab5522af2a4867b0ff63e06b0c4967f1857236244040a5d",
  xfam: "0x0702000000000000",
  tdAttributes: "0x0000001000000000",
  osImageHash: "0x8db40cb23008d6213668b5816702d100b37b859a8a5bfd18d938ae3a1b3715bd",
  composeHash: "0x254c2e42e9bf7dcc8a55924fa9fb4ef346e9bb4837353960ca5547c05a743bb7",
  imageId: "0x919e9c97158daf5f6a214523bebddc54dd1a84fe0be3e2482ca2f22e9483f189",
} as const satisfies Record<string, string>;

/** dstack's canonical JSON: sorted keys (at every level), compact, non-ASCII characters as they are. */
export function canonicalJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(",")}]`;
  if (x && typeof x === "object") {
    return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((x as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(x);
}

/** The compose-hash of a Phala app-compose.json: sha256 of its canonical JSON (0x + 64 hex characters). */
export function composeHashOf(appCompose: Record<string, unknown>): Hex {
  return `0x${createHash("sha256").update(canonicalJson(appCompose), "utf8").digest("hex")}`;
}

/** The app-compose of a new VM: the v21 one (same launch script, same options), with ITS docker-compose. The names of
 *  the encrypted variables must stay those of the compose (allowed_envs): checked here. */
export function appComposeFor(template: Record<string, unknown>, dockerCompose: string): Record<string, unknown> {
  if (typeof template.docker_compose_file !== "string" || typeof template.pre_launch_script !== "string") {
    throw new Error("template: a Phala app-compose.json is expected (docker_compose_file and pre_launch_script)");
  }
  const secrets = [...dockerCompose.matchAll(/^\s*-\s*"?([A-Z0-9_]+)=\$\{[A-Z0-9_]+\}"?\s*$/gm)].map((m) => m[1]!);
  const allowed = Array.isArray(template.allowed_envs) ? template.allowed_envs.map(String) : [];
  const missing = secrets.filter((s) => !allowed.includes(s));
  if (missing.length) throw new Error(`encrypted variables missing from the template's allowed_envs: ${missing.join(", ")}`);
  return { ...template, docker_compose_file: dockerCompose };
}

/** The predicted image fingerprint for a compose-hash, with the measurements of a VM of the same size and OS image. */
export function predictedImageId(composeHash: Hex, vm: { mrtd: string; rtmr0: string; rtmr1: string; rtmr2: string; xfam: string; tdAttributes: string; osImageHash: string } = V21_COPILOT_VM): Hex {
  return dstackImageId(
    { mrtd: vm.mrtd as Hex, rtmr0: vm.rtmr0 as Hex, rtmr1: vm.rtmr1 as Hex, rtmr2: vm.rtmr2 as Hex, xfam: vm.xfam as Hex, tdAttributes: vm.tdAttributes as Hex },
    composeHash, vm.osImageHash as Hex,
  );
}

/** Does the docker-compose still hold the image to replace after the push (never deployable as is)? */
export const IMAGE_PLACEHOLDER = "REPLACE_WITH_PUSHED_DIGEST";

async function main(argv: string[]) {
  const [templatePath, composePath] = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");
  const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined;
  if (!templatePath || !composePath) {
    console.error("usage: npx tsx src/enclave-site-measure.ts <saved v21 app-compose> <docker-compose.yml> [--out <app-compose.json>]");
    process.exit(2);
  }
  const template = JSON.parse(readFileSync(templatePath, "utf8")) as Record<string, unknown>;
  const dockerCompose = readFileSync(composePath, "utf8");
  // template check: it gives back the v21 compose-hash with ITS compose
  const v21 = composeHashOf(template);
  const app = appComposeFor(template, dockerCompose);
  const composeHash = composeHashOf(app);
  const report = {
    template: { file: templatePath, composeHash: v21, isV21Copilot: v21 === V21_COPILOT_VM.composeHash, v21ImageIdReplayed: predictedImageId(v21) === V21_COPILOT_VM.imageId },
    compose: composePath,
    placeholderImage: dockerCompose.includes(IMAGE_PLACEHOLDER),
    composeHash,
    predictedImageId: predictedImageId(composeHash),
    assumes: `same size (tdx.small), same OS image (os-image-hash ${V21_COPILOT_VM.osImageHash}) and same firmware as the v21 VM (${V21_COPILOT_VM.source}), deployed with THIS app-compose (same launch script)`,
    ...(out ? { appCompose: out } : {}),
  };
  if (out) writeFileSync(out, canonicalJson(app));
  console.log(JSON.stringify(report, null, 2));
  if (report.placeholderImage) console.error("WARNING: the compose image is still the placeholder (push the image, then write its digest): nothing to allow with this computation");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(`mesure : ${(e as Error)?.message ?? e}`); process.exit(1); });
}
